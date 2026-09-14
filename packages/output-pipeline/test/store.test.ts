/**
 * W504 render-segment store tests: the full repository contract (W004
 * patterns) exercised against BOTH implementations through one shared
 * suite, plus sqlite-specific persistence/integrity tests.
 *
 * Shared suite (in-memory + sqlite): round-trips, idempotent duplicates
 * (counted, never re-stored), fail-loud conflicts, fail-closed playback
 * rights on retrieval (deny-before-reveal), bounded size with explicit
 * rejects (never silent eviction), deep-clone-on-read and on-write, listing
 * in insertion order, idempotent deletes, and store-input validation.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { renderAnimeClip } from "@sporta/renderer-anime";
import type { AuthorizationPolicy } from "@sporta/contracts";
import { TEST_EPOCH_MS } from "@sporta/testing";
import {
  InMemoryRenderSegmentStore,
  PlaybackRightsDeniedError,
  SegmentConflictError,
  SegmentIntegrityError,
  SegmentStoreLimitError,
  SegmentValidationError,
  SqliteRenderSegmentStore,
  encodeAnimeClip,
  parseAnimeSegmentManifest,
} from "../src/index";
import type {
  EncodedAnimeSegment,
  RenderSegmentStore,
  RenderSegmentStoreLimits,
  StoreSegmentOutcome,
} from "../src/index";
import {
  RENDER_ID,
  SESSION_ID,
  analysisTransformationPolicy,
  buildClipRequest,
  buildFixtureOutput,
  buildFixtureSteps,
  expiredPolicy,
  fullAllowPolicy,
  nearExpiryPolicy,
} from "./helpers";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** The canonical encoded fixture segment (deterministic). */
function fixtureSegment(): EncodedAnimeSegment {
  return encodeAnimeClip(buildFixtureOutput());
}

/**
 * A REAL conflicting segment: the same render identity (→ the same segment
 * id) re-rendered with different frame content (player-7 moved +5 m). Built
 * through the actual renderer + encoder — never hand-forged.
 */
function conflictingSegment(): EncodedAnimeSegment {
  const shiftedSteps = buildFixtureSteps().map((step) => {
    const clone = structuredClone(step);
    const player7 = clone.snapshot.entities[0]!;
    const slot = player7.state.pitchPosition!;
    slot.value = { x: (slot.value as { x: number; y: number }).x + 5, y: 34 };
    return clone;
  });
  return encodeAnimeClip(renderAnimeClip(buildClipRequest(), shiftedSteps));
}

/** A retrieval query with full-allow rights at the test epoch. */
function allowQuery(
  segmentId: string,
  sessionId: string = SESSION_ID,
  renderId: string = RENDER_ID,
) {
  return { sessionId, renderId, segmentId, policy: fullAllowPolicy, nowMs: TEST_EPOCH_MS };
}

/** Store factory: fresh store per call, optionally with size limits. */
type StoreFactory = (limits?: Partial<RenderSegmentStoreLimits>) => RenderSegmentStore;

// ---------------------------------------------------------------------------
// The shared repository contract suite (W004 roundTripSuite pattern)
// ---------------------------------------------------------------------------

function storeContractSuite(makeStore: StoreFactory) {
  describe("store + retrieve round-trip", () => {
    test("storeSegment returns a stored record; getSegment deep-equals it", () => {
      const store = makeStore();
      const segment = fixtureSegment();
      const outcome = store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment });
      expect(outcome.outcome).toBe("stored");
      const record = store.getSegment(allowQuery(segment.segmentId));
      expect(record).not.toBeNull();
      expect(record!.segmentId).toBe(segment.segmentId);
      expect(record!.sessionId).toBe(SESSION_ID);
      expect(record!.renderId).toBe(RENDER_ID);
      expect(record!.contentType).toBe("image/svg+xml");
      expect(record!.content).toBe(segment.content);
      expect(record!.byteLength).toBe(segment.byteLength);
      expect(record!.contentHash).toBe(segment.contentHash);
      expect(record!.manifest).toEqual(segment.manifest);
      expect(record!.storeSequence).toBe(1);
      expect(record!.duplicateCount).toBe(0);
    });

    test("storedAtMs comes from the injected (deterministic) clock", () => {
      const store = makeStore();
      const segment = fixtureSegment();
      const { record } = store.storeSegment({
        sessionId: SESSION_ID,
        renderId: RENDER_ID,
        segment,
      }) as Extract<StoreSegmentOutcome, { outcome: "stored" }>;
      expect(record.storedAtMs).toBe(TEST_EPOCH_MS + 1); // first tick
    });

    test("getSegment of an absent key returns null (with rights)", () => {
      const store = makeStore();
      expect(store.getSegment(allowQuery("anime-clip-00000000"))).toBeNull();
    });

    test("retrieved records are deep clones (mutating them never leaks in)", () => {
      const store = makeStore();
      const segment = fixtureSegment();
      store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment });
      const record = store.getSegment(allowQuery(segment.segmentId))!;
      record.manifest.frameCount = 99;
      record.content = "<svg>hacked</svg>";
      const reread = store.getSegment(allowQuery(segment.segmentId))!;
      expect(reread.manifest.frameCount).toBe(6);
      expect(reread.content).toBe(segment.content);
    });

    test("mutating the store input after storeSegment never leaks in", () => {
      const store = makeStore();
      const segment = fixtureSegment();
      store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment });
      segment.content = "<svg>hacked</svg>";
      const record = store.getSegment(allowQuery(segment.segmentId))!;
      expect(record.content).not.toBe("<svg>hacked</svg>");
    });
  });

  describe("idempotency + conflict (fail-loud, never silent)", () => {
    test("same key + same content → counted no-op duplicate, nothing re-stored", () => {
      const store = makeStore();
      const segment = fixtureSegment();
      const first = store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment });
      expect(first.outcome).toBe("stored");
      const second = store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment });
      expect(second.outcome).toBe("duplicate");
      if (second.outcome === "duplicate") {
        expect(second.duplicateCount).toBe(1);
        // The ORIGINAL record is returned unchanged.
        expect(second.record.storedAtMs).toBe(first.record.storedAtMs);
        expect(second.record.storeSequence).toBe(first.record.storeSequence);
      }
      const third = store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment });
      expect(third.outcome).toBe("duplicate");
      if (third.outcome === "duplicate") expect(third.duplicateCount).toBe(2);
      const stats = store.stats();
      expect(stats.segments).toBe(1); // never re-stored
      expect(stats.totalBytes).toBe(segment.byteLength); // bytes counted once
      expect(stats.duplicateStores).toBe(2); // but counted
    });

    test("same key + different content → SegmentConflictError, nothing overwritten", () => {
      const store = makeStore();
      const original = fixtureSegment();
      store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment: original });
      const conflicting = conflictingSegment();
      expect(conflicting.segmentId).toBe(original.segmentId); // same identity
      expect(conflicting.content).not.toBe(original.content); // different bytes
      expect(() =>
        store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment: conflicting }),
      ).toThrow(SegmentConflictError);
      // The stored output is untouched, and the conflict is not a duplicate.
      const record = store.getSegment(allowQuery(original.segmentId))!;
      expect(record.content).toBe(original.content);
      expect(record.contentHash).toBe(original.contentHash);
      expect(store.stats().duplicateStores).toBe(0);
      expect(store.stats().segments).toBe(1);
    });
  });

  describe("fail-closed playback rights (retrieval)", () => {
    test("policy without canStoreDerivatives denies getSegment BEFORE existence is revealed", () => {
      const store = makeStore();
      const segment = fixtureSegment();
      store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment });
      // Present segment:
      expect(() =>
        store.getSegment({
          ...allowQuery(segment.segmentId),
          policy: analysisTransformationPolicy,
        }),
      ).toThrow(PlaybackRightsDeniedError);
      // ABSENT segment: still a rights denial (never a null reveal).
      expect(() =>
        store.getSegment({
          sessionId: SESSION_ID,
          renderId: RENDER_ID,
          segmentId: "anime-clip-00000000",
          policy: analysisTransformationPolicy,
          nowMs: TEST_EPOCH_MS,
        }),
      ).toThrow(PlaybackRightsDeniedError);
    });

    test("denial carries the policy id and the insufficient-policy reason", () => {
      const store = makeStore();
      try {
        store.getSegment({
          ...allowQuery("anime-clip-00000000"),
          policy: analysisTransformationPolicy,
        });
        expect.unreachable();
      } catch (err) {
        expect(err instanceof PlaybackRightsDeniedError).toBe(true);
        if (err instanceof PlaybackRightsDeniedError) {
          expect(err.failureClass).toBe("rights-denied");
          expect(err.details.reason).toBe("insufficient-policy");
          expect(err.details.policyId).toBe(analysisTransformationPolicy.policyId);
        }
      }
    });

    test("expired policy denies with the expired-policy reason", () => {
      const store = makeStore();
      try {
        store.getSegment({ ...allowQuery("anime-clip-00000000"), policy: expiredPolicy });
        expect.unreachable();
      } catch (err) {
        expect(err instanceof PlaybackRightsDeniedError).toBe(true);
        if (err instanceof PlaybackRightsDeniedError) {
          expect(err.details.reason).toBe("expired-policy");
        }
      }
    });

    test("policy expiring between two reads flips the second read to denied (re-derived at nowMs)", () => {
      const store = makeStore();
      const segment = fixtureSegment();
      store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment });
      const policy = nearExpiryPolicy("2025-01-06T13:00:00.000Z"); // +1h
      const before = store.getSegment({ ...allowQuery(segment.segmentId), policy });
      expect(before).not.toBeNull();
      expect(() =>
        store.getSegment({
          ...allowQuery(segment.segmentId),
          policy,
          nowMs: TEST_EPOCH_MS + 2 * 3_600_000,
        }),
      ).toThrow(PlaybackRightsDeniedError);
    });

    test("a malformed policy document denies (invalid-policy), never partially applies", () => {
      const store = makeStore();
      expect(() =>
        store.getSegment({
          ...allowQuery("anime-clip-00000000"),
          policy: {} as AuthorizationPolicy,
        }),
      ).toThrow(PlaybackRightsDeniedError);
    });

    test("a NON-FINITE evaluation time denies (invalid-now) — an expired policy + NaN never serves", () => {
      /**
       * REAL BUG this test pins (found in the inherited-work audit): the
       * expiry comparison `Date.parse(expiresAtIso) <= nowMs` is
       * vacuously false when `nowMs` is NaN, so an EXPIRED policy with a
       * NaN clock passed the gate and the store SERVED the protected
       * segment. The gate now rejects non-finite evaluation times
       * fail-closed BEFORE anything is revealed.
       */
      const store = makeStore();
      const segment = fixtureSegment();
      store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment });
      // The empirical fail-open case: expired policy + NaN.
      for (const badNow of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        "not-a-number" as unknown as number,
        undefined as unknown as number,
      ]) {
        try {
          store.getSegment({
            ...allowQuery(segment.segmentId),
            policy: expiredPolicy,
            nowMs: badNow,
          });
          expect.unreachable();
        } catch (err) {
          expect(err instanceof PlaybackRightsDeniedError).toBe(true);
          if (err instanceof PlaybackRightsDeniedError) {
            expect(err.failureClass).toBe("rights-denied");
            expect(err.details.reason).toBe("invalid-now");
          }
        }
      }
      // Even a full-allow policy denies on a non-finite clock (fail-closed:
      // the gate cannot prove the policy is in force).
      expect(() =>
        store.getSegment({ ...allowQuery(segment.segmentId), nowMs: Number.NaN }),
      ).toThrow(PlaybackRightsDeniedError);
      // The stored record is untouched and still served with a finite clock.
      expect(store.getSegment(allowQuery(segment.segmentId))).not.toBeNull();
      // Listing denies identically on a non-finite clock.
      expect(() =>
        store.listSegments({
          sessionId: SESSION_ID,
          renderId: RENDER_ID,
          policy: fullAllowPolicy,
          nowMs: Number.NaN,
        }),
      ).toThrow(PlaybackRightsDeniedError);
    });

    test("listSegments denies identically (never an empty partial list)", () => {
      const store = makeStore();
      const segment = fixtureSegment();
      store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment });
      expect(() =>
        store.listSegments({
          sessionId: SESSION_ID,
          renderId: RENDER_ID,
          policy: analysisTransformationPolicy,
          nowMs: TEST_EPOCH_MS,
        }),
      ).toThrow(PlaybackRightsDeniedError);
      expect(() =>
        store.listSegments({
          sessionId: SESSION_ID,
          renderId: RENDER_ID,
          policy: {} as AuthorizationPolicy,
          nowMs: TEST_EPOCH_MS,
        }),
      ).toThrow(PlaybackRightsDeniedError);
    });
  });

  describe("listing + deletion", () => {
    test("listSegments returns the render's segments in insertion order, scoped per render/session", () => {
      const store = makeStore();
      const segmentA = fixtureSegment();
      const segmentB = conflictingSegment();
      // Two different renders, plus the same content under another render id.
      store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment: segmentA });
      store.storeSegment({
        sessionId: SESSION_ID,
        renderId: "r-clip-2",
        segment: segmentB,
      });
      const listed = store.listSegments({
        sessionId: SESSION_ID,
        renderId: RENDER_ID,
        policy: fullAllowPolicy,
        nowMs: TEST_EPOCH_MS,
      });
      expect(listed).toEqual([
        {
          segmentId: segmentA.segmentId,
          contentType: "image/svg+xml",
          byteLength: segmentA.byteLength,
          contentHash: segmentA.contentHash,
        },
      ]);
      const otherRender = store.listSegments({
        sessionId: SESSION_ID,
        renderId: "r-clip-2",
        policy: fullAllowPolicy,
        nowMs: TEST_EPOCH_MS,
      });
      expect(otherRender).toHaveLength(1);
      expect(otherRender[0]!.segmentId).toBe(segmentB.segmentId);
      const emptyRender = store.listSegments({
        sessionId: SESSION_ID,
        renderId: "r-clip-unknown",
        policy: fullAllowPolicy,
        nowMs: TEST_EPOCH_MS,
      });
      expect(emptyRender).toEqual([]);
      const otherSession = store.listSegments({
        sessionId: "sess-other",
        renderId: RENDER_ID,
        policy: fullAllowPolicy,
        nowMs: TEST_EPOCH_MS,
      });
      expect(otherSession).toEqual([]);
    });

    test("deleteSegment removes the segment and is idempotent", () => {
      const store = makeStore();
      const segment = fixtureSegment();
      store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment });
      store.deleteSegment(SESSION_ID, RENDER_ID, segment.segmentId);
      expect(store.getSegment(allowQuery(segment.segmentId))).toBeNull();
      expect(() => store.deleteSegment(SESSION_ID, RENDER_ID, segment.segmentId)).not.toThrow();
      expect(() => store.deleteSegment(SESSION_ID, RENDER_ID, "never-existed")).not.toThrow();
      expect(store.stats().segments).toBe(0);
      expect(store.stats().totalBytes).toBe(0);
    });
  });

  describe("store-input validation (fail-loud on write)", () => {
    test("stale content hash (content tampered, hash not) is rejected", () => {
      const store = makeStore();
      const segment = fixtureSegment();
      const tampered: EncodedAnimeSegment = {
        ...segment,
        content: `${segment.content} `,
      };
      expect(() =>
        store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment: tampered }),
      ).toThrow(SegmentValidationError);
      expect(store.stats().segments).toBe(0);
    });

    test("wrong byte length is rejected", () => {
      const store = makeStore();
      const segment = fixtureSegment();
      const tampered: EncodedAnimeSegment = { ...segment, byteLength: segment.byteLength + 1 };
      expect(() =>
        store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment: tampered }),
      ).toThrow(SegmentValidationError);
    });

    test("manifest/segment id drift is rejected", () => {
      const store = makeStore();
      const segment = fixtureSegment();
      const tampered: EncodedAnimeSegment = {
        ...segment,
        manifest: { ...segment.manifest, segmentId: "anime-clip-deadbeef" },
      };
      expect(() =>
        store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment: tampered }),
      ).toThrow(/segmentId/);
    });

    test("manifest session drift from the store scope is rejected", () => {
      const store = makeStore();
      const segment = fixtureSegment();
      const tampered: EncodedAnimeSegment = {
        ...segment,
        manifest: { ...segment.manifest, sessionId: "sess-other" },
      };
      expect(() =>
        store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment: tampered }),
      ).toThrow(/another session/);
    });

    test("empty content / empty ids are rejected", () => {
      const store = makeStore();
      const segment = fixtureSegment();
      expect(() =>
        store.storeSegment({
          sessionId: "",
          renderId: RENDER_ID,
          segment,
        }),
      ).toThrow(SegmentValidationError);
      expect(() =>
        store.storeSegment({
          sessionId: SESSION_ID,
          renderId: "",
          segment,
        }),
      ).toThrow(SegmentValidationError);
      const emptyContent = { ...segment, content: "" } as EncodedAnimeSegment;
      expect(() =>
        store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment: emptyContent }),
      ).toThrow(SegmentValidationError);
    });
  });

  describe("bounded size — explicit reject, never silent eviction", () => {
    test("maxSegments: the (n+1)-th distinct segment is rejected, nothing evicted", () => {
      const store = makeStore({ maxSegments: 1 });
      const segmentA = fixtureSegment();
      store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment: segmentA });
      // A second DISTINCT key (same content is idempotent; the conflicting
      // variant shares the segment id, so it goes under a different render).
      const segmentB = conflictingSegment();
      expect(() =>
        store.storeSegment({ sessionId: SESSION_ID, renderId: "r-clip-2", segment: segmentB }),
      ).toThrow(SegmentStoreLimitError);
      // Nothing was evicted; the store still holds exactly the first segment.
      expect(store.stats().segments).toBe(1);
      expect(store.getSegment(allowQuery(segmentA.segmentId))).not.toBeNull();
      expect(store.stats().duplicateStores).toBe(0);
    });

    test("maxSegmentBytes: an oversized single segment is rejected", () => {
      const store = makeStore({ maxSegmentBytes: 8 });
      const segment = fixtureSegment();
      try {
        store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment });
        expect.unreachable();
      } catch (err) {
        expect(err instanceof SegmentStoreLimitError).toBe(true);
        if (err instanceof SegmentStoreLimitError) {
          expect(err.failureClass).toBe("resource-limit");
          expect(err.details.limit).toBe("maxSegmentBytes");
        }
      }
      expect(store.stats().segments).toBe(0);
    });

    test("maxTotalBytes: the write that would exceed the total is rejected", () => {
      const segment = fixtureSegment();
      const store = makeStore({ maxTotalBytes: segment.byteLength - 1 });
      expect(() =>
        store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment }),
      ).toThrow(SegmentStoreLimitError);
      expect(store.stats().segments).toBe(0);
    });

    test("duplicates never hit the limits (a no-op stores nothing)", () => {
      const store = makeStore({ maxSegments: 1 });
      const segment = fixtureSegment();
      store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment });
      const again = store.storeSegment({
        sessionId: SESSION_ID,
        renderId: RENDER_ID,
        segment,
      });
      expect(again.outcome).toBe("duplicate");
    });
  });

  describe("scope-id integrity — the NUL-free key space (regression)", () => {
    /**
     * REAL BUG this suite pins (found in the inherited-work audit): the
     * in-memory composite key is `\u0000`-separated, and a NUL inside a
     * caller-supplied id made the key AMBIGUOUS — empirically, a record
     * stored under `(sess, "r-1\u0000c")` was READ (and could be DELETED)
     * by a query crafted as `(sess, "r-1", "c\u0000<segmentId>")`. The
     * store now rejects NUL ids LOUDLY on every path, so the ambiguity can
     * never exist.
     */
    test("storeSegment rejects a NUL in sessionId / renderId / segmentId", () => {
      const store = makeStore();
      const segment = fixtureSegment();
      expect(() =>
        store.storeSegment({ sessionId: "sess\u0000x", renderId: RENDER_ID, segment }),
      ).toThrow(SegmentValidationError);
      expect(() =>
        store.storeSegment({ sessionId: SESSION_ID, renderId: "r-1\u0000c", segment }),
      ).toThrow(SegmentValidationError);
      const nulSegment: EncodedAnimeSegment = {
        ...segment,
        segmentId: `anime-clip-${segment.segmentId.slice(-8)}\u0000x`,
        manifest: { ...segment.manifest, segmentId: `${segment.segmentId}\u0000x` },
      };
      expect(() =>
        store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment: nulSegment }),
      ).toThrow(SegmentValidationError);
      expect(store.stats().segments).toBe(0);
    });

    test("getSegment rejects a NUL-crafted query — AFTER the rights gate", () => {
      const store = makeStore();
      const segment = fixtureSegment();
      store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment });
      // A NUL-crafted query can never address another scope's record:
      expect(() =>
        store.getSegment({
          sessionId: SESSION_ID,
          renderId: "r-1",
          segmentId: `c\u0000${segment.segmentId}`,
          policy: fullAllowPolicy,
          nowMs: TEST_EPOCH_MS,
        }),
      ).toThrow(SegmentValidationError);
      // Rights come FIRST (a denied policy + a malformed query → rights denial):
      expect(() =>
        store.getSegment({
          sessionId: SESSION_ID,
          renderId: "r-1",
          segmentId: `c\u0000${segment.segmentId}`,
          policy: analysisTransformationPolicy,
          nowMs: TEST_EPOCH_MS,
        }),
      ).toThrow(PlaybackRightsDeniedError);
      // The stored record is untouched.
      expect(store.getSegment(allowQuery(segment.segmentId))).not.toBeNull();
    });

    test("listSegments rejects a NUL-crafted scope (after the rights gate)", () => {
      const store = makeStore();
      store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment: fixtureSegment() });
      expect(() =>
        store.listSegments({
          sessionId: SESSION_ID,
          renderId: `r-1\u0000${RENDER_ID}`,
          policy: fullAllowPolicy,
          nowMs: TEST_EPOCH_MS,
        }),
      ).toThrow(SegmentValidationError);
      expect(() =>
        store.listSegments({
          sessionId: `${SESSION_ID}\u0000x`,
          renderId: RENDER_ID,
          policy: analysisTransformationPolicy,
          nowMs: TEST_EPOCH_MS,
        }),
      ).toThrow(PlaybackRightsDeniedError);
    });

    test("deleteSegment rejects a NUL-crafted key (never deletes another scope)", () => {
      const store = makeStore();
      const segment = fixtureSegment();
      store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment });
      // NUL-crafted delete keys are rejected loudly…
      expect(() => store.deleteSegment(SESSION_ID, "r-1", `c\u0000${segment.segmentId}`)).toThrow(
        SegmentValidationError,
      );
      expect(() =>
        store.deleteSegment(`${SESSION_ID}\u0000x`, RENDER_ID, segment.segmentId),
      ).toThrow(SegmentValidationError);
      // …and nothing was deleted by the rejected calls.
      expect(store.stats().segments).toBe(1);
      expect(store.getSegment(allowQuery(segment.segmentId))).not.toBeNull();
    });
  });

  describe("determinism", () => {
    test("two fresh stores fed the same sequence produce deep-equal records", () => {
      const storeA = makeStore();
      const storeB = makeStore();
      const segment = fixtureSegment();
      const recordA = storeA.storeSegment({
        sessionId: SESSION_ID,
        renderId: RENDER_ID,
        segment,
      }).record;
      const recordB = storeB.storeSegment({
        sessionId: SESSION_ID,
        renderId: RENDER_ID,
        segment,
      }).record;
      expect(recordA).toEqual(recordB);
      expect(storeA.stats()).toEqual(storeB.stats());
    });
  });
}

// ---------------------------------------------------------------------------
// parseAnimeSegmentManifest unit pins
// ---------------------------------------------------------------------------

describe("parseAnimeSegmentManifest (structural round-trip validation)", () => {
  test("accepts the encoded fixture manifest", () => {
    const check = parseAnimeSegmentManifest(fixtureSegment().manifest);
    expect(check.ok).toBe(true);
  });

  test("rejects wrong format kind / version", () => {
    const manifest = fixtureSegment().manifest;
    expect(
      parseAnimeSegmentManifest({ ...manifest, format: { kind: "webm", version: 1 } }).ok,
    ).toBe(false);
    expect(
      parseAnimeSegmentManifest({ ...manifest, format: { kind: "animated-svg", version: 2 } }).ok,
    ).toBe(false);
  });

  test("rejects frame count / frames-length drift", () => {
    const manifest = fixtureSegment().manifest;
    expect(parseAnimeSegmentManifest({ ...manifest, frameCount: 5 }).ok).toBe(false);
    expect(parseAnimeSegmentManifest({ ...manifest, frames: manifest.frames.slice(0, 5) }).ok).toBe(
      false,
    );
  });

  test("rejects a bad content hash and non-positive dur", () => {
    const manifest = fixtureSegment().manifest;
    expect(parseAnimeSegmentManifest({ ...manifest, contentHash: "XYZ" }).ok).toBe(false);
    const zeroDur = structuredClone(manifest);
    zeroDur.frames[0]!.durMs = 0;
    expect(parseAnimeSegmentManifest(zeroDur).ok).toBe(false);
  });

  test("rejects non-objects", () => {
    expect(parseAnimeSegmentManifest(null).ok).toBe(false);
    expect(parseAnimeSegmentManifest("nope").ok).toBe(false);
    expect(parseAnimeSegmentManifest(42).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

describe("InMemoryRenderSegmentStore", () => {
  storeContractSuite((limits) => new InMemoryRenderSegmentStore({ limits }));
});

// ---------------------------------------------------------------------------
// bun:sqlite implementation
// ---------------------------------------------------------------------------

describe("SqliteRenderSegmentStore", () => {
  let tempDir: string;
  let sqliteSeq = 0;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "sporta-output-pipeline-test-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  /** Each contract test gets its own database file for isolation. */
  function sqliteFactory(limits?: Partial<RenderSegmentStoreLimits>): SqliteRenderSegmentStore {
    const store = new SqliteRenderSegmentStore(join(tempDir, `contract-${sqliteSeq++}.sqlite`), {
      limits,
    });
    return store;
  }

  storeContractSuite((limits) => sqliteFactory(limits));

  describe("schema", () => {
    test("creates the render_output_segments table with the render index", () => {
      const path = join(tempDir, "schema.sqlite");
      const store = new SqliteRenderSegmentStore(path);
      const db = new Database(path);
      const tables = db
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'render_output_segments'",
        )
        .all();
      const indexes = db
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'render_output_segments' AND name NOT LIKE 'sqlite_autoindex%'",
        )
        .all();
      db.close();
      store.close();
      expect(tables).toHaveLength(1);
      expect((indexes[0] as { name: string } | undefined)?.name).toBe(
        "render_output_segments_render_idx",
      );
    });

    test("constructor accepts a Database instance; close is idempotent; closed throws", () => {
      const path = join(tempDir, "instance.sqlite");
      const db = new Database(path);
      const store = new SqliteRenderSegmentStore(db);
      const segment = fixtureSegment();
      store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment });
      expect(store.getSegment(allowQuery(segment.segmentId))).not.toBeNull();
      store.close();
      expect(() => store.getSegment(allowQuery(segment.segmentId))).toThrow();
      expect(() => store.close()).not.toThrow();
    });
  });

  describe("durable persistence", () => {
    test("documents survive close and reopen (deep-equal, verbatim manifest)", () => {
      const path = join(tempDir, "reopen.sqlite");
      const store = new SqliteRenderSegmentStore(path);
      const segment = fixtureSegment();
      const record = store.storeSegment({
        sessionId: SESSION_ID,
        renderId: RENDER_ID,
        segment,
      }).record;
      store.close();

      const reopened = new SqliteRenderSegmentStore(path);
      const stored = reopened.getSegment(allowQuery(segment.segmentId));
      expect(stored).toEqual(record);
      reopened.close();
    });

    test("duplicate counts persist and continue after reopen", () => {
      const path = join(tempDir, "duplicates.sqlite");
      const store = new SqliteRenderSegmentStore(path);
      const segment = fixtureSegment();
      store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment });
      store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment });
      expect(store.stats().duplicateStores).toBe(1);
      store.close();

      const reopened = new SqliteRenderSegmentStore(path);
      expect(reopened.stats().duplicateStores).toBe(1);
      const again = reopened.storeSegment({
        sessionId: SESSION_ID,
        renderId: RENDER_ID,
        segment,
      });
      expect(again.outcome).toBe("duplicate");
      if (again.outcome === "duplicate") expect(again.duplicateCount).toBe(2);
      expect(reopened.stats().duplicateStores).toBe(2);
      reopened.close();
    });

    test("store_sequence continues after reopen (insertion order preserved)", () => {
      const path = join(tempDir, "sequence.sqlite");
      const segmentA = fixtureSegment();
      const segmentB = conflictingSegment();
      const store = new SqliteRenderSegmentStore(path);
      const a = store.storeSegment({
        sessionId: SESSION_ID,
        renderId: RENDER_ID,
        segment: segmentA,
      }).record;
      const b = store.storeSegment({
        sessionId: SESSION_ID,
        renderId: "r-clip-2",
        segment: segmentB,
      }).record;
      store.close();

      const reopened = new SqliteRenderSegmentStore(path);
      const segmentC = fixtureSegment(); // same content as A, new render id
      const c = reopened.storeSegment({
        sessionId: SESSION_ID,
        renderId: "r-clip-3",
        segment: segmentC,
      }).record;
      expect(a.storeSequence).toBe(1);
      expect(b.storeSequence).toBe(2);
      expect(c.storeSequence).toBe(3); // continued, not restarted
      const listedB = reopened.listSegments({
        sessionId: SESSION_ID,
        renderId: "r-clip-2",
        policy: fullAllowPolicy,
        nowMs: TEST_EPOCH_MS,
      });
      const listedC = reopened.listSegments({
        sessionId: SESSION_ID,
        renderId: "r-clip-3",
        policy: fullAllowPolicy,
        nowMs: TEST_EPOCH_MS,
      });
      expect(listedB[0]!.segmentId).toBe(segmentB.segmentId);
      expect(listedC[0]!.segmentId).toBe(segmentC.segmentId);
      reopened.close();
    });
  });

  describe("integrity verification on read (corruption fails loud)", () => {
    function tamperRow(path: string, sql: string, params: Array<string | number>): void {
      const db = new Database(path);
      db.run(sql, params);
      db.close();
    }

    test("content drift (hash mismatch) → SegmentIntegrityError", () => {
      const path = join(tempDir, "corrupt-content.sqlite");
      const store = new SqliteRenderSegmentStore(path);
      const segment = fixtureSegment();
      store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment });
      store.close();
      tamperRow(
        path,
        "UPDATE render_output_segments SET content = content || ' ' WHERE segment_id = ?",
        [segment.segmentId],
      );

      const reopened = new SqliteRenderSegmentStore(path);
      expect(() => reopened.getSegment(allowQuery(segment.segmentId))).toThrow(
        SegmentIntegrityError,
      );
      reopened.close();
    });

    test("unparsable manifest_json → SegmentIntegrityError", () => {
      const path = join(tempDir, "corrupt-json.sqlite");
      const store = new SqliteRenderSegmentStore(path);
      const segment = fixtureSegment();
      store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment });
      store.close();
      tamperRow(
        path,
        "UPDATE render_output_segments SET manifest_json = '{not-valid-json' WHERE segment_id = ?",
        [segment.segmentId],
      );

      const reopened = new SqliteRenderSegmentStore(path);
      expect(() => reopened.getSegment(allowQuery(segment.segmentId))).toThrow(
        SegmentIntegrityError,
      );
      reopened.close();
    });

    test("byte-length drift → SegmentIntegrityError", () => {
      const path = join(tempDir, "corrupt-bytes.sqlite");
      const store = new SqliteRenderSegmentStore(path);
      const segment = fixtureSegment();
      store.storeSegment({ sessionId: SESSION_ID, renderId: RENDER_ID, segment });
      store.close();
      tamperRow(
        path,
        "UPDATE render_output_segments SET byte_length = byte_length + 1 WHERE segment_id = ?",
        [segment.segmentId],
      );

      const reopened = new SqliteRenderSegmentStore(path);
      expect(() => reopened.getSegment(allowQuery(segment.segmentId))).toThrow(
        SegmentIntegrityError,
      );
      reopened.close();
    });
  });
});
