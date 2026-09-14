/**
 * W402 e2e (M2 slice): the full consumer chain —
 *
 * store (W005) → `runWorldFusion` (W401) → `A.eventsSince(0)` → `eventWindow`
 * → `replayForward` — asserting the final snapshot parses against the
 * `WorldSnapshot` contract, the entity count matches engine A at the same
 * boundary, and the football state is carried (the post-match clock rule
 * from the fixture's fulltime candidate, via the at-T surface and a replay
 * seeded at the post-match boundary).
 */
import { describe, expect, test } from "bun:test";
import { WorldSnapshot } from "@sporta/contracts";
import { TEST_EPOCH_MS } from "@sporta/testing";
import { eventWindow, replayForward, stateAt } from "../src/index";
import type { ReplayLimits } from "../src/index";
import { buildE2EObservations, fuse, makeFootballState } from "./helpers";

const LIMITS: ReplayLimits = { maxEvents: 100, maxSpanMs: 120_000, checkpointEveryMs: 2_000 };

describe("e2e (M2 slice): store → fusion → eventsSince → eventWindow → replayForward", () => {
  const { engine: engineA } = fuse(buildE2EObservations(), { football: makeFootballState() });

  test("engine A's event stream is the three mapped commentary events", () => {
    const entries = engineA.eventsSince(0);
    expect(entries.map((entry) => entry.event.eventId)).toEqual([
      "fe-ceu-ec-1",
      "fe-ceu-ec-2",
      "fe-ceu-ec-3",
    ]);
    expect(entries.map((entry) => entry.event.eventTimeMs)).toEqual([500, 3_000, 6_000]);
  });

  test("the full-span replay's final snapshot parses against the WorldSnapshot contract", () => {
    const entries = engineA.eventsSince(0);
    // Full span: from the timeline start to engine A's current watermark
    // (10_500 — the football timeline marker the fulltime patch moved).
    const window = eventWindow(entries, {
      fromMs: 0,
      toMs: engineA.snapshot().watermark.watermarkMs,
    });
    expect(window).toHaveLength(3);
    const replay = replayForward({
      entries: window,
      limits: LIMITS,
      // The football state at the window start: the genesis state the
      // consumer knows (the engine does not back-date football state, so
      // stateAt(A, 0).football is absent — see the replay module docs).
      init: { football: makeFootballState() },
    });
    expect(WorldSnapshot.safeParse(replay.final).success).toBe(true);
    expect(replay.eventsApplied).toBe(3);
    expect(replay.correctionsApplied).toBe(0);
    expect(replay.final.sessionId).toBe(engineA.sessionId);
  });

  test("entity count matches engine A at the same boundary (net effect equivalence)", () => {
    const window = eventWindow(engineA.eventsSince(0), { fromMs: 0, toMs: 10_500 });
    const replay = replayForward({
      entries: window,
      limits: LIMITS,
      init: { football: makeFootballState() },
    });
    const boundary = replay.final.watermark.watermarkMs;

    // At the event-log boundary (6_000 — the last event time), engine A holds
    // NO entities yet (every entity's lastEventTimeMs is 10_000), and the
    // replay — rebuilding exactly the event-log state — holds none either:
    // the counts match at the same boundary. Events carry no entity state;
    // entity state at T is the at-T surface's job (stateAt).
    expect(replay.final.entities).toHaveLength(0);
    expect(engineA.snapshot(boundary).entities).toHaveLength(0);
    expect(replay.final.entities).toEqual(engineA.snapshot(boundary).entities);

    // The FULL-span replay reproduces engine A's event-log watermark EXACTLY
    // (same timeline position AND same sequence numbering — the net effect
    // of applying the same events in the same order).
    expect(replay.final.watermark).toEqual({ watermarkMs: 6_000, sequence: 3 });
    expect(engineA.snapshot(6_000).watermark).toEqual({ watermarkMs: 6_000, sequence: 3 });

    // The intentional generatedAtMs difference: the replay's forced
    // deterministic constant vs the live engine's wall-clock source.
    expect(replay.final.generatedAtMs).toBe(0);
    expect(engineA.snapshot().generatedAtMs).toBe(TEST_EPOCH_MS);
  });

  test("football state is carried: the seed passes through the replay verbatim", () => {
    const window = eventWindow(engineA.eventsSince(0), { fromMs: 0, toMs: 10_500 });
    const replay = replayForward({
      entries: window,
      limits: LIMITS,
      init: { football: makeFootballState() },
    });
    // The window's events include no football patches (the fulltime
    // candidate yields a football clock PATCH in fusion, never an event), so
    // the carried football state is the window-start seed, verbatim.
    expect(replay.final.football).toEqual(makeFootballState());
    // The fulltime candidate's post-match clock rule IS established in the
    // fusion-fed engine — visible through the at-T surface:
    expect(stateAt(engineA, 10_500).snapshot.football?.clock.period).toBe("post-match");
    expect(engineA.snapshot().football?.clock.period).toBe("post-match");
  });

  test("a replay seeded at the post-match boundary carries the post-match football state", () => {
    // A consumer replaying forward FROM the post-match boundary seeds the
    // football state there — the state at the window start is exactly the
    // fulltime candidate's post-match rule.
    const after = eventWindow(engineA.eventsSince(0), { fromMs: 10_500, toMs: 20_000 });
    expect(after).toEqual([]); // the event log ends at 6_000
    const seed = stateAt(engineA, 10_500).snapshot.football;
    expect(seed?.clock.period).toBe("post-match");
    const replay = replayForward({ entries: after, limits: LIMITS, init: { football: seed } });
    expect(replay.eventsApplied).toBe(0);
    expect(replay.checkpoints).toHaveLength(1); // final only — always present
    expect(replay.final.football?.clock.period).toBe("post-match");
    expect(WorldSnapshot.safeParse(replay.final).success).toBe(true);
  });

  test("the consumer catch-up path: stateAt → eventsSince(watermark) → eventWindow → replayForward", () => {
    // The W402 consumer flow: hold the state at T, resume the event stream
    // from the snapshot's watermark sequence, window it forward, replay it.
    const held = stateAt(engineA, 2_000).snapshot;
    expect(held.watermark).toEqual({ watermarkMs: 500, sequence: 1 });
    const resume = eventWindow(engineA.eventsSince(held.watermark.sequence), {
      fromMs: 2_000,
      toMs: 6_500,
    });
    expect(resume.map((entry) => entry.event.eventId)).toEqual(["fe-ceu-ec-2", "fe-ceu-ec-3"]);
    const replay = replayForward({ entries: resume, limits: LIMITS });
    expect(replay.eventsApplied).toBe(2);
    expect(replay.final.watermark).toEqual({ watermarkMs: 6_000, sequence: 2 });
    expect(WorldSnapshot.safeParse(replay.final).success).toBe(true);
  });
});
