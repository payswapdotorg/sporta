/**
 * The W804 input boundary — THE privacy pin.
 *
 * Product analytics consumes RECORDED W706 viewer telemetry event streams
 * (the `@sporta/viewer-shell` event model, schema version 1). The W706
 * validator (`parseTelemetryEvent` — exact-key allowlists, closed
 * vocabularies, scalar-only shapes) is the ONE gate through which events
 * enter: a wider event (any extra key — a policy, a payload, a user id, a
 * free-form record) fails with W706's own rejection reason, LOUDLY. Analytics
 * never re-implements the schema, so it can never drift wider than W706.
 *
 * What this means for the privacy posture (FUNNEL.md §2):
 *
 * - analytics MAY see: the closed W706 vocabulary — state transitions,
 *   operation timings, failure classes + the bounded error message +
 *   remediation hints, rebuffer-stall counts, integrity facts, the closed
 *   feedback kinds, and the OPAQUE session id (`sess-<n>`) correlation;
 * - analytics may NEVER see: authorization policies, media/artifact content,
 *   source-frame references, renderer payloads, free-form user text, user
 *   identifiers — unrepresentable in the input, rejected by name here.
 *
 * The REPORT goes further (test-pinned): no session ids and no error messages
 * cross into the report — the report is aggregate-only over the closed
 * vocabulary.
 */
import { parseTelemetryEvent, parseTelemetryLine } from "@sporta/viewer-shell";
import type { ViewerTelemetryEvent } from "@sporta/viewer-shell";
import { AnalyticsInputError } from "./errors.ts";

/**
 * Validates ONE recorded value against the REAL W706 event schema. Returns
 * the event, or throws {@link AnalyticsInputError} carrying the W706
 * validator's rejection reason VERBATIM (the privacy boundary's teeth:
 * wider events fail by name).
 */
export function validateRecordedEvent(value: unknown, index: number): ViewerTelemetryEvent {
  const parsed = parseTelemetryEvent(value);
  if (!parsed.ok) {
    throw new AnalyticsInputError(
      `recorded event at index ${String(index)} is not a valid W706 telemetry event: ${parsed.reason}`,
      index,
      parsed.reason,
    );
  }
  return parsed.event;
}

/**
 * Parses + validates a recorded event stream (parsed JSON values, e.g. the
 * lines of a W706 JSONL recording). The array's order is the AUTHORITATIVE
 * total order (a JSONL reader supplies line order — the file sink guarantees
 * line order equals record order; the `sequence` field is the per-run
 * counter). Fails loud on the FIRST invalid value: analytics never computes
 * over a partial or widened stream.
 */
export function parseRecordedEvents(values: readonly unknown[]): ViewerTelemetryEvent[] {
  return values.map((value, index) => validateRecordedEvent(value, index));
}

/**
 * Parses + validates the lines of a W706 JSONL recording (one compact JSON
 * line per event — the `telemetry-file-sink` wire form). Blank lines are
 * rejected (a recording line is never blank); the 1-based line number is
 * carried in the error.
 */
export function parseRecordedJsonl(lines: readonly string[]): ViewerTelemetryEvent[] {
  const events: ViewerTelemetryEvent[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      throw new AnalyticsInputError(
        `recorded JSONL line ${String(index + 1)} is blank — a W706 recording line is never blank`,
        index,
        "blank line",
      );
    }
    const parsed = parseTelemetryLine(trimmed);
    if (!parsed.ok) {
      throw new AnalyticsInputError(
        `recorded JSONL line ${String(index + 1)} is not a valid W706 telemetry event: ${parsed.reason}`,
        index,
        parsed.reason,
      );
    }
    events.push(parsed.event);
  }
  return events;
}
