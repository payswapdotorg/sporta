/**
 * Snapshot comparison with tolerance (W403, pure).
 *
 * {@link compareSnapshots} walks TWO `WorldSnapshot`s field by field, in a
 * documented deterministic order, and REPORTS differences — it never throws
 * on a difference (only on malformed input, fail loud, repo style). Every
 * walked field belongs to a tolerance class from {@link ./tolerance.ts}
 * (position/confidence/timeMs epsilons, exact integers, structural
 * equality); fields excluded BY RULE are recorded as `kind: "excluded"`
 * entries — VISIBLE in every diff, never a failure.
 *
 * WALK ORDER (the order diff entries appear in; deterministic):
 *
 * 1. `sessionId` — structural (exact).
 * 2. `schemaVersion` — structural (exact).
 * 3. `watermark.watermarkMs` — numeric, `timeMs` class (default 0: times
 *    are exact in this system).
 * 4. `watermark.sequence` — integer, EXACT; excluded by rule under the
 *    default spec (W402: replay-local sequence) → recorded as an excluded
 *    entry.
 * 5. `entities` — by entityId UNION (ids sorted ascending, deterministic);
 *    an entity present in only one snapshot is one structural diff at
 *    `entities[<id>]`. Per entity: `kind` (structural), `version` (integer
 *    EXACT), `lastEventTimeMs` (numeric `timeMs`), then every `state` slot
 *    (slot keys sorted): `status` (structural), `confidence` (numeric
 *    `confidence` class), and `value` (the value walk below).
 * 6. `football` — presence mismatch is one structural diff; otherwise
 *    `pitch` literals (exact), `clock.period` (structural), `clock.clockMs`
 *    (numeric `timeMs`), `clock.stoppage` (structural), `score.home`/`away`
 *    (integer EXACT), `score.status` (uncertainty slot: status/value
 *    structural, confidence numeric), `possession` (status/value structural,
 *    confidence numeric), `eventTaxonomyVersion` (structural).
 * 7. `generatedAtMs` — excluded by rule under the default spec (W402:
 *    engine clock vs `REPLAY_GENERATED_AT_MS`) → recorded as an excluded
 *    entry.
 *
 * THE VALUE WALK (state slot `value`, recursive): when both sides are
 * numbers, the pair compares numerically with the SLOT's field class —
 * `lastSeenMs` uses the `timeMs` epsilon; `position`/`pitchPosition` (the
 * two delivered spellings of the pitch-position slot: W401 fusion writes
 * `position`, the W003 testing builder writes `pitchPosition`) and any
 * other numeric leaf use the `positionM` epsilon (the documented general
 * physical-quantity default — the loosest class, never silent). Plain
 * objects recurse over their sorted key union, arrays compare element-wise
 * (`value[<i>]` paths, length mismatch structural), and everything else
 * (strings, enums, booleans, null) compares structurally. A type mismatch
 * (object vs number, present vs absent) reports one structural diff.
 * Presence mismatches at subtree paths (an entity, a state slot, the
 * football state) honor exclusion rules the same way leaves do — a consumer
 * can exclude a whole subtree BY RULE.
 *
 * RECORDING SEMANTICS: non-excluded fields are recorded ONLY when they
 * actually differ (numeric entries carry their delta and the epsilon they
 * were judged against, so a within-tolerance difference stays visible
 * information); excluded-by-rule fields are recorded ALWAYS (with both
 * sides' values — the exclusion rules stay visible in every comparison,
 * equal or not). `comparable` is `true` iff no recorded entry is a
 * structural difference or a numeric difference beyond its epsilon.
 */
import { WorldEntity, WorldSnapshot } from "@sporta/contracts";
import type { ToleranceSpec } from "./tolerance";
import { DEFAULT_TOLERANCE, isExcludedField, validateToleranceSpec } from "./tolerance";

/** One reported field-level difference between two snapshots. */
export interface FieldDiff {
  /** Full dotted path of the differing field, e.g. `entities[t1].state.position.value.x`. */
  path: string;
  /** Numeric (epsilon/exact), structural (must be equal), or excluded (recorded, never a failure). */
  kind: "numeric" | "structural" | "excluded";
  /** The field's value in snapshot `a`. */
  a: unknown;
  /** The field's value in snapshot `b`. */
  b: unknown;
  /** `|a - b|` for numeric (and numeric excluded) entries. */
  delta?: number;
  /** The tolerance the entry was judged against: an epsilon, `"exact"`, or `"excluded"`. */
  tolerance: number | "exact" | "excluded";
}

/** The result of comparing two snapshots under a tolerance spec. */
export interface SnapshotDiff {
  /** `true` iff no diff beyond tolerance (excluded entries never fail). */
  comparable: boolean;
  /** Every recorded difference, in documented walk order (excluded entries included). */
  diffs: readonly FieldDiff[];
}

/** Formats zod issues as `path: message; ...` (the repo's structural style). */
function issuesOf(error: {
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
}): string {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
}

/** Validates one side as a contract `WorldSnapshot` (fail loud, repo style). */
function validateSnapshot(side: unknown, label: string): void {
  const check = WorldSnapshot.safeParse(side);
  if (!check.success) {
    throw new RangeError(
      `compareSnapshots: ${label} is not a valid WorldSnapshot: ${issuesOf(check.error)}`,
    );
  }
}

/**
 * Deep structural equality over plain values (objects, arrays, primitives) —
 * the comparator's "exact" judgment AND the harness's fusion-report
 * equality. Treats an absent key and a key explicitly set to `undefined` as
 * different (key sets must match).
 */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((element, index) => valuesEqual(element, b[index]));
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  const recordA = a as Record<string, unknown>;
  const recordB = b as Record<string, unknown>;
  return keysA.every((key) => key in recordB && valuesEqual(recordA[key], recordB[key]));
}

/** Whether a value is a plain (non-array) object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The comparator's accumulating state. */
interface WalkState {
  spec: ToleranceSpec;
  diffs: FieldDiff[];
}

/** Records one excluded-by-rule entry (always recorded, never a failure). */
function recordExcluded(state: WalkState, path: string, a: unknown, b: unknown): void {
  const delta = typeof a === "number" && typeof b === "number" ? Math.abs(a - b) : undefined;
  state.diffs.push({
    path,
    kind: "excluded",
    a,
    b,
    ...(delta !== undefined ? { delta } : {}),
    tolerance: "excluded",
  });
}

/** Records one structural diff (always a comparability failure). */
function recordStructural(state: WalkState, path: string, a: unknown, b: unknown): void {
  state.diffs.push({ path, kind: "structural", a, b, tolerance: "exact" });
}

/**
 * Records a presence mismatch (an entity/slot/football subtree present on
 * only one side) — honoring an exclusion rule for its path, so consumers
 * can exclude whole subtrees BY RULE the same way they exclude leaves.
 */
function recordPresence(state: WalkState, path: string, a: unknown, b: unknown): void {
  if (isExcludedField(state.spec, path)) {
    recordExcluded(state, path, a, b);
    return;
  }
  recordStructural(state, path, a, b);
}

/** Records one numeric diff with its epsilon (fails iff beyond the epsilon). */
function recordNumeric(
  state: WalkState,
  path: string,
  a: number,
  b: number,
  tolerance: number | "exact",
): void {
  state.diffs.push({ path, kind: "numeric", a, b, delta: Math.abs(a - b), tolerance });
}

/**
 * Compares one field whose comparison mode is structural equality, honoring
 * an exclusion rule for its path.
 */
function leafStructural(state: WalkState, path: string, a: unknown, b: unknown): void {
  if (isExcludedField(state.spec, path)) {
    recordExcluded(state, path, a, b);
    return;
  }
  if (!valuesEqual(a, b)) recordStructural(state, path, a, b);
}

/** Compares a field whose comparison mode is numeric (exact or epsilon). */
function leafNumeric(
  state: WalkState,
  path: string,
  a: unknown,
  b: unknown,
  tolerance: number | "exact",
): void {
  if (isExcludedField(state.spec, path)) {
    recordExcluded(state, path, a, b);
    return;
  }
  if (typeof a === "number" && typeof b === "number") {
    if (a !== b) recordNumeric(state, path, a, b, tolerance);
    return;
  }
  // Defensive: contract-valid snapshots never reach here, but a type
  // mismatch is REPORTED, never thrown (no throw on difference).
  if (!valuesEqual(a, b)) recordStructural(state, path, a, b);
}

/** Compares an optional numeric field (`undefined` on both sides is equal). */
function leafOptionalNumeric(
  state: WalkState,
  path: string,
  a: unknown,
  b: unknown,
  epsilon: number,
): void {
  if (isExcludedField(state.spec, path)) {
    recordExcluded(state, path, a, b);
    return;
  }
  if (a === undefined && b === undefined) return;
  if (typeof a === "number" && typeof b === "number") {
    if (a !== b) recordNumeric(state, path, a, b, epsilon);
    return;
  }
  recordStructural(state, path, a, b);
}

/**
 * The state-slot VALUE walk (see module docblock): numeric leaves compare
 * with the slot's epsilon class; objects/arrays recurse; everything else is
 * structural.
 */
function walkSlotValue(
  state: WalkState,
  path: string,
  a: unknown,
  b: unknown,
  epsilon: number,
): void {
  if (isExcludedField(state.spec, path)) {
    recordExcluded(state, path, a, b);
    return;
  }
  if (a === undefined && b === undefined) return;
  if (typeof a === "number" && typeof b === "number") {
    if (a !== b) recordNumeric(state, path, a, b, epsilon);
    return;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const key of keys) {
      walkSlotValue(state, `${path}.${key}`, a[key], b[key], epsilon);
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      recordStructural(state, path, a, b);
      return;
    }
    for (let index = 0; index < a.length; index += 1) {
      walkSlotValue(state, `${path}[${index}]`, a[index], b[index], epsilon);
    }
    return;
  }
  if (!valuesEqual(a, b)) recordStructural(state, path, a, b);
}

/**
 * The epsilon class a state slot's numeric leaves compare under:
 * `lastSeenMs` is a session-timeline time (`timeMs`); `position` and
 * `pitchPosition` are pitch meters; every other numeric leaf defaults to
 * the position epsilon (the documented general physical-quantity default).
 */
function slotEpsilon(slot: string, spec: ToleranceSpec): number {
  if (slot === "lastSeenMs") return spec.timeMs;
  return spec.positionM;
}

/** Compares one uncertainty slot (`status` / `confidence` / `value`). */
function walkUncertainSlot(
  state: WalkState,
  path: string,
  slotA: Record<string, unknown> | undefined,
  slotB: Record<string, unknown> | undefined,
  spec: ToleranceSpec,
): void {
  if (slotA === undefined || slotB === undefined) {
    if (slotA !== slotB) recordPresence(state, path, slotA, slotB);
    return;
  }
  leafStructural(state, `${path}.status`, slotA.status, slotB.status);
  leafOptionalNumeric(
    state,
    `${path}.confidence`,
    slotA.confidence,
    slotB.confidence,
    spec.confidence,
  );
  walkSlotValue(
    state,
    `${path}.value`,
    slotA.value,
    slotB.value,
    slotEpsilon(path.split(".").at(-1)!, spec),
  );
}

/** Compares the entity maps by entityId union (ids sorted, deterministic). */
function walkEntities(
  state: WalkState,
  a: ReadonlyArray<WorldEntity>,
  b: ReadonlyArray<WorldEntity>,
  spec: ToleranceSpec,
): void {
  const mapA = new Map(a.map((entity) => [entity.entityId, entity]));
  const mapB = new Map(b.map((entity) => [entity.entityId, entity]));
  const ids = [...new Set([...mapA.keys(), ...mapB.keys()])].sort();
  for (const id of ids) {
    const entityA = mapA.get(id);
    const entityB = mapB.get(id);
    const basePath = `entities[${id}]`;
    if (entityA === undefined || entityB === undefined) {
      recordPresence(state, basePath, entityA, entityB);
      continue;
    }
    leafStructural(state, `${basePath}.kind`, entityA.kind, entityB.kind);
    leafNumeric(state, `${basePath}.version`, entityA.version, entityB.version, "exact");
    leafNumeric(
      state,
      `${basePath}.lastEventTimeMs`,
      entityA.lastEventTimeMs,
      entityB.lastEventTimeMs,
      spec.timeMs,
    );
    const slotKeys = [
      ...new Set([...Object.keys(entityA.state), ...Object.keys(entityB.state)]),
    ].sort();
    for (const slot of slotKeys) {
      walkUncertainSlot(
        state,
        `${basePath}.state.${slot}`,
        entityA.state[slot],
        entityB.state[slot],
        spec,
      );
    }
  }
}

/** Compares the optional football extension states. */
function walkFootball(
  state: WalkState,
  a: WorldSnapshot["football"],
  b: WorldSnapshot["football"],
  spec: ToleranceSpec,
): void {
  if ((a === undefined) !== (b === undefined)) {
    recordPresence(state, "football", a, b);
    return;
  }
  if (a === undefined || b === undefined) return;
  leafNumeric(
    state,
    "football.pitch.lengthAxisMeters",
    a.pitch.lengthAxisMeters,
    b.pitch.lengthAxisMeters,
    "exact",
  );
  leafNumeric(
    state,
    "football.pitch.widthAxisMeters",
    a.pitch.widthAxisMeters,
    b.pitch.widthAxisMeters,
    "exact",
  );
  leafStructural(state, "football.pitch.origin", a.pitch.origin, b.pitch.origin);
  leafStructural(state, "football.pitch.axes", a.pitch.axes, b.pitch.axes);
  leafStructural(state, "football.clock.period", a.clock.period, b.clock.period);
  leafNumeric(state, "football.clock.clockMs", a.clock.clockMs, b.clock.clockMs, spec.timeMs);
  leafStructural(state, "football.clock.stoppage", a.clock.stoppage, b.clock.stoppage);
  leafNumeric(state, "football.score.home", a.score.home, b.score.home, "exact");
  leafNumeric(state, "football.score.away", a.score.away, b.score.away, "exact");
  walkUncertainSlot(state, "football.score.status", a.score.status, b.score.status, spec);
  walkUncertainSlot(state, "football.possession", a.possession, b.possession, spec);
  leafStructural(
    state,
    "football.eventTaxonomyVersion",
    a.eventTaxonomyVersion,
    b.eventTaxonomyVersion,
  );
}

/**
 * Compares two world snapshots field by field under a tolerance spec.
 *
 * REPORTS, never throws, on differences; throws `RangeError` only when a
 * side is not a contract-valid `WorldSnapshot` (fail loud, repo style). The
 * returned `SnapshotDiff` (and every diff entry) is frozen. See the module
 * docblock for the walk order, field classes, value walk, and recording
 * semantics.
 */
export function compareSnapshots(
  a: WorldSnapshot,
  b: WorldSnapshot,
  tolerance: ToleranceSpec = DEFAULT_TOLERANCE,
): SnapshotDiff {
  validateSnapshot(a, "a");
  validateSnapshot(b, "b");
  const spec = validateToleranceSpec(tolerance);
  const state: WalkState = { spec, diffs: [] };

  leafStructural(state, "sessionId", a.sessionId, b.sessionId);
  leafStructural(state, "schemaVersion", a.schemaVersion, b.schemaVersion);
  leafNumeric(
    state,
    "watermark.watermarkMs",
    a.watermark.watermarkMs,
    b.watermark.watermarkMs,
    spec.timeMs,
  );
  leafNumeric(state, "watermark.sequence", a.watermark.sequence, b.watermark.sequence, "exact");
  walkEntities(state, a.entities, b.entities, spec);
  walkFootball(state, a.football, b.football, spec);
  leafNumeric(state, "generatedAtMs", a.generatedAtMs, b.generatedAtMs, spec.timeMs);

  const comparable = state.diffs.every((diff) => {
    if (diff.kind === "excluded") return true;
    if (diff.kind === "structural") return false;
    return typeof diff.tolerance === "number" && (diff.delta ?? 0) <= diff.tolerance;
  });
  const diffs = state.diffs.map((diff) => Object.freeze({ ...diff }));
  return Object.freeze({ comparable, diffs: Object.freeze(diffs) });
}
