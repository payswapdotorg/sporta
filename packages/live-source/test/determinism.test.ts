/**
 * THE DETERMINISTIC-REPLAY TESTS (L002's core accept criterion): the same
 * (seed, scenario) yields a BYTE-IDENTICAL observation sequence — every
 * scenario, pinned. Also: different seeds diverge, replay after a
 * mid-stream close is identical from the start (replay = re-run), and the
 * JSON encoding is stable (key order is insertion order — deterministic).
 */
import { describe, expect, test } from "bun:test";
import {
  LIVE_SCENARIO_KINDS,
  createDeterministicLiveSource,
  drainSource,
  type LiveScenarioKind,
} from "../src/index";

/** A compact-but-real configuration (fast tests; full roster by default). */
const BASE = {
  sessionId: "sess-l002-replay",
  seed: 20260920,
  tickCount: 150,
  rateMs: 200,
} as const;

function sequenceOf(scenario: LiveScenarioKind, seed: number): string {
  const source = createDeterministicLiveSource({ ...BASE, seed, scenario });
  const observations = drainSource(source);
  expect(observations.length).toBeGreaterThan(0);
  return JSON.stringify(observations);
}

describe("L002 deterministic replay — byte-identical per scenario", () => {
  for (const scenario of LIVE_SCENARIO_KINDS) {
    test(`scenario '${scenario}' replays byte-identically (same seed)`, () => {
      const first = sequenceOf(scenario, BASE.seed);
      const second = sequenceOf(scenario, BASE.seed);
      expect(second).toBe(first);
      // And a THIRD run (replay of the replay) stays identical.
      expect(sequenceOf(scenario, BASE.seed)).toBe(first);
    });
  }

  test("different seeds produce different sequences (every scenario)", () => {
    for (const scenario of LIVE_SCENARIO_KINDS) {
      const a = sequenceOf(scenario, 1);
      const b = sequenceOf(scenario, 2);
      expect(a).not.toBe(b);
    }
  });

  test("different scenarios produce different sequences at the same seed", () => {
    const sequences = new Set<string>();
    for (const scenario of LIVE_SCENARIO_KINDS) {
      sequences.add(sequenceOf(scenario, BASE.seed));
    }
    expect(sequences.size).toBe(LIVE_SCENARIO_KINDS.length);
  });

  test("replay after a mid-stream close restarts identically from tick 0", () => {
    const source = createDeterministicLiveSource({
      ...BASE,
      scenario: "out-of-order",
    });
    const head = drainSource(source, 17);
    source.close();
    expect(head.length).toBe(17);
    // The REPLAY: a fresh source over the same config reproduces the whole
    // sequence — including the 17 already-consumed observations.
    const full = drainSource(createDeterministicLiveSource({
      ...BASE,
      scenario: "out-of-order",
    }));
    expect(full.length).toBeGreaterThan(17);
    expect(JSON.stringify(full.slice(0, 17))).toBe(JSON.stringify(head));
  });

  test("the roster size changes the sequence (observations follow the script)", () => {
    const full = sequenceOf("normal", BASE.seed);
    const small = JSON.stringify(
      drainSource(
        createDeterministicLiveSource({ ...BASE, scenario: "normal", playersPerTeam: 5 }),
      ),
    );
    expect(small).not.toBe(full);
  });

  test("scenario CONFIG changes the delivery plan (not just the kind)", () => {
    const defaultDrop = sequenceOf("drop", BASE.seed);
    const configuredDrop = JSON.stringify(
      drainSource(
        createDeterministicLiveSource({
          ...BASE,
          scenario: { kind: "drop", dropRate: 0.4 },
        }),
      ),
    );
    expect(configuredDrop).not.toBe(defaultDrop);
    // And the same explicit config replays identically.
    const again = JSON.stringify(
      drainSource(
        createDeterministicLiveSource({
          ...BASE,
          scenario: { kind: "drop", dropRate: 0.4 },
        }),
      ),
    );
    expect(again).toBe(configuredDrop);
  });
});
