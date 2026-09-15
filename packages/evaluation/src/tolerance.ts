/**
 * The DOCUMENTED tolerance specification (W403).
 *
 * The W403 accept criterion is: "a fixed fixture produces comparable
 * world-model outputs across runs with documented tolerance." THIS MODULE
 * IS THAT DOCUMENTED TOLERANCE. Every default epsilon below is exported,
 * named, and carries its rationale; {@link DEFAULT_TOLERANCE} is the object
 * the evaluation harness and the snapshot comparator apply by default.
 * Consumers may tighten or loosen any class by spreading the default and
 * overriding — the comparator honors whatever spec it is handed
 * ({@link validateToleranceSpec} guards the invariants).
 *
 * FIELD CLASSES (what the comparator judges them by):
 *
 * - **Position fields** (pitch meters — the entity `position`/
 *   `pitchPosition` slot's `value.x`/`value.y`): `|a - b| <= positionM`
 *   passes. Rationale: positions are perception-derived floats carried
 *   verbatim from W206 track observations through W401 fusion; a
 *   same-binary deterministic chain reproduces them bit-exactly, so the
 *   epsilon only absorbs legitimately harmless reordering of float
 *   operations — it is deliberately tiny (1 nanometer).
 * - **Confidence fields** (every `UncertainValue.confidence` slot, [0, 1]):
 *   `|a - b| <= confidence` passes. Rationale: confidences are products of
 *   documented factors (e.g. W401 possession: ball x track x distance
 *   discount); the tightest class in the spec because confidence deltas
 *   feed downstream trust decisions — 1e-12 is float-arithmetic noise,
 *   nothing more.
 * - **Millisecond time fields** (`eventTimeMs`-derived values: entity
 *   `lastEventTimeMs`, `state.lastSeenMs.value`, football
 *   `clock.clockMs`, `watermark.watermarkMs`): `|a - b| <= timeMs` passes,
 *   DEFAULT 0 — times are EXACT in this system. Rationale: every time is
 *   an integer-millisecond constant on the canonical media timeline
 *   (docs/testing/HARNESS.md rule 3); a cross-run time difference is a real
 *   semantic difference, never rounding.
 * - **Version/sequence integers** (`entities[*].version`,
 *   `football.score.home`/`away`, `watermark.sequence` when not excluded):
 *   must be EXACT (`integer: "exact"`). A version or score delta is a
 *   different number of state changes — never comparable within any
 *   epsilon.
 * - **Everything else** (ids, enums, statuses, provenance, structural
 *   presence): structural equality, exact — the comparator reports these as
 *   `kind: "structural"` and they always fail comparability when they
 *   differ.
 *
 * EXCLUDED FIELDS (the exclusion rules — BY RULE, never by accident; each
 * is a W402-documented replay-vs-live difference, and the comparator
 * records them as `kind: "excluded"` diff entries so they stay VISIBLE in
 * every comparison while never failing it):
 *
 * - `generatedAtMs` — the live engine's clock (W403 injects a constant;
 *   production engines read wall-clock) vs the replay's forced constant
 *   `REPLAY_GENERATED_AT_MS` (packages/temporal replay module). W402 pins
 *   this: replay output must be byte-reproducible, so replay snapshots
 *   carry the constant instead of a clock read.
 * - `watermark.sequence` — the live engine's global sequence counter vs
 *   the replay engine's own replay-local counter. W402 pins this: a replay
 *   rebuilds on a FRESH engine, so its sequences count only the replayed
 *   window, never the live engine's arrival order.
 *
 * Excluded entries are matched by EXACT path equality against the field
 * paths the comparator walks (dotted, snapshot-root-relative, e.g.
 * `"watermark.sequence"`); there is no globbing — an exclusion is a
 * precise, auditable rule.
 */
import type { WorldSnapshot } from "@sporta/contracts";

/**
 * The tolerance specification the comparator and harness honor.
 * See the module docblock for every class's rationale.
 */
export interface ToleranceSpec {
  /** Position fields (meters): `|a - b| <= this` passes. */
  positionM: number;
  /** Confidence fields: `|a - b| <= this` passes. */
  confidence: number;
  /** Millisecond time fields (`eventTimeMs`, watermark): `|a - b| <= this` passes. */
  timeMs: number;
  /**
   * Version/sequence integers: must be EXACT. Always `"exact"` — the class
   * exists so consumers cannot accidentally widen it.
   */
  integer: "exact";
  /**
   * Fields excluded from comparison BY RULE (documented, per field class):
   * `generatedAtMs` (engine clock vs replay constant — W402 documented) and
   * `watermark.sequence` (replay-local — W402 documented). Matched by exact
   * field-path equality against the comparator's walked paths.
   */
  excludedFields: readonly string[];
}

/**
 * Default position epsilon (meters). See the module docblock:
 * perception-derived pitch positions reproduced by the same deterministic
 * binary are bit-exact; 1e-9 m = 1 nanometer absorbs only float-operation
 * reordering noise.
 */
export const DEFAULT_POSITION_EPSILON_M = 1e-9;

/**
 * Default confidence epsilon. See the module docblock: the tightest class —
 * 1e-12 is float-arithmetic noise on products of documented factors;
 * anything larger would silently blur downstream trust decisions.
 */
export const DEFAULT_CONFIDENCE_EPSILON = 1e-12;

/**
 * Default time epsilon (milliseconds). 0 — times are EXACT in this system
 * (integer-millisecond constants on the canonical media timeline; HARNESS
 * rule 3). A cross-run time difference is semantic, never rounding.
 */
export const DEFAULT_TIME_EPSILON_MS = 0;

/**
 * The excluded-by-rule field paths (the W402-documented replay-vs-live
 * differences). See the module docblock for each rule's rationale.
 */
export const DEFAULT_EXCLUDED_FIELDS: readonly string[] = ["generatedAtMs", "watermark.sequence"];

/**
 * The default documented tolerance: the object the evaluation harness and
 * the snapshot comparator apply unless a consumer hands them a tighter or
 * looser spec. Built ONLY from the named, exported defaults above.
 */
export const DEFAULT_TOLERANCE: ToleranceSpec = {
  positionM: DEFAULT_POSITION_EPSILON_M,
  confidence: DEFAULT_CONFIDENCE_EPSILON,
  timeMs: DEFAULT_TIME_EPSILON_MS,
  integer: "exact",
  excludedFields: DEFAULT_EXCLUDED_FIELDS,
};

/**
 * Validates a tolerance spec (fail loud, repo style): the three epsilon
 * classes must be finite non-negative numbers, `integer` must be the exact
 * sentinel, and `excludedFields` an array of non-empty path strings.
 * Returns the spec unchanged so callers can use it inline.
 */
export function validateToleranceSpec(spec: ToleranceSpec): ToleranceSpec {
  if (spec === null || typeof spec !== "object") {
    throw new RangeError("ToleranceSpec must be an object");
  }
  for (const key of ["positionM", "confidence", "timeMs"] as const) {
    const value = spec[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new RangeError(
        `ToleranceSpec.${key} must be a finite number >= 0 (got ${String(value)})`,
      );
    }
  }
  if (spec.integer !== "exact") {
    throw new RangeError(
      'ToleranceSpec.integer must be "exact" (integers are never epsilon-comparable)',
    );
  }
  if (!Array.isArray(spec.excludedFields)) {
    throw new RangeError("ToleranceSpec.excludedFields must be an array of field paths");
  }
  for (const field of spec.excludedFields) {
    if (typeof field !== "string" || field.length < 1) {
      throw new RangeError(
        `ToleranceSpec.excludedFields entries must be non-empty strings (got ${String(field)})`,
      );
    }
  }
  return spec;
}

/**
 * Whether `path` is excluded BY RULE for this spec: exact path match
 * against `excludedFields` — the comparator consults this at every field
 * it walks.
 */
export function isExcludedField(spec: ToleranceSpec, path: string): boolean {
  return spec.excludedFields.includes(path);
}

/**
 * Convenience re-export so the comparator's consumers can name the snapshot
 * type this tolerance governs without importing `@sporta/contracts` twice.
 */
export type { WorldSnapshot };
