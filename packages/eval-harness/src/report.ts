/**
 * The W801 suite report: the machine-readable aggregate (types only).
 *
 * One suite run → one {@link SuiteReport}: a pure, JSON-serializable
 * projection of everything measured, with NO volatile data (no wall clock,
 * no hostname, no random ids — see `src/environment.ts` for exactly what the
 * environment block contains and why). The canonical byte form is the W403
 * serializer (`serializeArtifact` from `@sporta/evaluation`: sorted keys, full
 * float precision, NaN/undefined rejected) — the harness's report is
 * canonical BY CONSTRUCTION through the same authority the repo already
 * trusts.
 *
 * Aggregation honesty (README §"Aggregation"): the aggregate verdict is
 * STRICTLY CONJUNCTIVE — every case must PASS. There are no weights, no
 * score averaging, and no skips: a case that cannot run (missing fixture,
 * crashing evaluator, malformed input) is a FAILED case result carrying the
 * error class and message, and the suite CONTINUES so the remaining cases
 * still report. Every failing case contributes at least one failure reason;
 * nothing is ever swallowed.
 */
import type { CaseVerdict } from "./cases/types";
import type { W403CaseConfig, W503CaseConfig, W601CaseConfig, SuiteConfig } from "./suite-config";
import type { W403CaseMeasured, W403CaseThresholds } from "./cases/w403";
import type { W503CaseMeasured, W503CaseThresholds } from "./cases/w503";
import type { W601CaseMeasured, W601CaseThresholds } from "./cases/w601";

/** Canonical suite-report schema tag (bump on any report shape change). */
export const REPORT_SCHEMA_TAG = "sporta/eval-harness/suite-report@1";

/** The checked-in golden suite report (package-relative). */
export const DEFAULT_GOLDEN_REPORT_PATH = `${import.meta.dir}/../fixtures/golden/suite-report-golden.json`;

/** The injected-clock reads bracketing one case. */
export interface CaseClockReads {
  /** The injected-clock value read immediately BEFORE the case ran. */
  readonly startMs: number;
  /** The injected-clock value read immediately AFTER the case ran. */
  readonly endMs: number;
}

/** A contained case crash: the error class and message (never swallowed). */
export interface CaseError {
  /** The thrown error's class name (e.g. `"SceneProjectionError"`, `"RangeError"`). */
  readonly errorClass: string;
  /** The thrown error's message. */
  readonly message: string;
}

/** The W403 case's report result. */
export interface W403CaseResult {
  readonly caseKind: "w403-replay-comparability";
  readonly caseName: string;
  readonly verdict: CaseVerdict;
  /** The case's declared fixture, echoed VERBATIM from the suite config. */
  readonly fixture: W403CaseConfig["fixture"];
  /** The case's declared policy, echoed VERBATIM from the suite config. */
  readonly policy: W403CaseConfig["policy"];
  readonly clock: CaseClockReads;
  readonly thresholds?: W403CaseThresholds;
  readonly measured?: W403CaseMeasured;
  readonly failureReasons: readonly string[];
  /** Present iff the case crashed (then `thresholds`/`measured` are absent). */
  readonly error?: CaseError;
}

/** The W503 case's report result. */
export interface W503CaseResult {
  readonly caseKind: "w503-temporal-consistency";
  readonly caseName: string;
  readonly verdict: CaseVerdict;
  readonly fixture: W503CaseConfig["fixture"];
  readonly policy: W503CaseConfig["policy"];
  readonly clock: CaseClockReads;
  readonly thresholds?: W503CaseThresholds;
  readonly measured?: W503CaseMeasured;
  readonly failureReasons: readonly string[];
  readonly error?: CaseError;
}

/** The W601 case's report result. */
export interface W601CaseResult {
  readonly caseKind: "w601-scene-conformance";
  readonly caseName: string;
  readonly verdict: CaseVerdict;
  readonly fixture: W601CaseConfig["fixture"];
  readonly policy: W601CaseConfig["policy"];
  readonly clock: CaseClockReads;
  readonly thresholds?: W601CaseThresholds;
  readonly measured?: W601CaseMeasured;
  readonly failureReasons: readonly string[];
  readonly error?: CaseError;
}

/** One case's result (discriminated on `caseKind`). */
export type SuiteCaseResult = W403CaseResult | W503CaseResult | W601CaseResult;

/** The conjunctive aggregate. */
export interface SuiteAggregate {
  /** PASS iff every case passed (strict conjunction — no weights, no averaging). */
  readonly verdict: CaseVerdict;
  readonly caseCount: number;
  readonly passCount: number;
  readonly failCount: number;
  /** Every failure reason, prefixed with its case name (never swallowed). */
  readonly failureReasons: readonly string[];
}

/** The full machine-readable suite report. */
export interface SuiteReport {
  /** Report schema tag: {@link REPORT_SCHEMA_TAG}. */
  readonly reportSchema: string;
  /** The suite identity + the config it ran (hash-pinned, self-describing). */
  readonly suite: {
    readonly suiteId: string;
    readonly suiteVersion: number;
    /** sha256 (hex) over the suite config's canonical bytes. */
    readonly suiteConfigSha256: string;
    /** The validated suite config, VERBATIM. */
    readonly config: SuiteConfig;
  };
  /** Honest deterministic environment facts (measured; see `src/environment.ts`). */
  readonly environment: {
    readonly packageVersions: Record<string, string>;
  };
  /** The injected-clock reads bracketing the whole suite run. */
  readonly clock: {
    readonly startMs: number;
    readonly endMs: number;
  };
  /** The case results, in the suite config's declared run order. */
  readonly cases: readonly SuiteCaseResult[];
  readonly aggregate: SuiteAggregate;
}
