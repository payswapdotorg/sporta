/**
 * The structured-JSON-lines telemetry FILE sink (W706) — NODE-ONLY (this
 * module imports `node:fs`/`node:path`, exactly like `./serve.ts`; it is
 * NOT part of the browser ES-module graph).
 *
 * Semantics (deterministic, explicit — see TELEMETRY.md §4):
 *
 * - **No network, no timers, no batching by time.** `record` validates the
 *   event ({@link parseTelemetryEvent} — the privacy boundary; garbage
 *   throws fail-loud) and appends its serialized JSON line to an ordered
 *   in-memory buffer. NOTHING is on disk yet.
 * - **`flush()` is the explicit write**: all buffered lines are appended to
 *   the declared path in ONE `appendFileSync` (each line terminated `\n`),
 *   in record order; the return value reports how many lines THIS flush
 *   wrote. Flushing an empty buffer writes nothing (`{ linesWritten: 0 }`).
 * - **`close()`** flushes then SEALS the sink: a later `record` throws
 *   fail-loud (closing is a lifecycle decision, never a silent drop).
 *   `close`/`flush` after close are idempotent.
 * - The declared path's parent directories are created at construction
 *   (`mkdir -p`); the file itself is created by the FIRST flush that has
 *   lines. Single-writer assumption: two sinks on one path interleave at
 *   flush granularity (each flush is one ordered append) — documented, the
 *   dev host uses exactly one.
 * - The event `sequence` (assigned by the emitter) is the authoritative
 *   total order; file line order equals record order for this sink.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { TelemetrySink } from "./telemetry-sink.ts";
import { parseTelemetryEvent, serializeTelemetryEvent } from "./telemetry-events.ts";
import type { ViewerTelemetryEvent } from "./telemetry-events.ts";

/** The file sink surface (see the module docs for the flush/close semantics). */
export interface JsonlTelemetryFileSink extends TelemetrySink {
  /**
   * Writes every buffered line (one ordered append), returning how many
   * lines THIS flush wrote. Explicit, synchronous, idempotent.
   */
  flush(): { linesWritten: number };
  /** Flushes, then seals the sink (later `record` throws). Idempotent. */
  close(): { linesWritten: number };
  /** The sink's status (path + buffer/line counters — no event contents). */
  status(): { path: string; buffered: number; linesWritten: number };
}

/** Options for {@link createJsonlTelemetryFileSink}. */
export interface JsonlTelemetryFileSinkOptions {
  /** The declared JSONL path (parent directories are created as needed). */
  path: string;
}

/** Creates the JSONL file sink (see the module docs). */
export function createJsonlTelemetryFileSink(
  options: JsonlTelemetryFileSinkOptions,
): JsonlTelemetryFileSink {
  const path = options.path;
  mkdirSync(dirname(path), { recursive: true });
  const buffer: string[] = [];
  let linesWritten = 0;
  let closed = false;

  function flush(): { linesWritten: number } {
    if (buffer.length === 0) return { linesWritten: 0 };
    const chunk = buffer.join("");
    appendFileSync(path, chunk);
    const written = buffer.length;
    buffer.length = 0;
    linesWritten += written;
    return { linesWritten: written };
  }

  return {
    record(event: ViewerTelemetryEvent): void {
      if (closed) {
        throw new RangeError(
          "telemetry file sink is closed — recording after close is a lifecycle error (never a silent drop)",
        );
      }
      const parsed = parseTelemetryEvent(event);
      if (!parsed.ok) {
        throw new RangeError(`telemetry file sink rejected an event: ${parsed.reason}`);
      }
      buffer.push(`${serializeTelemetryEvent(event)}\n`);
    },
    flush,
    close(): { linesWritten: number } {
      closed = true;
      return flush();
    },
    status(): { path: string; buffered: number; linesWritten: number } {
      return { path, buffered: buffer.length, linesWritten };
    },
  };
}
