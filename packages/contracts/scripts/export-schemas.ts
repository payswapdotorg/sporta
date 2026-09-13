/**
 * Exports every entry of CONTRACT_SCHEMAS to JSON Schema (draft 2020-12)
 * using zod v4's `z.toJSONSchema`.
 *
 * Usage (from `packages/contracts`):
 *
 * - `bun run export-schemas` — writes `dist/schemas/<name>.json` (gitignored
 *   build output, e.g. for external tooling).
 * - `bun run export-schemas --update-golden` — ALSO rewrites
 *   `fixtures/schemas-golden/<name>.json`, the committed compatibility
 *   goldens.
 *
 * Regenerating goldens is an intentional act: it must accompany a reviewed
 * schema change (bump the version per docs/contracts/COMPATIBILITY.md).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { CONTRACT_SCHEMAS } from "../src/index";

const DIST_DIR = join(import.meta.dir, "..", "dist", "schemas");
const GOLDEN_DIR = join(import.meta.dir, "..", "fixtures", "schemas-golden");
const updateGolden = process.argv.slice(2).includes("--update-golden");

mkdirSync(DIST_DIR, { recursive: true });
if (updateGolden) {
  mkdirSync(GOLDEN_DIR, { recursive: true });
}

for (const [name, schema] of Object.entries(CONTRACT_SCHEMAS)) {
  const jsonSchema = z.toJSONSchema(schema);
  const serialized = `${JSON.stringify(jsonSchema, null, 2)}\n`;
  writeFileSync(join(DIST_DIR, `${name}.json`), serialized);
  if (updateGolden) {
    writeFileSync(join(GOLDEN_DIR, `${name}.json`), serialized);
  }
  console.log(`exported ${name}${updateGolden ? " (+ golden)" : ""}`);
}

const count = Object.keys(CONTRACT_SCHEMAS).length;
console.log(`\n${count} schema${count === 1 ? "" : "s"} exported to ${DIST_DIR}`);
if (updateGolden) {
  console.log(`goldens updated in ${GOLDEN_DIR}`);
} else {
  console.log("goldens NOT touched (pass --update-golden to rewrite them intentionally)");
}
