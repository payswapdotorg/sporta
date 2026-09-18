/**
 * Cross-subprocess determinism: two SEPARATE bun processes evaluating the
 * same release input produce byte-identical reports (SHA-256 compared).
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";

/** Evaluates the release suite in a fresh bun subprocess; returns the hash. */
function subprocessReportHash(): string {
  const script = `
import { evaluateReleaseReadiness, parseDemoRecord } from "${join(import.meta.dir, "..", "src", "index.ts")}";
const report = evaluateReleaseReadiness({ humanRecord: parseDemoRecord() });
process.stdout.write(JSON.stringify(report));
`;
  const result = spawnSync("bun", ["-e", script], {
    encoding: "utf8",
    timeout: 180_000,
    cwd: join(import.meta.dir, ".."),
  });
  if (result.status !== 0) {
    throw new Error(`subprocess failed: ${result.stderr}`);
  }
  return createHash("sha256").update(result.stdout).digest("hex");
}

describe("cross-subprocess determinism", () => {
  test("two separate processes produce SHA-256-identical reports", () => {
    const a = subprocessReportHash();
    const b = subprocessReportHash();
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  }, 360_000);
});
