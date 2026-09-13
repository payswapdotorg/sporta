/**
 * W103 clock-math tests: the affine map in all four regimes (identity,
 * offset-only, drift-only, both), the exact algebraic inverse (round trip
 * within 1e-9), negative offsets, drift sign conventions, and the degenerate
 * non-invertible clock guards.
 *
 * Deterministic per docs/testing/HARNESS.md: explicit millisecond constants,
 * seeded draws from @sporta/testing's createRng — no `Math.random`, no
 * `Date.now`, no clock reads.
 */
import { describe, expect, test } from "bun:test";
import { createRng } from "@sporta/testing";
import { identityClock, toSessionMs, toSourceMs } from "../src/index";
import type { TrackClock } from "../src/index";

/** A clock with explicit affine terms (no builder indirection needed). */
function clock(offsetMs: number, driftPpm: number): TrackClock {
  return { trackId: "t-0-video", offsetMs, driftPpm };
}

describe("affine clock math", () => {
  test("identity clock maps and inverts without change", () => {
    const id = identityClock("t-0-video");
    expect(id).toEqual({ trackId: "t-0-video", offsetMs: 0, driftPpm: 0 });
    expect(toSessionMs(id, 0)).toBe(0);
    expect(toSessionMs(id, 60_000)).toBe(60_000);
    expect(toSourceMs(id, 60_000)).toBe(60_000);
    // A fresh identity per call: no shared mutable state.
    expect(identityClock("t-1-audio")).not.toBe(id);
    expect(identityClock("t-1-audio").trackId).toBe("t-1-audio");
  });

  test("offset-only clock shifts by offsetMs", () => {
    const c = clock(250, 0);
    expect(toSessionMs(c, 1_000)).toBe(1_250);
    expect(toSessionMs(c, 0)).toBe(250);
    expect(toSourceMs(c, 1_250)).toBe(1_000);
  });

  test("drift-only clock scales the source position by (1 + ppm/1e6)", () => {
    const c = clock(0, 500);
    // 60 000 ms + 60 000 * 500 / 1_000_000 = 60 030.
    expect(toSessionMs(c, 60_000)).toBe(60_030);
    const slow = clock(0, -500);
    expect(toSessionMs(slow, 60_000)).toBe(59_970);
  });

  test("both offset and drift compose affinely", () => {
    const c = clock(-60, -250);
    // 120 000 - 60 - 120 000 * 250 / 1e6 = 119 910.
    expect(toSessionMs(c, 120_000)).toBe(119_910);
    expect(toSessionMs(clock(-940, 0), 940)).toBe(0);
    expect(toSessionMs(clock(-940, 0), 1_000)).toBe(60);
  });

  test("negative offsets move content earlier, positive later", () => {
    expect(toSessionMs(clock(-1_000, 0), 1_000)).toBe(0);
    expect(toSessionMs(clock(60, 0), 1_000)).toBe(1_060);
  });

  test("drift sign conventions: positive grows, negative shrinks", () => {
    const source = 60_000;
    expect(toSessionMs(clock(0, 1_000), source)).toBe(60_060);
    expect(toSessionMs(clock(0, -1_000), source)).toBe(59_940);
    // The drift term is proportional to the SOURCE position, not the offset.
    expect(toSessionMs(clock(5_000, 1_000), source)).toBe(65_060);
  });
});

describe("exact inverse round trip", () => {
  test("toSourceMs(toSessionMs(x)) === x within 1e-9 for fixed values", () => {
    const offsets = [-940, -60, 0, 60, 250, 1_000];
    const drifts = [-1_000, -500, -1, 0, 1, 500, 1_000];
    const positions = [0, 1, 940, 1_000, 60_000, 100_000];
    for (const offsetMs of offsets) {
      for (const driftPpm of drifts) {
        const c = clock(offsetMs, driftPpm);
        for (const x of positions) {
          const roundTrip = toSourceMs(c, toSessionMs(c, x));
          expect(Math.abs(roundTrip - x)).toBeLessThanOrEqual(1e-9);
        }
      }
    }
  });

  test("toSourceMs(toSessionMs(x)) === x within 1e-9 for seeded draws", () => {
    const rng = createRng(1_031);
    for (let i = 0; i < 500; i += 1) {
      const x = rng() * 100_000;
      const offsetMs = (rng() - 0.5) * 2_000;
      const driftPpm = (rng() - 0.5) * 2_000;
      const c = clock(offsetMs, driftPpm);
      const roundTrip = toSourceMs(c, toSessionMs(c, x));
      expect(Math.abs(roundTrip - x)).toBeLessThanOrEqual(1e-9);
    }
  });

  test("toSessionMs(toSourceMs(s)) === s within 1e-9 (both directions)", () => {
    const c = clock(-940, 500);
    for (const s of [0, 60, 60_000, 100_000]) {
      const roundTrip = toSessionMs(c, toSourceMs(c, s));
      expect(Math.abs(roundTrip - s)).toBeLessThanOrEqual(1e-9);
    }
  });
});

describe("degenerate and invalid clocks fail loud", () => {
  test("driftPpm <= -1_000_000 is rejected by both directions", () => {
    const degenerate = clock(0, -1_000_000);
    expect(() => toSessionMs(degenerate, 1_000)).toThrow(RangeError);
    expect(() => toSourceMs(degenerate, 1_000)).toThrow(RangeError);
    const reversed = clock(0, -2_000_000);
    expect(() => toSessionMs(reversed, 1_000)).toThrow(RangeError);
    expect(() => toSourceMs(reversed, 1_000)).toThrow(RangeError);
  });

  test("non-finite clock terms and positions are rejected", () => {
    expect(() => toSessionMs(clock(Number.NaN, 0), 1_000)).toThrow(RangeError);
    expect(() => toSessionMs(clock(0, Number.NaN), 1_000)).toThrow(RangeError);
    expect(() => toSessionMs(clock(0, 0), Number.NaN)).toThrow(RangeError);
    expect(() => toSessionMs(clock(0, 0), Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => toSourceMs(clock(Number.POSITIVE_INFINITY, 0), 1_000)).toThrow(RangeError);
    expect(() => toSourceMs(clock(0, 0), Number.NEGATIVE_INFINITY)).toThrow(RangeError);
  });

  test("identityClock rejects empty track ids", () => {
    expect(() => identityClock("")).toThrow(RangeError);
  });
});
