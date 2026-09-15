/**
 * The W306 subprocess entry: runs the benchmark ONCE and writes the
 * canonical report bytes to stdout (plus the human summary to stderr) — so a
 * parent process's capture is exactly the report (the W801 `run-once.ts`
 * precedent). A crash propagates as a non-zero exit with the typed error on
 * stderr; a successful run always exits 0.
 *
 * Usage: bun run scripts/run-once.ts
 */
import { runLatencyBenchmark, serializeLatencyReport } from "../src/index";

const run = await runLatencyBenchmark();
process.stderr.write(`${run.summary}\n`);
process.stdout.write(serializeLatencyReport(run.report));
