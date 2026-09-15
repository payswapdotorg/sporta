/**
 * Cross-subprocess determinism (the work order's requirement): the CLI
 * (`scripts/gate.ts`, the `bun run gate` entry) is run TWICE as separate
 * subprocesses over the same checked-in fixtures and record —
 *
 * - the two stdouts are byte-identical;
 * - the canonical report bytes (between the SPORTA-RELEASE-REPORT
 *   markers) are SHA-256-stable across the two invocations;
 * - those bytes equal the IN-PROCESS canonical serialization of the same
 *   evaluation (the subprocess proof and the in-process proof are the
 *   same bytes);
 * - the last line is the literal verdict marker `SPORTA-RELEASE-GATE
 *   <verdict>` and the exit code matches the verdict.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { evaluateReleaseReadiness, serializeReleaseReport } from "../src/report";
import { buildDemoReleaseInput } from "../src/release";
import { loadDemoRecord } from "./helpers";

/** The CLI entry (spawned as a subprocess, like the W306 run-once proof). */
const GATE_SCRIPT = `${import.meta.dir}/../scripts/gate.ts`;

/** Runs the CLI once, returning { status, stdout }. */
function runGateOnce(): { status: number | null; stdout: string } {
  const result = spawnSync(process.execPath, [GATE_SCRIPT], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout ?? "" };
}

/** Extracts the canonical report bytes between the BEGIN/END markers. */
function extractReport(stdout: string): string {
  const beginMarker = "SPORTA-RELEASE-REPORT-BEGIN\n";
  const endMarker = "SPORTA-RELEASE-REPORT-END";
  const begin = stdout.indexOf(beginMarker);
  const end = stdout.indexOf(endMarker, begin);
  expect(begin).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(begin);
  // The report bytes run from after the BEGIN marker's newline up to (not
  // including) the END marker — the report's own trailing newline is the
  // byte right before it.
  return stdout.slice(begin + beginMarker.length, end);
}

/** SHA-256 of a string's UTF-8 bytes, hex-encoded. */
function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

describe("cross-subprocess determinism (scripts/gate.ts, stdout-compared)", () => {
  test("two subprocess runs emit byte-identical stdout", () => {
    const first = runGateOnce();
    const second = runGateOnce();
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(first.stdout).toBe(second.stdout);
  });

  test("the report bytes are SHA-256-stable across the two invocations", () => {
    const first = runGateOnce();
    const second = runGateOnce();
    const firstReport = extractReport(first.stdout);
    const secondReport = extractReport(second.stdout);
    expect(firstReport).toBe(secondReport);
    expect(sha256(firstReport)).toBe(sha256(secondReport));
    // A real hash, not a vacuous comparison: the known-good form of the
    // report hash is 64 hex characters.
    expect(sha256(firstReport)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("the subprocess bytes equal the in-process canonical serialization", () => {
    const subprocess = runGateOnce();
    const inProcess = serializeReleaseReport(
      evaluateReleaseReadiness(buildDemoReleaseInput(loadDemoRecord())),
    );
    expect(extractReport(subprocess.stdout)).toBe(inProcess);
  });

  test("the stdout envelope: marker line last, verdict marker literal, exit 0", () => {
    const result = runGateOnce();
    const lines = result.stdout.split("\n");
    // The stdout ends with "\n<marker>\n" — the marker is the last
    // non-empty line.
    const lastNonEmpty = [...lines].reverse().find((line) => line.length > 0);
    expect(lastNonEmpty).toBe("SPORTA-RELEASE-GATE PASS");
    expect(result.stdout.endsWith("SPORTA-RELEASE-GATE PASS\n")).toBe(true);
    expect(result.stdout.match(/SPORTA-RELEASE-GATE /g)!.length).toBe(1);
    expect(result.stdout.includes("VERDICT: PASS")).toBe(true);
    expect(result.status).toBe(0);
  });
});
