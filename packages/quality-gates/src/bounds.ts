/**
 * The W803 STRUCTURAL bounds — the only numeric constants this package
 * defines (docs/GATES.md §structural-bounds, pinned row-for-row by
 * `test/policyDoc.test.ts`).
 *
 * These are NOT quality thresholds. The roadmap's rule — a number without
 * measured evidence is an aspiration, not an SLO, and not a gate — applies
 * to QUALITY thresholds; every quality threshold used by this suite belongs
 * to and stays in the source evaluation packages (referenced, never
 * redefined — docs/GATES.md §gates). The constants below are field-size
 * sanity bounds on bounded record formats (the W605 `MAX_FINDINGS = 200`
 * precedent: a cap that keeps documents bounded, with truncation or
 * rejection accounted — never a judgment about measured quality).
 */
/** The bound object's identity (echoed by docs/GATES.md §structural-bounds). */
export const STRUCTURAL_BOUNDS_ID = "w803-structural-bounds-v1";

/** One documented structural bound. */
export interface StructuralBound {
  readonly name: string;
  readonly value: number;
  readonly purpose: string;
}

export const STRUCTURAL_BOUNDS: readonly StructuralBound[] = [
  {
    name: "MAX_FIXTURE_CASE_NAME_LENGTH",
    value: 200,
    purpose: "a scene-fixture case name is a bounded label, not free text",
  },
  {
    name: "MAX_REVIEWER_LENGTH",
    value: 200,
    purpose: "a reviewer identity is a bounded label, not free text",
  },
  {
    name: "MAX_SCOPE_LENGTH",
    value: 2000,
    purpose: "the review record's scope statement stays a statement, not a log",
  },
  {
    name: "MAX_ITEM_NOTES_LENGTH",
    value: 2000,
    purpose: "per-checklist-item notes stay notes, not reports",
  },
  {
    name: "MAX_RECORD_NOTES_LENGTH",
    value: 4000,
    purpose: "the record's overall notes stay notes, not reports",
  },
] as const;

/** Looks one bound up by name (fail-loud: an unknown name is a code bug). */
export function structuralBound(name: string): number {
  const bound = STRUCTURAL_BOUNDS.find((entry) => entry.name === name);
  if (bound === undefined) {
    throw new RangeError(`structuralBound: no bound named "${name}"`);
  }
  return bound.value;
}
