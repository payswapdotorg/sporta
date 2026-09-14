/**
 * Spatial state estimation (W206).
 *
 * FUSES the three delivered seams into one SWM-facing spatial series:
 *
 * - W204 `TrackedBox`es (image-space player positions with persistent ids),
 * - W203 `FieldCornerSet`s (per-frame camera calibration), and
 * - W103 `TrackClock` (frame-native time -> canonical session timeline),
 *
 * producing per-frame, per-track PITCH-SPACE positions in canonical meters,
 * stamped in SESSION milliseconds — the W206 accept criterion ("player
 * locations/projected coordinates are time-aligned"). No new detection, no new
 * calibration, no new synchronization, and NO velocity (velocity is W205's
 * ball-state concern / later fusion) — this module projects, aligns, and fuses
 * confidence, nothing more.
 *
 * ## Documented rules (each pinned by tests)
 *
 * - **Projection**: per frame, `createPitchProjector(cornerSet)` (W203) is
 *   solved ONCE and each tracked box's CENTER (`box.x + box.w/2`,
 *   `box.y + box.h/2` — the same center-based convention as W204/W205
 *   emission) is projected into the canonical pitch frame. Out-of-pitch
 *   results keep their TRUE coordinates and are flagged `inBounds: false` —
 *   NEVER clamped (architecture-lock §4: explicit uncertainty, no invented
 *   certainty; W203 semantics `0 <= x <= 105 AND 0 <= y <= 68`).
 * - **Confidence fusion — explicit, no inflation**: `confidence` is the
 *   `"min"` (default) or `"product"` of the track's confidence and the corner
 *   set's confidence. The raw inputs are preserved VERBATIM in
 *   `sourceConfidences` so downstream can re-fuse differently — the
 *   combination CHOICE is a pure function of the options (callers should
 *   record which mode they requested; the series itself does not embed it,
 *   its shape is frozen by the W206 interface contract). Nothing is ever
 *   averaged or bumped (architecture-lock §6: no silent confidence collapse).
 * - **Time alignment**: each frame's `presentationMs` is SOURCE time on the
 *   video track's own clock; the W103 affine `TrackClock` maps it to
 *   `sessionMs` on the canonical session timeline (drift measured by W103, or
 *   the identity fallback). The default clock is `identityClock("video")`.
 * - **Determinism**: no RNG, no clock reads, no I/O, no `Date.now`. Frames
 *   are processed in ARRAY ORDER; the output `points` are sorted by
 *   (`sessionMs` asc, `trackId` asc, `frameId` asc — the final tie-break
 *   makes the order a total order, so the same inputs always produce a
 *   deep-equal output regardless of sort-stability guarantees).
 *
 * Fail-loud validation follows the repo convention (architecture-lock §13,
 * untrusted model outputs): malformed options throw
 * {@link SpatialStateOptionsError}, malformed frame/track/corner-set input
 * throws {@link SpatialStateInputError}, and degenerate camera geometry
 * surfaces W203's OWN typed errors unchanged from `createPitchProjector`.
 */
import { ENTITY_ID_PATTERN } from "@sporta/contracts";
import { createPitchProjector } from "@sporta/field-mapping";
import type { FieldCornerSet } from "@sporta/field-mapping";
import type { TrackedBox, TrackerFrameInput } from "@sporta/perception-tracking";
import { identityClock, toSessionMs } from "@sporta/timeline";
import type { TrackClock } from "@sporta/timeline";

/** Typed error for invalid estimator OPTIONS (fail loud, the repo convention). */
export class SpatialStateOptionsError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "SpatialStateOptionsError";
  }
}

/** Typed error for malformed FRAME INPUT (fail loud; nothing is fabricated). */
export class SpatialStateInputError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "SpatialStateInputError";
  }
}

/** How track confidence and corner-set confidence combine into one number. */
export type ConfidenceCombination = "min" | "product";

/** One frame's worth of fusion input: tracker frame + calibration + tracks. */
export interface SpatialFrame {
  /** The W204 tracker frame (frameId, presentationMs, decodeOrder, sceneCut?). */
  readonly frame: TrackerFrameInput;
  /** The frame's calibrated corner set (W203 seam; per-frame camera). */
  readonly cornerSet: FieldCornerSet;
  /** The frame's tracked boxes (W204 seam), in the tracker's output order. */
  readonly tracks: readonly TrackedBox[];
}

/** One fused spatial state point (see module docs for every convention). */
export interface SpatialStatePoint {
  /** W204 track id — identity PASSTHROUGH (never re-issued or re-mapped). */
  readonly trackId: string;
  /** Frame id the point was fused on. */
  readonly frameId: string;
  /** Timeline-aligned position: `toSessionMs(clock, presentationMs)` (3.2). */
  readonly sessionMs: number;
  /** Projected box center, in METERS on the canonical 105 x 68 pitch frame. */
  readonly pitch: { x: number; y: number };
  /** W203 semantics: `0 <= x <= 105 AND 0 <= y <= 68`; flagged, never clamped. */
  readonly inBounds: boolean;
  /** Fused confidence (`"min"` or `"product"` of the two sources below). */
  readonly confidence: number;
  /** Raw source confidences, preserved verbatim for downstream re-fusion. */
  readonly sourceConfidences: { track: number; corners: number };
  /**
   * The tracked box's class label (W204 passthrough), carried through the
   * fusion so SWM emission can map label -> entity kind via W204's
   * `FOOTBALL_LABEL_KINDS`. Optional because the W206 interface contract
   * freezes the point shape: hand-built series may omit it, in which case
   * emission falls back to the documented `participant` default.
   */
  readonly label?: string;
}

/** Options for {@link estimateSpatialState}; all fields optional. */
export interface SpatialStateOptions {
  /**
   * The W103 clock mapping the video track's SOURCE time onto the session
   * timeline. Default: `identityClock("video")` — source time IS session time
   * (the honest fallback when no W103 alignment exists yet).
   */
  readonly clock?: TrackClock;
  /**
   * Confidence combination: `"min"` (default — the bottleneck is honest) or
   * `"product"`. Both preserve the raw values in `sourceConfidences`.
   */
  readonly confidenceCombination?: ConfidenceCombination;
}

/** The fused spatial series (see module docs for ordering and counts). */
export interface SpatialStateSeries {
  /** Number of frames PROCESSED (the input array length, including empty ones). */
  readonly frames: number;
  /** All fused points, ordered by (`sessionMs`, `trackId`, `frameId`). */
  readonly points: SpatialStatePoint[];
  /** Count of points with `inBounds === false` (out-of-play, flagged). */
  readonly outOfBounds: number;
}

// ---------------------------------------------------------------------------
// Validation (fail loud)
// ---------------------------------------------------------------------------

function assertFinite(value: unknown, what: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SpatialStateInputError(
      `spatial state: ${what} must be a finite number (got ${String(value)})`,
    );
  }
}

function assertConfidence(value: unknown, what: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new SpatialStateInputError(
      `spatial state: ${what} must be a number in [0, 1] (got ${String(value)})`,
    );
  }
}

/** Validates estimator options; throws {@link SpatialStateOptionsError}. */
function validateOptions(options: SpatialStateOptions): void {
  if (options === null || typeof options !== "object") {
    throw new SpatialStateOptionsError("spatial state: options must be an object");
  }
  const combination = options.confidenceCombination ?? "min";
  if (combination !== "min" && combination !== "product") {
    throw new SpatialStateOptionsError(
      `spatial state: confidenceCombination must be "min" or "product" ` +
        `(got ${String(options.confidenceCombination)})`,
    );
  }
  const clock = options.clock;
  if (clock !== undefined) {
    if (clock === null || typeof clock !== "object") {
      throw new SpatialStateOptionsError("spatial state: clock must be a TrackClock when provided");
    }
    if (typeof clock.trackId !== "string" || clock.trackId.length < 1) {
      throw new SpatialStateOptionsError(
        `spatial state: clock.trackId must be a non-empty string (got ${String(clock.trackId)})`,
      );
    }
    if (typeof clock.offsetMs !== "number" || !Number.isFinite(clock.offsetMs)) {
      throw new SpatialStateOptionsError(
        `spatial state: clock.offsetMs must be finite (got ${String(clock.offsetMs)})`,
      );
    }
    if (typeof clock.driftPpm !== "number" || !Number.isFinite(clock.driftPpm)) {
      throw new SpatialStateOptionsError(
        `spatial state: clock.driftPpm must be finite (got ${String(clock.driftPpm)})`,
      );
    }
    // The degenerate non-invertible-rate bound is W103's; toSessionMs enforces
    // it per mapping call (every frame maps, so it is always enforced in a
    // non-empty run).
  }
}

/** Validates one tracked box; throws {@link SpatialStateInputError}. */
function validateTrack(track: TrackedBox, where: string): void {
  if (track === null || typeof track !== "object") {
    throw new SpatialStateInputError(`spatial state: ${where} must be an object`);
  }
  if (typeof track.trackId !== "string" || !ENTITY_ID_PATTERN.test(track.trackId)) {
    throw new SpatialStateInputError(
      `spatial state: ${where}.trackId must match the contracts EntityId pattern ` +
        `[A-Za-z0-9_-]{1,64} (got ${String(track.trackId)})`,
    );
  }
  if (typeof track.label !== "string" || track.label.length < 1) {
    throw new SpatialStateInputError(
      `spatial state: ${where}.label must be a non-empty string (got ${String(track.label)})`,
    );
  }
  assertConfidence(track.confidence, `${where}.confidence`);
  const box = track.box;
  if (box === null || typeof box !== "object") {
    throw new SpatialStateInputError(`spatial state: ${where}.box must be an object`);
  }
  for (const field of [box.x, box.y, box.w, box.h] as const) {
    if (typeof field !== "number" || !Number.isFinite(field) || field < 0 || field > 1) {
      throw new SpatialStateInputError(
        `spatial state: ${where}.box fields must be numbers in [0, 1] ` +
          `(contract NormalizedBox; got ${String(field)})`,
      );
    }
  }
}

/** Validates one corner set; throws {@link SpatialStateInputError}. */
function validateCornerSet(cornerSet: FieldCornerSet, where: string): void {
  if (cornerSet === null || typeof cornerSet !== "object") {
    throw new SpatialStateInputError(`spatial state: ${where}.cornerSet must be an object`);
  }
  if (!Array.isArray(cornerSet.corners) || cornerSet.corners.length !== 4) {
    throw new SpatialStateInputError(
      `spatial state: ${where}.cornerSet.corners must be an array of exactly 4 points`,
    );
  }
  for (const [index, corner] of cornerSet.corners.entries()) {
    if (corner === null || typeof corner !== "object") {
      throw new SpatialStateInputError(
        `spatial state: ${where}.cornerSet.corners[${index}] must be an object`,
      );
    }
    assertFinite(corner.x, `${where}.cornerSet.corners[${index}].x`);
    assertFinite(corner.y, `${where}.cornerSet.corners[${index}].y`);
  }
  if (typeof cornerSet.cornerOrder !== "string" || cornerSet.cornerOrder.length < 1) {
    throw new SpatialStateInputError(
      `spatial state: ${where}.cornerSet.cornerOrder must be a non-empty string ` +
        `(the canonical W203 order is enforced by createPitchProjector)`,
    );
  }
  assertConfidence(cornerSet.confidence, `${where}.cornerSet.confidence`);
}

/** Validates the frame input surface; throws {@link SpatialStateInputError}. */
function validateFrames(frames: readonly SpatialFrame[]): void {
  if (!Array.isArray(frames)) {
    throw new SpatialStateInputError("spatial state: frames must be an array");
  }
  for (const [index, frame] of frames.entries()) {
    const where = `frames[${index}]`;
    if (frame === null || typeof frame !== "object") {
      throw new SpatialStateInputError(`spatial state: ${where} must be an object`);
    }
    if (frame.frame === null || typeof frame.frame !== "object") {
      throw new SpatialStateInputError(`spatial state: ${where}.frame must be an object`);
    }
    if (typeof frame.frame.frameId !== "string" || frame.frame.frameId.length < 1) {
      throw new SpatialStateInputError(
        `spatial state: ${where}.frame.frameId must be a non-empty string`,
      );
    }
    // presentationMs is SOURCE time on the video track's own clock: FINITE is
    // required, non-negativity is NOT (a negative source position with a
    // positive clock offset is legitimate pre-alignment data; the session
    // timeline's non-negativity is enforced at OBSERVATION emission, where the
    // contracts TimelinePoint schema demands it).
    assertFinite(frame.frame.presentationMs, `${where}.frame.presentationMs`);
    validateCornerSet(frame.cornerSet, where);
    if (!Array.isArray(frame.tracks)) {
      throw new SpatialStateInputError(`spatial state: ${where}.tracks must be an array`);
    }
    for (const [trackIndex, track] of frame.tracks.entries()) {
      validateTrack(track, `${where}.tracks[${trackIndex}]`);
    }
  }
}

// ---------------------------------------------------------------------------
// Fusion
// ---------------------------------------------------------------------------

/** Combines the two confidences per the documented mode (module docs). */
function combineConfidences(track: number, corners: number, mode: ConfidenceCombination): number {
  return mode === "min" ? Math.min(track, corners) : track * corners;
}

/** Total-order comparator: sessionMs asc, then trackId asc, then frameId asc. */
function comparePoints(a: SpatialStatePoint, b: SpatialStatePoint): number {
  if (a.sessionMs !== b.sessionMs) return a.sessionMs < b.sessionMs ? -1 : 1;
  if (a.trackId !== b.trackId) return a.trackId < b.trackId ? -1 : 1;
  if (a.frameId !== b.frameId) return a.frameId < b.frameId ? -1 : 1;
  return 0;
}

/**
 * Estimates the spatial state series from the fused frames.
 *
 * Per frame (ARRAY ORDER — the caller's order is the processing order):
 * solve the W203 projector from the frame's corner set (once per frame; a
 * degenerate or unsupported corner set surfaces W203's typed errors
 * unchanged), map the frame's `presentationMs` through the clock, and project
 * every tracked box's CENTER into pitch meters. The output points are then
 * sorted by (`sessionMs`, `trackId`, `frameId`) — see the module docs for why
 * the order is total. `frames` counts the input array length;
 * `outOfBounds` counts `inBounds === false` points.
 *
 * Pure and deterministic: the same `(frames, options)` always produce a
 * deep-equal {@link SpatialStateSeries} (no RNG, no clock reads, no I/O).
 */
export function estimateSpatialState(
  frames: readonly SpatialFrame[],
  options?: SpatialStateOptions,
): SpatialStateSeries {
  const resolved: SpatialStateOptions = options ?? {};
  validateOptions(resolved);
  validateFrames(frames);

  const clock: TrackClock = resolved.clock ?? identityClock("video");
  const combination: ConfidenceCombination = resolved.confidenceCombination ?? "min";

  const points: SpatialStatePoint[] = [];
  let outOfBounds = 0;

  for (const frame of frames) {
    // W203 seam: solve the homography ONCE per frame; typed errors (degenerate
    // correspondence, unsupported corner order) propagate unchanged — this
    // package never silently repairs camera geometry it cannot trust.
    const projector = createPitchProjector(frame.cornerSet);
    const sessionMs = toSessionMs(clock, frame.frame.presentationMs);

    for (const track of frame.tracks) {
      const projected = projector.project({
        x: track.box.x + track.box.w / 2,
        y: track.box.y + track.box.h / 2,
      });
      if (!projected.inBounds) outOfBounds += 1;
      points.push({
        trackId: track.trackId,
        frameId: frame.frame.frameId,
        sessionMs,
        pitch: { x: projected.x, y: projected.y },
        inBounds: projected.inBounds,
        confidence: combineConfidences(track.confidence, frame.cornerSet.confidence, combination),
        sourceConfidences: { track: track.confidence, corners: frame.cornerSet.confidence },
        label: track.label,
      });
    }
  }

  points.sort(comparePoints);
  return { frames: frames.length, points, outOfBounds };
}
