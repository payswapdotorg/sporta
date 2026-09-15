/**
 * The CLI pins (deliverable 3): `bun run gate` runs the canonical
 * fixture-based release evaluation, writes the deterministic report, and
 * prints the verdict and the literal marker line. The determinism proof
 * the work order demands lives here: TWO subprocess invocations produce
 * byte-identical stdout (compared as bytes AND as SHA-256 hashes), the
 * written report is byte-stable across the runs, its SHA-256 matches the
 * CLI's own printed hash, and the checked-in GOLDEN copy of the canonical
 * report pins the whole fixture run byte-for-byte (upstream drift in any
 * measured value is a loud, reviewed diff).
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCanonicalReleaseInput,
  canonicalReportBytes,
  evaluateReleaseReadiness,
} from "../src/index";

/** Package root: `import.meta.dir` is `<pkg>/test`, so one dirname up. */
const PACKAGE_ROOT = join(import.meta.dir, "..");

/** The checked-in self-check record. */
const RECORD: unknown = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, "fixtures", "human-review-self-check.json"), "utf8"),
);

/** One CLI invocation (a fresh subprocess, piped stdout/stderr). */
function runGate(): { exitCode: number; stdout: string } {
  const result = Bun.spawnSync(["bun", "run", "scripts/gate.ts"], {
    cwd: PACKAGE_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
  };
}

/** The SHA-256 of the report, as printed by the CLI's own marker line. */
function printedReportSha(stdout: string): string {
  const match = /^SPORTA-RELEASE-GATE-REPORT-SHA256 ([0-9a-f]{64})$/m.exec(stdout);
  expect(match, "the CLI must print the report SHA-256 marker line").not.toBeNull();
  return match![1]!;
}

describe("the gate CLI (scripts/gate.ts) — the fixture-based demo run", () => {
  test("exits 0 with the PASS verdict and the literal marker line", () => {
    const run = runGate();
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("overall verdict: PASS");
    expect(run.stdout).toContain("SPORTA-RELEASE-GATE PASS\n");
    // Every gate row is printed with its verdict and evidence summary.
    expect(run.stdout).toContain(
      "[PASS] temporal-stability (blocking, @sporta/renderer-evaluation)",
    );
    expect(run.stdout).toContain("w503-clean-clip: 21 checks, 0 failing");
    expect(run.stdout).toContain("w605-clean-match: 44 checks, 0 failing");
    expect(run.stdout).toContain("w605-directed-review: 44 checks, 0 failing");
    expect(run.stdout).toContain("4 gates = 4 pass + 0 fail + 0 not-runnable");
    // The human record line states the self-check record honestly.
    expect(run.stdout).toContain("human record automated-pipeline-self-check");
  });

  test("two subprocess invocations produce byte-identical stdout (compared hashes)", () => {
    const first = runGate();
    const second = runGate();
    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    // Byte-identical stdout across the two subprocess invocations.
    expect(second.stdout).toBe(first.stdout);
    // And therefore identical stdout hashes.
    const firstHash = createHash("sha256").update(first.stdout, "utf8").digest("hex");
    const secondHash = createHash("sha256").update(second.stdout, "utf8").digest("hex");
    expect(secondHash).toBe(firstHash);
    // The report's own SHA-256 marker is stable across the runs.
    expect(printedReportSha(second.stdout)).toBe(printedReportSha(first.stdout));
  });

  test("writes the deterministic report; its bytes hash to the CLI's printed SHA-256", () => {
    const run = runGate();
    const reportBytes = readFileSync(
      join(PACKAGE_ROOT, "reports", "release-readiness-report.json"),
      "utf8",
    );
    const fileHash = createHash("sha256").update(reportBytes, "utf8").digest("hex");
    expect(fileHash).toBe(printedReportSha(run.stdout));
    expect(reportBytes.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(reportBytes);
    expect(parsed.verdict).toBe("PASS");
    expect(parsed.schemaTag).toBe("sporta/quality-gates/w803@1");
  });

  test("the checked-in GOLDEN report is byte-identical to a fresh canonical evaluation", () => {
    const golden = readFileSync(
      join(PACKAGE_ROOT, "fixtures", "golden", "release-readiness-report.json"),
      "utf8",
    );
    const fresh = canonicalReportBytes(
      evaluateReleaseReadiness(buildCanonicalReleaseInput(RECORD)),
    );
    expect(fresh).toBe(golden);
  });

  test("the CLI's written report equals the checked-in golden bytes", () => {
    runGate();
    const written = readFileSync(
      join(PACKAGE_ROOT, "reports", "release-readiness-report.json"),
      "utf8",
    );
    const golden = readFileSync(
      join(PACKAGE_ROOT, "fixtures", "golden", "release-readiness-report.json"),
      "utf8",
    );
    expect(written).toBe(golden);
  });
});
