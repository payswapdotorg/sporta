/**
 * Typed boundary errors for the live-output transport (W305).
 *
 * Every failure class that can terminate a live output session is a distinct
 * {@link LiveOutputFailureClass}, carried on a typed {@link LiveOutputError}
 * (the W301/W304 posture: classified terminal failures, fail-closed, never a
 * naked string). The classes are protocol-level vocabulary for THIS package:
 * the media-session lifecycle's own `TerminalFailureClass`
 * (`@sporta/contracts`) stays untouched — a live-output failure is reported to
 * the session lifecycle by the host (W701), not conflated here.
 *
 * The link's backpressure refusals are NOT session failures: the W104
 * `ResourceLimitError` from `@sporta/transport` is the typed refusal the
 * bounded link throws (verbatim W104 semantics); `sendWindow` converts it into
 * a typed refusal receipt (counted, logged, metered) — the host decides, the
 * session continues. Resource limits are loud, but they are a policy outcome,
 * not a terminal fault.
 */
import type { LiveOutputFailureClass } from "./types";

/** Structured, JSON-safe details carried on every live-output error. */
export interface LiveOutputErrorDetails {
  /** The failure classification. */
  failureClass: LiveOutputFailureClass;
  /** The stream the error belongs to. */
  streamId: string;
  /** Machine-readable context (window ids, ordinals, measured lags, …). */
  [key: string]: unknown;
}

/**
 * The base typed error for the live output boundary. Subclasses exist for the
 * classes callers need to discriminate on; every instance carries the class
 * plus JSON-safe details.
 */
export abstract class LiveOutputError extends Error {
  readonly details: LiveOutputErrorDetails;

  constructor(message: string, details: LiveOutputErrorDetails) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}

/**
 * Fail-closed rights error (class `rights-denied`/`rights-lapsed`): raised
 * when live delivery is attempted without `canDeliverLive` (the
 * architecture-lock §11 boundary — transformation never clears rights), or
 * when the authorization policy lapses mid-stream.
 */
export class LiveOutputRightsError extends LiveOutputError {
  constructor(message: string, details: LiveOutputErrorDetails) {
    super(message, details);
  }
}

/**
 * Negotiation failure (class `negotiation-failed`): the viewer endpoint
 * rejected the offer, or the answer rejected the session.
 */
export class LiveOutputNegotiationError extends LiveOutputError {
  constructor(message: string, details: LiveOutputErrorDetails) {
    super(message, details);
  }
}

/**
 * Negotiation violation (class `negotiation-violation`): a frame window whose
 * declared profile does not match the negotiated track (a real WebRTC stack
 * cannot change codecs mid-stream without renegotiation; neither can this
 * contract).
 */
export class LiveOutputProfileMismatchError extends LiveOutputError {
  constructor(message: string, details: LiveOutputErrorDetails) {
    super(message, details);
  }
}

/**
 * Integrity violation (class `integrity-violation`): a delivered frame window
 * whose recomputed content hashes do not match the declared ones (the
 * W504/W705 sha-256 posture, enforced at the delivery boundary — fail loud,
 * never present corrupted frames).
 */
export class LiveOutputIntegrityError extends LiveOutputError {
  constructor(message: string, details: LiveOutputErrorDetails) {
    super(message, details);
  }
}

/**
 * Protocol violation (class `protocol-violation`): malformed documents,
 * illegal state transitions, in-order delivery violations, resume points
 * ahead of delivery — the contract's own rules, enforced loudly.
 */
export class LiveOutputProtocolError extends LiveOutputError {
  constructor(message: string, details: LiveOutputErrorDetails) {
    super(message, details);
  }
}

/** `true` when the thrown value is a typed live-output boundary error. */
export function isLiveOutputError(value: unknown): value is LiveOutputError {
  return value instanceof LiveOutputError;
}
