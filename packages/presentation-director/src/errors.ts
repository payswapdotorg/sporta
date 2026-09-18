/**
 * The fail-loud error of the presentation director. Every `present` input
 * that is not a structurally valid policy, or every presentation-layer
 * inconsistency (a framing gap, an importance-table gap on a ruled event,
 * a plan shape the additive layer cannot explain) is REFUSED with a
 * `PresentationError` carrying the JSON path and the reason — the
 * camera-director `DirectorError` posture (fail closed, never a silent
 * partial presentation).
 *
 * The wrapped W604 director's own `DirectorError` propagates VERBATIM from
 * `present` for camera-layer admission failures (the wrapped seam's error
 * is the honest error for the wrapped seam's input).
 */
import { describeValue } from "./internal";

/** Why the presentation director refused its input (closed vocabulary). */
export type PresentationErrorKind =
  /** The presentation policy document failed `validatePresentationPolicy`. */
  | "policy-invalid"
  /** A camera-plan window's slot has no framing row in the policy (fail-closed, never defaulted). */
  | "framing-gap"
  /** A camera-plan window's event type has no importance row (a ruled event without a weight). */
  | "importance-gap"
  /** The wrapped camera plan's shape cannot be presented (defense in depth). */
  | "plan-invalid"
  /** The candidate stream is malformed at the presentation layer. */
  | "candidates-invalid";

/** The presentation director's fail-loud error. */
export class PresentationError extends Error {
  /** Which admission gate refused the input. */
  readonly kind: PresentationErrorKind;
  /** Structured details (JSON path, values, invariant violations). */
  readonly details: Record<string, unknown>;

  constructor(kind: PresentationErrorKind, message: string, details: Record<string, unknown> = {}) {
    super(`presentation-director refused input (${kind}): ${message}`);
    this.name = "PresentationError";
    this.kind = kind;
    this.details = details;
  }

  /** A uniform description for logs/tests (never throws). */
  describe(): string {
    const details = Object.entries(this.details)
      .map(([key, value]) => `${key}=${describeValue(value)}`)
      .join("; ");
    return details === "" ? `${this.kind}: ${this.message}` : `${this.kind}: ${this.message} [${details}]`;
  }
}
