/**
 * R208 replay determinism: two in-process runs + one CROSS-SUBPROCESS run of
 * the same clip (fx-001, full 250 frames, identical config + provenance)
 * must produce BYTE-IDENTICAL artifact content hashes, and the serialized
 * artifacts themselves must be byte-identical.
 *
 * The subprocess leg runs `scripts/run-pipeline.ts` through `Bun.spawn` — a
 * fresh runtime, fresh module registry, fresh everything — and compares both
 * the printed content hash and the written artifact bytes.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RealToSwmPipeline, buildReconstructionArtifact, serializeArtifact } from "../src/index";
import { ffmpegAvailable, gatePolicy, loadGateClip } from "./helpers";

const available = await ffmpegAvailable();
if (!available) {
  console.warn("ffmpeg unavailable — skipping the determinism gate");
}

const CLI_SCRIPT = join(import.meta.dir, "..", "scripts", "run-pipeline.ts");

describe.skipIf(!available)("R208 replay determinism (fx-001, real clip)", () => {
  test("two in-process runs + one cross-subprocess run → byte-identical artifacts", async () => {
    const clip = loadGateClip("fx-001");
    const policy = gatePolicy();
    const config = {
      sessionId: "sess-fx-001",
      decode: { maxTotalBytes: 1024 * 1024 * 1024 },
    };

    const runOnce = async () => {
      const pipeline = new RealToSwmPipeline();
      const result = await pipeline.run({
        source: { ...clip.source, authorizationPolicy: policy },
        config,
      });
      return buildReconstructionArtifact(result, clip.provenance);
    };

    const first = await runOnce();
    const second = await runOnce();

    // Two in-process runs: identical content hash AND byte-identical JSON.
    expect(first.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.contentHash).toBe(first.contentHash);
    const firstJson = serializeArtifact(first);
    const secondJson = serializeArtifact(second);
    expect(secondJson).toBe(firstJson);

    // Cross-subprocess: fresh runtime via Bun.spawn.
    const outPath = join(tmpdir(), "sporta-r208-determinism-fx001.json");
    const provenanceJson = JSON.stringify({
      ...clip.provenance,
      // Canonical JSON round-trip normalizes nothing here: the same string
      // the in-process runs' canonical serializer produces.
    });
    const proc = Bun.spawn(
      [
        process.execPath,
        CLI_SCRIPT,
        join(import.meta.dir, "..", "fixtures", "media", "fx-001-normalized.mp4"),
        outPath,
        "fx-001",
        provenanceJson,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(exitCode).toBe(0);
    const subprocessHash = stdout.trim().split("\n")[0]!;
    expect(subprocessHash).toBe(first.contentHash);
    const subprocessJson = readFileSync(outPath, "utf8");
    expect(subprocessJson).toBe(firstJson);

    // Honest evidence for the report.
    console.log(
      `[determinism] fx-001 contentHash=${first.contentHash} ` +
        `(2 in-process + 1 cross-subprocess, byte-identical; subprocess stderr: ` +
        `${stderr.trim().split("\n")[0] ?? ""})`,
    );
  }, 180_000);

  test("a DIFFERENT clip config produces a different content hash (the hash is not vacuous)", async () => {
    const clip = loadGateClip("fx-001");
    const policy = gatePolicy();
    const base = {
      sessionId: "sess-fx-001",
      decode: { maxTotalBytes: 1024 * 1024 * 1024 },
    };
    const pipeline = new RealToSwmPipeline();
    const baseline = await pipeline.run({
      source: { ...clip.source, authorizationPolicy: policy },
      config: base,
    });
    const varied = await pipeline.run({
      source: { ...clip.source, authorizationPolicy: policy },
      config: { ...base, minTrackFrames: 12 },
    });
    expect(buildReconstructionArtifact(varied, clip.provenance).contentHash).not.toBe(
      buildReconstructionArtifact(baseline, clip.provenance).contentHash,
    );
  }, 120_000);
});
