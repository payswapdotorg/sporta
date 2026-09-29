/**
 * THE MEDIA TOOLCHAIN SEAM TESTS (R607 lane B — the W914 http compute
 * adapter seam): the in-process DEFAULT (the non-degradation law — REAL
 * ffmpeg, the same measured outcomes as the direct tool), the HTTP CLIENT
 * against a controlled stub worker speaking the wire schema (validation,
 * error mapping, the lying-provider and transport-fault postures — the
 * REAL worker round trip lives in `@sporta/compute-adapter-hosted`'s
 * battery, which drives this package's client against ITS worker), and
 * the env-driven composition root.
 *
 * Honesty note: the stub tests use a controlled `Bun.serve` answering
 * schema-valid envelopes with REAL hashes over the bytes it actually
 * returns — the client's validation and verification logic runs for real;
 * the media semantics (real ffprobe/ffmpeg) are proven by the in-process
 * tests here and the real-worker integration tests there.
 */
import { describe, expect, test } from "bun:test";
import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FfmpegTool,
  InMemoryStorage,
  InProcessMediaToolchain,
  MediaIntegrityError,
  MediaPlatformService,
  MediaToolchainResourceError,
  MediaToolchainResult,
  SqliteMediaPlatformStore,
  FfmpegUnavailableError,
  createHttpMediaToolchain,
  generateTestMp4,
  mediaToolchainSelectionOf,
  normalizedMediaKey,
  resolveMediaToolchainFromEnv,
  sha256OfBytes,
} from "../src/index";
import type { MediaToolchainDispatchRequest } from "../src/index";
import type { AuthorizationPolicy } from "@sporta/contracts";

/** Whether the REAL ffmpeg is usable in this environment. */
const tool = new FfmpegTool();
const hasFfmpeg = await tool.available();

/** A full-rights policy fixture (the fail-closed derivation allows all). */
const FULL_POLICY: AuthorizationPolicy = {
  policyId: "policy-toolchain-test-full",
  allowedOperations: ["analysis", "transformation", "storage", "derivativeGeneration"],
  assertedBy: "test",
};

/** Generates REAL MP4 bytes in a temp file and reads them back. */
async function realMp4Bytes(
  options: { durationSeconds?: number; withAudio?: boolean } = {},
): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), "sporta-toolchain-test-media-"));
  try {
    const path = await generateTestMp4(join(dir, "clip.mp4"), options);
    const file = Bun.file(path);
    return new Uint8Array(await file.arrayBuffer());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A schema-valid measured probe document (the stub worker's answer). */
function stubProbe(): {
  durationMs: number;
  videoStreams: Array<Record<string, unknown>>;
  audioStreams: Array<Record<string, unknown>>;
  frameRateFps: number;
  frameCount: number;
  raw: { streams: Array<Record<string, unknown>> };
} {
  const video = {
    index: 0,
    codec_type: "video",
    codec_name: "h264",
    width: 320,
    height: 240,
    avg_frame_rate: "24/1",
    r_frame_rate: "24/1",
    nb_frames: "48",
    duration: "2.000000",
  };
  const audio = {
    index: 1,
    codec_type: "audio",
    codec_name: "aac",
    channels: 2,
    sample_rate: "48000",
    duration: "2.000000",
  };
  return {
    durationMs: 2000,
    videoStreams: [video],
    audioStreams: [audio],
    frameRateFps: 24,
    frameCount: 48,
    raw: { streams: [video, audio] },
  };
}

/**
 * The controlled stub worker: answers the wire schema with envelopes whose
 * hashes are REAL over the bytes actually delivered (the "normalize"
 * answer echoes the received source bytes — the client's verification runs
 * for real; the real transcode is proven elsewhere). Behavior is scripted
 * per test via `mode`:
 * - "ok" — schema-valid success envelopes;
 * - "lie-hash" — a normalize success with a WRONG content hash;
 * - "ffmpeg-unavailable" — a classified failure envelope;
 * - "capacity" — an HTTP 503 capacity refusal;
 * - "garbage" — an HTTP 200 non-envelope body.
 */
function startStubWorker(mode: "ok" | "lie-hash" | "ffmpeg-unavailable" | "capacity" | "garbage"): {
  url: string;
  server: Bun.Server<undefined>;
} {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request): Promise<Response> {
      if (new URL(request.url).pathname !== "/v1/media/jobs/execute") {
        return new Response(JSON.stringify({ error: { errorClass: "unknown-route" } }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      const parsed = JSON.parse(await request.text()) as MediaToolchainDispatchRequest;
      if (mode === "capacity") {
        return new Response(
          JSON.stringify({
            error: {
              errorClass: "capacity",
              message: "worker is executing 1 jobs (budget 1) — retry later",
              terminal: "resource-limit",
            },
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        );
      }
      if (mode === "garbage") {
        return new Response(JSON.stringify({ disposition: "executed", result: { nope: true } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (mode === "ffmpeg-unavailable") {
        const body = {
          disposition: "executed",
          result: {
            jobId: parsed.job.jobId,
            operation: parsed.job.operation,
            status: "failed",
            failure: {
              errorClass: "ffmpeg-unavailable",
              message: "ffmpeg is not usable at '/nonexistent/ffmpeg' — never faked",
              terminal: "internal",
              failureClass: "internal",
              retryable: false,
            },
            metering: {
              startedAtMs: 1700000000000,
              finishedAtMs: 1700000000001,
              executionMs: 1,
              ffprobeRuns: 0,
              ffmpegRuns: 0,
              inputBytes: parsed.job.source.byteSize,
              outputBytes: 0,
            },
          },
        };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // "ok" / "lie-hash": success envelopes over the REAL received bytes.
      const bytes = new Uint8Array(Buffer.from(parsed.source.contentBase64, "base64"));
      const realHash = sha256OfBytes(bytes);
      if (parsed.job.operation === "probe") {
        const body = {
          disposition: "executed",
          result: {
            jobId: parsed.job.jobId,
            operation: "probe",
            status: "succeeded",
            sourceProbe: stubProbe(),
            metering: {
              startedAtMs: 1700000000000,
              finishedAtMs: 1700000000050,
              executionMs: 50,
              ffprobeRuns: 1,
              ffmpegRuns: 0,
              inputBytes: bytes.byteLength,
              outputBytes: 0,
            },
          },
        };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      const claimedHash =
        mode === "lie-hash"
          ? "0000000000000000000000000000000000000000000000000000000000000000"
          : realHash;
      const body = {
        disposition: "executed",
        result: {
          jobId: parsed.job.jobId,
          operation: "normalize",
          status: "succeeded",
          normalized: {
            contentHash: claimedHash,
            byteSize: bytes.byteLength,
            probe: stubProbe(),
            contentBase64: parsed.source.contentBase64,
          },
          artifact: {
            reality: "original",
            contentHash: claimedHash,
            sourceContentHash: parsed.job.source.contentHash,
            byteSize: bytes.byteLength,
            container: "mp4",
            videoCodec: "h264",
            audioCodec: "aac",
            durationMs: 2000,
            rendererId: "media-platform/normalize",
            rendererVersion: "0.1.0",
            generatedAtMs: 1700000000100,
            integrity: { algorithm: "sha256", verified: true },
          },
          metering: {
            startedAtMs: 1700000000000,
            finishedAtMs: 1700000000200,
            executionMs: 200,
            ffprobeRuns: 2,
            ffmpegRuns: 1,
            inputBytes: bytes.byteLength,
            outputBytes: bytes.byteLength,
          },
        },
      };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, server };
}

// ---------------------------------------------------------------------------
// 1. The in-process default seam (the non-degradation law)
// ---------------------------------------------------------------------------

describe("the in-process toolchain seam (the REAL default)", () => {
  test.skipIf(!hasFfmpeg)("probeMedia measures what the direct tool measures", async () => {
    const executor = new InProcessMediaToolchain();
    const bytes = await realMp4Bytes({ durationSeconds: 2, withAudio: true });
    const probe = await executor.probeMedia(bytes);
    expect(probe.videoStreams.length).toBeGreaterThanOrEqual(1);
    expect(probe.audioStreams.length).toBe(1);
    expect(probe.durationMs).toBeGreaterThanOrEqual(1900);
    expect(probe.durationMs).toBeLessThanOrEqual(2100);
    expect(probe.frameRateFps).toBeGreaterThan(20);
    expect(probe.frameCount).toBeGreaterThanOrEqual(46);
  });

  test.skipIf(!hasFfmpeg)("normalizeMedia returns the canonical output + its measured probe", async () => {
    const executor = new InProcessMediaToolchain();
    const bytes = await realMp4Bytes({ durationSeconds: 1, withAudio: true });
    const outcome = await executor.normalizeMedia(bytes);
    expect(outcome.outputBytes.byteLength).toBeGreaterThan(0);
    // The canonical encoding: H.264/AAC (measured from the OUTPUT probe).
    expect(outcome.outputProbe.videoStreams[0]!.codec_name).toBe("h264");
    expect(outcome.outputProbe.audioStreams[0]!.codec_name).toBe("aac");
    expect(outcome.outputProbe.audioStreams[0]!.sample_rate).toBe("48000");
    // The content address is the sha-256 of the delivered bytes.
    expect(sha256OfBytes(outcome.outputBytes)).toMatch(/^[0-9a-f]{64}$/);
    expect(outcome.executionMs).toBeGreaterThanOrEqual(0);
  });

  test.skipIf(!hasFfmpeg)(
    "the service over an EXPLICIT in-process seam behaves as the default (byte-identical seam law)",
    async () => {
      const scratch = await mkdtemp(join(tmpdir(), "sporta-seam-default-"));
      try {
        const storage = new InMemoryStorage();
        const store = new SqliteMediaPlatformStore(":memory:");
        const service = new MediaPlatformService({
          storage,
          sourceAssets: store.sourceAssets,
          manifests: store.manifests,
          artifacts: store.artifacts,
          jobs: store.jobs,
          resolvePolicy: () => FULL_POLICY,
          nowMs: Date.now,
          autoRun: false,
          toolchain: new InProcessMediaToolchain({ tool: new FfmpegTool() }),
        });
        const bytes = await realMp4Bytes({ durationSeconds: 1, withAudio: true });
        const { asset, job } = await service.upload({
          bytes,
          sessionId: "sess-seam-default",
          declaredRightsPolicyId: "policy-toolchain-test-full",
        });
        expect(asset.uploadState).toBe("stored");
        expect(asset.checksumVerified).toBe(true);
        const terminal = await service.runJob(job.jobId);
        expect(terminal.state).toBe("succeeded");
        const manifest = service.manifestOf(asset.assetId)!;
        expect(manifest.video.codec).toBe("h264");
        expect(manifest.audio?.codec).toBe("aac");
        const artifact = service.artifact(terminal.result!.artifactId)!;
        expect(artifact.reality).toBe("original");
        expect(artifact.contentHash).toBe(manifest.contentHash);
        expect(artifact.integrity).toEqual({ algorithm: "sha256", verified: true });
        expect(
          await storage.verify(normalizedMediaKey(manifest.contentHash), manifest.contentHash),
        ).toBe(manifest.contentHash);
        store.close();
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    },
  );
});

// ---------------------------------------------------------------------------
// 2. The HTTP client against a controlled stub worker (validation + mapping)
// ---------------------------------------------------------------------------

describe("the http toolchain client (controlled stub — the real worker round trip is in compute-adapter-hosted)", () => {
  test("the happy path: probe + normalize verified, the hash chain checked", async () => {
    const { url, server } = startStubWorker("ok");
    try {
      const executor = createHttpMediaToolchain(url);
      const bytes = new TextEncoder().encode("fake-but-real-bytes-for-the-client-test");
      const probe = await executor.probeMedia(bytes);
      expect(probe.durationMs).toBe(2000);
      expect(probe.videoStreams[0]!.codec_name).toBe("h264");
      const outcome = await executor.normalizeMedia(bytes);
      // The stub echoes the source bytes: the delivered bytes must equal
      // them AND the content address must verify (the client re-hashed).
      expect(outcome.outputBytes).toEqual(bytes);
      expect(sha256OfBytes(outcome.outputBytes)).toBe(sha256OfBytes(bytes));
      expect(outcome.outputProbe.frameCount).toBe(48);
      expect(outcome.executionMs).toBe(200);
    } finally {
      server.stop(true);
    }
  });

  test("the service over the http seam: upload → admission (stub probe) → normalize (stub) → the frozen records", async () => {
    const { url, server } = startStubWorker("ok");
    try {
      const storage = new InMemoryStorage();
      const store = new SqliteMediaPlatformStore(":memory:");
      const service = new MediaPlatformService({
        storage,
        sourceAssets: store.sourceAssets,
        manifests: store.manifests,
        artifacts: store.artifacts,
        jobs: store.jobs,
        resolvePolicy: () => FULL_POLICY,
        nowMs: Date.now,
        autoRun: false,
        toolchain: createHttpMediaToolchain(url),
      });
      const bytes = await realMp4Bytes({ durationSeconds: 1, withAudio: true });
      const { asset, job } = await service.upload({
        bytes,
        sessionId: "sess-seam-http",
        declaredRightsPolicyId: "policy-toolchain-test-full",
      });
      expect(asset.uploadState).toBe("stored");
      // The admission probe ran through the seam (the stub's measured doc).
      expect(asset.durationMs).toBe(2000);
      expect(asset.videoStreamCount).toBe(1);
      const terminal = await service.runJob(job.jobId);
      expect(terminal.state).toBe("succeeded");
      // The manifest is built from the seam's returned measured probe.
      const manifest = service.manifestOf(asset.assetId)!;
      expect(manifest.video.codec).toBe("h264");
      expect(manifest.video.widthPx).toBe(320);
      expect(manifest.frameCount).toBe(48);
      // The artifact is hash-chained to the bytes the seam delivered (the
      // stub echoes the source, so the content address is the source's).
      const artifact = service.artifact(terminal.result!.artifactId)!;
      expect(artifact.contentHash).toBe(sha256OfBytes(bytes));
      expect(artifact.contentHash).toBe(manifest.contentHash);
      expect(artifact.integrity).toEqual({ algorithm: "sha256", verified: true });
      expect(
        await storage.verify(normalizedMediaKey(manifest.contentHash), manifest.contentHash),
      ).toBe(manifest.contentHash);
      store.close();
    } finally {
      server.stop(true);
    }
  });

  test("a lying provider (wrong content hash) is refused, never trusted", async () => {
    const { url, server } = startStubWorker("lie-hash");
    try {
      const executor = createHttpMediaToolchain(url);
      const bytes = new TextEncoder().encode("lying-provider-probe");
      await expect(executor.normalizeMedia(bytes)).rejects.toBeInstanceOf(MediaIntegrityError);
    } finally {
      server.stop(true);
    }
  });

  test("a classified ffmpeg-unavailable failure maps to the typed unavailable error", async () => {
    const { url, server } = startStubWorker("ffmpeg-unavailable");
    try {
      const executor = createHttpMediaToolchain(url);
      const bytes = new TextEncoder().encode("boundary-class-probe");
      await expect(executor.probeMedia(bytes)).rejects.toBeInstanceOf(FfmpegUnavailableError);
      await expect(executor.normalizeMedia(bytes)).rejects.toBeInstanceOf(FfmpegUnavailableError);
    } finally {
      server.stop(true);
    }
  });

  test("a capacity refusal (HTTP 503) maps to the typed resource error", async () => {
    const { url, server } = startStubWorker("capacity");
    try {
      const executor = createHttpMediaToolchain(url);
      const bytes = new TextEncoder().encode("capacity-probe");
      await expect(executor.normalizeMedia(bytes)).rejects.toBeInstanceOf(
        MediaToolchainResourceError,
      );
    } finally {
      server.stop(true);
    }
  });

  test("an invalid envelope is a lying provider — the typed unavailable error", async () => {
    const { url, server } = startStubWorker("garbage");
    try {
      const executor = createHttpMediaToolchain(url);
      const bytes = new TextEncoder().encode("garbage-probe");
      await expect(executor.probeMedia(bytes)).rejects.toBeInstanceOf(FfmpegUnavailableError);
    } finally {
      server.stop(true);
    }
  });

  test("an unreachable worker is the typed unavailable error (fail-closed, never silent)", async () => {
    // A port nothing listens on: fetch rejects with a connection error.
    const executor = createHttpMediaToolchain("http://127.0.0.1:1");
    const bytes = new TextEncoder().encode("unreachable-probe");
    await expect(executor.probeMedia(bytes)).rejects.toBeInstanceOf(FfmpegUnavailableError);
    await expect(executor.normalizeMedia(bytes)).rejects.toBeInstanceOf(FfmpegUnavailableError);
  });
});

// ---------------------------------------------------------------------------
// 3. The env-driven composition root
// ---------------------------------------------------------------------------

describe("the env-driven toolchain selection (composition root)", () => {
  test("unset/empty/default selects in-process; the executor is the in-process seam", () => {
    expect(mediaToolchainSelectionOf({})).toBe("in-process");
    expect(mediaToolchainSelectionOf({ MEDIA_TOOLCHAIN: "" })).toBe("in-process");
    expect(mediaToolchainSelectionOf({ MEDIA_TOOLCHAIN: "in-process" })).toBe("in-process");
    const resolved = resolveMediaToolchainFromEnv({ env: {} });
    expect(resolved.toolchain).toBe("in-process");
    expect(resolved.executor).toBeInstanceOf(InProcessMediaToolchain);
    expect(resolved.tool).toBeInstanceOf(FfmpegTool);
  });

  test("http selects the http client and requires the worker URL (fail-loud)", () => {
    const resolved = resolveMediaToolchainFromEnv({
      env: { MEDIA_TOOLCHAIN: "http", MEDIA_TOOLCHAIN_URL: "http://127.0.0.1:3971" },
    });
    expect(resolved.toolchain).toBe("http");
    expect(resolved.workerUrl).toBe("http://127.0.0.1:3971");
    expect(resolved.executor).toBeDefined();
    expect(() =>
      resolveMediaToolchainFromEnv({ env: { MEDIA_TOOLCHAIN: "http" } }),
    ).toThrow(/MEDIA_TOOLCHAIN_URL/);
    expect(() => mediaToolchainSelectionOf({ MEDIA_TOOLCHAIN: "gpu" })).toThrow(/MEDIA_TOOLCHAIN/);
  });
});
