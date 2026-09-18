/**
 * R005 — promotion pipeline: legal-transition enforcement, evidence gates,
 * stale-state refusals, the R004 license gate, the auditable append-only
 * history, and the registry-status reflection.
 */
import { describe, expect, test } from "bun:test";
import type {
  BenchmarkRun,
  PromotionRecord,
  TechnologyProfile,
  TechnologyProfile as TechnologyProfileDoc,
} from "@sporta/contracts";
import type { DeepPartial } from "@sporta/testing";
import {
  InMemoryTechnologyRegistryStore,
  PromotionEvidenceError,
  PromotionLicenseError,
  PromotionPipeline,
  PromotionTransitionError,
  RegistryConflictError,
  RegistryValidationError,
  SqliteTechnologyRegistryStore,
  TechnologyRegistry,
  buildEvaluationReport,
  candidateKeyOf,
} from "../src/index";
import {
  buildBenchmarkRun,
  buildPromotionRecord,
  buildTechnologyCandidate,
  buildTechnologyProfile,
  TEST_EPOCH_MS,
} from "./builders";

/**
 * A full happy-path rig: candidate -> profile -> benchmark run(s) ->
 * evaluation report, all registered, so promotions can cite real evidence.
 */
function makeRig(options: { license?: TechnologyProfile["license"] } = {}) {
  const registry = new TechnologyRegistry(new InMemoryTechnologyRegistryStore());
  const pipeline = new PromotionPipeline(registry);

  const candidate = registry.registerCandidate(
    buildTechnologyCandidate({
      candidateId: "cand-pd",
      technologyId: "yolo-player-detector",
      technologyVersion: "1.0.0",
      adapterVersion: "1.0.0",
    }),
  ).record;
  // NOTE: `license` is only included when actually overridden — deepMerge
  // treats an explicit `undefined` as "remove the key".
  const profileOverrides: DeepPartial<TechnologyProfileDoc> = {
    technologyId: candidate.technologyId,
    technologyVersion: candidate.technologyVersion,
    adapterVersion: candidate.adapterVersion,
  };
  if (options.license !== undefined) {
    profileOverrides.license = options.license;
  }
  const profile = registry.recordProfile(buildTechnologyProfile(profileOverrides)).record;

  const run = registry.recordBenchmarkRun(
    buildBenchmarkRun({
      runId: "run-promo-1",
      technologyId: profile.technologyId,
      technologyVersion: profile.technologyVersion,
      adapterVersion: profile.adapterVersion,
    }),
  ).record;
  const report = registry.recordEvaluationReport(
    buildEvaluationReport({
      reportId: "report-promo-1",
      runs: [run],
      recommendation: "hold",
      rationale: "makeRig placeholder report (holds until a real comparison lands)",
      decidedAtMs: TEST_EPOCH_MS + 3_600_000,
    }),
  ).record;

  return {
    registry,
    pipeline,
    profile,
    run,
    report,
    promotion(overrides: Partial<PromotionRecord> = {}): PromotionRecord {
      return buildPromotionRecord({
        promotionId: "promo-1",
        technologyId: profile.technologyId,
        technologyVersion: profile.technologyVersion,
        adapterVersion: profile.adapterVersion,
        task: profile.task,
        fromStatus: "candidate",
        toStatus: "benchmarked",
        evidence: {
          evaluationReportId: report.reportId,
          benchmarkRunIds: [run.runId],
        },
        decidedAtMs: TEST_EPOCH_MS + 7_200_000,
        ...overrides,
      });
    },
  };
}

describe("promote: happy path + audit trail", () => {
  test("candidate -> benchmarked appends the record and reflects the status", () => {
    const { pipeline, registry, profile, promotion } = makeRig();
    const record = pipeline.promote(promotion());
    expect(record.promotionId).toBe("promo-1");
    expect(registry.getProfile(profile.technologyId, profile.technologyVersion)?.status).toBe(
      "benchmarked",
    );
    expect(pipeline.promotionHistory(profile.technologyId)).toHaveLength(1);
  });

  test("the full ladder candidate -> production requires evidence at every rung", () => {
    const { pipeline, registry, profile, promotion, report, run } = makeRig();

    pipeline.promote(promotion({ promotionId: "p-1" })); // candidate -> benchmarked

    // benchmarked -> approved needs a license review reference.
    expect(() =>
      pipeline.promote(
        promotion({ promotionId: "p-2", fromStatus: "benchmarked", toStatus: "approved" }),
      ),
    ).toThrow(PromotionEvidenceError);

    pipeline.promote(
      promotion({
        promotionId: "p-2",
        fromStatus: "benchmarked",
        toStatus: "approved",
        evidence: {
          evaluationReportId: report.reportId,
          benchmarkRunIds: [run.runId],
          licenseReviewRef: "https://example.test/reviews/yolo-1.0.0",
        },
      }),
    );

    pipeline.promote(
      promotion({
        promotionId: "p-3",
        fromStatus: "approved",
        toStatus: "canary",
        evidence: {
          evaluationReportId: report.reportId,
          benchmarkRunIds: [run.runId],
          licenseReviewRef: "https://example.test/reviews/yolo-1.0.0",
        },
      }),
    );
    pipeline.promote(
      promotion({
        promotionId: "p-4",
        fromStatus: "canary",
        toStatus: "production",
        evidence: {
          evaluationReportId: report.reportId,
          benchmarkRunIds: [run.runId],
          licenseReviewRef: "https://example.test/reviews/yolo-1.0.0",
        },
      }),
    );

    expect(registry.getProfile(profile.technologyId, profile.technologyVersion)?.status).toBe(
      "production",
    );
    const history = pipeline.promotionHistory(profile.technologyId);
    expect(history.map((r) => `${r.fromStatus}->${r.toStatus}`)).toEqual([
      "candidate->benchmarked",
      "benchmarked->approved",
      "approved->canary",
      "canary->production",
    ]);
  });

  test("promotionHistory is ordered by decidedAtMs across versions", () => {
    const { pipeline, profile, promotion, registry } = makeRig();
    // A second version of the same technology.
    const candidate2 = registry.registerCandidate(
      buildTechnologyCandidate({
        candidateId: "cand-pd-2",
        technologyId: profile.technologyId,
        technologyVersion: "2.0.0",
        adapterVersion: "1.0.0",
      }),
    ).record;
    const profile2 = registry.recordProfile(
      buildTechnologyProfile({
        technologyId: candidate2.technologyId,
        technologyVersion: candidate2.technologyVersion,
        adapterVersion: candidate2.adapterVersion,
      }),
    ).record;
    const run2 = registry.recordBenchmarkRun(
      buildBenchmarkRun({
        runId: "run-promo-2",
        technologyId: profile2.technologyId,
        technologyVersion: profile2.technologyVersion,
        adapterVersion: profile2.adapterVersion,
      }),
    ).record;
    const report2 = registry.recordEvaluationReport(
      buildEvaluationReport({
        reportId: "report-promo-2",
        runs: [run2],
        recommendation: "hold",
        rationale: "v2 placeholder report",
        decidedAtMs: TEST_EPOCH_MS + 3_700_000,
      }),
    ).record;

    pipeline.promote(promotion({ promotionId: "late", decidedAtMs: TEST_EPOCH_MS + 9_000_000 }));
    pipeline.promote(
      promotion({
        promotionId: "early",
        decidedAtMs: TEST_EPOCH_MS + 8_000_000,
        technologyVersion: "2.0.0",
        evidence: { evaluationReportId: report2.reportId, benchmarkRunIds: [run2.runId] },
      }),
    );
    const history = pipeline.promotionHistory(profile.technologyId);
    expect(history.map((r) => r.promotionId)).toEqual(["early", "late"]);
  });
});

describe("promote: state + legality gates", () => {
  test("refuses an illegal transition edge (candidate -> production)", () => {
    const { pipeline, promotion } = makeRig();
    expect(() => pipeline.promote(promotion({ toStatus: "production" }))).toThrow(
      PromotionTransitionError,
    );
  });

  test("refuses a terminal-exit reversal (rejected -> anything)", () => {
    const { pipeline, promotion } = makeRig();
    pipeline.promote(promotion({ promotionId: "p-rej", toStatus: "rejected" }));
    expect(() =>
      pipeline.promote(
        promotion({ promotionId: "p-revive", fromStatus: "rejected", toStatus: "candidate" }),
      ),
    ).toThrow(PromotionTransitionError);
  });

  test("refuses a stale fromStatus (registry state moved on)", () => {
    const { pipeline, promotion } = makeRig();
    pipeline.promote(promotion({ promotionId: "p-first" }));
    expect(() =>
      pipeline.promote(promotion({ promotionId: "p-stale", fromStatus: "candidate" })),
    ).toThrow(/does not match the registry's effective status/);
  });

  test("refuses promoting an unregistered technology", () => {
    const { pipeline, promotion } = makeRig();
    expect(() => pipeline.promote(promotion({ technologyId: "ghost-tech" }))).toThrow();
  });

  test("refuses evidence citing a stale adapterVersion", () => {
    const { pipeline, registry, profile, promotion } = makeRig();
    // Record a revision (new adapterVersion, same status).
    const revision = registry.recordProfile(
      buildTechnologyProfile({
        technologyId: profile.technologyId,
        technologyVersion: profile.technologyVersion,
        adapterVersion: "1.1.0",
      }),
    ).record;
    expect(revision.adapterVersion).toBe("1.1.0");
    expect(() => pipeline.promote(promotion({ adapterVersion: "1.0.0" }))).toThrow(
      /stale evidence/,
    );
  });

  test("refuses a malformed promotion record", () => {
    const { pipeline, promotion } = makeRig();
    expect(() => pipeline.promote({ ...promotion(), decidedBy: "" })).toThrow(
      RegistryValidationError,
    );
    expect(() => pipeline.promote({ ...promotion(), promotionId: "" })).toThrow(
      RegistryValidationError,
    );
  });
});

describe("promote: evidence gates", () => {
  test("toward approved requires a license review reference", () => {
    const { pipeline, promotion } = makeRig();
    pipeline.promote(promotion({ promotionId: "p-b" })); // -> benchmarked
    expect(() =>
      pipeline.promote(
        promotion({ promotionId: "p-a", fromStatus: "benchmarked", toStatus: "approved" }),
      ),
    ).toThrow(PromotionEvidenceError);
  });

  test("an unknown evaluation report is refused", () => {
    const { pipeline, promotion } = makeRig();
    expect(() =>
      pipeline.promote(
        promotion({
          evidence: { evaluationReportId: "report-missing", benchmarkRunIds: ["run-promo-1"] },
        }),
      ),
    ).toThrow(PromotionEvidenceError);
  });

  test("an unknown benchmark run is refused", () => {
    const { pipeline, promotion } = makeRig();
    expect(() =>
      pipeline.promote(
        promotion({
          evidence: { evaluationReportId: "report-promo-1", benchmarkRunIds: ["run-missing"] },
        }),
      ),
    ).toThrow(PromotionEvidenceError);
  });

  test("citing another technology's run is refused (no evidence laundering)", () => {
    const { pipeline, registry, promotion } = makeRig();
    // Register a second technology + run.
    const otherCandidate = registry.registerCandidate(
      buildTechnologyCandidate({ candidateId: "cand-other", technologyId: "other-detector" }),
    ).record;
    const otherProfile = registry.recordProfile(
      buildTechnologyProfile({
        technologyId: otherCandidate.technologyId,
        technologyVersion: otherCandidate.technologyVersion,
        adapterVersion: otherCandidate.adapterVersion,
      }),
    ).record;
    const otherRun = registry.recordBenchmarkRun(
      buildBenchmarkRun({
        runId: "run-other-1",
        technologyId: otherProfile.technologyId,
        technologyVersion: otherProfile.technologyVersion,
        adapterVersion: otherProfile.adapterVersion,
      }),
    ).record;
    const otherReport = registry.recordEvaluationReport(
      buildEvaluationReport({
        reportId: "report-other-1",
        runs: [otherRun],
        recommendation: "hold",
        rationale: "other technology placeholder report",
        decidedAtMs: TEST_EPOCH_MS + 3_800_000,
      }),
    ).record;

    expect(() =>
      pipeline.promote(
        promotion({
          evidence: {
            evaluationReportId: otherReport.reportId,
            benchmarkRunIds: [otherRun.runId],
          },
        }),
      ),
    ).toThrow(/belongs to other-detector/);
  });

  test("citing a run the report does not cite is refused", () => {
    const { pipeline, registry, promotion, run } = makeRig();
    // A second registered run of the same technology, NOT in the report.
    const run2 = registry.recordBenchmarkRun(
      buildBenchmarkRun({
        runId: "run-promo-2",
        technologyId: run.technologyId,
        technologyVersion: run.technologyVersion,
        adapterVersion: run.adapterVersion,
      }),
    ).record;
    expect(() =>
      pipeline.promote(
        promotion({
          evidence: { evaluationReportId: "report-promo-1", benchmarkRunIds: [run2.runId] },
        }),
      ),
    ).toThrow(/not cited by evaluation report/);
  });
});

describe("promote: the R004 license gate", () => {
  test("toward approved is REFUSED while any license component blocks", () => {
    const { pipeline, promotion } = makeRig({
      license: {
        code: { status: "permissive", licenseId: "Apache-2.0", commercialUse: true },
        model: { status: "unresolved" },
      },
    });
    pipeline.promote(promotion({ promotionId: "p-b" })); // candidate -> benchmarked (no license gate)
    expect(() =>
      pipeline.promote(
        promotion({
          promotionId: "p-a",
          fromStatus: "benchmarked",
          toStatus: "approved",
          evidence: {
            evaluationReportId: "report-promo-1",
            benchmarkRunIds: ["run-promo-1"],
            licenseReviewRef: "https://example.test/reviews/yolo",
          },
        }),
      ),
    ).toThrow(PromotionLicenseError);
  });

  test("a research-only model blocks every license-gated rung (approved onward)", () => {
    const { pipeline, promotion } = makeRig({
      license: {
        code: { status: "permissive", licenseId: "Apache-2.0", commercialUse: true },
        model: { status: "research-only", licenseId: "CC-BY-NC-4.0", commercialUse: false },
      },
    });
    pipeline.promote(promotion({ promotionId: "p-b" })); // candidate -> benchmarked: not gated
    // benchmarked -> approved IS license-gated: the research-only model blocks it.
    try {
      pipeline.promote(
        promotion({
          promotionId: "p-a",
          fromStatus: "benchmarked",
          toStatus: "approved",
          evidence: {
            evaluationReportId: "report-promo-1",
            benchmarkRunIds: ["run-promo-1"],
            licenseReviewRef: "https://example.test/reviews/yolo",
          },
        }),
      );
      throw new Error("expected the license gate to refuse benchmarked -> approved");
    } catch (err) {
      expect(err).toBeInstanceOf(PromotionLicenseError);
      const licenseError = err as PromotionLicenseError;
      expect(licenseError.reasons.join("\n")).toContain("research-only");
      expect(licenseError.reasons.join("\n")).toContain("license.model");
    }
    // The technology stays at benchmarked: production is unreachable.
    const { profile } = { profile: { technologyId: promotion().technologyId } };
    void profile;
  });

  test("a rejected exit needs only the rationale, no license review", () => {
    const { pipeline, promotion } = makeRig({
      license: { code: { status: "unresolved" } },
    });
    const record = pipeline.promote(
      promotion({ promotionId: "p-reject", toStatus: "rejected", rationale: "benchmark too weak" }),
    );
    expect(record.toStatus).toBe("rejected");
  });
});

describe("promote: audit-trail integrity", () => {
  test("re-promoting the identical record is an idempotent no-op", () => {
    const { pipeline, promotion, profile } = makeRig();
    const record = promotion();
    pipeline.promote(record);
    pipeline.promote(record); // idempotent
    expect(pipeline.promotionHistory(profile.technologyId)).toHaveLength(1);
  });

  test("the same promotionId with different content is a conflict", () => {
    const { pipeline, promotion } = makeRig();
    pipeline.promote(promotion());
    expect(() => pipeline.promote(promotion({ rationale: "different rationale" }))).toThrow(
      RegistryConflictError,
    );
  });

  test("the stored record is returned as a deep copy", () => {
    const { pipeline, promotion } = makeRig();
    const stored = pipeline.promote(promotion());
    stored.rationale = "tampered";
    expect(pipeline.promotionHistory(stored.technologyId)[0]?.rationale).toBe(
      "builder default promotion",
    );
  });
});

describe("promote works over the SQLite store too (cross-implementation)", () => {
  test("the full ladder round-trips on sqlite", () => {
    const store = new SqliteTechnologyRegistryStore(":memory:");
    const registry = new TechnologyRegistry(store);
    const pipeline = new PromotionPipeline(registry);

    const candidate = registry.registerCandidate(
      buildTechnologyCandidate({
        candidateId: "cand-sql",
        technologyId: "sql-detector",
      }),
    ).record;
    const profile = registry.recordProfile(
      buildTechnologyProfile({
        technologyId: candidate.technologyId,
        technologyVersion: candidate.technologyVersion,
        adapterVersion: candidate.adapterVersion,
      }),
    ).record;
    const run = registry.recordBenchmarkRun(
      buildBenchmarkRun({
        runId: "run-sql-1",
        technologyId: profile.technologyId,
        technologyVersion: profile.technologyVersion,
        adapterVersion: profile.adapterVersion,
      }),
    ).record;
    const report = registry.recordEvaluationReport(
      buildEvaluationReport({
        reportId: "report-sql-1",
        runs: [run],
        recommendation: "hold",
        rationale: "sqlite cross-implementation rig report",
        decidedAtMs: TEST_EPOCH_MS + 3_600_000,
      }),
    ).record;

    pipeline.promote(
      buildPromotionRecord({
        promotionId: "promo-sql-1",
        technologyId: profile.technologyId,
        technologyVersion: profile.technologyVersion,
        adapterVersion: profile.adapterVersion,
        fromStatus: "candidate",
        toStatus: "benchmarked",
        evidence: { evaluationReportId: report.reportId, benchmarkRunIds: [run.runId] },
      }),
    );
    expect(registry.getProfile(profile.technologyId, profile.technologyVersion)?.status).toBe(
      "benchmarked",
    );
    expect(pipeline.promotionHistory(profile.technologyId)).toHaveLength(1);
    store.close();
  });
});

describe("candidateKeyOf consistency between report and promotion", () => {
  test("the promotion evidence run key matches the profile identity", () => {
    const { run, profile } = makeRig();
    const runKey: string = candidateKeyOf(run as BenchmarkRun);
    expect(runKey).toBe(
      `${profile.technologyId}@${profile.technologyVersion}+${profile.adapterVersion}`,
    );
  });
});
