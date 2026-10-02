/**
 * The DomainSimulationProfile seam (REL-032) — the SECOND half of the §3
 * seam generalization. The `DomainPack` contract
 * (../domain/domain-pack.ts) names WHAT a domain is; this profile names HOW
 * a domain RUNS inside the generic lab machinery:
 *
 * - `createSimulator`: the deterministic world-simulator factory for this
 *   domain's scenarios (clock, entities, event progression, observations,
 *   source timing, fault replay — the §4 simulator contract);
 * - `groundTruthEntityIds`: which persistent entities one tick's ground
 *   truth carries (the identity-continuity ground truth for evaluation);
 * - `periodOf`: the domain's period/phase label for the body input (football
 *  : 1|2 halves; basketball: 1..4 quarters — the generic body contract
 *   carries a positive integer period, the pack defines its semantics);
 * - `createLabEvaluator` / `createRewardEngine`: the domain's default
 *   evaluation wiring (the evaluator + reward engine the domain's lab runs
 *   use when a caller does not inject its own — the "derived" defaults).
 *
 * WHY THIS SEAM EXISTS (REL-032, architecture §3): the v0 ensemble /
 * simulation / search / calibration code imported the football pack
 * directly (`FootballDomainPack`, `generateFootballScenario`,
 * `createFootballWorldSimulator`). That coupling made "Basketball, tennis,
 * other sports, and non-sport event domains must plug into this seam"
 * (§3) impossible without editing generic code per domain. Everything the
 * generic lab machinery needs now flows through `DomainPack` (the §3
 * contract, via `DomainPackLabView`) + `DomainSimulationProfile` (this
 * seam), with the football entry points delegating — football behavior
 * stays byte-identical, and a second pack (basketball, ./basketball)
 * proves the seam.
 */
import type {
  DomainObservationBase,
  DomainPack,
  FaultProfile,
  HardInvalidityRule,
  ReplayAdapter,
  ScenarioConfigBase,
  ScenarioGenerator,
  ScenarioRecordBase,
} from "../domain/domain-pack";
import { LabValidationError } from "../errors";
import type { FaultSchedule } from "../robustness/faults";
import type { LabEvaluator } from "../evaluation/evaluator";
import type { RewardEngine } from "../reward/engine";

// ---------------------------------------------------------------------------
// The structural tick bases (what the generic runner READS from a tick)
// ---------------------------------------------------------------------------

/**
 * The source-timing snapshot base (simulated milliseconds; null when the
 * source is unavailable this tick — e.g. a compute-provider failure). The
 * same three generic source roles every pack's simulator publishes:
 * broadcast, tracking, events.
 */
export interface DomainSourceTiming {
  broadcastAvailableAtMs: number | null;
  trackingAvailableAtMs: number | null;
  eventsAvailableAtMs: number | null;
}

/** One applied fault occurrence within a tick (structural base). */
export interface DomainAppliedFault {
  faultKind: string;
  note: string;
}

/**
 * The structural minimum the generic lab runner reads from one simulated
 * tick. A domain's tick type (football's `SimulatedTick`, basketball's
 * `BasketballSimulatedTick`) satisfies this structurally: `period` is the
 * domain's phase label (a positive integer — `periodOf` defines it),
 * observations are the pack's typed observation union (each extends
 * `DomainObservationBase`), and `appliedFaults` carry the injected fault
 * kinds. Ground-truth world state and ground-truth events ride the tick as
 * the domain's OWN types — the runner never reads them directly; it goes
 * through the profile (`groundTruthEntityIds`) so the record's trajectory
 * stays fully typed evidence.
 */
export interface DomainRunnerTick {
  tickIndex: number;
  clockMs: number;
  period: number;
  observations: readonly DomainObservationBase[];
  appliedFaults: readonly DomainAppliedFault[];
}

/** A deterministic world simulator over a domain's tick type (§4). */
export interface DomainSimulator<TTick extends DomainRunnerTick = DomainRunnerTick> {
  readonly scenarioId: string;
  readonly tickCount: number;
  /** Advance one tick (throws past the end — use `steps()` for iteration). */
  step(): TTick;
  /** Iterate every tick from the current position (resumable mid-run). */
  steps(): IterableIterator<TTick>;
  /** Run to completion and materialize every tick (deterministic). */
  ticks(): readonly TTick[];
}

// ---------------------------------------------------------------------------
// The structural scenario minimum (tick-counted scenarios)
// ---------------------------------------------------------------------------

/**
 * The structural scenario minimum the generic ensemble/benchmark runners
 * read beyond the §3 record: the expected tick count inside the initial
 * conditions (the fault schedule's `tickCount` input). Football's and
 * basketball's scenario records both pin `expectedTickCount` — the §3
 * scenario-generator seam convention for any simulator-driven domain.
 */
export interface DomainRunnerScenario<
  TConfig extends ScenarioConfigBase = ScenarioConfigBase,
> extends ScenarioRecordBase<TConfig> {
  initialConditions: { expectedTickCount: number; [field: string]: unknown };
}

// ---------------------------------------------------------------------------
// The structural pack view (the §3 slice the generic lab machinery reads)
// ---------------------------------------------------------------------------

/**
 * The structural slice of `DomainPack` the generic lab machinery consumes.
 * Declared with defaulted generics so `DomainPackLabView` reads as the
 * un-parameterized view; a typed pack instantiation (football's, basketball's)
 * is structurally assignable to its parameterized form (interface methods
 * are bivariant, so typed scenario generators and replay adapters slot in).
 */
export interface DomainPackLabView<
  TConfig extends ScenarioConfigBase = ScenarioConfigBase,
  TScenario extends ScenarioRecordBase<TConfig> = ScenarioRecordBase<TConfig>,
> {
  domainPackId: string;
  version: string;
  /** The pack's declared render targets (the impossible-output-claim gate reads these). */
  renderTargets: readonly { targetId: string }[];
  /** The pack's hard invalidity rules (checked at claim-emission time). */
  hardInvalidityRules: readonly HardInvalidityRule[];
  /** The pack's seed-deterministic scenario generator (same seed ⇒ byte-identical record). */
  scenarioGenerator: ScenarioGenerator<TScenario, TConfig>;
  /** The pack's replay adapter (a replay re-presents recorded evidence). */
  replayAdapter: ReplayAdapter;
  /** The pack's fault profiles (the robustness/benchmark default OOD family reads these). */
  faultProfiles: readonly FaultProfile[];
}

// ---------------------------------------------------------------------------
// The profile itself
// ---------------------------------------------------------------------------

/**
 * The DomainSimulationProfile — how a domain runs inside the generic lab.
 * `profileId`/`version` version the wiring; `domainPackId` MUST match the
 * pack the profile is paired with (the generic runners refuse a mismatch
 * with a typed validation error — a basketball profile under a football
 * pack is a configuration bug, never a silent cross-domain run).
 */
export interface DomainSimulationProfile<
  TScenario extends ScenarioRecordBase = ScenarioRecordBase,
  TTick extends DomainRunnerTick = DomainRunnerTick,
> {
  readonly profileId: string;
  readonly version: string;
  /** Must equal the paired pack's `domainPackId` (checked by the generic runners). */
  readonly domainPackId: string;
  /** The deterministic §4 world-simulator factory for this domain. */
  createSimulator(options: {
    scenario: TScenario;
    faultSchedule?: FaultSchedule;
  }): DomainSimulator<TTick>;
  /** The persistent entity ids one tick's ground truth carries. */
  groundTruthEntityIds(tick: TTick): readonly string[];
  /** The domain's period/phase label (football 1|2 halves; basketball 1..4 quarters). */
  periodOf(tick: TTick): number;
  /**
   * The domain's default lab evaluator ("derived" — used when a caller
   * injects none). Accepts an injected reward engine so callers can keep
   * ONE engine instance across evaluator + direct scoring (the search does).
   */
  createLabEvaluator(options?: { rewardEngine?: RewardEngine }): LabEvaluator;
  /** The domain's default reward engine (versioned weight sets over the pack's dimensions). */
  createRewardEngine(): RewardEngine;
}

/**
 * Refuse a pack/profile mismatch with a typed validation error — never a
 * silent cross-domain run. (The football/basketball facades always pass
 * matching pairs; only direct generic-API callers can trip this.)
 */
export function assertProfileMatchesPack(
  profile: DomainSimulationProfile,
  pack: Pick<DomainPackLabView, "domainPackId"> | Pick<DomainPack, "domainPackId">,
): void {
  if (profile.domainPackId !== pack.domainPackId) {
    throw new LabValidationError(
      `simulation profile ${profile.profileId} (domain ${profile.domainPackId}) cannot run ` +
        `domain pack ${pack.domainPackId} — pack and profile must match`,
      [
        {
          profileId: profile.profileId,
          profileDomainPackId: profile.domainPackId,
          packDomainPackId: pack.domainPackId,
        },
      ],
    );
  }
}
