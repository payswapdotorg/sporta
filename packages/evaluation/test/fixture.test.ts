/**
 * W403 frozen-fixture loader tests: the checked-in fixture loads, parses, and
 * is sha256-PINNED (byte drift fails the suite); every targeted invalid
 * variant (checked-in under `test/fixtures/invalid/`) fails LOUD with a
 * RangeError naming the break — never a silent skip or default.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { DEFAULT_FIXTURE_PATH, loadFixture } from "../src/fixture";
import { FIXTURE_KIND } from "../src/artifact";

/**
 * The PINNED sha256 of the checked-in fixture bytes. The fixture is frozen
 * input: any byte change (regeneration, reformatting, reordering) changes
 * the hash, fails this test, and invalidates the golden — regenerating the
 * fixture is a separate, tech-lead-reviewed act (TOLERANCE.md §7).
 */
const PINNED_FIXTURE_SHA256 = "7da57e102d45e93a77e108b0e8a813ac01fc03544fa2e1b2dba46632ea4059c2";

/** The pinned content facts of the checked-in fixture (spec-level pins). */
const PINNED_SPEC = {
  fixtureId: "w403-eval-fixture-1",
  sessionId: "sess-w403-eval",
  observationCount: 248,
  pinnedStateAtMs: [0, 2_000, 4_000, 6_000, 8_000, 10_000, 11_800],
  eventWindow: { fromMs: 0, toMs: 12_000 },
  replay: { maxEvents: 8, maxSpanMs: 12_000, checkpointEveryMs: 2_000 },
  possessionRadiusM: 2,
  maxReorderMs: 5_000,
} as const;

const INVALID_DIR = `${import.meta.dir}/fixtures/invalid`;

describe("loadFixture — the checked-in frozen fixture", () => {
  test("loads and validates (fixture file exists at the default path)", () => {
    expect(existsSync(DEFAULT_FIXTURE_PATH)).toBe(true);
    const loaded = loadFixture();
    expect(loaded.spec.fixtureKind).toBe(FIXTURE_KIND);
    expect(loaded.spec.observations).toHaveLength(PINNED_SPEC.observationCount);
  });

  test("the fixture bytes are sha256-pinned (byte drift fails the suite)", () => {
    const loaded = loadFixture();
    expect(loaded.sha256).toBe(PINNED_FIXTURE_SHA256);
    // Independent re-hash straight from the file bytes.
    const bytes = readFileSync(DEFAULT_FIXTURE_PATH, "utf8");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(PINNED_FIXTURE_SHA256);
  });

  test("the spec's pinned content facts hold (counts, pins, window, limits)", () => {
    const { spec } = loadFixture();
    expect(spec.fixtureId).toBe(PINNED_SPEC.fixtureId);
    expect(spec.sessionId).toBe(PINNED_SPEC.sessionId);
    expect(spec.trackFrame).toBe("pitch");
    expect(spec.pinnedStateAtMs).toEqual([...PINNED_SPEC.pinnedStateAtMs]);
    expect(spec.eventWindow).toEqual({ ...PINNED_SPEC.eventWindow });
    expect(spec.replay).toEqual({ ...PINNED_SPEC.replay });
    expect(spec.possessionRadiusM).toBe(PINNED_SPEC.possessionRadiusM);
    expect(spec.maxReorderMs).toBe(PINNED_SPEC.maxReorderMs);
    // Every observation parses (the loader already asserted it) and belongs
    // to the fixture session; the stream mixes tracks and candidates.
    const kinds = new Set(spec.observations.map((obs) => obs.payload.kind));
    expect(kinds.has("track")).toBe(true);
    expect(kinds.has("generic")).toBe(true);
    expect(spec.observations.every((obs) => obs.sessionId === spec.sessionId)).toBe(true);
  });

  test("the footballInit is the canonical pitch frame", () => {
    const { spec } = loadFixture();
    expect(spec.footballInit.pitch).toEqual({
      lengthAxisMeters: 105,
      widthAxisMeters: 68,
      origin: "corner",
      axes: "x=touchline, y=goal-line",
    });
  });
});

describe("loadFixture — fail-loud coverage (checked-in invalid variants)", () => {
  const cases: ReadonlyArray<{ file: string; message: RegExp }> = [
    {
      file: "wrong-kind.json",
      message: /only consumes "w403-fixture\/1" fixtures/,
    },
    { file: "bad-pins.json", message: /strictly ascending/ },
    { file: "bad-window.json", message: /eventWindow must be \{ fromMs, toMs \}/ },
    {
      file: "bad-observation.json",
      message: /observations\[0\] does not parse against the Observation contract/,
    },
    { file: "unknown-envelope-key.json", message: /unknown envelope key "extraEnvelopeKey"/ },
    { file: "bad-football-init.json", message: /not the canonical pitch frame/ },
    { file: "session-mismatch.json", message: /not the fixture session "sess-w403-invalid"/ },
    // Deliberately unparsable content — a .txt (not JSON data): Prettier's
    // JSON parser cannot be pointed at intentionally-broken JSON.
    { file: "malformed.txt", message: /not valid JSON/ },
  ];

  for (const { file, message } of cases) {
    test(`"${file}" throws a RangeError matching ${message}`, () => {
      expect(() => loadFixture(`${INVALID_DIR}/${file}`)).toThrow(RangeError);
      expect(() => loadFixture(`${INVALID_DIR}/${file}`)).toThrow(message);
    });
  }

  test("a missing fixture file fails loud (the fixture is checked-in input)", () => {
    expect(() => loadFixture(`${INVALID_DIR}/does-not-exist.json`)).toThrow(
      /cannot read the frozen fixture/,
    );
  });
});
