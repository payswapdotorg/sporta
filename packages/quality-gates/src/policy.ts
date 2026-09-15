/**
 * The versioned gate POLICY (a DATA document, not scattered ifs): which
 * gates exist, which package owns each, and which are BLOCKING for the
 * release verdict. Pinned row-for-row to docs/GATES.md §2 by
 * test/policy-doc.test.ts (the W503 THRESHOLDS.md convention — a change to
 * either side without the other fails the suite).
 *
 * Blocking gates: their FAIL makes the release FAIL. Advisory gates: their
 * FAIL is recorded but never blocks (the policy is explicit, never silent).
 */
export const GATE_POLICY_VERSION = "w803@1";

/** One gate's policy row. */
export interface GatePolicyRow {
  /** The gate id (stable, referenced by reports and GATES.md). */
  id: "temporal-stability" | "scene-correctness" | "human-review";
  /** The owning package (the real evaluation that runs). */
  source:
    "@sporta/renderer-evaluation" | "@sporta/scene-evaluation" | "@sporta/quality-gates/human";
  /** Whether a FAIL blocks the release. */
  blocking: boolean;
}

/** The gate policy table (GATES.md §2, pinned both directions). */
export const GATE_POLICY: readonly GatePolicyRow[] = [
  {
    id: "temporal-stability",
    source: "@sporta/renderer-evaluation",
    blocking: true,
  },
  {
    id: "scene-correctness",
    source: "@sporta/scene-evaluation",
    blocking: true,
  },
  {
    id: "human-review",
    source: "@sporta/quality-gates/human",
    blocking: true,
  },
];

/** The human-review checklist items (REVIEW.md §checklist, pinned by test). */
export const HUMAN_CHECKLIST: readonly string[] = [
  "one-rendered-clip-per-renderer-path-inspected",
  "gate-report-read-in-full",
  "sign-off-recorded",
];
