/**
 * The append-only JSON journal (REL-012): the file-backed persistence of the
 * job store.
 *
 * Design (the packet's law: "an append-only JSON-file store with atomic
 * rename writes (NO new native dependencies; the seam maps to a real DB
 * later)"):
 *
 * - THE FILE is a single JSON document — `{ format, events: [...] }` —
 *   holding the whole event journal. Events are APPEND-ONLY: they are
 *   never rewritten, reordered or removed; every store operation appends
 *   exactly one event and re-persists the document with an ATOMIC RENAME
 *   (write to a sibling temp file, then `renameSync` over the target —
 *   POSIX rename atomicity: a reader sees either the whole old document or
 *   the whole new one, never a torn write).
 * - STATE IS THE FOLD of the journal: a fresh store rebuilds every record
 *   by replaying the events in `seq` order (see `foldJournal`). The
 *   journal is therefore the evidence trail AND the recovery mechanism.
 * - CRASH SAFETY: a crash before the rename leaves the previous document
 *   intact — reloading yields the last committed state. Stray `.tmp-*`
 *   files are never read (they are not the source of truth) and a store
 *   whose persist failed is POISONED (it refuses further operations;
 *   honest: its memory no longer matches disk).
 * - The writer is INJECTABLE so tests can simulate an interrupted write
 *   (write the temp file, then die before the rename) and verify the
 *   last-good reload.
 * - The O(n) re-persist per append is the deliberate slice trade-off; a
 *   real DB adapter (REL-029) replaces the mechanism, not the discipline.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { JobCheckpoint, JobFailure, JobLease, JobRecord, JobState } from "./domain";
import { JobsStoreError } from "./errors";

/** The journal file format identifier (a mismatch refuses typed). */
export const JOURNAL_FORMAT = "sporta.durable-jobs.journal/v1";

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * The whitelisted record patch an event may carry. The fold applies only
 * these keys — anything else in a patch is corruption (the loader fails
 * closed with a typed error).
 */
export interface JobRecordPatch {
  state?: JobState;
  lease?: JobLease | null;
  checkpoints?: JobCheckpoint[];
  attempts?: number;
  cancellationRequested?: boolean;
  failure?: JobFailure | null;
  retryAt?: number | null;
  outputArtifactRefs?: string[];
  /** REL-029 — the executor's code version, recorded at attempt start. */
  codeVersion?: string;
  updatedAt?: number;
  completedAt?: number | null;
}

/** The event appended when a job is enqueued (carries the full record). */
export interface JobEnqueuedEvent {
  readonly seq: number;
  readonly at: number;
  readonly type: "enqueued";
  readonly record: JobRecord;
}

/** The event appended for every subsequent mutation of a record. */
export interface JobPatchedEvent {
  readonly seq: number;
  readonly at: number;
  readonly type: "patched";
  readonly jobId: string;
  /** The operation name for the audit trail (e.g. "acquire", "checkpoint"). */
  readonly op: string;
  readonly patch: JobRecordPatch;
}

export type JournalEvent = JobEnqueuedEvent | JobPatchedEvent;

/** The on-disk document shape. */
export interface JournalFileEnvelope {
  readonly format: string;
  readonly events: readonly JournalEvent[];
}

// ---------------------------------------------------------------------------
// The atomic writer (default) + the load/append primitives
// ---------------------------------------------------------------------------

/** How the journal document is persisted: temp file + atomic rename. */
export type JournalWriter = (path: string, data: string) => void;

let tempCounter = 0;

/**
 * The default writer: writes `${path}.tmp-<pid>-<n>` then renames it over
 * the target. The rename is the atomic commit point.
 */
export function writeJournalAtomic(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true });
  tempCounter += 1;
  const tmp = `${path}.tmp-${process.pid}-${tempCounter}`;
  writeFileSync(tmp, data, "utf8");
  renameSync(tmp, path);
}

/** Reads the journal file, or null when it does not exist yet (fresh store). */
export function readJournalFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new JobsStoreError(
      "jobs.store-read-failed",
      `failed to read the journal file at ${path}`,
      {
        path,
        cause: String(error),
      },
    );
  }
}

/** Parses + shape-validates the journal document (fail closed on garbage). */
export function parseJournal(text: string): JournalFileEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new JobsStoreError(
      "jobs.store-read-failed",
      "the journal file is not valid JSON (a torn write should be impossible with atomic renames — refusing to improvise)",
      { cause: String(error) },
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { format?: unknown }).format !== JOURNAL_FORMAT ||
    !Array.isArray((parsed as { events?: unknown }).events)
  ) {
    throw new JobsStoreError(
      "jobs.store-read-failed",
      `the journal file does not carry the ${JOURNAL_FORMAT} envelope (refusing to improvise)`,
    );
  }
  return parsed as JournalFileEnvelope;
}

// ---------------------------------------------------------------------------
// The fold (journal -> records)
// ---------------------------------------------------------------------------

const PATCH_KEYS: ReadonlySet<string> = new Set([
  "state",
  "lease",
  "checkpoints",
  "attempts",
  "cancellationRequested",
  "failure",
  "retryAt",
  "outputArtifactRefs",
  "codeVersion",
  "updatedAt",
  "completedAt",
]);

/**
 * Rebuilds the job records by replaying the journal. `enqueued` events
 * carry the full initial record; `patched` events apply their whitelisted
 * patch. Unknown event types or unknown patch keys are corruption — the
 * fold fails closed with a typed error.
 */
export function foldJournal(events: readonly JournalEvent[]): Map<string, JobRecord> {
  const records = new Map<string, JobRecord>();
  let expectedSeq = 1;
  for (const event of events) {
    if (typeof event !== "object" || event === null || event.seq !== expectedSeq) {
      throw new JobsStoreError(
        "jobs.store-read-failed",
        `journal corruption: expected event seq ${expectedSeq}`,
        { event },
      );
    }
    expectedSeq += 1;
    if (event.type === "enqueued") {
      const record = event.record;
      if (typeof record?.jobId !== "string") {
        throw new JobsStoreError(
          "jobs.store-read-failed",
          "journal corruption: enqueued event without a record",
          {
            seq: event.seq,
          },
        );
      }
      records.set(record.jobId, record);
      continue;
    }
    if (event.type === "patched") {
      const record = records.get(event.jobId);
      if (record === undefined) {
        throw new JobsStoreError(
          "jobs.store-read-failed",
          `journal corruption: patched event for unknown job ${event.jobId}`,
          { seq: event.seq, jobId: event.jobId },
        );
      }
      for (const key of Object.keys(event.patch)) {
        if (!PATCH_KEYS.has(key)) {
          throw new JobsStoreError(
            "jobs.store-read-failed",
            `journal corruption: patch carries unknown key ${key}`,
            { seq: event.seq, jobId: event.jobId },
          );
        }
      }
      records.set(event.jobId, { ...record, ...event.patch } as JobRecord);
      continue;
    }
    throw new JobsStoreError("jobs.store-read-failed", `journal corruption: unknown event type`, {
      event: event as unknown,
    });
  }
  return records;
}

/** Serializes the journal document deterministically. */
export function serializeJournal(events: readonly JournalEvent[]): string {
  return JSON.stringify({ format: JOURNAL_FORMAT, events });
}
