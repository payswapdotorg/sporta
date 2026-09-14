/**
 * Spatial state fusion (W206) — pitch-space player positions, time-aligned
 * to the session timeline.
 *
 * FUSES the three delivered seams (consume only, never re-implement):
 *
 * - W203 `@sporta/field-mapping`: the per-frame camera calibration
 *   (`FieldCornerSet`) -> `createPitchProjector` -> the image -> pitch
 *   homography, solved once per frame;
 * - W204 `@sporta/perception-tracking`: the per-frame `TrackedBox`es
 *   (image space, persistent session-scoped track ids, verbatim
 *   confidence);
 * - W103 `@sporta/timeline`: the affine `TrackClock` mapping the video
 *   track's SOURCE time (`presentationMs`) onto the canonical SESSION
 *   timeline (see `./align`).
 *
 * Per frame, each tracked box CENTER (`box.x + box.w / 2`,
 * `box.y + box.h / 2`) is projected through THAT frame's own homography
 * into the canonical pitch frame (frozen 105 x 68 m, corner origin,
 * x = touchline, y = goal-line), stamped with the session-aligned time,
 * and fused with an EXPLICIT, non-inflating confidence. The result is the
 * {@link SpatialStateSeries} — the input of `./observe`'s SWM-facing
 * spatial observation stream.
 *
 * Honesty rules (architecture-lock §4 — explicit uncertainty, never
 * invented certainty; §6 — confidence preserved, no silent collapse):
 *
 * - OUT-OF-PITCH STAYS OUT-OF-PITCH: the W203 `inBounds` flag (0 <= x <= 105
 *   AND 0 <= y <= 68, inclusive) is passed through VERBATIM and the pitch
 *   coordinates are NEVER clamped — a player standing beyond the touchline
 *   is an out-of-play fact (`inBounds: false` with the true coordinates),
 *   not a clamped in-play fiction;
 * - CONFIDENCE FUSION IS EXPLICIT: default `"min"` of (track confidence,
 *   corner-set confidence) — a projection is only as good as its weakest
 *   input, so the bottleneck is reported, not averaged away; `"product"`
 *   multiplies them (an independent-error model). BOTH keep the raw values
 *   in `sourceConfidences` so downstream fusion can re-fuse differently:
 *   the combination choice is RECORDED, never hidden;
 * - NO VELOCITY: the `TrackPayload` contract has an optional velocity, but
 *   velocity state estimation is W205's ball-state concern / later fusion;
 *   this package never sets it;
 * - NO NEW DETECTION, CALIBRATION, OR SYNCHRONIZATION: identity comes from
 *   W204 (`trackId` passthrough), geometry from W203, time from W103.
 *
 * Determinism (docs/testing/HARNESS.md): no RNG, no clock reads, no
 * `Date.now`, no environment reads. Frames are processed in ARRAY order
 * (the caller's order); the output points are sorted by
 * (sessionMs, trackId) with a STABLE sort — equal keys keep the frame
 * array order, then the frame's detection order — so the same inputs
 * always produce a deep-equal series.
 *
 * Fail-loud conventions (repo style): an unsupported `cornerOrder` or a
 * degenerate corner geometry throws the W203 typed error through
 * `createPitchProjector` (a silently wrong projection is never emitted);
 * a non-finite `presentationMs` or degenerate clock throws W103's
 * `RangeError` through `toSessionMs`; confidences outside [0, 1] throw a
 * `RangeError` here (they must survive verbatim into contract-valid
 * observations, which zod-restrict confidence to [0, 1] — garbage is
 * rejected at the boundary, closest to its cause).
 */
import { createPitchProjector } from "@sporta/field-mapping";
import type { FieldCornerSet } from "@sporta/field-mapping";
import type { TrackedBox, TrackerFrameInput } from "@sporta/perception-tracking";
import { identityClock } from "@sporta/timeline";
import type { TrackClock } from "@sporta/timeline";
import { alignSessionMs } from "./align";

/**
 * One fused input frame: the W204 tracker frame (id + SOURCE timeline
 * position + decode order), the W203 per-frame camera calibration, and the
 * W204 tracked boxes assigned on that frame. The three arrive from three
 * different upstream components; W206's job is exactly this confluence.
 */
export interface SpatialFrame {
  /** The tracker frame the boxes were assigned on (W204). */
  readonly frame: TrackerFrameInput;
  /** That frame's camera calibration (W203) — its OWN homography. */
  readonly cornerSet: FieldCornerSet;
  /** The frame's tracked boxes (W204), in detection order. */
  readonly tracks: readonly TrackedBox[];
}

/**
 * One fused player position: WHERE (pitch meters), WHEN (session
 * milliseconds), WHO (the W204 track id, passed through verbatim —
 * identity is W204's hypothesis, never re-minted here), and HOW SURE
 * (explicit fusion with raw sources preserved).
 */
export interface SpatialStatePoint {
  /** W204 track id — identity passthrough, never re-minted. */
  readonly trackId: string;
  /** The frame the position was fused from. */
  readonly frameId: string;
  /** Timeline-aligned position (W103 clock mapping — see `./align`). */
  readonly sessionMs: number;
  /** Canonical pitch frame position, in METERS. Unclamped — see `inBounds`. */
  readonly pitch: { x: number; y: number };
  /**
   * W203 semantics verbatim: `0 <= x <= 105 AND 0 <= y <= 68` (inclusive).
   * `false` means out-of-play: the coordinates above are the TRUE projected
   * values, NEVER clamped (architecture-lock §4).
   */
  readonly inBounds: boolean;
  /** Fused confidence in [0, 1] — `min` or `product` of the sources. */
  readonly confidence: number;
  /** Raw source confidences, preserved so downstream can re-fuse. */
  readonly sourceConfidences: { track: number; corners: number };
  /**
   * OPTIONAL passthrough of the W204 `TrackedBox.label` (always present on
   * estimator output — `TrackedBox.label` is required). Carried through so
   * `./observe` can map `subjectEntityRefs` kinds via W204's
   * `FOOTBALL_LABEL_KINDS` instead of assuming "participant". NOT part of
   * the emitted observation payload (the contracts `LocalEntityRef` has
   * `entityId` + `kind` only).
   */
  readonly label?: string;
}

/** Options for {@link estimateSpatialState}; all fields optional. */
export interface SpatialStateOptions {
  /**
   * The video track's W103 affine clock mapping SOURCE `presentationMs`
   * onto the session timeline. Default: `identityClock("video")` — source
   * time IS session time (the honest fallback when no measured clock
   * exists; W103's single-anchor alignment produces exactly this when the
   * tracks share one source timeline).
   */
  readonly clock?: TrackClock;
  /**
   * How (track confidence, corner-set confidence) combine into the point
   * confidence: `"min"` (default — the bottleneck is honest) or
   * `"product"` (independent-error model). The raw values are preserved in
   * `sourceConfidences` either way, so the choice is recorded, not hidden.
   */
  readonly confidenceCombination?: "min" | "product";
}

/** The fused output: points ordered by (sessionMs, trackId) — stable. */
export interface SpatialStateSeries {
  /** Number of frames fused (including frames with zero tracks). */
  readonly frames: number;
  /** All points, ordered by (sessionMs, trackId); stable for equal keys. */
  readonly points: readonly SpatialStatePoint[];
  /** Count of points with `inBounds === false` (flagged, never clamped). */
  readonly outOfBounds: number;
}

/** Guards a confidence value that must survive verbatim into [0, 1] slots. */
function assertUnitConfidence(value: number, what: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(
      `estimateSpatialState: ${what} must be a finite number in [0, 1] ` +
        `(got ${String(value)}) — confidences must survive verbatim into contract-valid observations`,
    );
  }
}

/** Sorts by (sessionMs, trackId); 0 on full tie (stable sort keeps order). */
function compareBySessionThenTrack(a: SpatialStatePoint, b: SpatialStatePoint): number {
  if (a.sessionMs !== b.sessionMs) return a.sessionMs - b.sessionMs;
  if (a.trackId === b.trackId) return 0;
  return a.trackId < b.trackId ? -1 : 1;
}

/**
 * Fuses per-frame calibrations + tracked boxes into the timeline-aligned
 * pitch-space series (the W206 core).
 *
 * Per frame: `createPitchProjector(frame.cornerSet)` (W203 — the
 * homography is solved once per frame; unsupported corner orders and
 * degenerate geometries throw the W203 typed errors, fail-loud), then each
 * tracked box CENTER is projected — `project({ x: box.x + box.w / 2,
 * y: box.y + box.h / 2 })` — yielding pitch meters plus the `inBounds`
 * flag, both passed through verbatim (never clamped). The frame's
 * `presentationMs` is mapped onto the session timeline ONCE per frame via
 * {@link alignSessionMs} (W103), so every point of one frame carries the
 * same session time.
 *
 * Output ordering: points are sorted by (sessionMs, trackId) with a stable
 * sort. Deterministic: the same inputs always produce a deep-equal series.
 */
export function estimateSpatialState(
  frames: readonly SpatialFrame[],
  options?: SpatialStateOptions,
): SpatialStateSeries {
  const combination = options?.confidenceCombination ?? "min";
  if (combination !== "min" && combination !== "product") {
    throw new RangeError(
      `estimateSpatialState: confidenceCombination must be "min" or "product" ` +
        `(got ${String(combination)})`,
    );
  }
  const clock: TrackClock = options?.clock ?? identityClock("video");

  const points: SpatialStatePoint[] = [];
  for (const spatialFrame of frames) {
    // Per-frame camera calibration (W203). Solving here means a bad corner
    // set fails loud BEFORE any point is minted from it.
    const projector = createPitchProjector(spatialFrame.cornerSet);
    assertUnitConfidence(
      spatialFrame.cornerSet.confidence,
      `cornerSet.confidence (frameId "${spatialFrame.frame.frameId}")`,
    );
    // Session time for the WHOLE frame — one clock application per frame.
    const sessionMs = alignSessionMs(clock, spatialFrame.frame.presentationMs);

    for (const track of spatialFrame.tracks) {
      assertUnitConfidence(
        track.confidence,
        `track confidence (trackId "${track.trackId}", frameId "${spatialFrame.frame.frameId}")`,
      );
      // Box CENTER projection — the documented W206 convention (same
      // formula as W204's image-space emission, applied to the pitch map).
      const projected = projector.project({
        x: track.box.x + track.box.w / 2,
        y: track.box.y + track.box.h / 2,
      });
      points.push({
        trackId: track.trackId,
        frameId: spatialFrame.frame.frameId,
        sessionMs,
        pitch: { x: projected.x, y: projected.y },
        inBounds: projected.inBounds,
        confidence:
          combination === "min"
            ? Math.min(track.confidence, spatialFrame.cornerSet.confidence)
            : track.confidence * spatialFrame.cornerSet.confidence,
        sourceConfidences: {
          track: track.confidence,
          corners: spatialFrame.cornerSet.confidence,
        },
        label: track.label,
      });
    }
  }

  // (sessionMs, trackId) ordering — stable: equal keys keep the frame array
  // order, then the frame's detection order.
  points.sort(compareBySessionThenTrack);

  let outOfBounds = 0;
  for (const point of points) {
    if (!point.inBounds) outOfBounds += 1;
  }
  return { frames: frames.length, points, outOfBounds };
}
