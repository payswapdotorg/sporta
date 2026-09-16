import { beforeAll, describe, expect, test } from "bun:test";
import { createDeterministicTestHasher } from "@sporta/identity";
import { ControlRightsDeniedError } from "@sporta/control-api";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { SPORTA_SESSION_COOKIE } from "../src/server/auth-service";
import { SEED_POLICIES } from "../src/server/dev-story";
import { ANONYMOUS_REQUESTER, buildCatalogFor, searchCatalog } from "../src/server/catalog-service";
import { parseSearchQuery } from "../src/server/catalog-service";
import { GET as listPoliciesRoute } from "../src/app/api/rights/policies/route";
import { GET as inspectRoute, PATCH as patchPolicyRoute } from "../src/app/api/rights/policies/[sessionId]/route";
import { PATCH as patchVisibilityRoute } from "../src/app/api/rights/policies/[sessionId]/visibility/route";
import { POST as revokeRoute } from "../src/app/api/rights/policies/[sessionId]/revocation/route";
import { GET as watchRoute } from "../src/app/api/watch/[sessionId]/route";
import { GET as segmentRoute } from "../src/app/api/watch/[sessionId]/renders/[renderId]/outputs/[segmentId]/route";
import { GET as catalogRoute } from "../src/app/api/catalog/sessions/route";

/**
 * W917 RIGHTS CENTER TESTS — the rights/publication backend battery: policy
 * inspection authorization (each caller sees EXACTLY their scope), policy
 * editing (contract-schema validated; malformed is never applied), the
 * visibility kinds, REVOCATION end-to-end (publish → revoke → playback AND
 * publication stopped, at every layer), the fail-closed re-derivation over
 * time (a policy that expires denies later with no new write), the
 * narrow-only property (an edit can never widen past the creation-time
 * attestation), the append-only audit record and the no-existence-oracle
 * denial. Everything runs over the REAL composition (decorated control
 * plane, real gate, real stores) with a pinned, advanceable clock.
 */

const NOW_MS = 1_788_888_888_000;
let clock = NOW_MS;

let server: SportaServer;

/** The seeded derby session (public, playback-authorized, has stored bytes). */
let derbyId = "";
let derbyAnimeRenderId = "";
let derbySegmentId = "";
/** The seed account (owns + attested the seeded content). */
let seedToken = "";

/** Test accounts + tokens. */
let viewerToken = "";
let creatorToken = "";
let creatorUserId = "";
let rightsHolderToken = "";
let rightsHolderUserId = "";
let operatorToken = "";

/** Gate-created test sessions. */
let creatorSessionId = ""; // owned by the creator (derby-authorized policy)
let attestedSessionId = ""; // owned by the creator, rights ATTETSTED by the rights holder

function withCookie(path: string, token: string): Request {
  return new Request(`http://sporta.test${path}`, {
    headers: { cookie: `${SPORTA_SESSION_COOKIE}=${token}` },
  });
}

function jsonRequest(path: string): Request {
  return new Request(`http://sporta.test${path}`);
}

function patchRequest(path: string, token: string, body: unknown): Request {
  return new Request(`http://sporta.test${path}`, {
    method: "PATCH",
    headers: { cookie: `${SPORTA_SESSION_COOKIE}=${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function postRequest(path: string, token: string, body?: unknown): Request {
  return new Request(`http://sporta.test${path}`, {
    method: "POST",
    headers: { cookie: `${SPORTA_SESSION_COOKIE}=${token}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
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

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function createOwnedSession(token: string, label: string): Promise<string> {
  const created = (await server.gate.createMediaSession(token, {
    authorizationPolicy: SEED_POLICIES.derby,
    sourceLabel: label,
  })) as { session: { sessionId: string } };
  return created.session.sessionId;
}

async function watch(sessionId: string, request?: Request): Promise<Response> {
  return watchRoute(request ?? jsonRequest(`/api/watch/${sessionId}`), {
    params: Promise.resolve({ sessionId }),
  });
}

beforeAll(async () => {
  server = createSportaServer({
    nowMs: () => clock,
    passwordHasher: createDeterministicTestHasher(),
    seed: true,
  });
  installSportaServerForTests(server);
  await server.ready;

  // The seeded derby session + its stored anime output (real bytes to stop).
  for (const summary of (await server.control.listSessions()).sessions) {
    if (server.storyIndex.get(summary.id)?.storyKey === "derby") derbyId = summary.id;
  }
  const { renders } = await server.control.listRenders(derbyId);
  const animeRender = renders.find((render) => render.rendererId === "anime.prototype")!;
  derbyAnimeRenderId = animeRender.renderId;
  const outputs = await server.control.listRenderOutputs(derbyId, derbyAnimeRenderId);
  derbySegmentId = outputs.segments[0]!.segmentId;

  // A token for the seed account (it owns + attested the seeded sessions).
  const seedAccount = await server.accounts.findByUsername("sporta-dev-seed");
  const seedSession = await server.auth.issueSession({ userId: seedAccount!.userId });
  seedToken = seedSession.token;

  const viewer = await createAccount("w917-viewer", ["viewer"]);
  viewerToken = viewer.token;
  const creator = await createAccount("w917-creator", ["creator", "viewer"]);
  creatorToken = creator.token;
  creatorUserId = creator.userId;
  const rightsHolder = await createAccount("w917-rights-holder", ["rights-holder", "viewer"]);
  rightsHolderToken = rightsHolder.token;
  rightsHolderUserId = rightsHolder.userId;
  const operator = await createAccount("w917-operator", ["operator", "viewer"]);
  operatorToken = operator.token;

  creatorSessionId = await createOwnedSession(creatorToken, "W917 creator session");
  // The rights-holder POLICY SCOPE: the creator owns it, the rights holder
  // attested its rights (the W916 recording-path pattern).
  attestedSessionId = await createOwnedSession(creatorToken, "W917 attested session");
  server.attestations.record(attestedSessionId, rightsHolderUserId);
});

// ---------------------------------------------------------------------------
// Policy inspection — each caller sees EXACTLY their scope
// ---------------------------------------------------------------------------

describe("policy inspection authorization (the scoped list)", () => {
  test("anonymous callers get the real 401 (the route)", async () => {
    const response = await listPoliciesRoute(jsonRequest("/api/rights/policies"));
    expect(response.status).toBe(401);
    const body = await bodyOf(response);
    expect(body.error?.failureClass).toBe("unauthenticated");
  });

  test("a viewer with no owned/attested content sees the honest empty scope", async () => {
    const response = await listPoliciesRoute(withCookie("/api/rights/policies", viewerToken));
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    expect(body.entries).toEqual([]);
    expect((body.viewer as Record<string, unknown>).userId).toBeTruthy();
  });

  test("the creator sees exactly their OWN sessions — nobody else's policies leak", async () => {
    const response = await listPoliciesRoute(withCookie("/api/rights/policies", creatorToken));
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    const entries = body.entries as Record<string, string>[];
    const ids = entries.map((entry) => entry.sessionId);
    expect(ids).toContain(creatorSessionId);
    expect(ids).toContain(attestedSessionId);
    expect(ids).not.toContain(derbyId); // the seed account's content
    expect(
      entries.filter((entry) => entry.access === "owned").map((entry) => entry.sessionId),
    ).toEqual([creatorSessionId, attestedSessionId]);
    // The attested session is in the CREATOR's scope via ownership, not via
    // the rights-holder attestation.
    expect(entries.find((entry) => entry.sessionId === attestedSessionId)?.access).toBe("owned");
  });

  test("the rights holder sees their attested scope (content they do not own)", async () => {
    const response = await listPoliciesRoute(
      withCookie("/api/rights/policies", rightsHolderToken),
    );
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    const entries = body.entries as Record<string, string>[];
    const ids = entries.map((entry) => entry.sessionId);
    expect(ids).toEqual([attestedSessionId]);
    expect(entries[0]?.access).toBe("attested");
  });

  test("the operator sees the full operational view", async () => {
    const response = await listPoliciesRoute(withCookie("/api/rights/policies", operatorToken));
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    const ids = (body.entries as Record<string, string>[]).map((entry) => entry.sessionId);
    expect(ids).toContain(derbyId);
    expect(ids).toContain(creatorSessionId);
    expect(ids).toContain(attestedSessionId);
  });

  test("an entry carries the REAL policy record + derived capabilities + visibility", async () => {
    const response = await listPoliciesRoute(withCookie("/api/rights/policies", creatorToken));
    const body = await bodyOf(response);
    const entry = (body.entries as Record<string, unknown>[]).find(
      (candidate) => candidate.sessionId === creatorSessionId,
    )!;
    expect(entry.effectiveSource).toBe("creation");
    expect(entry.revoked).toBe(false);
    expect(entry.visibility).toMatchObject({ kind: "public" });
    const policy = entry.policy as Record<string, unknown>;
    // The gate re-attested the declaration with the VERIFIED creator id.
    expect(policy.assertedBy).toBe(creatorUserId);
    expect(policy.allowedOperations).toContain("derivativeGeneration");
    expect(policy.allowedOperations).toContain("storage");
    const caps = entry.rightsCapabilities as Record<string, boolean>;
    expect(caps.canStoreDerivatives).toBe(true);
    expect(caps.canDeliverLive).toBe(true);
    expect(entry.lastChange).toBeNull(); // never changed yet
  });
});

describe("policy inspection authorization (one session)", () => {
  test("the owner inspects their session", async () => {
    const response = await inspectRoute(
      withCookie(`/api/rights/policies/${creatorSessionId}`, creatorToken),
      { params: Promise.resolve({ sessionId: creatorSessionId }) },
    );
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    expect((body.entry as Record<string, unknown>).sessionId).toBe(creatorSessionId);
    expect(Array.isArray(body.audit)).toBe(true);
  });

  test("the attesting rights holder inspects the session they control", async () => {
    const response = await inspectRoute(
      withCookie(`/api/rights/policies/${attestedSessionId}`, rightsHolderToken),
      { params: Promise.resolve({ sessionId: attestedSessionId }) },
    );
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    expect((body.entry as Record<string, unknown>).access).toBe("attested");
  });

  test("anonymous → 401", async () => {
    const response = await inspectRoute(
      jsonRequest(`/api/rights/policies/${creatorSessionId}`),
      { params: Promise.resolve({ sessionId: creatorSessionId }) },
    );
    expect(response.status).toBe(401);
  });

  test("a non-owner gets the UNIFORM 403 — no existence oracle (byte-identical bodies)", async () => {
    const existsResponse = await inspectRoute(
      withCookie(`/api/rights/policies/${creatorSessionId}`, viewerToken),
      { params: Promise.resolve({ sessionId: creatorSessionId }) },
    );
    const missingResponse = await inspectRoute(
      withCookie("/api/rights/policies/sess-does-not-exist", viewerToken),
      { params: Promise.resolve({ sessionId: "sess-does-not-exist" }) },
    );
    expect(existsResponse.status).toBe(403);
    expect(missingResponse.status).toBe(403);
    expect(await existsResponse.text()).toBe(await missingResponse.text());
  });

  test("a rights holder WITHOUT an attestation for the session is uniformly denied", async () => {
    const response = await inspectRoute(
      withCookie(`/api/rights/policies/${derbyId}`, rightsHolderToken),
      { params: Promise.resolve({ sessionId: derbyId }) },
    );
    expect(response.status).toBe(403);
  });

  test("the operator inspects any session (the operational view)", async () => {
    const response = await inspectRoute(
      withCookie(`/api/rights/policies/${creatorSessionId}`, operatorToken),
      { params: Promise.resolve({ sessionId: creatorSessionId }) },
    );
    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Policy editing — contract-schema validated, re-attested, effective
// ---------------------------------------------------------------------------

describe("policy editing", () => {
  test("the owner edits the policy: narrowed, re-attested, effective everywhere", async () => {
    const response = await patchPolicyRoute(
      patchRequest(`/api/rights/policies/${creatorSessionId}`, creatorToken, {
        authorizationPolicy: {
          policyId: "policy-w917-edited",
          allowedOperations: [
            "analysis",
            "transformation",
            "derivativeGeneration",
            "storage",
          ],
          assertedBy: "should-be-ignored",
          sharingScope: "private",
        },
      }),
      { params: Promise.resolve({ sessionId: creatorSessionId }) },
    );
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    const entry = body.entry as Record<string, unknown>;
    expect(entry.effectiveSource).toBe("edited");
    const policy = entry.policy as Record<string, unknown>;
    // Re-attested with the VERIFIED editor — never the caller's claim.
    expect(policy.assertedBy).toBe(creatorUserId);
    expect(policy.allowedOperations).not.toContain("sharing");
    expect(policy.sharingScope).toBe("private");
    const caps = entry.rightsCapabilities as Record<string, boolean>;
    expect(caps.canShare).toBe(false);
    expect(caps.canDeliverLive).toBe(false);
    expect(caps.canStoreDerivatives).toBe(true);
    // The rights-governed control plane re-derives per read.
    const governed = await server.control.getSession(creatorSessionId);
    expect(governed.rightsCapabilities.canShare).toBe(false);
    expect(governed.rightsCapabilities.canStoreDerivatives).toBe(true);
    // Playback is still authorized (storage kept) — the honest narrowed state.
    const watchResponse = await watch(creatorSessionId);
    expect(watchResponse.status).toBe(200);
    expect(((await bodyOf(watchResponse)).playback as Record<string, string>).state).toBe(
      "authorized",
    );
  });

  test("malformed policies are 400s and are NEVER applied", async () => {
    const before = await server.control.getSession(creatorSessionId);
    const malformed: unknown[] = [
      { policyId: "x", allowedOperations: ["teleportation"], assertedBy: "a" }, // unknown op
      { policyId: "x", allowedOperations: [], assertedBy: "a" }, // empty (min 1)
      { allowedOperations: ["analysis"], assertedBy: "a" }, // missing policyId
      "not-an-object",
      null,
    ];
    for (const candidate of malformed) {
      const response = await patchPolicyRoute(
        patchRequest(`/api/rights/policies/${creatorSessionId}`, creatorToken, {
          authorizationPolicy: candidate,
        }),
        { params: Promise.resolve({ sessionId: creatorSessionId }) },
      );
      expect(response.status).toBe(400);
    }
    // The 400 body is the classified validation error.
    const first = await patchPolicyRoute(
      patchRequest(`/api/rights/policies/${creatorSessionId}`, creatorToken, {
        authorizationPolicy: { policyId: "x", allowedOperations: ["teleportation"], assertedBy: "a" },
      }),
      { params: Promise.resolve({ sessionId: creatorSessionId }) },
    );
    expect((await bodyOf(first)).error?.failureClass).toBe("validation");
    // Nothing was applied: the effective policy is the previous edit.
    const after = await server.control.getSession(creatorSessionId);
    expect(after.rightsCapabilities).toEqual(before.rightsCapabilities);
    const entry = await server.rights.inspectPolicy(creatorToken, creatorSessionId);
    expect(entry.entry.policy?.policyId).toBe("policy-w917-edited");
  });

  test("an already-expired edit is rejected — revocation is the coherent action", async () => {
    const response = await patchPolicyRoute(
      patchRequest(`/api/rights/policies/${creatorSessionId}`, creatorToken, {
        authorizationPolicy: {
          policyId: "policy-w917-edited",
          allowedOperations: ["analysis"],
          assertedBy: creatorUserId,
          expiresAtIso: new Date(clock - 1).toISOString(),
        },
      }),
      { params: Promise.resolve({ sessionId: creatorSessionId }) },
    );
    expect(response.status).toBe(400);
    expect(((await bodyOf(response)).error as Record<string, string>).failureClass).toBe(
      "validation",
    );
  });

  test("a wrong-shaped body is a 400", async () => {
    const response = await patchPolicyRoute(
      patchRequest(`/api/rights/policies/${creatorSessionId}`, creatorToken, {
        nope: true,
      }),
      { params: Promise.resolve({ sessionId: creatorSessionId }) },
    );
    expect(response.status).toBe(400);
  });

  test("a non-owner cannot edit (uniform 403, exists or not)", async () => {
    const exists = await patchPolicyRoute(
      patchRequest(`/api/rights/policies/${creatorSessionId}`, viewerToken, {
        authorizationPolicy: SEED_POLICIES.derby,
      }),
      { params: Promise.resolve({ sessionId: creatorSessionId }) },
    );
    const missing = await patchPolicyRoute(
      patchRequest("/api/rights/policies/sess-does-not-exist", viewerToken, {
        authorizationPolicy: SEED_POLICIES.derby,
      }),
      { params: Promise.resolve({ sessionId: "sess-does-not-exist" }) },
    );
    expect(exists.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(await exists.text()).toBe(await missing.text());
  });

  test("the attesting rights holder CAN edit the session they control", async () => {
    const response = await patchPolicyRoute(
      patchRequest(`/api/rights/policies/${attestedSessionId}`, rightsHolderToken, {
        authorizationPolicy: {
          policyId: "policy-w917-attested-edit",
          allowedOperations: ["analysis", "transformation", "derivativeGeneration", "storage"],
          assertedBy: rightsHolderUserId,
        },
      }),
      { params: Promise.resolve({ sessionId: attestedSessionId }) },
    );
    expect(response.status).toBe(200);
    const entry = ((await bodyOf(response)).entry as Record<string, unknown>);
    expect((entry.policy as Record<string, unknown>).assertedBy).toBe(rightsHolderUserId);
  });
});

// ---------------------------------------------------------------------------
// Visibility editing (the W916 kinds, through the W917 surface)
// ---------------------------------------------------------------------------

describe("visibility editing", () => {
  test("unlisted: absent from listings, watchable by link (the link is the capability)", async () => {
    const response = await patchVisibilityRoute(
      patchRequest(`/api/rights/policies/${creatorSessionId}/visibility`, creatorToken, {
        visibility: "unlisted",
      }),
      { params: Promise.resolve({ sessionId: creatorSessionId }) },
    );
    expect(response.status).toBe(200);
    expect(
      ((await bodyOf(response)).entry as Record<string, unknown>).visibility,
    ).toMatchObject({ kind: "unlisted" });
    const listing = await buildCatalogFor(server, ANONYMOUS_REQUESTER);
    expect(
      listing.sessions.some((card) => card.sessionId === creatorSessionId),
    ).toBe(false);
    const watchResponse = await watch(creatorSessionId);
    expect(watchResponse.status).toBe(200);
    expect(((await bodyOf(watchResponse)).playback as Record<string, string>).state).toBe(
      "authorized",
    );
  });

  test("role-scoped: only the named grants discover it (server-side grants, never activeRole)", async () => {
    const response = await patchVisibilityRoute(
      patchRequest(`/api/rights/policies/${creatorSessionId}/visibility`, creatorToken, {
        visibility: { kind: "role-scoped", roles: ["analyst"] },
      }),
      { params: Promise.resolve({ sessionId: creatorSessionId }) },
    );
    expect(response.status).toBe(200);
    const listing = await buildCatalogFor(server, ANONYMOUS_REQUESTER);
    expect(listing.sessions.some((card) => card.sessionId === creatorSessionId)).toBe(false);
    const viewerListing = await buildCatalogFor(server, {
      state: "authenticated",
      userId: "w917-viewer-id",
      grants: ["viewer"],
    });
    expect(
      viewerListing.sessions.some((card) => card.sessionId === creatorSessionId),
    ).toBe(false);
    const analystListing = await buildCatalogFor(server, {
      state: "authenticated",
      userId: "w917-analyst-id",
      grants: ["analyst"],
    });
    expect(analystListing.sessions.some((card) => card.sessionId === creatorSessionId)).toBe(true);
  });

  test("invalid visibility edits are 400s and never stored", async () => {
    const bad: unknown[] = [
      "friends-only",
      "role-scoped",
      { kind: "role-scoped", roles: [] },
      { kind: "role-scoped", roles: ["superuser"] },
      { kind: "public", other: true } as never,
      42,
    ];
    for (const candidate of bad) {
      const response = await patchVisibilityRoute(
        patchRequest(`/api/rights/policies/${creatorSessionId}/visibility`, creatorToken, {
          visibility: candidate,
        }),
        { params: Promise.resolve({ sessionId: creatorSessionId }) },
      );
      expect(response.status).toBe(400);
    }
    // The last stored decision is still the valid role-scoped one.
    expect(server.publication.contentOf(creatorSessionId)?.kind).toBe("role-scoped");
  });

  test("public again: back in the anonymous catalog", async () => {
    const response = await patchVisibilityRoute(
      patchRequest(`/api/rights/policies/${creatorSessionId}/visibility`, creatorToken, {
        visibility: "public",
      }),
      { params: Promise.resolve({ sessionId: creatorSessionId }) },
    );
    expect(response.status).toBe(200);
    const listing = await buildCatalogFor(server, ANONYMOUS_REQUESTER);
    expect(listing.sessions.some((card) => card.sessionId === creatorSessionId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// REVOCATION end-to-end — the core acceptance
// ---------------------------------------------------------------------------

describe("revocation: publish → revoke → playback AND publication stop", () => {
  // The seeded derby session is public, playback-authorized and has REAL
  // stored bytes; its owner (the seed account) revokes it.
  test("BEFORE: the published state serves everyone", async () => {
    const anonymousWatch = await watch(derbyId);
    expect(anonymousWatch.status).toBe(200);
    expect(((await bodyOf(anonymousWatch)).playback as Record<string, string>).state).toBe(
      "authorized",
    );
    const listing = await buildCatalogFor(server, ANONYMOUS_REQUESTER);
    expect(listing.sessions.some((card) => card.sessionId === derbyId)).toBe(true);
    const segment = await segmentRoute(
      jsonRequest(`/api/watch/${derbyId}/renders/${derbyAnimeRenderId}/outputs/${derbySegmentId}`),
      {
        params: Promise.resolve({
          sessionId: derbyId,
          renderId: derbyAnimeRenderId,
          segmentId: derbySegmentId,
        }),
      },
    );
    expect(segment.status).toBe(200);
  });

  let revokedEntry: Record<string, unknown>;

  test("the owner revokes: both stops recorded, one audit entry", async () => {
    const response = await revokeRoute(
      postRequest(`/api/rights/policies/${derbyId}/revocation`, seedToken, {
        reason: "W917 acceptance test revocation",
      }),
      { params: Promise.resolve({ sessionId: derbyId }) },
    );
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    revokedEntry = body.entry as Record<string, unknown>;
    expect(revokedEntry.revoked).toBe(true);
    expect(revokedEntry.effectiveSource).toBe("edited");
    const policy = revokedEntry.policy as Record<string, unknown>;
    expect(typeof policy.expiresAtIso).toBe("string");
    expect(Date.parse(policy.expiresAtIso as string)).toBeLessThanOrEqual(clock);
    expect((revokedEntry.visibility as Record<string, unknown>).kind).toBe("private");
    // The audit recorded BOTH effects with who/what/when.
    const audit = server.rightsAudit.of(derbyId);
    expect(audit.length).toBe(1);
    expect(audit[0]!.changeKind).toBe("revocation");
    expect(audit[0]!.actorUserId).toBe((await server.accounts.findByUsername("sporta-dev-seed"))!.userId);
    const to = audit[0]!.to as Record<string, Record<string, unknown>>;
    expect((to.policy as Record<string, unknown>).expiresAtIso).toBeTruthy();
    expect((to.visibility as Record<string, unknown>).kind).toBe("private");
    expect(audit[0]!.summary).toContain("revoked");
    expect(audit[0]!.summary).toContain("W917 acceptance test revocation");
  });

  test("anonymous watch → 404 (the uniform unknown-session answer)", async () => {
    const response = await watch(derbyId);
    expect(response.status).toBe(404);
    expect(((await bodyOf(response)).error as Record<string, string>).failureClass).toBe(
      "unknown-session",
    );
  });

  test("the catalog drops it from discovery (and search never finds it)", async () => {
    const listing = await buildCatalogFor(server, ANONYMOUS_REQUESTER);
    expect(listing.sessions.some((card) => card.sessionId === derbyId)).toBe(false);
    const search = await searchCatalog(
      server,
      ANONYMOUS_REQUESTER,
      parseSearchQuery(new URLSearchParams({ q: "derby" })),
    );
    expect(search.matches.some((match) => match.sessionId === derbyId)).toBe(false);
    const catalogResponse = await catalogRoute();
    const catalogBody = await bodyOf(catalogResponse);
    expect(
      (catalogBody.sessions as Record<string, string>[]).some(
        (card) => card.sessionId === derbyId,
      ),
    ).toBe(false);
  });

  test("a non-owner BEARER token is denied too (the same uniform 404)", async () => {
    const response = await watch(derbyId, withCookie(`/api/watch/${derbyId}`, viewerToken));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe(
      await watch(derbyId, withCookie("/api/watch/sess-does-not-exist", viewerToken)).then((r) =>
        r.text(),
      ),
    );
  });

  test("the OWNER's watch model is the honest revoked state (denied, no render existence)", async () => {
    const response = await watch(derbyId, withCookie(`/api/watch/${derbyId}`, seedToken));
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    expect((body.playback as Record<string, string>).state).toBe("denied");
    expect((body.playback as Record<string, string>).reasonCode).toBe("rights-denied");
    expect(body.renders).toBeNull();
    expect(body.eventTail).toBeNull();
  });

  test("the BYTES stop even for the owner: the segment route answers 403", async () => {
    const response = await segmentRoute(
      withCookie(
        `/api/watch/${derbyId}/renders/${derbyAnimeRenderId}/outputs/${derbySegmentId}`,
        seedToken,
      ),
      {
        params: Promise.resolve({
          sessionId: derbyId,
          renderId: derbyAnimeRenderId,
          segmentId: derbySegmentId,
        }),
      },
    );
    expect(response.status).toBe(403);
    expect(((await bodyOf(response)).error as Record<string, string>).failureClass).toBe(
      "rights-denied",
    );
  });

  test("the control plane itself denies the bytes and new renders (typed errors)", async () => {
    expect(server.control.getRenderOutput(derbyId, derbyAnimeRenderId, derbySegmentId)).rejects.toBeInstanceOf(
      ControlRightsDeniedError,
    );
    expect(server.control.listRenderOutputs(derbyId, derbyAnimeRenderId)).rejects.toBeInstanceOf(
      ControlRightsDeniedError,
    );
    expect(
      server.control.createRender(derbyId, { rendererId: "sporta.testcard" }),
    ).rejects.toBeInstanceOf(ControlRightsDeniedError);
  });

  test("the owner's catalog card is the honest denied state", async () => {
    const seedUserId = (await server.accounts.findByUsername("sporta-dev-seed"))!.userId;
    const listing = await buildCatalogFor(server, {
      state: "authenticated",
      userId: seedUserId,
      grants: ["creator", "viewer"],
    });
    const card = listing.sessions.find((candidate) => candidate.sessionId === derbyId);
    expect(card).toBeDefined();
    expect(card!.playback.state).toBe("denied");
    expect(card!.renders).toBeNull();
  });

  test("a second revocation never pushes the out-of-force instant later", async () => {
    const firstExpiry = Date.parse(
      (revokedEntry.policy as Record<string, unknown>).expiresAtIso as string,
    );
    clock += 60_000;
    const response = await revokeRoute(
      postRequest(`/api/rights/policies/${derbyId}/revocation`, seedToken),
      { params: Promise.resolve({ sessionId: derbyId }) },
    );
    expect(response.status).toBe(200);
    const policy = ((await bodyOf(response)).entry as Record<string, unknown>)
      .policy as Record<string, unknown>;
    expect(Date.parse(policy.expiresAtIso as string)).toBe(firstExpiry);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed re-derivation over time + narrow-only
// ---------------------------------------------------------------------------

describe("fail-closed re-derivation (a policy that expires denies later)", () => {
  test("no new write is needed: the same read denies after the expiry passes", async () => {
    // A fresh, owned, playback-authorized session.
    const sessionId = await createOwnedSession(creatorToken, "W917 expiry session");
    const before = await server.control.getSession(sessionId);
    expect(before.rightsCapabilities.canStoreDerivatives).toBe(true);
    // Edit to a policy in force for 1 hour.
    const response = await patchPolicyRoute(
      patchRequest(`/api/rights/policies/${sessionId}`, creatorToken, {
        authorizationPolicy: {
          policyId: "policy-w917-expiring",
          allowedOperations: [
            "analysis",
            "transformation",
            "derivativeGeneration",
            "storage",
            "sharing",
          ],
          assertedBy: creatorUserId,
          expiresAtIso: new Date(clock + 3_600_000).toISOString(),
        },
      }),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(response.status).toBe(200);
    expect(
      ((await bodyOf(response)).entry as Record<string, unknown>).revoked,
    ).toBe(false);
    const inForce = await server.control.getSession(sessionId);
    expect(inForce.rightsCapabilities.canStoreDerivatives).toBe(true);
    // Advance the clock past the expiry — the SAME read now denies.
    clock += 3_600_001;
    const expired = await server.control.getSession(sessionId);
    expect(expired.rightsCapabilities.canStoreDerivatives).toBe(false);
    expect(expired.rightsCapabilities.canShare).toBe(false);
    const watchResponse = await watch(
      sessionId,
      withCookie(`/api/watch/${sessionId}`, creatorToken),
    );
    const body = await bodyOf(watchResponse);
    expect((body.playback as Record<string, string>).state).toBe("denied");
    // ... and it honestly reports as revoked in the center.
    const inspect = await server.rights.inspectPolicy(creatorToken, sessionId);
    expect(inspect.entry.revoked).toBe(true);
  });
});

describe("narrow-only: an edit can never widen past the creation-time attestation", () => {
  test("widening the training story's storage is capped (the intersection denies)", async () => {
    // Find the seeded training session: its creation policy deliberately
    // denies derivative STORAGE (the honest W905 reality).
    let trainingId = "";
    for (const summary of (await server.control.listSessions()).sessions) {
      if (server.storyIndex.get(summary.id)?.storyKey === "training") trainingId = summary.id;
    }
    const before = await server.control.getSession(trainingId);
    expect(before.rightsCapabilities.canStoreDerivatives).toBe(false);
    // A rights holder EDITS the policy to "grant" storage + sharing.
    const edit = await patchPolicyRoute(
      patchRequest(`/api/rights/policies/${trainingId}`, seedToken, {
        authorizationPolicy: {
          policyId: "policy-w917-widening-attempt",
          allowedOperations: [
            "analysis",
            "transformation",
            "derivativeGeneration",
            "storage",
            "sharing",
          ],
          assertedBy: "ignored",
        },
      }),
      { params: Promise.resolve({ sessionId: trainingId }) },
    );
    expect(edit.status).toBe(200); // the edit is stored...
    // ...but the EFFECTIVE capabilities stay capped: the intersection with
    // the creation-time attestation denies what was never attested.
    const after = await server.control.getSession(trainingId);
    expect(after.rightsCapabilities.canStoreDerivatives).toBe(false);
    expect(after.rightsCapabilities.canShare).toBe(false);
    expect(
      server.control.listRenders(trainingId),
    ).rejects.toBeInstanceOf(ControlRightsDeniedError);
  });
});

// ---------------------------------------------------------------------------
// The audit trail
// ---------------------------------------------------------------------------

describe("the append-only policy-change record", () => {
  test("every change kind is recorded with who/what/when", async () => {
    const trail = await server.rights.auditTrail(creatorToken);
    const kinds = (trail.entries as { changeKind: string }[]).map(
      (entry) => entry.changeKind,
    );
    expect(kinds).toContain("policy");
    expect(kinds).toContain("visibility");
    for (const entry of trail.entries) {
      expect(typeof entry.atIso).toBe("string");
      // The actor is the VERIFIED editor: the creator on their own sessions,
      // the rights holder on the session they control (which the creator
      // owns — both are legitimately in this trail's scope).
      expect([creatorUserId, rightsHolderUserId]).toContain(entry.actorUserId);
      expect(entry.sessionId).toBeTruthy();
      expect(entry.summary.length).toBeGreaterThan(0);
    }
    const own = trail.entries.filter((entry) => entry.sessionId === creatorSessionId);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((entry) => entry.actorUserId === creatorUserId)).toBe(true);
  });

  test("the trail is SCOPED: no other users' entries leak", async () => {
    const viewerTrail = await server.rights.auditTrail(viewerToken);
    expect(viewerTrail.entries).toEqual([]);
    const rightsHolderTrail = await server.rights.auditTrail(rightsHolderToken);
    for (const entry of rightsHolderTrail.entries) {
      expect(entry.sessionId).toBe(attestedSessionId); // only their scope
    }
    // The creator's trail never contains the seed account's revocation.
    const creatorTrail = await server.rights.auditTrail(creatorToken);
    expect(
      creatorTrail.entries.some((entry) => entry.sessionId === derbyId),
    ).toBe(false);
  });

  test("the operator sees the full trail", async () => {
    const trail = await server.rights.auditTrail(operatorToken);
    expect(
      trail.entries.some((entry) => entry.sessionId === derbyId && entry.changeKind === "revocation"),
    ).toBe(true);
  });

  test("records are append-only: prior entries are never rewritten", async () => {
    const before = server.rightsAudit.of(attestedSessionId).length;
    await server.rights.setVisibility(creatorToken, attestedSessionId, "private");
    const after = server.rightsAudit.of(attestedSessionId);
    expect(after.length).toBe(before + 1); // grew, nothing replaced
    expect(after[0]!.changeKind).toBe("policy"); // the oldest entry is intact
  });
});

// ---------------------------------------------------------------------------
// Decorator transparency (sessions without edits behave exactly as before)
// ---------------------------------------------------------------------------

describe("transparency: sessions without rights-holder edits are untouched", () => {
  test("the seeded friendly session serves the W904-era behavior", async () => {
    let friendlyId = "";
    for (const summary of (await server.control.listSessions()).sessions) {
      if (server.storyIndex.get(summary.id)?.storyKey === "friendly") friendlyId = summary.id;
    }
    const response = await watch(friendlyId);
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    expect((body.playback as Record<string, string>).state).toBe("authorized");
    expect((body.renders as unknown[]).length).toBeGreaterThan(0);
    const entry = await server.rights.inspectPolicy(seedToken, friendlyId);
    expect(entry.entry.effectiveSource).toBe("creation");
    expect(entry.entry.policy?.allowedOperations).toContain("storage");
  });
});
