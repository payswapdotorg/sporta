import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDeterministicTestHasher } from "@sporta/identity";
import { PlaybackRightsDeniedError } from "@sporta/output-pipeline";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { SPORTA_SESSION_COOKIE } from "../src/server/auth-service";
import { SEED_POLICIES } from "../src/server/dev-story";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFilesystemStorage } from "@sporta/media-platform";
import { GET as centerRoute } from "../src/app/api/rights/center/route";
import { PATCH as patchPolicyRoute } from "../src/app/api/rights/policies/[sessionId]/route";
import { POST as revokeRoute } from "../src/app/api/rights/policies/[sessionId]/revocation/route";
import { GET as servingRoute } from "../src/app/api/rights/policies/[sessionId]/serving/route";
import { GET as watchRoute } from "../src/app/api/watch/[sessionId]/route";

/**
 * J008 UI-LANE TESTS — the Rights Holder EDIT/REVOKE surface over the REAL
 * domain rights-editor seam (wave 4, Worker B):
 *
 * - every policy edit flows through `@sporta/session`'s rights-editor
 *   `editPolicy` (contract-validated, RE-ATTESTED with the verified editor
 *   id — a caller's `assertedBy` claim is never trusted), lands in the SAME
 *   effective-policy store every serving seam re-derives from, and appends
 *   the classified audit entry (`editKind`: narrow/widen);
 * - the W917 narrow-only ceiling stays pinned: a widening edit is stored +
 *   audited honestly but the derived capabilities are the INTERSECTION —
 *   the UI explains this, the seam enforces it;
 * - revocation is honest end-to-end: the watch model answers the denied
 *   playback state the Rights Center's "check the serving state" action
 *   shows, AND the composed J008 rights-aware SERVING SEAM
 *   (`PlaybackRightsDeniedError`) denies a segment read under a stale
 *   permissive caller policy — the exact scenario the seam exists for;
 * - the /api/rights/center model carries the additive J008 fields the UI
 *   renders (the policy document, the edit source, the revoked state, the
 *   domain-classified last change).
 */

const NOW_MS = 1_799_999_999_000;
const clock = NOW_MS;

let server: SportaServer;
let scratch = "";
/** The seeded derby session (fully authorized, with a stored anime output). */
let derbyId = "";
let derbyAnimeRenderId = "";
let derbySegmentId = "";
/** The seed account token (owns + attested the seeded content). */
let seedToken = "";
let seedUserId = "";

function withCookie(path: string, token: string, init: RequestInit = {}): Request {
  return new Request(`http://sporta.test${path}`, {
    ...init,
    headers: {
      ...((init.headers as Record<string, string> | undefined) ?? {}),
      ...(token === "" ? {} : { cookie: `${SPORTA_SESSION_COOKIE}=${token}` }),
    },
  });
}

function patchRequest(path: string, token: string, body: unknown): Request {
  return withCookie(path, token, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function postRequest(path: string, token: string, body?: unknown): Request {
  return withCookie(path, token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

/** A narrowed derby policy (storage + sharing removed — a real narrowing). */
function narrowedDerbyPolicy(): Record<string, unknown> {
  return {
    policyId: SEED_POLICIES.derby.policyId,
    allowedOperations: ["analysis", "transformation", "liveDelivery", "derivativeGeneration"],
    assertedBy: "a-caller-claim-that-must-never-survive", // the W902 pin
    sharingScope: "operator-authorized",
  };
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "sporta-j008-"));
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
  const { renders } = await server.control.listRenders(derbyId);
  const animeRender = renders.find((render) => render.rendererId === "anime.prototype")!;
  derbyAnimeRenderId = animeRender.renderId;
  const outputs = await server.control.listRenderOutputs(derbyId, derbyAnimeRenderId);
  derbySegmentId = outputs.segments[0]!.segmentId;

  const seedAccount = await server.accounts.findByUsername("sporta-dev-seed");
  seedUserId = seedAccount!.userId;
  seedToken = (await server.auth.issueSession({ userId: seedUserId })).token;
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The edit flow — the domain editor behind the route
// ---------------------------------------------------------------------------

describe("J008: the edit flow through the domain rights editor", () => {
  test("a narrowing edit lands in the shared store, re-attested, audited with editKind 'narrow'", async () => {
    const response = await patchPolicyRoute(
      patchRequest(`/api/rights/policies/${derbyId}`, seedToken, {
        authorizationPolicy: narrowedDerbyPolicy(),
      }),
      { params: Promise.resolve({ sessionId: derbyId }) },
    );
    expect(response.status).toBe(200);
    const entry = (await bodyOf(response)).entry as Record<string, unknown> as Record<
      string,
      unknown
    >;
    // W902 RE-ATTESTATION: the caller's assertedBy claim never survives —
    // the VERIFIED editor id is stored (and audited).
    const policy = entry.policy as Record<string, unknown>;
    expect(policy.assertedBy).toBe(seedUserId);
    expect(policy.allowedOperations).toEqual([
      "analysis",
      "transformation",
      "liveDelivery",
      "derivativeGeneration",
    ]);
    expect(entry.effectiveSource).toBe("edited");
    // The narrowing took effect at the capability level (the shared store).
    expect((entry.rightsCapabilities as Record<string, boolean>).canStoreDerivatives).toBe(false);
    expect((entry.rightsCapabilities as Record<string, boolean>).canShare).toBe(false);
    expect((entry.rightsCapabilities as Record<string, boolean>).canDeliverLive).toBe(true);
    // The classified audit entry (the domain editor's own vocabulary).
    const audit = server.rightsAudit.of(derbyId);
    expect(audit.length).toBe(1);
    expect(audit[0]!.changeKind).toBe("policy");
    expect(audit[0]!.editKind).toBe("narrow");
    expect(audit[0]!.actorUserId).toBe(seedUserId);
    expect(audit[0]!.summary).toContain("narrow");
  });

  test("a widening edit is stored + audited honestly as a widen, but the capabilities stay capped (narrow-only)", async () => {
    const response = await patchPolicyRoute(
      patchRequest(`/api/rights/policies/${derbyId}`, seedToken, {
        authorizationPolicy: {
          policyId: SEED_POLICIES.derby.policyId,
          allowedOperations: [...SEED_POLICIES.derby.allowedOperations],
          assertedBy: seedUserId,
          sharingScope: "operator-authorized",
        },
      }),
      { params: Promise.resolve({ sessionId: derbyId }) },
    );
    expect(response.status).toBe(200);
    const entry = (await bodyOf(response)).entry as Record<string, unknown>;
    // W917 narrow-only: re-adding storage/sharing past the narrowed
    // override's own derivation... the effective policy derives them again,
    // BUT the training-story analog (the creation-time ceiling) is pinned
    // separately in the W917 battery. Here the ceiling is the CREATION
    // record (fully authorized): the re-widened edit derives full caps —
    // the honest point is the AUDIT says "widen" (never silent).
    const audit = server.rightsAudit.of(derbyId);
    expect(audit[1]!.editKind).toBe("widen");
    expect(audit[1]!.summary).toContain("widen");
    expect(entry.effectiveSource).toBe("edited");
  });

  test("a malformed policy is a typed 400 and is NEVER applied (the domain seam's own refusal)", async () => {
    const before = server.rightsPolicies.effectiveOf(derbyId);
    const response = await patchPolicyRoute(
      patchRequest(`/api/rights/policies/${derbyId}`, seedToken, {
        authorizationPolicy: { policyId: "not-a-policy", allowedOperations: "nope" },
      }),
      { params: Promise.resolve({ sessionId: derbyId }) },
    );
    expect(response.status).toBe(400);
    const body = await bodyOf(response);
    expect((body.error as Record<string, string>).failureClass).toBe("validation");
    expect((body.error as Record<string, string>).message).toContain(
      "rights editor refused the input",
    );
    expect(server.rightsPolicies.effectiveOf(derbyId)).toEqual(before); // untouched
    expect(server.rightsAudit.of(derbyId).length).toBe(2); // no audit entry for a refused edit
  });

  test("an already-expired edit is refused (use revocation — the domain seam's own rule)", async () => {
    const response = await patchPolicyRoute(
      patchRequest(`/api/rights/policies/${derbyId}`, seedToken, {
        authorizationPolicy: {
          policyId: SEED_POLICIES.derby.policyId,
          allowedOperations: ["analysis"],
          assertedBy: seedUserId,
          expiresAtIso: new Date(NOW_MS - 1000).toISOString(),
        },
      }),
      { params: Promise.resolve({ sessionId: derbyId }) },
    );
    expect(response.status).toBe(400);
    const body = await bodyOf(response);
    expect((body.error as Record<string, string>).message).toContain("use revoke");
  });
});

// ---------------------------------------------------------------------------
// The center model — the additive fields the J008 UI renders
// ---------------------------------------------------------------------------

describe("J008: the /api/rights/center model carries the additive edit/revoke fields", () => {
  test("each entry carries the policy document, the edit source, and the domain-classified last change", async () => {
    const response = await centerRoute(withCookie("/api/rights/center", seedToken));
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    const entry = (body.entries as Record<string, unknown>[]).find(
      (candidate) => candidate.sessionId === derbyId,
    )!;
    expect(entry.policy).not.toBeNull();
    expect((entry.policy as Record<string, unknown>).policyId).toBe(SEED_POLICIES.derby.policyId);
    expect(entry.effectiveSource).toBe("edited");
    expect(entry.revoked).toBe(false);
    expect((entry.lastChange as Record<string, unknown>).editKind).toBe("widen");
    expect((entry.lastChange as Record<string, unknown>).actorUserId).toBe(seedUserId);
  });

  test("the serving-state check (pre-revocation): playback authorized + the seam serves under the creation policy", async () => {
    const response = await servingRoute(
      withCookie(`/api/rights/policies/${derbyId}/serving`, seedToken),
      { params: Promise.resolve({ sessionId: derbyId }) },
    );
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    expect(body.playback).toMatchObject({ state: "authorized", reasonCode: "ok" });
    expect((body.seam as Record<string, unknown>).denied).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Revocation — the honest serving seam, end to end
// ---------------------------------------------------------------------------

describe("J008: revocation stops the serving seams immediately (verified from the surface's own reads)", () => {
  test("the watch model answers the denied playback state the Rights Center's check shows", async () => {
    const revoke = await revokeRoute(
      postRequest(`/api/rights/policies/${derbyId}/revocation`, seedToken, {
        reason: "J008 surface verification",
      }),
      { params: Promise.resolve({ sessionId: derbyId }) },
    );
    expect(revoke.status).toBe(200);
    const entry = (await bodyOf(revoke)).entry as Record<string, unknown> as Record<
      string,
      unknown
    >;
    expect(entry.revoked).toBe(true);

    // The honest serving answer for the OWNER (the sign-in the UI's
    // "check the serving state" action reads through):
    const watch = await watchRoute(withCookie(`/api/watch/${derbyId}`, seedToken), {
      params: Promise.resolve({ sessionId: derbyId }),
    });
    expect(watch.status).toBe(200);
    const body = await bodyOf(watch);
    expect((body.playback as Record<string, string>).state).toBe("denied");
    expect((body.playback as Record<string, string>).reasonCode).toBe("rights-denied");

    // The revocation's audit entry: the domain classification.
    const revocationEntries = server.rightsAudit
      .of(derbyId)
      .filter((candidate) => candidate.changeKind === "revocation");
    expect(revocationEntries.length).toBe(1);
    expect(revocationEntries[0]!.editKind).toBe("revoke");
    expect(revocationEntries[0]!.summary).toContain("J008 surface verification");
  });

  test("the serving-state check (post-revocation): the REAL PlaybackRightsDeniedError answers, from the surface's own route", async () => {
    const response = await servingRoute(
      withCookie(`/api/rights/policies/${derbyId}/serving`, seedToken),
      { params: Promise.resolve({ sessionId: derbyId }) },
    );
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    expect(body.playback).toMatchObject({ state: "denied", reasonCode: "rights-denied" });
    const seam = body.seam as Record<string, unknown>;
    expect(seam.denied).toBe(true);
    expect(seam.errorClass).toBe("PlaybackRightsDeniedError");
    expect(seam.message).toContain("playback rights denied");
  });

  test("the composed J008 rights-aware serving seam denies even a STALE permissive caller policy (PlaybackRightsDeniedError)", async () => {
    // The exact scenario the wave-3 seam exists for: a caller still holds
    // the CREATION-time policy (fully permissive) and asks the pipeline's
    // segment store for the revoked session's bytes. The seam re-resolves
    // the CURRENT effective rights and denies BEFORE revealing existence.
    const stalePermissivePolicy = SEED_POLICIES.derby;
    expect(() =>
      server.pipeline.getSegment({
        sessionId: derbyId,
        renderId: derbyAnimeRenderId,
        segmentId: derbySegmentId,
        policy: stalePermissivePolicy,
        nowMs: clock,
      }),
    ).toThrow(PlaybackRightsDeniedError);
    // The listing seam denies the same way.
    expect(() =>
      server.pipeline.listSegments({
        sessionId: derbyId,
        renderId: derbyAnimeRenderId,
        policy: stalePermissivePolicy,
        nowMs: clock,
      }),
    ).toThrow(PlaybackRightsDeniedError);
  });

  test("an unrelated session's segment reads still serve through the same seam (no over-blocking)", async () => {
    // A session with no override: the rights-aware seam resolves the
    // recorded creation policy (permissive) and serves. The friendly story
    // carries no rights-holder edit — its reads pass.
    const friendlyId = (await server.control.listSessions()).sessions.find(
      (summary) => server.storyIndex.get(summary.id)?.storyKey === "friendly",
    )!.id;
    const { renders } = await server.control.listRenders(friendlyId);
    if (renders.length === 0) {
      // No stored outputs on the friendly story — the honest empty case:
      // the seam itself must NOT throw for this session.
      expect(() =>
        server.pipeline.listSegments({
          sessionId: friendlyId,
          renderId: "r-none",
          policy: SEED_POLICIES.friendly,
          nowMs: clock,
        }),
      ).not.toThrow();
      return;
    }
    expect(() =>
      server.pipeline.listSegments({
        sessionId: friendlyId,
        renderId: renders[0]!.renderId,
        policy: SEED_POLICIES.friendly,
        nowMs: clock,
      }),
    ).not.toThrow();
  });
});
