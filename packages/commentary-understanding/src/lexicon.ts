/**
 * Event pattern lexicon (W209) — DATA, pure.
 *
 * Per football event type, an ORDERED list of `{ source, strength }` regex
 * entries: more specific patterns first (the first matching pattern of a
 * type fixes the match span and its `strength` — e.g. "shot on target"
 * (0.7) beats bare "shot" (0.6) inside the `shot` list). All regexes are
 * case-insensitive (`gi` at compile time) and are used only for their match
 * SPAN — capture groups have no side effects (only `match[0]` is read).
 *
 * ## Starter set (tech-lead authored, verbatim)
 *
 * The first pattern entry per type below is the starter set from the work
 * item, kept exactly as delivered. The entries marked `[EXT]` are worker
 * additions — documented football-common phrasings that close gaps the
 * starters miss (e.g. the starter `scored?` matches "score"/"scored" but
 * NOT the present-tense "scores"; `passes?` matches "passes" but NOT the
 * bare noun "pass"). Every extension keeps the same rules:
 * case-insensitive, whole-word-bounded, no lookarounds.
 *
 * ## Type resolution — the documented PRIORITY order
 *
 * `EVENT_TYPE_PRIORITY` below is the complete order, most specific first:
 *
 *     goal > save > shot > free-kick > card > corner > foul
 *           > offside > throw-in > substitution > kickoff
 *           > fulltime > pass > other
 *
 * realizing the tech-lead's specificity chains `goal > save > shot`,
 * `free-kick > foul`, `corner > pass`, `card > foul`. The order applies at
 * TWO points in `extract.ts`:
 *
 * 1. **Same-start span contention**: when two patterns of DIFFERENT types
 *    match overlapping spans, the earlier-starting match wins; at equal
 *    start the higher-priority (lower rank) type wins ("free kick-off"
 *    is a free-kick, not a kickoff).
 * 2. **The scoring-attempt absorption family** — `goal > save > shot`:
 *    a shot that goes in is reported by its OUTCOME. Within ONE commentary
 *    unit, if any goal match survives the span sweep, that unit's `shot`
 *    and `save` matches are absorbed (dropped); else if a `save` match
 *    survives, that unit's `shot` matches are absorbed. This is why
 *    "He shoots... GOAL!" is a SINGLE goal candidate. All other types
 *    coexist — a foul and the free-kick awarded for it are two events
 *    (the benchmark's mixed scenario asserts exactly that).
 *
 * `other` has NO patterns (reserved type — see `types.ts`).
 */
import type { CommentaryEventType } from "./types";

/** One lexicon pattern: a regex source string plus its match strength. */
export interface EventPattern {
  /** Regex source (case-insensitive, whole-word style) — see module docs. */
  readonly source: string;
  /** Match strength in [0, 1]: how unambiguous this phrasing is. */
  readonly strength: number;
}

/** One event type's ordered pattern list (most specific first). */
export interface EventTypePatterns {
  readonly eventType: CommentaryEventType;
  readonly patterns: readonly EventPattern[];
}

/**
 * The event pattern lexicon. Starter entries first per type, then
 * documented `[EXT]` extensions.
 */
export const EVENT_PATTERNS: ReadonlyArray<EventTypePatterns> = [
  {
    eventType: "goal",
    patterns: [
      {
        source: "\\b(scored?\\b|\\bgoal!?\\b|\\bfinds? the (?:back of the )?net\\b)",
        strength: 0.9,
      },
      { source: "\\bown goal\\b", strength: 0.85 },
      // [EXT] present-tense gap of the starter's `scored?`: "Salah scores!"
      { source: "\\bscores\\b", strength: 0.9 },
    ],
  },
  {
    eventType: "shot",
    patterns: [
      {
        source: "\\bshoots?\\b|\\bshot (?:on|off) target\\b|\\bdrives? it\\b|\\beffort\\b",
        strength: 0.7,
      },
      // [EXT] bare "shot"/"shots" — weaker than the qualified forms above.
      { source: "\\bshots?\\b", strength: 0.6 },
    ],
  },
  {
    eventType: "pass",
    patterns: [
      {
        source: "\\bpasses?\\b|\\bplays? (?:it|a ball) (?:to|through)\\b|\\bcross(?:es)?\\b",
        strength: 0.7,
      },
      // [EXT] the bare noun "pass" ("a lovely pass"), which the starter's
      // `passes?` (matches "passe"/"passes" only) misses.
      { source: "\\bpass(?:es)?\\b", strength: 0.7 },
    ],
  },
  {
    eventType: "save",
    patterns: [
      { source: "\\bsaves?\\b|\\bkeeper (?:punches|parries)\\b", strength: 0.8 },
      // [EXT] participle form: "it's saved by the keeper".
      { source: "\\bsaved\\b", strength: 0.75 },
    ],
  },
  {
    eventType: "corner",
    patterns: [
      { source: "\\bcorner kick\\b|\\bfrom the corner\\b", strength: 0.85 },
      // [EXT] bare "corner" ("wins a corner", "corner comes in").
      { source: "\\bcorner\\b", strength: 0.75 },
    ],
  },
  {
    eventType: "foul",
    patterns: [
      {
        source: "\\bfouls?\\b|\\bbrought down\\b|\\btrip(?:ped|s)? (?:him|her|him up)\\b",
        strength: 0.75,
      },
      // [EXT] passive form: "he is fouled on the touchline".
      { source: "\\bfouled\\b", strength: 0.75 },
    ],
  },
  {
    eventType: "free-kick",
    patterns: [{ source: "\\bfree[ -]?kick\\b", strength: 0.85 }],
  },
  {
    eventType: "offside",
    patterns: [{ source: "\\boffside\\b", strength: 0.9 }],
  },
  {
    eventType: "throw-in",
    patterns: [{ source: "\\bthrow[ -]?in\\b", strength: 0.85 }],
  },
  {
    eventType: "substitution",
    patterns: [
      { source: "\\bsubstitut\\w+\\b|\\bcomes? on for\\b|\\breplac(?:es|ed)\\b", strength: 0.8 },
      // [EXT] colloquial "subbed" ("Firmino is subbed").
      { source: "\\bsubbed\\b", strength: 0.75 },
    ],
  },
  {
    eventType: "card",
    patterns: [
      { source: "\\byellow card\\b|\\bred card\\b|\\bbooked\\b", strength: 0.9 },
      // [EXT] present-tense referee action: "the referee books him".
      { source: "\\bbooks?\\b", strength: 0.85 },
      // [EXT] dismissal phrasings — always a card outcome.
      { source: "\\b(?:second yellow|sent off|dismissed)\\b", strength: 0.9 },
    ],
  },
  {
    eventType: "kickoff",
    patterns: [{ source: "\\bkick[ -]?off\\b", strength: 0.9 }],
  },
  {
    eventType: "fulltime",
    patterns: [
      { source: "\\bfull[ -]?time\\b|\\bfinal whistle\\b", strength: 0.9 },
      // [EXT] "and it's all over!" — the classic fulltime call. Weaker
      // strength: "all over" can occur mid-match ("all over the place").
      { source: "\\ball over\\b", strength: 0.7 },
    ],
  },
];

/**
 * The documented type-resolution priority order (most specific first) —
 * see the module docs for how it is applied. Rank 0 is highest priority.
 * `other` is listed for completeness: it has no patterns and can never
 * win a match.
 */
export const EVENT_TYPE_PRIORITY: readonly CommentaryEventType[] = [
  "goal",
  "save",
  "shot",
  "free-kick",
  "card",
  "corner",
  "foul",
  "offside",
  "throw-in",
  "substitution",
  "kickoff",
  "fulltime",
  "pass",
  "other",
];

/** One precompiled lexicon pattern, ready for scanning. */
export interface CompiledEventPattern {
  /** The event type this pattern evidences. */
  readonly eventType: CommentaryEventType;
  /** This pattern's match strength (from the lexicon entry). */
  readonly strength: number;
  /** The compiled regex — case-insensitive, global (for `matchAll`). */
  readonly regex: RegExp;
  /** Priority rank of `eventType` in {@link EVENT_TYPE_PRIORITY} (0 = highest). */
  readonly priority: number;
  /** Global lexicon index — the deterministic last tiebreak for the span sweep. */
  readonly patternIndex: number;
}

/**
 * Compiles the lexicon into a flat array of precompiled patterns (types in
 * `EVENT_TYPE_PRIORITY` order... as listed in `EVENT_PATTERNS`, each type's
 * patterns in list order). Called ONCE at module load into
 * {@link COMPILED_EVENT_PATTERNS}; extraction never constructs a regex from
 * input at runtime. Pure: same lexicon → structurally equal result.
 */
export function compileEventPatterns(): readonly CompiledEventPattern[] {
  const priorityOf = new Map<CommentaryEventType, number>(
    EVENT_TYPE_PRIORITY.map((eventType, rank) => [eventType, rank]),
  );
  const compiled: CompiledEventPattern[] = [];
  let patternIndex = 0;
  for (const entry of EVENT_PATTERNS) {
    const priority = priorityOf.get(entry.eventType);
    if (priority === undefined) {
      throw new Error(`event type ${entry.eventType} missing from EVENT_TYPE_PRIORITY`);
    }
    for (const pattern of entry.patterns) {
      compiled.push({
        eventType: entry.eventType,
        strength: pattern.strength,
        regex: new RegExp(pattern.source, "gi"),
        priority,
        patternIndex,
      });
      patternIndex += 1;
    }
  }
  return compiled;
}

/**
 * The module-load compilation singleton — the ONLY regex set the
 * extraction pipeline ever scans with (built once; no runtime regex
 * construction from input).
 */
export const COMPILED_EVENT_PATTERNS: readonly CompiledEventPattern[] = compileEventPatterns();

/**
 * The scoring-attempt absorption family (goal > save > shot) as rank data:
 * within one unit, the lowest-rank (highest-priority) family member that
 * matched absorbs the higher-rank members. Realized in `extract.ts`.
 */
export const SCORING_FAMILY: readonly CommentaryEventType[] = ["goal", "save", "shot"];
