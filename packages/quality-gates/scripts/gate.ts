/**
 * The W803 release-gate CLI: runs the suite over the repo fixtures with
 * the checked-in demo record, writes the machine-readable report, and
 * prints the verdict + the literal marker line.
 *
 * Usage: bun run gate [--record <path>] [--out <dir>]
 *
 * Exit codes: 0 PASS · 1 FAIL · 2 PENDING-HUMAN-REVIEW.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateReleaseReadiness, parseDemoRecord, type HumanReviewRecord } from "../src/index";

function recordFor(): HumanReviewRecord | undefined {
  const flagIndex = process.argv.indexOf("--record");
  if (flagIndex > 0) {
    const path = process.argv[flagIndex + 1];
    if (path === undefined) {
      console.error("--record requires a path");
      process.exit(1);
    }
    return JSON.parse(readFileSync(path, "utf8")) as HumanReviewRecord;
  }
  return parseDemoRecord();
}

const outDir = (() => {
  const flagIndex = process.argv.indexOf("--out");
  return flagIndex > 0 ? (process.argv[flagIndex + 1] ?? "reports") : "reports";
})();

const report = evaluateReleaseReadiness({ humanRecord: recordFor() });

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "w803-release-report.json"), JSON.stringify(report, null, 2));

console.log(`W803 release gates — fixture run (policy ${report.policyVersion})`);
for (const gate of report.gates) {
  console.log(`  ${gate.id}: ${gate.status}${gate.reason ? ` — ${gate.reason}` : ""}`);
}
console.log(
  `  accounting: ${report.accounting.gateCount} gates = ` +
    `${report.accounting.passCount} pass + ${report.accounting.failCount} fail + ` +
    `${report.accounting.notRunnableCount} not-runnable + ` +
    `${report.accounting.pendingHumanReviewCount} pending (reconciles: ${report.accounting.reconciles})`,
);
console.log(`report: ${join(outDir, "w803-release-report.json")}`);
console.log(`SPORTA-RELEASE-GATE ${report.verdict.outcome}`);

process.exit(report.verdict.outcome === "PASS" ? 0 : report.verdict.outcome === "FAIL" ? 1 : 2);
