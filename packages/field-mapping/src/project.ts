/**
 * Image -> pitch projection service (W203).
 *
 * `createPitchProjector` solves the homography from a corner set ONCE (at
 * creation — projecting never re-solves) and returns a pure {@link
 * PitchProjector}: image-normalized coordinates in, canonical pitch meters
 * out. This is the seam W206 (spatial state estimation) consumes.
 *
 * Out-of-play semantics: image points may legitimately project OUTSIDE the
 * pitch (out-of-play areas, points off the visible window). Such results are
 * flagged via `inBounds: false` and NEVER clamped — clamping would silently
 * invent in-play positions (architecture-lock §4: explicit uncertainty, no
 * invented certainty).
 */
import {
  PITCH_LENGTH_AXIS_METERS,
  PITCH_WIDTH_AXIS_METERS,
  type PitchPoint,
} from "@sporta/contracts";
import type { DetectionPayload } from "@sporta/contracts";
import { applyHomography, solveHomography, type Point2D } from "./homography";
import { CANONICAL_CORNER_ORDER, CANONICAL_PITCH_CORNERS, type FieldCornerSet } from "./calibrator";
import { UnsupportedCornerOrderError } from "./errors";

/** Bounding box in normalized image coordinates `[0, 1]` (contract-derived). */
export type NormalizedBox = DetectionPayload["box"];

/** An image point's projection into the canonical pitch frame. */
export type ProjectedPitchPoint = PitchPoint & { inBounds: boolean };

/** A normalized box's projection: center + four corners, in pitch meters. */
export interface ProjectedBox {
  /** Projection of the box center `((x + w/2), (y + h/2))`. */
  readonly center: PitchPoint;
  /** Projections of the box corners, image order: tl, tr, br, bl. */
  readonly corners: PitchPoint[];
  /** `true` iff the projected center AND all four corners are in bounds. */
  readonly inBounds: boolean;
}

/**
 * The projection service: pure, deterministic image -> pitch mapping built
 * from one calibrated corner set.
 */
export interface PitchProjector {
  /**
   * Projects one image point into the canonical pitch frame (meters).
   * `inBounds` is `0 <= x <= 105 AND 0 <= y <= 68`; out-of-bounds results are
   * returned unclamped.
   */
  project(imagePoint: Point2D): ProjectedPitchPoint;
  /** Projects a normalized box's center and four corners. */
  projectBox(box: NormalizedBox): ProjectedBox;
}

function inPitchBounds(point: { x: number; y: number }): boolean {
  return (
    point.x >= 0 &&
    point.x <= PITCH_LENGTH_AXIS_METERS &&
    point.y >= 0 &&
    point.y <= PITCH_WIDTH_AXIS_METERS
  );
}

/**
 * Builds a {@link PitchProjector} from a calibrated corner set.
 *
 * The homography is solved ONCE here, pairing `corners[i]` with the canonical
 * pitch corner `CANONICAL_PITCH_CORNERS[i]` when `cornerOrder` is the
 * documented default {@link CANONICAL_CORNER_ORDER} (`"tl, tr, br, bl"`;
 * top-left = touchline corner nearest the origin). Any other order string
 * throws {@link UnsupportedCornerOrderError} — W203 deliberately supports only
 * the documented order (extensibility later).
 *
 * Consistency guarantee (the W203 accept criterion): for a FIXED corner set
 * the projector is pure — repeated projection of the same point returns
 * identical results — and pitch-frame distances are metric-consistent with
 * the corner geometry (a box spanning half the image width maps to half the
 * visible pitch width).
 */
export function createPitchProjector(cornerSet: FieldCornerSet): PitchProjector {
  if (cornerSet.cornerOrder !== CANONICAL_CORNER_ORDER) {
    throw new UnsupportedCornerOrderError(
      `createPitchProjector: unsupported cornerOrder "${cornerSet.cornerOrder}" — W203 ` +
        `supports only the canonical "${CANONICAL_CORNER_ORDER}" producer order`,
      { cornerOrder: cornerSet.cornerOrder, supported: CANONICAL_CORNER_ORDER },
    );
  }
  const homography = solveHomography(cornerSet.corners, [...CANONICAL_PITCH_CORNERS]);

  return {
    project(imagePoint: Point2D): ProjectedPitchPoint {
      const projected = applyHomography(homography, imagePoint);
      return { x: projected.x, y: projected.y, inBounds: inPitchBounds(projected) };
    },
    projectBox(box: NormalizedBox): ProjectedBox {
      const center = applyHomography(homography, {
        x: box.x + box.w / 2,
        y: box.y + box.h / 2,
      });
      const imageCorners: readonly Point2D[] = [
        { x: box.x, y: box.y },
        { x: box.x + box.w, y: box.y },
        { x: box.x + box.w, y: box.y + box.h },
        { x: box.x, y: box.y + box.h },
      ];
      const corners = imageCorners.map((corner) => applyHomography(homography, corner));
      return {
        center,
        corners,
        inBounds: inPitchBounds(center) && corners.every((corner) => inPitchBounds(corner)),
      };
    },
  };
}
