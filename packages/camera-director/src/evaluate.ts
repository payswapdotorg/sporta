/**
 * The evaluation surface of a camera plan (W604 → W605): per-window
 * decision records, flattened for scoring. Everything here is a PURE
 * projection of the plan's own data (no re-derivation, no invention) —
 * W605 scores director quality against these records. The projection is
 * ISOLATED: every record carries FRESH `source` and `decision` documents
 * (deep clones of the plan's JSON-safe values), so an evaluator mutating a
 * record can never corrupt the plan it was projected from.
 */
import { cloneJson } from "./internal";
import type { CameraPlan, PresentationKind, WindowDecision } from "./types";

/**
 * One flattened decision record: which window, which rule fired, which
 * event drove it (verbatim), what was directed. A 1:1 projection of
 * `plan.windows[i].decision` + the window's identity fields.
 */
export interface PlanDecisionRecord {
  /** The window's rundown index. */
  windowIndex: number;
  /** The presentation kind (live / review). */
  kind: PresentationKind;
  /** The window's match-timeline source range (closed). */
  source: { startMs: number; endMs: number };
  /** The directed camera slot. */
  cameraSlotId: string;
  /** The decision: rule id, verbatim event, follow inputs, pinned hold. */
  decision: WindowDecision;
}

/**
 * The per-window decision records of a plan, rundown order — the
 * evaluation surface ("which rule fired, which event drove it,
 * confidence verbatim from candidates"). Pure projection.
 */
export function planDecisionRecords(plan: CameraPlan): PlanDecisionRecord[] {
  return plan.windows.map((window) => ({
    windowIndex: window.index,
    kind: window.kind,
    source: cloneJson(window.source),
    cameraSlotId: window.cameraSlotId,
    decision: cloneJson(window.decision),
  }));
}
