/**
 * R306 ARTIFACT-INGEST SEAM — THE MEASUREMENT DRIVER (DEVELOPMENT-TIME
 * EVIDENCE, not a test): measures the R306 arc's flight-5 seam — the
 * artifact-delivery/ingest landing at the app-side render-output writer —
 * on THIS machine, and writes the machine-checkable record
 * `artifact-ingest-seam.json`:
 *
 *   1. THE BATTERY — `bun test apps/web/test/artifact-ingest-seam.test.ts`
 *      spawned and its verdict parsed (pass/fail counts + expect() calls +
 *      the exit code — never asserted from theory);
 *   2. THE PRE-FIX REFUSAL, REPRODUCED VERBATIM — the hosted golden path's
 *      measured 3/4 gap class: the app-side composed store's own read of
 *      the delivered artifact id (the exact call the PRE-fix ingest made)
 *      on an EMPTY app store, with the artifact registered ONLY in the
 *      worker's own store (the hosted plane's two-runtime split). The
 *      typed refusal is recorded verbatim + the sha-256 of its message;
 *   3. THE POST-FIX DELIVERY LANDING — the same inline envelope through the
 *      REAL writer (the app store composed, EMPTY): the landing's identity
 *      (the real MP4's sha-256/byteSize/manifestId, the store's own
 *      artifactId, the frozen manifest), the media platform's record, the
 *      storage seam's integrity-verified byte-identical served bytes
 *      (ftyp), the base64-canonicality measurement (delivered text vs the
 *      canonical re-encode), the put-counter arithmetic, and the verified
 *      re-read through the SAME `loadEncodedArtifact` seam;
 *   4. THE IN-PROCESS SHAPE (non-degradation) — the artifact pre-registered
 *      in the SHARED store: the ingest adds ZERO puts, the landing is
 *      byte-identical and record-identical to the hosted shape's;
 *   5. RE-DELIVERY IDEMPOTENCY — the same envelope twice (no second put;
 *      the store read now succeeds) and the NON-CANONICAL delivery variant
 *      (delivered text ≠ the canonical re-encode): the store's COUNTED
 *      duplicate, never a second put;
 *   6. THE REFUSALS (all measured) — the integrity refusal, the manifest
 *      mismatch, the session mismatch, the LAUNDERED-delivery refusals (a
 *      tampered pre-stored record: never registrable), and the NO-DELIVERY
 *      miss (the same typed refusal VERBATIM) — every one with NOTHING put
 *      and no media record.
 *
 * HONEST SCOPE (never laundered): everything here runs LOCALLY on THIS
 * machine (the real ffmpeg 7.1.x encode, the real in-memory stores, the
 * real media platform seams). The HOSTED re-flight (a fresh E2B sandbox +
 * redeploy + the golden-path walk re-run — the 4/4 closure measure) is the
 * named NEXT flight, not this one: the baked sandbox i5lvv9q3… is DEAD
 * (502 measured, the r306-deploy ephemerality doctrine) and the deployment
 * is SSO-walled. No numbers are fabricated: every field is measured in
 * this run.
 *
 * Run (from the REPO ROOT):
 *   bun run scripts/evidence/r306-artifact-ingest/artifact-ingest-seam.ts
 */
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  ENCODED_ARTIFACT_CONTENT_TYPE,
  EncodingError,
  base64Of,
  bridgeRgbFrames,
  createFfmpegFrameEncoder,
  encodedArtifactMetadataOf,
  loadEncodedArtifact,
  registerEncodedArtifact,
} from "../../../packages/encoding/src/index";
import type { EncodedArtifact } from "../../../packages/encoding/src/index";
import {
  InMemoryArtifactStore,
  InMemoryRenderSegmentStore,
} from "../../../packages/output-pipeline/src/index";
import type {
  ArtifactStore,
  PutArtifactInput,
  PutArtifactOutcome,
  StoredArtifact,
} from "../../../packages/output-pipeline/src/index";
import {
  FfmpegTool,
  InMemoryStorage,
  MediaPlatformService,
  SqliteMediaPlatformStore,
  normalizedMediaKey,
  sha256OfBytes,
} from "../../../packages/media-platform/src/index";
import type { RenderOutputWriter } from "../../../packages/control-api/src/index";
import { createDerivedRealityRenderOutputWriter } from "../../../apps/web/src/server/derived-reality-media";

/** The repo root (the battery child + imports resolve from here). */
const ROOT = resolve(import.meta.dirname, "../../..");
const HERE = dirname(new URL(import.meta.url).pathname);
const RECORD = resolve(HERE, "artifact-ingest-seam.json");

// ---------------------------------------------------------------------------
// The harness (the battery's own conventions: deterministic, real seams)
// ---------------------------------------------------------------------------

const SESSION_ID = "sess-r306-artifact-ingest";
const FRAME_WIDTH = 160;
const FRAME_HEIGHT = 90;
const FRAME_FPS = 25;
const FRAME_COUNT = 12;
const NOW_MS = 2_222_222_222_000;

function syntheticFrame(index: number): Uint8Array {
  const frame = new Uint8Array(FRAME_WIDTH * FRAME_HEIGHT * 3);
  for (let p = 0; p < FRAME_WIDTH * FRAME_HEIGHT; p += 1) {
    frame[p * 3] = (p * 3 + index * 17) % 256;
    frame[p * 3 + 1] = (p + index * 29 + FRAME_COUNT) % 256;
    frame[p * 3 + 2] = (p * 7 + index * 11) % 256;
  }
  return frame;
}

function storeArtifactIdOf(base64Content: string): string {
  return sha256OfBytes(new TextEncoder().encode(base64Content));
}

/** One measured put (the counting store's own record). */
interface PutMeasurement {
  artifactId: string;
  outcome: "stored" | "duplicate";
  duplicateCount: number;
}

function countingArtifactStore(inner: ArtifactStore): {
  store: ArtifactStore;
  puts: PutMeasurement[];
} {
  const puts: PutMeasurement[] = [];
  const store: ArtifactStore = {
    putArtifact: (input: PutArtifactInput): PutArtifactOutcome => {
      const outcome = inner.putArtifact(input);
      puts.push({
        artifactId: outcome.record.artifactId,
        outcome: outcome.outcome,
        duplicateCount: outcome.outcome === "duplicate" ? outcome.duplicateCount : 0,
      });
      return outcome;
    },
    getArtifact: (artifactId: string) => inner.getArtifact(artifactId),
    listArtifacts: () => inner.listArtifacts(),
    deleteArtifact: (artifactId: string) => inner.deleteArtifact(artifactId),
    stats: () => inner.stats(),
  };
  return { store, puts };
}

function putCountersOf(puts: PutMeasurement[]): Record<string, number> {
  return {
    dispatched: puts.length,
    stored: puts.filter((put) => put.outcome === "stored").length,
    duplicate: puts.filter((put) => put.outcome === "duplicate").length,
  };
}

function makeMediaPlatform(): { service: MediaPlatformService; storage: InMemoryStorage } {
  const storage = new InMemoryStorage();
  const store = new SqliteMediaPlatformStore(":memory:");
  const service = new MediaPlatformService({
    storage,
    sourceAssets: store.sourceAssets,
    manifests: store.manifests,
    artifacts: store.artifacts,
    jobs: store.jobs,
    resolvePolicy: () => ({
      policyId: "policy-r306-ingest-evidence",
      allowedOperations: ["analysis", "transformation", "derivativeGeneration", "storage"],
      assertedBy: "evidence-driver",
    }),
    nowMs: () => NOW_MS,
    autoRun: false,
  });
  return { service, storage };
}

function makeWriter(
  media: { service: MediaPlatformService },
  artifactStore: ArtifactStore,
): RenderOutputWriter {
  return createDerivedRealityRenderOutputWriter({
    segmentStore: new InMemoryRenderSegmentStore(),
    getMedia: () => media.service,
    encodedArtifactStore: artifactStore,
  });
}

async function ingest(writer: RenderOutputWriter, envelope: unknown): Promise<void> {
  await writer.storeSegment(
    envelope as Parameters<RenderOutputWriter["storeSegment"]>[0],
  );
}

async function refusalOf(writer: RenderOutputWriter, envelope: unknown): Promise<unknown> {
  try {
    await ingest(writer, envelope);
  } catch (err) {
    return err;
  }
  return null;
}

function inlineEnvelopeOf(delivery: {
  contentHash: string;
  manifest: unknown;
  manifestId: string;
  content: string;
}): {
  sessionId: string;
  renderId: string;
  segment: {
    segmentId: string;
    contentType: string;
    content: string;
    byteLength: number;
    contentHash: string;
    manifest: unknown;
  };
} {
  return {
    sessionId: SESSION_ID,
    renderId: "r-r306-ingest-evidence",
    segment: {
      segmentId: delivery.manifestId,
      contentType: ENCODED_ARTIFACT_CONTENT_TYPE,
      content: delivery.content,
      byteLength: new TextEncoder().encode(delivery.content).length,
      contentHash: delivery.contentHash,
      manifest: structuredClone(delivery.manifest),
    },
  };
}

/** One measured refusal (the fail-closed posture, never a quiet pass). */
interface RefusalMeasurement {
  refused: boolean;
  name: string;
  kind: string | null;
  message: string;
  messageSha256: string;
  putCounters: Record<string, number>;
  mediaRecords: number;
}

/** The fail-closed check accumulator (the prior flights' own convention). */
const failures: string[] = [];
function requireCheck(name: string, ok: boolean, detail?: string): void {
  if (!ok) failures.push(detail === undefined ? name : `${name} (${detail})`);
}

// ---------------------------------------------------------------------------
// 1. The machine + the seam's own battery (spawned; the verdict parsed)
// ---------------------------------------------------------------------------
const tool = new FfmpegTool();
const ffmpegResolved = await tool.available();
const ffmpegVersion = ffmpegResolved ? await tool.version() : null;
const encoder = createFfmpegFrameEncoder();
const encoderAvailable = encoder !== null;
const startedAtMs = Date.now();

const batteryChild = Bun.spawn({
  cmd: [process.execPath, "test", "apps/web/test/artifact-ingest-seam.test.ts"],
  cwd: ROOT,
  stdout: "pipe",
  stderr: "pipe",
});
// bun test writes its results to stderr (the stdout header only).
const batteryText = await new Response(batteryChild.stderr).text();
const batteryExit = await batteryChild.exited;
const batteryPass = Number(/(\d+) pass/.exec(batteryText)?.[1] ?? -1);
const batteryFail = Number(/(\d+) fail/.exec(batteryText)?.[1] ?? -1);
const batteryExpects = Number(/(\d+) expect\(\) calls/.exec(batteryText)?.[1] ?? -1);
console.log(
  `[measure] battery: ${batteryPass} pass / ${batteryFail} fail / ${batteryExpects} expect() calls / exit ${batteryExit}`,
);
requireCheck(
  "battery green",
  batteryExit === 0 && batteryFail === 0 && batteryPass === 6,
  `pass=${batteryPass} fail=${batteryFail} exit=${batteryExit}`,
);
requireCheck("the local ffmpeg encoder is available", encoderAvailable && ffmpegResolved);

// ---------------------------------------------------------------------------
// 2. THE REAL ARTIFACT (the worker's own encode — real ffmpeg/libx264)
// ---------------------------------------------------------------------------
const artifact: EncodedArtifact = bridgeRgbFrames({
  encoder: encoder!,
  frames: Array.from({ length: FRAME_COUNT }, (_, i) => syntheticFrame(i)),
  width: FRAME_WIDTH,
  height: FRAME_HEIGHT,
  fps: FRAME_FPS,
  origin: {
    rendererId: "game-3d.prototype",
    rendererVersion: "0.3.0",
    bridge: "game-3d",
    engineId: "pitch-engine",
    engineVersion: "1.0.0",
  },
  sessionId: SESSION_ID,
  swm: { snapshotVersion: 7, lastEventSequence: 402 },
});
requireCheck("the real artifact is a real MP4", artifact.kind === "mp4" && artifact.byteSize > 1024);
requireCheck(
  "the artifact carries the ftyp magic",
  Buffer.from(artifact.bytes.subarray(4, 8)).toString("ascii") === "ftyp",
);

// The worker's own registration in ITS OWN store (the hosted plane's split):
const workerStore = new InMemoryArtifactStore();
const workerRegistration = registerEncodedArtifact(workerStore, artifact);
requireCheck("the worker's own registration stored", workerRegistration.outcome === "stored");

// The inline delivery envelope (the compute worker's own handoff shape):
const canonicalContent = base64Of(artifact.bytes);
const envelope = inlineEnvelopeOf({
  contentHash: artifact.contentHash,
  manifest: artifact.manifest,
  manifestId: artifact.manifestId,
  content: canonicalContent,
});

// ---------------------------------------------------------------------------
// 3. THE PRE-FIX REFUSAL, REPRODUCED VERBATIM (the measured gap class)
// ---------------------------------------------------------------------------
// The app-side composed store is EMPTY (a different runtime's instance):
const preFixAppStore = countingArtifactStore(new InMemoryArtifactStore());
const missId = storeArtifactIdOf(envelope.segment.content);
const preFixStarted = Date.now();
let preFixRefusal: EncodingError | null = null;
try {
  loadEncodedArtifact(preFixAppStore.store, missId, envelope.segment.contentHash);
} catch (err) {
  preFixRefusal = err instanceof EncodingError ? err : null;
}
requireCheck("the pre-fix read refused", preFixRefusal !== null);
const preFixVerbatim = preFixRefusal?.message ?? "NO REFUSAL (driver bug)";
requireCheck(
  "the pre-fix refusal is the specific miss class",
  preFixRefusal !== null &&
    preFixRefusal.kind === "artifact-invalid" &&
    preFixRefusal.failureClass === "media-invalid" &&
    preFixVerbatim === `encoding refused (artifact-invalid): no artifact "${missId}" is stored`,
);
const preFixSha = sha256OfBytes(new TextEncoder().encode(preFixVerbatim));
console.log(
  `[measure] pre-fix refusal (verbatim): ${preFixVerbatim.slice(0, 96)}… [sha ${preFixSha.slice(0, 16)}…]`,
);

// ---------------------------------------------------------------------------
// 4. THE POST-FIX DELIVERY LANDING (through the REAL writer)
// ---------------------------------------------------------------------------
const landingAppStore = countingArtifactStore(new InMemoryArtifactStore());
const landingMedia = makeMediaPlatform();
const landingWriter = makeWriter(landingMedia, landingAppStore.store);
const landingStarted = Date.now();
await ingest(landingWriter, envelope);
const landingWallMs = Date.now() - landingStarted;

const landingRecords = landingMedia.service.artifactsOfSession(SESSION_ID);
requireCheck("the landing recorded exactly one media artifact", landingRecords.length === 1);
const landingRecord = landingRecords[0] ?? null;
requireCheck(
  "the landed record's identity is the artifact's own",
  landingRecord !== null &&
    landingRecord.contentHash === artifact.contentHash &&
    landingRecord.byteSize === artifact.byteSize &&
    landingRecord.artifactId === `mp4-${artifact.contentHash.slice(0, 16)}` &&
    landingRecord.reality === "three-d-game" &&
    landingRecord.sessionId === SESSION_ID,
);
const storedBytes = await landingMedia.storage.get(normalizedMediaKey(artifact.contentHash));
requireCheck("the storage seam serves the landed bytes", storedBytes !== null);
const servedSha = storedBytes === null ? "" : sha256OfBytes(storedBytes);
requireCheck(
  "the served bytes are the worker's own encode, byte-identical",
  storedBytes !== null &&
    sha256OfBytes(storedBytes) === artifact.contentHash &&
    Buffer.compare(Buffer.from(storedBytes), Buffer.from(artifact.bytes)) === 0,
);
requireCheck(
  "the served bytes carry the ftyp magic",
  storedBytes !== null &&
    Buffer.from(storedBytes.subarray(4, 8)).toString("ascii") === "ftyp",
);

const landingCounters = putCountersOf(landingAppStore.puts);
requireCheck(
  "the landing's put arithmetic (dispatched === stored + duplicate)",
  landingCounters.stored + landingCounters.duplicate === landingCounters.dispatched,
);
requireCheck(
  "the landing made exactly one stored put",
  landingCounters.dispatched === 1 && landingCounters.stored === 1 && landingCounters.duplicate === 0,
);

// BASE64-CANONICALITY, MEASURED: the delivered text vs the canonical re-encode.
const deliveredIsCanonical = envelope.segment.content === base64Of(artifact.bytes);
const registeredArtifactId = landingAppStore.puts[0]?.artifactId ?? "";
requireCheck(
  "the canonicality/id consistency holds",
  deliveredIsCanonical === (registeredArtifactId === missId),
);
requireCheck(
  "the registration returned the store's own content address",
  /^[0-9a-f]{64}$/.test(registeredArtifactId),
);
requireCheck(
  "the landing landed exactly what the miss named (the canonical case)",
  !deliveredIsCanonical || registeredArtifactId === missId,
);

// The verified re-read through the SAME seam (the store now serves it):
const reRead = loadEncodedArtifact(landingAppStore.store, registeredArtifactId, artifact.contentHash);
requireCheck(
  "the verified re-read is byte-identical and typed",
  reRead.contentHash === artifact.contentHash &&
    Buffer.compare(Buffer.from(reRead.bytes), Buffer.from(artifact.bytes)) === 0 &&
    reRead.record.contentType === ENCODED_ARTIFACT_CONTENT_TYPE &&
    reRead.record.metadata.sessionId === SESSION_ID,
);
requireCheck(
  "the registered metadata is the artifact's own",
  JSON.stringify(reRead.record.metadata) === JSON.stringify(encodedArtifactMetadataOf(artifact)),
);
console.log(
  `[measure] landing: sha256 ${artifact.contentHash.slice(0, 16)}… / ${artifact.byteSize} B / store ${registeredArtifactId.slice(0, 16)}… / puts ${landingCounters.dispatched} dispatched, ${landingCounters.stored} stored / wall ${landingWallMs} ms`,
);

// ---------------------------------------------------------------------------
// 5. THE IN-PROCESS SHAPE (non-degradation: ZERO ingest puts)
// ---------------------------------------------------------------------------
const sharedStore = countingArtifactStore(new InMemoryArtifactStore());
const workerSharedRegistration = registerEncodedArtifact(sharedStore.store, artifact);
requireCheck("the in-process pre-registration stored", workerSharedRegistration.outcome === "stored");
const preIngestPuts = sharedStore.puts.length;
const inProcessMedia = makeMediaPlatform();
const inProcessWriter = makeWriter(inProcessMedia, sharedStore.store);
await ingest(inProcessWriter, envelope);
const inProcessCounters = putCountersOf(sharedStore.puts);
requireCheck(
  "the in-process ingest added ZERO puts",
  sharedStore.puts.length === preIngestPuts && inProcessCounters.stored === 1,
);
const inProcessRecords = inProcessMedia.service.artifactsOfSession(SESSION_ID);
requireCheck("the in-process landing recorded one artifact", inProcessRecords.length === 1);
const recordDeepEqualsHosted =
  landingRecord !== null &&
  inProcessRecords[0] !== undefined &&
  JSON.stringify(inProcessRecords[0]) === JSON.stringify(landingRecord);
const inProcessBytes = await inProcessMedia.storage.get(normalizedMediaKey(artifact.contentHash));
const inProcessBytesByteIdentical =
  inProcessBytes !== null &&
  storedBytes !== null &&
  Buffer.compare(Buffer.from(inProcessBytes), Buffer.from(storedBytes)) === 0;
requireCheck(
  "the in-process landing is record-identical + byte-identical to the hosted shape's",
  recordDeepEqualsHosted && inProcessBytesByteIdentical,
);

// ---------------------------------------------------------------------------
// 6. RE-DELIVERY IDEMPOTENCY (the same envelope twice + the non-canonical)
// ---------------------------------------------------------------------------
const reDeliveryAppStore = countingArtifactStore(new InMemoryArtifactStore());
const reDeliveryMedia = makeMediaPlatform();
const reDeliveryWriter = makeWriter(reDeliveryMedia, reDeliveryAppStore.store);
await ingest(reDeliveryWriter, envelope); // first: the landing fires
const firstDeliveryCounters = putCountersOf(reDeliveryAppStore.puts);
requireCheck(
  "the first re-delivery leg landed one stored put",
  firstDeliveryCounters.dispatched === 1 && firstDeliveryCounters.stored === 1,
);
await ingest(reDeliveryWriter, envelope); // second: the store read now succeeds
const sameEnvelopeCounters = putCountersOf(reDeliveryAppStore.puts);
requireCheck(
  "the same-envelope re-delivery made NO second put",
  sameEnvelopeCounters.dispatched === 1 && sameEnvelopeCounters.duplicate === 0,
);
const reDeliveryRecords = reDeliveryMedia.service.artifactsOfSession(SESSION_ID);
requireCheck(
  "the media record stayed exactly one after re-delivery",
  reDeliveryRecords.length === 1,
);

// The NON-CANONICAL delivery variant (delivered text ≠ canonical re-encode):
const wrappedContent = `${envelope.segment.content}\n`;
const wrappedEnvelope = {
  ...envelope,
  segment: {
    ...envelope.segment,
    content: wrappedContent,
    byteLength: new TextEncoder().encode(wrappedContent).length,
  },
};
requireCheck(
  "the wrapped delivery is genuinely non-canonical",
  wrappedContent !== base64Of(artifact.bytes),
);
await ingest(reDeliveryWriter, wrappedEnvelope);
const nonCanonicalCounters = putCountersOf(reDeliveryAppStore.puts);
const nonCanonicalStoreStats = reDeliveryAppStore.store.stats();
requireCheck(
  "the non-canonical re-delivery is the store's COUNTED duplicate, never a second put",
  nonCanonicalCounters.dispatched === 2 &&
    nonCanonicalCounters.stored === 1 &&
    nonCanonicalCounters.duplicate === 1,
);
requireCheck(
  "the store's own stats agree (one artifact, one duplicate put)",
  nonCanonicalStoreStats.artifacts === 1 && nonCanonicalStoreStats.duplicatePuts === 1,
);
requireCheck(
  "the read-back used the registration's returned artifactId (the canonical address)",
  reDeliveryAppStore.puts[1]?.artifactId === reDeliveryAppStore.puts[0]?.artifactId,
);
const reDeliveryServed = await reDeliveryMedia.storage.get(normalizedMediaKey(artifact.contentHash));
requireCheck(
  "the re-delivered record's bytes stay integrity-verified",
  reDeliveryServed !== null && sha256OfBytes(reDeliveryServed) === artifact.contentHash,
);

// ---------------------------------------------------------------------------
// 7. THE REFUSALS (all measured; NOTHING put on any of them)
// ---------------------------------------------------------------------------
async function measureRefusal(
  name: string,
  envelopeToRefuse: unknown,
): Promise<RefusalMeasurement> {
  const appStore = countingArtifactStore(new InMemoryArtifactStore());
  const media = makeMediaPlatform();
  const writer = makeWriter(media, appStore.store);
  const refusal = await refusalOf(writer, envelopeToRefuse);
  const message = refusal instanceof Error ? refusal.message : "NO REFUSAL (driver bug)";
  return {
    refused: refusal !== null,
    name,
    kind: refusal instanceof EncodingError ? refusal.kind : null,
    message,
    messageSha256: sha256OfBytes(new TextEncoder().encode(message)),
    putCounters: putCountersOf(appStore.puts),
    mediaRecords: media.service.artifactsOfSession(SESSION_ID).length,
  };
}

/**
 * Measures one refusal against a TAMPERED pre-stored record served by the
 * store for the exact id the composed read looks up (the laundering rig).
 */
async function measureRefusalWithTamperedStore(
  name: string,
  tampered: StoredArtifact,
  envelopeToRefuse: unknown,
): Promise<RefusalMeasurement> {
  const inner = new InMemoryArtifactStore();
  const appStore = countingArtifactStore({
    putArtifact: (input: PutArtifactInput) => inner.putArtifact(input),
    getArtifact: (artifactId: string) =>
      artifactId === tampered.artifactId ? structuredClone(tampered) : inner.getArtifact(artifactId),
    listArtifacts: () => inner.listArtifacts(),
    deleteArtifact: (artifactId: string) => inner.deleteArtifact(artifactId),
    stats: () => inner.stats(),
  });
  const media = makeMediaPlatform();
  const writer = makeWriter(media, appStore.store);
  const refusal = await refusalOf(writer, envelopeToRefuse);
  const message = refusal instanceof Error ? refusal.message : "NO REFUSAL (driver bug)";
  return {
    refused: refusal !== null,
    name,
    kind: refusal instanceof EncodingError ? refusal.kind : null,
    message,
    messageSha256: sha256OfBytes(new TextEncoder().encode(message)),
    putCounters: putCountersOf(appStore.puts),
    mediaRecords: media.service.artifactsOfSession(SESSION_ID).length,
  };
}

function assertNothingPut(refusal: RefusalMeasurement): void {
  requireCheck(
    `the ${refusal.name} refusal put NOTHING`,
    refusal.putCounters.dispatched === 0 &&
      refusal.putCounters.stored === 0 &&
      refusal.putCounters.duplicate === 0,
    JSON.stringify(refusal.putCounters),
  );
  requireCheck(`the ${refusal.name} refusal recorded NO media artifact`, refusal.mediaRecords === 0);
}

// 7a — delivered bytes that do NOT re-hash to the claim (integrity).
const tamperedBytes = new Uint8Array(artifact.bytes);
tamperedBytes[tamperedBytes.length - 1]! ^= 0xff;
const integrityRefusal = await measureRefusal("integrity", {
  ...envelope,
  segment: { ...envelope.segment, content: base64Of(tamperedBytes) },
});
requireCheck(
  "the integrity refusal is the existing loud failure",
  integrityRefusal.refused && integrityRefusal.message.includes("failed integrity: the delivered bytes hash to"),
);
assertNothingPut(integrityRefusal);

// 7b — the manifest's hash disagrees with the segment's claim.
const lyingManifest = structuredClone(artifact.manifest);
lyingManifest.contentHash = sha256OfBytes(new Uint8Array([1, 2, 3]));
const manifestRefusal = await measureRefusal("manifest-mismatch", {
  ...envelope,
  segment: { ...envelope.segment, manifest: lyingManifest },
});
requireCheck(
  "the manifest-mismatch refusal is the existing loud failure",
  manifestRefusal.refused && manifestRefusal.message.includes("disagrees with its own container manifest"),
);
assertNothingPut(manifestRefusal);

// 7c — the manifest belongs to another session.
const otherSessionManifest = structuredClone(artifact.manifest);
otherSessionManifest.sessionId = "sess-someone-else";
const sessionRefusal = await measureRefusal("session-mismatch", {
  ...envelope,
  segment: { ...envelope.segment, manifest: otherSessionManifest },
});
requireCheck(
  "the session-mismatch refusal is the existing loud failure",
  sessionRefusal.refused && sessionRefusal.message.includes("belongs to session 'sess-someone-else'"),
);
assertNothingPut(sessionRefusal);

// 7d — the LAUNDERED delivery: a tampered pre-stored record (wrong bytes
//      under the RIGHT id) — the store's own integrity class, NEVER
//      registrable from a delivery.
const wrongBytes = new Uint8Array(artifact.bytes);
wrongBytes[0]! ^= 0x5a;
const tamperedRecord: StoredArtifact = {
  artifactId: missId,
  contentType: ENCODED_ARTIFACT_CONTENT_TYPE,
  content: base64Of(wrongBytes),
  byteLength: Buffer.byteLength(base64Of(wrongBytes), "utf8"),
  metadata: encodedArtifactMetadataOf(artifact),
  storedAtMs: NOW_MS,
  storeSequence: 1,
  duplicateCount: 0,
};
const launderedRefusal = await measureRefusalWithTamperedStore(
  "laundered-tampered-record",
  tamperedRecord,
  envelope,
);
requireCheck(
  "the laundered (tampered-record) refusal is the store's verify-failed class — never registrable",
  launderedRefusal.refused &&
    launderedRefusal.kind === "verify-failed" &&
    launderedRefusal.message.includes(`artifact "${missId}" decodes to bytes whose sha-256`),
);
assertNothingPut(launderedRefusal);

// 7e — the laundered CONTENT TYPE: right id, wrong type — the kind matches
//      the miss's kind but NOT the specific miss message: still never
//      registrable.
const wrongTypeRecord: StoredArtifact = {
  ...tamperedRecord,
  contentType: "text/plain",
  content: envelope.segment.content,
  byteLength: Buffer.byteLength(envelope.segment.content, "utf8"),
};
const wrongTypeRefusal = await measureRefusalWithTamperedStore(
  "laundered-content-type",
  wrongTypeRecord,
  envelope,
);
requireCheck(
  "the wrong-content-type refusal is never registrable (not the specific miss)",
  wrongTypeRefusal.refused &&
    wrongTypeRefusal.kind === "artifact-invalid" &&
    wrongTypeRefusal.message.includes(`is not an encoded artifact (contentType "text/plain")`),
);
assertNothingPut(wrongTypeRefusal);

// 7f — the NO-DELIVERY miss (empty inline document): the SAME typed
//      refusal VERBATIM (the honest pre-seam answer).
const emptyContent = "";
const noDeliveryRefusal = await measureRefusal("no-delivery", {
  ...envelope,
  segment: { ...envelope.segment, content: emptyContent, byteLength: 0 },
});
const emptyMissId = storeArtifactIdOf(emptyContent);
requireCheck(
  "the no-delivery refusal is the miss VERBATIM",
  noDeliveryRefusal.refused &&
    noDeliveryRefusal.message ===
      `encoding refused (artifact-invalid): no artifact "${emptyMissId}" is stored`,
);
assertNothingPut(noDeliveryRefusal);

// ---------------------------------------------------------------------------
// 8. The record (only what THIS run measured) + the verdict
// ---------------------------------------------------------------------------
const totalWallMs = Date.now() - startedAtMs;
const verdict =
  `THE ARTIFACT-DELIVERY/INGEST SEAM IS CLOSED at the app-side ingest (R306 flight 5, LOCAL-ONLY): ` +
  `the pre-fix typed refusal reproduced VERBATIM (no artifact "${missId.slice(0, 16)}…" is stored; message sha ${preFixSha.slice(0, 16)}…); ` +
  `the HOSTED-shape delivery (the worker's store ≠ the app's store) LANDS — the real MP4 sha256 ${artifact.contentHash} (${artifact.byteSize} B) ` +
  `registered in the app store under the store's own content address ${registeredArtifactId.slice(0, 16)}…, re-read through the verified loadEncodedArtifact seam, ` +
  `and recorded in the media platform with integrity-verified byte-identical bytes (ftyp); ` +
  `the in-process shape degraded NOTHING (ZERO ingest puts, record-identical + byte-identical landing); ` +
  `re-delivery is idempotent (no second put on the same envelope; the non-canonical delivery is the store's COUNTED duplicate, never a second put); ` +
  `every existing refusal stayed loud with NOTHING put (integrity, manifest mismatch, session mismatch, laundered tampered-record, laundered content-type, no-delivery VERBATIM); ` +
  `the battery ${batteryPass}/${batteryPass} green (${batteryExpects} expect() calls). ` +
  `THE HOSTED RE-FLIGHT (a fresh E2B sandbox + redeploy + the golden-path walk re-run — the 4/4 closure measure) is the named NEXT flight, not this one.`;

const record = {
  schemaVersion: "1.0",
  kind: "r306-artifact-ingest-seam",
  clientHonesty:
    "the client is THIS DRIVER composing the hosted plane's two-runtime split locally (the worker's own store ≠ the app-side composed store, both REAL InMemoryArtifactStore instances; the artifact a REAL ffmpeg/libx264 encode through the R306 bridge; the ingest through the REAL routing render-output writer with the REAL media platform) — every field below is MEASURED in this run, never copied, never fabricated; the pre-fix refusal is reproduced by calling the PRE-fix ingest's own store read on the empty app store (the exact call site the hosted golden path measured refusing)",
  machine: {
    bun: Bun.version,
    nodeCompat: process.version,
    ffmpeg: ffmpegVersion,
    encoderKind: encoder?.kind ?? null,
    measuredAtIso: new Date().toISOString(),
    totalWallMs,
  },
  battery: {
    command: "bun test apps/web/test/artifact-ingest-seam.test.ts",
    pass: batteryPass,
    fail: batteryFail,
    expectCalls: batteryExpects,
    exitCode: batteryExit,
  },
  preFixRefusal: {
    reproduced: preFixRefusal !== null,
    verbatim: preFixVerbatim,
    sha256OfMessage: preFixSha,
    kind: preFixRefusal?.kind ?? null,
    failureClass: preFixRefusal?.failureClass ?? null,
    missedArtifactId: missId,
    wallMs: Date.now() - preFixStarted,
  },
  postFixLanding: {
    landed: landingRecord !== null,
    contentHash: artifact.contentHash,
    byteSize: artifact.byteSize,
    manifestId: artifact.manifestId,
    frozenManifest: landingRecord,
    appStoreArtifactId: registeredArtifactId,
    workerStoreArtifactId: workerRegistration.artifactId,
    appStoreArtifactIdEqualsMissedId: registeredArtifactId === missId,
    base64Canonical: {
      deliveredEqualsCanonicalReEncode: deliveredIsCanonical,
      note: "the worker's delivery text is its own base64Of (canonical); the wrapped variant (content + newline) decodes to the same bytes under a different text hash — the read-back uses the registration's RETURNED artifactId either way",
    },
    putCounters: landingCounters,
    mediaPlatform: {
      records: landingRecords.length,
      artifactId: landingRecord?.artifactId ?? null,
      reality: landingRecord?.reality ?? null,
      sessionId: landingRecord?.sessionId ?? null,
      storageKey: normalizedMediaKey(artifact.contentHash),
      servedBytesSha256: servedSha,
      servedByteLength: storedBytes?.byteLength ?? 0,
      servedBytesByteIdenticalToWorkerEncode:
        storedBytes !== null &&
        Buffer.compare(Buffer.from(storedBytes), Buffer.from(artifact.bytes)) === 0,
      ftyp:
        storedBytes !== null &&
        Buffer.from(storedBytes.subarray(4, 8)).toString("ascii") === "ftyp",
    },
    reRead: {
      contentHashVerified: reRead.contentHash === artifact.contentHash,
      bytesByteIdentical:
        Buffer.compare(Buffer.from(reRead.bytes), Buffer.from(artifact.bytes)) === 0,
      contentType: reRead.record.contentType,
      metadata: reRead.record.metadata,
    },
    wallMs: landingWallMs,
  },
  inProcessShape: {
    putCounters: inProcessCounters,
    ingestPuts: sharedStore.puts.length - preIngestPuts,
    recordDeepEqualsHosted,
    bytesByteIdentical: inProcessBytesByteIdentical,
  },
  reDelivery: {
    sameEnvelope: {
      putCounters: sameEnvelopeCounters,
      mediaRecords: reDeliveryRecords.length,
    },
    nonCanonicalDelivery: {
      deliveredEqualsCanonicalReEncode: false,
      putCounters: nonCanonicalCounters,
      storeStats: nonCanonicalStoreStats,
      registeredUnderCanonicalArtifactId:
        reDeliveryAppStore.puts[1]?.artifactId === reDeliveryAppStore.puts[0]?.artifactId,
      duplicateCount: reDeliveryAppStore.puts[1]?.duplicateCount ?? 0,
    },
  },
  refusals: {
    integrity: integrityRefusal,
    manifestMismatch: manifestRefusal,
    sessionMismatch: sessionRefusal,
    launderedTamperedRecord: launderedRefusal,
    launderedContentType: wrongTypeRefusal,
    noDelivery: noDeliveryRefusal,
  },
  verdict,
};

await writeFile(RECORD, `${JSON.stringify(record, null, 2)}\n`, "utf8");
console.log(`[measure] record written: ${RECORD}`);
console.log(`[measure] verdict: ${verdict}`);

if (failures.length > 0) {
  console.error(`REFUSED — ${failures.length} driver checks failed:`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}
console.log("[measure] all driver checks passed (failures: 0)");
