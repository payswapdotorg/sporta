/**
 * Typed errors of `@sporta/real-to-swm` (R207/R208).
 *
 * Every failure path is a CLASSIFIED refusal, never a silent partial result:
 * invalid or degenerate input fails closed with `PipelineAdmissionError`
 * (contracts `terminalFailureClass: "media-invalid"`), a corrupted or
 * tampered artifact fails closed with `ArtifactIntegrityError`, and decode
 * boundary refusals (rights/limits/media) propagate the typed
 * `@sporta/decoding` errors unchanged — they are already classified.
 */
import type { TerminalFailureClass } from "@sporta/contracts";

/** Base class of every typed error this package raises. */
export class RealToSwmError extends Error {
  /** The contracts terminal failure class of this error. */
  readonly terminalFailureClass: TerminalFailureClass;
  /** Structured details (deterministic, JSON-safe). */
  readonly details: Record<string, unknown>;

  constructor(
    message: string,
    terminalFailureClass: TerminalFailureClass,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "RealToSwmError";
    this.terminalFailureClass = terminalFailureClass;
    this.details = details;
  }
}

/**
 * Fail-closed admission refusal (invalid/degenerate clip input): empty bytes,
 * an unrecognized container family, no video track, or a decode that yielded
 * zero frames. NEVER a partial fake pipeline.
 */
export class PipelineAdmissionError extends RealToSwmError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, "media-invalid", details);
    this.name = "PipelineAdmissionError";
  }
}

/**
 * The reconstruction artifact's content hash does not match its content —
 * the artifact is corrupted or was tampered with. Replay refuses.
 */
export class ArtifactIntegrityError extends RealToSwmError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, "media-invalid", details);
    this.name = "ArtifactIntegrityError";
  }
}

/**
 * An artifact or intermediate structure does not conform to the frozen
 * contracts (a snapshot/event that fails zod validation on replay).
 */
export class ArtifactValidationError extends RealToSwmError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, "media-invalid", details);
    this.name = "ArtifactValidationError";
  }
}

/** Type guard for every typed error of this package. */
export function isRealToSwmError(error: unknown): error is RealToSwmError {
  return error instanceof RealToSwmError;
}
