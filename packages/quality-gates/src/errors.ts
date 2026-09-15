/**
 * The typed error of the release-gate suite. Fail-closed everywhere: an
 * unknown shape, a malformed record, or an unreadable gate input throws
 * with a code and a JSON path — never a silent skip, never a coerced pass.
 */
export type ReleaseGateErrorCode =
  "record-malformed" | "record-incomplete" | "policy-malformed" | "gate-malformed";

/** One typed, path-carrying release-gate error. */
export class ReleaseGateError extends Error {
  readonly code: ReleaseGateErrorCode;
  readonly path: string;

  constructor(code: ReleaseGateErrorCode, path: string, message: string) {
    super(`${message} (at ${path})`);
    this.name = "ReleaseGateError";
    this.code = code;
    this.path = path;
  }
}
