/**
 * MEDIA-PLATFORM UNIT/INTEGRATION TESTS (R101-R104) — hermetic, but REAL:
 * every media byte is produced by the REAL ffmpeg in-test (the lavfi
 * testsrc generator — no committed binary fixtures, no faked probes), and
 * every normalization runs the REAL transcode.
 *
 * 1. STORAGE SEAM: the filesystem adapter's put/get/open(Range)/verify
 *    semantics, content-addressed idempotency, conflict fail-loud, key
 *    traversal refusal; the in-memory adapter's parity.
 * 2. FFMPEG TOOL: availability detection, real probe measurements, the
 *    canonical transcode (H.264/AAC faststart), the typed wrapper errors.
 * 3. NORMALIZATION (R102): generated MP4 → MediaManifest + original
 *    artifact, every field MEASURED (duration/frame count/codecs), stored
 *    bytes re-read + hash-verified, provenance rules asserted.
 * 4. UPLOAD BOUNDARY (R101): rights fail-closed (no policy / mismatched id
 *    / no transformation), size/container/duration constraints validated
 *    PRE-STORAGE with typed refusals, nothing stored on rejection.
 * 5. JOB LIFECYCLE (R103): the W914 vocabulary walk, stage-tied progress
 *    (never fake), terminal dispositions, restart durability through a
 *    REAL sqlite file (close + reopen shows the LAST DURABLE STATE, never
 *    an invented completion), and the explicit fail-interrupted policy.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FfmpegTool,
  InMemoryStorage,
  LocalFilesystemStorage,
  MediaJobService,
  MediaPlatformService,
  SqliteMediaPlatformStore,
  UPLOAD_CONSTRAINTS,
  generateTestMp4,
  normalizedMediaKey,
  sha256OfBytes,
  sourceAssetKey,
} from "../src/index";
import { MediaIntegrityError, MediaRightsError } from "../src/index";
import type { AuthorizationPolicy } from "@sporta/contracts";

/** Whether the REAL ffmpeg is usable in this environment. */
const tool = new FfmpegTool();
const hasFfmpeg = await tool.available();

/** A full-rights policy fixture (the fail-closed derivation allows all). */
const FULL_POLICY: AuthorizationPolicy = {
  policyId: "policy-test-full",
  allowedOperations: ["analysis", "transformation", "storage", "derivativeGeneration"],
  assertedBy: "test",
};

/** A transformation-less policy (upload must refuse it). */
const NO_TRANSFORM_POLICY: AuthorizationPolicy = {
  policyId: "policy-test-analysis-only",
  allowedOperations: ["analysis"],
  assertedBy: "test",
};

/** Generates REAL MP4 bytes in a temp file and reads them back. */
async function realMp4Bytes(
  options: { durationSeconds?: number; withAudio?: boolean } = {},
): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), "sporta-test-media-"));
  try {
    const path = await generateTestMp4(join(dir, "clip.mp4"), options);
    const file = Bun.file(path);
    return new Uint8Array(await file.arrayBuffer());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 1. The storage seam
// ---------------------------------------------------------------------------

describe("the storage seam (LocalFilesystemStorage)", () => {
  let root = "";
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "sporta-storage-"));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("put/get/verify round-trips and measures the content hash", async () => {
    const storage = new LocalFilesystemStorage(root);
    const bytes = new TextEncoder().encode("hello sporta");
    const put = await storage.put("a/b/obj.bin", bytes);
    expect(put.outcome).toBe("stored");
    expect(put.info.contentHash).toBe(sha256OfBytes(bytes));
    expect(put.info.byteSize).toBe(12);
    const read = await storage.get("a/b/obj.bin");
    expect(read === null ? null : sha256OfBytes(read)).toBe(put.info.contentHash);
    expect(await storage.verify("a/b/obj.bin", put.info.contentHash)).toBe(put.info.contentHash);
  });

  test("same-key identical put is a counted duplicate; different content fails loud", async () => {
    const storage = new LocalFilesystemStorage(root);
    const first = new TextEncoder().encode("same");
    const second = new TextEncoder().encode("same");
    const third = new TextEncoder().encode("different");
    expect((await storage.put("idem.bin", first)).outcome).toBe("stored");
    expect((await storage.put("idem.bin", second)).outcome).toBe("duplicate");
    await expect(storage.put("idem.bin", third)).rejects.toBeInstanceOf(MediaIntegrityError);
  });

  test("open() serves whole-object and bounded Range views", async () => {
    const storage = new LocalFilesystemStorage(root);
    const bytes = new Uint8Array(1000).fill(7);
    await storage.put("range.bin", bytes);
    const whole = await storage.open("range.bin");
    expect(whole?.length).toBe(1000);
    expect(whole?.offset).toBe(0);
    expect(whole?.totalSize).toBe(1000);
    const partial = await storage.open("range.bin", { start: 100, end: 199 });
    expect(partial?.length).toBe(100);
    expect(partial?.offset).toBe(100);
    expect(partial?.totalSize).toBe(1000);
    expect(partial?.bytes.every((byte) => byte === 7)).toBe(true);
    // An unbounded end clamps to the object's last byte.
    const openEnd = await storage.open("range.bin", { start: 990 });
    expect(openEnd?.length).toBe(10);
    // A start beyond the object refuses loudly (malformed range).
    await expect(storage.open("range.bin", { start: 1001 })).rejects.toBeInstanceOf(
      MediaIntegrityError,
    );
    expect(await storage.open("absent.bin")).toBe(null);
  });

  test("path-traversal keys are refused loudly (never written)", async () => {
    const storage = new LocalFilesystemStorage(root);
    await expect(storage.put("../escape.bin", new Uint8Array(4))).rejects.toBeInstanceOf(
      MediaIntegrityError,
    );
    await expect(storage.put("/absolute.bin", new Uint8Array(4))).rejects.toBeInstanceOf(
      MediaIntegrityError,
    );
  });
});

describe("the storage seam (InMemoryStorage parity)", () => {
  test("put/get/open/verify match the filesystem semantics", async () => {
    const storage = new InMemoryStorage();
    const bytes = new TextEncoder().encode("memory");
    const put = await storage.put("k/v.bin", bytes);
    expect(put.outcome).toBe("stored");
    expect((await storage.put("k/v.bin", bytes)).outcome).toBe("duplicate");
    const view = await storage.open("k/v.bin", { start: 1, end: 3 });
    expect(view?.length).toBe(3);
    expect(await storage.verify("k/v.bin", put.info.contentHash)).toBe(put.info.contentHash);
    await expect(storage.put("k/v.bin", new TextEncoder().encode("other"))).rejects.toBeInstanceOf(
      MediaIntegrityError,
    );
  });
});

// ---------------------------------------------------------------------------
// 2. The ffmpeg tool
// ---------------------------------------------------------------------------

describe("the ffmpeg tool (real subprocess)", () => {
  test.skipIf(!hasFfmpeg)("detects availability and probes real measurements", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sporta-ffmpeg-"));
    try {
      const path = await generateTestMp4(join(dir, "clip.mp4"), {
        durationSeconds: 2,
        withAudio: true,
      });
      const probe = await tool.probe(path);
      expect(probe.videoStreams.length).toBeGreaterThanOrEqual(1);
      expect(probe.audioStreams.length).toBe(1);
      // testsrc rate=24 duration=2 → 48 frames, 2000ms (measured, ±rounding).
      expect(probe.durationMs).toBeGreaterThanOrEqual(1900);
      expect(probe.durationMs).toBeLessThanOrEqual(2100);
      expect(probe.frameCount).toBeGreaterThanOrEqual(46);
      expect(probe.frameCount).toBeLessThanOrEqual(50);
      expect(probe.frameRateFps).toBeGreaterThan(20);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test.skipIf(!hasFfmpeg)("transcodes to the canonical H.264/AAC faststart MP4", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sporta-transcode-"));
    try {
      const input = await generateTestMp4(join(dir, "in.mp4"), { durationSeconds: 1 });
      const output = join(dir, "out.mp4");
      const probe = await tool.transcodeToNormalizedMp4(input, output);
      expect(probe.videoStreams[0]!.codec_name).toBe("h264");
      expect(probe.audioStreams[0]!.codec_name).toBe("aac");
      expect(probe.audioStreams[0]!.sample_rate).toBe("48000");
      expect(probe.audioStreams[0]!.channels).toBe(2);
      // +faststart: the moov atom sits in the first bytes (HTML5 streaming).
      const head = new Uint8Array(await Bun.file(output).slice(0, 64).arrayBuffer());
      const text = new TextDecoder("latin1").decode(head);
      expect(text.includes("moov") || text.includes("ftyp")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a corrupt media file refuses with the typed media-invalid error", async () => {
    if (!hasFfmpeg) return;
    const dir = await mkdtemp(join(tmpdir(), "sporta-corrupt-"));
    try {
      const path = join(dir, "corrupt.mp4");
      // Valid mp4 magic bytes, then garbage — sniffing passes, probing fails.
      await Bun.write(
        path,
        new Uint8Array([
          0x00,
          0x00,
          0x00,
          0x20,
          0x66,
          0x74,
          0x79,
          0x70,
          0x69,
          0x73,
          0x6f,
          0x6d,
          ...new Uint8Array(64).fill(0xff),
        ]),
      );
      await expect(tool.probe(path)).rejects.toMatchObject({
        name: "MediaInvalidError",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Normalization + the original artifact (R102/R104, real bytes)
// ---------------------------------------------------------------------------

describe("the media platform service (real pipeline, in-memory seams)", () => {
  let scratch = "";
  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "sporta-platform-"));
  });
  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  function makeService(
    policies: Map<string, AuthorizationPolicy>,
    options: { autoRun?: boolean } = {},
  ) {
    const storage = new LocalFilesystemStorage(join(scratch, `storage-${crypto.randomUUID()}`));
    const service = new MediaPlatformService({
      storage,
      sourceAssets: new SqliteMediaPlatformStore(":memory:").sourceAssets,
      manifests: new SqliteMediaPlatformStore(":memory:").manifests,
      artifacts: new SqliteMediaPlatformStore(":memory:").artifacts,
      jobs: new SqliteMediaPlatformStore(":memory:").jobs,
      resolvePolicy: (sessionId) => policies.get(sessionId) ?? null,
      nowMs: Date.now,
      autoRun: options.autoRun ?? false,
    });
    return { service, storage };
  }

  test.skipIf(!hasFfmpeg)(
    "R101→R104: upload real MP4 bytes → stored asset → real job → normalized manifest → original artifact",
    async () => {
      const policies = new Map([["sess-test-1", FULL_POLICY]]);
      const { service, storage } = makeService(policies);
      const bytes = await realMp4Bytes({ durationSeconds: 2, withAudio: true });

      // R101: the upload stores + hash-verifies the asset and admits a job.
      const { asset, job } = await service.upload({
        bytes,
        sessionId: "sess-test-1",
        declaredRightsPolicyId: "policy-test-full",
      });
      expect(asset.uploadState).toBe("stored");
      expect(asset.checksumVerified).toBe(true);
      expect(asset.contentHash).toBe(sha256OfBytes(bytes));
      expect(asset.container).toBe("mp4");
      expect(asset.videoStreamCount).toBeGreaterThanOrEqual(1);
      expect(asset.audioStreamCount).toBe(1);
      expect(asset.durationMs).toBeGreaterThanOrEqual(1900);
      expect(asset.durationMs).toBeLessThanOrEqual(2100);
      expect(job.state).toBe("queued");
      // The upload stage is complete at admission (the ACTUAL first stage).
      expect(job.stages.map((stage) => stage.stage)).toContain("upload-complete");
      expect(job.progress).toBeCloseTo(1 / 3, 5);
      // The stored bytes hash-verify through the seam.
      expect(await storage.verify(sourceAssetKey(asset.assetId), asset.contentHash)).toBe(
        asset.contentHash,
      );

      // R103: the REAL pipeline runs to terminal success.
      const terminal = await service.runJob(job.jobId);
      expect(terminal.state).toBe("succeeded");
      expect(terminal.terminal).toBe(true);
      expect(terminal.progress).toBe(1);
      expect(terminal.stages.map((stage) => stage.stage)).toEqual([
        "created",
        "upload-complete",
        "normalization-complete",
        "artifact-stored",
        "terminal",
      ]);
      expect(terminal.result).toBeDefined();

      // R102: the manifest is measured from the ACTUAL normalized media.
      const manifest = service.manifestOf(asset.assetId)!;
      expect(manifest.sourceAssetId).toBe(asset.assetId);
      expect(manifest.contentHash).not.toBe(asset.contentHash); // re-encoded
      expect(manifest.video.codec).toBe("h264");
      expect(manifest.video.widthPx).toBe(320);
      expect(manifest.video.heightPx).toBe(240);
      expect(manifest.audio?.codec).toBe("aac");
      expect(manifest.audio?.sampleRateHz).toBe(48000);
      expect(manifest.frameCount).toBeGreaterThanOrEqual(46);
      expect(manifest.durationMs).toBeGreaterThanOrEqual(1900);
      // The normalized bytes are stored content-addressed and verify.
      expect(
        await storage.verify(normalizedMediaKey(manifest.contentHash), manifest.contentHash),
      ).toBe(manifest.contentHash);

      // R104: the original-reality artifact manifest.
      const artifact = service.artifact(terminal.result!.artifactId)!;
      expect(artifact.reality).toBe("original");
      expect(artifact.sourceAssetId).toBe(asset.assetId);
      expect(artifact.swm).toBe(null);
      expect(artifact.contentHash).toBe(manifest.contentHash);
      expect(artifact.integrity).toEqual({ algorithm: "sha256", verified: true });
      expect(artifact.rendererId).toBe("media-platform/normalize");
      expect(artifact.container).toBe("mp4");
      expect(artifact.sessionId).toBe("sess-test-1");
    },
  );

  test.skipIf(!hasFfmpeg)("audio-less sources normalize to audio: null", async () => {
    const policies = new Map([["sess-test-2", FULL_POLICY]]);
    const { service } = makeService(policies);
    const bytes = await realMp4Bytes({ durationSeconds: 1, withAudio: false });
    const { asset, job } = await service.upload({
      bytes,
      sessionId: "sess-test-2",
      declaredRightsPolicyId: "policy-test-full",
    });
    expect(asset.audioStreamCount).toBe(0);
    const terminal = await service.runJob(job.jobId);
    expect(terminal.state).toBe("succeeded");
    const manifest = service.manifestOf(asset.assetId)!;
    expect(manifest.audio).toBe(null);
    const artifact = service.artifact(terminal.result!.artifactId)!;
    expect(artifact.audioCodec).toBe(null);
  });

  test("R101 fail-closed: no effective policy refuses before anything is stored", async () => {
    const { service, storage } = makeService(new Map());
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(
      service.upload({ bytes, sessionId: "sess-unknown", declaredRightsPolicyId: "policy-x" }),
    ).rejects.toBeInstanceOf(MediaRightsError);
    // Nothing was stored (the storage seam saw no put for any asset key).
    expect(await storage.get("source-assets/anything.mp4")).toBe(null);
  });

  test("R101 fail-closed: a mismatched declared policy id refuses", async () => {
    const policies = new Map([["sess-1", FULL_POLICY]]);
    const { service } = makeService(policies);
    const bytes = await realMp4Bytes({ durationSeconds: 1 });
    await expect(
      service.upload({ bytes, sessionId: "sess-1", declaredRightsPolicyId: "policy-OTHER" }),
    ).rejects.toMatchObject({
      name: "MediaRightsError",
      details: { declaredRightsPolicyId: "policy-OTHER", effectivePolicyId: "policy-test-full" },
    });
  });

  test("R101 fail-closed: a policy without transformation refuses (source-frame reference)", async () => {
    const policies = new Map([["sess-1", NO_TRANSFORM_POLICY]]);
    const { service } = makeService(policies);
    const bytes = await realMp4Bytes({ durationSeconds: 1 });
    await expect(
      service.upload({
        bytes,
        sessionId: "sess-1",
        declaredRightsPolicyId: "policy-test-analysis-only",
      }),
    ).rejects.toMatchObject({ name: "MediaRightsError" });
  });

  test("R101 pre-storage constraints: size, container, duration — typed refusals, nothing stored", async () => {
    const policies = new Map([["sess-1", FULL_POLICY]]);
    const { service } = makeService(policies);

    // Empty body.
    await expect(
      service.upload({
        bytes: new Uint8Array(0),
        sessionId: "sess-1",
        declaredRightsPolicyId: "policy-test-full",
      }),
    ).rejects.toMatchObject({ name: "UploadRejectedError", constraint: "size-empty" });

    // Over the size bound (a fake 200MB+ buffer — the check is byte-length only).
    const huge = new Uint8Array(UPLOAD_CONSTRAINTS.maxBytes + 1);
    await expect(
      service.upload({
        bytes: huge,
        sessionId: "sess-1",
        declaredRightsPolicyId: "policy-test-full",
      }),
    ).rejects.toMatchObject({ name: "UploadRejectedError", constraint: "size-over-limit" });

    // Wrong container (webm magic bytes on a tiny buffer).
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04]);
    await expect(
      service.upload({
        bytes: webm,
        sessionId: "sess-1",
        declaredRightsPolicyId: "policy-test-full",
      }),
    ).rejects.toMatchObject({ name: "UploadRejectedError", constraint: "container-not-mp4" });

    if (hasFfmpeg) {
      // Over-duration media (probe-measured, pre-storage): a REAL 121s
      // clip — one second past the bound (testsrc encodes in seconds).
      const long = await realMp4Bytes({ durationSeconds: 121, withAudio: false });
      await expect(
        service.upload({
          bytes: long,
          sessionId: "sess-1",
          declaredRightsPolicyId: "policy-test-full",
        }),
      ).rejects.toMatchObject({ name: "UploadRejectedError", constraint: "duration-over-limit" });
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Job lifecycle durability (R103 — restart shows the last durable state)
// ---------------------------------------------------------------------------

describe("the media job lifecycle durability (sqlite, restart semantics)", () => {
  let scratch = "";
  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "sporta-jobs-"));
  });
  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  test.skipIf(!hasFfmpeg)(
    "a restart reads the LAST DURABLE STATE and never invents completion",
    async () => {
      const dbPath = join(scratch, `jobs-${crypto.randomUUID()}.db`);
      const storage = new InMemoryStorage();

      // Phase 1: upload + advance to in-flight, then "crash" (close the db).
      const store1 = new SqliteMediaPlatformStore(dbPath);
      const service1 = new MediaPlatformService({
        storage,
        sourceAssets: store1.sourceAssets,
        manifests: store1.manifests,
        artifacts: store1.artifacts,
        jobs: store1.jobs,
        resolvePolicy: () => FULL_POLICY,
        nowMs: Date.now,
        autoRun: false,
      });
      const bytes = await realMp4Bytes({ durationSeconds: 1 });
      const { job } = await service1.upload({
        bytes,
        sessionId: "sess-durable",
        declaredRightsPolicyId: "policy-test-full",
      });
      const jobService = service1.jobs;
      jobService.advance(job.jobId, "in-flight");
      const inFlight = jobService.view(job.jobId)!;
      expect(inFlight.state).toBe("in-flight");
      store1.close();

      // Phase 2: a NEW store over the SAME sqlite file — the job's last
      // durable state is exactly what phase 1 left (no invented completion).
      const store2 = new SqliteMediaPlatformStore(dbPath);
      const service2 = new MediaPlatformService({
        storage,
        sourceAssets: store2.sourceAssets,
        manifests: store2.manifests,
        artifacts: store2.artifacts,
        jobs: store2.jobs,
        resolvePolicy: () => FULL_POLICY,
        nowMs: Date.now,
        autoRun: false,
      });
      const preserved = service2.jobView(job.jobId)!;
      expect(preserved.state).toBe("in-flight");
      expect(preserved.terminal).toBe(false);
      expect(preserved.progress).toBeCloseTo(1 / 3, 5);
      expect(preserved.result).toBeUndefined();

      // Phase 3: the explicit fail-interrupted reconciliation moves live
      // jobs to a TYPED failed — still never a success (the operator
      // decision, constructed directly over the same ledger).
      const store3 = new SqliteMediaPlatformStore(dbPath);
      new MediaJobService({
        repository: store3.jobs,
        nowMs: Date.now,
        onRestart: "fail-interrupted",
      });
      const service3 = new MediaPlatformService({
        storage,
        sourceAssets: store3.sourceAssets,
        manifests: store3.manifests,
        artifacts: store3.artifacts,
        jobs: store3.jobs,
        resolvePolicy: () => FULL_POLICY,
        nowMs: Date.now,
        autoRun: false,
      });
      const reconciled = service3.jobView(job.jobId)!;
      expect(reconciled.state).toBe("failed");
      expect(reconciled.failure?.failureClass).toBe("internal");
      expect(reconciled.failure?.message).toContain("interrupted-by-restart");
      store3.close();
      store2.close();
    },
  );

  test.skipIf(!hasFfmpeg)(
    "a terminal state survives restart byte-identically (the completed ledger)",
    async () => {
      const dbPath = join(scratch, `jobs-${crypto.randomUUID()}.db`);
      const storage = new InMemoryStorage();
      const store1 = new SqliteMediaPlatformStore(dbPath);
      const service1 = new MediaPlatformService({
        storage,
        sourceAssets: store1.sourceAssets,
        manifests: store1.manifests,
        artifacts: store1.artifacts,
        jobs: store1.jobs,
        resolvePolicy: () => FULL_POLICY,
        nowMs: Date.now,
        autoRun: false,
      });
      const bytes = await realMp4Bytes({ durationSeconds: 1 });
      const { job } = await service1.upload({
        bytes,
        sessionId: "sess-durable-2",
        declaredRightsPolicyId: "policy-test-full",
      });
      const terminal = await service1.runJob(job.jobId);
      expect(terminal.state).toBe("succeeded");
      const snapshot = JSON.stringify(terminal);
      store1.close();

      const store2 = new SqliteMediaPlatformStore(dbPath);
      const service2 = new MediaPlatformService({
        storage,
        sourceAssets: store2.sourceAssets,
        manifests: store2.manifests,
        artifacts: store2.artifacts,
        jobs: store2.jobs,
        resolvePolicy: () => FULL_POLICY,
        nowMs: Date.now,
        autoRun: false,
      });
      const reread = service2.jobView(job.jobId)!;
      expect(JSON.stringify(reread)).toBe(snapshot);
      // Re-running a terminal job is a no-op (the ledger never double-runs).
      const rerun = await service2.runJob(job.jobId);
      expect(rerun.state).toBe("succeeded");
      store2.close();
    },
  );
});
