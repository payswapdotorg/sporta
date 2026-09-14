/**
 * The cross-run evaluation runner (W403).
 *
 * Runs the frozen fixture in SEPARATE bun subprocesses (default 2), collects
 * each run's canonical artifact bytes from the subprocess's stdout, and
 * compares:
 *
 * - every run PAIR through the field-classified comparator (the documented
 *   tolerance — see TOLERANCE.md);
 * - run 1 against the CHECKED-IN GOLDEN baseline artifact (also through the
 *   comparator);
 * - byte-level identity of the canonical serializations (informational
 *   evidence of same-binary determinism — the gate is the tolerance
 *   comparison, and byte-identity is reported, never assumed).
 *
 * The golden FILE is Prettier-formatted for the repo's format check
 * (Prettier's JSON printer is lossless); the byte comparison therefore
 * compares `serializeArtifact(JSON.parse(golden))` against the run's
 * canonical bytes — canonical form to canonical form.
 *
 * Deterministic output: no clock reads, no RNG, no timestamps in any report
 * or message this module produces.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { compareWorldModelArtifacts } from "./compare";
import type { ComparisonReport } from "./compare";
import { serializeArtifact } from "./serialize";
import { DEFAULT_FIXTURE_PATH } from "./fixture";

/** The subprocess entry the runner spawns (package-relative). */
export const RUN_ONCE_SCRIPT = `${import.meta.dir}/../scripts/run-once.ts`;

/** The default checked-in golden baseline (package-relative). */
export const DEFAULT_GOLDEN_PATH = `${import.meta.dir}/../fixtures/golden/w403-golden.json`;

/** Default number of subprocess runs. */
export const DEFAULT_RUNS = 2;

/** Options for {@link runCrossRunEvaluation}. */
export interface RunnerOptions {
  /** Number of subprocess runs (default 2, minimum 2 — a pairwise comparison needs two). */
  readonly runs?: number;
  /** The frozen fixture path (default: the checked-in W403 fixture). */
  readonly fixturePath?: string;
  /** The golden baseline path; `null` disables the golden comparison. */
  readonly goldenPath?: string | null;
  /** The bun executable (default `process.execPath`). */
  readonly bunExecutable?: string;
}

/** One subprocess run's outcome. */
export interface RunRecord {
  /** 1-based run index. */
  readonly runIndex: number;
  /** The subprocess exit code (0 = success). */
  readonly exitCode: number;
  /** The subprocess stderr (empty on success). */
  readonly stderr: string;
  /** The run's canonical artifact bytes (null when the subprocess failed). */
  readonly canonical: string | null;
  /** The parsed artifact (null when the subprocess failed or stdout was unparsable). */
  readonly artifact: unknown;
}

/** One pairwise (or golden) comparison verdict. */
export interface ComparisonOutcome {
  /** Human-identifying label, e.g. `"run 1 ↔ run 2"` or `"run 1 ↔ golden"`. */
  readonly label: string;
  /** The field-classified comparison report. */
  readonly report: ComparisonReport;
  /** Whether the two canonical serializations are byte-identical (informational). */
  readonly byteIdentical: boolean;
}

/** The full cross-run evaluation report (machine-readable; no volatile data). */
export interface EvaluationReport {
  /** Number of subprocess runs completed successfully. */
  readonly runsCompleted: number;
  /** The subprocess run records. */
  readonly runs: readonly RunRecord[];
  /** Pairwise comparisons (run i ↔ run j, i < j). */
  readonly pairwise: readonly ComparisonOutcome[];
  /** The golden comparison (null when disabled or unavailable). */
  readonly golden: ComparisonOutcome | null;
  /** Overall verdict: every comparison passed and every run succeeded. */
  readonly passed: boolean;
  /** Machine-readable failure reasons (empty when passed). */
  readonly failureReasons: readonly string[];
}

/** Runs the frozen fixture once in a bun subprocess, capturing its output. */
function runSubprocessOnce(options: RunnerOptions, runIndex: number): RunRecord {
  const bun = options.bunExecutable ?? process.execPath;
  const fixturePath = options.fixturePath ?? DEFAULT_FIXTURE_PATH;
  const result = spawnSync(bun, [RUN_ONCE_SCRIPT, "--fixture", fixturePath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    return {
      runIndex,
      exitCode: -1,
      stderr: `failed to spawn "${bun}": ${result.error.message}`,
      canonical: null,
      artifact: null,
    };
  }
  const stdout = result.stdout ?? "";
  if (result.status !== 0) {
    return {
      runIndex,
      exitCode: result.status ?? -1,
      stderr: result.stderr ?? "",
      canonical: null,
      artifact: null,
    };
  }
  try {
    return {
      runIndex,
      exitCode: 0,
      stderr: result.stderr ?? "",
      canonical: stdout,
      artifact: JSON.parse(stdout),
    };
  } catch (cause) {
    return {
      runIndex,
      exitCode: -1,
      stderr: `run-once stdout is not valid JSON: ${(cause as Error).message}`,
      canonical: stdout,
      artifact: null,
    };
  }
}

/**
 * Runs the cross-run evaluation. Synchronous (subprocesses run to completion
 * before comparisons); deterministic output.
 */
export function runCrossRunEvaluation(options: RunnerOptions = {}): EvaluationReport {
  const requestedRuns = options.runs ?? DEFAULT_RUNS;
  if (typeof requestedRuns !== "number" || !Number.isInteger(requestedRuns) || requestedRuns < 2) {
    // Fail loud (repo style): a pairwise comparison needs two runs — silently
    // clamping would hide a caller's configuration mistake.
    throw new RangeError(
      `runCrossRunEvaluation: runs must be an integer >= 2 (got ${String(options.runs)})`,
    );
  }
  const runs = requestedRuns;
  const goldenPath = options.goldenPath === undefined ? DEFAULT_GOLDEN_PATH : options.goldenPath;

  const runRecords: RunRecord[] = [];
  for (let i = 1; i <= runs; i += 1) {
    runRecords.push(runSubprocessOnce(options, i));
  }

  const failureReasons: string[] = [];
  const successful = runRecords.filter(
    (record) => record.exitCode === 0 && record.artifact !== null,
  );
  for (const record of runRecords) {
    if (record.exitCode !== 0) {
      failureReasons.push(
        `run ${record.runIndex} failed (exit ${record.exitCode}): ${record.stderr.trim().split("\n").at(-1) ?? ""}`.trim(),
      );
    }
  }

  const pairwise: ComparisonOutcome[] = [];
  for (let i = 0; i < successful.length; i += 1) {
    for (let j = i + 1; j < successful.length; j += 1) {
      const a = successful[i]!;
      const b = successful[j]!;
      const report = compareWorldModelArtifacts(a.artifact, b.artifact);
      if (!report.passed) {
        failureReasons.push(
          `pairwise run ${a.runIndex} ↔ run ${b.runIndex}: ${report.diffCount} diff(s)`,
        );
      }
      pairwise.push({
        label: `run ${a.runIndex} ↔ run ${b.runIndex}`,
        report,
        byteIdentical: a.canonical === b.canonical,
      });
    }
  }

  let golden: ComparisonOutcome | null = null;
  if (goldenPath !== null && successful.length > 0) {
    let goldenCanonical: string;
    try {
      goldenCanonical = serializeArtifact(JSON.parse(readFileSync(goldenPath, "utf8")));
    } catch (cause) {
      failureReasons.push(
        `golden baseline "${goldenPath}" is missing or unparsable: ${(cause as Error).message}`,
      );
      goldenCanonical = "";
    }
    if (goldenCanonical !== "") {
      const first = successful[0]!;
      const report = compareWorldModelArtifacts(JSON.parse(goldenCanonical), first.artifact);
      if (!report.passed) {
        failureReasons.push(
          `golden comparison (run ${first.runIndex}): ${report.diffCount} diff(s)`,
        );
      }
      golden = {
        label: `run ${first.runIndex} ↔ golden`,
        report,
        byteIdentical: goldenCanonical === first.canonical,
      };
    }
  }

  if (successful.length < 2) {
    failureReasons.push(
      `cross-run comparison needs at least 2 successful runs (got ${successful.length})`,
    );
  }

  return {
    runsCompleted: successful.length,
    runs: runRecords,
    pairwise,
    golden,
    passed: failureReasons.length === 0,
    failureReasons,
  };
}

/** Renders a comparison report as deterministic multi-line text (CLI output). */
export function renderComparisonReport(outcome: ComparisonOutcome): string {
  const lines: string[] = [];
  const { report } = outcome;
  lines.push(
    `${outcome.label}: ${report.passed ? "PASSED" : "FAILED"} — ${report.diffCount} diff(s), ` +
      `byte-identical: ${outcome.byteIdentical}`,
  );
  const s = report.summary;
  lines.push(
    `  fields compared: exact ${s.exactFieldsCompared}, count ${s.countFieldsCompared}, ` +
      `epsilon ${s.epsilonFieldsCompared} (max |Δ| ${s.maxAbsDeviation}), ` +
      `set arrays ${s.setArraysCompared}`,
  );
  for (const fieldDiff of report.diffs) {
    lines.push(`  DIFF [${fieldDiff.fieldClass}] ${fieldDiff.path}`);
    lines.push(`    expected: ${fieldDiff.expected}`);
    lines.push(`    actual:   ${fieldDiff.actual}`);
    if (fieldDiff.deviation !== undefined) {
      lines.push(`    deviation: ${fieldDiff.deviation}`);
    }
    lines.push(`    reason: ${fieldDiff.reason}`);
  }
  return lines.join("\n");
}
