/**
 * Basketball pack identity constants (REL-032) — extracted into a
 * dependency-free module so `./basketball` (pack instance + scenario
 * generator) and `../simulation/basketball-simulator` (the simulator and
 * the pack's DomainSimulationProfile) can share them without an import
 * cycle, mirroring `./football-ids`.
 */
export const BASKETBALL_DOMAIN_PACK_ID = "basketball";
export const BASKETBALL_DOMAIN_PACK_VERSION = "0.1.0";
export const BASKETBALL_LAB_EVALUATOR_ID = "basketball-lab-evaluator";
/**
 * v0.1.0 (REL-032): the basketball evaluator is born on the generic
 * `createLabEvaluator` factory (the extracted, behavior-identical form of
 * the football v0.2 evaluator logic) — no per-domain evaluator upgrade
 * history applies, so it starts at its own 0.1.0.
 */
export const BASKETBALL_LAB_EVALUATOR_VERSION = "0.1.0";
