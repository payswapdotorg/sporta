/**
 * HF003 — the CURRENT-DETECTOR BASELINE runs (Worker A, flight 1).
 *
 * The work item demands the RF-DETR candidate be "compared against the current
 * detector" on the SAME fixture frames. The current detector is the J012
 * license-clean production path `contrast-context-detector`
 * (packages/perception-adapters, pure code, deterministic, CPU-only). This
 * driver runs it — plus the weak `heuristic-color-detector` for context —
 * through the repo's OWN L010 benchmark harness
 * (`@sporta/perception-benchmark.runPerceptionBenchmark`) over:
 *
 * - `synthetic-diagnostic-01` (the Sporta benchmark fixture, scored against
 *   the fixture's exact ground truth by the harness itself);
 * - `fx-001` (the authorized REAL licensed gate clip — CC0, FIFA Beach Soccer
 *   2021 penalty, Wikimedia Commons; no annotations exist, recorded unscored).
 *
 * Frame sampling: stride 10 by decode order (the harness default — the same
 * convention the HF003 python benchmark uses, so the frame sets match).
 *
 * The output (results/baseline-current-detector.json) is committed evidence:
 * latency numbers are wall-clock readings on this benchmark host; the
 * harness's scoring is the repo's own matcher (never re-implemented here).
 *
 * Run: bun scripts/evidence/hf-portfolio/hf003/run-baseline.ts
 * (requires ffmpeg on PATH — the W102 integration-test convention.)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  contrastContextBenchmarkCandidate,
  heuristicColorBenchmarkCandidate,
  loadBenchmarkClip,
  runPerceptionBenchmark,
} from "@sporta/perception-benchmark";
import type { PerceptionBenchmarkRun } from "@sporta/perception-benchmark";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "results");
const STRIDE = 10;

/** Serializes one harness run into the committed evidence shape. */
function runRecord(run: PerceptionBenchmarkRun, candidateRole: string) {
  return {
    candidateRole,
    candidate: run.candidate,
    clip: {
      clipId: run.clip.clipId,
      mediaKind: run.clip.mediaKind,
      licenseId: run.clip.licenseId,
      sha256: run.clip.sha256,
    },
    harnessVersion: run.harnessVersion,
    stride: STRIDE,
    latencyMs: run.latency,
    dropout: run.dropout,
    scoring: run.scoring,
    boundaryNote: run.boundaryNote,
    frames: run.frames.map((frame) => ({
      frameId: frame.frameId,
      presentationMs: frame.presentationMs,
      playerCount: frame.players.length,
      ballCount: frame.balls.length,
      detectMs: frame.detectMs,
      ...(frame.refusalClass !== undefined ? { refusalClass: frame.refusalClass } : {}),
    })),
  };
}

const startedAt = new Date().toISOString();
mkdirSync(OUT_DIR, { recursive: true });

// Sequential runs only (the benchmark-host memory discipline: no parallel jobs).
const runs: ReturnType<typeof runRecord>[] = [];

const fixtureClip = loadBenchmarkClip("synthetic-diagnostic-01");
const fixtureProduction = await runPerceptionBenchmark({
  candidate: contrastContextBenchmarkCandidate(),
  clip: fixtureClip,
  options: { stride: STRIDE },
});
runs.push(runRecord(fixtureProduction, "current-detector (production path)"));

const fixtureWeak = await runPerceptionBenchmark({
  candidate: heuristicColorBenchmarkCandidate(),
  clip: fixtureClip,
  options: { stride: STRIDE },
});
runs.push(runRecord(fixtureWeak, "weak-baseline (context)"));

const realClip = loadBenchmarkClip("fx-001");
const realProduction = await runPerceptionBenchmark({
  candidate: contrastContextBenchmarkCandidate(),
  clip: realClip,
  options: { stride: STRIDE },
});
runs.push(runRecord(realProduction, "current-detector (production path)"));

const record = {
  evidenceId: "hf003-baseline-current-detector",
  purpose:
    "HF003 baseline: the current J012 production detector (contrast-context) " +
    "plus the weak heuristic baseline, run through the repo's own L010 " +
    "harness over the same clips/stride the RF-DETR python benchmark uses",
  host: {
    cpuCores: 2,
    gpu: "none (CPU-only benchmark host)",
    note:
      "latency numbers are wall-clock CPU readings on this benchmark host; " +
      "GPU memory is N/A on this host — process RSS recorded instead",
  },
  startedAtUtc: startedAt,
  completedAtUtc: new Date().toISOString(),
  processRssBytes: process.memoryUsage.rss(),
  runs,
};

const outPath = join(OUT_DIR, "baseline-current-detector.json");
writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");
console.log(`baseline evidence written: ${outPath}`);
for (const run of record.runs) {
  const scoring =
    run.scoring.kind === "ground-truth"
      ? `precision=${run.scoring.precision.toFixed(3)} recall=${run.scoring.recall.toFixed(3)} f1=${run.scoring.f1.toFixed(3)}`
      : "unscored (no annotations)";
  console.log(
    `${run.candidateRole} @ ${run.clip.clipId}: ${scoring}; latency mean=${run.latencyMs.mean.toFixed(1)}ms p50=${run.latencyMs.p50.toFixed(1)}ms p95=${run.latencyMs.p95.toFixed(1)}ms; sampled=${run.dropout.sampledFrames} refused=${run.dropout.refusedFrames} zeroDet=${run.dropout.zeroDetectionFrames}`,
  );
}
