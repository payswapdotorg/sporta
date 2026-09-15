/**
 * The W801 subprocess entry: runs the suite ONCE and writes the canonical
 * report bytes to stdout — nothing else, so a parent process's capture is
 * exactly the report (the W403 `run-once.ts` precedent).
 *
 * Any failure (config, harness, evaluator crash) propagates as a non-zero
 * exit; bun prints the error to stderr. A FAILING VERDICT is not an error of
 * the run itself — it still exits 0 and prints the canonical report (the
 * verdict is data; callers decide exit codes).
 *
 * Usage: bun run scripts/run-once.ts [--suite <path>]
 */
import { loadSuiteConfig, runSuite, serializeSuiteReport } from "../src/index";

interface CliOptions {
  suite?: string;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--suite") {
      const value = argv[i + 1];
      if (value === undefined) {
        process.stderr.write("run-once: --suite requires a path argument\n");
        process.exit(2);
      }
      options.suite = value;
      i += 1;
    } else {
      process.stderr.write(`run-once: unknown argument "${arg}"\n`);
      process.exit(2);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const loaded = loadSuiteConfig(options.suite);
const report = runSuite(loaded);
process.stdout.write(serializeSuiteReport(report));
