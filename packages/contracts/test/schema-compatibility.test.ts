import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { CONTRACT_SCHEMAS } from "../src/index";

const GOLDEN_DIR = join(import.meta.dir, "..", "fixtures", "schemas-golden");

const BREAK_INSTRUCTIONS = [
  "schema break detected: a committed golden snapshot no longer matches the schema",
  "exported from the current contracts source.",
  "",
  "If the change is intentional:",
  "  1. bump SCHEMA_MINOR (additive) or SCHEMA_MAJOR (breaking) in",
  "     packages/contracts/src/versioning.ts;",
  "  2. for breaking changes, add an ADR under docs/adr/ and a migration note",
  "     (see docs/contracts/COMPATIBILITY.md and architecture-lock §14);",
  "  3. regenerate the goldens intentionally:",
  "     cd packages/contracts && bun run export-schemas --update-golden;",
  "  4. update the fixtures under packages/contracts/fixtures/ and review the",
  "     golden diff before committing.",
  "",
  "If the change is NOT intentional, revert the contracts source.",
].join("\n");

function listGoldenNames(): string[] {
  if (!existsSync(GOLDEN_DIR)) return [];
  return readdirSync(GOLDEN_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(/\.json$/, ""))
    .sort();
}

describe("schema compatibility (golden snapshots)", () => {
  test("every contract schema has exactly one committed golden", () => {
    expect(listGoldenNames()).toEqual(Object.keys(CONTRACT_SCHEMAS).sort());
  });

  for (const [name, schema] of Object.entries(CONTRACT_SCHEMAS)) {
    test(`golden snapshot matches current export: ${name}`, () => {
      const goldenPath = join(GOLDEN_DIR, `${name}.json`);
      const golden: unknown = JSON.parse(readFileSync(goldenPath, "utf8"));
      const fresh: unknown = z.toJSONSchema(schema);
      try {
        expect(golden).toEqual(fresh);
      } catch (mismatch) {
        throw new Error(
          `${BREAK_INSTRUCTIONS}\n\ngolden diff for "${name}":\n${(mismatch as Error).message}`,
        );
      }
    });
  }
});
