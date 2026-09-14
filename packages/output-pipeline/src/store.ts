/**
 * The render-output segment store (W504): bounded, rights-gated storage for
 * encoded anime segments, in memory and on `bun:sqlite`.
 *
 * W004 repository patterns, followed exactly:
 *
 * - a port interface (`RenderSegmentStore`) + two implementations
 *   (`InMemoryRenderSegmentStore` for tests/ephemeral runs,
 *   `SqliteRenderSegmentStore` for durable storage; DDL applied
 *   idempotently; constructor takes a file path or an open `Database`;
 *   `close()` is idempotent);
 * - validation on write AND on read (stored documents are re-verified —
 *   content hash, byte length, manifest shape — and a corrupted row fails
 *   loudly with `SegmentIntegrityError`, never partial data);
 * - deep-clone-on-read (callers can never mutate stored state through
 *   handed-out references) and clone-on-write (mutating the input after
 *   `storeSegment` never leaks in);
 * - idempotency with conflict semantics: the same
 *   `(sessionId, renderId, segmentId)` with the SAME content is a no-op
 *   duplicate that is COUNTED; with DIFFERENT content it is a fail-loud
 *   `SegmentConflictError` (stored output is never silently replaced);
 * - NUL-free scope ids: the in-memory composite key is `\u0000`-separated,
 *   so a NUL inside any id would make the key AMBIGUOUS (one scope's crafted
 *   triple could read or delete another scope's record). Such ids are
 *   rejected loudly on every path (write, read, delete) — the key space is
 *   unambiguous BY VALIDATION, not by trusting callers.
 *
 * Deviation from the W004 precedent, deliberate: the repository stamps
 * wall-clock `Date.now()` into sqlite rows; this store takes an INJECTED
 * clock (deterministic `TEST_EPOCH_MS + ticks` default — the repo's
 * determinism constitution) so stored timestamps are reproducible.
 *
 * Fail-closed rights (the W701 posture): every retrieval re-derives the
 * capabilities from the CALLER-SUPPLIED authorization policy at the
 * evaluation time; without `canStoreDerivatives` the call throws
 * `PlaybackRightsDeniedError` BEFORE revealing whether anything exists.
 * Never partial data.
 *
 * Bounded size: `limits` (segment count, per-segment bytes, total bytes) are
 * enforced with an explicit `SegmentStoreLimitError` reject — the store
 * never silently evicts and never grows unbounded silently.
 */
import { AuthorizationPolicy, deriveRightsCapabilities } from "@sporta/contracts";
import type { AuthorizationPolicy as AuthorizationPolicyDoc } from "@sporta/contracts";
import { Database } from "bun:sqlite";
import { TEST_EPOCH_MS } from "@sporta/testing";
import {
  PlaybackRightsDeniedError,
  SegmentConflictError,
  SegmentIntegrityError,
  SegmentStoreLimitError,
  SegmentValidationError,
} from "./errors";
import { contentHashOf } from "./encode";
import type {
  PlaybackRightsContext,
  RenderSegmentStore,
  RenderSegmentStoreLimits,
  RenderSegmentStoreStats,
  SegmentListQuery,
  SegmentRetrievalQuery,
  StoreSegmentInput,
  StoreSegmentOutcome,
  StoredRenderSegment,
  StoredRenderSegmentSummary,
} from "./types";
import type { AnimeSegmentManifest } from "./types";

/** Module-level encoder (pure, deterministic). */
const textEncoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Options, limits, clock
// ---------------------------------------------------------------------------

/** Options for both store implementations. */
export interface RenderSegmentStoreOptions {
  /**
   * Size bounds. Exceeding any bound REJECTS the write with
   * `SegmentStoreLimitError` — never silent eviction. Defaults:
   * {@link DEFAULT_STORE_LIMITS}.
   */
  limits?: Partial<RenderSegmentStoreLimits>;
  /**
   * Clock in epoch milliseconds (default: deterministic per-store counter
   * `TEST_EPOCH_MS + ticks`). Production callers MUST inject a real wall
   * clock; the deterministic default keeps unseeded runs reproducible
   * (docs/testing/HARNESS.md).
   */
  nowMs?: () => number;
}

/**
 * The default store bounds: 1000 segments, 16 MiB per segment, 256 MiB
 * total. Bounded by default — a store never grows unbounded silently.
 */
export const DEFAULT_STORE_LIMITS: RenderSegmentStoreLimits = {
  maxSegments: 1_000,
  maxSegmentBytes: 16 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
};

/** Merges partial limits onto the defaults. */
export function resolveStoreLimits(
  limits?: Partial<RenderSegmentStoreLimits>,
): RenderSegmentStoreLimits {
  return { ...DEFAULT_STORE_LIMITS, ...limits };
}

/** Deterministic per-store clock: `TEST_EPOCH_MS + ticks`. */
function createDeterministicStoreClock(): () => number {
  let ticks = 0;
  return (): number => TEST_EPOCH_MS + (ticks += 1);
}

// ---------------------------------------------------------------------------
// Structural helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): string {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length < 1) {
    throw new SegmentValidationError(
      `${field} must be a non-empty string (got ${describeValue(value)})`,
      { field },
    );
  }
  return value;
}

/**
 * Store scope ids must be NUL-free: the in-memory composite key is
 * `\u0000`-separated, so a NUL inside an id would make the key AMBIGUOUS (a
 * crafted `(sessionId, renderId, segmentId)` triple could address a record
 * stored under a DIFFERENT triple — reading or even deleting another scope's
 * output). The store rejects such ids LOUDLY on every path (write, read,
 * delete) instead of trusting callers to send "text ids".
 */
function requireScopeId(value: unknown, field: string): string {
  const id = requireNonEmptyString(value, field);
  if (id.includes("\u0000")) {
    throw new SegmentValidationError(
      `${field} must not contain the NUL character (U+0000): the composite store key is NUL-separated, so a NUL inside an id would make the key ambiguous (got ${JSON.stringify(id)})`,
      { field },
    );
  }
  return id;
}

/**
 * Validates retrieval/listing/delete scope ids (NUL-free, non-empty). Runs
 * AFTER the fail-closed rights gate on the read paths (rights before
 * validation errors — the pipeline's `locateAnimeRef` ordering).
 */
function requireQueryScope(query: { sessionId: unknown; renderId: unknown }): void {
  requireScopeId(query.sessionId, "query.sessionId");
  requireScopeId(query.renderId, "query.renderId");
}

/** The composite store key (NUL-separated; unambiguous — ids are NUL-free by validation). */
function storeKey(sessionId: string, renderId: string, segmentId: string): string {
  return `${sessionId}\u0000${renderId}\u0000${segmentId}`;
}

/** Deep clone of a stored record (callers never hold store-internal state). */
function cloneRecord(record: StoredRenderSegment): StoredRenderSegment {
  return structuredClone(record);
}

// ---------------------------------------------------------------------------
// Manifest shape validation (store-side, JSON-space)
// ---------------------------------------------------------------------------

/**
 * Structural validation of a container manifest value (the sqlite
 * round-trip and the store-input path). Result union, so callers classify
 * the failure themselves: a malformed INPUT is a `media-invalid` validation
 * error; a malformed STORED ROW is an `internal` integrity error.
 */
export function parseAnimeSegmentManifest(
  value: unknown,
): { ok: true; value: AnimeSegmentManifest } | { ok: false; reason: string } {
  if (!isRecord(value)) return { ok: false, reason: "manifest must be an object" };
  const format = value.format;
  if (!isRecord(format)) return { ok: false, reason: "manifest.format must be an object" };
  if (format.kind !== "animated-svg") {
    return { ok: false, reason: `manifest.format.kind must be "animated-svg"` };
  }
  if (format.version !== 1) return { ok: false, reason: "manifest.format.version must be 1" };
  const segmentId = value.segmentId;
  if (typeof segmentId !== "string" || segmentId.length < 1) {
    return { ok: false, reason: "manifest.segmentId must be a non-empty string" };
  }
  const sessionId = value.sessionId;
  if (typeof sessionId !== "string" || sessionId.length < 1) {
    return { ok: false, reason: "manifest.sessionId must be a non-empty string" };
  }
  const frameCount = value.frameCount;
  if (typeof frameCount !== "number" || !Number.isInteger(frameCount) || frameCount < 1) {
    return { ok: false, reason: "manifest.frameCount must be an integer >= 1" };
  }
  const totalDurationMs = value.totalDurationMs;
  if (
    typeof totalDurationMs !== "number" ||
    !Number.isFinite(totalDurationMs) ||
    totalDurationMs < 1
  ) {
    return { ok: false, reason: "manifest.totalDurationMs must be a finite number >= 1" };
  }
  const contentHash = value.contentHash;
  if (typeof contentHash !== "string" || !/^[0-9a-f]{64}$/.test(contentHash)) {
    return { ok: false, reason: "manifest.contentHash must be 64 lowercase hex digits (sha-256)" };
  }
  const frames = value.frames;
  if (!Array.isArray(frames) || frames.length !== frameCount) {
    return { ok: false, reason: "manifest.frames must be an array of length frameCount" };
  }
  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i]!;
    if (!isRecord(frame)) return { ok: false, reason: `manifest.frames[${i}] must be an object` };
    if (frame.frameIndex !== i) {
      return { ok: false, reason: `manifest.frames[${i}].frameIndex must be ${i}` };
    }
    const outputTimestampMs = frame.outputTimestampMs;
    const beginMs = frame.beginMs;
    for (const [field, entry] of [
      ["outputTimestampMs", outputTimestampMs],
      ["beginMs", beginMs],
    ] as const) {
      if (typeof entry !== "number" || !Number.isFinite(entry) || entry < 0) {
        return { ok: false, reason: `manifest.frames[${i}].${field} must be a finite number >= 0` };
      }
    }
    const durMs = frame.durMs;
    if (typeof durMs !== "number" || !Number.isFinite(durMs) || durMs <= 0) {
      return { ok: false, reason: `manifest.frames[${i}].durMs must be a finite number > 0` };
    }
  }
  if (!isRecord(value.sourceManifest)) {
    return {
      ok: false,
      reason: "manifest.sourceManifest must be an object (the W502 render manifest)",
    };
  }
  // The W502 manifest is carried VERBATIM: shape-checked as a record only
  // (its per-frame accounting is the renderer's contract, re-validated by
  // the encoder on the render path).
  return { ok: true, value: value as unknown as AnimeSegmentManifest };
}

// ---------------------------------------------------------------------------
// Fail-closed rights gate (the W701 posture)
// ---------------------------------------------------------------------------

/**
 * Fail-closed playback-rights derivation. The caller-supplied policy is the
 * trust boundary (W701: no user authentication yet); capabilities are
 * re-derived at `query.nowMs` and retrieval requires
 * `canStoreDerivatives === true`. A missing/malformed/expired/insufficient
 * decision denies BEFORE anything is revealed — never partial data.
 *
 * The evaluation time itself is guarded FIRST: it must be a FINITE
 * epoch-milliseconds number. A non-finite value (`NaN`, `±Infinity`, or a
 * non-number) makes every expiry comparison vacuously false (`x <= NaN` is
 * always false), which would let an EXPIRED policy pass this gate and serve
 * protected bytes — a fail-open hole (found and fixed in the inherited-work
 * audit; pinned by the invalid-now tests). Fail closed instead.
 *
 * Exported for the pipeline (`./pipeline.ts`), whose `locateAnimeRef` gates
 * on the SAME fail-closed posture before revealing any artifact.
 */
export function assertPlaybackRights(query: PlaybackRightsContext & { sessionId: string }): void {
  if (typeof query.nowMs !== "number" || !Number.isFinite(query.nowMs)) {
    throw new PlaybackRightsDeniedError(
      `playback rights denied: the evaluation time must be a finite epoch-milliseconds number (got ${describeValue(query.nowMs)})`,
      { sessionId: query.sessionId, reason: "invalid-now" },
    );
  }
  const policyCheck = AuthorizationPolicy.safeParse(query.policy);
  if (!policyCheck.success) {
    throw new PlaybackRightsDeniedError(
      `playback rights denied: the caller-supplied authorization policy is not a valid AuthorizationPolicy`,
      { sessionId: query.sessionId, reason: "invalid-policy" },
    );
  }
  const policy: AuthorizationPolicyDoc = policyCheck.data;
  const capabilities = deriveRightsCapabilities(policy, new Date(query.nowMs));
  if (capabilities.canStoreDerivatives !== true) {
    const expired =
      policy.expiresAtIso !== undefined && Date.parse(policy.expiresAtIso) <= query.nowMs;
    throw new PlaybackRightsDeniedError(
      expired
        ? `playback rights denied (expired-policy): policy '${policy.policyId}' is not currently in force`
        : `playback rights denied: policy '${policy.policyId}' does not grant canStoreDerivatives (derivativeGeneration + storage)`,
      {
        sessionId: query.sessionId,
        policyId: policy.policyId,
        reason: expired ? "expired-policy" : "insufficient-policy",
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Store-input validation + integrity verification
// ---------------------------------------------------------------------------

/** The validated fields of a `storeSegment` input. */
interface ValidatedStoreInput {
  sessionId: string;
  renderId: string;
  segment: {
    segmentId: string;
    contentType: string;
    content: string;
    byteLength: number;
    contentHash: string;
    manifest: AnimeSegmentManifest;
  };
}

/**
 * Validates a `storeSegment` input fail-loud (never a partial store):
 * non-empty ids, a structurally valid manifest, and — critically — the
 * content hash and byte length are RECOMPUTED from the content and must
 * match the declared values (a lying segment document is rejected, not
 * stored). The manifest's segment id, content hash, and session scope must
 * agree with the segment and the store scope.
 */
function validateStoreInput(input: unknown): ValidatedStoreInput {
  if (!isRecord(input)) {
    throw new SegmentValidationError("storeSegment input must be an object", {});
  }
  const sessionId = requireScopeId(input.sessionId, "input.sessionId");
  const renderId = requireScopeId(input.renderId, "input.renderId");
  const segment = input.segment;
  if (!isRecord(segment)) {
    throw new SegmentValidationError("input.segment must be an object", {});
  }
  const segmentId = requireScopeId(segment.segmentId, "segment.segmentId");
  const contentType = requireNonEmptyString(segment.contentType, "segment.contentType");
  const content = requireNonEmptyString(segment.content, "segment.content");
  const manifestCheck = parseAnimeSegmentManifest(segment.manifest);
  if (!manifestCheck.ok) {
    throw new SegmentValidationError(`segment.manifest is invalid: ${manifestCheck.reason}`, {
      reason: manifestCheck.reason,
    });
  }
  const manifest = manifestCheck.value;
  if (manifest.segmentId !== segmentId) {
    throw new SegmentValidationError(
      `segment.manifest.segmentId ("${manifest.segmentId}") must equal segment.segmentId ("${segmentId}")`,
      { segmentId, manifestSegmentId: manifest.segmentId },
    );
  }
  if (manifest.sessionId !== sessionId) {
    throw new SegmentValidationError(
      `segment.manifest.sessionId ("${manifest.sessionId}") must equal the store scope sessionId ("${sessionId}") — the segment belongs to another session`,
      { sessionId, manifestSessionId: manifest.sessionId },
    );
  }
  const recomputedHash = contentHashOf(content);
  const recomputedBytes = textEncoder.encode(content).length;
  const declaredHash = segment.contentHash;
  if (typeof declaredHash !== "string" || declaredHash !== recomputedHash) {
    throw new SegmentValidationError(
      `segment.contentHash must be the sha-256 of segment.content ("${recomputedHash}"; got ${describeValue(declaredHash)})`,
      { recomputedContentHash: recomputedHash },
    );
  }
  const declaredBytes = segment.byteLength;
  if (typeof declaredBytes !== "number" || declaredBytes !== recomputedBytes) {
    throw new SegmentValidationError(
      `segment.byteLength must be the UTF-8 byte length of segment.content (${recomputedBytes}; got ${describeValue(declaredBytes)})`,
      { recomputedByteLength: recomputedBytes },
    );
  }
  if (manifest.contentHash !== recomputedHash) {
    throw new SegmentValidationError(
      `segment.manifest.contentHash ("${manifest.contentHash}") must equal the recomputed content hash ("${recomputedHash}")`,
      { recomputedContentHash: recomputedHash },
    );
  }
  return {
    sessionId,
    renderId,
    segment: {
      segmentId,
      contentType,
      content,
      byteLength: recomputedBytes,
      contentHash: recomputedHash,
      manifest,
    },
  };
}

/**
 * Read-side integrity verification: the hash and byte length are recomputed
 * from the stored content and must match both the stored columns and the
 * container manifest. Corrupted rows fail loudly — never partial data.
 */
function verifySegmentIntegrity(record: {
  sessionId: string;
  renderId: string;
  segmentId: string;
  content: string;
  byteLength: number;
  contentHash: string;
  manifest: AnimeSegmentManifest;
}): void {
  const recomputedHash = contentHashOf(record.content);
  const recomputedBytes = textEncoder.encode(record.content).length;
  if (record.contentHash !== recomputedHash) {
    throw new SegmentIntegrityError(
      `stored segment '${record.segmentId}' (render '${record.renderId}', session '${record.sessionId}') failed integrity verification: content hash drift`,
      { sessionId: record.sessionId, renderId: record.renderId, segmentId: record.segmentId },
    );
  }
  if (record.manifest.contentHash !== recomputedHash) {
    throw new SegmentIntegrityError(
      `stored segment '${record.segmentId}' (render '${record.renderId}', session '${record.sessionId}') failed integrity verification: manifest content hash drift`,
      { sessionId: record.sessionId, renderId: record.renderId, segmentId: record.segmentId },
    );
  }
  if (record.byteLength !== recomputedBytes) {
    throw new SegmentIntegrityError(
      `stored segment '${record.segmentId}' (render '${record.renderId}', session '${record.sessionId}') failed integrity verification: byte length drift`,
      { sessionId: record.sessionId, renderId: record.renderId, segmentId: record.segmentId },
    );
  }
}

// ---------------------------------------------------------------------------
// Limit enforcement (explicit reject, never silent eviction)
// ---------------------------------------------------------------------------

function enforceStoreLimits(
  limits: RenderSegmentStoreLimits,
  usage: { segmentBytes: number; segmentsAfterStore: number; totalBytesAfterStore: number },
  scope: { sessionId: string; renderId: string; segmentId: string },
): void {
  if (usage.segmentBytes > limits.maxSegmentBytes) {
    throw new SegmentStoreLimitError(
      `segment '${scope.segmentId}' is ${usage.segmentBytes} bytes, above the per-segment limit ${limits.maxSegmentBytes} (rejected; nothing was evicted)`,
      { ...scope, limit: "maxSegmentBytes", segmentBytes: usage.segmentBytes },
    );
  }
  if (usage.totalBytesAfterStore > limits.maxTotalBytes) {
    throw new SegmentStoreLimitError(
      `storing segment '${scope.segmentId}' would raise the store to ${usage.totalBytesAfterStore} bytes, above the total limit ${limits.maxTotalBytes} (rejected; nothing was evicted)`,
      { ...scope, limit: "maxTotalBytes", totalBytesAfterStore: usage.totalBytesAfterStore },
    );
  }
  if (usage.segmentsAfterStore > limits.maxSegments) {
    throw new SegmentStoreLimitError(
      `storing segment '${scope.segmentId}' would raise the store to ${usage.segmentsAfterStore} segments, above the count limit ${limits.maxSegments} (rejected; nothing was evicted)`,
      { ...scope, limit: "maxSegments", segmentsAfterStore: usage.segmentsAfterStore },
    );
  }
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

/**
 * Process-local `RenderSegmentStore`. Stores deep clones and hands out deep
 * clones: mutating a returned record never affects the store, and mutating
 * the store input after `storeSegment` never affects what was stored.
 */
export class InMemoryRenderSegmentStore implements RenderSegmentStore {
  private readonly segments = new Map<string, StoredRenderSegment>();
  private readonly limits: RenderSegmentStoreLimits;
  private readonly nowMs: () => number;
  private nextSequence = 1;
  private totalBytes = 0;
  private duplicateStores = 0;

  constructor(options: RenderSegmentStoreOptions = {}) {
    this.limits = resolveStoreLimits(options.limits);
    this.nowMs = options.nowMs ?? createDeterministicStoreClock();
  }

  storeSegment(input: StoreSegmentInput): StoreSegmentOutcome {
    const validated = validateStoreInput(input);
    const { sessionId, renderId } = validated;
    const { segmentId, contentType, content, byteLength, contentHash, manifest } =
      validated.segment;
    const key = storeKey(sessionId, renderId, segmentId);
    const existing = this.segments.get(key);
    if (existing !== undefined) {
      if (existing.content === content) {
        // Idempotent no-op duplicate — COUNTED, never re-stored.
        existing.duplicateCount += 1;
        this.duplicateStores += 1;
        return {
          outcome: "duplicate",
          record: cloneRecord(existing),
          duplicateCount: existing.duplicateCount,
        };
      }
      throw new SegmentConflictError(
        sessionId,
        renderId,
        segmentId,
        existing.contentHash,
        contentHash,
      );
    }
    enforceStoreLimits(
      this.limits,
      {
        segmentBytes: byteLength,
        segmentsAfterStore: this.segments.size + 1,
        totalBytesAfterStore: this.totalBytes + byteLength,
      },
      { sessionId, renderId, segmentId },
    );
    const record: StoredRenderSegment = {
      sessionId,
      renderId,
      segmentId,
      contentType,
      content,
      byteLength,
      contentHash,
      manifest: structuredClone(manifest),
      storedAtMs: this.nowMs(),
      storeSequence: this.nextSequence,
      duplicateCount: 0,
    };
    this.nextSequence += 1;
    this.segments.set(key, record);
    this.totalBytes += byteLength;
    return { outcome: "stored", record: cloneRecord(record) };
  }

  getSegment(query: SegmentRetrievalQuery): StoredRenderSegment | null {
    assertPlaybackRights(query);
    requireQueryScope(query);
    requireScopeId(query.segmentId, "query.segmentId");
    const stored = this.segments.get(storeKey(query.sessionId, query.renderId, query.segmentId));
    if (stored === undefined) return null;
    const record = cloneRecord(stored);
    verifySegmentIntegrity(record);
    return record;
  }

  listSegments(query: SegmentListQuery): StoredRenderSegmentSummary[] {
    assertPlaybackRights(query);
    requireQueryScope(query);
    const matches: StoredRenderSegment[] = [];
    for (const record of this.segments.values()) {
      if (record.sessionId === query.sessionId && record.renderId === query.renderId) {
        matches.push(record);
      }
    }
    // Insertion order (store_sequence), like the sqlite implementation.
    matches.sort((a, b) => a.storeSequence - b.storeSequence);
    return matches.map((record) => ({
      segmentId: record.segmentId,
      contentType: record.contentType,
      byteLength: record.byteLength,
      contentHash: record.contentHash,
    }));
  }

  deleteSegment(sessionId: string, renderId: string, segmentId: string): void {
    // Scope ids are validated first: a NUL-ambiguous key must never delete
    // another scope's record (host-side maintenance op — no rights context,
    // same as the write path).
    requireScopeId(sessionId, "sessionId");
    requireScopeId(renderId, "renderId");
    requireScopeId(segmentId, "segmentId");
    const key = storeKey(sessionId, renderId, segmentId);
    const stored = this.segments.get(key);
    if (stored !== undefined) {
      this.segments.delete(key);
      this.totalBytes -= stored.byteLength;
    }
  }

  stats(): RenderSegmentStoreStats {
    return {
      segments: this.segments.size,
      totalBytes: this.totalBytes,
      duplicateStores: this.duplicateStores,
    };
  }
}

// ---------------------------------------------------------------------------
// bun:sqlite implementation
// ---------------------------------------------------------------------------

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS render_output_segments (
    session_id TEXT NOT NULL,
    render_id TEXT NOT NULL,
    segment_id TEXT NOT NULL,
    content_type TEXT NOT NULL,
    content TEXT NOT NULL,
    byte_length INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    stored_at_ms INTEGER NOT NULL,
    store_sequence INTEGER NOT NULL,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, render_id, segment_id)
  )
`;

const CREATE_RENDER_INDEX_SQL =
  "CREATE INDEX IF NOT EXISTS render_output_segments_render_idx ON render_output_segments (session_id, render_id, store_sequence)";

/** One stored row (raw column values). */
interface SegmentRow {
  session_id: string;
  render_id: string;
  segment_id: string;
  content_type: string;
  content: string;
  byte_length: number;
  content_hash: string;
  manifest_json: string;
  stored_at_ms: number;
  store_sequence: number;
  duplicate_count: number;
}

/**
 * Durable `RenderSegmentStore` on `bun:sqlite` (built-in; no new
 * dependency).
 *
 * Schema: `render_output_segments (session_id, render_id, segment_id TEXT
 * composite PRIMARY KEY, content_type, content, byte_length INTEGER,
 * content_hash, manifest_json, stored_at_ms INTEGER, store_sequence INTEGER,
 * duplicate_count INTEGER)` plus an index for the per-render listing.
 * `manifest_json` holds the full deterministic container manifest;
 * `duplicate_count` persists the counted no-op duplicates; `store_sequence`
 * is assigned from `MAX(store_sequence)` at construction, so insertion
 * order is stable across close/reopen. Writes validate the input; reads
 * re-verify integrity (hash, byte length, manifest shape) and fail loudly
 * with {@link SegmentIntegrityError} on drift.
 */
export class SqliteRenderSegmentStore implements RenderSegmentStore {
  private readonly db: Database;
  private closed = false;
  private readonly limits: RenderSegmentStoreLimits;
  private readonly nowMs: () => number;
  private nextSequence: number;

  private readonly stmtInsert: ReturnType<Database["query"]>;
  private readonly stmtGet: ReturnType<Database["query"]>;
  private readonly stmtList: ReturnType<Database["query"]>;
  private readonly stmtDelete: ReturnType<Database["query"]>;
  private readonly stmtBumpDuplicate: ReturnType<Database["query"]>;

  /**
   * @param dbOrPath file path to a sqlite database (created if absent) or an
   *   open `bun:sqlite` `Database` instance. DDL is applied idempotently.
   *   `.close()` closes the underlying connection — do not close while other
   *   users of a shared instance still need it.
   */
  constructor(dbOrPath: string | Database, options: RenderSegmentStoreOptions = {}) {
    this.db = typeof dbOrPath === "string" ? new Database(dbOrPath) : dbOrPath;
    this.db.run(CREATE_TABLE_SQL);
    this.db.run(CREATE_RENDER_INDEX_SQL);
    this.limits = resolveStoreLimits(options.limits);
    this.nowMs = options.nowMs ?? createDeterministicStoreClock();
    const stats = this.db
      .query(
        "SELECT COUNT(*) AS segments, COALESCE(SUM(byte_length), 0) AS total_bytes, COALESCE(SUM(duplicate_count), 0) AS duplicates, COALESCE(MAX(store_sequence), 0) AS max_sequence FROM render_output_segments",
      )
      .get() as { segments: number; total_bytes: number; duplicates: number; max_sequence: number };
    this.nextSequence = stats.max_sequence + 1;
    this.stmtInsert = this.db.query(
      "INSERT INTO render_output_segments (session_id, render_id, segment_id, content_type, content, byte_length, content_hash, manifest_json, stored_at_ms, store_sequence, duplicate_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
    );
    this.stmtGet = this.db.query(
      "SELECT session_id, render_id, segment_id, content_type, content, byte_length, content_hash, manifest_json, stored_at_ms, store_sequence, duplicate_count FROM render_output_segments WHERE session_id = ? AND render_id = ? AND segment_id = ?",
    );
    this.stmtList = this.db.query(
      "SELECT segment_id, content_type, byte_length, content_hash FROM render_output_segments WHERE session_id = ? AND render_id = ? ORDER BY store_sequence ASC",
    );
    this.stmtDelete = this.db.query(
      "DELETE FROM render_output_segments WHERE session_id = ? AND render_id = ? AND segment_id = ?",
    );
    this.stmtBumpDuplicate = this.db.query(
      "UPDATE render_output_segments SET duplicate_count = duplicate_count + 1 WHERE session_id = ? AND render_id = ? AND segment_id = ?",
    );
  }

  storeSegment(input: StoreSegmentInput): StoreSegmentOutcome {
    this.assertOpen();
    const validated = validateStoreInput(input);
    const { sessionId, renderId } = validated;
    const { segmentId, contentType, content, byteLength, contentHash, manifest } =
      validated.segment;
    const existing = this.stmtGet.get(sessionId, renderId, segmentId) as SegmentRow | null;
    if (existing !== null) {
      if (existing.content === content) {
        // Idempotent no-op duplicate — COUNTED (persisted), never re-stored.
        this.stmtBumpDuplicate.run(sessionId, renderId, segmentId);
        return {
          outcome: "duplicate",
          record: this.rowToRecord({ ...existing, duplicate_count: existing.duplicate_count + 1 }),
          duplicateCount: existing.duplicate_count + 1,
        };
      }
      throw new SegmentConflictError(
        sessionId,
        renderId,
        segmentId,
        existing.content_hash,
        contentHash,
      );
    }
    const stats = this.liveStats();
    enforceStoreLimits(
      this.limits,
      {
        segmentBytes: byteLength,
        segmentsAfterStore: stats.segments + 1,
        totalBytesAfterStore: stats.totalBytes + byteLength,
      },
      { sessionId, renderId, segmentId },
    );
    const storedAtMs = this.nowMs();
    const storeSequence = this.nextSequence;
    this.nextSequence += 1;
    this.stmtInsert.run(
      sessionId,
      renderId,
      segmentId,
      contentType,
      content,
      byteLength,
      contentHash,
      JSON.stringify(manifest),
      storedAtMs,
      storeSequence,
    );
    return {
      outcome: "stored",
      record: {
        sessionId,
        renderId,
        segmentId,
        contentType,
        content,
        byteLength,
        contentHash,
        manifest: structuredClone(manifest),
        storedAtMs,
        storeSequence,
        duplicateCount: 0,
      },
    };
  }

  getSegment(query: SegmentRetrievalQuery): StoredRenderSegment | null {
    this.assertOpen();
    assertPlaybackRights(query);
    requireQueryScope(query);
    requireScopeId(query.segmentId, "query.segmentId");
    const row = this.stmtGet.get(
      query.sessionId,
      query.renderId,
      query.segmentId,
    ) as SegmentRow | null;
    if (row === null) return null;
    return this.rowToRecord(row);
  }

  listSegments(query: SegmentListQuery): StoredRenderSegmentSummary[] {
    this.assertOpen();
    assertPlaybackRights(query);
    requireQueryScope(query);
    const rows = this.stmtList.all(query.sessionId, query.renderId) as Array<{
      segment_id: string;
      content_type: string;
      byte_length: number;
      content_hash: string;
    }>;
    return rows.map((row) => ({
      segmentId: row.segment_id,
      contentType: row.content_type,
      byteLength: row.byte_length,
      contentHash: row.content_hash,
    }));
  }

  deleteSegment(sessionId: string, renderId: string, segmentId: string): void {
    this.assertOpen();
    // Scope ids are validated first (uniform port contract with the
    // in-memory backend, even though the composite PRIMARY KEY columns make
    // sqlite itself immune to the NUL ambiguity).
    requireScopeId(sessionId, "sessionId");
    requireScopeId(renderId, "renderId");
    requireScopeId(segmentId, "segmentId");
    this.stmtDelete.run(sessionId, renderId, segmentId);
  }

  stats(): RenderSegmentStoreStats {
    this.assertOpen();
    return this.liveStats();
  }

  /** Closes the underlying sqlite connection. Idempotent. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  private liveStats(): RenderSegmentStoreStats {
    const row = this.db
      .query(
        "SELECT COUNT(*) AS segments, COALESCE(SUM(byte_length), 0) AS total_bytes, COALESCE(SUM(duplicate_count), 0) AS duplicates FROM render_output_segments",
      )
      .get() as { segments: number; total_bytes: number; duplicates: number };
    return { segments: row.segments, totalBytes: row.total_bytes, duplicateStores: row.duplicates };
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("SqliteRenderSegmentStore is closed");
    }
  }

  /** Row → record: parse the manifest, verify integrity, deep-clone. */
  private rowToRecord(row: SegmentRow): StoredRenderSegment {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.manifest_json);
    } catch (err) {
      throw new SegmentIntegrityError(
        `stored segment '${row.segment_id}' (render '${row.render_id}', session '${row.session_id}') has an unparsable manifest`,
        { sessionId: row.session_id, renderId: row.render_id, segmentId: row.segment_id },
        { cause: err },
      );
    }
    const manifestCheck = parseAnimeSegmentManifest(parsed);
    if (!manifestCheck.ok) {
      throw new SegmentIntegrityError(
        `stored segment '${row.segment_id}' (render '${row.render_id}', session '${row.session_id}') has an invalid manifest: ${manifestCheck.reason}`,
        {
          sessionId: row.session_id,
          renderId: row.render_id,
          segmentId: row.segment_id,
          reason: manifestCheck.reason,
        },
      );
    }
    const record: StoredRenderSegment = {
      sessionId: row.session_id,
      renderId: row.render_id,
      segmentId: row.segment_id,
      contentType: row.content_type,
      content: row.content,
      byteLength: row.byte_length,
      contentHash: row.content_hash,
      manifest: structuredClone(manifestCheck.value),
      storedAtMs: row.stored_at_ms,
      storeSequence: row.store_sequence,
      duplicateCount: row.duplicate_count,
    };
    verifySegmentIntegrity(record);
    return record;
  }
}
