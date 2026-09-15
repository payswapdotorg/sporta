/**
 * The W803 detection proof (the W503/W605 `test/detection.test.ts`
 * convention): the gate suite must BITE. Every requirement of the work
 * item's teeth list is proven here against the REAL injector seams of the
 * source evaluation packages — this package injects nothing of its own:
 *
 * - a temporal defect injected through the real W503 injector seam →
 *   overall FAIL (two defect classes);
 * - a scene defect injected the way the scene-evaluation package's own
 *   tests inject (its real injectors) → overall FAIL (two defect classes);
 * - the human record removed → PENDING-HUMAN-REVIEW (never PASS, never a
 *   skip);
 * - the human record malformed / incomplete → PENDING-HUMAN-REVIEW with
 *   the issues accounted;
 * - a completed record with a failed item → FAIL (an honest failed
 *   review);
 * - a gate made not-runnable (malformed fixture input, absent seam, a
 *   fixture that errors among healthy ones) → counted FAIL with the
 *   reason, never skipped — and the healthy partial evidence still
 *   carried;
 * - accounting totality: the counts reconcile in every scenario.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCorrectionsMatchFixture,
  injectSceneStateDrift,
  injectWrongScoreClaim,
} from "@sporta/scene-evaluation";
import type { SceneEvaluationInput } from "@sporta/scene-evaluation";
import {
  injectGeometryTeleport,
  injectWindowOverlap,
  renderW503CleanFixture,
} from "@sporta/renderer-evaluation";
import { buildDefaultReleaseInputs, evaluateReleaseReadiness } from "../src/index";
import type { GateRow, ReleaseGateInput, ReleaseReadinessReport } from "../src/index";

/** The checked-in fixture-demo self-check record. */
const RECORD_PATH = join(
  import.meta.dir,
  "..",
  "fixtures",
  "human-review",
  "self-check-record.json",
);
const demoRecord: unknown = JSON.parse(readFileSync(RECORD_PATH, "utf8"));

/** The manifest type of the real W503 fixture clip (no extra imports needed). */
type TemporalManifest = ReturnType<typeof renderW503CleanFixture>["manifest"];

/** The demo input, built once (pure builders; nothing downstream mutates it). */
const demoInput = buildDefaultReleaseInputs({ humanReview: demoRecord });

/** The clean temporal output (the injector seam's input, fresh per case). */
function cleanTemporal() {
  return renderW503CleanFixture();
}

/** The demo input with the temporal seam replaced by a perturbed manifest. */
function withTemporalManifest(manifest: TemporalManifest): ReleaseGateInput {
  const output = cleanTemporal();
  return {
    ...demoInput,
    temporal: { input: { manifest, frames: output.frames } },
  };
}

/** The demo input with one scene fixture case's input replaced. */
function withSceneFixture(index: number, input: SceneEvaluationInput): ReleaseGateInput {
  const scene = [...demoInput.scene!];
  scene[index] = { ...scene[index]!, input };
  return { ...demoInput, scene };
}

/** The demo input with the human record replaced. */
function withHumanRecord(record: unknown): ReleaseGateInput {
  return { ...demoInput, humanReview: record };
}

/** The typed gate-row lookup (fail-loud on an unknown id — a test bug). */
function gateOf<K extends GateRow["gateId"]>(
  report: ReleaseReadinessReport,
  gateId: K,
): Extract<GateRow, { gateId: K }> {
  const gate = report.gates.find((row) => row.gateId === gateId);
  if (gate === undefined) throw new Error(`no gate row "${gateId}"`);
  // find() matched the literal id; the cast is the union narrowing.
  return gate as Extract<GateRow, { gateId: K }>;
}

describe("the gate bites — temporal defects through the real W503 injector seam", () => {
  test("a player teleported 60+ meters in one frame: overall FAIL, geometry checks carried verbatim", () => {
    const clean = cleanTemporal();
    const perturbed = injectGeometryTeleport(clean.manifest, {
      frameIndex: 2,
      entityId: "player-7",
      toMeters: { x: 90, y: 34 },
    });
    const report = evaluateReleaseReadiness(withTemporalManifest(perturbed));
    expect(report.verdict.overall).toBe("FAIL");
    const temporal = gateOf(report, "temporal-stability");
    expect(temporal.verdict).toBe("FAIL");
    if (temporal.measured.ran !== true) throw new Error("unreachable");
    const failing = temporal.measured.failures.map((failure) => failure.metric);
    expect(failing).toContain("geometry.jumpCount");
    expect(failing).toContain("geometry.maxJumpRatio");
    // The measured evidence is the real evaluation's own value, carried verbatim.
    expect(
      temporal.measured.checks.find((check) => check.metric === "geometry.jumpCount")?.measured,
    ).toBe(2);
    // The other gates still pass; the accounting counts exactly one FAIL.
    expect(gateOf(report, "scene-correctness").verdict).toBe("PASS");
    expect(gateOf(report, "human-quality-checks").verdict).toBe("PASS");
    expect(report.accounting).toMatchObject({ totalGates: 4, pass: 3, fail: 1, notRunnable: 0 });
    expect(report.accounting.reconciles).toBe(true);
  });

  test("an overlapping caption window: overall FAIL, the artifact check carried verbatim", () => {
    const clean = cleanTemporal();
    const perturbed = injectWindowOverlap(clean.manifest, { frameIndex: 2 });
    const report = evaluateReleaseReadiness(withTemporalManifest(perturbed));
    expect(report.verdict.overall).toBe("FAIL");
    const temporal = gateOf(report, "temporal-stability");
    expect(temporal.verdict).toBe("FAIL");
    if (temporal.measured.ran !== true) throw new Error("unreachable");
    expect(temporal.measured.failures.map((failure) => failure.metric)).toContain(
      "artifacts.windowOverlapCount",
    );
    expect(
      temporal.measured.checks.find((check) => check.metric === "artifacts.windowOverlapCount")
        ?.measured,
    ).toBe(1);
  });
});

describe("the gate bites — scene defects the way the scene package's own tests inject them", () => {
  test("a wrong score claim on one frame: overall FAIL, score+clock checks carried verbatim", () => {
    const corrections = buildCorrectionsMatchFixture();
    const perturbed = injectWrongScoreClaim(corrections, { frameIndex: 35 });
    const report = evaluateReleaseReadiness(withSceneFixture(1, perturbed));
    expect(report.verdict.overall).toBe("FAIL");
    const scene = gateOf(report, "scene-correctness");
    expect(scene.verdict).toBe("FAIL");
    if (scene.measured.ran !== true) throw new Error("unreachable");
    const failingFixture = scene.measured.fixtures[1]!;
    expect(failingFixture.name).toBe("corrections-match");
    expect(failingFixture.pass).toBe(false);
    const failing = failingFixture.failures.map((failure) => failure.metric);
    expect(failing).toContain("score.frameClaimMismatchCount");
    expect(failing).toContain("clock.frameClaimMismatchCount");
    expect(
      failingFixture.checks.find((check) => check.metric === "score.frameClaimMismatchCount")
        ?.measured,
    ).toBe(1);
    // The healthy fixtures are still carried with their own PASS verdicts.
    expect(scene.measured.fixtures[0]!.pass).toBe(true);
    expect(scene.measured.fixtures[2]!.pass).toBe(true);
    expect(gateOf(report, "temporal-stability").verdict).toBe("PASS");
  });

  test("a scene-state drift (an invented position): overall FAIL, the position check carried verbatim", () => {
    const corrections = buildCorrectionsMatchFixture();
    const perturbed = injectSceneStateDrift(corrections, {
      frameIndex: 20,
      entityId: "striker-9",
      dxMeters: 3,
    });
    const report = evaluateReleaseReadiness(withSceneFixture(1, perturbed));
    expect(report.verdict.overall).toBe("FAIL");
    const scene = gateOf(report, "scene-correctness");
    expect(scene.verdict).toBe("FAIL");
    if (scene.measured.ran !== true) throw new Error("unreachable");
    expect(scene.measured.fixtures[1]!.failures.map((failure) => failure.metric)).toContain(
      "sceneState.positionMismatchCount",
    );
  });
});

describe("the gate bites — the human record is fail-closed", () => {
  test("the record removed: PENDING-HUMAN-REVIEW, never PASS, never a skip", () => {
    const report = evaluateReleaseReadiness(withHumanRecord(undefined));
    expect(report.verdict.overall).toBe("PENDING-HUMAN-REVIEW");
    const human = gateOf(report, "human-quality-checks");
    expect(human.verdict).toBe("NOT-RUNNABLE");
    expect(human.reason).toContain("no human review record supplied");
    expect(report.humanReview.status).toBe("missing");
    // Every machine gate passed; the accounting counts the one not-runnable.
    expect(gateOf(report, "temporal-stability").verdict).toBe("PASS");
    expect(gateOf(report, "scene-correctness").verdict).toBe("PASS");
    expect(report.accounting).toMatchObject({ totalGates: 4, pass: 3, fail: 0, notRunnable: 1 });
    expect(report.accounting.reconciles).toBe(true);
  });

  test("a malformed record (empty reviewer): PENDING with the typed issue accounted", () => {
    const report = evaluateReleaseReadiness(
      withHumanRecord({ ...(demoRecord as object), reviewer: "" }),
    );
    expect(report.verdict.overall).toBe("PENDING-HUMAN-REVIEW");
    expect(gateOf(report, "human-quality-checks").verdict).toBe("NOT-RUNNABLE");
    expect(report.humanReview.status).toBe("malformed");
    expect(report.humanReview.issues.some((issue) => issue.path === "$.reviewer")).toBe(true);
  });

  test("a garbage record (a string): PENDING, malformed at the root path", () => {
    const report = evaluateReleaseReadiness(withHumanRecord("looks fine"));
    expect(report.verdict.overall).toBe("PENDING-HUMAN-REVIEW");
    expect(report.humanReview.status).toBe("malformed");
    expect(report.humanReview.issues[0]?.path).toBe("$");
  });

  test("an incomplete record (one checklist item dropped): PENDING with the missing id accounted", () => {
    const record = demoRecord as { items: unknown[] };
    const incomplete = {
      ...(demoRecord as object),
      items: record.items.filter(
        (item) => (item as { checklistItemId: string }).checklistItemId !== "reports.scene-gate",
      ),
    };
    const report = evaluateReleaseReadiness(withHumanRecord(incomplete));
    expect(report.verdict.overall).toBe("PENDING-HUMAN-REVIEW");
    expect(report.humanReview.status).toBe("incomplete");
    expect(report.humanReview.missingItemIds).toEqual(["reports.scene-gate"]);
  });

  test("a completed record with a failed item: overall FAIL (an honest failed review)", () => {
    const record = demoRecord as { items: Array<{ checklistItemId: string; result: string }> };
    const failed = {
      ...(demoRecord as object),
      items: record.items.map((item) =>
        item.checklistItemId === "clips.w603-match-fixture" ? { ...item, result: "fail" } : item,
      ),
    };
    const report = evaluateReleaseReadiness(withHumanRecord(failed));
    expect(report.verdict.overall).toBe("FAIL");
    const human = gateOf(report, "human-quality-checks");
    expect(human.verdict).toBe("FAIL");
    expect(report.humanReview.status).toBe("complete");
    expect(report.humanReview.failedItemIds).toEqual(["clips.w603-match-fixture"]);
    expect(report.accounting).toMatchObject({ totalGates: 4, pass: 3, fail: 1, notRunnable: 0 });
  });
});

describe("the gate bites — a gate that cannot run is counted FAIL, never skipped", () => {
  test("a malformed temporal manifest: NOT-RUNNABLE with the source package's typed error carried", () => {
    // The malformed shape the W503 package's own validation tests use: an
    // unknown disposition value — structurally rejected with a typed error.
    const clean = cleanTemporal();
    const invalid = structuredClone(clean.manifest);
    (invalid.frames[0]!.entities[0] as { disposition: string }).disposition = "sort-of-drawn";
    const report = evaluateReleaseReadiness(withTemporalManifest(invalid));
    expect(report.verdict.overall).toBe("FAIL");
    const temporal = gateOf(report, "temporal-stability");
    expect(temporal.verdict).toBe("NOT-RUNNABLE");
    if (temporal.measured.ran !== false) throw new Error("unreachable");
    expect(temporal.measured.supplied).toBe(true);
    expect(temporal.measured.error.name).toBe("TemporalEvaluationError");
    expect(temporal.measured.error.code).toBe("manifest-malformed");
    expect(temporal.measured.error.path).toBe("$.frames[0].entities[0].disposition");
    expect(temporal.reason).toContain("counted FAIL, never skipped");
    expect(report.accounting).toMatchObject({ totalGates: 4, pass: 3, fail: 0, notRunnable: 1 });
    expect(report.accounting.reconciles).toBe(true);
  });

  test("a garbage manifest (any thrown package error): accounted NOT-RUNNABLE, never a crash", () => {
    const report = evaluateReleaseReadiness(
      withTemporalManifest({ nonsense: true } as unknown as TemporalManifest),
    );
    expect(report.verdict.overall).toBe("FAIL");
    const temporal = gateOf(report, "temporal-stability");
    expect(temporal.verdict).toBe("NOT-RUNNABLE");
    if (temporal.measured.ran !== false) throw new Error("unreachable");
    expect(temporal.measured.error.name).toBe("TypeError");
    expect(temporal.measured.error.message.length).toBeGreaterThan(0);
    expect(temporal.measured.supplied).toBe(true);
  });

  test("the temporal seam absent entirely: NOT-RUNNABLE for missing input, overall FAIL", () => {
    const base = buildDefaultReleaseInputs({ humanReview: demoRecord });
    const report = evaluateReleaseReadiness({ scene: base.scene, humanReview: demoRecord });
    expect(report.verdict.overall).toBe("FAIL");
    const temporal = gateOf(report, "temporal-stability");
    expect(temporal.verdict).toBe("NOT-RUNNABLE");
    if (temporal.measured.ran !== false) throw new Error("unreachable");
    expect(temporal.measured.supplied).toBe(false);
    expect(temporal.measured.error.code).toBe("gate-input-missing");
  });

  test("one malformed scene fixture among healthy ones: NOT-RUNNABLE, partial evidence still carried", () => {
    const report = evaluateReleaseReadiness(
      withSceneFixture(2, { nonsense: true } as unknown as SceneEvaluationInput),
    );
    expect(report.verdict.overall).toBe("FAIL");
    const scene = gateOf(report, "scene-correctness");
    expect(scene.verdict).toBe("NOT-RUNNABLE");
    if (scene.measured.ran !== false) throw new Error("unreachable");
    expect(scene.measured.suppliedFixtureCount).toBe(3);
    expect(scene.measured.evaluated).toHaveLength(2); // the healthy prefix, never dropped
    expect(scene.measured.evaluated.every((fixture) => fixture.pass)).toBe(true);
    expect(scene.measured.errors).toHaveLength(1);
    expect(scene.measured.errors[0]!.index).toBe(2);
    expect(scene.measured.errors[0]!.name).toBe("directed-review");
    expect(scene.measured.errors[0]!.error.name).toBe("SceneEvaluationError");
    expect(scene.reason).toContain('fixture[2] "directed-review"');
  });

  test("the scene seam absent: NOT-RUNNABLE, overall FAIL", () => {
    const base = buildDefaultReleaseInputs({ humanReview: demoRecord });
    const report = evaluateReleaseReadiness({ temporal: base.temporal, humanReview: demoRecord });
    expect(report.verdict.overall).toBe("FAIL");
    const scene = gateOf(report, "scene-correctness");
    expect(scene.verdict).toBe("NOT-RUNNABLE");
    expect(scene.reason).toContain("no scene fixture case supplied");
  });

  test("a machine not-runnable dominates a pending human record (FAIL, not PENDING)", () => {
    const report = evaluateReleaseReadiness({
      temporal: {
        input: { manifest: { nonsense: true } as unknown as TemporalManifest },
      },
      humanReview: undefined,
    });
    expect(report.verdict.overall).toBe("FAIL");
    expect(report.verdict.reason).toContain("temporal-stability (NOT-RUNNABLE)");
  });
});

describe("accounting totality — the counts reconcile in every scenario", () => {
  const scenarios: Array<[string, ReleaseGateInput]> = [
    ["clean demo", buildDefaultReleaseInputs({ humanReview: demoRecord })],
    [
      "temporal defect",
      withTemporalManifest(
        injectGeometryTeleport(cleanTemporal().manifest, {
          frameIndex: 2,
          entityId: "player-7",
          toMeters: { x: 90, y: 34 },
        }),
      ),
    ],
    ["human record removed", withHumanRecord(undefined)],
    [
      "malformed temporal input",
      withTemporalManifest({ nonsense: true } as unknown as TemporalManifest),
    ],
    ["no seams at all", {}],
  ];

  test("gates = pass + fail + not-runnable, always, and every gate has its row", () => {
    for (const [name, input] of scenarios) {
      const report = evaluateReleaseReadiness(input);
      expect(report.gates, name).toHaveLength(4);
      expect(report.accounting.totalGates, name).toBe(4);
      expect(report.accounting.totalGates, name).toBe(
        report.accounting.pass + report.accounting.fail + report.accounting.notRunnable,
      );
      expect(report.accounting.reconciles, name).toBe(true);
      expect(report.accounting.perGate, name).toHaveLength(4);
      for (const gate of report.gates) {
        if (gate.verdict !== "PASS") {
          expect(gate.reason.length, name).toBeGreaterThan(0);
        }
      }
    }
  });

  test("the empty input fails closed: machine gates not-runnable, human missing, overall FAIL", () => {
    const report = evaluateReleaseReadiness({});
    expect(report.verdict.overall).toBe("FAIL");
    // 3 not-runnable (temporal, scene, human) + the accounting gate itself,
    // which correctly passes: the ledger is fine, the inputs are not.
    expect(report.accounting).toMatchObject({ totalGates: 4, pass: 1, fail: 0, notRunnable: 3 });
    expect(gateOf(report, "gate-accounting").verdict).toBe("PASS");
  });
});
