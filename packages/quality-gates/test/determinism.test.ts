/**
 * The determinism pins (the work item's verbatim requirements):
 *
 * - `evaluateReleaseReadiness` is test-pinned TWICE IN ONE PROCESS: the
 *   canonical JSON of two evaluations of the same input is byte-identical
 *   (=== on strings), for the clean demo input AND for a perturbed input;
 * - the report is CROSS-SUBPROCESS stable: two CLI invocations
 *   (`scripts/gate.ts`) produce byte-identical stdout AND byte-identical
 *   report files, with compared SHA-256 hashes; the CLI's printed
 *   SHA-256 is the file's actual SHA-256, and the literal marker line
 *   `SPORTA-RELEASE-GATE PASS` is on stdout.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { injectGeometryTeleport, renderW503CleanFixture } from "@sporta/renderer-evaluation";
import {
  buildDefaultReleaseInputs,
  canonicalJsonStringify,
  evaluateReleaseReadiness,
} from "../src/index";

const RECORD_PATH = join(
  import.meta.dir,
  "..",
  "fixtures",
  "human-review",
  "self-check-record.json",
);
const demoRecord: unknown = JSON.parse(readFileSync(RECORD_PATH, "utf8"));

const sha256 = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

describe("in-process determinism (pinned twice)", () => {
  test("the clean demo input: two evaluations, byte-identical canonical JSON", () => {
    const input = buildDefaultReleaseInputs({ humanReview: demoRecord });
    const first = canonicalJsonStringify(evaluateReleaseReadiness(input));
    const second = canonicalJsonStringify(evaluateReleaseReadiness(input));
    expect(second).toBe(first);
    expect(first.length).toBeGreaterThan(1000); // a real report, not a stub
  });

  test("a perturbed input: two evaluations, byte-identical (and different from clean)", () => {
    const clean = renderW503CleanFixture();
    const perturbed = injectGeometryTeleport(clean.manifest, {
      frameIndex: 2,
      entityId: "player-7",
      toMeters: { x: 90, y: 34 },
    });
    const input = {
      ...buildDefaultReleaseInputs({ humanReview: demoRecord }),
      temporal: { input: { manifest: perturbed, frames: clean.frames } },
    };
    const first = canonicalJsonStringify(evaluateReleaseReadiness(input));
    const second = canonicalJsonStringify(evaluateReleaseReadiness(input));
    expect(second).toBe(first);

    const cleanInput = buildDefaultReleaseInputs({ humanReview: demoRecord });
    const cleanJson = canonicalJsonStringify(evaluateReleaseReadiness(cleanInput));
    expect(first).not.toBe(cleanJson); // the defect is visible in the bytes
  });
});

describe("cross-subprocess determinism (the CLI, twice, hashes compared)", () => {
  const cwd = join(import.meta.dir, "..");
  // One shared path for the stdout-identical runs (stdout embeds the path),
  // plus a distinct path to prove the report CONTENT is path-independent.
  const reportPath = join(tmpdir(), "w803-gate-report.json");
  const reportPathOther = join(tmpdir(), "w803-gate-report-other.json");

  function runCli(...args: string[]): { exitCode: number; stdout: string } {
    const result = Bun.spawnSync(["bun", "run", "scripts/gate.ts", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: result.exitCode,
      stdout: new TextDecoder().decode(result.stdout),
    };
  }

  test("two invocations: exit 0, byte-identical stdout, byte-identical reports, stable SHA-256", () => {
    const first = runCli("--report", reportPath);
    expect(first.exitCode).toBe(0);
    const bytesOne = readFileSync(reportPath);

    const second = runCli("--report", reportPath);
    expect(second.exitCode).toBe(0);
    const bytesTwo = readFileSync(reportPath);

    // Byte-identical stdout across the two subprocess invocations.
    expect(second.stdout).toBe(first.stdout);

    // The marker line is literal and green.
    expect(first.stdout).toContain("SPORTA-RELEASE-GATE PASS");

    // Byte-identical report files; the SHA-256 is stable across processes.
    expect(bytesTwo.length).toBe(bytesOne.length);
    expect(sha256(bytesTwo)).toBe(sha256(bytesOne));

    // The CLI's printed hash is the file's ACTUAL hash (no lying stdout).
    const printed = /sha256 ([0-9a-f]{64})/.exec(first.stdout);
    expect(printed).not.toBeNull();
    expect(printed![1]).toBe(sha256(bytesOne));
  });

  test("the report content is independent of the output path", () => {
    const first = runCli("--report", reportPath);
    expect(first.exitCode).toBe(0);
    const other = runCli("--report", reportPathOther);
    expect(other.exitCode).toBe(0);
    // Same report bytes at a different path (stdout differs only in the path line).
    expect(sha256(readFileSync(reportPathOther))).toBe(sha256(readFileSync(reportPath)));
    rmSync(reportPathOther, { force: true });
  });

  test("the default report path works (dist/release-report.json, gitignored)", () => {
    // No --report flag: the CLI writes its default, package-relative dist/ path.
    const result = runCli();
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("SPORTA-RELEASE-GATE PASS");
    expect(result.stdout).toContain(join("dist", "release-report.json"));
    expect(() => readFileSync(join(cwd, "dist", "release-report.json"))).not.toThrow();
  });
});
