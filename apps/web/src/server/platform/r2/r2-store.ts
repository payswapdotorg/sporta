/**
 * The R2-backed render-output store (W912) — the hosted adapter for the W504
 * render-output store PORT.
 *
 * HONEST PORT BOUNDARY: the engine's `RenderSegmentStore` (W504) is a
 * SYNCHRONOUS interface (the in-memory/`bun:sqlite` era). Network I/O cannot
 * honestly implement a synchronous store, so this adapter implements the
 * port's SEMANTICS with async methods — the same structural-port precedent
 * `@sporta/control-api` uses for its own `RenderOutputStore` consumer seam
 * (`packages/control-api/src/playback.ts` declares the interface instead of
 * importing the engine package). The semantics preserved, fail-closed:
 *
 * - idempotent stores with COUNTED duplicates; the same key with DIFFERENT
 *   content is a fail-loud `SegmentConflictError` (stored output is never
 *   silently replaced);
 * - bounded size (segments / per-segment bytes / total bytes) with explicit
 *   `SegmentStoreLimitError` rejection — never silent eviction;
 * - retrieval is RIGHTS-GATED FIRST: without `canStoreDerivatives` (re-derived
 *   fail-closed at `nowMs`) the call denies BEFORE revealing existence;
 * - stored documents are re-verified on read (content hash + measured byte
 *   length) — corrupted data fails loudly (`SegmentIntegrityError`), never
 *   partial data.
 *
 * Object layout (private bucket):
 * - `render-outputs/<sessionId>/<renderId>/<segmentId>.json` — the document;
 * - `render-outputs/<sessionId>/<renderId>/index.json` — insertion order +
 *   per-scope totals (what `listSegments` reads);
 * - `render-outputs/_stats.json` — the store-global counters (`stats()`).
 *
 * SINGLE-WRITER ASSUMPTION (documented): index/stats updates are
 * read-modify-write on single objects. Hosted writes are serialized per scope
 * by the bounded job queue (W913) / compute adapter (W914-hosted); concurrent
 * independent writers to the SAME scope are outside this wave's composition
 * (see DEPLOYMENT.md "Known boundaries").
 */
import { createHash } from "node:crypto";
import { deriveRightsCapabilities, type AuthorizationPolicy } from "@sporta/contracts";
import { presignGetUrl, signAwsRequest, type SigV4Credentials } from "./sigv4";

// ---------------------------------------------------------------------------
// Types (the structural mirrors of the W504 port vocabulary)
// ---------------------------------------------------------------------------

/** The rights context a retrieval must carry (W701 posture). */
export interface HostedPlaybackRightsContext {
  policy: AuthorizationPolicy | null | undefined;
  nowMs: number;
}

/** An encoded render-output segment (W504 `EncodedAnimeSegment`, manifest opaque). */
export interface HostedEncodedSegment {
  segmentId: string;
  contentType: string;
  content: string;
  byteLength: number;
  contentHash: string;
  /** The deterministic container manifest, stored VERBATIM (opaque here). */
  manifest: unknown;
}

/** Input for {@link R2RenderOutputStore.storeSegment}. */
export interface HostedStoreSegmentInput {
  sessionId: string;
  renderId: string;
  segment: HostedEncodedSegment;
}

/** A stored segment, as handed out by the store. */
export interface HostedStoredRenderSegment {
  sessionId: string;
  renderId: string;
  segmentId: string;
  contentType: string;
  content: string;
  byteLength: number;
  contentHash: string;
  manifest: unknown;
  storedAtMs: number;
  storeSequence: number;
  duplicateCount: number;
}

/** The outcome of a store (never silent). */
export type HostedStoreSegmentOutcome =
  | { outcome: "stored"; record: HostedStoredRenderSegment }
  | { outcome: "duplicate"; record: HostedStoredRenderSegment; duplicateCount: number };

/** One entry of `listSegments`. */
export interface HostedSegmentSummary {
  segmentId: string;
  contentType: string;
  byteLength: number;
  contentHash: string;
}

/** Retrieval query (rights-checked, fail-closed). */
export interface HostedSegmentRetrievalQuery extends HostedPlaybackRightsContext {
  sessionId: string;
  renderId: string;
  segmentId: string;
}

/** Listing query (rights-checked, fail-closed). */
export interface HostedSegmentListQuery extends HostedPlaybackRightsContext {
  sessionId: string;
  renderId: string;
}

/** Store bounds — exceeded bounds REJECT, never silently evict (W504 values). */
export interface HostedSegmentStoreLimits {
  maxSegments: number;
  maxTotalBytes: number;
  maxSegmentBytes: number;
}

/** Counters exposed by `stats()` (never silent accounting). */
export interface HostedSegmentStoreStats {
  segments: number;
  totalBytes: number;
  duplicateStores: number;
}

/** The W504 default magnitudes (free-tier conservative: 10 GB provider cap). */
export const HOSTED_STORE_DEFAULT_LIMITS: HostedSegmentStoreLimits = {
  maxSegments: 1_000,
  maxSegmentBytes: 16 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
};

// ---------------------------------------------------------------------------
// Typed errors (structural mirrors of the W504 family — same names, same
// failureClass values, so control-plane consumers recognize them structurally)
// ---------------------------------------------------------------------------

/** Failure classification (the session-level `TerminalFailureClass` values). */
export type PlatformFailureClass =
  "rights-denied" | "media-invalid" | "resource-limit" | "internal";

/** The base of the platform store error family. */
export class PlatformStoreError extends Error {
  readonly failureClass: PlatformFailureClass;
  readonly details: Record<string, unknown>;

  constructor(
    failureClass: PlatformFailureClass,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "PlatformStoreError";
    this.failureClass = failureClass;
    this.details = details;
  }
}

/** Retrieval rights were denied (fail-closed, before existence is revealed). */
export class PlaybackRightsDeniedError extends PlatformStoreError {
  constructor(message = "playback denied: the policy does not permit storing derivatives") {
    super("rights-denied", message);
    this.name = "PlaybackRightsDeniedError";
  }
}

/** A malformed/incoherent segment document (fail-loud on write). */
export class SegmentValidationError extends PlatformStoreError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("media-invalid", message, details);
    this.name = "SegmentValidationError";
  }
}

/** Same key, different content — never a silent replace. */
export class SegmentConflictError extends PlatformStoreError {
  constructor(
    sessionId: string,
    renderId: string,
    segmentId: string,
    storedContentHash: string,
    receivedContentHash: string,
  ) {
    super(
      "media-invalid",
      `render output segment '${segmentId}' for render '${renderId}' on session '${sessionId}' is already stored with different content`,
      { sessionId, renderId, segmentId, storedContentHash, receivedContentHash },
    );
    this.name = "SegmentConflictError";
  }
}

/** A store bound was exceeded (explicit rejection). */
export class SegmentStoreLimitError extends PlatformStoreError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("resource-limit", message, details);
    this.name = "SegmentStoreLimitError";
  }
}

/** A stored document failed integrity verification on read. */
export class SegmentIntegrityError extends PlatformStoreError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("internal", message, details);
    this.name = "SegmentIntegrityError";
  }
}

// ---------------------------------------------------------------------------
// Wire envelopes
// ---------------------------------------------------------------------------

interface SegmentDocumentV1 {
  schema: "sporta.render-output/1";
  sessionId: string;
  renderId: string;
  segmentId: string;
  contentType: string;
  content: string;
  byteLength: number;
  contentHash: string;
  manifest: unknown;
  storedAtMs: number;
  storeSequence: number;
  duplicateCount: number;
}

interface IndexEntry {
  segmentId: string;
  storeSequence: number;
  byteLength: number;
  contentHash: string;
  contentType: string;
}

interface ScopeIndexV1 {
  schema: "sporta.render-output-index/1";
  sessionId: string;
  renderId: string;
  nextSequence: number;
  duplicateStores: number;
  totalBytes: number;
  entries: IndexEntry[];
}

interface StatsV1 {
  schema: "sporta.render-output-stats/1";
  segments: number;
  totalBytes: number;
  duplicateStores: number;
}

const EMPTY_STATS: StatsV1 = {
  schema: "sporta.render-output-stats/1",
  segments: 0,
  totalBytes: 0,
  duplicateStores: 0,
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const UTF8 = new TextEncoder();
const HEX64 = /^[0-9a-f]{64}$/;

function validScopeId(kind: string, value: string): boolean {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128 &&
    !value.includes("\u0000") &&
    !value.includes("/") &&
    /^[\x20-\x7e]+$/.test(value)
  );
}

function measureUtf8Bytes(text: string): number {
  return UTF8.encode(text).length;
}

function assertRights(query: HostedPlaybackRightsContext): void {
  if (!Number.isFinite(query.nowMs)) {
    throw new PlaybackRightsDeniedError("playback denied: evaluation time is not finite");
  }
  const capabilities = deriveRightsCapabilities(query.policy ?? null, new Date(query.nowMs));
  if (!capabilities.canStoreDerivatives) {
    throw new PlaybackRightsDeniedError();
  }
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/** Options for {@link R2RenderOutputStore}. */
export interface R2RenderOutputStoreOptions {
  /** R2 S3-compatible endpoint (e.g. `https://<account>.r2.cloudflarestorage.com`). */
  endpoint: string;
  /** Private bucket name. */
  bucket: string;
  credentials: SigV4Credentials;
  /** Overrides for the W504 default bounds. */
  limits?: Partial<HostedSegmentStoreLimits>;
  /** Wall clock for stored timestamps (default: real time). */
  nowMs?: () => number;
  /** Injectable fetch (tests/proxies). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** The R2-backed render-output store (W504 semantics, async port). */
export class R2RenderOutputStore {
  readonly #endpoint: string;
  readonly #bucket: string;
  readonly #credentials: SigV4Credentials;
  readonly #limits: HostedSegmentStoreLimits;
  readonly #nowMs: () => number;
  readonly #fetchImpl: typeof fetch;

  constructor(options: R2RenderOutputStoreOptions) {
    this.#endpoint = options.endpoint.replace(/\/$/, "");
    this.#bucket = options.bucket;
    this.#credentials = options.credentials;
    this.#limits = { ...HOSTED_STORE_DEFAULT_LIMITS, ...options.limits };
    this.#nowMs = options.nowMs ?? Date.now;
    this.#fetchImpl = options.fetchImpl ?? fetch;
  }

  // -- object addressing ----------------------------------------------------

  #objectUrl(key: string): URL {
    return new URL(`${this.#endpoint}/${this.#bucket}/${key}`);
  }

  #documentKey(sessionId: string, renderId: string, segmentId: string): string {
    return `render-outputs/${sessionId}/${renderId}/${segmentId}.json`;
  }

  #indexKey(sessionId: string, renderId: string): string {
    return `render-outputs/${sessionId}/${renderId}/index.json`;
  }

  static readonly STATS_KEY = "render-outputs/_stats.json";

  // -- signed object primitives ----------------------------------------------

  async #getJson<T>(key: string): Promise<T | null> {
    const signed = signAwsRequest({
      method: "GET",
      url: this.#objectUrl(key),
      credentials: this.#credentials,
    });
    const response = await this.#fetchImpl(signed.url, {
      method: "GET",
      headers: signed.headers,
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new PlatformStoreError(
        "internal",
        `r2 get '${key}' failed with HTTP ${response.status}`,
        { key, status: response.status },
      );
    }
    return (await response.json()) as T;
  }

  async #putJson(key: string, value: unknown, contentType = "application/json"): Promise<void> {
    const body = JSON.stringify(value);
    const signed = signAwsRequest({
      method: "PUT",
      url: this.#objectUrl(key),
      headers: { "content-type": contentType },
      body,
      credentials: this.#credentials,
    });
    const response = await this.#fetchImpl(signed.url, {
      method: "PUT",
      headers: signed.headers,
      body,
    });
    if (!response.ok) {
      throw new PlatformStoreError(
        "internal",
        `r2 put '${key}' failed with HTTP ${response.status}`,
        { key, status: response.status },
      );
    }
  }

  async #deleteObject(key: string): Promise<void> {
    const signed = signAwsRequest({
      method: "DELETE",
      url: this.#objectUrl(key),
      credentials: this.#credentials,
    });
    const response = await this.#fetchImpl(signed.url, {
      method: "DELETE",
      headers: signed.headers,
    });
    if (!response.ok && response.status !== 404) {
      throw new PlatformStoreError(
        "internal",
        `r2 delete '${key}' failed with HTTP ${response.status}`,
        { key, status: response.status },
      );
    }
  }

  // -- store API ------------------------------------------------------------

  /**
   * Presigns a SHORT-LIVED GET for a stored segment. This is the ONLY
   * authorized delivery form for private objects — callers MUST have already
   * authorized the requester (the playback route's rights gate) before
   * calling; the presign itself never bypasses that gate.
   */
  presignedGetUrl(
    sessionId: string,
    renderId: string,
    segmentId: string,
    expiresSeconds: number,
  ): string {
    return presignGetUrl({
      url: this.#objectUrl(this.#documentKey(sessionId, renderId, segmentId)),
      credentials: this.#credentials,
      expiresSeconds,
    });
  }

  /** The bucket + endpoint this store is bound to (non-secret, for health). */
  describe(): { provider: "r2"; bucket: string; endpoint: string } {
    return { provider: "r2", bucket: this.#bucket, endpoint: this.#endpoint };
  }

  /**
   * Fetches a URL through the store's own transport seam (the injected
   * `fetchImpl` — the global fetch by default). The playback path uses this
   * to retrieve presigned URLs, so a substituted transport is honored
   * everywhere (tests/proxies) without touching globals.
   */
  async fetchViaTransport(url: string): Promise<Response> {
    return this.#fetchImpl(url);
  }

  async storeSegment(input: HostedStoreSegmentInput): Promise<HostedStoreSegmentOutcome> {
    const { sessionId, renderId } = input;
    const segment = input.segment;
    if (!validScopeId("sessionId", sessionId) || !validScopeId("renderId", renderId)) {
      throw new SegmentValidationError("storeSegment: invalid session/render scope id", {
        sessionId,
        renderId,
      });
    }
    if (!validScopeId("segmentId", segment.segmentId)) {
      throw new SegmentValidationError("storeSegment: invalid segment id", {
        segmentId: segment.segmentId,
      });
    }
    if (typeof segment.content !== "string" || segment.content.length === 0) {
      throw new SegmentValidationError("storeSegment: segment content must be a non-empty string");
    }
    if (typeof segment.contentType !== "string" || segment.contentType.length === 0) {
      throw new SegmentValidationError("storeSegment: contentType is required");
    }
    if (!HEX64.test(segment.contentHash)) {
      throw new SegmentValidationError(
        "storeSegment: contentHash must be 64 lowercase hex digits",
        { contentHash: segment.contentHash },
      );
    }
    const measured = measureUtf8Bytes(segment.content);
    if (segment.byteLength !== measured) {
      throw new SegmentValidationError(
        "storeSegment: byteLength does not match the measured UTF-8 length",
        { declared: segment.byteLength, measured },
      );
    }
    if (segment.byteLength > this.#limits.maxSegmentBytes) {
      throw new SegmentStoreLimitError(
        `segment exceeds the per-segment byte bound (${this.#limits.maxSegmentBytes})`,
        { byteLength: segment.byteLength, maxSegmentBytes: this.#limits.maxSegmentBytes },
      );
    }

    const index = await this.#readIndex(sessionId, renderId);
    const existing = index.entries.find((entry) => entry.segmentId === segment.segmentId);
    if (existing !== undefined) {
      const storedDoc = await this.#requireDocument(sessionId, renderId, existing);
      if (storedDoc.contentHash === segment.contentHash) {
        // R2 free-tier write-storm fix (the W920 final-gate finding): the
        // duplicate path is READ-VERIFY-ONLY. Content-addressed segments are
        // immutable, so re-PUTting the identical document (plus the index,
        // plus the global stats) burned THREE Class A writes per duplicate —
        // fired by every cold-instance dev-seed mirror and every durable
        // reconstruction — and a serverless cold-start burst tripped R2's
        // per-account rate limit (HTTP 429), 500-ing READS of data that was
        // already durable. The integrity check below (recorded hash vs the
        // offered hash) is the whole of the duplicate contract; redundant
        // duplicate-counting writes are gone (in-process duplicate accounting
        // lives in the W504 pipeline store; the durable counters only ever
        // tracked rewrites that must no longer happen).
        return {
          outcome: "duplicate",
          record: documentToRecord(storedDoc),
          duplicateCount: storedDoc.duplicateCount,
        };
      }
      throw new SegmentConflictError(
        sessionId,
        renderId,
        segment.segmentId,
        storedDoc.contentHash,
        segment.contentHash,
      );
    }

    if (index.entries.length + 1 > this.#limits.maxSegments) {
      throw new SegmentStoreLimitError(
        `store is at its segment bound (${this.#limits.maxSegments})`,
        { segments: index.entries.length, maxSegments: this.#limits.maxSegments },
      );
    }
    if (index.totalBytes + segment.byteLength > this.#limits.maxTotalBytes) {
      throw new SegmentStoreLimitError(
        `store is at its total byte bound (${this.#limits.maxTotalBytes})`,
        { totalBytes: index.totalBytes, byteLength: segment.byteLength },
      );
    }

    const document: SegmentDocumentV1 = {
      schema: "sporta.render-output/1",
      sessionId,
      renderId,
      segmentId: segment.segmentId,
      contentType: segment.contentType,
      content: segment.content,
      byteLength: segment.byteLength,
      contentHash: segment.contentHash,
      manifest: structuredClone(segment.manifest),
      storedAtMs: this.#nowMs(),
      storeSequence: index.nextSequence,
      duplicateCount: 0,
    };
    await this.#putJson(this.#documentKey(sessionId, renderId, segment.segmentId), document);
    index.entries.push({
      segmentId: segment.segmentId,
      storeSequence: index.nextSequence,
      byteLength: segment.byteLength,
      contentHash: segment.contentHash,
      contentType: segment.contentType,
    });
    index.nextSequence += 1;
    index.totalBytes += segment.byteLength;
    await this.#writeIndex(sessionId, renderId, index);
    const stats = await this.#readStats();
    stats.segments += 1;
    stats.totalBytes += segment.byteLength;
    await this.#putJson(R2RenderOutputStore.STATS_KEY, stats);
    return { outcome: "stored", record: documentToRecord(document) };
  }

  async getSegment(query: HostedSegmentRetrievalQuery): Promise<HostedStoredRenderSegment | null> {
    assertRights(query);
    if (
      !validScopeId("sessionId", query.sessionId) ||
      !validScopeId("renderId", query.renderId) ||
      !validScopeId("segmentId", query.segmentId)
    ) {
      return null;
    }
    const document = await this.#getJson<SegmentDocumentV1>(
      this.#documentKey(query.sessionId, query.renderId, query.segmentId),
    );
    if (document === null) return null;
    return this.#verifyDocument(document);
  }

  async listSegments(query: HostedSegmentListQuery): Promise<HostedSegmentSummary[]> {
    assertRights(query);
    if (!validScopeId("sessionId", query.sessionId) || !validScopeId("renderId", query.renderId)) {
      return [];
    }
    const index = await this.#readIndex(query.sessionId, query.renderId);
    return index.entries.map((entry) => ({
      segmentId: entry.segmentId,
      contentType: entry.contentType,
      byteLength: entry.byteLength,
      contentHash: entry.contentHash,
    }));
  }

  async deleteSegment(sessionId: string, renderId: string, segmentId: string): Promise<void> {
    if (
      !validScopeId("sessionId", sessionId) ||
      !validScopeId("renderId", renderId) ||
      !validScopeId("segmentId", segmentId)
    ) {
      return; // idempotent no-op, as in W504
    }
    const index = await this.#readIndex(sessionId, renderId);
    const entry = index.entries.find((candidate) => candidate.segmentId === segmentId);
    await this.#deleteObject(this.#documentKey(sessionId, renderId, segmentId));
    if (entry !== undefined) {
      index.entries = index.entries.filter((candidate) => candidate.segmentId !== segmentId);
      index.totalBytes -= entry.byteLength;
      await this.#writeIndex(sessionId, renderId, index);
      const stats = await this.#readStats();
      stats.segments = Math.max(0, stats.segments - 1);
      stats.totalBytes = Math.max(0, stats.totalBytes - entry.byteLength);
      await this.#putJson(R2RenderOutputStore.STATS_KEY, stats);
    }
  }

  async stats(): Promise<HostedSegmentStoreStats> {
    const stats = await this.#readStats();
    return {
      segments: stats.segments,
      totalBytes: stats.totalBytes,
      duplicateStores: stats.duplicateStores,
    };
  }

  // -- internals ------------------------------------------------------------

  async #readIndex(sessionId: string, renderId: string): Promise<ScopeIndexV1> {
    const stored = await this.#getJson<ScopeIndexV1>(this.#indexKey(sessionId, renderId));
    if (stored === null) {
      return {
        schema: "sporta.render-output-index/1",
        sessionId,
        renderId,
        nextSequence: 1,
        duplicateStores: 0,
        totalBytes: 0,
        entries: [],
      };
    }
    return stored;
  }

  async #writeIndex(sessionId: string, renderId: string, index: ScopeIndexV1): Promise<void> {
    await this.#putJson(this.#indexKey(sessionId, renderId), index);
  }

  async #readStats(): Promise<StatsV1> {
    return (await this.#getJson<StatsV1>(R2RenderOutputStore.STATS_KEY)) ?? { ...EMPTY_STATS };
  }

  async #requireDocument(
    sessionId: string,
    renderId: string,
    entry: IndexEntry,
  ): Promise<SegmentDocumentV1> {
    const document = await this.#getJson<SegmentDocumentV1>(
      this.#documentKey(sessionId, renderId, entry.segmentId),
    );
    if (document === null) {
      throw new SegmentIntegrityError(
        `index references segment '${entry.segmentId}' but its document is missing`,
        { sessionId, renderId, segmentId: entry.segmentId },
      );
    }
    return document;
  }

  /** Re-verifies a stored document before handing it out (W004 read-verify). */
  async #verifyDocument(document: SegmentDocumentV1): Promise<HostedStoredRenderSegment> {
    if (document.schema !== "sporta.render-output/1") {
      throw new SegmentIntegrityError("stored document has an unknown schema", {
        schema: document.schema,
      });
    }
    const measured = measureUtf8Bytes(document.content);
    if (document.byteLength !== measured) {
      throw new SegmentIntegrityError("stored document byte length drifted", {
        stored: document.byteLength,
        measured,
      });
    }
    const digest = createHash("sha256").update(document.content, "utf8").digest("hex");
    if (document.contentHash !== digest) {
      throw new SegmentIntegrityError("stored document content hash drifted", {
        stored: document.contentHash,
        computed: digest,
      });
    }
    return documentToRecord(document);
  }
}

function documentToRecord(document: SegmentDocumentV1): HostedStoredRenderSegment {
  return {
    sessionId: document.sessionId,
    renderId: document.renderId,
    segmentId: document.segmentId,
    contentType: document.contentType,
    content: document.content,
    byteLength: document.byteLength,
    contentHash: document.contentHash,
    manifest: structuredClone(document.manifest),
    storedAtMs: document.storedAtMs,
    storeSequence: document.storeSequence,
    duplicateCount: document.duplicateCount,
  };
}
