/**
 * W801 repeatability proofs (the W403 determinism-test precedent, one level
 * up): the suite run twice IN-PROCESS is deep-equal and byte-identical, the
 * suite run twice in SEPARATE bun subprocesses produces byte-identical
 * stdout, and the subprocess bytes equal the in-process bytes (same-binary
 * evidence, honestly scoped: this proves determinism of THIS binary on THIS
 * worktree, nothing about cross-binary or cross-machine identity).
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { serializeArtifact } from "@sporta/evaluation";
import { loadSuiteConfig, runSuite, serializeSuiteReport } from "../src/index";

const RUN_ONCE_SCRIPT = `${import.meta.dir}/../scripts/run-once.ts`;

/** Runs the suite once in a separate bun subprocess, capturing stdout. */
function subprocessOnce(): { status: number | null; stdout: string; stderr: string } {
  const run = spawnSync(process.execPath, [RUN_ONCE_SCRIPT], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

describe("repeatability: the suite ×2 IN-PROCESS", () => {
  const first = runSuite(loadSuiteConfig());
  const second = runSuite(loadSuiteConfig());

  test("two in-process runs are deep-equal", () => {
    expect(first).toEqual(second);
  });

  test("two in-process runs serialize to byte-identical canonical bytes", () => {
    expect(serializeSuiteReport(first)).toBe(serializeSuiteReport(second));
  });

  test("serialization is idempotent: serialize(parse(bytes)) reproduces the bytes", () => {
    const canonical = serializeSuiteReport(first);
    expect(serializeArtifact(JSON.parse(canonical))).toBe(canonical);
  });
});

describe("repeatability: the suite ×2 in SEPARATE bun subprocesses", () => {
  test("two subprocess runs print byte-identical canonical reports", () => {
    const a = subprocessOnce();
    const b = subprocessOnce();
    expect(a.status).toBe(0);
    expect(b.status).toBe(0);
    expect(a.stderr).toBe("");
    expect(b.stderr).toBe("");
    expect(a.stdout).toBe(b.stdout);
    expect(a.stdout.length).toBeGreaterThan(0);
  });

  test("the subprocess bytes EQUAL the in-process bytes (cross-mode identity)", () => {
    const subprocess = subprocessOnce();
    const inProcess = serializeSuiteReport(runSuite(loadSuiteConfig()));
    expect(subprocess.status).toBe(0);
    expect(subprocess.stdout).toBe(inProcess);
  });

  test("the subprocess bytes equal the checked-in golden's canonical form", () => {
    const subprocess = subprocessOnce();
    const goldenPath = `${import.meta.dir}/../fixtures/golden/suite-report-golden.json`;
    const goldenCanonical = serializeArtifact(JSON.parse(readFileSync(goldenPath, "utf8")));
    expect(subprocess.status).toBe(0);
    expect(subprocess.stdout).toBe(goldenCanonical);
  });
});
