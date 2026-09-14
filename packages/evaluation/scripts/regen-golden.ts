/**
 * The W403 golden regeneration CLI — an EXPLICIT, reviewed act, never part of
 * any test or evaluation run.
 *
 * REGENERATION REQUIRES TECH-LEAD REVIEW (see TOLERANCE.md §6): the golden is
 * the acceptance baseline for world-model comparability; rewriting it without
 * review would let a nondeterminism regression pass silently.
 *
 * What this script does:
 *
 * 1. requires `--confirm` (without it: prints instructions, writes nothing);
 * 2. runs the pipeline ONCE in a subprocess (exactly what the evaluator sees);
 * 3. writes the canonical artifact to the golden path, then formats the FILE
 *    with the repo's Prettier (for the repo format check; comparisons always
 *    use the canonical form, so the cosmetic formatting is lossless);
 * 4. VERIFIES the written golden: re-parses it, re-serializes it, and asserts
 *    it reproduces the canonical bytes EXACTLY (Prettier losslessness proof);
 * 5. verifies self-consistency: a SECOND subprocess run must reproduce the
 *    same canonical bytes (a golden that cannot be reproduced is never
 *    committed);
 * 6. prints the old → new fixtureSha256 (a change means the FIXTURE bytes
 *    changed — that must be a separate, conscious, reviewed change).
 *
 * Usage: bun run regen-golden [--fixture <path>] [--golden <path>] --confirm
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_FIXTURE_PATH } from "../src/fixture";
import { DEFAULT_GOLDEN_PATH, RUN_ONCE_SCRIPT } from "../src/runner";
import { runFixtureEvaluation, serializeArtifact } from "../src/index";

/** The repository root (Prettier resolves its config from the file's path). */
const REPO_ROOT = `${import.meta.dir}/../../../`;

interface CliOptions {
  confirm?: boolean;
  fixturePath?: string;
  goldenPath?: string;
}

const USAGE = `usage: bun run regen-golden --confirm [--fixture <path>] [--golden <path>]
  --confirm       REQUIRED: acknowledge tech-lead review of the regeneration
  --fixture path  frozen fixture path (default ${DEFAULT_FIXTURE_PATH})
  --golden path   golden output path (default ${DEFAULT_GOLDEN_PATH})

Regenerating the golden requires tech-lead review (TOLERANCE.md §6).
The fixture itself is NEVER regenerated — only the golden artifact is.`;

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--confirm") {
      options.confirm = true;
    } else if (arg === "--fixture") {
      const value = argv[i + 1];
      if (value === undefined) {
        process.stderr.write("regen-golden: --fixture requires a path argument\n");
        process.exit(2);
      }
      options.fixturePath = value;
      i += 1;
    } else if (arg === "--golden") {
      const value = argv[i + 1];
      if (value === undefined) {
        process.stderr.write("regen-golden: --golden requires a path argument\n");
        process.exit(2);
      }
      options.goldenPath = value;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else {
      process.stderr.write(`regen-golden: unknown argument "${arg}"\n\n${USAGE}\n`);
      process.exit(2);
    }
  }
  return options;
}

/** Runs the pipeline once in a subprocess and returns its canonical stdout. */
function subprocessCanonical(fixturePath: string): string {
  const run = spawnSync(process.execPath, [RUN_ONCE_SCRIPT, "--fixture", fixturePath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) {
    process.stderr.write(
      `regen-golden: the subprocess run failed (exit ${run.status}):\n${run.stderr}\n`,
    );
    process.exit(2);
  }
  return run.stdout ?? "";
}

const options = parseArgs(process.argv.slice(2));
const fixturePath = options.fixturePath ?? DEFAULT_FIXTURE_PATH;
const goldenPath = options.goldenPath ?? DEFAULT_GOLDEN_PATH;

if (!options.confirm) {
  process.stderr.write(
    "regen-golden: REFUSING to write without --confirm.\n\n" +
      "The golden baseline is the acceptance evidence for W403 comparability. Regenerating it\n" +
      "requires TECH-LEAD REVIEW of the underlying change (TOLERANCE.md §6): a diff of the old\n" +
      "and new artifacts must be reviewed, and the fixture sha256 must be unchanged unless the\n" +
      "fixture itself was consciously changed in a separate, reviewed commit.\n\n" +
      "Re-run with --confirm once the change is reviewed.\n",
  );
  process.exit(1);
}

// Step 1: one subprocess run — exactly the bytes the evaluator compares.
const canonical = subprocessCanonical(fixturePath);
const parsed = JSON.parse(canonical) as { fixtureSha256?: string; fixtureId?: string };

// Step 2: the old golden's fixture hash (a change = the FIXTURE changed too).
let oldSha: string | null = null;
try {
  const old = JSON.parse(readFileSync(goldenPath, "utf8")) as { fixtureSha256?: string };
  if (typeof old.fixtureSha256 === "string") {
    oldSha = old.fixtureSha256;
  }
} catch {
  // No existing golden — first generation.
}

// Step 3: write the canonical bytes, then Prettier-format the file.
mkdirSync(dirname(goldenPath), { recursive: true });
writeFileSync(goldenPath, canonical);
const format = spawnSync("bunx", ["prettier", "--write", goldenPath], {
  cwd: REPO_ROOT,
  encoding: "utf8",
});
if (format.status !== 0) {
  process.stderr.write(
    `regen-golden: Prettier formatting failed (exit ${format.status}):\n${format.stderr}\n` +
      "The golden file still contains the raw canonical bytes; fix formatting manually.\n",
  );
  process.exit(2);
}

// Step 4: Prettier losslessness proof — the formatted file must re-serialize
// to EXACTLY the canonical bytes.
const written = readFileSync(goldenPath, "utf8");
const recanonicalized = serializeArtifact(JSON.parse(written));
if (recanonicalized !== canonical) {
  process.stderr.write(
    "regen-golden: Prettier formatting was NOT lossless — re-serializing the formatted\n" +
      "golden does not reproduce the canonical bytes. The golden file has been left in its\n" +
      "raw canonical form; investigate before committing.\n",
  );
  writeFileSync(goldenPath, canonical);
  process.exit(2);
}

// Step 5: self-consistency — a second independent subprocess run must
// reproduce the same canonical bytes (a non-reproducible golden is never
// committed).
const second = subprocessCanonical(fixturePath);
if (second !== canonical) {
  process.stderr.write(
    "regen-golden: SELF-CONSISTENCY FAILURE — a second subprocess run produced different\n" +
      "canonical bytes. The golden file has been left in its raw canonical form; the\n" +
      "pipeline is nondeterministic and must be fixed before any golden is committed.\n",
  );
  writeFileSync(goldenPath, canonical);
  process.exit(2);
}

// Also verify in-process determinism (the same walk, same machine, no spawn).
const inProcess = runFixtureEvaluation(fixturePath);
if (inProcess.canonical !== canonical) {
  process.stderr.write(
    "regen-golden: the in-process pipeline run differs from the subprocess run —\n" +
      "determinism is broken (TOLERANCE.md §2); refusing to commit this golden.\n",
  );
  writeFileSync(goldenPath, canonical);
  process.exit(2);
}

process.stdout.write(
  `regen-golden: wrote ${goldenPath}\n` +
    `  fixture:      ${fixturePath}\n` +
    `  fixtureId:    ${parsed.fixtureId ?? "<missing>"}\n` +
    `  fixtureSha256: ${parsed.fixtureSha256 ?? "<missing>"}\n` +
    (oldSha === null
      ? "  (first generation — no previous golden)\n"
      : `  previous fixtureSha256: ${oldSha}\n` +
        `  ${oldSha === parsed.fixtureSha256 ? "fixture UNCHANGED" : "FIXTURE CHANGED — this must be a separate, reviewed change"}\n`) +
    `  bytes (canonical): ${canonical.length}\n` +
    "  Prettier losslessness + subprocess/in-process self-consistency: VERIFIED\n\n" +
    "  REMINDER: golden regeneration requires tech-lead review (TOLERANCE.md §6).\n",
);
