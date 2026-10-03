/**
 * R607 62-c — the E2B MEDIA-FAILOVER GOLDEN-PATH DRIVER
 * (DEVELOPMENT-TIME EVIDENCE, not a test): the REAL corpus clip through
 * the repo's OWN media-toolchain worker hosted on the E2B sandbox, over
 * the REAL PUBLIC wire — the exact operations the hosted control plane's
 * `MEDIA_TOOLCHAIN=http + MEDIA_TOOLCHAIN_URL` configuration dispatches:
 *
 *   the live descriptor (fetched over the public wire) → admission
 *   (rights + magic-byte + REAL ffprobe on the received bytes, dispatched
 *   to the E2B worker) → normalization (REAL ffmpeg in the sandbox,
 *   measured manifest) → the original-reality artifact (content-addressed,
 *   hash-chained back to the source) → playable (faststart moov-first +
 *   a real driver-side ffprobe of the stored bytes) → the accounting
 *   snapshot + identities → the non-degradation law (the DEFAULT
 *   in-process executor over the SAME bytes → byte-identical output) →
 *   the derived-reality REMOTE render (the design-support measurement for
 *   the recorded admission gap: a REAL tactical.prototype render executed
 *   by the E2B compute worker over the wire) → the fail-closed boundary
 *   record (an unreachable worker URL → the typed ffmpeg-unavailable
 *   refusal, never silence).
 *
 * Every number is MEASURED; shas are FULL sha-256 hex strings computed
 * from the bytes; job ids are the workers' real ids. The record lives at
 * golden-path.json next to this script.
 *
 * Prerequisite: provider-record.json (provision-e2b.ts) + the sandbox up.
 * Run (from the REPO ROOT):
 *   bun run scripts/evidence/r607-e2b-media-failover/golden-path.ts
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  FfmpegTool,
  InProcessMediaToolchain,
  LocalFilesystemStorage,
  MediaPlatformService,
  SqliteMediaPlatformStore,
  createHttpMediaToolchain,
  fetchMediaToolchainDescriptor,
  normalizedMediaKey,
  sha256OfBytes,
} from "@sporta/media-platform";
import type { MediaToolchainStats } from "@sporta/compute-adapter-hosted";
import type { AuthorizationPolicy } from "@sporta/contracts";
import { buildEventEnvelope, buildWorldSnapshot } from "@sporta/testing";
import { TACTICAL_OUTPUT_PROFILES } from "@sporta/renderer-tactical";
import {
  canonicalJsonOf,
  ComputeDispatchRequest,
  sha256OfCanonicalJson,
} from "@sporta/compute-adapter";
import { assertMediaToolchainAccounting } from "@sporta/compute-adapter-hosted";

const HERE = dirname(new URL(import.meta.url).pathname);
const REPO_ROOT = resolve(HERE, "../../..");

// The provider record (provision-e2b.ts output) — the worker URLs.
const providerRecord = JSON.parse(
  await readFile(resolve(HERE, "provider-record.json"), "utf8"),
) as {
  workers: {
    media: { publicUrl: string };
    compute: { publicUrl: string };
  };
  provider: { sandbox: { sandboxId: string } };
};
const MEDIA_BASE = providerRecord.workers.media.publicUrl;
const COMPUTE_BASE = providerRecord.workers.compute.publicUrl;
console.log(`[driver] E2B media worker:     ${MEDIA_BASE}`);
console.log(`[driver] E2B compute worker:   ${COMPUTE_BASE}`);

// The REAL corpus clip — the exact clip of the 2026-09-26 hosted run
// (scripts/evidence/spr-corpus-bytes/, the frozen authorized substrate).
const CLIP_PATH = resolve(REPO_ROOT, "scripts/evidence/spr-corpus-bytes/clip-b1-wide-broadcast.mp4");
const sourceBytes = new Uint8Array(await readFile(CLIP_PATH));
const sourceHash = sha256OfBytes(sourceBytes);
console.log(
  `[driver] source: ${sourceBytes.byteLength} bytes, sha-256 ${sourceHash} (clip-b1-wide-broadcast.mp4 — the 2026-09-26 run's clip)`,
);

// The driver-side local tool (playability probes + the non-degradation run).
const tool = new FfmpegTool();
if (!(await tool.available())) {
  console.error("FATAL: the driver sandbox's local ffmpeg does not resolve (needed for the non-degradation + playability probes)");
  process.exit(1);
}

// Health + the descriptor, fetched LIVE over the public wire (never invented).
const health = await (await fetch(`${MEDIA_BASE}/health`)).json();
const descriptor = await fetchMediaToolchainDescriptor(MEDIA_BASE);
if (!descriptor.toolchain.resolved || descriptor.operations.length === 0) {
  console.error(
    `FATAL: the E2B media worker at ${MEDIA_BASE} is not toolchain-capable (resolved=${descriptor.toolchain.resolved})`,
  );
  process.exit(1);
}
console.log(`[driver] E2B toolchain: ${descriptor.toolchain.ffmpegVersion}`);

/** A full wall-clock measurement pair (dev-time measurement code). */
async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; wallMs: number }> {
  const startedAt = Date.now();
  const value = await fn();
  return { value, wallMs: Math.max(0, Date.now() - startedAt) };
}

async function fetchStats(base: string): Promise<MediaToolchainStats> {
  const response = await fetch(`${base}/v1/media/stats`);
  if (!response.ok) throw new Error(`stats fetch failed: HTTP ${response.status}`);
  return (await response.json()) as MediaToolchainStats;
}

async function fetchUsage(base: string): Promise<unknown[]> {
  const response = await fetch(`${base}/v1/media/usage`);
  if (!response.ok) throw new Error(`usage fetch failed: HTTP ${response.status}`);
  return (await response.json()) as unknown[];
}

// The control-plane-side composition over the http seam (the EXACT shape
// the hosted web composition wires when MEDIA_TOOLCHAIN=http).
const scratch = await mkdtemp(join(tmpdir(), "sporta-r607-e2b-golden-"));
const storage = new LocalFilesystemStorage(join(scratch, "media-storage"), "r607-e2b-golden");
const store = new SqliteMediaPlatformStore(join(scratch, "ledger.sqlite"));
const POLICY: AuthorizationPolicy = {
  policyId: "policy-r607-e2b-golden",
  allowedOperations: ["analysis", "transformation", "storage", "derivativeGeneration"],
  assertedBy: "r607-e2b-golden-path-driver",
};
const SESSION_ID = "sess-r607-e2b-golden";
const service = new MediaPlatformService({
  storage,
  sourceAssets: store.sourceAssets,
  manifests: store.manifests,
  artifacts: store.artifacts,
  jobs: store.jobs,
  resolvePolicy: () => POLICY,
  nowMs: Date.now,
  autoRun: false,
  toolchain: createHttpMediaToolchain(MEDIA_BASE),
});

try {
  // --- stage 0: the E2B worker ledger state at driver start.
  const stats0 = await fetchStats(MEDIA_BASE);
  assertMediaToolchainAccounting(stats0);

  // --- stage 1: admission (rights + magic-byte + ffprobe on the received
  //     bytes — the probe dispatched over the public E2B wire).
  const admission = await timed(() =>
    service.upload({
      bytes: sourceBytes,
      sessionId: SESSION_ID,
      declaredRightsPolicyId: POLICY.policyId,
    }),
  );
  const { asset, job } = admission.value;
  if (asset.uploadState !== "stored" || !asset.checksumVerified) {
    throw new Error(`admission did not store a verified asset: ${JSON.stringify(asset)}`);
  }
  if (asset.contentHash !== sourceHash) {
    throw new Error("the stored asset's contentHash does not equal the measured source sha-256");
  }
  const statsAfterAdmission = await fetchStats(MEDIA_BASE);
  const usageAfterAdmission = await fetchUsage(MEDIA_BASE);
  if (statsAfterAdmission.jobsDispatched - stats0.jobsDispatched !== 1) {
    throw new Error(
      `admission accounting: dispatched delta ${statsAfterAdmission.jobsDispatched - stats0.jobsDispatched} (expected 1)`,
    );
  }
  const probeJobId = (
    usageAfterAdmission[usageAfterAdmission.length - 1] as { jobId: string }
  ).jobId;
  const probeJobRecord = await (await fetch(`${MEDIA_BASE}/v1/media/jobs/${probeJobId}`)).json();

  // --- stage 2: normalization (REAL ffmpeg in the E2B sandbox).
  const normalization = await timed(() => service.runJob(job.jobId));
  const terminal = normalization.value;
  if (terminal.state !== "succeeded" || terminal.progress !== 1) {
    throw new Error(`the pipeline did not succeed: ${JSON.stringify(terminal)}`);
  }
  const manifest = service.manifestOf(asset.assetId);
  if (manifest === undefined) throw new Error("no manifest after a succeeded pipeline");
  const artifact = service.artifact(terminal.result!.artifactId);
  if (artifact === undefined) throw new Error("no artifact after a succeeded pipeline");

  // --- stage 3: the hash chain, verified END-TO-END from the bytes.
  const storedBytes = await storage.get(normalizedMediaKey(manifest.contentHash));
  if (storedBytes === null) throw new Error("the normalized bytes are not in the store");
  const storedHash = sha256OfBytes(storedBytes);
  const chain = {
    sourceHashMeasured: sourceHash,
    assetContentHash: asset.contentHash,
    manifestContentHash: manifest.contentHash,
    artifactContentHash: artifact.contentHash,
    storedBytesHashMeasured: storedHash,
    storedByteSize: storedBytes.byteLength,
  };
  const chainChecks = [
    chain.assetContentHash === chain.sourceHashMeasured,
    chain.manifestContentHash === chain.storedBytesHashMeasured,
    chain.artifactContentHash === chain.storedBytesHashMeasured,
    manifest.byteSize === storedBytes.byteLength,
    artifact.byteSize === storedBytes.byteLength,
    artifact.sourceAssetId === asset.assetId,
    artifact.integrity.algorithm === "sha256",
  ];
  if (chainChecks.some((ok) => !ok)) {
    throw new Error(`the hash chain verification failed: ${JSON.stringify(chain)}`);
  }

  // --- stage 4: the accounting snapshot + identities (over the wire).
  const statsFinal = await fetchStats(MEDIA_BASE);
  const usageFinal = await fetchUsage(MEDIA_BASE);
  assertMediaToolchainAccounting(statsFinal);
  const identity1 =
    statsFinal.jobsDispatched === statsFinal.succeeded + statsFinal.failed + statsFinal.inFlight;
  const identity2 = statsFinal.usageRecords === statsFinal.succeeded + statsFinal.failed;
  if (!identity1 || !identity2) throw new Error("an accounting identity failed");
  if (usageFinal.length !== statsFinal.usageRecords) {
    throw new Error(`stats and the usage drain disagree: ${usageFinal.length} vs ${statsFinal.usageRecords}`);
  }
  // The normalize job of THIS run: the most recent usage record that is not
  // this run's probe job (the ledger is cumulative across driver runs —
  // the W914 driver demanded an empty ledger; this driver measures deltas).
  const normalizeJobId = (
    [...usageFinal]
      .reverse()
      .find((r) => (r as { jobId: string }).jobId !== probeJobId) as { jobId: string }
  ).jobId;
  const normalizeJobRecord = (await (
    await fetch(`${MEDIA_BASE}/v1/media/jobs/${normalizeJobId}`)
  ).json()) as {
    result?: {
      artifact?: { sourceContentHash?: string; contentHash?: string };
      metering?: { executionMs: number; ffprobeRuns: number; ffmpegRuns: number };
    };
  };
  const envelopeArtifact = normalizeJobRecord.result?.artifact;
  if (
    envelopeArtifact?.sourceContentHash !== sourceHash ||
    envelopeArtifact?.contentHash !== storedHash
  ) {
    throw new Error(
      `the E2B worker envelope's hash chain does not match the measured bytes: ${JSON.stringify(envelopeArtifact)}`,
    );
  }

  // --- stage 5: playability (the canonical faststart MP4 + a REAL
  //     driver-side ffprobe of the stored bytes).
  const head = new TextDecoder("latin1").decode(storedBytes.slice(0, 8192));
  const moovAt = head.indexOf("moov");
  const mdatAt = head.indexOf("mdat");
  const moovBeforeMdat = moovAt !== -1 && (mdatAt === -1 || moovAt < mdatAt);
  const playbackProbePath = join(scratch, "playback-check.mp4");
  await writeFile(playbackProbePath, storedBytes);
  const playbackProbe = await tool.probe(playbackProbePath);
  const playable =
    moovBeforeMdat &&
    playbackProbe.videoStreams.some((s) => s.codec_name === "h264") &&
    Math.abs(playbackProbe.durationMs - asset.durationMs) <= 500;

  // --- stage 6: the NON-DEGRADATION LAW, measured at BOTH boundaries.
  //     (a) CROSS-BUILD (honest difference, recorded as such): the DEFAULT
  //     in-process executor (this driver's local ffmpeg build) vs the E2B
  //     worker (the sandbox's Debian-12 ffmpeg build) — the W914 law's own
  //     wording binds byte-identity to "the same ffmpeg build"; across
  //     builds the encoded bytes legitimately differ (the provider-class
  //     difference, never a transport degradation);
  //     (b) SAME-PROVIDER determinism (the E2B provider's OWN
  //     reproducibility): the SAME bytes dispatched AGAIN to the SAME E2B
  //     worker → the SAME output sha (byte-identity within one build).
  const inProcessToolchain = new InProcessMediaToolchain({ tool, nowMs: Date.now });
  const inProcessNormalization = await timed(() => inProcessToolchain.normalizeMedia(sourceBytes));
  const inProcessHash = sha256OfBytes(inProcessNormalization.value.outputBytes);
  const e2bSecondNormalization = await timed(() =>
    createHttpMediaToolchain(MEDIA_BASE).normalizeMedia(sourceBytes),
  );
  const e2bSecondHash = sha256OfBytes(e2bSecondNormalization.value.outputBytes);
  const crossBuildByteIdentical = inProcessHash === storedHash;
  const sameProviderByteIdentical = e2bSecondHash === storedHash;

  // --- stage 7: the DERIVED-REALITY REMOTE RENDER (the design-support
  //     measurement for the recorded admission gap): a REAL
  //     tactical.prototype render dispatched to the E2B compute worker
  //     over the wire — the remote execution plane the hosted composition
  //     CANNOT yet dispatch to (its admission is local-plane-gated; the
  //     gap is recorded in the evidence pack README).
  const SESSION_REMOTE = "sess-r607-e2b-remote-render";
  const snapshot = buildWorldSnapshot({ sessionId: SESSION_REMOTE });
  const events = [
    {
      sequence: snapshot.watermark.sequence + 1,
      snapshotVersionAfter: 1,
      event: buildEventEnvelope({
        sessionId: SESSION_REMOTE,
        eventTimeMs: snapshot.watermark.watermarkMs + 1,
      }),
    },
  ];
  const snapshotPayload = { snapshotVersion: 1, snapshot };
  const eventsPayload = { fromSequence: snapshot.watermark.sequence, entries: events };
  const tacticalProfile = TACTICAL_OUTPUT_PROFILES[0]!;
  const remoteRenderRequest = ComputeDispatchRequest.parse({
    job: {
      schemaVersion: "1.0",
      jobId: `render-job-r607-e2b-tactical-${Date.now()}`,
      idempotencyKey: `render-r607-e2b-tactical-key-${Date.now()}`,
      sessionId: SESSION_REMOTE,
      correlationId: "corr-r607-e2b",
      traceId: "trace-r607-e2b",
      renderer: { rendererId: "tactical.prototype" },
      recipe: { styleId: "style-r607-e2b", configSchemaVersion: "1.0", config: {} },
      inputs: [
        {
          inputId: "swm-snapshot",
          kind: "swm-snapshot",
          ref: `swm-snapshot:${SESSION_REMOTE}:v1`,
          contentHash: await sha256OfCanonicalJson(snapshotPayload),
          byteSize: canonicalJsonOf(snapshotPayload).length,
        },
        {
          inputId: "swm-events",
          kind: "swm-event-window",
          ref: `swm-events:${SESSION_REMOTE}:from-${snapshot.watermark.sequence}`,
          contentHash: await sha256OfCanonicalJson(eventsPayload),
          byteSize: canonicalJsonOf(eventsPayload).length,
        },
      ],
      outputProfile: {
        resolution: { w: tacticalProfile.resolution.w, h: tacticalProfile.resolution.h },
        frameRate: tacticalProfile.frameRate,
        codec: tacticalProfile.codec,
        container: tacticalProfile.container,
        latencyClass: "offline",
      },
      rights: { policyRef: POLICY.policyId, canReferenceSourceFrames: true },
      constraints: { deadlineMs: 60_000, priority: 0 },
    },
    inputs: [
      { inputId: "swm-snapshot", kind: "swm-snapshot", payload: snapshotPayload },
      { inputId: "swm-events", kind: "swm-event-window", payload: eventsPayload },
    ],
  });
  const remoteRenderStarted = Date.now();
  const remoteRenderResponse = await fetch(`${COMPUTE_BASE}/v1/jobs/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(remoteRenderRequest),
    signal: AbortSignal.timeout(120_000),
  });
  const remoteRenderWallMs = Date.now() - remoteRenderStarted;
  const remoteRenderBody = (await remoteRenderResponse.json()) as {
    disposition?: string;
    result?: {
      status?: string;
      outputs?: {
        artifactId?: string;
        contentHash?: string;
        contentType?: string;
        byteLength?: number;
        delivery?: { mode?: string; content?: string };
        manifest?: { bridge?: string; geometry?: { frameCount?: number; fps?: number } };
      }[];
      metering?: { executionMs?: number; framesRendered?: number; bytesEncoded?: number };
      failure?: { errorClass?: string; message?: string };
    };
  };
  const remoteOutput = remoteRenderBody.result?.outputs?.[0];
  const remoteMp4 = remoteOutput?.delivery?.content
    ? Buffer.from(remoteOutput.delivery.content, "base64")
    : null;
  const remoteRender = {
    note: "a REAL tactical.prototype derived-reality render executed by the E2B compute worker over the public wire — the remote execution plane the recorded ADMISSION gap keeps the hosted app from dispatching to (design support for the TL decision, NOT a hosted-path claim)",
    computeWorkerUrl: COMPUTE_BASE,
    httpStatusCode: remoteRenderResponse.status,
    disposition: remoteRenderBody.disposition,
    wallMs: remoteRenderWallMs,
    status: remoteRenderBody.result?.status,
    rendererId: "tactical.prototype",
    jobId: remoteRenderRequest.job.jobId,
    workerMetering: remoteRenderBody.result?.metering,
    artifact: remoteOutput
      ? {
          contentType: remoteOutput.contentType,
          artifactId: remoteOutput.artifactId,
          contentHash: remoteOutput.contentHash,
          inlineByteLength: remoteOutput.byteLength,
          rawMp4Bytes: remoteMp4?.byteLength ?? 0,
          bridge: remoteOutput.manifest?.bridge,
          frameCount: remoteOutput.manifest?.geometry?.frameCount,
          ftypMagic: remoteMp4 ? remoteMp4.subarray(4, 8).toString("ascii") : null,
          sha256OfRawBytes: remoteMp4 ? sha256OfBytes(new Uint8Array(remoteMp4)) : null,
          hashChainVerified:
            remoteMp4 !== null &&
            remoteOutput.contentHash === sha256OfBytes(new Uint8Array(remoteMp4)),
        }
      : null,
    failure: remoteRenderBody.result?.failure ?? null,
  };

  // --- stage 8: the fail-closed boundary record (an UNREACHABLE worker URL
  //     → the typed ffmpeg-unavailable refusal — the honest hosted posture
  //     when the provider is down; never silence, never a faked transform).
  const unreachableExecutor = createHttpMediaToolchain(
    `https://3971-00000000000000000000.e2b.app`,
    { deadlineMs: 15_000 },
  );
  let boundaryErrorClass = "";
  try {
    await unreachableExecutor.probeMedia(sourceBytes.subarray(0, 4096));
    boundaryErrorClass = "NO-ERROR (unexpected — the unreachable worker accepted a probe?)";
  } catch (error) {
    boundaryErrorClass = `${(error as Error).name}: ${(error as Error).message.slice(0, 160)}`;
  }

  // --- the record (full shas only; every number measured).
  const record = {
    schemaVersion: "1.0",
    kind: "r607-e2b-media-failover-golden-path",
    note: "run at the branch tip (see commands.md for the exact invocation)",
    mediaWorkerUrl: MEDIA_BASE,
    computeWorkerUrl: COMPUTE_BASE,
    sandboxId: providerRecord.provider.sandbox.sandboxId,
    workerHealth: health,
    descriptor,
    driverLocalToolchain: { ffmpegVersion: await tool.version() },
    source: {
      clipId: "sprclip-b1-wide-broadcast (the 2026-09-26 hosted run's clip)",
      path: "scripts/evidence/spr-corpus-bytes/clip-b1-wide-broadcast.mp4",
      byteSize: sourceBytes.byteLength,
      sha256: sourceHash,
    },
    ledgerBefore: { dispatched: stats0.jobsDispatched, usageRecords: stats0.usageRecords },
    stages: {
      admission: {
        assetId: asset.assetId,
        mediaJobId: job.jobId,
        workerJobId: probeJobId,
        workerJob: probeJobRecord,
        clientWallMs: admission.wallMs,
        workerExecutionMs: (probeJobRecord as { metering?: { executionMs: number } }).metering
          ?.executionMs,
        measuredDurationMs: asset.durationMs,
        videoStreamCount: asset.videoStreamCount,
        audioStreamCount: asset.audioStreamCount,
        uploadState: asset.uploadState,
        checksumVerified: asset.checksumVerified,
      },
      normalization: {
        mediaJobId: job.jobId,
        terminalState: terminal.state,
        workerJobId: normalizeJobId,
        workerExecutionMs: normalizeJobRecord.result?.metering?.executionMs,
        workerFfprobeRuns: normalizeJobRecord.result?.metering?.ffprobeRuns,
        workerFfmpegRuns: normalizeJobRecord.result?.metering?.ffmpegRuns,
        clientWallMs: normalization.wallMs,
        pipelineNormalizationMs: terminal.result?.normalizationMs,
      },
    },
    manifest: {
      manifestId: manifest.manifestId,
      sourceAssetId: manifest.sourceAssetId,
      contentHash: manifest.contentHash,
      byteSize: manifest.byteSize,
      durationMs: manifest.durationMs,
      frameCount: manifest.frameCount,
      video: manifest.video,
      audio: manifest.audio,
    },
    artifact: {
      artifactId: artifact.artifactId,
      reality: artifact.reality,
      contentHash: artifact.contentHash,
      byteSize: artifact.byteSize,
      container: artifact.container,
      videoCodec: artifact.videoCodec,
      audioCodec: artifact.audioCodec,
      durationMs: artifact.durationMs,
      rendererId: artifact.rendererId,
      rendererVersion: artifact.rendererVersion,
      integrity: artifact.integrity,
      storageKey: normalizedMediaKey(manifest.contentHash),
    },
    hashChain: chain,
    hashChainChecksPassed: chainChecks.filter((ok) => ok).length,
    hashChainChecksTotal: chainChecks.length,
    playability: {
      moovBeforeMdat,
      moovOffset: moovAt,
      mdatOffset: mdatAt,
      probeDurationMs: playbackProbe.durationMs,
      probeVideoCodec: playbackProbe.videoStreams[0]?.codec_name ?? null,
      probeAudioCodec: playbackProbe.audioStreams[0]?.codec_name ?? null,
      playable,
    },
    nonDegradation: {
      note: "(a) cross-build: the DEFAULT in-process executor (this driver's local ffmpeg) vs the E2B worker (the sandbox's Debian-12 ffmpeg) — the W914 byte-identity law binds to the SAME ffmpeg build; across builds the bytes differ by the codec build itself (recorded honestly, never laundered as transport degradation); (b) same-provider: the SAME bytes re-dispatched to the SAME E2B worker → byte-identical output (the provider's own determinism)",
      driverLocalFfmpeg: await tool.version(),
      e2bWorkerFfmpeg: descriptor.toolchain.ffmpegVersion,
      inProcessSha256: inProcessHash,
      e2bFirstSha256: storedHash,
      e2bSecondSha256: e2bSecondHash,
      crossBuildByteIdentical,
      sameProviderByteIdentical,
      e2bSecondRunWallMs: e2bSecondNormalization.wallMs,
      e2bSecondRunExecutionMs: e2bSecondNormalization.value.executionMs,
    },
    derivedRealityRemoteRender: remoteRender,
    boundaryRecord: {
      note: "an UNREACHABLE E2B worker URL → the typed ffmpeg-unavailable refusal at the admission seam (fail-closed: the pipeline never claims a transform it did not perform)",
      errorObserved: boundaryErrorClass,
    },
    accounting: {
      stats: statsFinal,
      identity1DispatchedEqualsTerminalPlusInFlight: identity1,
      identity2UsageRecordsEqualsTerminal: identity2,
      usageDrainCount: usageFinal.length,
      usageRecords: usageFinal,
    },
  };

  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(HERE, { recursive: true });
  const outPath = join(HERE, "golden-path.json");
  writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");

  console.log("=== R607/62-c E2B media-failover golden path (measured) ===");
  console.log(`E2B media worker:  ${MEDIA_BASE}`);
  console.log(`E2B toolchain:     ${descriptor.toolchain.ffmpegVersion}`);
  console.log(`source:            ${sourceBytes.byteLength} bytes, sha-256 ${sourceHash}`);
  console.log(
    `admission:         client ${admission.wallMs}ms (worker execution ${record.stages.admission.workerExecutionMs}ms, job ${probeJobId}); duration measured ${asset.durationMs}ms; ${asset.videoStreamCount}v/${asset.audioStreamCount}a streams`,
  );
  console.log(
    `normalization:     client ${normalization.wallMs}ms (worker execution ${record.stages.normalization.workerExecutionMs}ms, job ${normalizeJobId}; ffprobe x${record.stages.normalization.workerFfprobeRuns}, ffmpeg x${record.stages.normalization.workerFfmpegRuns})`,
  );
  console.log(
    `artifact:          ${artifact.byteSize} bytes, sha-256 ${artifact.contentHash} (hash chain ${record.hashChainChecksPassed}/${record.hashChainChecksTotal} links verified)`,
  );
  console.log(
    `playable:          ${playable} (moov@${moovAt} before mdat@${mdatAt}; driver-side ffprobe: ${playbackProbe.videoStreams[0]?.codec_name}/${playbackProbe.audioStreams[0]?.codec_name ?? "no-audio"}, ${playbackProbe.durationMs}ms)`,
  );
  console.log(
    `non-degradation:   cross-build ${crossBuildByteIdentical ? "BYTE-IDENTICAL" : `DIFFERENT (driver ${inProcessHash.slice(0, 12)}… [${(await tool.version())?.slice(0, 40)}] vs E2B ${storedHash.slice(0, 12)}… [${descriptor.toolchain.ffmpegVersion?.slice(0, 40)}] — the codec-build difference, recorded)`}; same-provider ${sameProviderByteIdentical ? "BYTE-IDENTICAL" : "MISMATCH"} (E2B run2 ${e2bSecondHash.slice(0, 16)}…, ${e2bSecondNormalization.wallMs}ms)`,
  );
  console.log(
    `remote derived:    tactical.prototype over the wire → HTTP ${remoteRenderResponse.status} ${remoteRenderBody.result?.status} (${remoteRenderWallMs}ms wall, worker execution ${remoteRenderBody.result?.metering?.executionMs}ms; MP4 ${remoteMp4?.byteLength ?? 0}B, ftyp ${remoteRender.artifact?.ftypMagic}, hash-chain ${remoteRender.artifact?.hashChainVerified})`,
  );
  console.log(
    `boundary:          unreachable worker → ${boundaryErrorClass.slice(0, 120)}`,
  );
  console.log(
    `accounting:        dispatched=${statsFinal.jobsDispatched} === succeeded(${statsFinal.succeeded}) + failed(${statsFinal.failed}) + inFlight(${statsFinal.inFlight}); usageRecords=${statsFinal.usageRecords}; usage drain agrees (${usageFinal.length}); duplicates=${statsFinal.duplicates}; capacityRefusals=${statsFinal.capacityRefusals}; probeRuns=${statsFinal.probeRuns}; transcodeRuns=${statsFinal.transcodeRuns}; in=${statsFinal.inputBytes}B out=${statsFinal.outputBytes}B; totalExecutionMs=${statsFinal.totalExecutionMs}`,
  );
  console.log(`record:            ${outPath}`);
} finally {
  store.close();
  await rm(scratch, { recursive: true, force: true });
}
