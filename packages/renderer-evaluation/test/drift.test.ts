/**
 * Geometry drift metric tests (W503): clean values, teleport detection,
 * honest gap accounting (never interpolated — gaps break the series and are
 * counted; a gap never masks an implausible endpoint displacement), kind
 * specific bounds, and the near-boundary semantics (inclusive pass).
 */
import { describe, expect, test } from "bun:test";
import type { AnimeClipManifest } from "@sporta/renderer-anime";
import {
  THRESHOLDS,
  driftBoundFor,
  injectDispositionFlap,
  injectGeometryTeleport,
  measureGeometryDrift,
  renderW503CleanFixture,
} from "../src/index";

function cleanManifest(): AnimeClipManifest {
  return structuredClone(renderW503CleanFixture().manifest);
}

describe("driftBoundFor — the documented bound formula", () => {
  test("player bound: 12.5 m/s x dt + 0.01 m", () => {
    expect(driftBoundFor("participant", 1_000)).toBe(12.51);
    expect(driftBoundFor("participant", 2_000)).toBe(25.01);
    expect(driftBoundFor("participant", 500)).toBe(6.26);
  });

  test("ball bound: 40 m/s x dt + 0.01 m", () => {
    expect(driftBoundFor("ball", 1_000)).toBe(40.01);
    expect(driftBoundFor("ball", 2_000)).toBe(80.01);
  });

  test("non-ball kinds use the (conservative) player bound", () => {
    expect(driftBoundFor("team", 1_000)).toBe(driftBoundFor("participant", 1_000));
  });

  test("bound parameters echo the THRESHOLDS constants (pinned to THRESHOLDS.md)", () => {
    expect(THRESHOLDS.PLAYER_MAX_SPEED_MPS).toBe(12.5);
    expect(THRESHOLDS.BALL_MAX_SPEED_MPS).toBe(40);
    expect(THRESHOLDS.POSITION_EPSILON_METERS).toBe(0.01);
  });
});

describe("measureGeometryDrift — the clean W502 fixture", () => {
  const metrics = measureGeometryDrift(cleanManifest());

  test("5 measured entities (with positions), 2 not measurable (no positions ever)", () => {
    expect(metrics.measuredEntityIds).toEqual([
      "player-7",
      "player-9",
      "player-out",
      "player-far",
      "ball-1",
    ]);
    expect(metrics.notMeasuredEntityIds).toEqual(["player-11", "team-1"]);
  });

  test("25 measured pairs (5 entities x 5 consecutive pairs), 0 jumps, 0 gaps", () => {
    expect(metrics.measuredPairCount).toBe(25);
    expect(metrics.jumpCount).toBe(0);
    expect(metrics.gapFrameCount).toBe(0);
    expect(metrics.gapSpanCount).toBe(0);
  });

  test("max displacement 0.8 m (player-7), max jump 0 (no jumps), max ratio well below the bound", () => {
    expect(metrics.maxDisplacementMeters).toBeCloseTo(0.8, 10);
    expect(metrics.maxJumpMeters).toBe(0);
    expect(metrics.maxJumpRatio).toBeGreaterThan(0);
    expect(metrics.maxJumpRatio).toBeLessThan(0.07);
  });

  test("player-7 series: 5 steps, dt 1000, displacement 0.8, bound 12.51, no gaps", () => {
    const player7 = metrics.perEntity.find((entity) => entity.entityId === "player-7")!;
    expect(player7.series).toHaveLength(5);
    for (const step of player7.series) {
      expect(step.dtMs).toBe(1_000);
      expect(step.displacementMeters).toBeCloseTo(0.8, 10);
      expect(step.boundMeters).toBe(12.51);
      expect(step.exceedsBound).toBe(false);
      expect(step.spansGap).toBe(false);
    }
    expect(player7.series.map((step) => step.toFrameIndex)).toEqual([1, 2, 3, 4, 5]);
  });

  test("ball uses the ball bound (0.5 m displacement vs 40.01 m)", () => {
    const ball = metrics.perEntity.find((entity) => entity.entityId === "ball-1")!;
    expect(ball.bound.maxSpeedMps).toBe(40);
    for (const step of ball.series) {
      expect(step.displacementMeters).toBeCloseTo(0.5, 10);
      expect(step.boundMeters).toBe(40.01);
    }
  });

  test("the out-of-play entities' TRUE positions are measured (never clamped away)", () => {
    const far = metrics.perEntity.find((entity) => entity.entityId === "player-far")!;
    expect(far.series).toHaveLength(5);
    for (const step of far.series) {
      expect(step.fromMeters).toEqual({ x: 120, y: 34 });
      expect(step.displacementMeters).toBe(0);
    }
  });
});

describe("measureGeometryDrift — teleport detection", () => {
  test("teleported player: jumps on both the inbound and outbound pair", () => {
    const perturbed = injectGeometryTeleport(cleanManifest(), {
      frameIndex: 2,
      entityId: "player-7",
      toMeters: { x: 90, y: 34 },
    });
    const metrics = measureGeometryDrift(perturbed);
    expect(metrics.jumpCount).toBe(2); // (1->2) 36.7 m and (2->3) 35.1 m in 1 s
    expect(metrics.maxJumpMeters).toBeCloseTo(36.7, 10); // the inbound teleport distance
    const player7 = metrics.perEntity.find((entity) => entity.entityId === "player-7")!;
    expect(player7.maxJumpMeters).toBeCloseTo(36.7, 10);
    const inbound = player7.series.find((step) => step.toFrameIndex === 2)!;
    expect(inbound.displacementMeters).toBeCloseTo(90 - 53.3, 10);
    expect(inbound.exceedsBound).toBe(true);
    expect(inbound.jumpRatio).toBeGreaterThan(1);
    expect(metrics.maxJumpRatio).toBeGreaterThan(2);
  });
});

describe("measureGeometryDrift — honest gap accounting (never interpolated)", () => {
  test("a mid-clip justified omission breaks the series: 4 steps, one spanning the gap", () => {
    // player-9 rendered -> omitted-no-position (position dropped) -> rendered.
    const perturbed = injectDispositionFlap(cleanManifest(), {
      frameIndex: 2,
      entityId: "player-9",
    });
    const metrics = measureGeometryDrift(perturbed);
    const player9 = metrics.perEntity.find((entity) => entity.entityId === "player-9")!;
    expect(player9.series).toHaveLength(4); // NOT 5: the gap frame produces no step
    expect(player9.measuredFrameCount).toBe(5);
    expect(player9.gapFrameCount).toBe(1);
    expect(player9.gapSpanCount).toBe(1);
    const spanning = player9.series.find((step) => step.spansGap)!;
    expect(spanning.fromFrameIndex).toBe(1);
    expect(spanning.toFrameIndex).toBe(3);
    expect(spanning.dtMs).toBe(2_000);
    expect(spanning.boundMeters).toBe(25.01); // bound scaled to the FULL elapsed time
    expect(spanning.displacementMeters).toBeCloseTo(1.2, 10);
    expect(spanning.exceedsBound).toBe(false); // 1.2 m over 2 s is plausible
    expect(metrics.gapFrameCount).toBe(1);
  });

  test("a gap never masks a teleport: endpoint displacement over the full span is judged", () => {
    // player-9's frame-2 position is dropped (gap) AND frame 3 teleports:
    // the (1 -> 3) pair spans the gap with ~60 m over 2 s > 25.01 m bound.
    let perturbed = cleanManifest();
    perturbed = injectDispositionFlap(perturbed, { frameIndex: 2, entityId: "player-9" });
    perturbed = injectGeometryTeleport(perturbed, {
      frameIndex: 3,
      entityId: "player-9",
      toMeters: { x: 90, y: 20 },
    });
    const metrics = measureGeometryDrift(perturbed);
    const player9 = metrics.perEntity.find((entity) => entity.entityId === "player-9")!;
    const spanning = player9.series.find((step) => step.spansGap)!;
    expect(spanning.exceedsBound).toBe(true);
    expect(player9.jumpCount).toBe(2); // (1->3) across the gap and (3->4) back
    expect(metrics.jumpCount).toBe(2);
  });
});

describe("measureGeometryDrift — kind-specific bounds and boundary semantics", () => {
  test("ball at 39 m/s passes (ball bound 40); the same displacement as a player fails", () => {
    // frame 1 ball position: (51.0, 34.5) — a 39 m displacement in 1 s.
    const ballTeleported = injectGeometryTeleport(cleanManifest(), {
      frameIndex: 2,
      entityId: "ball-1",
      toMeters: { x: 90, y: 34.5 },
    });
    const ballMetrics = measureGeometryDrift(ballTeleported);
    const ball = ballMetrics.perEntity.find((entity) => entity.entityId === "ball-1")!;
    const inbound = ball.series.find((step) => step.toFrameIndex === 2)!;
    expect(inbound.displacementMeters).toBeCloseTo(39, 10);
    expect(inbound.exceedsBound).toBe(false); // 39 < 40.01
    expect(ballMetrics.jumpCount).toBe(0);

    const playerTeleported = injectGeometryTeleport(cleanManifest(), {
      frameIndex: 2,
      entityId: "player-7",
      toMeters: { x: 91.5, y: 34 },
    });
    const playerMetrics = measureGeometryDrift(playerTeleported);
    expect(playerMetrics.jumpCount).toBe(2); // player at 39 m/s is impossible
  });

  test("near-boundary: just below the bound passes, just above fails (inclusive pass)", () => {
    // player-7 at frame 2: previous position (53.3, 34), dt 1000, bound 12.51.
    // 12.4 m passes; 12.7 m fails on the inbound pair (the outbound pair
    // back to frame 3's true (54.9, 34) is 11.1 m — inside the bound).
    const below = injectGeometryTeleport(cleanManifest(), {
      frameIndex: 2,
      entityId: "player-7",
      toMeters: { x: 65.7, y: 34 },
    });
    expect(measureGeometryDrift(below).jumpCount).toBe(0);
    const above = injectGeometryTeleport(cleanManifest(), {
      frameIndex: 2,
      entityId: "player-7",
      toMeters: { x: 66.0, y: 34 },
    });
    const aboveMetrics = measureGeometryDrift(above);
    expect(aboveMetrics.jumpCount).toBe(1);
    const inbound = aboveMetrics.perEntity
      .find((entity) => entity.entityId === "player-7")!
      .series.find((step) => step.toFrameIndex === 2)!;
    expect(inbound.displacementMeters).toBeCloseTo(12.7, 10);
    expect(inbound.jumpRatio).toBeGreaterThan(1);
  });

  test("every step's exceedsBound equals displacement > bound (self-consistent evidence)", () => {
    const perturbed = injectGeometryTeleport(cleanManifest(), {
      frameIndex: 3,
      entityId: "ball-1",
      toMeters: { x: 10, y: 60 },
    });
    const metrics = measureGeometryDrift(perturbed);
    for (const entity of metrics.perEntity) {
      for (const step of entity.series) {
        expect(step.exceedsBound).toBe(step.displacementMeters > step.boundMeters);
        expect(step.jumpRatio).toBeCloseTo(step.displacementMeters / step.boundMeters, 12);
      }
    }
  });
});

describe("measureGeometryDrift — determinism", () => {
  test("two measurements of the same manifest are deep-equal", () => {
    const manifest = cleanManifest();
    expect(measureGeometryDrift(manifest)).toEqual(measureGeometryDrift(manifest));
  });
});
