/**
 * W402 §3.4 e2e tests (M2 slice): the full consumer chain —
 * W005 store → W401 `runWorldFusion` → `eventsSince(0)` → `eventWindow` →
 * `replayForward` — over both fusion fixtures:
 *
 * - the candidates-only fixture isolates the event-driven chain: the final
 *   snapshot parses against the `WorldSnapshot` contract, the entity count
 *   matches the fused engine, and the football context (the post-match clock
 *   rule the fixture's fulltime candidate established) is carried;
 * - the multi-stream fixture pins the documented intentional difference:
 *   the event stream carries NO entity state (entities come from W401's
 *   entity pass — upserts — which are not events), so the replay's entity
 *   state is empty while the fused engine's is not.
 */
import { describe, expect, test } from "bun:test";
import { WorldSnapshot } from "@sporta/contracts";
import { runWorldFusion } from "@sporta/fusion";
import { eventWindow, replayForward } from "../src/index";
import {
  SESSION_ID,
  buildCandidatesOnlyObservations,
  buildMultiStreamObservations,
  makeEngine,
  makeFootballState,
  makeStore,
} from "./helpers";

describe("e2e (M2 slice): store → runWorldFusion → eventsSince → eventWindow → replayForward", () => {
  test("candidates-only fixture: parse + entity count + football carried (post-match from fulltime)", () => {
    const store = makeStore(buildCandidatesOnlyObservations());
    const engine = makeEngine({ football: makeFootballState() });
    const report = runWorldFusion({ store, engine, sessionId: SESSION_ID });
    // The chain's shape: 3 events applied (kickoff, pass, goal), 1 fulltime
    // clock patch (fulltime yields NO event — W401 §3.1).
    expect(report.eventsApplied).toBe(3);
    expect(report.clockPatches).toBe(1);

    const entries = engine.eventsSince(0);
    expect(entries.length).toBe(3);
    // Full span of the event times: [0, 6000] covers every event.
    const window = eventWindow(entries, { fromMs: 0, toMs: 6_000 });
    expect(window.length).toBe(3);

    // The football context is CALLER-PROVIDED replay state: the fulltime
    // candidate's post-match clock rule lives in the fused engine (a clock
    // patch, not an event — the event window cannot re-derive it), so the
    // consumer pins the football state as replay init and the replay CARRIES
    // it verbatim into every snapshot.
    const fusedFootball = engine.snapshot().football;
    expect(fusedFootball).toBeDefined();
    const result = replayForward({
      entries: window,
      limits: { maxEvents: 10, maxSpanMs: 6_000, checkpointEveryMs: 1_000 },
      init: { football: fusedFootball },
    });

    // The final snapshot parses against the WorldSnapshot contract.
    const parsed = WorldSnapshot.safeParse(result.final);
    expect(parsed.success).toBe(true);

    // Entity count matches the fused engine (the candidates-only engine
    // carries no entities; so does the event-only replay).
    expect(result.final.entities.length).toBe(engine.entityIds.length);
    expect(result.final.entities).toEqual([]);

    // Football state carried — including the post-match clock rule the
    // fixture's fulltime candidate established.
    expect(result.final.football).toBeDefined();
    expect(result.final.football?.clock.period).toBe("post-match");
    expect(result.final.football?.clock.stoppage).toBe(false);
    expect(result.final.football).toEqual(fusedFootball);

    // Every checkpoint also carries the football context (frozen clones).
    for (const checkpoint of result.checkpoints) {
      expect(checkpoint.football?.clock.period).toBe("post-match");
    }

    // The replayed event-derived state: 3 applied, watermark at the last
    // event's time with the replay-local sequence.
    expect(result.eventsApplied).toBe(3);
    expect(result.final.watermark).toEqual({ watermarkMs: 6_000, sequence: 3 });
  });

  test("multi-stream fixture: final parses; entity state is the documented intentional difference", () => {
    const store = makeStore(buildMultiStreamObservations());
    const engine = makeEngine({ football: makeFootballState() });
    runWorldFusion({ store, engine, sessionId: SESSION_ID });
    const entries = engine.eventsSince(0);
    expect(entries.length).toBe(3);

    const window = eventWindow(entries, { fromMs: 0, toMs: 6_000 });
    const result = replayForward({
      entries: window,
      limits: { maxEvents: 10, maxSpanMs: 6_000, checkpointEveryMs: 1_000 },
    });

    expect(WorldSnapshot.safeParse(result.final).success).toBe(true);

    // INTENTIONAL DIFFERENCE (documented): the fused engine holds 3 tracked
    // entities; the replay's entity state is EMPTY because the event stream
    // carries no entity state — W401 builds entity positions through its
    // entity pass (engine upserts), which are not events and are not part of
    // the event window. An event-only forward replay cannot reconstruct
    // entity positions; reconstructing them would need a baseline-snapshot
    // seam, which is outside W402's specified input surface.
    expect(engine.entityIds.length).toBe(3);
    expect(result.final.entities).toEqual([]);

    // The event-derived net effect still matches the chain: 3 applied events
    // and the watermark at the last event's time.
    expect(result.eventsApplied).toBe(3);
    expect(result.final.watermark).toEqual({ watermarkMs: 6_000, sequence: 3 });
  });

  test("the full chain is deterministic end-to-end (two complete runs, deep-equal)", () => {
    const run = () => {
      const store = makeStore(buildCandidatesOnlyObservations());
      const engine = makeEngine({ football: makeFootballState() });
      runWorldFusion({ store, engine, sessionId: SESSION_ID });
      const window = eventWindow(engine.eventsSince(0), { fromMs: 0, toMs: 6_000 });
      return replayForward({
        entries: window,
        limits: { maxEvents: 10, maxSpanMs: 6_000, checkpointEveryMs: 1_000 },
        init: { football: engine.snapshot().football },
      });
    };
    expect(run()).toEqual(run());
  });
});
