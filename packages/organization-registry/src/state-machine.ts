/**
 * The organization lifecycle state machine (REL-018, ADR-013 #9):
 * `draft -> benchmarked -> validated -> canary -> production -> retired`,
 * legal transitions only, `retired` terminal.
 *
 * Pure data + pure functions — no I/O, no clock, no policy thresholds. The
 * edges are split by OPERATION: promotion (forward only, gate-evaluated) and
 * rollback (canary/production -> retired, or -> canary where policy says
 * so). Anything not in the table is illegal and the callers refuse with a
 * TYPED refusal record — a skipped state (e.g. draft -> validated) is
 * structurally impossible, not merely discouraged.
 */
import type { OrganizationStatus } from "./domain";
import { ORGANIZATION_STATUSES } from "./domain";

/** How a transition may be performed. */
export type TransitionOperation = "promotion" | "rollback";

/**
 * The statuses reachable by a forward (promotion) step — everything except
 * `draft` (the start), `production` (the end of the forward path) and
 * `retired` (terminal).
 */
export type ForwardTarget = "benchmarked" | "validated" | "canary" | "production";

/** A legal edge of the lifecycle graph. */
export interface LifecycleEdge {
  readonly from: OrganizationStatus;
  readonly to: OrganizationStatus;
  readonly operation: TransitionOperation;
}

/** The forward path, precisely typed (every target IS a {@link ForwardTarget}). */
const PROMOTION_STEPS: readonly { from: OrganizationStatus; to: ForwardTarget }[] = [
  { from: "draft", to: "benchmarked" },
  { from: "benchmarked", to: "validated" },
  { from: "validated", to: "canary" },
  { from: "canary", to: "production" },
];

/**
 * The complete legal-edge table. THE list — a transition not on it does not
 * exist. Note there is no edge out of `retired` (terminal) and no edge that
 * skips a state.
 */
export const LIFECYCLE_EDGES: readonly LifecycleEdge[] = [
  // The promotion path (forward only; each step is gate-evaluated in
  // src/promotion.ts per the frozen pipeline).
  ...PROMOTION_STEPS.map((step) => ({ ...step, operation: "promotion" as const })),
  // Rollback: automatic retirement from canary or production, and the
  // policy-gated demotion production -> canary (the contract's "or -> canary
  // where policy says so").
  { from: "canary", to: "retired", operation: "rollback" },
  { from: "production", to: "retired", operation: "rollback" },
  { from: "production", to: "canary", operation: "rollback" },
];

/** All statuses with at least one outgoing legal edge. */
const HAS_OUTGOING: ReadonlySet<OrganizationStatus> = new Set(
  LIFECYCLE_EDGES.map((edge) => edge.from),
);

/** Is the from -> to transition legal (regardless of operation)? */
export function isLegalTransition(from: OrganizationStatus, to: OrganizationStatus): boolean {
  return LIFECYCLE_EDGES.some((edge) => edge.from === from && edge.to === to);
}

/** The edge for a legal from -> to pair, or null when the pair is illegal. */
export function lifecycleEdge(
  from: OrganizationStatus,
  to: OrganizationStatus,
): LifecycleEdge | null {
  return LIFECYCLE_EDGES.find((edge) => edge.from === from && edge.to === to) ?? null;
}

/** All legal targets from a status. */
export function legalTargetsFrom(from: OrganizationStatus): OrganizationStatus[] {
  return LIFECYCLE_EDGES.filter((edge) => edge.from === from).map((edge) => edge.to);
}

/** Is this status terminal (no outgoing edges)? Only `retired`. */
export function isTerminalStatus(status: OrganizationStatus): boolean {
  return !HAS_OUTGOING.has(status);
}

/**
 * The human-auditable refusal reason for an illegal from -> to attempt, or
 * null when the pair is legal. These strings are recorded verbatim in typed
 * refusal records — they name the LAW, not a suggestion.
 */
export function illegalTransitionReason(
  from: OrganizationStatus,
  to: OrganizationStatus,
): string | null {
  if (isLegalTransition(from, to)) return null;
  if (from === "retired") {
    return `retired is terminal: ${from} -> ${to} is not a legal transition (retirement preserves lineage; it never resurrects)`;
  }
  const fromIndex = ORGANIZATION_STATUSES.indexOf(from);
  const toIndex = ORGANIZATION_STATUSES.indexOf(to);
  if (toIndex > fromIndex) {
    const expected = legalTargetsFrom(from)[0];
    return `illegal skip: ${from} -> ${to} jumps states (the only forward step from ${from} is ${expected})`;
  }
  return `illegal backward transition: ${from} -> ${to} (rollback can only retire, or demote production to canary)`;
}

/**
 * The single forward (promotion) target from a status, or null when the
 * status has no forward step (production/retired).
 */
export function forwardTargetFrom(status: OrganizationStatus): ForwardTarget | null {
  const step = PROMOTION_STEPS.find((s) => s.from === status);
  return step !== undefined ? step.to : null;
}
