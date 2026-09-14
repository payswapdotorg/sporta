/**
 * The field-classified deep comparator (W403, pure, deterministic).
 *
 * THE CONTRACT (see TOLERANCE.md for the full documented tolerance):
 *
 * - every compared field belongs to a tolerance CLASS: `EXACT` (ints, strings,
 *   enums, ids — same-binary determinism), `EPSILON` (float-derived values,
 *   compared within the documented epsilon, default 1e-9), `COUNT`
 *   (observability counts — integers, exact), or `SET` (order-insensitive
 *   collections, ONLY where element order is genuinely semantically
 *   irrelevant — each justified in TOLERANCE.md);
 * - a field NOT covered by the classification FAILS LOUD: the diff carries
 *   the full JSON path and class `UNCLASSIFIED`. Nothing ever silently passes;
 * - `NaN` and `undefined`-vs-missing mismatches are flagged explicitly in
 *   diffs, never coerced;
 * - the comparison is a PURE function of (expected, actual, spec): no clock,
 *   no RNG; object keys are walked in sorted order and SET elements in
 *   canonical key order, so even the DIFF LIST is deterministic.
 */
import { canonicalizeValue } from "./serialize";

/** The tolerance class of one compared field. */
export type FieldClass = "EXACT" | "EPSILON" | "COUNT" | "SET";

/**
 * One classification rule: the JSON-path pattern a field must match, its
 * class, and (for `SET`) the element property used as the canonical sort key.
 *
 * Pattern grammar (full-path match — no prefixes):
 * - `$` — the artifact root;
 * - a literal segment — matches itself;
 * - `*` — any single key segment (used only where the key family is asserted
 *   elsewhere: `$.fusion.*` = {first, refusion}, `$.stateAt.*` = the fixture's
 *   pinned timestamps — both pinned by `assertArtifactShape`);
 * - `[*]` — any array-index or SET-element locator segment (`[3]`, `[pA]`).
 */
export interface ClassificationRule {
  readonly pattern: string;
  readonly fieldClass: FieldClass;
  /** SET only: the element property whose value sorts the set (fail loud on duplicates). */
  readonly setKey?: string;
  /** Why this field has this class (mirrored in TOLERANCE.md). */
  readonly rationale: string;
}

/** The default documented epsilon for EPSILON-class fields. */
export const DEFAULT_EPSILON = 1e-9;

/**
 * The tolerance specification of one comparison: the epsilon and the ordered
 * rule table (first matching rule wins).
 */
export interface ToleranceSpec {
  readonly epsilon: number;
  readonly rules: readonly ClassificationRule[];
}

/** One field-level difference (the structured diff report entry). */
export interface FieldDiff {
  /** Full JSON path of the differing field, e.g. `$.stateAt.5000.entities[pA].state.position.value.x`. */
  readonly path: string;
  /** The field's class — or `UNCLASSIFIED` when no rule covers the path. */
  readonly fieldClass: FieldClass | "UNCLASSIFIED";
  /** The expected value, rendered JSON-safely (undefined → `"undefined"`, NaN → `"NaN"`). */
  readonly expected: string;
  /** The actual value, rendered the same way. */
  readonly actual: string;
  /** `|expected − actual|` for numeric breaches (absent for structural diffs). */
  readonly deviation?: number;
  /** Human explanation of the failure. */
  readonly reason: string;
}

/** Deterministic comparison statistics. */
export interface ComparisonSummary {
  readonly exactFieldsCompared: number;
  readonly countFieldsCompared: number;
  readonly epsilonFieldsCompared: number;
  readonly setArraysCompared: number;
  /** Max |expected − actual| observed over EPSILON fields (0 when all equal). */
  readonly maxAbsDeviation: number;
}

/** The result of one classified comparison. */
export interface ComparisonReport {
  /** `true` iff zero diffs (every field classified, in tolerance, structurally equal). */
  readonly passed: boolean;
  readonly diffCount: number;
  readonly diffs: readonly FieldDiff[];
  readonly summary: ComparisonSummary;
}

// ---------------------------------------------------------------------------
// The W403 artifact classification (the documented tolerance table).
// ---------------------------------------------------------------------------

/**
 * Builds the classification rules INSIDE one serialized world snapshot. The
 * same snapshot shape appears at three artifact locations — `$.stateAt.*`
 * (pinned-timestamp snapshots), `$.replay.checkpoints[*]`, and
 * `$.replay.final` — so the internal rules are shared across the three roots.
 */
function snapshotRules(root: string): ClassificationRule[] {
  const rules: ClassificationRule[] = [
    {
      pattern: root,
      fieldClass: "EXACT",
      rationale: "snapshot container — structural recursion",
    },
    { pattern: `${root}.sessionId`, fieldClass: "EXACT", rationale: "id string" },
    { pattern: `${root}.schemaVersion`, fieldClass: "EXACT", rationale: "contract version string" },
    { pattern: `${root}.watermark`, fieldClass: "EXACT", rationale: "container" },
    {
      pattern: `${root}.watermark.watermarkMs`,
      fieldClass: "EXACT",
      rationale: "integer millisecond timeline position",
    },
    {
      pattern: `${root}.watermark.sequence`,
      fieldClass: "EXACT",
      rationale: "integer event-log sequence",
    },
    {
      pattern: `${root}.entities`,
      fieldClass: "SET",
      setKey: "entityId",
      rationale:
        "a snapshot is a world STATE: consumers resolve entities by id; the engine's array " +
        "order is Map insertion order (an implementation detail), not semantic. Within one " +
        "binary the order is deterministic anyway, so SET is not a loosening in practice",
    },
    {
      pattern: `${root}.entities[*]`,
      fieldClass: "EXACT",
      rationale: "entity container — structural recursion",
    },
    { pattern: `${root}.entities[*].entityId`, fieldClass: "EXACT", rationale: "id string" },
    { pattern: `${root}.entities[*].kind`, fieldClass: "EXACT", rationale: "enum" },
    {
      pattern: `${root}.entities[*].version`,
      fieldClass: "EXACT",
      rationale: "integer entity version (monotonic state version, not an observability count)",
    },
    {
      pattern: `${root}.entities[*].lastEventTimeMs`,
      fieldClass: "EXACT",
      rationale: "integer millisecond timeline position",
    },
    {
      pattern: `${root}.entities[*].state`,
      fieldClass: "EXACT",
      rationale: "state-slot container",
    },
    {
      pattern: `${root}.entities[*].state.position`,
      fieldClass: "EXACT",
      rationale: "uncertainty-slot container",
    },
    {
      pattern: `${root}.entities[*].state.position.status`,
      fieldClass: "EXACT",
      rationale: "enum",
    },
    {
      pattern: `${root}.entities[*].state.position.value`,
      fieldClass: "EXACT",
      rationale: "point container",
    },
    {
      pattern: `${root}.entities[*].state.position.value.x`,
      fieldClass: "EPSILON",
      rationale: "pitch meters — float-derived perception value",
    },
    {
      pattern: `${root}.entities[*].state.position.value.y`,
      fieldClass: "EPSILON",
      rationale: "pitch meters — float-derived perception value",
    },
    {
      pattern: `${root}.entities[*].state.position.confidence`,
      fieldClass: "EPSILON",
      rationale: "confidence in [0,1] — float-derived, passed through verbatim",
    },
    {
      pattern: `${root}.entities[*].state.spatialFrame`,
      fieldClass: "EXACT",
      rationale: "uncertainty-slot container",
    },
    {
      pattern: `${root}.entities[*].state.spatialFrame.status`,
      fieldClass: "EXACT",
      rationale: "enum",
    },
    {
      pattern: `${root}.entities[*].state.spatialFrame.value`,
      fieldClass: "EXACT",
      rationale: 'enum ("pitch" or "image")',
    },
    {
      pattern: `${root}.entities[*].state.lastSeenMs`,
      fieldClass: "EXACT",
      rationale: "uncertainty-slot container",
    },
    {
      pattern: `${root}.entities[*].state.lastSeenMs.status`,
      fieldClass: "EXACT",
      rationale: "enum",
    },
    {
      pattern: `${root}.entities[*].state.lastSeenMs.value`,
      fieldClass: "EXACT",
      rationale: "integer millisecond timeline position",
    },
    {
      pattern: `${root}.football`,
      fieldClass: "EXACT",
      rationale: "football extension container (optional key)",
    },
    { pattern: `${root}.football.pitch`, fieldClass: "EXACT", rationale: "container" },
    {
      pattern: `${root}.football.pitch.lengthAxisMeters`,
      fieldClass: "EXACT",
      rationale: "canonical constant literal (105)",
    },
    {
      pattern: `${root}.football.pitch.widthAxisMeters`,
      fieldClass: "EXACT",
      rationale: "canonical constant literal (68)",
    },
    {
      pattern: `${root}.football.pitch.origin`,
      fieldClass: "EXACT",
      rationale: "canonical literal",
    },
    { pattern: `${root}.football.pitch.axes`, fieldClass: "EXACT", rationale: "canonical literal" },
    { pattern: `${root}.football.clock`, fieldClass: "EXACT", rationale: "container" },
    { pattern: `${root}.football.clock.period`, fieldClass: "EXACT", rationale: "enum" },
    {
      pattern: `${root}.football.clock.clockMs`,
      fieldClass: "EXACT",
      rationale: "integer millisecond clock value",
    },
    { pattern: `${root}.football.clock.stoppage`, fieldClass: "EXACT", rationale: "boolean" },
    { pattern: `${root}.football.score`, fieldClass: "EXACT", rationale: "container" },
    { pattern: `${root}.football.score.home`, fieldClass: "EXACT", rationale: "integer goals" },
    { pattern: `${root}.football.score.away`, fieldClass: "EXACT", rationale: "integer goals" },
    {
      pattern: `${root}.football.score.status`,
      fieldClass: "EXACT",
      rationale: "uncertainty-slot container",
    },
    {
      pattern: `${root}.football.score.status.status`,
      fieldClass: "EXACT",
      rationale: "enum",
    },
    {
      pattern: `${root}.football.score.status.value`,
      fieldClass: "EXACT",
      rationale: 'enum ("provisional" or "confirmed")',
    },
    {
      pattern: `${root}.football.score.status.confidence`,
      fieldClass: "EPSILON",
      rationale: "confidence in [0,1] — float-derived",
    },
    {
      pattern: `${root}.football.possession`,
      fieldClass: "EXACT",
      rationale: "uncertainty-slot container",
    },
    { pattern: `${root}.football.possession.status`, fieldClass: "EXACT", rationale: "enum" },
    {
      pattern: `${root}.football.possession.value`,
      fieldClass: "EXACT",
      rationale: "container",
    },
    {
      pattern: `${root}.football.possession.value.entityId`,
      fieldClass: "EXACT",
      rationale: "id string",
    },
    {
      pattern: `${root}.football.possession.confidence`,
      fieldClass: "EPSILON",
      rationale:
        "possession confidence = ball × track × distance product — genuine float arithmetic",
    },
    {
      pattern: `${root}.football.eventTaxonomyVersion`,
      fieldClass: "EXACT",
      rationale: "version string",
    },
    {
      pattern: `${root}.generatedAtMs`,
      fieldClass: "EXACT",
      rationale:
        "forced-constant by construction (injected clock TEST_EPOCH_MS for live snapshots, " +
        "REPLAY_GENERATED_AT_MS for replay snapshots) — asserted in the pipeline, compared exact",
    },
  ];
  return rules;
}

/**
 * The complete, ordered W403 artifact classification. First matching rule
 * wins; a path matching NO rule is `UNCLASSIFIED` → the comparison fails
 * loud. TOLERANCE.md documents this table (a test pins doc/table equality).
 */
export const W403_ARTIFACT_CLASSIFICATION: readonly ClassificationRule[] = [
  { pattern: "$", fieldClass: "EXACT", rationale: "artifact root container" },
  { pattern: "$.artifactSchema", fieldClass: "EXACT", rationale: "schema tag string" },
  { pattern: "$.fixtureId", fieldClass: "EXACT", rationale: "fixture identity string" },
  {
    pattern: "$.fixtureSha256",
    fieldClass: "EXACT",
    rationale: "sha256 hex of the frozen fixture bytes — proves identical input across runs",
  },
  { pattern: "$.fusion", fieldClass: "EXACT", rationale: "fusion section container" },
  {
    pattern: "$.fusion.*",
    fieldClass: "EXACT",
    rationale: "fusion report container (first or refusion — keys asserted by shape check)",
  },
  {
    pattern: "$.fusion.*.entitiesUpserted",
    fieldClass: "COUNT",
    rationale: "observability count",
  },
  { pattern: "$.fusion.*.eventsApplied", fieldClass: "COUNT", rationale: "observability count" },
  {
    pattern: "$.fusion.*.eventsDeduplicated",
    fieldClass: "COUNT",
    rationale: "observability count",
  },
  { pattern: "$.fusion.*.clockPatches", fieldClass: "COUNT", rationale: "observability count" },
  {
    pattern: "$.fusion.*.possessionUpdates",
    fieldClass: "COUNT",
    rationale: "observability count",
  },
  {
    pattern: "$.fusion.*.snapshotVersionAfter",
    fieldClass: "EXACT",
    rationale: "integer engine snapshot version (state version, not an observability count)",
  },
  {
    pattern: "$.fusion.*.conflicts",
    fieldClass: "EXACT",
    rationale:
      "conflict ledger in deterministic merge order — the ledger sequence cf-1, cf-2… is semantic",
  },
  {
    pattern: "$.fusion.*.conflicts[*]",
    fieldClass: "EXACT",
    rationale: "conflict record container",
  },
  {
    pattern: "$.fusion.*.conflicts[*].conflictId",
    fieldClass: "EXACT",
    rationale: "ledger sequence id string",
  },
  { pattern: "$.fusion.*.conflicts[*].slotKey", fieldClass: "EXACT", rationale: "slot key string" },
  {
    pattern: "$.fusion.*.conflicts[*].observationIds",
    fieldClass: "EXACT",
    rationale: "order-stable canonical (eventTimeMs, observationId) ordering — semantic",
  },
  {
    pattern: "$.fusion.*.conflicts[*].observationIds[*]",
    fieldClass: "EXACT",
    rationale: "id string",
  },
  {
    pattern: "$.fusion.*.conflicts[*].values",
    fieldClass: "EXACT",
    rationale: "values in observationIds order — paired ordering is semantic",
  },
  {
    pattern: "$.fusion.*.conflicts[*].values[*]",
    fieldClass: "EXACT",
    rationale: "conflict value container",
  },
  {
    pattern: "$.fusion.*.conflicts[*].values[*].value",
    fieldClass: "EXACT",
    rationale:
      "conflicting slot values — entity-id strings in this fixture (a future numeric value " +
      "would need a conscious class decision)",
  },
  {
    pattern: "$.fusion.*.conflicts[*].values[*].confidence",
    fieldClass: "EPSILON",
    rationale: "confidence in [0,1] — float-derived",
  },
  {
    pattern: "$.fusion.*.conflicts[*].resolution",
    fieldClass: "EXACT",
    rationale: "enum (W401 never auto-resolves)",
  },
  {
    pattern: "$.fusion.*.conflicts[*].detectedAtMs",
    fieldClass: "EXACT",
    rationale: "integer millisecond timeline position",
  },
  {
    pattern: "$.fusion.*.warnings",
    fieldClass: "EXACT",
    rationale:
      "warnings in the fusion pass's documented deterministic emission order — tighter than " +
      "needed semantically, deliberately (same binary ⇒ deterministic order)",
  },
  { pattern: "$.fusion.*.warnings[*]", fieldClass: "EXACT", rationale: "warning string" },
  { pattern: "$.stateAt", fieldClass: "EXACT", rationale: "stateAt section container" },
  ...snapshotRules("$.stateAt.*"),
  { pattern: "$.eventWindow", fieldClass: "EXACT", rationale: "eventWindow section container" },
  { pattern: "$.eventWindow.fromMs", fieldClass: "EXACT", rationale: "integer ms window bound" },
  { pattern: "$.eventWindow.toMs", fieldClass: "EXACT", rationale: "integer ms window bound" },
  {
    pattern: "$.eventWindow.entries",
    fieldClass: "EXACT",
    rationale:
      "engine log order (event time then sequence) — the engine's application order, semantic",
  },
  {
    pattern: "$.eventWindow.entries[*]",
    fieldClass: "EXACT",
    rationale: "stream-entry container",
  },
  {
    pattern: "$.eventWindow.entries[*].sequence",
    fieldClass: "EXACT",
    rationale: "integer log sequence",
  },
  {
    pattern: "$.eventWindow.entries[*].snapshotVersionAfter",
    fieldClass: "EXACT",
    rationale: "integer snapshot version",
  },
  {
    pattern: "$.eventWindow.entries[*].event",
    fieldClass: "EXACT",
    rationale: "event envelope container",
  },
  {
    pattern: "$.eventWindow.entries[*].event.eventId",
    fieldClass: "EXACT",
    rationale: "id string",
  },
  {
    pattern: "$.eventWindow.entries[*].event.sessionId",
    fieldClass: "EXACT",
    rationale: "id string",
  },
  {
    pattern: "$.eventWindow.entries[*].event.schemaVersion",
    fieldClass: "EXACT",
    rationale: "contract version string",
  },
  {
    pattern: "$.eventWindow.entries[*].event.eventTypeRef",
    fieldClass: "EXACT",
    rationale: "typed event reference string",
  },
  {
    pattern: "$.eventWindow.entries[*].event.interval",
    fieldClass: "EXACT",
    rationale: "interval container",
  },
  {
    pattern: "$.eventWindow.entries[*].event.interval.startTimeMs",
    fieldClass: "EXACT",
    rationale: "integer ms",
  },
  {
    pattern: "$.eventWindow.entries[*].event.interval.endTimeMs",
    fieldClass: "EXACT",
    rationale: "integer ms",
  },
  {
    pattern: "$.eventWindow.entries[*].event.eventTimeMs",
    fieldClass: "EXACT",
    rationale: "integer ms timeline position",
  },
  {
    pattern: "$.eventWindow.entries[*].event.provenance",
    fieldClass: "EXACT",
    rationale: "enum — provenance discipline preserved verbatim",
  },
  {
    pattern: "$.eventWindow.entries[*].event.confidence",
    fieldClass: "EPSILON",
    rationale: "confidence in [0,1] — float-derived",
  },
  {
    pattern: "$.eventWindow.entries[*].event.evidence",
    fieldClass: "EXACT",
    rationale: "evidence container",
  },
  {
    pattern: "$.eventWindow.entries[*].event.evidence.observationIds",
    fieldClass: "EXACT",
    rationale: "evidence chain in builder order (candidate id first) — semantic",
  },
  {
    pattern: "$.eventWindow.entries[*].event.evidence.observationIds[*]",
    fieldClass: "EXACT",
    rationale: "id string",
  },
  {
    pattern: "$.eventWindow.entries[*].event.evidence.reportedBy",
    fieldClass: "EXACT",
    rationale: "reporter string (optional key)",
  },
  {
    pattern: "$.eventWindow.entries[*].event.correctionOf",
    fieldClass: "EXACT",
    rationale: "superseded event id string (optional key)",
  },
  { pattern: "$.replay", fieldClass: "EXACT", rationale: "replay section container" },
  { pattern: "$.replay.eventsApplied", fieldClass: "COUNT", rationale: "observability count" },
  {
    pattern: "$.replay.correctionsApplied",
    fieldClass: "COUNT",
    rationale: "observability count",
  },
  {
    pattern: "$.replay.supersededSkipped",
    fieldClass: "COUNT",
    rationale: "observability count (supersession accounting)",
  },
  {
    pattern: "$.replay.correctionsOrphaned",
    fieldClass: "COUNT",
    rationale: "observability count (orphan accounting)",
  },
  {
    pattern: "$.replay.duplicatesSkipped",
    fieldClass: "COUNT",
    rationale: "observability count",
  },
  { pattern: "$.replay.limits", fieldClass: "EXACT", rationale: "limits container" },
  {
    pattern: "$.replay.limits.maxEvents",
    fieldClass: "EXACT",
    rationale: "integer replay limit (input echo, not an observability count)",
  },
  {
    pattern: "$.replay.limits.maxSpanMs",
    fieldClass: "EXACT",
    rationale: "integer replay limit (input echo)",
  },
  {
    pattern: "$.replay.limits.checkpointEveryMs",
    fieldClass: "EXACT",
    rationale: "integer replay limit (input echo)",
  },
  {
    pattern: "$.replay.checkpoints",
    fieldClass: "EXACT",
    rationale: "checkpoints in application order (checkpoint cadence crossing order) — semantic",
  },
  ...snapshotRules("$.replay.checkpoints[*]"),
  ...snapshotRules("$.replay.final"),
];

// ---------------------------------------------------------------------------
// Pattern matching.
// ---------------------------------------------------------------------------

/** Tokenizes a pattern into matchable segments (`$.a.b[*]` → `$ a b [*]`). */
function tokenizePattern(pattern: string): string[] {
  const tokens = pattern.match(/(\[\*?\]|\*|[^.[\]]+)/g);
  if (tokens === null || tokens.length === 0 || tokens[0] !== "$") {
    throw new RangeError(`classify: malformed classification pattern "${pattern}"`);
  }
  return tokens;
}

/** Whether one pattern segment matches one path segment. */
function segmentMatches(patternSegment: string, pathSegment: string): boolean {
  if (patternSegment === "[*]") {
    return pathSegment.startsWith("[") && pathSegment.endsWith("]");
  }
  if (patternSegment === "*") {
    return !pathSegment.startsWith("[");
  }
  return patternSegment === pathSegment;
}

interface CompiledRule {
  readonly rule: ClassificationRule;
  readonly tokens: readonly string[];
}

function compileRules(rules: readonly ClassificationRule[]): readonly CompiledRule[] {
  const compiled: CompiledRule[] = [];
  for (const rule of rules) {
    if (rule.fieldClass !== "SET" && rule.setKey !== undefined) {
      throw new RangeError(
        `classify: rule "${rule.pattern}" carries setKey but is ${rule.fieldClass} ` +
          "(setKey is meaningful only on SET rules)",
      );
    }
    if (rule.fieldClass === "SET" && rule.setKey === undefined) {
      // Allowed: the canonical-string fallback ordering (documented in code).
    }
    compiled.push({ rule, tokens: tokenizePattern(rule.pattern) });
  }
  return compiled;
}

/**
 * The default compiled W403 rule table: compiled once at MODULE LOAD, which
 * also validates every pattern of the default table fail-loud at import
 * time. `deepCompare` reuses this compilation whenever the default table is
 * passed (identity check) and compiles custom specs per call.
 */
const W403_COMPILED: readonly CompiledRule[] = compileRules(W403_ARTIFACT_CLASSIFICATION);

// ---------------------------------------------------------------------------
// The comparator.
// ---------------------------------------------------------------------------

/** Validates a tolerance spec (fail loud, repo style). */
function validateSpec(spec: ToleranceSpec): void {
  if (typeof spec.epsilon !== "number" || !Number.isFinite(spec.epsilon) || spec.epsilon <= 0) {
    throw new RangeError(
      `deepCompare: epsilon must be a finite number > 0 (got ${String(spec.epsilon)})`,
    );
  }
  if (!Array.isArray(spec.rules) || spec.rules.length === 0) {
    throw new RangeError("deepCompare: rules must be a non-empty ClassificationRule array");
  }
}

/**
 * The field-classified deep comparison. Pure and deterministic; produces a
 * structured diff report (path, class, expected, actual, deviation) and NEVER
 * throws for value differences — unknown fields, NaN, and structural
 * mismatches are all diffs, so the report is the single fail-loud surface.
 */
export function deepCompare(
  expected: unknown,
  actual: unknown,
  spec: ToleranceSpec = { epsilon: DEFAULT_EPSILON, rules: W403_ARTIFACT_CLASSIFICATION },
): ComparisonReport {
  validateSpec(spec);
  const compiled =
    spec.rules === W403_ARTIFACT_CLASSIFICATION ? W403_COMPILED : compileRules(spec.rules);
  const diffs: FieldDiff[] = [];
  const summary = {
    exactFieldsCompared: 0,
    countFieldsCompared: 0,
    epsilonFieldsCompared: 0,
    setArraysCompared: 0,
    maxAbsDeviation: 0,
  };

  const classify = (segments: readonly string[]): ClassificationRule | undefined => {
    for (const candidate of compiled) {
      if (candidate.tokens.length !== segments.length) continue;
      let ok = true;
      for (let i = 0; i < segments.length; i += 1) {
        if (!segmentMatches(candidate.tokens[i]!, segments[i]!)) {
          ok = false;
          break;
        }
      }
      if (ok) return candidate.rule;
    }
    return undefined;
  };

  const diff = (
    segments: readonly string[],
    fieldClass: FieldClass | "UNCLASSIFIED",
    expectedValue: unknown,
    actualValue: unknown,
    reason: string,
    deviation?: number,
  ): void => {
    diffs.push({
      path: renderPath(segments),
      fieldClass,
      expected: renderValue(expectedValue),
      actual: renderValue(actualValue),
      ...(deviation !== undefined ? { deviation } : {}),
      reason,
    });
  };

  const countLeaf = (fieldClass: FieldClass): void => {
    if (fieldClass === "EXACT") summary.exactFieldsCompared += 1;
    else if (fieldClass === "COUNT") summary.countFieldsCompared += 1;
    else if (fieldClass === "EPSILON") summary.epsilonFieldsCompared += 1;
  };

  const visit = (segments: readonly string[], a: unknown, b: unknown): void => {
    const rule = classify(segments);
    if (rule === undefined) {
      diff(segments, "UNCLASSIFIED", a, b, "no classification rule covers this JSON path");
      return;
    }
    switch (rule.fieldClass) {
      case "EXACT":
        visitExact(segments, a, b, rule);
        break;
      case "COUNT":
        visitCount(segments, a, b);
        break;
      case "EPSILON":
        visitEpsilon(segments, a, b, rule);
        break;
      case "SET":
        visitSet(segments, a, b, rule);
        break;
    }
  };

  const visitExact = (
    segments: readonly string[],
    a: unknown,
    b: unknown,
    rule: ClassificationRule,
  ): void => {
    if (isPlainObject(a) && isPlainObject(b)) {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      for (const key of keys) {
        const childSegments = [...segments, key];
        const inA = key in a;
        const inB = key in b;
        if (inA && inB) {
          const va = a[key];
          const vb = b[key];
          if (va === undefined && vb === undefined) {
            const childRule = classify(childSegments);
            if (childRule === undefined) {
              diff(
                childSegments,
                "UNCLASSIFIED",
                undefined,
                undefined,
                "no classification rule covers this JSON path",
              );
            } else {
              countLeaf(childRule.fieldClass);
            }
            continue;
          }
          visit(childSegments, va, vb);
        } else {
          const present = inA ? a[key] : b[key];
          const childClass = classifyChild(childSegments);
          if (present === undefined) {
            diff(
              childSegments,
              childClass,
              inA ? a[key] : b[key],
              inA ? b[key] : a[key],
              "undefined-vs-missing: the key is present with value undefined on one side and " +
                "absent on the other — not silently equal",
            );
          } else {
            const missingSide = inA ? "missing in actual" : "missing in expected";
            const reason =
              childClass === "UNCLASSIFIED"
                ? `unclassified-field: no classification rule covers this JSON path ` +
                  `(key "${key}" is ${missingSide})`
                : `missing-field: key "${key}" is ${missingSide}`;
            diff(childSegments, childClass, inA ? a[key] : b[key], inA ? b[key] : a[key], reason);
          }
        }
      }
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        diff(
          segments,
          rule.fieldClass,
          a.length,
          b.length,
          `array-length: expected ${a.length} element(s), actual ${b.length}`,
        );
      }
      const common = Math.max(a.length, b.length);
      for (let i = 0; i < common; i += 1) {
        const childSegments = [...segments, `[${i}]`];
        if (i >= a.length || i >= b.length) {
          const expected = i < a.length ? a[i] : undefined;
          const actual = i < b.length ? b[i] : undefined;
          diff(
            childSegments,
            classifyChild(childSegments),
            expected,
            actual,
            "missing-element: the array is shorter on one side",
          );
          continue;
        }
        visit(childSegments, a[i], b[i]);
      }
      return;
    }
    // Leaf comparison.
    if (a === undefined || b === undefined) {
      if (a === undefined && b === undefined) {
        countLeaf(rule.fieldClass);
        return;
      }
      diff(
        segments,
        rule.fieldClass,
        a,
        b,
        `undefined-mismatch: ${a === undefined ? "expected" : "actual"} is undefined`,
      );
      return;
    }
    if (typeof a !== typeof b || (a === null) !== (b === null)) {
      diff(
        segments,
        rule.fieldClass,
        a,
        b,
        `type-mismatch: expected ${typeName(a)}, actual ${typeName(b)}`,
      );
      return;
    }
    if (typeof a === "number" && typeof b === "number") {
      if (Number.isNaN(a) || Number.isNaN(b)) {
        diff(
          segments,
          rule.fieldClass,
          a,
          b,
          "NaN: a NaN is never equal to anything (flagged, never coerced)",
        );
        return;
      }
      if (a === b) {
        countLeaf(rule.fieldClass);
        return;
      }
      diff(segments, rule.fieldClass, a, b, "exact-mismatch: values differ", Math.abs(a - b));
      return;
    }
    if (a === b) {
      countLeaf(rule.fieldClass);
      return;
    }
    diff(segments, rule.fieldClass, a, b, "exact-mismatch: values differ");
  };

  const visitCount = (segments: readonly string[], a: unknown, b: unknown): void => {
    if (typeof a !== "number" || typeof b !== "number") {
      diff(
        segments,
        "COUNT",
        a,
        b,
        `type-mismatch: COUNT fields must be numbers (expected ${typeName(a)}, actual ${typeName(b)})`,
      );
      return;
    }
    if (Number.isNaN(a) || Number.isNaN(b)) {
      diff(segments, "COUNT", a, b, "NaN: a NaN is never a count (flagged, never coerced)");
      return;
    }
    if (!Number.isInteger(a) || !Number.isInteger(b)) {
      diff(
        segments,
        "COUNT",
        a,
        b,
        "count-not-integer: COUNT fields are observability counts and must be integers",
      );
      return;
    }
    if (a === b) {
      summary.countFieldsCompared += 1;
      return;
    }
    diff(segments, "COUNT", a, b, "count-mismatch: observability counts differ", Math.abs(a - b));
  };

  const visitEpsilon = (
    segments: readonly string[],
    a: unknown,
    b: unknown,
    rule: ClassificationRule,
  ): void => {
    if (typeof a !== "number" || typeof b !== "number") {
      diff(
        segments,
        rule.fieldClass,
        a,
        b,
        `type-mismatch: EPSILON fields must be numbers (expected ${typeName(a)}, actual ${typeName(b)})`,
      );
      return;
    }
    if (Number.isNaN(a) || Number.isNaN(b)) {
      diff(
        segments,
        rule.fieldClass,
        a,
        b,
        "NaN: a NaN in an EPSILON field is flagged, never coerced",
      );
      return;
    }
    const deviation = Math.abs(a - b);
    if (deviation > summary.maxAbsDeviation) {
      summary.maxAbsDeviation = deviation;
    }
    if (deviation <= spec.epsilon) {
      summary.epsilonFieldsCompared += 1;
      return;
    }
    diff(
      segments,
      rule.fieldClass,
      a,
      b,
      `epsilon-breach: |expected − actual| = ${deviation} > epsilon ${spec.epsilon}`,
      deviation,
    );
  };

  const visitSet = (
    segments: readonly string[],
    a: unknown,
    b: unknown,
    rule: ClassificationRule,
  ): void => {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      diff(
        segments,
        rule.fieldClass,
        a,
        b,
        `type-mismatch: SET fields must be arrays (expected ${typeName(a)}, actual ${typeName(b)})`,
      );
      return;
    }
    summary.setArraysCompared += 1;
    if (rule.setKey === undefined) {
      visitSetByCanonicalString(segments, a, b, rule);
      return;
    }
    const keyed = (side: unknown[], label: string): Map<string, unknown> => {
      const map = new Map<string, unknown>();
      for (const element of side) {
        if (!isPlainObject(element) || !(rule.setKey! in element)) {
          diff(
            segments,
            rule.fieldClass,
            element,
            undefined,
            `set-element-key-missing: a ${label} element lacks the setKey "${rule.setKey}"`,
          );
          continue;
        }
        const key = element[rule.setKey!];
        if (typeof key !== "string" && typeof key !== "number") {
          diff(
            segments,
            rule.fieldClass,
            key,
            undefined,
            `set-element-key-invalid: the setKey "${rule.setKey}" must be a string or number ` +
              `(got ${typeName(key)} in ${label})`,
          );
          continue;
        }
        const rendered = String(key);
        if (map.has(rendered)) {
          diff(
            [...segments, `[${rendered}]`],
            rule.fieldClass,
            map.get(rendered),
            element,
            `set-key-duplicate: key "${rendered}" appears twice in ${label} — never silently collapsed`,
          );
          continue;
        }
        map.set(rendered, element);
      }
      return map;
    };
    const mapA = keyed(a, "expected");
    const mapB = keyed(b, "actual");
    const keys = [...new Set([...mapA.keys(), ...mapB.keys()])].sort();
    for (const key of keys) {
      const childSegments = [...segments, `[${key}]`];
      if (!mapA.has(key) || !mapB.has(key)) {
        diff(
          childSegments,
          classifyChild([...segments, "[*]"]),
          mapA.get(key),
          mapB.get(key),
          `set-element-missing: key "${key}" is ${mapA.has(key) ? "missing in actual" : "missing in expected"}`,
        );
        continue;
      }
      visit(childSegments, mapA.get(key), mapB.get(key));
    }
  };

  /** SET fallback (no setKey): canonical-string ordering + pairwise compare. */
  const visitSetByCanonicalString = (
    segments: readonly string[],
    a: unknown[],
    b: unknown[],
    rule: ClassificationRule,
  ): void => {
    const canonical = (value: unknown): string | null => {
      try {
        return JSON.stringify(canonicalizeValue(value));
      } catch {
        diff(
          segments,
          rule.fieldClass,
          value,
          undefined,
          "set-element-unserializable: the element cannot be canonically serialized (NaN, " +
            "undefined, or non-JSON value inside a SET element)",
        );
        return null;
      }
    };
    const sortOrNulls = (side: unknown[]): ReadonlyArray<{ key: string | null; value: unknown }> =>
      side
        .map((value) => ({ key: canonical(value), value }))
        .sort((x, y) => {
          const xa = String(x.key);
          const ya = String(y.key);
          return xa < ya ? -1 : xa > ya ? 1 : 0;
        });
    const sortedA = sortOrNulls(a);
    const sortedB = sortOrNulls(b);
    const common = Math.max(sortedA.length, sortedB.length);
    for (let i = 0; i < common; i += 1) {
      const childSegments = [...segments, `[${i}]`];
      if (i >= sortedA.length || i >= sortedB.length) {
        diff(
          childSegments,
          classifyChild(childSegments),
          i < sortedA.length ? sortedA[i]!.value : undefined,
          i < sortedB.length ? sortedB[i]!.value : undefined,
          "set-element-missing: the set is smaller on one side",
        );
        continue;
      }
      visit(childSegments, sortedA[i]!.value, sortedB[i]!.value);
    }
  };

  const classifyChild = (segments: readonly string[]): FieldClass | "UNCLASSIFIED" => {
    return classify(segments)?.fieldClass ?? "UNCLASSIFIED";
  };

  visit(["$"], expected, actual);

  return {
    passed: diffs.length === 0,
    diffCount: diffs.length,
    diffs,
    summary,
  };
}

/**
 * Compares two W403 world-model artifacts under the documented W403
 * classification (see TOLERANCE.md). `overrides.epsilon` and
 * `overrides.rules` replace the defaults when provided.
 */
export function compareWorldModelArtifacts(
  expected: unknown,
  actual: unknown,
  overrides: { epsilon?: number; rules?: readonly ClassificationRule[] } = {},
): ComparisonReport {
  return deepCompare(expected, actual, {
    epsilon: overrides.epsilon ?? DEFAULT_EPSILON,
    rules: overrides.rules ?? W403_ARTIFACT_CLASSIFICATION,
  });
}

// ---------------------------------------------------------------------------
// Rendering helpers (diff output only — never part of compared values).
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function renderPath(segments: readonly string[]): string {
  let out = "$";
  for (const segment of segments) {
    if (segment === "$") continue;
    out += segment.startsWith("[") ? segment : `.${segment}`;
  }
  return out;
}

/** Renders any value JSON-safely for diff output (NaN/undefined visible). */
function renderValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "number") {
    return Number.isNaN(value) ? "NaN" : String(value);
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (Array.isArray(value)) {
    return `[${value.map((element) => renderValue(element)).join(", ")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map(
        (key) => `${JSON.stringify(key)}: ${renderValue((value as Record<string, unknown>)[key])}`,
      )
      .join(", ")}}`;
  }
  return String(value);
}
