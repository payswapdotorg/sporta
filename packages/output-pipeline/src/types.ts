/**
 * Public types of the anime output pipeline (W504): the encoded segment
 * (one self-contained animated SVG document plus its deterministic container
 * manifest) and the render-segment store documents.
 *
 * The encoder consumes a W502 `AnimeRenderOutput` (SVG frame sequence +
 * per-frame manifest) and produces ONE playable segment; the timing,
 * provenance, and accounting inside the container manifest are copied
 * VERBATIM from the W502 render manifest — the output pipeline never
 * invents timing, positions, captions, or confidence.
 */
import type { AnimeClipManifest, AnimeRenderOutput } from "@sporta/renderer-anime";
import type { AuthorizationPolicy } from "@sporta/contracts";

/** The media type of an encoded anime segment document. */
export const ANIME_SEGMENT_CONTENT_TYPE = "image/svg+xml" as const;

/** The identity of the container format (see ENCODING.md). */
export interface AnimeSegmentFormat {
  /** The format kind: a self-contained animated SVG document (SMIL). */
  kind: "animated-svg";
  /** The container format version (structure-breaking changes bump this). */
  version: 1;
}

/**
 * The SMIL timing of one frame inside the encoded segment, derived EXACTLY
 * from the W502 render manifest: `beginMs` is the frame's output timestamp
 * relative to the first frame; `durMs` is the frame's output window length
 * (`windowMs.endMs - windowMs.startMs`). The same numbers appear (serialized
 * in seconds) as the `begin`/`dur` attributes of the frame's `<set>` element.
 */
export interface AnimeSegmentFrameTiming {
  frameIndex: number;
  /** The frame's position on the W502 output timeline, verbatim. */
  outputTimestampMs: number;
  /** When the frame becomes visible, in ms from the segment start. */
  beginMs: number;
  /** How long the frame stays visible, in ms (the W502 window length). */
  durMs: number;
}

/**
 * The deterministic container manifest of an encoded anime segment: the
 * segment identity, frame count, total duration, content hash, per-frame
 * SMIL timing, and the W502 render manifest VERBATIM (per-frame provenance,
 * dispositions, captions, watermark — the W503 measurement source).
 */
export interface AnimeSegmentManifest {
  /** The container format identity (see ENCODING.md). */
  format: AnimeSegmentFormat;
  /** The deterministic segment id (`anime-clip-<fnv1a32-hex8>`). */
  segmentId: string;
  /** The session the W502 render belongs to, verbatim. */
  sessionId: string;
  /** Number of encoded frames. */
  frameCount: number;
  /** Total playback duration in ms, verbatim from the W502 output window. */
  totalDurationMs: number;
  /**
   * sha-256 of the encoded SVG document text (UTF-8 bytes), as 64 lowercase
   * hex digits via `Bun.CryptoHasher` (the W101 checksum precedent). This is
   * the CONTENT-ADDRESSED artifact id: the same content always hashes to the
   * same id, so it is the key of the artifact store and the integrity check
   * of every stored document.
   */
  contentHash: string;
  /** Per-frame SMIL timing, in W502 frame order. */
  frames: AnimeSegmentFrameTiming[];
  /** The complete W502 render manifest, verbatim (provenance/accounting). */
  sourceManifest: AnimeClipManifest;
}

/**
 * One encoded anime segment: a self-contained animated SVG document (SMIL
 * `begin`/`dur` per frame, no JavaScript inside the SVG) plus the
 * deterministic container manifest.
 */
export interface EncodedAnimeSegment {
  /** The deterministic segment id (matches `manifest.segmentId`). */
  segmentId: string;
  /** Always `image/svg+xml` for this encoder. */
  contentType: typeof ANIME_SEGMENT_CONTENT_TYPE;
  /** The full animated SVG document, UTF-8 text. */
  content: string;
  /** UTF-8 byte length of `content` (measured, never asserted from input). */
  byteLength: number;
  /** sha-256 of `content`, 64 lowercase hex digits (matches the manifest). */
  contentHash: string;
  /** The deterministic container manifest. */
  manifest: AnimeSegmentManifest;
}

/** Caller-supplied authorization decision for a retrieval (W701 posture). */
export interface PlaybackRightsContext {
  /**
   * The authorization policy for the session — the trust boundary (W701:
   * there is no user authentication yet; the caller-supplied policy is it).
   * Capabilities are RE-DERIVED fail-closed at `nowMs`; a missing, expired,
   * or insufficient decision denies before any data is revealed.
   */
  policy: AuthorizationPolicy;
  /** Evaluation time for the policy derivation (an injected clock value). */
  nowMs: number;
}

// ---------------------------------------------------------------------------
// Content-addressed artifact store (the bytes layer)
// ---------------------------------------------------------------------------

/**
 * The scope metadata recorded with a stored artifact: the coordinates the
 * artifact can later be LOCATED by, copied from the encoded segment manifest
 * + the store scope at put time (the pipeline). These fields are what make
 * W502 `anime://<sessionId>/<snapshotVersion>/<frameIndex>` artifact refs
 * resolvable: a ref matches an artifact when the session/snapshot match and
 * the frame index is below `frameCount`.
 */
export interface AnimeArtifactMetadata {
  sessionId: string;
  renderId: string;
  segmentId: string;
  /** The W502 render's snapshot version (manifest `session.snapshotVersion`). */
  snapshotVersion: number;
  /** The number of frames the artifact covers (manifest `frameCount`). */
  frameCount: number;
  /** Total playback duration in ms (manifest `totalDurationMs`). */
  totalDurationMs: number;
}

/** A stored content-addressed artifact, as handed out by the store. */
export interface StoredArtifact {
  /** The sha-256 of the content — the artifact's address (64 lowercase hex). */
  artifactId: string;
  contentType: string;
  /** The artifact document, verbatim (byte-identical on every read). */
  content: string;
  /** UTF-8 byte length of `content` (measured, never declared). */
  byteLength: number;
  /** The scope coordinates recorded at put time. */
  metadata: AnimeArtifactMetadata;
  /** Store time in epoch ms (from the injected clock). */
  storedAtMs: number;
  /** Deterministic insertion order (stable across reopen). */
  storeSequence: number;
  /** How many no-op duplicate puts were counted for this artifact. */
  duplicateCount: number;
}

/** One entry of `ArtifactStore.listArtifacts`. */
export interface StoredArtifactSummary {
  artifactId: string;
  contentType: string;
  byteLength: number;
  metadata: AnimeArtifactMetadata;
}

/** Input for `ArtifactStore.putArtifact`. */
export interface PutArtifactInput {
  content: string;
  contentType: string;
  metadata: AnimeArtifactMetadata;
}

/**
 * The outcome of `ArtifactStore.putArtifact` (never silent): idempotent by
 * construction — the same content is the same artifact id, counted as a
 * duplicate, and the stored bytes are never re-written.
 */
export type PutArtifactOutcome =
  | { outcome: "stored"; record: StoredArtifact }
  | { outcome: "duplicate"; record: StoredArtifact; duplicateCount: number };

/** Counters exposed by `ArtifactStore.stats()`. */
export interface ArtifactStoreStats {
  /** Distinct stored artifacts. */
  artifacts: number;
  /** Total UTF-8 bytes over stored artifacts. */
  totalBytes: number;
  /** Total no-op duplicate puts counted (idempotent re-puts). */
  duplicatePuts: number;
}

/** Artifact-store size bounds — exceeded bounds REJECT, never silently evict. */
export interface ArtifactStoreLimits {
  /** Maximum number of distinct stored artifacts. */
  maxArtifacts: number;
  /** Maximum total UTF-8 bytes over all stored artifacts. */
  maxTotalBytes: number;
  /** Maximum UTF-8 bytes of a single artifact. */
  maxArtifactBytes: number;
}

/**
 * The content-addressed artifact store port (W504): sha-256 artifact id →
 * artifact. `put` is idempotent by content (same bytes = same id, counted
 * duplicate, never re-written); `get` returns the byte-identical artifact
 * (integrity-verified) or `null` for an absent id; `list` returns the
 * summaries WITH metadata in insertion order. Rights are derived one layer
 * up (the render-segment store gate + the pipeline's locate gate) — this
 * layer owns bytes and integrity, not authorization.
 */
export interface ArtifactStore {
  putArtifact(input: PutArtifactInput): PutArtifactOutcome;
  getArtifact(artifactId: string): StoredArtifact | null;
  listArtifacts(): StoredArtifactSummary[];
  /** Removes one artifact; idempotent (deleting an absent id is a no-op). */
  deleteArtifact(artifactId: string): void;
  stats(): ArtifactStoreStats;
}

/** A stored render-output segment, as handed out by the store. */
export interface StoredRenderSegment {
  sessionId: string;
  renderId: string;
  segmentId: string;
  contentType: string;
  /** The encoded segment document (e.g. the animated SVG text). */
  content: string;
  /** UTF-8 byte length of `content`. */
  byteLength: number;
  /** sha-256 of `content`, 64 lowercase hex digits (the content-addressed artifact id). */
  contentHash: string;
  /** The deterministic container manifest, verbatim. */
  manifest: AnimeSegmentManifest;
  /** Store time in epoch ms (from the injected clock). */
  storedAtMs: number;
  /** Deterministic insertion order (stable across sqlite reopen). */
  storeSequence: number;
  /** How many no-op duplicate stores were counted for this key. */
  duplicateCount: number;
}

/** One entry of `RenderSegmentStore.listSegments`. */
export interface StoredRenderSegmentSummary {
  segmentId: string;
  contentType: string;
  byteLength: number;
  contentHash: string;
}

/** Input for `RenderSegmentStore.storeSegment`. */
export interface StoreSegmentInput {
  sessionId: string;
  renderId: string;
  segment: EncodedAnimeSegment;
}

/** The outcome of `RenderSegmentStore.storeSegment` (never silent). */
export type StoreSegmentOutcome =
  | { outcome: "stored"; record: StoredRenderSegment }
  | { outcome: "duplicate"; record: StoredRenderSegment; duplicateCount: number };

/** Retrieval query for one exact segment (rights-checked, fail-closed). */
export interface SegmentRetrievalQuery extends PlaybackRightsContext {
  sessionId: string;
  renderId: string;
  segmentId: string;
}

/** Listing query for all segments under one render (rights-checked). */
export interface SegmentListQuery extends PlaybackRightsContext {
  sessionId: string;
  renderId: string;
}

/** Store size bounds — exceeded bounds REJECT, never silently evict. */
export interface RenderSegmentStoreLimits {
  /** Maximum number of distinct stored segments. */
  maxSegments: number;
  /** Maximum total UTF-8 bytes over all stored segments. */
  maxTotalBytes: number;
  /** Maximum UTF-8 bytes of a single segment. */
  maxSegmentBytes: number;
}

/** Counters exposed by `RenderSegmentStore.stats()` (never silent accounting). */
export interface RenderSegmentStoreStats {
  /** Distinct stored segments. */
  segments: number;
  /** Total UTF-8 bytes over stored segments. */
  totalBytes: number;
  /** Total no-op duplicate stores counted (idempotent re-stores). */
  duplicateStores: number;
}

/**
 * The render-segment store port (W504). In-memory and `bun:sqlite`
 * implementations follow the W004 repository patterns: validation on write
 * AND read, idempotent store with counted duplicates, fail-loud conflicts,
 * bounded size with explicit rejects, deep-clone-on-read, and fail-closed
 * rights on retrieval.
 */
export interface RenderSegmentStore {
  /**
   * Validates and stores an encoded segment. Idempotent: the same key with
   * the same content is a no-op duplicate that is COUNTED (the stored
   * record is returned unchanged); the same key with different content
   * throws {@link SegmentConflictError}. Bounds are enforced with
   * {@link SegmentStoreLimitError} — never silent eviction.
   */
  storeSegment(input: StoreSegmentInput): StoreSegmentOutcome;
  /**
   * Fail-closed retrieval: the caller-supplied policy is re-derived at
   * `nowMs`; without `canStoreDerivatives` the call throws
   * {@link PlaybackRightsDeniedError} BEFORE revealing whether the segment
   * exists. Returns `null` only for an absent key.
   */
  getSegment(query: SegmentRetrievalQuery): StoredRenderSegment | null;
  /**
   * Fail-closed listing (same rights posture) of every segment stored under
   * `(sessionId, renderId)`, in insertion order.
   */
  listSegments(query: SegmentListQuery): StoredRenderSegmentSummary[];
  /** Removes one segment; idempotent (deleting an absent key is a no-op). */
  deleteSegment(sessionId: string, renderId: string, segmentId: string): void;
  /** Store counters (distinct segments, total bytes, counted duplicates). */
  stats(): RenderSegmentStoreStats;
}

// ---------------------------------------------------------------------------
// The encode → store → locate pipeline (./pipeline.ts)
// ---------------------------------------------------------------------------

/** Input for `AnimeOutputPipeline.encodeAndStore`. */
export interface PipelineStoreInput {
  /** The session scope the encoded segment is stored under. */
  sessionId: string;
  /** The host-assigned render id (e.g. the control plane's `r-<seq>`). */
  renderId: string;
  /** The W502 render output to encode (SVG frames + manifest). */
  output: AnimeRenderOutput;
}

/** Result of `AnimeOutputPipeline.encodeAndStore` (honest, both layers). */
export interface PipelineStoreResult {
  sessionId: string;
  renderId: string;
  /** The deterministic segment id (`anime-clip-<fnv1a32-hex8>`). */
  segmentId: string;
  /** The sha-256 content hash — the content-addressed artifact id. */
  artifactId: string;
  contentType: string;
  byteLength: number;
  frameCount: number;
  /** The segment-store outcome (`stored` | `duplicate`). */
  outcome: "stored" | "duplicate";
  /** The artifact-store outcome (same content = same id, counted). */
  artifactOutcome: "stored" | "duplicate";
}

/** A parsed, well-formed W502 `anime://…` artifact ref. */
export interface ParsedAnimeArtifactRef {
  /** The original ref string, verbatim. */
  ref: string;
  sessionId: string;
  snapshotVersion: number;
  frameIndex: number;
}

/** The parse result of one W502 artifact ref (malformed refs carry a reason). */
export type AnimeRefParse =
  { kind: "ok"; ref: ParsedAnimeArtifactRef } | { kind: "invalid"; reason: string };

/** Query for `AnimeOutputPipeline.locateAnimeRef` (rights-gated, fail-closed). */
export interface PipelineLocateQuery extends PlaybackRightsContext {
  /** The W502 artifact ref to resolve (`anime://<sess>/<snapshot>/<frame>`). */
  ref: string;
  /** Optional render-scope narrowing (resolve only under this render id). */
  renderId?: string;
}

/**
 * One resolved location of a W502 `anime://…` ref: the playback coordinates
 * the control plane serves
 * (`GET /v1/sessions/:id/renders/:renderId/outputs/:segmentId`) plus the
 * content-addressed artifact id behind them.
 */
export interface AnimeRefLocation {
  /** The resolved ref, verbatim. */
  ref: string;
  sessionId: string;
  snapshotVersion: number;
  frameIndex: number;
  renderId: string;
  segmentId: string;
  /** The sha-256 artifact id (=== the served segment's contentHash). */
  artifactId: string;
  contentType: string;
  byteLength: number;
  contentHash: string;
}

/** Both store layers' counters (never-silent accounting). */
export interface PipelineStats {
  /** Distinct segments in the render-segment store. */
  segments: number;
  /** Total UTF-8 bytes over stored segments. */
  segmentBytes: number;
  /** Counted no-op duplicate segment stores. */
  duplicateSegmentStores: number;
  /** Distinct artifacts in the content-addressed store. */
  artifacts: number;
  /** Total UTF-8 bytes over stored artifacts. */
  artifactBytes: number;
  /** Counted no-op duplicate artifact puts. */
  duplicateArtifactPuts: number;
}
