import { describe, expect, test } from "bun:test";
import {
  CANVAS_H,
  CANVAS_W,
  CAPTION_BAND_Y,
  MARGIN,
  PITCH_CENTER_X,
  PITCH_CENTER_Y,
  PITCH_LEFT,
  PITCH_MARKINGS,
  PITCH_RECT,
  PITCH_TOP,
  SCALE,
  classifyPosition,
  round2,
  toCanvas,
  toCanvasRounded,
} from "../src/index";

describe("canvas constants (documented math)", () => {
  test("canvas 1170 × 880: 2×60 margin + 1050×680 pitch + 60 margin + 80 caption band", () => {
    expect(CANVAS_W).toBe(1170);
    expect(CANVAS_H).toBe(880);
    expect(MARGIN).toBe(60);
    expect(SCALE).toBe(10);
    expect(PITCH_RECT).toEqual({ x: 60, y: 60, w: 1050, h: 680 });
    expect(CAPTION_BAND_Y).toBe(800);
    expect(PITCH_LEFT).toBe(60);
    expect(PITCH_TOP).toBe(60);
  });

  test("pitch center = (585, 400) — halfway line at 52.5 m, center line at 34 m", () => {
    expect(PITCH_CENTER_X).toBe(585);
    expect(PITCH_CENTER_Y).toBe(400);
  });
});

describe("toCanvas — the exact affine projection", () => {
  test("corner origin (0,0) → (60,60); far corner (105,68) → (1110,740)", () => {
    expect(toCanvas({ x: 0, y: 0 })).toEqual({ x: 60, y: 60 });
    expect(toCanvas({ x: 105, y: 68 })).toEqual({ x: 1110, y: 740 });
  });

  test("pitch center (52.5, 34) → (585, 400)", () => {
    expect(toCanvas({ x: 52.5, y: 34 })).toEqual({ x: 585, y: 400 });
  });

  test("exact projected values for fixture positions (mapping math pinned)", () => {
    expect(toCanvas({ x: 52.5, y: 34 })).toEqual({ x: 585, y: 400 });
    expect(toCanvas({ x: 53.3, y: 34 })).toEqual({ x: 593, y: 400 });
    expect(toCanvas({ x: 50.5, y: 34.5 })).toEqual({ x: 565, y: 405 });
    expect(toCanvas({ x: 30, y: 20 })).toEqual({ x: 360, y: 260 });
  });

  test("NEVER clamped: out-of-bounds positions project to their TRUE coordinates", () => {
    expect(toCanvas({ x: -3, y: 34 })).toEqual({ x: 30, y: 400 }); // near zone
    expect(toCanvas({ x: 120, y: 34 })).toEqual({ x: 1260, y: 400 }); // off canvas
    expect(toCanvas({ x: 52.5, y: 75 })).toEqual({ x: 585, y: 810 }); // over caption band
    expect(toCanvas({ x: -30, y: -30 })).toEqual({ x: -240, y: -240 }); // far outside
  });

  test("rounding is display-only: round2 to exact 2-decimal values", () => {
    expect(round2(585)).toBe(585);
    expect(round2(592.999999)).toBe(593);
    expect(round2(400.005)).toBe(400.01);
    expect(toCanvasRounded({ x: 52.5049, y: 34 })).toEqual({ x: 585.05, y: 400 });
  });
});

describe("classifyPosition — boundary semantics (test-pinned)", () => {
  test("in-play: pitch bounds inclusive (the lines are part of the pitch)", () => {
    expect(classifyPosition({ x: 0, y: 0 })).toBe("in-play");
    expect(classifyPosition({ x: 105, y: 68 })).toBe("in-play");
    expect(classifyPosition({ x: 0, y: 34 })).toBe("in-play");
    expect(classifyPosition({ x: 105, y: 34 })).toBe("in-play");
    expect(classifyPosition({ x: 52.5, y: 0 })).toBe("in-play");
    expect(classifyPosition({ x: 52.5, y: 68 })).toBe("in-play");
    expect(classifyPosition({ x: 52.5, y: 34 })).toBe("in-play");
  });

  test("just outside the lines is out-of-play-near (drawable margin)", () => {
    expect(classifyPosition({ x: -0.1, y: 34 })).toBe("out-of-play-near");
    expect(classifyPosition({ x: 105.1, y: 34 })).toBe("out-of-play-near");
    expect(classifyPosition({ x: 52.5, y: -0.1 })).toBe("out-of-play-near");
    expect(classifyPosition({ x: 52.5, y: 68.1 })).toBe("out-of-play-near");
    expect(classifyPosition({ x: -3, y: 34 })).toBe("out-of-play-near");
  });

  test("canvas edges are the near/off-canvas boundary (6 m allowance)", () => {
    expect(classifyPosition({ x: -6, y: 34 })).toBe("out-of-play-near"); // canvas x = 0
    expect(classifyPosition({ x: -6.1, y: 34 })).toBe("out-of-play-off-canvas"); // canvas x = -1
    expect(classifyPosition({ x: 111, y: 34 })).toBe("out-of-play-near"); // canvas x = 1170
    expect(classifyPosition({ x: 111.1, y: 34 })).toBe("out-of-play-off-canvas"); // 1171
    expect(classifyPosition({ x: 52.5, y: -6 })).toBe("out-of-play-near"); // canvas y = 0
    expect(classifyPosition({ x: 52.5, y: -6.1 })).toBe("out-of-play-off-canvas");
  });

  test("the caption band starts at canvas y 800: positions over it are off-canvas", () => {
    expect(classifyPosition({ x: 52.5, y: 73.9 })).toBe("out-of-play-near"); // canvas y 799
    expect(classifyPosition({ x: 52.5, y: 74 })).toBe("out-of-play-off-canvas"); // canvas y 800
    expect(classifyPosition({ x: 52.5, y: 75 })).toBe("out-of-play-off-canvas");
  });

  test("far out-of-bounds is off-canvas with the TRUE position preserved upstream", () => {
    expect(classifyPosition({ x: 120, y: 34 })).toBe("out-of-play-off-canvas");
    expect(classifyPosition({ x: -30, y: -30 })).toBe("out-of-play-off-canvas");
    // the projection itself never moves the point:
    expect(toCanvas({ x: 120, y: 34 }).x).toBe(1260);
  });
});

describe("PITCH_MARKINGS — Laws-of-the-Game standard geometry (pinned)", () => {
  test("penalty area 16.5 m deep × 40.32 m wide; goal area 5.5 × 18.32; circle 9.15; spot 11", () => {
    expect(PITCH_MARKINGS.penaltyDepth).toBe(165);
    expect(PITCH_MARKINGS.penaltyWidth).toBe(403.2);
    expect(PITCH_MARKINGS.goalAreaDepth).toBe(55);
    expect(PITCH_MARKINGS.goalAreaWidth).toBe(183.2);
    expect(PITCH_MARKINGS.centerCircleR).toBe(91.5);
    expect(PITCH_MARKINGS.penaltySpotOffset).toBe(110);
  });

  test("penalty spots at (170, 400) and (1000, 400)", () => {
    expect(PITCH_MARKINGS.penaltySpotLeft).toEqual({ x: 170, y: 400 });
    expect(PITCH_MARKINGS.penaltySpotRight).toEqual({ x: 1000, y: 400 });
  });

  test("penalty arcs: chord at the 16.5 m line, half-height sqrt(91.5² − 55²) rounded", () => {
    // sqrt(8372.25 − 3025) = sqrt(5347.25) ≈ 73.1247 → 400 ± 73.12
    expect(PITCH_MARKINGS.leftPenaltyArcPath).toBe("M 225 326.88 A 91.5 91.5 0 0 1 225 473.12");
    expect(PITCH_MARKINGS.rightPenaltyArcPath).toBe("M 945 326.88 A 91.5 91.5 0 0 0 945 473.12");
  });
});
