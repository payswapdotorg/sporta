/**
 * Media session lifecycle (W004 domain module).
 *
 * Implements the status machine from `docs/contracts/streaming.md`:
 *
 * `created -> authorized -> ingesting -> normalizing -> processing ->
 * rendering -> delivering -> completed`
 *
 * with terminal `failed` / `cancelled` states. Terminal failures are explicit
 * and classified; cancellation is idempotent.
 *
 * Rights gate (architecture-lock §11, fail-closed):
 *
 * - `created -> authorized` requires an `AuthorizationPolicy` allowing
 *   `analysis`;
 * - entering `rendering` requires the policy to allow `transformation`;
 * - a missing, expired, or insufficient policy DENIES the transition
 *   (`rights-denied` terminal failure class) and never advances the session.
 *
 * All methods are pure with respect to their input: they return a fresh,
 * deeply-copied `MediaSession` and never mutate the argument.
 */
import { SCHEMA_VERSION } from "@sporta/contracts";
import type {
  AllowedOperation,
  AuthorizationPolicy,
  MediaSession as MediaSessionDoc,
  ProcessingState,
  SessionStatus,
  SessionTimeline,
  SourceMedia,
  TerminalFailureClass,
} from "@sporta/contracts";
import { parseSessionDocument } from "./validation";

/**
 * Ordered pipeline statuses (the happy path).
 */
export const SESSION_PIPELINE_STATUSES: readonly SessionStatus[] = [
  "created",
  "authorized",
  "ingesting",
  "normalizing",
  "processing",
  "rendering",
  "delivering",
  "completed",
] as const;

/** Statuses with no outgoing transitions. */
export const TERMINAL_SESSION_STATUSES: readonly SessionStatus[] = [
  "completed",
  "failed",
  "cancelled",
] as const;

const TERMINAL_STATUSES: ReadonlySet<SessionStatus> = new Set(TERMINAL_SESSION_STATUSES);

const LINEAR_SUCCESSOR: Partial<Record<SessionStatus, SessionStatus>> = {
  created: "authorized",
  authorized: "ingesting",
  ingesting: "normalizing",
  normalizing: "processing",
  processing: "rendering",
  rendering: "delivering",
  delivering: "completed",
};

/** Returns `true` when `status` has no outgoing transitions. */
export function isTerminalStatus(status: SessionStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Returns `true` when `from -> to` is a legal lifecycle edge.
 *
 * Legal edges are: the linear pipeline successor, and `failed`/`cancelled`
 * from any active (non-terminal) status. Terminal statuses have no outgoing
 * edges; self-transitions are always illegal.
 */
export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  if (TERMINAL_STATUSES.has(from)) return false;
  return to === "failed" || to === "cancelled" || LINEAR_SUCCESSOR[from] === to;
}

/** Reasons a rights gate can deny a transition (fail-closed). */
export type RightsDenialReason =
  "missing-policy" | "expired-policy" | "missing-operation" | "policy-mismatch";

/**
 * A rights gate denied a transition. The session is NOT advanced (fail
 * closed). Carries the `rights-denied` terminal failure class so the denial
 * can be recorded on the session via `SessionLifecycle.fail`.
 */
export class RightsDeniedError extends Error {
  readonly reason: RightsDenialReason;
  readonly requiredOperation: AllowedOperation;
  readonly policyId?: string;
  readonly terminalFailureClass: "rights-denied";

  constructor(
    reason: RightsDenialReason,
    requiredOperation: AllowedOperation,
    policyId?: string,
    message?: string,
  ) {
    const where = policyId !== undefined ? ` for policy '${policyId}'` : "";
    super(
      message ??
        `rights denied (${reason}): operation '${requiredOperation}' is not authorized${where}`,
    );
    this.name = "RightsDeniedError";
    this.reason = reason;
    this.requiredOperation = requiredOperation;
    this.policyId = policyId;
    this.terminalFailureClass = "rights-denied";
  }
}

/**
 * Asserts (throws on failure) that `policy` authorizes `operation` at time
 * `now`. Exported for reuse by ingestion and delivery boundaries.
 *
 * FAIL-CLOSED: a missing policy denies; an `expiresAtIso` in the past (or
 * exactly `now`, mirroring `deriveRightsCapabilities` in the contracts)
 * denies; a policy that does not list the operation denies.
 */
export function assertAuthorized(
  policy: AuthorizationPolicy | null | undefined,
  operation: AllowedOperation,
  now: Date = new Date(),
): void {
  if (!policy) {
    throw new RightsDeniedError("missing-policy", operation);
  }
  if (policy.expiresAtIso !== undefined && Date.parse(policy.expiresAtIso) <= now.getTime()) {
    throw new RightsDeniedError("expired-policy", operation, policy.policyId);
  }
  if (!policy.allowedOperations.includes(operation)) {
    throw new RightsDeniedError("missing-operation", operation, policy.policyId);
  }
}

/**
 * Thrown by `SessionLifecycle.transition` on an illegal status edge.
 */
export class InvalidTransitionError extends Error {
  readonly from: SessionStatus;
  readonly to: SessionStatus;

  constructor(from: SessionStatus, to: SessionStatus) {
    super(`illegal media-session transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
    this.from = from;
    this.to = to;
  }
}

/** Resolves the authorization policy referenced by a session. */
export type PolicyResolver = (policyId: string) => AuthorizationPolicy | null | undefined;

/** Options for constructing a {@link SessionLifecycle} service. */
export interface SessionLifecycleOptions {
  /**
   * Resolves `session.authorizationPolicyId` to the current policy record
   * whenever a rights gate fires. When absent, gates only pass if a policy is
   * presented via {@link TransitionMeta.policy}.
   */
  resolvePolicy?: PolicyResolver;
  /** Wall clock used for transition timestamps and expiry checks. */
  now?: () => Date;
}

/** Metadata for a lifecycle transition. */
export interface TransitionMeta {
  /** Wall-clock time of the transition (ISO-8601 UTC; defaults to now). */
  atIso?: string;
  /**
   * Overrides `processingState.stage` recorded with the transition. Defaults
   * to the new status on pipeline progress; terminal transitions keep the
   * stage at which the session stopped.
   */
  stage?: string;
  /**
   * Presents the authorization policy at the rights gate (used for
   * `created -> authorized` and entering `rendering`). Falls back to the
   * service's policy resolver. Must reference the session's
   * `authorizationPolicyId` — a mismatched policy is denied.
   */
  policy?: AuthorizationPolicy;
}

/** Input for {@link newSession}. */
export interface NewSessionInput {
  sessionId: string;
  /** Must reference the authorization policy declared at ingestion. */
  authorizationPolicyId: string;
  /** At least one authorized source (schema minimum: 1). */
  sources: SourceMedia[];
  /** Partial timeline overrides; defaults to a zeroed, unmeasured timeline. */
  timeline?: Partial<Omit<SessionTimeline, "driftMeasured">> & { driftMeasured?: boolean };
  /** Partial processing-state overrides; defaults to `{ stage: "created" }`. */
  processingState?: Partial<Omit<ProcessingState, "stage">> & { stage?: string };
  /** Creation time (ISO-8601 UTC); defaults to now. */
  createdAtIso?: string;
}

const EMPTY_TIMELINE: SessionTimeline = {
  durationMs: 0,
  videoClockOffsetMs: 0,
  audioClockOffsetMs: 0,
  driftMeasured: false,
};

/**
 * Builds a fresh `MediaSession` document in the `created` status. The
 * document is validated against the `MediaSession` schema (throws
 * {@link SessionDocumentValidationError} on invalid input, e.g. zero
 * sources). Authorization is intentionally NOT checked here — the rights gate
 * fires on `created -> authorized`, not on creation.
 */
export function newSession(input: NewSessionInput, now: Date = new Date()): MediaSessionDoc {
  const session: MediaSessionDoc = {
    sessionId: input.sessionId,
    schemaVersion: SCHEMA_VERSION,
    status: "created",
    authorizationPolicyId: input.authorizationPolicyId,
    sources: input.sources,
    timeline: { ...EMPTY_TIMELINE, ...input.timeline },
    processingState: { stage: "created", ...input.processingState },
    createdAtIso: input.createdAtIso ?? now.toISOString(),
  };
  return parseSessionDocument(session);
}

/**
 * Session lifecycle state machine.
 *
 * Pure service: `transition`, `cancel`, and `fail` return a fresh deep copy
 * and never mutate their input.
 */
export class SessionLifecycle {
  private readonly resolvePolicy?: PolicyResolver;
  private readonly now: () => Date;

  constructor(options: SessionLifecycleOptions = {}) {
    this.resolvePolicy = options.resolvePolicy;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Advances `session` to `next` along a legal edge.
   *
   * - Illegal edges throw {@link InvalidTransitionError}.
   * - Rights gates (fail closed, session NOT advanced on denial):
   *   `created -> authorized` requires a policy allowing `analysis`;
   *   entering `rendering` requires a policy allowing `transformation`.
   *   Denials throw {@link RightsDeniedError}; record them with `fail`.
   * - On pipeline progress, `processingState.stage` becomes the new status
   *   (unless `meta.stage` overrides); terminal transitions keep the stage at
   *   which the session stopped.
   * - Transitioning to `cancelled` stamps `cancelledAtIso`
   *   (`meta.atIso` or now).
   *
   * Prefer {@link cancel} and {@link fail} for terminal transitions: they are
   * idempotent and record the terminal metadata this raw transition leaves
   * out (failure classification).
   */
  transition(
    session: MediaSessionDoc,
    next: SessionStatus,
    meta?: TransitionMeta,
  ): MediaSessionDoc {
    if (!canTransition(session.status, next)) {
      throw new InvalidTransitionError(session.status, next);
    }
    this.enforceRightsGate(session, next, meta);

    const progressesPipeline = LINEAR_SUCCESSOR[session.status] === next;
    const result = structuredClone(session);
    result.status = next;
    result.processingState.stage =
      meta?.stage ?? (progressesPipeline ? next : session.processingState.stage);
    if (next === "cancelled") {
      result.cancelledAtIso = meta?.atIso ?? this.now().toISOString();
    }
    return result;
  }

  /**
   * Cancels the session. IDEMPOTENT per the streaming contract: cancelling an
   * already-terminal session (cancelled, failed, or completed) is a no-op that
   * returns the current state unchanged — `cancelledAtIso` is never
   * re-stamped.
   */
  cancel(session: MediaSessionDoc): MediaSessionDoc {
    if (isTerminalStatus(session.status)) return structuredClone(session);
    return this.transition(session, "cancelled");
  }

  /**
   * Fails the session with an explicit terminal failure class. IDEMPOTENT on
   * terminal sessions: the first classification wins and later `fail` calls
   * are no-ops returning the current state. `processingState.stage` records
   * the stage at which the session failed; an optional `detail` is recorded
   * in `processingState.lastError`.
   */
  fail(
    session: MediaSessionDoc,
    terminalFailureClass: TerminalFailureClass,
    detail?: string,
  ): MediaSessionDoc {
    if (isTerminalStatus(session.status)) return structuredClone(session);
    const result = this.transition(session, "failed");
    result.processingState.terminalFailureClass = terminalFailureClass;
    if (detail !== undefined) {
      result.processingState.lastError = detail;
    }
    return result;
  }

  private enforceRightsGate(
    session: MediaSessionDoc,
    next: SessionStatus,
    meta?: TransitionMeta,
  ): void {
    const requiredOperation: AllowedOperation | undefined =
      next === "authorized" ? "analysis" : next === "rendering" ? "transformation" : undefined;
    if (requiredOperation === undefined) return;

    let policy = meta?.policy;
    if (policy !== undefined && policy.policyId !== session.authorizationPolicyId) {
      throw new RightsDeniedError(
        "policy-mismatch",
        requiredOperation,
        policy.policyId,
        `rights denied (policy-mismatch): presented policy '${policy.policyId}' does not match session policy '${session.authorizationPolicyId}'`,
      );
    }
    if (policy === undefined && this.resolvePolicy !== undefined) {
      policy = this.resolvePolicy(session.authorizationPolicyId) ?? undefined;
    }
    assertAuthorized(policy, requiredOperation, this.now());
  }
}
