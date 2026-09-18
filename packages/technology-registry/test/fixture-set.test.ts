/**
 * R002 — fixture-set contract: versioned records, scenario taxonomy, the
 * real-vs-synthetic honesty rules, the evaluation-only license flag, and
 * the canonical default fixture set (manifest integrity + on-disk media
 * verification).
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_FIXTURE_SET_VERSION,
  FixtureScenarioTag,
  REAL_FOOTAGE_CANDIDATES,
  coveredScenarioTags,
  isEvaluationOnly,
  loadDefaultFixtureSet,
  parseFixtureSet,
  verifyDefaultFixtureSetMedia,
} from "../src/index";
import { buildFixtureEntry, buildFixtureSet } from "./builders";

const MEDIA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "media");

describe("FixtureSet contract (R002)", () => {
  test("accepts a valid set and keeps its version", () => {
    const set = buildFixtureSet({ fixtureSetVersion: "fixtures-x-v1" });
    expect(set.fixtureSetVersion).toBe("fixtures-x-v1");
    expect(set.entries).toHaveLength(1);
  });

  test("refuses duplicate fixture ids", () => {
    expect(() =>
      parseFixtureSet(
        buildFixtureSet({
          entries: [
            buildFixtureEntry({ fixtureId: "dup" }),
            buildFixtureEntry({ fixtureId: "dup" }),
          ],
        }),
      ),
    ).toThrow(/duplicate fixtureId/);
  });

  test("refuses an empty entries array", () => {
    expect(() => parseFixtureSet(buildFixtureSet({ entries: [] }))).toThrow();
  });

  test("refuses entries without a scenario tag", () => {
    expect(() =>
      parseFixtureSet(buildFixtureSet({ entries: [buildFixtureEntry({ scenarioTags: [] })] })),
    ).toThrow();
  });

  test("real footage must cite a source URL (honest provenance)", () => {
    expect(() =>
      parseFixtureSet(
        buildFixtureSet({
          entries: [
            buildFixtureEntry({
              mediaKind: "real-footage",
              media: { sourceUrl: undefined },
            }),
          ],
        }),
      ),
    ).toThrow(/source URL/);
  });

  test("synthetic diagnostics must NOT cite a source URL (they are generated)", () => {
    expect(() =>
      parseFixtureSet(
        buildFixtureSet({
          entries: [
            buildFixtureEntry({
              fixtureId: "synthetic-1",
              mediaKind: "synthetic-diagnostic",
            }),
          ],
        }),
      ),
    ).toThrow(/synthetic-diagnostic/);
  });

  test("scenario taxonomy is exactly the frozen six tags", () => {
    expect([...FixtureScenarioTag.options].sort()).toEqual([
      "ball-action",
      "camera-movement",
      "cut-boundary",
      "occlusion",
      "open-play",
      "set-piece",
    ]);
  });
});

describe("isEvaluationOnly (R002 license flag)", () => {
  test("a fully affirmed permissive entry is not evaluation-only", () => {
    expect(isEvaluationOnly(buildFixtureEntry())).toBe(false);
  });

  test("an unresolved component flags the entry", () => {
    const entry = buildFixtureEntry({
      license: {
        code: { status: "permissive", licenseId: "CC0-1.0", commercialUse: true },
        dataset: { status: "unresolved" },
      },
    });
    expect(isEvaluationOnly(entry)).toBe(true);
  });

  test("an unreviewed commercial-use verdict flags the entry (fail-closed)", () => {
    const entry = buildFixtureEntry({
      license: {
        // Explicit undefined removes the builder's default verdict.
        code: { status: "permissive", licenseId: "CC-BY-4.0", commercialUse: undefined },
      },
    });
    expect(isEvaluationOnly(entry)).toBe(true);
  });

  test("a non-commercial dataset flags the entry", () => {
    const entry = buildFixtureEntry({
      license: {
        code: { status: "permissive", licenseId: "CC0-1.0", commercialUse: true },
        dataset: { status: "research-only", licenseId: "CC-BY-NC-4.0", commercialUse: false },
      },
    });
    expect(isEvaluationOnly(entry)).toBe(true);
  });

  test("absent components do not flag the entry", () => {
    const entry = buildFixtureEntry({
      license: { code: { status: "permissive", licenseId: "CC0-1.0", commercialUse: true } },
    });
    expect(isEvaluationOnly(entry)).toBe(false);
  });
});

describe("coveredScenarioTags", () => {
  test("unions and sorts the tags across entries", () => {
    const set = buildFixtureSet({
      entries: [
        buildFixtureEntry({ fixtureId: "a", scenarioTags: ["set-piece", "ball-action"] }),
        buildFixtureEntry({ fixtureId: "b", scenarioTags: ["occlusion"] }),
      ],
    });
    expect(coveredScenarioTags(set)).toEqual(["ball-action", "occlusion", "set-piece"]);
  });
});

describe("real-footage candidates (media-drop checklist)", () => {
  test("every candidate carries complete license provenance and a plan", () => {
    expect(REAL_FOOTAGE_CANDIDATES.length).toBeGreaterThanOrEqual(4);
    for (const candidate of REAL_FOOTAGE_CANDIDATES) {
      expect(candidate.sourceUrl).toMatch(/^https:\/\/upload\.wikimedia\.org\//);
      expect(candidate.licensePageUrl).toMatch(/^https:\/\/commons\.wikimedia\.org\//);
      expect(candidate.licenseId.length).toBeGreaterThan(0);
      expect(candidate.commercialUse).toBe(true);
      expect(candidate.plannedScenarioTags.length).toBeGreaterThan(0);
    }
  });

  test("candidates are NOT active fixtures (no media files exist for them)", () => {
    const set = loadDefaultFixtureSet();
    const activeIds = new Set(set.entries.map((entry) => entry.fixtureId));
    for (const candidate of REAL_FOOTAGE_CANDIDATES) {
      expect(activeIds.has(candidate.fixtureId)).toBe(false);
      // And no candidate media file is checked in.
      expect(existsSync(join(MEDIA_DIR, `${candidate.fixtureId}.webm`))).toBe(false);
      expect(existsSync(join(MEDIA_DIR, `${candidate.fixtureId}.ogv`))).toBe(false);
    }
  });

  test("the planned scenario coverage across candidates completes the taxonomy", () => {
    const planned = new Set(REAL_FOOTAGE_CANDIDATES.flatMap((c) => c.plannedScenarioTags));
    for (const tag of FixtureScenarioTag.options) {
      expect(planned.has(tag)).toBe(true);
    }
  });
});

describe("default fixture set (manifest)", () => {
  test("loads, validates, and pins its version", () => {
    const set = loadDefaultFixtureSet();
    expect(set.fixtureSetVersion).toBe(DEFAULT_FIXTURE_SET_VERSION);
    expect(set.entries.length).toBeGreaterThan(0);
    // Every entry id is unique (schema-enforced) and referenced media is local.
    for (const entry of set.entries) {
      expect(entry.mediaRef.startsWith("http")).toBe(false);
    }
  });

  test("every synthetic entry is labeled synthetic-diagnostic; every real entry cites its source", () => {
    const set = loadDefaultFixtureSet();
    for (const entry of set.entries) {
      if (entry.mediaKind === "synthetic-diagnostic") {
        expect(entry.media.sourceUrl).toBeUndefined();
        expect(entry.notes ?? "").toContain("synthetic");
      } else {
        expect(entry.media.sourceUrl).toMatch(/^https:\/\//);
        expect(entry.license.code.licenseId).toBeDefined();
      }
    }
  });

  test("the checked-in media files exist and match their sha256 pins", () => {
    const issues = verifyDefaultFixtureSetMedia();
    expect(issues).toEqual([]);
    const set = loadDefaultFixtureSet();
    for (const entry of set.entries) {
      const path = join(MEDIA_DIR, entry.mediaRef);
      expect(existsSync(path)).toBe(true);
      expect(statSync(path).size).toBeGreaterThan(0);
      if (entry.media.sha256 !== undefined) {
        const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
        expect(hash).toBe(entry.media.sha256);
      }
    }
  });
});
