/**
 * The error of the game-engine adapter seam (R302).
 *
 * Thrown fail-loud (the repo convention) when a call violates the frozen
 * `GameEngineAdapter` seam's envelope: unknown scene handles, unsupported
 * rendering styles or output formats, over-capacity scenes, invalid output
 * profiles, or missing staging configuration. Engine adapters behind this
 * seam NEVER return half-rendered output — they throw with structured
 * evidence.
 */

/** Machine-readable violation classes of the adapter seam. */
export type GameEngineViolationCode =
  | "unknown-scene"
  | "unsupported-style"
  | "unsupported-format"
  | "scene-capacity-exceeded"
  | "invalid-output-profile"
  | "invalid-build-request"
  | "invalid-event"
  | "staging-unavailable";

/** The typed error of {@link GameEngineAdapter} implementations. */
export class GameEngineAdapterError extends Error {
  /** Machine-readable violation classification. */
  readonly code: GameEngineViolationCode;

  /** Structured evidence about the violation (ids, limits, reasons). */
  readonly details: Record<string, unknown>;

  constructor(
    message: string,
    code: GameEngineViolationCode,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "GameEngineAdapterError";
    this.code = code;
    this.details = details;
  }
}
