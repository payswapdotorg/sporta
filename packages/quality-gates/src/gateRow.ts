/**
 * The shared gate-row vocabulary (docs/GATES.md §gates): every gate —
 * machine, human, or the ledger itself — surfaces as ONE row shape with a
 * verdict from a closed vocabulary, a policy-copied privilege block, and an
 * accounted reason that is never empty when the verdict is not PASS.
 */
import type { NotRunnableOutcome } from "./gatePolicy";

/** A gate's verdict. `NOT-RUNNABLE` is a COUNTED FAIL for the release, never a skip. */
export type GateVerdict = "PASS" | "FAIL" | "NOT-RUNNABLE";

/**
 * A thrown error, accounted (never swallowed): the error's class name,
 * message, and — when the thrower is one of the typed dependency errors —
 * its `code` and JSON `path`, carried verbatim.
 */
export interface AccountedError {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
  readonly path?: string;
}

/** Accounts a thrown value without losing its typed evidence. */
export function describeThrownError(error: unknown): AccountedError {
  if (error instanceof Error) {
    const carrier = error as Error & { code?: unknown; path?: unknown };
    return {
      name: error.name,
      message: error.message,
      ...(typeof carrier.code === "string" ? { code: carrier.code } : {}),
      ...(typeof carrier.path === "string" ? { path: carrier.path } : {}),
    };
  }
  return {
    name: `thrown-${typeof error}`,
    message: typeof error === "string" ? error : safeMessage(error),
  };
}

/** A deterministic message for a thrown non-Error value. */
function safeMessage(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** The fields every gate row carries (copied from its policy entry). */
export interface GateRowBase {
  /** The gate's stable id (matches its policy entry). */
  readonly gateId: string;
  /** The gate's human-readable name (from the policy). */
  readonly name: string;
  /** The workspace package owning the evaluation (from the policy). */
  readonly sourcePackage: string;
  /** Whether this gate blocks the release (from the policy). */
  readonly blocking: boolean;
  /** What this gate's NOT-RUNNABLE contributes (from the policy). */
  readonly notRunnableOutcome: NotRunnableOutcome;
  /** The gate's verdict. */
  readonly verdict: GateVerdict;
  /**
   * The accounted reason. Never empty unless the verdict is PASS; for
   * `NOT-RUNNABLE` it states exactly why the gate could not run.
   */
  readonly reason: string;
}
