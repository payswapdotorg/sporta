/**
 * HF002 provenance-ledger validator: the machine-checkable twin of
 * docs/contracts/technology-provenance-ledger.md.
 *
 * The ledger is only trustworthy if it cannot silently drift, so this battery
 * fails on ANY drift between the JSON registry, the markdown contract and the
 * frozen task-profile IDs. It intentionally pins the frozen profile set: if
 * docs/contracts/technology-task-profiles.md is ever restructured, this test
 * forces a deliberate re-review instead of a silently weaker parse.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const LEDGER_JSON_PATH = join(
  REPO_ROOT,
  "scripts",
  "evidence",
  "hf-portfolio",
  "provenance-ledger.json",
);
const LEDGER_MD_PATH = join(REPO_ROOT, "docs", "contracts", "technology-provenance-ledger.md");
const PROFILES_MD_PATH = join(REPO_ROOT, "docs", "contracts", "technology-task-profiles.md");

/** The exact row schema (field names shared by the markdown and JSON twins). */
const ROW_FIELDS = [
  "candidate",
  "taskProfiles",
  "modelUrl",
  "revision",
  "modelLicense",
  "codeLicense",
  "weightsProvenance",
  "datasetProvenance",
  "commercialUse",
  "gatingState",
  "sources",
  "recordedAt",
] as const;

interface LedgerRow {
  candidate: string;
  taskProfiles: string[];
  modelUrl: string;
  revision: string;
  modelLicense: string;
  codeLicense: string;
  weightsProvenance: string;
  datasetProvenance: string;
  commercialUse: string;
  gatingState: string;
  sources: string[];
  recordedAt: string;
}

/** Research-only watchlist candidates named by the work-items doc. */
const WATCHLIST_CANDIDATES: ReadonlySet<string> = new Set(["DA3-GIANT"]);

/** The frozen logical profile set (HF001) — pinned so a weaker parse fails. */
const FROZEN_PROFILE_COUNT = 17;

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function parseFrozenProfileIds(profilesMd: string): Set<string> {
  const ids = new Set<string>();
  for (const match of profilesMd.matchAll(/^### (\S+)$/gm)) {
    const id = match[1];
    if (id !== undefined) ids.add(id);
  }
  return ids;
}

interface MarkdownRow {
  candidate: string;
  modelUrl: string;
  gatingState: string;
  inWatchlistSection: boolean;
}

function parseMarkdownRows(ledgerMd: string): MarkdownRow[] {
  const watchlistStart = ledgerMd.indexOf("## Research-only watchlist");
  const rows: MarkdownRow[] = [];
  const candidateRe = /^- candidate: (.+)$/gm;
  const modelUrlRe = /^- modelUrl: (.+)$/gm;
  const gatingRe = /^- gatingState: (.+)$/gm;
  const candidates = [...ledgerMd.matchAll(candidateRe)].map((m) => {
    const value = m[1];
    if (value === undefined) throw new Error("unreachable: candidate capture");
    return { value, index: m.index ?? 0 };
  });
  const modelUrls = [...ledgerMd.matchAll(modelUrlRe)].map((m) => {
    const value = m[1];
    if (value === undefined) throw new Error("unreachable: modelUrl capture");
    return { value, index: m.index ?? 0 };
  });
  const gatingStates = [...ledgerMd.matchAll(gatingRe)].map((m) => {
    const value = m[1];
    if (value === undefined) throw new Error("unreachable: gatingState capture");
    return { value, index: m.index ?? 0 };
  });
  if (candidates.length !== modelUrls.length || candidates.length !== gatingStates.length) {
    throw new Error(
      `markdown row fields out of sync: ${candidates.length} candidates, ${modelUrls.length} modelUrls, ${gatingStates.length} gatingStates`,
    );
  }
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const modelUrl = modelUrls[i];
    const gating = gatingStates[i];
    if (candidate === undefined || modelUrl === undefined || gating === undefined) {
      throw new Error("unreachable: index access guarded by length check");
    }
    rows.push({
      candidate: candidate.value,
      modelUrl: modelUrl.value,
      gatingState: gating.value,
      inWatchlistSection: candidate.index > watchlistStart,
    });
  }
  return rows;
}

function loadLedgerRows(): LedgerRow[] {
  const parsed: unknown = JSON.parse(readText(LEDGER_JSON_PATH));
  if (!Array.isArray(parsed)) throw new Error("provenance-ledger.json must be a JSON array");
  return parsed.map((row: unknown): LedgerRow => {
    if (typeof row !== "object" || row === null) {
      throw new Error("every ledger row must be an object");
    }
    return row as LedgerRow;
  });
}

describe("hf002 provenance ledger", () => {
  const rows = loadLedgerRows();
  const ledgerMd = readText(LEDGER_MD_PATH);
  const markdownRows = parseMarkdownRows(ledgerMd);
  const frozenProfiles = parseFrozenProfileIds(readText(PROFILES_MD_PATH));

  test("frozen task-profile doc parses to the pinned HF001 profile set", () => {
    expect(frozenProfiles.size).toBe(FROZEN_PROFILE_COUNT);
    expect(frozenProfiles.has("football.playerDetection")).toBe(true);
    expect(frozenProfiles.has("football.commentarySpeakerDiarization")).toBe(true);
    expect(frozenProfiles.has("scene.metric3DReconstruction")).toBe(true);
    expect(frozenProfiles.has("renderer.cinematicReCamera")).toBe(true);
    expect(frozenProfiles.has("renderer.upscale")).toBe(true);
  });

  test("every row's field set is exactly the schema", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const keys = Object.keys(row).sort();
      const expected = [...ROW_FIELDS].slice().sort();
      expect(keys).toEqual(expected);
    }
  });

  test("every taskProfiles entry exists in the frozen profiles doc", () => {
    for (const row of rows) {
      expect(row.taskProfiles.length).toBeGreaterThan(0);
      for (const profile of row.taskProfiles) {
        expect(frozenProfiles.has(profile)).toBe(true);
      }
    }
  });

  test("watchlist entries carry gatingState watchlist, and nothing else does", () => {
    for (const row of rows) {
      if (WATCHLIST_CANDIDATES.has(row.candidate)) {
        expect(row.gatingState).toBe("watchlist");
      } else {
        expect(row.gatingState).toBe("candidate");
      }
    }
    for (const mdRow of markdownRows) {
      if (WATCHLIST_CANDIDATES.has(mdRow.candidate)) {
        expect(mdRow.inWatchlistSection).toBe(true);
        expect(mdRow.gatingState).toBe("watchlist");
      }
    }
    const watchlistSectionRows = markdownRows.filter((row) => row.inWatchlistSection);
    expect(watchlistSectionRows.map((row) => row.candidate).sort()).toEqual(
      [...WATCHLIST_CANDIDATES].sort(),
    );
  });

  test("commercialUse values are only yes/no/unclear", () => {
    for (const row of rows) {
      expect(["yes", "no", "unclear"]).toContain(row.commercialUse);
    }
  });

  test("gating never starts above candidate/watchlist (HF015 is TL-only)", () => {
    for (const row of rows) {
      expect(["candidate", "watchlist"]).toContain(row.gatingState);
    }
  });

  test("JSON and markdown rows agree on count, candidate and modelUrl", () => {
    expect(markdownRows.length).toBe(rows.length);
    for (let i = 0; i < rows.length; i += 1) {
      const jsonRow = rows[i];
      const mdRow = markdownRows[i];
      if (jsonRow === undefined || mdRow === undefined) throw new Error("unreachable");
      expect(mdRow.candidate).toBe(jsonRow.candidate);
      expect(mdRow.modelUrl).toBe(jsonRow.modelUrl);
    }
  });

  test("honesty invariants: unique candidates, cited sources, revisions, timestamps", () => {
    const candidates = rows.map((row) => row.candidate);
    expect(new Set(candidates).size).toBe(candidates.length);
    for (const row of rows) {
      expect(row.sources.length).toBeGreaterThan(0);
      for (const source of row.sources) {
        expect(source.startsWith("https://")).toBe(true);
      }
      if (row.revision !== "unknown") {
        expect(row.revision).toMatch(/^[0-9a-f]{40}$/);
      }
      expect(row.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(row.modelUrl.startsWith("https://")).toBe(true);
    }
  });
});
