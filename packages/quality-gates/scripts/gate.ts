/**
 * The W803 release gate CLI: runs the release evaluation over the REAL
 * fixtures (the W503 clean clip + all three W605 fixtures, through the
 * real seams), writes the deterministic machine-readable report to
 * `reports/release-readiness-report.json` (canonical bytes — the same
 * input yields byte-identical output), prints the per-gate human summary,
 * the verdict, and the literal marker line `SPORTA-RELEASE-GATE
 * <verdict>`, plus the report's SHA-256 (stable across invocations).
 *
 * Usage: bun run gate   (from packages/quality-gates)
 *
 * Exit codes (GATES.md §6): 0 = PASS · 1 = PENDING-HUMAN-REVIEW ·
 * 2 = FAIL. A PENDING or FAIL exit is the gate biting, not a crash.
 *
 * The human review record used is the checked-in automated pipeline
 * self-check record (fixtures/human-review-self-check.json) — the demo
 * run's honest record, clearly NOT a claim that a human reviewed
 * production output (docs/REVIEW.md §5, GATES.md §7).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  RELEASE_REPORT_SCHEMA_TAG,
  buildCanonicalReleaseInput,
  canonicalReportBytes,
  evaluateReleaseReadiness,
} from "../src/index";

/** Package root: `import.meta.dir` is `<pkg>/scripts`, so one dirname up. */
const PACKAGE_ROOT = dirname(import.meta.dir);

/** The checked-in self-check record (the demo run's honest review record). */
const RECORD_PATH = join(PACKAGE_ROOT, "fixtures", "human-review-self-check.json");

/** Where the deterministic report is written (git-ignored; canonical bytes). */
const REPORT_PATH = join(PACKAGE_ROOT, "reports", "release-readiness-report.json");

/** Exit codes by verdict (GATES.md §6). */
const EXIT_CODES: Record<string, number> = {
  PASS: 0,
  "PENDING-HUMAN-REVIEW": 1,
  FAIL: 2,
};

const record: unknown = JSON.parse(readFileSync(RECORD_PATH, "utf8"));
const input = buildCanonicalReleaseInput(record);
const report = evaluateReleaseReadiness(input);
const bytes = canonicalReportBytes(report);
const sha256 = createHash("sha256").update(bytes, "utf8").digest("hex");

mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, bytes, "utf8");

console.log(
  `W803 release readiness — policy ${report.policyId} · report ${RELEASE_REPORT_SCHEMA_TAG}`,
);
console.log(
  `input: 1 temporal fixture + ${input.scene?.length ?? 0} scene fixtures (the real W503/W605 fixtures) · human record ${report.humanReview.recordKind ?? "absent"}`,
);
for (const gate of report.gates) {
  const role = gate.blocking ? "blocking" : "advisory";
  console.log(`  [${gate.verdict}] ${gate.gateId} (${role}, ${gate.sourcePackage})`);
  for (const run of gate.runs ?? []) {
    console.log(
      `         ${run.fixture}: ${run.checks.length} checks, ${run.failingChecks.length} failing (${run.reportSchemaTag}, source verdict ${run.sourceVerdictPass ? "PASS" : "FAIL"})`,
    );
    for (const check of run.failingChecks) {
      console.log(
        `           FAIL ${check.metric} = ${check.measured} (threshold ${check.operator === "max" ? "<=" : ">="} ${check.threshold})`,
      );
    }
  }
  if (gate.reason !== null) {
    console.log(`         reason [${gate.reason.code}]: ${gate.reason.message}`);
  }
}
console.log(
  `accounting: ${report.accounting.totalGates} gates = ${report.accounting.counts.pass} pass + ${report.accounting.counts.fail} fail + ${report.accounting.counts.notRunnable} not-runnable (rows ${report.accounting.rowCount}, reconciles ${report.accounting.reconciles})`,
);
console.log(`overall verdict: ${report.verdict}`);
console.log(`SPORTA-RELEASE-GATE ${report.verdict}`);
console.log(`SPORTA-RELEASE-GATE-REPORT-SHA256 ${sha256}`);
console.log(`report written: reports/release-readiness-report.json (${bytes.length} bytes)`);

process.exit(EXIT_CODES[report.verdict] ?? 2);
