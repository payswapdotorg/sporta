/**
 * W403 integration tests — the in-process DOUBLE-RUN of the fixed fixture:
 * the full pipeline (fixture → W005 store → W401 fusion ×2 → W402 temporal
 * outputs → canonical artifact) is deep-equal across two complete runs, the
 * idempotent re-fusion evidence holds, the forced clock constants hold, and
 * the outputs parse against the W005/W006 contracts.
 */
import { describe, expect, test } from "bun:test";
import { WorldEventStreamEntry, WorldSnapshot } from "@sporta/contracts";
import { REPLAY_GENERATED_AT_MS } from "@sporta/temporal";
import { TEST_EPOCH_MS } from "@sporta/testing";
import { runFixtureEvaluation } from "../src/pipeline";
import { ARTIFACT_SCHEMA } from "../src/artifact";
import { compareWorldModelArtifacts } from "../src/compare";

describe("runFixtureEvaluation — the in-process double-run (integration)", () => {
  const first = runFixtureEvaluation();
  const second = runFixtureEvaluation();

  test("two complete runs produce deep-equal artifacts and identical canonical bytes", () => {
    expect(first.artifact).toEqual(second.artifact);
    expect(first.canonical).toBe(second.canonical);
  });

  test("the double-run also passes the field-classified comparator (0 diffs)", () => {
    const report = compareWorldModelArtifacts(first.artifact, second.artifact);
    expect(report.passed).toBe(true);
    expect(report.diffCount).toBe(0);
    expect(report.summary.maxAbsDeviation).toBe(0);
  });

  test("the artifact carries the fixture identity and its sha256", () => {
    expect(first.artifact.artifactSchema).toBe(ARTIFACT_SCHEMA);
    expect(first.artifact.fixtureId).toBe("w403-eval-fixture-1");
    expect(first.artifact.fixtureSha256).toBe(first.fixture.sha256);
    expect(first.artifact.fixtureSha256).toHaveLength(64);
  });

  test("the fixture actually exercises the measured paths (honest coverage pins)", () => {
    const { fusion, eventWindow, replay } = first.artifact;
    // Fusion: a real entity pass, a real event pass, a real clock patch.
    expect(fusion.first.entitiesUpserted).toBe(240);
    expect(fusion.first.eventsApplied).toBe(4);
    expect(fusion.first.clockPatches).toBe(1);
    expect(fusion.first.conflicts).toHaveLength(1);
    expect(fusion.first.conflicts[0]!.slotKey).toBe("possession");
    expect(fusion.first.warnings.length).toBeGreaterThan(0);
    // Event window: the 4 commentary-derived events, in engine order.
    expect(eventWindow.entries).toHaveLength(4);
    expect(replay.eventsApplied).toBe(4);
    expect(replay.checkpoints.length).toBe(4);
  });

  test("the idempotent re-fusion evidence holds (W401 semantics)", () => {
    const { first: firstReport, refusion } = first.artifact.fusion;
    // The second pass re-derives the SAME events → dedup, no re-application,
    // no entity re-upserts, and the snapshot version does not move.
    expect(refusion.eventsDeduplicated).toBe(4);
    expect(refusion.eventsApplied).toBe(0);
    expect(refusion.entitiesUpserted).toBe(0);
    expect(refusion.clockPatches).toBe(0);
    expect(refusion.snapshotVersionAfter).toBe(firstReport.snapshotVersionAfter);
  });

  test("stateAt keys are exactly the fixture's pinned timestamps", () => {
    expect(Object.keys(first.artifact.stateAt)).toEqual([
      "0",
      "2000",
      "4000",
      "6000",
      "8000",
      "10000",
      "11800",
    ]);
  });

  test("forced clock constants: live snapshots TEST_EPOCH_MS, replay REPLAY_GENERATED_AT_MS", () => {
    for (const snapshot of Object.values(first.artifact.stateAt)) {
      expect(snapshot.generatedAtMs).toBe(TEST_EPOCH_MS);
    }
    for (const snapshot of first.artifact.replay.checkpoints) {
      expect(snapshot.generatedAtMs).toBe(REPLAY_GENERATED_AT_MS);
    }
    expect(first.artifact.replay.final.generatedAtMs).toBe(REPLAY_GENERATED_AT_MS);
  });

  test("every snapshot parses against the WorldSnapshot contract", () => {
    for (const snapshot of Object.values(first.artifact.stateAt)) {
      expect(WorldSnapshot.safeParse(snapshot).success).toBe(true);
    }
    for (const checkpoint of first.artifact.replay.checkpoints) {
      expect(WorldSnapshot.safeParse(checkpoint).success).toBe(true);
    }
    expect(WorldSnapshot.safeParse(first.artifact.replay.final).success).toBe(true);
  });

  test("every event-window entry parses against the stream-entry contract", () => {
    for (const entry of first.artifact.eventWindow.entries) {
      expect(WorldEventStreamEntry.safeParse(entry).success).toBe(true);
    }
  });

  test("the canonical bytes round-trip losslessly (parse → serialize → equal)", () => {
    const roundTrip = JSON.parse(first.canonical);
    const reSerialized = JSON.stringify(roundTrip, null, 2) + "\n";
    // Full-precision guarantee: JSON round-trip preserves every double.
    expect(reSerialized).toBe(first.canonical);
  });
});
