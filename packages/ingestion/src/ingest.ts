/**
 * `ingestSource` — the validation-level ingestion boundary (W101).
 *
 * Pipeline per the work-item spec, STRICTLY in this order:
 *
 * 1. **Rights gate, fail closed** (architecture-lock §11): the source is
 *    rejected unless a currently-valid authorization policy explicitly allows
 *    `analysis`. The gate runs BEFORE the size and container checks so an
 *    unauthorized caller learns nothing about the media (not even its size or
 *    container). A missing or expired policy decision DENIES — engineering
 *    must never assume transformation by itself clears rights.
 * 2. **Size bound** (architecture-lock §13): `byteLength > policy.maxBytes`
 *    rejects with a `resource-limit` failure.
 * 3. **Container allowlist**: magic-byte sniffing only — no decoder, no
 *    demuxer (that is W102). Anything unknown or off-list rejects with
 *    `media-invalid`.
 * 4. **Receipt**: sha-256 checksum (Bun built-in hasher, zero dependencies),
 *    a deterministic `src-<12 hex>` source id, and idempotent registration.
 *
 * Idempotency (streaming contract: "Duplicate messages are tolerated through
 * idempotency keys"): a {@link SourceRegistry} maps checksum → receipt, so
 * re-ingesting identical bytes returns the SAME receipt — no duplicate source
 * is created.
 *
 * Observability (architecture-lock §12): each decision path emits exactly one
 * structured log line (info on accept, warn on reject) carrying the
 * correlation context and stage `"ingestion"`, and bumps metrics counters
 * (`ingest_accepted`, `ingest_rejected_total` plus a per-failure-class
 * labeled series). Callers that provide no observability objects get silent
 * no-op defaults ({@link noopObservability}).
 */
import type { AuthorizationPolicy, SourceMediaKind } from "@sporta/contracts";
import { bindLogger, createLogger, MetricsRegistry } from "@sporta/observability";
import type { CorrelationContext, Logger } from "@sporta/observability";
import { assertAuthorized, RightsDeniedError as SessionRightsDeniedError } from "@sporta/session";
import { sniffContainer } from "./container";
import type { Container } from "./container";
import { DEFAULT_INGESTION_POLICY } from "./policy";
import type { IngestionPolicy } from "./policy";
import {
  isIngestionError,
  ResourceLimitError,
  RightsDeniedError,
  UnsupportedMediaError,
} from "./errors";

/** Log/metric stage name for every record emitted by this boundary. */
const INGESTION_STAGE = "ingestion";

/** Length of the checksum hex prefix used to build `sourceId`. */
const SOURCE_ID_HEX_PREFIX = 12;

/** Metric names emitted by the ingestion boundary (see METRIC_NAMES pattern). */
export const INGESTION_METRIC_NAMES = {
  /** Counter bumped once per accepted source (idempotent duplicates included). */
  accepted: "ingest_accepted",
  /** Counter bumped once per rejected source. */
  rejectedTotal: "ingest_rejected_total",
} as const;

/** Label key carrying the terminal failure class on rejection counters. */
const FAILURE_CLASS_LABEL = "failure_class";

/** Receipt returned for one ingested (or re-ingested) source. */
export interface IngestionReceipt {
  /** Session the source was ingested into. */
  sessionId: string;
  /** Deterministic id: `"src-" + <12 hex of the sha-256 checksum>`. */
  sourceId: string;
  /** Full lowercase-hex sha-256 checksum of the accepted bytes. */
  checksum: string;
  /** Sniffed container family. */
  container: Container;
  /** Size of the accepted bytes. */
  byteLength: number;
  /** Ingestion time (epoch ms) — injected via {@link IngestionSourceInput.nowMs}. */
  ingestedAtMs: number;
  /** Whether the source is a file upload or a live stream. */
  sourceKind: SourceMediaKind;
  /** Optional original filename (files only; never trusted as content). */
  filename?: string;
}

/** Observability seams for one ingestion call; every field is optional. */
export interface IngestionObservability {
  /** Structured logger from `@sporta/observability` (default: silent no-op). */
  logger?: Logger;
  /** Metrics registry (default: private silent registry). */
  metrics?: MetricsRegistry;
  /** Correlation context bound onto every log line when provided. */
  correlation?: CorrelationContext;
}

/**
 * Constructs the silent no-op observability defaults used when a caller
 * provides none: a logger that emits nothing (level filter above info/warn,
 * no-op sink) and a fresh in-memory metrics registry nobody reads. Fresh per
 * call, so no state leaks between ingestions.
 */
export function noopObservability(): { logger: Logger; metrics: MetricsRegistry } {
  return {
    logger: createLogger({ minLevel: "error", sink: () => {} }),
    metrics: new MetricsRegistry(),
  };
}

/** Input for {@link ingestSource}. */
export interface IngestionSourceInput {
  /** Session the source belongs to. */
  sessionId: string;
  /** Raw source bytes. UNTRUSTED (architecture-lock §13): never decoded here. */
  bytes: Uint8Array;
  /** Whether this is a `file` upload or a live `stream` source. */
  sourceKind: SourceMediaKind;
  /** Optional original filename (informational only). */
  filename?: string;
  /**
   * The authorization policy decision for the session. `null`/`undefined`
   * means NO decision exists, which the fail-closed gate treats as DENY.
   */
  authorizationPolicy: AuthorizationPolicy | null | undefined;
  /** Ingestion policy override (default: {@link DEFAULT_INGESTION_POLICY}). */
  policy?: IngestionPolicy;
  /** Observability seams (default: silent no-ops). */
  observability?: IngestionObservability;
  /**
   * Deduplication registry making re-ingesting identical bytes return the
   * SAME receipt. When omitted, a per-call throwaway registry is used —
   * idempotency then holds only within the single call. Share one registry
   * per session/service for cross-call deduplication.
   */
  registry?: SourceRegistry;
  /**
   * Evaluation time (epoch milliseconds) for the rights-expiry check and the
   * receipt's `ingestedAtMs`.
   *
   * NOTE: defaults to 0 so tests stay deterministic (the repo-wide
   * clock-injection rule, docs/testing/HARNESS.md — no `Date.now` reads).
   * Production callers MUST inject a real clock (e.g. `Date.now()`): with the
   * default 0 the expiry leg of the rights gate is inert (an expired policy
   * would pass), so callers must never rely on the default in production.
   */
  nowMs?: number;
}

/**
 * In-memory idempotency registry: checksum → receipt. Re-ingesting identical
 * bytes returns the original receipt ("duplicate messages are tolerated
 * through idempotency keys" — docs/contracts/streaming.md). Receipts are
 * frozen on creation, so returned references cannot be mutated.
 */
export class SourceRegistry {
  private readonly byChecksum = new Map<string, IngestionReceipt>();

  /** Number of distinct ingested sources (by checksum). */
  get size(): number {
    return this.byChecksum.size;
  }

  /** Returns the receipt previously registered for `checksum`, if any. */
  get(checksum: string): IngestionReceipt | undefined {
    return this.byChecksum.get(checksum);
  }

  /**
   * Registers `receipt` under its checksum. First write wins: a later put for
   * the same checksum is a no-op, preserving the original ingestion record.
   */
  put(receipt: IngestionReceipt): void {
    if (!this.byChecksum.has(receipt.checksum)) {
      this.byChecksum.set(receipt.checksum, receipt);
    }
  }
}

/** sha-256 of `bytes` as lowercase hex, via Bun's built-in hasher (no deps). */
function sha256Hex(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  return hasher.digest("hex");
}

/**
 * Ingests one authorized source at the validation level.
 *
 * Returns the {@link IngestionReceipt} — the SAME receipt object when
 * identical bytes were already registered (idempotent duplicates are
 * tolerated, not errors). Throws a typed ingestion error
 * ({@link RightsDeniedError} / {@link ResourceLimitError} /
 * {@link UnsupportedMediaError}) on every rejection path, each carrying the
 * contracts `terminalFailureClass`.
 */
export function ingestSource(input: IngestionSourceInput): IngestionReceipt {
  const policy = input.policy ?? DEFAULT_INGESTION_POLICY;
  const nowMs = input.nowMs ?? 0;
  const registry = input.registry ?? new SourceRegistry();

  const noop = noopObservability();
  const logger = input.observability?.logger ?? noop.logger;
  const metrics = input.observability?.metrics ?? noop.metrics;
  const correlation = input.observability?.correlation;
  const stageLogger =
    correlation !== undefined
      ? bindLogger(logger, correlation, INGESTION_STAGE)
      : logger.child({ sessionId: input.sessionId, stage: INGESTION_STAGE });

  try {
    // --- 1. rights gate, FIRST and fail closed ---------------------------
    // assertAuthorized throws the session package's RightsDeniedError; map
    // it to the ingestion-typed error with structured details. The gate runs
    // before any media inspection so an unauthorized caller learns nothing
    // about the bytes (not even size or container).
    try {
      assertAuthorized(input.authorizationPolicy ?? null, "analysis", new Date(nowMs));
    } catch (err) {
      if (err instanceof SessionRightsDeniedError) {
        throw new RightsDeniedError(err.message, {
          reason: err.reason,
          requiredOperation: err.requiredOperation,
          ...(err.policyId !== undefined ? { policyId: err.policyId } : {}),
        });
      }
      throw err;
    }

    // --- 2. size bound (architecture-lock §13) ---------------------------
    if (input.bytes.byteLength > policy.maxBytes) {
      throw new ResourceLimitError(
        `source exceeds ingestion size limit: ${input.bytes.byteLength} bytes > ` +
          `policy.maxBytes ${policy.maxBytes}`,
        { byteLength: input.bytes.byteLength, maxBytes: policy.maxBytes },
      );
    }

    // --- 3. container allowlist (magic-byte level only; decode is W102) --
    const info = sniffContainer(input.bytes);
    if (!policy.allowedContainers.includes(info.container)) {
      throw new UnsupportedMediaError(
        `container '${info.container}' is not allowed by the ingestion policy`,
        {
          detectedContainer: info.container,
          detectedMimeType: info.mimeType,
          detectedBy: info.detectedBy,
          allowedContainers: [...policy.allowedContainers],
          byteLength: input.bytes.byteLength,
        },
      );
    }

    // --- 4. checksum + idempotent receipt --------------------------------
    const checksum = sha256Hex(input.bytes);
    const existing = registry.get(checksum);
    if (existing !== undefined) {
      stageLogger.info("ingest accepted", {
        sourceId: existing.sourceId,
        checksum,
        container: existing.container,
        byteLength: existing.byteLength,
        sourceKind: existing.sourceKind,
        duplicate: true,
        ...(input.filename !== undefined ? { filename: input.filename } : {}),
      });
      metrics.counter(INGESTION_METRIC_NAMES.accepted).inc();
      return existing;
    }

    const receipt: IngestionReceipt = Object.freeze({
      sessionId: input.sessionId,
      sourceId: `src-${checksum.slice(0, SOURCE_ID_HEX_PREFIX)}`,
      checksum,
      container: info.container,
      byteLength: input.bytes.byteLength,
      ingestedAtMs: nowMs,
      sourceKind: input.sourceKind,
      ...(input.filename !== undefined ? { filename: input.filename } : {}),
    });
    registry.put(receipt);

    stageLogger.info("ingest accepted", {
      sourceId: receipt.sourceId,
      checksum,
      container: receipt.container,
      byteLength: receipt.byteLength,
      sourceKind: receipt.sourceKind,
      ...(input.filename !== undefined ? { filename: input.filename } : {}),
    });
    metrics.counter(INGESTION_METRIC_NAMES.accepted).inc();
    return receipt;
  } catch (err) {
    // One structured warn line + rejection counters per classified rejection.
    // Non-ingestion errors (internal faults) propagate untouched — they are
    // not ingestion decisions and classify as `internal` downstream.
    if (isIngestionError(err)) {
      stageLogger.warn("ingest rejected", {
        failureClass: err.terminalFailureClass,
        error: err.message,
        ...err.details,
      });
      metrics.counter(INGESTION_METRIC_NAMES.rejectedTotal).inc();
      metrics
        .counter(INGESTION_METRIC_NAMES.rejectedTotal, {
          [FAILURE_CLASS_LABEL]: err.terminalFailureClass,
        })
        .inc();
    }
    throw err;
  }
}
