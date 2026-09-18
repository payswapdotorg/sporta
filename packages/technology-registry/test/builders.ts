/**
 * Deterministic builders for `@sporta/technology-registry` test data.
 *
 * Follows the `@sporta/testing` builder contract (W003): every builder
 * returns a FULLY VALID document for its frozen zod schema — the output is
 * `schema.parse`d on build — with `(overrides?, seed?)` deep-merge
 * semantics. No `Math.random`, no `Date.now`: every time is an explicit
 * millisecond constant, every id is derived from the seed.
 */
import {
  BenchmarkRun,
  EvaluationReport,
  PromotionRecord,
  TechnologyCandidate,
  TechnologyProfile,
} from "@sporta/contracts";
import type {
  AdapterTaskKind,
  BenchmarkRun as BenchmarkRunDoc,
  EvaluationReport as EvaluationReportDoc,
  PromotionRecord as PromotionRecordDoc,
  TechnologyCandidate as TechnologyCandidateDoc,
  TechnologyProfile as TechnologyProfileDoc,
} from "@sporta/contracts";
import { createRng, deepMerge, TEST_EPOCH_MS } from "@sporta/testing";
import type { DeepPartial } from "@sporta/testing";
import { FixtureSet, parseFixtureSet, parseLicenseReviewDocument } from "../src/index";
import type { FixtureSet as FixtureSetDoc, LicenseReviewRecord } from "../src/index";

/** The canonical harness epoch (2025-01-06T12:00:00.000Z), re-exported. */
export { TEST_EPOCH_MS };

export const DEFAULT_TASK: AdapterTaskKind = "perception.player-detection";

/** A permissive, commercially-affirmed license record. */
export const PERMISSIVE_LICENSE = {
  code: {
    status: "permissive",
    licenseId: "Apache-2.0",
    commercialUse: true,
    reviewRef: "https://example.test/reviews/code",
  },
  model: {
    status: "permissive",
    licenseId: "AGPL-3.0-with-exception",
    commercialUse: true,
    reviewRef: "https://example.test/reviews/model",
  },
} as const;

/** A license record with an unresolved component (R004 blocker). */
export const UNRESOLVED_LICENSE = {
  code: {
    status: "permissive",
    licenseId: "Apache-2.0",
    commercialUse: true,
    reviewRef: "https://example.test/reviews/code",
  },
  model: { status: "unresolved" },
} as const;

/** A resolved-but-research-only model component (R004 blocker). */
export const RESEARCH_ONLY_LICENSE = {
  code: {
    status: "permissive",
    licenseId: "Apache-2.0",
    commercialUse: true,
    reviewRef: "https://example.test/reviews/code",
  },
  model: {
    status: "research-only",
    licenseId: "CC-BY-NC-4.0",
    commercialUse: false,
    reviewRef: "https://example.test/reviews/model",
  },
} as const;

export function buildTechnologyCandidate(
  overrides?: DeepPartial<TechnologyCandidateDoc>,
  seed?: number,
): TechnologyCandidateDoc {
  const rng = createRng(seed ?? 42);
  const pick = rng() * 1_000_000;
  const defaults: TechnologyCandidateDoc = {
    schemaVersion: "1.1",
    candidateId: `cand-${Math.floor(pick)}`,
    technologyId: `tech-${Math.floor(pick)}`,
    technologyVersion: "1.0.0",
    adapterVersion: "1.0.0",
    task: DEFAULT_TASK,
    displayName: "Test Candidate Detector",
    registeredAtMs: TEST_EPOCH_MS,
  };
  const merged = deepMerge(defaults, overrides ?? {});
  return TechnologyCandidate.parse(merged);
}

export function buildTechnologyProfile(
  overrides?: DeepPartial<TechnologyProfileDoc>,
  seed?: number,
): TechnologyProfileDoc {
  const rng = createRng(seed ?? 42);
  const pick = Math.floor(rng() * 1_000_000);
  const defaults: TechnologyProfileDoc = {
    schemaVersion: "1.1",
    technologyId: `tech-${pick}`,
    technologyVersion: "1.0.0",
    adapterVersion: "1.0.0",
    task: DEFAULT_TASK,
    displayName: "Test Detector",
    capabilities: { "detects-players": "detects player bounding boxes" },
    inputContract: "contracts/normalized-video-frame@1",
    outputContract: "contracts/observation.detection@1",
    resourceRequirements: { gpuRequired: false, minRamGb: 4 },
    executionRequirements: { runtime: "bun" },
    provenance: { maintainer: "sporta-test", sourceUrl: "https://example.test/source" },
    license: structuredClone(PERMISSIVE_LICENSE),
    benchmarkProfile: { fixtureSetVersion: "fixtures-football-v1", benchmarkRunIds: [] },
    failureClasses: [
      {
        failureClassId: "decode-error",
        description: "frame could not be decoded",
        retryable: true,
      },
    ],
    status: "candidate",
    notes: "builder default profile",
  };
  const merged = deepMerge(defaults, overrides ?? {});
  return TechnologyProfile.parse(merged);
}

export function buildBenchmarkRun(
  overrides?: DeepPartial<BenchmarkRunDoc>,
  seed?: number,
): BenchmarkRunDoc {
  const rng = createRng(seed ?? 42);
  const pick = Math.floor(rng() * 1_000_000);
  const defaults: BenchmarkRunDoc = {
    schemaVersion: "1.1",
    runId: `run-${pick}`,
    technologyId: `tech-${pick}`,
    technologyVersion: "1.0.0",
    adapterVersion: "1.0.0",
    task: DEFAULT_TASK,
    fixtureSetVersion: "fixtures-football-v1",
    startedAtMs: TEST_EPOCH_MS,
    completedAtMs: TEST_EPOCH_MS + 60_000,
    metrics: { precision: 0.91, recall: 0.88 },
    resourceUsage: { cpuMs: 1200 },
    runtimeSeconds: 42.5,
    costEstimateUsd: 0.25,
    failureSummary: { failures: 0, failureExamples: [] },
    reproducibility: { deterministic: true, rerunDeltaPct: 0, seed: "seed-1" },
    licenseCheck: "pass",
    artifactRefs: ["artifact://run/1"],
  };
  const merged = deepMerge(defaults, overrides ?? {});
  return BenchmarkRun.parse(merged);
}

export function buildEvaluationReport(
  overrides?: DeepPartial<EvaluationReportDoc>,
  seed?: number,
): EvaluationReportDoc {
  const rng = createRng(seed ?? 42);
  const pick = Math.floor(rng() * 1_000_000);
  const defaults: EvaluationReportDoc = {
    schemaVersion: "1.1",
    reportId: `report-${pick}`,
    fixtureSetVersion: "fixtures-football-v1",
    benchmarkRunIds: ["run-1"],
    comparison: {
      "tech-a@1.0.0+1.0.0": { precision: 0.91, "benchmark.failures": 0 },
    },
    recommendation: "hold",
    rationale: "builder default report",
    decidedAtMs: TEST_EPOCH_MS + 3_600_000,
  };
  const merged = deepMerge(defaults, overrides ?? {});
  return EvaluationReport.parse(merged);
}

export function buildPromotionRecord(
  overrides?: DeepPartial<PromotionRecordDoc>,
  seed?: number,
): PromotionRecordDoc {
  const rng = createRng(seed ?? 42);
  const pick = Math.floor(rng() * 1_000_000);
  const defaults: PromotionRecordDoc = {
    schemaVersion: "1.1",
    promotionId: `promo-${pick}`,
    technologyId: `tech-${pick}`,
    technologyVersion: "1.0.0",
    adapterVersion: "1.0.0",
    task: DEFAULT_TASK,
    fromStatus: "candidate",
    toStatus: "benchmarked",
    decidedAtMs: TEST_EPOCH_MS + 7_200_000,
    decidedBy: "tech-lead@example.test",
    evidence: {
      evaluationReportId: "report-1",
      benchmarkRunIds: ["run-1"],
    },
    rationale: "builder default promotion",
  };
  const merged = deepMerge(defaults, overrides ?? {});
  return PromotionRecord.parse(merged);
}

export function buildLicenseReview(
  overrides?: DeepPartial<LicenseReviewRecord>,
  seed?: number,
): LicenseReviewRecord {
  const rng = createRng(seed ?? 42);
  const pick = Math.floor(rng() * 1_000_000);
  const defaults: LicenseReviewRecord = {
    schemaVersion: "1.1",
    reviewId: `review-${pick}`,
    technologyId: `tech-${pick}`,
    technologyVersion: "1.0.0",
    component: "code",
    status: "permissive",
    licenseId: "Apache-2.0",
    commercialUse: true,
    reviewer: "legal@example.test",
    reviewRef: "https://example.test/reviews/code",
    reviewedAtMs: TEST_EPOCH_MS + 1_800_000,
  };
  const merged = deepMerge(defaults, overrides ?? {});
  return parseLicenseReviewDocument(merged);
}

export function buildFixtureEntry(
  overrides?: DeepPartial<FixtureSetDoc["entries"][number]>,
): FixtureSetDoc["entries"][number] {
  const defaults: FixtureSetDoc["entries"][number] = {
    schemaVersion: "1.1",
    fixtureId: "fixture-1",
    mediaKind: "real-footage",
    mediaRef: "football-clip-01.mp4",
    media: {
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Example",
      durationSeconds: 12,
    },
    license: {
      code: {
        status: "permissive",
        licenseId: "CC0-1.0",
        commercialUse: true,
        reviewRef: "https://example.test/fixture-license",
      },
    },
    expectedAnnotationRefs: ["annotations/fixture-1.json"],
    scenarioTags: ["open-play"],
  };
  const merged = deepMerge(defaults, overrides ?? {});
  return FixtureSet.shape.entries.element.parse(merged);
}

export function buildFixtureSet(
  overrides?: DeepPartial<FixtureSetDoc>,
  seed?: number,
): FixtureSetDoc {
  const rng = createRng(seed ?? 42);
  const pick = Math.floor(rng() * 1_000_000);
  const defaults: FixtureSetDoc = {
    schemaVersion: "1.1",
    fixtureSetVersion: `fixtures-test-${pick}`,
    displayName: "Test Fixture Set",
    entries: [buildFixtureEntry()],
    createdAtMs: TEST_EPOCH_MS,
  };
  const merged = deepMerge(defaults, overrides ?? {});
  return parseFixtureSet(merged);
}

export { FixtureSet };
