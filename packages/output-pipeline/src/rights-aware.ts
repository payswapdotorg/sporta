/**
 * THE REVOCATION-AWARE SERVING SEAM (J008) — a `RenderSegmentStore`
 * decorator that re-resolves the session's CURRENT rights at EVERY
 * retrieval, so a revoked/narrowed policy fails closed at the serving seam
 * even when the CALLER still holds a stale authorization policy.
 *
 * WHY THIS LAYER (the honest gap it closes): the W504 store's playback gate
 * is CALLER-SUPPLIED — `PlaybackRightsContext { policy, nowMs }` is the
 * documented trust boundary (W701: "the caller-supplied policy is it"). A
 * rights holder who REVOKES a session (the rights store's override expires
 * it in the past) cannot rely on every caller dropping their stale policy
 * reference: the seam itself must re-derive from the CURRENT effective
 * rights. This decorator composes the domain rights resolution
 * (`@sporta/session`'s effective-policy store, via an injected resolver)
 * with the store: every `getSegment`/`listSegments` call first resolves the
 * session's effective capabilities at the caller's evaluation time and
 * throws `PlaybackRightsDeniedError` BEFORE revealing whether anything
 * exists (the same fail-closed posture as `assertPlaybackRights` — the
 * inner store still applies its own caller-supplied check underneath:
 * belt and suspenders, never a replaced gate).
 *
 * FAIL-CLOSED (the contract's own rule): a resolver that returns null/undefined
 * (no policy record) denies — a missing decision is DENY, never a silent
 * pass-through. A resolver that throws propagates typed (never
 * caught-and-guessed).
 *
 * Writes (`storeSegment`), maintenance (`deleteSegment`) and counters
 * (`stats`) pass through unchanged — retrieval/publication is the
 * rights-gated surface (the same boundary the W504 store itself draws).
 */
import type { RightsCapabilities } from "@sporta/contracts";
import { PlaybackRightsDeniedError } from "./errors";
import type {
  RenderSegmentStore,
  RenderSegmentStoreStats,
  SegmentListQuery,
  SegmentRetrievalQuery,
  StoreSegmentInput,
  StoreSegmentOutcome,
  StoredRenderSegment,
  StoredRenderSegmentSummary,
} from "./types";

/**
 * Resolves the session's CURRENT effective capabilities at `nowMs` (the
 * caller's evaluation time — the same time the caller-supplied policy is
 * derived at). `null`/`undefined` = no rights decision → DENY (fail-closed).
 * The composition typically binds this to `@sporta/session`'s
 * `effectiveCapabilitiesOf` over the rights-policy store.
 */
export type RightsCapabilityResolver = (
  sessionId: string,
  nowMs: number,
) => RightsCapabilities | null | undefined;

/** Options for {@link createRightsAwareSegmentStore}. */
export interface RightsAwareSegmentStoreOptions {
  /** The inner store (the W504 in-memory or sqlite implementation). */
  inner: RenderSegmentStore;
  /** The current-rights resolver (fail-closed on null). */
  resolve: RightsCapabilityResolver;
}

/** A malformed decorator configuration (fail-loud). */
export class RightsAwareStoreValidationError extends Error {
  constructor(issues: readonly string[]) {
    super(`rights-aware segment store refused the input: ${issues.join("; ")}`);
    this.name = "RightsAwareStoreValidationError";
  }
}

/**
 * Creates the revocation-aware `RenderSegmentStore` decorator (J008): the
 * retrieval/listing seams re-resolve the session's CURRENT effective
 * capabilities at the caller's evaluation time and fail closed without
 * `canStoreDerivatives`; writes and maintenance pass through.
 */
export function createRightsAwareSegmentStore(
  options: RightsAwareSegmentStoreOptions,
): RenderSegmentStore {
  const issues: string[] = [];
  if (options === null || typeof options?.inner !== "object") {
    issues.push("inner must be a RenderSegmentStore");
  }
  if (typeof options?.resolve !== "function") {
    issues.push("resolve must be a RightsCapabilityResolver function");
  }
  if (issues.length > 0) throw new RightsAwareStoreValidationError(issues);
  const inner = options.inner;
  const resolve = options.resolve;

  const assertCurrentRights = (sessionId: string, nowMs: number): void => {
    const capabilities = resolve(sessionId, nowMs);
    if (capabilities == null || capabilities.canStoreDerivatives !== true) {
      throw new PlaybackRightsDeniedError(
        `playback rights denied: the session's current effective rights do not grant canStoreDerivatives (revoked, expired, narrowed, or unrecorded — fail-closed at the serving seam)`,
        { sessionId, reason: "revoked-or-insufficient" },
      );
    }
  };

  return {
    storeSegment(input: StoreSegmentInput): StoreSegmentOutcome {
      return inner.storeSegment(input);
    },
    getSegment(query: SegmentRetrievalQuery): StoredRenderSegment | null {
      // The revocation-aware gate FIRST (before the inner store's own
      // caller-supplied check — both run; this one sees the CURRENT rights).
      assertCurrentRights(query.sessionId, query.nowMs);
      return inner.getSegment(query);
    },
    listSegments(query: SegmentListQuery): StoredRenderSegmentSummary[] {
      assertCurrentRights(query.sessionId, query.nowMs);
      return inner.listSegments(query);
    },
    deleteSegment(sessionId: string, renderId: string, segmentId: string): void {
      inner.deleteSegment(sessionId, renderId, segmentId);
    },
    stats(): RenderSegmentStoreStats {
      return inner.stats();
    },
  };
}
