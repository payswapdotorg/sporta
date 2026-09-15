/**
 * The W306 case executor: the end-to-end latency benchmark (W801 harness's
 * live-stream case).
 *
 * Runs the REAL W306 benchmark — `@sporta/latency-benchmark`'s
 * `runLatencyBenchmark`, which drives the REAL W304 streaming pipeline
 * (`RenderOrchestrator` over the W303 gpu-worker protocol through the REAL
 * W502 anime executor) on the controlled live-stream fixture — as ONE bun
 * SUBPROCESS (its `scripts/run-once.ts` entry, the byte-reproducible form the
 * package's own determinism tests spawn). The subprocess's stdout is the
 * benchmark's canonical report bytes; the case parses them through the
 * package's VERSIONED parser (`parseLatencyReport` — strict zod, cross-
 * consistency checks, never a partial parse) and checks the measured stages
 * against the package's SLO candidate table (`checkSloCandidates`) when the
 * policy enables it.
 *
 * MEASURED VALUES — the honest projection (the W403 precedent): the case's
 * `measured` carries the benchmark report's identity, configuration, stage
 * tables, and accounting VERBATIM **except** the per-frame/per-batch `trace`
 * rows, which are dropped. The dropped rows are the raw evidence (200+ KB),
 * byte-reproducible from the benchmark's own pinned fixture (same fixture +
 * clock + pipeline → byte-identical bytes, pinned by the benchmark's
 * determinism suite, in-process and across subprocesses); the stage table
 * kept here is the measured latency evidence. A test pins the projection: the
 * case's measured deep-equals a hand-trimmed copy of the parsed subprocess
 * report, so nothing else is altered.
 *
 * Every timing in the carried evidence is INJECTED-CLOCK domain (the
 * benchmark's own honest boundary — it characterizes the pipeline's
 * algorithmic latency structure on the controlled fixture, never wall-clock
 * or real-network latency; see the benchmark's README/SLOs.md).
 */
import { spawnSync } from "node:child_process";
import {
  REPORT_SCHEMA_TAG as W306_REPORT_SCHEMA_TAG,
  SLO_CANDIDATES,
  SLO_CANDIDATE_PROFILE_ID,
  checkSloCandidates,
  parseLatencyReport,
  serializeLatencyReport,
} from "@sporta/latency-benchmark";
import type { LatencyBenchmarkReport } from "@sporta/latency-benchmark";
import type { CaseOutcome } from "./types";
import type { W306CaseConfig } from "../suite-config";

/** The benchmark's subprocess entry (the package's own byte-reproducible form). */
export const W306_RUN_ONCE_SCRIPT = `${import.meta.dir}/../../../latency-benchmark/scripts/run-once.ts`;

/** The subprocess run's status (mirrors the W403 case's run record). */
export interface W306CaseRunRecord {
  /** The subprocess exit code (0 = success; a non-zero code FAILS the case). */
  readonly exitCode: number;
  /**
   * The subprocess's stderr — on success the benchmark's deterministic human
   * summary; on failure the crash's error text (evidence, never swallowed).
   */
  readonly stderr: string;
  /** The byte length of the canonical report the subprocess emitted. */
  readonly stdoutBytes: number;
}

/** One SLO-candidate verdict, verbatim from the benchmark package. */
export type W306SloVerdict = ReturnType<typeof checkSloCandidates>[number];

/** The W306 case's measured values (the honest projection of the report). */
export interface W306CaseMeasured {
  /** The benchmark run's status (the subprocess evidence). */
  readonly run: W306CaseRunRecord;
  /** The benchmark report's own schema tag (must equal the current parser's). */
  readonly reportSchema: string;
  /** The benchmark identity block, verbatim. */
  readonly benchmark: LatencyBenchmarkReport["benchmark"];
  /** The stage tables (batch + frame + authored source model), verbatim. */
  readonly stages: LatencyBenchmarkReport["stages"];
  /** The accounting blocks (orchestrator stats + frames), verbatim. */
  readonly accounting: LatencyBenchmarkReport["accounting"];
  /** The stage definitions, verbatim (the report is self-describing). */
  readonly stageDefinitions: LatencyBenchmarkReport["stageDefinitions"];
  /**
   * The SLO-candidate verdicts (present iff `policy.checkSloCandidates`;
   * null when disabled — an explicit config value, never a silent default).
   */
  readonly sloVerdicts: readonly W306SloVerdict[] | null;
}

/** The W306 case's thresholds: the benchmark package's candidate table, VERBATIM. */
export interface W306CaseThresholds {
  /** The candidate table's identity (the benchmark package's export). */
  readonly sloProfileId: string;
  /** The candidate table itself, verbatim. */
  readonly candidates: readonly (typeof SLO_CANDIDATES)[number][];
}

/** Projects the parsed benchmark report onto the harness's measured shape. */
export function projectBenchmarkReport(
  report: LatencyBenchmarkReport,
  run: W306CaseRunRecord,
  sloVerdicts: readonly W306SloVerdict[] | null,
): W306CaseMeasured {
  return {
    run,
    reportSchema: report.reportSchema,
    benchmark: report.benchmark,
    stages: report.stages,
    accounting: report.accounting,
    stageDefinitions: report.stageDefinitions,
    sloVerdicts,
  };
}

/**
 * Runs the W306 case: one benchmark subprocess, parsed + validated through
 * the package's versioned parser, checked against the SLO candidates.
 *
 * Fail-loud contract: a non-zero subprocess exit, an unparseable report, a
 * fixture-identity mismatch, or (when enabled) any breached SLO candidate
 * FAILS the case with machine-readable failure reasons — never a silently
 * degraded verdict. (The runner's crash containment still wraps executor
 * throws, but every expected failure path returns a reasoned FAIL.)
 */
export function runW306Case(
  caseConfig: W306CaseConfig,
): CaseOutcome<W306CaseMeasured, W306CaseThresholds> {
  const result = spawnSync(process.execPath, [W306_RUN_ONCE_SCRIPT], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw new RangeError(
      `runW306Case: failed to spawn the benchmark subprocess ` +
        `("${process.execPath} ${W306_RUN_ONCE_SCRIPT}"): ${result.error.message}`,
    );
  }
  const stdout = result.stdout ?? "";
  const run: W306CaseRunRecord = {
    exitCode: result.status ?? -1,
    stderr: result.stderr ?? "",
    stdoutBytes: stdout.length,
  };
  if (run.exitCode !== 0) {
    // A crashing benchmark is a structural FAIL of the case (the harness's
    // crash containment demotes this throw to a failed case result carrying
    // the error class + message — the suite continues; nothing is swallowed).
    throw new RangeError(
      `the benchmark subprocess exited ${String(run.exitCode)} — stderr tail: ` +
        `${run.stderr.slice(-2_000)}`,
    );
  }
  const report = parseLatencyReport(JSON.parse(stdout));
  const measured = projectBenchmarkReport(
    report,
    run,
    caseConfig.policy.checkSloCandidates ? checkSloCandidates(report) : null,
  );
  const failureReasons: string[] = [];
  if (report.reportSchema !== W306_REPORT_SCHEMA_TAG) {
    failureReasons.push(
      `benchmark report schema tag "${report.reportSchema}" is not the current ` +
        `"${W306_REPORT_SCHEMA_TAG}" — the benchmark package drifted from the harness`,
    );
  }
  if (report.benchmark.fixture.profileId !== caseConfig.fixture.benchmark) {
    failureReasons.push(
      `benchmark ran fixture "${report.benchmark.fixture.profileId}" but the suite ` +
        `config declared "${caseConfig.fixture.benchmark}" — the case must run what it declares`,
    );
  }
  if (measured.sloVerdicts !== null) {
    for (const verdict of measured.sloVerdicts) {
      if (!verdict.pass) {
        failureReasons.push(
          `SLO candidate breached: ${verdict.stage} ${verdict.metric} = ` +
            `${String(verdict.measuredMs)}ms > target ${String(verdict.targetMs)}ms`,
        );
      }
    }
  }
  const verdict = failureReasons.length === 0 ? "PASS" : "FAIL";
  return {
    verdict,
    measured,
    thresholds: { sloProfileId: SLO_CANDIDATE_PROFILE_ID, candidates: SLO_CANDIDATES },
    failureReasons,
  };
}

/** Re-canonicalizes a parsed report (the byte form the subprocess emitted). */
export function recanonicalizeBenchmarkReport(report: LatencyBenchmarkReport): string {
  return serializeLatencyReport(report);
}
