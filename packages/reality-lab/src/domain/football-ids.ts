/**
 * Football pack identity constants (REL-001) — extracted into a
 * dependency-free module so `./football` (pack instance) and `./scenario`
 * (generator) can share them without an import cycle.
 */
export const FOOTBALL_DOMAIN_PACK_ID = "football";
export const FOOTBALL_DOMAIN_PACK_VERSION = "0.1.0";
export const FOOTBALL_LAB_EVALUATOR_ID = "football-lab-evaluator";
/**
 * 0.2.0 (REL-007): the evaluator hook now delegates its aggregation to the
 * full reward engine and attaches the per-run `RewardRecord` to its result
 * (additive output; `overall` stays the plain mean of measured dimensions).
 */
export const FOOTBALL_LAB_EVALUATOR_VERSION = "0.2.0";
