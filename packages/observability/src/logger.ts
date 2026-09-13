/**
 * Structured logging: one JSON line per call (W007 §3.1).
 *
 * Every log call emits exactly ONE JSON line to the sink (default:
 * `console.log`): a {@link LogRecord} serialized with a safe stringifier that
 * can never throw — circular references and other non-JSON values inside
 * `fields` are coerced to strings instead of failing the emit path (a logger
 * must never take the pipeline down with it).
 *
 * Level filtering: a record is emitted only when its level weight is >= the
 * logger's `minLevel` (default `"info"`). Children created via
 * {@link Logger.child} inherit the sink, the clock, and the minimum level, and
 * merge their bound correlation fields into every line.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** One structured log line, exactly as it is serialized to the sink. */
export interface LogRecord {
  /** Wall-clock emit time in epoch milliseconds. */
  ts: number;
  level: LogLevel;
  msg: string;
  /** Media session the record belongs to (bound via child loggers). */
  sessionId?: string;
  /** Correlation id: ties the record to its triggering request. */
  correlationId?: string;
  /** Trace id: spans the observable processing chain. */
  traceId?: string;
  /** Pipeline stage that emitted the record. */
  stage?: string;
  /** Arbitrary structured payload; safe-stringified, never fatal. */
  fields?: Record<string, unknown>;
}

/** Options for {@link createLogger}. */
export interface LoggerOptions {
  /** Minimum level that is emitted (default `"info"`). */
  minLevel?: LogLevel;
  /** Line consumer (default: `console.log`). */
  sink?: (line: string) => void;
  /**
   * Clock for the `ts` field, epoch milliseconds (default: `Date.now`).
   * Injected by tests for determinism (the repo-wide clock-injection rule,
   * docs/testing/HARNESS.md) and by deployments that want a monotonic clock.
   */
  now?: () => number;
}

/** The structured logger surface. */
export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  /**
   * Returns a logger whose every line carries the given bound fields
   * (`sessionId`, `correlationId`, `traceId`, `stage`, and base `fields`).
   * Child bindings override the parent's; per-call `fields` override the
   * child's. `ts`, `level`, and `msg` are always per-call.
   */
  child(bindings: Partial<LogRecord>): Logger;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function defaultSink(line: string): void {
  // eslint-disable-next-line no-console -- the documented default sink
  console.log(line);
}

/**
 * Correlation fields a child logger can bind (the subset of {@link LogRecord}
 * that makes sense to carry on every line; `ts`/`level`/`msg` stay per-call).
 */
interface BoundFields {
  sessionId?: string;
  correlationId?: string;
  traceId?: string;
  stage?: string;
  fields?: Record<string, unknown>;
}

/** Coercion applied to values JSON.stringify cannot represent faithfully. */
const CIRCULAR_PLACEHOLDER = "[Circular]";

/**
 * Deep-copies `value` into a JSON-safe structure: circular references become
 * {@link CIRCULAR_PLACEHOLDER}, bigint/function/symbol values become strings,
 * and objects are cloned so the original is never mutated. Sibling references
 * to the same object remain valid (objects leave the `seen` set once their
 * subtree is serialized); only true cycles are cut.
 */
function jsonSafe(value: unknown, seen: Set<object>): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "bigint":
    case "function":
    case "symbol":
      return String(value);
    case "undefined":
      return undefined;
    case "object": {
      if (seen.has(value as object)) return CIRCULAR_PLACEHOLDER;
      seen.add(value as object);
      if (Array.isArray(value)) {
        const items = value.map((item) => jsonSafe(item, seen));
        seen.delete(value as object);
        return items;
      }
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value)) {
        const safe = jsonSafe(entry, seen);
        if (safe !== undefined) {
          out[key] = safe; // matches JSON.stringify: undefined keys are dropped
        }
      }
      seen.delete(value as object);
      return out;
    }
  }
}

/**
 * Serializes any record to one JSON line without ever throwing: the record is
 * sanitized to a JSON-safe structure first, so `JSON.stringify` cannot fail
 * (no cycles, no bigint, no functions, no symbols survive sanitization).
 */
export function safeStringify(record: LogRecord): string {
  return JSON.stringify(jsonSafe(record, new Set<object>())) as string;
}

function mergeBindings(parent: BoundFields, bindings: Partial<LogRecord>): BoundFields {
  const merged: BoundFields = { ...parent };
  if (bindings.sessionId !== undefined) merged.sessionId = bindings.sessionId;
  if (bindings.correlationId !== undefined) merged.correlationId = bindings.correlationId;
  if (bindings.traceId !== undefined) merged.traceId = bindings.traceId;
  if (bindings.stage !== undefined) merged.stage = bindings.stage;
  if (bindings.fields !== undefined) merged.fields = { ...bindings.fields };
  return merged;
}

function makeLogger(options: LoggerOptions, bound: BoundFields): Logger {
  const minWeight = LEVEL_WEIGHT[options.minLevel ?? "info"];
  const sink = options.sink ?? defaultSink;
  const now = options.now ?? Date.now;

  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_WEIGHT[level] < minWeight) return;
    const record: LogRecord = { ts: now(), level, msg };
    if (bound.sessionId !== undefined) record.sessionId = bound.sessionId;
    if (bound.correlationId !== undefined) record.correlationId = bound.correlationId;
    if (bound.traceId !== undefined) record.traceId = bound.traceId;
    if (bound.stage !== undefined) record.stage = bound.stage;
    const mergedFields =
      bound.fields === undefined && fields === undefined
        ? undefined
        : { ...bound.fields, ...fields };
    if (mergedFields !== undefined && Object.keys(mergedFields).length > 0) {
      record.fields = mergedFields;
    }
    sink(safeStringify(record));
  };

  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    child: (bindings) => makeLogger(options, mergeBindings(bound, bindings)),
  };
}

/**
 * Creates a structured logger. Each level method emits exactly one JSON line
 * to the sink when the level passes `minLevel` filtering.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  return makeLogger(options, {});
}
