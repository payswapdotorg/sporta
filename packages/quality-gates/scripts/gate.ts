/**
 * The W803 release-gate CLI: runs the release evaluation over the
 * fixture-based demo inputs (the REAL fixtures of the two evaluation
 * packages + the checked-in human-review record), writes the
 * deterministic canonical JSON report, prints every gate's verdict and
 * the accounting, and prints the literal marker line
 * `SPORTA-RELEASE-GATE <verdict>`.
 *
 * usage: bun run gate [--report <path>]
 *
 * - default report path: dist/release-report.json (package-relative, gitignored — the repo convention for generated artifacts)
 * - exit codes: 0 = PASS · 1 = FAIL · 2 = PENDING-HUMAN-REVIEW · 3 = usage
 *
 * The stdout and the report file are pure functions of the checked-in
 * fixtures and record: two invocations are byte-identical (pinned by
 * `test/determinism.test.ts` with compared SHA-256 hashes).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  REPORT_SCHEMA_TAG,
  buildDefaultReleaseInputs,
  canonicalJsonStringify,
  evaluateReleaseReadiness,
} from "../src/index";

const USAGE = `usage: bun run gate [--report <path>]
  --report path   write the canonical machine-readable report to this path
                  (default: dist/release-report.json)`;

/** The package root (scripts/ is one level down). */
const PACKAGE_ROOT = join(import.meta.dir, "..");

/** The checked-in human-review record path (the fixture-demo self-check). */
const RECORD_PATH = join(PACKAGE_ROOT, "fixtures", "human-review", "self-check-record.json");

interface CliOptions {
  readonly reportPath: string;
}

/** Parses the arguments (fail-loud on unknown flags — never a silent default for a typo). */
function parseArgs(argv: readonly string[]): CliOptions {
  let reportPath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--report") {
      index += 1;
      const value = argv[index];
      if (value === undefined || value === "") {
        process.stderr.write("gate: --report requires a path argument\n");
        process.exit(3);
      }
      reportPath = value;
    } else {
      process.stderr.write(`gate: unknown argument "${arg}"\n${USAGE}\n`);
      process.exit(3);
    }
  }
  return { reportPath: reportPath ?? join(PACKAGE_ROOT, "dist", "release-report.json") };
}

const options = parseArgs(process.argv.slice(2));

// --- the inputs: the real fixtures + the checked-in review record ---------
const humanReview: unknown = JSON.parse(readFileSync(RECORD_PATH, "utf8"));
const input = buildDefaultReleaseInputs({ humanReview });
const report = evaluateReleaseReadiness(input);
const canonical = canonicalJsonStringify(report);
const sha256 = createHash("sha256").update(canonical, "utf8").digest("hex");

mkdirSync(dirname(options.reportPath), { recursive: true });
writeFileSync(options.reportPath, canonical, "utf8");

// --- the human-readable summary (deterministic; same input → same stdout) --
console.log(`== @sporta/quality-gates — release readiness (${REPORT_SCHEMA_TAG}) ==`);
console.log(`  gate policy: ${report.gatePolicy.policyId} · ${report.gatePolicy.gateCount} gates`);
for (const gate of report.gates) {
  console.log(`  [${gate.verdict}] ${gate.gateId} (${gate.sourcePackage})`);
  console.log(`          ${gate.reason}`);
}
const human = report.humanReview;
console.log(
  `  human review: ${human.status}` +
    (human.record === undefined
      ? ""
      : ` — recordKind ${human.record.recordKind}, reviewer ${human.record.reviewer}, reviewedAt ${human.record.reviewedAt}, humanAttested ${human.humanAttested}`),
);
if (human.issues.length > 0) {
  for (const issue of human.issues) {
    console.log(`          issue ${issue.path}: ${issue.code} — ${issue.message}`);
  }
}
console.log(
  `  accounting: ${report.accounting.totalGates} gates = ${report.accounting.pass} pass + ${report.accounting.fail} fail + ${report.accounting.notRunnable} not-runnable (reconciles: ${report.accounting.reconciles})`,
);
console.log(`  report: ${options.reportPath} (sha256 ${sha256})`);
console.log(`  verdict: ${report.verdict.overall} — ${report.verdict.reason}`);
console.log(`SPORTA-RELEASE-GATE ${report.verdict.overall}`);

process.exit(report.verdict.overall === "PASS" ? 0 : report.verdict.overall === "FAIL" ? 1 : 2);
