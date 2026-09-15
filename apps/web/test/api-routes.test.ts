import { beforeAll, describe, expect, test } from "bun:test";
import { createDeterministicTestHasher } from "@sporta/identity";
import {
  createSportaServer,
  installSportaServerForTests,
} from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { SPORTA_SESSION_COOKIE } from "../src/server/auth-service";
import { POST as registerRoute } from "../src/app/api/auth/register/route";
import { POST as loginRoute } from "../src/app/api/auth/login/route";
import { POST as logoutRoute } from "../src/app/api/auth/logout/route";
import { GET as meRoute } from "../src/app/api/auth/me/route";
import { POST as switchRoleRoute } from "../src/app/api/auth/switch-role/route";
import { GET as capabilityRoute } from "../src/app/api/capability/route";
import { GET as catalogRoute } from "../src/app/api/catalog/sessions/route";
import { GET as libraryRoute } from "../src/app/api/catalog/library/route";
import { GET as watchRoute } from "../src/app/api/watch/[sessionId]/route";
import { GET as outputRoute } from "../src/app/api/watch/[sessionId]/renders/[renderId]/outputs/[segmentId]/route";

/**
 * API ROUTE TESTS (W904): the route handlers themselves, driven as real
 * functions over real `Request`s, against a HERMETIC composition — the real
 * control plane + the real identity stores + the REAL dev seed (real engine
 * sessions, real renders, real stored outputs), with a deterministic test
 * hasher and a pinned clock. Nothing is mocked: the only injected seams are
 * the ones the composition root already exposes.
 */

const NOW_MS = 1_777_777_777_000;
let server: SportaServer;
let seededSessionIds: string[] = [];
let trainingSessionId: string | null = null;
let seededOutput: { sessionId: string; renderId: string; segmentId: string } | null = null;

beforeAll(async () => {
  server = createSportaServer({
    nowMs: () => NOW_MS,
    passwordHasher: createDeterministicTestHasher(),
    seed: true,
  });
  installSportaServerForTests(server);
  await server.ready;
  // The real seeded catalog (built through the real services, same as routes).
  const catalog = await server.control.listSessions();
  seededSessionIds = catalog.sessions.map((entry) => entry.id);
  for (const sessionId of seededSessionIds) {
    const story = server.storyIndex.get(sessionId);
    if (story?.storyKey === "training") trainingSessionId = sessionId;
    // The control plane's render listing is playback-gated: a rights-denied
    // session DENIES before existence — enumerate only authorized sessions.
    if (story?.storyKey === "training") continue;
    const { renders } = await server.control.listRenders(sessionId);
    for (const render of renders) {
      const outputs = await server.control.listRenderOutputs(sessionId, render.renderId);
      if (outputs.segments.length > 0 && seededOutput === null) {
        seededOutput = { sessionId, renderId: render.renderId, segmentId: outputs.segments[0]!.segmentId };
      }
    }
  }
});

function jsonRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`http://sporta.test${path}`, init);
}

function withCookie(path: string, cookie: string, init: RequestInit = {}): Request {
  return new Request(`http://sporta.test${path}`, {
    ...init,
    headers: {
      ...((init.headers as Record<string, string> | undefined) ?? {}),
      cookie,
    },
  });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// /api/capability — the frozen seam
// ---------------------------------------------------------------------------

describe("GET /api/capability", () => {
  test("answers a real, parseable W901 capability response", async () => {
    const response = await capabilityRoute(jsonRequest("/api/capability"));
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    expect(body.schemaVersion).toBe("1.0");
    expect(body.auth).toMatchObject({ state: "anonymous", sessionValid: false });
  });

  test("echoes the caller's requestId verbatim", async () => {
    const response = await capabilityRoute(jsonRequest("/api/capability?requestId=req-w904-1"));
    const body = await bodyOf(response);
    expect(body.requestContext).toEqual({ requestId: "req-w904-1" });
  });

  test("reports the REAL renderer registry (testcard + anime) with honest live", async () => {
    const response = await capabilityRoute(jsonRequest("/api/capability"));
    const body = (await bodyOf(response)) as {
      renderers: { rendererId: string; availability: string }[];
      modes: { live: { availability: string; reasonCode: string; transportKind: string } };
    };
    const ids = body.renderers.map((renderer) => renderer.rendererId).sort();
    expect(ids).toEqual(["anime.prototype", "sporta.testcard"]);
    // Simulation F: the in-process control plane may never be labelled live.
    expect(body.modes.live).toEqual({
      availability: "unavailable",
      reasonCode: "in-process-transport-not-live",
      transportKind: "in-process",
    });
  });

  test("a presented-but-invalid session is invalid-session, never silently anonymous", async () => {
    const response = await capabilityRoute(
      withCookie("/api/capability", `${SPORTA_SESSION_COOKIE}=not-a-real-token`),
    );
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    expect(body.auth).toMatchObject({ state: "invalid-session", sessionValid: false });
  });
});

// ---------------------------------------------------------------------------
// /api/auth/* — register/login/logout/me/switch-role
// ---------------------------------------------------------------------------

describe("the auth round-trip", () => {
  test("register validates input (400 with classified body)", async () => {
    const response = await registerRoute(
      jsonRequest("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "x", password: "short" }),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await bodyOf(response)) as { error: { failureClass: string } };
    expect(body.error.failureClass).toBe("validation");
  });

  test("register refuses self-minting operator/rights-holder grants", async () => {
    const response = await registerRoute(
      jsonRequest("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "powerful-user",
          password: "a-very-long-password",
          roles: ["operator"],
        }),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await bodyOf(response)) as { error: { message: string } };
    expect(body.error.message).toContain("viewer, creator, and analyst");
  });

  test("register → login → me → switch-role → logout, with cookies", async () => {
    // 1. Register (no cookie is set — register then sign in).
    const registerResponse = await registerRoute(
      jsonRequest("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "w904-route-user", password: "route-test-password-1", roles: ["viewer", "creator"] }),
      }),
    );
    expect(registerResponse.status).toBe(200);
    const account = (await bodyOf(registerResponse)) as { username: string; roles: string[] };
    expect(account.username).toBe("w904-route-user");
    expect([...account.roles].sort()).toEqual(["creator", "viewer"]);
    expect(registerResponse.headers.get("set-cookie")).toBeNull();

    // 2. Duplicate username is a 409 conflict.
    const duplicate = await registerRoute(
      jsonRequest("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "w904-route-user", password: "route-test-password-1" }),
      }),
    );
    expect(duplicate.status).toBe(409);

    // 3. Login: wrong password is a generic 401 (no username oracle).
    const wrong = await loginRoute(
      jsonRequest("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "w904-route-user", password: "wrong-password-here" }),
      }),
    );
    expect(wrong.status).toBe(401);
    const wrongBody = (await bodyOf(wrong)) as { error: { failureClass: string } };
    expect(wrongBody.error.failureClass).toBe("auth-invalid");

    // 4. Login: correct credentials set the HttpOnly cookie + return the token.
    const login = await loginRoute(
      jsonRequest("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "w904-route-user", password: "route-test-password-1" }),
      }),
    );
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie");
    expect(cookie).not.toBeNull();
    expect(cookie).toContain(`${SPORTA_SESSION_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    const loginBody = (await bodyOf(login)) as { token: string; account: { username: string; activeRole: string | null } };
    expect(typeof loginBody.token).toBe("string");
    expect(loginBody.account.username).toBe("w904-route-user");

    // 5. me with the cookie answers the account view.
    const me = await meRoute(withCookie("/api/auth/me", cookie!));
    expect(me.status).toBe(200);
    const meBody = (await bodyOf(me)) as { username: string; roles: string[]; activeRole: string | null };
    expect(meBody.username).toBe("w904-route-user");
    expect(meBody.activeRole).toBeNull();

    // 6. Anonymous me is a 401.
    const anonymousMe = await meRoute(jsonRequest("/api/auth/me"));
    expect(anonymousMe.status).toBe(401);

    // 7. switch-role to a held grant changes the presentation role only.
    const switched = await switchRoleRoute(
      withCookie("/api/auth/switch-role", cookie!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "creator" }),
      }),
    );
    expect(switched.status).toBe(200);
    const switchedBody = (await bodyOf(switched)) as { activeRole: string; roles: string[] };
    expect(switchedBody.activeRole).toBe("creator");
    expect([...switchedBody.roles].sort()).toEqual(["creator", "viewer"]);

    // 8. switch-role to an un-granted role is a 403 (never authority).
    const forbidden = await switchRoleRoute(
      withCookie("/api/auth/switch-role", cookie!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "operator" }),
      }),
    );
    expect(forbidden.status).toBe(403);

    // 9. Logout revokes; me afterwards is 401; logout is idempotent.
    const logout = await logoutRoute(withCookie("/api/auth/logout", cookie!, { method: "POST" }));
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    const meAfter = await meRoute(withCookie("/api/auth/me", cookie!));
    expect(meAfter.status).toBe(401);
    const logoutAgain = await logoutRoute(withCookie("/api/auth/logout", cookie!, { method: "POST" }));
    expect(logoutAgain.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// /api/catalog/* — the real seeded catalog
// ---------------------------------------------------------------------------

describe("GET /api/catalog/sessions", () => {
  test("lists the real seeded sessions as honest card models", async () => {
    const response = await catalogRoute();
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      sessions: {
        sessionId: string;
        label: string;
        status: string;
        playback: { state: string; reasonCode: string };
        renders: unknown;
        outputCount: number | null;
        story: { source: string; storyKey: string; eventCount: number } | null;
      }[];
      catalogSource: string;
    };
    expect(body.catalogSource).toBe("dev-seed");
    expect(body.sessions.length).toBeGreaterThanOrEqual(3);
    expect(seededSessionIds.length).toBe(body.sessions.length);

    // Every card is labeled dev-seed and carries real story data.
    for (const card of body.sessions) {
      expect(card.story).not.toBeNull();
      expect(card.story!.source).toBe("dev-seed");
      expect(card.label.length).toBeGreaterThan(3);
    }

    // The training story (a REAL rights-denied session) denies playback and
    // reveals NOTHING about its renders (fail-closed, Simulation D).
    const denied = body.sessions.find((card) => card.story!.storyKey === "training");
    expect(denied).toBeDefined();
    expect(denied!.playback).toEqual({ state: "denied", reasonCode: "rights-denied" });
    expect(denied!.renders).toBeNull();
    expect(denied!.outputCount).toBeNull();

    // The derby story (fully authorized) has real renders + a stored output.
    const derby = body.sessions.find((card) => card.story!.storyKey === "derby");
    expect(derby).toBeDefined();
    expect(derby!.playback).toEqual({ state: "authorized", reasonCode: "ok" });
    expect(derby!.renders).not.toBeNull();
    expect((derby!.renders as { renderId: string }[]).length).toBeGreaterThanOrEqual(2);
    expect(derby!.outputCount).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /api/catalog/library", () => {
  test("anonymous callers get the authentication-required 401", async () => {
    const response = await libraryRoute(jsonRequest("/api/catalog/library"));
    expect(response.status).toBe(401);
    const body = (await bodyOf(response)) as { error: { failureClass: string } };
    expect(body.error.failureClass).toBe("unauthenticated");
  });

  test("a signed-in user with no sessions gets the honest empty library", async () => {
    // Register + login a fresh user through the real routes.
    await registerRoute(
      jsonRequest("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "w904-library-user", password: "route-test-password-1" }),
      }),
    );
    const login = await loginRoute(
      jsonRequest("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "w904-library-user", password: "route-test-password-1" }),
      }),
    );
    const cookie = login.headers.get("set-cookie")!;
    const response = await libraryRoute(withCookie("/api/catalog/library", cookie));
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as { sessions: unknown[]; ownerId: string };
    expect(body.sessions).toEqual([]);
    expect(body.ownerId).toMatch(/^u-\d+$/);
  });
});

// ---------------------------------------------------------------------------
// /api/watch/* — the playback-session acquisition + the output gate
// ---------------------------------------------------------------------------

describe("GET /api/watch/[sessionId]", () => {
  test("answers the real watch model for a seeded session", async () => {
    expect(seededSessionIds.length).toBeGreaterThan(0);
    const sessionId = seededSessionIds[0]!;
    const response = await watchRoute(jsonRequest(`/api/watch/${sessionId}`), {
      params: Promise.resolve({ sessionId }),
    });
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      sessionId: string;
      renders: unknown[] | null;
      story: { source: string; waveCount: number } | null;
    };
    expect(body.sessionId).toBe(sessionId);
    expect(body.story).not.toBeNull();
    expect(body.story!.source).toBe("dev-seed");
    expect(body.story!.waveCount).toBe(6);
  });

  test("an unknown session answers the control plane's own 404", async () => {
    const response = await watchRoute(jsonRequest("/api/watch/no-such-session"), {
      params: Promise.resolve({ sessionId: "no-such-session" }),
    });
    expect(response.status).toBe(404);
    const body = (await bodyOf(response)) as { error: { failureClass: string } };
    expect(body.error.failureClass).toBe("unknown-session");
  });
});

describe("GET /api/watch/[sessionId]/renders/[renderId]/outputs/[segmentId]", () => {
  test("serves a real stored output through the playback gate", async () => {
    expect(seededOutput).not.toBeNull();
    const { sessionId, renderId, segmentId } = seededOutput!;
    const response = await outputRoute(
      jsonRequest(`/api/watch/${sessionId}/renders/${renderId}/outputs/${segmentId}`),
      { params: Promise.resolve({ sessionId, renderId, segmentId }) },
    );
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      contentType: string;
      contentHash: string;
      manifest: { frameCount: number; totalDurationMs: number };
    };
    expect(body.contentType).toContain("svg");
    expect(body.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(body.manifest.frameCount).toBeGreaterThan(0);
    expect(body.manifest.totalDurationMs).toBeGreaterThan(0);
  });

  test("the rights-denied session's outputs deny before existence (Simulation D)", async () => {
    // The training session is REAL and seeded: rendering ran (compute is
    // allowed) but stored playback is denied — the gate must 403 BEFORE the
    // store is consulted, regardless of the render/segment ids offered.
    expect(trainingSessionId).not.toBeNull();
    const response = await outputRoute(
      jsonRequest(`/api/watch/${trainingSessionId}/renders/r-000/outputs/whatever`),
      {
        params: Promise.resolve({
          sessionId: trainingSessionId!,
          renderId: "r-000",
          segmentId: "whatever",
        }),
      },
    );
    expect(response.status).toBe(403);
    const body = (await bodyOf(response)) as { error: { failureClass: string } };
    expect(body.error.failureClass).toBe("rights-denied");
  });

  test("an unknown segment of an authorized render is a 404", async () => {
    expect(seededOutput).not.toBeNull();
    const { sessionId, renderId } = seededOutput!;
    const response = await outputRoute(
      jsonRequest(`/api/watch/${sessionId}/renders/${renderId}/outputs/no-such-segment`),
      {
        params: Promise.resolve({ sessionId, renderId, segmentId: "no-such-segment" }),
      },
    );
    expect(response.status).toBe(404);
    const body = (await bodyOf(response)) as { error: { failureClass: string } };
    expect(body.error.failureClass).toBe("unknown-segment");
  });
});
