/**
 * The composition tests: the fixture-demo release evaluation over the REAL
 * evaluations of the two completed evaluation packages — the clean
 * baseline, the verbatim carrying of the source reports' evidence, the
 * policy-driven verdict derivation (including the advisory MECHANISM,
 * proven with a test-only policy variant), and the wrapper contract's
 * fail-loud validation.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateTemporalConsistency } from "@sporta/renderer-evaluation";
import { evaluateSceneOutput } from "@sporta/scene-evaluation";
import type { SceneEvaluationInput } from "@sporta/scene-evaluation";
import {
  GATE_POLICY,
  QualityGatesError,
  buildDefaultReleaseInputs,
  canonicalJsonStringify,
  deriveOverallVerdict,
  evaluateReleaseReadiness,
} from "../src/index";
import type { GateRow, ReleaseReadinessReport } from "../src/index";

/** The typed gate-row lookup (fail-loud on an unknown id — a test bug). */
function gateRowOf<K extends GateRow["gateId"]>(
  report: ReleaseReadinessReport,
  gateId: K,
): Extract<GateRow, { gateId: K }> {
  const gate = report.gates.find((row) => row.gateId === gateId);
  if (gate === undefined) throw new Error(`no gate row "${gateId}"`);
  // find() matched the literal id; the cast is the union narrowing.
  return gate as Extract<GateRow, { gateId: K }>;
}

/** The checked-in fixture-demo self-check record. */
const RECORD_PATH = join(
  import.meta.dir,
  "..",
  "fixtures",
  "human-review",
  "self-check-record.json",
);
const demoRecord: unknown = JSON.parse(readFileSync(RECORD_PATH, "utf8"));

/** The demo input, built once (the fixture builders render through the real seams). */
const demoInput = buildDefaultReleaseInputs({ humanReview: demoRecord });
const report = evaluateReleaseReadiness(demoInput);

describe("the fixture-demo baseline: every gate passes, the release is PASS", () => {
  test("overall PASS with all four blocking gates passing", () => {
    expect(report.verdict.overall).toBe("PASS");
    expect(report.schemaTag).toBe("sporta/quality-gates/w803@1");
    expect(report.verdict.blockingGateResults).toHaveLength(4);
    expect(report.verdict.blockingGateResults.every((result) => result.outcome === "pass")).toBe(
      true,
    );
  });

  test("the gate rows are the policy's gates, in policy order, all PASS", () => {
    const gateIds: string[] = report.gates.map((gate) => gate.gateId);
    expect(gateIds).toEqual(GATE_POLICY.map((entry) => entry.gateId));
    expect(report.gates.every((gate) => gate.verdict === "PASS")).toBe(true);
  });

  test("each row carries its policy identity and privileges verbatim", () => {
    GATE_POLICY.forEach((entry, index) => {
      const gate = report.gates[index]!;
      expect(gate.name).toBe(entry.name);
      expect(gate.sourcePackage).toBe(entry.sourcePackage);
      expect(gate.blocking).toBe(entry.blocking);
      expect(gate.notRunnableOutcome).toBe(entry.notRunnableOutcome);
    });
  });

  test("the accounting reconciles: 4 gates = 4 pass + 0 fail + 0 not-runnable", () => {
    expect(report.accounting.totalGates).toBe(4);
    expect(report.accounting.pass).toBe(4);
    expect(report.accounting.fail).toBe(0);
    expect(report.accounting.notRunnable).toBe(0);
    expect(report.accounting.reconciles).toBe(true);
    const perGateIds: string[] = report.accounting.perGate.map((row) => row.gateId);
    expect(perGateIds).toEqual(GATE_POLICY.map((entry) => entry.gateId));
  });
});

describe("the temporal gate composes the REAL W503 evaluation, evidence verbatim", () => {
  const row = gateRowOf(report, "temporal-stability");

  test("the row is the temporal-stability gate from @sporta/renderer-evaluation", () => {
    expect(row.gateId).toBe("temporal-stability");
    expect(row.sourcePackage).toBe("@sporta/renderer-evaluation");
  });

  test("the evaluation ran over the real fixture clip (SVG frames on)", () => {
    expect(row.measured.ran).toBe(true);
    if (row.measured.ran !== true) throw new Error("unreachable");
    expect(row.measured.schemaTag).toBe("sporta/renderer-evaluation/w503@1");
    expect(row.measured.input.sessionId).toBe("sess-anime-clip");
    expect(row.measured.input.svgFramesMeasured).toBe(true);
    expect(row.measured.input.frameCount).toBe(6);
  });

  test("the carried checks and failures are VERBATIM the source report's own", () => {
    if (row.measured.ran !== true) throw new Error("unreachable");
    const direct = evaluateTemporalConsistency(demoInput.temporal!.input);
    expect(row.measured.checks).toEqual(direct.verdict.checks);
    expect(row.measured.failures).toEqual(direct.verdict.failures);
    expect(row.measured.input).toEqual(direct.input);
    expect(direct.verdict.pass).toBe(true);
    expect(row.measured.checks).toHaveLength(21); // 20 + conditional styleBytes
    expect(row.measured.checks.every((check) => check.pass)).toBe(true);
  });

  test("the carried checks embed the REFERENCED thresholds (not redefinitions)", () => {
    if (row.measured.ran !== true) throw new Error("unreachable");
    const thresholds = new Set(row.measured.checks.map((check) => check.threshold));
    expect(thresholds.size).toBeGreaterThan(1); // real pinned values, not a copied constant
  });
});

describe("the scene gate composes the REAL W605 evaluation, evidence verbatim", () => {
  const row = gateRowOf(report, "scene-correctness");

  test("the row is the scene-correctness gate from @sporta/scene-evaluation", () => {
    expect(row.gateId).toBe("scene-correctness");
    expect(row.sourcePackage).toBe("@sporta/scene-evaluation");
  });

  test("the three real fixtures evaluated, each with its own PASS verdict", () => {
    expect(row.measured.ran).toBe(true);
    if (row.measured.ran !== true) throw new Error("unreachable");
    expect(row.measured.fixtures.map((fixture) => fixture.name)).toEqual([
      "clean-match",
      "corrections-match",
      "directed-review",
    ]);
    expect(row.measured.fixtures.every((fixture) => fixture.pass)).toBe(true);
    for (const fixture of row.measured.fixtures) {
      expect(fixture.schemaTag).toBe("sporta/scene-evaluation/w605@1");
      expect(fixture.failures).toEqual([]);
      expect(fixture.findings.dropped).toBe(0);
      expect(fixture.findings.truncated).toBe(false);
    }
  });

  test("the carried per-fixture evidence is VERBATIM the source report's own", () => {
    if (row.measured.ran !== true) throw new Error("unreachable");
    const carried = row.measured.fixtures[1]!; // corrections-match
    const direct = evaluateSceneOutput(demoInput.scene![1]!.input);
    expect(carried.checks).toEqual(direct.verdict.checks);
    expect(carried.failures).toEqual(direct.verdict.failures);
    expect(carried.input).toEqual(direct.input);
    expect(carried.findings).toEqual({
      recorded: direct.findings.entries.length,
      dropped: direct.findings.dropped,
      cap: direct.findings.cap,
      truncated: direct.findings.truncated,
    });
    expect(direct.verdict.pass).toBe(true);
  });
});

describe("the human gate: the checked-in pipeline self-check record, honestly carried", () => {
  const row = gateRowOf(report, "human-quality-checks");
  const section = report.humanReview;

  test("the record is complete and every checklist item passes", () => {
    expect(row.gateId).toBe("human-quality-checks");
    expect(row.verdict).toBe("PASS");
    expect(section.status).toBe("complete");
    expect(section.checklistVersion).toBe("w803-review-checklist-v1");
    expect(section.issues).toEqual([]);
    expect(section.failedItemIds).toEqual([]);
  });

  test("the record is honestly marked as the automated pipeline self-check", () => {
    expect(section.record?.recordKind).toBe("pipeline-self-check");
    expect(section.record?.reviewer).toBe("w803-automated-pipeline");
    expect(section.humanAttested).toBe(false);
    expect(row.reason).toContain("recordKind: pipeline-self-check");
    expect(row.reason).toContain("humanAttested: false");
  });

  test("the per-item results are joined with the checklist requirements", () => {
    expect(section.items).toHaveLength(7);
    expect(section.items?.map((item) => item.checklistItemId)).toEqual([
      "clips.w503-anime-fixture",
      "clips.w603-match-fixture",
      "clips.w604-directed-fixture",
      "reports.temporal-gate",
      "reports.scene-gate",
      "reports.release-accounting",
      "scope.fixture-demo-confirmed",
    ]);
    expect(section.items?.every((item) => item.result === "pass")).toBe(true);
    expect(section.items?.every((item) => item.requirement.length > 0)).toBe(true);
  });

  test("the record's factual claims are pinned to the real fixtures' numbers (no silent rot)", () => {
    const temporal = gateRowOf(report, "temporal-stability");
    const scene = gateRowOf(report, "scene-correctness");
    if (temporal.measured.ran !== true || scene.measured.ran !== true) {
      throw new Error("unreachable");
    }
    const temporalFrames = temporal.measured.input.frameCount;
    const temporalChecks = temporal.measured.checks.length;
    const [clean, corrections, directed] = scene.measured.fixtures;
    const scope = section.record?.scope ?? "";
    // The scope's frame/window/marker counts are the real reports' counts.
    expect(scope).toContain(`${temporalFrames} frames at`);
    expect(scope).toContain(`${clean!.input.frameCount} frames`);
    expect(scope).toContain(
      `${corrections!.input.frameCount} frames, ${corrections!.input.markerCount} markers`,
    );
    expect(scope).toContain(
      `${directed!.input.frameCount} frames, ${directed!.input.windowCount} windows`,
    );
    // The item notes' counts likewise.
    expect(section.items?.[0]?.notes).toContain(`All ${temporalFrames} SVG frames`);
    expect(section.items?.[3]?.notes).toContain(`${temporalChecks} checks`);
    expect(section.items?.[4]?.notes).toContain(
      `0 failing checks out of ${clean!.checks.length} per fixture`,
    );
  });
});

describe("the verdict derivation reads the POLICY, not gate-id ifs", () => {
  test("blocking is consulted from the policy data (advisory mechanism proven with a test-only variant)", () => {
    // A failing scene gate under the CANONICAL policy fails the release...
    const scene = [...demoInput.scene!];
    scene[1] = { ...scene[1]!, input: { malformed: true } as unknown as SceneEvaluationInput };
    const failingReport = evaluateReleaseReadiness({ ...demoInput, scene });
    expect(failingReport.verdict.overall).toBe("FAIL");

    // ...and under a TEST-ONLY policy that demotes scene-correctness to
    // advisory, the SAME rows no longer block (the advisory outcome is
    // recorded in the reason instead). The canonical evaluation never
    // accepts a caller policy — this is the mechanism proof.
    const advisoryPolicy = GATE_POLICY.map((entry) =>
      entry.gateId === "scene-correctness" ? { ...entry, blocking: false } : entry,
    );
    const advisoryVerdict = deriveOverallVerdict(failingReport.gates, advisoryPolicy);
    expect(advisoryVerdict.overall).toBe("PASS");
    expect(advisoryVerdict.reason).toContain("advisory gate(s) recorded non-pass verdicts");
    expect(advisoryVerdict.blockingGateResults.map((result) => result.gateId)).not.toContain(
      "scene-correctness",
    );
    // The canonical policy, same rows: FAIL (blocking-ness is data, and v1 data blocks).
    const canonicalVerdict = deriveOverallVerdict(failingReport.gates, GATE_POLICY);
    expect(canonicalVerdict.overall).toBe("FAIL");
  });
});

describe("the wrapper contract is fail-loud (this package's own input shape)", () => {
  test("an unknown top-level key throws with its JSON path", () => {
    expect(() =>
      evaluateReleaseReadiness({ ...demoInput, nonsense: true } as unknown as Parameters<
        typeof evaluateReleaseReadiness
      >[0]),
    ).toThrow(QualityGatesError);
    try {
      evaluateReleaseReadiness({ nonsense: true } as unknown as Parameters<
        typeof evaluateReleaseReadiness
      >[0]);
      throw new Error("unreachable");
    } catch (error) {
      expect(error).toBeInstanceOf(QualityGatesError);
      const typed = error as QualityGatesError;
      expect(typed.code).toBe("input-malformed");
      expect(typed.path).toBe("$.nonsense");
    }
  });

  test("a present-but-empty temporal seam throws (absent is accounted, wrong is rejected)", () => {
    expect(() =>
      // {} is not a TemporalGateInput (input missing) — the caller bug class.
      evaluateReleaseReadiness({ temporal: {} as never, humanReview: demoRecord }),
    ).toThrow(/\.temporal\.input/);
  });

  test("a scene seam entry with an unbounded name throws with the structural bound", () => {
    expect(() =>
      evaluateReleaseReadiness({
        scene: [
          {
            name: "x".repeat(201),
            input: { malformed: true } as unknown as SceneEvaluationInput,
          },
        ],
        humanReview: demoRecord,
      }),
    ).toThrow(/MAX_FIXTURE_CASE_NAME_LENGTH/);
  });
});

describe("purity: the same input re-evaluates deep-equal", () => {
  test("a second evaluation of the demo input is deep-equal and canonically identical", () => {
    const second = evaluateReleaseReadiness(demoInput);
    expect(second).toEqual(report);
    expect(canonicalJsonStringify(second)).toBe(canonicalJsonStringify(report));
  });
});
