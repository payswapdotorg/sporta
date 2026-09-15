/**
 * The REAL-benchmark integration pins (the W306 evidence, live): one run of
 * the real pipeline (`runLatencyBenchmark` — the checked-in evidence
 * configuration; no mocks anywhere in the chain), pinning
 *
 * - the LIVE stage tables to the SLO baselines (`BASELINE_BATCH_STATS` /
 *   `BASELINE_FRAME_STATS` in ./helpers, and every `baselineMs` in
 *   `SLO_DEFINITIONS`) — the benchmark and the SLO table cannot drift apart
 *   silently;
 * - the report's own stage vocabulary against the mirrored input keys;
 * - the full consumer path: project → validate → evaluate → the compliant
 *   verdict (also through the canonical serialized bytes — the from-disk
 *   consumer path);
 * - the operator CLI (`scripts/evaluate.ts`) over the REAL report bytes:
 *   exit 0 + the machine-readable compliance on stdout + the deterministic
 *   human summary on stderr, byte-identical across two subprocess runs;
 *   garbage input fails loud with exit 3.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLatencyBenchmark } from "@sporta/latency-benchmark";
import {
  BATCH_STAGE_KEYS,
  FRAME_STAGE_KEYS,
  parseLatencySloInput,
  projectBenchmarkReport,
  type LatencySloInput,
  type LatencyStatsSubset,
} from "../src/input";
import { evaluateSloCompliance, renderComplianceSummary } from "../src/evaluate";
import { SLO_DEFINITIONS, SLO_SET_ID } from "../src/slos";
import { BASELINE_BATCH_STATS, BASELINE_FRAME_STATS } from "./helpers";

/** The report's stage entry shape (count + min/max + p50/p95), by key. */
type StageTable = Record<string, LatencyStatsSubset>;

/** Reads one percentile of one stage from a stage table (fail-loud on a missing key). */
function stageMetric(table: StageTable, stage: string, metric: "p50Ms" | "p95Ms"): number {
  const stats = table[stage];
  if (stats === undefined) {
    throw new RangeError(`the live report carries no stats for stage "${stage}"`);
  }
  return stats[metric];
}

describe("the live evidence run (the checked-in fixture + pipeline)", () => {
  test("completes, balances, and measures the pinned sample sizes", async () => {
    const run = await runLatencyBenchmark();
    expect(run.report.benchmark.orchestratorOutcome).toBe("completed");
    expect(run.report.benchmark.fixture.profileId).toBe("w306-live-fixture");
    expect(run.report.benchmark.fixture.seed).toBe("w306-live-fixture-v1");
    const frames = run.report.accounting.frames;
    expect(frames.framesIn).toBe(240);
    expect(frames.framesEmitted).toBe(240);
    expect(frames.framesSkippedStale).toBe(0);
    expect(frames.framesDropped).toBe(0);
    expect(frames.framesCancelled).toBe(0);
    expect(frames.framesDuplicate).toBe(0);
    expect(run.report.stages.batch["end-to-end"]!.count).toBe(140);
    expect(run.report.stages.frame["end-to-end"]!.count).toBe(240);
  });

  test("the live stage tables ARE the SLO baselines (batch and frame, row for row)", async () => {
    const run = await runLatencyBenchmark();
    expect(run.report.stages.batch).toEqual(BASELINE_BATCH_STATS);
    expect(run.report.stages.frame).toEqual(BASELINE_FRAME_STATS);
  });

  test("every SLO's baselineMs IS the live measured value (16 objectives, metric for metric)", async () => {
    const run = await runLatencyBenchmark();
    for (const slo of SLO_DEFINITIONS) {
      const table = slo.scope === "batch" ? run.report.stages.batch : run.report.stages.frame;
      const metric = slo.metric === "p95" ? "p95Ms" : "p50Ms";
      expect(stageMetric(table, slo.stage, metric)).toBe(slo.baselineMs);
    }
  });

  test("the report's stage vocabulary IS the mirrored input vocabulary (both scopes)", async () => {
    const run = await runLatencyBenchmark();
    expect(new Set(Object.keys(run.report.stages.batch))).toEqual(new Set(BATCH_STAGE_KEYS));
    expect(new Set(Object.keys(run.report.stages.frame))).toEqual(new Set(FRAME_STAGE_KEYS));
  });
});

describe("the full consumer path over the REAL report (project → validate → evaluate)", () => {
  test("the projected input validates and the live window is compliant: 16/16 met, no alerts", async () => {
    const run = await runLatencyBenchmark();
    const input = parseLatencySloInput(projectBenchmarkReport(run.report));
    const report = evaluateSloCompliance(input);
    expect(report.sloSetId).toBe(SLO_SET_ID);
    expect(report.summary).toEqual({
      sloCount: 16,
      metCount: 16,
      breachedCount: 0,
      warningAlertCount: 0,
      criticalAlertCount: 0,
      verdict: "compliant",
    });
    expect(report.window.fixtureProfileId).toBe("w306-live-fixture");
  });

  test("the canonical serialized bytes take the same path to the same verdict (the from-disk consumer)", async () => {
    const run = await runLatencyBenchmark();
    const input = parseLatencySloInput(
      projectBenchmarkReport(
        JSON.parse(run.serialized) as Parameters<typeof projectBenchmarkReport>[0],
      ),
    );
    expect(evaluateSloCompliance(input).summary.verdict).toBe("compliant");
  });

  test("the in-process summary over the live window is stable (deterministic text)", async () => {
    const run = await runLatencyBenchmark();
    const input: LatencySloInput = parseLatencySloInput(projectBenchmarkReport(run.report));
    expect(renderComplianceSummary(evaluateSloCompliance(input))).toBe(
      renderComplianceSummary(evaluateSloCompliance(input)),
    );
  });
});

describe("the operator CLI over the REAL report bytes (scripts/evaluate.ts)", () => {
  const CLI = join(import.meta.dir, "..", "scripts", "evaluate.ts");
  const REPORT_PATH = join(tmpdir(), "sporta-slo-cli-test-report.json");
  const GARBAGE_PATH = join(tmpdir(), "sporta-slo-cli-test-garbage.json");

  test("exit 0 on the compliant live window: machine report on stdout, human summary on stderr", async () => {
    const run = await runLatencyBenchmark();
    writeFileSync(REPORT_PATH, run.serialized);
    try {
      const cli = spawnSync(process.execPath, [CLI, REPORT_PATH], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      expect(cli.status).toBe(0);
      const parsed = JSON.parse(cli.stdout) as {
        sloSetId?: string;
        summary?: { verdict?: string };
      };
      expect(parsed.sloSetId).toBe(SLO_SET_ID);
      expect(parsed.summary?.verdict).toBe("compliant");
      expect(cli.stderr).toContain("W802 latency SLO compliance");
      expect(cli.stderr).toContain("verdict compliant");
    } finally {
      rmSync(REPORT_PATH, { force: true });
    }
  });

  test("two CLI runs over the same report are byte-identical (determinism through the CLI seam)", async () => {
    const run = await runLatencyBenchmark();
    writeFileSync(REPORT_PATH, run.serialized);
    try {
      const first = spawnSync(process.execPath, [CLI, REPORT_PATH], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      const second = spawnSync(process.execPath, [CLI, REPORT_PATH], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      expect(first.status).toBe(0);
      expect(second.status).toBe(0);
      expect(first.stdout).toBe(second.stdout);
      expect(first.stderr).toBe(second.stderr);
    } finally {
      rmSync(REPORT_PATH, { force: true });
    }
  });

  test("garbage input fails loud: exit 3, the usage message on stderr", () => {
    writeFileSync(GARBAGE_PATH, "not json at all");
    try {
      const cli = spawnSync(process.execPath, [CLI, GARBAGE_PATH], { encoding: "utf8" });
      expect(cli.status).toBe(3);
      expect(cli.stderr).toContain("slo-evaluate:");
    } finally {
      rmSync(GARBAGE_PATH, { force: true });
    }
  });

  test("a missing argument fails loud: exit 3", () => {
    const cli = spawnSync(process.execPath, [CLI], { encoding: "utf8" });
    expect(cli.status).toBe(3);
    expect(cli.stderr).toContain("usage:");
  });
});
