/**
 * R208 reconstruction gate — the REAL-clip acceptance tests (fx-001 + fx-004,
 * the TL media drop). CONDITIONAL on ffmpeg availability (the W102
 * integration-test convention); the committed fixtures are sha256-verified
 * fail-closed before use.
 *
 * Gate acceptance (each criterion evidenced here):
 *
 * 1. Each gate clip → a `ReconstructionArtifact` with a coherent SWM:
 *    players/ball entities with confidence + provenance, snapshots, event
 *    candidates.
 * 2. Provenance honesty: the artifact carries the clip's sha256 + license
 *    record VERBATIM from the manifest; the degradation ledger accounts for
 *    every frame.
 * 3. Event candidates are plausible: typed, with confidence + supporting
 *    evidence pointers that RESOLVE in the observation store.
 */
import { describe, expect, test } from "bun:test";
import { WorldSnapshot } from "@sporta/contracts";
import { RealToSwmPipeline, buildReconstructionArtifact, replayReconstruction } from "../src/index";
import type { PipelineResult, ReconstructionArtifact } from "../src/index";
import { ffmpegAvailable, gateConfig, gatePolicy, loadGateManifest, loadGateClip } from "./helpers";

const available = await ffmpegAvailable();
if (!available) {
  console.warn("ffmpeg unavailable — skipping the R208 real-clip gate");
}

/** Runs the full pipeline on one gate clip and builds the artifact. */
async function runGateClip(
  clipId: string,
): Promise<{ result: PipelineResult; artifact: ReconstructionArtifact }> {
  const clip = loadGateClip(clipId);
  const pipeline = new RealToSwmPipeline();
  const stageWallClock = new Map<string, number>();
  let lastStage: string | null = null;
  let lastStart = 0;
  const result = await pipeline.run(
    {
      source: { ...clip.source, authorizationPolicy: gatePolicy() },
      config: gateConfig(clipId),
    },
    {
      onStageStart: (stage) => {
        lastStage = stage;
        lastStart = Date.now();
      },
      onStageComplete: (stage) => {
        if (lastStage === stage && lastStart > 0) {
          stageWallClock.set(stage, Date.now() - lastStart);
        }
      },
    },
  );
  // Resource evidence (honest wall-clock, measured OUTSIDE the artifact).
  const timings = [...stageWallClock.entries()].map(([stage, ms]) => `${stage}=${ms}ms`).join(" ");
  console.log(`[gate ${clipId}] wall-clock: ${timings}`);
  const artifact = buildReconstructionArtifact(result, clip.provenance);
  return { result, artifact };
}

describe.skipIf(!available)("R208 reconstruction gate (real clips)", () => {
  const manifest = loadGateManifest();

  for (const entry of manifest.clips) {
    test(`gate clip ${entry.clipId}: coherent SWM reconstruction artifact`, async () => {
      const { result, artifact } = await runGateClip(entry.clipId);

      // --- the artifact is complete and self-consistent -------------------
      expect(artifact.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(artifact.schemaVersion).toBe("1.1");
      expect(artifact.clip.frameCount).toBe(entry.normalizedShape.frameCount);
      expect(artifact.clip.width).toBe(entry.normalizedShape.width);
      expect(artifact.clip.height).toBe(entry.normalizedShape.height);

      // --- coherent SWM: entities with confidence + provenance -----------
      const finalSnapshot = artifact.swm.snapshots[artifact.swm.snapshots.length - 1]!;
      expect(artifact.swm.snapshots.length).toBeGreaterThan(0);
      expect(WorldSnapshot.safeParse(finalSnapshot).success).toBe(true);
      const participants = finalSnapshot.entities.filter((e) => e.kind === "participant");
      const balls = finalSnapshot.entities.filter((e) => e.kind === "ball");
      expect(participants.length).toBeGreaterThan(0);
      expect(balls.length).toBeGreaterThan(0);
      // Every entity carries an uncertain position with confidence (never a
      // silent collapse to a boolean/presence claim).
      for (const entity of finalSnapshot.entities) {
        const position = entity.state.position!;
        expect(position).toBeDefined();
        expect(position.status).toBe("uncertain");
        expect(position.confidence).toBeGreaterThanOrEqual(0);
        expect(position.confidence).toBeLessThanOrEqual(1);
      }
      // Per-entity provenance joins 1:1 with the snapshot entities.
      for (const entity of finalSnapshot.entities) {
        const record = artifact.provenance.entities.find((p) => p.entityId === entity.entityId);
        expect(record).toBeDefined();
        expect(record!.observationCount).toBeGreaterThan(0);
        expect(record!.meanConfidence).toBeGreaterThanOrEqual(0);
        expect(record!.producedBy.length).toBeGreaterThan(0);
      }

      // --- the ledger accounts for every frame ---------------------------
      const decode = artifact.ledger.stages.find((s) => s.stage === "decode")!;
      expect(decode.framesIn).toBe(entry.normalizedShape.frameCount);
      expect(decode.framesOut).toBe(entry.normalizedShape.frameCount);
      for (const stage of artifact.ledger.stages) {
        // Every stage's frame accounting is explicit: nothing between
        // framesIn and framesOut is unexplained (degradations + outputs).
        expect(stage.framesIn).toBeLessThanOrEqual(entry.normalizedShape.frameCount);
        expect(stage.degradations).toBeDefined();
      }
      // The honest degradations this footage actually produces: both gate
      // clips refuse pitch calibration (beach sand / archival film carry no
      // pitch-green), and that refusal is RECORDED, never silent.
      const calibrate = artifact.ledger.stages.find((s) => s.stage === "calibrate")!;
      expect(calibrate.degradations.some((d) => d.kind === "calibration-unavailable")).toBe(true);
      const summary = artifact.ledger.summary.find((d) => d.kind === "calibration-unavailable");
      expect(summary).toBeDefined();

      // --- event candidates: typed + confidence + resolvable evidence ----
      expect(artifact.eventCandidates.length).toBeGreaterThan(0);
      for (const candidate of artifact.eventCandidates) {
        expect(candidate.eventTypeRef).toBe("real-to-swm/v1/ball-impulse");
        expect(candidate.confidence).toBeGreaterThanOrEqual(0);
        expect(candidate.confidence).toBeLessThanOrEqual(1);
        expect(candidate.evidence.length).toBe(3);
        for (const observationId of candidate.evidence) {
          expect(result.store.byId(observationId)).toBeDefined();
        }
      }

      // --- replay reconstructs the view from the artifact alone ----------
      const view = replayReconstruction(artifact);
      expect(view.clipId).toBe(entry.clipId);
      expect(view.snapshots.length).toBe(artifact.swm.snapshots.length);
      expect(view.entities.length).toBe(finalSnapshot.entities.length);
      expect(view.eventCandidates.length).toBe(artifact.eventCandidates.length);
    }, 120_000);

    test(`gate clip ${entry.clipId}: provenance carries sha256 + license VERBATIM`, async () => {
      const { artifact } = await runGateClip(entry.clipId);
      // The normalized clip's OWN sha256 (content-addressed identity).
      expect(artifact.clip.contentSha256).toBe(entry.normalizedSha256);
      // The manifest provenance carried verbatim.
      expect(artifact.clip.provenance.sourceUrl).toBe(entry.sourceUrl);
      expect(artifact.clip.provenance.sourceSha256).toBe(entry.sourceSha256);
      expect(artifact.clip.provenance.licenseId).toBe(entry.licenseId);
      if (entry.licenseAttribution !== undefined) {
        expect(artifact.clip.provenance.licenseAttribution).toBe(entry.licenseAttribution);
      }
      // CC BY-SA requires the attribution to actually be present.
      if (entry.licenseId === "CC-BY-SA-3.0-nl") {
        expect(artifact.clip.provenance.licenseAttribution).toBeDefined();
        expect(artifact.clip.provenance.licenseAttribution).toContain("Open Beelden");
      }
    }, 120_000);
  }

  test("the committed gate media is verified against the manifest (fail-closed)", () => {
    // loadGateClip throws on drift; loading both clips here proves the
    // committed bytes match the manifest pins exactly.
    for (const entry of loadGateManifest().clips) {
      const clip = loadGateClip(entry.clipId);
      expect(clip.bytes.byteLength).toBeGreaterThan(0);
      expect(clip.provenance.sourceSha256).toBe(entry.sourceSha256);
    }
  });
});
