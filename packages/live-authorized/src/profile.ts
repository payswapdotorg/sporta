/**
 * THE AUTHORIZED SKILLCORNER PROVIDER REGISTRATION (L009) — the frozen
 * live-reality contract §6 source-adapter record, registered through the
 * TechnologyProfile contract exactly like the L007/L008 candidates.
 *
 * THE RECORDED PROVENANCE (every fact below was FETCHED 2026-09-21 — this
 * sandbox has github.com, pypi.org and skillcorner.com reachability; the
 * api host itself needs credentials, which is the honest blocker):
 *
 * - The provider's own Python SDK (PyPI `skillcorner==3.2.0` wheel,
 *   `skillcorner/config/class_config.py`): `base_url: https://skillcorner.com`,
 *   BASIC auth from `SKILLCORNER_USERNAME` / `SKILLCORNER_PASSWORD`
 *   (fitrequest's username/password credentials) — the env names adopted
 *   verbatim by ./env.ts;
 * - The SDK's method config (`config/method_config_list.py`): the tracking
 *   endpoint `GET /api/match/{match_id}/tracking`
 *   (`base_name: match_tracking_data`, documented at
 *   `https://skillcorner.com/api/docs/#/match/match_tracking_list`);
 * - The SDK's `pagination.py`: DRF list envelope `{count, next, previous,
 *   results}` with `next`-link walking — the envelope ./response.ts pins;
 * - The provider's published tracking frame format (the opendata schema of
 *   record — `@sporta/live-open-data` `skillcorner/format`, recorded
 *   2026-09-21 from github.com/SkillCorner/opendata): the frame core this
 *   adapter validates strictly.
 *
 * THE BLOCKED POSTURE (the R004 fail-closed rule, A's Metrica precedent):
 * the DATASET component stays honestly UNRESOLVED — feeding the live
 * contract from the authorized API requires contractual feed access
 * (credentials + a data-use agreement with SkillCorner), and this
 * deployment holds neither. `blockingLicenseIssues` is therefore non-empty
 * and the candidate is BLOCKED beyond the shipped adapter shape until the
 * operator records the access. The adapter code, env gate, health check
 * and fixture batteries all EXIST (this package) — activation is a
 * binding + a live-schema verification, never a re-write.
 */
import type {
  FailureClassRecord,
  ResourceRequirements,
  TechnologyLicenseRecord,
  TechnologyProfile,
} from "@sporta/contracts";
import { SCHEMA_VERSION } from "@sporta/contracts";

/** The authorized adapter identity (mirrors ./skillcorner/authorized-feed). */
export const SKILLCORNER_AUTHORIZED_PROFILE_TECHNOLOGY_ID = "skillcorner-authorized-tracking";
export const SKILLCORNER_AUTHORIZED_PROFILE_VERSION = "api-v2026-09";

/** The three-way license record — the dataset component is the blocker. */
export const SKILLCORNER_AUTHORIZED_LICENSE: TechnologyLicenseRecord = {
  code: {
    status: "permissive",
    licenseId: "Sporta-repository",
    commercialUse: true,
    reviewRef:
      "the adapter code is Sporta's own (this repository, no third-party code); the provider " +
      "SDK consulted for the recorded facts is MIT (gitlab.com/public-corner/skillcorner, " +
      "fetched 2026-09-21) — facts only were recorded, no SDK code is vendored",
  },
  dataset: {
    status: "unresolved",
    reviewRef:
      "the authorized SkillCorner tracking feed is COMMERCIAL data under contract " +
      "(skillcorner.com); this deployment holds NO credentials and NO data-use agreement — " +
      "commercial use NOT affirmed, honestly unresolved (fetched 2026-09-21: the provider's " +
      "standard terms at skillcorner.com/legal/standard-terms-and-conditions govern feed use)",
  },
  // model: ABSENT — tracking data, no model checkpoint component.
};

/** The documented failure classes of the authorized adapter. */
export const SKILLCORNER_AUTHORIZED_FAILURE_CLASSES: readonly FailureClassRecord[] = [
  {
    failureClassId: "skillcorner-authorized.credentials-missing",
    description:
      "The env gate found incomplete bindings (SKILLCORNER_USERNAME / SKILLCORNER_PASSWORD / " +
      "SKILLCORNER_MATCH_ID). The feed is never constructed — the capability check answers " +
      "`blocked` with the exact missing binding names (never a guessed or default credential).",
    retryable: true,
  },
  {
    failureClassId: "skillcorner-authorized.auth-rejected",
    description:
      "The provider answered 401/403. Counted (authRejections) and returned typed — the " +
      "adapter never retries silently and never degrades to an unauthenticated call.",
    retryable: true,
  },
  {
    failureClassId: "skillcorner-authorized.page-schema-mismatch",
    description:
      "A page failed the recorded DRF envelope {count,next,previous,results}. The whole page " +
      "refuses loudly — never a partial page, never a guessed field.",
    retryable: false,
  },
  {
    failureClassId: "skillcorner-authorized.frame-schema-mismatch",
    description:
      "A frame's KNOWN-CONSUMED projection failed the recorded core (frame/timestamp/period/" +
      "ball_data/player_data). The frame is refused and counted (framesRefused) — never a " +
      "partially-kept frame.",
    retryable: false,
  },
  {
    failureClassId: "skillcorner-authorized.unknown-provider-fields",
    description:
      "The live feed carried fields beyond the recorded format. They are COUNTED BY NAME " +
      "(unknownFieldKinds) and dropped at the adapter — never forwarded, never guessed. The " +
      "activation-time verification hook: the first live pull surfaces the exact delta and " +
      "the recorded schema is then extended deliberately.",
    retryable: false,
  },
];

/** Resource requirements: HTTP + parsing, CPU-only. */
export const SKILLCORNER_AUTHORIZED_RESOURCES: ResourceRequirements = {
  gpuRequired: false,
  minRamGb: 1,
  minCpuCores: 1,
};

/**
 * THE BLOCKED-BY-ACCESS CANDIDATE (L009): the authorized SkillCorner live
 * tracking feed. The adapter shape, env gate, health check and fixture
 * batteries ship in `@sporta/live-authorized`; the candidate is BLOCKED
 * beyond that until the operator records contractual feed access (the
 * dataset license component resolves + the live frame schema is verified
 * on a real pull). Registered honestly rather than silently omitted.
 */
export const SKILLCORNER_AUTHORIZED_PROFILE: TechnologyProfile = {
  schemaVersion: SCHEMA_VERSION,
  technologyId: SKILLCORNER_AUTHORIZED_PROFILE_TECHNOLOGY_ID,
  technologyVersion: SKILLCORNER_AUTHORIZED_PROFILE_VERSION,
  adapterVersion: "0.1.0",
  task: "perception.player-tracking",
  displayName:
    "SkillCorner authorized live tracking feed (BLOCKED — no credentials/feed access in this deployment)",
  capabilities: {
    "authorized-live-source":
      "feeds the frozen LiveObservation contract from GET /api/match/{match_id}/tracking " +
      "(HTTP Basic; DRF pagination walked page-by-page) when the env bindings exist",
    "provider-field-isolation":
      "known-consumed fields validate strictly; recorded-but-unmapped fields are counted " +
      "(knownUnmappedFieldRows); unknown fields are counted BY NAME (unknownFieldKinds) — " +
      "nothing provider-specific ever reaches a product contract",
    "honest-blocked-gate":
      "incomplete bindings keep the feed unconstructed; the capability check reports `blocked` " +
      "with the exact missing binding names — never an invented credential or a smoothed unknown",
    "fixture-verified-shape":
      "the recorded envelope + frame core are pinned by format-fixtures (synthetic values — " +
      "sample data is NEVER committed); the live payload delta surfaces at first pull",
  },
  inputContract:
    "https://skillcorner.com GET /api/match/{match_id}/tracking — the recorded facts " +
    "(SDK class_config + method config + pagination.py, PyPI skillcorner==3.2.0, fetched " +
    "2026-09-21): HTTP Basic (SKILLCORNER_USERNAME/PASSWORD), DRF {count,next,previous," +
    "results} envelope; frames follow the provider's published tracking format (the opendata " +
    "schema of record)",
  outputContract:
    "@sporta/live-source LiveObservation (the frozen live-reality §1/§2 shapes) — the same " +
    "seam the L007 replay adapter feeds (L004 temporal buffer / L003 live SWM updater)",
  resourceRequirements: SKILLCORNER_AUTHORIZED_RESOURCES,
  executionRequirements: {
    runtime: "bun/node — injected fetch seam + injected clock; no I/O in the constructor",
    status: "blocked-pending-feed-access",
  },
  provenance: {
    maintainer: "Sporta (adapter); data: SkillCorner (skillcorner.com, contractual feed)",
    sourceUrl: "https://skillcorner.com/api/docs/#/match/match_tracking_list",
    versionTag:
      "SDK skillcorner==3.2.0 (PyPI wheel, fetched 2026-09-21) + the opendata schema of record",
  },
  license: SKILLCORNER_AUTHORIZED_LICENSE,
  benchmarkProfile: {
    fixtureSetVersion: "skillcorner-authorized@api-recorded-1",
    benchmarkRunIds: [],
  },
  failureClasses: [...SKILLCORNER_AUTHORIZED_FAILURE_CLASSES],
  status: "candidate",
  notes:
    "L009 authorized provider adapter — the honest BLOCKED registration: the adapter shape, " +
    "env gate (SKILLCORNER_USERNAME / SKILLCORNER_PASSWORD / SKILLCORNER_MATCH_ID — the " +
    "provider SDK's own env naming), health check and fixture batteries all ship; the " +
    "dataset component stays unresolved until the operator records contractual feed access. " +
    "Activation checklist: (1) set the bindings, (2) verify the live frame schema on the " +
    "first pull (unknownFieldKinds must be reviewed — extend the recorded core if the live " +
    "feed carries new fields), (3) record the data-use agreement in this profile's dataset " +
    "component, (4) wire the feed at the live transport seam. See " +
    "docs/status/l009-authorized-provider-adapter.md.",
};
