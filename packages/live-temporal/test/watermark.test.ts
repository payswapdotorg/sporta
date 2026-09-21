/**
 * The D1 watermark arithmetic battery — pure-function properties: monotonicity
 * (a regressing input can only hold the watermark back, never pull it
 * backwards), boundedness (the reorder window always discounts the max event
 * time), non-negativity, hole visibility at the engine level, and the honest
 * lag clamp. Seeded draws (the repo's splitmix32) — no wall clock, no
 * unseeded randomness.
 */
import { describe, expect, test } from "bun:test";
import { createSeededRandom, substreamSeed } from "@sporta/live-source";
import {
  DEFAULT_REORDER_WINDOW_MS,
  holeClosedByWatermark,
  nextWatermarkMs,
  watermarkLagMs,
  windowBoundMs,
} from "../src/index";

describe("windowBoundMs — the bounded reorder window (D2)", () => {
  test("the bound is the max event time minus the window, floored at 0", () => {
    expect(windowBoundMs(1000, 250)).toBe(750);
    expect(windowBoundMs(100, 250)).toBe(0);
    expect(windowBoundMs(0, 250)).toBe(0);
  });

  test("larger windows hold the bound further back (bounded reorder)", () => {
    for (const window of [50, 250, 5000]) {
      expect(windowBoundMs(10_000, window)).toBe(10_000 - window);
    }
  });
});

describe("nextWatermarkMs — the conservative monotonic watermark (D1)", () => {
  test("the combined candidate is min(emission, window), clamped >= 0", () => {
    // Emission ahead of the window: the window bound wins.
    expect(
      nextWatermarkMs({
        sourceEmissionWatermarkMs: 5000,
        maxEventTimeMs: 5000,
        reorderWindowMs: 250,
        previousMs: 0,
      }),
    ).toBe(4750);
    // Emission holding back (an in-flight out-of-order swap): min(400, 350) = 350.
    expect(
      nextWatermarkMs({
        sourceEmissionWatermarkMs: 400,
        maxEventTimeMs: 600,
        reorderWindowMs: 250,
        previousMs: 0,
      }),
    ).toBe(350);
  });

  test("monotonic: a regressing input can only hold the watermark back", () => {
    // The previous watermark is 3000; both inputs regress below it.
    expect(
      nextWatermarkMs({
        sourceEmissionWatermarkMs: 1000,
        maxEventTimeMs: 1100,
        reorderWindowMs: 250,
        previousMs: 3000,
      }),
    ).toBe(3000);
  });

  test("the candidate is never negative", () => {
    expect(
      nextWatermarkMs({
        sourceEmissionWatermarkMs: 0,
        maxEventTimeMs: 0,
        reorderWindowMs: 250,
        previousMs: 0,
      }),
    ).toBe(0);
  });

  test("property: the exact conservative identity over seeded draws (1000 cases)", () => {
    const random = createSeededRandom(substreamSeed(42, 1));
    let previousMs = 0;
    let maxEventTimeMs = 0;
    for (let i = 0; i < 1000; i += 1) {
      maxEventTimeMs += random.nextIntBetween(0, 200);
      // The emission guarantee may REGRESS between arrivals (a misbehaving
      // source) — a guarantee once given is never retracted, so the monotonic
      // clamp may legitimately hold the watermark ABOVE a regressing input.
      const emission = Math.max(0, maxEventTimeMs - random.nextIntBetween(0, 600));
      const candidate = nextWatermarkMs({
        sourceEmissionWatermarkMs: emission,
        maxEventTimeMs,
        reorderWindowMs: DEFAULT_REORDER_WINDOW_MS,
        previousMs,
      });
      const exact = Math.max(
        previousMs,
        Math.max(0, Math.min(emission, maxEventTimeMs - DEFAULT_REORDER_WINDOW_MS)),
      );
      // The exact D1 identity…
      expect(candidate).toBe(exact);
      // …which implies monotonic, non-negative, and bounded by the window
      // discount whenever the inputs do not regress below the past watermark.
      expect(candidate).toBeGreaterThanOrEqual(previousMs);
      expect(candidate).toBeGreaterThanOrEqual(0);
      if (emission >= previousMs) {
        expect(candidate).toBeLessThanOrEqual(emission);
      }
      expect(candidate).toBeLessThanOrEqual(
        Math.max(previousMs, Math.max(0, maxEventTimeMs - DEFAULT_REORDER_WINDOW_MS)),
      );
      previousMs = candidate;
    }
  });
});

describe("holeClosedByWatermark — the D4 drop closure rule", () => {
  test("a hole closes exactly when the watermark reaches its revealing arrival", () => {
    expect(holeClosedByWatermark(599, 600)).toBe(false);
    expect(holeClosedByWatermark(600, 600)).toBe(true);
    expect(holeClosedByWatermark(601, 600)).toBe(true);
  });
});

describe("watermarkLagMs — the honest §9 lag clamp", () => {
  test("lag is the render clock ahead of the watermark, clamped at 0", () => {
    expect(watermarkLagMs(3000, 2500)).toBe(500);
    expect(watermarkLagMs(2500, 3000)).toBe(0);
    expect(watermarkLagMs(2500, 2500)).toBe(0);
  });
});
