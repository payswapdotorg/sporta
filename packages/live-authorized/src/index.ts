/**
 * @sporta/live-authorized — THE AUTHORIZED LIVE PROVIDER ADAPTER (L009).
 *
 * One real authorized provider (SkillCorner's contractual tracking feed)
 * CAN feed the frozen live contract when credentials + feed access exist;
 * otherwise the item stays honestly BLOCKED with the exact external
 * dependency recorded, while L001-L007 remain testable without it (the
 * acceptance's own wording — this package is that shape).
 *
 * THE DELIVERABLE (blocked-state complete):
 * - the ENV-DRIVEN gate (./env.ts): the provider SDK's own binding names
 *   (SKILLCORNER_USERNAME / SKILLCORNER_PASSWORD / SKILLCORNER_MATCH_ID);
 *   incomplete bindings → the honest `blocked` with the exact missing
 *   names — never an invented credential, never a smoothed unknown;
 * - the ADAPTER (./skillcorner/authorized-feed.ts): the pull-based,
 *   buffered observation source over the RECORDED endpoint
 *   (GET /api/match/{match_id}/tracking, HTTP Basic, DRF pagination) with
 *   injected fetch + clock (no I/O in the constructor, no hidden globals);
 * - the RECORDED RESPONSE SCHEMA (./skillcorner/response.ts): the DRF
 *   envelope + the provider's published frame core, strict on what is
 *   consumed, COUNTING what is not (unmapped rows; unknown fields BY NAME
 *   — the activation-time verification hook);
 * - the §6 REGISTRATION (./profile.ts): the TechnologyProfile with the
 *   three-way license record — the dataset component honestly unresolved
 *   (no feed access), `blockingLicenseIssues` non-empty (R004 fail-closed);
 * - the HEALTH/CAPABILITY SURFACE (./health.ts): the operator panel row.
 *
 * CONSTITUTION (pinned by tests):
 * - sample data is NEVER committed — fixtures are format-fixtures over the
 *   recorded schema with synthetic values;
 * - provider-field isolation: every emitted batch parses against the
 *   STRICT frozen LiveObservation contract; possession/image-corner
 *   projections never reach a product contract;
 * - the recorded facts carry their fetch provenance (2026-09-21; the
 *   sources are named in ./profile.ts) — nothing about the live payload
 *   is claimed beyond the record.
 */
export {
  SKILLCORNER_USERNAME_ENV,
  SKILLCORNER_PASSWORD_ENV,
  SKILLCORNER_MATCH_ID_ENV,
  SKILLCORNER_API_BASE_ENV,
  SKILLCORNER_DEFAULT_API_BASE,
  authorizedSkillCornerConfig,
  authorizedFeedCapability,
} from "./env";
export type {
  AuthorizedEnvLike,
  SkillCornerAuthorizedConfig,
  AuthorizedFeedCapability,
} from "./env";

export {
  SKILLCORNER_AUTHORIZED_PROFILE_TECHNOLOGY_ID,
  SKILLCORNER_AUTHORIZED_PROFILE_VERSION,
  SKILLCORNER_AUTHORIZED_PROFILE,
  SKILLCORNER_AUTHORIZED_LICENSE,
  SKILLCORNER_AUTHORIZED_FAILURE_CLASSES,
} from "./profile";

export { authorizedLiveProviderHealth } from "./health";
export type { AuthorizedLiveProviderHealth, AuthorizedLiveProviderHealthPanel } from "./health";

export {
  SKILLCORNER_AUTHORIZED_ADAPTER_ID,
  SKILLCORNER_AUTHORIZED_ADAPTER_VERSION,
  SKILLCORNER_AUTHORIZED_DEFAULT_SOURCE_ID,
  SKILLCORNER_AUTHORIZED_CONFIDENCE_PRIORS,
  SkillCornerAuthorizedFeed,
  skillCornerTrackingUrl,
  skillCornerBasicAuthHeader,
} from "./skillcorner/authorized-feed";
export type {
  AuthorizedFetchLike,
  SkillCornerAuthorizedFeedConfig,
  SkillCornerAuthorizedFeedStats,
  SkillCornerPagePull,
} from "./skillcorner/authorized-feed";

export {
  SKILLCORNER_AUTHORIZED_FRAME_RATE_HZ,
  SKILLCORNER_AUTHORIZED_FRAME_INTERVAL_MS,
  SKILLCORNER_AUTHORIZED_DEFAULT_PITCH,
  SKILLCORNER_AUTHORIZED_CONSUMED_FIELDS,
  SKILLCORNER_AUTHORIZED_UNMAPPED_FIELDS,
  SkillCornerAuthorizedFormatError,
  parseSkillCornerAuthorizedFrame,
  parseSkillCornerAuthorizedPage,
  parseSkillCornerAuthorizedTimestampMs,
} from "./skillcorner/response";
export type {
  SkillCornerAuthorizedBallData,
  SkillCornerAuthorizedPlayerData,
  SkillCornerAuthorizedFrameCore,
  SkillCornerAuthorizedPage,
  FrameFieldAccounting,
} from "./skillcorner/response";
