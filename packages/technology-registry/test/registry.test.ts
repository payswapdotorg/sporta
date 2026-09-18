/**
 * R001 — Technology Registry: candidate registration (validation,
 * idempotent duplicates), profile recording (taxonomy enforcement,
 * lifecycle rules, immutability), list/get views, and run/report
 * registration gates.
 */
import { describe, expect, test } from "bun:test";
import type { TechnologyProfile } from "@sporta/contracts";
import {
  EvaluationValidationError,
  IllegalProfileStatusError,
  InMemoryTechnologyRegistryStore,
  RegistryConflictError,
  RegistryValidationError,
  TechnologyNotFoundError,
  TechnologyRegistry,
} from "../src/index";
import {
  buildBenchmarkRun,
  buildEvaluationReport,
  buildTechnologyCandidate,
  buildTechnologyProfile,
  PERMISSIVE_LICENSE,
  TEST_EPOCH_MS,
} from "./builders";

function makeRegistry() {
  return new TechnologyRegistry(new InMemoryTechnologyRegistryStore());
}

/** Register candidate + first profile (status candidate) for a technology. */
function registerUnit(
  registry: TechnologyRegistry,
  overrides: Partial<Parameters<typeof buildTechnologyCandidate>[0]> & {
    profileOverrides?: Parameters<typeof buildTechnologyProfile>[0];
  } = {},
) {
  const candidate = buildTechnologyCandidate({
    technologyId: "yolo-detector",
    candidateId: "cand-yolo-1",
    ...overrides,
  });
  const { record: registered } = registry.registerCandidate(candidate);
  const profile = buildTechnologyProfile({
    technologyId: registered.technologyId,
    technologyVersion: registered.technologyVersion,
    adapterVersion: registered.adapterVersion,
    ...overrides.profileOverrides,
  });
  registry.recordProfile(profile);
  return { candidate: registered, profile };
}

describe("registerCandidate (R001)", () => {
  test("stores a valid candidate and reports created", () => {
    const registry = makeRegistry();
    const candidate = buildTechnologyCandidate({ candidateId: "cand-a", technologyId: "tech-a" });
    const result = registry.registerCandidate(candidate);
    expect(result.created).toBe(true);
    expect(result.record.candidateId).toBe("cand-a");
    expect(registry.getCandidate("cand-a")?.technologyId).toBe("tech-a");
  });

  test("re-registering the identical triple is an idempotent no-op", () => {
    const registry = makeRegistry();
    const candidate = buildTechnologyCandidate({ candidateId: "cand-a", technologyId: "tech-a" });
    const first = registry.registerCandidate(candidate);
    const second = registry.registerCandidate(
      buildTechnologyCandidate({ candidateId: "cand-a", technologyId: "tech-a" }),
    );
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.record).toEqual(first.record);
  });

  test("the same triple under a different candidateId is a conflict", () => {
    const registry = makeRegistry();
    registry.registerCandidate(
      buildTechnologyCandidate({ candidateId: "cand-a", technologyId: "tech-a" }),
    );
    expect(() =>
      registry.registerCandidate(
        buildTechnologyCandidate({ candidateId: "cand-b", technologyId: "tech-a" }),
      ),
    ).toThrow(RegistryConflictError);
  });

  test("an invalid document is refused (fail-closed on write)", () => {
    const registry = makeRegistry();
    const valid = buildTechnologyCandidate();
    expect(() => registry.registerCandidate({ ...valid, task: "not-a-task" as never })).toThrow(
      RegistryValidationError,
    );
    expect(() => registry.registerCandidate({ ...valid, candidateId: "" })).toThrow(
      RegistryValidationError,
    );
  });

  test("a task outside the AdapterTaskKind taxonomy is refused", () => {
    const registry = makeRegistry();
    const valid = buildTechnologyCandidate();
    expect(() =>
      registry.registerCandidate({ ...valid, task: "perception.nonexistent" as never }),
    ).toThrow(RegistryValidationError);
  });
});

describe("recordProfile (R001)", () => {
  test("records the first profile and returns it as candidate", () => {
    const registry = makeRegistry();
    const { profile } = registerUnit(registry);
    const stored = registry.getProfile(profile.technologyId, profile.technologyVersion);
    expect(stored?.status).toBe("candidate");
    expect(stored?.adapterVersion).toBe(profile.adapterVersion);
  });

  test("refuses a first profile that does not enter as candidate", () => {
    const registry = makeRegistry();
    const candidate = buildTechnologyCandidate({ candidateId: "cand-x", technologyId: "tech-x" });
    registry.registerCandidate(candidate);
    expect(() =>
      registry.recordProfile(
        buildTechnologyProfile({
          technologyId: "tech-x",
          technologyVersion: candidate.technologyVersion,
          adapterVersion: candidate.adapterVersion,
          status: "production",
        }),
      ),
    ).toThrow(IllegalProfileStatusError);
  });

  test("refuses a profile for an unregistered candidate (every profile starts as a candidate)", () => {
    const registry = makeRegistry();
    expect(() =>
      registry.recordProfile(buildTechnologyProfile({ technologyId: "ghost-tech" })),
    ).toThrow(TechnologyNotFoundError);
  });

  test("refuses a profile whose task mismatches the candidate's task", () => {
    const registry = makeRegistry();
    const candidate = buildTechnologyCandidate({
      candidateId: "cand-t",
      technologyId: "tech-t",
      task: "perception.ball-detection",
    });
    registry.registerCandidate(candidate);
    expect(() =>
      registry.recordProfile(
        buildTechnologyProfile({
          technologyId: "tech-t",
          technologyVersion: candidate.technologyVersion,
          adapterVersion: candidate.adapterVersion,
          task: "perception.player-detection",
        }),
      ),
    ).toThrow(RegistryValidationError);
  });

  test("re-recording the identical triple is an idempotent no-op", () => {
    const registry = makeRegistry();
    const { profile } = registerUnit(registry);
    const again = registry.recordProfile(profile);
    expect(again.created).toBe(false);
    expect(again.record.status).toBe("candidate");
  });

  test("re-recording the same triple with different content is refused (immutability)", () => {
    const registry = makeRegistry();
    const { profile } = registerUnit(registry);
    expect(() =>
      registry.recordProfile({ ...profile, displayName: "Changed Display Name" }),
    ).toThrow(RegistryConflictError);
  });

  test("a same-status revision with a new adapterVersion is accepted", () => {
    const registry = makeRegistry();
    const { profile } = registerUnit(registry);
    const revision = buildTechnologyProfile({
      technologyId: profile.technologyId,
      technologyVersion: profile.technologyVersion,
      adapterVersion: "1.1.0",
      displayName: "Revised Detector",
      license: { code: { status: "permissive", licenseId: "MIT", commercialUse: true } },
    });
    const result = registry.recordProfile(revision);
    expect(result.created).toBe(true);
    const current = registry.getProfile(profile.technologyId, profile.technologyVersion);
    expect(current?.adapterVersion).toBe("1.1.0");
    expect(current?.status).toBe("candidate");
    // The old immutable document is still available for audit.
    const recorded = registry.getRecordedProfile({
      technologyId: profile.technologyId,
      technologyVersion: profile.technologyVersion,
      adapterVersion: profile.adapterVersion,
    });
    expect(recorded?.displayName).toBe(profile.displayName);
  });

  test("a legal-edge status change via recordProfile is accepted", () => {
    const registry = makeRegistry();
    const { profile } = registerUnit(registry);
    const advanced = buildTechnologyProfile({
      technologyId: profile.technologyId,
      technologyVersion: profile.technologyVersion,
      adapterVersion: "1.1.0",
      status: "benchmarked",
      benchmarkProfile: {
        fixtureSetVersion: "fixtures-football-v1",
        benchmarkRunIds: ["run-1"],
      },
    });
    registry.recordProfile(advanced);
    expect(registry.getProfile(profile.technologyId, profile.technologyVersion)?.status).toBe(
      "benchmarked",
    );
  });

  test("an illegal status transition is refused", () => {
    const registry = makeRegistry();
    const { profile } = registerUnit(registry);
    expect(() =>
      registry.recordProfile(
        buildTechnologyProfile({
          technologyId: profile.technologyId,
          technologyVersion: profile.technologyVersion,
          adapterVersion: "1.1.0",
          status: "production", // candidate -> production skips every gate
        }),
      ),
    ).toThrow(IllegalProfileStatusError);
  });

  test("an invalid profile document is refused", () => {
    const registry = makeRegistry();
    const candidate = buildTechnologyCandidate({ candidateId: "cand-i", technologyId: "tech-i" });
    registry.registerCandidate(candidate);
    const valid = buildTechnologyProfile({
      technologyId: "tech-i",
      technologyVersion: candidate.technologyVersion,
      adapterVersion: candidate.adapterVersion,
    });
    expect(() =>
      registry.recordProfile({
        ...valid,
        resourceRequirements: { gpuRequired: true, minVramGb: -2 },
      }),
    ).toThrow(RegistryValidationError);
  });
});

describe("listProfiles (R001)", () => {
  test("filters by task and status over the effective views", () => {
    const registry = makeRegistry();
    registerUnit(registry, {
      technologyId: "detector-a",
      candidateId: "cand-a",
      profileOverrides: { technologyId: "detector-a" },
    });
    registerUnit(registry, {
      technologyId: "tracker-b",
      candidateId: "cand-b",
      task: "perception.player-tracking",
      profileOverrides: {
        technologyId: "tracker-b",
        task: "perception.player-tracking",
        inputContract: "contracts/observation.detection-sequence@1",
        outputContract: "contracts/observation.track@1",
      },
    });

    expect(registry.listProfiles()).toHaveLength(2);
    expect(
      registry.listProfiles({ task: "perception.player-tracking" }).map((p) => p.technologyId),
    ).toEqual(["tracker-b"]);
    expect(registry.listProfiles({ status: "candidate" }).map((p) => p.technologyId)).toEqual([
      "detector-a",
      "tracker-b",
    ]);
    expect(registry.listProfiles({ status: "production" })).toHaveLength(0);
  });

  test("an unknown task filter yields an empty list", () => {
    const registry = makeRegistry();
    expect(registry.listProfiles({ task: "rendering.encode" })).toHaveLength(0);
  });
});

describe("recordBenchmarkRun / recordEvaluationReport gates", () => {
  test("a benchmark run for an unregistered profile is refused", () => {
    const registry = makeRegistry();
    expect(() => registry.recordBenchmarkRun(buildBenchmarkRun({ technologyId: "ghost" }))).toThrow(
      TechnologyNotFoundError,
    );
  });

  test("a benchmark run for a registered profile is stored, idempotently", () => {
    const registry = makeRegistry();
    const { profile } = registerUnit(registry);
    const run = buildBenchmarkRun({
      technologyId: profile.technologyId,
      technologyVersion: profile.technologyVersion,
      adapterVersion: profile.adapterVersion,
      runId: "run-yolo-1",
    });
    const first = registry.recordBenchmarkRun(run);
    const second = registry.recordBenchmarkRun(run);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(registry.getBenchmarkRun("run-yolo-1")?.technologyId).toBe(profile.technologyId);
  });

  test("a report citing an unknown run is refused", () => {
    const registry = makeRegistry();
    expect(() =>
      registry.recordEvaluationReport(
        buildEvaluationReport({ benchmarkRunIds: ["run-nope"], reportId: "report-1" }),
      ),
    ).toThrow(EvaluationValidationError);
  });

  test("a promote recommendation without a recommended candidate is refused", () => {
    const registry = makeRegistry();
    const { profile } = registerUnit(registry);
    const run = registry.recordBenchmarkRun(
      buildBenchmarkRun({
        technologyId: profile.technologyId,
        technologyVersion: profile.technologyVersion,
        adapterVersion: profile.adapterVersion,
        runId: "run-1",
      }),
    );
    expect(() =>
      registry.recordEvaluationReport(
        buildEvaluationReport({
          reportId: "report-1",
          benchmarkRunIds: [run.record.runId],
          recommendation: "promote",
          recommendedCandidate: undefined,
        }),
      ),
    ).toThrow(EvaluationValidationError);
  });

  test("a coherent report is stored", () => {
    const registry = makeRegistry();
    const { profile } = registerUnit(registry);
    const run = registry.recordBenchmarkRun(
      buildBenchmarkRun({
        technologyId: profile.technologyId,
        technologyVersion: profile.technologyVersion,
        adapterVersion: profile.adapterVersion,
        runId: "run-1",
      }),
    );
    const report = registry.recordEvaluationReport(
      buildEvaluationReport({
        reportId: "report-1",
        benchmarkRunIds: [run.record.runId],
        recommendation: "hold",
      }),
    );
    expect(report.created).toBe(true);
    expect(registry.getEvaluationReport("report-1")?.fixtureSetVersion).toBe(
      run.record.fixtureSetVersion,
    );
  });
});

describe("registry holds the frozen-contract documents unchanged", () => {
  test("round-trips a profile without altering frozen fields", () => {
    const registry = makeRegistry();
    const { profile } = registerUnit(registry);
    const stored = registry.getProfile(
      profile.technologyId,
      profile.technologyVersion,
    ) as TechnologyProfile;
    expect(stored.license).toEqual(PERMISSIVE_LICENSE);
    expect(stored.schemaVersion).toBe("1.1");
    expect(stored.task).toBe("perception.player-detection");
    expect(stored.provenance.maintainer).toBe("sporta-test");
  });
});

describe("registration timestamps are caller-controlled", () => {
  test("registeredAtMs comes from the document, never the clock", () => {
    const registry = makeRegistry();
    const candidate = registry.registerCandidate(
      buildTechnologyCandidate({ registeredAtMs: TEST_EPOCH_MS + 123 }),
    );
    expect(candidate.record.registeredAtMs).toBe(TEST_EPOCH_MS + 123);
  });
});
