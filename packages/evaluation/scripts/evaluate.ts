/**
 * The W403 cross-run evaluation CLI.
 *
 * Runs the frozen fixture in N separate bun subprocesses (default 2),
 * compares every run pair AND the first run against the checked-in golden
 * baseline through the field-classified comparator, and exits:
 *
 * - `0` — every comparison passed (comparable within the documented tolerance);
 * - `1` — at least one comparison failed (out-of-tolerance, unclassified
 *   field, or golden drift);
 * - `2` — harness error (bad arguments, failed subprocess, unreadable golden).
 *
 * Usage (from `packages/evaluation` or the repository root):
 *
 *   bun run evaluate [--runs N] [--fixture <path>] [--golden <path>|none] [--json]
 *
 * Output is deterministic (no clock reads, no timestamps) — the same
 * evaluation prints the same report.
 */
import { DEFAULT_FIXTURE_PATH } from "../src/fixture";
import {
  DEFAULT_GOLDEN_PATH,
  RUN_ONCE_SCRIPT,
  renderComparisonReport,
  runCrossRunEvaluation,
} from "../src/runner";

interface CliOptions {
  runs?: number;
  fixturePath?: string;
  goldenPath?: string | null;
  json?: boolean;
}

const USAGE = `usage: bun run evaluate [--runs N] [--fixture <path>] [--golden <path>|none] [--json]
  --runs N        number of subprocess runs (default 2; minimum 2)
  --fixture path  frozen fixture path (default ${DEFAULT_FIXTURE_PATH})
  --golden path   golden baseline path, or "none" to skip (default ${DEFAULT_GOLDEN_PATH})
  --json          print the machine-readable EvaluationReport as JSON`;

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case "--runs": {
        const value = argv[i + 1];
        const runs = value === undefined ? Number.NaN : Number.parseInt(value, 10);
        if (Number.isNaN(runs) || runs < 2) {
          process.stderr.write(`evaluate: --runs requires an integer >= 2 (got "${value}")\n`);
          process.exit(2);
        }
        options.runs = runs;
        i += 1;
        break;
      }
      case "--fixture": {
        const value = argv[i + 1];
        if (value === undefined) {
          process.stderr.write("evaluate: --fixture requires a path argument\n");
          process.exit(2);
        }
        options.fixturePath = value;
        i += 1;
        break;
      }
      case "--golden": {
        const value = argv[i + 1];
        if (value === undefined) {
          process.stderr.write('evaluate: --golden requires a path argument or "none"\n');
          process.exit(2);
        }
        options.goldenPath = value === "none" ? null : value;
        i += 1;
        break;
      }
      case "--json": {
        options.json = true;
        break;
      }
      case "--help":
      case "-h": {
        process.stdout.write(`${USAGE}\n`);
        process.exit(0);
        break;
      }
      default: {
        process.stderr.write(`evaluate: unknown argument "${arg}"\n\n${USAGE}\n`);
        process.exit(2);
      }
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const report = runCrossRunEvaluation({
  ...(options.runs !== undefined ? { runs: options.runs } : {}),
  ...(options.fixturePath !== undefined ? { fixturePath: options.fixturePath } : {}),
  ...(options.goldenPath !== undefined ? { goldenPath: options.goldenPath } : {}),
});

if (options.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(
    `w403 evaluation — subprocess entry: ${RUN_ONCE_SCRIPT}\n` +
      `runs completed: ${report.runsCompleted} / ${report.runs.length}\n`,
  );
  for (const outcome of report.pairwise) {
    process.stdout.write(`${renderComparisonReport(outcome)}\n`);
  }
  if (report.golden !== null) {
    process.stdout.write(`${renderComparisonReport(report.golden)}\n`);
  } else {
    process.stdout.write("golden comparison: SKIPPED (disabled)\n");
  }
  if (report.failureReasons.length > 0) {
    process.stdout.write("FAILURE REASONS:\n");
    for (const reason of report.failureReasons) {
      process.stdout.write(`  - ${reason}\n`);
    }
  }
  process.stdout.write(
    `VERDICT: ${report.passed ? "COMPARABLE — fixed fixture, documented tolerance" : "NOT COMPARABLE"}\n`,
  );
}

process.exit(report.passed ? 0 : 1);
