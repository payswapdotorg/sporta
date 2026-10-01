/**
 * The artifact lineage (REL-029) — the provenance chain of a durable job's
 * outputs, answering the acceptance question verbatim: "which run, which
 * inputs, which code version".
 *
 * Source of truth: docs/testing/reality-engineering-lab-acceptance.md Gate
 * REL-A8 ("No duplicate authoritative completion or artifact lineage is
 * allowed") and the REL-029 packet ("artifact lineage: the artifact's
 * provenance chain survives all of the above").
 *
 * THE DESIGN LAW: lineage is a PURE PROJECTION over the immutable
 * {@link JobRecord} — never a second store, never a side-channel. Because
 * the record IS the fold of the durable journal, the lineage SURVIVES
 * worker restarts, harness reconnects, retry storms and cancellations by
 * construction: reload the journal anywhere, re-fold, re-project, and the
 * same chain comes back. The legs:
 *
 * - WHICH RUN: `jobId` + `kind` + `attempts` + the terminal state;
 * - WHICH INPUTS: `inputDigest` (SHA-256 of the canonical JSON of the job
 *   input — the content address of the request payload) plus the explicit
 *   `inputArtifactRefs`;
 * - WHICH CODE VERSION: `codeVersion` (the executor's declared version,
 *   recorded at attempt start by the runtime);
 * - WHAT CAME OUT: `outputArtifactRefs` — EMPTY for a cancelled job (the
 *   no-partial-authoritative-output law) and filled exactly at the one
 *   authoritative completion.
 */
import type { JobRecord } from "./domain";
import { canonicalJson, sha256Hex } from "./hash";

/** The artifact lineage: the job's provenance chain as one queryable view. */
export interface ArtifactLineage {
  /** WHICH RUN: the durable job identifier. */
  readonly jobId: string;
  /** WHICH RUN: the job kind (the executor family). */
  readonly kind: string;
  /** WHICH RUN: the attempt count (crashes continue, failures increment). */
  readonly attempts: number;
  /** WHICH RUN: the terminal-or-current state. */
  readonly state: string;
  /** WHICH INPUTS: SHA-256 hex of the canonical JSON of the job input. */
  readonly inputDigest: string;
  /** WHICH INPUTS: the explicit input artifact references. */
  readonly inputArtifactRefs: readonly string[];
  /** WHICH CODE VERSION: the executor's declared version (null = undeclared). */
  readonly codeVersion: string | null;
  /** WHAT CAME OUT: the output artifact references (empty until completion). */
  readonly outputArtifactRefs: readonly string[];
  /** The idempotency key the run converged under, or null. */
  readonly idempotencyKey: string | null;
  /** How many durable checkpoints the run persisted. */
  readonly checkpointCount: number;
  /** When the run reached its terminal state (epoch ms), or null. */
  readonly completedAt: number | null;
}

/**
 * Projects the artifact lineage of a job record. Async only because the
 * input digest is a real SHA-256 over the canonical input serialization.
 */
export async function lineageOf(record: JobRecord): Promise<ArtifactLineage> {
  return deepFreeze({
    jobId: record.jobId,
    kind: record.kind,
    attempts: record.attempts,
    state: record.state,
    inputDigest: await sha256Hex(canonicalJson(record.input)),
    inputArtifactRefs: [...record.inputArtifactRefs],
    codeVersion: record.codeVersion,
    outputArtifactRefs: [...record.outputArtifactRefs],
    idempotencyKey: record.idempotencyKey,
    checkpointCount: record.checkpoints.length,
    completedAt: record.completedAt,
  });
}

/**
 * Compares two lineages for EQUALITY OF MEANING: the wall-clock
 * `completedAt` leg is stripped (an interrupted-and-resumed run and an
 * uninterrupted run completed at different instants — every leg that
 * MEANS something must be identical).
 */
export function lineageEquals(a: ArtifactLineage, b: ArtifactLineage): boolean {
  const meaning = (lineage: ArtifactLineage) => ({
    jobId: lineage.jobId,
    kind: lineage.kind,
    attempts: lineage.attempts,
    state: lineage.state,
    inputDigest: lineage.inputDigest,
    inputArtifactRefs: [...lineage.inputArtifactRefs],
    codeVersion: lineage.codeVersion,
    outputArtifactRefs: [...lineage.outputArtifactRefs],
    idempotencyKey: lineage.idempotencyKey,
    checkpointCount: lineage.checkpointCount,
  });
  return JSON.stringify(meaning(a)) === JSON.stringify(meaning(b));
}

/** Deep freeze (the store precedent): lineage views are immutable. */
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
