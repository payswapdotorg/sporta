/**
 * Determinism pins for the seeded PRNG (W003): mulberry32 draw sequences and
 * FNV-1a string hashes are pinned to exact values so any accidental change to
 * the generators is caught before it silently reshuffles every fixture.
 */
import { describe, expect, test } from "bun:test";
import { createRng, seedFromString } from "../src/rng";

/** Reference draw sequences (mulberry32, public-domain implementation). */
const PINNED_DRAWS: ReadonlyArray<{ seed: number; draws: number[] }> = [
  {
    seed: 0,
    draws: [
      0.26642920868471265, 0.0003297457005828619, 0.2232720274478197, 0.1462021479383111,
      0.46732782293111086,
    ],
  },
  {
    seed: 1,
    draws: [
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741,
      0.9683778982143849,
    ],
  },
  {
    seed: 123456789,
    draws: [0.2577907438389957, 0.9707721115555614, 0.7853280142880976],
  },
];

/** Reference FNV-1a (32-bit, UTF-16 code units) hashes. */
const PINNED_HASHES: ReadonlyArray<{ input: string; hash: number }> = [
  { input: "", hash: 2166136261 }, // FNV-1a offset basis
  { input: "a", hash: 3826002220 },
  { input: "hello", hash: 1335831723 },
  { input: "sporta", hash: 244995684 },
  { input: "m0-e2e", hash: 305745619 },
];

describe("createRng (mulberry32)", () => {
  test("matches the pinned reference draw sequences", () => {
    for (const { seed, draws } of PINNED_DRAWS) {
      const rng = createRng(seed);
      const actual = draws.map(() => rng());
      expect(actual).toEqual(draws);
    }
  });

  test("same seed produces identical sequences (fresh generators)", () => {
    const first = Array.from({ length: 25 }, () => createRng(42)());
    const second = Array.from({ length: 25 }, () => createRng(42)());
    expect(first).toEqual(second);
  });

  test("different seeds produce different sequences", () => {
    const first = Array.from({ length: 25 }, () => createRng(1)());
    const second = Array.from({ length: 25 }, () => createRng(2)());
    expect(first).not.toEqual(second);
  });

  test("every draw is in [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  test("output is roughly uniform over 1000 fixed-seed draws", () => {
    const rng = createRng(7);
    let sum = 0;
    for (let i = 0; i < 1000; i += 1) sum += rng();
    const mean = sum / 1000;
    // Deterministic for the fixed seed; loose bounds keep the intent clear
    // (sanity, not a statistical test — see docs/testing/testing-strategy.md).
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.6);
  });

  test("seeds are normalized to unsigned 32-bit (low 32 bits win)", () => {
    // 2^32 === 0 modulo 2^32: documented normalization of out-of-range seeds.
    const fromZero = Array.from({ length: 3 }, () => createRng(0)());
    const fromTwoPow32 = Array.from({ length: 3 }, () => createRng(4294967296)());
    expect(fromTwoPow32).toEqual(fromZero);
  });

  test("negative seeds use their two's-complement low 32 bits", () => {
    const fromNegative = Array.from({ length: 3 }, () => createRng(-1)());
    const fromUint32Max = Array.from({ length: 3 }, () => createRng(4294967295)());
    expect(fromNegative).toEqual(fromUint32Max);
  });
});

describe("seedFromString (FNV-1a)", () => {
  test("matches the pinned reference hashes", () => {
    for (const { input, hash } of PINNED_HASHES) {
      expect(seedFromString(input)).toBe(hash);
    }
  });

  test("is deterministic: repeated calls return the same seed", () => {
    for (const { input } of PINNED_HASHES) {
      expect(seedFromString(input)).toBe(seedFromString(input));
    }
  });

  test("distinct strings hash to distinct seeds (sample)", () => {
    const inputs = [
      "session",
      "observation",
      "event",
      "world-model",
      "renderer",
      "streaming",
      "rights",
      "uncertainty",
    ];
    const seeds = new Set(inputs.map((input) => seedFromString(input)));
    expect(seeds.size).toBe(inputs.length);
  });

  test("composes with createRng: named seeds drive stable generators", () => {
    const first = Array.from({ length: 10 }, () => createRng(seedFromString("m0-e2e"))());
    const second = Array.from({ length: 10 }, () => createRng(seedFromString("m0-e2e"))());
    expect(first).toEqual(second);
    const other = Array.from({ length: 10 }, () => createRng(seedFromString("other"))());
    expect(other).not.toEqual(first);
  });
});
