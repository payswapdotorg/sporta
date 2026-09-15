/**
 * W306 determinism: the same fixture + injected clock + pipeline produce
 * BYTE-IDENTICAL report bytes — in-process (two fresh runs, deep-equal reports,
 * identical summaries) and ACROSS SUBPROCESSES (the `scripts/run-once.ts` entry
 * run twice, stdout-compared). This is the property that makes every number in
 * SLOs.md reproducible evidence rather than a one-off observation.
 *
 * The canonical serialization is also pinned structurally: sorted keys at
 * every level, and a trailing newline (the W403 serializer semantics,
 * re-implemented locally in `report.ts`).
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { runLatencyBenchmark } from "../src/benchmark";
import { LIVE_FIXTURE_PROFILE } from "../src/fixture";
import { serializeLatencyReport } from "../src/report";
import { parseLatencyReport } from "../src/schema";

/** A small live profile (fast: the determinism property, not the evidence run). */
const determinismProfile = {
  ...LIVE_FIXTURE_PROFILE,
  profileId: "w306-determinism-fixture",
  seed: "w306-determinism-seed",
  seconds: 12,
  burstEventFromMs: 4_000,
  burstEventToMs: 6_000,
  burstUpdatesPerSecond: 4,
};

describe("determinism: in-process (two fresh runs)", () => {
  test("the same options produce byte-identical serialized reports", async () => {
    const a = await runLatencyBenchmark({ profile: determinismProfile });
    const b = await runLatencyBenchmark({ profile: determinismProfile });
    expect(a.serialized).toBe(b.serialized);
  });

  test("the reports are deep-equal AND the summaries are identical", async () => {
    const a = await runLatencyBenchmark({ profile: determinismProfile });
    const b = await runLatencyBenchmark({ profile: determinismProfile });
    expect(a.report).toEqual(b.report);
    expect(a.summary).toBe(b.summary);
    expect(a.trace.frames.length).toBe(b.trace.frames.length);
    expect(a.result.stats).toEqual(b.result.stats);
  });

  test("a different seed produces a different schedule (the PRNG is live, not constant)", async () => {
    const a = await runLatencyBenchmark({ profile: determinismProfile });
    const b = await runLatencyBenchmark({
      profile: { ...determinismProfile, seed: "w306-other-seed" },
    });
    expect(a.serialized).not.toBe(b.serialized);
  });
});

describe("determinism: across subprocesses (run-once.ts, stdout-compared)", () => {
  const RUN_ONCE = `${import.meta.dir}/../scripts/run-once.ts`;

  test("two subprocess runs emit byte-identical canonical report bytes", () => {
    const first = spawnSync(process.execPath, [RUN_ONCE], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const second = spawnSync(process.execPath, [RUN_ONCE], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(first.stdout).toBe(second.stdout);
    // The subprocess bytes equal the in-process canonical form of the SAME
    // default run (the checked-in evidence configuration).
    expect(first.stdout.endsWith("\n")).toBe(true);
    const parsed = parseLatencyReport(JSON.parse(first.stdout));
    expect(parsed.benchmark.fixture.profileId).toBe("w306-live-fixture");
  });

  test("the subprocess bytes equal an in-process default run's serialized bytes", async () => {
    const run = await runLatencyBenchmark();
    const subprocess = spawnSync(process.execPath, [RUN_ONCE], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    expect(subprocess.status).toBe(0);
    expect(subprocess.stdout).toBe(run.serialized);
  });
});

describe("the canonical serialization (sorted keys, 2-space, trailing newline)", () => {
  test("every object level's keys are sorted", async () => {
    const run = await runLatencyBenchmark({ profile: determinismProfile });
    const text = run.serialized;
    expect(text.endsWith("\n")).toBe(true);
    // Top level keys sorted.
    const topKeys = Object.keys(JSON.parse(text) as Record<string, unknown>);
    expect(topKeys).toEqual([...topKeys].sort());
    // Nested levels sorted: "balanced" sorts BEFORE "dropReasons", which
    // sorts before "emittedManifestFrames" (the accounting.frames block).
    const accountingIndex = text.indexOf('"accounting"');
    const balancedIndex = text.indexOf('"balanced"', accountingIndex);
    const dropReasonsIndex = text.indexOf('"dropReasons"', accountingIndex);
    const emittedIndex = text.indexOf('"emittedManifestFrames"', accountingIndex);
    expect(balancedIndex).toBeGreaterThan(-1);
    expect(dropReasonsIndex).toBeGreaterThan(balancedIndex);
    expect(emittedIndex).toBeGreaterThan(dropReasonsIndex);
  });

  test("serializing a parsed report reproduces the same bytes (idempotence)", async () => {
    const run = await runLatencyBenchmark({ profile: determinismProfile });
    const parsed = parseLatencyReport(JSON.parse(run.serialized));
    expect(serializeLatencyReport(parsed)).toBe(run.serialized);
  });
});
