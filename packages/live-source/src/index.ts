/**
 * @sporta/live-source — THE DETERMINISTIC/REPLAY LIVE SOURCE (L002).
 *
 * A synthetic TRACKING live source that emits player/ball entity
 * observations incrementally at a configurable rate through the FROZEN
 * `docs/contracts/live-reality.md` LiveObservation semantics, with six
 * CONFIGURABLE, deterministically-replayable delivery scenarios:
 * normal, jitter, delay, drop, out-of-order and reconnect.
 *
 * The port seam ({@link LiveSourcePort}) is what Worker A's L003 incremental
 * updater consumes (integration lands in wave 2 — this wave keeps the seam
 * contract-clean: pull-based, no transport, no SWM writes, observations
 * only). The wave-2 W915 SSE lane bridges this source to the browser.
 *
 * CONSTITUTION (pinned by test/boundary.test.ts):
 * - NO wall clock in the core (the ingest schedule is delivery-plan DATA:
 *   `ingestTimeMs = eventTimeMs + planned offset`);
 * - NO environment reads (composition-root rule);
 * - NO unseeded randomness (splitmix32 streams, stable sub-stream seeds);
 * - same (seed, scenario, tickCount, rateMs, roster) → BYTE-IDENTICAL
 *   observation sequence (pinned per scenario by test/determinism.test.ts);
 * - dropped updates are VISIBLE sequence gaps, counted in stats — never
 *   smoothed over; reconnects resume with explicit gap accounting;
 * - quality/confidence are honest (a degraded window emits degraded
 *   quality and lowered confidence; undetected entities carry low
 *   confidence and no velocity — never fabricated certainty);
 * - pitch coordinates are Sporta-canonical meters (105 x 68, corner
 *   origin, x = touchline).
 *
 * `packages/contracts` is FROZEN: the LiveObservation/EntityObservation
 * shapes live here additively (the Wave 0 mapping decision), re-using the
 * frozen primitives (`EntityId`, `Watermark`, `ProvenanceKind`). The one
 * deliberate addition beyond the frozen field list is the OPTIONAL
 * `recovery` member (explicit reconnect gap accounting) — recorded as an
 * additive live-layer extension in the L002 delivery report.
 */
// The frozen-shaped live observation contracts (additive live layer)
export {
  LIVE_ENTITY_KINDS,
  LIVE_OBSERVATION_QUALITIES,
  LIVE_SOURCE_TYPES,
  LiveEntityObservation,
  LiveObservation,
  LiveObservationValidationError,
  LiveRecoveryAccounting,
  PitchPosition,
  PitchVelocity,
  parseLiveObservation,
} from "./observation";
export type { LiveEntityKind, LiveObservationQuality, LiveSourceType } from "./observation";
// The seeded PRNG (deterministic by construction)
export { createSeededRandom, substreamSeed } from "./prng";
export type { SeededRandom } from "./prng";
// The scenario vocabulary + delivery plans (DATA)
export {
  LIVE_SCENARIO_DEFAULTS,
  LIVE_SCENARIO_KINDS,
  LiveScenarioValidationError,
  buildDeliveryPlan,
  validateScenario,
} from "./scenarios";
export type {
  DeliveryPlan,
  LiveScenarioConfig,
  LiveScenarioKind,
  PlannedEmission,
  TickDisposition,
} from "./scenarios";
// The deterministic match script (the observed synthetic match model)
export { batchConfidenceOf, buildScriptedRoster, observeRosterAtTick } from "./match-script";
export type { MatchScriptConfig, ScriptedEntity } from "./match-script";
// The source (the L002/L003 port seam)
export {
  LIVE_SOURCE_ADAPTER_ID,
  LIVE_SOURCE_ADAPTER_VERSION,
  DeterministicLiveSource,
  LiveSourceValidationError,
  createDeterministicLiveSource,
  drainSource,
} from "./source";
export type {
  DeterministicLiveSourceConfig,
  LiveSourceMetadata,
  LiveSourcePort,
  LiveSourceStats,
} from "./source";
