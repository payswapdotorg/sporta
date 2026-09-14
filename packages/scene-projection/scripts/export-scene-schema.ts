/**
 * Exports the scene specification schema to JSON Schema (draft 2020-12) using
 * zod v4's `z.toJSONSchema` — the W002 export precedent applied to the scene
 * schema owned by THIS package.
 *
 * Usage (from `packages/scene-projection`):
 *
 * - `bun run export-schemas` — writes `dist/schemas/scene-specification.json`
 *   (gitignored build output, e.g. for external tooling).
 * - `bun run export-schemas --update-golden` — ALSO rewrites
 *   `fixtures/schemas-golden/scene-specification.json`, the committed
 *   compatibility golden.
 *
 * Regenerating the golden is an intentional act: it must accompany a reviewed
 * scene-schema change (bump SCENE_SCHEMA_MINOR for additive, SCHEMA_SCHEMA_MAJOR
 * for breaking — see CONTRACT.md, "Versioning and compatibility policy").
 * Like every JSON-Schema export, the golden is STRUCTURAL: runtime-only
 * refinements (e.g. `SceneBounds`'s xMax >= xMin) are not visible in it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { SceneSpecification } from "../src/schema";

const DIST_DIR = join(import.meta.dir, "..", "dist", "schemas");
const GOLDEN_DIR = join(import.meta.dir, "..", "fixtures", "schemas-golden");
const updateGolden = process.argv.slice(2).includes("--update-golden");

mkdirSync(DIST_DIR, { recursive: true });
if (updateGolden) {
  mkdirSync(GOLDEN_DIR, { recursive: true });
}

const jsonSchema = z.toJSONSchema(SceneSpecification);
const serialized = `${JSON.stringify(jsonSchema, null, 2)}\n`;
writeFileSync(join(DIST_DIR, "scene-specification.json"), serialized);
if (updateGolden) {
  writeFileSync(join(GOLDEN_DIR, "scene-specification.json"), serialized);
}
console.log(`exported scene-specification${updateGolden ? " (+ golden)" : ""}`);
console.log(`written to ${DIST_DIR}`);
if (updateGolden) {
  console.log(`golden updated in ${GOLDEN_DIR}`);
} else {
  console.log("golden NOT touched (pass --update-golden to rewrite it intentionally)");
}
