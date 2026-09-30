/**
 * The acquisition state machine (REL-009,
 * docs/contracts/historical-media-and-corpus.md §Acquisition states):
 *
 * ```
 * referenced -> authorized-for-access -> acquired -> normalized -> benchmarked
 * ```
 *
 * Pure data + pure functions — no I/O, no clock, no rights policy. The
 * edges are the LAW: a transition not on the table does not exist, and the
 * store (src/store.ts) refuses illegal attempts with a typed error. Note
 * the two guarded edges:
 * - `referenced -> authorized-for-access` additionally REQUIRES an explicit
 *   rights/policy basis record (the store's gate; the table alone is not
 *   the whole law);
 * - the `acquired` birth state of user-fed uploads is NOT a transition —
 *   the record is created with bytes + declared basis in hand, so no edge
 *   is traversed (the machine governs transitions of EXISTING records).
 */
import type { AcquisitionState } from "./domain";
import { ACQUISITION_STATES } from "./domain";

/** How a legal acquisition transition may be performed. */
export type AcquisitionOperation = "authorize" | "acquire" | "normalize" | "benchmark";

/** A legal edge of the acquisition graph. */
export interface AcquisitionEdge {
  readonly from: AcquisitionState;
  readonly to: AcquisitionState;
  readonly operation: AcquisitionOperation;
}

/**
 * The complete legal-edge table. THE list — a transition not on it does not
 * exist. There is no edge out of `benchmarked` (terminal) and no edge that
 * skips a state: `referenced -> acquired` is structurally impossible, which
 * is the state-machine half of the rights invariant (the basis record is
 * the other half).
 */
export const ACQUISITION_EDGES: readonly AcquisitionEdge[] = [
  { from: "referenced", to: "authorized-for-access", operation: "authorize" },
  { from: "authorized-for-access", to: "acquired", operation: "acquire" },
  { from: "acquired", to: "normalized", operation: "normalize" },
  { from: "normalized", to: "benchmarked", operation: "benchmark" },
];

/** All states with at least one outgoing legal edge. */
const HAS_OUTGOING: ReadonlySet<AcquisitionState> = new Set(
  ACQUISITION_EDGES.map((edge) => edge.from),
);

/** Is the from -> to transition legal (regardless of operation)? */
export function isLegalAcquisitionTransition(
  from: AcquisitionState,
  to: AcquisitionState,
): boolean {
  return ACQUISITION_EDGES.some((edge) => edge.from === from && edge.to === to);
}

/** The edge for a legal from -> to pair, or null when the pair is illegal. */
export function acquisitionEdge(
  from: AcquisitionState,
  to: AcquisitionState,
): AcquisitionEdge | null {
  return ACQUISITION_EDGES.find((edge) => edge.from === from && edge.to === to) ?? null;
}

/** All legal targets from a state. */
export function legalAcquisitionTargetsFrom(from: AcquisitionState): AcquisitionState[] {
  return ACQUISITION_EDGES.filter((edge) => edge.from === from).map((edge) => edge.to);
}

/** Is this state terminal (no outgoing edges)? Only `benchmarked`. */
export function isTerminalAcquisitionState(state: AcquisitionState): boolean {
  return !HAS_OUTGOING.has(state);
}

/**
 * The human-auditable refusal reason for an illegal from -> to attempt, or
 * null when the pair is legal. These strings are recorded verbatim in typed
 * refusal records — they name the LAW, not a suggestion.
 */
export function illegalAcquisitionTransitionReason(
  from: AcquisitionState,
  to: AcquisitionState,
): string | null {
  if (isLegalAcquisitionTransition(from, to)) return null;
  if (from === "benchmarked") {
    return `benchmarked is terminal: ${from} -> ${to} is not a legal transition (a benchmarked source is frozen evidence)`;
  }
  const fromIndex = ACQUISITION_STATES.indexOf(from);
  const toIndex = ACQUISITION_STATES.indexOf(to);
  if (toIndex > fromIndex) {
    const expected = legalAcquisitionTargetsFrom(from)[0];
    return `illegal skip: ${from} -> ${to} jumps states (the only step from ${from} is ${expected ?? "none"})`;
  }
  return `illegal backward transition: ${from} -> ${to} (acquisition only moves forward: ${ACQUISITION_STATES.join(" -> ")})`;
}
