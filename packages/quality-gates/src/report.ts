/**
 * The release-readiness report (W803 deliverable 2): the deterministic
 * composition verdict. Pure — a function of the human-review record (and
 * the deterministic fixtures the gate runners evaluate); no clock, no
 * randomness. Same input → byte-identical report (pinned in-process
 * ×2 and across subprocesses). The machine gates evaluate in-memory
 * fixtures; the `visual-correctness` gate (R307) additionally performs
 * REAL bounded media work (engine render + ffmpeg encode/decode) over
 * the same deterministic fixture domain — determinism per encoder build
 * (the encoding plane's documented bound).
 *
 * Verdict semantics (the policy, one place):
 * - **PASS** — every BLOCKING gate PASSes (machine gates green + the human
 *   record complete with every checklist item "pass").
 * - **PENDING-HUMAN-REVIEW** — every machine gate PASSes but the human
 *   record is absent, malformed, or incomplete. Never a PASS, never silent.
 * - **FAIL** — any blocking gate FAILs or is NOT-RUNNABLE (a gate that
 *   cannot run is a failed release check, never a skipped one), or the
 *   human record is complete with a "fail" checklist item.
 *
 * The `visual-correctness` gate (R307, added in `w803@2`) performs REAL
 * media work (a real engine render + a real ffmpeg encode + a real decode
 * of the artifact's frames) over the repo's deterministic fixtures — the
 * report remains a pure function of the fixture domain and the encoder
 * build (no wall clock, no randomness; byte-determinism per build, the
 * encoding plane's documented bound).
 */
import { z } from "zod";
import { GATE_POLICY_VERSION } from "./policy";
import {
  runTemporalGate,
  runSceneGate,
  runHumanGate,
  runVisualCorrectnessGate,
  type GateResult,
} from "./gates";
import { humanReviewVerdict, parseHumanReview } from "./human";

/** The report schema tag (versioned with the report shape). */
export const REPORT_SCHEMA_TAG = "sporta/quality-gates/w803@1";

/** The overall release verdict. */
export type ReleaseOutcome = "PASS" | "FAIL" | "PENDING-HUMAN-REVIEW";

/** The full release-readiness report. */
export interface ReleaseReadinessReport {
  schemaTag: string;
  policyVersion: string;
  input: {
    /** The evaluation domain: the repo's deterministic fixtures. */
    fixtureDomain: "repo-fixtures";
    /** Whether a human-review record was supplied. */
    humanRecordSupplied: boolean;
  };
  gates: GateResult[];
  humanReview: {
    status: "complete" | "incomplete" | "failed" | "absent";
    reviewer: string;
    reason?: string;
  };
  accounting: {
    gateCount: number;
    passCount: number;
    failCount: number;
    notRunnableCount: number;
    pendingHumanReviewCount: number;
    /** gateCount === pass + fail + not-runnable + pending (never silent). */
    reconciles: boolean;
  };
  verdict: {
    outcome: ReleaseOutcome;
    reason?: string;
    /** The blocking gate ids, in policy order (the gate list behind the verdict). */
    blockingGates: string[];
  };
}

/** The zod schema (machine-readable contract; validated on return). */
export const ReleaseReadinessReportSchema = z.object({
  schemaTag: z.literal(REPORT_SCHEMA_TAG),
  policyVersion: z.string(),
  input: z.object({
    fixtureDomain: z.literal("repo-fixtures"),
    humanRecordSupplied: z.boolean(),
  }),
  gates: z.array(
    z.object({
      id: z.enum(["temporal-stability", "scene-correctness", "visual-correctness", "human-review"]),
      source: z.string(),
      status: z.enum(["PASS", "FAIL", "NOT-RUNNABLE", "PENDING-HUMAN-REVIEW"]),
      reason: z.string().optional(),
      summary: z.record(z.union([z.number(), z.string(), z.boolean()])),
      blocking: z.boolean(),
    }),
  ),
  humanReview: z.object({
    status: z.enum(["complete", "incomplete", "failed", "absent"]),
    reviewer: z.string(),
    reason: z.string().optional(),
  }),
  accounting: z.object({
    gateCount: z.number().int().min(0),
    passCount: z.number().int().min(0),
    failCount: z.number().int().min(0),
    notRunnableCount: z.number().int().min(0),
    pendingHumanReviewCount: z.number().int().min(0),
    reconciles: z.boolean(),
  }),
  verdict: z.object({
    outcome: z.enum(["PASS", "FAIL", "PENDING-HUMAN-REVIEW"]),
    reason: z.string().optional(),
    blockingGates: z.array(z.string()),
  }),
});

/** Options for the release evaluation (all optional; defaults are the fixtures). */
export interface ReleaseReadinessOptions {
  /** The human-review record document (unknown JSON). */
  humanRecord?: unknown;
  /** Gate runner overrides (test seams — the defaults run the real gates). */
  temporalGate?: () => GateResult;
  sceneGate?: () => GateResult;
  visualGate?: () => GateResult;
}

/**
 * Evaluates the release readiness of the fixture domain: runs every gate
 * (the real evaluations), applies the policy, and returns the deterministic
 * report. Throws `RangeError` if the evaluator produced a report its own
 * schema rejects (an evaluator bug, never an input problem).
 */
export function evaluateReleaseReadiness(
  options: ReleaseReadinessOptions = {},
): ReleaseReadinessReport {
  // Defense in depth: a gate runner that THROWS (a broken override, an
  // unexpected package failure) is a NOT-RUNNABLE blocking gate — the
  // release fails loudly, never crashes silently into a coerced verdict.
  const safeRunner = (runner: () => GateResult, id: string): GateResult => {
    try {
      return runner();
    } catch (error) {
      return {
        id: id as GateResult["id"],
        source: "@sporta/quality-gates/human" as const,
        status: "NOT-RUNNABLE",
        reason: `gate runner threw: ${(error as Error).message}`,
        summary: {},
        blocking: true,
      };
    }
  };
  const gates: GateResult[] = [
    safeRunner(options.temporalGate ?? runTemporalGate, "temporal-stability"),
    safeRunner(options.sceneGate ?? runSceneGate, "scene-correctness"),
    safeRunner(options.visualGate ?? runVisualCorrectnessGate, "visual-correctness"),
    safeRunner(() => runHumanGate(options.humanRecord), "human-review"),
  ];

  const passCount = gates.filter((g) => g.status === "PASS").length;
  const failCount = gates.filter((g) => g.status === "FAIL").length;
  const notRunnableCount = gates.filter((g) => g.status === "NOT-RUNNABLE").length;
  const pendingHumanReviewCount = gates.filter((g) => g.status === "PENDING-HUMAN-REVIEW").length;
  const gateCount = gates.length;
  const reconciles =
    gateCount === passCount + failCount + notRunnableCount + pendingHumanReviewCount;

  const humanStatus = parseHumanReview(options.humanRecord);
  const humanVerdict = humanReviewVerdict(humanStatus);
  const humanSection: ReleaseReadinessReport["humanReview"] = (() => {
    if (options.humanRecord === undefined) {
      return { status: "absent", reviewer: "(none)", reason: "no human-review record supplied" };
    }
    if (humanStatus.kind === "complete") {
      return { status: "complete", reviewer: humanStatus.record.reviewer };
    }
    return {
      status: humanStatus.kind,
      reviewer: "(none)",
      reason: humanStatus.reason,
    };
  })();

  const blockingFailures = gates.filter(
    (g) => g.blocking && (g.status === "FAIL" || g.status === "NOT-RUNNABLE"),
  );
  let outcome: ReleaseOutcome;
  let reason: string | undefined;
  if (blockingFailures.length > 0) {
    outcome = "FAIL";
    reason = `blocking gate(s) not green: ${blockingFailures
      .map((g) => `${g.id}=${g.status}${g.reason ? ` (${g.reason})` : ""}`)
      .join("; ")}`;
  } else if (pendingHumanReviewCount > 0) {
    outcome = "PENDING-HUMAN-REVIEW";
    reason = humanVerdict.reason ?? "human review pending";
  } else {
    outcome = "PASS";
  }

  const report: ReleaseReadinessReport = {
    schemaTag: REPORT_SCHEMA_TAG,
    policyVersion: GATE_POLICY_VERSION,
    input: {
      fixtureDomain: "repo-fixtures",
      humanRecordSupplied: options.humanRecord !== undefined,
    },
    gates,
    humanReview: humanSection,
    accounting: {
      gateCount,
      passCount,
      failCount,
      notRunnableCount,
      pendingHumanReviewCount,
      reconciles,
    },
    verdict: {
      outcome,
      reason,
      blockingGates: gates.filter((g) => g.blocking).map((g) => g.id),
    },
  };

  const parsed = ReleaseReadinessReportSchema.safeParse(report);
  if (!parsed.success) {
    throw new RangeError(
      `the release report failed its own schema (an evaluator bug): ${parsed.error.message}`,
    );
  }
  return report;
}
