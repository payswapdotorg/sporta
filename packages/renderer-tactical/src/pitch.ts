/**
 * Pitch-layout arithmetic for the tactical 2D view (R301).
 *
 * Maps the canonical W601 scene coordinate space (meters, right-handed,
 * origin at the corner, x along the touchline 0-105, y along the goal line
 * 0-68 — `@sporta/scene-projection`) onto the pixel raster with a UNIFORM
 * scale, so circles stay circles. Pure math, no I/O.
 */

/** The tactical view's uniform margin around the pitch (pixels). */
export const PITCH_MARGIN_PX = 24;

/** The width of the bottom overlay band (score/clock + event ticker), pixels. */
export const OVERLAY_BAND_PX = 46;

/**
 * The pixel-space layout of the pitch inside a frame. All values are derived
 * deterministically from (width, height): the pitch is scaled uniformly to
 * fit the play area above the overlay band, centered horizontally, and
 * top-anchored with the margin.
 */
export interface PitchLayout {
  /** Frame width in pixels. */
  width: number;
  /** Frame height in pixels. */
  height: number;
  /** Uniform meters→pixels scale. */
  scale: number;
  /** The pitch's top-left pixel (the (0,0) corner in meters). */
  originX: number;
  originY: number;
  /** Pitch pixel width (105 m at `scale`). */
  pitchWidthPx: number;
  /** Pitch pixel height (68 m at `scale`). */
  pitchHeightPx: number;
}

/** Builds the layout for a frame of `width`×`height` pixels. */
export function pitchLayout(width: number, height: number): PitchLayout {
  const playWidth = width - PITCH_MARGIN_PX * 2;
  const playHeight = height - PITCH_MARGIN_PX * 2 - OVERLAY_BAND_PX;
  if (playWidth < 100 || playHeight < 60) {
    throw new RangeError(
      `frame ${width}x${height} leaves no usable play area for the tactical pitch`,
    );
  }
  const scale = Math.min(playWidth / 105, playHeight / 68);
  const pitchWidthPx = 105 * scale;
  const pitchHeightPx = 68 * scale;
  return {
    width,
    height,
    scale,
    originX: (width - pitchWidthPx) / 2,
    originY: PITCH_MARGIN_PX,
    pitchWidthPx,
    pitchHeightPx,
  };
}

/** Projects a scene point (meters) to pixel space. */
export function toPixels(
  layout: PitchLayout,
  point: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: layout.originX + point.x * layout.scale,
    y: layout.originY + point.y * layout.scale,
  };
}
