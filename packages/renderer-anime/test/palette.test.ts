import { describe, expect, test } from "bun:test";
import { FOOTBALL_EVENT_TYPES } from "@sporta/contracts";
import {
  ANIME_RENDERER_ID,
  ANIME_RENDERER_VERSION,
  BALL_STYLE,
  PLAYER_PALETTE,
  animeEntityStyle,
  animeStyleKey,
  fnv1a32,
  opacityFromConfidence,
  stableEntityStyle,
} from "../src/index";

/** Canonical FNV-1a 32-bit test vectors (algorithm pin). */
describe("fnv1a32 — deterministic hash", () => {
  test("empty input hashes to the offset basis 0x811c9dc5", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("")).toBe(2166136261);
  });

  test("the canonical 'abc' test vector", () => {
    expect(fnv1a32("abc")).toBe(0x1a47e90b);
    expect(fnv1a32("abc")).toBe(440920331);
  });

  test("stable across calls and call orders (no hidden state)", () => {
    expect(fnv1a32("anime.prototype:0.1.0:player-7")).toBe(
      fnv1a32("anime.prototype:0.1.0:player-7"),
    );
    expect(fnv1a32("x")).toBe(4245442695);
  });

  test("pinned hash for the fixture entity composite strings", () => {
    expect(fnv1a32("anime.prototype:0.1.0:player-7")).toBe(3058534601);
    expect(fnv1a32("anime.prototype:0.1.0:player-9")).toBe(3226310791);
    expect(fnv1a32("anime.prototype:0.1.0:player-11")).toBe(1257082);
    expect(fnv1a32("anime.prototype:0.1.0:ball-1")).toBe(400920383);
  });
});

describe("PLAYER_PALETTE — the fixed anime palette table", () => {
  test("8 two-tone entries with exact pinned colors", () => {
    expect(PLAYER_PALETTE).toHaveLength(8);
    expect(PLAYER_PALETTE[0]).toEqual({ paletteIndex: 0, jersey: "#3f6fbf", trim: "#f2c94c" });
    expect(PLAYER_PALETTE[1]).toEqual({ paletteIndex: 1, jersey: "#d64f4f", trim: "#f8f4e8" });
    expect(PLAYER_PALETTE[2]).toEqual({ paletteIndex: 2, jersey: "#3fae7a", trim: "#1d2a3a" });
    expect(PLAYER_PALETTE[3]).toEqual({ paletteIndex: 3, jersey: "#e8873a", trim: "#22252a" });
    expect(PLAYER_PALETTE[4]).toEqual({ paletteIndex: 4, jersey: "#8e5bc0", trim: "#f2c94c" });
    expect(PLAYER_PALETTE[5]).toEqual({ paletteIndex: 5, jersey: "#2fa8c9", trim: "#d64f4f" });
    expect(PLAYER_PALETTE[6]).toEqual({ paletteIndex: 6, jersey: "#c94f8e", trim: "#f8f4e8" });
    expect(PLAYER_PALETTE[7]).toEqual({ paletteIndex: 7, jersey: "#f2c94c", trim: "#22252a" });
  });

  test("every palette index is present exactly once", () => {
    const indices = PLAYER_PALETTE.map((entry) => entry.paletteIndex).sort((a, b) => a - b);
    expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test("the ball style is fixed (white ball, dark outline)", () => {
    expect(BALL_STYLE).toEqual({ fill: "#fbfbf4", stroke: "#22252a" });
  });
});

describe("stableEntityStyle — identity-stable styling", () => {
  const styleKey = `${ANIME_RENDERER_ID}:${ANIME_RENDERER_VERSION}`;

  test("pure function of (styleKey, entityId): deep-equal on every call", () => {
    const first = stableEntityStyle(styleKey, "player-7");
    const second = stableEntityStyle(styleKey, "player-7");
    expect(first).toEqual(second);
    expect(first).not.toBe(second); // fresh clone per call (no shared mutable table entry)
  });

  test("pinned palette assignment for fixture ids (hash % 8)", () => {
    // fnv1a32("anime.prototype:0.1.0:player-7") = 3058534601; 3058534601 % 8 = 1
    expect(stableEntityStyle(styleKey, "player-7")).toEqual({
      paletteIndex: 1,
      jersey: "#d64f4f",
      trim: "#f8f4e8",
    });
    // 3226310791 % 8 = 7
    expect(stableEntityStyle(styleKey, "player-9").paletteIndex).toBe(7);
    // 1257082 % 8 = 2
    expect(stableEntityStyle(styleKey, "player-11").paletteIndex).toBe(2);
    // 400920383 % 8 = 7
    expect(stableEntityStyle(styleKey, "ball-1").paletteIndex).toBe(7);
    // 3671557087 % 8 = 7, 3688334706 % 8 = 2, 3870622849 % 8 = 1
    expect(stableEntityStyle(styleKey, "p1").paletteIndex).toBe(7);
    expect(stableEntityStyle(styleKey, "p2").paletteIndex).toBe(2);
    expect(stableEntityStyle(styleKey, "b1").paletteIndex).toBe(1);
  });

  test("every palette entry is reachable from plausible entity ids (no dead entries)", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i += 1) {
      seen.add(stableEntityStyle(styleKey, `player-${i}`).paletteIndex);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test("the style is a pure function of the RENDERER VERSION too (restyling rides a version bump)", () => {
    // fnv1a32("anime.prototype:0.2.0:p1") % 8 = 4 vs 7 at 0.1.0 — a version
    // bump deliberately reassigns styles; the same version never does.
    expect(stableEntityStyle("anime.prototype:0.2.0", "p1").paletteIndex).toBe(4);
    expect(stableEntityStyle("anime.prototype:0.1.0", "p1").paletteIndex).toBe(7);
    expect(stableEntityStyle("anime.prototype:0.2.0", "player-7").paletteIndex).toBe(2);
    expect(stableEntityStyle("anime.prototype:0.1.0", "player-7").paletteIndex).toBe(1);
  });

  test("animeStyleKey + animeEntityStyle use the package identity", () => {
    expect(animeStyleKey()).toBe("anime.prototype:0.1.0");
    expect(animeEntityStyle("player-7")).toEqual(stableEntityStyle(styleKey, "player-7"));
  });

  test("returned styles are table clones — mutating one cannot poison the table", () => {
    const style = animeEntityStyle("player-7") as { jersey: string };
    style.jersey = "#000000";
    expect(animeEntityStyle("player-7").jersey).toBe("#d64f4f");
  });
});

describe("opacityFromConfidence — honest visual weight", () => {
  test("documented formula: 0.35 + 0.65 * confidence, rounded to 3 decimals", () => {
    expect(opacityFromConfidence(1)).toBe(1);
    expect(opacityFromConfidence(0)).toBe(0.35);
    expect(opacityFromConfidence(0.9)).toBe(0.935);
    expect(opacityFromConfidence(0.5)).toBe(0.675);
    expect(opacityFromConfidence(0.25)).toBe(0.513); // 0.5125 → 0.513 (half away from zero)
  });

  test("absent confidence maps to undefined (NO opacity claim, neutral styling)", () => {
    expect(opacityFromConfidence(undefined)).toBeUndefined();
  });
});

/** Guard: the caption phrase table stays in lockstep with the v1 taxonomy. */
test("sanity: FOOTBALL_EVENT_TYPES is the 16-type v1 taxonomy", () => {
  expect(FOOTBALL_EVENT_TYPES).toHaveLength(16);
  expect(FOOTBALL_EVENT_TYPES).toContain("goal");
  expect(FOOTBALL_EVENT_TYPES).toContain("possession-change");
});
