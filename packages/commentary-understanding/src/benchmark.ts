/**
 * Extraction benchmark (W209) — the "benchmark commentary extracts event
 * candidates, subjects, emphasis, and confidence" acceptance evidence.
 *
 * Per scenario: run the deterministic extractor over the scenario's W208
 * units (with the scenario's fixture-scoped lexicon), then match extracted
 * candidates against the hand-annotated ground truth by EXACT equality of
 * the `(eventTimeMs, eventType, eventPhrase)` triple — greedy, each
 * expected entry consuming at most one candidate. From the match count:
 *
 * - `precision = correct / extracted` (0 when nothing was extracted);
 * - `recall = correct / expected` (1 when nothing was expected — vacuous
 *   perfection, never produced by the fixtures);
 * - `f1` = harmonic mean, 0 when `precision + recall = 0`.
 *
 * Counters (`perType`, `withSubjects`, `meanConfidence`, `meanEmphasis`)
 * are exact counts/means over the extracted candidates — no sampling, no
 * tolerance. Deterministic: the same scenarios always produce a
 * deep-equal report array.
 *
 * ## BENCHMARK_FIXTURES (documented; the tests assert the hand-computed
 * values annotated per scenario)
 *
 * 1. `clean-steady-play-by-play` — 11 units of calm play-by-play covering
 *    nine event types. Expected: 11, all extracted → P = R = F1 = 1.
 * 2. `excited-goal-call` — caps, exclamations, intensifiers, and the
 *    shot-absorbed-by-goal case. Expected: 5, all extracted → P = R = F1 = 1.
 * 3. `mixed-multi-event-passage` — a passage with coexisting events, an
 *    over-extraction (bare "effort" — the annotator rejects it: too vague
 *    to be a shot candidate) and a recall miss (no lexicon pattern for
 *    "dinks it"). Expected: 9, extracted: 9, correct: 8 → P = R = F1 = 8/9.
 * 4. `sparse-single-event` — one lone event, near-empty lexicon → exactly
 *    1 candidate, empty subjects. Expected: 1 → P = R = F1 = 1.
 *
 * Total annotated expected entries: 11 + 5 + 9 + 1 = 26 (≥ 25 required).
 */
import type { CommentaryUnit } from "@sporta/commentary-segmentation";
import { extractEventCandidates } from "./extract";
import type { KnownEntityLexicon } from "./subjects";
import type { CommentaryEventType } from "./types";

/** Small local factory (HARNESS.md pattern: fixed values, no RNG/clock). */
function makeUnit(unitId: string, startMs: number, endMs: number, text: string): CommentaryUnit {
  return { unitId, startMs, endMs, text, sourceWindowIds: [`tu-${startMs / 1000}`] };
}

/** One benchmark scenario: W208 units, a fixture lexicon, ground truth. */
export interface ExtractionScenario {
  /** The scenario's label (identifies the scenario on failure). */
  readonly name: string;
  /** The W208 commentary units to extract from. */
  readonly units: CommentaryUnit[];
  /** The fixture-scoped entity vocabulary for subject extraction. */
  readonly lexicon: KnownEntityLexicon;
  /**
   * Hand-annotated ground truth: one entry per event the annotator says
   * the passage contains, matched by exact `(eventTimeMs, eventType,
   * eventPhrase)` equality.
   */
  readonly expected: ReadonlyArray<{
    readonly eventTimeMs: number;
    readonly eventType: CommentaryEventType;
    readonly eventPhrase: string;
  }>;
}

/** Per-scenario extraction benchmark report (see module docs for metrics). */
export interface ExtractionBenchmarkReport {
  /** Scenario name. */
  scenario: string;
  /** Input commentary units. */
  units: number;
  /** Extracted event candidates. */
  candidates: number;
  /** Extracted candidates per event type (types present only). */
  perType: Record<string, number>;
  /** Candidates with at least one subject mention. */
  withSubjects: number;
  /** Mean candidate confidence (0 when none extracted). */
  meanConfidence: number;
  /** Mean candidate emphasis (0 when none extracted). */
  meanEmphasis: number;
  /** correct / extracted (0 when nothing extracted). */
  precision: number;
  /** correct / expected (1 when nothing expected). */
  recall: number;
  /** Harmonic mean of precision and recall (0 when both are 0). */
  f1: number;
}

/**
 * The benchmark fixtures (see module docs for the per-scenario hand
 * computations the tests assert).
 */
export const BENCHMARK_FIXTURES: readonly ExtractionScenario[] = [
  {
    // Scenario 1 — clean steady play-by-play.
    //
    // 11 units -> 11 candidates, all matching the 11 expected entries:
    //   P = R = F1 = 1
    // withSubjects = 7 (all but cu-5/7/8/10 — no lexicon name present)
    // meanConfidence = (0.85+0.875+0.9+0.91+0.745+0.925+0.77+0.745
    //                   +0.875+0.695+0.875)/11 = 9.165/11 = 0.83318…
    // meanEmphasis  = 0.4/11 = 0.03636… (only cu-4's "!")
    // perType: pass 1, corner 2, save 1, goal 1, card 1, throw-in 1,
    //          offside 1, free-kick 1, foul 2
    name: "clean-steady-play-by-play",
    lexicon: {
      players: ["Salah", "Mane", "Robertson", "Alisson"],
      teams: ["Liverpool"],
    },
    units: [
      makeUnit("cu-1", 10_000, 10_500, "Salah plays a pass to Mane."),
      makeUnit("cu-2", 12_000, 12_500, "Mane wins a corner for Liverpool."),
      makeUnit("cu-3", 14_000, 14_500, "Alisson saves it comfortably."),
      makeUnit("cu-4", 16_000, 16_500, "It's a goal for Liverpool!"),
      makeUnit("cu-5", 18_000, 18_500, "The referee books him."),
      makeUnit("cu-6", 20_000, 20_500, "Quick throw-in taken by Robertson."),
      makeUnit("cu-7", 22_000, 22_500, "He's flagged offside, just about."),
      makeUnit("cu-8", 24_000, 24_500, "Free-kick in a dangerous area."),
      makeUnit("cu-9", 26_000, 26_500, "Salah is brought down."),
      makeUnit("cu-10", 27_000, 27_500, "That's a foul, says the referee."),
      makeUnit("cu-11", 28_000, 28_500, "Corner swung in by Liverpool."),
    ],
    expected: [
      { eventTimeMs: 10_000, eventType: "pass", eventPhrase: "pass" },
      { eventTimeMs: 12_000, eventType: "corner", eventPhrase: "corner" },
      { eventTimeMs: 14_000, eventType: "save", eventPhrase: "saves" },
      { eventTimeMs: 16_000, eventType: "goal", eventPhrase: "goal" },
      { eventTimeMs: 18_000, eventType: "card", eventPhrase: "books" },
      { eventTimeMs: 20_000, eventType: "throw-in", eventPhrase: "throw-in" },
      { eventTimeMs: 22_000, eventType: "offside", eventPhrase: "offside" },
      { eventTimeMs: 24_000, eventType: "free-kick", eventPhrase: "Free-kick" },
      { eventTimeMs: 26_000, eventType: "foul", eventPhrase: "brought down" },
      { eventTimeMs: 27_000, eventType: "foul", eventPhrase: "foul" },
      { eventTimeMs: 28_000, eventType: "corner", eventPhrase: "Corner" },
    ],
  },
  {
    // Scenario 2 — excited goal call with emphasis.
    //
    // 4 units -> 5 candidates (cu-3 yields foul + free-kick), all matching
    // the 5 expected entries: P = R = F1 = 1
    // cu-1 "Kane shoots and SCORES, unbelievable!" — the shot is absorbed
    //      by the goal (one scoring attempt, one outcome candidate).
    // withSubjects = 5
    // meanConfidence = (0.87+0.87+0.835+0.885+0.95)/5 = 4.41/5 = 0.882
    // meanEmphasis  = (0.8+0.8+0.4+0.4+0)/5 = 2.4/5 = 0.48
    // perType: goal 2, foul 1, free-kick 1, card 1
    name: "excited-goal-call",
    lexicon: { players: ["Kane", "Son"], teams: ["Spurs"] },
    units: [
      makeUnit("cu-1", 30_000, 30_800, "Kane shoots and SCORES, unbelievable!"),
      makeUnit("cu-2", 32_000, 32_500, "WHAT A GOAL from Son!"),
      makeUnit("cu-3", 33_000, 33_600, "Son is fouled and Spurs have a free-kick!"),
      makeUnit("cu-4", 34_000, 34_500, "Kane is booked for the challenge."),
    ],
    expected: [
      { eventTimeMs: 30_000, eventType: "goal", eventPhrase: "SCORES" },
      { eventTimeMs: 32_000, eventType: "goal", eventPhrase: "GOAL" },
      { eventTimeMs: 33_000, eventType: "foul", eventPhrase: "fouled" },
      { eventTimeMs: 33_000, eventType: "free-kick", eventPhrase: "free-kick" },
      { eventTimeMs: 34_000, eventType: "card", eventPhrase: "booked" },
    ],
  },
  {
    // Scenario 3 — mixed multi-event passage (honest, imperfect extraction).
    //
    // 11 units -> 9 extracted, 9 expected, 8 correct:
    //   - cu-6 "dinks it" — NO lexicon pattern exists for it: a recall miss.
    //   - cu-7 bare "effort" — extracted but the annotator rejects it as
    //     too vague to be a shot candidate: a precision miss.
    //   P = R = F1 = 8/9 = 0.888…
    // withSubjects = 7 (cu-9 "Yellow card…" and cu-10 "…at the Etihad."
    //   carry no lexicon name)
    // meanConfidence = (0.85+0.875+0.95+0.9+0.83+0.85+0.77+0.77+0.95)/9
    //                = 7.745/9 = 0.86055…
    // meanEmphasis  = 0.2/9 = 0.0222… (only cu-7's "superb")
    // perType: shot 2, corner 1, offside 2, substitution 1, pass 1,
    //          card 1, fulltime 1
    name: "mixed-multi-event-passage",
    lexicon: { players: ["Sterling", "Foden", "Ederson"], teams: ["City", "United"] },
    units: [
      makeUnit("cu-1", 50_000, 50_500, "Sterling drives it wide of the far post."),
      makeUnit("cu-2", 52_000, 52_500, "Corner to City, cleared as far as Foden."),
      makeUnit("cu-3", 54_000, 54_500, "Foden is caught offside."),
      makeUnit("cu-4", 56_000, 56_500, "Foden comes on for Sterling."),
      makeUnit("cu-5", 58_000, 58_500, "Half-time changes worked, City look sharper."),
      makeUnit("cu-6", 60_000, 60_500, "Sterling dances past two and dinks it over Ederson."),
      makeUnit("cu-7", 62_000, 62_500, "That's a superb effort from Foden."),
      makeUnit("cu-8", 64_000, 64_500, "Ederson passes short to the defender."),
      makeUnit("cu-9", 66_000, 66_500, "Yellow card for the challenge."),
      makeUnit("cu-10", 68_000, 68_500, "And that's full-time here at the Etihad."),
      makeUnit("cu-11", 70_000, 70_500, "Offside flag goes up against City."),
    ],
    expected: [
      { eventTimeMs: 50_000, eventType: "shot", eventPhrase: "drives it" },
      { eventTimeMs: 52_000, eventType: "corner", eventPhrase: "Corner" },
      { eventTimeMs: 54_000, eventType: "offside", eventPhrase: "offside" },
      { eventTimeMs: 56_000, eventType: "substitution", eventPhrase: "comes on for" },
      // cu-6 recall miss: "dinks it" has no pattern — the extractor is
      // honest about what its lexicon does not cover.
      { eventTimeMs: 60_000, eventType: "shot", eventPhrase: "dinks it" },
      { eventTimeMs: 64_000, eventType: "pass", eventPhrase: "passes" },
      { eventTimeMs: 66_000, eventType: "card", eventPhrase: "Yellow card" },
      { eventTimeMs: 68_000, eventType: "fulltime", eventPhrase: "full-time" },
      { eventTimeMs: 70_000, eventType: "offside", eventPhrase: "Offside" },
      // NOTE: cu-7's extracted (62000, shot, "effort") is deliberately NOT
      // expected — the precision miss documented above.
    ],
  },
  {
    // Scenario 4 — sparse passage, single event, near-empty lexicon.
    //
    // 2 units -> exactly 1 candidate (cu-2's throw-in) with EMPTY
    // subjects (the lexicon names Thiago, who never appears — no name
    // guessing): P = R = F1 = 1
    // withSubjects = 0; meanConfidence = 0.745; meanEmphasis = 0;
    // perType: throw-in 1
    name: "sparse-single-event",
    lexicon: { players: ["Thiago"], teams: [] },
    units: [
      makeUnit("cu-1", 90_000, 90_500, "Midfield battle here, neither side giving an inch."),
      makeUnit("cu-2", 92_000, 92_300, "Throw-in."),
    ],
    expected: [{ eventTimeMs: 92_000, eventType: "throw-in", eventPhrase: "Throw-in" }],
  },
];

/**
 * Runs the extraction benchmark over the scenarios (see module docs for
 * the metric definitions). Reports come back in scenario order. Pure and
 * deterministic.
 */
export function runExtractionBenchmark(
  scenarios: readonly ExtractionScenario[],
): ExtractionBenchmarkReport[] {
  return scenarios.map((scenario) => {
    const extracted = extractEventCandidates({
      units: scenario.units,
      lexicon: scenario.lexicon,
    });

    // Greedy exact-triple matching; each expected entry consumes at most
    // one candidate (duplicate triples in either list stay unmatched).
    const consumed = new Set<number>();
    let correct = 0;
    for (const expected of scenario.expected) {
      const index = extracted.findIndex(
        (candidate, candidateIndex) =>
          !consumed.has(candidateIndex) &&
          candidate.eventTimeMs === expected.eventTimeMs &&
          candidate.eventType === expected.eventType &&
          candidate.eventPhrase === expected.eventPhrase,
      );
      if (index !== -1) {
        consumed.add(index);
        correct += 1;
      }
    }

    const precision = extracted.length === 0 ? 0 : correct / extracted.length;
    const recall = scenario.expected.length === 0 ? 1 : correct / scenario.expected.length;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

    const perType: Record<string, number> = {};
    let withSubjects = 0;
    let confidenceSum = 0;
    let emphasisSum = 0;
    for (const candidate of extracted) {
      perType[candidate.eventType] = (perType[candidate.eventType] ?? 0) + 1;
      if (candidate.subjects.length > 0) withSubjects += 1;
      confidenceSum += candidate.confidence;
      emphasisSum += candidate.emphasis;
    }

    return {
      scenario: scenario.name,
      units: scenario.units.length,
      candidates: extracted.length,
      perType,
      withSubjects,
      meanConfidence: extracted.length > 0 ? confidenceSum / extracted.length : 0,
      meanEmphasis: extracted.length > 0 ? emphasisSum / extracted.length : 0,
      precision,
      recall,
      f1,
    };
  });
}
