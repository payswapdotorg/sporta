/**
 * @sporta/output-pipeline — the anime output pipeline (work item W504).
 *
 * Encodes, stores, and serves the W502 anime renderer's output:
 *
 * - `encode`: `encodeAnimeClip` — a W502 `AnimeRenderOutput` (SVG frame
 *   sequence + per-frame manifest) becomes ONE self-contained animated SVG
 *   document (SMIL `begin`/`dur` per frame; no JavaScript inside the SVG)
 *   plus a deterministic container manifest (segment id, frame count, total
 *   duration, sha-256 content hash via `Bun.CryptoHasher`, per-frame timing,
 *   the W502 render manifest VERBATIM). See `ENCODING.md` for the format.
 *   HONEST SCOPE: this is an SVG-timeline segment, not raster video —
 *   raster codecs are out of scope for W504.
 * - `artifacts`: the CONTENT-ADDRESSED artifact store — sha-256 artifact id
 *   → bytes, in-memory and on-disk under a declared root with deterministic
 *   paths; puts are idempotent by content (same bytes = same id, counted
 *   duplicate, never re-written); reads are integrity-verified and
 *   byte-identical; listing carries the scope metadata.
 * - `store`: the render-segment store — the rights-gated scope index
 *   `(sessionId, renderId, segmentId)` the control plane serves playback
 *   through (in-memory + `bun:sqlite`), following the W004 repository
 *   patterns: idempotent store with COUNTED duplicates, fail-loud conflicts
 *   on content drift, bounded size with explicit rejects (never silent
 *   eviction), integrity verification on read (never partial data), and
 *   fail-closed playback rights (caller-supplied authorization policy;
 *   without `canStoreDerivatives` retrieval denies before anything is
 *   revealed).
 * - `pipeline`: `createAnimeOutputPipeline` — the ENCODE → STORE → LOCATE
 *   composition over both layers, with honest stats and typed errors;
 *   W502 `anime://` artifact refs become resolvable through
 *   `locateAnimeRef` (rights-gated fail-closed, returning the playback
 *   coordinates the control plane serves).
 *
 * Package boundary: runtime dependencies are `@sporta/contracts` (the
 * fail-closed rights derivation) and `@sporta/renderer-anime` (the W502
 * output types + the deterministic FNV-1a/XML utilities) only. The control
 * plane (`@sporta/control-api`) consumes the store STRUCTURALLY (its
 * `RenderOutputStore` port) with no dependency in either direction at the
 * package level — `@sporta/control-api` and `@sporta/testing` are dev-only
 * here (the W504 e2e wires the whole chain through a real control server).
 */
export {
  ANIME_SEGMENT_FORMAT,
  SEGMENT_ID_PREFIX,
  byteLengthOf,
  contentHashOf,
  encodeAnimeClip,
  formatSmilClock,
  segmentIdentityOf,
  segmentIdOf,
} from "./encode";
export {
  DEFAULT_ARTIFACT_LIMITS,
  InMemoryArtifactStore,
  ON_DISK_LAYOUT,
  OnDiskArtifactStore,
  parseArtifactMetadata,
  resolveArtifactLimits,
} from "./artifacts";
export type { ArtifactStoreOptions } from "./artifacts";
export {
  DEFAULT_STORE_LIMITS,
  InMemoryRenderSegmentStore,
  SqliteRenderSegmentStore,
  assertPlaybackRights,
  parseAnimeSegmentManifest,
  resolveStoreLimits,
} from "./store";
export type { RenderSegmentStoreOptions } from "./store";
export { ANIME_REF_SCHEME, createAnimeOutputPipeline, parseAnimeArtifactRef } from "./pipeline";
export type { AnimeOutputPipeline, AnimeOutputPipelineOptions } from "./pipeline";
export {
  OutputPipelineError,
  PlaybackRightsDeniedError,
  SegmentConflictError,
  SegmentEncodingError,
  SegmentIntegrityError,
  SegmentStoreLimitError,
  SegmentValidationError,
  isOutputPipelineError,
} from "./errors";
export type {
  OutputPipelineErrorDetails,
  OutputPipelineErrorFamily,
  OutputPipelineFailureClass,
} from "./errors";
export { ANIME_SEGMENT_CONTENT_TYPE } from "./types";
export type {
  AnimeArtifactMetadata,
  AnimeRefLocation,
  AnimeRefParse,
  AnimeSegmentFormat,
  AnimeSegmentFrameTiming,
  AnimeSegmentManifest,
  ArtifactStore,
  ArtifactStoreLimits,
  ArtifactStoreStats,
  EncodedAnimeSegment,
  ParsedAnimeArtifactRef,
  PlaybackRightsContext,
  PipelineLocateQuery,
  PipelineStats,
  PipelineStoreInput,
  PipelineStoreResult,
  PutArtifactInput,
  PutArtifactOutcome,
  RenderSegmentStore,
  RenderSegmentStoreLimits,
  RenderSegmentStoreStats,
  SegmentListQuery,
  SegmentRetrievalQuery,
  StoreSegmentInput,
  StoreSegmentOutcome,
  StoredArtifact,
  StoredArtifactSummary,
  StoredRenderSegment,
  StoredRenderSegmentSummary,
} from "./types";
