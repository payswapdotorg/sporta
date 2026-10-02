/**
 * The Lab Run (REL-002): an IMMUTABLE run record + the deterministic
 * replay API — the FOOTBALL facade over the generic runner.
 *
 * THE DETERMINISM CONTRACT: the same (seed, configuration, organization
 * definition, fault schedule, evaluator) ⇒ deep-equal run record — with
 * wall-clock/duration fields stripped, because determinism is a property
 * of the RECORD, not of the machine. `runLab` twice on the same inputs and
 * `deterministicLabRun` both records ⇒ deep-equal (the test suite pins
 * this, byte-level, via JSON serialization). Every stochastic input flows
 * from the seed through `LabRng` forks; the ONLY wall-clock values in the
 * record live in `execution` (started/duration/invocation metadata), which
 * `deterministicLabRun` strips.
 *
 * THE PROVENANCE CONTRACT: the record's provenance is
 * `lab-simulation` — lab world state is NEVER production truth (ADR-013
 * §8). The organization's emitted domain records (claims) are derived from
 * ACTIONS; model/runtime bindings ride `execution.modelInvocations` as
 * execution metadata and can never appear inside a domain record.
 *
 * THE LOOP: receive tick observations (evidence set grows) → execute the
 * organization's nodes in the deterministic execution-order walk → each
 * body invocation goes through the provider-neutral Model Runtime seam →
 * outputs are schema-validated → actions are recorded and claims are
 * hard-gate-checked AT EMISSION TIME (a claim citing evidence the org has
 * not received yet is a fabrication, lookahead included) → budgets are
 * enforced per node → termination conditions stop the loop → the evaluator
 * scores the run and returns typed refusals for any hard-gate violation.
 *
 * REL-032 SEAM NOTE: since the seam generalization the runner logic lives
 * in ./domain-lab-run.ts (`runDomainLab`), flowing through
 * `DomainPack` + `DomainSimulationProfile` (./domain-profile.ts); THIS
 * module keeps the football-typed public surface (`runLab`,
 * `LabRunRecord`, …) and delegates with ./football-profile.ts — football
 * behavior is byte-identical (the 222-test suite plus the seam-neutrality
 * pins `runLab ≡ runDomainLab` guard this).
 */
import type { FootballDomainPack } from "../domain/football";
import { checkFootballClaims } from "../domain/football";
import type { FootballScenarioConfig, FootballScenarioRecord } from "../domain/scenario";
import type { FaultSchedule } from "../robustness/faults";
import type { LabEvaluator } from "../evaluation/evaluator";
import type { SimulatedTick } from "./world-simulator";
import type {
  DomainLabRunOptions,
  DomainLabRunRecord,
  OrganizationRuntimeBundle,
} from "./domain-lab-run";
import {
  assertDomainLabRunReproduces,
  deterministicDomainLabRun,
  replayDomainLabRun,
  runDomainLab,
} from "./domain-lab-run";
import { footballDomainSimulationProfile } from "./football-profile";

// The public football-typed surface (unchanged names, unchanged shapes) —
// all re-exported from the generic runner module at the bottom of this file.

/** The immutable football lab run record (REL-A2's reproduction unit). */
export type LabRunRecord = DomainLabRunRecord<FootballScenarioRecord, SimulatedTick>;

/** The record with wall-clock/duration execution metadata stripped. */
export type DeterministicLabRun = Omit<LabRunRecord, "execution">;

/**
 * Strip the execution section (wall-clock start, duration, invocation
 * metadata). Two runs' deterministic views are deep-equal iff the runs
 * reproduced — determinism is a property of the record.
 */
export function deterministicLabRun(record: LabRunRecord): DeterministicLabRun {
  return deterministicDomainLabRun(record);
}

// ---------------------------------------------------------------------------
// Options + the football facade
// ---------------------------------------------------------------------------

/** The football run options (the v0 public shape, unchanged). */
export interface LabRunOptions {
  domainPack: FootballDomainPack;
  organization: OrganizationRuntimeBundle;
  scenario: FootballScenarioRecord;
  faultSchedule?: FaultSchedule;
  evaluator?: LabEvaluator;
}

function domainOptions(
  options: LabRunOptions,
): DomainLabRunOptions<FootballScenarioConfig, FootballScenarioRecord, SimulatedTick> {
  return {
    domainPack: options.domainPack,
    simulationProfile: footballDomainSimulationProfile,
    organization: options.organization,
    scenario: options.scenario,
    faultSchedule: options.faultSchedule,
    evaluator: options.evaluator,
  };
}

/**
 * Run one football lab run: simulate the scenario, execute the organization
 * through the model-runtime seam, hard-gate every emitted claim, score the
 * run. Deterministic from (scenario seed, config, definition, schedule).
 * Delegates to `runDomainLab` with the football profile (REL-032 seam).
 */
export function runLab(options: LabRunOptions): LabRunRecord {
  return runDomainLab<FootballScenarioConfig, FootballScenarioRecord, SimulatedTick>(
    domainOptions(options),
  );
}

/**
 * Replay a lab run's observation stream through the domain pack's replay
 * adapter (REL-002's replay seam): a replay re-presents the RECORDED
 * evidence — it never re-simulates the world.
 */
export function replayLabRun(
  domainPack: FootballDomainPack,
  record: LabRunRecord | DeterministicLabRun,
) {
  return replayDomainLabRun<FootballScenarioConfig, FootballScenarioRecord, SimulatedTick>(
    domainPack,
    record,
  );
}

/**
 * Determinism self-check helper (used by tests and the ensemble): re-run
 * the same inputs and compare deterministic views for deep equality.
 */
export function assertLabRunReproduces(options: LabRunOptions): {
  reproduced: boolean;
  first: DeterministicLabRun;
  second: DeterministicLabRun;
} {
  return assertDomainLabRunReproduces<
    FootballScenarioConfig,
    FootballScenarioRecord,
    SimulatedTick
  >(domainOptions(options));
}

// Re-export the football claims checker for callers that want direct rule
// access over constructed claims (the hard-gate tests use it).
export { checkFootballClaims };

// Re-export the generic runner's public names — the football-typed surface
// (OrganizationRuntimeBundle, DegradationRecord, LabExecutionMetadata,
// LabRunMetrics, RecordedAction) and the REL-032 seam surface both live in
// ./domain-lab-run.ts.
export {
  assertDomainLabRunReproduces,
  deterministicDomainLabRun,
  replayDomainLabRun,
  runDomainLab,
} from "./domain-lab-run";
export type {
  DegradationRecord,
  DeterministicDomainLabRun,
  DomainLabRunOptions,
  DomainLabRunRecord,
  LabExecutionMetadata,
  LabRunMetrics,
  OrganizationRuntimeBundle,
  RecordedAction,
} from "./domain-lab-run";
