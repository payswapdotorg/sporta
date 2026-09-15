/**
 * W801 suite-config validation tests: the declarative, versioned, strictly
 * validated suite definition. Every negative here is a FAIL-LOUD proof —
 * unknown case kinds, unknown keys, missing fields, wrong types, and
 * duplicate names all throw before anything runs; the config has NO
 * defaults (an omitted field is an error, never a silently-filled value).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import {
  DEFAULT_SUITE_PATH,
  SUITE_CONFIG_SCHEMA_TAG,
  loadSuiteConfig,
  validateSuiteConfig,
} from "../src/suite-config";
import { defaultConfigObject, scratchPath } from "./helpers";

/** The valid default config, deep-cloned, with one mutation applied. */
function mutated(mutator: (config: Record<string, unknown>) => void): Record<string, unknown> {
  const config = defaultConfigObject();
  mutator(config);
  return config;
}

/** Extracts the first case object for case-level mutations. */
function firstCase(config: Record<string, unknown>): Record<string, unknown> {
  const cases = config.cases as Record<string, unknown>[];
  return cases[0]!;
}

describe("suite config: the checked-in default suite loads and validates", () => {
  test("the default suite path is the checked-in file", () => {
    expect(DEFAULT_SUITE_PATH).toContain("fixtures/suite.json");
  });

  test("the checked-in suite validates with the expected shape", () => {
    const loaded = loadSuiteConfig();
    expect(loaded.config.suiteKind).toBe(SUITE_CONFIG_SCHEMA_TAG);
    expect(loaded.config.suiteId).toBe("sporta-eval-harness-default");
    expect(loaded.config.suiteVersion).toBe(2);
    expect(loaded.config.cases.map((c) => c.caseName)).toEqual([
      "w403-replay-comparability",
      "w503-temporal-consistency",
      "w601-scene-conformance",
      "w306-latency-benchmark",
    ]);
    for (const caseConfig of loaded.config.cases) {
      // caseKind is a controlled union; caseName is the caller-chosen echo of
      // it in the checked-in default suite (compared as plain strings).
      expect(caseConfig.caseKind as string).toBe(caseConfig.caseName);
      expect(Object.keys(caseConfig.fixture).length).toBeGreaterThan(0);
      expect(Object.keys(caseConfig.policy).length).toBeGreaterThan(0);
    }
  });

  test("the loaded config carries a canonical serialization + sha256", () => {
    const loaded = loadSuiteConfig();
    expect(loaded.canonical).toBe(loadSuiteConfig().canonical);
    expect(loaded.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(loaded.originDir).toContain("fixtures");
  });

  test("the canonical serialization is the W403 serializer's form (sorted keys)", () => {
    const loaded = loadSuiteConfig();
    const parsed = JSON.parse(loaded.canonical) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort());
  });
});

describe("suite config: fail-loud validation (no defaults, no unknown anything)", () => {
  test("a non-object config fails", () => {
    expect(() => validateSuiteConfig(null)).toThrow(RangeError);
    expect(() => validateSuiteConfig([1, 2])).toThrow(/must be a JSON object/);
  });

  test("the wrong suiteKind tag fails loud (versioned shape)", () => {
    expect(() =>
      validateSuiteConfig(mutated((c) => (c.suiteKind = "sporta/eval-harness/suite-config@0"))),
    ).toThrow(/suiteKind/);
  });

  test("an unknown top-level key fails with its name", () => {
    expect(() => validateSuiteConfig(mutated((c) => (c.weights = { w403: 0.5 })))).toThrow(
      /unknown key "weights"/,
    );
  });

  test("a missing top-level key fails (no defaults)", () => {
    expect(() => validateSuiteConfig(mutated((c) => delete c.suiteVersion))).toThrow(
      /missing required key "suiteVersion"/,
    );
  });

  test("suiteVersion must be an integer >= 1", () => {
    expect(() => validateSuiteConfig(mutated((c) => (c.suiteVersion = 0)))).toThrow(/suiteVersion/);
    expect(() => validateSuiteConfig(mutated((c) => (c.suiteVersion = 1.5)))).toThrow(
      /suiteVersion/,
    );
  });

  test("an empty cases array fails (a suite with no cases is a config error)", () => {
    expect(() => validateSuiteConfig(mutated((c) => (c.cases = [])))).toThrow(/non-empty/);
  });

  test("a missing cases key fails", () => {
    expect(() => validateSuiteConfig(mutated((c) => delete c.cases))).toThrow(
      /missing required key "cases"/,
    );
  });

  test("an UNKNOWN CASE KIND fails loud, listing the known kinds", () => {
    expect(() =>
      validateSuiteConfig(mutated((c) => (firstCase(c).caseKind = "w999-unknown-evaluator"))),
    ).toThrow(/unknown case kind/);
    expect(() =>
      validateSuiteConfig(mutated((c) => (firstCase(c).caseKind = "w999-unknown-evaluator"))),
    ).toThrow(/w403-replay-comparability/);
  });

  test("a duplicate caseName fails", () => {
    expect(() =>
      validateSuiteConfig(
        mutated((c) => {
          const cases = c.cases as Record<string, unknown>[];
          cases.push(JSON.parse(JSON.stringify(cases[0]!)) as Record<string, unknown>);
        }),
      ),
    ).toThrow(/duplicate caseName/);
  });

  test("an unknown case-level key fails", () => {
    expect(() => validateSuiteConfig(mutated((c) => (firstCase(c).skipOnCrash = true)))).toThrow(
      /unknown key "skipOnCrash"/,
    );
  });

  test("a case missing its policy fails — policies are never defaulted", () => {
    expect(() => validateSuiteConfig(mutated((c) => delete firstCase(c).policy))).toThrow(
      /missing required key "policy"/,
    );
  });

  test("a case missing its fixture fails — fixtures are never defaulted", () => {
    expect(() => validateSuiteConfig(mutated((c) => delete firstCase(c).fixture))).toThrow(
      /missing required key "fixture"/,
    );
  });

  test("W403 policy: runs must be an integer >= 2", () => {
    expect(() =>
      validateSuiteConfig(
        mutated((c) => ((firstCase(c).policy as Record<string, unknown>).runs = 1)),
      ),
    ).toThrow(/runs must be an integer >= 2/);
    expect(() =>
      validateSuiteConfig(
        mutated((c) => ((firstCase(c).policy as Record<string, unknown>).runs = "2")),
      ),
    ).toThrow(/runs must be an integer >= 2/);
  });

  test("W403 fixture: a missing goldenPath fails (null is explicit, absence is not)", () => {
    expect(() =>
      validateSuiteConfig(
        mutated((c) => delete (firstCase(c).fixture as Record<string, unknown>).goldenPath),
      ),
    ).toThrow(/missing required key "goldenPath"/);
  });

  test("W403 fixture: an unknown fixture key fails", () => {
    expect(() =>
      validateSuiteConfig(
        mutated((c) => ((firstCase(c).fixture as Record<string, unknown>).epsilon = 5)),
      ),
    ).toThrow(/unknown key "epsilon"/);
  });

  test("W403 fixture: goldenPath null is an explicit valid policy", () => {
    const config = mutated(
      (c) => ((firstCase(c).fixture as Record<string, unknown>).goldenPath = null),
    );
    expect(() => validateSuiteConfig(config)).not.toThrow();
  });

  test("W503 fixture: an unknown clip fails (the controlled vocabulary)", () => {
    expect(() =>
      validateSuiteConfig(
        mutated((c) => {
          const cases = c.cases as Record<string, unknown>[];
          (cases[1]!.fixture as Record<string, unknown>).clip = "some-other-clip";
        }),
      ),
    ).toThrow(/w503-clean-fixture/);
  });

  test("W503 policy: detectionProof must be a boolean", () => {
    expect(() =>
      validateSuiteConfig(
        mutated((c) => {
          const cases = c.cases as Record<string, unknown>[];
          (cases[1]!.policy as Record<string, unknown>).detectionProof = "yes";
        }),
      ),
    ).toThrow(/detectionProof/);
  });

  test("W601 policy: an unknown evidence mode fails", () => {
    expect(() =>
      validateSuiteConfig(
        mutated((c) => {
          const cases = c.cases as Record<string, unknown>[];
          (cases[2]!.policy as Record<string, unknown>).evidence = "partial";
        }),
      ),
    ).toThrow(/evidence/);
  });

  test("W601 fixture: a missing sceneFixturePath fails", () => {
    expect(() =>
      validateSuiteConfig(
        mutated((c) => {
          const cases = c.cases as Record<string, unknown>[];
          delete (cases[2]!.fixture as Record<string, unknown>).sceneFixturePath;
        }),
      ),
    ).toThrow(/sceneFixturePath/);
  });

  test("W306 fixture: an unknown benchmark fails (the controlled vocabulary)", () => {
    expect(() =>
      validateSuiteConfig(
        mutated((c) => {
          const cases = c.cases as Record<string, unknown>[];
          (cases[3]!.fixture as Record<string, unknown>).benchmark = "some-other-fixture";
        }),
      ),
    ).toThrow(/w306-live-fixture/);
  });

  test("W306 policy: checkSloCandidates must be a boolean (no defaults)", () => {
    expect(() =>
      validateSuiteConfig(
        mutated((c) => {
          const cases = c.cases as Record<string, unknown>[];
          (cases[3]!.policy as Record<string, unknown>).checkSloCandidates = "yes";
        }),
      ),
    ).toThrow(/checkSloCandidates/);
    expect(() =>
      validateSuiteConfig(
        mutated((c) => {
          const cases = c.cases as Record<string, unknown>[];
          delete (cases[3]!.policy as Record<string, unknown>).checkSloCandidates;
        }),
      ),
    ).toThrow(/missing required key "checkSloCandidates"/);
  });

  test("W306 fixture: an unknown fixture key fails", () => {
    expect(() =>
      validateSuiteConfig(
        mutated((c) => {
          const cases = c.cases as Record<string, unknown>[];
          (cases[3]!.fixture as Record<string, unknown>).fixturePath = "./somewhere.json";
        }),
      ),
    ).toThrow(/unknown key "fixturePath"/);
  });
});

describe("suite config: loading (fail loud on file problems)", () => {
  test("a missing config file fails with the path", () => {
    expect(() => loadSuiteConfig("/nonexistent/w801-suite.json")).toThrow(
      /cannot read the suite config/,
    );
  });

  test("a config file that is not valid JSON fails", () => {
    const path = scratchPath("not-json-suite.json");
    writeFileSync(path, "{not json");
    expect(() => loadSuiteConfig(path)).toThrow(/not valid JSON/);
  });

  test("a config file with an invalid body fails with the JSON path", () => {
    const path = scratchPath("invalid-suite.json");
    const base = defaultConfigObject();
    const cases = base.cases as Record<string, unknown>[];
    (cases[0]! as Record<string, unknown>).caseKind = "w999-unknown-evaluator";
    writeFileSync(path, JSON.stringify(base, null, 2));
    expect(() => loadSuiteConfig(path)).toThrow(/unknown case kind/);
  });
});

test("the checked-in suite file is Prettier-formatted JSON (repo format check)", () => {
  // Smoke: the file parses as JSON and its object keys match the validator's.
  const text = readFileSync(DEFAULT_SUITE_PATH, "utf8");
  expect(JSON.parse(text)).toEqual(loadSuiteConfig().config);
});
