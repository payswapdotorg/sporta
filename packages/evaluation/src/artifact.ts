/**
 * The W403 evaluation artifact and the frozen-fixture contract (types only).
 *
 * A {@link WorldModelArtifact} is the CANONICAL, SERIALIZABLE form of
 * everything the W403 evaluation measures: one deterministic walk
 * fixture → W005 store → W401 fusion (twice — the second pass is the
 * idempotence evidence) → W402 temporal outputs (`stateAt` at pinned
 * timestamps, one `eventWindow`, one `replayForward`). It is a PURE PROJECTION
 * of the world-model outputs — values are carried verbatim, never invented,
 * coerced, or rounded.
 *
 * The artifact carries the sha256 of the fixture BYTES it was produced from:
 * every comparison of two artifacts therefore also proves both runs consumed
 * the identical frozen input (the field is compared `EXACT`).
 */
import type { Observation, WorldEventStreamEntry, WorldSnapshot } from "@sporta/contracts";
import type { FootballState } from "@sporta/world-model";
import type { FusionReport } from "@sporta/fusion";
import type { ReplayLimits } from "@sporta/temporal";

/** Canonical artifact schema tag (bump on any artifact shape change). */
export const ARTIFACT_SCHEMA = "w403-artifact/1";

/** The frozen fixture's kind tag. */
export const FIXTURE_KIND = "w403-fixture/1";

/**
 * The canonical, deterministic world-model artifact of one evaluation run.
 * Every field is JSON-serializable as-is; the serializer
 * (`serializeArtifact`) is the byte-level authority on its form.
 */
export interface WorldModelArtifact {
  /** Artifact schema tag (EXACT-compared; never silently drifted). */
  readonly artifactSchema: typeof ARTIFACT_SCHEMA;
  /** The fixture's own id string (EXACT-compared). */
  readonly fixtureId: string;
  /** sha256 (hex) over the fixture FILE bytes this run consumed (EXACT-compared). */
  readonly fixtureSha256: string;
  /**
   * The fusion pass over the fixture: `first` = the initial deterministic
   * `runWorldFusion` pass; `refusion` = the immediate second pass over the
   * SAME store and engine (W401's documented idempotent re-fusion — its
   * counters and unchanged `snapshotVersionAfter` are the idempotence
   * evidence, compared field-by-field like everything else).
   */
  readonly fusion: {
    readonly first: FusionReport;
    readonly refusion: FusionReport;
  };
  /**
   * `stateAt(engine, T).snapshot` for every pinned timestamp T of the fixture,
   * keyed by `String(T)`. Keys are exactly the fixture's pins (asserted).
   */
  readonly stateAt: Readonly<Record<string, WorldSnapshot>>;
  /** The event-time window queried over `engine.eventsSince(0)` and its entries. */
  readonly eventWindow: {
    readonly fromMs: number;
    readonly toMs: number;
    readonly entries: readonly WorldEventStreamEntry[];
  };
  /**
   * The `replayForward` result over the event window (checkpoints, final
   * snapshot, and the supersession/orphan/duplicate accounting — all
   * deterministic; `generatedAtMs` is forced to `REPLAY_GENERATED_AT_MS` by
   * the temporal package itself).
   */
  readonly replay: {
    readonly eventsApplied: number;
    readonly correctionsApplied: number;
    readonly supersededSkipped: number;
    readonly correctionsOrphaned: number;
    readonly duplicatesSkipped: number;
    readonly limits: ReplayLimits;
    readonly checkpoints: readonly WorldSnapshot[];
    readonly final: WorldSnapshot;
  };
}

/** The parsed, validated frozen fixture (W403's fixed input). */
export interface FixtureSpec {
  /** Fixture identity (echoed into the artifact as `fixtureId`). */
  readonly fixtureId: string;
  /** Kind tag — must equal {@link FIXTURE_KIND}. */
  readonly fixtureKind: string;
  /** The media session every observation and the engine belong to. */
  readonly sessionId: string;
  /** The fusion pass's declared spatial frame for the track stream. */
  readonly trackFrame: "pitch";
  /** Possession radius in canonical pitch meters (fusion input). */
  readonly possessionRadiusM: number;
  /** Engine bounded-reorder window (engine init). */
  readonly maxReorderMs: number;
  /** Engine initial football state (caller-provided replay context). */
  readonly footballInit: FootballState;
  /** Pinned timestamps for `stateAt` (asserted ascending, unique, ≥ 0). */
  readonly pinnedStateAtMs: readonly number[];
  /** Event-time window bounds for `eventWindow`. */
  readonly eventWindow: { readonly fromMs: number; readonly toMs: number };
  /** Replay limits for `replayForward`. */
  readonly replay: ReplayLimits;
  /** The frozen observation stream, in the fixture's fixed array order. */
  readonly observations: readonly Observation[];
}
