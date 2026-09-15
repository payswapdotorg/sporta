/**
 * W801 golden-report tests: the checked-in golden is the drift gate.
 *
 * - the fresh suite's canonical bytes EQUAL the golden's canonical form
 *   (canonical-to-canonical — the golden FILE is Prettier-formatted, which
 *   is lossless);
 * - every MUTATED golden fails the comparison (verdict flips, measured-value
 *   tweaks, config-hash tweaks);
 * - a semantically-null mutation (reordering keys in the golden file) does
 *   NOT fail — the comparison is canonical, so cosmetic file formatting
 *   cannot create false drift;
 * - regen-golden refuses to write without --confirm (the W403 discipline).
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { serializeArtifact } from "@sporta/evaluation";
import {
  DEFAULT_GOLDEN_REPORT_PATH,
  assertSuiteReportShape,
  loadSuiteConfig,
  runSuite,
  serializeSuiteReport,
} from "../src/index";
import type { SuiteReport, W403CaseResult, W503CaseResult, W601CaseResult } from "../src/index";
import { defaultSuiteReport } from "./helpers";

/** The golden's canonical form (canonical-to-canonical comparison). */
function goldenCanonical(): string {
  return serializeArtifact(JSON.parse(readFileSync(DEFAULT_GOLDEN_REPORT_PATH, "utf8")));
}

/** The fresh suite's canonical bytes. */
function freshCanonical(): string {
  return serializeSuiteReport(runSuite(loadSuiteConfig()));
}

describe("golden: the checked-in report is the drift gate", () => {
  test("the fresh suite's canonical bytes equal the golden's canonical form", () => {
    expect(freshCanonical()).toBe(goldenCanonical());
  });

  test("the memoized suite run (shared across test files) also matches the golden", () => {
    expect(serializeSuiteReport(defaultSuiteReport())).toBe(goldenCanonical());
  });

  test("the golden parses and passes the report shape self-check", () => {
    const golden = JSON.parse(readFileSync(DEFAULT_GOLDEN_REPORT_PATH, "utf8"));
    expect(() => assertSuiteReportShape(golden)).not.toThrow();
  });
});

describe("golden: mutations fail the drift gate (detection teeth)", () => {
  const base = () => JSON.parse(goldenCanonical()) as SuiteReport;

  test("a flipped aggregate verdict is detected", () => {
    const mutated = base();
    mutated.aggregate.verdict = "FAIL";
    expect(serializeArtifact(mutated)).not.toBe(freshCanonical());
  });

  test("a tweaked W403 measured value is detected", () => {
    const mutated = base();
    const w403 = mutated.cases[0] as W403CaseResult;
    w403.measured!.runsCompleted = 1;
    expect(serializeArtifact(mutated)).not.toBe(freshCanonical());
  });

  test("a tweaked W503 measured threshold check is detected", () => {
    const mutated = base();
    const w503 = mutated.cases[1] as W503CaseResult;
    w503.measured!.report.verdict.checks[0]!.measured = 999;
    expect(serializeArtifact(mutated)).not.toBe(freshCanonical());
  });

  test("a tweaked W601 measured check result is detected", () => {
    const mutated = base();
    const w601 = mutated.cases[2] as W601CaseResult;
    w601.measured!.checks[0]!.passed = false;
    expect(serializeArtifact(mutated)).not.toBe(freshCanonical());
  });

  test("a tweaked environment version is detected", () => {
    const mutated = base();
    mutated.environment.packageVersions["@sporta/evaluation"] = "9.9.9";
    expect(serializeArtifact(mutated)).not.toBe(freshCanonical());
  });

  test("a tweaked suite-config hash is detected", () => {
    const mutated = base();
    mutated.suite.suiteConfigSha256 = "0".repeat(64);
    expect(serializeArtifact(mutated)).not.toBe(freshCanonical());
  });

  test("a tweaked injected-clock read is detected", () => {
    const mutated = base();
    mutated.cases[1]!.clock.endMs += 1;
    expect(serializeArtifact(mutated)).not.toBe(freshCanonical());
  });

  test("reordering the golden file's keys does NOT fail (canonical comparison)", () => {
    const golden = JSON.parse(readFileSync(DEFAULT_GOLDEN_REPORT_PATH, "utf8")) as Record<
      string,
      unknown
    >;
    // Reverse the top-level key order in the FILE's JSON text.
    const reordered: Record<string, unknown> = {};
    for (const key of Object.keys(golden).reverse()) {
      reordered[key] = golden[key];
    }
    expect(serializeArtifact(reordered)).toBe(freshCanonical());
  });
});

describe("golden: regen discipline (regen-golden refuses without --confirm)", () => {
  const REGEN_SCRIPT = `${import.meta.dir}/../scripts/regen-golden.ts`;

  test("without --confirm it exits 1, refuses, and writes nothing", () => {
    const before = readFileSync(DEFAULT_GOLDEN_REPORT_PATH, "utf8");
    const run = spawnSync(process.execPath, [REGEN_SCRIPT], { encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("REFUSING to write without --confirm");
    expect(readFileSync(DEFAULT_GOLDEN_REPORT_PATH, "utf8")).toBe(before);
  });

  test("an unknown regen argument exits 2 (usage error)", () => {
    const run = spawnSync(process.execPath, [REGEN_SCRIPT, "--bogus"], { encoding: "utf8" });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("unknown argument");
  });
});
