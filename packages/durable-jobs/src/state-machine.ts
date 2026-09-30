/**
 * The job state machine (REL-012): legal edges only, typed refusal reasons.
 *
 * The edges are split by OPERATION:
 * - `acquire`: queued -> leased (a worker takes the job);
 * - `start`: leased -> running (execution begins; the attempts law applies);
 * - `checkpoint`: running -> checkpointed (a durable resume point);
 * - `resume`: checkpointed -> running (execution continues);
 * - `complete`: running|checkpointed -> completed;
 * - `fail`: running|checkpointed -> failed;
 * - `retry`: failed -> queued (policy-bounded, after the backoff delay);
 * - `requeue-takeover`: leased|running|checkpointed -> queued (the lease
 *   EXPIRED — the store enforces expiry; another worker then re-acquires);
 * - `cancel`: queued|leased|running|checkpointed -> cancelled.
 *
 * Note what does NOT exist: no edge skips `queued -> leased -> running`, no
 * edge out of a terminal state, and no edge that lets a worker write a job
 * it does not hold a live lease on (that law is the store's lease
 * discipline, layered on top of this table).
 */
import type { JobState } from "./domain";

/** How a legal job transition may be performed. */
export type JobTransitionOperation =
  | "acquire"
  | "start"
  | "checkpoint"
  | "resume"
  | "complete"
  | "fail"
  | "retry"
  | "requeue-takeover"
  | "cancel";

/** A legal edge of the job state graph. */
export interface JobEdge {
  readonly from: JobState;
  readonly to: JobState;
  readonly operation: JobTransitionOperation;
}

/**
 * The complete legal-edge table. THE list — a transition not on it does not
 * exist.
 */
export const JOB_EDGES: readonly JobEdge[] = [
  { from: "queued", to: "leased", operation: "acquire" },
  { from: "leased", to: "running", operation: "start" },
  { from: "running", to: "checkpointed", operation: "checkpoint" },
  { from: "checkpointed", to: "running", operation: "resume" },
  { from: "running", to: "completed", operation: "complete" },
  { from: "checkpointed", to: "completed", operation: "complete" },
  { from: "running", to: "failed", operation: "fail" },
  { from: "checkpointed", to: "failed", operation: "fail" },
  { from: "failed", to: "queued", operation: "retry" },
  { from: "leased", to: "queued", operation: "requeue-takeover" },
  { from: "running", to: "queued", operation: "requeue-takeover" },
  { from: "checkpointed", to: "queued", operation: "requeue-takeover" },
  { from: "queued", to: "cancelled", operation: "cancel" },
  { from: "leased", to: "cancelled", operation: "cancel" },
  { from: "running", to: "cancelled", operation: "cancel" },
  { from: "checkpointed", to: "cancelled", operation: "cancel" },
];

/** All states with at least one outgoing legal edge. */
const HAS_OUTGOING: ReadonlySet<JobState> = new Set(JOB_EDGES.map((edge) => edge.from));

/** Is the from -> to transition legal (regardless of operation)? */
export function isLegalJobTransition(from: JobState, to: JobState): boolean {
  return JOB_EDGES.some((edge) => edge.from === from && edge.to === to);
}

/** The edge for a legal from -> to pair, or null when the pair is illegal. */
export function jobEdge(from: JobState, to: JobState): JobEdge | null {
  return JOB_EDGES.find((edge) => edge.from === from && edge.to === to) ?? null;
}

/** All legal targets from a state. */
export function legalJobTargetsFrom(from: JobState): JobState[] {
  return JOB_EDGES.filter((edge) => edge.from === from).map((edge) => edge.to);
}

/** Is this state terminal (no outgoing edges)? */
export function isTerminalState(state: JobState): boolean {
  return !HAS_OUTGOING.has(state);
}

/**
 * The human-auditable refusal reason for an illegal from -> to attempt, or
 * null when the pair is legal. These strings are recorded verbatim in
 * typed refusal records — they name the LAW, not a suggestion.
 */
export function illegalJobTransitionReason(from: JobState, to: JobState): string | null {
  if (isLegalJobTransition(from, to)) return null;
  if (isTerminalState(from)) {
    return `${from} is terminal: ${from} -> ${to} is not a legal transition (terminal records are frozen evidence; the journal preserves the history)`;
  }
  if (from === "queued" && to !== "leased" && to !== "cancelled") {
    return `illegal jump from queued: ${from} -> ${to} (a job must be leased by a worker before it can run; the only other edge from queued is cancellation)`;
  }
  if (to === "running") {
    return `illegal jump to running: ${from} -> ${to} (running is only reachable from leased by a start, or from checkpointed by a resume)`;
  }
  if (to === "queued") {
    return `illegal requeue: ${from} -> ${to} (only a policy-bounded retry after failure, or a lease-expired takeover, requeues a job)`;
  }
  return `illegal transition: ${from} -> ${to} (no such edge in the job state machine)`;
}
