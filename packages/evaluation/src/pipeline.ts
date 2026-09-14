/**
 * The W403 evaluation pipeline (pure, deterministic).
 *
 * One fixed input → one canonical world-model artifact:
 *
 * 1. load the FROZEN fixture (byte-stable, sha256-pinned);
 * 2. append its observations to a fresh W005 `InMemoryObservationStore` in the
 *    fixture's fixed array order;
 * 3. create a W006 engine with the fixture's football init and an INJECTED
 *    clock (`now: () => TEST_EPOCH_MS` — never a wall-clock read);
 * 4. run W401 `runWorldFusion` — twice: `first`, then the immediate `refusion`
 *    over the same store+engine (the idempotent re-fusion evidence);
 * 5. W402 temporal outputs: `stateAt` at every pinned timestamp, one
 *    `eventWindow` over `engine.eventsSince(0)`, and one `replayForward` over
 *    that window (football init caller-pinned per the documented W402
 *    limitation — entity state is not reconstructible from event windows);
 * 6. assemble the artifact, ASSERT its structural shape (fail loud on unknown
 *    keys) and its forced-constant clock fields, and serialize it.
 *
 * No `Math.random`, no `Date.now`, no ambient state: the same fixture file
 * produces a byte-identical canonical artifact on every call.
 */
import { runWorldFusion } from "@sporta/fusion";
import { eventWindow, replayForward, stateAt } from "@sporta/temporal";
import { REPLAY_GENERATED_AT_MS } from "@sporta/temporal";
import { InMemoryObservationStore } from "@sporta/observation";
import { TEST_EPOCH_MS } from "@sporta/testing";
import { WorldModelEngine } from "@sporta/world-model";
import { ARTIFACT_SCHEMA } from "./artifact";
import type { WorldModelArtifact } from "./artifact";
import { loadFixture } from "./fixture";
import type { LoadedFixture } from "./fixture";
import { assertArtifactShape } from "./shape";
import { serializeArtifact } from "./serialize";

/** Everything one evaluation run produces. */
export interface PipelineResult {
  /** The canonical artifact (plain, JSON-serializable data). */
  readonly artifact: WorldModelArtifact;
  /** The artifact's canonical serialization bytes (sorted keys, full precision). */
  readonly canonical: string;
  /** The loaded fixture (spec + sha256) — for callers that echo provenance. */
  readonly fixture: LoadedFixture;
}

/**
 * Runs the evaluation pipeline over a frozen fixture file.
 *
 * @param fixturePath path to the checked-in fixture (default: the W403 fixture)
 */
export function runFixtureEvaluation(fixturePath?: string): PipelineResult {
  const fixture = loadFixture(fixturePath ?? undefined);
  const spec = fixture.spec;

  // -- W005 store: the frozen observation stream, fixture array order --------
  const store = new InMemoryObservationStore();
  for (const observation of spec.observations) {
    store.append(observation);
  }

  // -- W006 engine: football init from the fixture, INJECTED constant clock ---
  const engine = WorldModelEngine.create(spec.sessionId, {
    football: spec.footballInit,
    maxReorderMs: spec.maxReorderMs,
    now: () => TEST_EPOCH_MS,
  });

  // -- W401 fusion: first pass, then the idempotent re-fusion ----------------
  const first = runWorldFusion({
    store,
    engine,
    sessionId: spec.sessionId,
    trackFrame: spec.trackFrame,
    possessionRadiusM: spec.possessionRadiusM,
  });
  const refusion = runWorldFusion({
    store,
    engine,
    sessionId: spec.sessionId,
    trackFrame: spec.trackFrame,
    possessionRadiusM: spec.possessionRadiusM,
  });

  // -- W402 temporal outputs --------------------------------------------------
  const stateAtSnapshots: Record<string, ReturnType<typeof stateAt>["snapshot"]> = {};
  for (const t of spec.pinnedStateAtMs) {
    stateAtSnapshots[String(t)] = stateAt(engine, t).snapshot;
  }

  const entries = eventWindow(engine.eventsSince(0), {
    fromMs: spec.eventWindow.fromMs,
    toMs: spec.eventWindow.toMs,
  });

  // The replay's football context is CALLER-PINNED (documented W402
  // limitation: the event window carries no entity/football state — upserts
  // and clock patches are not events). Pinning the fused engine's final
  // football state is the documented consumer pattern.
  const replay = replayForward({
    entries,
    limits: {
      maxEvents: spec.replay.maxEvents,
      maxSpanMs: spec.replay.maxSpanMs,
      checkpointEveryMs: spec.replay.checkpointEveryMs,
    },
    init: { football: engine.snapshot().football },
  });

  // -- The artifact: a pure projection of the outputs above ------------------
  const artifact: WorldModelArtifact = {
    artifactSchema: ARTIFACT_SCHEMA,
    fixtureId: spec.fixtureId,
    fixtureSha256: fixture.sha256,
    fusion: { first, refusion },
    stateAt: stateAtSnapshots,
    eventWindow: {
      fromMs: spec.eventWindow.fromMs,
      toMs: spec.eventWindow.toMs,
      entries,
    },
    replay: {
      eventsApplied: replay.eventsApplied,
      correctionsApplied: replay.correctionsApplied,
      supersededSkipped: replay.supersededSkipped,
      correctionsOrphaned: replay.correctionsOrphaned,
      duplicatesSkipped: replay.duplicatesSkipped,
      limits: { ...replay.limits },
      checkpoints: [...replay.checkpoints],
      final: replay.final,
    },
  };

  // -- Fail-loud self-checks before serialization ----------------------------
  assertArtifactShape(artifact, spec.pinnedStateAtMs);
  assertForcedClockConstants(artifact);

  return { artifact, canonical: serializeArtifact(artifact), fixture };
}

/**
 * Asserts the volatile time fields are FORCED CONSTANTS (the tolerance
 * contract's replacement for exclusion — stronger, because a leaked wall-clock
 * read fails the evaluation instead of being ignored):
 *
 * - every live-engine snapshot (`stateAt.*`) carries `generatedAtMs === TEST_EPOCH_MS`
 *   (the pipeline's injected clock);
 * - every replay snapshot (`replay.checkpoints[*]`, `replay.final`) carries
 *   `generatedAtMs === REPLAY_GENERATED_AT_MS` (W402's forced constant).
 */
function assertForcedClockConstants(artifact: WorldModelArtifact): void {
  for (const pin of Object.keys(artifact.stateAt)) {
    const snapshot = artifact.stateAt[pin]!;
    if (snapshot.generatedAtMs !== TEST_EPOCH_MS) {
      throw new RangeError(
        `runFixtureEvaluation: $.stateAt.${pin}.generatedAtMs is ${snapshot.generatedAtMs}, ` +
          `not the injected constant TEST_EPOCH_MS (${TEST_EPOCH_MS}) — a wall-clock read ` +
          "leaked into the evaluated path",
      );
    }
  }
  const replaySnapshots = [...artifact.replay.checkpoints, artifact.replay.final];
  replaySnapshots.forEach((snapshot, index) => {
    const label =
      index < artifact.replay.checkpoints.length
        ? `$.replay.checkpoints[${index}]`
        : "$.replay.final";
    if (snapshot.generatedAtMs !== REPLAY_GENERATED_AT_MS) {
      throw new RangeError(
        `runFixtureEvaluation: ${label}.generatedAtMs is ${snapshot.generatedAtMs}, not the ` +
          `forced constant REPLAY_GENERATED_AT_MS (${REPLAY_GENERATED_AT_MS})`,
      );
    }
  });
}
