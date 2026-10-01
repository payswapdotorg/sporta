/**
 * The typed-refusal ledger (REL-026) — every bypass-shaped input refuses
 * TYPED, fail-closed, WITH THE REFUSAL RECORDED: never silently dropped.
 *
 * Source of truth: docs/testing/reality-engineering-lab-acceptance.md Gate
 * REL-A1 ("Denied acquisition must fail closed with a useful state") and
 * the Worker B packet's provider rule ("YouTube/source adapters may
 * discover and reference content; download/transformation only when
 * authorization/policy allows; never implement a bypass").
 *
 * THE DIVISION OF LABOR (fail-closed is the STORE's job; recording is the
 * LEDGER's job): the corpus store, the connectors and the pipeline keep
 * throwing their typed {@link CorpusApiError} refusals exactly as they do
 * today — the refusal itself is unchanged, un-weakened and un-caught. The
 * ledger wraps an operation (`attempt`) so that WHEN a typed refusal fires,
 * an immutable audit record is appended BEFORE the error re-throws: the
 * same typed code, the same failureClass, the same machine-readable
 * details, plus the operation name and a JSON-safe subject summary (which
 * source/canonical URL/connector/feed the refusal was about).
 *
 * Non-corpus errors (programming faults, infrastructure faults) are NOT
 * recorded — they are not refusals; they propagate untouched. Recording is
 * never swallowing: `attempt` always either returns the operation's value
 * or re-throws the exact error it was shown.
 *
 * Constitution: no wall time, no randomness — clock + ids are injected
 * (the repo precedent); the default ledger is deterministic
 * (`refusal-1`, `refusal-2`, ..., the corpus default clock).
 */
import { createCorpusDefaultClock } from "./clock";
import type { IdSource } from "./clock";
import { createSequentialIdSource } from "./clock";
import { isCorpusError } from "./errors";
import type { CorpusApiError } from "./errors";

// ---------------------------------------------------------------------------
// The refusal record
// ---------------------------------------------------------------------------

/** One recorded typed refusal (immutable evidence of a fail-closed moment). */
export interface RefusalRecord {
  /** The ledger-side id (deterministic by default). */
  readonly refusalId: string;
  /** When the refusal fired (epoch ms, injected clock). */
  readonly at: number;
  /** The operation that refused, e.g. "authorize-access", "connector-acquire". */
  readonly operation: string;
  /** JSON-safe subject summary: what the refusal was about. */
  readonly subject: Record<string, unknown>;
  /** The typed error code, e.g. "corpus.rights-basis-required". */
  readonly code: string;
  /** The typed failure class, e.g. "rights". */
  readonly failureClass: string;
  /** The human-readable refusal message (unchanged, from the error). */
  readonly message: string;
  /** The typed error's structured details (JSON-safe subset). */
  readonly details: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// The ledger port
// ---------------------------------------------------------------------------

/** The query filter for the ledger. */
export interface RefusalFilter {
  readonly code?: string;
  readonly failureClass?: string;
  readonly operation?: string;
  /** Substring match over the canonical subject serialization. */
  readonly subjectContains?: string;
}

/** The refusal ledger: record + query the fail-closed audit trail. */
export interface RefusalLedger {
  /**
   * Runs an operation under audit: a typed corpus refusal firing inside it
   * is recorded and then RE-THROWN unchanged (fail-closed preserved — the
   * ledger is an audit trail, never a swallowing layer).
   */
  attempt<T>(operation: string, subject: Record<string, unknown>, fn: () => Promise<T>): Promise<T>;
  /**
   * Records a refusal directly from a caught error. Returns the record, or
   * null when the error is not a typed corpus error (nothing is recorded
   * for non-refusals).
   */
  record(operation: string, subject: Record<string, unknown>, error: unknown): RefusalRecord | null;
  /** Lists the recorded refusals (chronological), optionally filtered. */
  list(filter?: RefusalFilter): readonly RefusalRecord[];
  /** Looks a refusal up by id, or null. */
  get(refusalId: string): RefusalRecord | null;
  /** How many refusals are recorded (optionally filtered). */
  count(filter?: RefusalFilter): number;
}

/** Options for {@link createRefusalLedger}. */
export interface RefusalLedgerOptions {
  /** Injected clock (default: the deterministic corpus clock). */
  readonly clock?: () => number;
  /** Injected id source (default: `refusal-1`, `refusal-2`, ...). */
  readonly idSource?: IdSource;
}

/** Creates the in-memory refusal ledger. */
export function createRefusalLedger(options: RefusalLedgerOptions = {}): RefusalLedger {
  const clock = options.clock ?? createCorpusDefaultClock();
  const idSource = options.idSource ?? createSequentialIdSource("refusal");
  const records: RefusalRecord[] = [];

  function jsonSafeSubject(subject: Record<string, unknown>): Record<string, unknown> {
    const text = JSON.stringify(subject);
    if (text === undefined) {
      // A subject that cannot serialize is recorded honestly as such —
      // never dropped, never fabricated.
      return { unserializable: true };
    }
    return JSON.parse(text) as Record<string, unknown>;
  }

  function jsonSafeDetails(error: CorpusApiError): Record<string, unknown> {
    const text = JSON.stringify(error.details ?? {});
    if (text === undefined) return {};
    return JSON.parse(text) as Record<string, unknown>;
  }

  const ledger: RefusalLedger = {
    async attempt(operation, subject, fn) {
      try {
        return await fn();
      } catch (error) {
        ledger.record(operation, subject, error);
        throw error;
      }
    },

    record(operation, subject, error) {
      if (!isCorpusError(error)) return null;
      const typed = error as CorpusApiError;
      const record: RefusalRecord = deepFreeze({
        refusalId: idSource.nextId(),
        at: clock(),
        operation,
        subject: jsonSafeSubject(subject),
        code: typed.code,
        failureClass: typed.failureClass,
        message: typed.message,
        details: jsonSafeDetails(typed),
      });
      records.push(record);
      return record;
    },

    list(filter) {
      const filtered = records.filter((record) => {
        if (filter?.code !== undefined && record.code !== filter.code) return false;
        if (filter?.failureClass !== undefined && record.failureClass !== filter.failureClass) {
          return false;
        }
        if (filter?.operation !== undefined && record.operation !== filter.operation) {
          return false;
        }
        if (
          filter?.subjectContains !== undefined &&
          !JSON.stringify(record.subject).includes(filter.subjectContains)
        ) {
          return false;
        }
        return true;
      });
      return [...filtered];
    },

    get(refusalId) {
      return records.find((record) => record.refusalId === refusalId) ?? null;
    },

    count(filter) {
      return ledger.list(filter).length;
    },
  };
  return ledger;
}

/** Deep freeze (the store precedent): refusal records are immutable evidence. */
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
