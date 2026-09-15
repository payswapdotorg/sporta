/**
 * W801 runner tests: the suite execution semantics —
 *
 * - the default suite passes 3/3 (real evaluators, real fixtures);
 * - the per-case MEASURED VALUES are VERBATIM from the evaluators (each case
 *   deep-equals the evaluator's own direct output for the same input);
 * - thresholds are the evaluators' own exported constants;
 * - crash containment: a crashing case is a FAILED case result with the
 *   error class + message, the suite CONTINUES, the aggregate reports it;
 * - a missing fixture is a structural FAIL, never a skip;
 * - a failing evaluator verdict flips the conjunctive aggregate;
 * - the clock is INJECTED (custom clocks produce custom clock reads).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCrossRunEvaluation, DEFAULT_EPSILON } from "@sporta/evaluation";
import type { EvaluationReport } from "@sporta/evaluation";
import {
  evaluateRenderOutput,
  renderW503CleanFixture,
  THRESHOLDS,
} from "@sporta/renderer-evaluation";
import { CAMERA_SLOT_IDS, projectScene, runSceneConformance } from "@sporta/scene-projection";
import {
  createStepClock,
  loadSuiteConfig,
  loadW601SceneFixture,
  projectEvaluationReport,
  runSuite,
} from "../src/index";
import type { SuiteReport, W403CaseResult, W503CaseResult, W601CaseResult } from "../src/index";
import { cloneReport, defaultConfigObject, defaultSuiteReport, scratchPath } from "./helpers";

const LOADED = loadSuiteConfig();

describe("runner: the default suite (real evaluators, checked-in fixtures)", () => {
  const report = defaultSuiteReport();

  test("the aggregate is PASS, 3/3, conjunctive", () => {
    expect(report.aggregate.verdict).toBe("PASS");
    expect(report.aggregate.caseCount).toBe(3);
    expect(report.aggregate.passCount).toBe(3);
    expect(report.aggregate.failCount).toBe(0);
    expect(report.aggregate.failureReasons).toEqual([]);
  });

  test("the cases run in the declared order with their verdicts", () => {
    expect(report.cases.map((c) => c.caseName)).toEqual([
      "w403-replay-comparability",
      "w503-temporal-consistency",
      "w601-scene-conformance",
    ]);
    for (const caseResult of report.cases) {
      expect(caseResult.verdict).toBe("PASS");
      expect(caseResult.failureReasons).toEqual([]);
      expect(caseResult.error).toBeUndefined();
    }
  });

  test("the report carries the suite config hash and the config verbatim", () => {
    expect(report.suite.suiteConfigSha256).toBe(LOADED.sha256);
    expect(report.suite.config).toEqual(LOADED.config);
    expect(report.suite.suiteId).toBe(LOADED.config.suiteId);
  });

  test("case fixture/policy are echoed verbatim from the config (relative paths)", () => {
    for (const [index, caseResult] of report.cases.entries()) {
      const caseConfig = LOADED.config.cases[index]!;
      expect(caseResult.fixture).toEqual(caseConfig.fixture);
      expect(caseResult.policy).toEqual(caseConfig.policy);
      // Declared fixture paths stay RELATIVE in the report (machine-independent bytes).
      const json = JSON.stringify(caseResult.fixture);
      expect(json).not.toContain("/home/");
      expect(json).not.toContain("/tmp/");
    }
  });
});

describe("runner: measured values are VERBATIM from the real evaluators", () => {
  const report = defaultSuiteReport();

  test("W403 measured equals the projection of a direct evaluator run", () => {
    const caseResult = report.cases[0] as W403CaseResult;
    const direct: EvaluationReport = runCrossRunEvaluation({
      runs: caseResult.policy.runs,
      fixturePath: join(LOADED.originDir, caseResult.fixture.fixturePath),
      goldenPath: join(LOADED.originDir, caseResult.fixture.goldenPath ?? ""),
    });
    expect(caseResult.measured).toEqual(projectEvaluationReport(direct));
    expect(caseResult.measured?.runsCompleted).toBe(2);
    expect(caseResult.measured?.golden?.byteIdentical).toBe(true);
    expect(caseResult.measured?.pairwise[0]?.byteIdentical).toBe(true);
    expect(caseResult.measured?.failureReasons).toEqual([]);
  });

  test("W503 measured.report equals the evaluator's direct output, deep-equal", () => {
    const caseResult = report.cases[1] as W503CaseResult;
    const direct = evaluateRenderOutput(renderW503CleanFixture());
    expect(caseResult.measured?.report).toEqual(direct);
    expect(caseResult.measured?.detectionProof).not.toBeNull();
    expect(caseResult.measured?.detectionProof).toHaveLength(9);
    expect(caseResult.measured?.detectionProof?.every((entry) => entry.detected)).toBe(true);
  });

  test("W601 measured equals the conformance of the real projection, deep-equal", () => {
    const caseResult = report.cases[2] as W601CaseResult;
    const fixture = loadW601SceneFixture(join(LOADED.originDir, caseResult.fixture.sceneFixturePath));
    const scene = projectScene(fixture.snapshot, {
      events: fixture.events,
      cameraSlotIds: fixture.cameraSlotIds,
    });
    const direct = runSceneConformance(scene, {
      snapshot: fixture.snapshot,
      events: fixture.events,
      cameraSlotIds: fixture.cameraSlotIds,
    });
    expect(caseResult.measured).toEqual(direct);
    expect(caseResult.measured?.passed).toBe(true);
  });

  test("thresholds are the evaluators' own exported constants", () => {
    const w403 = report.cases[0] as W403CaseResult;
    expect(w403.thresholds?.defaultEpsilon).toBe(DEFAULT_EPSILON);
    const w503 = report.cases[1] as W503CaseResult;
    expect(w503.thresholds).toEqual(THRESHOLDS);
    const w601 = report.cases[2] as W601CaseResult;
    expect(w601.thresholds?.checkIds).toEqual(
      (report.cases[2] as W601CaseResult).measured?.checks.map((check) => check.checkId),
    );
  });
});

describe("runner: crash containment (a crashing case never kills the suite)", () => {
  test("a malformed W601 fixture → SceneProjectionError case result, suite continues", () => {
    const configPath = writeCrashingSuite("crash-w601", "malformed-scene-fixture.json");
    const report = runSuite(loadSuiteConfig(configPath));

    expect(report.aggregate.verdict).toBe("FAIL");
    expect(report.aggregate.failCount).toBe(1);
    const crashed = report.cases[2] as W601CaseResult;
    expect(crashed.verdict).toBe("FAIL");
    expect(crashed.error).toBeDefined();
    expect(crashed.error?.errorClass).toBe("SceneProjectionError");
    expect(crashed.error?.message).toContain("WorldSnapshot");
    expect(crashed.measured).toBeUndefined();
    expect(crashed.thresholds).toBeUndefined();
    // The suite CONTINUED: the other two cases still ran and passed.
    expect(report.cases[0]?.verdict).toBe("PASS");
    expect(report.cases[1]?.verdict).toBe("PASS");
    // The aggregate reports the crash, attributed — never swallowed.
    expect(report.aggregate.failureReasons.some((r) => r.startsWith("w601-scene-conformance: "))).toBe(
      true,
    );
    expect(
      report.aggregate.failureReasons.some((r) => r.includes("case crashed: SceneProjectionError")),
    ).toBe(true);
  });

  test("a missing W601 fixture is a structural FAIL, never a skip", () => {
    const configPath = writeCrashingSuite("missing-w601", "does-not-exist.json");
    const report = runSuite(loadSuiteConfig(configPath));
    const failed = report.cases[2] as W601CaseResult;
    expect(failed.verdict).toBe("FAIL");
    expect(failed.error?.errorClass).toBe("RangeError");
    expect(failed.error?.message).toContain("cannot read the scene fixture");
    expect(report.aggregate.verdict).toBe("FAIL");
    expect(JSON.stringify(report)).not.toContain("skip");
  });

  test("a W601 fixture with an unknown camera slot fails the case (loader gate)", () => {
    const configPath = writeCrashingSuite("bad-slot-w601", "bad-slot-scene-fixture.json");
    const report = runSuite(loadSuiteConfig(configPath));
    const failed = report.cases[2] as W601CaseResult;
    expect(failed.verdict).toBe("FAIL");
    expect(failed.error?.errorClass).toBe("RangeError");
    expect(failed.error?.message).toContain("unknown camera slot");
  });
});

describe("runner: a failing evaluator verdict flips the conjunctive aggregate", () => {
  test("a TAMPERED W403 golden → the W403 case fails, aggregate fails, loudly", () => {
    // Tamper: the real W403 golden with one EPSILON field moved beyond epsilon
    // (the W403 e2e tamper probe). The evaluator's golden comparison fails.
    const realGolden = join(LOADED.originDir, "../../evaluation/fixtures/golden/w403-golden.json");
    const golden = JSON.parse(readFileSync(realGolden, "utf8")) as Record<string, unknown>;
    const stateAt = golden.stateAt as Record<string, unknown>;
    const snapshot = stateAt["11800"] as { entities: unknown[] };
    const ball = snapshot.entities.find(
      (e) => (e as { entityId?: string }).entityId === "b1",
    ) as { state: { position: { value: { x: number } } } };
    ball.state.position.value.x += 1e-6;
    const tamperedPath = scratchPath("tampered-w403-golden.json");
    writeFileSync(tamperedPath, JSON.stringify(golden, null, 2));

    const configPath = scratchPath("tampered-golden-suite.json");
    writeScratchSuite(configPath, {
      w403: { goldenPath: tamperedPath },
    });

    const report = runSuite(loadSuiteConfig(configPath));
    expect(report.aggregate.verdict).toBe("FAIL");
    const w403 = report.cases[0] as W403CaseResult;
    expect(w403.verdict).toBe("FAIL");
    expect(w403.error).toBeUndefined(); // an evaluation failure, not a crash
    expect(w403.measured?.golden?.report.passed).toBe(false);
    expect(w403.measured?.failureReasons?.some((r) => r.includes("golden"))).toBe(true);
    // The other cases still passed — the aggregate is conjunctive over them.
    expect(report.cases[1]?.verdict).toBe("PASS");
    expect(report.cases[2]?.verdict).toBe("PASS");
    expect(report.aggregate.failureReasons.some((r) => r.startsWith("w403-replay-comparability: "))).toBe(
      true,
    );
  });
});

describe("runner: the clock is injected (never ambient)", () => {
  test("a custom step clock produces custom, positioned clock reads", () => {
    const clock = createStepClock({ epochMs: 42, stepMs: 1 });
    const report = runSuite(LOADED, { clock });
    expect(report.clock.startMs).toBe(42);
    expect(report.clock.endMs).toBe(49);
    expect(report.cases.map((c) => [c.clock.startMs, c.clock.endMs])).toEqual([
      [43, 44],
      [45, 46],
      [47, 48],
    ]);
  });

  test("a recording clock proves every read comes from the injected seam", () => {
    const reads: number[] = [];
    const report = runSuite(LOADED, {
      clock: {
        now: () => {
          reads.push(reads.length);
          return 1_000 + reads.length;
        },
      },
    });
    // 1 suite read + 2 per case + 1 final suite read = 8 reads, all from the seam.
    expect(reads).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(report.clock).toEqual({ startMs: 1_001, endMs: 1_008 });
    expect(report.cases[0]?.clock).toEqual({ startMs: 1_002, endMs: 1_003 });
  });

  test("the default clock starts at TEST_EPOCH_MS (the repo constant)", () => {
    const report = defaultSuiteReport();
    expect(report.clock.startMs).toBe(1_736_164_800_000);
  });
});

describe("runner: determinism of a fresh run (deep-equal, byte-identical)", () => {
  test("two fresh runs with default clocks are deep-equal", () => {
    const first = runSuite(loadSuiteConfig());
    const second = runSuite(loadSuiteConfig());
    expect(first).toEqual(second);
  });
});

/** Writes a suite config whose W601 case points at a scratch fixture path. */
function writeCrashingSuite(name: string, sceneFixtureFileName: string): string {
  const fixturePath = scratchPath(sceneFixtureFileName);
  if (sceneFixtureFileName === "malformed-scene-fixture.json") {
    writeMalformedSceneFixture(fixturePath);
  } else if (sceneFixtureFileName === "bad-slot-scene-fixture.json") {
    writeBadSlotSceneFixture(fixturePath);
  } // "does-not-exist.json" is intentionally NOT written.
  const configPath = scratchPath(`${name}-suite.json`);
  writeScratchSuite(configPath, { w601: { sceneFixturePath: fixturePath } });
  return configPath;
}

/**
 * Writes a scratch suite config: the default suite with the given case-level
 * path overrides (absolute paths — scratch configs live in the OS temp dir,
 * so the default RELATIVE paths would resolve against the wrong origin).
 */
function writeScratchSuite(
  configPath: string,
  overrides: {
    w403?: { fixturePath?: string; goldenPath?: string | null };
    w601?: { sceneFixturePath?: string };
  },
): void {
  const config = defaultConfigObject();
  const cases = config.cases as Array<Record<string, unknown>>;
  const w403Fixture = cases[0]!.fixture as Record<string, unknown>;
  w403Fixture.fixturePath =
    overrides.w403?.fixturePath ?? join(LOADED.originDir, String(w403Fixture.fixturePath));
  if (overrides.w403?.goldenPath !== undefined) {
    w403Fixture.goldenPath = overrides.w403.goldenPath;
  } else {
    w403Fixture.goldenPath = join(LOADED.originDir, String(w403Fixture.goldenPath));
  }
  const w601Fixture = cases[2]!.fixture as Record<string, unknown>;
  w601Fixture.sceneFixturePath =
    overrides.w601?.sceneFixturePath ?? join(LOADED.originDir, String(w601Fixture.sceneFixturePath));
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/** A structurally-valid envelope with a garbage snapshot (projectScene throws). */
function writeMalformedSceneFixture(path: string): void {
  writeFileSync(
    path,
    JSON.stringify(
      {
        fixtureKind: "sporta/eval-harness/w601-scene-fixture@1",
        sessionId: "sess-scene-golden",
        snapshot: { not: "a world snapshot" },
        events: [],
        cameraSlotIds: [...CAMERA_SLOT_IDS],
      },
      null,
      2,
    ),
  );
}

/** A valid-shaped fixture carrying an unknown camera slot. */
function writeBadSlotSceneFixture(path: string): void {
  const real = loadW601SceneFixture(join(LOADED.originDir, "./w601-scene-fixture.json"));
  writeFileSync(
    path,
    JSON.stringify(
      {
        fixtureKind: "sporta/eval-harness/w601-scene-fixture@1",
        sessionId: real.sessionId,
        snapshot: real.snapshot,
        events: real.events,
        cameraSlotIds: ["main-wide", ...real.cameraSlotIds],
      },
      null,
      2,
    ),
  );
}

/** Guard: the helper module's clone is structurally equal (helpers sanity). */
test("helpers: cloneReport is deep-equal to the source", () => {
  const report: SuiteReport = defaultSuiteReport();
  expect(cloneReport(report)).toEqual(report);
});
