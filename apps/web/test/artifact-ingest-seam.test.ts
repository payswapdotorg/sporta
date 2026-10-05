/**
 * THE R306 ARTIFACT-DELIVERY/INGEST SEAM BATTERY (the arc's flight 5) — the
 * hosted plane's measured gap class, closed at the app-side ingest and
 * pinned here:
 *
 *   the compute worker encodes + registers the artifact in ITS OWN store,
 *   then hands the job envelope back with the artifact INLINE (delivery
 *   mode "inline", the base64 document). On the HOSTED plane the app's
 *   composed store is a DIFFERENT instance — its read missed with the TYPED
 *   `no artifact "<sha>" is stored` refusal (the hosted golden path's
 *   3/4 gap), while the bytes were ALREADY delivered. The seam LANDS that
 *   delivery: decode → integrity-verify → validate the container manifest
 *   (every existing fail-closed check BEFORE any put) → reconstruct the
 *   `EncodedArtifact` → `registerEncodedArtifact` (the store's own
 *   cross-verify) → re-read through the SAME verified seam.
 *
 * The measured cases (the honest split, every number measured):
 *   1. THE HOSTED-SHAPE DELIVERY LANDS — two stores, the artifact in the
 *      worker's only, the ingest through the REAL writer lands it in the
 *      app's store + the media platform (integrity-verified, `ftyp`).
 *   2. The IN-PROCESS shape — the artifact pre-registered in the SHARED
 *      store: the ingest path unchanged, ZERO puts, byte-identical landing
 *      (non-degradation, pinned against case 1's own record).
 *   3. Re-delivery idempotency — the same envelope twice (the store read
 *      now succeeds: no second put) AND the non-canonical delivery variant
 *      (the delivered text ≠ the canonical re-encode): the store's COUNTED
 *      duplicate, never a second put.
 *   4. The integrity refusals preserved — delivered bytes that do NOT
 *      re-hash to the claim, a manifest/hash disagreement, a session
 *      mismatch, an invalid manifest: all loud, NOTHING put.
 *   5. The LAUNDERED-DELIVERY refusal — a tampered pre-stored record (the
 *      integrity-shaped store refusal): NEVER registrable from a delivery,
 *      the typed refusal propagates verbatim.
 *   6. The NO-DELIVERY refusal — a store miss with absent/undecodable
 *      inline content: the SAME typed refusal, VERBATIM.
 *
 * REAL vs FIXTURE BOUNDARY: the encoded artifact is a REAL ffmpeg/libx264
 * MP4 (the R306 real-artifact builder pattern — synthetic rgb24 frames
 * through the REAL `FfmpegFrameEncoder`, never a committed media fixture);
 * the stores, the storage seam, and the media platform are the REAL
 * in-memory implementations the composition itself uses. The typed skip
 * guard (the repo convention) covers machines without ffmpeg/libx264.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import {
  ENCODED_ARTIFACT_CONTENT_TYPE,
  EncodingError,
  base64Of,
  bridgeRgbFrames,
  createFfmpegFrameEncoder,
  encodedArtifactMetadataOf,
  loadEncodedArtifact,
  registerEncodedArtifact,
} from "@sporta/encoding";
import type { EncodedArtifact } from "@sporta/encoding";
import { InMemoryArtifactStore, InMemoryRenderSegmentStore } from "@sporta/output-pipeline";
import type {
  ArtifactStore,
  PutArtifactInput,
  PutArtifactOutcome,
  StoredArtifact,
} from "@sporta/output-pipeline";
import {
  InMemoryStorage,
  MediaPlatformService,
  SqliteMediaPlatformStore,
  normalizedMediaKey,
  sha256OfBytes,
} from "@sporta/media-platform";
import type { MediaPlatformService as MediaService } from "@sporta/media-platform";
import type { AuthorizationPolicy, RenderArtifactManifest } from "@sporta/contracts";
import type { RenderOutputWriter } from "@sporta/control-api";
import { createDerivedRealityRenderOutputWriter } from "../src/server/derived-reality-media";

// ---------------------------------------------------------------------------
// The harness (the repo's hermetic conventions: deterministic, no ambient
// clock, REAL in-memory implementations)
// ---------------------------------------------------------------------------

/** The canonical test session (the ingest's session identity). */
const SESSION_ID = "sess-r306-artifact-ingest";

/** The deterministic frame geometry (small, fast, even). */
const FRAME_WIDTH = 160;
const FRAME_HEIGHT = 90;
const FRAME_FPS = 25;
const FRAME_COUNT = 12;

/** One deterministic synthetic frame (pure integer math — bit-exact). */
function syntheticFrame(index: number): Uint8Array {
  const frame = new Uint8Array(FRAME_WIDTH * FRAME_HEIGHT * 3);
  for (let p = 0; p < FRAME_WIDTH * FRAME_HEIGHT; p += 1) {
    frame[p * 3] = (p * 3 + index * 17) % 256;
    frame[p * 3 + 1] = (p + index * 29 + FRAME_COUNT) % 256;
    frame[p * 3 + 2] = (p * 7 + index * 11) % 256;
  }
  return frame;
}

/** A deterministic frame sequence (the REAL encoder's input). */
function syntheticFrames(count: number): Uint8Array[] {
  return Array.from({ length: count }, (_, i) => syntheticFrame(i));
}

/** A full-rights policy fixture (the media platform's resolution seam). */
const FULL_POLICY: AuthorizationPolicy = {
  policyId: "policy-r306-ingest-test",
  allowedOperations: ["analysis", "transformation", "derivativeGeneration", "storage"],
  assertedBy: "test",
};

/** A deterministic clock (the repo's hermetic rig). */
const NOW_MS = 2_222_222_222_000;

/** The REAL ffmpeg encoder (the typed skip guard covers machines without it). */
const encoder = createFfmpegFrameEncoder();
const encoderAvailable = encoder !== null;

/** The store-side artifact id of a base64 document (the seam's own key). */
function storeArtifactIdOf(base64Content: string): string {
  return sha256OfBytes(new TextEncoder().encode(base64Content));
}

/** One inline delivery envelope as the control plane's ingest hands it over. */
function inlineEnvelopeOf(artifact: EncodedArtifact): {
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
  const content = base64Of(artifact.bytes);
  return {
    sessionId: SESSION_ID,
    renderId: "r-r306-ingest-1",
    segment: {
      segmentId: artifact.manifestId,
      contentType: ENCODED_ARTIFACT_CONTENT_TYPE,
      content,
      byteLength: new TextEncoder().encode(content).length,
      contentHash: artifact.contentHash,
      manifest: structuredClone(artifact.manifest),
    },
  };
}

/** Builds one fresh media platform (the REAL service over in-memory seams). */
function makeMediaPlatform(): { service: MediaService; storage: InMemoryStorage } {
  const storage = new InMemoryStorage();
  const store = new SqliteMediaPlatformStore(":memory:");
  const service = new MediaPlatformService({
    storage,
    sourceAssets: store.sourceAssets,
    manifests: store.manifests,
    artifacts: store.artifacts,
    jobs: store.jobs,
    resolvePolicy: (sessionId: string) => (sessionId === SESSION_ID ? FULL_POLICY : null),
    nowMs: () => NOW_MS,
    autoRun: false,
  });
  return { service, storage };
}

/** One measured put (the counting store's own record). */
interface PutMeasurement {
  artifactId: string;
  outcome: "stored" | "duplicate";
  duplicateCount: number;
}

/**
 * Wraps one artifact store with the put counters the battery measures
 * (dispatched puts, stored vs duplicate outcomes — never re-written bytes).
 */
function countingArtifactStore(inner: ArtifactStore): {
  store: ArtifactStore;
  puts: PutMeasurement[];
  putCalls: () => number;
  storedPuts: () => number;
  duplicatePuts: () => number;
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
  return {
    store,
    puts,
    putCalls: () => puts.length,
    storedPuts: () => puts.filter((put) => put.outcome === "stored").length,
    duplicatePuts: () => puts.filter((put) => put.outcome === "duplicate").length,
  };
}

/**
 * The laundered-delivery rig: a TAMPERED pre-stored record served by the
 * store for the exact artifact id the composed read will look up (the
 * content-addressed id is right; the CONTENT is wrong — the tamper).
 */
function tamperingArtifactStore(inner: ArtifactStore, tampered: StoredArtifact): ArtifactStore {
  return {
    putArtifact: (input: PutArtifactInput) => inner.putArtifact(input),
    getArtifact: (artifactId: string) =>
      artifactId === tampered.artifactId
        ? structuredClone(tampered)
        : inner.getArtifact(artifactId),
    listArtifacts: () => inner.listArtifacts(),
    deleteArtifact: (artifactId: string) => inner.deleteArtifact(artifactId),
    stats: () => inner.stats(),
  };
}

/** The writer under test (the composition's own routing writer). */
function makeWriter(
  media: { service: MediaService },
  artifactStore: ArtifactStore,
): RenderOutputWriter {
  return createDerivedRealityRenderOutputWriter({
    segmentStore: new InMemoryRenderSegmentStore(),
    getMedia: () => media.service,
    encodedArtifactStore: artifactStore,
  });
}

/** Ingests one envelope (the control plane's await contract). */
async function ingest(writer: RenderOutputWriter, envelope: unknown): Promise<void> {
  await writer.storeSegment(envelope as Parameters<RenderOutputWriter["storeSegment"]>[0]);
}

/** Captures the ingest's rejection (the typed refusal object, never a string). */
async function refusalOf(writer: RenderOutputWriter, envelope: unknown): Promise<unknown> {
  try {
    await ingest(writer, envelope);
  } catch (err) {
    return err;
  }
  return null;
}

// The REAL encoded artifact (built once — the ffmpeg encode is real work).
let artifact: EncodedArtifact;
/** The landing from case 1 (case 2 pins its byte-identity against it). */
let hostedLanding: { manifest: RenderArtifactManifest; bytes: Uint8Array } | null = null;

describe.skipIf(!encoderAvailable)(
  "the R306 artifact-delivery/ingest seam (flight 5 — the hosted gap class closed at the app-side ingest)",
  () => {
    beforeAll(() => {
      // THE REAL ARTIFACT: synthetic rgb24 frames through the REAL
      // ffmpeg/libx264 encoder — a REAL MP4 (ftyp, avc1), never a fixture.
      artifact = bridgeRgbFrames({
        encoder: encoder!,
        frames: syntheticFrames(FRAME_COUNT),
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
      expect(artifact.kind).toBe("mp4");
      expect(artifact.byteSize).toBeGreaterThan(1024);
      expect(Buffer.from(artifact.bytes.subarray(4, 8)).toString("ascii")).toBe("ftyp");
    });

    test("case 1 — THE HOSTED-SHAPE DELIVERY LANDS (the gap class: two stores, the artifact in the worker's only)", async () => {
      // The hosted plane's split: the worker registered ITS OWN store; the
      // app's composed store is EMPTY (a different runtime's instance).
      const workerStore = new InMemoryArtifactStore();
      const workerRegistration = registerEncodedArtifact(workerStore, artifact);
      expect(workerRegistration.outcome).toBe("stored");
      const appStore = countingArtifactStore(new InMemoryArtifactStore());
      const media = makeMediaPlatform();
      const writer = makeWriter(media, appStore.store);
      const envelope = inlineEnvelopeOf(artifact);

      // THE PRE-FIX REFUSAL SHAPE (measured first, on the record): the
      // app-side store's own read of the delivered id misses.
      const missId = storeArtifactIdOf(envelope.segment.content);
      let missRefusal: unknown = null;
      try {
        loadEncodedArtifact(appStore.store, missId, envelope.segment.contentHash);
      } catch (err) {
        missRefusal = err;
      }
      expect(missRefusal).toBeInstanceOf(EncodingError);
      expect((missRefusal as EncodingError).message).toBe(
        `encoding refused (artifact-invalid): no artifact "${missId}" is stored`,
      );

      // THE LANDING (the post-fix ingest through the REAL writer):
      await ingest(writer, envelope);

      // The media platform recorded the artifact (the manifest + bytes).
      const records = media.service.artifactsOfSession(SESSION_ID);
      expect(records).toHaveLength(1);
      const record = records[0]!;
      expect(record.artifactId).toBe(`mp4-${artifact.contentHash.slice(0, 16)}`);
      expect(record.contentHash).toBe(artifact.contentHash);
      expect(record.byteSize).toBe(artifact.byteSize);
      expect(record.reality).toBe("three-d-game");
      expect(record.sessionId).toBe(SESSION_ID);
      expect(record.swm).toEqual({ snapshotVersion: 7, lastEventSequence: 402 });
      // The storage seam serves the INTEGRITY-VERIFIED bytes (byte-identical
      // to the worker's own encode, ftyp magic — a REAL MP4 landed).
      const stored = await media.storage.get(normalizedMediaKey(artifact.contentHash));
      expect(stored).not.toBeNull();
      expect(sha256OfBytes(stored!)).toBe(artifact.contentHash);
      expect(Buffer.compare(Buffer.from(stored!), Buffer.from(artifact.bytes))).toBe(0);
      expect(Buffer.from(stored!.subarray(4, 8)).toString("ascii")).toBe("ftyp");
      hostedLanding = { manifest: structuredClone(record), bytes: stored! };

      // The put-counter arithmetic: ONE dispatched put, ONE stored, ZERO
      // duplicates — the landing's own registration, nothing else.
      expect(appStore.putCalls()).toBe(1);
      expect(appStore.storedPuts()).toBe(1);
      expect(appStore.duplicatePuts()).toBe(0);

      // BASE64-CANONICALITY, MEASURED: the delivered text IS byte-identical
      // to the canonical re-encode (the worker's own `base64Of`), so the
      // registration's artifactId IS the delivered id's hash — measured,
      // never assumed.
      expect(envelope.segment.content).toBe(base64Of(artifact.bytes));
      const registeredId = appStore.puts[0]!.artifactId;
      expect(registeredId).toBe(missId);

      // The app store now serves the verified read-back through the SAME
      // seam the in-process path uses (bytes byte-identical to the encode).
      const loaded = loadEncodedArtifact(appStore.store, registeredId, artifact.contentHash);
      expect(loaded.contentHash).toBe(artifact.contentHash);
      expect(Buffer.compare(Buffer.from(loaded.bytes), Buffer.from(artifact.bytes))).toBe(0);
      expect(loaded.record.contentType).toBe(ENCODED_ARTIFACT_CONTENT_TYPE);
      // The registered metadata is the artifact's own (the W504 six fields).
      expect(loaded.record.metadata).toEqual(encodedArtifactMetadataOf(artifact));
    });

    test("case 2 — the in-process shape: the SHARED store read succeeds, ZERO puts, byte-identical landing (non-degradation)", async () => {
      // The in-process plane: the worker's registration landed in the SAME
      // store instance the writer reads (the composition's own wiring).
      const sharedStore = countingArtifactStore(new InMemoryArtifactStore());
      const workerRegistration = registerEncodedArtifact(sharedStore.store, artifact);
      expect(workerRegistration.outcome).toBe("stored");
      const preIngestPuts = sharedStore.putCalls();
      expect(preIngestPuts).toBe(1); // the worker's own registration only

      const media = makeMediaPlatform();
      const writer = makeWriter(media, sharedStore.store);
      await ingest(writer, inlineEnvelopeOf(artifact));

      // ZERO puts from the ingest: the put counter is UNCHANGED (the
      // initial verified read succeeded — the landing never fired).
      expect(sharedStore.putCalls()).toBe(preIngestPuts);
      expect(sharedStore.storedPuts()).toBe(1);
      expect(sharedStore.duplicatePuts()).toBe(0);

      // The landing is byte-identical to the hosted shape's (the same
      // manifest record, the same served bytes — non-degradation, pinned
      // against case 1's own measurement).
      const records = media.service.artifactsOfSession(SESSION_ID);
      expect(records).toHaveLength(1);
      expect(hostedLanding).not.toBeNull();
      expect(records[0]).toEqual(hostedLanding!.manifest);
      const stored = await media.storage.get(normalizedMediaKey(artifact.contentHash));
      expect(stored).not.toBeNull();
      expect(Buffer.compare(Buffer.from(stored!), Buffer.from(hostedLanding!.bytes))).toBe(0);
      expect(Buffer.compare(Buffer.from(stored!), Buffer.from(artifact.bytes))).toBe(0);
    });

    test("case 3 — re-delivery idempotency: no second put on the same envelope; the non-canonical delivery is the store's COUNTED duplicate", async () => {
      const appStore = countingArtifactStore(new InMemoryArtifactStore());
      const media = makeMediaPlatform();
      const writer = makeWriter(media, appStore.store);
      const envelope = inlineEnvelopeOf(artifact);

      // First delivery: the landing fires (one stored put).
      await ingest(writer, envelope);
      expect(appStore.putCalls()).toBe(1);
      expect(appStore.storedPuts()).toBe(1);
      expect(appStore.duplicatePuts()).toBe(0);
      const firstRecord = media.service.artifactsOfSession(SESSION_ID)[0]!;

      // Second delivery of the SAME envelope: the store read now SUCCEEDS
      // (the artifact is registered) — the in-process shape, ZERO puts.
      await ingest(writer, envelope);
      expect(appStore.putCalls()).toBe(1);
      expect(appStore.storedPuts()).toBe(1);
      expect(appStore.duplicatePuts()).toBe(0);
      // The media platform's record is consistent (the counted-duplicate
      // no-op — still exactly one record, unchanged).
      const records = media.service.artifactsOfSession(SESSION_ID);
      expect(records).toHaveLength(1);
      expect(records[0]).toEqual(firstRecord);

      // THE NON-CANONICAL DELIVERY VARIANT (the delivered text ≠ the
      // canonical re-encode, decodes to the SAME bytes): the miss fires
      // again (a different delivered-text hash) → the landing → the
      // store's COUNTED duplicate, never a second put.
      const wrappedContent = `${envelope.segment.content}\n`;
      const wrappedEnvelope = {
        ...envelope,
        segment: {
          ...envelope.segment,
          content: wrappedContent,
          byteLength: new TextEncoder().encode(wrappedContent).length,
        },
      };
      expect(wrappedContent).not.toBe(base64Of(artifact.bytes)); // measured: NOT canonical
      await ingest(writer, wrappedEnvelope);
      expect(appStore.putCalls()).toBe(2); // one more dispatched
      expect(appStore.storedPuts()).toBe(1); // NEVER a second put
      expect(appStore.duplicatePuts()).toBe(1); // the counted duplicate
      // The store's own stats agree: one artifact, one duplicate put.
      expect(appStore.store.stats().artifacts).toBe(1);
      expect(appStore.store.stats().duplicatePuts).toBe(1);
      // The read-back used the registration's RETURNED artifactId (the
      // canonical content address) — the delivered text's own hash differs.
      expect(appStore.puts[1]!.artifactId).toBe(appStore.puts[0]!.artifactId);
      expect(appStore.puts[1]!.duplicateCount).toBe(1);
      // The media platform's record stays consistent.
      expect(media.service.artifactsOfSession(SESSION_ID)).toHaveLength(1);
      const stored = await media.storage.get(normalizedMediaKey(artifact.contentHash));
      expect(stored).not.toBeNull();
      expect(sha256OfBytes(stored!)).toBe(artifact.contentHash);
    });

    test("case 4 — the integrity refusals preserved: NOTHING put when the delivery fails any existing check", async () => {
      // 4a — delivered bytes that do NOT re-hash to the claim.
      {
        const appStore = countingArtifactStore(new InMemoryArtifactStore());
        const media = makeMediaPlatform();
        const writer = makeWriter(media, appStore.store);
        const tamperedBytes = new Uint8Array(artifact.bytes);
        tamperedBytes[tamperedBytes.length - 1]! ^= 0xff;
        const envelope = inlineEnvelopeOf(artifact);
        const badHashEnvelope = {
          ...envelope,
          segment: { ...envelope.segment, content: base64Of(tamperedBytes) },
        };
        const refusal = await refusalOf(writer, badHashEnvelope);
        expect(refusal).toBeInstanceOf(Error);
        expect((refusal as Error).message).toContain(
          "failed integrity: the delivered bytes hash to",
        );
        expect(appStore.putCalls()).toBe(0);
        expect(media.service.artifactsOfSession(SESSION_ID)).toHaveLength(0);
      }
      // 4b — the manifest's hash disagrees with the segment's claim.
      {
        const appStore = countingArtifactStore(new InMemoryArtifactStore());
        const media = makeMediaPlatform();
        const writer = makeWriter(media, appStore.store);
        const envelope = inlineEnvelopeOf(artifact);
        const lyingManifest = structuredClone(artifact.manifest);
        lyingManifest.contentHash = sha256OfBytes(new Uint8Array([1, 2, 3]));
        const mismatchEnvelope = {
          ...envelope,
          segment: { ...envelope.segment, manifest: lyingManifest },
        };
        const refusal = await refusalOf(writer, mismatchEnvelope);
        expect(refusal).toBeInstanceOf(Error);
        expect((refusal as Error).message).toContain("disagrees with its own container manifest");
        expect(appStore.putCalls()).toBe(0);
        expect(media.service.artifactsOfSession(SESSION_ID)).toHaveLength(0);
      }
      // 4c — the manifest belongs to another session.
      {
        const appStore = countingArtifactStore(new InMemoryArtifactStore());
        const media = makeMediaPlatform();
        const writer = makeWriter(media, appStore.store);
        const envelope = inlineEnvelopeOf(artifact);
        const otherSessionManifest = structuredClone(artifact.manifest);
        otherSessionManifest.sessionId = "sess-someone-else";
        const sessionEnvelope = {
          ...envelope,
          segment: { ...envelope.segment, manifest: otherSessionManifest },
        };
        const refusal = await refusalOf(writer, sessionEnvelope);
        expect(refusal).toBeInstanceOf(Error);
        expect((refusal as Error).message).toContain("belongs to session 'sess-someone-else'");
        expect(appStore.putCalls()).toBe(0);
        expect(media.service.artifactsOfSession(SESSION_ID)).toHaveLength(0);
      }
      // 4d — the manifest itself is invalid (the R306 plane's own check).
      {
        const appStore = countingArtifactStore(new InMemoryArtifactStore());
        const media = makeMediaPlatform();
        const writer = makeWriter(media, appStore.store);
        const envelope = inlineEnvelopeOf(artifact);
        const invalidManifest = structuredClone(artifact.manifest);
        invalidManifest.schemaVersion = "9.9";
        const invalidEnvelope = {
          ...envelope,
          segment: { ...envelope.segment, manifest: invalidManifest },
        };
        const refusal = await refusalOf(writer, invalidEnvelope);
        expect(refusal).toBeInstanceOf(Error);
        expect((refusal as Error).message).toContain("failed container-manifest validation");
        expect(appStore.putCalls()).toBe(0);
        expect(media.service.artifactsOfSession(SESSION_ID)).toHaveLength(0);
      }
    });

    test("case 5 — the LAUNDERED-DELIVERY refusal: a tampered pre-stored record is NEVER registrable from the delivery", async () => {
      const envelope = inlineEnvelopeOf(artifact);
      const missId = storeArtifactIdOf(envelope.segment.content);

      // 5a — a record under the RIGHT id whose CONTENT decodes to the WRONG
      // bytes: the store's own read refuses with the integrity class
      // (verify-failed) — NOT the miss — so the landing NEVER fires.
      {
        const wrongBytes = new Uint8Array(artifact.bytes);
        wrongBytes[0]! ^= 0x5a;
        const tampered: StoredArtifact = {
          artifactId: missId,
          contentType: ENCODED_ARTIFACT_CONTENT_TYPE,
          content: base64Of(wrongBytes),
          byteLength: Buffer.byteLength(base64Of(wrongBytes), "utf8"),
          metadata: encodedArtifactMetadataOf(artifact),
          storedAtMs: NOW_MS,
          storeSequence: 1,
          duplicateCount: 0,
        };
        const appStore = countingArtifactStore(
          tamperingArtifactStore(new InMemoryArtifactStore(), tampered),
        );
        const media = makeMediaPlatform();
        const writer = makeWriter(media, appStore.store);
        const refusal = await refusalOf(writer, envelope);
        expect(refusal).toBeInstanceOf(EncodingError);
        const typed = refusal as EncodingError;
        expect(typed.kind).toBe("verify-failed");
        expect(typed.message).toContain(`artifact "${missId}" decodes to bytes whose sha-256`);
        // NEVER registrable: no put, no record.
        expect(appStore.putCalls()).toBe(0);
        expect(media.service.artifactsOfSession(SESSION_ID)).toHaveLength(0);
      }
      // 5b — a record under the right id with the WRONG content type: the
      // refusal class matches the miss's KIND but not the specific message —
      // still never registrable.
      {
        const tampered: StoredArtifact = {
          artifactId: missId,
          contentType: "text/plain",
          content: envelope.segment.content,
          byteLength: Buffer.byteLength(envelope.segment.content, "utf8"),
          metadata: encodedArtifactMetadataOf(artifact),
          storedAtMs: NOW_MS,
          storeSequence: 1,
          duplicateCount: 0,
        };
        const appStore = countingArtifactStore(
          tamperingArtifactStore(new InMemoryArtifactStore(), tampered),
        );
        const media = makeMediaPlatform();
        const writer = makeWriter(media, appStore.store);
        const refusal = await refusalOf(writer, envelope);
        expect(refusal).toBeInstanceOf(EncodingError);
        const typed = refusal as EncodingError;
        expect(typed.kind).toBe("artifact-invalid");
        expect(typed.message).toContain(`is not an encoded artifact (contentType "text/plain")`);
        expect(appStore.putCalls()).toBe(0);
        expect(media.service.artifactsOfSession(SESSION_ID)).toHaveLength(0);
      }
    });

    test("case 6 — the NO-DELIVERY refusal: the miss with absent/undecodable content stays the SAME typed refusal, VERBATIM", async () => {
      // 6a — an empty inline document (no delivery at all).
      {
        const appStore = countingArtifactStore(new InMemoryArtifactStore());
        const media = makeMediaPlatform();
        const writer = makeWriter(media, appStore.store);
        const envelope = inlineEnvelopeOf(artifact);
        const emptyEnvelope = {
          ...envelope,
          segment: { ...envelope.segment, content: "", byteLength: 0 },
        };
        const expectedId = storeArtifactIdOf("");
        const refusal = await refusalOf(writer, emptyEnvelope);
        expect(refusal).toBeInstanceOf(EncodingError);
        const typed = refusal as EncodingError;
        expect(typed.kind).toBe("artifact-invalid");
        expect(typed.failureClass).toBe("media-invalid");
        // VERBATIM — the exact pre-seam refusal, byte for byte.
        expect(typed.message).toBe(
          `encoding refused (artifact-invalid): no artifact "${expectedId}" is stored`,
        );
        expect(appStore.putCalls()).toBe(0);
        expect(media.service.artifactsOfSession(SESSION_ID)).toHaveLength(0);
      }
      // 6b — a wholly undecodable document (decodes to ZERO bytes): no
      //    delivery. NOTE (measured): Bun's base64 decode is LENIENT — a
      //    string like "!!!not-base64!!!" still decodes to 7 bytes (its
      //    alphabet characters survive), so it is a PRESENT-but-wrong
      //    delivery (case 4a's integrity refusal); only a document with NO
      //    decodable characters is delivery-less.
      {
        const appStore = countingArtifactStore(new InMemoryArtifactStore());
        const media = makeMediaPlatform();
        const writer = makeWriter(media, appStore.store);
        const envelope = inlineEnvelopeOf(artifact);
        const garbageContent = "!!!!!!";
        expect(Buffer.from(garbageContent, "base64").byteLength).toBe(0); // measured
        const garbageEnvelope = {
          ...envelope,
          segment: {
            ...envelope.segment,
            content: garbageContent,
            byteLength: new TextEncoder().encode(garbageContent).length,
          },
        };
        const expectedId = storeArtifactIdOf(garbageContent);
        const refusal = await refusalOf(writer, garbageEnvelope);
        expect(refusal).toBeInstanceOf(EncodingError);
        expect((refusal as EncodingError).message).toBe(
          `encoding refused (artifact-invalid): no artifact "${expectedId}" is stored`,
        );
        expect(appStore.putCalls()).toBe(0);
        expect(media.service.artifactsOfSession(SESSION_ID)).toHaveLength(0);
      }
    });
  },
);
