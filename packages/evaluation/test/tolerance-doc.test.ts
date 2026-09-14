/**
 * W403 TOLERANCE.md pin tests — the documented tolerance and the executable
 * classification cannot drift apart: §3's rule table matches
 * `W403_ARTIFACT_CLASSIFICATION` row-for-row (pattern, class, setKey,
 * rationale, ORDER), and the document carries the policy statements the
 * contract is built on (epsilon value, fail-loud unclassified policy,
 * SET justification, regen procedure).
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { DEFAULT_EPSILON, W403_ARTIFACT_CLASSIFICATION } from "../src/compare";

const DOC_PATH = `${import.meta.dir}/../TOLERANCE.md`;

/** One parsed §3 table row. */
interface DocRow {
  pattern: string;
  fieldClass: string;
  setKey: string | null;
  rationale: string;
}

/** Parses the §3 rule table out of TOLERANCE.md (fail loud on shape drift). */
function parseDocTable(doc: string): DocRow[] {
  const lines = doc.split("\n");
  const start = lines.findIndex((line) =>
    line.startsWith("| pattern | class | setKey | rationale |"),
  );
  if (start === -1) {
    throw new RangeError("TOLERANCE.md: the §3 rule table header is missing");
  }
  const rows: DocRow[] = [];
  for (let i = start + 2; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!line.startsWith("|")) break; // the table ends at the next section
    const cells = line
      .slice(1, line.endsWith("|") ? -1 : undefined)
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length !== 4) {
      throw new RangeError(`TOLERANCE.md: malformed table row "${line}"`);
    }
    rows.push({
      pattern: cells[0]!.replace(/^`|`$/g, ""),
      fieldClass: cells[1]!,
      setKey: cells[2] === "—" ? null : cells[2]!,
      rationale: cells[3]!,
    });
  }
  return rows;
}

describe("TOLERANCE.md — the doc/table pin (no silent drift either way)", () => {
  test("every code rule is documented, in order, with identical class/setKey/rationale", async () => {
    const rows = parseDocTable(await readFile(DOC_PATH, "utf8"));
    expect(rows).toHaveLength(W403_ARTIFACT_CLASSIFICATION.length);
    for (let i = 0; i < W403_ARTIFACT_CLASSIFICATION.length; i += 1) {
      const rule = W403_ARTIFACT_CLASSIFICATION[i]!;
      const row = rows[i]!;
      expect(row.pattern).toBe(rule.pattern);
      expect(row.fieldClass).toBe(rule.fieldClass);
      expect(row.setKey).toBe(rule.setKey ?? null);
      expect(row.rationale).toBe(rule.rationale);
    }
  });

  test("the documented table has no extra rows (doc ⇒ code, both directions)", async () => {
    const rows = parseDocTable(await readFile(DOC_PATH, "utf8"));
    const codePatterns = new Set(W403_ARTIFACT_CLASSIFICATION.map((rule) => rule.pattern));
    for (const row of rows) {
      expect(codePatterns.has(row.pattern)).toBe(true);
    }
  });

  test("the policy statements are present (epsilon, fail-loud, SET, regen)", async () => {
    const doc = await readFile(DOC_PATH, "utf8");
    expect(String(DEFAULT_EPSILON)).toBe("1e-9");
    expect(doc).toContain("ε = 1e-9");
    expect(doc).toContain("UNCLASSIFIED");
    expect(doc).toContain("FAILS LOUD");
    expect(doc).toContain("SET only where element order is genuinely semantically irrelevant");
    expect(doc).toContain("tech-lead review");
    expect(doc).toContain("regen-golden --confirm");
    expect(doc).toContain("forced constants, not exclusions");
    // The honest limitations section exists (§8) and admits zero-measures.
    expect(doc).toContain("## 8. Limitations (measured, honest)");
    expect(doc).toContain("measures 0");
  });
});
