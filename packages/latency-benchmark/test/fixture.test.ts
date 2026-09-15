/**
 * The W306 live-stream fixture: construction invariants, the burst
 * sub-stepping, the arrival schedule arithmetic, determinism, and the
 * fail-loud profile validation.
 */
import { describe, expect, test } from "bun:test";
import { buildLiveFixture, LIVE_FIXTURE_PROFILE } from "../src/fixture";
import type { LiveFixtureProfile } from "../src/fixture";
import { LatencyFixtureError } from "../src/errors";
import { WorldSnapshot } from "@sporta/contracts";

/** A small valid profile (fast construction for structural tests). */
function smallProfile(overrides: Partial<LiveFixtureProfile> = {}): LiveFixtureProfile {
  return {
    ...LIVE_FIXTURE_PROFILE,
    profileId: "w306-test-fixture",
    seed: "w306-test-seed",
    seconds: 12,
    burstEventFromMs: 4_000,
    burstEventToMs: 6_000,
    burstUpdatesPerSecond: 4,
    ...overrides,
  };
}

describe("buildLiveFixture (the checked-in default profile)", () => {
  test("the default profile builds exactly 240 steps over 90 event seconds", () => {
    // 80 normal seconds (1 update each) + 10 burst seconds × 16 = 240.
    const fixture = buildLiveFixture();
    expect(fixture.steps).toHaveLength(240);
    expect(fixture.profile).toBe(LIVE_FIXTURE_PROFILE);
    expect(fixture.sessionId).toBe("sess-w306-live-fixture");
  });

  test("burst seconds are sub-stepped at 16 marks/second, normal at 1", () => {
    const fixture = buildLiveFixture();
    // The burst window [30000, 40000) covers the OWNING SECONDS 30..39 (a
    // second is dense iff its END boundary is inside the window) — 10 dense
    // seconds × 16 marks. The (29000, 39000] watermark range captures exactly
    // those marks; second 40 is NORMAL (its end boundary 40000 is outside the
    // burst window by the [from, to) convention).
    const burstMarks = fixture.steps.filter(
      (step) =>
        step.update.watermark.watermarkMs > 29_000 && step.update.watermark.watermarkMs <= 39_000,
    );
    expect(burstMarks).toHaveLength(160);
    // The first burst second's marks: 29 062.5 … 30 000 (16 sub-windows).
    const firstSecondMarks = fixture.steps
      .filter(
        (s) => s.update.watermark.watermarkMs > 29_000 && s.update.watermark.watermarkMs <= 30_000,
      )
      .map((s) => s.update.watermark.watermarkMs);
    expect(firstSecondMarks).toHaveLength(16);
    expect(firstSecondMarks[0]).toBe(29_062.5);
    expect(firstSecondMarks[15]).toBe(30_000);
    // The LAST burst second (39) is dense; second 40 is normal again.
    const lastBurstSecond = fixture.steps.filter(
      (s) => s.update.watermark.watermarkMs > 38_000 && s.update.watermark.watermarkMs <= 39_000,
    );
    expect(lastBurstSecond).toHaveLength(16);
    const secondForty = fixture.steps.filter(
      (s) => s.update.watermark.watermarkMs > 39_000 && s.update.watermark.watermarkMs <= 40_000,
    );
    expect(secondForty).toHaveLength(1);
    expect(secondForty[0]!.update.watermark.watermarkMs).toBe(40_000);
  });

  test("every update is a real W006/W402 document with a schema-valid snapshot", () => {
    const fixture = buildLiveFixture();
    for (const [index, step] of fixture.steps.entries()) {
      expect(step.sequence).toBe(index);
      expect(step.update.sequence).toBe(index);
      expect(step.update.byteSize).toBe(LIVE_FIXTURE_PROFILE.byteSize);
      const parsed = WorldSnapshot.safeParse(step.update.snapshot);
      expect(parsed.success).toBe(true);
    }
  });

  test("the 8 authored events partition across exactly one window each", () => {
    const fixture = buildLiveFixture();
    const totalEvents = fixture.steps.reduce((sum, step) => sum + step.update.events.length, 0);
    expect(totalEvents).toBe(8);
    const seen = new Set<string>();
    for (const step of fixture.steps) {
      for (const entry of step.update.events) {
        expect(seen.has(entry.event.eventId)).toBe(false);
        seen.add(entry.event.eventId);
      }
    }
    expect(seen.size).toBe(8);
  });

  test("visibility strictly increases and matches the schedule arithmetic", () => {
    const fixture = buildLiveFixture();
    for (let i = 0; i < fixture.steps.length; i += 1) {
      const step = fixture.steps[i]!;
      expect(step.visibleAtMs).toBe(step.observedAtMs + step.deriveMs);
      expect(step.deriveMs).toBeGreaterThanOrEqual(LIVE_FIXTURE_PROFILE.deriveMinMs);
      expect(step.deriveMs).toBeLessThanOrEqual(LIVE_FIXTURE_PROFILE.deriveMaxMs);
      if (i > 0) {
        expect(step.visibleAtMs).toBeGreaterThan(fixture.steps[i - 1]!.visibleAtMs);
        expect(step.observedAtMs).toBeGreaterThan(fixture.steps[i - 1]!.observedAtMs);
      }
    }
  });

  test("deterministic: the same profile builds a deep-equal fixture twice", () => {
    expect(buildLiveFixture()).toEqual(buildLiveFixture());
  });

  test("different seeds build different schedules (the PRNG is live, not a constant)", () => {
    const a = buildLiveFixture({ ...LIVE_FIXTURE_PROFILE, seed: "seed-a" });
    const b = buildLiveFixture({ ...LIVE_FIXTURE_PROFILE, seed: "seed-b" });
    expect(a.steps.map((s) => s.visibleAtMs)).not.toEqual(b.steps.map((s) => s.visibleAtMs));
  });
});

describe("buildLiveFixture (structural variants)", () => {
  test("a small profile builds normal + burst steps with burst cadence", () => {
    const fixture = buildLiveFixture(smallProfile());
    // 10 normal seconds + 2 burst seconds × 4 = 18 steps. The burst window
    // [4000, 6000) covers owning seconds 4 and 5; the (3000, 5000] watermark
    // range captures their 8 dense marks (second 6's end boundary 6000 is
    // OUTSIDE the [from, to) burst window — its 6000 mark is normal).
    expect(fixture.steps).toHaveLength(18);
    const burstSteps = fixture.steps.filter(
      (s) => s.update.watermark.watermarkMs > 3_000 && s.update.watermark.watermarkMs <= 5_000,
    );
    expect(burstSteps).toHaveLength(8);
    const normalSix = fixture.steps.filter(
      (s) => s.update.watermark.watermarkMs > 5_000 && s.update.watermark.watermarkMs <= 6_000,
    );
    expect(normalSix).toHaveLength(1);
    expect(normalSix[0]!.update.watermark.watermarkMs).toBe(6_000);
  });

  test("the participant stays in pitch bounds for the whole story (well-formed renders)", () => {
    const fixture = buildLiveFixture(smallProfile({ seconds: 95 }));
    for (const step of fixture.steps) {
      for (const entity of step.update.snapshot.entities) {
        const position = entity.state.pitchPosition;
        if (position !== undefined && position.status === "known") {
          const { x, y } = position.value as { x: number; y: number };
          expect(x).toBeGreaterThan(0);
          expect(x).toBeLessThan(105);
          expect(y).toBeGreaterThan(0);
          expect(y).toBeLessThan(68);
        }
      }
    }
  });

  test("a 2-second minimal profile builds", () => {
    const fixture = buildLiveFixture(
      smallProfile({ seconds: 2, burstEventFromMs: 1_000, burstEventToMs: 2_000 }),
    );
    expect(fixture.steps).toHaveLength(1 + 4);
  });
});

describe("profile validation (fail loud, typed)", () => {
  test("every invalid dimension refuses with LatencyFixtureError", () => {
    const cases: Array<[string, Partial<LiveFixtureProfile>]> = [
      ["seconds 0", { seconds: 0 }],
      ["seconds non-integer", { seconds: 2.5 }],
      ["normalGapMs 0", { normalGapMs: 0 }],
      ["burstGapMs negative", { burstGapMs: -1 }],
      ["burstUpdatesPerSecond 1", { burstUpdatesPerSecond: 1 }],
      ["burst window inverted", { burstEventFromMs: 5_000, burstEventToMs: 4_000 }],
      ["burst window beyond story", { burstEventFromMs: 4_000, burstEventToMs: 99_999 }],
      ["burst window at time 0", { burstEventFromMs: 0 }],
      ["derive range inverted", { deriveMinMs: 200, deriveMaxMs: 80 }],
      ["derive negative", { deriveMinMs: -1 }],
      ["derive non-integer", { deriveMinMs: 0.5 }],
      ["byteSize 0", { byteSize: 0 }],
      ["firstObservationAtMs negative", { firstObservationAtMs: -1 }],
      ["maxArrivalJitterMs negative", { maxArrivalJitterMs: -1 }],
      ["profileVersion 0", { profileVersion: 0 }],
      ["profileId empty", { profileId: "" }],
      ["seed empty", { seed: "" }],
    ];
    for (const [label, overrides] of cases) {
      try {
        buildLiveFixture(smallProfile(overrides));
        expect.unreachable(`${label} should have refused`);
      } catch (err) {
        expect(err).toBeInstanceOf(LatencyFixtureError);
        expect((err as Error).message.length).toBeGreaterThan(0);
      }
    }
  });

  test("the error is a typed latency-benchmark error", () => {
    try {
      buildLiveFixture(smallProfile({ seconds: 0 }));
      expect.unreachable();
    } catch (err) {
      expect((err as { scope?: string }).scope).toBe("latency-benchmark");
      expect((err as { code?: string }).code).toBe("invalid-fixture");
    }
  });
});
