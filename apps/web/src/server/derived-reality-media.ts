/**
 * THE derived-reality render-output landing (R508-R510) — the composition's
 * routing `RenderOutputWriter`: the control plane's ingest hands every
 * inline output artifact to ONE writer, and this one routes by the
 * artifact's honest content type:
 *
 * - `image/svg+xml` (the W504 anime review segment): the pipeline's own
 *   segment store, byte-identical with the pre-R508 composition — the
 *   explicitly-labeled DIAGNOSTICS surface (never the primary artifact);
 * - `video/mp4+base64` (the R306-encoded derived-reality MP4): decode →
 *   INTEGRITY-VERIFY (the raw bytes re-hash to the artifact's content
 *   address, and the container manifest VALIDATES) → the frozen
 *   `RenderArtifactManifest` → the media platform's
 *   `recordDerivedRealityArtifact` (bytes content-addressed in the
 *   storage seam + the durable artifact record) — the SAME landing the
 *   `original` reality's normalized MP4s take, so the Watch surface serves
 *   all four realities through one verified-read byte route.
 *
 * The frozen manifest: the tactical bridge carries the renderer's OWN
 * frozen manifest VERBATIM (`manifest.rendererManifest`); the game bridges
 * carry the container manifest, and the frozen manifest is DERIVED from
 * its own honest fields (the R303/R304 `mp4-<hash16>` convention) —
 * cross-checked against the verbatim copy when one rides along.
 *
 * Fail-closed: any inconsistency (a hash mismatch, an invalid manifest, a
 * registration refusal) throws LOUD — the ingest marks the job's outputs
 * failed and nothing half-registered is ever served.
 */
import { RenderArtifactManifest } from "@sporta/contracts";
import type { RenderArtifactManifest as RenderArtifactManifestDoc } from "@sporta/contracts";
import type { RenderOutputWriter } from "@sporta/control-api";
import {
  ENCODED_ARTIFACT_CONTENT_TYPE,
  loadEncodedArtifact,
  validateEncodedManifest,
} from "@sporta/encoding";
import type { EncodedContainerManifest } from "@sporta/encoding";
import type { ArtifactStore, RenderSegmentStore } from "@sporta/output-pipeline";
import { sha256OfBytes } from "@sporta/media-platform";
import type { MediaPlatformService } from "@sporta/media-platform";

/** The reality each derived bridge produces (the frozen vocabulary). */
const REALITY_OF_BRIDGE: Readonly<Record<string, RenderArtifactManifestDoc["reality"]>> =
  Object.freeze({
    tactical: "tactical",
    "game-3d": "three-d-game",
    "anime-npr": "anime-npr",
  });

/** The video codec identity recorded in the frozen manifest. */
const DERIVED_VIDEO_CODEC = "avc1.42E01E";

/** Options for {@link createDerivedRealityRenderOutputWriter}. */
export interface DerivedRealityRenderOutputWriterOptions {
  /** The W504 segment store (the SVG review-segment landing, unchanged). */
  segmentStore: RenderSegmentStore;
  /**
   * The media platform service accessor (late-bound: the composition
   * constructs the control app before the media seam, so the writer
   * resolves the service at LANDING time — an ingest can only fire after
   * the whole composition exists).
   */
  getMedia: () => MediaPlatformService;
  /**
   * The W504 content-addressed artifact store (the R306 registration
   * plane). When supplied, the MP4 is READ BACK through the R306
   * `loadEncodedArtifact` seam (the store's own integrity-verified read +
   * the raw-hash re-verification) instead of re-decoding the inline base64
   * in place — the two reads agree by construction.
   */
  encodedArtifactStore?: ArtifactStore;
}

/** One routed segment as the control plane's ingest hands it over. */
interface RoutedSegment {
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
}

/**
 * Creates the routing render-output writer. The MP4 branch is async (the
 * media platform's storage seam is async) — the control plane's ingest
 * awaits the writer's return (the R508-R510 ingest contract).
 */
export function createDerivedRealityRenderOutputWriter(
  options: DerivedRealityRenderOutputWriterOptions,
): RenderOutputWriter {
  return {
    storeSegment(input: RoutedSegment): unknown {
      if (input.segment.contentType === ENCODED_ARTIFACT_CONTENT_TYPE) {
        return landDerivedRealityMp4(options, input);
      }
      // The W504 anime review segment: the pre-R508 landing, byte-identical.
      return options.segmentStore.storeSegment(input as Parameters<
        RenderSegmentStore["storeSegment"]
      >[0]);
    },
  };
}

/**
 * Lands ONE derived-reality MP4: integrity-verify the inline base64
 * document (or read the R306 store back), validate the container manifest,
 * build/verify the frozen `RenderArtifactManifest`, and register it into
 * the media platform.
 */
async function landDerivedRealityMp4(
  options: DerivedRealityRenderOutputWriterOptions,
  input: RoutedSegment,
): Promise<void> {
  const { segment } = input;
  // 1. The bytes: decode the base64 document and re-hash it (fail-closed —
  //    the ingest never lands bytes that do not re-hash to their content
  //    address). When the R306 store is composed, prefer its own verified
  //    read (the same bytes, the same hash, cross-checked).
  let bytes: Uint8Array;
  let measuredHash: string;
  if (options.encodedArtifactStore !== undefined) {
    const loaded = loadEncodedArtifact(
      options.encodedArtifactStore,
      storeArtifactIdOf(segment.content),
      segment.contentHash,
    );
    bytes = loaded.bytes;
    measuredHash = loaded.contentHash;
  } else {
    bytes = Buffer.from(segment.content, "base64");
    measuredHash = sha256OfBytes(bytes);
  }
  if (measuredHash !== segment.contentHash) {
    throw new Error(
      `derived-reality artifact '${segment.contentHash}' failed integrity: the delivered bytes hash to ${measuredHash}`,
    );
  }
  if (segment.byteLength !== Buffer.byteLength(segment.content, "utf8")) {
    throw new Error(
      `derived-reality artifact '${segment.contentHash}' failed its inline byte-length claim (${segment.byteLength} declared, ${Buffer.byteLength(segment.content, "utf8")} measured)`,
    );
  }

  // 2. The container manifest must VALIDATE (the R306 plane's own check).
  const manifestCheck = validateEncodedManifest(segment.manifest);
  if (!manifestCheck.ok) {
    throw new Error(
      `derived-reality artifact '${segment.contentHash}' failed container-manifest validation: ${manifestCheck.issues.join("; ")}`,
    );
  }
  const container = manifestCheck.value;
  if (container.contentHash !== segment.contentHash || container.byteSize !== bytes.byteLength) {
    throw new Error(
      `derived-reality artifact '${segment.contentHash}' disagrees with its own container manifest (hash ${container.contentHash}, byteSize ${container.byteSize} vs ${bytes.byteLength})`,
    );
  }

  // 3. The frozen manifest: the renderer's OWN verbatim copy when one
  //    rides in the container (the tactical bridge carries it), otherwise
  //    derived from the container's own honest fields (the R303/R304
  //    `mp4-<hash16>` convention).
  const manifest = frozenManifestOf(container, bytes);
  if (manifest.sessionId !== input.sessionId) {
    throw new Error(
      `derived-reality artifact '${segment.contentHash}' belongs to session '${manifest.sessionId}', not the ingested '${input.sessionId}'`,
    );
  }
  // The renderer's verbatim copy (when present) must AGREE with the
  // derived one on the fields that matter — a disagreement is a conflict,
  // never a silently preferred side.
  const verbatim = RenderArtifactManifest.safeParse(container.rendererManifest);
  if (verbatim.success) {
    if (
      verbatim.data.contentHash !== manifest.contentHash ||
      verbatim.data.sessionId !== manifest.sessionId ||
      verbatim.data.reality !== manifest.reality ||
      verbatim.data.byteSize !== manifest.byteSize
    ) {
      throw new Error(
        `derived-reality artifact '${segment.contentHash}' carries a verbatim renderer manifest that disagrees with its container manifest`,
      );
    }
    await options.getMedia().recordDerivedRealityArtifact({
      manifest: verbatim.data,
      bytes,
    });
    return;
  }
  await options.getMedia().recordDerivedRealityArtifact({ manifest, bytes });
}

/**
 * The store-side artifact id of a base64 document: the R306 store keys the
 * stored document by the sha-256 of the STORED base64 text (the store's
 * own content address — distinct from the RAW MP4's content address, both
 * recorded honestly by the registration).
 */
function storeArtifactIdOf(base64Content: string): string {
  return sha256OfBytes(new TextEncoder().encode(base64Content));
}

/** Derives the frozen `RenderArtifactManifest` from a validated container manifest. */
function frozenManifestOf(
  container: EncodedContainerManifest,
  bytes: Uint8Array,
): RenderArtifactManifestDoc {
  const reality = REALITY_OF_BRIDGE[container.bridge];
  if (reality === undefined) {
    throw new Error(
      `derived-reality container manifest carries bridge '${container.bridge}', which maps to no frozen reality`,
    );
  }
  if (container.swm === null) {
    throw new Error(
      `derived-reality artifact '${container.contentHash}' carries no SWM provenance — refusing (fail-closed, R605)`,
    );
  }
  const manifest: RenderArtifactManifestDoc = RenderArtifactManifest.parse({
    schemaVersion: "1.1",
    artifactId: `mp4-${container.contentHash.slice(0, 16)}`,
    sessionId: container.sessionId,
    reality,
    contentHash: container.contentHash,
    byteSize: bytes.byteLength,
    container: "mp4",
    videoCodec: DERIVED_VIDEO_CODEC,
    audioCodec: null,
    durationMs: Math.max(1, Math.round(container.geometry.durationMs)),
    rendererId: container.source.rendererId,
    rendererVersion: container.source.rendererVersion,
    generatedAtMs: container.generatedAtMs,
    swm: {
      snapshotVersion: container.swm.snapshotVersion,
      lastEventSequence: container.swm.lastEventSequence,
    },
    integrity: { algorithm: "sha256", verified: true },
  });
  return manifest;
}
