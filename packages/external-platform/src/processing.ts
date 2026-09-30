/**
 * The platform processing engines (REL-014/016): the media-processing and
 * feed-processing JOB EXECUTORS over the real @sporta/durable-jobs runtime,
 * plus the transformer and quality-gate ports they ride.
 *
 * THE CONTRACT'S PIPELINE (external-platform-and-mcp.md §Feed processing):
 *
 * ```
 * video platform upload
 *   -> Sporta source validation          (the corpus state machine: the
 *                                        rights gate at acquisition, the
 *                                        no-transformation restriction at
 *                                        normalization — typed refusals)
 *   -> domain/organization selection     (the registry's eligible catalog)
 *   -> render                            (the transformer port)
 *   -> quality gates                     (the quality-gate port)
 *   -> transformed asset                 (the output artifact)
 *   -> platform publication pipeline     (getOutput/getEvidence)
 * ```
 *
 * THE FAIL-CLOSED LAWS (tested):
 * - Rights/policy enforcement is DELEGATED to the corpus state machine: a
 *   source that was never acquired+normalized cannot be transformed — the
 *   executor refuses typed and the JOB FAILS (nothing is published). A
 *   `no-transformation` restriction refuses at normalization, inside the
 *   corpus, with the corpus's own typed error.
 * - Publication is ATOMIC WITH COMPLETION: artifacts and evidence are
 *   published only after the last checkpoint, immediately before
 *   `complete`. A CANCELLED job (the cancellation honored at a checkpoint)
 *   therefore leaves NO partial authoritative output — `getOutput` refuses
 *   typed. A crashed worker resumes from the per-item checkpoints and
 *   completes exactly once (no duplicate completion, no lost lineage).
 */
import type { CorpusStore, SourceRecord } from "@sporta/historical-corpus";
import type { JobExecutor, JobExecutorContext } from "@sporta/durable-jobs";
import { JobsValidationError } from "@sporta/durable-jobs";
import type { TenantScope } from "./domain";
import type { EvidenceBundleRecord, OutputArtifactRecord } from "./domain";
import type { IdSource } from "./clock";
import { sha256HexBytes } from "./hash";

// ---------------------------------------------------------------------------
// The shared platform stores (the in-memory artifact/evidence sinks)
// ---------------------------------------------------------------------------

/**
 * The authoritative in-memory artifact + evidence stores the services read
 * and the executors publish into (the port-friendly seam for a durable
 * artifact store later). Publication is keyed by jobId; records are deeply
 * frozen on the way out.
 */
export interface PlatformStores {
  /** Publishes the authoritative artifact for a job (idempotent by content). */
  publishArtifact(record: OutputArtifactRecord, bytes: Uint8Array): Promise<void>;
  /** The artifact record for a job, or null. */
  artifactOf(jobId: string): Promise<{ record: OutputArtifactRecord; bytes: Uint8Array } | null>;
  /** Publishes the evidence bundle for a job. */
  publishEvidence(record: EvidenceBundleRecord): Promise<void>;
  /** The evidence bundle for a job, or null. */
  evidenceOf(jobId: string): Promise<EvidenceBundleRecord | null>;
}

/** Creates the in-memory platform stores. */
export function createPlatformStores(): PlatformStores {
  const artifacts = new Map<string, { record: OutputArtifactRecord; bytes: Uint8Array }>();
  const evidence = new Map<string, EvidenceBundleRecord>();
  return {
    async publishArtifact(record, bytes) {
      artifacts.set(record.jobId, { record: deepFreeze({ ...record }), bytes });
    },
    async artifactOf(jobId) {
      return artifacts.get(jobId) ?? null;
    },
    async publishEvidence(record) {
      evidence.set(record.jobId, deepFreeze({ ...record }));
    },
    async evidenceOf(jobId) {
      return evidence.get(jobId) ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// The transformer + quality-gate ports
// ---------------------------------------------------------------------------

/** The render/transform port: normalized bytes in, transformed bytes out. */
export interface PlatformTransformer {
  /** The transformer identity (recorded in the evidence). */
  readonly id: string;
  transform(input: {
    readonly bytes: Uint8Array;
    readonly sourceId: string;
    readonly organizationId: string | null;
  }): Promise<Uint8Array>;
}

/**
 * The honest v0 transformer: prepends a deterministic header naming the
 * organization and source to the normalized bytes. A REAL byte
 * transformation (the output checksum differs from the input's), fully
 * deterministic — the render lanes plug in behind the same port.
 */
export function createHeaderTransformer(): PlatformTransformer {
  const encoder = new TextEncoder();
  return {
    id: "header-transform/v0",
    async transform({ bytes, sourceId, organizationId }) {
      const header = encoder.encode(
        `SPORTA-TRANSFORM/${organizationId ?? "no-organization"}/${sourceId}\n`,
      );
      const output = new Uint8Array(header.length + bytes.length);
      output.set(header, 0);
      output.set(bytes, header.length);
      return output;
    },
  };
}

/** The quality-gate verdict. */
export interface QualityGateResult {
  readonly gateId: string;
  readonly passed: boolean;
  readonly checks: readonly {
    readonly name: string;
    readonly passed: boolean;
    readonly detail: string;
  }[];
}

/** The quality-gate port: the deterministic checks an output must pass. */
export interface PlatformQualityGate {
  readonly gateId: string;
  evaluate(input: {
    readonly output: Uint8Array;
    readonly sources: readonly SourceRecord[];
    readonly organizationId: string | null;
    /** The total normalized byte length the output was derived from. */
    readonly inputByteLength: number;
  }): Promise<QualityGateResult>;
}

/**
 * The honest v0 gate: output non-empty, per-source lineage complete (every
 * transformed source carries acquired + normalized checksums), and no data
 * loss (the output is at least as long as its normalized inputs).
 */
export function createChecksumQualityGate(): PlatformQualityGate {
  return {
    gateId: "media-quality/v0",
    async evaluate({ output, sources, organizationId, inputByteLength }) {
      const checks: QualityGateResult["checks"] = [
        {
          name: "output-non-empty",
          passed: output.byteLength > 0,
          detail: `output carries ${output.byteLength} bytes`,
        },
        {
          name: "lineage-complete",
          passed: sources.every(
            (source) =>
              source.acquiredChecksum !== null &&
              source.normalized !== null &&
              source.normalized.normalizedChecksum !== "",
          ),
          detail: sources
            .map(
              (source) =>
                `${source.sourceId}:${source.normalized !== null ? "normalized" : "NOT-NORMALIZED"}`,
            )
            .join(","),
        },
        {
          name: "no-data-loss",
          passed: output.byteLength >= inputByteLength,
          detail: `output ${output.byteLength} bytes vs ${inputByteLength} normalized input bytes (organization ${organizationId ?? "none"}, ${sources.length} source(s))`,
        },
      ];
      return {
        gateId: "media-quality/v0",
        passed: checks.every((check) => check.passed),
        checks,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// The job input shapes (stamped by the services, parsed by the executors)
// ---------------------------------------------------------------------------

/** The tenant-scoped job input the services enqueue for media processing. */
export interface MediaJobInput {
  readonly scope: TenantScope;
  readonly sourceId: string;
  readonly organizationId: string | null;
}

/** The tenant-scoped job input the services enqueue for feed processing. */
export interface FeedJobInput {
  readonly scope: TenantScope;
  readonly items: readonly {
    readonly sourceId: string;
    /** True when the item was submitted WITH bytes (transformable). */
    readonly transformable: boolean;
  }[];
  readonly organizationId: string;
  readonly requireTransformation: boolean;
}

/** Fail-closed input parse: a malformed job input is a typed configuration failure. */
function parseJobInput<T>(input: unknown, kind: string): T {
  if (typeof input !== "object" || input === null) {
    throw new JobsValidationError(`job input for kind ${kind} is not an object`, [input]);
  }
  const scoped = input as { scope?: unknown };
  if (
    typeof scoped.scope !== "object" ||
    scoped.scope === null ||
    typeof (scoped.scope as { platformId?: unknown }).platformId !== "string" ||
    typeof (scoped.scope as { tenantId?: unknown }).tenantId !== "string"
  ) {
    throw new JobsValidationError(`job input for kind ${kind} carries no tenant scope`, [input]);
  }
  return input as T;
}

// ---------------------------------------------------------------------------
// The processing engine (shared by both executors)
// ---------------------------------------------------------------------------

/** Everything an executor needs (wired by createExternalPlatform). */
export interface ProcessingDeps {
  readonly corpus: CorpusStore;
  readonly stores: PlatformStores;
  readonly transformer: PlatformTransformer;
  readonly qualityGate: PlatformQualityGate;
  readonly clock: () => number;
  readonly idSource: IdSource;
}

/** One transformed item: the bytes plus the lineage the evidence carries. */
interface ProcessedItem {
  readonly sourceId: string;
  readonly bytes: Uint8Array;
  readonly record: SourceRecord;
}

/** One skipped reference item (indexed, never transformed). */
interface SkippedItem {
  readonly record: SourceRecord;
}

/** Is this record a mere reference (never acquired, never normalized)? */
function isReferenceRecord(record: SourceRecord): boolean {
  return record.state !== "acquired" && record.normalized === null;
}

/**
 * Processes one source through the corpus-gated pipeline: normalize when
 * needed (the corpus state machine refuses `no-transformation` sources
 * typed — the refusal becomes the job failure) -> transform. Returns null
 * for a reference record (the caller decides: fail-closed or skip).
 */
async function processSource(
  deps: ProcessingDeps,
  sourceId: string,
  organizationId: string | null,
): Promise<ProcessedItem | null> {
  let record = await deps.corpus.get(sourceId);
  if (isReferenceRecord(record)) return null;
  if (record.state === "acquired") {
    // THE CORPUS STATE MACHINE IS THE AUTHORITY: normalization refuses a
    // `no-transformation` source typed; rights/policy enforcement is
    // delegated, never reimplemented here.
    record = await deps.corpus.normalizeSource(sourceId);
  }
  const normalizedBytes = await deps.corpus.getBytes(sourceId, "normalized");
  const bytes = await deps.transformer.transform({
    bytes: normalizedBytes,
    sourceId,
    organizationId,
  });
  return { sourceId, bytes, record };
}

/** Publishes the artifact + evidence atomically with completion. */
async function publish(
  deps: ProcessingDeps,
  input: { readonly scope: TenantScope; readonly organizationId: string | null },
  jobId: string,
  kind: OutputArtifactRecord["kind"],
  processed: readonly ProcessedItem[],
  skipped: readonly SkippedItem[],
  gate: QualityGateResult,
): Promise<string> {
  const output = concat(processed.map((item) => item.bytes));
  const checksum = await sha256HexBytes(output);
  const artifactRef = `artifact://${checksum}`;
  const now = deps.clock();
  await deps.stores.publishArtifact(
    {
      artifactId: deps.idSource.nextId(),
      jobId,
      scope: input.scope,
      kind,
      artifactRef,
      checksum,
      byteLength: output.byteLength,
      items: await Promise.all(
        processed.map(async (item) => ({
          sourceId: item.sourceId,
          canonicalUrl: item.record.canonicalUrl,
          checksum: await sha256HexBytes(item.bytes),
        })),
      ),
      organizationId: input.organizationId,
      createdAt: now,
    },
    output,
  );
  await deps.stores.publishEvidence({
    evidenceId: deps.idSource.nextId(),
    jobId,
    scope: input.scope,
    sourceLineage: [
      ...processed.map((item) => ({
        sourceId: item.sourceId,
        canonicalUrl: item.record.canonicalUrl,
        provider: item.record.provider,
        acquiredChecksum: item.record.acquiredChecksum,
        normalizedChecksum: item.record.normalized?.normalizedChecksum ?? null,
        outcome: "transformed" as const,
      })),
      ...skipped.map((item) => ({
        sourceId: item.record.sourceId,
        canonicalUrl: item.record.canonicalUrl,
        provider: item.record.provider,
        acquiredChecksum: item.record.acquiredChecksum,
        normalizedChecksum: item.record.normalized?.normalizedChecksum ?? null,
        outcome: "skipped-reference" as const,
      })),
    ],
    qualityGate: {
      gateId: gate.gateId,
      passed: gate.passed,
      checks: gate.checks.map((check) => ({ ...check })),
    },
    organizationId: input.organizationId,
    createdAt: deps.clock(),
  });
  return artifactRef;
}

// ---------------------------------------------------------------------------
// The media-processing executor (kind "external.media-processing")
// ---------------------------------------------------------------------------

/** Creates the media-processing executor (submit_video's long job). */
export function createMediaProcessingExecutor(deps: ProcessingDeps): JobExecutor {
  return {
    kind: "external.media-processing",
    async execute(ctx: JobExecutorContext): Promise<readonly string[]> {
      const input = parseJobInput<MediaJobInput>(ctx.job.input, "external.media-processing");
      const processed = await processSource(deps, input.sourceId, input.organizationId);
      if (processed === null) {
        // Fail-closed: a reference cannot be transformed — a URL is a source
        // reference, not proof of transformation rights.
        const record = await deps.corpus.get(input.sourceId);
        throw new Error(
          `media processing refused: source ${input.sourceId} is in state ${record.state} (transformation requires acquired+normalized bytes; the corpus state machine is the authority)${
            record.restrictions.includes("reference-only")
              ? " — the source is declared reference-only"
              : ""
          }`,
        );
      }
      const gate = await deps.qualityGate.evaluate({
        output: processed.bytes,
        sources: [processed.record],
        organizationId: input.organizationId,
        inputByteLength: (await deps.corpus.getBytes(input.sourceId, "normalized")).byteLength,
      });
      if (!gate.passed) {
        const failed = gate.checks.filter((check) => !check.passed).map((check) => check.name);
        throw new Error(`quality gate ${gate.gateId} failed: ${failed.join(", ")}`);
      }
      const artifactRef = await publish(
        deps,
        input,
        ctx.job.jobId,
        "transformed-media",
        [processed],
        [],
        gate,
      );
      return [artifactRef];
    },
  };
}

// ---------------------------------------------------------------------------
// The feed-processing executor (kind "external.feed-processing", REL-016)
// ---------------------------------------------------------------------------

/** The resumable per-item checkpoint state of a feed job. */
interface FeedCheckpointState {
  readonly processedItems: readonly string[];
  readonly skippedItems: readonly string[];
}

/** Creates the feed-processing executor (submit_feed's long job). */
export function createFeedProcessingExecutor(deps: ProcessingDeps): JobExecutor {
  return {
    kind: "external.feed-processing",
    async execute(ctx: JobExecutorContext): Promise<readonly string[]> {
      const input = parseJobInput<FeedJobInput>(ctx.job.input, "external.feed-processing");
      // The resume point: which items are already durable.
      const last = ctx.job.checkpoints[ctx.job.checkpoints.length - 1];
      const resume = (last?.state as FeedCheckpointState | undefined) ?? {
        processedItems: [],
        skippedItems: [],
      };
      const processedIds = new Set<string>(resume.processedItems);
      const skippedIds = new Set<string>(resume.skippedItems);

      const processed: ProcessedItem[] = [];
      const skipped: SkippedItem[] = [];

      for (const item of input.items) {
        if (processedIds.has(item.sourceId)) {
          // Resumed work: the transformer is deterministic, so re-deriving
          // the output reproduces exactly the pre-crash bytes.
          const redone = await processSource(deps, item.sourceId, input.organizationId);
          if (redone !== null) processed.push(redone);
          continue;
        }
        if (skippedIds.has(item.sourceId)) {
          const record = await deps.corpus.get(item.sourceId);
          skipped.push({ record });
          continue;
        }
        const record = await deps.corpus.get(item.sourceId);
        if (isReferenceRecord(record)) {
          if (input.requireTransformation) {
            // FAIL-CLOSED: the feed promised transformation for every item.
            throw new Error(
              `feed processing refused: item ${item.sourceId} (${record.canonicalUrl}) is in state ${record.state} — transformation requires acquired+normalized bytes (submit the item's bytes with a declared basis, or set requireTransformation false to index references)`,
            );
          }
          skipped.push({ record });
          skippedIds.add(item.sourceId);
          await ctx.checkpoint({
            processedItems: [...processedIds],
            skippedItems: [...skippedIds],
          });
          continue;
        }
        const done = await processSource(deps, item.sourceId, input.organizationId);
        if (done === null) {
          throw new Error(
            `feed processing refused: item ${item.sourceId} (${record.canonicalUrl}) could not be normalized for transformation (the corpus state machine refused; the job fails closed)`,
          );
        }
        processed.push(done);
        processedIds.add(item.sourceId);
        // The per-item checkpoint: the resume boundary after a crash AND the
        // cancellation boundary (the honored signal stops the job HERE,
        // before any publication — no partial authoritative output).
        await ctx.checkpoint({
          processedItems: [...processedIds],
          skippedItems: [...skippedIds],
        });
      }

      if (processed.length === 0) {
        throw new Error(
          "feed processing refused: no transformable items (an all-reference feed produces no output; submit bytes with declared bases)",
        );
      }

      // The quality gate over the whole aggregate output.
      const output = concat(processed.map((item) => item.bytes));
      const inputByteLength = await normalizedLengthOf(deps, processed);
      const gate = await deps.qualityGate.evaluate({
        output,
        sources: processed.map((item) => item.record),
        organizationId: input.organizationId,
        inputByteLength,
      });
      if (!gate.passed) {
        const failed = gate.checks.filter((check) => !check.passed).map((check) => check.name);
        throw new Error(`quality gate ${gate.gateId} failed: ${failed.join(", ")}`);
      }

      // Publication is atomic with completion: after the LAST checkpoint a
      // cancellation request can no longer be honored mid-flight (the v0
      // cooperative law), so what follows is one uninterrupted commit.
      const artifactRef = await publish(
        deps,
        input,
        ctx.job.jobId,
        "feed-output",
        processed,
        skipped,
        gate,
      );
      return [artifactRef];
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** The total normalized byte length of the processed items. */
async function normalizedLengthOf(
  deps: ProcessingDeps,
  processed: readonly ProcessedItem[],
): Promise<number> {
  let total = 0;
  for (const item of processed) {
    const bytes = await deps.corpus.getBytes(item.sourceId, "normalized");
    total += bytes.byteLength;
  }
  return total;
}

/** Concatenates byte arrays (deterministic order). */
function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

/** Deep freeze (the repo precedent). */
function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    return Object.freeze(value);
  }
  return value;
}
