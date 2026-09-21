import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BenchmarkRun } from "@sporta/contracts";
import {
  runBallDetectionFamilyBenchmark,
  runBallFamilyBenchmark,
  runCalibrationFamilyBenchmark,
  runDetectionFamilyBenchmark,
  runTeamFamilyBenchmark,
  runTrackingFamilyBenchmark,
} from "../src/index";

describe("deterministic family benchmarks (all families)", () => {
  const benchmarks = [
    ["detection", runDetectionFamilyBenchmark],
    ["ball-detection", runBallDetectionFamilyBenchmark],
    ["tracking", runTrackingFamilyBenchmark],
    ["ball", runBallFamilyBenchmark],
    ["calibration", runCalibrationFamilyBenchmark],
    ["team", runTeamFamilyBenchmark],
  ] as const;

  for (const [name, run] of benchmarks) {
    test(`${name}: two runs of the same benchmark produce IDENTICAL records`, () => {
      const first = run();
      const second = run();
      expect(first.length).toBeGreaterThan(0);
      expect(second).toEqual(first);
    });

    test(`${name}: every record conforms to the frozen BenchmarkRun schema`, () => {
      for (const record of run()) {
        const parsed = BenchmarkRun.safeParse(record);
        expect(parsed.success).toBe(true);
        expect(parsed.data?.costEstimateUsd).toBeNull();
        expect(parsed.data?.reproducibility.deterministic).toBe(true);
        expect(parsed.data?.reproducibility.rerunDeltaPct).toBe(0);
        expect(parsed.data?.reproducibility.seed).toBeDefined();
        expect(parsed.data?.runtimeSeconds).toBeGreaterThan(0);
        expect(parsed.data?.fixtureSetVersion).toBe("perception-adapters.synthetic-diagnostic@1");
        expect(parsed.data?.artifactRefs.length).toBeGreaterThan(0);
        // The honesty rule: failures > 0 requires at least one example.
        if (parsed.data !== undefined && parsed.data.failureSummary.failures > 0) {
          expect(parsed.data.failureSummary.failureExamples.length).toBeGreaterThan(0);
        }
      }
    });
  }

  test("the detection benchmark's candidates are all present and materially different", () => {
    // Deterministic pin: the model-backed candidate's degradation class depends
    // on the weights-dir state, and the repo commits NO weights (the pinned
    // download is operator-provided — packages/perception-adapters/assets/README.md).
    // A controlled temp weightsDir with a DUMMY weights file pins the documented
    // pre-W303 posture (weights present, no backend wired) so the assertion holds
    // on every clean checkout; the weights-absent posture is covered by its own
    // case below. The detector only checks file EXISTENCE at this seam (the real
    // parse happens in the injected backend), so a zero-byte sentinel is the
    // honest pin — it is never parsed, never promoted, never committed.
    const weightsDir = mkdtempSync(join(tmpdir(), "sporta-weights-pin-"));
    writeFileSync(join(weightsDir, "yolov8n.pt"), "");
    const runs = runDetectionFamilyBenchmark({
      modelBackedOptions: { weightsDir },
    });
    expect(runs.map((run) => run.technologyId)).toEqual([
      "heuristic-color-detector",
      "model-backed-detector",
      "contrast-context-detector",
    ]);
    const heuristic = runs[0]!;
    const modelBacked = runs[1]!;
    const contrastContext = runs[2]!;
    // The heuristic candidate actually detects on synthetic pixels.
    expect(heuristic.metrics.truePositives).toBeGreaterThan(0);
    expect(heuristic.failureSummary.failures).toBe(0);
    // The model-backed candidate honestly fails closed without a backend.
    expect(modelBacked.failureSummary.failures).toBeGreaterThan(0);
    expect(modelBacked.failureSummary.failureExamples.join("; ")).toContain(
      "model-backed.inference-backend-not-wired",
    );
    // The J012b production-path candidate detects on synthetic pixels with
    // honest metrics (surface-agnostic: it fires on the fixture's green
    // pitch exactly as it fires on sand or film gray).
    expect(contrastContext.metrics.truePositives).toBeGreaterThan(0);
    expect(contrastContext.failureSummary.failures).toBe(0);
  });

  test("the detection benchmark's model-backed candidate reports weights-unavailable when no weights asset exists", () => {
    // The complementary honest posture: with NO weights asset (the default on
    // any clean checkout — weights are never committed), the candidate fails
    // closed with the weights-unavailable class, never a silent empty list.
    const emptyWeightsDir = mkdtempSync(join(tmpdir(), "sporta-weights-empty-"));
    const runs = runDetectionFamilyBenchmark({
      modelBackedOptions: { weightsDir: emptyWeightsDir },
    });
    const modelBacked = runs[1]!;
    expect(modelBacked.failureSummary.failures).toBeGreaterThan(0);
    expect(modelBacked.failureSummary.failureExamples.join("; ")).toContain(
      "model-backed.weights-unavailable",
    );
  });

  test("the tracking benchmark's two candidates materially differ on the fixtures", () => {
    const runs = runTrackingFamilyBenchmark();
    expect(runs.map((run) => run.technologyId)).toEqual([
      "greedy-iou-tracker",
      "hungarian-tracker",
    ]);
    const greedy = runs[0]!;
    const hungarian = runs[1]!;
    expect(greedy.metrics.gtBoxes).toBe(hungarian.metrics.gtBoxes);
    expect(greedy.metrics.gtIdentitySwitches).not.toBe(hungarian.metrics.gtIdentitySwitches);
  });

  test("the ball benchmark's two candidates are both present", () => {
    const runs = runBallFamilyBenchmark();
    expect(runs.map((run) => run.technologyId)).toEqual([
      "nearest-box-ball-tracker",
      "color-blob-ball-tracker",
    ]);
    // Both track the visible ball with small position error.
    expect(runs[0]!.metrics.positionRmse).toBeLessThan(0.01);
    expect(runs[1]!.metrics.positionRmse).toBeLessThan(0.05);
  });

  test("the calibration benchmark: baseline exact, line-based refuses the zoomed scenario honestly", () => {
    const runs = runCalibrationFamilyBenchmark();
    expect(runs.map((run) => run.technologyId)).toEqual([
      "homography-field-calibrator",
      "line-based-field-calibrator",
    ]);
    const baseline = runs[0]!;
    const lineBased = runs[1]!;
    expect(baseline.metrics.cornerRmseMeters).toBeLessThan(1e-6);
    expect(baseline.metrics.refusedScenarios).toBe(0);
    expect(lineBased.metrics.refusedScenarios).toBe(1);
    expect(lineBased.failureSummary.failureExamples.join("; ")).toContain(
      "line-based.insufficient-line-evidence",
    );
  });

  test("the team benchmark reports perfect partition accuracy and full unknown honesty", () => {
    const runs = runTeamFamilyBenchmark();
    expect(runs.length).toBe(1);
    const metrics = runs[0]!.metrics;
    expect(metrics.partitionAccuracy).toBe(1);
    expect(metrics.unknownHonestyRate).toBe(1);
    expect(metrics.overUnknownRate).toBe(0);
  });
});

describe("the committed fixture specs (synthetic-diagnostic, on disk)", () => {
  const FIXTURES_DIR = join(import.meta.dir, "..", "fixtures");

  test("every family's scenario spec file is committed and carries the fixture-set version", () => {
    for (const fileName of [
      "detection-scenarios.json",
      "tracking-scenarios.json",
      "ball-scenarios.json",
      "calibration-scenarios.json",
      "team-scenarios.json",
    ]) {
      const parsed = JSON.parse(readFileSync(join(FIXTURES_DIR, fileName), "utf8")) as {
        fixtureSetVersion: string;
        honestyBoundary: string;
        scenarios: readonly { specId?: string; detection?: { specId?: string } }[];
      };
      expect(parsed.fixtureSetVersion).toBe("perception-adapters.synthetic-diagnostic@1");
      expect(parsed.honestyBoundary).toContain("SYNTHETIC-DIAGNOSTIC");
      expect(parsed.scenarios.length).toBeGreaterThan(0);
      for (const scenario of parsed.scenarios) {
        // Tracking scenarios nest their detection spec; every scenario is
        // named either way.
        const specId = scenario.specId ?? scenario.detection?.specId;
        expect(specId === undefined || specId.length > 0).toBe(true);
      }
    }
  });
});

describe("statelessness (SQLite nothing — this package is stateless)", () => {
  test("the package declares no database or persistence dependencies", () => {
    const packageJson = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const dependencyNames = Object.keys(packageJson.dependencies ?? {});
    expect(dependencyNames).toEqual([
      "@sporta/ball-tracking",
      "@sporta/contracts",
      "@sporta/field-mapping",
      "@sporta/perception-detection",
      "@sporta/perception-tracking",
      "@sporta/testing",
    ]);
    for (const name of dependencyNames) {
      expect(name).not.toMatch(/prisma|sqlite|postgres|mysql|redis|mongo/i);
    }
  });
});
