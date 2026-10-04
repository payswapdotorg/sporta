/**
 * THE MEDIA TOOLCHAIN DECODE-OPERATION TESTS (R607 Gap 1 — the TL-authorized
 * decode seam): the worker's `decode-probe` / `decode-frames` legs executing
 * the REAL ffmpeg/ffprobe over real HTTP (a `Bun.serve` socket, a REAL MP4
 * produced in-test by the real ffmpeg — no committed fixtures), the same
 * conventions as `./media-toolchain.test.ts`:
 *
 * 1. THE GOLDEN PATH: the decode-probe answers the W102 `ProbeResult`
 *    document (the exact shape the R207 pipeline's track selection
 *    consumes); the decode-frames answers ONE bounded frame batch for the
 *    dispatched window — the frames' byte math (`w*h*3`), the canonical
 *    frame ids, the CFR presentation timeline, the metering's
 *    decodedFrames/decodedFrameBytes axes, the worker ledger + accounting.
 * 2. THE FAIL-CLOSED FRAME BUDGET: a window whose byte budget admits fewer
 *    frames than the window contains refuses with the typed
 *    `frame-budget-exceeded` class (resource-limit; outputs discarded,
 *    never truncated silently) — the W914 budget doctrine's frame axis.
 * 3. THE SHARED FAIL-CLOSED STEPS still hold for decode dispatches: a lying
 *    source claim is never interpreted; a rights-denying posture refuses
 *    before any tool runs; idempotent re-POSTs answer the SAME envelope.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FfmpegTool,
  MediaToolchainDispatchRequest,
  MediaToolchainResult,
  generateTestMp4,
  sha256OfBytes,
} from "@sporta/media-platform";
import type { MediaToolchainDispatchRequest as DispatchDoc } from "@sporta/media-platform";
import {
  MediaToolchainWorker,
  assertMediaToolchainAccounting,
  createMediaToolchainServer,
  createMediaToolchainWorker,
} from "../src/index";

/** Whether the REAL ffmpeg is usable in this environment. */
const tool = new FfmpegTool();
const hasFfmpeg = await tool.available();

/** A full-rights policy fixture (the fail-closed derivation allows all). */
const FULL_POSTURE = {
  policyRef: "media-decode-seam-test",
  canReferenceSourceFrames: true,
};

/** Deterministic job-id counter (the ledger's idempotence keys). */
let jobSeq = 0;
function nextJobId(prefix: string): string {
  jobSeq += 1;
  return `${prefix}-${String(jobSeq).padStart(3, "0")}`;
}

/** The real worker + served socket this battery drives. */
function realWorker(): MediaToolchainWorker {
  return createMediaToolchainWorker({ tool, nowMs: Date.now });
}

/** Builds a decode dispatch over the given real MP4 bytes. */
function decodeDispatch(
  bytes: Uint8Array,
  operation: "decode-probe" | "decode-frames",
  overrides: {
    window?: { streamIndex: number; fromMs?: number; toMs?: number; maxTotalBytes: number };
    contentHash?: string;
    byteSize?: number;
    rights?: { policyRef: string; canReferenceSourceFrames: boolean };
  } = {},
): DispatchDoc {
  const dispatch: DispatchDoc = {
    job: {
      schemaVersion: "1.0",
      jobId: nextJobId("decode"),
      idempotencyKey: nextJobId("decode-key"),
      sessionId: "sess-media-decode-test",
      operation,
      source: {
        contentHash: overrides.contentHash ?? sha256OfBytes(bytes),
        byteSize: overrides.byteSize ?? bytes.byteLength,
        container: "mp4",
      },
      rights: overrides.rights ?? FULL_POSTURE,
      constraints: { deadlineMs: 120_000, priority: 0 },
      mediaPolicy: { maxDurationMs: 120_000 },
      ...(overrides.window !== undefined ? { decodeWindow: overrides.window } : {}),
    },
    source: {
      inputId: "source-media",
      kind: "source-media",
      contentBase64: Buffer.from(bytes).toString("base64"),
    },
  };
  return MediaToolchainDispatchRequest.parse(dispatch);
}

/** Generates a REAL small MP4 (160x120 @ 12fps, 2s) and reads it back. */
async function realMp4Bytes(): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), "sporta-media-decode-test-"));
  try {
    const path = await generateTestMp4(join(dir, "clip.mp4"), {
      durationSeconds: 2,
      withAudio: true,
      width: 160,
      height: 120,
      frameRate: 12,
    });
    const file = Bun.file(path);
    return new Uint8Array(await file.arrayBuffer());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("the media toolchain decode operations (R607 Gap 1 — REAL ffmpeg over the wire)", () => {
  test.skipIf(!hasFfmpeg)(
    "decode-probe answers the W102 ProbeResult document the R207 pipeline consumes",
    async () => {
      const worker = realWorker();
      const server = createMediaToolchainServer({ worker, port: 0 });
      try {
        const bytes = await realMp4Bytes();
        const dispatch = decodeDispatch(bytes, "decode-probe");
        const response = await fetch(`http://127.0.0.1:${server.port}/v1/media/jobs/execute`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(dispatch),
        });
        expect(response.status).toBe(200);
        const body = (await response.json()) as { disposition: string; result: unknown };
        expect(body.disposition).toBe("executed");
        const envelope = MediaToolchainResult.parse(body.result);
        expect(envelope.status).toBe("succeeded");
        expect(envelope.operation).toBe("decode-probe");
        expect(envelope.decodeProbe).toBeDefined();
        const probe = envelope.decodeProbe!;
        // The W102 document: the video + audio track inventory, the mp4
        // container, the measured whole-source duration.
        expect(probe.container).toBe("mp4");
        expect(probe.tracks.length).toBe(2);
        expect(probe.tracks[0]!.kind).toBe("video");
        expect(probe.tracks[0]!.streamIndex).toBe(0);
        expect(probe.tracks[0]!.trackId).toBe("t-0-video");
        expect(probe.tracks[1]!.kind).toBe("audio");
        expect(probe.durationMs).toBeGreaterThanOrEqual(1900);
        expect(probe.durationMs).toBeLessThanOrEqual(2100);
        // One REAL ffprobe run, no ffmpeg, nothing outbound.
        expect(envelope.metering.ffprobeRuns).toBe(1);
        expect(envelope.metering.ffmpegRuns).toBe(0);
        expect(envelope.metering.outputBytes).toBe(0);
        // The worker's ledger + accounting identities hold.
        const stats = worker.stats();
        assertMediaToolchainAccounting(stats);
        expect(stats.succeeded).toBe(1);
        expect(stats.probeRuns).toBe(1);
      } finally {
        server.stop(true);
      }
    },
  );

  test.skipIf(!hasFfmpeg)(
    "decode-frames answers ONE bounded batch: the byte math, the canonical ids, the metering",
    async () => {
      const worker = realWorker();
      const server = createMediaToolchainServer({ worker, port: 0 });
      try {
        const bytes = await realMp4Bytes();
        // A 1-second window at 12fps: ~12 frames of 160x120 rgb24 (57 600 B).
        const dispatch = decodeDispatch(bytes, "decode-frames", {
          window: { streamIndex: 0, fromMs: 0, toMs: 1000, maxTotalBytes: 1024 * 1024 },
        });
        const response = await fetch(`http://127.0.0.1:${server.port}/v1/media/jobs/execute`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(dispatch),
        });
        expect(response.status).toBe(200);
        const body = (await response.json()) as { disposition: string; result: unknown };
        const envelope = MediaToolchainResult.parse(body.result);
        expect(envelope.status).toBe("succeeded");
        expect(envelope.operation).toBe("decode-frames");
        const batch = envelope.decodedFrames!;
        expect(batch.frames.length).toBeGreaterThanOrEqual(11);
        expect(batch.frames.length).toBeLessThanOrEqual(13);
        const first = batch.frames[0]!;
        const frameBytes = Buffer.from(first.contentBase64, "base64");
        // The rgb24 byte-math invariant, verified at the RECEIVING boundary.
        expect(frameBytes.byteLength).toBe(first.width * first.height * 3);
        expect(first.width).toBe(160);
        expect(first.height).toBe(120);
        expect(first.frameId).toBe("f-0-0");
        expect(first.streamIndex).toBe(0);
        expect(first.presentationMs).toBe(0);
        // The CFR presentation timeline: decodeOrder n at n * (1000/12)ms.
        const second = batch.frames[1]!;
        expect(second.decodeOrder).toBe(1);
        expect(second.presentationMs).toBeCloseTo(1000 / 12, 5);
        // The measured totals + the metering's frame axes agree.
        let measured = 0;
        for (const frame of batch.frames) {
          measured += Buffer.from(frame.contentBase64, "base64").byteLength;
        }
        expect(measured).toBe(batch.totalBytes);
        expect(envelope.metering.decodedFrames).toBe(batch.frames.length);
        expect(envelope.metering.decodedFrameBytes).toBe(batch.totalBytes);
        expect(envelope.metering.outputBytes).toBe(batch.totalBytes);
        // One REAL ffmpeg run (the rawvideo decode) + one targeted ffprobe
        // (the adapter's geometry resolution).
        expect(envelope.metering.ffmpegRuns).toBe(1);
        expect(envelope.metering.ffprobeRuns).toBe(1);
        // The worker ledger + accounting identities hold.
        assertMediaToolchainAccounting(worker.stats());
        expect(worker.stats()!.outputBytes).toBe(batch.totalBytes);
      } finally {
        server.stop(true);
      }
    },
  );

  test.skipIf(!hasFfmpeg)(
    "the fail-closed frame budget refuses an over-budget window (outputs discarded, never truncated)",
    async () => {
      const worker = realWorker();
      const server = createMediaToolchainServer({ worker, port: 0 });
      try {
        const bytes = await realMp4Bytes();
        // The budget admits exactly ONE 160x120 rgb24 frame; the 1s window
        // contains ~12 — the batch must be refused, not truncated.
        const dispatch = decodeDispatch(bytes, "decode-frames", {
          window: { streamIndex: 0, fromMs: 0, toMs: 1000, maxTotalBytes: 57_600 },
        });
        const response = await fetch(`http://127.0.0.1:${server.port}/v1/media/jobs/execute`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(dispatch),
        });
        expect(response.status).toBe(200);
        const body = (await response.json()) as { disposition: string; result: unknown };
        const envelope = MediaToolchainResult.parse(body.result);
        expect(envelope.status).toBe("failed");
        expect(envelope.failure!.errorClass).toBe("frame-budget-exceeded");
        expect(envelope.failure!.failureClass).toBe("resource-limit");
        expect(envelope.failure!.terminal).toBe("non-retryable");
        // Nothing was delivered.
        expect(envelope.decodedFrames).toBeUndefined();
        expect(envelope.metering.outputBytes).toBe(0);
        assertMediaToolchainAccounting(worker.stats());
      } finally {
        server.stop(true);
      }
    },
  );

  test.skipIf(!hasFfmpeg)(
    "a lying source claim on a decode dispatch is never interpreted (the shared fail-closed steps)",
    async () => {
      const worker = realWorker();
      const server = createMediaToolchainServer({ worker, port: 0 });
      try {
        const bytes = await realMp4Bytes();
        const dispatch = decodeDispatch(bytes, "decode-probe", {
          contentHash: "0000000000000000000000000000000000000000000000000000000000000000",
        });
        const response = await fetch(`http://127.0.0.1:${server.port}/v1/media/jobs/execute`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(dispatch),
        });
        expect(response.status).toBe(200);
        const body = (await response.json()) as { disposition: string; result: unknown };
        const envelope = MediaToolchainResult.parse(body.result);
        expect(envelope.status).toBe("failed");
        expect(envelope.failure!.errorClass).toBe("source-hash-mismatch");
        expect(envelope.failure!.failureClass).toBe("internal");
      } finally {
        server.stop(true);
      }
    },
  );

  test.skipIf(!hasFfmpeg)(
    "a rights-denying decode posture refuses before any tool runs",
    async () => {
      const worker = realWorker();
      const server = createMediaToolchainServer({ worker, port: 0 });
      try {
        const bytes = await realMp4Bytes();
        const dispatch = decodeDispatch(bytes, "decode-frames", {
          window: { streamIndex: 0, maxTotalBytes: 1024 * 1024 },
          rights: { policyRef: "denied", canReferenceSourceFrames: false },
        });
        const response = await fetch(`http://127.0.0.1:${server.port}/v1/media/jobs/execute`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(dispatch),
        });
        expect(response.status).toBe(200);
        const body = (await response.json()) as { disposition: string; result: unknown };
        const envelope = MediaToolchainResult.parse(body.result);
        expect(envelope.status).toBe("failed");
        expect(envelope.failure!.errorClass).toBe("rights-denied");
        // Refused BEFORE any tool ran.
        expect(envelope.metering.ffprobeRuns).toBe(0);
        expect(envelope.metering.ffmpegRuns).toBe(0);
      } finally {
        server.stop(true);
      }
    },
  );

  test.skipIf(!hasFfmpeg)(
    "idempotence: a re-POST of a decode job answers the SAME envelope, counted",
    async () => {
      const worker = realWorker();
      const server = createMediaToolchainServer({ worker, port: 0 });
      try {
        const bytes = await realMp4Bytes();
        const dispatch = decodeDispatch(bytes, "decode-probe");
        const post = () =>
          fetch(`http://127.0.0.1:${server.port}/v1/media/jobs/execute`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(dispatch),
          });
        const first = await post();
        const firstBody = (await first.json()) as { disposition: string; result: unknown };
        const second = await post();
        const secondBody = (await second.json()) as {
          disposition: string;
          result: unknown;
          duplicateExecutions: number;
        };
        expect(firstBody.disposition).toBe("executed");
        expect(secondBody.disposition).toBe("duplicate");
        expect(secondBody.duplicateExecutions).toBe(1);
        expect(JSON.stringify(secondBody.result)).toBe(JSON.stringify(firstBody.result));
        // The worker ledger: one executed job + one counted duplicate.
        const stats = worker.stats();
        assertMediaToolchainAccounting(stats);
        expect(stats.jobsDispatched).toBe(1);
        expect(stats.duplicates).toBe(1);
      } finally {
        server.stop(true);
      }
    },
  );
});
