/**
 * Pure presentation-layer unit tests (no ffmpeg, no engine scenes):
 * raster primitives, the pixel font, the camera model, and the palette
 * derivations — the deterministic foundations both renderers share.
 */
import { describe, expect, test } from "bun:test";
import { Framebuffer, mixRgb, posterize, rgb, shade, tint } from "../../src/game/raster";
import {
  GLYPH_ADVANCE,
  GLYPH_HEIGHT,
  GLYPH_WIDTH,
  drawText,
  glyphVocabulary,
  isRenderableText,
  measureText,
} from "../../src/game/font";
import { buildGameCamera, emphasisWindowsOf, projectPoint } from "../../src/game/camera";
import {
  KEEPER_KIT_COLOR,
  KIT_PALETTE_SIZE,
  OFFICIAL_KIT_COLOR,
  entityKit,
  jerseyNumberOf,
} from "../../src/game/palette";
import { chipPhrase, formatClockMs } from "../../src/game/frame";
import { fnv1a32 } from "../../src/game/palette";

describe("Framebuffer (the software rasterizer's canvas)", () => {
  test("clear and setPixel write exact rgb24 bytes with canvas clipping", () => {
    const fb = new Framebuffer(4, 2);
    fb.clear(rgb(10, 20, 30));
    expect(fb.bytes.length).toBe(4 * 2 * 3);
    expect([...fb.bytes.slice(0, 3)]).toEqual([10, 20, 30]);
    fb.setPixel(1, 0, rgb(255, 0, 0));
    expect(fb.pixel(1, 0)).toEqual({ r: 255, g: 0, b: 0 });
    // Out-of-canvas writes are silently clipped (never throw, never wrap).
    fb.setPixel(-1, 0, rgb(1, 1, 1));
    fb.setPixel(4, 0, rgb(1, 1, 1));
    fb.setPixel(0, 2, rgb(1, 1, 1));
    expect(fb.pixel(0, 0)).toEqual({ r: 10, g: 20, b: 30 });
  });

  test("clearGradient interpolates one row color per scanline", () => {
    const fb = new Framebuffer(1, 3);
    fb.clearGradient(rgb(0, 0, 0), rgb(90, 90, 90));
    expect(fb.pixel(0, 0)).toEqual({ r: 0, g: 0, b: 0 });
    expect(fb.pixel(0, 1).r).toBe(45);
    expect(fb.pixel(0, 2)).toEqual({ r: 90, g: 90, b: 90 });
  });

  test("fillEllipse stays inside its bounds; degenerate radii are no-ops", () => {
    const fb = new Framebuffer(8, 8);
    fb.clear(rgb(0, 0, 0));
    fb.fillEllipse(4, 4, 2, 1, rgb(200, 100, 50));
    const before = fb.bytes.slice().filter((b) => b !== 0).length;
    expect(before).toBeGreaterThan(0);
    fb.fillEllipse(-5, -5, 1, 1, rgb(9, 9, 9)); // fully clipped: no crash
    fb.fillEllipse(4, 4, 0, 0, rgb(9, 9, 9)); // degenerate: no-op
    expect(fb.pixel(0, 0)).toEqual({ r: 0, g: 0, b: 0 });
  });

  test("fillTriangleGouraud interpolates per-vertex colors (affine ramp)", () => {
    const fb = new Framebuffer(10, 10);
    fb.clear(rgb(0, 0, 0));
    fb.fillTriangleGouraud(
      { x: 0, y: 0 },
      { x: 9, y: 0 },
      { x: 0, y: 9 },
      rgb(0, 0, 0),
      rgb(90, 90, 90),
      rgb(0, 0, 0),
    );
    // The right edge midpoint sits between the left (0) and right (90).
    const mid = fb.pixel(6, 1);
    expect(mid.r).toBeGreaterThan(0);
    expect(mid.r).toBeLessThan(90);
    expect(mid.g).toBe(mid.r);
    expect(mid.b).toBe(mid.r);
  });

  test("fillConvexPolygon fan-triangulates a quad without holes", () => {
    const fb = new Framebuffer(20, 20);
    fb.clear(rgb(0, 0, 0));
    fb.fillConvexPolygon(
      [
        { x: 2, y: 2 },
        { x: 17, y: 2 },
        { x: 17, y: 17 },
        { x: 2, y: 17 },
      ],
      rgb(50, 60, 70),
    );
    expect(fb.pixel(10, 10)).toEqual({ r: 50, g: 60, b: 70 });
    expect(fb.pixel(19, 19)).toEqual({ r: 0, g: 0, b: 0 }); // outside
  });

  test("drawThickLine draws a horizontal run with rounded caps", () => {
    const fb = new Framebuffer(30, 10);
    fb.clear(rgb(0, 0, 0));
    fb.drawThickLine(5, 5, 25, 5, 3, rgb(255, 255, 255));
    expect(fb.pixel(5, 5)).toEqual({ r: 255, g: 255, b: 255 });
    expect(fb.pixel(15, 5)).toEqual({ r: 255, g: 255, b: 255 });
    expect(fb.pixel(15, 7)).toEqual({ r: 0, g: 0, b: 0 }); // outside thickness
    expect(fb.pixel(15, 3)).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe("color helpers", () => {
  test("shade/tint/mixRgb/posterize are pure and monotone", () => {
    const base = rgb(100, 100, 100);
    expect(shade(base, 0)).toEqual(base);
    expect(shade(base, 1)).toEqual({ r: 0, g: 0, b: 0 });
    expect(tint(base, 1)).toEqual({ r: 255, g: 255, b: 255 });
    expect(mixRgb(rgb(0, 0, 0), rgb(10, 20, 30), 0.5)).toEqual({ r: 5, g: 10, b: 15 });
    // Posterization snaps channels onto the level grid.
    const quantized = posterize(rgb(100, 100, 100), 6);
    expect(quantized.r % 51).toBe(0);
  });
});

describe("the 4x5 pixel font", () => {
  test("covers the full presentation vocabulary (A-Z, 0-9, punctuation)", () => {
    expect(glyphVocabulary().length).toBeGreaterThanOrEqual(41);
    for (const text of [
      "HOME 2 - 1 AWAY",
      "45:00 1ST",
      "GOAL!!",
      "AERIAL CAM",
      "SIDELINE CAM",
      "TURNOVER",
      "REFEREE",
      "EMPHASIS",
      "INJURY",
      "OFFSIDE",
      "KICKOFF",
      "SUB",
      "PRE",
      "STOP",
    ]) {
      expect(isRenderableText(text)).toBe(true);
    }
  });

  test("measureText advances one glyph + 1px spacing per character", () => {
    expect(measureText("", 1)).toBe(0);
    expect(measureText("A", 1)).toBe(GLYPH_WIDTH);
    expect(measureText("AB", 1)).toBe(GLYPH_WIDTH + 1 + GLYPH_WIDTH);
    expect(measureText("A", 2)).toBe(GLYPH_WIDTH * 2);
    expect(GLYPH_HEIGHT).toBe(5);
    expect(GLYPH_ADVANCE).toBe(GLYPH_WIDTH + 1);
  });

  test("drawText writes pixels; unknown characters render as blanks", () => {
    const fb = new Framebuffer(40, 10);
    fb.clear(rgb(0, 0, 0));
    drawText(fb, "A", 0, 0, 1, rgb(255, 255, 255));
    const lit = fb.bytes.filter((b) => b === 255).length;
    expect(lit).toBeGreaterThan(0);
    const fb2 = new Framebuffer(40, 10);
    drawText(fb2, "\u00e9\u4e2d", 0, 0, 1, rgb(255, 255, 255)); // non-vocabulary
    expect(fb2.bytes.every((b) => b === 0)).toBe(true);
  });
});

describe("the follow camera model", () => {
  const target = { x: 60, y: 30, z: 0 };

  test("is deterministic: same inputs, same pose", () => {
    const a = buildGameCamera({
      target,
      tMs: 1_234,
      behavior: "aerial-follow",
      seed: 9,
      canvasHeight: 360,
      emphasisWindows: [],
    });
    const b = buildGameCamera({
      target,
      tMs: 1_234,
      behavior: "aerial-follow",
      seed: 9,
      canvasHeight: 360,
      emphasisWindows: [],
    });
    expect(a).toEqual(b);
  });

  test("aerial-follow orbits the target at the documented height", () => {
    const camera = buildGameCamera({
      target,
      tMs: 0,
      behavior: "aerial-follow",
      seed: 3,
      canvasHeight: 360,
      emphasisWindows: [],
    });
    expect(camera.behavior).toBe("aerial-follow");
    expect(camera.eye.z).toBeGreaterThan(15); // elevated drone view
    const horizontal = Math.hypot(camera.eye.x - target.x, camera.eye.y - target.y);
    expect(horizontal).toBeGreaterThan(15); // at radius, not overhead
  });

  test("sideline-follow sits behind the y=0 touchline", () => {
    const camera = buildGameCamera({
      target,
      tMs: 500,
      behavior: "sideline-follow",
      seed: 3,
      canvasHeight: 360,
      emphasisWindows: [],
    });
    expect(camera.behavior).toBe("sideline-follow");
    expect(camera.eye.y).toBeLessThan(0);
    expect(camera.eye.z).toBeLessThan(8); // broadcast height
  });

  test("emphasis windows punch the focal length up and back down", () => {
    const windows = [{ startMs: 1_000, endMs: 2_800 }];
    const before = buildGameCamera({
      target,
      tMs: 900,
      behavior: "aerial-follow",
      seed: 1,
      canvasHeight: 360,
      emphasisWindows: windows,
    });
    const middle = buildGameCamera({
      target,
      tMs: 1_900,
      behavior: "aerial-follow",
      seed: 1,
      canvasHeight: 360,
      emphasisWindows: windows,
    });
    const after = buildGameCamera({
      target,
      tMs: 3_000,
      behavior: "aerial-follow",
      seed: 1,
      canvasHeight: 360,
      emphasisWindows: windows,
    });
    expect(middle.focalPx).toBeGreaterThan(before.focalPx);
    expect(middle.focalPx).toBeGreaterThan(after.focalPx);
  });

  test("projectPoint maps the camera-space origin to the canvas center", () => {
    const camera = buildGameCamera({
      target,
      tMs: 0,
      behavior: "aerial-follow",
      seed: 2,
      canvasHeight: 360,
      emphasisWindows: [],
    });
    // A point along the forward axis at the look-at height projects center.
    const along = {
      x: camera.eye.x + camera.forward.x * 20,
      y: camera.eye.y + camera.forward.y * 20,
      z: camera.eye.z + camera.forward.z * 20,
    };
    const projected = projectPoint(camera, along, 640, 360);
    expect(projected).not.toBeNull();
    expect(projected!.x).toBeCloseTo(320, 0);
    expect(projected!.y).toBeCloseTo(180, 0);
    expect(projected!.depth).toBeCloseTo(20, 0);
    // A point behind the near plane projects to null (clipped, never faked).
    const behind = {
      x: camera.eye.x - camera.forward.x * 0.1,
      y: camera.eye.y - camera.forward.y * 0.1,
      z: camera.eye.z - camera.forward.z * 0.1,
    };
    expect(projectPoint(camera, behind, 640, 360)).toBeNull();
  });

  test("emphasisWindowsOf arms windows only for goal/shot/save events", () => {
    expect(
      emphasisWindowsOf([
        { eventTimeMs: 1_000, eventTypeRef: "football/v1/pass" },
        { eventTimeMs: 2_000, eventTypeRef: "football/v1/goal" },
        { eventTimeMs: 3_000, eventTypeRef: "football/v1/save" },
        { eventTimeMs: 4_000, eventTypeRef: "other/v1/goal" },
      ]),
    ).toEqual([
      { startMs: 2_000, endMs: 3_800 },
      { startMs: 3_000, endMs: 4_800 },
    ]);
  });
});

describe("palette derivations (the W602 identity-stable posture)", () => {
  test("kit colors are stable per (styleKey, entityId) and never invent team claims", () => {
    const a = entityKit({
      styleKey: "s1",
      entityId: "player-3",
      kind: "participant",
      teamRole: null,
      teamId: null,
    });
    const b = entityKit({
      styleKey: "s1",
      entityId: "player-3",
      kind: "participant",
      teamRole: null,
      teamId: null,
    });
    expect(a).toEqual(b);
    const c = entityKit({
      styleKey: "s2",
      entityId: "player-3",
      kind: "participant",
      teamRole: null,
      teamId: null,
    });
    expect(a.color).not.toEqual(c.color); // style keys re-key (documented)
    expect(KIT_PALETTE_SIZE).toBe(8);
  });

  test("a known goalkeeper gets the keeper kit; officials get the neutral kit", () => {
    expect(
      entityKit({
        styleKey: "s",
        entityId: "p",
        kind: "participant",
        teamRole: "goalkeeper",
        teamId: null,
      }),
    ).toEqual({ color: KEEPER_KIT_COLOR, goalkeeper: true });
    expect(
      entityKit({
        styleKey: "s",
        entityId: "p",
        kind: "official",
        teamRole: "goalkeeper",
        teamId: null,
      }),
    ).toEqual({ color: OFFICIAL_KIT_COLOR, goalkeeper: false });
  });

  test("a known teamId maps stably (the R206-ready path)", () => {
    const home = entityKit({
      styleKey: "s",
      entityId: "p1",
      kind: "participant",
      teamRole: null,
      teamId: "home",
    });
    const homeAgain = entityKit({
      styleKey: "s",
      entityId: "p2",
      kind: "participant",
      teamRole: null,
      teamId: "home",
    });
    expect(home.color).toEqual(homeAgain.color);
  });

  test("jersey numbers: declared verbatim, else trailing digits, else stable hash", () => {
    expect(jerseyNumberOf("player-7", 11)).toBe(11); // verbatim wins
    expect(jerseyNumberOf("player-7", null)).toBe(7);
    expect(jerseyNumberOf("keeper", null)).toBe((fnv1a32("jersey:keeper") % 99) + 1);
    expect(jerseyNumberOf("x-150", null)).toBe((150 % 99) + 1); // >99 wraps
  });
});

describe("HUD text derivations", () => {
  test("chipPhrase maps the football/v1 taxonomy and defaults honestly", () => {
    expect(chipPhrase("football/v1/goal")).toBe("GOAL!!");
    expect(chipPhrase("football/v1/pass")).toBe("PASS");
    expect(chipPhrase("football/v1/possession-change")).toBe("TURNOVER");
    expect(chipPhrase("unknown/v1/thing")).toBe("EVENT");
  });

  test("formatClockMs formats MM:SS and clamps negatives", () => {
    expect(formatClockMs(0)).toBe("00:00");
    expect(formatClockMs(59_999)).toBe("00:59");
    expect(formatClockMs(60_000)).toBe("01:00");
    expect(formatClockMs(2_754_000)).toBe("45:54");
    expect(formatClockMs(-5)).toBe("00:00");
  });
});
