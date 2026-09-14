/**
 * W209 benchmark tests — the ACCEPTANCE CRITERION for this work item:
 * "benchmark commentary extracts event candidates, subjects, emphasis, and
 * confidence". Every asserted value is hand-computed and annotated in the
 * fixture comments (see `src/benchmark.ts`).
 */
import { describe, expect, test } from "bun:test";
import { BENCHMARK_FIXTURES, extractEventCandidates, runExtractionBenchmark } from "../src/index";

const reports = runExtractionBenchmark(BENCHMARK_FIXTURES);

function report(name: string) {
  const found = reports.find((entry) => entry.scenario === name);
  if (found === undefined) throw new Error(`missing benchmark scenario ${name}`);
  return found;
}

describe("extraction benchmark (acceptance criterion)", () => {
  test(">= 25 total annotated candidates across the fixtures", () => {
    const totalExpected = BENCHMARK_FIXTURES.reduce(
      (sum, scenario) => sum + scenario.expected.length,
      0,
    );
    const totalExtracted = reports.reduce((sum, entry) => sum + entry.candidates, 0);
    // 11 + 5 + 9 + 1 = 26 expected; the extractor finds 26 too.
    expect(totalExpected).toBeGreaterThanOrEqual(25);
    expect(totalExtracted).toBe(totalExpected);
  });

  test("scenario 1 (clean): P = R = F1 = 1, exact counters", () => {
    const clean = report("clean-steady-play-by-play");
    // Hand-computed (fixture comments): 11 units -> 11 candidates, all 11
    // expected matched.
    expect(clean.units).toBe(11);
    expect(clean.candidates).toBe(11);
    expect(clean.precision).toBe(1);
    expect(clean.recall).toBe(1);
    expect(clean.f1).toBe(1);
    // withSubjects = 7 (cu-5/7/8/10 carry no lexicon name); perType
    // counts; means per the fixture arithmetic.
    expect(clean.withSubjects).toBe(7);
    expect(clean.perType).toEqual({
      pass: 1,
      corner: 2,
      save: 1,
      goal: 1,
      card: 1,
      "throw-in": 1,
      offside: 1,
      "free-kick": 1,
      foul: 2,
    });
    expect(clean.meanConfidence).toBeCloseTo(9.165 / 11, 9);
    expect(clean.meanEmphasis).toBeCloseTo(0.4 / 11, 9);
  });

  test("scenario 2 (excited): recall >= 0.9, exact counters", () => {
    const excited = report("excited-goal-call");
    // Hand-computed: 4 units -> 5 candidates (cu-3 = foul + free-kick), all
    // 5 expected matched: P = R = F1 = 1.
    expect(excited.units).toBe(4);
    expect(excited.candidates).toBe(5);
    expect(excited.recall).toBeGreaterThanOrEqual(0.9);
    expect(excited.precision).toBe(1);
    expect(excited.f1).toBe(1);
    expect(excited.withSubjects).toBe(5);
    expect(excited.perType).toEqual({ goal: 2, foul: 1, "free-kick": 1, card: 1 });
    expect(excited.meanConfidence).toBeCloseTo(4.41 / 5, 9);
    expect(excited.meanEmphasis).toBeCloseTo(2.4 / 5, 9);
  });

  test("scenario 3 (mixed): the honest P = R = F1 = 8/9", () => {
    const mixed = report("mixed-multi-event-passage");
    // Hand-computed: 11 units -> 9 extracted, 9 expected, 8 correct.
    // - one recall miss ("dinks it" has no pattern),
    // - one precision miss (bare "effort" extracted, not annotated).
    expect(mixed.units).toBe(11);
    expect(mixed.candidates).toBe(9);
    expect(mixed.precision).toBeCloseTo(8 / 9, 12);
    expect(mixed.recall).toBeCloseTo(8 / 9, 12);
    expect(mixed.f1).toBeCloseTo(8 / 9, 12);
    expect(mixed.withSubjects).toBe(7);
    expect(mixed.perType).toEqual({
      shot: 2,
      corner: 1,
      offside: 2,
      substitution: 1,
      pass: 1,
      card: 1,
      fulltime: 1,
    });
    expect(mixed.meanConfidence).toBeCloseTo(7.745 / 9, 9);
    expect(mixed.meanEmphasis).toBeCloseTo(0.2 / 9, 9);
  });

  test("scenario 4 (sparse): exactly 1 candidate with empty subjects", () => {
    const sparse = report("sparse-single-event");
    // Hand-computed: 2 units -> 1 throw-in candidate; the lexicon names
    // Thiago, who never appears -> subjects [] (no name guessing).
    expect(sparse.units).toBe(2);
    expect(sparse.candidates).toBe(1);
    expect(sparse.withSubjects).toBe(0);
    expect(sparse.perType).toEqual({ "throw-in": 1 });
    expect(sparse.precision).toBe(1);
    expect(sparse.recall).toBe(1);
    expect(sparse.f1).toBe(1);
    expect(sparse.meanConfidence).toBeCloseTo(0.745, 9);
    expect(sparse.meanEmphasis).toBe(0);

    const scenario = BENCHMARK_FIXTURES.find((entry) => entry.name === "sparse-single-event");
    expect(scenario).toBeDefined();
    const extracted = extractEventCandidates({
      units: scenario?.units ?? [],
      lexicon: scenario?.lexicon ?? { players: [], teams: [] },
    });
    expect(extracted).toHaveLength(1);
    expect(extracted[0]?.subjects).toEqual([]);
  });

  test("the benchmark is deterministic: two runs deep-equal", () => {
    expect(runExtractionBenchmark(BENCHMARK_FIXTURES)).toEqual(
      runExtractionBenchmark(BENCHMARK_FIXTURES),
    );
  });
});
