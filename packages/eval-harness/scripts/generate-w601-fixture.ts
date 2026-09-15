/**
 * The W601 scene-fixture generator (an EXPLICIT, reviewed act — the W403
 * fixture discipline: the checked-in fixture is frozen input, regenerated
 * only through this script with `--confirm`).
 *
 * Writes `fixtures/w601-scene-fixture.json` from the in-code fixture builder
 * (`src/w601-fixture.ts`, the W601 golden-fixture construction):
 *
 * 1. requires `--confirm` (without it: prints instructions, writes nothing);
 * 2. builds the fixture deterministically (real engine, injected clock);
 * 3. writes the canonical serialization, then Prettier-formats the file (the
 *    repo's format check; comparisons always use the canonical form, so the
 *    cosmetic formatting is lossless — proven by the next step);
 * 4. VERIFIES the written file: re-parsing + re-serializing reproduces the
 *    canonical bytes exactly, and a SECOND build reproduces the same bytes
 *    (a fixture that cannot be reproduced is never committed).
 *
 * Usage: bun run regen-w601-fixture [--out <path>] --confirm
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { serializeArtifact } from "@sporta/evaluation";
import { buildW601SceneFixture, W601_FIXTURE_SESSION } from "../src/w601-fixture";
import { W601_SCENE_FIXTURE_KIND } from "../src/cases/w601";

/** The repository root (Prettier resolves its config from the file's path). */
const REPO_ROOT = `${import.meta.dir}/../../../`;

const DEFAULT_OUT_PATH = `${import.meta.dir}/../fixtures/w601-scene-fixture.json`;

interface CliOptions {
  confirm?: boolean;
  outPath?: string;
}

const USAGE = `usage: bun run regen-w601-fixture --confirm [--out <path>]
  --confirm    REQUIRED: acknowledge tech-lead review of the regeneration
  --out path   fixture output path (default ${DEFAULT_OUT_PATH})

The scene fixture is the W601 case's checked-in input; regenerating it is a
conscious, reviewed act (a change invalidates the suite report golden).`;

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--confirm") {
      options.confirm = true;
    } else if (arg === "--out") {
      const value = argv[i + 1];
      if (value === undefined) {
        process.stderr.write("regen-w601-fixture: --out requires a path argument\n");
        process.exit(2);
      }
      options.outPath = value;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else {
      process.stderr.write(`regen-w601-fixture: unknown argument "${arg}"\n\n${USAGE}\n`);
      process.exit(2);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const outPath = options.outPath ?? DEFAULT_OUT_PATH;

if (!options.confirm) {
  process.stderr.write(
    "regen-w601-fixture: REFUSING to write without --confirm.\n\n" +
      "The scene fixture is the W601 suite case's checked-in input (frozen input discipline).\n" +
      "Regenerating it requires TECH-LEAD REVIEW, and it invalidates the suite report golden\n" +
      "(regenerate that too, with its own review).\n\n" +
      "Re-run with --confirm once the change is reviewed.\n",
  );
  process.exit(1);
}

// Step 1: build deterministically.
const fixture = buildW601SceneFixture();
const canonical = serializeArtifact({
  fixtureKind: W601_SCENE_FIXTURE_KIND,
  sessionId: W601_FIXTURE_SESSION,
  snapshot: fixture.snapshot,
  events: fixture.events,
  cameraSlotIds: fixture.cameraSlotIds,
});

// Step 2: write the canonical bytes, then Prettier-format the file.
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, canonical);
const format = spawnSync("bunx", ["prettier", "--write", outPath], {
  cwd: REPO_ROOT,
  encoding: "utf8",
});
if (format.status !== 0) {
  process.stderr.write(
    `regen-w601-fixture: Prettier formatting failed (exit ${format.status}):\n${format.stderr}\n` +
      "The fixture file still contains the raw canonical bytes; fix formatting manually.\n",
  );
  process.exit(2);
}

// Step 3: Prettier losslessness proof — the formatted file must re-serialize
// to EXACTLY the canonical bytes.
const written = readFileSync(outPath, "utf8");
const recanonicalized = serializeArtifact(JSON.parse(written));
if (recanonicalized !== canonical) {
  process.stderr.write(
    "regen-w601-fixture: Prettier formatting was NOT lossless — re-serializing the formatted\n" +
      "fixture does not reproduce the canonical bytes. The file has been left in its raw\n" +
      "canonical form; investigate before committing.\n",
  );
  writeFileSync(outPath, canonical);
  process.exit(2);
}

// Step 4: reproducibility — a second deterministic build must produce the
// same canonical bytes (a non-reproducible fixture is never committed).
const secondFixture = buildW601SceneFixture();
const second = serializeArtifact({
  fixtureKind: W601_SCENE_FIXTURE_KIND,
  sessionId: W601_FIXTURE_SESSION,
  snapshot: secondFixture.snapshot,
  events: secondFixture.events,
  cameraSlotIds: secondFixture.cameraSlotIds,
});
if (second !== canonical) {
  process.stderr.write(
    "regen-w601-fixture: SELF-CONSISTENCY FAILURE — a second fixture build produced different\n" +
      "canonical bytes. The fixture builder is nondeterministic and must be fixed first.\n",
  );
  writeFileSync(outPath, canonical);
  process.exit(2);
}

process.stdout.write(
  `regen-w601-fixture: wrote ${outPath}\n` +
    `  bytes (canonical): ${canonical.length}\n` +
    "  Prettier losslessness + build reproducibility: VERIFIED\n\n" +
    "  REMINDER: a fixture change invalidates the suite report golden (regen-golden, with review).\n",
);
