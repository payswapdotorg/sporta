/**
 * The W803 release gate CLI (`bun run gate`): runs the release evaluation
 * over the repo's real fixtures (the W503 clean clip + the three W605
 * fixtures) with the checked-in automated-pipeline self-check review
 * record, WRITES the deterministic canonical report to stdout (between
 * the SPORTA-RELEASE-REPORT-BEGIN/END markers — machine-extractable,
 * byte-stable across processes), prints a human-readable summary, and
 * ends with the literal verdict marker line:
 *
 *     SPORTA-RELEASE-GATE <verdict>
 *
 * The verdict is one of PASS / PENDING-HUMAN-REVIEW / FAIL. Exit codes:
 * 0 = PASS, 1 = FAIL, 2 = PENDING-HUMAN-REVIEW. The stdout is a pure
 * function of the checked-in fixtures and record: two runs emit
 * byte-identical bytes (pinned by test/subprocess.test.ts, SHA-256
 * compared).
 *
 * Honesty note (docs/GATES.md §boundaries): this demo run evaluates
 * FIXTURES, not production traffic, and the human-review record it uses
 * is the pipeline's own self-check record — it completes the record
 * format's contract and demonstrates the human gate's complete-record
 * path; it is NOT a claim that a human reviewed production output.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDemoReleaseInput,
  evaluateReleaseReadiness,
  serializeReleaseReport,
} from "../src/index";

/** The package root (scripts/ is one level down). */
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// The demo run: real fixtures + the checked-in self-check review record.
const recordPath = join(PACKAGE_ROOT, "fixtures", "human-review", "w803-fixture-self-check.json");
const record: unknown = JSON.parse(readFileSync(recordPath, "utf8"));
const report = evaluateReleaseReadiness(buildDemoReleaseInput(record));

// The deterministic canonical report (machine-extractable envelope).
console.log("SPORTA-RELEASE-REPORT-BEGIN");
process.stdout.write(serializeReleaseReport(report));
console.log("SPORTA-RELEASE-REPORT-END");

// The human-readable summary (deterministic — derived from the report).
console.log(
  `== sporta release gate (W803) — policy ${report.policy.version} — ${report.schemaTag} ==`,
);
console.log(
  `fixtures: temporal ${report.input.temporalFixtureCount} · scene ${report.input.sceneFixtureCount} · human review record ${report.input.humanReviewSupplied ? "supplied" : "ABSENT"}`,
);
for (const gate of report.gates) {
  const evaluations =
    gate.evaluations.length === 0
      ? ""
      : ` — ${gate.evaluations.filter((sub) => sub.verdict === "PASS").length}/${gate.evaluations.length} fixtures pass`;
  const reason = gate.reason === undefined ? "" : ` — ${gate.reason}`;
  console.log(
    `  [${gate.verdict}] ${gate.gateId} (${gate.blocking ? "blocking" : "advisory"}, ${gate.sourcePackage})${evaluations}${reason}`,
  );
  for (const sub of gate.evaluations) {
    const subReason = sub.notRunnableReason === undefined ? "" : ` — ${sub.notRunnableReason}`;
    const failures =
      sub.failedCheckCount === undefined || sub.failedCheckCount === 0
        ? ""
        : ` — ${sub.failedCheckCount} failing check(s): ${sub.failingChecks
            .map(
              (check) =>
                `${check.metric}=${check.measured} (threshold ${check.operator === "max" ? "<=" : ">="} ${check.threshold})`,
            )
            .join(", ")}`;
    console.log(`      [${sub.verdict}] ${sub.fixtureName}${subReason}${failures}`);
    for (const value of sub.keyValues) {
      console.log(`        ${value.metric} = ${value.value}`);
    }
  }
  for (const value of gate.keyValues) {
    console.log(`      ${value.metric} = ${value.value}`);
  }
}
console.log(
  `human review: ${report.humanReview.recordStatus} (checklist ${report.humanReview.checklistVersion}, required ${report.humanReview.required})${
    report.humanReview.problems.length === 0
      ? ""
      : ` — problems: ${report.humanReview.problems.join("; ")}`
  }`,
);
console.log(
  `accounting: total ${report.accounting.totalGates} = pass ${report.accounting.passCount} + fail ${report.accounting.failCount} + not-runnable ${report.accounting.notRunnableCount}`,
);
console.log(`VERDICT: ${report.verdict.outcome} — ${report.verdict.reason}`);
console.log(`SPORTA-RELEASE-GATE ${report.verdict.outcome}`);

process.exit(report.verdict.outcome === "PASS" ? 0 : report.verdict.outcome === "FAIL" ? 1 : 2);
