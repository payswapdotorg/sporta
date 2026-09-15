/**
 * The W801 suite runner: ONE repeatable pass over the declared suite.
 *
 * `runSuite(loaded, options?)` walks the suite config's cases IN DECLARED
 * ORDER, running each case's REAL evaluator in-process:
 *
 * - the case clock is read from the INJECTED clock before and after every
 *   case (the report's only "timings" — injected-clock domain, never
 *   wall-clock; see `src/clock.ts`);
 * - a CRASHING case is CONTAINED: the exception becomes a FAILED case result
 *   carrying `error.errorClass` + `error.message`, and the suite CONTINUES —
 *   the remaining cases still run and still report. Nothing is ever
 *   swallowed: the error also surfaces in the case's and the aggregate's
 *   failure reasons. (A case that cannot run — missing fixture, malformed
 *   input — is a structural FAIL, never a skip.);
 * - the aggregate is a STRICT CONJUNCTION (no weights, no averaging — README
 *   §"Aggregation");
 * - before returning, the report passes the structural self-check
 *   (`assertSuiteReportShape`) — a violation is a HARNESS bug and throws
 *   (it is never demoted to a case failure).
 *
 * Deterministic: given the same loaded config and the same injected-clock
 * behavior, two runs produce deep-equal reports and byte-identical canonical
 * serializations (pinned by tests, in-process and across subprocesses).
 */
import { resolve } from "node:path";
import { serializeArtifact } from "@sporta/evaluation";
import { createDefaultClock } from "./clock";
import type { SuiteClock } from "./clock";
import { measurePackageVersions } from "./environment";
import { REPORT_SCHEMA_TAG } from "./report";
import type { CaseError, SuiteReport, SuiteCaseResult } from "./report";
import type { LoadedSuite, SuiteCaseConfig } from "./suite-config";
import { assertSuiteReportShape } from "./validate";
import { runW403Case } from "./cases/w403";
import { runW503Case } from "./cases/w503";
import { runW601Case } from "./cases/w601";
import type { CaseVerdict } from "./cases/types";

/** Options for {@link runSuite}. */
export interface RunSuiteOptions {
  /**
   * The injected clock (default: a fresh deterministic step clock at
   * TEST_EPOCH_MS — never an ambient clock). The clock must be monotonic
   * across the run (the report's shape check enforces it).
   */
  readonly clock?: SuiteClock;
}

/** Describes a contained crash for the case result. */
function describeError(cause: unknown): CaseError {
  const error = cause instanceof Error ? cause : undefined;
  return {
    errorClass: error?.name ?? (cause === null || cause === undefined ? "Error" : typeof cause),
    message: error?.message ?? String(cause),
  };
}

/** The failed case result for a contained crash (the suite continues). */
function crashedCaseResult(
  caseConfig: SuiteCaseConfig,
  clockReads: { startMs: number; endMs: number },
  cause: unknown,
): SuiteCaseResult {
  const error = describeError(cause);
  const reason = `case crashed: ${error.errorClass}: ${error.message}`;
  switch (caseConfig.caseKind) {
    case "w403-replay-comparability":
      return {
        caseKind: caseConfig.caseKind,
        caseName: caseConfig.caseName,
        verdict: "FAIL",
        fixture: caseConfig.fixture,
        policy: caseConfig.policy,
        clock: clockReads,
        failureReasons: [reason],
        error,
      };
    case "w503-temporal-consistency":
      return {
        caseKind: caseConfig.caseKind,
        caseName: caseConfig.caseName,
        verdict: "FAIL",
        fixture: caseConfig.fixture,
        policy: caseConfig.policy,
        clock: clockReads,
        failureReasons: [reason],
        error,
      };
    case "w601-scene-conformance":
      return {
        caseKind: caseConfig.caseKind,
        caseName: caseConfig.caseName,
        verdict: "FAIL",
        fixture: caseConfig.fixture,
        policy: caseConfig.policy,
        clock: clockReads,
        failureReasons: [reason],
        error,
      };
  }
}

/** Runs ONE case (dispatch + crash containment + injected-clock reads). */
function runOneCase(
  caseConfig: SuiteCaseConfig,
  resolvePath: (relativePath: string) => string,
  clock: SuiteClock,
): SuiteCaseResult {
  const startMs = clock.now();
  try {
    const context = { resolvePath };
    switch (caseConfig.caseKind) {
      case "w403-replay-comparability": {
        const outcome = runW403Case(caseConfig, context);
        return {
          caseKind: caseConfig.caseKind,
          caseName: caseConfig.caseName,
          verdict: outcome.verdict,
          fixture: caseConfig.fixture,
          policy: caseConfig.policy,
          clock: { startMs, endMs: clock.now() },
          thresholds: outcome.thresholds,
          measured: outcome.measured,
          failureReasons: [...outcome.failureReasons],
        };
      }
      case "w503-temporal-consistency": {
        const outcome = runW503Case(caseConfig);
        return {
          caseKind: caseConfig.caseKind,
          caseName: caseConfig.caseName,
          verdict: outcome.verdict,
          fixture: caseConfig.fixture,
          policy: caseConfig.policy,
          clock: { startMs, endMs: clock.now() },
          thresholds: outcome.thresholds,
          measured: outcome.measured,
          failureReasons: [...outcome.failureReasons],
        };
      }
      case "w601-scene-conformance": {
        const outcome = runW601Case(caseConfig, context);
        return {
          caseKind: caseConfig.caseKind,
          caseName: caseConfig.caseName,
          verdict: outcome.verdict,
          fixture: caseConfig.fixture,
          policy: caseConfig.policy,
          clock: { startMs, endMs: clock.now() },
          thresholds: outcome.thresholds,
          measured: outcome.measured,
          failureReasons: [...outcome.failureReasons],
        };
      }
    }
  } catch (cause) {
    return crashedCaseResult(caseConfig, { startMs, endMs: clock.now() }, cause);
  }
}

/**
 * Runs the whole suite. Deterministic; throws only on harness-internal
 * structural problems (the post-run shape self-check) — evaluator crashes
 * are contained per-case.
 */
export function runSuite(loaded: LoadedSuite, options: RunSuiteOptions = {}): SuiteReport {
  const clock = options.clock ?? createDefaultClock();
  const resolvePath = (relativePath: string): string => resolve(loaded.originDir, relativePath);

  const startMs = clock.now();
  const cases: SuiteCaseResult[] = [];
  for (const caseConfig of loaded.config.cases) {
    cases.push(runOneCase(caseConfig, resolvePath, clock));
  }
  const endMs = clock.now();

  const passCount = cases.filter((caseResult) => caseResult.verdict === "PASS").length;
  const failCount = cases.length - passCount;
  const failureReasons = cases.flatMap((caseResult) =>
    caseResult.failureReasons.map((reason) => `${caseResult.caseName}: ${reason}`),
  );
  const aggregateVerdict: CaseVerdict = failCount === 0 ? "PASS" : "FAIL";

  const report: SuiteReport = {
    reportSchema: REPORT_SCHEMA_TAG,
    suite: {
      suiteId: loaded.config.suiteId,
      suiteVersion: loaded.config.suiteVersion,
      suiteConfigSha256: loaded.sha256,
      config: loaded.config,
    },
    environment: {
      packageVersions: measurePackageVersions(),
    },
    clock: { startMs, endMs },
    cases,
    aggregate: {
      verdict: aggregateVerdict,
      caseCount: cases.length,
      passCount,
      failCount,
      failureReasons,
    },
  };

  assertSuiteReportShape(report);
  return report;
}

/** Serializes a suite report into its canonical bytes (the W403 serializer). */
export function serializeSuiteReport(report: SuiteReport): string {
  // serializeArtifact canonicalizes (sorted keys, full float precision) and
  // rejects volatile values (NaN/undefined) — the repo's byte-level authority,
  // reused so the harness's canonical form is the W403 form by construction.
  return serializeArtifact(report);
}
