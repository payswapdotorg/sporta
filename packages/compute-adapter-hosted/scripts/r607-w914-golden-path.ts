/**
 * R607 lane B — the W914 http compute adapter GOLDEN-PATH DRIVER
 * (DEVELOPMENT-TIME EVIDENCE, not a test): one REAL upload through the
 * media-toolchain compute worker over the REAL HTTP wire —
 *
 *   admission (rights + magic-byte + REAL ffprobe on the received bytes,
 *   dispatched to the worker) → normalization (REAL ffmpeg, measured
 *   manifest) → the original-reality artifact (content-addressed,
 *   hash-chained back to the source) → playable (faststart moov-first +
 *   a real ffprobe of the stored bytes) → the accounting snapshot
 *   (dispatched === terminal + in-flight; usage records; the two
 *   independent reads stats/usage agree) → the honest boundary record
 *   (an unresolved-toolchain worker reproduces the R607 hosted
 *   ffmpeg-unavailable refusal class over the wire).
 *
 * Modes:
 *   --worker-url http://127.0.0.1:3971   dispatch against an ALREADY-RUNNING
 *                                        external worker (the standalone
 *                                        `r607-media-toolchain-worker.ts` —
 *                                        the exact topology the hosted
 *                                        control plane would use with an
 *                                        external toolchain worker URL);
 *   (default)                            start an embedded
 *                                        `createMediaToolchainServer` on the
 *                                        same fixed port (real Bun.serve
 *                                        socket, same code path) and stop it
 *                                        at the end.
 *
 * Every number in the record is MEASURED (client-observed wall clock +
 * the worker's own metering counters via /v1/media/*); shas are FULL
 * sha-256 hex strings computed from the bytes (never guessed, never
 * truncated); job ids are the ledger's real ids.
 *
 * Outputs `<out>/golden-path.json` + a stdout summary. Run twice to check
 * determinism (source and artifact shas must reproduce; timings and ids
 * vary — the record marks them as measured).
 *
 * Run (from this package's directory):
 *   bun run scripts/r607-w914-golden-path.ts
 *   bun run scripts/r607-w914-golden-path.ts --worker-url http://127.0.0.1:3971
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  FfmpegTool,
  LocalFilesystemStorage,
  MediaPlatformService,
  SqliteMediaPlatformStore,
  createHttpMediaToolchain,
  fetchMediaToolchainDescriptor,
  generateTestMp4,
  normalizedMediaKey,
  sha256OfBytes,
} from "@sporta/media-platform";
import type { AuthorizationPolicy } from "@sporta/contracts";
import { ComputeUsageRecord } from "@sporta/compute-adapter";
import {
  MediaToolchainWorker,
  assertMediaToolchainAccounting,
  createMediaToolchainServer,
  createMediaToolchainWorker,
} from "../src/index";
import type { MediaToolchainStats } from "../src/index";

// ---------------------------------------------------------------------------
// CLI (dev-time: argparse by hand, no deps)
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}
const workerUrlArg = argValue("--worker-url");
const outDir = resolve(
  import.meta.dirname,
  "../../../scripts/evidence/r607-w914-toolchain",
);

/** A full wall-clock measurement pair (dev-time measurement code). */
function timed<T>(fn: () => Promise<T>): Promise<{ value: T; wallMs: number }> {
  const startedAt = Date.now();
  return fn().then((value) => ({ value, wallMs: Math.max(0, Date.now() - startedAt) }));
}

/** Fetches the worker's stats (the accounting snapshot, over the wire). */
async function fetchStats(base: string): Promise<MediaToolchainStats> {
  const response = await fetch(`${base}/v1/media/stats`);
  if (!response.ok) throw new Error(`stats fetch failed: HTTP ${response.status}`);
  return (await response.json()) as MediaToolchainStats;
}

/** Fetches the worker's usage drain (the independent second read). */
async function fetchUsage(base: string): Promise<unknown[]> {
  const response = await fetch(`${base}/v1/media/usage`);
  if (!response.ok) throw new Error(`usage fetch failed: HTTP ${response.status}`);
  return (await response.json()) as unknown[];
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

const REPO_ROOT_NOTE = "run at the branch tip (see commands.md for the exact invocations)";

const tool = new FfmpegTool();
const toolResolved = await tool.available();
if (!toolResolved) {
  console.error(
    "FATAL: the local ffmpeg/ffprobe toolchain does not resolve — this evidence run requires a toolchain-capable sandbox (fail-loud, never faked)",
  );
  process.exit(1);
}
const ffmpegVersion = await tool.version();

// The worker: external (already running) or embedded on the same fixed port.
const FIXED_PORT = 3971;
let embeddedServer: ReturnType<typeof createMediaToolchainServer> | undefined;
let embeddedWorker: MediaToolchainWorker | undefined;
let base: string;
if (workerUrlArg !== undefined) {
  base = workerUrlArg.replace(/\/+$/, "");
  console.log(`[driver] mode: EXTERNAL worker at ${base} (the hosted-plane topology)`);
} else {
  embeddedWorker = createMediaToolchainWorker({ tool, nowMs: Date.now });
  embeddedServer = createMediaToolchainServer({ worker: embeddedWorker, port: FIXED_PORT });
  base = `http://127.0.0.1:${embeddedServer.port}`;
  console.log(`[driver] mode: EMBEDDED worker on the fixed port ${FIXED_PORT} (real Bun.serve socket)`);
}

// Health + the descriptor, fetched LIVE (never invented).
const health = await (await fetch(`${base}/health`)).json();
const descriptor = await fetchMediaToolchainDescriptor(base);
if (!descriptor.toolchain.resolved || descriptor.operations.length === 0) {
  console.error(
    `FATAL: the worker at ${base} is not toolchain-capable (resolved=${descriptor.toolchain.resolved}) — this golden path requires a resolved toolchain (fail-loud, never faked)`,
  );
  embeddedServer?.stop(true);
  process.exit(1);
}

// The control-plane-side composition over the http seam.
const scratch = await mkdtemp(join(tmpdir(), "sporta-r607-w914-golden-"));
const storage = new LocalFilesystemStorage(join(scratch, "media-storage"), "r607-w914-golden");
const store = new SqliteMediaPlatformStore(join(scratch, "ledger.sqlite"));
const POLICY: AuthorizationPolicy = {
  policyId: "policy-r607-w914-golden",
  allowedOperations: ["analysis", "transformation", "storage", "derivativeGeneration"],
  assertedBy: "r607-w914-golden-path-driver",
};
const SESSION_ID = "sess-r607-w914-golden";
const service = new MediaPlatformService({
  storage,
  sourceAssets: store.sourceAssets,
  manifests: store.manifests,
  artifacts: store.artifacts,
  jobs: store.jobs,
  resolvePolicy: () => POLICY,
  nowMs: Date.now,
  autoRun: false,
  toolchain: createHttpMediaToolchain(base),
});

try {
  // --- stage 0: the ledger must start EMPTY (a fresh worker's zero state).
  const stats0 = await fetchStats(base);
  const usage0 = await fetchUsage(base);
  assertMediaToolchainAccounting(stats0);
  if (stats0.jobsDispatched !== 0 || usage0.length !== 0) {
    throw new Error(
      `the worker ledger is not empty (dispatched=${stats0.jobsDispatched}, usage=${usage0.length}) — re-run against a fresh worker`,
    );
  }

  // --- stage 1: the REAL source clip (real ffmpeg generation, deterministic
  //     lavfi sources: testsrc video + 440Hz sine audio, 2s, 320x240, 24fps).
  const sourcePath = await generateTestMp4(join(scratch, "source.mp4"), {
    durationSeconds: 2,
    withAudio: true,
  });
  const sourceBytes = new Uint8Array(await readFile(sourcePath));
  const sourceHash = sha256OfBytes(sourceBytes);

  // --- stage 2: admission (rights + magic-byte + ffprobe on the received
  //     bytes — the probe dispatched over the wire).
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
  const statsAfterAdmission = await fetchStats(base);
  const usageAfterAdmission = await fetchUsage(base);
  // The admission dispatched EXACTLY one probe job (the seam's probe).
  if (statsAfterAdmission.jobsDispatched !== 1 || statsAfterAdmission.succeeded !== 1) {
    throw new Error(
      `admission accounting: dispatched=${statsAfterAdmission.jobsDispatched} succeeded=${statsAfterAdmission.succeeded} (expected 1/1)`,
    );
  }
  const probeJobId = (usageAfterAdmission[0] as { jobId: string }).jobId;
  const probeJobRecord = await (await fetch(`${base}/v1/media/jobs/${probeJobId}`)).json();

  // --- stage 3: normalization (the REAL ffmpeg transcode, dispatched over
  //     the wire; the manifest derived from the OUTPUT's measured probe).
  const normalization = await timed(() => service.runJob(job.jobId));
  const terminal = normalization.value;
  if (terminal.state !== "succeeded" || terminal.progress !== 1) {
    throw new Error(`the pipeline did not succeed: ${JSON.stringify(terminal)}`);
  }
  const manifest = service.manifestOf(asset.assetId);
  if (manifest === undefined) throw new Error("no manifest after a succeeded pipeline");
  const artifact = service.artifact(terminal.result!.artifactId);
  if (artifact === undefined) throw new Error("no artifact after a succeeded pipeline");

  // --- stage 4: the hash chain, verified END-TO-END (four links, all
  //     re-measured here from the bytes):
  //     source bytes → (worker envelope sourceContentHash) → normalized
  //     bytes → (manifest/artifact/stored contentHash).
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

  // --- stage 5: the accounting snapshot (over the wire) + identities.
  const statsFinal = await fetchStats(base);
  const usageFinal = await fetchUsage(base);
  assertMediaToolchainAccounting(statsFinal); // in-process assert on the fetched numbers
  const identity1 =
    statsFinal.jobsDispatched === statsFinal.succeeded + statsFinal.failed + statsFinal.inFlight;
  const identity2 = statsFinal.usageRecords === statsFinal.succeeded + statsFinal.failed;
  if (!identity1 || !identity2) throw new Error("an accounting identity failed");
  if (usageFinal.length !== statsFinal.usageRecords) {
    throw new Error(
      `stats and the usage drain disagree: ${usageFinal.length} vs ${statsFinal.usageRecords}`,
    );
  }
  for (const record of usageFinal) {
    if (!ComputeUsageRecord.safeParse(record).success) {
      throw new Error("a usage record failed its own Wave-1 schema");
    }
  }
  const normalizeJobId = (usageFinal.find((r) => {
    const job = (r as { jobId: string }).jobId;
    return job !== probeJobId;
  }) as { jobId: string } | undefined)?.jobId;
  if (normalizeJobId === undefined) throw new Error("no normalize usage record found");
  const normalizeJobRecord = (await (await fetch(`${base}/v1/media/jobs/${normalizeJobId}`)).json()) as {
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
      `the worker envelope's hash chain does not match the measured bytes: ${JSON.stringify(envelopeArtifact)}`,
    );
  }

  // --- stage 6: playability (the canonical faststart MP4: the moov atom
  //     BEFORE mdat in the head, + a REAL driver-side ffprobe of the stored
  //     bytes — one extra local probe, honestly noted, not worker-metered).
  const head = new TextDecoder("latin1").decode(storedBytes.slice(0, 4096));
  const moovAt = head.indexOf("moov");
  const mdatAt = head.indexOf("mdat");
  const moovBeforeMdat = moovAt !== -1 && (mdatAt === -1 || moovAt < mdatAt);
  const playbackProbePath = join(scratch, "playback-check.mp4");
  await writeFile(playbackProbePath, storedBytes);
  const playbackProbe = await tool.probe(playbackProbePath);
  const playable =
    moovBeforeMdat &&
    playbackProbe.videoStreams.some((s) => s.codec_name === "h264") &&
    playbackProbe.durationMs >= 1900 &&
    playbackProbe.durationMs <= 2100;

  // --- stage 7: the honest boundary record (the R607 hosted class,
  //     reproduced at a worker boundary over the wire: an unresolved
  //     toolchain advertises NOTHING and refuses with ffmpeg-unavailable).
  const bogusTool = new FfmpegTool({
    ffmpegPath: "/nonexistent/ffmpeg-binary",
    ffprobePath: "/nonexistent/ffprobe-binary",
  });
  const boundaryWorker = createMediaToolchainWorker({ tool: bogusTool, nowMs: Date.now });
  const boundaryServer = createMediaToolchainServer({ worker: boundaryWorker, port: 0 });
  const boundaryBase = `http://127.0.0.1:${boundaryServer.port}`;
  const boundaryDescriptor = await fetchMediaToolchainDescriptor(boundaryBase);
  const boundaryDispatch = await fetch(`${boundaryBase}/v1/media/jobs/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      job: {
        schemaVersion: "1.0",
        jobId: "r607-w914-boundary-probe",
        idempotencyKey: "r607-w914-boundary-probe-key",
        sessionId: SESSION_ID,
        operation: "probe",
        source: { contentHash: sourceHash, byteSize: sourceBytes.byteLength, container: "mp4" },
        rights: { policyRef: POLICY.policyId, canReferenceSourceFrames: true },
        constraints: { deadlineMs: 120_000, priority: 0 },
        mediaPolicy: { maxDurationMs: 120_000 },
      },
      source: {
        inputId: "source-media",
        kind: "source-media",
        contentBase64: Buffer.from(sourceBytes).toString("base64"),
      },
    }),
  });
  const boundaryEnvelope = (await boundaryDispatch.json()) as {
    result?: { status: string; failure?: { errorClass: string; failureClass: string } };
  };
  boundaryServer.stop(true);

  // --- the record (full shas only; every number measured).
  const record = {
    schemaVersion: "1.0" as const,
    kind: "r607-w914-golden-path",
    note: REPO_ROOT_NOTE,
    mode: workerUrlArg !== undefined ? "external-worker" : "embedded-worker-fixed-port",
    workerUrl: base,
    workerHealth: health,
    descriptor,
    localToolchain: {
      ffmpegPath: tool.ffmpegPath,
      ffprobePath: tool.ffprobePath,
      ffmpegVersion,
      resolved: toolResolved,
    },
    source: {
      generator: "generateTestMp4 (real ffmpeg lavfi: testsrc video + 440Hz sine audio)",
      params: { durationSeconds: 2, withAudio: true, width: 320, height: 240, frameRate: 24 },
      byteSize: sourceBytes.byteLength,
      sha256: sourceHash,
    },
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
    playability: {
      moovBeforeMdat,
      moovOffset: moovAt,
      mdatOffset: mdatAt,
      probeDurationMs: playbackProbe.durationMs,
      probeVideoCodec: playbackProbe.videoStreams[0]?.codec_name ?? null,
      probeAudioCodec: playbackProbe.audioStreams[0]?.codec_name ?? null,
      playable,
    },
    accounting: {
      stats: statsFinal,
      identity1DispatchedEqualsTerminalPlusInFlight: identity1,
      identity2UsageRecordsEqualsTerminal: identity2,
      usageDrainCount: usageFinal.length,
      usageRecords: usageFinal,
    },
    boundaryRecord: {
      note: "the R607 hosted boundary class reproduced at a worker boundary over the wire (the hosted Node serverless runtime ships no ffmpeg/ffprobe — upload REFUSED at admission, typed ffprobe-absent class; nothing faked, nothing stored)",
      descriptor: boundaryDescriptor,
      dispatchHttpStatusCode: boundaryDispatch.status,
      envelope: boundaryEnvelope,
    },
  };

  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "golden-path.json");
  writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");

  // --- the stdout summary (the honest measured numbers).
  console.log("=== R607/W914 media-toolchain golden path (measured) ===");
  console.log(`mode:            ${record.mode} (${base})`);
  console.log(`toolchain:       ffmpeg ${tool.ffmpegPath} / ffprobe ${tool.ffprobePath}`);
  console.log(`                 ${ffmpegVersion}`);
  console.log(`source:          ${sourceBytes.byteLength} bytes, sha-256 ${sourceHash}`);
  console.log(
    `admission:       client ${admission.wallMs}ms (worker execution ${record.stages.admission.workerExecutionMs}ms, job ${probeJobId}); duration measured ${asset.durationMs}ms; ${asset.videoStreamCount}v/${asset.audioStreamCount}a streams`,
  );
  console.log(
    `normalization:   client ${normalization.wallMs}ms (worker execution ${record.stages.normalization.workerExecutionMs}ms, job ${normalizeJobId}; ffprobe x${record.stages.normalization.workerFfprobeRuns}, ffmpeg x${record.stages.normalization.workerFfmpegRuns})`,
  );
  console.log(
    `artifact:        ${artifact.byteSize} bytes, sha-256 ${artifact.contentHash} (chain: source ${sourceHash.slice(0, 12)}… → normalized ${artifact.contentHash.slice(0, 12)}…, verified ${chainChecks.filter((ok) => ok).length}/${chainChecks.length} links)`,
  );
  console.log(
    `playable:        ${playable} (moov@${moovAt} before mdat@${mdatAt}; driver-side ffprobe: ${playbackProbe.videoStreams[0]?.codec_name}/${playbackProbe.audioStreams[0]?.codec_name ?? "no-audio"}, ${playbackProbe.durationMs}ms)`,
  );
  console.log(
    `accounting:      dispatched=${statsFinal.jobsDispatched} === succeeded(${statsFinal.succeeded}) + failed(${statsFinal.failed}) + inFlight(${statsFinal.inFlight}); usageRecords=${statsFinal.usageRecords} === terminal(${statsFinal.succeeded + statsFinal.failed}); usage drain agrees (${usageFinal.length}); duplicates=${statsFinal.duplicates}; capacityRefusals=${statsFinal.capacityRefusals}; probeRuns=${statsFinal.probeRuns}; transcodeRuns=${statsFinal.transcodeRuns}; in=${statsFinal.inputBytes}B out=${statsFinal.outputBytes}B; totalExecutionMs=${statsFinal.totalExecutionMs}`,
  );
  console.log(
    `boundary:        unresolved-toolchain worker → operations [] , dispatch ${boundaryDispatch.status} → ${boundaryEnvelope.result?.failure?.errorClass} (${boundaryEnvelope.result?.failure?.failureClass}) — the R607 hosted class, honest over the wire`,
  );
  console.log(`record:          ${outPath}`);
} finally {
  store.close();
  await rm(scratch, { recursive: true, force: true });
  embeddedServer?.stop(true);
}
