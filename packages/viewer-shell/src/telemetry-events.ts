/**
 * The W706 viewer telemetry event vocabulary — a versioned, TYPED, validated,
 * privacy-scoped-by-construction event model for the viewer's lifecycle
 * moments (see `TELEMETRY.md` for the full privacy-scope decision).
 *
 * PRINCIPLE — PRIVACY BY CONSTRUCTION: every event kind is a CLOSED shape.
 * The schema (the {@link parseTelemetryEvent} validator + the exported key
 * allowlists) accepts EXACTLY the declared fields and rejects every other
 * key, so an event CANNOT carry an authorization policy, media content,
 * source-frame data, a renderer payload, a free-form details record, or any
 * user identifier — those fields are unrepresentable, not merely discouraged.
 * The only free-form string in the vocabulary is the error `message`, which
 * by construction comes from the viewer's typed error model
 * (`./errors.ts` — `ErrorView.message`), and it is bounded (length sanity
 * check). Correlation uses OPAQUE ids only: the control-plane session id
 * (`sess-<n>`) when a session is open — the same id family the control
 * client's `x-request-id`/session conventions already use. Timestamps
 * (`atMs`) live in the viewer's INJECTED clock domain (the deterministic
 * epoch counter in tests, `performance.now()` in the browser) — never a
 * wall-clock read.
 *
 * W804 BOUNDARY (documented decision): W804 "product analytics" is the LATER
 * owner of product-funnel metrics. These events are the RAW MATERIAL a
 * future analytics layer may aggregate — this module deliberately contains
 * NO aggregation, no funnels, no user/session counting beyond the event
 * vocabulary itself.
 *
 * Schema versioning: `schemaVersion: 1`. Any vocabulary change (a new kind,
 * a new field, a removed field) bumps the version and is recorded in
 * `TELEMETRY.md`; consumers reject other versions fail-loud.
 *
 * DROPPED-FRAME HONESTY: no event kind carries a "dropped frames" fact —
 * neither batch player drops frames (the frame player STALLS at a missing
 * frame and re-syncs on arrival — `./player.ts`; the SMIL segment player's
 * document is complete at load — `./segment-player.ts`), and the live
 * player never drops either (W305's transport accounts every skip itself;
 * the viewer consumes the accounted stream — `./live-player.ts`), so a
 * dropped-frame signal does not exist at the real seams and is not
 * invented. The honest equivalent is the `rebuffer-stall` event (a stall
 * episode while playing — batch frame player and live player alike).
 */
import type { ViewerStatus } from "./viewer-core.ts";
import { isViewerFailureClass } from "./errors.ts";
import type { ViewerFailureClass } from "./errors.ts";

/**
 * The telemetry schema version. Bumped on every vocabulary change; the
 * validator rejects any other value (an unknown version is never guessed).
 */
export const TELEMETRY_SCHEMA_VERSION = 1;

/**
 * The runtime list of viewer statuses an event may carry (compiled from the
 * `ViewerStatus` union — the two `never` checks below pin the mirror against
 * the viewer-core type at COMPILE time, so the list can never drift).
 */
export const TELEMETRY_VIEWER_STATUSES = [
  "disconnected",
  "connecting",
  "browsing-sessions",
  "session-detail",
  "renderer-selection",
  "render-queued",
  "loading-output",
  "outputs-pending",
  "ready",
  "playing",
  "paused",
  "ended",
  "live-connecting",
  "live-playing",
  "live-reconnecting",
  "live-ended",
  "error",
] as const;

// Compile-time exhaustiveness pins (both directions — no missing member, no
// extra member). `import type` keeps this module free of a runtime cycle.
type _StatusesAreExactlyViewerStatus = Exclude<
  ViewerStatus,
  (typeof TELEMETRY_VIEWER_STATUSES)[number]
>;
const _statusesExactlyViewerStatus: _StatusesAreExactlyViewerStatus[] = [];
type _ViewerStatusAreExactlyStatuses = Exclude<
  (typeof TELEMETRY_VIEWER_STATUSES)[number],
  ViewerStatus
>;
const _viewerStatusExactlyStatuses: _ViewerStatusAreExactlyStatuses[] = [];
void _statusesExactlyViewerStatus;
void _viewerStatusExactlyStatuses;

/**
 * The closed set of viewer operations telemetry knows about — EXACTLY the
 * `run("...")` operation names `./viewer-core.ts` dispatches (the set is
 * pinned against the source by test: adding a `run()` operation without
 * extending this vocabulary would drop its error events; a stale entry
 * fails the same pin). Unknown operations are DROPPED (counted by the
 * emitter), never carried as free text — a closed vocabulary is part of the
 * privacy scope.
 */
export const TELEMETRY_OPERATIONS = [
  "connect",
  "refreshSessions",
  "createSession",
  "openSession",
  "terminateSession",
  "beginRender",
  "createRender",
  "selectRender",
  "openLive",
] as const;

/** One of the closed viewer operation names (see {@link TELEMETRY_OPERATIONS}). */
export type ViewerOperation = (typeof TELEMETRY_OPERATIONS)[number];

/** Type guard: `true` when `value` is a known viewer operation. */
export function isViewerOperation(value: unknown): value is ViewerOperation {
  return typeof value === "string" && (TELEMETRY_OPERATIONS as readonly string[]).includes(value);
}

/**
 * The operations whose durations are timed on the injected clock (the
 * startup-timing events). Extension = add here AND to the event validator.
 */
export const TELEMETRY_TIMED_OPERATIONS = ["connect", "load-output", "openLive"] as const;

/** One of the timed operations (see {@link TELEMETRY_TIMED_OPERATIONS}). */
export type TimedOperation = (typeof TELEMETRY_TIMED_OPERATIONS)[number];

/**
 * Remediation hints — ONE per failure class, the viewer-owned guidance that
 * travels with every `error-occurred` event (mirrors `FAILURE_CLASS_LABELS`:
 * one table, test-pinned for every class). Derived from the failure class,
 * never free text.
 */
export const REMEDIATION_HINTS: Readonly<Record<ViewerFailureClass, string>> = {
  "rights-denied":
    "This session's authorization policy does not allow the operation. Open a session with a policy that grants it, or ask the operator to extend the policy.",
  "media-invalid":
    "The request or the stored output was rejected as invalid. Try a different renderer/profile or re-render; if it persists, the artifact may be corrupt.",
  validation:
    "The request did not pass validation. Check the inputs (renderer id, profile, policy document) and retry.",
  "resource-limit":
    "A resource limit was hit. This is usually transient — retry in a moment or reduce the request size.",
  internal:
    "The server reported an internal fault. Retrying may clear it; if it persists, contact the operator.",
  "unknown-session":
    "The session no longer exists. Refresh the session list and open a session that exists.",
  "unknown-render":
    "The render no longer exists. Refresh the session detail and select a render that exists.",
  "unknown-segment":
    "The stored output segment no longer exists. Refresh the session detail and reload the render.",
  "unknown-route":
    "The viewer requested a route the server does not serve. This is a client/server version mismatch — reload the viewer.",
  "method-not-allowed":
    "The HTTP method was wrong for the route. This is a client/server version mismatch — reload the viewer.",
  network:
    "The control server could not be reached. Check that it is running and your connection, then retry.",
  "unsupported-output":
    "The render's output is not playable by this viewer yet. Pick a renderer whose output this viewer supports.",
};

/** Type guard: `true` when `value` is one of the table's remediation hints. */
function isRemediationHint(value: unknown): boolean {
  if (typeof value !== "string") return false;
  for (const hint of Object.values(REMEDIATION_HINTS)) {
    if (hint === value) return true;
  }
  return false;
}

/**
 * The structured USER feedback kinds (W706): a closed vocabulary the
 * playback-feedback affordance offers (see `./telemetry-plan.ts`). NEVER a
 * free-form text field — the boundary is the kind itself; anything the user
 * would "say" beyond this vocabulary is intentionally NOT collectable.
 */
export const USER_FEEDBACK_KINDS = ["playback-good", "playback-stalled", "playback-poor"] as const;

/** One of the structured user feedback kinds. */
export type UserFeedbackKind = (typeof USER_FEEDBACK_KINDS)[number];

/** Type guard: `true` when `value` is a known feedback kind. */
export function isUserFeedbackKind(value: unknown): value is UserFeedbackKind {
  return typeof value === "string" && (USER_FEEDBACK_KINDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The event union (closed shapes — no record/array fields anywhere)
// ---------------------------------------------------------------------------

/** The common envelope of every telemetry event (all fields scalar). */
export interface TelemetryEventCommon {
  /** The vocabulary version (see {@link TELEMETRY_SCHEMA_VERSION}). */
  schemaVersion: typeof TELEMETRY_SCHEMA_VERSION;
  /** The kind discriminator (see {@link TELEMETRY_EVENT_KINDS}). */
  kind: TelemetryEventKind;
  /**
   * The event id: a 1-based deterministic counter assigned by the emitter
   * (never a uuid, never wall-clock-derived). Events are totally ordered by
   * it — including across the dev-grade HTTP bridge, where file line order
   * is only arrival order (see TELEMETRY.md §4).
   */
  sequence: number;
  /** Emission time in the viewer's INJECTED clock domain (ms). */
  atMs: number;
  /**
   * The OPAQUE control-plane session id (`sess-<n>`) when one is open, else
   * `null`. Correlation only — never a user identifier, never a policy.
   */
  sessionId: string | null;
}

/** A viewer state-machine transition (the lifecycle spine). */
export interface StateTransitionEvent extends TelemetryEventCommon {
  kind: "state-transition";
  from: ViewerStatus;
  to: ViewerStatus;
}

/** A timed operation measured on the injected clock (startup timing). */
export interface OperationTimingEvent extends TelemetryEventCommon {
  kind: "operation-timing";
  operation: TimedOperation;
  /** `>= 0`, measured from the injected clock (begin → success). */
  durationMs: number;
}

/** A surfaced viewer failure (from the typed error model — see module docs). */
export interface ErrorOccurredEvent extends TelemetryEventCommon {
  kind: "error-occurred";
  /** The failing viewer operation (closed vocabulary). */
  operation: ViewerOperation;
  /** The classification, verbatim from the typed error model. */
  failureClass: ViewerFailureClass;
  /**
   * The verbatim message from the typed error model (`ErrorView.message`),
   * bounded in length by the validator. The ONLY free-form string in the
   * vocabulary, by decision (see TELEMETRY.md §2).
   */
  message: string;
  /** The viewer-owned remediation hint (from {@link REMEDIATION_HINTS}). */
  remediationHint: string;
}

/** One honest playback stall episode (see the dropped-frame honesty note). */
export interface RebufferStallEvent extends TelemetryEventCommon {
  kind: "rebuffer-stall";
  /** The frame the playhead stalled at (0-based). */
  frameIndex: number;
  /** Total frames declared by the manifest. */
  frameCount: number;
  /** Frames supplied so far (the honest buffer/availability count). */
  availableFrames: number;
}

/** The playback provider's client-side integrity check passed (real seam). */
export interface IntegrityVerifiedEvent extends TelemetryEventCommon {
  kind: "integrity-verified";
  /** The measured UTF-8 byte length of the verified segment document. */
  byteLength: number;
  /** Frames declared by the container manifest. */
  frameCount: number;
}

/** An explicit, structured USER feedback signal (closed kinds only). */
export interface UserFeedbackEvent extends TelemetryEventCommon {
  kind: "user-feedback";
  feedback: UserFeedbackKind;
}

/** Every telemetry event — the closed union (privacy by construction). */
export type ViewerTelemetryEvent =
  | StateTransitionEvent
  | OperationTimingEvent
  | ErrorOccurredEvent
  | RebufferStallEvent
  | IntegrityVerifiedEvent
  | UserFeedbackEvent;

/** The kind discriminator values. */
export const TELEMETRY_EVENT_KINDS = [
  "state-transition",
  "operation-timing",
  "error-occurred",
  "rebuffer-stall",
  "integrity-verified",
  "user-feedback",
] as const;

/** The union of kind values. */
export type TelemetryEventKind = (typeof TELEMETRY_EVENT_KINDS)[number];

/**
 * The exact key allowlist per event kind — the schema's teeth. A payload
 * carrying ANY other key is rejected (this is what makes sensitive fields
 * unrepresentable). Pinned by tests against the literal sets below.
 */
export const TELEMETRY_EVENT_KEYS: Readonly<Record<TelemetryEventKind, readonly string[]>> = {
  "state-transition": ["kind", "schemaVersion", "sequence", "atMs", "sessionId", "from", "to"],
  "operation-timing": [
    "kind",
    "schemaVersion",
    "sequence",
    "atMs",
    "sessionId",
    "operation",
    "durationMs",
  ],
  "error-occurred": [
    "kind",
    "schemaVersion",
    "sequence",
    "atMs",
    "sessionId",
    "operation",
    "failureClass",
    "message",
    "remediationHint",
  ],
  "rebuffer-stall": [
    "kind",
    "schemaVersion",
    "sequence",
    "atMs",
    "sessionId",
    "frameIndex",
    "frameCount",
    "availableFrames",
  ],
  "integrity-verified": [
    "kind",
    "schemaVersion",
    "sequence",
    "atMs",
    "sessionId",
    "byteLength",
    "frameCount",
  ],
  "user-feedback": ["kind", "schemaVersion", "sequence", "atMs", "sessionId", "feedback"],
};

/** The bound on the error `message` length (sanity bound; see TELEMETRY.md §2). */
export const TELEMETRY_MESSAGE_MAX_LENGTH = 2_048;

// ---------------------------------------------------------------------------
// The validator (fail-loud, package-local schema — the viewer-shell precedent:
// hand-rolled closed-shape validators, e.g. `./segment-player.ts`; the browser
// module graph forbids adding a validation dependency)
// ---------------------------------------------------------------------------

/** Outcome of {@link parseTelemetryEvent}: the event or the exact reason. */
export type TelemetryParseResult =
  { ok: true; event: ViewerTelemetryEvent } | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireFiniteNumber(value: unknown, field: string): number | { failed: string } {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { failed: `${field} must be a finite number (got ${typeof value})` };
  }
  return value;
}

function requireInteger(
  value: unknown,
  field: string,
  options: { min: number; max?: number } = { min: 0 },
): number | { failed: string } {
  const numeric = requireFiniteNumber(value, field);
  if (typeof numeric === "object") return numeric;
  if (!Number.isInteger(numeric)) {
    return { failed: `${field} must be an integer (got ${String(numeric)})` };
  }
  if (numeric < options.min) {
    return { failed: `${field} must be >= ${String(options.min)} (got ${String(numeric)})` };
  }
  if (options.max !== undefined && numeric > options.max) {
    return { failed: `${field} must be <= ${String(options.max)} (got ${String(numeric)})` };
  }
  return numeric;
}

function requireStatus(value: unknown, field: string): ViewerStatus | { failed: string } {
  if (
    typeof value !== "string" ||
    !(TELEMETRY_VIEWER_STATUSES as readonly string[]).includes(value)
  ) {
    return { failed: `${field} must be a known viewer status (got ${String(value)})` };
  }
  return value as ViewerStatus;
}

/** Validates the common envelope fields; returns the reason or `null` if ok. */
function checkCommon(payload: Record<string, unknown>): string | null {
  if (payload.schemaVersion !== TELEMETRY_SCHEMA_VERSION) {
    return `schemaVersion must be ${String(TELEMETRY_SCHEMA_VERSION)} (got ${String(payload.schemaVersion)})`;
  }
  const sequence = requireInteger(payload.sequence, "sequence", { min: 1 });
  if (typeof sequence === "object") return sequence.failed;
  const atMs = requireFiniteNumber(payload.atMs, "atMs");
  if (typeof atMs === "object") return atMs.failed;
  if (payload.sessionId !== null && typeof payload.sessionId !== "string") {
    return `sessionId must be a string or null (got ${typeof payload.sessionId})`;
  }
  if (typeof payload.sessionId === "string" && payload.sessionId.length < 1) {
    return "sessionId must be a non-empty string when present";
  }
  return null;
}

/**
 * Parses + validates one telemetry event (fail-loud, exact reasons):
 *
 * - the payload must be an object whose keys are EXACTLY the kind's closed
 *   allowlist ({@link TELEMETRY_EVENT_KEYS}) — every unknown key is named in
 *   the rejection (this is the privacy pin: policies, artifact content,
 *   free-form records are unrepresentable);
 * - the common envelope (schemaVersion/sequence/atMs/sessionId) is checked;
 * - per-kind fields are type- and range-checked against the vocabulary.
 */
export function parseTelemetryEvent(value: unknown): TelemetryParseResult {
  if (!isRecord(value)) {
    return { ok: false, reason: "telemetry event must be an object" };
  }
  const kind = value.kind;
  if (typeof kind !== "string" || !(TELEMETRY_EVENT_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, reason: `unknown telemetry event kind (got ${String(kind)})` };
  }
  const eventKind = kind as TelemetryEventKind;
  const allowed = TELEMETRY_EVENT_KEYS[eventKind];
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      return {
        ok: false,
        reason: `unknown '${eventKind}' field '${key}' — the telemetry vocabulary is closed (privacy by construction; see TELEMETRY.md)`,
      };
    }
  }
  for (const key of allowed) {
    if (!(key in value)) {
      return { ok: false, reason: `missing '${eventKind}' field '${key}'` };
    }
  }
  const common = checkCommon(value);
  if (common !== null) return { ok: false, reason: common };
  switch (eventKind) {
    case "state-transition": {
      const from = requireStatus(value.from, "from");
      if (typeof from === "object") return { ok: false, reason: from.failed };
      const to = requireStatus(value.to, "to");
      if (typeof to === "object") return { ok: false, reason: to.failed };
      if (from === to) {
        return { ok: false, reason: "from and to must differ (a non-transition is not an event)" };
      }
      return { ok: true, event: value as unknown as StateTransitionEvent };
    }
    case "operation-timing": {
      const operation = value.operation;
      if (
        typeof operation !== "string" ||
        !(TELEMETRY_TIMED_OPERATIONS as readonly string[]).includes(operation)
      ) {
        return {
          ok: false,
          reason: `operation must be one of ${TELEMETRY_TIMED_OPERATIONS.join(", ")} (got ${String(operation)})`,
        };
      }
      const durationMs = requireFiniteNumber(value.durationMs, "durationMs");
      if (typeof durationMs === "object") return { ok: false, reason: durationMs.failed };
      if (durationMs < 0) {
        return { ok: false, reason: `durationMs must be >= 0 (got ${String(durationMs)})` };
      }
      return { ok: true, event: value as unknown as OperationTimingEvent };
    }
    case "error-occurred": {
      if (!isViewerOperation(value.operation)) {
        return {
          ok: false,
          reason: `operation must be a known viewer operation (got ${String(value.operation)})`,
        };
      }
      if (!isViewerFailureClass(value.failureClass)) {
        return {
          ok: false,
          reason: `failureClass must be a known viewer failure class (got ${String(value.failureClass)})`,
        };
      }
      const message = value.message;
      if (typeof message !== "string" || message.length < 1) {
        return { ok: false, reason: "message must be a non-empty string" };
      }
      if (message.length > TELEMETRY_MESSAGE_MAX_LENGTH) {
        return {
          ok: false,
          reason: `message length ${String(message.length)} exceeds the bound ${String(TELEMETRY_MESSAGE_MAX_LENGTH)} (sanity bound, see TELEMETRY.md §2)`,
        };
      }
      if (!isRemediationHint(value.remediationHint)) {
        return {
          ok: false,
          reason: "remediationHint must come from the REMEDIATION_HINTS table",
        };
      }
      return { ok: true, event: value as unknown as ErrorOccurredEvent };
    }
    case "rebuffer-stall": {
      const frameIndex = requireInteger(value.frameIndex, "frameIndex", { min: 0 });
      if (typeof frameIndex === "object") return { ok: false, reason: frameIndex.failed };
      const frameCount = requireInteger(value.frameCount, "frameCount", { min: 1 });
      if (typeof frameCount === "object") return { ok: false, reason: frameCount.failed };
      const availableFrames = requireInteger(value.availableFrames, "availableFrames", {
        min: 0,
        max: frameCount,
      });
      if (typeof availableFrames === "object") return { ok: false, reason: availableFrames.failed };
      if (frameIndex >= frameCount) {
        return {
          ok: false,
          reason: `frameIndex ${String(frameIndex)} must be < frameCount ${String(frameCount)}`,
        };
      }
      return { ok: true, event: value as unknown as RebufferStallEvent };
    }
    case "integrity-verified": {
      const byteLength = requireInteger(value.byteLength, "byteLength", { min: 1 });
      if (typeof byteLength === "object") return { ok: false, reason: byteLength.failed };
      const frameCount = requireInteger(value.frameCount, "frameCount", { min: 1 });
      if (typeof frameCount === "object") return { ok: false, reason: frameCount.failed };
      return { ok: true, event: value as unknown as IntegrityVerifiedEvent };
    }
    case "user-feedback": {
      if (!isUserFeedbackKind(value.feedback)) {
        return {
          ok: false,
          reason: `feedback must be one of ${USER_FEEDBACK_KINDS.join(", ")} (got ${String(value.feedback)})`,
        };
      }
      return { ok: true, event: value as unknown as UserFeedbackEvent };
    }
  }
}

// ---------------------------------------------------------------------------
// Serialization (the JSON-lines wire/line form — deterministic)
// ---------------------------------------------------------------------------

/**
 * Serializes one validated event to ONE compact JSON line (no trailing
 * newline; the file sink appends the newline). Key order is the object's
 * insertion order — stable for events built by this package's emitters.
 * Callers must pass an event that {@link parseTelemetryEvent} accepts.
 */
export function serializeTelemetryEvent(event: ViewerTelemetryEvent): string {
  return JSON.stringify(event) as string;
}

/**
 * Parses one JSON line back into a validated event (the inverse of
 * {@link serializeTelemetryEvent} — used by the file-sink reader path and
 * tests). Rejects malformed JSON and any schema violation.
 */
export function parseTelemetryLine(line: string): TelemetryParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { ok: false, reason: `telemetry line is not valid JSON: ${line.slice(0, 120)}` };
  }
  return parseTelemetryEvent(parsed);
}
