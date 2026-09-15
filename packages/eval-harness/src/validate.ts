/**
 * The W801 suite-report structural self-check (the W403 `assertArtifactShape`
 * precedent applied to the harness's own report).
 *
 * `assertSuiteReportShape` validates the report the way a strict consumer
 * would: exact key sets at every harness-owned level (unknown keys fail loud
 * with the JSON path), enum and type checks, and CROSS-CONSISTENCY checks
 * (case results echo the suite config verbatim; counts add up; the aggregate
 * verdict is the strict conjunction; every failing case contributes failure
 * reasons; the injected clock is monotonic across the run). The evaluator
 * outputs inside `measured` are validated one level deep (envelope, verdict
 * checks, schema tags) — their internal shapes are the evaluator packages'
 * own contracts, pinned by their own tests; the harness validates its OWN
 * construction.
 *
 * The runner calls this on every report before returning it: a violation is
 * a HARNESS bug and fails loud (it is never reported as a case failure).
 */
import { DEFAULT_EPSILON } from "@sporta/evaluation";
import {
  REPORT_SCHEMA_TAG as W503_REPORT_SCHEMA_TAG,
  THRESHOLDS,
} from "@sporta/renderer-evaluation";
import {
  REPORT_SCHEMA_TAG as W306_BENCHMARK_REPORT_SCHEMA_TAG,
  SLO_CANDIDATES,
  SLO_CANDIDATE_PROFILE_ID,
} from "@sporta/latency-benchmark";
import { validateSuiteConfig, CASE_KINDS } from "./suite-config";
import type { SuiteConfig, SuiteCaseConfig } from "./suite-config";
import { ENVIRONMENT_PACKAGE_KEYS } from "./environment";
import { REPORT_SCHEMA_TAG } from "./report";
import type { SuiteReport } from "./report";
import { W403_TOLERANCE_DOCUMENT } from "./cases/w403";
import { W601_RULE_DOCUMENT } from "./cases/w601";

/** Renders a path array as `$.cases[2].clock` for error messages. */
function at(path: readonly string[]): string {
  return path.join(".");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural deep-equality over plain JSON data. */
function jsonDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((element, index) => jsonDeepEqual(element, b[index]));
  }
  if (isRecord(a) && isRecord(b)) {
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (aKeys.length !== bKeys.length || aKeys.some((key, i) => key !== bKeys[i])) {
      return false;
    }
    return aKeys.every((key) => jsonDeepEqual(a[key], b[key]));
  }
  return false;
}

function requireRecord(value: unknown, path: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new RangeError(`assertSuiteReportShape: ${at(path)} must be an object`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, path: readonly string[]): string {
  if (typeof value !== "string" || value.length < 1) {
    throw new RangeError(
      `assertSuiteReportShape: ${at(path)} must be a non-empty string (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

function requireFiniteNumber(value: unknown, path: readonly string[]): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(
      `assertSuiteReportShape: ${at(path)} must be a finite number (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

function requireBoolean(value: unknown, path: readonly string[]): boolean {
  if (typeof value !== "boolean") {
    throw new RangeError(
      `assertSuiteReportShape: ${at(path)} must be a boolean (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

function requireStringArray(value: unknown, path: readonly string[]): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.some((v) => typeof v !== "string" || v.length < 1)
  ) {
    throw new RangeError(
      `assertSuiteReportShape: ${at(path)} must be a non-empty array of non-empty strings`,
    );
  }
  return value as readonly string[];
}

/** Asserts the object carries EXACTLY the required keys (no more, no less). */
function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  path: readonly string[],
): void {
  const requiredSet = new Set(required);
  for (const key of Object.keys(value)) {
    if (!requiredSet.has(key)) {
      throw new RangeError(
        `assertSuiteReportShape: ${at(path)} carries unknown key "${key}" — the report shape is ` +
          `versioned (${REPORT_SCHEMA_TAG}); unknown keys fail loud`,
      );
    }
  }
  for (const key of required) {
    if (!(key in value)) {
      throw new RangeError(`assertSuiteReportShape: ${at(path)} is missing required key "${key}"`);
    }
  }
}

/** Validates { startMs, endMs } clock reads (monotone within themselves). */
function requireClockReads(
  value: unknown,
  path: readonly string[],
): { startMs: number; endMs: number } {
  const record = requireRecord(value, path);
  exactKeys(record, ["startMs", "endMs"], path);
  const startMs = requireFiniteNumber(record.startMs, [...path, "startMs"]);
  const endMs = requireFiniteNumber(record.endMs, [...path, "endMs"]);
  if (endMs < startMs) {
    throw new RangeError(
      `assertSuiteReportShape: ${at(path)} is non-monotonic (startMs ${startMs} > endMs ${endMs}) ` +
        "— injected-clock reads must be monotonic across the run",
    );
  }
  return { startMs, endMs };
}

/** Validates a comparison report (the W403 comparator's output shape). */
function requireComparisonReport(value: unknown, path: readonly string[]): void {
  const record = requireRecord(value, path);
  exactKeys(record, ["passed", "diffCount", "diffs", "summary"], path);
  requireBoolean(record.passed, [...path, "passed"]);
  requireFiniteNumber(record.diffCount, [...path, "diffCount"]);
  if (!Array.isArray(record.diffs)) {
    throw new RangeError(`assertSuiteReportShape: ${at(path)}.diffs must be an array`);
  }
  record.diffs.forEach((diff, index) => {
    const diffRecord = requireRecord(diff, [...path, "diffs", `[${index}]`]);
    exactKeys(
      diffRecord,
      ["path", "fieldClass", "expected", "actual", "reason", "deviation"],
      [...path, "diffs", `[${index}]`],
    );
    requireNonEmptyString(diffRecord.path, [...path, "diffs", `[${index}]`, "path"]);
    requireNonEmptyString(diffRecord.fieldClass, [...path, "diffs", `[${index}]`, "fieldClass"]);
    requireNonEmptyString(diffRecord.expected, [...path, "diffs", `[${index}]`, "expected"]);
    requireNonEmptyString(diffRecord.actual, [...path, "diffs", `[${index}]`, "actual"]);
    requireNonEmptyString(diffRecord.reason, [...path, "diffs", `[${index}]`, "reason"]);
  });
  const summary = requireRecord(record.summary, [...path, "summary"]);
  exactKeys(
    summary,
    [
      "exactFieldsCompared",
      "countFieldsCompared",
      "epsilonFieldsCompared",
      "setArraysCompared",
      "maxAbsDeviation",
    ],
    [...path, "summary"],
  );
  for (const key of [
    "exactFieldsCompared",
    "countFieldsCompared",
    "epsilonFieldsCompared",
    "setArraysCompared",
    "maxAbsDeviation",
  ]) {
    requireFiniteNumber(summary[key], [...path, "summary", key]);
  }
}

/** Validates one case's common envelope; returns the parsed fields. */
function requireCaseCommon(
  value: unknown,
  index: number,
): {
  record: Record<string, unknown>;
  caseName: string;
  caseKind: string;
  verdict: string;
  clock: { startMs: number; endMs: number };
} {
  const path = ["$", "cases", `[${index}]`];
  const record = requireRecord(value, path);
  const allowed = [
    "caseKind",
    "caseName",
    "verdict",
    "fixture",
    "policy",
    "clock",
    "thresholds",
    "measured",
    "failureReasons",
    "error",
  ];
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new RangeError(
        `assertSuiteReportShape: ${at(path)} carries unknown key "${key}" — the case-result shape ` +
          "is versioned; unknown keys fail loud",
      );
    }
  }
  for (const key of [
    "caseKind",
    "caseName",
    "verdict",
    "fixture",
    "policy",
    "clock",
    "failureReasons",
  ]) {
    if (!(key in record)) {
      throw new RangeError(`assertSuiteReportShape: ${at(path)} is missing required key "${key}"`);
    }
  }
  const caseKind = requireNonEmptyString(record.caseKind, [...path, "caseKind"]);
  if (!CASE_KINDS.includes(caseKind as (typeof CASE_KINDS)[number])) {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "caseKind"])} is "${caseKind}" — not a known case kind`,
    );
  }
  const caseName = requireNonEmptyString(record.caseName, [...path, "caseName"]);
  const verdict = requireNonEmptyString(record.verdict, [...path, "verdict"]);
  if (verdict !== "PASS" && verdict !== "FAIL") {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "verdict"])} must be "PASS" or "FAIL" (got "${verdict}")`,
    );
  }
  const clock = requireClockReads(record.clock, [...path, "clock"]);
  if (!Array.isArray(record.failureReasons)) {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "failureReasons"])} must be an array`,
    );
  }
  record.failureReasons.forEach((reason, reasonIndex) => {
    requireNonEmptyString(reason, [...path, "failureReasons", `[${reasonIndex}]`]);
  });
  // Crash/normal consistency: thresholds+measured present ⟺ error absent.
  const hasError = "error" in record;
  const hasMeasured = "measured" in record && "thresholds" in record;
  if (hasError === hasMeasured) {
    throw new RangeError(
      `assertSuiteReportShape: ${at(path)} is inconsistent — a normal case carries ` +
        "thresholds+measured and no error; a crashed case carries an error and neither",
    );
  }
  if (hasError) {
    const error = requireRecord(record.error, [...path, "error"]);
    exactKeys(error, ["errorClass", "message"], [...path, "error"]);
    requireNonEmptyString(error.errorClass, [...path, "error", "errorClass"]);
    requireNonEmptyString(error.message, [...path, "error", "message"]);
  }
  return { record, caseName, caseKind, verdict, clock };
}

/** Validates the W403 case's thresholds + measured (one level deep). */
function requireW403Details(record: Record<string, unknown>, index: number): void {
  const path = ["$", "cases", `[${index}]`];
  if (!("measured" in record)) {
    return; // crashed case — nothing more to check
  }
  const thresholds = requireRecord(record.thresholds, [...path, "thresholds"]);
  exactKeys(thresholds, ["defaultEpsilon", "toleranceDocument"], [...path, "thresholds"]);
  if (thresholds.defaultEpsilon !== DEFAULT_EPSILON) {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "thresholds", "defaultEpsilon"])} is ` +
        `${String(thresholds.defaultEpsilon)}, not the evaluator's current DEFAULT_EPSILON ` +
        `(${String(DEFAULT_EPSILON)}) — a threshold drift must force a report regeneration`,
    );
  }
  if (thresholds.toleranceDocument !== W403_TOLERANCE_DOCUMENT) {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "thresholds", "toleranceDocument"])} must be ` +
        `"${W403_TOLERANCE_DOCUMENT}"`,
    );
  }
  const measured = requireRecord(record.measured, [...path, "measured"]);
  exactKeys(
    measured,
    ["runsCompleted", "runs", "pairwise", "golden", "failureReasons"],
    [...path, "measured"],
  );
  requireFiniteNumber(measured.runsCompleted, [...path, "measured", "runsCompleted"]);
  if (!Array.isArray(measured.runs)) {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "measured", "runs"])} must be an array`,
    );
  }
  measured.runs.forEach((run, runIndex) => {
    const runRecord = requireRecord(run, [...path, "measured", "runs", `[${runIndex}]`]);
    exactKeys(
      runRecord,
      ["runIndex", "exitCode", "stderr"],
      [...path, "measured", "runs", `[${runIndex}]`],
    );
    requireFiniteNumber(runRecord.runIndex, [
      ...path,
      "measured",
      "runs",
      `[${runIndex}]`,
      "runIndex",
    ]);
    requireFiniteNumber(runRecord.exitCode, [
      ...path,
      "measured",
      "runs",
      `[${runIndex}]`,
      "exitCode",
    ]);
    if (typeof runRecord.stderr !== "string") {
      throw new RangeError(
        `assertSuiteReportShape: ${at([...path, "measured", "runs", `[${runIndex}]`, "stderr"])} ` +
          "must be a string",
      );
    }
  });
  if (!Array.isArray(measured.pairwise)) {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "measured", "pairwise"])} must be an array`,
    );
  }
  measured.pairwise.forEach((outcome, outcomeIndex) => {
    const outcomePath = [...path, "measured", "pairwise", `[${outcomeIndex}]`];
    const outcomeRecord = requireRecord(outcome, outcomePath);
    exactKeys(outcomeRecord, ["label", "byteIdentical", "report"], outcomePath);
    requireNonEmptyString(outcomeRecord.label, [...outcomePath, "label"]);
    requireBoolean(outcomeRecord.byteIdentical, [...outcomePath, "byteIdentical"]);
    requireComparisonReport(outcomeRecord.report, [...outcomePath, "report"]);
  });
  if (measured.golden !== null) {
    const goldenPath = [...path, "measured", "golden"];
    const goldenRecord = requireRecord(measured.golden, goldenPath);
    exactKeys(goldenRecord, ["label", "byteIdentical", "report"], goldenPath);
    requireNonEmptyString(goldenRecord.label, [...goldenPath, "label"]);
    requireBoolean(goldenRecord.byteIdentical, [...goldenPath, "byteIdentical"]);
    requireComparisonReport(goldenRecord.report, [...goldenPath, "report"]);
  }
  if (!Array.isArray(measured.failureReasons)) {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "measured", "failureReasons"])} must be an array`,
    );
  }
}

/** Validates the W503 case's thresholds + measured (one level deep). */
function requireW503Details(record: Record<string, unknown>, index: number): void {
  const path = ["$", "cases", `[${index}]`];
  if (!("measured" in record)) {
    return;
  }
  if (!jsonDeepEqual(record.thresholds, THRESHOLDS)) {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "thresholds"])} does not deep-equal the W503 ` +
        "evaluator's current THRESHOLDS — a threshold drift must force a report regeneration",
    );
  }
  const measured = requireRecord(record.measured, [...path, "measured"]);
  exactKeys(measured, ["report", "detectionProof"], [...path, "measured"]);
  const report = requireRecord(measured.report, [...path, "measured", "report"]);
  for (const key of ["schemaTag", "input", "identity", "geometry", "artifacts", "verdict"]) {
    if (!(key in report)) {
      throw new RangeError(
        `assertSuiteReportShape: ${at([...path, "measured", "report"])} is missing "${key}"`,
      );
    }
  }
  for (const key of Object.keys(report)) {
    if (
      ![
        "schemaTag",
        "input",
        "identity",
        "styleBytes",
        "geometry",
        "artifacts",
        "verdict",
      ].includes(key)
    ) {
      throw new RangeError(
        `assertSuiteReportShape: ${at([...path, "measured", "report"])} carries unknown key "${key}"`,
      );
    }
  }
  if (report.schemaTag !== W503_REPORT_SCHEMA_TAG) {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "measured", "report", "schemaTag"])} is ` +
        `"${String(report.schemaTag)}", not the evaluator's current tag ` +
        `"${W503_REPORT_SCHEMA_TAG}"`,
    );
  }
  const verdict = requireRecord(report.verdict, [...path, "measured", "report", "verdict"]);
  exactKeys(verdict, ["pass", "failures", "checks"], [...path, "measured", "report", "verdict"]);
  requireBoolean(verdict.pass, [...path, "measured", "report", "verdict", "pass"]);
  if (!Array.isArray(verdict.checks)) {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "measured", "report", "verdict", "checks"])} must be an array`,
    );
  }
  verdict.checks.forEach((check, checkIndex) => {
    const checkPath = [...path, "measured", "report", "verdict", "checks", `[${checkIndex}]`];
    const checkRecord = requireRecord(check, checkPath);
    exactKeys(checkRecord, ["metric", "operator", "threshold", "measured", "pass"], checkPath);
    requireNonEmptyString(checkRecord.metric, [...checkPath, "metric"]);
    if (checkRecord.operator !== "max" && checkRecord.operator !== "min") {
      throw new RangeError(
        `assertSuiteReportShape: ${at([...checkPath, "operator"])} must be "max" or "min"`,
      );
    }
    requireFiniteNumber(checkRecord.threshold, [...checkPath, "threshold"]);
    requireFiniteNumber(checkRecord.measured, [...checkPath, "measured"]);
    requireBoolean(checkRecord.pass, [...checkPath, "pass"]);
  });
  if (measured.detectionProof !== null) {
    if (!Array.isArray(measured.detectionProof)) {
      throw new RangeError(
        `assertSuiteReportShape: ${at([...path, "measured", "detectionProof"])} must be an array or null`,
      );
    }
    measured.detectionProof.forEach((entry, entryIndex) => {
      const entryPath = [...path, "measured", "detectionProof", `[${entryIndex}]`];
      const entryRecord = requireRecord(entry, entryPath);
      exactKeys(entryRecord, ["injection", "detected", "failingMetrics"], entryPath);
      requireNonEmptyString(entryRecord.injection, [...entryPath, "injection"]);
      requireBoolean(entryRecord.detected, [...entryPath, "detected"]);
      if (!Array.isArray(entryRecord.failingMetrics)) {
        throw new RangeError(
          `assertSuiteReportShape: ${at([...entryPath, "failingMetrics"])} must be an array`,
        );
      }
      entryRecord.failingMetrics.forEach((metric, metricIndex) => {
        requireNonEmptyString(metric, [...entryPath, "failingMetrics", `[${metricIndex}]`]);
      });
    });
  }
}

/** Validates the W601 case's thresholds + measured (one level deep). */
function requireW601Details(record: Record<string, unknown>, index: number): void {
  const path = ["$", "cases", `[${index}]`];
  if (!("measured" in record)) {
    return;
  }
  const thresholds = requireRecord(record.thresholds, [...path, "thresholds"]);
  exactKeys(thresholds, ["ruleDocument", "checkIds"], [...path, "thresholds"]);
  if (thresholds.ruleDocument !== W601_RULE_DOCUMENT) {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "thresholds", "ruleDocument"])} must be ` +
        `"${W601_RULE_DOCUMENT}"`,
    );
  }
  requireStringArray(thresholds.checkIds, [...path, "thresholds", "checkIds"]);
  const measured = requireRecord(record.measured, [...path, "measured"]);
  exactKeys(measured, ["checks", "passed"], [...path, "measured"]);
  requireBoolean(measured.passed, [...path, "measured", "passed"]);
  if (!Array.isArray(measured.checks)) {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "measured", "checks"])} must be an array`,
    );
  }
  const checkIds: string[] = [];
  measured.checks.forEach((check, checkIndex) => {
    const checkPath = [...path, "measured", "checks", `[${checkIndex}]`];
    const checkRecord = requireRecord(check, checkPath);
    const allowed = ["checkId", "description", "passed", "detail"];
    for (const key of Object.keys(checkRecord)) {
      if (!allowed.includes(key)) {
        throw new RangeError(
          `assertSuiteReportShape: ${at(checkPath)} carries unknown key "${key}"`,
        );
      }
    }
    checkIds.push(requireNonEmptyString(checkRecord.checkId, [...checkPath, "checkId"]));
    requireNonEmptyString(checkRecord.description, [...checkPath, "description"]);
    requireBoolean(checkRecord.passed, [...checkPath, "passed"]);
  });
  if (!jsonDeepEqual(thresholds.checkIds, checkIds)) {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "thresholds", "checkIds"])} does not match the ` +
        "measured conformance checks — the applied-rule list must be the verbatim check ids",
    );
  }
}

/** Validates one W306 latency-stats block (count + min/max/p50/p95). */
function requireW306LatencyStats(value: unknown, path: readonly string[]): void {
  const stats = requireRecord(value, path);
  exactKeys(stats, ["count", "minMs", "maxMs", "p50Ms", "p95Ms"], path);
  for (const key of ["count", "minMs", "maxMs", "p50Ms", "p95Ms"]) {
    const latency = requireFiniteNumber(stats[key], [...path, key]);
    if (latency < 0) {
      throw new RangeError(
        `assertSuiteReportShape: ${at([...path, key])} must be >= 0 (latencies are ` +
          "non-negative injected-clock milliseconds)",
      );
    }
  }
  const count = stats.count as number;
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "count"])} must be an integer >= 1 — a stage ` +
        "with no samples is undefined, never a fabricated zero",
    );
  }
}

/**
 * Validates the W306 case's thresholds + measured (one level deep): the SLO
 * candidate table must be the benchmark package's CURRENT export (a drift
 * forces a report regeneration), the carried report must carry the current
 * benchmark schema tag, the stage tables must be complete non-empty
 * summaries, and the accounting block must balance (the never-silent rule
 * extends to consumers reading the suite report from disk).
 */
function requireW306Details(record: Record<string, unknown>, index: number): void {
  const path = ["$", "cases", `[${index}]`];
  if (!("measured" in record)) {
    return; // crashed case — nothing more to check
  }
  const thresholds = requireRecord(record.thresholds, [...path, "thresholds"]);
  exactKeys(thresholds, ["sloProfileId", "candidates"], [...path, "thresholds"]);
  if (thresholds.sloProfileId !== SLO_CANDIDATE_PROFILE_ID) {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "thresholds", "sloProfileId"])} must be ` +
        `"${SLO_CANDIDATE_PROFILE_ID}" — a candidate-table drift must force a report ` +
        "regeneration",
    );
  }
  if (!jsonDeepEqual(thresholds.candidates, SLO_CANDIDATES)) {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "thresholds", "candidates"])} does not deep-equal ` +
        "the benchmark package's current SLO_CANDIDATES — a candidate drift must force a " +
        "report regeneration",
    );
  }
  const measured = requireRecord(record.measured, [...path, "measured"]);
  exactKeys(
    measured,
    ["run", "reportSchema", "benchmark", "stages", "accounting", "stageDefinitions", "sloVerdicts"],
    [...path, "measured"],
  );
  // The subprocess evidence: a successful run's record.
  const run = requireRecord(measured.run, [...path, "measured", "run"]);
  exactKeys(run, ["exitCode", "stderr", "stdoutBytes"], [...path, "measured", "run"]);
  const exitCode = requireFiniteNumber(run.exitCode, [...path, "measured", "run", "exitCode"]);
  if (exitCode !== 0) {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "measured", "run", "exitCode"])} is ` +
        `${String(exitCode)}, not 0 — a crashing benchmark is a FAILED case, never a ` +
        "measured report",
    );
  }
  if (typeof run.stderr !== "string") {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "measured", "run", "stderr"])} must be a string`,
    );
  }
  const stdoutBytes = requireFiniteNumber(run.stdoutBytes, [
    ...path,
    "measured",
    "run",
    "stdoutBytes",
  ]);
  if (!Number.isInteger(stdoutBytes) || stdoutBytes < 1) {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "measured", "run", "stdoutBytes"])} must be a ` +
        "positive integer — the measured values came from real report bytes",
    );
  }
  // The carried benchmark report's own schema tag must be the CURRENT one.
  if (measured.reportSchema !== W306_BENCHMARK_REPORT_SCHEMA_TAG) {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "measured", "reportSchema"])} is ` +
        `"${String(measured.reportSchema)}", not the benchmark package's current tag ` +
        `"${W306_BENCHMARK_REPORT_SCHEMA_TAG}" — a benchmark schema drift must force a ` +
        "report regeneration",
    );
  }
  // The benchmark identity block: clock domain + percentile method are the
  // W306 honesty constants — the report may never silently change them.
  const benchmark = requireRecord(measured.benchmark, [...path, "measured", "benchmark"]);
  if (benchmark.clockDomain !== "injected-virtual") {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "measured", "benchmark", "clockDomain"])} must ` +
        'be "injected-virtual" — every carried timing is injected-clock domain',
    );
  }
  if (benchmark.percentileMethod !== "nearest-rank") {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "measured", "benchmark", "percentileMethod"])} ` +
        'must be "nearest-rank" (the documented, test-pinned method)',
    );
  }
  // The stage tables: every batch/frame stage carries a complete summary.
  const stages = requireRecord(measured.stages, [...path, "measured", "stages"]);
  exactKeys(stages, ["batch", "frame", "sourceModel"], [...path, "measured", "stages"]);
  const batchStages = requireRecord(stages.batch, [...path, "measured", "stages", "batch"]);
  for (const key of [
    "swm-to-batch",
    "batch-queue",
    "w303-schedule",
    "render-execution",
    "finish-to-emit",
    "end-to-end",
  ]) {
    requireW306LatencyStats(batchStages[key], [...path, "measured", "stages", "batch", key]);
  }
  const frameStages = requireRecord(stages.frame, [...path, "measured", "stages", "frame"]);
  for (const key of ["swm-store-sojourn", "end-to-end"]) {
    requireW306LatencyStats(frameStages[key], [...path, "measured", "stages", "frame", key]);
  }
  const sourceModel = requireRecord(stages.sourceModel, [
    ...path,
    "measured",
    "stages",
    "sourceModel",
  ]);
  exactKeys(
    sourceModel,
    ["worldModelUpdateDeriveMs", "authoredNotMeasured"],
    [...path, "measured", "stages", "sourceModel"],
  );
  requireW306LatencyStats(sourceModel.worldModelUpdateDeriveMs, [
    ...path,
    "measured",
    "stages",
    "sourceModel",
    "worldModelUpdateDeriveMs",
  ]);
  if (sourceModel.authoredNotMeasured !== true) {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "measured", "stages", "sourceModel", "authoredNotMeasured"])} ` +
        "must be true — the authored source model is never presented as measured",
    );
  }
  // The accounting block: the never-silent identity must balance HERE too.
  const accounting = requireRecord(measured.accounting, [...path, "measured", "accounting"]);
  exactKeys(accounting, ["frames", "orchestratorStats"], [...path, "measured", "accounting"]);
  const frames = requireRecord(accounting.frames, [...path, "measured", "accounting", "frames"]);
  const frameKeys = [
    "framesIn",
    "framesEmitted",
    "framesSkippedStale",
    "framesDropped",
    "framesCancelled",
    "framesDuplicate",
    "dropReasons",
    "emittedManifestFrames",
    "balanced",
  ];
  for (const key of Object.keys(frames)) {
    if (!frameKeys.includes(key)) {
      throw new RangeError(
        `assertSuiteReportShape: ${at([...path, "measured", "accounting", "frames"])} carries ` +
          `unknown key "${key}"`,
      );
    }
  }
  for (const key of frameKeys) {
    if (!(key in frames)) {
      throw new RangeError(
        `assertSuiteReportShape: ${at([...path, "measured", "accounting", "frames"])} is ` +
          `missing key "${key}"`,
      );
    }
  }
  for (const key of [
    "framesIn",
    "framesEmitted",
    "framesSkippedStale",
    "framesDropped",
    "framesCancelled",
    "framesDuplicate",
    "emittedManifestFrames",
  ]) {
    requireFiniteNumber(frames[key], [...path, "measured", "accounting", "frames", key]);
  }
  if (frames.balanced !== true) {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "measured", "accounting", "frames", "balanced"])} ` +
        "must be true — an unbalanced accounting is a benchmark crash, never a report",
    );
  }
  const framesIn = frames.framesIn as number;
  const accounted =
    (frames.framesEmitted as number) +
    (frames.framesSkippedStale as number) +
    (frames.framesDropped as number) +
    (frames.framesCancelled as number) +
    (frames.framesDuplicate as number);
  if (framesIn !== accounted) {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "measured", "accounting", "frames"])} does not ` +
        "balance (framesIn !== emitted + skippedStale + dropped + cancelled + duplicate) — " +
        "the never-silent rule extends to consumers reading the suite report",
    );
  }
  if ((frames.framesEmitted as number) !== (frames.emittedManifestFrames as number)) {
    throw new RangeError(
      `assertSuiteReportShape: ${at([...path, "measured", "accounting", "frames"])} — ` +
        "framesEmitted must equal emittedManifestFrames",
    );
  }
  // The SLO verdicts: one per (stage, metric), all pass-consistent.
  if (measured.sloVerdicts !== null) {
    if (!Array.isArray(measured.sloVerdicts)) {
      throw new RangeError(
        `assertSuiteReportShape: ${at([...path, "measured", "sloVerdicts"])} must be an array ` +
          "or null",
      );
    }
    measured.sloVerdicts.forEach((verdict, verdictIndex) => {
      const verdictPath = [...path, "measured", "sloVerdicts", `[${verdictIndex}]`];
      const verdictRecord = requireRecord(verdict, verdictPath);
      exactKeys(verdictRecord, ["stage", "metric", "targetMs", "measuredMs", "pass"], verdictPath);
      requireNonEmptyString(verdictRecord.stage, [...verdictPath, "stage"]);
      if (verdictRecord.metric !== "p50" && verdictRecord.metric !== "p95") {
        throw new RangeError(
          `assertSuiteReportShape: ${at([...verdictPath, "metric"])} must be "p50" or "p95"`,
        );
      }
      requireFiniteNumber(verdictRecord.targetMs, [...verdictPath, "targetMs"]);
      requireFiniteNumber(verdictRecord.measuredMs, [...verdictPath, "measuredMs"]);
      requireBoolean(verdictRecord.pass, [...verdictPath, "pass"]);
    });
  }
}

/** Finds the config case a report case must echo (by position). */
function configCaseAt(config: SuiteConfig, index: number): SuiteCaseConfig {
  const caseConfig = config.cases[index];
  if (caseConfig === undefined) {
    throw new RangeError(
      `assertSuiteReportShape: $.cases[${index}] has no matching suite-config case — the report ` +
        "must carry exactly the config's cases, in the config's order",
    );
  }
  return caseConfig;
}

/**
 * Validates the full suite report shape + consistency. Throws `RangeError`
 * (with the JSON path) on the first violation.
 */
export function assertSuiteReportShape(report: unknown): asserts report is SuiteReport {
  const root = requireRecord(report, ["$"]);
  exactKeys(root, ["reportSchema", "suite", "environment", "clock", "cases", "aggregate"], ["$"]);
  if (root.reportSchema !== REPORT_SCHEMA_TAG) {
    throw new RangeError(
      `assertSuiteReportShape: $.reportSchema must be "${REPORT_SCHEMA_TAG}" ` +
        `(got ${JSON.stringify(root.reportSchema)})`,
    );
  }

  // --- suite block -----------------------------------------------------------
  const suite = requireRecord(root.suite, ["$", "suite"]);
  exactKeys(suite, ["suiteId", "suiteVersion", "suiteConfigSha256", "config"], ["$", "suite"]);
  requireNonEmptyString(suite.suiteId, ["$", "suite", "suiteId"]);
  const suiteVersion = requireFiniteNumber(suite.suiteVersion, ["$", "suite", "suiteVersion"]);
  if (!Number.isInteger(suiteVersion) || suiteVersion < 1) {
    throw new RangeError(
      `assertSuiteReportShape: $.suite.suiteVersion must be an integer >= 1 (got ${String(suiteVersion)})`,
    );
  }
  const sha = requireNonEmptyString(suite.suiteConfigSha256, ["$", "suite", "suiteConfigSha256"]);
  if (!/^[0-9a-f]{64}$/.test(sha)) {
    throw new RangeError(
      "assertSuiteReportShape: $.suite.suiteConfigSha256 must be 64 lowercase hex characters",
    );
  }
  const config = validateSuiteConfig(suite.config);
  if (config.suiteId !== suite.suiteId || config.suiteVersion !== suite.suiteVersion) {
    throw new RangeError(
      "assertSuiteReportShape: $.suite.suiteId/suiteVersion do not match the embedded config — " +
        "the report identity must be the config's identity",
    );
  }

  // --- environment block -----------------------------------------------------
  const environment = requireRecord(root.environment, ["$", "environment"]);
  exactKeys(environment, ["packageVersions"], ["$", "environment"]);
  const packageVersions = requireRecord(environment.packageVersions, [
    "$",
    "environment",
    "packageVersions",
  ]);
  const versionKeys = Object.keys(packageVersions).sort();
  const expectedKeys = [...ENVIRONMENT_PACKAGE_KEYS].sort();
  if (!jsonDeepEqual(versionKeys, expectedKeys)) {
    throw new RangeError(
      "assertSuiteReportShape: $.environment.packageVersions must carry exactly the harness's " +
        "runtime package set (measured, not asserted)",
    );
  }
  for (const key of versionKeys) {
    requireNonEmptyString(packageVersions[key], ["$", "environment", "packageVersions", key]);
  }

  // --- suite clock -----------------------------------------------------------
  const suiteClock = requireClockReads(root.clock, ["$", "clock"]);

  // --- cases -----------------------------------------------------------------
  if (!Array.isArray(root.cases) || root.cases.length < 1) {
    throw new RangeError(
      "assertSuiteReportShape: $.cases must be a non-empty array — an empty suite is a " +
        "configuration error, not a vacuous PASS",
    );
  }
  let passCount = 0;
  let failCount = 0;
  const aggregateReasonPrefixes: string[] = [];
  // The previous case's endMs — case clock windows must not regress across
  // the run (the runner reads suiteStart, then start/end per case in order,
  // then suiteEnd; a monotonic clock therefore yields non-decreasing windows).
  let previousCaseEndMs: number | undefined;
  root.cases.forEach((caseResult, index) => {
    const common = requireCaseCommon(caseResult, index);
    const casePath = ["$", "cases", `[${index}]`];
    // The case must echo the config's case, in order, verbatim.
    const caseConfig = configCaseAt(config, index);
    if (common.caseKind !== caseConfig.caseKind || common.caseName !== caseConfig.caseName) {
      throw new RangeError(
        `assertSuiteReportShape: ${at(casePath)} (kind "${common.caseKind}", name ` +
          `"${common.caseName}") does not match the suite config's case #${index} (kind ` +
          `"${caseConfig.caseKind}", name "${caseConfig.caseName}") — the report must carry the ` +
          "config's cases, in the config's order",
      );
    }
    if (!jsonDeepEqual(common.record.fixture, caseConfig.fixture)) {
      throw new RangeError(
        `assertSuiteReportShape: ${at([...casePath, "fixture"])} does not echo the suite config ` +
          "verbatim",
      );
    }
    if (!jsonDeepEqual(common.record.policy, caseConfig.policy)) {
      throw new RangeError(
        `assertSuiteReportShape: ${at([...casePath, "policy"])} does not echo the suite config ` +
          "verbatim",
      );
    }
    // The case clock must sit inside the suite clock window (monotonic clock).
    if (common.clock.startMs < suiteClock.startMs || common.clock.endMs > suiteClock.endMs) {
      throw new RangeError(
        `assertSuiteReportShape: ${at([...casePath, "clock"])} lies outside the suite clock ` +
          `window [${suiteClock.startMs}, ${suiteClock.endMs}] — injected-clock reads must be ` +
          "monotonic across the run",
      );
    }
    // The case clock windows must not regress across the run either: cases
    // run in declared order on one monotonic clock, so case N's startMs must
    // be >= case N-1's endMs (containment alone let a swapped-window report
    // through — pinned by the report-shape regression test).
    if (previousCaseEndMs !== undefined && common.clock.startMs < previousCaseEndMs) {
      throw new RangeError(
        `assertSuiteReportShape: ${at([...casePath, "clock"])} regresses before the previous ` +
          `case's endMs (${previousCaseEndMs}) — injected-clock reads must be monotonic across ` +
          "the run",
      );
    }
    previousCaseEndMs = common.clock.endMs;
    // Kind-specific details.
    if (common.caseKind === "w403-replay-comparability") {
      requireW403Details(common.record, index);
    } else if (common.caseKind === "w503-temporal-consistency") {
      requireW503Details(common.record, index);
    } else if (common.caseKind === "w601-scene-conformance") {
      requireW601Details(common.record, index);
    } else {
      requireW306Details(common.record, index);
    }
    // Verdict/reason consistency.
    const reasons = common.record.failureReasons as readonly unknown[];
    if (common.verdict === "PASS") {
      passCount += 1;
      if (reasons.length > 0) {
        throw new RangeError(
          `assertSuiteReportShape: ${at([...casePath, "verdict"])} is PASS but failureReasons ` +
            "is non-empty — a passing case has no failure reasons",
        );
      }
    } else {
      failCount += 1;
      if (reasons.length < 1) {
        throw new RangeError(
          `assertSuiteReportShape: ${at([...casePath, "verdict"])} is FAIL but failureReasons is ` +
            "empty — a failing case must explain itself (never silent)",
        );
      }
      aggregateReasonPrefixes.push(common.caseName);
    }
  });

  // --- aggregate -------------------------------------------------------------
  const aggregate = requireRecord(root.aggregate, ["$", "aggregate"]);
  exactKeys(
    aggregate,
    ["verdict", "caseCount", "passCount", "failCount", "failureReasons"],
    ["$", "aggregate"],
  );
  const aggregateVerdict = requireNonEmptyString(aggregate.verdict, ["$", "aggregate", "verdict"]);
  if (aggregateVerdict !== "PASS" && aggregateVerdict !== "FAIL") {
    throw new RangeError(
      `assertSuiteReportShape: $.aggregate.verdict must be "PASS" or "FAIL" (got "${aggregateVerdict}")`,
    );
  }
  requireFiniteNumber(aggregate.caseCount, ["$", "aggregate", "caseCount"]);
  requireFiniteNumber(aggregate.passCount, ["$", "aggregate", "passCount"]);
  requireFiniteNumber(aggregate.failCount, ["$", "aggregate", "failCount"]);
  if (
    aggregate.caseCount !== root.cases.length ||
    aggregate.passCount !== passCount ||
    aggregate.failCount !== failCount
  ) {
    throw new RangeError(
      `assertSuiteReportShape: $.aggregate counts (case ${String(aggregate.caseCount)}, pass ` +
        `${String(aggregate.passCount)}, fail ${String(aggregate.failCount)}) do not match the ` +
        `case results (${root.cases.length} / ${passCount} / ${failCount})`,
    );
  }
  const expectedAggregateVerdict = failCount === 0 ? "PASS" : "FAIL";
  if (aggregateVerdict !== expectedAggregateVerdict) {
    throw new RangeError(
      `assertSuiteReportShape: $.aggregate.verdict is "${aggregateVerdict}" but the cases ` +
        `conjoin to "${expectedAggregateVerdict}" — the aggregate is a STRICT CONJUNCTION`,
    );
  }
  if (!Array.isArray(aggregate.failureReasons)) {
    throw new RangeError("assertSuiteReportShape: $.aggregate.failureReasons must be an array");
  }
  aggregate.failureReasons.forEach((reason, reasonIndex) => {
    const text = requireNonEmptyString(reason, [
      "$",
      "aggregate",
      "failureReasons",
      `[${reasonIndex}]`,
    ]);
    const owner = aggregateReasonPrefixes.find((name) => text.startsWith(`${name}: `));
    if (owner === undefined) {
      throw new RangeError(
        `assertSuiteReportShape: $.aggregate.failureReasons[${reasonIndex}] is not prefixed ` +
          `"caseName: " for a failing case — failure reasons must stay attributed (never swallowed)`,
      );
    }
  });
  for (const name of aggregateReasonPrefixes) {
    const has = (aggregate.failureReasons as readonly unknown[]).some(
      (reason) => typeof reason === "string" && reason.startsWith(`${name}: `),
    );
    if (!has) {
      throw new RangeError(
        `assertSuiteReportShape: the failing case "${name}" contributes no aggregate failure ` +
          "reason — every failing case must be represented",
      );
    }
  }
}
