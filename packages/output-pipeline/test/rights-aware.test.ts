/**
 * THE J008 REVOCATION-AWARE SERVING SEAM BATTERY — the fail-closed
 * enforcement at the output pipeline's retrieval/listing boundary:
 *
 * - the decorator re-resolves the session's CURRENT effective rights at
 *   every `getSegment`/`listSegments` and denies BEFORE the inner store
 *   (and before existence is revealed) when the current rights lack
 *   `canStoreDerivatives`;
 * - THE STALE-POLICY ATTACK: a caller still holding a full-allow
 *   caller-supplied policy (the W701 trust boundary) is denied after a
 *   rights-holder REVOKE — the caller-supplied check alone is not enough,
 *   and this seam composes with (never replaces) the domain resolution;
 * - fail-closed on a null resolution (no rights record = DENY, never
 *   pass-through); a throwing resolver propagates typed;
 * - belt-and-suspenders: the INNER store's own caller-supplied gate still
 *   applies beneath the decorator (an expired caller policy denies even
 *   when the current domain rights would allow);
 * - writes/maintenance/counters pass through (retrieval is the gated
 *   surface — the W504 store's own boundary, mirrored here);
 * - THE END-TO-END REVOCATION FLOW against the REAL J008 domain: the
 *   `@sporta/session` rights store + editor (grant → serve → revoke →
 *   FAILS CLOSED), through `effectiveCapabilitiesOf` as the resolver.
 */
import { describe, expect, test } from "bun:test";
import type { AuthorizationPolicy, RightsCapabilities } from "@sporta/contracts";
import { TEST_EPOCH_MS } from "@sporta/testing";
import {
  createRightsAwareSegmentStore,
  InMemoryRenderSegmentStore,
  PlaybackRightsDeniedError,
  encodeAnimeClip,
  RightsAwareStoreValidationError,
} from "../src/index";
import type { RightsCapabilityResolver } from "../src/index";
import {
  InMemoryEffectivePolicyStore,
  InMemoryRightsAuditStore,
  createRightsEditor,
  effectiveCapabilitiesOf,
} from "@sporta/session";
import {
  RENDER_ID,
  SESSION_ID,
  buildClipRequest,
  buildFixtureOutput,
  buildFixtureSteps,
  expiredPolicy,
  fullAllowPolicy,
} from "./helpers";
import { renderAnimeClip } from "@sporta/renderer-anime";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The canonical encoded fixture segment (deterministic). */
function fixtureSegment() {
  return encodeAnimeClip(buildFixtureOutput());
}

/** A REAL second segment: the same render re-rendered with different content. */
function conflictingSegment() {
  const shiftedSteps = buildFixtureSteps().map((step) => {
    const clone = structuredClone(step);
    const player7 = clone.snapshot.entities[0]!;
    const slot = player7.state.pitchPosition!;
    slot.value = { x: (slot.value as { x: number; y: number }).x + 5, y: 34 };
    return clone;
  });
  return encodeAnimeClip(renderAnimeClip(buildClipRequest(), shiftedSteps));
}

/** Full current rights (the resolver's allow answer). */
const FULL_CAPS: RightsCapabilities = {
  canReferenceSourceFrames: true,
  canDeliverLive: true,
  canStoreDerivatives: true,
  canShare: true,
};

/** Current rights WITHOUT storage/derivative capability (a narrowed state). */
const NARROWED_CAPS: RightsCapabilities = {
  canReferenceSourceFrames: true,
  canDeliverLive: true,
  canStoreDerivatives: false,
  canShare: false,
};

/** A retrieval query with full-allow caller rights at the test epoch. */
function allowQuery(segmentId: string, sessionId = SESSION_ID, renderId = RENDER_ID) {
  return { sessionId, renderId, segmentId, policy: fullAllowPolicy, nowMs: TEST_EPOCH_MS };
}

/** A list query with full-allow caller rights at the test epoch. */
function allowListQuery(sessionId = SESSION_ID, renderId = RENDER_ID) {
  return { sessionId, renderId, policy: fullAllowPolicy, nowMs: TEST_EPOCH_MS };
}

/** A resolver that always answers `caps` (the simplest mock). */
function staticResolver(caps: RightsCapabilities | null): RightsCapabilityResolver {
  return () => caps;
}

/** A store with one fixture segment stored, wrapped by the decorator. */
function stockedStore(resolve: RightsCapabilityResolver) {
  const inner = new InMemoryRenderSegmentStore();
  const segment = fixtureSegment();
  inner.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment });
  return { inner, segment, store: createRightsAwareSegmentStore({ inner, resolve }) };
}

// ---------------------------------------------------------------------------
// Wiring (fail-loud on malformed configuration)
// ---------------------------------------------------------------------------

describe("the decorator wiring (fail-loud)", () => {
  test("refuses a malformed configuration with the typed validation error", () => {
    expect(() =>
      createRightsAwareSegmentStore({ resolve: staticResolver(FULL_CAPS) } as never),
    ).toThrow(RightsAwareStoreValidationError);
    expect(() =>
      createRightsAwareSegmentStore({
        inner: new InMemoryRenderSegmentStore(),
        resolve: null as never,
      }),
    ).toThrow(RightsAwareStoreValidationError);
    expect(() =>
      createRightsAwareSegmentStore({
        inner: new InMemoryRenderSegmentStore(),
        resolve: "not-a-function" as never,
      }),
    ).toThrow(RightsAwareStoreValidationError);
  });
});

// ---------------------------------------------------------------------------
// The fail-closed core (retrieval + listing deny on current-rights loss)
// ---------------------------------------------------------------------------

describe("the fail-closed core (the current rights decide, deny-before-reveal)", () => {
  test("full current rights → retrieval round-trips through the decorator", () => {
    const { segment, store } = stockedStore(staticResolver(FULL_CAPS));
    const record = store.getSegment(allowQuery(segment.segmentId));
    expect(record).not.toBeNull();
    expect(record!.segmentId).toBe(segment.segmentId);
    expect(record!.content).toBe(segment.content);
    expect(record!.contentHash).toBe(segment.contentHash);
  });

  test("full current rights → listing round-trips through the decorator", () => {
    const { segment, store } = stockedStore(staticResolver(FULL_CAPS));
    const summaries = store.listSegments(allowListQuery());
    expect(summaries.length).toBe(1);
    expect(summaries[0]!.segmentId).toBe(segment.segmentId);
    expect(summaries[0]!.contentHash).toBe(segment.contentHash);
  });

  test("a NULL resolution denies (no rights record = DENY, never pass-through) — even for an ABSENT segment", () => {
    const { segment, store } = stockedStore(staticResolver(null));
    expect(() => store.getSegment(allowQuery(segment.segmentId))).toThrow(
      PlaybackRightsDeniedError,
    );
    // Deny BEFORE existence: the absent key also throws (never a null that
    // would reveal the segment does not exist).
    expect(() => store.getSegment(allowQuery("anime-clip-does-not-exist"))).toThrow(
      PlaybackRightsDeniedError,
    );
    expect(() => store.listSegments(allowListQuery())).toThrow(PlaybackRightsDeniedError);
  });

  test("current rights WITHOUT canStoreDerivatives (narrowed) deny with the typed error", () => {
    const { segment, store } = stockedStore(staticResolver(NARROWED_CAPS));
    let denied: PlaybackRightsDeniedError | null = null;
    try {
      store.getSegment(allowQuery(segment.segmentId));
    } catch (error) {
      denied = error as PlaybackRightsDeniedError;
    }
    expect(denied).toBeInstanceOf(PlaybackRightsDeniedError);
    expect(denied!.details).toMatchObject({
      sessionId: SESSION_ID,
      reason: "revoked-or-insufficient",
    });
    expect(() => store.listSegments(allowListQuery())).toThrow(PlaybackRightsDeniedError);
  });

  test("a resolver that throws propagates verbatim (typed, never caught-and-guessed)", () => {
    class ResolverOutage extends Error {
      constructor() {
        super("the rights store is unreachable");
        this.name = "ResolverOutage";
      }
    }
    const { segment, store } = stockedStore(() => {
      throw new ResolverOutage();
    });
    expect(() => store.getSegment(allowQuery(segment.segmentId))).toThrow(ResolverOutage);
    expect(() => store.listSegments(allowListQuery())).toThrow(ResolverOutage);
  });

  test("the resolver receives (sessionId, nowMs) verbatim — the caller's CURRENT evaluation time", () => {
    const seen: Array<{ sessionId: string; nowMs: number }> = [];
    const { segment, store } = stockedStore((sessionId, nowMs) => {
      seen.push({ sessionId, nowMs });
      return FULL_CAPS;
    });
    const query = { ...allowQuery(segment.segmentId), nowMs: TEST_EPOCH_MS + 5_000 };
    store.getSegment(query);
    store.getSegment(allowQuery(segment.segmentId));
    expect(seen).toEqual([
      { sessionId: SESSION_ID, nowMs: TEST_EPOCH_MS + 5_000 },
      { sessionId: SESSION_ID, nowMs: TEST_EPOCH_MS },
    ]);
  });
});

// ---------------------------------------------------------------------------
// THE STALE-POLICY ATTACK (the honest gap this decorator closes)
// ---------------------------------------------------------------------------

describe("the stale-policy attack (revoked current rights beat a stale caller policy)", () => {
  test("current rights revoked mid-flight: the SAME caller policy flips allow→deny", () => {
    // The caller holds a full-allow policy for the whole test (the W701
    // trust boundary: caller-supplied policy is all the INNER store sees).
    let current: RightsCapabilities | null = FULL_CAPS;
    const { segment, store } = stockedStore(() => current);

    // Before revocation: the caller's policy serves.
    expect(store.getSegment(allowQuery(segment.segmentId))).not.toBeNull();
    expect(store.listSegments(allowListQuery()).length).toBe(1);

    // The rights holder REVOKES (the domain store now has no allow decision).
    current = null;

    // After revocation: the SAME stale caller policy is DENIED at the seam.
    expect(() => store.getSegment(allowQuery(segment.segmentId))).toThrow(
      PlaybackRightsDeniedError,
    );
    expect(() => store.listSegments(allowListQuery())).toThrow(PlaybackRightsDeniedError);
  });
});

// ---------------------------------------------------------------------------
// Belt and suspenders (the inner gate still applies beneath)
// ---------------------------------------------------------------------------

describe("the inner caller-supplied gate still applies (composed, not replaced)", () => {
  test("current domain rights allow + the caller policy EXPIRED → the inner store denies", () => {
    const { segment, store } = stockedStore(staticResolver(FULL_CAPS));
    const expiredQuery = {
      ...allowQuery(segment.segmentId),
      policy: expiredPolicy,
    };
    expect(() => store.getSegment(expiredQuery)).toThrow(PlaybackRightsDeniedError);
    expect(() => store.listSegments({ ...allowListQuery(), policy: expiredPolicy })).toThrow(
      PlaybackRightsDeniedError,
    );
  });
});

// ---------------------------------------------------------------------------
// The designed boundary (writes/maintenance/counters pass through)
// ---------------------------------------------------------------------------

describe("the designed boundary (writes, maintenance, and counters pass through)", () => {
  test("storeSegment, deleteSegment, and stats pass through unchanged", () => {
    const { inner, segment, store } = stockedStore(staticResolver(null));
    // The retrieval surface is the rights-gated boundary; writes are the
    // upstream pipeline's own decision (a stored-but-unservable segment is
    // inert — nobody can retrieve it, as pinned above).
    const second = conflictingSegment();
    const outcome = store.storeSegment({
      sessionId: SESSION_ID,
      renderId: "r-clip-2",
      segment: second,
    });
    expect(outcome.outcome).toBe("stored");
    expect(store.stats().segments).toBe(2);
    store.deleteSegment(SESSION_ID, "r-clip-2", second.segmentId);
    expect(inner.stats().segments).toBe(1);
    expect(store.stats()).toEqual(inner.stats());
    // …and the original segment still cannot be SERVED (the gate holds):
    expect(() => store.getSegment(allowQuery(segment.segmentId))).toThrow(
      PlaybackRightsDeniedError,
    );
  });
});

// ---------------------------------------------------------------------------
// THE END-TO-END REVOCATION FLOW (the REAL J008 domain as the resolver)
// ---------------------------------------------------------------------------

describe("the end-to-end revocation flow (the real @sporta/session domain)", () => {
  /** Wires the REAL domain stores + editor to the serving seam. */
  function makeRevocationFixture() {
    const policies = new InMemoryEffectivePolicyStore();
    const audit = new InMemoryRightsAuditStore();
    const now = { ms: TEST_EPOCH_MS };
    const editor = createRightsEditor({
      policies,
      audit,
      nowMs: () => now.ms,
    });
    // The resolver: the domain's own effective-capability derivation at the
    // caller's evaluation time (the composition the app layer binds).
    const resolve: RightsCapabilityResolver = (sessionId, nowMs) =>
      effectiveCapabilitiesOf(policies, sessionId, new Date(nowMs));
    const inner = new InMemoryRenderSegmentStore();
    const segment = fixtureSegment();
    return { policies, audit, editor, now, resolve, inner, segment };
  }

  test("grant → serve → revoke → FAILS CLOSED (the J008 golden path)", () => {
    const fixture = makeRevocationFixture();
    // 1. The session is created with full rights (the creation record).
    fixture.editor.recordCreation(SESSION_ID, { userId: "creator-1" }, fullAllowPolicy);
    // 2. The serving seam is composed over the domain resolution.
    const store = createRightsAwareSegmentStore({
      inner: fixture.inner,
      resolve: fixture.resolve,
    });
    // A caller-supplied full-allow policy (the W701 trust boundary) with an
    // EARLIER view of the world — it stays byte-identical across the revoke.
    const staleCallerPolicy: AuthorizationPolicy = structuredClone(fullAllowPolicy);
    // 3. The derivative is produced and stored while rights are in force.
    const outcome = store.storeSegment({
      sessionId: SESSION_ID,
      renderId: RENDER_ID,
      segment: fixture.segment,
    });
    expect(outcome.outcome).toBe("stored");

    // 4. SERVE: the current rights are full → the segment is served.
    expect(
      store.getSegment({
        sessionId: SESSION_ID,
        renderId: RENDER_ID,
        segmentId: fixture.segment.segmentId,
        policy: staleCallerPolicy,
        nowMs: TEST_EPOCH_MS,
      }),
    ).not.toBeNull();
    expect(store.listSegments({ ...allowListQuery(), policy: staleCallerPolicy }).length).toBe(1);

    // 5. The rights holder REVOKES (audited, the domain's own time bound).
    fixture.editor.revoke(SESSION_ID, { userId: "holder-1" }, "license withdrawn");
    expect(fixture.audit.lastOf(SESSION_ID)!.editKind).toBe("revoke");

    // 6. SERVE AGAIN with the SAME stale caller policy → FAILS CLOSED.
    expect(() =>
      store.getSegment({
        sessionId: SESSION_ID,
        renderId: RENDER_ID,
        segmentId: fixture.segment.segmentId,
        policy: staleCallerPolicy,
        nowMs: TEST_EPOCH_MS,
      }),
    ).toThrow(PlaybackRightsDeniedError);
    expect(() => store.listSegments({ ...allowListQuery(), policy: staleCallerPolicy })).toThrow(
      PlaybackRightsDeniedError,
    );
  });

  test("NARROW also closes the seam (a narrowed policy without storage rights denies)", () => {
    const fixture = makeRevocationFixture();
    fixture.editor.recordCreation(SESSION_ID, { userId: "creator-1" }, fullAllowPolicy);
    const store = createRightsAwareSegmentStore({
      inner: fixture.inner,
      resolve: fixture.resolve,
    });
    store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment: fixture.segment });
    // The rights holder narrows to analysis+transformation only — no
    // derivativeGeneration/storage → canStoreDerivatives re-derives false.
    fixture.editor.editPolicy(
      SESSION_ID,
      { userId: "holder-1" },
      {
        policyId: "policy-narrowed",
        allowedOperations: ["analysis", "transformation"],
        assertedBy: "holder-1",
        expiresAtIso: fullAllowPolicy.expiresAtIso,
      },
    );
    expect(fixture.audit.lastOf(SESSION_ID)!.editKind).toBe("narrow");
    expect(() => store.getSegment(allowQuery(fixture.segment.segmentId))).toThrow(
      PlaybackRightsDeniedError,
    );
  });

  test("an UNRECORDED session fails closed too (no creation record = no allow)", () => {
    const fixture = makeRevocationFixture();
    const store = createRightsAwareSegmentStore({
      inner: fixture.inner,
      resolve: fixture.resolve,
    });
    // The domain store has no record at all: the contract's own fail-closed
    // derivation yields deny-all → the seam denies (never a pass-through).
    expect(() => store.getSegment(allowQuery(fixture.segment.segmentId))).toThrow(
      PlaybackRightsDeniedError,
    );
  });
});
