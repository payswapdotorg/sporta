/**
 * W918 ROUTE-LEVEL OPERATIONS-CONSOLE TESTS — the operator console over the
 * REAL route handlers against HERMETIC compositions (in-memory transient
 * backing + pinned clock + deterministic hasher — the only seams the
 * composition root exposes for injection).
 *
 * Proven here (the W918 acceptance: the operator sees hosted health,
 * queues, provider quotas, failed jobs and safe remediation actions):
 *
 * 1. OPERATOR GATE: every console route answers the REAL 401 anonymous /
 *    403 permission-denied for a signed-in non-operator (the identity
 *    layer's operator-only `provider-health.read` action — self-
 *    registration cannot mint the grant; the test mints it the way
 *    provisioning does, straight into the account store);
 * 2. HEALTH SNAPSHOT SHAPE: the honest platform state (unconfigured is
 *    unconfigured — the hermetic env has no Neon/R2/Upstash bindings), the
 *    real compute provider selection, the real queue bound;
 * 3. QUEUE STATE: live depth against the hard bound, and admission
 *    refusals counted at the dispatch seam where they actually happen;
 * 4. FAILED-JOB LISTING: the compute ledger lists the REAL failed job with
 *    its never-silent failure reason, input accounting and metered usage;
 * 5. RETRY: a NEW real job through the full admission ladder (never a
 *    status flip — the failed job stays failed), refused for non-failed
 *    and unknown jobs;
 * 6. CANCEL: the adapter's real cancel on a live job (a test-only pause
 *    over the REAL worker holds the job dispatch-side), the admission slot
 *    released, the late provider report superseded (never a flip back),
 *    terminal jobs an honest counted no-op;
 * 7. AUDIT: every remediation recorded — successes AND refusals — with
 *    actor, target and reason.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDeterministicTestHasher } from "@sporta/identity";
import {
  ComputeWorker,
  HostedComputeAdapter,
  createDefaultOutputSegmentStore,
} from "@sporta/compute-adapter-hosted";
import type { ComputeAdapterPort } from "@sporta/compute-adapter";
import { RendererRegistry, createTestCardRenderer } from "@sporta/renderer-contract";
import { createAnimePrototypeRenderer } from "@sporta/renderer-anime";
import { InMemoryRedis } from "../src/server/platform/upstash/redis";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { SPORTA_SESSION_COOKIE } from "../src/server/auth-service";
import { HOSTED_QUEUE_KEY, HOSTED_QUEUE_MAX_DEPTH } from "../src/server/platform/upstash/hosted";

// The console routes under test.
import { GET as healthRoute } from "../src/app/api/operations/health/route";
import { GET as queuesRoute } from "../src/app/api/operations/queues/route";
import { GET as providersRoute } from "../src/app/api/operations/providers/route";
import { GET as jobsRoute } from "../src/app/api/operations/jobs/route";
import { GET as auditRoute } from "../src/app/api/operations/audit/route";
import { POST as retryRoute } from "../src/app/api/operations/jobs/[jobId]/retry/route";
import { POST as cancelRoute } from "../src/app/api/operations/jobs/[jobId]/cancel/route";

// The studio routes that create the REAL jobs the console observes.
import { POST as createSessionRoute } from "../src/app/api/create/sessions/route";
import { POST as dispatchRoute } from "../src/app/api/create/sessions/[sessionId]/renders/route";
import { GET as jobRoute } from "../src/app/api/create/sessions/[sessionId]/jobs/[jobId]/route";

const NOW_MS = 1_777_777_777_000;
const FULL_OPERATIONS = [
  "analysis",
  "transformation",
  "liveDelivery",
  "derivativeGeneration",
  "storage",
  "sharing",
];

let server: SportaServer;
let operatorToken = "";
let creatorToken = "";
let viewerToken = "";
let creatorUserId = "";

beforeAll(async () => {
  server = createSportaServer({
    nowMs: () => NOW_MS,
    passwordHasher: createDeterministicTestHasher(),
    transient: { redis: new InMemoryRedis(() => NOW_MS), provider: "in-memory" },
    seed: true,
  });
  installSportaServerForTests(server);
  await server.ready;
  // Self-registration cannot mint the operator grant (operator-assigned);
  // create the account directly in the store, exactly as provisioning would.
  const operator = await server.accounts.create({
    username: "ops-operator",
    email: undefined,
    passwordHash: "not-a-login-path",
    roles: ["operator", "viewer"],
    createdAtIso: new Date(NOW_MS).toISOString(),
  });
  operatorToken = (await server.auth.issueSession({ userId: operator.userId })).token;
  const creator = await server.auth.register({
    username: "ops-creator",
    password: "a-real-studio-password",
    roles: ["creator", "viewer"],
  });
  creatorUserId = creator.userId;
  creatorToken = (await server.auth.issueSession({ userId: creator.userId })).token;
  const viewer = await server.auth.register({
    username: "ops-viewer",
    password: "a-real-viewer-password",
  });
  viewerToken = (await server.auth.issueSession({ userId: viewer.userId })).token;
});

function withCookie(token: string | null, path: string, init: RequestInit = {}): Request {
  return new Request(`http://sporta.test${path}`, {
    ...init,
    headers: {
      ...((init.headers as Record<string, string> | undefined) ?? {}),
      ...(token === null ? {} : { cookie: `${SPORTA_SESSION_COOKIE}=${token}` }),
    },
  });
}

function post(path: string, payload: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

/** Creates one studio session as the creator (the real dispatches' home). */
async function createStudioSession(): Promise<string> {
  const response = await createSessionRoute(
    withCookie(
      creatorToken,
      "/api/create/sessions",
      post("/api/create/sessions", { sourceKey: "derby", operations: FULL_OPERATIONS }),
    ),
  );
  expect(response.status).toBe(201);
  const body = (await bodyOf(response)) as { sessionId: string };
  return body.sessionId;
}

/** Dispatches one render as the creator and returns the job id. */
async function dispatchRender(sessionId: string, rendererId: string): Promise<string> {
  const response = await dispatchRoute(
    withCookie(
      creatorToken,
      `/api/create/sessions/${sessionId}/renders`,
      post(`/api/create/sessions/${sessionId}/renders`, { rendererId }),
    ),
    { params: Promise.resolve({ sessionId }) },
  );
  expect(response.status).toBe(202);
  const body = (await bodyOf(response)) as { jobId: string };
  return body.jobId;
}

/** Polls the studio job route until terminal (bounded — never a silent hang). */
async function pollToTerminal(
  token: string,
  sessionId: string,
  jobId: string,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await jobRoute(
      withCookie(token, `/api/create/sessions/${sessionId}/jobs/${jobId}`),
      { params: Promise.resolve({ sessionId, jobId }) },
    );
    expect(response.status).toBe(200);
    const job = await bodyOf(response);
    const state = job.state as string;
    if (
      state === "succeeded" ||
      state === "failed" ||
      state === "cancelled" ||
      state === "dead-lettered"
    ) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`job ${jobId} never reached a terminal state`);
}

/** Drives every console route with the given token (the gate matrix). */
async function consoleRoutesWith(token: string | null): Promise<
  {
    path: string;
    response: Response;
  }[]
> {
  return [
    { path: "health", response: await healthRoute(withCookie(token, "/api/operations/health")) },
    { path: "queues", response: await queuesRoute(withCookie(token, "/api/operations/queues")) },
    {
      path: "providers",
      response: await providersRoute(withCookie(token, "/api/operations/providers")),
    },
    { path: "jobs", response: await jobsRoute(withCookie(token, "/api/operations/jobs")) },
    { path: "audit", response: await auditRoute(withCookie(token, "/api/operations/audit")) },
    {
      path: "retry",
      response: await retryRoute(
        withCookie(token, "/api/operations/jobs/j", post("/api/operations/jobs/j", {})),
        { params: Promise.resolve({ jobId: "j" }) },
      ),
    },
    {
      path: "cancel",
      response: await cancelRoute(withCookie(token, "/api/operations/jobs/j", { method: "POST" }), {
        params: Promise.resolve({ jobId: "j" }),
      }),
    },
  ];
}

// ---------------------------------------------------------------------------
// The operator gate (the real 401/403 paths, every route)
// ---------------------------------------------------------------------------

describe("the operations console operator gate", () => {
  test("anonymous callers get the real 401 on EVERY console route", async () => {
    const results = await consoleRoutesWith(null);
    expect(results.length).toBe(7);
    for (const { path, response } of results) {
      expect(response.status).toBe(401);
      const body = await bodyOf(response);
      expect(body.error).toMatchObject({ failureClass: "unauthenticated" });
      expect(path.length).toBeGreaterThan(0);
    }
  });

  test("an invalid session token is still the real 401", async () => {
    const response = await healthRoute(withCookie("not-a-real-token", "/api/operations/health"));
    expect(response.status).toBe(401);
  });

  test("a signed-in non-operator gets the real 403 permission-denied on EVERY console route", async () => {
    const results = await consoleRoutesWith(viewerToken);
    for (const { response } of results) {
      expect(response.status).toBe(403);
      const body = await bodyOf(response);
      expect(body.error).toMatchObject({ failureClass: "permission-denied" });
    }
  });

  test("a creator (a granted, but non-operator, account) is also refused", async () => {
    const response = await jobsRoute(withCookie(creatorToken, "/api/operations/jobs"));
    expect(response.status).toBe(403);
    const body = await bodyOf(response);
    expect(body.error).toMatchObject({ failureClass: "permission-denied" });
  });
});

// ---------------------------------------------------------------------------
// The health board
// ---------------------------------------------------------------------------

describe("GET /api/operations/health", () => {
  test("answers the honest platform snapshot (operator-gated)", async () => {
    const response = await healthRoute(withCookie(operatorToken, "/api/operations/health"));
    expect(response.status).toBe(200);
    const health = (await bodyOf(response)) as {
      env: string;
      deployMarker: string | null;
      overall: string;
      providers: {
        identity: { state: string; configured: boolean };
        artifacts: { state: string; configured: boolean };
        transientState: { state: string; configured: boolean };
      };
      compute: { configured: boolean; provider: string | null; adapterId: string | null };
      liveTransport: { state: string };
      renderQueue: { key: string; maxDepth: number; admissionLeaseMs: number; depth: number };
    };
    // The provider checks use the CLOSED vocabulary and are consistent with
    // their configured flag (the sandbox may carry a DATABASE_URL the check
    // cannot reach — the honest `error` state, never a healthy claim).
    const providerStates: string[] = ["unconfigured", "ok", "error"];
    expect(providerStates).toContain(health.providers.identity.state);
    expect(providerStates).toContain(health.providers.artifacts.state);
    expect(providerStates).toContain(health.providers.transientState.state);
    expect(health.providers.identity.configured).toBe(
      health.providers.identity.state !== "unconfigured",
    );
    expect(["ok", "degraded", "error"]).toContain(health.overall);
    expect(["local", "preview", "beta-personal"]).toContain(health.env);
    expect(health.compute.configured).toBe(true);
    expect(health.compute.provider).toBe("in-process");
    expect(health.compute.adapterId).toBe("sporta.compute.hosted");
    expect(typeof health.liveTransport.state).toBe("string");
    expect(health.renderQueue.key).toBe(HOSTED_QUEUE_KEY);
    expect(health.renderQueue.maxDepth).toBe(HOSTED_QUEUE_MAX_DEPTH);
    expect(Number.isInteger(health.renderQueue.depth)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The queue panel
// ---------------------------------------------------------------------------

describe("GET /api/operations/queues", () => {
  test("answers the bounded queue's real state (depth, bound, backing)", async () => {
    const response = await queuesRoute(withCookie(operatorToken, "/api/operations/queues"));
    expect(response.status).toBe(200);
    const queues = (await bodyOf(response)) as {
      provider: string;
      queue: { key: string; maxDepth: number; depth: number; utilization: number };
      admissionRefusals: { count: number; last: unknown };
    };
    expect(queues.provider).toBe("in-memory");
    expect(queues.queue.key).toBe(HOSTED_QUEUE_KEY);
    expect(queues.queue.maxDepth).toBe(HOSTED_QUEUE_MAX_DEPTH);
    expect(queues.queue.depth).toBeGreaterThanOrEqual(0);
    expect(queues.queue.utilization).toBeLessThanOrEqual(1);
  });

  test("a full queue refuses a real dispatch and the refusal is counted at the seam", async () => {
    // Fill the bounded queue to its hard bound with real admission offers.
    for (let i = 0; i < HOSTED_QUEUE_MAX_DEPTH; i += 1) {
      const offered = await server.transientState.queue.offer({
        jobId: `fill-${i}`,
        userId: null,
        kind: "render",
        payloadJson: "{}",
      });
      expect(offered.accepted).toBe(true);
    }
    const sessionId = await createStudioSession();
    const refused = await dispatchRoute(
      withCookie(
        creatorToken,
        `/api/create/sessions/${sessionId}/renders`,
        post(`/api/create/sessions/${sessionId}/renders`, { rendererId: "anime.prototype" }),
      ),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(refused.status).toBe(503);
    expect((await bodyOf(refused)).error).toMatchObject({ failureClass: "capacity-exceeded" });

    // The console counts the refusal where it happened.
    const response = await queuesRoute(withCookie(operatorToken, "/api/operations/queues"));
    expect(response.status).toBe(200);
    const queues = (await bodyOf(response)) as {
      queue: { depth: number; entries: unknown[] };
      admissionRefusals: { count: number; last: { depth: number; maxDepth: number } | null };
    };
    expect(queues.queue.depth).toBe(HOSTED_QUEUE_MAX_DEPTH);
    expect(queues.queue.entries.length).toBe(HOSTED_QUEUE_MAX_DEPTH);
    expect(queues.admissionRefusals.count).toBe(1);
    expect(queues.admissionRefusals.last).not.toBeNull();
    expect(queues.admissionRefusals.last!.depth).toBe(HOSTED_QUEUE_MAX_DEPTH);
    expect(queues.admissionRefusals.last!.maxDepth).toBe(HOSTED_QUEUE_MAX_DEPTH);

    // Drain the real queue, then the same dispatch admits again.
    for (let taken = 0; taken < HOSTED_QUEUE_MAX_DEPTH;) {
      const batch = await server.transientState.queue.take();
      taken += batch.length;
      if (batch.length === 0) break;
    }
    const admitted = await dispatchRoute(
      withCookie(
        creatorToken,
        `/api/create/sessions/${sessionId}/renders`,
        post(`/api/create/sessions/${sessionId}/renders`, { rendererId: "anime.prototype" }),
      ),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(admitted.status).toBe(202);
    const job = await pollToTerminal(
      creatorToken,
      sessionId,
      ((await bodyOf(admitted)) as { jobId: string }).jobId,
    );
    expect(job.state).toBe("succeeded");
  });
});

// ---------------------------------------------------------------------------
// The jobs panel (the compute ledger, incl. FAILED with reasons)
// ---------------------------------------------------------------------------

describe("GET /api/operations/jobs", () => {
  test("lists the real failed job with its never-silent failure reason", async () => {
    const sessionId = await createStudioSession();
    // The REAL failure seam: the testcard renderer has no W502 detailed
    // surface, so the compute path fails the job honestly.
    const failedJobId = await dispatchRender(sessionId, "sporta.testcard");
    const failed = await pollToTerminal(creatorToken, sessionId, failedJobId);
    expect(failed.state).toBe("failed");

    const response = await jobsRoute(withCookie(operatorToken, "/api/operations/jobs"));
    expect(response.status).toBe(200);
    const jobs = (await bodyOf(response)) as {
      jobs: {
        jobId: string;
        sessionId: string;
        state: string;
        rendererId: string | null;
        dispatchedByUserId: string | null;
        completion: {
          status: string;
          failure: { errorClass: string; message: string; terminal: string } | null;
          accounting: {
            consumedInputs: number;
            unconsumedInputs: { inputId: string; reason: string }[];
          } | null;
          usage: { unitId: string; quantity: number }[];
        } | null;
        unavailableReason: string | null;
      }[];
      totals: { all: number; failed: number; succeeded: number };
      computeUnavailable: boolean;
    };
    expect(jobs.computeUnavailable).toBe(false);
    const row = jobs.jobs.find((job) => job.jobId === failedJobId);
    expect(row).toBeDefined();
    expect(row!.sessionId).toBe(sessionId);
    expect(row!.state).toBe("failed");
    expect(row!.rendererId).toBe("sporta.testcard");
    expect(row!.dispatchedByUserId).toBe(creatorUserId);
    expect(row!.unavailableReason).toBeNull();
    expect(row!.completion).not.toBeNull();
    expect(row!.completion!.status).toBe("failed");
    expect(row!.completion!.failure).not.toBeNull();
    expect(row!.completion!.failure!.errorClass).toBe("renderer-not-encodable");
    expect(row!.completion!.failure!.message.length).toBeGreaterThan(0);
    expect(row!.completion!.failure!.terminal).toBe("non-retryable");
    // The never-silent input accounting rides on the completion.
    expect(row!.completion!.accounting).not.toBeNull();
    expect(row!.completion!.accounting!.consumedInputs).toBeGreaterThan(0);
    expect(Array.isArray(row!.completion!.accounting!.unconsumedInputs)).toBe(true);
    const usageIds = row!.completion!.usage.map((unit) => unit.unitId).sort();
    expect(usageIds).toEqual(["artifact-bytes", "cpu-ms", "render-requests"]);
    expect(jobs.totals.failed).toBeGreaterThanOrEqual(1);
    expect(jobs.totals.all).toBe(jobs.jobs.length);
  });
});

// ---------------------------------------------------------------------------
// Retry (a NEW real job — never a status flip)
// ---------------------------------------------------------------------------

describe("POST /api/operations/jobs/[jobId]/retry", () => {
  test("re-dispatches the failed job as a NEW real job through the admission ladder", async () => {
    const sessionId = await createStudioSession();
    const failedJobId = await dispatchRender(sessionId, "sporta.testcard");
    await pollToTerminal(creatorToken, sessionId, failedJobId);

    const response = await retryRoute(
      withCookie(
        operatorToken,
        `/api/operations/jobs/${failedJobId}/retry`,
        post(`/api/operations/jobs/${failedJobId}/retry`, {}),
      ),
      { params: Promise.resolve({ jobId: failedJobId }) },
    );
    expect(response.status).toBe(200);
    const result = (await bodyOf(response)) as {
      originalJobId: string;
      newJobId: string;
      disposition: string;
      note: string;
    };
    expect(result.originalJobId).toBe(failedJobId);
    expect(result.newJobId).not.toBe(failedJobId);
    expect(result.disposition).toBe("admitted");

    // The NEW job RUNS (real execution, honest outcome: the testcard fails
    // again for the same never-silent reason — a retry is not a fix).
    const rerun = await pollToTerminal(creatorToken, sessionId, result.newJobId);
    expect(rerun.state).toBe("failed");
    expect((rerun.completion as { failure: { errorClass: string } }).failure.errorClass).toBe(
      "renderer-not-encodable",
    );

    // NEVER a status flip: the original row STAYS failed, the new row exists.
    const jobsResponse = await jobsRoute(withCookie(operatorToken, "/api/operations/jobs"));
    const jobs = (await bodyOf(jobsResponse)) as {
      jobs: { jobId: string; state: string }[];
    };
    const original = jobs.jobs.find((job) => job.jobId === failedJobId);
    expect(original!.state).toBe("failed");
    expect(jobs.jobs.some((job) => job.jobId === result.newJobId)).toBe(true);
    expect(jobs.jobs.filter((job) => job.jobId === result.newJobId).length).toBe(1);
  });

  test("refuses to retry a job that is not failed (a succeeded job)", async () => {
    const sessionId = await createStudioSession();
    const succeededJobId = await dispatchRender(sessionId, "anime.prototype");
    await pollToTerminal(creatorToken, sessionId, succeededJobId);

    const response = await retryRoute(
      withCookie(
        operatorToken,
        `/api/operations/jobs/${succeededJobId}/retry`,
        post(`/api/operations/jobs/${succeededJobId}/retry`, {}),
      ),
      { params: Promise.resolve({ jobId: succeededJobId }) },
    );
    expect(response.status).toBe(400);
    const body = await bodyOf(response);
    expect(body.error).toMatchObject({ failureClass: "validation" });
    expect(String((body.error as { message: string }).message)).toContain(
      "only failed jobs can be retried",
    );
  });

  test("refuses an unknown job id", async () => {
    const response = await retryRoute(
      withCookie(
        operatorToken,
        "/api/operations/jobs/job-does-not-exist/retry",
        post("/api/operations/jobs/job-does-not-exist/retry", {}),
      ),
      { params: Promise.resolve({ jobId: "job-does-not-exist" }) },
    );
    expect(response.status).toBe(400);
    expect((await bodyOf(response)).error).toMatchObject({ failureClass: "validation" });
  });
});

// ---------------------------------------------------------------------------
// The audit trail (both outcomes recorded)
// ---------------------------------------------------------------------------

describe("GET /api/operations/audit", () => {
  test("records the executed retry AND the refused retries with actor and reason", async () => {
    const response = await auditRoute(withCookie(operatorToken, "/api/operations/audit"));
    expect(response.status).toBe(200);
    const audit = (await bodyOf(response)) as {
      records: {
        actorUserId: string;
        actorUsername: string;
        action: string;
        targetJobId: string;
        outcome: string;
        detail: string;
      }[];
      note: string;
    };
    expect(audit.records.length).toBe(2);
    for (const record of audit.records) {
      expect(record.actorUsername).toBe("ops-operator");
      expect(record.action === "job.retry" || record.action === "job.cancel").toBe(true);
      expect(record.detail.length).toBeGreaterThan(0);
    }
    const succeeded = audit.records.find((record) => record.outcome === "succeeded");
    expect(succeeded).toBeDefined();
    expect(succeeded!.action).toBe("job.retry");
    expect(succeeded!.detail).toContain("re-dispatched as new job");
    const refused = audit.records.find(
      (record) => record.outcome === "refused" && record.action === "job.retry",
    );
    expect(refused).toBeDefined();
    expect(refused!.detail).toContain("not 'failed'");
    expect(audit.note.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The provider panel (measured counters vs honest unknowns)
// ---------------------------------------------------------------------------

describe("GET /api/operations/providers", () => {
  test("measures only what the seams expose; unknown stays unknown", async () => {
    const response = await providersRoute(withCookie(operatorToken, "/api/operations/providers"));
    expect(response.status).toBe(200);
    const providers = (await bodyOf(response)) as {
      providers: {
        provider: string;
        usage: "measured" | "unknown";
        counters: { name: string; value: number }[];
        limits: { name: string; value: number | string }[];
        note: string;
      }[];
      notes: string[];
    };
    const byId = new Map(providers.providers.map((provider) => [provider.provider, provider]));
    expect([...byId.keys()].sort()).toEqual(["compute", "neon", "r2", "upstash"]);
    // The hermetic env configures no R2/Neon/Upstash — honest unknowns.
    expect(byId.get("r2")!.usage).toBe("unknown");
    expect(byId.get("neon")!.usage).toBe("unknown");
    expect(byId.get("neon")!.counters).toEqual([]);
    expect(byId.get("upstash")!.usage).toBe("unknown");
    expect(byId.get("neon")!.note).toContain("no usage counter");
    // The compute adapter's accounting identities ARE measured (real
    // dispatches happened in the earlier suites over this same composition).
    const compute = byId.get("compute")!;
    expect(compute.usage).toBe("measured");
    const counters = new Map(compute.counters.map((counter) => [counter.name, counter.value]));
    expect(counters.get("jobs-dispatched")!).toBeGreaterThanOrEqual(2);
    expect(counters.get("failed")!).toBeGreaterThanOrEqual(2);
    expect(counters.get("succeeded")!).toBeGreaterThanOrEqual(1);
    // The documented render-requests quota limit rides along (the W919 seam).
    expect(compute.limits).toContainEqual({
      name: "render-requests per user per hour",
      value: 20,
    });
    expect(providers.notes.join(" ")).toContain("NOT measured usage");
  });
});

// ---------------------------------------------------------------------------
// Cancel semantics (a live job over the REAL adapter, held dispatch-side by
// a test-only pause — the same in-process compute path, deterministically
// observable before it settles)
// ---------------------------------------------------------------------------

describe("POST /api/operations/jobs/[jobId]/cancel", () => {
  let cancelServer: SportaServer;
  let cancelOperatorToken = "";
  let cancelCreatorToken = "";
  let releaseExecution: () => void = () => {};

  beforeAll(async () => {
    // The REAL in-process compute path (the same HostedComputeAdapter +
    // ComputeWorker + renderer registry the composition builds), with the
    // executor held behind a gate so the admitted job stays live long enough
    // to observe the cancel. Nothing about the adapter is simulated.
    const registry = new RendererRegistry();
    registry.register(createTestCardRenderer());
    registry.register(createAnimePrototypeRenderer());
    const worker = new ComputeWorker({
      rendererRegistry: registry,
      outputSegmentStore: createDefaultOutputSegmentStore(),
      nowMs: () => NOW_MS,
    });
    const gate = new Promise<void>((resolve) => {
      releaseExecution = resolve;
    });
    const gatedAdapter: ComputeAdapterPort = new HostedComputeAdapter({
      descriptor: worker.describe(),
      execute: async (job, materialized) => {
        await gate;
        if (materialized === undefined) {
          throw new Error("in-process execution requires materialized inputs");
        }
        const execution = await worker.execute({ job, inputs: materialized });
        if (execution.kind === "refused") {
          throw new Error(`${execution.reason.errorClass}: ${execution.reason.message}`);
        }
        return execution.result;
      },
      nowMs: () => NOW_MS,
      providerId: worker.providerId,
    });
    cancelServer = createSportaServer({
      nowMs: () => NOW_MS,
      passwordHasher: createDeterministicTestHasher(),
      transient: { redis: new InMemoryRedis(() => NOW_MS), provider: "in-memory" },
      seed: false,
      computeAdapter: gatedAdapter,
    });
    installSportaServerForTests(cancelServer);
    await cancelServer.ready;
    const operator = await cancelServer.accounts.create({
      username: "cancel-operator",
      email: undefined,
      passwordHash: "not-a-login-path",
      roles: ["operator", "viewer"],
      createdAtIso: new Date(NOW_MS).toISOString(),
    });
    cancelOperatorToken = (
      await cancelServer.auth.issueSession({
        userId: operator.userId,
      })
    ).token;
    const creator = await cancelServer.auth.register({
      username: "cancel-creator",
      password: "a-real-studio-password",
      roles: ["creator", "viewer"],
    });
    cancelCreatorToken = (await cancelServer.auth.issueSession({ userId: creator.userId })).token;
  });

  afterAll(() => {
    // Restore the main composition as the process singleton (later suites, if
    // any, observe the original hermetic server again).
    installSportaServerForTests(server);
  });

  test("cancels a live admitted job, releases its slot, and never flips on the late report", async () => {
    const sessionResponse = await createSessionRoute(
      withCookie(
        cancelCreatorToken,
        "/api/create/sessions",
        post("/api/create/sessions", { sourceKey: "derby", operations: FULL_OPERATIONS }),
      ),
    );
    expect(sessionResponse.status).toBe(201);
    const sessionId = ((await bodyOf(sessionResponse)) as { sessionId: string }).sessionId;

    const dispatch = await dispatchRoute(
      withCookie(
        cancelCreatorToken,
        `/api/create/sessions/${sessionId}/renders`,
        post(`/api/create/sessions/${sessionId}/renders`, { rendererId: "anime.prototype" }),
      ),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(dispatch.status).toBe(202);
    const jobId = ((await bodyOf(dispatch)) as { jobId: string }).jobId;

    // The job is LIVE (admitted, execution held) and its admission slot held.
    let response = await jobsRoute(withCookie(cancelOperatorToken, "/api/operations/jobs"));
    expect(response.status).toBe(200);
    const jobs = (await bodyOf(response)) as {
      jobs: { jobId: string; state: string; admission: { released: boolean } }[];
    };
    const row = jobs.jobs.find((job) => job.jobId === jobId);
    expect(row).toBeDefined();
    expect(row!.state).not.toBe("succeeded");
    expect(row!.state).not.toBe("failed");
    expect(row!.admission.released).toBe(false);

    // CANCEL — the adapter's real cancel on a live job.
    response = await cancelRoute(
      withCookie(cancelOperatorToken, `/api/operations/jobs/${jobId}/cancel`, {
        method: "POST",
      }),
      { params: Promise.resolve({ jobId }) },
    );
    expect(response.status).toBe(200);
    const cancelled = (await bodyOf(response)) as {
      jobId: string;
      cancelled: boolean;
      alreadyTerminal: string | null;
    };
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.alreadyTerminal).toBeNull();

    // The admission slot returned to the bounded queue.
    const queueResponse = await queuesRoute(
      withCookie(cancelOperatorToken, "/api/operations/queues"),
    );
    const queues = (await bodyOf(queueResponse)) as { queue: { depth: number } };
    expect(queues.queue.depth).toBe(0);
    const releasedResponse = await jobsRoute(
      withCookie(cancelOperatorToken, "/api/operations/jobs"),
    );
    const released = (await bodyOf(releasedResponse)) as {
      jobs: { jobId: string; admission: { released: boolean; admissionId: string | null } }[];
    };
    const releasedRow = released.jobs.find((job) => job.jobId === jobId);
    expect(releasedRow!.admission.released).toBe(true);
    expect(releasedRow!.admission.admissionId).toBeNull();

    // Now release the gate: the real execution runs and its LATE report is
    // superseded — the job STAYS cancelled (never a flip back).
    releaseExecution();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const settledResponse = await jobsRoute(
      withCookie(cancelOperatorToken, "/api/operations/jobs"),
    );
    const settled = (await bodyOf(settledResponse)) as { jobs: { jobId: string; state: string }[] };
    expect(settled.jobs.find((job) => job.jobId === jobId)!.state).toBe("cancelled");

    // A second cancel is the honest counted no-op with the disposition.
    response = await cancelRoute(
      withCookie(cancelOperatorToken, `/api/operations/jobs/${jobId}/cancel`, {
        method: "POST",
      }),
      { params: Promise.resolve({ jobId }) },
    );
    expect(response.status).toBe(200);
    const noOp = (await bodyOf(response)) as {
      cancelled: boolean;
      alreadyTerminal: string | null;
    };
    expect(noOp.cancelled).toBe(false);
    expect(noOp.alreadyTerminal).toBe("cancelled");
  });

  test("the audit trail records the cancel outcomes (executed + no-op)", async () => {
    const response = await auditRoute(withCookie(cancelOperatorToken, "/api/operations/audit"));
    expect(response.status).toBe(200);
    const audit = (await bodyOf(response)) as {
      records: { action: string; outcome: string; detail: string }[];
    };
    const cancels = audit.records.filter((record) => record.action === "job.cancel");
    expect(cancels.length).toBe(2);
    expect(cancels.some((record) => record.outcome === "succeeded")).toBe(true);
    expect(
      cancels.some(
        (record) => record.outcome === "refused" && record.detail.includes("already-terminal"),
      ),
    ).toBe(true);
  });
});
