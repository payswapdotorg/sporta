/**
 * W913 ROUTE-LEVEL ADMISSION TESTS — the quota/queue guards firing through
 * the REAL route handlers over a HERMETIC composition (in-memory transient
 * backing + pinned clock + deterministic hasher — the only injected seams
 * the composition root exposes).
 *
 * Proven here (the W913 acceptance: quota guards and degradation paths):
 * 1. AUTH RATE LIMITS: login attempts are counted per source IP AND per
 *    attempted account handle — attempts, not successes (a correct password
 *    is REFUSED once the window is exhausted — fail-closed admission), and
 *    the refusal is an honest 429 with the W901 QuotaState + Retry-After.
 * 2. REGISTRATION limits: per-IP and per-attempted-handle windows.
 * 3. RENDER QUOTA: the studio's dispatch consumes the per-user
 *    render-requests quota; exhaustion → 429 + the CAPABILITY response
 *    degrades (overall: degraded, quota-exhausted) and the studio options
 *    surface the live quota state.
 * 4. BOUNDED QUEUE: a full queue refuses new expensive jobs BEFORE the
 *    provider runs them (503, Simulation E); releasing a slot admits again;
 *    the settled job's slot is returned by the job poll.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { createDeterministicTestHasher } from "@sporta/identity";
import { InMemoryRedis } from "../src/server/platform/upstash/redis";
import { HOSTED_QUEUE_MAX_DEPTH, RENDER_REQUESTS_QUOTA } from "../src/server/platform/upstash/hosted";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { SPORTA_SESSION_COOKIE } from "../src/server/auth-service";
import { POST as loginRoute } from "../src/app/api/auth/login/route";
import { POST as registerRoute } from "../src/app/api/auth/register/route";
import { GET as capabilityRoute } from "../src/app/api/capability/route";
import { GET as optionsRoute } from "../src/app/api/create/options/route";
import { POST as createSessionRoute } from "../src/app/api/create/sessions/route";
import { POST as dispatchRoute } from "../src/app/api/create/sessions/[sessionId]/renders/route";
import { GET as jobRoute } from "../src/app/api/create/sessions/[sessionId]/jobs/[jobId]/route";

const NOW_MS = 1_777_777_777_000;
let server: SportaServer;
let creatorToken = "";
let secondCreatorToken = "";
let creatorUserId = "";

beforeAll(async () => {
  server = createSportaServer({
    nowMs: () => NOW_MS,
    passwordHasher: createDeterministicTestHasher(),
    // The hermetic transient backing: the SAME port the hosted Upstash client
    // implements, over the in-memory fallback with the composition's clock.
    transient: { redis: new InMemoryRedis(() => NOW_MS), provider: "in-memory" },
    seed: true,
  });
  installSportaServerForTests(server);
  await server.ready;
  const creator = await server.auth.register({
    username: "admission-creator",
    password: "a-real-studio-password",
    roles: ["creator", "viewer"],
  });
  creatorUserId = creator.userId;
  creatorToken = (await server.auth.issueSession({ userId: creator.userId })).token;
  const second = await server.auth.register({
    username: "admission-second",
    password: "a-real-second-password",
    roles: ["creator", "viewer"],
  });
  secondCreatorToken = (await server.auth.issueSession({ userId: second.userId })).token;
});

function withCookie(token: string, path: string, init: RequestInit = {}): Request {
  return new Request(`http://sporta.test${path}`, {
    ...init,
    headers: {
      ...((init.headers as Record<string, string> | undefined) ?? {}),
      cookie: `${SPORTA_SESSION_COOKIE}=${token}`,
    },
  });
}

function fromIp(ip: string, path: string, init: RequestInit = {}): Request {
  return new Request(`http://sporta.test${path}`, {
    ...init,
    headers: {
      ...((init.headers as Record<string, string> | undefined) ?? {}),
      "x-forwarded-for": ip,
    },
  });
}

function post(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Auth rate limits (login + register)
// ---------------------------------------------------------------------------

describe("login rate limits (per IP + per attempted handle)", () => {
  test("attempts from one IP are counted — the 31st is an honest 429 (even with the CORRECT password)", async () => {
    const ip = "198.51.100.7";
    // Burn the per-IP window with attempts at DIFFERENT handles (each miss is
    // an honest 401; no single account-quota is ever close to its bound, so
    // the IP window is the guard that fires).
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await loginRoute(
        fromIp(ip, "/api/auth/login", post({ username: `ip-burn-${attempt}`, password: "wrong-password-123" })),
      );
      expect(response.status).toBe(401); // honest failures while capacity remains
    }
    // The 31st attempt presents the CORRECT credentials: still refused —
    // fail-closed admission (the counter counts attempts, not successes).
    const correct = post({ username: "admission-creator", password: "a-real-studio-password" });
    const refused = await loginRoute(fromIp(ip, "/api/auth/login", correct));
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toMatch(/^\d+$/);
    const body = await bodyOf(refused);
    expect(body.error).toMatchObject({
      failureClass: "rate-limited",
      details: {
        quota: {
          quotaId: "login-attempts-ip",
          exhausted: true,
          reasonCode: "quota-exhausted",
        },
        retryAfterSeconds: expect.any(Number),
      },
    });
    // A DIFFERENT IP is unaffected (the window is per subject).
    const other = await loginRoute(
      fromIp("198.51.100.8", "/api/auth/login", correct),
    );
    expect(other.status).toBe(200);
  });

  test("attempts at ONE handle are counted across IPs — the 11th is refused", async () => {
    const correct = post({ username: "admission-second", password: "a-real-second-password" });
    // 10 attempts from 10 DIFFERENT IPs (the per-IP window never trips).
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await loginRoute(
        fromIp(`203.0.113.${attempt + 1}`, "/api/auth/login", correct),
      );
      expect(response.status).toBe(200);
    }
    const refused = await loginRoute(
      fromIp("203.0.113.200", "/api/auth/login", correct),
    );
    expect(refused.status).toBe(429);
    const body = await bodyOf(refused);
    expect((body.error as { details: { quota: { quotaId: string } } }).details.quota.quotaId).toBe(
      "login-attempts-account",
    );
  });
});

describe("register rate limits (per IP + per attempted handle)", () => {
  test("the 11th registration from one IP is an honest 429", async () => {
    const ip = "192.0.2.9";
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await registerRoute(
        fromIp(
          ip,
          "/api/auth/register",
          post({ username: `rate-user-${attempt}`, password: "a-real-user-password" }),
        ),
      );
      expect(response.status).toBe(200);
    }
    const refused = await registerRoute(
      fromIp(ip, "/api/auth/register", post({ username: "rate-user-10", password: "a-real-user-password" })),
    );
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toMatch(/^\d+$/);
    const body = await bodyOf(refused);
    expect(
      (body.error as { details: { quota: { quotaId: string; exhausted: boolean } } }).details
        .quota,
    ).toMatchObject({ quotaId: "register-attempts-ip", exhausted: true });
  });

  test("attempts at ONE handle are counted — 10 conflict attempts then a 429", async () => {
    // 1st registers the handle, the next 9 are honest conflicts (409).
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await registerRoute(
        fromIp(
          `192.0.2.${100 + attempt}`,
          "/api/auth/register",
          post({ username: "contested-handle", password: "a-real-user-password" }),
        ),
      );
      expect([200, 409]).toContain(response.status);
    }
    const refused = await registerRoute(
      fromIp("192.0.2.200", "/api/auth/register", post({ username: "contested-handle", password: "a-real-user-password" })),
    );
    expect(refused.status).toBe(429);
    const body = await bodyOf(refused);
    expect(
      (body.error as { details: { quota: { quotaId: string } } }).details.quota.quotaId,
    ).toBe("register-attempts-account");
  });
});

// ---------------------------------------------------------------------------
// Render quota (the studio's Simulation-E admission stop)
// ---------------------------------------------------------------------------

async function createStudioSession(token: string): Promise<string> {
  const response = await createSessionRoute(
    withCookie(
      token,
      "/api/create/sessions",
      post({ sourceKey: "derby", operations: ["analysis", "transformation", "storage"] }),
    ),
  );
  expect(response.status).toBe(201);
  const body = (await bodyOf(response)) as { sessionId: string };
  return body.sessionId;
}

describe("the per-user render-request quota (degradation path)", () => {
  let sessionId = "";

  beforeAll(async () => {
    sessionId = await createStudioSession(creatorToken);
  });

  test("the studio options surface the LIVE quota state", async () => {
    const response = await optionsRoute(withCookie(creatorToken, "/api/create/options"));
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as { renderQuota: Record<string, unknown> };
    expect(body.renderQuota).toMatchObject({
      quotaId: "render-requests",
      used: 0,
      limit: 20,
      exhausted: false,
      reasonCode: "ok",
    });
  });

  test("dispatch consumes the quota; exhaustion → 429 with the quota state", async () => {
    // One real dispatch through the route (202), then the remaining budget
    // consumed through the SAME guard seam the route uses.
    const dispatch = await dispatchRoute(
      withCookie(creatorToken, `/api/create/sessions/${sessionId}/renders`, post({ rendererId: "anime.prototype" })),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(dispatch.status).toBe(202);
    for (let index = 0; index < RENDER_REQUESTS_QUOTA.limit - 1; index += 1) {
      const outcome = await server.transientState.quotas.consume(
        RENDER_REQUESTS_QUOTA,
        creatorUserId,
      );
      expect(outcome.allowed).toBe(true);
    }
    // The quota is exhausted: the next dispatch is refused BEFORE the
    // provider runs (Simulation E admission-stop).
    const before = await server.transientState.queue.depth();
    const refused = await dispatchRoute(
      withCookie(creatorToken, `/api/create/sessions/${sessionId}/renders`, post({ rendererId: "anime.prototype" })),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toMatch(/^\d+$/);
    const body = await bodyOf(refused);
    expect((body.error as { details: { quota: { quotaId: string; exhausted: boolean } } }).details.quota).toMatchObject(
      { quotaId: "render-requests", exhausted: true, reasonCode: "quota-exhausted" },
    );
    // The refused job never entered the bounded queue.
    expect(await server.transientState.queue.depth()).toBe(before);
  });

  test("the CAPABILITY response degrades honestly on quota exhaustion", async () => {
    const response = await capabilityRoute(withCookie(creatorToken, "/api/capability"));
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      quotas: { quotaId: string; used: number; limit: number; exhausted: boolean; reasonCode: string }[];
      overall: { state: string; reasonCodes: string[] };
    };
    expect(body.quotas).toHaveLength(1);
    expect(body.quotas[0]).toMatchObject({
      quotaId: "render-requests",
      used: 20,
      limit: 20,
      exhausted: true,
      reasonCode: "quota-exhausted",
    });
    expect(body.overall.state).toBe("degraded");
    expect(body.overall.reasonCodes).toContain("quota-exhausted");
  });

  test("anonymous capability carries no quota entries (nothing to admit)", async () => {
    const response = await capabilityRoute(new Request("http://sporta.test/api/capability"));
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as { quotas: unknown[]; auth: { state: string } };
    expect(body.auth.state).toBe("anonymous");
    expect(body.quotas).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The bounded render queue (platform capacity — fail-closed admission)
// ---------------------------------------------------------------------------

describe("the bounded render queue", () => {
  let sessionId = "";

  beforeAll(async () => {
    sessionId = await createStudioSession(secondCreatorToken);
  });

  test("a FULL queue refuses new expensive jobs BEFORE the provider runs (503)", async () => {
    // Fill the queue to its hard bound through the SAME queue seam.
    const fill = HOSTED_QUEUE_MAX_DEPTH - (await server.transientState.queue.depth());
    for (let index = 0; index < fill; index += 1) {
      await server.transientState.queue.offer({
        jobId: `fill-${index}`,
        userId: null,
        kind: "fill",
        payloadJson: "{}",
      });
    }
    expect(await server.transientState.queue.depth()).toBe(HOSTED_QUEUE_MAX_DEPTH);
    const refused = await dispatchRoute(
      withCookie(secondCreatorToken, `/api/create/sessions/${sessionId}/renders`, post({ rendererId: "anime.prototype" })),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(refused.status).toBe(503);
    expect(refused.headers.get("retry-after")).toMatch(/^\d+$/);
    const body = await bodyOf(refused);
    expect(body.error).toMatchObject({
      failureClass: "capacity-exceeded",
      details: { depth: HOSTED_QUEUE_MAX_DEPTH, maxDepth: HOSTED_QUEUE_MAX_DEPTH },
    });
  });

  test("a released slot admits again; the SETTLED job returns its slot", async () => {
    await server.transientState.queue.release("fill-0");
    const dispatch = await dispatchRoute(
      withCookie(secondCreatorToken, `/api/create/sessions/${sessionId}/renders`, post({ rendererId: "anime.prototype" })),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(dispatch.status).toBe(202);
    const { jobId } = (await bodyOf(dispatch)) as { jobId: string };
    // The admission occupies a slot until the job settles.
    expect(await server.transientState.queue.depth()).toBe(HOSTED_QUEUE_MAX_DEPTH);
    // Poll to terminal (the real route), then the slot is back.
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const response = await jobRoute(
        withCookie(secondCreatorToken, `/api/create/sessions/${sessionId}/jobs/${jobId}`),
        { params: Promise.resolve({ sessionId, jobId }) },
      );
      expect(response.status).toBe(200);
      const job = (await bodyOf(response)) as { state: string };
      if (
        job.state === "succeeded" ||
        job.state === "failed" ||
        job.state === "cancelled" ||
        job.state === "dead-lettered"
      ) {
        expect(job.state).toBe("succeeded");
        break;
      }
    }
    expect(await server.transientState.queue.depth()).toBe(HOSTED_QUEUE_MAX_DEPTH - 1);
  });
});
