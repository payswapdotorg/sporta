import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDeterministicTestHasher } from "@sporta/identity";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { SPORTA_SESSION_COOKIE } from "../src/server/auth-service";
import { GET as jobsRoute } from "../src/app/api/operations/jobs/route";
import { operationsJobContextLinks } from "../src/components/operations-console";
import { ROUTES } from "../src/lib/navigation";

/**
 * THE OPERATOR CONTEXTUAL NAVIGATION TESTS (J011) — the operations console
 * links jobs/failures DIRECTLY to their context:
 *
 * 1. THE SERVER JOIN (the affected session, identified): the jobs listing
 *    carries each job's session LABEL — the control plane's own
 *    `sourceLabel` joined per row (the operator sees WHICH session, never a
 *    bare id to guess about); a session with no recorded label stays the
 *    honest id; the route stays operator-gated (the real 401/403 — the
 *    console's one access rule, unchanged).
 * 2. THE CONTEXTUAL LINK DERIVATIONS (pure): every job row's link targets
 *    are derived from the job's REAL data — the session-addressable Watch
 *    route (the same target the session cards use), the Create studio, the
 *    console's own Providers & quotas panel (the in-page anchor), and the
 *    compute connection center. No fabricated targets; a session id is
 *    encoded, never interpolated raw.
 *
 * REAL-vs-FIXTURE: the composition, the control-plane sessions, the
 * seeded job and the routes are all REAL (the seeded dispatches through
 * the studio ledger); only the clock/hasher are test-injected (the repo's
 * hermetic-composition convention).
 */

const NOW_MS = 1_777_777_777_000;

let server: SportaServer;
let operatorToken = "";
let viewerToken = "";

beforeAll(async () => {
  server = createSportaServer({
    nowMs: () => NOW_MS,
    passwordHasher: createDeterministicTestHasher(),
    seed: true,
  });
  installSportaServerForTests(server);
  await server.ready;

  // Self-registration cannot mint the operator grant (operator-assigned);
  // the test mints it the way provisioning does, straight into the account
  // store (the W918 console battery's own pattern).
  const operator = await server.accounts.create({
    username: "j011-operator",
    email: undefined,
    passwordHash: "not-a-login-path",
    roles: ["operator", "viewer"],
    createdAtIso: new Date(NOW_MS).toISOString(),
  });
  operatorToken = (await server.auth.issueSession({ userId: operator.userId })).token;
  const viewer = await server.auth.register({
    username: "j011-viewer",
    password: "a-real-j011-viewer-password",
    roles: ["viewer"],
  });
  viewerToken = (await server.auth.issueSession({ userId: viewer.userId })).token;

  // ONE real async dispatch through the studio seam (the operator's own
  // owner-or-operator rule — the same ladder the console's retry uses), so
  // the jobs ledger the console lists is REAL (the seed's own renders are
  // the synchronous control-plane path, not async jobs).
  const seeded = (
    await server.control.listSessions()
  ).sessions.find((summary) => summary.sourceLabel !== undefined);
  expect(seeded).toBeDefined();
  const dispatch = await server.studio.dispatchRender({
    token: operatorToken,
    sessionId: seeded!.id,
    rendererId: "anime.prototype",
    styleId: "j011-operations-context",
  });
  expect(dispatch.jobId.length).toBeGreaterThan(0);
});

afterAll(() => {
  // The composition holds no resources that need explicit release.
});

function authorized(path: string, token: string): Request {
  return new Request(`http://sporta.test${path}`, {
    headers: { cookie: `${SPORTA_SESSION_COOKIE}=${token}` },
  });
}

describe("GET /api/operations/jobs (the J011 server join)", () => {
  test("anonymous callers get the real 401 (the console's gate is unchanged)", async () => {
    const response = await jobsRoute(new Request("http://sporta.test/api/operations/jobs"));
    expect(response.status).toBe(401);
  });

  test("a signed-in non-operator gets the real 403 (the console's gate is unchanged)", async () => {
    const response = await jobsRoute(authorized("/api/operations/jobs", viewerToken));
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { failureClass: string } };
    expect(body.error.failureClass).toBe("permission-denied");
  });

  test("every job row carries the affected session's LABEL (the control plane's own join)", async () => {
    const response = await jobsRoute(authorized("/api/operations/jobs", operatorToken));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      jobs: {
        jobId: string;
        sessionId: string;
        sessionLabel: string | null;
      }[];
    };
    // The dev seed's real dispatched jobs (the story sessions render through
    // the studio ledger). Every row's session resolves in the control plane
    // with its recorded sourceLabel — the join the console navigates by.
    expect(body.jobs.length).toBeGreaterThan(0);
    for (const job of body.jobs) {
      expect(typeof job.sessionId).toBe("string");
      expect(job.sessionId.length).toBeGreaterThan(0);
      // The seeded sessions carry their story labels (the control plane's
      // own sourceLabel — never invented here).
      expect(job.sessionLabel).not.toBeNull();
      expect(typeof job.sessionLabel).toBe("string");
    }
  });
});

describe("the contextual link derivations (J011 — pure)", () => {
  test("a job row's links target the session-addressable surfaces (no guessing URLs)", () => {
    const job = { sessionId: "sess-j011-example" };
    const links = operationsJobContextLinks(job);
    // THE WATCH TARGET: the existing session-addressable watch route — the
    // same target the session cards use, with the id encoded.
    expect(links.watch).toBe(`${ROUTES.watch}?session=sess-j011-example`);
    // THE CREATE TARGET: the Create studio (where a re-submission starts).
    expect(links.create).toBe(ROUTES.create);
    // THE PROVIDER TARGET: the console's own Providers & quotas panel.
    expect(links.providers).toBe("#ops-providers-title");
    // THE COMPUTE-CENTER TARGET: the connection center route.
    expect(links.computeCenter).toBe(ROUTES.computeCenter);
  });

  test("a session id with reserved characters is encoded (never interpolated raw)", () => {
    const links = operationsJobContextLinks({ sessionId: "sess/with?reserved#chars" });
    expect(links.watch).toBe(`${ROUTES.watch}?session=sess%2Fwith%3Freserved%23chars`);
  });

  test("the links are stable per job data (the derivation is pure)", () => {
    const job = { sessionId: "sess-a" };
    expect(operationsJobContextLinks(job)).toEqual(operationsJobContextLinks(job));
    expect(operationsJobContextLinks({ sessionId: "sess-b" }).watch).not.toBe(
      operationsJobContextLinks(job).watch,
    );
  });
});
