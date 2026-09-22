import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDeterministicTestHasher } from "@sporta/identity";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { SPORTA_SESSION_COOKIE } from "../src/server/auth-service";
import { SEED_POLICIES } from "../src/server/dev-story";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFilesystemStorage } from "@sporta/media-platform";
import { GET as auditTrailRoute } from "../src/app/api/audit/trail/route";
import { ROLE_WORKSPACES } from "../src/lib/role-workspaces";
import { REAL_SURFACE_ROUTES } from "../src/lib/deferred-surfaces";

/**
 * J009 TESTS — the rights-audit DISCOVERABILITY surface (wave 4, Worker B):
 * the /audit trail over the role-gated domain query seam
 * (`@sporta/session`'s rights-audit-query — `auditTrailFor` /
 * `auditTrailInScope`):
 *
 * - anonymous callers get the honest 401 (the seam's own boundary);
 * - a RIGHTS HOLDER reaches the trails of the sessions THEY OWN — and
 *   nobody else's;
 * - an OPERATOR reaches every trail (the operational view);
 * - every other role gets the honest 403 (no audit workspace at all — the
 *   J003 honesty pattern with a real backing);
 * - the entries are the DOMAIN-vocabulary rights decisions (policy edits +
 *   revocations with the J008 `editKind`) — publication-visibility entries
 *   are outside the vocabulary and never presented as domain entries;
 * - the surface is WORKSPACE-REACHABLE: the rights-holder and operator
 *   workspaces link /audit by route (no guessed URLs — the acceptance).
 */

const NOW_MS = 1_799_999_999_000;
const clock = NOW_MS;

let server: SportaServer;
let scratch = "";
let derbyId = "";
let viewerToken = "";
let creatorToken = "";
let creatorUserId = "";
let holderToken = "";
let holderUserId = "";
let operatorToken = "";
/** A session owned by the CREATOR (outside the holder's own scope). */
let creatorSessionId = "";

function withCookie(path: string, token: string): Request {
  return new Request(`http://sporta.test${path}`, {
    headers: { cookie: `${SPORTA_SESSION_COOKIE}=${token}` },
  });
}

function plainRequest(path: string): Request {
  return new Request(`http://sporta.test${path}`);
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function createAccount(
  username: string,
  roles: string[],
): Promise<{ userId: string; token: string }> {
  const account = await server.accounts.create({
    username,
    email: undefined,
    passwordHash: "not-a-login-path",
    roles: roles as never,
    createdAtIso: new Date(NOW_MS).toISOString(),
  });
  const session = await server.auth.issueSession({ userId: account.userId });
  return { userId: account.userId, token: session.token };
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "sporta-j009-"));
  server = createSportaServer({
    nowMs: () => clock,
    passwordHasher: createDeterministicTestHasher(),
    seed: true,
    media: {
      db: ":memory:",
      storage: new LocalFilesystemStorage(join(scratch, "media-storage")),
    },
    annotations: { db: ":memory:" },
  });
  installSportaServerForTests(server);
  await server.ready;

  for (const summary of (await server.control.listSessions()).sessions) {
    if (server.storyIndex.get(summary.id)?.storyKey === "derby") derbyId = summary.id;
  }

  const viewer = await createAccount("j009-viewer", ["viewer"]);
  viewerToken = viewer.token;
  const creator = await createAccount("j009-creator", ["creator", "viewer"]);
  creatorToken = creator.token;
  creatorUserId = creator.userId;
  const holder = await createAccount("j009-holder", ["rights-holder", "viewer"]);
  holderToken = holder.token;
  holderUserId = holder.userId;
  const operator = await createAccount("j009-operator", ["operator", "viewer"]);
  operatorToken = operator.token;

  // A session OWNED by the rights holder (their own scope) and one owned by
  // the creator (outside the holder's own scope).
  const holderSession = (await server.gate.createMediaSession(holderToken, {
    authorizationPolicy: SEED_POLICIES.friendly,
    sourceLabel: "J009 holder-owned session",
  })) as { session: { sessionId: string } };
  const creatorSession = (await server.gate.createMediaSession(creatorToken, {
    authorizationPolicy: SEED_POLICIES.friendly,
    sourceLabel: "J009 creator-owned session",
  })) as { session: { sessionId: string } };
  creatorSessionId = creatorSession.session.sessionId;

  // Rights decisions on BOTH sessions (the domain editor's classified
  // entries — the trail's content) + one publication-visibility entry (the
  // app-layer vocabulary, outside the domain trail).
  await server.rightsEditor.editPolicy(
    holderSession.session.sessionId,
    { userId: holderUserId },
    {
      policyId: SEED_POLICIES.friendly.policyId,
      allowedOperations: ["analysis", "transformation", "derivativeGeneration", "storage"],
      assertedBy: holderUserId,
      sharingScope: "private",
    },
  );
  await server.rightsEditor.revoke(creatorSessionId, { userId: creatorUserId }, "J009 fixture");
  server.rightsAudit.append({
    atIso: new Date(clock).toISOString(),
    actorUserId: creatorUserId,
    sessionId: creatorSessionId,
    changeKind: "visibility",
    summary: "set visibility to private (a publication decision — outside the domain trail)",
    from: null,
    to: { kind: "private" },
  });
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The workspace scope (auditTrailInScope)
// ---------------------------------------------------------------------------

describe("J009: the workspace audit trail (auditTrailInScope through the route)", () => {
  test("anonymous callers get the honest 401 (the domain seam's own boundary)", async () => {
    const response = await auditTrailRoute(plainRequest("/api/audit/trail"));
    expect(response.status).toBe(401);
    const body = await bodyOf(response);
    expect((body.error as Record<string, string>).failureClass).toBe("unauthenticated");
  });

  test("a viewer (no rights-holder/operator grant) gets the honest 403 — no audit workspace at all", async () => {
    const response = await auditTrailRoute(withCookie("/api/audit/trail", viewerToken));
    expect(response.status).toBe(403);
    const body = await bodyOf(response);
    expect((body.error as Record<string, string>).failureClass).toBe("permission-denied");
    expect((body.error as Record<string, unknown>).details).toMatchObject({
      seam: "rights-audit-query",
    });
  });

  test("a rights holder sees EXACTLY their own sessions' trails — nobody else's", async () => {
    const response = await auditTrailRoute(withCookie("/api/audit/trail", holderToken));
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    expect(body.scope).toBe("own");
    expect(body.sessionId).toBeNull();
    const entries = body.entries as Record<string, string>[];
    const sessionIds = new Set(entries.map((entry) => entry.sessionId));
    // Their own session's rights decisions are there; the creator's session
    // (not theirs) and the seed account's sessions are NOT.
    expect(sessionIds.has(entries[0]!.sessionId)).toBe(true);
    expect(entries.length).toBe(1);
    expect(entries[0]!.sessionId).not.toBe(creatorSessionId);
    expect(entries[0]!.sessionId).not.toBe(derbyId);
    expect(entries[0]!.editKind).toBe("narrow");
  });

  test("an operator sees EVERY trail (the operational view)", async () => {
    const response = await auditTrailRoute(withCookie("/api/audit/trail", operatorToken));
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    expect(body.scope).toBe("operator");
    const sessionIds = new Set(
      (body.entries as Record<string, string>[]).map((entry) => entry.sessionId),
    );
    expect(sessionIds.has(creatorSessionId)).toBe(true);
  });

  test("the trail carries the DOMAIN vocabulary only — visibility entries never masquerade as rights decisions", async () => {
    const response = await auditTrailRoute(withCookie("/api/audit/trail", operatorToken));
    expect(response.status).toBe(200);
    const entries = (await bodyOf(response)).entries as Record<string, string>[];
    for (const entry of entries) {
      expect(entry.changeKind === "policy" || entry.changeKind === "revocation").toBe(true);
      expect(typeof entry.editKind).toBe("string");
    }
    // The fixture's visibility entry on the creator's session exists in the
    // app-layer log but NOT in the domain trail:
    expect(entries.some((entry) => entry.summary.includes("publication decision"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The per-session drill-down (auditTrailFor)
// ---------------------------------------------------------------------------

describe("J009: the per-session trail (auditTrailFor through ?session=)", () => {
  test("the owner reaches their own session's trail", async () => {
    const response = await auditTrailRoute(
      withCookie(`/api/audit/trail?session=${encodeURIComponent(creatorSessionId)}`, creatorToken),
    );
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    expect(body.sessionId).toBe(creatorSessionId);
    const entries = body.entries as Record<string, string>[];
    expect(entries.some((entry) => entry.editKind === "revoke")).toBe(true);
  });

  test("an operator reaches any session's trail", async () => {
    const response = await auditTrailRoute(
      withCookie(`/api/audit/trail?session=${encodeURIComponent(creatorSessionId)}`, operatorToken),
    );
    expect(response.status).toBe(200);
  });

  test("a non-owner (no grant) gets the uniform 403 — whether or not the session exists (no oracle)", async () => {
    const real = await auditTrailRoute(
      withCookie(`/api/audit/trail?session=${encodeURIComponent(creatorSessionId)}`, viewerToken),
    );
    const unknown = await auditTrailRoute(
      withCookie(
        `/api/audit/trail?session=${encodeURIComponent("sess-does-not-exist")}`,
        viewerToken,
      ),
    );
    expect(real.status).toBe(403);
    expect(unknown.status).toBe(403);
    expect(await real.text()).toBe(await unknown.text());
  });

  test("a rights holder reaches their OWN session's trail but not another owner's (uniform 403)", async () => {
    const own = await auditTrailRoute(
      withCookie(`/api/audit/trail?session=${encodeURIComponent(creatorSessionId)}`, holderToken),
    );
    expect(own.status).toBe(403); // the creator owns it, not the holder
    const body = await bodyOf(own);
    expect((body.error as Record<string, unknown>).details).toMatchObject({
      reason: "not-resource-owner",
    });
  });

  test("an analyst grant does not open the RIGHTS audit trail (the seam's own scope)", async () => {
    const analyst = await createAccount("j009-analyst", ["analyst", "viewer"]);
    const response = await auditTrailRoute(
      withCookie(`/api/audit/trail?session=${encodeURIComponent(creatorSessionId)}`, analyst.token),
    );
    expect(response.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Workspace reachability (the acceptance's "without guessing URLs")
// ---------------------------------------------------------------------------

describe("J009: the trail is workspace-reachable (no guessed URLs)", () => {
  test("the rights-holder workspace lists the Audit surface by route", () => {
    const surfaces = ROLE_WORKSPACES["rights-holder"];
    expect(surfaces.some((surface) => surface.href === "/audit")).toBe(true);
  });

  test("the operator workspace lists the Audit surface by route", () => {
    const surfaces = ROLE_WORKSPACES.operator;
    expect(surfaces.some((surface) => surface.href === "/audit")).toBe(true);
  });

  test("/audit is a REAL surface route (no deferred panel behind it any more)", () => {
    expect(REAL_SURFACE_ROUTES.includes("/audit")).toBe(true);
  });

  test("the Rights Center links the audit surface (the cross-link the holder follows)", async () => {
    const component = await Bun.file(
      new URL("../src/components/rights-center.tsx", import.meta.url),
    ).text();
    expect(component).toContain("href={ROUTES.audit}");
    expect(component).toContain("The rights audit trail lives in Audit");
  });
});
