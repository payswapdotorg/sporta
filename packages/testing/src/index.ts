/**
 * @sporta/testing — deterministic test data for the Sporta platform (W003).
 *
 * The harness behind `docs/testing/HARNESS.md`: seeded PRNG, zod-valid
 * builders, and deterministic timelines for the test layers defined in
 * `docs/testing/testing-strategy.md` (the authority). No `Math.random`, no
 * `Date.now` — every random draw comes from a seed, every time is an explicit
 * millisecond constant.
 *
 * - `rng`: mulberry32 `createRng(seed)` + FNV-1a `seedFromString(s)`
 * - `builders`: `buildMediaSession`, `buildObservation`, `buildEventEnvelope`,
 *   `buildWorldSnapshot`, `buildAuthorizationPolicy`, `buildRenderRequest`,
 *   `buildStageMessage` — `(overrides?, seed?)` deep-merged onto valid
 *   defaults, validated against the `@sporta/contracts` zod schemas
 * - `sequences`: `observationTimeline({ count, fromMs, stepMs, ... })` and
 *   `eventSequence({ count, fromMs, stepMs, ... })` spread across the
 *   canonical media timeline
 */
export { DEFAULT_SEED, createRng, seedFromString } from "./rng";
export {
  TEST_EPOCH_ISO,
  TEST_EPOCH_MS,
  buildAuthorizationPolicy,
  buildEventEnvelope,
  buildMediaSession,
  buildObservation,
  buildRenderRequest,
  buildStageMessage,
  buildWorldSnapshot,
  deepMerge,
} from "./builders";
export type { DeepPartial } from "./builders";
export {
  DEFAULT_EVENT_TYPE_REFS,
  DEFAULT_MODALITIES,
  eventSequence,
  observationTimeline,
} from "./sequences";
export type { EventSequenceOptions, ObservationTimelineOptions } from "./sequences";
