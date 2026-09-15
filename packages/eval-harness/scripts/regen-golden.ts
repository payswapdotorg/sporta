/**
 * The W801 suite-report golden regeneration CLI — an EXPLICIT, reviewed act,
 * never part of any test or evaluation run (the W403 `regen-golden`
 * discipline).
 *
 * REGENERATION REQUIRES TECH-LEAD REVIEW (see README §"Golden discipline"):
 * the golden report is the acceptance baseline for the whole suite; rewriting
 * it without review would let a nondeterminism regression (or an evaluator
 * change that silently moved a measured value) pass undetected.
 *
 * What this script does:
 *
 * 1. requires `--confirm` (without it: prints instructions, writes nothing);
 * 2. runs the suite ONCE in a subprocess (exactly the bytes the CLI and the
 *    tests compare);
 * 3. writes the canonical report to the golden path, then formats the FILE
 *    with the repo's Prettier (for the repo format check; comparisons always
 *    use the canonical form, so the cosmetic formatting is lossless);
 * 4. VERIFIES the written golden: re-parses it, re-serializes it, and asserts
 *    it reproduces the canonical bytes EXACTLY (Prettier losslessness proof);
 * 5. verifies self-consistency: a SECOND subprocess run and an IN-PROCESS
 *    run must both reproduce the same canonical bytes (a golden that cannot
 *    be reproduced is never committed);
 * 6. prints the old → new suite-config sha256 (a change means the SUITE
 *    CONFIG changed — that must be a separate, conscious, reviewed change).
 *
 * Usage: bun run regen-golden [--suite <path>] [--golden <path>] --confirm
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { serializeArtifact } from "@sporta/evaluation";
import {
  DEFAULT_SUITE_PATH,
  loadSuiteConfig,
  runSuite,
  serializeSuiteReport,
} from "../src/index";

/** The subprocess entry (package-relative). */
const RUN_ONCE_SCRIPT = `${import.meta.dir}/run-once.ts`;

/** The default checked-in golden report (package-relative). */
const DEFAULT_GOLDEN_PATH = `${import.meta.dir}/../fixtures/golden/suite-report-golden.json`;

/** The repository root (Prettier resolves its config from the file's path). */
const REPO_ROOT = `${import.meta.dir}/../../../`;

interface CliOptions {
  confirm?: boolean;
  suitePath?: string;
  goldenPath?: string;
}

const USAGE = `usage: bun run regen-golden --confirm [--suite <path>] [--golden <path>]
  --confirm    REQUIRED: acknowledge tech-lead review of the regeneration
  --suite path suite config path (default ${DEFAULT_SUITE_PATH})
  --golden path golden report output path (default ${DEFAULT_GOLDEN_PATH})

Regenerating the golden report requires tech-lead review (README §"Golden discipline").
The suite config itself is NEVER regenerated here — only the report golden is.`;

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--confirm") {
      options.confirm = true;
    } else if (arg === "--suite") {
      const value = argv[i + 1];
      if (value === undefined) {
        process.stderr.write("regen-golden: --suite requires a path argument\n");
        process.exit(2);
      }
      options.suitePath = value;
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

/** Runs the suite once in a bun subprocess and returns its canonical stdout. */
function subprocessCanonical(suitePath: string): string {
  const run = spawnSync(process.execPath, [RUN_ONCE_SCRIPT, "--suite", suitePath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) {
    process.stderr.write(
      `regen-golden: the subprocess suite run failed (exit ${run.status}):\n${run.stderr}\n`,
    );
    process.exit(2);
  }
  return run.stdout ?? "";
}

const options = parseArgs(process.argv.slice(2));
const suitePath = options.suitePath ?? DEFAULT_SUITE_PATH;
const goldenPath = options.goldenPath ?? DEFAULT_GOLDEN_PATH;

if (!options.confirm) {
  process.stderr.write(
    "regen-golden: REFUSING to write without --confirm.\n\n" +
      "The golden report is the acceptance baseline for the whole suite. Regenerating it\n" +
      "requires TECH-LEAD REVIEW of the underlying change (README §\"Golden discipline\"): a diff\n" +
      "of the old and new reports must be reviewed, and the suite-config sha256 must be\n" +
      "unchanged unless the suite config itself was consciously changed in a separate,\n" +
      "reviewed commit.\n\n" +
      "Re-run with --confirm once the change is reviewed.\n",
  );
  process.exit(1);
}

// Step 1: one subprocess run — exactly the bytes the CLI and tests compare.
const canonical = subprocessCanonical(suitePath);
const parsed = JSON.parse(canonical) as {
  suite?: { suiteConfigSha256?: string; suiteId?: string };
};

// Step 2: the old golden's suite-config hash (a change = the CONFIG changed).
let oldSha: string | null = null;
try {
  const old = JSON.parse(readFileSync(goldenPath, "utf8")) as {
    suite?: { suiteConfigSha256?: string };
  };
  if (typeof old.suite?.suiteConfigSha256 === "string") {
    oldSha = old.suite.suiteConfigSha256;
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

// Step 5: self-consistency — a second independent subprocess run AND an
// in-process run must reproduce the same canonical bytes.
const second = subprocessCanonical(suitePath);
if (second !== canonical) {
  process.stderr.write(
    "regen-golden: SELF-CONSISTENCY FAILURE — a second subprocess suite run produced\n" +
      "different canonical bytes. The golden file has been left in its raw canonical form;\n" +
      "the suite is nondeterministic and must be fixed before any golden is committed.\n",
  );
  writeFileSync(goldenPath, canonical);
  process.exit(2);
}
const inProcess = serializeSuiteReport(runSuite(loadSuiteConfig(suitePath)));
if (inProcess !== canonical) {
  process.stderr.write(
    "regen-golden: the in-process suite run differs from the subprocess run —\n" +
      "determinism is broken; refusing to commit this golden.\n",
  );
  writeFileSync(goldenPath, canonical);
  process.exit(2);
}

process.stdout.write(
  `regen-golden: wrote ${goldenPath}\n` +
    `  suite:        ${suitePath}\n` +
    `  suiteId:      ${parsed.suite?.suiteId ?? "<missing>"}\n` +
    `  suiteConfigSha256: ${parsed.suite?.suiteConfigSha256 ?? "<missing>"}\n` +
    (oldSha === null
      ? "  (first generation — no previous golden)\n"
      : `  previous suiteConfigSha256: ${oldSha}\n` +
        `  ${
          oldSha === parsed.suite?.suiteConfigSha256
            ? "suite config UNCHANGED"
            : "SUITE CONFIG CHANGED — this must be a separate, reviewed change"
        }\n`) +
    `  bytes (canonical): ${canonical.length}\n` +
    "  Prettier losslessness + subprocess/in-process self-consistency: VERIFIED\n\n" +
    "  REMINDER: golden regeneration requires tech-lead review (README §\"Golden discipline\").\n",
);
