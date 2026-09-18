/**
 * The typed error family of the encoding package (fail-loud, never a raw
 * spawn error): every refusal carries a terminal failure class (the
 * repo-wide vocabulary), a stable error kind, and JSON-safe details.
 */
import { describeValue } from "./internal";

/** The terminal failure classes (the repo-wide vocabulary). */
export type EncodingFailureClass = "media-invalid" | "resource-limit" | "internal";

/** Why the encoder refused (closed vocabulary). */
export type EncodingErrorKind =
  /** The frame stream is malformed (geometry, byte lengths, admission). */
  | "frames-invalid"
  /** The encoder binary is unavailable or refused to run. */
  | "encoder-unavailable"
  /** The encode subprocess failed (non-zero exit, timeout kill, no output). */
  | "encode-failed"
  /** The adopted artifact failed verification (hash mismatch, bad manifest). */
  | "artifact-invalid"
  /** The store rejected the artifact (limits, integrity). */
  | "store-rejected"
  /** The probe/decode of an encoded artifact failed or disagreed. */
  | "verify-failed";

/** The encoding package's fail-loud error. */
export class EncodingError extends Error {
  readonly failureClass: EncodingFailureClass;
  readonly kind: EncodingErrorKind;
  readonly details: Record<string, unknown>;

  constructor(
    failureClass: EncodingFailureClass,
    kind: EncodingErrorKind,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(`encoding refused (${kind}): ${message}`);
    this.name = "EncodingError";
    this.failureClass = failureClass;
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
