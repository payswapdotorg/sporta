/**
 * Shared executor contracts for the W801 suite's cases.
 *
 * Each case kind is implemented by ONE executor that runs the REAL evaluator
 * package in-process and returns a {@link CaseOutcome}: the verdict, the
 * measured values VERBATIM from the evaluator, the thresholds that were
 * applied (verbatim from the evaluator's exports), and case-level failure
 * reasons (the evaluator's own failure evidence, formatted — never invented).
 *
 * The runner (never the executors) owns crash containment: an executor that
 * throws produces a FAILED case result carrying the error class + message,
 * and the suite CONTINUES (see `src/runner.ts`).
 */

/** The per-case verdict vocabulary (a case is PASS or FAIL — no skips). */
export type CaseVerdict = "PASS" | "FAIL";

/** What one case executor produced. */
export interface CaseOutcome<TMeasured, TThresholds> {
  /** The case's verdict (conjunctively aggregated by the runner). */
  readonly verdict: CaseVerdict;
  /** The measured values, verbatim from the evaluator. */
  readonly measured: TMeasured;
  /** The thresholds/policies the evaluator applied, verbatim. */
  readonly thresholds: TThresholds;
  /** Machine-readable failure reasons (empty when PASS — never swallowed). */
  readonly failureReasons: readonly string[];
}

/** The context a case executor runs in. */
export interface CaseContext {
  /**
   * Resolves a config-declared RELATIVE fixture path against the suite
   * config file's directory (the only path authority in the harness). The
   * REPORT still carries the verbatim declared value — never this resolved
   * absolute path — so report bytes stay machine-independent.
   */
  readonly resolvePath: (relativePath: string) => string;
}
