/**
 * The telemetry sink port (W706) — the injectable seam telemetry flows into.
 *
 * A sink is DELIBERATELY minimal: `record(event): void`. No network in the
 * port, no batching timers, no async — sinks are synchronous, deterministic,
 * and can never block the viewer (the emitter — `./telemetry.ts` — guards
 * every `record` call, so a throwing or failing sink degrades to a counted
 * drop, never a viewer failure; the W007 logger principle: observability
 * must never take the product down).
 *
 * Implementations in this package:
 *
 * - `./telemetry-sink.ts` — {@link createInMemoryTelemetrySink}: the
 *   in-memory test sink (ordered, cloned, validating).
 * - `./telemetry-file-sink.ts` — `createJsonlTelemetryFileSink`: the
 *   structured-JSON-lines FILE sink under a declared path (node-only;
 *   deterministic buffered writes + explicit `flush`/`close`, no timers).
 * - `./telemetry-http-sink.ts` — the browser-safe bridge that POSTs each
 *   event to the dev viewer server's `/telemetry` route (which writes
 *   through the real file sink); dev-grade, fire-and-forget, ordered by an
 *   internal chain, failures counted.
 *
 * EVERY sink validates ({@link parseTelemetryEvent}) before storing — the
 * schema boundary is the privacy boundary, so no sink can be made to
 * persist an out-of-vocabulary event (a policy, artifact bytes, a
 * free-form record). Validation failures throw fail-loud to the CALLER
 * (the emitter guards its own emissions; the dev-server route answers a
 * typed 400 to a client that sends garbage).
 */
import type { ViewerTelemetryEvent } from "./telemetry-events.ts";
import { parseTelemetryEvent } from "./telemetry-events.ts";

/** The telemetry sink port (see the module docs). */
export interface TelemetrySink {
  /**
   * Records one VALIDATED event. Implementations MUST validate the event
   * (fail-loud `RangeError` naming the schema violation) and store it in
   * call order.
   */
  record(event: ViewerTelemetryEvent): void;
}

/** The in-memory sink (tests, and any host that wants the events locally). */
export interface InMemoryTelemetrySink extends TelemetrySink {
  /** The recorded events, in record order (cloned — callers keep ownership of the objects they pass). */
  readonly events: readonly ViewerTelemetryEvent[];
}

/**
 * Creates the in-memory test sink. Each accepted event is stored as a
 * structured clone (the caller mutating its object afterwards cannot
 * retroactively change what was recorded — the same isolation posture as
 * the capture store's deep clones).
 */
export function createInMemoryTelemetrySink(): InMemoryTelemetrySink {
  const events: ViewerTelemetryEvent[] = [];
  return {
    events,
    record(event: ViewerTelemetryEvent): void {
      const parsed = parseTelemetryEvent(event);
      if (!parsed.ok) {
        throw new RangeError(`in-memory telemetry sink rejected an event: ${parsed.reason}`);
      }
      events.push(structuredClone(event));
    },
  };
}
