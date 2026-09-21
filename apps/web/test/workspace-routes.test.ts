import { beforeAll, describe, expect, test } from "bun:test";
import { createDeterministicTestHasher } from "@sporta/identity";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { SPORTA_SESSION_COOKIE } from "../src/server/auth-service";
import { GET as rightsCenterRoute } from "../src/app/api/rights/center/route";
import { GET as operationsRoute } from "../src/app/api/operations/route";
import { GET as pendingWorkRoute } from "../src/app/api/workspaces/pending-work/route";
import { GET as jobsRoute } from "../src/app/api/workspaces/jobs/route";
import { POST as createSessionRoute } from "../src/app/api/create/sessions/route";
import { countFailed, countInFlight } from "../src/server/workspace-service";

/**
 * W907 — the role-workspace API routes, driven as real functions over real
 * `Request`s against a HERMETIC composition (real control plane + compute
 * plane, real identity gate, real dev seed). The acceptance paths pinned
 * here:
 *
 * - the role workspaces' REAL backing (rights-policy records through the
 *   gate, the operator's real platform state, real job rows);
 * - the DENIED paths are the real 403/401 answers with explanations — a
 *   viewer hitting the Rights Center gets the server's own permission
 *   denial, and a non-operator hitting Operations gets the IDENTITY
 *   POLICY's own `provider-health.read` denial;
 * - pending work is counted from the real compute plane only.
 */

const NOW_MS = 1_799_999_999_000;
let server: SportaServer;
let viewerToken = "";
let rightsHolderToken = "";
let operatorToken = "";
let creatorToken = "";
let derbySessionId = "";
let trainingSessionId = "";
let ownedSessionId = "";

beforeAll(async () => {
  server = createSportaServer({
    nowMs: () => NOW_MS,
    passwordHasher: createDeterministicTestHasher(),
    seed: true,
  });
  installSportaServerForTests(server);
  await server.ready;

  // Real accounts through the real store — the grant-provisioning path the
  // W906 audit identified: rights-holder and operator grants are STORE-minted,
  // never self-registered.
  const viewer = await server.auth.register({
    username: "w907-viewer",
    password: "a-real-viewer-password",
  });
  viewerToken = (await server.auth.issueSession({ userId: viewer.userId })).token;

  const rightsHolder = await server.auth.createSeedAccount({
    username: "w907-rights-holder",
    password: "store-minted-rights-holder",
    roles: ["viewer", "rights-holder"],
  });
  rightsHolderToken = (await server.auth.issueSession({ userId: rightsHolder.userId })).token;

  const operator = await server.auth.createSeedAccount({
    username: "w907-operator",
    password: "store-minted-operator",
    roles: ["operator"],
  });
  operatorToken = (await server.auth.issueSession({ userId: operator.userId })).token;

  const creator = await server.auth.register({
    username: "w907-creator",
    password: "a-real-creator-password",
    roles: ["creator", "viewer"],
  });
  creatorToken = (await server.auth.issueSession({ userId: creator.userId })).token;

  // The seeded sessions (created through the REAL gate by the seed account).
  const { sessions } = await server.control.listSessions();
  for (const entry of sessions) {
    const story = server.storyIndex.get(entry.id);
    if (story?.storyKey === "derby") derbySessionId = entry.id;
    if (story?.storyKey === "training") trainingSessionId = entry.id;
  }

  // A session the rights-holder OWNS (through the REAL gate, real policy).
  const created = (await server.gate.createMediaSession(rightsHolderToken, {
    authorizationPolicy: {
      policyId: "w907-rights-holder-policy",
      allowedOperations: ["analysis", "transformation", "derivativeGeneration", "storage"],
      assertedBy: rightsHolder.userId,
      storageDurationDays: 30,
      sharingScope: "private",
    },
    sourceLabel: "W907 rights-holder owned session",
  })) as { session: { sessionId: string } };
  ownedSessionId = created.session.sessionId;
});

function withCookie(token: string | null, path: string): Request {
  return new Request(`http://sporta.test${path}`, {
    headers: token !== null ? { cookie: `${SPORTA_SESSION_COOKIE}=${token}` } : {},
  });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// GET /api/rights/center
// ---------------------------------------------------------------------------

describe("W907 GET /api/rights/center — the Rights Holder workspace", () => {
  test("anonymous callers get the real 401", async () => {
    const response = await rightsCenterRoute(withCookie(null, "/api/rights/center"));
    expect(response.status).toBe(401);
    const body = await bodyOf(response);
    expect(body.error).toMatchObject({ failureClass: "unauthenticated" });
  });

  test("a viewer (no rights-holder grant) gets the REAL 403 with the explanation", async () => {
    const response = await rightsCenterRoute(withCookie(viewerToken, "/api/rights/center"));
    expect(response.status).toBe(403);
    const body = await bodyOf(response);
    expect(body.error).toMatchObject({
      failureClass: "permission-denied",
      details: { requiredGrant: "rights-holder" },
    });
    expect((body.error as { message: string }).message).toContain("rights-holder");
  });

  test("a rights-holder sees their OWN sessions with REAL policy records", async () => {
    const response = await rightsCenterRoute(withCookie(rightsHolderToken, "/api/rights/center"));
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      scope: string;
      entries: {
        sessionId: string;
        policyId: string;
        access: string;
        visibility: string;
        rightsCapabilities: Record<string, boolean>;
      }[];
    };
    expect(body.scope).toBe("owned");
    expect(body.entries.length).toBe(1);
    const entry = body.entries[0]!;
    expect(entry.sessionId).toBe(ownedSessionId);
    expect(entry.access).toBe("owned");
    expect(entry.policyId).toBe("w907-rights-holder-policy");
    // The REAL derived capabilities of the declared policy (transformation +
    // derivativeGeneration + storage, no liveDelivery, no sharing).
    expect(entry.rightsCapabilities).toEqual({
      canReferenceSourceFrames: true,
      canDeliverLive: false,
      canStoreDerivatives: true,
      canShare: false,
    });
  });

  test("an operator's scope is every session, including the playback-DENIED one (the gate reads owner/operator, not playback)", async () => {
    const response = await rightsCenterRoute(withCookie(operatorToken, "/api/rights/center"));
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      scope: string;
      entries: { sessionId: string; access: string; rightsCapabilities: Record<string, boolean> }[];
    };
    expect(body.scope).toBe("operator");
    const ids = body.entries.map((entry) => entry.sessionId);
    expect(ids).toContain(derbySessionId);
    expect(ids).toContain(trainingSessionId);
    expect(ids).toContain(ownedSessionId);
    expect(body.entries.every((entry) => entry.access === "operator")).toBe(true);
    // The training story's policy denies derivative storage — the real record says so.
    const training = body.entries.find((entry) => entry.sessionId === trainingSessionId)!;
    expect(training.rightsCapabilities.canStoreDerivatives).toBe(false);
    // The derby story's policy permits the full set — the real record says so.
    const derby = body.entries.find((entry) => entry.sessionId === derbySessionId)!;
    expect(derby.rightsCapabilities.canDeliverLive).toBe(true);
  });

  test("the center's own note is honest about read-only scope", async () => {
    const response = await rightsCenterRoute(withCookie(rightsHolderToken, "/api/rights/center"));
    const body = (await bodyOf(response)) as { note: string };
    expect(body.note).toContain("read-only");
    expect(body.note).toContain("W917");
  });
});

// ---------------------------------------------------------------------------
// GET /api/operations
// ---------------------------------------------------------------------------

describe("W907 GET /api/operations — the Operator workspace", () => {
  test("anonymous callers get the real 401", async () => {
    const response = await operationsRoute(withCookie(null, "/api/operations"));
    expect(response.status).toBe(401);
    const body = await bodyOf(response);
    expect(body.error).toMatchObject({ failureClass: "unauthenticated" });
  });

  test("a viewer gets the IDENTITY POLICY's own 403 (provider-health.read, role-not-granted)", async () => {
    const response = await operationsRoute(withCookie(viewerToken, "/api/operations"));
    expect(response.status).toBe(403);
    const body = await bodyOf(response);
    expect(body.error).toMatchObject({
      failureClass: "permission-denied",
      details: { action: "provider-health.read", reason: "role-not-granted" },
    });
  });

  test("an operator gets the REAL platform state (shared with /api/platform/health)", async () => {
    const response = await operationsRoute(withCookie(operatorToken, "/api/operations"));
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      health: {
        env: string;
        providers: Record<string, { provider: string; check: { state: string } }>;
        renderQueue: {
          key: string;
          maxDepth: number;
          admissionLeaseMs: number;
          depth: number | null;
        };
      };
      compute: { provider: string; adapterId: string } | null;
      queues: { key: string; maxDepth: number; admissionLeaseMs: number; depth: number | null };
      live: { state: string; detail: string; servingSources: number };
      failedJobs: unknown[];
    };
    // The same honest snapshot the health route serves. The provider bindings
    // follow the REAL environment (this sandbox may bind Neon/R2), so the
    // pinned invariant is the honesty rule itself: an in-memory fallback is
    // ALWAYS reported unconfigured — never "ok".
    expect(body.health.env).toBe("local");
    const checkStates = ["ok", "unconfigured", "error"];
    for (const seam of ["identity", "artifacts", "transientState"]) {
      const seamState = body.health.providers[seam]!;
      expect(["neon", "in-memory", "r2", "upstash"]).toContain(seamState.provider);
      expect(checkStates).toContain(seamState.check.state);
      if (seamState.provider === "in-memory") {
        expect(seamState.check.state).toBe("unconfigured");
      }
    }
    // The REAL compute plane (the in-process provider + its real adapter id).
    expect(body.compute).not.toBeNull();
    expect(body.compute!.provider).toBe("in-process");
    expect(body.compute!.adapterId.length).toBeGreaterThan(0);
    // The REAL W913 render-queue observation — the same numbers the health
    // snapshot serves (one shared implementation), never an invented depth.
    expect(body.queues.key).toBe("sporta:jobs:render");
    expect(body.queues.maxDepth).toBe(256); // the real free-tier hard bound
    expect(body.queues.admissionLeaseMs).toBeGreaterThan(0);
    expect(body.queues.depth === null || Number.isInteger(body.queues.depth)).toBe(true);
    // And the health section carries the SAME observation (no drift).
    expect(body.health.renderQueue).toEqual(body.queues);
    // The live transport is env-gated OFF in tests — the honest state.
    expect(body.live.state).toBe("unavailable");
    expect(body.live.servingSources).toBe(0);
    // No failed jobs — the real answer, not a placeholder.
    expect(body.failedJobs).toEqual([]);
  });

  test("switching the active role NEVER changes the operations decision (context-only)", async () => {
    // The viewer account switches its active role to viewer (a grant it
    // holds) — the operations denial must be byte-identical.
    await server.auth.switchRole(viewerToken, { role: "viewer" });
    const response = await operationsRoute(withCookie(viewerToken, "/api/operations"));
    expect(response.status).toBe(403);
    const body = await bodyOf(response);
    expect(body.error).toMatchObject({
      details: { action: "provider-health.read", reason: "role-not-granted" },
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/workspaces/jobs
// ---------------------------------------------------------------------------

describe("W907 GET /api/workspaces/jobs — the Jobs workspace", () => {
  test("anonymous callers get the real 401", async () => {
    const response = await jobsRoute(withCookie(null, "/api/workspaces/jobs"));
    expect(response.status).toBe(401);
  });

  test("a viewer gets the REAL 403 with the creator/operator explanation", async () => {
    const response = await jobsRoute(withCookie(viewerToken, "/api/workspaces/jobs"));
    expect(response.status).toBe(403);
    const body = await bodyOf(response);
    expect(body.error).toMatchObject({
      failureClass: "permission-denied",
      details: { requiredGrants: ["creator", "operator"] },
    });
  });

  test("a creator sees their OWN sessions (owned scope, honest empty job lists)", async () => {
    const response = await jobsRoute(withCookie(creatorToken, "/api/workspaces/jobs"));
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      scope: string;
      sessions: { sessionId: string; jobs: unknown[] }[];
    };
    expect(body.scope).toBe("owned");
    // The creator owns nothing yet — the honest empty answer.
    expect(body.sessions).toEqual([]);
  });

  test("an operator sees EVERY session (operator scope, real headers)", async () => {
    const response = await jobsRoute(withCookie(operatorToken, "/api/workspaces/jobs"));
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      scope: string;
      sessions: { sessionId: string; label: string; status: string; jobs: unknown[] }[];
    };
    expect(body.scope).toBe("operator");
    // L005 (full): 9 seeded (3 stories + 6 L005 tactical scenarios) + the rights-holder's.
    expect(body.sessions.length).toBe(10);
    const ids = body.sessions.map((entry) => entry.sessionId);
    expect(ids).toContain(derbySessionId);
    expect(ids).toContain(trainingSessionId);
    expect(ids).toContain(ownedSessionId);
    // Every session header carries the control plane's real status + label.
    for (const entry of body.sessions) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.status.length).toBeGreaterThan(0);
      expect(entry.jobs).toEqual([]); // no studio-dispatched jobs yet — honest
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/workspaces/pending-work
// ---------------------------------------------------------------------------

describe("W907 GET /api/workspaces/pending-work — the switcher's badges", () => {
  test("anonymous callers get the real 401", async () => {
    const response = await pendingWorkRoute(withCookie(null, "/api/workspaces/pending-work"));
    expect(response.status).toBe(401);
  });

  test("a viewer carries NO badge (no pending-work data plane — honest absence)", async () => {
    const response = await pendingWorkRoute(
      withCookie(viewerToken, "/api/workspaces/pending-work"),
    );
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as { roles: Record<string, unknown> };
    expect(Object.keys(body.roles)).toEqual([]);
  });

  test("an operator with no failed jobs carries no badge either (zero is null, never 0)", async () => {
    const response = await pendingWorkRoute(
      withCookie(operatorToken, "/api/workspaces/pending-work"),
    );
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as { roles: Record<string, unknown> };
    expect(body.roles.operator).toBeUndefined();
  });

  test("a creator who owns a settled job carries no in-flight badge (the real count is zero)", async () => {
    // Create a session as the creator and dispatch ONE real render job.
    const created = await createSessionRoute(
      new Request("http://sporta.test/api/create/sessions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${SPORTA_SESSION_COOKIE}=${creatorToken}`,
        },
        body: JSON.stringify({
          sourceKey: "derby",
          operations: ["analysis", "transformation", "derivativeGeneration", "storage"],
        }),
      }),
    );
    expect(created.status).toBe(201);
    const { sessionId } = (await bodyOf(created)) as { sessionId: string };
    const dispatched = await server.studio.dispatchRender({
      token: creatorToken,
      sessionId,
      rendererId: "anime.prototype",
      styleId: "w907-jobs-test",
    });
    // Poll to terminal through the REAL job ledger.
    let state = "";
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const job = await server.studio.jobState(creatorToken, sessionId, dispatched.jobId);
      state = job.state;
      if (["succeeded", "failed", "cancelled", "dead-lettered"].includes(state)) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(state).toBe("succeeded");

    // The pending-work badge for creator is the REAL in-flight count: zero
    // (the only job settled) — carried as honest absence.
    const response = await pendingWorkRoute(
      withCookie(creatorToken, "/api/workspaces/pending-work"),
    );
    expect(response.status).toBe(200);
    const pending = (await bodyOf(response)) as { roles: Record<string, unknown> };
    expect(pending.roles.creator).toBeUndefined();

    // And the Jobs overview now lists the settled job with its REAL state.
    const jobsResponse = await jobsRoute(withCookie(creatorToken, "/api/workspaces/jobs"));
    expect(jobsResponse.status).toBe(200);
    const overview = (await bodyOf(jobsResponse)) as {
      scope: string;
      sessions: {
        sessionId: string;
        jobs: {
          jobId: string;
          state: string;
          completion?: { status: string; executionMs: number; usage: { unitId: string }[] };
        }[];
      }[];
    };
    const mine = overview.sessions.find((entry) => entry.sessionId === sessionId)!;
    expect(mine.jobs.length).toBe(1);
    expect(mine.jobs[0]!.jobId).toBe(dispatched.jobId);
    expect(mine.jobs[0]!.state).toBe("succeeded");
    expect(mine.jobs[0]!.completion!.status).toBe("succeeded");
    expect(mine.jobs[0]!.completion!.executionMs).toBeGreaterThanOrEqual(0);
    expect(mine.jobs[0]!.completion!.usage.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The pending-work classifiers (pure, but load-bearing for the badges)
// ---------------------------------------------------------------------------

describe("W907 pending-work classifiers — which states mean work", () => {
  test("the non-terminal states count as in-flight work", () => {
    const rows = ["admitted", "dispatched", "queued", "in-flight"].map((state) => ({ state }));
    expect(countInFlight(rows)).toBe(4);
  });

  test("settled states never count as in-flight (a settled job is done work)", () => {
    const rows = ["succeeded", "failed", "cancelled", "dead-lettered"].map((state) => ({
      state,
    }));
    expect(countInFlight(rows)).toBe(0);
  });

  test("only real failures count as failed work — cancelled is not a failure", () => {
    const rows = ["failed", "dead-lettered", "cancelled", "succeeded"].map((state) => ({
      state,
    }));
    expect(countFailed(rows)).toBe(2);
  });

  test("an unknown future state counts as neither (fail-closed against vocabulary growth)", () => {
    expect(countInFlight([{ state: "paused" }])).toBe(0);
    expect(countFailed([{ state: "paused" }])).toBe(0);
  });
});
