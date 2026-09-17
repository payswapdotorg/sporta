/**
 * One-shot TL regen of the scene golden (canonical serialization of the
 * golden fixture's projection). See CONTRACT.md "Goldens and regeneration
 * procedure" — this file is Prettier-formatted (lossless for JSON).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { serializeScene } from "../src/index";
import { buildGoldenScene } from "../test/helpers";

const out = join(import.meta.dir, "..", "fixtures", "golden", "scene-golden.json");
writeFileSync(out, serializeScene(buildGoldenScene()) + "\n");
console.log("scene golden regenerated (canonical bytes)");
