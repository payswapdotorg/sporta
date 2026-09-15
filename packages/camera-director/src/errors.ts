/**
 * The fail-loud error of the camera director. Every `direct`/composition
 * input that is not a structurally valid policy, match timeline, candidate
 * stream, or camera plan is REFUSED with a `DirectorError` carrying the
 * JSON path and the reason — the renderer-3d `RendererContractError`
 * posture (fail closed, never a silent partial direction).
 */
import { describeValue } from "./internal";

/** Why the director refused its input (closed vocabulary). */
export type DirectorErrorKind =
  /** The policy document failed {@link validatePolicy}-equivalent checks. */
  | "policy-invalid"
  /** The match timeline is malformed (empty, non-increasing atMs, bad scenes). */
  | "timeline-invalid"
  /** The W209 candidate stream is malformed. */
  | "candidates-invalid"
  /** The camera plan is malformed or inconsistent with the match timeline. */
  | "plan-invalid"
  /** The composed directed render exceeds the documented frame budget. */
  | "budget-exceeded";

/** The director's fail-loud error. */
export class DirectorError extends Error {
  /** Which admission gate refused the input. */
  readonly kind: DirectorErrorKind;
  /** Structured details (JSON path, values, invariant violations). */
  readonly details: Record<string, unknown>;

  constructor(kind: DirectorErrorKind, message: string, details: Record<string, unknown> = {}) {
    super(`camera-director refused input (${kind}): ${message}`);
    this.name = "DirectorError";
    this.kind = kind;
    this.details = details;
  }

  /** A uniform description for logs/tests (never throws). */
  describe(): string {
    const details = Object.entries(this.details)
      .map(([key, value]) => `${key}=${describeValue(value)}`)
      .join("; ");
    return details === ""
      ? `${this.kind}: ${this.message}`
      : `${this.kind}: ${this.message} [${details}]`;
  }
}
