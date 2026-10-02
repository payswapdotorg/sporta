/**
 * The football DomainSimulationProfile (REL-032) — the football wiring of the
 * generic seam (./domain-profile.ts): the football world simulator (§4), the
 * football identity ground truth, the two-period label, and the football
 * default evaluator + reward engine ("derived" defaults). The football
 * facades (./lab-run.ts `runLab`, ../robustness/ensemble.ts `runEnsemble`,
 * ../orgsearch/search.ts `runOrganizationSearch`,
 * ../calibration/calibration.ts `runCalibration`) delegate through THIS
 * profile so their behavior stays byte-identical with the pre-seam v0 code.
 */
import type { FaultSchedule } from "../robustness/faults";
import type { FootballScenarioRecord } from "../domain/scenario";
import { FOOTBALL_DOMAIN_PACK_ID } from "../domain/football-ids";
import { createFootballWorldSimulator, type SimulatedTick } from "./world-simulator";
import { createFootballLabEvaluator } from "../evaluation/evaluator";
import type { LabEvaluator } from "../evaluation/evaluator";
import { createFootballRewardEngine } from "../reward/engine";
import type { RewardEngine } from "../reward/engine";
import type { DomainSimulationProfile } from "./domain-profile";

/** The football implementation of the DomainSimulationProfile seam. */
export const footballDomainSimulationProfile: DomainSimulationProfile<
  FootballScenarioRecord,
  SimulatedTick
> = {
  profileId: "football-simulation-profile",
  version: "0.1.0",
  domainPackId: FOOTBALL_DOMAIN_PACK_ID,
  createSimulator(options: { scenario: FootballScenarioRecord; faultSchedule?: FaultSchedule }) {
    return createFootballWorldSimulator(options);
  },
  groundTruthEntityIds(tick: SimulatedTick): readonly string[] {
    return [...tick.groundTruth.players.map((player) => player.playerId), "ball"];
  },
  periodOf(tick: SimulatedTick): number {
    return tick.period;
  },
  createLabEvaluator(options: { rewardEngine?: RewardEngine } = {}): LabEvaluator {
    return createFootballLabEvaluator(options);
  },
  createRewardEngine(): RewardEngine {
    return createFootballRewardEngine();
  },
};
