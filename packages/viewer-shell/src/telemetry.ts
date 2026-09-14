/**
 * The viewer telemetry emitter (W706) — the ONLY code path that builds and
 * dispatches telemetry events, wired into `createViewerCore` at the real
 * lifecycle moments (see `./viewer-core.ts`).
 *
 * Determinism (constitution):
 *
 * - the event id (`sequence`) is a 1-based deterministic counter — never a
 *   uuid, never wall-clock-derived;
 * - `atMs` comes from the INJECTED clock the emitter is constructed with
 *   (the viewer core passes its own clock; the browser bootstrap injects
 *   `performance.now` — the W702 DOM-edge precedent);
 * - the same command script over the same clock and sink yields a
 *   deep-equal event trace (test-pinned).
 *
 * Robustness: telemetry must never take the viewer down (the W007 logger
 * principle). Every emit validates its own event through the schema
 * validator BEFORE sinking, and every sink call is guarded — an invalid
 * event or a throwing sink is COUNTED in {@link ViewerTelemetry.status},
 * never thrown to the caller. A host-facing sink that receives garbage
 * still throws fail-loud (the sink owns that boundary); the emitter simply
 * never lets its own failures escape.
 *
 * Correlation: `setSessionId` carries the OPAQUE control-plane session id
 * (`sess-<n>`) on every event while a session is open — the viewer's
 * existing opaque-id conventions; no user identifiers exist in this model.
 */
import type { TelemetrySink } from "./telemetry-sink.ts";
import { parseTelemetryEvent } from "./telemetry-events.ts";
import { REMEDIATION_HINTS } from "./telemetry-events.ts";
import { isViewerOperation } from "./telemetry-events.ts";
import type { TelemetryEventCommon } from "./telemetry-events.ts";
import type {
  ErrorOccurredEvent,
  IntegrityVerifiedEvent,
  OperationTimingEvent,
  RebufferStallEvent,
  StateTransitionEvent,
  TelemetryEventKind,
  TimedOperation,
  UserFeedbackEvent,
  UserFeedbackKind,
  ViewerTelemetryEvent,
} from "./telemetry-events.ts";
import type { ErrorView, ViewerFailureClass } from "./errors.ts";
import type { ViewerStatus } from "./viewer-core.ts";

/** Options for {@link createViewerTelemetry}. */
export interface ViewerTelemetryOptions {
  /** The sink every validated event is recorded into. */
  sink: TelemetrySink;
  /** The injected time source (ms) — the viewer core's clock. */
  nowMs: () => number;
}

/** The emitter's health snapshot (surfaced for tests + the plan layer). */
export interface ViewerTelemetryStatus {
  /** Events successfully recorded into the sink. */
  emitted: number;
  /** Events dropped (invalid at the schema boundary, or the sink threw). */
  dropped: number;
  /** The first drop's reason, verbatim (null when none). */
  dropReason: string | null;
}

/** The emitter surface (see the module docs). */
export interface ViewerTelemetry {
  /** Records a viewer state-machine transition (from !== to). */
  stateTransition(from: ViewerStatus, to: ViewerStatus): void;
  /** Records a timed operation (duration measured on the injected clock). */
  operationTiming(operation: TimedOperation, durationMs: number): void;
  /** Records a surfaced failure (from the typed error model, verbatim class/message + the remediation hint). */
  errorOccurred(error: ErrorView): void;
  /** Records one honest playback stall episode (the frame player's buffering seam). */
  rebufferStall(facts: { frameIndex: number; frameCount: number; availableFrames: number }): void;
  /** Records a passed client-side integrity check (the real W504 playback seam). */
  integrityVerified(facts: { byteLength: number; frameCount: number }): void;
  /** Records an explicit, structured USER feedback signal (closed kinds). */
  userFeedback(feedback: UserFeedbackKind): void;
  /** Sets the opaque correlation session id (null when no session is open). */
  setSessionId(sessionId: string | null): void;
  /** The emitter health snapshot (see {@link ViewerTelemetryStatus}). */
  status(): ViewerTelemetryStatus;
}

/** Creates the emitter (see the module docs). */
export function createViewerTelemetry(options: ViewerTelemetryOptions): ViewerTelemetry {
  const sink = options.sink;
  const nowMs = options.nowMs;
  let sequence = 0;
  let sessionId: string | null = null;
  let emitted = 0;
  let dropped = 0;
  let dropReason: string | null = null;

  /** Dispatch: validate, then sink, counting drops — never throwing. */
  function dispatch(event: ViewerTelemetryEvent): void {
    const parsed = parseTelemetryEvent(event);
    if (!parsed.ok) {
      dropped += 1;
      if (dropReason === null) dropReason = parsed.reason;
      return;
    }
    try {
      sink.record(event);
      emitted += 1;
    } catch (err) {
      dropped += 1;
      if (dropReason === null) {
        dropReason = `sink failure: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }

  /** Stamps the common envelope (the deterministic id + clock domain). */
  function envelope<K extends TelemetryEventKind>(kind: K): TelemetryEventCommon & { kind: K } {
    sequence += 1;
    return {
      schemaVersion: 1,
      kind,
      sequence,
      atMs: nowMs(),
      sessionId,
    };
  }

  const telemetry: ViewerTelemetry = {
    stateTransition(from: ViewerStatus, to: ViewerStatus): void {
      const base = envelope("state-transition");
      const event: StateTransitionEvent = { ...base, from, to };
      dispatch(event);
    },

    operationTiming(operation: TimedOperation, durationMs: number): void {
      const base = envelope("operation-timing");
      const event: OperationTimingEvent = { ...base, operation, durationMs };
      dispatch(event);
    },

    errorOccurred(error: ErrorView): void {
      // Closed vocabulary: an operation outside the known set is dropped
      // (counted) rather than carried as free text — the privacy scope.
      if (!isViewerOperation(error.operation)) {
        dropped += 1;
        if (dropReason === null) {
          dropReason = `unknown operation '${error.operation}' is not in the telemetry vocabulary`;
        }
        return;
      }
      const base = envelope("error-occurred");
      const event: ErrorOccurredEvent = {
        ...base,
        operation: error.operation,
        failureClass: error.failureClass,
        message: error.message,
        remediationHint: remediationOf(error.failureClass),
      };
      dispatch(event);
    },

    rebufferStall(facts: {
      frameIndex: number;
      frameCount: number;
      availableFrames: number;
    }): void {
      const base = envelope("rebuffer-stall");
      const event: RebufferStallEvent = { ...base, ...facts };
      dispatch(event);
    },

    integrityVerified(facts: { byteLength: number; frameCount: number }): void {
      const base = envelope("integrity-verified");
      const event: IntegrityVerifiedEvent = { ...base, ...facts };
      dispatch(event);
    },

    userFeedback(feedback: UserFeedbackKind): void {
      const base = envelope("user-feedback");
      const event: UserFeedbackEvent = { ...base, feedback };
      dispatch(event);
    },

    setSessionId(id: string | null): void {
      sessionId = id;
    },

    status(): ViewerTelemetryStatus {
      return { emitted, dropped, dropReason };
    },
  };
  return telemetry;
}

/** The remediation hint for a failure class (from the one table). */
function remediationOf(failureClass: ViewerFailureClass): string {
  return REMEDIATION_HINTS[failureClass];
}
