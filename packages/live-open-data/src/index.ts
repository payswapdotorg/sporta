/**
 * @sporta/live-open-data — THE OPEN-DATA REPLAY ADAPTERS (L007) + THE LIVE
 * PROVIDER TECHNOLOGYPROFILE REGISTRATIONS (L008).
 *
 * Legally permitted open tracking data replays through the EXACT live path —
 * `open-data adapter → LiveObservation → TemporalBufferEngine (L004) →
 * LiveSwmUpdater (L003) → WorldModelEngine` — with every provider-specific
 * field normalized at the adapter (nothing leaks into a product contract)
 * and every provider registered through the frozen TechnologyProfile
 * contract with the THREE-WAY license record (code / dataset / model —
 * ADR-011: permissive code never silently makes data usable).
 *
 * CONSTITUTION (pinned by tests):
 * - provider-field isolation: the emitted batches parse against the STRICT
 *   frozen LiveObservation contract (any leak refuses loudly) and no
 *   provider key survives anywhere in the output;
 * - sample data is NEVER committed: tests use format-fixtures — the recorded
 *   published schema with synthetic values (the schema of record lives in
 *   ./skillcorner/format, fetched from the provider repository 2026-09-21);
 * - license evidence is fetched-and-recorded, not assumed: SkillCorner
 *   opendata is MIT (the repository LICENSE); Metrica sample-data carries NO
 *   license grant and is registered as the EXPLICITLY BLOCKED candidate
 *   (`blockingLicenseIssues` non-empty — the R004 fail-closed rule);
 * - replay determinism: same JSONL → byte-identical batches (no clock, no
 *   RNG, no I/O beyond the injected text).
 */
// The recorded SkillCorner opendata schema + pure parsing
export {
  SKILLCORNER_DEFAULT_PITCH,
  SKILLCORNER_FRAME_INTERVAL_MS,
  SKILLCORNER_FRAME_RATE_HZ,
  SkillCornerFormatError,
  parseSkillCornerFrame,
  parseSkillCornerJsonl,
  parseSkillCornerTimestampMs,
} from "./skillcorner/format";
export type {
  SkillCornerBallData,
  SkillCornerImageCorners,
  SkillCornerPlayerData,
  SkillCornerPossession,
  SkillCornerTrackingFrame,
} from "./skillcorner/format";
// The L007 replay adapter
export {
  SKILLCORNER_ADAPTER_ID,
  SKILLCORNER_ADAPTER_VERSION,
  SKILLCORNER_CONFIDENCE_PRIORS,
  SKILLCORNER_DEFAULT_SOURCE_ID,
  SkillCornerOpenDataReplay,
  createSkillCornerOpenDataReplay,
} from "./skillcorner/adapter";
export type {
  SkillCornerOpenDataReplayConfig,
  SkillCornerReplayStats,
} from "./skillcorner/adapter";
// The L008 TechnologyProfile registrations (frozen contract shape)
export {
  LIVE_OPEN_DATA_REGISTRATION_EPOCH_MS,
  METRICA_SAMPLE_DATA_PROFILE,
  SKILLCORNER_OPENDATA_FAILURE_CLASSES,
  SKILLCORNER_OPENDATA_LICENSE,
  SKILLCORNER_OPENDATA_PROFILE,
  SKILLCORNER_PROFILE_TECHNOLOGY_ID,
  SKILLCORNER_PROFILE_VERSION,
  registeredLiveProviderProfiles,
} from "./profiles";
