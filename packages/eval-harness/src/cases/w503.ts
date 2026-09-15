/**
 * The W503 case executor: rendered-clip temporal consistency (W801 harness).
 *
 * Runs the REAL W503 evaluator — `renderW503CleanFixture` +
 * `evaluateRenderOutput` from `@sporta/renderer-evaluation` — in-process.
 * The clean fixture is BUILT by driving the real W502 renderer (inside the
 * evaluator package), then measured by the pure metric core; the case's
 * `measured.report` is the evaluator's `TemporalConsistencyReport` VERBATIM
 * (identity flicker, style-byte stability, geometry drift, temporal
 * artifacts, and the full threshold-check list with every measured value).
 *
 * The optional detection proof (policy `detectionProof: true`) replicates
 * the W503 evaluate CLI's proof set: the nine single-defect injections, each
 * re-evaluated — every injection must flip the verdict to FAIL. One going
 * undetected FAILS the case (the metric lost its teeth). The injection list
 * (names + parameters) is the evaluator package's own proof set, replicated
 * here because the CLI's list is script-local; it is documented in README
 * §"W503 detection proof" and pinned by tests.
 */
import {
  evaluateRenderOutput,
  injectAppliedSequenceGap,
  injectDispositionFlap,
  injectDuplicateEventAttribution,
  injectGeometryTeleport,
  injectStyleByteInstability,
  injectStyleInstability,
  injectUnexplainedAbsence,
  injectWatermarkRegression,
  injectWindowOverlap,
  renderW503CleanFixture,
  THRESHOLDS,
} from "@sporta/renderer-evaluation";
import type { TemporalConsistencyReport, Thresholds } from "@sporta/renderer-evaluation";
import type { CaseOutcome } from "./types";
import type { W503CaseConfig } from "../suite-config";

/** One detection-proof result. */
export interface W503DetectionProofEntry {
  /** The injected defect class's label (the W503 CLI's proof-set name). */
  readonly injection: string;
  /** Whether the re-evaluation FAILED (the defect was detected). */
  readonly detected: boolean;
  /** The failing check metrics of the perturbed evaluation, verbatim. */
  readonly failingMetrics: readonly string[];
}

/** The W503 case's measured values. */
export interface W503CaseMeasured {
  /** The evaluator's full temporal-consistency report, VERBATIM. */
  readonly report: TemporalConsistencyReport;
  /**
   * The detection proof results (present iff `policy.detectionProof`; null
   * when disabled — an explicit config value, never a silent default).
   */
  readonly detectionProof: readonly W503DetectionProofEntry[] | null;
}

/** The W503 case's thresholds: the evaluator's THRESHOLDS object, VERBATIM. */
export type W503CaseThresholds = Thresholds;

/** Runs the W503 case: the real temporal-consistency evaluator, in-process. */
export function runW503Case(caseConfig: W503CaseConfig): CaseOutcome<W503CaseMeasured, W503CaseThresholds> {
  const output = renderW503CleanFixture();
  const report = evaluateRenderOutput(output);

  const detectionProof = caseConfig.policy.detectionProof
    ? runDetectionProof(output)
    : null;

  const failureReasons: string[] = [];
  if (!report.verdict.pass) {
    for (const failure of report.verdict.failures) {
      const relation = failure.operator === "max" ? "<=" : ">=";
      failureReasons.push(
        `${failure.metric} = ${failure.measured} (threshold ${relation} ${failure.threshold})`,
      );
    }
  }
  if (detectionProof !== null) {
    for (const entry of detectionProof) {
      if (!entry.detected) {
        failureReasons.push(
          `detection proof: injection "${entry.injection}" went UNDETECTED ` +
            "(a metric lost its defect class)",
        );
      }
    }
  }

  const verdict =
    report.verdict.pass && (detectionProof === null || detectionProof.every((e) => e.detected))
      ? "PASS"
      : "FAIL";

  return {
    verdict,
    measured: { report, detectionProof },
    thresholds: THRESHOLDS,
    failureReasons,
  };
}

/**
 * The W503 detection proof: the evaluator package's own nine-injection proof
 * set (the list `packages/renderer-evaluation/scripts/evaluate.ts` runs),
 * replicated here so the harness case carries the same teeth.
 */
function runDetectionProof(output: ReturnType<typeof renderW503CleanFixture>): W503DetectionProofEntry[] {
  const manifest = output.manifest;
  const entries: W503DetectionProofEntry[] = [];
  const add = (injection: string, perturbedOutput: typeof output): void => {
    const perturbedReport = evaluateRenderOutput(perturbedOutput);
    entries.push({
      injection,
      detected: !perturbedReport.verdict.pass,
      failingMetrics: perturbedReport.verdict.failures.map((failure) => failure.metric),
    });
  };

  add("identity flicker (unexplained entity absence)", {
    ...output,
    manifest: injectUnexplainedAbsence(manifest, { frameIndex: 2, entityId: "player-7" }),
  });
  add("style instability (restyled entity on one frame)", {
    ...output,
    manifest: injectStyleInstability(manifest, { frameIndex: 2, entityId: "player-7" }),
  });
  add("SVG byte-level style instability (manifest token untouched)", injectStyleByteInstability(output, {
    frameIndex: 2,
    entityId: "player-7",
  }));
  add("geometry drift (teleported player)", {
    ...output,
    manifest: injectGeometryTeleport(manifest, {
      frameIndex: 2,
      entityId: "player-7",
      toMeters: { x: 90, y: 34 },
    }),
  });
  add("watermark regression", {
    ...output,
    manifest: injectWatermarkRegression(manifest, { frameIndex: 2 }),
  });
  add("disposition flapping (drawn→omitted→drawn)", {
    ...output,
    manifest: injectDispositionFlap(manifest, { frameIndex: 2, entityId: "player-9" }),
  });
  add("applied-sequence gap (silently dropped event)", {
    ...output,
    manifest: injectAppliedSequenceGap(manifest, { frameIndex: 3, sequence: 13 }),
  });
  add("duplicate event attribution (event shown twice)", {
    ...output,
    manifest: injectDuplicateEventAttribution(manifest, {
      sequence: 11,
      fromFrameIndex: 0,
      toFrameIndex: 2,
    }),
  });
  add("caption window overlap", {
    ...output,
    manifest: injectWindowOverlap(manifest, { frameIndex: 2 }),
  });

  return entries;
}
