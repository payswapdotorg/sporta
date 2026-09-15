/**
 * The W802 CLI: evaluates latency SLO compliance over one W306 benchmark
 * report FILE and writes the machine-readable compliance report to stdout
 * (plus the human summary to stderr) — the W306 `run-once.ts` convention.
 *
 * Usage: bun run scripts/evaluate.ts <path-to-latency-report.json>
 *
 * Exit codes: 0 = compliant (every SLO met, no alerts) · 1 = at-risk (every
 * SLO met, ≥1 warning) · 2 = breached (≥1 objective or the loss invariant
 * failed) · 3 = usage/parse error (fail-loud, message on stderr).
 *
 * The input is a `sporta/latency-benchmark/report@1` document (the
 * benchmark's canonical bytes — `bun run benchmark` in that package emits
 * exactly that); the CLI projects it onto the SLO input schema (strict,
 * versioned, validated) and evaluates. A document from any other domain
 * fails loud, never partially accepted.
 */
import { readFileSync } from "node:fs";
import {
  evaluateSloCompliance,
  parseLatencySloInput,
  projectBenchmarkReport,
  renderComplianceSummary,
  type LatencyBenchmarkReportSubset,
} from "../src/index";

const EXIT_CODES = { compliant: 0, atRisk: 1, breached: 2, usage: 3 } as const;

function failUsage(message: string): never {
  process.stderr.write(`slo-evaluate: ${message}\n`);
  process.stderr.write("usage: bun run scripts/evaluate.ts <path-to-latency-report.json>\n");
  process.exit(EXIT_CODES.usage);
}

if (process.argv.length !== 3) {
  failUsage(
    `expected exactly one argument (the report path), got ${String(process.argv.length - 2)}`,
  );
}
const reportPath = process.argv[2]!;

let raw: string;
try {
  raw = readFileSync(reportPath, "utf8");
} catch (error) {
  failUsage(`cannot read the report file "${reportPath}": ${(error as Error).message}`);
}

let document: unknown;
try {
  document = JSON.parse(raw);
} catch (error) {
  failUsage(`the report file is not valid JSON: ${(error as Error).message}`);
}

let compliance;
try {
  // Project + VALIDATE (fail-loud on any shape/domain drift) + evaluate.
  const projected = projectBenchmarkReport(document as LatencyBenchmarkReportSubset);
  compliance = evaluateSloCompliance(parseLatencySloInput(projected));
} catch (error) {
  failUsage(`the document is not a valid latency report / SLO input: ${(error as Error).message}`);
}

process.stderr.write(`${renderComplianceSummary(compliance)}\n`);
process.stdout.write(`${JSON.stringify(compliance, null, 2)}\n`);
process.exit(
  compliance.summary.verdict === "compliant"
    ? EXIT_CODES.compliant
    : compliance.summary.verdict === "at-risk"
      ? EXIT_CODES.atRisk
      : EXIT_CODES.breached,
);
