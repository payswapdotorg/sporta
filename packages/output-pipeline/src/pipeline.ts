/**
 * The W504 output pipeline: ENCODE → STORE → LOCATE over one W502
 * `AnimeRenderOutput`.
 *
 * `createAnimeOutputPipeline` composes the two store layers and owns the
 * host-side steps the control plane does not:
 *
 * 1. **encode** — `encodeAnimeClip` turns the renderer output into one
 *    self-contained animated-SVG segment + container manifest (pure,
 *    byte-deterministic; malformed render output fails loud with
 *    `SegmentEncodingError`);
 * 2. **store** — the encoded segment goes into the scope-keyed
 *    `RenderSegmentStore` (the rights-gated index the W701 control plane
 *    serves playback through — idempotent, counted duplicates, fail-loud
 *    conflicts, bounded), and its content goes into the content-addressed
 *    `ArtifactStore` (sha-256 artifact id; same content = same id, counted
 *    duplicate, never re-written);
 * 3. **locate** — W502 `anime://<sessionId>/<snapshotVersion>/<frameIndex>`
 *    artifact refs become RESOLVABLE: `locateAnimeRef` re-derives playback
 *    rights FAIL-CLOSED first, then matches the ref against the artifact
 *    metadata and verifies each candidate is actually served by the segment
 *    store, returning the exact playback coordinates
 *    `(renderId, segmentId, artifactId)` the control plane's routes answer.
 *
 * Ordering on store: the SEGMENT is stored first, then the artifact. A
 * segment-store rejection (conflict, limit) therefore leaves NO artifact
 * behind; an artifact-store rejection after a successful segment store
 * throws loud with the segment already playable through the control plane
 * (documented honest limitation — the failed pipeline call is never silent,
 * and `stats()` reports both layers).
 *
 * The pipeline object itself structurally satisfies the control plane's
 * `RenderOutputStore` port (`getSegment`/`listSegments` delegate to the
 * segment store), so `createControlServer({ renderOutputStore: pipeline })`
 * wires the whole chain with no dependency in either direction.
 */
import { encodeAnimeClip } from "./encode";
import { SegmentValidationError } from "./errors";
import { InMemoryArtifactStore } from "./artifacts";
import { InMemoryRenderSegmentStore, assertPlaybackRights } from "./store";
import type {
  AnimeArtifactMetadata,
  AnimeRefLocation,
  AnimeRefParse,
  ArtifactStore,
  ParsedAnimeArtifactRef,
  PipelineLocateQuery,
  PipelineStats,
  PipelineStoreInput,
  PipelineStoreResult,
  RenderSegmentStore,
  SegmentListQuery,
  SegmentRetrievalQuery,
  StoredRenderSegment,
  StoredRenderSegmentSummary,
} from "./types";

// ---------------------------------------------------------------------------
// anime:// artifact-ref parsing (W502's opaque refs become structured)
// ---------------------------------------------------------------------------

/** The URI scheme of W502 anime artifact refs (see renderer-anime render.ts). */
export const ANIME_REF_SCHEME = "anime://" as const;

/**
 * Parses one W502 artifact ref: `anime://<sessionId>/<snapshotVersion>/<frameIndex>`.
 * The parser is strict (three non-empty path segments, integer numbers ≥ 0)
 * — a malformed ref NEVER matches anything and is reported with its reason
 * instead of being silently ignored.
 */
export function parseAnimeArtifactRef(ref: string): AnimeRefParse {
  if (typeof ref !== "string" || ref.length < 1) {
    return { kind: "invalid", reason: "artifact ref must be a non-empty string" };
  }
  if (!ref.startsWith(ANIME_REF_SCHEME)) {
    return { kind: "invalid", reason: `artifact ref must start with "${ANIME_REF_SCHEME}"` };
  }
  const path = ref.slice(ANIME_REF_SCHEME.length);
  const segments = path.split("/");
  if (segments.length !== 3) {
    return {
      kind: "invalid",
      reason: `artifact ref must have exactly 3 path segments (sessionId, snapshotVersion, frameIndex); got ${segments.length}`,
    };
  }
  const [sessionId, snapshotVersionText, frameIndexText] = segments as [string, string, string];
  if (sessionId.length < 1) {
    return { kind: "invalid", reason: "artifact ref sessionId segment is empty" };
  }
  const snapshotVersion = Number(snapshotVersionText);
  if (
    !/^\d+$/.test(snapshotVersionText) ||
    !Number.isSafeInteger(snapshotVersion) ||
    snapshotVersion < 0
  ) {
    return {
      kind: "invalid",
      reason: `artifact ref snapshotVersion segment must be a non-negative integer (got "${snapshotVersionText}")`,
    };
  }
  const frameIndex = Number(frameIndexText);
  if (!/^\d+$/.test(frameIndexText) || !Number.isSafeInteger(frameIndex) || frameIndex < 0) {
    return {
      kind: "invalid",
      reason: `artifact ref frameIndex segment must be a non-negative integer (got "${frameIndexText}")`,
    };
  }
  return { kind: "ok", ref: { ref, sessionId, snapshotVersion, frameIndex } };
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/** Options for {@link createAnimeOutputPipeline}. */
export interface AnimeOutputPipelineOptions {
  /**
   * The scope-keyed, rights-gated segment store the control plane serves
   * playback through (default: a fresh `InMemoryRenderSegmentStore`).
   */
  segmentStore?: RenderSegmentStore;
  /**
   * The content-addressed artifact store (sha-256 id → bytes; default: a
   * fresh `InMemoryArtifactStore`). For durable runs pair an
   * `OnDiskArtifactStore` with a `SqliteRenderSegmentStore`.
   */
  artifactStore?: ArtifactStore;
}

/** Derives the artifact metadata of an encoded segment under a store scope. */
function artifactMetadataOf(
  scope: { sessionId: string; renderId: string },
  segment: ReturnType<typeof encodeAnimeClip>,
): AnimeArtifactMetadata {
  return {
    sessionId: scope.sessionId,
    renderId: scope.renderId,
    segmentId: segment.segmentId,
    snapshotVersion: segment.manifest.sourceManifest.session.snapshotVersion,
    frameCount: segment.manifest.frameCount,
    totalDurationMs: segment.manifest.totalDurationMs,
  };
}

/**
 * Creates the output pipeline. Pure composition — no clocks of its own (the
 * stores own their injected clocks), no I/O beyond the stores' own. Every
 * refusal is a typed output-pipeline error; nothing is silently dropped.
 */
export function createAnimeOutputPipeline(
  options: AnimeOutputPipelineOptions = {},
): AnimeOutputPipeline {
  const segmentStore = options.segmentStore ?? new InMemoryRenderSegmentStore();
  const artifactStore = options.artifactStore ?? new InMemoryArtifactStore();

  const pipeline: AnimeOutputPipeline = {
    segmentStore,
    artifactStore,

    encodeAndStore(input: PipelineStoreInput): PipelineStoreResult {
      // 1. Encode (pure, byte-deterministic; malformed output fails loud).
      const segment = encodeAnimeClip(input.output);

      // 2. Store the scope-keyed segment record FIRST (idempotent, counted
      //    duplicates, fail-loud conflicts, bounded). A rejection here
      //    leaves no artifact behind.
      const segmentOutcome = segmentStore.storeSegment({
        sessionId: input.sessionId,
        renderId: input.renderId,
        segment,
      });

      // 3. Put the content into the content-addressed artifact store (same
      //    content = same sha-256 id, counted duplicate, never re-written).
      //    A failure here is loud; the already-stored segment remains
      //    playable through the control plane (documented limitation).
      const artifactOutcome = artifactStore.putArtifact({
        content: segment.content,
        contentType: segment.contentType,
        metadata: artifactMetadataOf(input, segment),
      });

      return {
        sessionId: input.sessionId,
        renderId: input.renderId,
        segmentId: segment.segmentId,
        artifactId: segment.contentHash,
        contentType: segment.contentType,
        byteLength: segment.byteLength,
        frameCount: segment.manifest.frameCount,
        outcome: segmentOutcome.outcome,
        artifactOutcome: artifactOutcome.outcome,
      };
    },

    locateAnimeRef(query: PipelineLocateQuery): AnimeRefLocation[] {
      const parsed = parseAnimeArtifactRef(query.ref);
      // Fail-closed rights FIRST — even for a malformed ref, the gate runs
      // before anything else is revealed (the W701 / store posture).
      assertPlaybackRights({
        sessionId: parsed.kind === "ok" ? parsed.ref.sessionId : query.ref,
        policy: query.policy,
        nowMs: query.nowMs,
      });
      if (parsed.kind === "invalid") {
        // A malformed ref is a caller-input problem, not a silent empty
        // result: it throws (typed, media-invalid) instead.
        throw new SegmentValidationError(`cannot locate anime artifact ref: ${parsed.reason}`, {
          ref: query.ref,
          reason: parsed.reason,
        });
      }
      const target: ParsedAnimeArtifactRef = parsed.ref;
      const matches: AnimeRefLocation[] = [];
      for (const summary of artifactStore.listArtifacts()) {
        const metadata = summary.metadata;
        if (metadata.sessionId !== target.sessionId) continue;
        if (metadata.snapshotVersion !== target.snapshotVersion) continue;
        if (target.frameIndex >= metadata.frameCount) continue;
        // Scope resolution (fixed in the inherited-work audit): the
        // content-addressed layer indexes ONE scope per content hash (first
        // write wins), so `metadata.renderId` is the FIRST scope that stored
        // these bytes — not necessarily the only one that serves them. When
        // the caller narrows to a DIFFERENT render id, probe that scope
        // directly instead of skipping the artifact: it is a valid location
        // iff it serves the same segment id with the same content hash (the
        // pipeline's own multi-scope pattern — the same logical render
        // stored under a second render id, which keeps its deterministic
        // segment id). Without the probe, narrowing to any non-first scope
        // silently returned [] even though the control plane serves the
        // byte-identical artifact there (pinned by tests).
        const scopes: Array<{ renderId: string; segmentId: string }> =
          query.renderId !== undefined && metadata.renderId !== query.renderId
            ? [{ renderId: query.renderId, segmentId: metadata.segmentId }]
            : [{ renderId: metadata.renderId, segmentId: metadata.segmentId }];
        for (const scope of scopes) {
          // The artifact must be SERVED under the candidate scope: its
          // segment record must exist there (an orphaned artifact — e.g.
          // after a failed pipeline call — is never located), and the served
          // content hash must equal the artifact id (a scope storing
          // DIFFERENT bytes under the same segment id is not a location).
          // getSegment re-checks rights fail-closed.
          const served = segmentStore.getSegment({
            sessionId: metadata.sessionId,
            renderId: scope.renderId,
            segmentId: scope.segmentId,
            policy: query.policy,
            nowMs: query.nowMs,
          });
          if (served === null) continue;
          if (served.contentHash !== summary.artifactId) continue;
          matches.push({
            ref: target.ref,
            sessionId: target.sessionId,
            snapshotVersion: target.snapshotVersion,
            frameIndex: target.frameIndex,
            renderId: scope.renderId,
            segmentId: scope.segmentId,
            artifactId: summary.artifactId,
            contentType: summary.contentType,
            byteLength: summary.byteLength,
            contentHash: served.contentHash,
          });
        }
      }
      return matches;
    },

    getSegment(query: SegmentRetrievalQuery): StoredRenderSegment | null {
      return segmentStore.getSegment(query);
    },

    listSegments(query: SegmentListQuery): StoredRenderSegmentSummary[] {
      return segmentStore.listSegments(query);
    },

    stats(): PipelineStats {
      const segmentStats = segmentStore.stats();
      const artifactStats = artifactStore.stats();
      return {
        segments: segmentStats.segments,
        segmentBytes: segmentStats.totalBytes,
        duplicateSegmentStores: segmentStats.duplicateStores,
        artifacts: artifactStats.artifacts,
        artifactBytes: artifactStats.totalBytes,
        duplicateArtifactPuts: artifactStats.duplicatePuts,
      };
    },
  };
  return pipeline;
}

/**
 * The anime output pipeline surface (encode → store → locate). Also
 * structurally satisfies the control plane's `RenderOutputStore` port.
 */
export interface AnimeOutputPipeline {
  /** The scope-keyed, rights-gated segment store (the control-plane face). */
  readonly segmentStore: RenderSegmentStore;
  /** The content-addressed artifact store (the bytes layer). */
  readonly artifactStore: ArtifactStore;

  /**
   * Encodes one W502 render output and stores it: the segment record into
   * the segment store (scope `(sessionId, renderId, segmentId)`), the
   * content into the artifact store (sha-256 id). Idempotent on both
   * layers; fail-loud typed errors; honest outcomes for both layers.
   */
  encodeAndStore(input: PipelineStoreInput): PipelineStoreResult;

  /**
   * Resolves one W502 `anime://…` artifact ref to the playback coordinates
   * the control plane serves, rights-gated fail-closed BEFORE anything is
   * revealed. A malformed ref throws (typed); a well-formed ref that
   * matches nothing resolves to `[]` (honest absence — never an invented
   * location).
   *
   * Scope semantics: the artifact layer indexes ONE scope per content hash
   * (first write wins), so an un-narrowed lookup resolves to the indexed
   * scope. With `renderId` narrowing, the narrowed scope is PROBED directly
   * — it is a valid location iff it serves the same segment id with the
   * same content hash — so the same logical render stored under several
   * render ids resolves under each of them. Honest limitation: scopes
   * serving the identical bytes under a DIFFERENT segment id are not
   * discoverable (the artifact layer has no reverse content index).
   */
  locateAnimeRef(query: PipelineLocateQuery): AnimeRefLocation[];

  /** Fail-closed retrieval (delegates to the segment store). */
  getSegment(query: SegmentRetrievalQuery): StoredRenderSegment | null;

  /** Fail-closed listing (delegates to the segment store). */
  listSegments(query: SegmentListQuery): StoredRenderSegmentSummary[];

  /** Both layers' counters (never-silent accounting). */
  stats(): PipelineStats;
}
