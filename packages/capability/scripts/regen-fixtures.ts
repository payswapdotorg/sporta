/**
 * Regenerates the W901 deny/degraded capability fixtures (deterministic).
 *
 * `bun run regen-fixtures` re-runs `buildCapabilityResponse` over the eight
 * canonical scenarios (./scenarios.ts) and writes the serialized responses
 * under `fixtures/v1/`. The scenarios are the brief's deny/degraded coverage
 * list: anonymous, authenticated-no-roles, rights-denied renderer,
 * quota-exhausted, provider-down, provider-degraded, live-unavailable
 * (Simulation F), and partial availability.
 *
 * Formatting follows the repo's regen-golden precedent
 * (`packages/evaluation/scripts/regen-golden.ts`): the canonical bytes are
 * written first, then the file is Prettier-formatted (the root
 * `format:check` gates machine-generated JSON too), and the formatting is
 * PROVEN LOSSLESS — re-serializing the formatted file must reproduce the
 * exact canonical bytes, or the script refuses to leave the formatted file
 * in place.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildCapabilityResponse } from "../src/service";
import { parseCapabilityResponse, serializeCapabilityResponse } from "../src/serialize";
import { FIXTURE_NAMES, FIXTURE_SCENARIOS } from "./scenarios";

/** Repository root (where `bunx prettier` resolves the shared config). */
const REPO_ROOT = `${import.meta.dir}/../../../`;

const OUT_DIR = join(import.meta.dir, "..", "fixtures", "v1");

mkdirSync(OUT_DIR, { recursive: true });

for (const name of FIXTURE_NAMES) {
  const input = FIXTURE_SCENARIOS[name]!;
  const response = buildCapabilityResponse(input);
  const canonical = `${serializeCapabilityResponse(response)}\n`;
  const path = join(OUT_DIR, `${name}.json`);

  // Step 1: write the canonical bytes (single line, fixed key order).
  writeFileSync(path, canonical);

  // Step 2: Prettier-format the file (the root format:check gates it).
  const format = spawnSync("bunx", ["prettier", "--write", path], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (format.status !== 0) {
    process.stderr.write(
      `regen-fixtures: Prettier formatting failed for ${name} (exit ${format.status}):\n` +
        `${format.stderr}\nThe fixture still contains the raw canonical bytes.\n`,
    );
    process.exit(2);
  }

  // Step 3: Losslessness proof — the formatted file must re-serialize to
  // EXACTLY the canonical bytes (formatting changed whitespace only).
  const written = readFileSync(path, "utf8");
  const recanonicalized = serializeCapabilityResponse(parseCapabilityResponse(written));
  if (`${recanonicalized}\n` !== canonical) {
    process.stderr.write(
      `regen-fixtures: Prettier formatting was NOT lossless for ${name} — re-serializing\n` +
        "the formatted fixture does not reproduce the canonical bytes. The fixture has been\n" +
        "left in its raw canonical form; investigate before committing.\n",
    );
    writeFileSync(path, canonical);
    process.exit(2);
  }

  console.log(
    `${name}.json: overall=${response.overall.state} renderers=${response.renderers.map((r) => `${r.rendererId}:${r.availability}`).join(", ")}`,
  );
}
console.log(`wrote ${FIXTURE_NAMES.length} fixtures to ${OUT_DIR}`);
