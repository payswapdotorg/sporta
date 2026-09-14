/**
 * The HTTP telemetry bridge sink (W706) — BROWSER-SAFE (part of the served
 * ES-module graph: only relative imports + type-only `@sporta/*` imports +
 * the platform `fetch`).
 *
 * The honest composition (the W705 "real provider through the same-origin
 * proxy" pattern, mirrored for telemetry): the browser CANNOT write the
 * JSONL file itself, so this sink POSTs each event to the DEV viewer
 * server's own `/telemetry` route — which records it into the REAL file
 * sink under a declared path (see `./serve.ts`). DEV-GRADE, honestly
 * labeled: the route is local, unauthenticated (the W701 trust boundary is
 * inherited — the caller-supplied policy is the only trust boundary), and
 * exists so a real browser session leaves the same evidence the headless
 * tests produce. A production deployment replaces this sink behind the
 * same port (or drops the browser sink entirely) — the port, not the
 * transport, is the contract.
 *
 * Behavior:
 *
 * - `record(event): void` stays SYNCHRONOUS per the port: the event is
 *   validated locally (garbage throws fail-loud to the caller BEFORE any
 *   wire traffic — the emitter guards its own calls, so this never breaks
 *   the viewer), then enqueued on an internal ordered chain and POSTed
 *   one-event-per-request. No batching timers, no sampling.
 * - The chain guarantees POST DISPATCH order = record order (arrival order
 *   at the dev server follows it on a single connection); the event's
 *   `sequence` remains the authoritative total order regardless.
 * - Fire-and-forget with HONEST accounting: transport failures (non-2xx
 *   answers, network errors, and SYNCHRONOUS throws from the fetch seam —
 *   e.g. a fetch that rejects an invalid URL before returning a promise)
 *   are COUNTED in {@link HttpTelemetrySink.status} with the last failure
 *   reason — never thrown (telemetry must never take the viewer down),
 *   never retried (no retry timers by design), and never allowed to
 *   poison the dispatch chain (a sync throw is one counted failure; the
 *   next event dispatches normally — test-pinned).
 */
import { parseTelemetryEvent, serializeTelemetryEvent } from "./telemetry-events.ts";
import type { ViewerTelemetryEvent } from "./telemetry-events.ts";
import type { TelemetrySink } from "./telemetry-sink.ts";
import type { FetchLike } from "./http-client.ts";

/** The bridge sink's health snapshot (surfaced for tests + diagnostics). */
export interface HttpTelemetrySinkStatus {
  /** Events dispatched to the wire (in record order). */
  posted: number;
  /** Dispatches that failed (non-2xx or network error). */
  failed: number;
  /** The last failure reason, verbatim (null when none). */
  lastFailure: string | null;
}

/** The bridge sink surface (see the module docs). */
export interface HttpTelemetrySink extends TelemetrySink {
  status(): HttpTelemetrySinkStatus;
}

/** Options for {@link createHttpTelemetrySink}. */
export interface HttpTelemetrySinkOptions {
  /**
   * Base URL of the dev viewer server's telemetry route (same-origin
   * relative URL `"/telemetry"` is what the bootstrap passes).
   */
  baseUrl: string;
  /** Fetch seam (defaults to the platform `fetch`; injectable for tests). */
  fetch?: FetchLike;
  /** Request-id factory (default: deterministic per-sink `viewer-tel-<n>`). */
  requestId?: () => string;
}

/** Creates the HTTP telemetry bridge sink (see the module docs). */
export function createHttpTelemetrySink(options: HttpTelemetrySinkOptions): HttpTelemetrySink {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  let seq = 0;
  const nextRequestId = options.requestId ?? ((): string => `viewer-tel-${(seq += 1)}`);
  let posted = 0;
  let failed = 0;
  let lastFailure: string | null = null;
  // The ordered dispatch chain: each POST starts only after the previous
  // one settled (order guarantee; no timers — failures resolve immediately).
  let chain: Promise<void> = Promise.resolve();

  function postOne(event: ViewerTelemetryEvent): Promise<void> {
    let request: Promise<Response>;
    try {
      request = doFetch(`${baseUrl}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-request-id": nextRequestId(),
        },
        body: serializeTelemetryEvent(event),
      });
    } catch (err) {
      // A SYNCHRONOUS throw from the fetch seam (e.g. an invalid URL, or a
      // custom injected fetch that throws before returning a promise) must
      // not poison the dispatch chain: it is one counted transport failure
      // and the chain stays resolved, so the NEXT event still dispatches
      // (test-pinned — the never-take-the-viewer-down principle).
      failed += 1;
      lastFailure = `telemetry post threw: ${err instanceof Error ? err.message : String(err)}`;
      return Promise.resolve();
    }
    return request
      .then((response: Response) => {
        if (!response.ok) {
          failed += 1;
          lastFailure = `telemetry route answered status ${String(response.status)}`;
        } else {
          posted += 1;
        }
      })
      .catch((err: unknown) => {
        failed += 1;
        lastFailure = `telemetry post failed: ${err instanceof Error ? err.message : String(err)}`;
      });
  }

  return {
    record(event: ViewerTelemetryEvent): void {
      const parsed = parseTelemetryEvent(event);
      if (!parsed.ok) {
        // Fail-loud to the CALLER before any wire traffic (the emitter
        // guards its own emissions; a host sending garbage learns it here).
        throw new RangeError(`http telemetry sink rejected an event: ${parsed.reason}`);
      }
      chain = chain.then(() => postOne(event));
    },
    status(): HttpTelemetrySinkStatus {
      return { posted, failed, lastFailure };
    },
  };
}
