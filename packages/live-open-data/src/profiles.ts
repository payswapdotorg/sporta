/**
 * THE L008 LIVE-PROVIDER TECHNOLOGYPROFILE REGISTRATIONS — the open-data
 * replay providers, each registered through the frozen `TechnologyProfile`
 * contract with the §6 source-adapter surface (capabilities, data format,
 * rate, provenance, license/data-use state, failure classes) and the
 * THREE-WAY license record (code / dataset — no model component exists for
 * pre-computed tracking data; recorded separately per ADR-011 and the
 * technology-plane license policy).
 *
 * LICENSE EVIDENCE (fetched and recorded 2026-09-21):
 *
 * - SkillCorner/opendata: the repository root carries an MIT LICENSE
 *   (`Copyright (c) 2020 SkillCorner`), which covers the repository contents
 *   including the tracking data; the README additionally requests source
 *   credit ("If you use the data, we kindly ask that you credit SkillCorner")
 *   — honored in the profile notes. Both components resolve permissive with
 *   commercial use affirmed by the license text (MIT), so
 *   `blockingLicenseIssues` is EMPTY — the real registered candidate.
 * - Metrica sample-data: the repository carries NO license file; the README
 *   "Legal stuff" section only requests acknowledgment. Sporta review cannot
 *   affirm commercial use from an attribution request — both components stay
 *   honestly UNRESOLVED, `blockingLicenseIssues` is non-empty, and the
 *   candidate is EXPLICITLY BLOCKED beyond format research until an explicit
 *   license grant is recorded (the R004 fail-closed rule, made concrete).
 */
import type {
  FailureClassRecord,
  ResourceRequirements,
  TechnologyLicenseRecord,
  TechnologyProfile,
} from "@sporta/contracts";
import { SCHEMA_VERSION } from "@sporta/contracts";

/** The fixed registration epoch for the L008 records. */
export const LIVE_OPEN_DATA_REGISTRATION_EPOCH_MS = 1_771_430_400_000;

/** The SkillCorner adapter identity (mirrors ./adapter). */
export const SKILLCORNER_PROFILE_TECHNOLOGY_ID = "skillcorner-opendata-broadcast-tracking";
export const SKILLCORNER_PROFILE_VERSION = "2024-2025-au-aleague-sample";

/** The three-way license record for the SkillCorner opendata provider. */
export const SKILLCORNER_OPENDATA_LICENSE: TechnologyLicenseRecord = {
  code: {
    status: "permissive",
    licenseId: "MIT",
    commercialUse: true,
    reviewRef:
      "https://github.com/SkillCorner/opendata/LICENSE — MIT, Copyright (c) 2020 SkillCorner " +
      "(fetched 2026-09-21)",
  },
  dataset: {
    status: "permissive",
    licenseId: "MIT",
    commercialUse: true,
    reviewRef:
      "https://github.com/SkillCorner/opendata — the tracking data rides the MIT-licensed " +
      "repository (10 matches, AUS A-League 2024/2025, broadcast tracking + derived events); " +
      "the README additionally requests source credit — honored (recorded in the profile notes)",
  },
  // model: ABSENT — pre-computed tracking data; no checkpoint component exists.
};

/** Documented failure classes of the SkillCorner replay adapter. */
export const SKILLCORNER_OPENDATA_FAILURE_CLASSES: readonly FailureClassRecord[] = [
  {
    failureClassId: "skillcorner-replay.frame-schema-mismatch",
    description:
      "A JSONL line failed the recorded published schema (strict parse). The adapter refuses " +
      "fail-loud with the line number — never a partial frame.",
    retryable: false,
  },
  {
    failureClassId: "skillcorner-replay.empty-frame-skipped",
    description:
      "The all-null pre-match frames carry no entity rows; they yield no LiveObservation " +
      "batch and are counted (emptyFramesSkipped) — never a fabricated empty observation.",
    retryable: false,
  },
  {
    failureClassId: "skillcorner-replay.confidence-prior",
    description:
      "The published format carries no confidence values; the adapter supplies the " +
      "documented detectedness prior (0.85 detected / 0.25 extrapolated carry) — a prior, " +
      "never a measured confidence.",
    retryable: false,
  },
];

/** Resource requirements: pure parsing, CPU-only. */
export const SKILLCORNER_OPENDATA_RESOURCES: ResourceRequirements = {
  gpuRequired: false,
  minRamGb: 1,
  minCpuCores: 1,
};

/**
 * THE REAL REGISTERED CANDIDATE (L008): the SkillCorner opendata
 * broadcast-tracking replay source — the L007 adapter's registration record.
 * Status `candidate`: replay-registered with full provenance and license
 * evidence; production promotion requires benchmark + review evidence (the
 * technology-plane lifecycle — never self-promoted).
 */
export const SKILLCORNER_OPENDATA_PROFILE: TechnologyProfile = {
  schemaVersion: SCHEMA_VERSION,
  technologyId: SKILLCORNER_PROFILE_TECHNOLOGY_ID,
  technologyVersion: SKILLCORNER_PROFILE_VERSION,
  adapterVersion: "0.1.0",
  task: "perception.player-tracking",
  displayName: "SkillCorner Open Data broadcast-tracking replay source (L007/L008)",
  capabilities: {
    "replay-source":
      "replays the published 10 fps broadcast-tracking JSONL as frozen LiveObservation batches",
    "player-tracking":
      "22-player broadcast tracking, meters, center-origin pitch frame normalized to the Sporta canonical frame",
    "ball-tracking": "ball xyz tracking with the is_detected extrapolation-carry honesty flag",
    "provider-field-isolation":
      "every provider field normalizes at the adapter; the provider possession hypothesis and image-corner projection never reach a product contract",
    "license-clean-mit":
      "code + dataset MIT (the repository LICENSE, fetched 2026-09-21); README source-credit request honored",
  },
  inputContract:
    "github.com/SkillCorner/opendata data/matches/{id}/{id}_tracking_extrapolated.jsonl — " +
    "the recorded published schema (README + sampled frames, 2026-09-21; see @sporta/live-open-data skillcorner/format)",
  outputContract:
    "@sporta/live-source LiveObservation (the frozen live-reality §1/§2 shapes) — consumed " +
    "by @sporta/live-temporal (L004) and @sporta/live-swm (L003)",
  resourceRequirements: SKILLCORNER_OPENDATA_RESOURCES,
  executionRequirements: {
    runtime: "bun/node — pure JSONL parsing, no native dependencies, no network at replay time",
  },
  provenance: {
    maintainer: "Sporta (adapter); data: SkillCorner (github.com/SkillCorner/opendata)",
    sourceUrl: "https://github.com/SkillCorner/opendata",
    versionTag: "master@2026-09-21 — 10 matches, Australian A-League 2024/2025 sample",
  },
  license: SKILLCORNER_OPENDATA_LICENSE,
  benchmarkProfile: {
    fixtureSetVersion: "skillcorner-opendata@2024-2025:format-fixtures-1",
    benchmarkRunIds: [],
  },
  failureClasses: [...SKILLCORNER_OPENDATA_FAILURE_CLASSES],
  status: "candidate",
  notes:
    "L007 replay adapter registration. Data credit: SkillCorner (skillcorner.com) via the " +
    "MIT-licensed opendata repository, in partnership with PySport. The dataset is broadcast " +
    "tracking (CV/ML over broadcast video) — the provenance kind is DERIVED on every batch. " +
    "Sample data is NEVER committed to the Sporta repository; tests use format-fixtures " +
    "(the recorded schema with synthetic values).",
};

/**
 * THE EXPLICITLY BLOCKED CANDIDATE (L008): Metrica Sports sample-data — the
 * repository carries NO license file (README "Legal stuff" requests
 * acknowledgment only, fetched 2026-09-21), so neither the code nor the
 * dataset component can resolve; `blockingLicenseIssues` is non-empty and
 * the candidate is blocked beyond FORMAT RESEARCH until an explicit license
 * grant is recorded. Registered honestly rather than silently omitted (the
 * L008 acceptance: "at least one real OR explicitly blocked provider
 * candidate").
 */
export const METRICA_SAMPLE_DATA_PROFILE: TechnologyProfile = {
  schemaVersion: SCHEMA_VERSION,
  technologyId: "metrica-sample-data-tracking",
  technologyVersion: "sample-games-1-3",
  adapterVersion: "not-implemented",
  task: "perception.player-tracking",
  displayName: "Metrica Sports sample data (EXPLICITLY BLOCKED — license unresolved)",
  capabilities: {
    "format-research":
      "the published CSV (games 1-2) and EPTS FIFA (game 3) tracking formats are recorded for research; 0-1 normalized coordinates, 105x68 meters",
    blocked:
      "no adapter ships this wave: the repository carries no license grant — replay beyond format research is blocked",
  },
  inputContract:
    "github.com/metrica-sports/sample-data (README + data layout, fetched 2026-09-21) — research-recorded only",
  outputContract: "none (blocked — no adapter)",
  resourceRequirements: { gpuRequired: false },
  executionRequirements: { status: "blocked-pending-license" },
  provenance: {
    maintainer: "Metrica Sports (github.com/metrica-sports/sample-data)",
    sourceUrl: "https://github.com/metrica-sports/sample-data",
    versionTag: "master@2026-09-21 — Sample Games 1-3 (anonymized)",
  },
  license: {
    code: {
      status: "unresolved",
      reviewRef:
        "https://github.com/metrica-sports/sample-data — NO LICENSE file in the repository " +
        "(fetched 2026-09-21); the README 'Legal stuff' section requests acknowledgment only, " +
        "which is not a license grant",
    },
    dataset: {
      status: "unresolved",
      reviewRef:
        "same repository — the sample tracking/event data (anonymized) carries no explicit " +
        "license; commercial use NOT affirmed by Sporta review — honestly unresolved, never fabricated",
    },
  },
  benchmarkProfile: {
    fixtureSetVersion: "metrica-sample-data@format-research-1",
    benchmarkRunIds: [],
  },
  failureClasses: [
    {
      failureClassId: "metrica-sample.license-unresolved",
      description:
        "The repository carries no license file; the README requests acknowledgment only. " +
        "Blocked beyond format research until an explicit license grant is recorded " +
        "(the R004 fail-closed rule).",
      retryable: false,
    },
  ],
  status: "candidate",
  notes:
    "EXPLICITLY BLOCKED (L008): the honest registration of a provider whose data-use state " +
    "cannot be affirmed. If Metrica (or the operator) records an explicit grant, the profile " +
    "re-registers with resolved components and the adapter work proceeds (Wave 2+).",
};

/** All L008 live-provider registrations (identity order, deterministic). */
export function registeredLiveProviderProfiles(): readonly TechnologyProfile[] {
  return [SKILLCORNER_OPENDATA_PROFILE, METRICA_SAMPLE_DATA_PROFILE];
}
