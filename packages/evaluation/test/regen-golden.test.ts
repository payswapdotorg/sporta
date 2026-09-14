/**
 * W403 regen-golden script tests — the regeneration is an EXPLICIT act:
 *
 * - without `--confirm` the script REFUSES to write anything (exit 1, no
 *   file created) and names the tech-lead-review requirement;
 * - with `--confirm` (to a SCRATCH path — the checked-in golden is never
 *   touched by tests) the regeneration succeeds and is provably fresh:
 *   the written file re-serializes to the canonical bytes of a live
 *   pipeline run, which are also EXACTLY the checked-in golden's canonical
 *   bytes (the baseline is not stale);
 * - the script's output reminds about the tech-lead review gate.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { serializeArtifact } from "../src/serialize";
import { runFixtureEvaluation } from "../src/pipeline";
import { DEFAULT_GOLDEN_PATH } from "../src/runner";
import { scratchPath } from "./helpers";

const REGEN_SCRIPT = `${import.meta.dir}/../scripts/regen-golden.ts`;

/** Runs the regen script; returns { status, stdout, stderr }. */
function runRegen(args: readonly string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(process.execPath, [REGEN_SCRIPT, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

describe("regen-golden — the explicit, reviewed act", () => {
  const scratch = scratchPath("regen-golden-test.json");

  test("without --confirm it refuses to write (exit 1, no file, TL-review reminder)", () => {
    rmSync(scratch, { force: true });
    const result = runRegen(["--golden", scratch]);
    expect(result.status).toBe(1);
    expect(existsSync(scratch)).toBe(false);
    expect(result.stderr).toContain("REFUSING to write without --confirm");
    expect(result.stderr).toContain("TECH-LEAD REVIEW");
  });

  test("with --confirm it regenerates to the scratch path and proves freshness", () => {
    rmSync(scratch, { force: true });
    const result = runRegen(["--golden", scratch, "--confirm"]);
    expect(result.status).toBe(0);
    expect(existsSync(scratch)).toBe(true);

    // The written (Prettier-formatted) file re-serializes to the canonical
    // bytes of a LIVE pipeline run: Prettier formatting is lossless and the
    // subprocess/in-process runs agree (the script asserted both too).
    const written = readFileSync(scratch, "utf8");
    const live = runFixtureEvaluation();
    expect(serializeArtifact(JSON.parse(written))).toBe(live.canonical);

    // The checked-in golden is exactly as fresh: its canonical bytes are the
    // same as a live run's (the baseline is NOT stale).
    const checkedIn = readFileSync(DEFAULT_GOLDEN_PATH, "utf8");
    expect(serializeArtifact(JSON.parse(checkedIn))).toBe(live.canonical);

    // The reminder is printed (the review gate travels with the tool).
    expect(result.stdout).toContain("tech-lead review");
    rmSync(scratch);
  });
});
