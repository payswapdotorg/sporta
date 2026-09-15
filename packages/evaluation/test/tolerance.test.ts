/**
 * W403 tolerance-spec tests.
 *
 * The tolerance spec IS the "documented tolerance" of the W403 accept
 * criterion: every default epsilon is pinned here by name, and — because
 * THE EXCLUSION RULES ARE THE CONTRACT — every excluded field is pinned
 * with its rationale and its BEHAVIOR (recorded, visible, never a
 * failure). If any of these defaults changes, this file is what fails, and
 * the change must be re-documented in `src/tolerance.ts`.
 */
import { describe, expect, test } from "bun:test";
import { REPLAY_GENERATED_AT_MS } from "@sporta/temporal";
import {
  DEFAULT_CONFIDENCE_EPSILON,
  DEFAULT_EXCLUDED_FIELDS,
  DEFAULT_POSITION_EPSILON_M,
  DEFAULT_TIME_EPSILON_MS,
  DEFAULT_TOLERANCE,
  EVALUATION_ENGINE_NOW_MS,
  compareSnapshots,
  isExcludedField,
  validateToleranceSpec,
} from "../src/index";
import type { ToleranceSpec } from "../src/index";
import { makeSnapshot } from "./helpers";

describe("tolerance spec — the documented defaults (pinned, named, exported)", () => {
  test("position epsilon: 1e-9 meters (1 nanometer — float reordering noise only)", () => {
    // Rationale (src/tolerance.ts): positions are perception-derived floats
    // carried verbatim through the deterministic chain; same-binary runs
    // reproduce them bit-exactly, so the epsilon absorbs only harmless
    // reordering of float operations.
    expect(DEFAULT_POSITION_EPSILON_M).toBe(1e-9);
  });

  test("confidence epsilon: 1e-12 (the tightest class — float noise on products)", () => {
    // Rationale: confidences are products of documented factors and feed
    // downstream trust decisions; 1e-12 is arithmetic noise, nothing more.
    expect(DEFAULT_CONFIDENCE_EPSILON).toBe(1e-12);
  });

  test("time epsilon: 0 (times are EXACT — integer-ms constants on the media timeline)", () => {
    // Rationale: HARNESS rule 3 — every time is an explicit millisecond
    // constant; a cross-run time difference is semantic, never rounding.
    expect(DEFAULT_TIME_EPSILON_MS).toBe(0);
  });

  test("integer class: the exact sentinel, never epsilon-comparable", () => {
    expect(DEFAULT_TOLERANCE.integer).toBe("exact");
  });

  test("DEFAULT_TOLERANCE is composed ONLY from the named exported defaults", () => {
    expect(DEFAULT_TOLERANCE).toEqual({
      positionM: DEFAULT_POSITION_EPSILON_M,
      confidence: DEFAULT_CONFIDENCE_EPSILON,
      timeMs: DEFAULT_TIME_EPSILON_MS,
      integer: "exact",
      excludedFields: DEFAULT_EXCLUDED_FIELDS,
    });
  });

  test("the default spec object is not frozen — it stays spreadable for consumer overrides", () => {
    // Consumers tighten/loosen by spreading ({ ...DEFAULT_TOLERANCE, positionM });
    // the shared default is never mutated in place by the harness.
    expect(Object.isFrozen(DEFAULT_TOLERANCE)).toBe(false);
    // The excluded-field paths themselves are pinned here (the content contract):
    expect(DEFAULT_EXCLUDED_FIELDS).toEqual(["generatedAtMs", "watermark.sequence"]);
  });
});

describe("tolerance spec — the EXCLUSION RULES (the contract)", () => {
  test("generatedAtMs: excluded because W402 forces replay clocks to a constant", () => {
    // RULE: the live engine's `generatedAtMs` is a clock read (the harness
    // injects the constant EVALUATION_ENGINE_NOW_MS), while W402's
    // replayForward FORCES every replay snapshot's `generatedAtMs` to
    // REPLAY_GENERATED_AT_MS — replay output must be byte-reproducible.
    // The field records WHO generated the snapshot and WHEN, not world
    // state: a replay-vs-live difference here is documented, not a defect.
    expect(REPLAY_GENERATED_AT_MS).toBe(0);
    expect(EVALUATION_ENGINE_NOW_MS).not.toBe(REPLAY_GENERATED_AT_MS);
    // BEHAVIOR: deliberately different values are recorded as excluded
    // entries and never fail comparability.
    const a = makeSnapshot();
    const b = makeSnapshot({ generatedAtMs: a.generatedAtMs + 1234 });
    const diff = compareSnapshots(a, b);
    const entry = diff.diffs.find((candidate) => candidate.path === "generatedAtMs");
    expect(entry?.kind).toBe("excluded");
    expect(diff.comparable).toBe(true);
  });

  test("watermark.sequence: excluded because replay sequences are replay-local", () => {
    // RULE: a W402 replay rebuilds on a FRESH engine whose sequence counter
    // counts only the replayed window; the live engine's counter counts
    // the whole session's arrival order. The two numbers measure different
    // engines' bookkeeping, not different world state.
    const a = makeSnapshot();
    const b = makeSnapshot({ watermarkSequence: a.watermark.sequence + 3 });
    const diff = compareSnapshots(a, b);
    const entry = diff.diffs.find((candidate) => candidate.path === "watermark.sequence");
    expect(entry?.kind).toBe("excluded");
    expect(diff.comparable).toBe(true);
  });

  test("exclusions match EXACT paths — no prefixes, no globbing", () => {
    const spec = DEFAULT_TOLERANCE;
    expect(isExcludedField(spec, "generatedAtMs")).toBe(true);
    expect(isExcludedField(spec, "watermark.sequence")).toBe(true);
    // Near-miss paths are NOT excluded: the rule is precise and auditable.
    expect(isExcludedField(spec, "watermark.watermarkMs")).toBe(false);
    expect(isExcludedField(spec, "watermark.sequence.foo")).toBe(false);
    expect(isExcludedField(spec, "football.generatedAtMs")).toBe(false);
    expect(isExcludedField(spec, "")).toBe(false);
  });
});

describe("validateToleranceSpec — fail loud on an invalid spec (repo style)", () => {
  test("accepts the default and a valid custom spec (spread + override)", () => {
    expect(validateToleranceSpec(DEFAULT_TOLERANCE)).toBe(DEFAULT_TOLERANCE);
    const custom: ToleranceSpec = { ...DEFAULT_TOLERANCE, positionM: 0.5 };
    expect(validateToleranceSpec(custom)).toBe(custom);
  });

  test("rejects non-finite or negative epsilons", () => {
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY, "0.1" as unknown as number]) {
      expect(() => validateToleranceSpec({ ...DEFAULT_TOLERANCE, positionM: bad })).toThrow(
        RangeError,
      );
      expect(() => validateToleranceSpec({ ...DEFAULT_TOLERANCE, confidence: bad })).toThrow(
        RangeError,
      );
      expect(() => validateToleranceSpec({ ...DEFAULT_TOLERANCE, timeMs: bad })).toThrow(
        RangeError,
      );
    }
  });

  test("rejects a widened integer class", () => {
    expect(() =>
      validateToleranceSpec({ ...DEFAULT_TOLERANCE, integer: "epsilon" as never }),
    ).toThrow(RangeError);
  });

  test("rejects malformed excludedFields", () => {
    expect(() =>
      validateToleranceSpec({ ...DEFAULT_TOLERANCE, excludedFields: "generatedAtMs" as never }),
    ).toThrow(RangeError);
    expect(() =>
      validateToleranceSpec({ ...DEFAULT_TOLERANCE, excludedFields: ["", 7 as unknown as string] }),
    ).toThrow(RangeError);
  });

  test("a custom spec with NO exclusions makes generatedAtMs a real difference again", () => {
    // The mirror of the exclusion behavior: tighten the spec to exclude
    // nothing, and the same generatedAtMs difference now FAILS
    // comparability — the exclusion is a rule, not an accident.
    const strict: ToleranceSpec = { ...DEFAULT_TOLERANCE, excludedFields: [] };
    const a = makeSnapshot();
    const b = makeSnapshot({ generatedAtMs: a.generatedAtMs + 1234 });
    const diff = compareSnapshots(a, b, strict);
    expect(diff.comparable).toBe(false);
    expect(diff.diffs.find((candidate) => candidate.path === "generatedAtMs")?.kind).toBe(
      "numeric",
    );
  });
});
