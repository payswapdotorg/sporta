/**
 * R607 lane B — the STANDALONE media-toolchain compute worker
 * (DEVELOPMENT-TIME/EVIDENCE ENTRY, not a test): one `Bun.serve` process
 * serving the media-toolchain execution profile of
 * `@sporta/compute-adapter-hosted` on a FIXED local port (3971), with the
 * REAL ffmpeg/ffprobe toolchain resolved via `Bun.which` and the REAL wall
 * clock injected (the transport composition root — the exact shape an
 * external toolchain worker deployment serves, and the counterpart the
 * hosted control plane's `MEDIA_TOOLCHAIN=http + MEDIA_TOOLCHAIN_URL`
 * configuration dispatches to).
 *
 * Run (from this package's directory):
 *
 *   bun run scripts/r607-media-toolchain-worker.ts            # 127.0.0.1:3971
 *   PORT=3972 bun run scripts/r607-media-toolchain-worker.ts  # an alternate fixed port
 *
 * Boot output: the honest descriptor (the MEASURED toolchain resolution +
 * `ffmpeg -version` line + the fail-closed budgets). The process stays up
 * until SIGINT/SIGTERM; every route, envelope, and metering counter is the
 * production `MediaToolchainWorker` application — no test seams, no stubs.
 *
 * Routes (see src/media-http.ts): GET /health, GET /v1/media/adapter,
 * POST /v1/media/jobs/execute, GET /v1/media/jobs/:jobId,
 * GET /v1/media/usage, GET /v1/media/stats.
 */
import { createMediaToolchainServer, createMediaToolchainWorker } from "../src/index";
import { FfmpegTool } from "@sporta/media-platform";

const PORT = Number(process.env["PORT"] ?? 3971);
const HOSTNAME = "127.0.0.1";

const tool = new FfmpegTool();
const worker = createMediaToolchainWorker({ tool, nowMs: Date.now });
const server = createMediaToolchainServer({ worker, port: PORT, hostname: HOSTNAME });

const descriptor = await worker.describe();
const resolved = descriptor.toolchain.resolved
  ? `RESOLVED — ffmpeg '${descriptor.toolchain.ffmpegPath}' / ffprobe '${descriptor.toolchain.ffprobePath}'`
  : "UNRESOLVED — this worker advertises NO operations and refuses every dispatch with the typed ffmpeg-unavailable class (honest, never faked)";
console.log(`[media-toolchain-worker] listening on http://${HOSTNAME}:${server.port}`);
console.log(
  `[media-toolchain-worker] adapter ${descriptor.adapterId} v${descriptor.adapterVersion}, provider ${descriptor.providerId}`,
);
console.log(`[media-toolchain-worker] toolchain: ${resolved}`);
if (descriptor.toolchain.ffmpegVersion !== null) {
  console.log(`[media-toolchain-worker] measured identity: ${descriptor.toolchain.ffmpegVersion}`);
}
console.log(
  `[media-toolchain-worker] budgets: maxExecutionMs=${descriptor.budgets.maxExecutionMs} maxSourceBytes=${descriptor.budgets.maxSourceBytes} maxArtifactBytes=${descriptor.budgets.maxArtifactBytes} maxConcurrentJobs=${descriptor.budgets.maxConcurrentJobs} (ONE ffmpeg at a time — the memory discipline)`,
);
if (!descriptor.toolchain.resolved) {
  // Stay up (the boundary class is served honestly over the wire), but say
  // it loudly: this process is a toolchain-CAPABLE worker ONLY when the
  // binaries resolve.
  console.warn(
    "[media-toolchain-worker] WARNING: ffmpeg/ffprobe did not resolve — every dispatch will refuse (ffmpeg-unavailable); nothing is executed or faked",
  );
}

let stopping = false;
function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  const stats = worker.stats();
  console.log(
    `[media-toolchain-worker] ${signal}: stopping — dispatched=${stats.jobsDispatched} succeeded=${stats.succeeded} failed=${stats.failed} inFlight=${stats.inFlight} usageRecords=${stats.usageRecords} duplicates=${stats.duplicates} capacityRefusals=${stats.capacityRefusals}`,
  );
  server.stop(true);
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
