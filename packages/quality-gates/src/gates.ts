/**
 * The gate runners (the core of W803): each gate runs the REAL evaluation
 * of its owning package and returns a machine verdict. This package
 * re-implements NOTHING — it composes, accounts, and applies policy.
 *
 * The machine gates:
 * - **temporal-stability** — `@sporta/renderer-evaluation`'s real
 *   `evaluateRenderOutput` over its real clean fixture; the gate verdict
 *   is that report's own verdict (thresholds REFERENCED from that
 *   package's pinned THRESHOLDS — zero new numbers here);
 * - **scene-correctness** — `@sporta/scene-evaluation`'s real
 *   `evaluateSceneOutput` over its real match AND directed fixtures (both
 *   must pass);
 * - **human-review** — the fail-closed record gate (./human.ts).
 *
 * A gate runner that THROWS (package error, unreadable input) is reported
 * NOT-RUNNABLE with the reason — and a not-runnable BLOCKING gate counts
 * as FAIL for the release verdict (never a silent skip).
 */
import {
  evaluateRenderOutput,
  renderW503CleanFixture,
  injectStyleInstability,
} from "@sporta/renderer-evaluation";
import {
  evaluateSceneOutput,
  buildCleanMatchFixture,
  buildDirectedReviewFixture,
} from "@sporta/scene-evaluation";
import { parseHumanReview, humanReviewVerdict, type HumanReviewStatus } from "./human";
import type { GatePolicyRow } from "./policy";

/** One gate's executed result. */
export interface GateResult {
  /** The gate id (matches the policy row). */
  id: GatePolicyRow["id"];
  /** The owning package (the real evaluation that ran). */
  source: GatePolicyRow["source"];
  /** PASS / FAIL / NOT-RUNNABLE / PENDING-HUMAN-REVIEW. */
  status: "PASS" | "FAIL" | "NOT-RUNNABLE" | "PENDING-HUMAN-REVIEW";
  /** The accounted reason when not PASS (never silent). */
  reason?: string;
  /** Key measured values carried VERBATIM from the source reports (evidence). */
  summary: Record<string, number | string | boolean>;
  /** Whether this gate blocks the release (the policy row, verbatim). */
  blocking: boolean;
}

/** The temporal-stability gate: the real W503 evaluation over its fixture. */
export function runTemporalGate(
  outputSupplier: () => ReturnType<typeof renderW503CleanFixture> = renderW503CleanFixture,
): GateResult {
  const base = {
    id: "temporal-stability" as const,
    source: "@sporta/renderer-evaluation" as const,
    blocking: true,
  };
  try {
    const report = evaluateRenderOutput(outputSupplier());
    const failing = report.verdict.failures.length;
    return {
      ...base,
      status: report.verdict.pass ? "PASS" : "FAIL",
      reason: report.verdict.pass
        ? undefined
        : `${failing} failing check(s): ${report.verdict.failures
            .map((f) => f.metric)
            .slice(0, 5)
            .join(", ")}`,
      summary: {
        verdict: report.verdict.pass,
        checkCount: report.verdict.checks.length,
        failingCheckCount: failing,
        schemaTag: report.schemaTag,
      },
    };
  } catch (error) {
    return {
      ...base,
      status: "NOT-RUNNABLE",
      reason: `renderer-evaluation threw: ${(error as Error).message}`,
      summary: { verdict: false },
    };
  }
}

/** The scene-correctness gate: the real W605 evaluation, both fixtures. */
export function runSceneGate(options?: {
  matchFixture?: () => ReturnType<typeof buildCleanMatchFixture>;
  directedFixture?: () => ReturnType<typeof buildDirectedReviewFixture>;
}): GateResult {
  const base = {
    id: "scene-correctness" as const,
    source: "@sporta/scene-evaluation" as const,
    blocking: true,
  };
  try {
    const match = evaluateSceneOutput({
      ...(options?.matchFixture ?? buildCleanMatchFixture)(),
    });
    const directedFixture = (options?.directedFixture ?? buildDirectedReviewFixture)();
    const directed = evaluateSceneOutput({
      ...directedFixture.input,
      plan: directedFixture.plan,
    });
    const pass = match.verdict.pass && directed.verdict.pass;
    return {
      ...base,
      status: pass ? "PASS" : "FAIL",
      reason: pass
        ? undefined
        : `match ${match.verdict.pass ? "PASS" : "FAIL"} (${match.verdict.failures.length} failing), directed ${directed.verdict.pass ? "PASS" : "FAIL"} (${directed.verdict.failures.length} failing)`,
      summary: {
        matchVerdict: match.verdict.pass,
        matchCheckCount: match.verdict.checks.length,
        matchFailingCheckCount: match.verdict.failures.length,
        directedVerdict: directed.verdict.pass,
        directedCheckCount: directed.verdict.checks.length,
        directedFailingCheckCount: directed.verdict.failures.length,
        matchSchemaTag: match.schemaTag,
      },
    };
  } catch (error) {
    return {
      ...base,
      status: "NOT-RUNNABLE",
      reason: `scene-evaluation threw: ${(error as Error).message}`,
      summary: { matchVerdict: false, directedVerdict: false },
    };
  }
}

/** The human-review gate: the fail-closed record check. */
export function runHumanGate(record?: unknown): GateResult {
  const base = {
    id: "human-review" as const,
    source: "@sporta/quality-gates/human" as const,
    blocking: true,
  };
  const status: HumanReviewStatus = parseHumanReview(record);
  const verdict = humanReviewVerdict(status);
  return {
    ...base,
    status: verdict.pending ? "PENDING-HUMAN-REVIEW" : verdict.pass ? "PASS" : "FAIL",
    reason: verdict.reason,
    summary: {
      verdict: verdict.pass,
      pending: verdict.pending,
      reviewer: status.kind === "complete" ? status.record.reviewer : "(none)",
    },
  };
}

/**
 * The default temporal-defect fixture for the detection tests: the W503
 * package's own style-instability injector (a REAL defect injection seam —
 * one restyled frame: player-7 at frame 2) over the real clean fixture.
 */
export function buildTemporalDefectFixture(): ReturnType<typeof renderW503CleanFixture> {
  const clean = renderW503CleanFixture();
  const manifest = injectStyleInstability(clean.manifest, {
    frameIndex: 2,
    entityId: "player-7",
  });
  return { ...clean, manifest };
}
