/**
 * R001 — resolveTaskProfile: the resolution seam. Ordering rules, pin
 * semantics, and the three typed outcomes (resolved / no-candidate /
 * unresolvable-preference). Exercises both the pure function and the
 * registry-integrated path.
 */
import { describe, expect, test } from "bun:test";
import type { TechnologyProfile } from "@sporta/contracts";
import {
  InMemoryTechnologyRegistryStore,
  PromotionPipeline,
  STATUS_RANK,
  TechnologyRegistry,
  buildEvaluationReport,
  resolveTaskProfileAgainst,
} from "../src/index";
import {
  buildBenchmarkRun,
  buildPromotionRecord,
  buildTechnologyCandidate,
  buildTechnologyProfile,
  TEST_EPOCH_MS,
} from "./builders";

/** A deterministic profile factory with explicit identity + status. */
function profile(
  technologyId: string,
  technologyVersion: string,
  status: TechnologyProfile["status"],
  adapterVersion = "1.0.0",
  task: TechnologyProfile["task"] = "perception.player-detection",
): TechnologyProfile {
  return buildTechnologyProfile({
    technologyId,
    technologyVersion,
    adapterVersion,
    status,
    task,
    inputContract:
      task === "perception.player-detection"
        ? "contracts/normalized-video-frame@1"
        : "contracts/observation.detection-sequence@1",
    outputContract:
      task === "perception.player-detection"
        ? "contracts/observation.detection@1"
        : "contracts/observation.track@1",
  });
}

describe("resolveTaskProfileAgainst (pure)", () => {
  test("no active profiles -> no-candidate", () => {
    const result = resolveTaskProfileAgainst({ task: "perception.player-detection" }, []);
    expect(result.outcome).toBe("no-candidate");
  });

  test("terminal profiles never resolve -> no-candidate", () => {
    const result = resolveTaskProfileAgainst({ task: "perception.player-detection" }, [
      profile("det-rejected", "1.0.0", "rejected"),
      profile("det-deprecated", "1.0.0", "deprecated"),
    ]);
    expect(result.outcome).toBe("no-candidate");
  });

  test("highest status wins: production > canary > approved > benchmarked > candidate", () => {
    const profiles = [
      profile("det-candidate", "1.0.0", "candidate"),
      profile("det-benchmarked", "1.0.0", "benchmarked"),
      profile("det-approved", "1.0.0", "approved"),
      profile("det-canary", "1.0.0", "canary"),
      profile("det-production", "1.0.0", "production"),
    ];
    const result = resolveTaskProfileAgainst({ task: "perception.player-detection" }, profiles);
    expect(result.outcome).toBe("resolved");
    if (result.outcome === "resolved") {
      expect(result.profile.technologyId).toBe("det-production");
      expect(result.via).toBe("highest-status");
    }
  });

  test("ties break deterministically by technology id, then version, then adapter", () => {
    const profiles = [
      profile("det-b", "1.0.0", "approved"),
      profile("det-a", "2.0.0", "approved"),
      profile("det-a", "1.0.0", "approved"),
    ];
    const result = resolveTaskProfileAgainst({ task: "perception.player-detection" }, profiles);
    if (result.outcome === "resolved") {
      expect(result.profile.technologyId).toBe("det-a");
      expect(result.profile.technologyVersion).toBe("1.0.0");
    } else {
      throw new Error("expected resolution");
    }
  });

  test("only profiles for the requested task are considered", () => {
    const profiles = [
      profile("tracker-x", "1.0.0", "production", "1.0.0", "perception.player-tracking"),
    ];
    const result = resolveTaskProfileAgainst({ task: "perception.player-detection" }, profiles);
    expect(result.outcome).toBe("no-candidate");
  });

  test("a preferred pin resolves ahead of a higher-status default", () => {
    const profiles = [
      profile("det-prod", "1.0.0", "production"),
      profile("det-pinned", "1.0.0", "candidate"),
    ];
    const result = resolveTaskProfileAgainst(
      { task: "perception.player-detection", prefer: ["det-pinned@1.0.0"] },
      profiles,
    );
    if (result.outcome === "resolved") {
      expect(result.profile.technologyId).toBe("det-pinned");
      expect(result.via).toBe("preference");
    } else {
      throw new Error("expected resolution");
    }
  });

  test("prefer order wins over fallback order", () => {
    const profiles = [
      profile("det-a", "1.0.0", "candidate"),
      profile("det-b", "1.0.0", "candidate"),
    ];
    const result = resolveTaskProfileAgainst(
      { task: "perception.player-detection", prefer: ["det-b@1.0.0"], fallback: ["det-a@1.0.0"] },
      profiles,
    );
    if (result.outcome === "resolved") {
      expect(result.profile.technologyId).toBe("det-b");
      expect(result.via).toBe("preference");
    } else {
      throw new Error("expected resolution");
    }
  });

  test("a failed preferred pin falls through to a resolvable fallback", () => {
    const profiles = [profile("det-a", "1.0.0", "candidate")];
    const result = resolveTaskProfileAgainst(
      {
        task: "perception.player-detection",
        prefer: ["det-missing@1.0.0"],
        fallback: ["det-a@1.0.0"],
      },
      profiles,
    );
    if (result.outcome === "resolved") {
      expect(result.profile.technologyId).toBe("det-a");
      expect(result.via).toBe("fallback");
    } else {
      throw new Error("expected resolution");
    }
  });

  test("unresolvable pins never silently substitute a different technology", () => {
    const profiles = [profile("det-a", "1.0.0", "production")];
    const result = resolveTaskProfileAgainst(
      { task: "perception.player-detection", prefer: ["det-missing@1.0.0"] },
      profiles,
    );
    expect(result.outcome).toBe("unresolvable-preference");
    if (result.outcome === "unresolvable-preference") {
      expect(result.attempted).toEqual(["det-missing@1.0.0"]);
      expect(result.issues).toHaveLength(1);
    }
  });

  test("inactive (deprecated/rejected) pins are unresolvable, not fallbacks to default", () => {
    const profiles = [
      profile("det-old", "1.0.0", "deprecated"),
      profile("det-new", "1.0.0", "candidate"),
    ];
    const result = resolveTaskProfileAgainst(
      { task: "perception.player-detection", prefer: ["det-old@1.0.0"] },
      profiles,
    );
    expect(result.outcome).toBe("unresolvable-preference");
  });

  test("malformed pins are recorded as issues", () => {
    const profiles = [profile("det-a", "1.0.0", "candidate")];
    const result = resolveTaskProfileAgainst(
      { task: "perception.player-detection", prefer: ["no-at-sign", "@noversion", "noid@"] },
      profiles,
    );
    expect(result.outcome).toBe("unresolvable-preference");
    if (result.outcome === "unresolvable-preference") {
      expect(result.issues).toHaveLength(3);
    }
  });

  test("a pin for the wrong task is refused", () => {
    const profiles = [
      profile("tracker-x", "1.0.0", "production", "1.0.0", "perception.player-tracking"),
    ];
    const result = resolveTaskProfileAgainst(
      { task: "perception.player-detection", prefer: ["tracker-x@1.0.0"] },
      profiles,
    );
    expect(result.outcome).toBe("no-candidate");
  });
});

describe("TechnologyRegistry.resolveTaskProfile (integrated)", () => {
  /**
   * Registers profiles honestly: every unit enters as `candidate` and is
   * advanced through the promotion pipeline (with real evidence) to its
   * target status — never by recording a non-candidate first profile.
   */
  function registryWith(
    units: Array<{
      id: string;
      version?: string;
      status: TechnologyProfile["status"];
      task?: TechnologyProfile["task"];
    }>,
  ): TechnologyRegistry {
    const registry = new TechnologyRegistry(new InMemoryTechnologyRegistryStore());
    const ladder: Record<string, TechnologyProfile["status"][]> = {
      candidate: [],
      benchmarked: ["benchmarked"],
      approved: ["benchmarked", "approved"],
      canary: ["benchmarked", "approved", "canary"],
      production: ["benchmarked", "approved", "canary", "production"],
    };
    let seq = 0;
    for (const unit of units) {
      const version = unit.version ?? "1.0.0";
      const candidate = buildTechnologyCandidate({
        candidateId: `cand-${unit.id}`,
        technologyId: unit.id,
        technologyVersion: version,
        task: unit.task ?? "perception.player-detection",
      });
      registry.registerCandidate(candidate);
      registry.recordProfile(
        profile(unit.id, version, "candidate", "1.0.0", unit.task ?? "perception.player-detection"),
      );
      const run = registry.recordBenchmarkRun(
        buildBenchmarkRun({
          runId: `run-${unit.id}`,
          technologyId: unit.id,
          technologyVersion: version,
          task: unit.task ?? "perception.player-detection",
        }),
      ).record;
      const report = registry.recordEvaluationReport(
        buildEvaluationReport({
          reportId: `report-${unit.id}`,
          runs: [run],
          recommendation: "hold",
          rationale: "resolution-test rig report",
          decidedAtMs: TEST_EPOCH_MS + seq,
        }),
      ).record;
      seq += 1;
      let from: TechnologyProfile["status"] = "candidate";
      for (const to of ladder[unit.status] ?? []) {
        new PromotionPipeline(registry).promote(
          buildPromotionRecord({
            promotionId: `promo-${unit.id}-${to}`,
            technologyId: unit.id,
            technologyVersion: version,
            task: unit.task ?? "perception.player-detection",
            fromStatus: from,
            toStatus: to,
            evidence: {
              evaluationReportId: report.reportId,
              benchmarkRunIds: [run.runId],
              ...(to === "approved" || to === "canary" || to === "production"
                ? { licenseReviewRef: "https://example.test/reviews/rig" }
                : {}),
            },
          }),
        );
        from = to;
      }
    }
    return registry;
  }

  test("resolves the highest-status registered profile", () => {
    const registry = registryWith([
      { id: "det-a", status: "candidate" },
      { id: "det-b", status: "approved" },
    ]);
    const result = registry.resolveTaskProfile({ task: "perception.player-detection" });
    if (result.outcome === "resolved") {
      expect(result.profile.technologyId).toBe("det-b");
      expect(result.profile.status).toBe("approved");
    } else {
      throw new Error("expected resolution");
    }
  });

  test("resolves a preferred pin through the registry", () => {
    const registry = registryWith([
      { id: "det-a", status: "production" },
      { id: "det-b", status: "benchmarked" },
    ]);
    const result = registry.resolveTaskProfile({
      task: "perception.player-detection",
      prefer: ["det-b@1.0.0"],
    });
    if (result.outcome === "resolved") {
      expect(result.profile.technologyId).toBe("det-b");
      expect(result.via).toBe("preference");
    } else {
      throw new Error("expected resolution");
    }
  });

  test("reports no-candidate for a task with no registrations", () => {
    const registry = registryWith([{ id: "det-a", status: "candidate" }]);
    const result = registry.resolveTaskProfile({ task: "intelligence.asr" });
    expect(result.outcome).toBe("no-candidate");
  });

  test("rejects an invalid task reference at the boundary", () => {
    const registry = registryWith([{ id: "det-a", status: "candidate" }]);
    expect(() => registry.resolveTaskProfile({ task: "not-a-task" as never })).toThrow();
  });
});

describe("STATUS_RANK", () => {
  test("orders the lifecycle as frozen in the contracts", () => {
    expect(STATUS_RANK.production).toBeGreaterThan(STATUS_RANK.canary);
    expect(STATUS_RANK.canary).toBeGreaterThan(STATUS_RANK.approved);
    expect(STATUS_RANK.approved).toBeGreaterThan(STATUS_RANK.benchmarked);
    expect(STATUS_RANK.benchmarked).toBeGreaterThan(STATUS_RANK.candidate);
    expect(STATUS_RANK.deprecated).toBeLessThan(0);
    expect(STATUS_RANK.rejected).toBeLessThan(0);
  });
});
