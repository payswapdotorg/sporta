/**
 * The compute-job lifecycle state machine (W914 Wave 1): the closed state
 * vocabulary, the LEGAL transition table, and the fail-loud transition
 * assertion.
 *
 * ## Vocabulary alignment (cited)
 *
 * - Terminal states `"succeeded" | "failed" | "cancelled" | "dead-lettered"`
 *   — VERBATIM `GpuTerminalDisposition` (`@sporta/gpu-worker` `src/types.ts`).
 * - Live states `"queued" | "in-flight"` — VERBATIM live members of the W303
 *   `GpuJobState` (`"queued"` = waiting for a claim; `"in-flight"` = leased
 *   and executing).
 * - `"admitted"` / `"dispatched"` are the ADAPTER-level additions: W303's
 *   in-process `submit()` resolves admission and queueing inside one call, so
 *   the protocol never observes them; a hosted adapter whose provider
 *   handoff is decoupled (an HTTP 202 pattern) DOES, and the contract names
 *   those states honestly.
 *
 * ## The transition table (14 legal edges, closed)
 *
 * | from | to | meaning |
 * |---|---|---|
 * | `admitted` | `dispatched` | provider handoff initiated (async-accept providers) |
 * | `admitted` | `queued` | provider accepted synchronously (the reference path) |
 * | `admitted` | `cancelled` | cancelled before handoff |
 * | `dispatched` | `queued` | provider accepted the handoff (ack) |
 * | `dispatched` | `failed` | provider refused the job (determinate refusal) |
 * | `dispatched` | `cancelled` | cancelled while in handoff |
 * | `queued` | `in-flight` | execution started (a claim/lease was granted) |
 * | `queued` | `failed` | deadline fired while queued (`deadline-timeout`) |
 * | `queued` | `dead-lettered` | recovery budget exhausted before execution |
 * | `queued` | `cancelled` | cancelled while queued |
 * | `in-flight` | `queued` | recovery requeue (lease expiry within the claim budget — the W303 requeue) |
 * | `in-flight` | `succeeded` | execution completed |
 * | `in-flight` | `failed` | determinate failure (non-retryable, deadline, stale worker) |
 * | `in-flight` | `dead-lettered` | recovery budget exhausted (retry-exhausted / internal) |
 * | `in-flight` | `cancelled` | cancelled while executing (eventual report is superseded — accounted) |
 *
 * Terminal states have NO outgoing edges — every job lands in EXACTLY ONE
 * terminal disposition (the W303 exactly-one constitution). Illegal
 * transitions (e.g. `admitted → succeeded` skipping the provider, or
 * `succeeded → failed`) are rejected loudly by {@link assertComputeTransition}.
 */

/** The closed job-state vocabulary (see the module docs for the alignment). */
export const COMPUTE_JOB_STATES = [
  "admitted",
  "dispatched",
  "queued",
  "in-flight",
  "succeeded",
  "failed",
  "cancelled",
  "dead-lettered",
] as const;
export type ComputeJobState = (typeof COMPUTE_JOB_STATES)[number];

/** The terminal dispositions — VERBATIM the W303 `GpuTerminalDisposition`. */
export const COMPUTE_TERMINAL_DISPOSITIONS = [
  "succeeded",
  "failed",
  "cancelled",
  "dead-lettered",
] as const;
export type ComputeTerminalDisposition = (typeof COMPUTE_TERMINAL_DISPOSITIONS)[number];

/** The live (non-terminal) states, in lifecycle order. */
export const COMPUTE_LIVE_STATES = ["admitted", "dispatched", "queued", "in-flight"] as const;
export type ComputeLiveState = (typeof COMPUTE_LIVE_STATES)[number];

/**
 * The legal transition table. `admitted → queued` is the synchronous-provider
 * edge (the in-memory reference path); `admitted → dispatched → queued` is
 * the decoupled-handoff path a hosted HTTP provider takes.
 */
export const COMPUTE_TRANSITIONS: Readonly<Record<ComputeJobState, readonly ComputeJobState[]>> =
  Object.freeze({
    admitted: Object.freeze(["dispatched", "queued", "cancelled"] as const),
    dispatched: Object.freeze(["queued", "failed", "cancelled"] as const),
    queued: Object.freeze(["in-flight", "failed", "dead-lettered", "cancelled"] as const),
    "in-flight": Object.freeze(["queued", "succeeded", "failed", "dead-lettered", "cancelled"] as const),
    succeeded: Object.freeze([] as const),
    failed: Object.freeze([] as const),
    cancelled: Object.freeze([] as const),
    "dead-lettered": Object.freeze([] as const),
  });

/** `true` when `state` is one of the terminal dispositions (no outgoing edges). */
export function isTerminalComputeState(state: ComputeJobState): state is ComputeTerminalDisposition {
  return (COMPUTE_TERMINAL_DISPOSITIONS as readonly string[]).includes(state);
}

/** `true` when the `from → to` edge exists in the transition table. */
export function canTransitionComputeJob(from: ComputeJobState, to: ComputeJobState): boolean {
  return (COMPUTE_TRANSITIONS[from] as readonly ComputeJobState[]).includes(to);
}

/**
 * Asserts the `from → to` edge is legal (throws `RangeError` naming both
 * states and the legal successors otherwise — the fail-loud posture). The
 * in-memory reference adapter applies this on EVERY state change, so an
 * illegal transition can never be recorded silently.
 */
export function assertComputeTransition(from: ComputeJobState, to: ComputeJobState): void {
  if (!canTransitionComputeJob(from, to)) {
    const legal = (COMPUTE_TRANSITIONS[from] as readonly ComputeJobState[]).join(", ");
    throw new RangeError(
      `illegal compute-job transition '${from}' -> '${to}' (legal successors of '${from}': ` +
        `${legal.length > 0 ? legal : "none — terminal state"})`,
    );
  }
}
