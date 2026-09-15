/**
 * Test helpers (W804): the constructed REAL-shaped stream builder.
 *
 * Every event a `Stream` mints is a VALID W706 viewer telemetry event — the
 * analytics input gate re-validates through the REAL
 * `@sporta/viewer-shell` validator on every compute call, so a helper that
 * produced an invalid shape would fail the very tests using it (the builder
 * is honest by construction: exact keys, closed vocabularies, monotonic
 * 1-based `sequence`, `atMs` in an explicit deterministic injected-clock
 * domain — `TEST_EPOCH_MS` from `@sporta/testing`, advanced by event count;
 * never a wall-clock read).
 */
import { REMEDIATION_HINTS } from "@sporta/viewer-shell";
import type {
  TimedOperation,
  UserFeedbackKind,
  ViewerFailureClass,
  ViewerOperation,
  ViewerStatus,
  ViewerTelemetryEvent,
} from "@sporta/viewer-shell";
import { TEST_EPOCH_MS } from "@sporta/testing";

/** The deterministic injected clock step per minted event (ms). */
const AT_MS_STEP = 10;

/**
 * The stream builder: mints valid W706 events with a monotonic 1-based
 * `sequence` (the per-run counter convention) and a deterministic `atMs`
 * (`TEST_EPOCH_MS + (sequence - 1) * 10`). Accumulates `events` in mint
 * order — the authoritative total order (FUNNEL.md §7).
 */
export class Stream {
  private sequence = 0;
  readonly events: ViewerTelemetryEvent[] = [];

  private envelope(sessionId: string | null): {
    schemaVersion: 1;
    sequence: number;
    atMs: number;
    sessionId: string | null;
  } {
    this.sequence += 1;
    return {
      schemaVersion: 1,
      sequence: this.sequence,
      atMs: TEST_EPOCH_MS + (this.sequence - 1) * AT_MS_STEP,
      sessionId,
    };
  }

  /** One state-machine transition (`from !== to`, both known statuses). */
  transition(from: ViewerStatus, to: ViewerStatus, sessionId: string | null = null): this {
    this.events.push({ ...this.envelope(sessionId), kind: "state-transition", from, to });
    return this;
  }

  /** One timed operation on the injected clock (success path). */
  timing(operation: TimedOperation, durationMs: number, sessionId: string | null = null): this {
    this.events.push({
      ...this.envelope(sessionId),
      kind: "operation-timing",
      operation,
      durationMs,
    });
    return this;
  }

  /** One surfaced failure (the typed error model, verbatim class + message). */
  failure(
    operation: ViewerOperation,
    failureClass: ViewerFailureClass,
    message = `crafted ${failureClass} failure for ${operation}`,
    sessionId: string | null = null,
  ): this {
    this.events.push({
      ...this.envelope(sessionId),
      kind: "error-occurred",
      operation,
      failureClass,
      message,
      remediationHint: REMEDIATION_HINTS[failureClass],
    });
    return this;
  }

  /** One honest playback stall episode. */
  stall(
    facts: { frameIndex: number; frameCount: number; availableFrames: number },
    sessionId: string | null = null,
  ): this {
    this.events.push({ ...this.envelope(sessionId), kind: "rebuffer-stall", ...facts });
    return this;
  }

  /** One passed client-side integrity check. */
  integrity(
    facts: { byteLength: number; frameCount: number },
    sessionId: string | null = null,
  ): this {
    this.events.push({ ...this.envelope(sessionId), kind: "integrity-verified", ...facts });
    return this;
  }

  /** One structured user feedback signal. */
  feedback(feedback: UserFeedbackKind, sessionId: string | null = null): this {
    this.events.push({ ...this.envelope(sessionId), kind: "user-feedback", feedback });
    return this;
  }

  /** Pushes an ALREADY-built event (for hand-crafted anomaly cases). */
  raw(event: ViewerTelemetryEvent): this {
    this.events.push(event);
    return this;
  }
}

/** The cohort establishment: `openSession` succeeded (`browsing-sessions → session-detail`). */
export function establish(stream: Stream, sessionId: string): void {
  stream.transition("browsing-sessions", "session-detail", sessionId);
}

/** The connect flow's transitions (viewer-scoped: no session id). */
export function connectAttempt(stream: Stream, outcome: "success" | "error"): void {
  stream.transition("disconnected", "connecting");
  if (outcome === "success") {
    stream.transition("connecting", "browsing-sessions");
  }
}
