/**
 * The subprocess entry the cross-run runner spawns (W403).
 *
 * Runs the evaluation pipeline over the frozen fixture ONCE and writes the
 * canonical artifact bytes to stdout — nothing else, so the parent process's
 * capture is exactly the artifact. Any failure propagates as a non-zero exit
 * (bun prints the error to stderr); the parent fails loud on it.
 *
 * Usage: bun run scripts/run-once.ts [--fixture <path>]
 */
import { runFixtureEvaluation } from "../src/index";

interface CliOptions {
  fixture?: string;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--fixture") {
      const value = argv[i + 1];
      if (value === undefined) {
        process.stderr.write("run-once: --fixture requires a path argument\n");
        process.exit(2);
      }
      options.fixture = value;
      i += 1;
    } else {
      process.stderr.write(`run-once: unknown argument "${arg}"\n`);
      process.exit(2);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const { canonical } = runFixtureEvaluation(options.fixture);
process.stdout.write(canonical);
