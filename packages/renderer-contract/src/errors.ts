/**
 * The error of the renderer plugin contract (W501).
 *
 * Thrown for contract violations — request refusals raised from `render`
 * (defense in depth), registry misuse (duplicate/unknown renderer versions),
 * and post-dispose use (R4). `failureClass` reuses the session-level terminal
 * failure classification so hosts map renderer refusals onto their existing
 * failure handling; `details` carries structured evidence (never secrets).
 */
import type { TerminalFailureClass } from "@sporta/contracts";

export class RendererContractError extends Error {
  /** Machine-readable failure classification for session-level handling. */
  readonly failureClass: TerminalFailureClass;

  /** Structured evidence about the violation (ids, versions, reasons). */
  readonly details: Record<string, unknown>;

  constructor(
    message: string,
    failureClass: TerminalFailureClass,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "RendererContractError";
    this.failureClass = failureClass;
    this.details = details;
  }
}
