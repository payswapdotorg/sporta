/**
 * The W801 evaluation-harness CLI (the W403/W503 `bun run evaluate`
 * precedent).
 *
 * Runs the suite ONCE, prints a deterministic human summary (and/or the
 * machine-readable canonical report), optionally writes the canonical report
 * to a file, and exits:
 *
 * - `0` — the aggregate verdict is PASS (every case passed, conjunctively);
 * - `1` — the aggregate verdict is FAIL (at least one case failed — an
 *   out-of-tolerance measurement, a detected defect, a failed conformance
 *   check, or a contained crash; failure reasons are always printed);
 * - `2` — usage/structural error (unknown argument, unreadable/invalid
 *   suite config, harness self-check violation, unwritable report path).
 *
 * Output is deterministic (no clock reads, no timestamps, no hostnames) —
 * the same suite in the same worktree prints the same summary and writes
 * byte-identical report bytes.
 *
 * Usage (from `packages/eval-harness` or the repository root):
 *
 *   bun run evaluate [--suite <path>] [--report <path>] [--json]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_SUITE_PATH, loadSuiteConfig, runSuite, serializeSuiteReport } from "../src/index";
import type { SuiteReport, SuiteCaseResult } from "../src/index";

interface CliOptions {
  suitePath?: string;
  reportPath?: string;
  json?: boolean;
}

const USAGE = `usage: bun run evaluate [--suite <path>] [--report <path>] [--json]
  --suite path    suite config path (default ${DEFAULT_SUITE_PATH})
  --report path   write the canonical machine-readable report to this path
  --json          print the canonical machine-readable report to stdout

Exit codes: 0 = all cases PASS; 1 = aggregate FAIL; 2 = usage/structural error.`;

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case "--suite": {
        const value = argv[i + 1];
        if (value === undefined) {
          process.stderr.write("evaluate: --suite requires a path argument\n");
          process.exit(2);
        }
        options.suitePath = value;
        i += 1;
        break;
      }
      case "--report": {
        const value = argv[i + 1];
        if (value === undefined) {
          process.stderr.write("evaluate: --report requires a path argument\n");
          process.exit(2);
        }
        options.reportPath = value;
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

/** Renders one case's deterministic summary line(s). */
function renderCase(caseResult: SuiteCaseResult): string[] {
  const lines: string[] = [];
  const mark = caseResult.verdict === "PASS" ? "PASS" : "FAIL";
  lines.push(`  case ${caseResult.caseName} [${caseResult.caseKind}]: ${mark}`);
  if (caseResult.error !== undefined) {
    lines.push(`    error: ${caseResult.error.errorClass}: ${caseResult.error.message}`);
  }
  if (caseResult.measured !== undefined) {
    const measured = caseResult.measured as unknown as Record<string, unknown>;
    if (caseResult.caseKind === "w403-replay-comparability") {
      lines.push(
        `    runs completed: ${String(measured.runsCompleted)}, pairwise comparisons: ` +
          `${(measured.pairwise as unknown[] | undefined)?.length ?? 0}, golden comparison: ` +
          `${measured.golden === null ? "disabled" : (measured.golden as { report?: { passed?: boolean } }).report?.passed === true ? "PASSED" : "FAILED"}`,
      );
    } else if (caseResult.caseKind === "w503-temporal-consistency") {
      const report = measured.report as {
        verdict?: { checks?: unknown[]; failures?: unknown[] };
        input?: { rendererId?: string; rendererVersion?: string; frameCount?: number };
      };
      const checks = report.verdict?.checks?.length ?? 0;
      const failing = report.verdict?.failures?.length ?? 0;
      const proof = measured.detectionProof;
      const proofText =
        proof === null || proof === undefined
          ? "disabled"
          : `${(proof as { detected?: boolean }[]).filter((e) => e.detected).length}/` +
            `${(proof as unknown[]).length} injections detected`;
      lines.push(
        `    ${String(report.input?.rendererId)}@${String(report.input?.rendererVersion)}: ` +
          `${String(report.input?.frameCount)} frames, ${checks} threshold checks ` +
          `(${failing} failing), detection proof: ${proofText}`,
      );
    } else if (caseResult.caseKind === "w306-latency-benchmark") {
      const stages = measured.stages as {
        batch?: Record<string, { count?: number; p50Ms?: number; p95Ms?: number }>;
      };
      const endToEnd = stages.batch?.["end-to-end"];
      const verdicts = measured.sloVerdicts as { pass?: boolean }[] | null;
      const sloText =
        verdicts === null || verdicts === undefined
          ? "disabled"
          : `${verdicts.filter((v) => v.pass).length}/${verdicts.length} candidate checks met`;
      const frames = (
        measured.accounting as {
          frames?: {
            framesIn?: number;
            framesEmitted?: number;
            framesDropped?: number;
            framesSkippedStale?: number;
          };
        }
      ).frames;
      lines.push(
        `    end-to-end p50 ${String(endToEnd?.p50Ms)}ms / p95 ${String(endToEnd?.p95Ms)}ms ` +
          `(n=${String(endToEnd?.count)}), injected-clock domain; frames ` +
          `${String(frames?.framesIn)} in = ${String(frames?.framesEmitted)} emitted ` +
          `(${String((frames?.framesSkippedStale ?? 0) + (frames?.framesDropped ?? 0))} lost); ` +
          `SLO candidates: ${sloText}`,
      );
    } else {
      const checks = measured.checks as { checkId?: string }[] | undefined;
      lines.push(
        `    conformance: ${checks?.length ?? 0} checks ` +
          `(${(caseResult.measured as { passed?: boolean }).passed === true ? "all passed" : "FAILED"})`,
      );
    }
  }
  lines.push(`    injected clock: ${caseResult.clock.startMs} → ${caseResult.clock.endMs}`);
  for (const reason of caseResult.failureReasons) {
    lines.push(`    failure: ${reason}`);
  }
  return lines;
}

/** Renders the deterministic human summary (CLI stdout). */
export function renderSummary(report: SuiteReport): string {
  const lines: string[] = [];
  lines.push(
    `sporta eval-harness — suite "${report.suite.suiteId}" v${report.suite.suiteVersion} ` +
      `(${report.aggregate.caseCount} case(s))`,
  );
  lines.push(`  suite config sha256: ${report.suite.suiteConfigSha256}`);
  lines.push("  environment (measured):");
  for (const [name, version] of Object.entries(report.environment.packageVersions)) {
    lines.push(`    ${name} ${version}`);
  }
  for (const caseResult of report.cases) {
    lines.push(...renderCase(caseResult));
  }
  lines.push(`  injected clock (suite): ${report.clock.startMs} → ${report.clock.endMs}`);
  if (report.aggregate.failureReasons.length > 0) {
    lines.push("FAILURE REASONS:");
    for (const reason of report.aggregate.failureReasons) {
      lines.push(`  - ${reason}`);
    }
  }
  lines.push(
    `AGGREGATE VERDICT: ${report.aggregate.verdict} — ${report.aggregate.passCount}/` +
      `${report.aggregate.caseCount} case(s) passed (conjunctive)`,
  );
  return lines.join("\n");
}

const options = parseArgs(process.argv.slice(2));

let report: SuiteReport;
try {
  const loaded = loadSuiteConfig(options.suitePath);
  report = runSuite(loaded);
} catch (cause) {
  // Usage/structural error: bad arguments were handled above; this is an
  // invalid/unreadable suite config or a harness self-check violation.
  process.stderr.write(`evaluate: ${(cause as Error).message}\n`);
  process.exit(2);
}

const canonical = serializeSuiteReport(report);

if (options.reportPath !== undefined) {
  try {
    mkdirSync(dirname(options.reportPath), { recursive: true });
    writeFileSync(options.reportPath, canonical);
  } catch (cause) {
    process.stderr.write(
      `evaluate: cannot write the report to "${options.reportPath}" (${(cause as Error).message})\n`,
    );
    process.exit(2);
  }
}

if (options.json) {
  process.stdout.write(canonical);
} else {
  process.stdout.write(`${renderSummary(report)}\n`);
}

process.exit(report.aggregate.verdict === "PASS" ? 0 : 1);
