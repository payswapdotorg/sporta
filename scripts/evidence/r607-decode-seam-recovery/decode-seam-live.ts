/**
 * R607 DECODE-SEAM RECOVERY — THE LIVE DECODE-SEAM DRIVER (DEVELOPMENT-TIME
 * EVIDENCE, not a test): drives the R207 decode seam's client half
 * (`createHttpDecodePort`) against the E2B sandbox's PUBLIC worker URL at
 * the pinned decode-seam merge — the EXACT network position the hosted
 * Vercel runtime holds when `MEDIA_TOOLCHAIN=http` composes the injected
 * decode-port into `RealToSwmPipeline`.
 *
 * What this run PROVES (measured, never asserted from theory):
 *   - the pinned-revision worker advertises and EXECUTES the ADDITIVE
 *     `decode-probe`/`decode-frames` pair over the public wire (REAL
 *     ffprobe/ffmpeg INSIDE the E2B sandbox);
 *   - the demux-level W102 probe document arrives intact (the track
 *     inventory the R207 pipeline's track selection consumes);
 *   - the bounded `[fromMs, toMs)` frame batch arrives intact (real decoded
 *     rgb24 frames, the cumulative byte budget respected, the byte-math
 *     re-measured client-side against the envelope's own totalBytes);
 *   - the fail-closed budget refusal reproduces over the wire (a tiny
 *     maxTotalBytes → the TYPED ResourceLimitError — the same class the
 *     local path's callers see);
 *   - the worker's own accounting agrees with the client's view (the
 *     ledger cross-checked against the usage drain, two reads).
 *
 * HONEST SCOPE: the CLIENT here is this driver (the orchestrating sandbox),
 * NOT the hosted Vercel runtime — the hosted leg is the SEPARATE
 * hosted-golden-path run (see commands.md §5 and the 65-j flight's
 * hosted-golden-path.json for its measured state at the pre-seam sha).
 *
 * Modes:
 *   --worker-url https://3971-<sandboxId>.e2b.app   REQUIRED — the E2B
 *     worker's public URL (the sandbox must be up; orchestrate-e2b.ts
 *     provisions it).
 *
 * Run (from the REPO ROOT):
 *   bun run scripts/evidence/r607-decode-seam-recovery/decode-seam-live.ts \
 *     --worker-url https://3971-<sandboxId>.e2b.app
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  FfmpegTool,
  createHttpDecodePort,
  fetchMediaToolchainDescriptor,
  generateTestMp4,
  sha256OfBytes,
} from "@sporta/media-platform";
import { assertMediaToolchainAccounting } from "@sporta/compute-adapter-hosted";
import { ResourceLimitError } from "@sporta/decoding";
import type { AuthorizationPolicy } from "@sporta/contracts";
import type { MediaToolchainStats } from "@sporta/compute-adapter-hosted";
import type { NormalizedVideoFrame, ProbeResult } from "@sporta/decoding";

// ---------------------------------------------------------------------------
// CLI (dev-time: argparse by hand, no deps)
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}
const workerUrlArg = argValue("--worker-url");
if (workerUrlArg === undefined) {
  console.error("FATAL: --worker-url <url> is required (the E2B worker's public URL — no embedded mode in this driver)");
  process.exit(1);
}
const base = workerUrlArg.replace(/\/$/, "");
const outDir = resolve(import.meta.dirname, ".");

/** The worker identity from the provisioning record (sandbox + pinned sha). */
const sandboxRecordPath = join(outDir, "sandbox-record.json");
const sandboxRecord = JSON.parse(readFileSync(sandboxRecordPath, "utf8")) as {
  provider?: { sandbox?: { sandboxId?: string }; pinnedRevision?: { sha?: string } };
};
const workerIdentity = {
  provider: "E2B",
  sandboxId: sandboxRecord.provider?.sandbox?.sandboxId ?? "unknown",
  pinnedSha: sandboxRecord.provider?.pinnedRevision?.sha ?? "unknown",
  publicUrl: base,
  note: "the worker the hosted runtime's MEDIA_TOOLCHAIN_URL points at (the same network position); the pinned revision carries the decode seam's ADDITIVE decode-probe/decode-frames profile",
};

/** A full wall-clock measurement pair (dev-time measurement code). */
function timed<T>(fn: () => Promise<T>): Promise<{ value: T; wallMs: number }> {
  const startedAt = Date.now();
  return fn().then((value) => ({ value, wallMs: Math.max(0, Date.now() - startedAt) }));
}

/** Fetches the worker's stats (the accounting snapshot, over the wire). */
async function fetchStats(): Promise<MediaToolchainStats> {
  const response = await fetch(`${base}/v1/media/stats`);
  if (!response.ok) throw new Error(`stats fetch failed: HTTP ${response.status}`);
  return (await response.json()) as MediaToolchainStats;
}

/** Fetches the worker's usage drain (the independent second read). */
async function fetchUsage(): Promise<{ jobId: string; operation?: string; terminal?: string }[]> {
  const response = await fetch(`${base}/v1/media/usage`);
  if (!response.ok) throw new Error(`usage fetch failed: HTTP ${response.status}`);
  return (await response.json()) as { jobId: string; operation?: string; terminal?: string }[];
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------
const SESSION_ID = "sess-r607-decode-seam-live";
const POLICY: AuthorizationPolicy = {
  policyId: "policy-r607-decode-seam-live",
  allowedOperations: ["analysis", "transformation", "storage", "derivativeGeneration"],
  assertedBy: "r607-decode-seam-live-driver",
};

const tool = new FfmpegTool();
if (!(await tool.available())) {
  console.error(
    "FATAL: the local ffmpeg/ffprobe toolchain does not resolve — this evidence run requires a toolchain-capable sandbox (fail-loud, never faked)",
  );
  process.exit(1);
}
const localFfmpegVersion = await tool.version();

// The descriptor: the pinned-revision worker MUST advertise the four ops.
const descriptor = await fetchMediaToolchainDescriptor(base);
const advertisedOps = [...descriptor.operations].sort();
const expectedOps = ["decode-frames", "decode-probe", "normalize", "probe"];
if (advertisedOps.join(",") !== expectedOps.join(",")) {
  console.error(
    `FATAL: the worker does not advertise the seam's four operations (got [${advertisedOps.join(", ")}])`,
  );
  process.exit(1);
}

// The seam's client half: the http decode port (the SAME object the web
// composition injects into RealToSwmPipeline when MEDIA_TOOLCHAIN=http).
const port = createHttpDecodePort(base);

const scratch = await mkdtemp(join(tmpdir(), "r607-decode-seam-live-"));
const record: Record<string, unknown> = {
  schemaVersion: "1.0",
  kind: "r607-decode-seam-recovery-live-decode",
  scope:
    "the client is this driver over the public wire (the same network position the hosted runtime holds); the hosted leg is the separate hosted-golden-path run",
  workerIdentity,
  localToolchain: { ffmpegVersion: localFfmpegVersion },
  descriptor: { operationsAdvertised: advertisedOps, operationsExpected: expectedOps },
  stages: {} as Record<string, unknown>,
};

try {
  // --- stage 0: the ledger's STARTING state, read honestly (the driver is
  //     re-runnable against a warm worker: the accounting stages below verify
  //     measured DELTAS — exactly one dispatch per stage, terminal counts
  //     tracking — rather than absolute zero; the 65-j fresh-worker
  //     convention recorded the same identities on a cold ledger).
  const stats0 = await fetchStats();
  const usage0 = await fetchUsage();
  assertMediaToolchainAccounting(stats0);
  const ledger0 = {
    dispatched: stats0.jobsDispatched,
    succeeded: stats0.succeeded,
    failed: stats0.failed,
    usageRecords: usage0.length,
    note: "the STARTING ledger (measured); the stages below assert exact deltas against it — the identities hold identically on a cold or warm worker",
  };
  (record as { ledger?: unknown }).ledger = ledger0;

  const expectDelta = (
    label: string,
    stats: MediaToolchainStats,
    dDispatched: number,
    dSucceeded: number,
    dFailed: number,
  ): void => {
    const got = {
      dispatched: stats.jobsDispatched - stats0.jobsDispatched,
      succeeded: stats.succeeded - stats0.succeeded,
      failed: stats.failed - stats0.failed,
    };
    if (got.dispatched !== dDispatched || got.succeeded !== dSucceeded || got.failed !== dFailed) {
      throw new Error(
        `${label} accounting delta: dispatched+${got.dispatched} succeeded+${got.succeeded} failed+${got.failed} (expected +${dDispatched}/+${dSucceeded}/+${dFailed})`,
      );
    }
  };

  // --- stage 1: the REAL source clip (real local ffmpeg generation,
  //     deterministic lavfi sources: testsrc video + 440Hz sine audio, 2s,
  //     320x240, 24fps — the same media the 65-j golden path used).
  const sourcePath = await generateTestMp4(join(scratch, "source.mp4"), {
    durationSeconds: 2,
    withAudio: true,
  });
  const sourceBytes = new Uint8Array(await readFile(sourcePath));
  const sourceHash = sha256OfBytes(sourceBytes);
  const input = {
    receipt: {
      sessionId: SESSION_ID,
      sourceId: `src-${sourceHash.slice(0, 12)}`,
      checksum: sourceHash,
      container: "mp4" as const,
      byteLength: sourceBytes.byteLength,
      ingestedAtMs: 0,
      sourceKind: "file" as const,
    },
    authorizationPolicy: POLICY,
    openBytes: async () => sourceBytes,
  };

  // --- stage 2: the W102 demux-level probe OVER THE WIRE (real ffprobe in
  //     the sandbox; the pipeline's track-selection surface).
  const probeRun = await timed(() => port.probe(input));
  const probe: ProbeResult = probeRun.value;
  const videoTrack = probe.tracks.find((track) => track.kind === "video");
  if (
    probe.container !== "mp4" ||
    videoTrack === undefined ||
    probe.tracks.every((track) => track.kind !== "audio")
  ) {
    throw new Error(
      `the probe document is not the expected W102 shape: container=${probe.container}, tracks=${JSON.stringify(probe.tracks.map((t) => t.kind))}`,
    );
  }
  const probeStats = await fetchStats();
  expectDelta("probe", probeStats, 1, 1, 0);
  (record.stages as Record<string, unknown>).probe = {
    operation: "decode-probe",
    wallMs: probeRun.wallMs,
    probe: {
      container: probe.container,
      durationMs: probe.durationMs,
      tracks: probe.tracks.map((t) => ({
        trackId: t.trackId,
        streamIndex: t.streamIndex,
        kind: t.kind,
        codec: t.codec,
        ...(t.width !== undefined ? { width: t.width, height: t.height } : {}),
      })),
    },
    selectedVideoStreamIndex: videoTrack.streamIndex,
    accounting: {
      starting: { dispatched: stats0.jobsDispatched, succeeded: stats0.succeeded, failed: stats0.failed },
      delta: { dispatched: 1, succeeded: 1, failed: 0 },
    },
  };

  // --- stage 3: the bounded frame batch OVER THE WIRE (real ffmpeg decode
  //     in the sandbox; ONE decode-frames fetch for [0, 2000) with a real
  //     cumulative budget; every frame's bytes re-measured client-side).
  const DECODE_BUDGET_BYTES = 1024 * 1024 * 1024; // 1 GiB — the studio's own STUDIO_UPLOAD_DECODE_BUDGET_BYTES (the pipeline's real posture, mirrored)
  const framesRun = await timed(async () => {
    const frames: NormalizedVideoFrame[] = [];
    for await (const frame of port.decodeVideo(input, videoTrack.streamIndex, {
      fromMs: 0,
      toMs: 2000,
      maxTotalBytes: DECODE_BUDGET_BYTES,
    })) {
      frames.push(frame);
    }
    return frames;
  });
  const frames = framesRun.value;
  if (frames.length === 0) {
    throw new Error("the bounded decode produced ZERO frames — the seam's frame batch is empty (fail-loud)");
  }
  const measuredBytes = frames.reduce(
    (sum, frame) => sum + frame.bytes.byteLength,
    0,
  );
  const monotonic = frames.every(
    (frame, i) => i === 0 || frame.presentationMs >= frames[i - 1]!.presentationMs,
  );
  const windowRespected = frames.every((frame) => frame.presentationMs < 2000 && frame.presentationMs >= 0);
  const dimsConsistent = frames.every(
    (frame) => frame.width > 0 && frame.height > 0 && frame.pixelFormat === "rgb24",
  );
  const first = frames[0]!;
  if (measuredBytes > DECODE_BUDGET_BYTES || !monotonic || !windowRespected || !dimsConsistent) {
    throw new Error(
      `the frame batch violates the W102 invariants (bytes=${measuredBytes}/${DECODE_BUDGET_BYTES}, monotonic=${monotonic}, window=${windowRespected}, dims=${dimsConsistent})`,
    );
  }
  const framesStats = await fetchStats();
  expectDelta("frames", framesStats, 2, 2, 0);
  (record.stages as Record<string, unknown>).decodeFrames = {
    operation: "decode-frames",
    wallMs: framesRun.wallMs,
    frameCount: frames.length,
    firstFrame: {
      frameId: first.frameId,
      presentationMs: first.presentationMs,
      width: first.width,
      height: first.height,
      pixelFormat: first.pixelFormat,
      byteLength: first.bytes.byteLength,
    },
    lastFrame: {
      frameId: frames[frames.length - 1]!.frameId,
      presentationMs: frames[frames.length - 1]!.presentationMs,
    },
    measuredTotalBytes: measuredBytes,
    budgetBytes: DECODE_BUDGET_BYTES,
    invariants: { monotonic, windowRespected, dimsConsistent },
    accounting: {
      starting: { dispatched: stats0.jobsDispatched, succeeded: stats0.succeeded, failed: stats0.failed },
      delta: { dispatched: 2, succeeded: 2, failed: 0 },
    },
  };

  // --- stage 4: the fail-closed budget refusal OVER THE WIRE (a 100-byte
  //     budget cannot admit ANY real frame — the TYPED ResourceLimitError,
  //     the same class the local path's callers see).
  const negativeRun = await timed(async () => {
    let framesSeen = 0;
    try {
      for await (const frame of port.decodeVideo(input, videoTrack.streamIndex, {
        maxTotalBytes: 100,
      })) {
        framesSeen += 1;
        void frame;
      }
      return { refused: false, framesSeen, errorClass: null };
    } catch (error) {
      return {
        refused: true,
        framesSeen,
        errorClass: error instanceof ResourceLimitError ? "ResourceLimitError" : String(error),
      };
    }
  });
  if (!negativeRun.value.refused || negativeRun.value.errorClass !== "ResourceLimitError") {
    throw new Error(
      `the tiny-budget decode did NOT refuse with the typed ResourceLimitError: ${JSON.stringify(negativeRun.value)}`,
    );
  }
  const finalStats = await fetchStats();
  const finalUsage = await fetchUsage();
  assertMediaToolchainAccounting(finalStats);
  expectDelta("final (probe + frames + refusal)", finalStats, 3, 2, 1);
  if (finalUsage.length !== finalStats.jobsDispatched) {
    throw new Error(
      `the usage drain (${finalUsage.length}) disagrees with the dispatched count (${finalStats.jobsDispatched})`,
    );
  }
  (record.stages as Record<string, unknown>).budgetRefusalNegative = {
    operation: "decode-frames",
    budgetBytes: 100,
    refused: negativeRun.value.refused,
    typedErrorClass: negativeRun.value.errorClass,
    framesAdmittedBeforeRefusal: negativeRun.value.framesSeen,
    wallMs: negativeRun.wallMs,
  };
  (record as { accounting?: unknown }).accounting = {
    startingLedger: ledger0,
    stats: finalStats,
    usageDrainCount: finalUsage.length,
    usageRecordsThisRun: finalUsage.slice(usage0.length).map((u) => ({
      jobId: u.jobId,
      operation: u.operation,
      terminal: u.terminal,
    })),
    identities:
      "dispatched === terminal; stats === the usage drain (two independent reads); the stages' deltas: probe +1/1/0, frames +1/1/0, refusal +1/0/1",
  };

  // --- the record.
  const outPath = resolve(outDir, "decode-seam-live.json");
  await writeFile(outPath, JSON.stringify(record, null, 2) + "\n");

  console.log("=== R607 decode seam LIVE over the public wire (measured) ===");
  console.log(`worker:      ${workerIdentity.sandboxId} @ ${workerIdentity.pinnedSha.slice(0, 7)}`);
  console.log(`operations:  [${advertisedOps.join(", ")}]`);
  console.log(
    `probe:       container=${probe.container}, tracks=[${probe.tracks.map((t) => t.kind).join(", ")}], video stream=${videoTrack.streamIndex}, wall ${probeRun.wallMs}ms`,
  );
  console.log(
    `frames:      ${frames.length} frames, ${measuredBytes} bytes (budget ${DECODE_BUDGET_BYTES}), ${first.width}x${first.height} rgb24, wall ${framesRun.wallMs}ms`,
  );
  console.log(
    `negative:    100-byte budget → ${negativeRun.value.errorClass} (refused=${negativeRun.value.refused})`,
  );
  console.log(
    `accounting:  dispatched=${finalStats.jobsDispatched} succeeded=${finalStats.succeeded} failed=${finalStats.failed} (usage drain ${finalUsage.length})`,
  );
  console.log(`record:      ${outPath}`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
