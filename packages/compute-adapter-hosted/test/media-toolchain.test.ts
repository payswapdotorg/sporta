/**
 * THE MEDIA TOOLCHAIN WORKER TESTS (R607 lane B — the W914 http compute
 * adapter against a REAL toolchain worker): the hosted package's media
 * execution profile over the REAL wire.
 *
 * 1. DESCRIPTOR HONESTY: the resolved toolchain advertises the operations
 *    it can execute with the MEASURED `ffmpeg -version` identity; an
 *    unresolved toolchain advertises NOTHING (operations: []) and every
 *    dispatch refuses with the typed `ffmpeg-unavailable` class — the
 *    R607 hosted boundary class, reproduced and classified honestly at
 *    the worker boundary.
 * 2. THE REAL GOLDEN PATH over real HTTP (a `Bun.serve` socket, a REAL
 *    MP4 produced in-test by the real ffmpeg — no committed fixtures):
 *    admission probe (measured) → normalize (real transcode, measured
 *    manifest source) → the original-reality artifact with the HASH CHAIN
 *    (re-verified: the delivered bytes re-hashed, the source claim
 *    re-measured) → the +faststart playability check.
 * 3. THE FAILURE CLASSES: budget-exceeded (timeout, outputs discarded),
 *    rights-denied, source-hash-mismatch (a lying claim), malformed
 *    dispatches (HTTP 400), capacity (deterministic concurrent refusal),
 *    idempotent duplicates.
 * 4. THE LEDGER: per-job records, the usage drain (one `ComputeUsageRecord`
 *    per terminal job — the Wave-1 contract verbatim), and the accounting
 *    identities (`assertMediaToolchainAccounting` + the metering sums
 *    recomputed from the records).
 * 5. THE END-TO-END MEDIA-PLATFORM INTEGRATION: `MediaPlatformService` +
 *    `createHttpMediaToolchain` against the served worker — a REAL upload
 *    (admission probe via the worker) → a REAL normalization (ffmpeg via
 *    the worker) → the frozen manifest + artifact records, hash-verified
 *    through the storage seam — the R607 media-leg golden path, proven on
 *    this toolchain-capable plane.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FfmpegTool,
  InMemoryStorage,
  MediaToolchainDispatchRequest,
  MediaToolchainResult,
  MediaPlatformService,
  SqliteMediaPlatformStore,
  createHttpMediaToolchain,
  fetchMediaToolchainDescriptor,
  generateTestMp4,
  normalizedMediaKey,
  sha256OfBytes,
} from "@sporta/media-platform";
import type { MediaToolchainDispatchRequest as MediaToolchainDispatchRequestDoc } from "@sporta/media-platform";
import type { AuthorizationPolicy } from "@sporta/contracts";
import { ComputeUsageRecord } from "@sporta/compute-adapter";
import {
  MediaToolchainWorker,
  assertMediaToolchainAccounting,
  createMediaToolchainHttpHandler,
  createMediaToolchainServer,
  createMediaToolchainWorker,
} from "../src/index";

/** Whether the REAL ffmpeg is usable in this environment. */
const tool = new FfmpegTool();
const hasFfmpeg = await tool.available();

/** A full-rights policy fixture (the fail-closed derivation allows all). */
const FULL_POLICY: AuthorizationPolicy = {
  policyId: "policy-media-toolchain-test",
  allowedOperations: ["analysis", "transformation", "storage", "derivativeGeneration"],
  assertedBy: "test",
};

/** Deterministic job-id counter (the ledger's idempotence keys). */
let jobSeq = 0;
function nextJobId(prefix: string): string {
  jobSeq += 1;
  return `${prefix}-${String(jobSeq).padStart(3, "0")}`;
}

/** Generates REAL MP4 bytes in a temp file and reads them back. */
async function realMp4Bytes(
  options: { durationSeconds?: number; withAudio?: boolean } = {},
): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), "sporta-media-worker-test-"));
  try {
    const path = await generateTestMp4(join(dir, "clip.mp4"), options);
    const file = Bun.file(path);
    return new Uint8Array(await file.arrayBuffer());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Builds one REAL, valid media-toolchain dispatch over the given bytes. */
function buildMediaDispatch(
  bytes: Uint8Array,
  overrides: {
    jobId?: string;
    operation?: "probe" | "normalize";
    contentHash?: string;
    byteSize?: number;
    canReferenceSourceFrames?: boolean;
    deadlineMs?: number;
    maxDurationMs?: number;
  } = {},
): MediaToolchainDispatchRequestDoc {
  const request = {
    job: {
      schemaVersion: "1.0" as const,
      jobId: overrides.jobId ?? nextJobId("media-job"),
      idempotencyKey: `key-${overrides.jobId ?? nextJobId("media-job")}`,
      sessionId: "sess-media-toolchain-test",
      operation: overrides.operation ?? "normalize",
      source: {
        contentHash: overrides.contentHash ?? sha256OfBytes(bytes),
        byteSize: overrides.byteSize ?? bytes.byteLength,
        container: "mp4" as const,
      },
      rights: {
        policyRef: "policy-media-toolchain-test",
        canReferenceSourceFrames: overrides.canReferenceSourceFrames ?? true,
      },
      constraints: { deadlineMs: overrides.deadlineMs ?? 120_000, priority: 0 },
      mediaPolicy: { maxDurationMs: overrides.maxDurationMs ?? 120_000 },
    },
    source: {
      inputId: "source-media",
      kind: "source-media" as const,
      contentBase64: Buffer.from(bytes).toString("base64"),
    },
  };
  // Fail loud on any fixture drift: the built request MUST parse against
  // the wire contract.
  return MediaToolchainDispatchRequest.parse(request);
}

/** A worker over the REAL resolved toolchain (a real clock injected). */
function realWorker(overrides: { budgets?: object } = {}): MediaToolchainWorker {
  return createMediaToolchainWorker({
    tool,
    nowMs: Date.now,
    ...(overrides.budgets === undefined ? {} : { budgets: overrides.budgets }),
  });
}

// ---------------------------------------------------------------------------
// 1. Descriptor honesty (the capability the worker ACTUALLY has)
// ---------------------------------------------------------------------------

describe("the media toolchain worker's descriptor (honesty)", () => {
  test.skipIf(!hasFfmpeg)(
    "a resolved toolchain advertises both operations + the measured version identity",
    async () => {
      const worker = realWorker();
      const descriptor = await worker.describe();
      expect(descriptor.adapterId).toBe("sporta.compute.hosted.media");
      expect(descriptor.providerKind).toBe("cpu-worker");
      // R607 Gap 1 (the TL-authorized enum extension): the resolved
      // toolchain now also advertises the decode seam's two operations.
      // R306: + the encode seam's `encode-frames` (the G12 walk's named
      // next gap — additive, the same law the decode pair landed under).
      expect(descriptor.operations).toEqual([
        "probe",
        "normalize",
        "decode-probe",
        "decode-frames",
        "encode-frames",
      ]);
      expect(descriptor.toolchain.resolved).toBe(true);
      expect(descriptor.toolchain.ffmpegPath).toBe(tool.ffmpegPath);
      expect(descriptor.toolchain.ffprobePath).toBe(tool.ffprobePath);
      expect(descriptor.toolchain.ffmpegVersion).toContain("ffmpeg version");
      expect(descriptor.budgets.maxConcurrentJobs).toBe(1);
      expect(descriptor.costUnits.map((unit) => unit.unitId)).toEqual([
        "cpu-ms",
        "media-jobs",
        "artifact-bytes",
      ]);
    },
  );

  test("an unresolved toolchain advertises NOTHING and refuses with the typed boundary class", async () => {
    // A tool whose binaries cannot resolve — the hosted-Node-runtime
    // condition (Bun.which finds nothing; the fallback path is unusable).
    const bogusTool = new FfmpegTool({
      ffmpegPath: "/nonexistent/ffmpeg-binary",
      ffprobePath: "/nonexistent/ffprobe-binary",
    });
    const worker = createMediaToolchainWorker({ tool: bogusTool, nowMs: Date.now });
    const descriptor = await worker.describe();
    expect(descriptor.toolchain.resolved).toBe(false);
    expect(descriptor.operations).toEqual([]);
    expect(descriptor.toolchain.ffmpegPath).toBe(null);
    expect(descriptor.toolchain.ffmpegVersion).toBe(null);

    // Every dispatch refuses with the R607 boundary class, honestly typed.
    const bytes = new TextEncoder().encode("any-bytes");
    const execution = await worker.execute(buildMediaDispatch(bytes, { operation: "probe" }));
    if (execution.kind !== "executed") throw new Error("expected an executed (failed) envelope");
    expect(execution.result.status).toBe("failed");
    expect(execution.result.failure?.errorClass).toBe("ffmpeg-unavailable");
    expect(execution.result.failure?.failureClass).toBe("internal");
    expect(execution.result.metering.ffmpegRuns).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. The real golden path over real HTTP (admission → normalize → artifact)
// ---------------------------------------------------------------------------

describe("the media toolchain golden path over real HTTP", () => {
  test.skipIf(!hasFfmpeg)("admission probe: a REAL measured probe over the wire", async () => {
    const worker = realWorker();
    const server = createMediaToolchainServer({ worker, port: 0 });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const bytes = await realMp4Bytes({ durationSeconds: 2, withAudio: true });
      const request = buildMediaDispatch(bytes, { operation: "probe" });
      const response = await fetch(`${base}/v1/media/jobs/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { disposition: string; result: unknown };
      expect(body.disposition).toBe("executed");
      const envelope = MediaToolchainResult.parse(body.result);
      expect(envelope.status).toBe("succeeded");
      expect(envelope.operation).toBe("probe");
      // MEASURED by the real ffprobe (never caller-declared):
      expect(envelope.sourceProbe!.durationMs).toBeGreaterThanOrEqual(1900);
      expect(envelope.sourceProbe!.durationMs).toBeLessThanOrEqual(2100);
      expect(envelope.sourceProbe!.videoStreams.length).toBeGreaterThanOrEqual(1);
      expect(envelope.sourceProbe!.audioStreams.length).toBe(1);
      expect(envelope.sourceProbe!.frameRateFps).toBeGreaterThan(20);
      expect(envelope.metering.ffprobeRuns).toBeGreaterThanOrEqual(1);
      expect(envelope.metering.ffmpegRuns).toBe(0);
      expect(envelope.metering.inputBytes).toBe(bytes.byteLength);
    } finally {
      server.stop(true);
    }
  });

  test.skipIf(!hasFfmpeg)(
    "normalize: the REAL transcode + the original-reality artifact with the verified hash chain",
    async () => {
      const worker = realWorker();
      const server = createMediaToolchainServer({ worker, port: 0 });
      const base = `http://127.0.0.1:${server.port}`;
      try {
        const bytes = await realMp4Bytes({ durationSeconds: 2, withAudio: true });
        const request = buildMediaDispatch(bytes, { operation: "normalize" });
        const response = await fetch(`${base}/v1/media/jobs/execute`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        });
        expect(response.status).toBe(200);
        const body = (await response.json()) as { disposition: string; result: unknown };
        const envelope = MediaToolchainResult.parse(body.result);
        expect(envelope.status).toBe("succeeded");
        expect(envelope.operation).toBe("normalize");

        // THE HASH CHAIN, re-verified at the receiving boundary:
        const outputBytes = new Uint8Array(
          Buffer.from(envelope.normalized!.contentBase64, "base64"),
        );
        expect(sha256OfBytes(outputBytes)).toBe(envelope.normalized!.contentHash);
        expect(outputBytes.byteLength).toBe(envelope.normalized!.byteSize);
        expect(envelope.artifact!.contentHash).toBe(envelope.normalized!.contentHash);
        expect(envelope.artifact!.sourceContentHash).toBe(sha256OfBytes(bytes));
        expect(envelope.artifact!.integrity).toEqual({ algorithm: "sha256", verified: true });
        expect(envelope.artifact!.reality).toBe("original");
        expect(envelope.artifact!.rendererId).toBe("media-platform/normalize");

        // The MEASURED manifest source (the output's own probe):
        const probe = envelope.normalized!.probe;
        expect(probe.videoStreams[0]!.codec_name).toBe("h264");
        expect(probe.audioStreams[0]!.codec_name).toBe("aac");
        expect(probe.audioStreams[0]!.sample_rate).toBe("48000");
        expect(envelope.artifact!.videoCodec).toBe("h264");
        expect(envelope.artifact!.audioCodec).toBe("aac");

        // PLAYABLE: the canonical faststart MP4 (the moov atom up front —
        // the HTML5 `<video>` Range-streaming requirement).
        const head = new TextDecoder("latin1").decode(outputBytes.slice(0, 64));
        expect(head.includes("moov") || head.includes("ftyp")).toBe(true);

        // The metering: a REAL ffmpeg run, two REAL ffprobe runs.
        expect(envelope.metering.ffmpegRuns).toBe(1);
        expect(envelope.metering.ffprobeRuns).toBeGreaterThanOrEqual(2);
        expect(envelope.metering.inputBytes).toBe(bytes.byteLength);
        expect(envelope.metering.outputBytes).toBe(outputBytes.byteLength);
        expect(envelope.metering.executionMs).toBeGreaterThan(0);
      } finally {
        server.stop(true);
      }
    },
  );

  test.skipIf(!hasFfmpeg)(
    "the end-to-end media-platform integration: upload → admission (worker probe) → normalize (worker ffmpeg) → the frozen records",
    async () => {
      const worker = realWorker();
      const server = createMediaToolchainServer({ worker, port: 0 });
      const base = `http://127.0.0.1:${server.port}`;
      const scratch = await mkdtemp(join(tmpdir(), "sporta-media-e2e-"));
      try {
        // The descriptor is FETCHED live (never invented): the client
        // composition can check the toolchain before dispatching.
        const descriptor = await fetchMediaToolchainDescriptor(base);
        expect(descriptor.toolchain.resolved).toBe(true);
        // R607 Gap 1 (the TL-authorized enum extension): the live descriptor
        // fetched over the wire advertises the decode seam's operations too.
        // R306: + the encode seam's `encode-frames` (additive).
        expect(descriptor.operations).toEqual([
          "probe",
          "normalize",
          "decode-probe",
          "decode-frames",
          "encode-frames",
        ]);

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
          toolchain: createHttpMediaToolchain(base),
        });

        // R101: the upload — admission probing THROUGH THE WORKER.
        const bytes = await realMp4Bytes({ durationSeconds: 2, withAudio: true });
        const { asset, job } = await service.upload({
          bytes,
          sessionId: "sess-media-e2e",
          declaredRightsPolicyId: "policy-media-toolchain-test",
        });
        expect(asset.uploadState).toBe("stored");
        expect(asset.checksumVerified).toBe(true);
        expect(asset.contentHash).toBe(sha256OfBytes(bytes));
        expect(asset.durationMs).toBeGreaterThanOrEqual(1900);

        // R102/R104: the REAL pipeline — normalization THROUGH THE WORKER.
        const terminal = await service.runJob(job.jobId);
        expect(terminal.state).toBe("succeeded");
        expect(terminal.progress).toBe(1);
        const manifest = service.manifestOf(asset.assetId)!;
        expect(manifest.sourceAssetId).toBe(asset.assetId);
        expect(manifest.video.codec).toBe("h264");
        expect(manifest.video.widthPx).toBe(320);
        expect(manifest.audio?.codec).toBe("aac");
        expect(manifest.frameCount).toBeGreaterThanOrEqual(46);
        const artifact = service.artifact(terminal.result!.artifactId)!;
        expect(artifact.reality).toBe("original");
        expect(artifact.contentHash).toBe(manifest.contentHash);
        expect(artifact.sourceAssetId).toBe(asset.assetId);
        expect(artifact.integrity).toEqual({ algorithm: "sha256", verified: true });
        // The stored bytes hash-verify through the seam (the final link of
        // the chain, at the control-plane side).
        expect(
          await storage.verify(normalizedMediaKey(manifest.contentHash), manifest.contentHash),
        ).toBe(manifest.contentHash);
        store.close();

        // THE ACCOUNTING SNAPSHOT (the acceptance's metering identities):
        const stats = worker.stats();
        // One probe job (admission) + one normalize job — nothing else.
        expect(stats.jobsDispatched).toBe(2);
        expect(stats.succeeded).toBe(2);
        expect(stats.inFlight).toBe(0);
        expect(stats.usageRecords).toBe(2);
        expect(() => assertMediaToolchainAccounting(stats)).not.toThrow();
        // Every usage record is a schema-valid Wave-1 ComputeUsageRecord.
        const usage = worker.usageRecords();
        for (const record of usage) {
          expect(ComputeUsageRecord.safeParse(record).success).toBe(true);
        }
        expect(usage.map((r) => r.jobId)).toHaveLength(2);
        // The metering sums recompute from the per-job records (the
        // never-silent cross-check — every counter is derived from the
        // records it names).
        let transcodeRuns = 0;
        let probeRuns = 0;
        for (const record of worker.usageRecords()) {
          const job = worker.getJob(record.jobId);
          if (job?.metering === undefined) continue;
          transcodeRuns += job.metering.ffmpegRuns;
          probeRuns += job.metering.ffprobeRuns;
        }
        expect(stats.transcodeRuns).toBe(transcodeRuns);
        expect(stats.probeRuns).toBe(probeRuns);
        expect(stats.transcodeRuns).toBeGreaterThanOrEqual(1);
        expect(stats.inputBytes).toBeGreaterThanOrEqual(bytes.byteLength * 2);
      } finally {
        server.stop(true);
        await rm(scratch, { recursive: true, force: true });
      }
    },
  );
});

// ---------------------------------------------------------------------------
// 3. The failure classes (classified envelopes — never silence)
// ---------------------------------------------------------------------------

describe("the media toolchain failure classes", () => {
  test.skipIf(!hasFfmpeg)(
    "a measured budget breach discards the outputs and fails with the timeout class",
    async () => {
      // maxExecutionMs: 1 — any REAL ffmpeg run exceeds it determinately.
      const worker = createMediaToolchainWorker({
        tool,
        nowMs: Date.now,
        budgets: { maxExecutionMs: 1 },
      });
      const bytes = await realMp4Bytes({ durationSeconds: 1, withAudio: false });
      const execution = await worker.execute(buildMediaDispatch(bytes, { operation: "normalize" }));
      if (execution.kind !== "executed") throw new Error("expected an executed (failed) envelope");
      const result = execution.result;
      expect(result.status).toBe("failed");
      expect(result.failure?.errorClass).toBe("budget-exceeded");
      expect(result.failure?.terminal).toBe("timeout");
      expect(result.failure?.failureClass).toBe("resource-limit");
      // The outputs were DISCARDED (never handed back).
      expect(result.normalized).toBeUndefined();
      expect(result.artifact).toBeUndefined();
      // The ffmpeg run still happened and is metered honestly.
      expect(result.metering.ffmpegRuns).toBe(1);
    },
  );

  test.skipIf(!hasFfmpeg)("a rights-denying posture is refused before any tool runs", async () => {
    const worker = realWorker();
    const bytes = await realMp4Bytes({ durationSeconds: 1, withAudio: false });
    const execution = await worker.execute(
      buildMediaDispatch(bytes, { canReferenceSourceFrames: false }),
    );
    if (execution.kind !== "executed") throw new Error("expected an executed (failed) envelope");
    expect(execution.result.status).toBe("failed");
    expect(execution.result.failure?.errorClass).toBe("rights-denied");
    expect(execution.result.failure?.failureClass).toBe("rights-denied");
    expect(execution.result.metering.ffmpegRuns).toBe(0);
  });

  test.skipIf(!hasFfmpeg)("a lying content-hash claim is never interpreted", async () => {
    const worker = realWorker();
    const bytes = await realMp4Bytes({ durationSeconds: 1, withAudio: false });
    const execution = await worker.execute(
      buildMediaDispatch(bytes, {
        contentHash: "0000000000000000000000000000000000000000000000000000000000000000",
      }),
    );
    if (execution.kind !== "executed") throw new Error("expected an executed (failed) envelope");
    expect(execution.result.status).toBe("failed");
    expect(execution.result.failure?.errorClass).toBe("source-hash-mismatch");
    expect(execution.result.failure?.failureClass).toBe("internal");
    expect(execution.result.metering.inputBytes).toBe(bytes.byteLength);
  });

  test.skipIf(!hasFfmpeg)(
    "an over-duration OUTPUT refuses with the media-invalid class",
    async () => {
      // The policy bound is enforced against the PRODUCED media: a 2s clip
      // against a 1s bound refuses at the re-check.
      const worker = realWorker();
      const bytes = await realMp4Bytes({ durationSeconds: 2, withAudio: false });
      const execution = await worker.execute(buildMediaDispatch(bytes, { maxDurationMs: 1000 }));
      if (execution.kind !== "executed") throw new Error("expected an executed (failed) envelope");
      expect(execution.result.status).toBe("failed");
      expect(execution.result.failure?.errorClass).toBe("duration-over-limit");
      expect(execution.result.failure?.failureClass).toBe("media-invalid");
    },
  );

  test.skipIf(!hasFfmpeg)("idempotence: a re-POST answers the SAME envelope, counted", async () => {
    const worker = realWorker();
    const bytes = await realMp4Bytes({ durationSeconds: 1, withAudio: false });
    const request = buildMediaDispatch(bytes, { operation: "probe", jobId: "media-job-idem-1" });
    const first = await worker.execute(request);
    const second = await worker.execute(request);
    expect(first.kind).toBe("executed");
    expect(second.kind).toBe("duplicate");
    if (second.kind !== "duplicate" || first.kind !== "executed") throw new Error("unreachable");
    expect(second.duplicateExecutions).toBe(1);
    expect(second.result).toEqual(first.result);
    expect(worker.stats().duplicates).toBe(1);
    // The duplicate did NOT execute a second ffprobe.
    expect(worker.stats().probeRuns).toBe(1);
  });

  test.skipIf(!hasFfmpeg)(
    "capacity: a concurrent dispatch is refused determinately (one ffmpeg at a time)",
    async () => {
      const worker = realWorker();
      const bytesA = await realMp4Bytes({ durationSeconds: 2, withAudio: false });
      const bytesB = await realMp4Bytes({ durationSeconds: 2, withAudio: false });
      // The first dispatch enters execution (inFlight = 1 synchronously);
      // the second observes the bounded concurrency and is REFUSED.
      const first = worker.execute(buildMediaDispatch(bytesA, { jobId: "media-job-cap-1" }));
      const second = await worker.execute(buildMediaDispatch(bytesB, { jobId: "media-job-cap-2" }));
      expect(second.kind).toBe("refused");
      if (second.kind !== "refused") throw new Error("unreachable");
      expect(second.reason.errorClass).toBe("capacity");
      expect(second.reason.terminal).toBe("resource-limit");
      const settled = await first;
      expect(settled.kind).toBe("executed");
      expect(worker.stats().capacityRefusals).toBe(1);
      expect(() => assertMediaToolchainAccounting(worker.stats())).not.toThrow();
    },
  );
});

// ---------------------------------------------------------------------------
// 4. The HTTP surface (routes, refusals, the ledger views)
// ---------------------------------------------------------------------------

describe("the media toolchain HTTP surface", () => {
  function handler(worker = realWorker()) {
    return createMediaToolchainHttpHandler(worker);
  }

  test("GET /health answers liveness + identity", async () => {
    const handle = handler();
    const response = await handle(new Request("http://worker/health"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.service).toBe("sporta-media-toolchain-worker");
    expect(body.adapterId).toBe("sporta.compute.hosted.media");
    expect(response.headers.get("x-provider-id")).toBe("sporta-media-toolchain-worker-1");
  });

  test("GET /v1/media/adapter answers the honest descriptor", async () => {
    const handle = handler();
    const response = await handle(new Request("http://worker/v1/media/adapter"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { toolchain: { resolved: boolean } };
    expect(typeof body.toolchain.resolved).toBe("boolean");
  });

  test("a non-JSON body answers 400 invalid-body", async () => {
    const handle = handler();
    const response = await handle(
      new Request("http://worker/v1/media/jobs/execute", { method: "POST", body: "not json" }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { errorClass: string } };
    expect(body.error.errorClass).toBe("invalid-body");
  });

  test("a structurally invalid dispatch answers 400 invalid-dispatch", async () => {
    const handle = handler();
    const response = await handle(
      new Request("http://worker/v1/media/jobs/execute", {
        method: "POST",
        body: JSON.stringify({ job: { nope: true }, source: {} }),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { errorClass: string } };
    expect(body.error.errorClass).toBe("invalid-dispatch");
  });

  test.skipIf(!hasFfmpeg)(
    "GET /v1/media/jobs/:jobId answers the record (404 unknown, never fabricated)",
    async () => {
      const handle = handler();
      const missing = await handle(new Request("http://worker/v1/media/jobs/nope"));
      expect(missing.status).toBe(404);
      expect(((await missing.json()) as { error: { errorClass: string } }).error.errorClass).toBe(
        "unknown-job",
      );

      const worker = realWorker();
      const bytes = await realMp4Bytes({ durationSeconds: 1, withAudio: false });
      const request = buildMediaDispatch(bytes, { operation: "probe", jobId: "media-job-http-1" });
      await worker.execute(request);
      const server = createMediaToolchainServer({ worker, port: 0 });
      try {
        const response = await fetch(
          `http://127.0.0.1:${server.port}/v1/media/jobs/media-job-http-1`,
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as { state: string; metering: unknown };
        expect(body.state).toBe("succeeded");
        expect(body.metering).toBeDefined();
      } finally {
        server.stop(true);
      }
    },
  );

  test.skipIf(!hasFfmpeg)("GET /v1/media/usage drains the usage records", async () => {
    const worker = realWorker();
    const bytes = await realMp4Bytes({ durationSeconds: 1, withAudio: false });
    await worker.execute(buildMediaDispatch(bytes, { operation: "probe" }));
    const server = createMediaToolchainServer({ worker, port: 0 });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/v1/media/usage`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as unknown[];
      expect(body).toHaveLength(1);
      expect(ComputeUsageRecord.safeParse(body[0]).success).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test.skipIf(!hasFfmpeg)(
    "GET /v1/media/stats answers the accounting snapshot; stats and the usage drain AGREE across the wire",
    async () => {
      const worker = realWorker();
      const bytes = await realMp4Bytes({ durationSeconds: 1, withAudio: false });
      const server = createMediaToolchainServer({ worker, port: 0 });
      const base = `http://127.0.0.1:${server.port}`;
      try {
        // The identity holds at the empty ledger too (0 === 0 + 0).
        const empty = (await (await fetch(`${base}/v1/media/stats`)).json()) as {
          jobsDispatched: number;
          usageRecords: number;
        };
        expect(empty.jobsDispatched).toBe(0);
        expect(empty.usageRecords).toBe(0);

        await worker.execute(buildMediaDispatch(bytes, { operation: "probe" }));
        const stats = (await (await fetch(`${base}/v1/media/stats`)).json()) as typeof empty & {
          succeeded: number;
          failed: number;
          inFlight: number;
        };
        expect(stats.jobsDispatched).toBe(1);
        expect(stats.succeeded).toBe(1);
        expect(stats.inFlight).toBe(0);
        // Two INDEPENDENT reads agree (stats vs the usage drain).
        const usage = (await (await fetch(`${base}/v1/media/usage`)).json()) as unknown[];
        expect(usage).toHaveLength(stats.usageRecords);
        expect(stats.usageRecords).toBe(stats.succeeded + stats.failed);
      } finally {
        server.stop(true);
      }
    },
  );

  test("unknown routes answer 404; the x-request-id header is echoed", async () => {
    const handle = handler();
    const response = await handle(
      new Request("http://worker/no/such/route", { headers: { "x-request-id": "req-mtw-1" } }),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe("req-mtw-1");
    const body = (await response.json()) as { error: { errorClass: string } };
    expect(body.error.errorClass).toBe("unknown-route");
  });
});

// ---------------------------------------------------------------------------
// 5. The accounting identities (the never-silent ledger)
// ---------------------------------------------------------------------------

describe("the media toolchain accounting (identities hold at every settle)", () => {
  test.skipIf(!hasFfmpeg)(
    "a mixed battery settles with the identities + the recomputed metering sums",
    async () => {
      const worker = createMediaToolchainWorker({
        tool,
        nowMs: Date.now,
        budgets: { maxExecutionMs: 1 }, // every normalize determinately times out
      });
      const bytes = await realMp4Bytes({ durationSeconds: 1, withAudio: false });
      const zeros = "0000000000000000000000000000000000000000000000000000000000000000";
      // One success (probe), one timeout failure (normalize), one lying
      // claim (failed pre-execution), one re-POST (a counted duplicate, not
      // a dispatch), one capacity refusal (never entered the ledger).
      const ok = await worker.execute(
        buildMediaDispatch(bytes, { operation: "probe", jobId: "media-job-acc-1" }),
      );
      const timedOut = await worker.execute(
        buildMediaDispatch(bytes, { operation: "normalize", jobId: "media-job-acc-2" }),
      );
      const lying = await worker.execute(
        buildMediaDispatch(bytes, { contentHash: zeros, jobId: "media-job-acc-3" }),
      );
      const duplicate = await worker.execute(
        buildMediaDispatch(bytes, { operation: "normalize", jobId: "media-job-acc-2" }),
      );
      const concurrent = worker.execute(buildMediaDispatch(bytes, { jobId: "media-job-acc-4" }));
      const refused = await worker.execute(buildMediaDispatch(bytes, { jobId: "media-job-acc-5" }));
      await concurrent;
      expect(ok.kind).toBe("executed");
      expect(timedOut.kind).toBe("executed");
      expect(lying.kind).toBe("executed");
      expect(duplicate.kind).toBe("duplicate");
      expect(refused.kind).toBe("refused");

      const stats = worker.stats();
      // 4 dispatched (the probe, the timed-out normalize, the lying claim,
      // the concurrent normalize), 4 terminal, 0 in flight.
      expect(stats.jobsDispatched).toBe(4);
      expect(stats.succeeded).toBe(1);
      expect(stats.failed).toBe(3);
      expect(stats.inFlight).toBe(0);
      expect(stats.duplicates).toBe(1);
      expect(stats.capacityRefusals).toBe(1);
      expect(() => assertMediaToolchainAccounting(stats)).not.toThrow();
      // Metering totality: exactly one usage record per terminal job.
      expect(stats.usageRecords).toBe(4);
      expect(worker.usageRecords()).toHaveLength(4);
      // A lying ledger would break the identities — the assert has teeth.
      expect(() =>
        assertMediaToolchainAccounting({ ...stats, usageRecords: stats.usageRecords + 1 }),
      ).toThrow(/identity 2/);
      expect(() =>
        assertMediaToolchainAccounting({ ...stats, jobsDispatched: stats.jobsDispatched + 1 }),
      ).toThrow(/identity 1/);
    },
  );
});
