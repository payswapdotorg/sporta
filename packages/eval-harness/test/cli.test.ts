/**
 * W801 CLI tests (`bun run evaluate`): the W403/W503 exit-code contract —
 * 0 = all-PASS, 1 = FAIL verdict, 2 = usage/structural error — plus the
 * byte-identity proof across TWO SEPARATE CLI subprocess runs (the report
 * files and the --json stdout are byte-identical, and equal the in-process
 * canonical bytes and the checked-in golden's canonical form).
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serializeArtifact } from "@sporta/evaluation";
import {
  DEFAULT_GOLDEN_REPORT_PATH,
  loadSuiteConfig,
  runSuite,
  serializeSuiteReport,
} from "../src/index";
import { defaultConfigObject, scratchPath } from "./helpers";

const LOADED = loadSuiteConfig();

/**
 * Writes a scratch suite config (absolute fixture paths — scratch configs
 * live in the OS temp dir, so the default RELATIVE paths would resolve
 * against the wrong origin).
 */
function writeScratchSuiteConfig(name: string, mutator: (config: Record<string, unknown>) => void): string {
  const config = defaultConfigObject();
  const cases = config.cases as Array<Record<string, unknown>>;
  const w403 = cases[0]!.fixture as Record<string, unknown>;
  w403.fixturePath = join(LOADED.originDir, String(w403.fixturePath));
  w403.goldenPath = join(LOADED.originDir, String(w403.goldenPath));
  const w601 = cases[2]!.fixture as Record<string, unknown>;
  w601.sceneFixturePath = join(LOADED.originDir, String(w601.sceneFixturePath));
  mutator(config);
  const path = scratchPath(name);
  writeFileSync(path, JSON.stringify(config, null, 2));
  return path;
}

const EVALUATE_SCRIPT = `${import.meta.dir}/../scripts/evaluate.ts`;

/** One CLI subprocess invocation. */
function cli(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const run = spawnSync(process.execPath, [EVALUATE_SCRIPT, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

describe("CLI: the happy path, twice, in separate subprocesses", () => {
  const reportA = scratchPath("cli-report-a.json");
  const reportB = scratchPath("cli-report-b.json");

  const runA = cli(["--report", reportA, "--json"]);
  const runB = cli(["--report", reportB, "--json"]);

  test("both invocations exit 0 (all cases PASS)", () => {
    expect(runA.status).toBe(0);
    expect(runB.status).toBe(0);
  });

  test("the two report FILES are byte-identical", () => {
    expect(readFileSync(reportA, "utf8")).toBe(readFileSync(reportB, "utf8"));
  });

  test("the two --json stdouts are byte-identical", () => {
    expect(runA.stdout).toBe(runB.stdout);
  });

  test("the report file bytes equal the --json stdout bytes", () => {
    expect(readFileSync(reportA, "utf8")).toBe(runA.stdout);
  });

  test("the report bytes equal the in-process canonical bytes", () => {
    const inProcess = serializeSuiteReport(runSuite(loadSuiteConfig()));
    expect(readFileSync(reportA, "utf8")).toBe(inProcess);
  });

  test("the report bytes equal the checked-in golden's canonical form", () => {
    const goldenCanonical = serializeArtifact(
      JSON.parse(readFileSync(DEFAULT_GOLDEN_REPORT_PATH, "utf8")),
    );
    expect(readFileSync(reportA, "utf8")).toBe(goldenCanonical);
  });
});

describe("CLI: the human summary (deterministic, from the report only)", () => {
  test("without --json the summary names every case and the aggregate verdict", () => {
    const run = cli([]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("sporta eval-harness");
    expect(run.stdout).toContain("case w403-replay-comparability");
    expect(run.stdout).toContain("case w503-temporal-consistency");
    expect(run.stdout).toContain("case w601-scene-conformance");
    expect(run.stdout).toContain("AGGREGATE VERDICT: PASS — 3/3 case(s) passed (conjunctive)");
    // The summary never prints a wall clock or a hostname.
    expect(run.stdout).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  test("--help exits 0 and prints the usage", () => {
    const run = cli(["--help"]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("usage: bun run evaluate");
    expect(run.stdout).toContain("--report");
  });
});

describe("CLI: usage/structural errors exit 2", () => {
  test("an unknown argument exits 2", () => {
    const run = cli(["--bogus"]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("unknown argument");
  });

  test("a --suite pointing at a missing file exits 2", () => {
    const run = cli(["--suite", "/nonexistent/suite.json"]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("cannot read the suite config");
  });

  test("a --suite with an invalid config body exits 2", () => {
    const path = scratchPath("cli-invalid-suite.json");
    writeFileSync(path, "{not json");
    const run = cli(["--suite", path]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("not valid JSON");
  });

  test("--report without a value exits 2", () => {
    const run = cli(["--report"]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("--report requires a path argument");
  });

  test("an unwritable --report path exits 2", () => {
    const run = cli(["--report", "/nonexistent-dir-hierarchy/report.json"]);
    // mkdirSync would create it; a path whose parent is a FILE cannot be created.
    const blocker = scratchPath("cli-report-blocker");
    writeFileSync(blocker, "not a directory");
    const blocked = cli(["--report", `${blocker}/report.json`]);
    expect(run.status === 2 || blocked.status === 2).toBe(true);
    if (blocked.status === 2) {
      expect(blocked.stderr).toContain("cannot write the report");
    }
  });
});

describe("CLI: a FAILING verdict exits 1 (never silent)", () => {
  test("a suite whose W601 fixture is missing exits 1 with the failure reasons", () => {
    const path = writeScratchSuiteConfig("cli-failing-suite.json", (config) => {
      const cases = config.cases as Array<Record<string, unknown>>;
      (cases[2]!.fixture as Record<string, unknown>).sceneFixturePath = "/nonexistent/scene.json";
    });

    const run = cli(["--suite", path]);
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("AGGREGATE VERDICT: FAIL — 2/3 case(s) passed (conjunctive)");
    expect(run.stdout).toContain("w601-scene-conformance: case crashed: RangeError");
    expect(run.stdout).toContain("FAILURE REASONS");
  });

  test("the failing run still writes its canonical report (--report)", () => {
    const path = writeScratchSuiteConfig("cli-failing-suite-2.json", (config) => {
      const cases = config.cases as Array<Record<string, unknown>>;
      (cases[2]!.fixture as Record<string, unknown>).sceneFixturePath = "/nonexistent/scene.json";
    });

    const reportPath = scratchPath("cli-failing-report.json");
    const run = cli(["--suite", path, "--report", reportPath]);
    expect(run.status).toBe(1);
    const written = JSON.parse(readFileSync(reportPath, "utf8")) as { aggregate?: { verdict?: string } };
    expect(written.aggregate?.verdict).toBe("FAIL");
  });
});
