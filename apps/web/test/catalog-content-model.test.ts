import { beforeAll, describe, expect, test } from "bun:test";
import { createDeterministicTestHasher } from "@sporta/identity";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { SPORTA_SESSION_COOKIE } from "../src/server/auth-service";
import {
  ANONYMOUS_REQUESTER,
  buildCatalogFor,
  buildRealityGroups,
  parseSearchQuery,
  searchCatalog,
  sessionDiscoverableBy,
  resolveCatalogRequester,
  type CatalogRequester,
} from "../src/server/catalog-service";
import {
  parseContentVisibility,
  PublicationStore,
  type ContentVisibilityRecord,
} from "../src/server/publication";
import { SEED_POLICIES } from "../src/server/dev-story";
import { GET as catalogRoute } from "../src/app/api/catalog/sessions/route";
import { GET as realitiesRoute } from "../src/app/api/catalog/realities/route";
import { GET as searchRoute } from "../src/app/api/catalog/search/route";
import { GET as watchRoute } from "../src/app/api/watch/[sessionId]/route";

/**
 * CATALOG CONTENT MODEL TESTS (W916): the four-kind visibility model, the
 * requester-scoped discoverability (anonymous / authenticated / rights
 * holder / operator), the reality linkage (same match session → per-renderer
 * reality groups), the search backend, the no-existence-oracle property and
 * the fail-closed unknown-visibility rule — all driven over the REAL dev
 * seed + REAL gate-created sessions with a pinned clock and the
 * deterministic test hasher. Nothing is mocked.
 */

const NOW_MS = 1_777_777_777_000;
let server: SportaServer;

/** The seeded session ids by story key. */
let derbyId = "";
let friendlyId = "";
let trainingId = "";
/** L005: the live tactical scaffold's seeded session id. */
const tacticalSessionIds: string[] = [];

/** Test accounts + tokens (created through the real store, like provisioning). */
let viewerToken = "";
let creatorToken = "";
let creatorUserId = "";
let rightsHolderToken = "";
let operatorToken = "";

/** Gate-created test sessions (owner: the creator), one per visibility kind. */
let privateSessionId = "";
let unlistedSessionId = "";
let roleScopedSessionId = "";
let unknownSessionId = "";

function requester(userId: string | null, grants: string[]): CatalogRequester {
  return {
    state: userId === null ? "anonymous" : "authenticated",
    userId,
    grants: grants as CatalogRequester["grants"],
  };
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

/** Creates one real gate session owned by the creator (derby = playback-authorized). */
async function createOwnedSession(label: string): Promise<string> {
  const created = (await server.gate.createMediaSession(creatorToken, {
    authorizationPolicy: SEED_POLICIES.derby,
    sourceLabel: label,
  })) as { session: { sessionId: string } };
  return created.session.sessionId;
}

function withCookie(path: string, token: string): Request {
  return new Request(`http://sporta.test${path}`, {
    headers: { cookie: `${SPORTA_SESSION_COOKIE}=${token}` },
  });
}

function jsonRequest(path: string): Request {
  return new Request(`http://sporta.test${path}`);
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeAll(async () => {
  server = createSportaServer({
    nowMs: () => NOW_MS,
    passwordHasher: createDeterministicTestHasher(),
    seed: true,
  });
  installSportaServerForTests(server);
  await server.ready;

  for (const summary of (await server.control.listSessions()).sessions) {
    const story = server.storyIndex.get(summary.id);
    if (story?.storyKey === "derby") derbyId = summary.id;
    if (story?.storyKey === "friendly") friendlyId = summary.id;
    if (story?.storyKey === "training") trainingId = summary.id;
    if (story?.storyKey === "live-tactical-synthetic") {
      tacticalSessionIds.push(summary.id);
    }
  }

  const viewer = await createAccount("w916-viewer", ["viewer"]);
  viewerToken = viewer.token;
  const creator = await createAccount("w916-creator", ["creator", "viewer"]);
  creatorToken = creator.token;
  creatorUserId = creator.userId;
  const rightsHolder = await createAccount("w916-rights-holder", ["rights-holder", "viewer"]);
  rightsHolderToken = rightsHolder.token;
  const operator = await createAccount("w916-operator", ["operator", "viewer"]);
  operatorToken = operator.token;

  // One real session per visibility kind, all owned by the creator.
  privateSessionId = await createOwnedSession("W916 private preview");
  server.publication.set(privateSessionId, "private");
  unlistedSessionId = await createOwnedSession("W916 unlisted link");
  server.publication.set(unlistedSessionId, { kind: "unlisted" });
  roleScopedSessionId = await createOwnedSession("W916 rights-holder briefing");
  server.publication.set(roleScopedSessionId, { kind: "role-scoped", roles: ["rights-holder"] });
  unknownSessionId = await createOwnedSession("W916 broken flag");
  // A version-skewed producer's garbage — the store's own test seam injects
  // it unvalidated so the fail-closed READ path can be proven.
  server.publication.setUnvalidatedForTests(unknownSessionId, { kind: "friends-only" });
});

// ---------------------------------------------------------------------------
// The content-model store (fail-closed parsing + W906 compatibility)
// ---------------------------------------------------------------------------

describe("the content visibility store", () => {
  test("parses every valid decision (legacy strings + full records)", () => {
    expect(parseContentVisibility("public")).toEqual({
      kind: "public",
      roles: [],
      setBy: null,
      setAtIso: null,
    });
    expect(parseContentVisibility("private")?.kind).toBe("private");
    expect(parseContentVisibility({ kind: "unlisted" })?.kind).toBe("unlisted");
    const scoped = parseContentVisibility({
      kind: "role-scoped",
      roles: ["rights-holder", "operator"],
    });
    expect(scoped?.kind).toBe("role-scoped");
    expect(scoped?.roles).toEqual(["rights-holder", "operator"]);
  });

  test("fail-closed: garbage, unknown kinds and bad scopes parse to null", () => {
    expect(parseContentVisibility(42)).toBeNull();
    expect(parseContentVisibility("friends-only")).toBeNull();
    expect(parseContentVisibility(null)).toBeNull();
    expect(parseContentVisibility({})).toBeNull();
    expect(parseContentVisibility({ kind: "role-scoped", roles: [] })).toBeNull();
    expect(parseContentVisibility({ kind: "role-scoped", roles: ["superuser"] })).toBeNull();
    expect(
      parseContentVisibility({ kind: "public", roles: "nope" as unknown as string[] })?.roles,
    ).toEqual([]);
  });

  test("set REFUSES invalid decisions loudly (never stores an undefined visibility)", () => {
    const store = new PublicationStore();
    expect(() => store.set("s", "friends-only" as never)).toThrow();
    expect(() => store.set("s", { kind: "role-scoped" })).toThrow();
    expect(() => store.set("s", { kind: "role-scoped", roles: ["superuser"] as never })).toThrow();
    // Nothing invalid was stored: the store stays usable and honest.
    store.set("s", "private");
    expect(store.visibilityOf("s")).toBe("private");
  });

  test("W906 compatibility: legacy strings + the public default keep working", () => {
    const store = new PublicationStore();
    expect(store.isPublic("unset")).toBe(true); // the documented default
    expect(store.visibilityOf("unset")).toBe("public");
    store.set("s", "private");
    expect(store.isPublic("s")).toBe(false);
    expect(store.visibilityOf("s")).toBe("private");
    store.set("s", "public");
    expect(store.isPublic("s")).toBe(true);
  });

  test("unlisted and role-scoped read as 'private' to legacy consumers — never public", () => {
    const store = new PublicationStore();
    store.set("u", { kind: "unlisted" });
    store.set("r", { kind: "role-scoped", roles: ["operator"] });
    expect(store.visibilityOf("u")).toBe("private");
    expect(store.visibilityOf("r")).toBe("private");
  });
});

// ---------------------------------------------------------------------------
// Discoverability (the pure decision, per visibility kind × requester)
// ---------------------------------------------------------------------------

describe("sessionDiscoverableBy (the fail-closed decision matrix)", () => {
  const record = (partial: Partial<ContentVisibilityRecord>): ContentVisibilityRecord | null =>
    parseContentVisibility(
      partial === null ? null : { kind: partial.kind, roles: partial.roles, ...partial },
    );

  function factsFor(
    visibility: ContentVisibilityRecord | null,
    ownerId: string | null,
    attestedBy: string | null = null,
  ) {
    return {
      sessionId: "s-test",
      label: "s",
      ownerId,
      policyAssertedBy: attestedBy,
      visibility,
    };
  }

  test("public content is discoverable by everyone, anonymous included", () => {
    expect(
      sessionDiscoverableBy(requester(null, []), factsFor(record({ kind: "public" }), null)),
    ).toBe(true);
  });

  test("private content: owner and operator only", () => {
    const vis = record({ kind: "private" });
    expect(sessionDiscoverableBy(requester(null, []), factsFor(vis, "u-1"))).toBe(false);
    expect(sessionDiscoverableBy(requester("u-2", ["viewer"]), factsFor(vis, "u-1"))).toBe(false);
    expect(sessionDiscoverableBy(requester("u-1", ["viewer"]), factsFor(vis, "u-1"))).toBe(true);
    expect(sessionDiscoverableBy(requester("u-9", ["operator"]), factsFor(vis, "u-1"))).toBe(true);
  });

  test("unlisted content: owner and operator in listings (the link itself is the capability)", () => {
    const vis = record({ kind: "unlisted" });
    expect(sessionDiscoverableBy(requester(null, []), factsFor(vis, "u-1"))).toBe(false);
    expect(sessionDiscoverableBy(requester("u-2", ["creator"]), factsFor(vis, "u-1"))).toBe(false);
    expect(sessionDiscoverableBy(requester("u-1", ["creator"]), factsFor(vis, "u-1"))).toBe(true);
    expect(sessionDiscoverableBy(requester("u-9", ["operator"]), factsFor(vis, "u-1"))).toBe(true);
  });

  test("role-scoped content: the named grants + owner + operator", () => {
    const vis = record({ kind: "role-scoped", roles: ["rights-holder"] });
    expect(sessionDiscoverableBy(requester(null, []), factsFor(vis, "u-1"))).toBe(false);
    expect(
      sessionDiscoverableBy(requester("u-2", ["viewer", "creator"]), factsFor(vis, "u-1")),
    ).toBe(false);
    expect(sessionDiscoverableBy(requester("u-2", ["rights-holder"]), factsFor(vis, "u-1"))).toBe(
      true,
    );
    expect(sessionDiscoverableBy(requester("u-1", ["creator"]), factsFor(vis, "u-1"))).toBe(true);
    expect(sessionDiscoverableBy(requester("u-9", ["operator"]), factsFor(vis, "u-1"))).toBe(true);
  });

  test("fail-closed: an UNKNOWN visibility is discoverable by NOBODY — not even the operator", () => {
    const facts = factsFor(null, "u-1");
    expect(sessionDiscoverableBy(requester(null, []), facts)).toBe(false);
    expect(sessionDiscoverableBy(requester("u-2", ["viewer"]), facts)).toBe(false);
    expect(sessionDiscoverableBy(requester("u-1", ["creator"]), facts)).toBe(false);
    expect(sessionDiscoverableBy(requester("u-2", ["rights-holder"]), facts)).toBe(false);
    expect(sessionDiscoverableBy(requester("u-9", ["operator"]), facts)).toBe(false);
  });

  test("the rights-holder policy scope: attested rights are discoverable by their attester", () => {
    const vis = record({ kind: "private" });
    expect(
      sessionDiscoverableBy(requester("u-rh", ["rights-holder"]), factsFor(vis, "u-other", "u-rh")),
    ).toBe(true);
    expect(
      sessionDiscoverableBy(
        requester("u-rh", ["rights-holder"]),
        factsFor(vis, "u-other", "u-someone-else"),
      ),
    ).toBe(false);
    // A non-rights-holder never gets the policy scope even when attested.
    expect(
      sessionDiscoverableBy(requester("u-rh", ["viewer"]), factsFor(vis, "u-other", "u-rh")),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The requester-scoped catalog (over the real seed + the gate-created sessions)
// ---------------------------------------------------------------------------

describe("buildCatalogFor (role-differentiated listings)", () => {
  test("anonymous: exactly the public seeded sessions, nothing else", async () => {
    const { sessions, degraded } = await buildCatalogFor(server, ANONYMOUS_REQUESTER);
    expect(degraded).toBeNull();
    // L005 (full): three story sessions + six live-tactical scenario sessions.
    expect(sessions.map((card) => card.sessionId).sort()).toEqual(
      [derbyId, friendlyId, trainingId, ...tacticalSessionIds].sort(),
    );
    for (const card of sessions) {
      expect(card.visibility).toBeNull(); // no visibility flag for anonymous
      expect(card.operational).toBeNull(); // no operational block for anonymous
    }
  });

  test("authenticated non-owner (viewer): public only — no visibility, no operational fields", async () => {
    const { sessions } = await buildCatalogFor(
      server,
      await resolveCatalogRequester(server, withCookie("/api/catalog/sessions", viewerToken)),
    );
    // L005 (full): three story sessions + six live-tactical scenario sessions.
    expect(sessions.map((card) => card.sessionId).sort()).toEqual(
      [derbyId, friendlyId, trainingId, ...tacticalSessionIds].sort(),
    );
  });

  test("the owner sees their own private/unlisted/role-scoped sessions + their visibility flags", async () => {
    const requester = await resolveCatalogRequester(
      server,
      withCookie("/api/catalog/sessions", creatorToken),
    );
    const { sessions } = await buildCatalogFor(server, requester);
    const ids = sessions.map((card) => card.sessionId);
    expect(ids).toContain(privateSessionId);
    expect(ids).toContain(unlistedSessionId);
    expect(ids).toContain(roleScopedSessionId);
    expect(ids).toContain(derbyId); // + the public seeded content
    const privateCard = sessions.find((card) => card.sessionId === privateSessionId)!;
    expect(privateCard.visibility).toEqual({ kind: "private", roles: [] });
    expect(privateCard.operational).toBeNull(); // owner is not an operator
    const unlistedCard = sessions.find((card) => card.sessionId === unlistedSessionId)!;
    expect(unlistedCard.visibility).toEqual({ kind: "unlisted", roles: [] });
  });

  test("a rights holder discovers the role-scoped content (the named grant)", async () => {
    const requester = await resolveCatalogRequester(
      server,
      withCookie("/api/catalog/sessions", rightsHolderToken),
    );
    const { sessions } = await buildCatalogFor(server, requester);
    const ids = sessions.map((card) => card.sessionId);
    expect(ids).toContain(roleScopedSessionId); // scoped to rights-holder
    expect(ids).not.toContain(privateSessionId); // another account's private
    expect(ids).not.toContain(unlistedSessionId); // another account's unlisted
  });

  test("the operator's operational view: every valid session incl. others' non-public ones", async () => {
    const requester = await resolveCatalogRequester(
      server,
      withCookie("/api/catalog/sessions", operatorToken),
    );
    const { sessions } = await buildCatalogFor(server, requester);
    const ids = sessions.map((card) => card.sessionId);
    expect(ids).toContain(privateSessionId);
    expect(ids).toContain(unlistedSessionId);
    expect(ids).toContain(roleScopedSessionId);
    for (const card of sessions) {
      expect(card.operational).toEqual({ ownerRecorded: true }); // every session here is owned
      expect(card.visibility).not.toBeNull();
    }
  });

  test("fail-closed: the unknown-visibility session is in NOBODY's listing (operator included)", async () => {
    for (const token of [viewerToken, creatorToken, rightsHolderToken, operatorToken]) {
      const requester = await resolveCatalogRequester(
        server,
        withCookie("/api/catalog/sessions", token),
      );
      const { sessions } = await buildCatalogFor(server, requester);
      expect(sessions.find((card) => card.sessionId === unknownSessionId)).toBeUndefined();
    }
    const anonymous = await buildCatalogFor(server, ANONYMOUS_REQUESTER);
    expect(anonymous.sessions.find((card) => card.sessionId === unknownSessionId)).toBeUndefined();
  });

  test("the owner still sees the broken-visibility session in their LIBRARY (ownership axis)", async () => {
    const library = await server.control.listSessions();
    expect(library.sessions.find((entry) => entry.id === unknownSessionId)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Reality linkage (the same match session → per-renderer reality groups)
// ---------------------------------------------------------------------------

describe("reality linkage", () => {
  test("the derby card: one match, TWO realities (testcard + anime), honest states", async () => {
    const { sessions } = await buildCatalogFor(server, ANONYMOUS_REQUESTER);
    const derby = sessions.find((card) => card.sessionId === derbyId)!;
    expect(derby.realityCount).toBe(2);
    expect(derby.realities).not.toBeNull();
    const byRenderer = new Map(derby.realities!.map((reality) => [reality.rendererId, reality]));
    expect([...byRenderer.keys()].sort()).toEqual(["anime.prototype", "sporta.testcard"]);
    // The anime reality stored real outputs; the testcard render ran but
    // stored none — both are honest states, neither invented.
    expect(byRenderer.get("anime.prototype")!.state).toBe("ready");
    expect(byRenderer.get("anime.prototype")!.hasStoredOutputs).toBe(true);
    expect(byRenderer.get("sporta.testcard")!.state).toBe("no-stored-output");
    expect(byRenderer.get("sporta.testcard")!.hasStoredOutputs).toBe(false);
    // The realities link to the SAME session's real renders.
    for (const reality of derby.realities!) {
      expect(reality.renderId).toMatch(/^r-/);
    }
  });

  test("the friendly card: one reality (testcard only)", async () => {
    const { sessions } = await buildCatalogFor(server, ANONYMOUS_REQUESTER);
    const friendly = sessions.find((card) => card.sessionId === friendlyId)!;
    expect(friendly.realityCount).toBe(1);
    expect(friendly.realities![0]!.rendererId).toBe("sporta.testcard");
  });

  test("the denied training card reveals NOTHING about its realities (fail-closed)", async () => {
    const { sessions } = await buildCatalogFor(server, ANONYMOUS_REQUESTER);
    const training = sessions.find((card) => card.sessionId === trainingId)!;
    expect(training.playback.state).toBe("denied");
    expect(training.realities).toBeNull();
    expect(training.realityCount).toBeNull();
    expect(training.renders).toBeNull();
  });

  test("the reality-grouped view: one match entry per session, sessionId the constant", async () => {
    const view = await buildRealityGroups(server, ANONYMOUS_REQUESTER);
    // L005 (full): three story sessions + six live-tactical scenario sessions.
    expect(view.matches).toHaveLength(9);
    const derby = view.matches.find((match) => match.sessionId === derbyId)!;
    expect(derby.realityCount).toBe(2);
    expect(derby.realities!.map((reality) => reality.rendererId).sort()).toEqual([
      "anime.prototype",
      "sporta.testcard",
    ]);
    for (const match of view.matches) {
      expect(match.realityCount).toBe(match.realities === null ? null : match.realities.length);
    }
  });

  test("a render whose renderer left the registry reports renderer-unavailable (not ready)", async () => {
    // The pure mapping the routes use, over real render shapes: a render
    // whose renderer is no longer registered honestly reports
    // renderer-unavailable — never an invented "ready".
    const { realityGroupsOf } = await import("../src/server/catalog-service");
    const states = realityGroupsOf(
      [
        { renderId: "r-1", rendererId: "sporta.testcard", hasStoredOutputs: true, segmentCount: 3 },
        {
          renderId: "r-2",
          rendererId: "retired.renderer",
          hasStoredOutputs: false,
          segmentCount: 0,
        },
      ],
      new Set(["sporta.testcard"]),
    );
    expect(states[0]).toMatchObject({ rendererId: "sporta.testcard", state: "ready" });
    expect(states[1]).toMatchObject({
      rendererId: "retired.renderer",
      state: "renderer-unavailable",
      hasStoredOutputs: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Search (the Search surface's data layer)
// ---------------------------------------------------------------------------

describe("searchCatalog (real fields, filters, fail-closed)", () => {
  test("text match on the label (case-insensitive) with matchedOn", async () => {
    const result = await searchCatalog(
      server,
      ANONYMOUS_REQUESTER,
      parseSearchQuery(new URLSearchParams("q=KINGS+PARK")),
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.sessionId).toBe(derbyId);
    expect(result.matches[0]!.matchedOn).toEqual(["label"]);
  });

  test("text match on the story key (the labeled dev-seed metadata)", async () => {
    const result = await searchCatalog(
      server,
      ANONYMOUS_REQUESTER,
      parseSearchQuery(new URLSearchParams("q=friendly")),
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.sessionId).toBe(friendlyId);
    expect(result.matches[0]!.matchedOn).toEqual(["label", "story"]); // both fields really match
  });

  test("text match on renderer ids — but NEVER for a playback-denied session", async () => {
    // The training session DID render through anime.prototype, but its
    // renders are not revealed — a renderer search must not leak that.
    const result = await searchCatalog(
      server,
      ANONYMOUS_REQUESTER,
      parseSearchQuery(new URLSearchParams("q=testcard")),
    );
    expect(result.matches.map((match) => match.sessionId).sort()).toEqual(
      [derbyId, friendlyId].sort(),
    );
    expect(result.matches[0]!.matchedOn).toEqual(["renderer"]);
    const anime = await searchCatalog(
      server,
      ANONYMOUS_REQUESTER,
      parseSearchQuery(new URLSearchParams("q=anime.prototype")),
    );
    expect(anime.matches.map((match) => match.sessionId)).toEqual([derbyId]); // training is denied → not matched
  });

  test("no match answers an honest empty list", async () => {
    const result = await searchCatalog(
      server,
      ANONYMOUS_REQUESTER,
      parseSearchQuery(new URLSearchParams("q=no-such-content-anywhere")),
    );
    expect(result.matches).toEqual([]);
  });

  test("renderer filter: exact renderer ids over the session's real renders", async () => {
    const anime = await searchCatalog(
      server,
      ANONYMOUS_REQUESTER,
      parseSearchQuery(new URLSearchParams("renderer=anime.prototype")),
    );
    expect(anime.matches.map((match) => match.sessionId)).toEqual([derbyId]); // training is denied → not matched
    const testcard = await searchCatalog(
      server,
      ANONYMOUS_REQUESTER,
      parseSearchQuery(new URLSearchParams("renderer=sporta.testcard")),
    );
    expect(testcard.matches.map((match) => match.sessionId).sort()).toEqual(
      [derbyId, friendlyId].sort(),
    );
  });

  test("rights + status filters: typed, exact, over the real card fields", async () => {
    const denied = await searchCatalog(
      server,
      ANONYMOUS_REQUESTER,
      parseSearchQuery(new URLSearchParams("rights=denied")),
    );
    expect(denied.matches.map((match) => match.sessionId)).toEqual([trainingId]);
    const both = await searchCatalog(
      server,
      ANONYMOUS_REQUESTER,
      parseSearchQuery(new URLSearchParams("status=authorized&rights=authorized")),
    );
    // L005 (full): the six live-tactical scenario sessions are authorized too.
    expect(both.matches.map((match) => match.sessionId).sort()).toEqual(
      [derbyId, friendlyId, ...tacticalSessionIds].sort(),
    );
  });

  test("strict typing: unknown closed-vocabulary values and empty searches are typed 400s", () => {
    expect(() => parseSearchQuery(new URLSearchParams("status=banana"))).toThrow(
      /unknown status filter/,
    );
    expect(() => parseSearchQuery(new URLSearchParams("rights=maybe"))).toThrow(
      /unknown rights filter/,
    );
    expect(() => parseSearchQuery(new URLSearchParams(""))).toThrow(/empty search/);
  });

  test("visibility-aware: a private session's label is searchable by its owner, invisible to everyone else", async () => {
    const owner = await resolveCatalogRequester(
      server,
      withCookie("/api/catalog/search", creatorToken),
    );
    const mine = await searchCatalog(
      server,
      owner,
      parseSearchQuery(new URLSearchParams("q=W916+private+preview")),
    );
    expect(mine.matches.map((match) => match.sessionId)).toEqual([privateSessionId]);
    const anonymous = await searchCatalog(
      server,
      ANONYMOUS_REQUESTER,
      parseSearchQuery(new URLSearchParams("q=W916+private+preview")),
    );
    expect(anonymous.matches).toEqual([]); // filtered BEFORE matching — no oracle
  });

  test("search respects role-scoped discoverability (the rights holder finds the briefing)", async () => {
    const rightsHolder = await resolveCatalogRequester(
      server,
      withCookie("/api/catalog/search", rightsHolderToken),
    );
    const found = await searchCatalog(
      rightsHolder === null ? server : server,
      rightsHolder,
      parseSearchQuery(new URLSearchParams("q=briefing")),
    );
    expect(found.matches.map((match) => match.sessionId)).toEqual([roleScopedSessionId]);
    const anonymous = await searchCatalog(
      server,
      ANONYMOUS_REQUESTER,
      parseSearchQuery(new URLSearchParams("q=briefing")),
    );
    expect(anonymous.matches).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// No existence oracle + the watch gate (uniform answers)
// ---------------------------------------------------------------------------

describe("assertWatchable through the watch route (no existence oracle)", () => {
  async function watchResponse(sessionId: string, request?: Request): Promise<Response> {
    return watchRoute(request ?? jsonRequest(`/api/watch/${sessionId}`), {
      params: Promise.resolve({ sessionId }),
    });
  }

  test("a private session and an unknown session answer the anonymous caller IDENTICALLY (modulo the caller's own id)", async () => {
    const privateWatch = await watchResponse(privateSessionId);
    const unknownWatch = await watchResponse("no-such-session");
    expect(privateWatch.status).toBe(404);
    expect(unknownWatch.status).toBe(404);
    // The control plane's unknown-session error echoes the CALLER-SUPPLIED id
    // only — normalize it out and the two answers are byte-identical.
    const normalize = (body: string, id: string) => body.split(id).join("<id>");
    const privateText = await privateWatch.clone().text();
    const unknownText = await unknownWatch.clone().text();
    expect(normalize(privateText, privateSessionId)).toBe(
      normalize(unknownText, "no-such-session"),
    );
    expect(
      (JSON.parse(privateText) as { error: { failureClass: string } }).error.failureClass,
    ).toBe("unknown-session");
    expect(
      (JSON.parse(unknownText) as { error: { failureClass: string } }).error.failureClass,
    ).toBe("unknown-session");
  });

  test("an unlisted session IS watchable by the link holder (the link is the capability)", async () => {
    const response = await watchResponse(unlistedSessionId);
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as { sessionId: string };
    expect(body.sessionId).toBe(unlistedSessionId);
  });

  test("a role-scoped session: non-holders get the uniform 404, holders watch", async () => {
    const viewer = await watchResponse(
      roleScopedSessionId,
      withCookie(`/api/watch/${roleScopedSessionId}`, viewerToken),
    );
    const unknown = await watchResponse(
      "no-such-session",
      withCookie("/api/watch/no-such-session", viewerToken),
    );
    expect(viewer.status).toBe(404);
    const normalize = (body: string, id: string) => body.split(id).join("<id>");
    expect(normalize(await viewer.text(), roleScopedSessionId)).toBe(
      normalize(await unknown.text(), "no-such-session"),
    );
    const holder = await watchResponse(
      roleScopedSessionId,
      withCookie(`/api/watch/${roleScopedSessionId}`, rightsHolderToken),
    );
    expect(holder.status).toBe(200);
  });

  test("the owner and an operator watch a private session; other accounts cannot", async () => {
    const owner = await watchResponse(
      privateSessionId,
      withCookie(`/api/watch/${privateSessionId}`, creatorToken),
    );
    expect(owner.status).toBe(200);
    const operator = await watchResponse(
      privateSessionId,
      withCookie(`/api/watch/${privateSessionId}`, operatorToken),
    );
    expect(operator.status).toBe(200);
    const viewer = await watchResponse(
      privateSessionId,
      withCookie(`/api/watch/${privateSessionId}`, viewerToken),
    );
    expect(viewer.status).toBe(404); // uniform, same as unknown
  });

  test("an unknown-visibility session fails CLOSED: anonymous gets the uniform 404, the owner recovers", async () => {
    const anonymous = await watchResponse(unknownSessionId);
    const unknown = await watchResponse("another-no-such-session");
    expect(anonymous.status).toBe(404);
    const normalize = (body: string, id: string) => body.split(id).join("<id>");
    expect(normalize(await anonymous.text(), unknownSessionId)).toBe(
      normalize(await unknown.text(), "another-no-such-session"),
    );
    // The recovery path: the owner can still watch their own session while
    // the flag is broken (documented — the watch gate fails toward the
    // W906 private rule, never toward anonymous access).
    const owner = await watchResponse(
      unknownSessionId,
      withCookie(`/api/watch/${unknownSessionId}`, creatorToken),
    );
    expect(owner.status).toBe(200);
    // But the anonymous link-holder rule for UNLISTED does not apply here.
    const viewer = await watchResponse(
      unknownSessionId,
      withCookie(`/api/watch/${unknownSessionId}`, viewerToken),
    );
    expect(viewer.status).toBe(404); // uniform, same as unknown
  });
});

// ---------------------------------------------------------------------------
// The routes (HTTP level, real Requests + cookies)
// ---------------------------------------------------------------------------

describe("GET /api/catalog/sessions (requester-scoped, versioned shape)", () => {
  test("anonymous: schema 1.1, anonymous viewer summary, the public sessions", async () => {
    const response = await catalogRoute();
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      catalogSchemaVersion: string;
      viewer: { state: string; userId: string | null; grants: string[] };
      sessions: { sessionId: string; realities: unknown }[];
      catalogSource: string;
    };
    expect(body.catalogSchemaVersion).toBe("1.1");
    expect(body.viewer).toEqual({ state: "anonymous", userId: null, grants: [] });
    // L005 (full): three story sessions + six live-tactical scenario sessions.
    expect(body.sessions).toHaveLength(9);
    expect(body.catalogSource).toBe("dev-seed");
  });

  test("the owner's cookie: own private session appears with its visibility flag", async () => {
    const response = await catalogRoute(withCookie("/api/catalog/sessions", creatorToken));
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      viewer: { state: string; userId: string };
      sessions: { sessionId: string; visibility: { kind: string } | null }[];
    };
    expect(body.viewer.state).toBe("authenticated");
    expect(body.viewer.userId).toBe(creatorUserId);
    const own = body.sessions.find((entry) => entry.sessionId === privateSessionId);
    expect(own?.visibility?.kind).toBe("private");
  });

  test("the operator's cookie: the operational view with ownerRecorded", async () => {
    const response = await catalogRoute(withCookie("/api/catalog/sessions", operatorToken));
    const body = (await bodyOf(response)) as {
      sessions: { sessionId: string; operational: { ownerRecorded: boolean } | null }[];
    };
    const ids = body.sessions.map((entry) => entry.sessionId);
    expect(ids).toContain(privateSessionId);
    const own = body.sessions.find((entry) => entry.sessionId === privateSessionId);
    expect(own?.operational).toEqual({ ownerRecorded: true });
  });

  test("a presented-but-invalid token answers exactly as anonymous (never 500)", async () => {
    const response = await catalogRoute(withCookie("/api/catalog/sessions", "not-a-real-token"));
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as { viewer: { state: string } };
    expect(body.viewer.state).toBe("anonymous");
  });
});

describe("GET /api/catalog/realities (the reality-grouped view)", () => {
  test("groups the derby's two realities under one match entry", async () => {
    const response = await realitiesRoute(withCookie("/api/catalog/realities", viewerToken));
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      catalogSchemaVersion: string;
      matches: {
        sessionId: string;
        realityCount: number | null;
        realities: { rendererId: string; state: string }[] | null;
      }[];
    };
    expect(body.catalogSchemaVersion).toBe("1.1");
    const derby = body.matches.find((match) => match.sessionId === derbyId)!;
    expect(derby.realityCount).toBe(2);
    expect(derby.realities!.map((reality) => reality.rendererId).sort()).toEqual([
      "anime.prototype",
      "sporta.testcard",
    ]);
    const training = body.matches.find((match) => match.sessionId === trainingId)!;
    expect(training.realities).toBeNull(); // denied — nothing revealed
  });

  test("the operator's view includes the non-public sessions' match entries", async () => {
    const response = await realitiesRoute(withCookie("/api/catalog/realities", operatorToken));
    const body = (await bodyOf(response)) as { matches: { sessionId: string }[] };
    const ids = body.matches.map((match) => match.sessionId);
    expect(ids).toContain(unlistedSessionId);
    expect(ids).not.toContain(unknownSessionId); // fail-closed
  });
});

describe("GET /api/catalog/search (the route)", () => {
  test("answers a real query with the matched card + matchedOn", async () => {
    const response = await searchRoute(jsonRequest("/api/catalog/search?q=derby"));
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      catalogSchemaVersion: string;
      query: { q: string };
      matches: { sessionId: string; matchedOn: string[] }[];
    };
    expect(body.catalogSchemaVersion).toBe("1.1");
    expect(body.query).toEqual({ q: "derby" });
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0]!.matchedOn).toEqual(["label", "story"]); // both really match
  });

  test("the typed 400s reach the wire (validation failureClass, no silent empties)", async () => {
    const bad = await searchRoute(jsonRequest("/api/catalog/search?q=x&rights=maybe"));
    expect(bad.status).toBe(400);
    expect(((await bodyOf(bad)) as { error: { failureClass: string } }).error.failureClass).toBe(
      "validation",
    );
    const empty = await searchRoute(jsonRequest("/api/catalog/search"));
    expect(empty.status).toBe(400);
    expect(((await bodyOf(empty)) as { error: { failureClass: string } }).error.failureClass).toBe(
      "validation",
    );
  });

  test("owner-scoped search through the route: the private session appears only for its owner", async () => {
    const ownerResponse = await searchRoute(
      withCookie("/api/catalog/search?q=unlisted+link", creatorToken),
    );
    const ownerBody = (await bodyOf(ownerResponse)) as { matches: { sessionId: string }[] };
    expect(ownerBody.matches.map((match) => match.sessionId)).toEqual([unlistedSessionId]);
    const anonymousResponse = await searchRoute(jsonRequest("/api/catalog/search?q=unlisted+link"));
    const anonymousBody = (await bodyOf(anonymousResponse)) as { matches: unknown[] };
    expect(anonymousBody.matches).toEqual([]);
  });
});
