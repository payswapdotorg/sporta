/**
 * Provider-neutral field-calibrator seam + the deterministic fixture camera
 * (W203).
 *
 * Architecture-lock §9 (vendor neutrality): real CV corner detection arrives
 * with the GPU worker protocol (W303); until then every calibrator — fixture
 * or real — sits behind the {@link FieldCalibratorAdapter} interface, and
 * everything downstream (the pitch projector, observation emission) is
 * written against this seam only.
 *
 * The seam's vocabulary is the {@link CANONICAL_CORNER_ORDER} producer order:
 * a corner set's `corners[i]` is the image position of the CANONICAL pitch
 * corner `CANONICAL_PITCH_CORNERS[i]`. Corners currently outside the frame
 * carry extrapolated coordinates outside `[0, 1]` (that is exactly what makes
 * the homography recoverable from the corner set — the
 * `cameraHomographyRef` on emitted observations documents this).
 */
import {
  PITCH_LENGTH_AXIS_METERS,
  PITCH_WIDTH_AXIS_METERS,
  type PitchPoint,
} from "@sporta/contracts";
import type { Point2D } from "./homography";

/**
 * The canonical producer corner order supported in W203: `"tl, tr, br, bl"`.
 * Index semantics: `corners[0]` is the touchline corner nearest the pitch
 * origin (canonical `(0, 0)` — it appears TOP-LEFT in a canonical whole-pitch
 * view), `corners[1]` is `(105, 0)`, `corners[2]` is `(105, 68)`, `corners[3]`
 * is `(0, 68)`. Any other `cornerOrder` string is rejected by the projector
 * with a typed error (extensibility is deliberate future work, not a W203
 * concern).
 */
export const CANONICAL_CORNER_ORDER = "tl, tr, br, bl";

/**
 * The four canonical pitch corners (frozen `PitchFrame`: 105 x 68 m, corner
 * origin, x = touchline, y = goal-line), in {@link CANONICAL_CORNER_ORDER}
 * order. Pairing a corner set's entries with these (via `solveHomography`)
 * recovers the image -> pitch homography.
 */
export const CANONICAL_PITCH_CORNERS: readonly PitchPoint[] = [
  { x: 0, y: 0 },
  { x: PITCH_LENGTH_AXIS_METERS, y: 0 },
  { x: PITCH_LENGTH_AXIS_METERS, y: PITCH_WIDTH_AXIS_METERS },
  { x: 0, y: PITCH_WIDTH_AXIS_METERS },
];

/**
 * One calibrated field corner set: the four pitch corners' positions in
 * normalized image coordinates (the frame spans `[0, 1]²`; off-frame corners
 * may carry coordinates outside it), the documented producer order, and the
 * calibrator's confidence in `[0, 1]`.
 */
export interface FieldCornerSet {
  /** Image positions of the four canonical pitch corners, ORDERED. */
  readonly corners: [Point2D, Point2D, Point2D, Point2D];
  /** Documented producer order (see {@link CANONICAL_CORNER_ORDER}). */
  readonly cornerOrder: string;
  /** Confidence in [0, 1] for the whole corner set. */
  readonly confidence: number;
}

/**
 * One video frame offered to a field calibrator, shaped after the W102
 * `NormalizedVideoFrame` fields the seam needs (the full decoding type is
 * assignable to this input).
 *
 * `bytes` is rgb24, `width * height * 3` — decoding already ENFORCED that
 * invariant (architecture-lock §13, untrusted media), so adapters do not
 * re-validate byte volume; they may inspect pixel content or ignore it.
 */
export interface CalibratorFrameInput {
  /** Frame id (`f-<streamIndex>-<decodeOrder>` in the decoding convention). */
  readonly frameId: string;
  /** Presentation position on the media timeline (milliseconds). */
  readonly presentationMs: number;
  /** Frame width in pixels. */
  readonly width: number;
  /** Frame height in pixels. */
  readonly height: number;
  /** Frame pixels: rgb24, `width * height * 3` (validated upstream). */
  readonly bytes: Uint8Array;
  /** Decode-order position within the decode call, starting at 0. */
  readonly decodeOrder: number;
}

/**
 * The provider-neutral field-calibrator seam: one method, per-frame, in and
 * out. Implementations may be synchronous (fixture, local models) or
 * asynchronous (remote/GPU workers — W303); the return union lets a pipeline
 * `await` both uniformly. `calibratorId` doubles as the `componentId` stamped
 * on emitted observations, so every observation names the component that
 * produced it.
 */
export interface FieldCalibratorAdapter {
  /** Component id used on observations emitted from this adapter's output. */
  readonly calibratorId: string;
  /** Locates the four pitch corners in one frame. */
  calibrate(frame: CalibratorFrameInput): Promise<FieldCornerSet> | FieldCornerSet;
}

// ---------------------------------------------------------------------------
// Fixture camera
// ---------------------------------------------------------------------------

/**
 * The deterministic synthetic camera specification.
 *
 * - `pan` in [0, 1]: horizontal camera position — 0 slides the visible
 *   window flush against the low-x touchline end, 1 flush against the
 *   high-x end (see the model docs on {@link FixtureFieldCalibrator});
 * - `zoom` >= 1: 1 = half the pitch visible per axis (52.5 m of the 105 m
 *   touchline), 2 = a quarter (26.25 m), i.e. each unit of zoom halves the
 *   visible extent again;
 * - `jitter` >= 0: per-corner deterministic perturbation magnitude in
 *   normalized image units (0 default; values far below 1 are meaningful —
 *   see the jitter formula in the class docs).
 */
export interface FixtureCameraSpec {
  readonly pan: number;
  readonly zoom: number;
  readonly jitter: number;
}

/** Fixed confidence the fixture calibrator reports for every corner set. */
export const FIXTURE_CALIBRATOR_CONFIDENCE = 0.9;

/** Default component id for {@link FixtureFieldCalibrator} instances. */
export const FIXTURE_CALIBRATOR_DEFAULT_ID = "fixture-field-calibrator";

function validateSpec(spec: FixtureCameraSpec): void {
  // Fail loud at construction (the repo convention) rather than emitting
  // geometry later that silently violates the documented camera model.
  if (typeof spec.pan !== "number" || !Number.isFinite(spec.pan) || spec.pan < 0 || spec.pan > 1) {
    throw new RangeError(
      `fixture camera spec: pan must be a finite number in [0, 1] (got ${spec.pan})`,
    );
  }
  if (typeof spec.zoom !== "number" || !Number.isFinite(spec.zoom) || spec.zoom < 1) {
    throw new RangeError(
      `fixture camera spec: zoom must be a finite number >= 1 (got ${spec.zoom})`,
    );
  }
  if (typeof spec.jitter !== "number" || !Number.isFinite(spec.jitter) || spec.jitter < 0) {
    throw new RangeError(
      `fixture camera spec: jitter must be a finite number >= 0 (got ${spec.jitter})`,
    );
  }
}

/**
 * The deterministic fixture {@link FieldCalibratorAdapter}.
 *
 * SYNTHETIC CAMERA MODEL (documented once, honored exactly): with zoom `z`
 * and pan `p`, the visible pitch window is
 *
 * ```text
 *   visLength = (PITCH_LENGTH / 2) / z        // 52.5 m at z=1, 26.25 at z=2
 *   visWidth  = (PITCH_WIDTH  / 2) / z         // 34 m at z=1, 17 at z=2
 *   x0 = p * (PITCH_LENGTH - visLength)       // pan slides along the touchline
 *   y0 = (PITCH_WIDTH - visWidth) / 2          // vertically centered
 * ```
 *
 * and the camera projects pitch to image LINEARLY (affine, axis-aligned):
 *
 * ```text
 *   u = (X - x0) / visLength        v = (Y - y0) / visWidth
 * ```
 *
 * so the visible rectangle maps exactly onto the image `[0, 1]²`. The emitted
 * `corners[i]` is the image position of canonical pitch corner `i` — corners
 * outside the current view carry extrapolated coordinates outside `[0, 1]`
 * (e.g. zoom 1, pan 0.5 puts corner 0 at `(-0.5, -0.5)` and corner 2 at
 * `(1.5, 1.5)`), which is precisely what makes the homography recoverable
 * from the corner set.
 *
 * JITTER (bounded, reproducible, NO `Math.random`): each corner `i` of the
 * frame with `decodeOrder d` is offset — on BOTH axes — by
 *
 * ```text
 *   delta = ((d * 7 + i * 13) % 100) / 100 * jitter      // in [0, 0.99*jitter]
 * ```
 *
 * `decodeOrder` is assumed >= 0 (it is a decode-call counter by the W102
 * contract). With `jitter = 0` the corners are the exact model values.
 *
 * The fixture IGNORES the pixel bytes, `width`, `height`, `frameId`, and
 * `presentationMs` — the output is a pure function of `(spec,
 * frame.decodeOrder)`. A real CV calibrator would not ignore pixels; that is
 * exactly the difference this fixture documents.
 */
export class FixtureFieldCalibrator implements FieldCalibratorAdapter {
  readonly calibratorId: string;
  private readonly spec: FixtureCameraSpec;
  private readonly visibleLength: number;
  private readonly visibleWidth: number;
  private readonly windowX0: number;
  private readonly windowY0: number;

  constructor(spec: FixtureCameraSpec, calibratorId: string = FIXTURE_CALIBRATOR_DEFAULT_ID) {
    validateSpec(spec);
    if (typeof calibratorId !== "string" || calibratorId.length < 1) {
      throw new RangeError(
        `fixture camera spec: calibratorId must be a non-empty string (got ${calibratorId})`,
      );
    }
    this.spec = spec;
    this.calibratorId = calibratorId;
    this.visibleLength = PITCH_LENGTH_AXIS_METERS / 2 / spec.zoom;
    this.visibleWidth = PITCH_WIDTH_AXIS_METERS / 2 / spec.zoom;
    this.windowX0 = spec.pan * (PITCH_LENGTH_AXIS_METERS - this.visibleLength);
    this.windowY0 = (PITCH_WIDTH_AXIS_METERS - this.visibleWidth) / 2;
  }

  calibrate(frame: CalibratorFrameInput): FieldCornerSet {
    const corners = CANONICAL_PITCH_CORNERS.map((pitchCorner, cornerIndex) => {
      const u = (pitchCorner.x - this.windowX0) / this.visibleLength;
      const v = (pitchCorner.y - this.windowY0) / this.visibleWidth;
      const delta = (((frame.decodeOrder * 7 + cornerIndex * 13) % 100) / 100) * this.spec.jitter;
      return { x: u + delta, y: v + delta };
    }) as [Point2D, Point2D, Point2D, Point2D];
    return {
      corners,
      cornerOrder: CANONICAL_CORNER_ORDER,
      confidence: FIXTURE_CALIBRATOR_CONFIDENCE,
    };
  }
}
