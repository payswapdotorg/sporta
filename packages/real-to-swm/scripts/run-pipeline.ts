/**
 * CLI runner for the real-to-SWM pipeline (R207/R208 tooling).
 *
 * Usage:
 *   bun scripts/run-pipeline.ts <clip.mp4> <out-artifact.json> [clipId] [provenanceJson]
 *
 * Runs the DEFAULT pipeline composition over the clip, writes the canonical
 * artifact JSON to <out-artifact.json>, prints the content hash, and prints
 * honest per-stage wall-clock measurements (decode / perceive / fuse / emit)
 * on stderr — measurement lives HERE, never inside the deterministic core.
 *
 * This script exists for the R208 cross-subprocess determinism proof and the
 * resource/cost evidence; it is not part of the package's library surface.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { RealToSwmPipeline, buildReconstructionArtifact, serializeArtifact } from "../src/index";
import type { ClipProvenance } from "../src/index";
import { buildAuthorizationPolicy } from "@sporta/testing";
import type { AuthorizationPolicy } from "@sporta/contracts";

const clipPath = process.argv[2];
const outPath = process.argv[3];
if (clipPath === undefined || outPath === undefined) {
  console.error(
    "usage: bun scripts/run-pipeline.ts <clip.mp4> <out-artifact.json> [clipId] [provenanceJson]",
  );
  process.exit(2);
}
const clipId = process.argv[4] ?? basename(clipPath).replace(/\.[^.]+$/, "");
const provenanceOverride: ClipProvenance | undefined =
  process.argv[5] !== undefined ? (JSON.parse(process.argv[5]) as ClipProvenance) : undefined;

const bytes = new Uint8Array(readFileSync(clipPath));
const policy: AuthorizationPolicy = buildAuthorizationPolicy();

// The decode budget: 640x360 rgb24 frames; ~700KB/frame + headroom.
const maxTotalBytes = 1024 * 1024 * 1024;

const stageWallClock = new Map<string, number>();
let lastStage: string | null = null;
let lastStart = 0;
const hooks = {
  onStageStart: (stage: string) => {
    lastStage = stage;
    lastStart = Date.now();
  },
  onStageComplete: (stage: string) => {
    if (lastStage === stage && lastStart > 0) {
      stageWallClock.set(stage, Date.now() - lastStart);
    }
  },
};

const provenance: ClipProvenance = provenanceOverride ?? { clipId };

const pipeline = new RealToSwmPipeline();
const result = await pipeline.run(
  {
    source: { provenance, bytes, authorizationPolicy: policy, filename: basename(clipPath) },
    config: { sessionId: `sess-${clipId}`, decode: { maxTotalBytes } },
  },
  hooks,
);

const artifact = buildReconstructionArtifact(result, provenance);
writeFileSync(outPath, serializeArtifact(artifact));
console.log(artifact.contentHash);
console.error(
  `clip=${clipId} frames=${result.clip.frameCount} entities=${result.provenance.length} ` +
    `events=${result.events.length} candidates=${result.eventCandidates.length}`,
);
for (const [stage, ms] of stageWallClock) {
  console.error(`wall-clock ${stage}: ${ms}ms`);
}
