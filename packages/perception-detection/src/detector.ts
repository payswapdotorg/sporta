/**
 * Provider-neutral detector seam (W201).
 *
 * Architecture-lock §9 (vendor neutrality): no core contract may hard-code a
 * single AI-model provider. Real ML backends arrive with the GPU worker
 * protocol (W303); until then every detector — fixture or real — sits behind
 * the {@link DetectorAdapter} interface, and everything downstream (the
 * benchmark harness, observation emission) is written against this seam only.
 *
 * The input is one decoded video frame in the normalized internal
 * representation (`NormalizedVideoFrame`, W102): rgb24 pixels plus the frame's
 * position on the normalized media timeline (architecture-lock §3). The output
 * is per-frame boxes + labels + confidence — DETECTION-level only. Identity
 * and tracking are W204's concern, so a detection never carries an entity id.
 */
import type { DetectionPayload } from "@sporta/contracts";

/**
 * Bounding box in normalized image coordinates: `x`/`y`/`w`/`h` each in
 * [0, 1] (the same shape the contracts `DetectionPayload` constrains).
 *
 * Derived from the exported contract payload type rather than re-declared, so
 * the two cannot drift. Note the contract schema bounds each FIELD
 * independently: `x + w` may exceed 1 for hand-built boxes (the fixture
 * detector clamps every edge into the unit square, and `iou` clamps before
 * intersecting).
 */
export type NormalizedBox = DetectionPayload["box"];

/**
 * One detected object in one frame: a normalized box, a class label, and the
 * detector's confidence in [0, 1].
 *
 * Detection-level only by design: no entity id, no track, no velocity —
 * identity/tracking is W204. Confidence is preserved verbatim downstream
 * (architecture-lock §6: no silent confidence collapse).
 */
export interface DetectedBox {
  readonly box: NormalizedBox;
  readonly label: string;
  readonly confidence: number;
}

/**
 * One video frame offered to a detector, shaped after the W102
 * `NormalizedVideoFrame` (the fields a detector needs; the full decoding type
 * is assignable to this input).
 *
 * `bytes` is rgb24, `width * height * 3` — decoding already ENFORCED that
 * invariant (architecture-lock §13, untrusted media), so adapters do not
 * re-validate byte volume; they may inspect pixel content or ignore it.
 */
export interface DetectorFrameInput {
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
  /** Stream the frame was decoded from. */
  readonly streamIndex: number;
}

/**
 * The provider-neutral detector seam: one method, per-frame, in and out.
 *
 * Implementations may be synchronous (fixture, local models) or asynchronous
 * (remote/GPU workers — W303); the return union lets a pipeline `await` both
 * uniformly. `detectorId` doubles as the `componentId` stamped on emitted
 * observations, so every observation names the component that produced it.
 */
export interface DetectorAdapter {
  /** Component id used on observations emitted from this adapter's output. */
  readonly detectorId: string;
  /** Runs detection on one frame; one {@link DetectedBox} per found object. */
  detect(frame: DetectorFrameInput): Promise<readonly DetectedBox[]> | readonly DetectedBox[];
}
