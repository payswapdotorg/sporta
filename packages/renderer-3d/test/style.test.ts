import { describe, expect, test } from "bun:test";
import {
  AVATAR_PALETTE,
  AVATAR_BODY_HEIGHT_METERS,
  AVATAR_HEAD_RADIUS_METERS,
  BALL_RADIUS_METERS,
  BALL_STYLE,
  OFFICIAL_STYLE,
  avatarEntityStyle,
  avatarFieldStyleKey,
  fnv1a32,
  opacityFromConfidence,
  stableAvatarStyle,
} from "../src/index";
import type { AvatarStyle } from "../src/index";

describe("fnv1a32 — the deterministic hash (known test vectors)", () => {
  test("the empty string hashes to the FNV offset basis", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
  });

  test("public FNV-1a 32-bit test vectors (engine-independent via Math.imul)", () => {
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });

  test("pinned hashes for the composite style inputs (0.1.0 key + the 0.2.0 key)", () => {
    expect(fnv1a32("avatar-field.prototype:0.1.0:striker-9")).toBe(2_086_319_900);
    expect(fnv1a32("avatar-field.prototype:0.1.0:winger-7")).toBe(4_075_311_610);
    // The W603 bump's key (re-pinned):
    expect(fnv1a32("avatar-field.prototype:0.2.0:striker-9")).toBe(2_712_985_589);
    expect(fnv1a32("avatar-field.prototype:0.2.0:winger-7")).toBe(3_701_444_837);
  });
});

describe("stableAvatarStyle — identity-stable, version-independent", () => {
  test("pure: same (styleKey, entityId) → deep-equal result, forever", () => {
    const a = stableAvatarStyle("key", "striker-9");
    const b = stableAvatarStyle("key", "striker-9");
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // fresh clone per call
  });

  test("the composite input is `<styleKey>:<entityId>` (pinned palette entries)", () => {
    expect(stableAvatarStyle("avatar-field.prototype:0.1.0", "striker-9")).toEqual({
      paletteIndex: 4,
      jersey: "#9b5de5",
      trim: "#ffd23f",
    });
    expect(stableAvatarStyle("avatar-field.prototype:0.1.0", "winger-7")).toEqual({
      paletteIndex: 2,
      jersey: "#2a9d8f",
      trim: "#17202a",
    });
    expect(stableAvatarStyle("avatar-field.prototype:0.1.0", "outlier-8")).toEqual({
      paletteIndex: 7,
      jersey: "#ffd23f",
      trim: "#1b2631",
    });
  });

  test("a different styleKey (renderer version bump) restyles — the ONLY restyle path", () => {
    // The W603 0.2.0 bump is the restyle moment: striker-9 moves from the
    // 0.1.0 entry (index 4) to the 0.2.0 entry (index 5) — the W602
    // documented restyle semantics, now exercised in production.
    const underThis = stableAvatarStyle("avatar-field.prototype:0.1.0", "striker-9");
    const underCurrent = stableAvatarStyle("avatar-field.prototype:0.2.0", "striker-9");
    const underNext = stableAvatarStyle("avatar-field.prototype:0.3.0", "striker-9");
    expect(underThis.paletteIndex).toBe(4);
    expect(underCurrent).toEqual({ paletteIndex: 5, jersey: "#00b4d8", trim: "#e63946" });
    expect(underNext).toEqual({ paletteIndex: 6, jersey: "#ef476f", trim: "#f8f9fa" });
    expect(underCurrent.paletteIndex).not.toBe(underThis.paletteIndex);
    expect(underNext.paletteIndex).not.toBe(underCurrent.paletteIndex);
  });

  test("the palette table: 8 two-tone entries, valid hex colors", () => {
    expect(AVATAR_PALETTE).toHaveLength(8);
    expect(AVATAR_PALETTE.map((entry) => entry.paletteIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const entry of AVATAR_PALETTE) {
      expect(entry.jersey).toMatch(/^#[0-9a-f]{6}$/);
      expect(entry.trim).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("officials and the ball use FIXED styles (not hashed)", () => {
    expect(OFFICIAL_STYLE).toEqual({ paletteIndex: 8, jersey: "#22223b", trim: "#ffd166" });
    expect(OFFICIAL_STYLE.paletteIndex).toBeGreaterThanOrEqual(AVATAR_PALETTE.length); // outside the hashed table
    expect(BALL_STYLE).toEqual({ fill: "#fdfdf6", stroke: "#161a1f" });
  });

  test("avatarFieldStyleKey derives from the renderer identity", () => {
    expect(avatarFieldStyleKey()).toBe("avatar-field.prototype:0.2.0");
  });

  test("avatarEntityStyle ignores the entity's SWM version (no-flicker by construction)", () => {
    // The API takes ONLY the entityId: there is no version parameter to
    // depend on. The fixture's striker bumps version 3..8 across frames;
    // its style tokens stay byte-identical (pinned end-to-end in the clip
    // and benchmark tests).
    const first: AvatarStyle = avatarEntityStyle("striker-9");
    for (let version = 3; version <= 8; version += 1) {
      expect(avatarEntityStyle("striker-9")).toEqual(first);
    }
  });
});

describe("opacityFromConfidence — verbatim confidence → visual weight", () => {
  test("documented formula 0.35 + 0.65·c, rounded to 3 decimals", () => {
    expect(opacityFromConfidence(0)).toBe(0.35);
    expect(opacityFromConfidence(1)).toBe(1);
    expect(opacityFromConfidence(0.5)).toBe(0.675);
    expect(opacityFromConfidence(0.7)).toBe(0.805);
    expect(opacityFromConfidence(0.9)).toBe(0.935); // the fixture ball
    expect(opacityFromConfidence(0.72)).toBe(0.818); // the fixture possession
  });

  test("absent confidence maps to undefined (NO opacity attribute — a neutral no-claim style)", () => {
    expect(opacityFromConfidence(undefined)).toBeUndefined();
  });

  test("uncertainty reduces weight but never hides the fact (0 → still 0.35)", () => {
    expect(opacityFromConfidence(0)).toBeGreaterThan(0);
  });
});

describe("presentation constants (documented, versioned with the renderer)", () => {
  test("avatar body size: 1.8 m figure, 0.14 m head (stylized marker size, not stature claims)", () => {
    expect(AVATAR_BODY_HEIGHT_METERS).toBe(1.8);
    expect(AVATAR_HEAD_RADIUS_METERS).toBe(0.14);
  });

  test("ball radius: IFAB Law 2 max circumference 0.70 m → r = 0.70/(2π) ≈ 0.11", () => {
    expect(BALL_RADIUS_METERS).toBe(0.11);
    expect(0.7 / (2 * Math.PI)).toBeCloseTo(0.1114, 3);
  });
});
