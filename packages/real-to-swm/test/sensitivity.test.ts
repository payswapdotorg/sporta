/**
 * J012c sensitivity tests — the reality-fidelity acceptance: two materially
 * different REAL clips (fx-001 beach soccer, CC0; fx-004 1944 newsreel,
 * CC BY-SA 3.0 nl — the committed gate media) run through the DEFAULT
 * player-detection chain (contrast-context → model-backed → heuristic-color;
 * the J012 license-clean production path) must produce MATERIALLY DIFFERENT
 * reconstructed football state: divergent entity populations, divergent
 * event-candidate populations, divergent artifact identities. An empty or
 * default SWM — the audited failure mode where both clips materialized the
 * same empty-event state and the derived realities rendered byte-identical
 * outputs — cannot pass here.
 *
 * The honesty invariants are pinned alongside:
 * - the DEFAULT chain is the production path and the used candidate is the
 *   contrast-context detector on BOTH real clips;
 * - the honest-degradation machinery is preserved: with the model-backed
 *   candidate configured as the chain head, its weights-unavailable refusal
 *   is RECORDED in the ledger and the chain falls back (never a crash, never
 *   a silent skip);
 * - per-clip determinism is pinned by the R208 determinism suite (fx-001);
 *   this file does not re-run full determinism (battery time) but asserts
 *   the two clips' artifacts are not identical inputs for derived reality.
 *
 * REAL vs FIXTURE BOUNDARY: both clips here are REAL committed footage (the
 * R208 gate media, sha256-verified fail-closed by the helpers); the
 * synthetic-diagnostic path is covered by synthetic.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { RealToSwmPipeline, buildReconstructionArtifact } from "../src/index";
import type { PipelineResult, ReconstructionArtifact } from "../src/index";
import { ffmpegAvailable, gatePolicy, loadGateClip } from "./helpers";

const available = await ffmpegAvailable();
if (!available) {
  console.warn("ffmpeg unavailable — skipping the J012c sensitivity tests");
}

/** Runs the full DEFAULT pipeline on one gate clip and builds the artifact. */
async function runDefaultChain(
  clipId: string,
): Promise<{ result: PipelineResult; artifact: ReconstructionArtifact }> {
  const clip = loadGateClip(clipId);
  const pipeline = new RealToSwmPipeline();
  const result = await pipeline.run({
    source: { ...clip.source, authorizationPolicy: gatePolicy() },
    config: {
      sessionId: `sess-j012c-${clipId}`,
      decode: { maxTotalBytes: 1024 * 1024 * 1024 },
    },
  });
  return { result, artifact: buildReconstructionArtifact(result, clip.provenance) };
}

describe.skipIf(!available)(
  "J012c reality-fidelity sensitivity (real clips, default chain)",
  () => {
    test("two materially different real clips produce MATERIALLY DIFFERENT SWM state", async () => {
      const first = await runDefaultChain("fx-001");
      const second = await runDefaultChain("fx-004");

      // --- non-vacuous identity: the artifacts are not interchangeable ----
      expect(first.artifact.contentHash).not.toBe(second.artifact.contentHash);

      // --- the DEFAULT chain used the license-clean production path --------
      for (const { result } of [first, second]) {
        const detect = result.ledger.stages.find((s) => s.stage === "detect")!;
        expect(detect.attempted[0]!.technologyId).toBe("contrast-context-detector");
        expect(detect.attempted[0]!.outcome).toBe("used");
      }

      // --- coherent SWM on both: entities with honest confidence ----------
      for (const { artifact } of [first, second]) {
        const final = artifact.swm.snapshots[artifact.swm.snapshots.length - 1]!;
        const participants = final.entities.filter((e) => e.kind === "participant");
        const balls = final.entities.filter((e) => e.kind === "ball");
        expect(participants.length).toBeGreaterThan(0);
        expect(balls.length).toBeGreaterThan(0);
        for (const entity of final.entities) {
          const position = entity.state.position!;
          expect(position.status).toBe("uncertain");
          expect(position.confidence).toBeGreaterThan(0);
          expect(position.confidence).toBeLessThanOrEqual(1);
        }
      }

      // --- MATERIALLY DIFFERENT entity populations ------------------------
      // The audited failure mode reconstructed BOTH clips into the same
      // empty/default state; the production path must diverge them.
      const firstFinal = first.artifact.swm.snapshots[first.artifact.swm.snapshots.length - 1]!;
      const secondFinal = second.artifact.swm.snapshots[second.artifact.swm.snapshots.length - 1]!;
      const firstParticipants = firstFinal.entities.filter((e) => e.kind === "participant").length;
      const secondParticipants = secondFinal.entities.filter(
        (e) => e.kind === "participant",
      ).length;
      // Entity-count divergence beyond a small tolerance (the two clips show
      // materially different numbers of trackable figures — measured: 311 vs
      // 520 at the final snapshots on the committed media).
      const countGap = Math.abs(firstParticipants - secondParticipants);
      expect(countGap).toBeGreaterThan(
        Math.max(10, 0.1 * Math.max(firstParticipants, secondParticipants)),
      );

      // --- MATERIALLY DIFFERENT event-candidate populations ----------------
      // Ball-impulse candidates come from the ball tracks; the two clips'
      // different play produce different candidate sets (measured: 15 vs 58).
      expect(first.artifact.eventCandidates.length).toBeGreaterThan(0);
      expect(second.artifact.eventCandidates.length).toBeGreaterThan(0);
      expect(first.artifact.eventCandidates.length).not.toBe(
        second.artifact.eventCandidates.length,
      );

      // --- MATERIALLY DIFFERENT per-snapshot position distributions --------
      // Mean participant position per clip (image frame — both clips refuse
      // pitch calibration, honestly ledgered): the clips' action concentrates
      // in different regions of the frame.
      const meanPosition = (artifact: ReconstructionArtifact): { x: number; y: number } => {
        const final = artifact.swm.snapshots[artifact.swm.snapshots.length - 1]!;
        const positions = final.entities
          .filter((e) => e.kind === "participant")
          .map((e) => (e.state.position as { value: { x: number; y: number } }).value);
        const mean = positions.reduce(
          (acc, p) => ({ x: acc.x + p.x / positions.length, y: acc.y + p.y / positions.length }),
          { x: 0, y: 0 },
        );
        return mean;
      };
      const firstMean = meanPosition(first.artifact);
      const secondMean = meanPosition(second.artifact);
      const positionDistance = Math.hypot(firstMean.x - secondMean.x, firstMean.y - secondMean.y);
      expect(positionDistance).toBeGreaterThan(0.02);

      // --- honest degradation preserved on both clips ----------------------
      // Both real clips refuse pitch calibration (beach sand / archival film
      // carry no pitch-green) and that refusal is RECORDED, never silent.
      for (const { artifact } of [first, second]) {
        const calibrate = artifact.ledger.stages.find((s) => s.stage === "calibrate")!;
        expect(calibrate.degradations.some((d) => d.kind === "calibration-unavailable")).toBe(true);
      }
    }, 180_000);

    test("the honest model-backed refusal + fallback ledger is preserved when the production head is configured out", async () => {
      // The model-backed candidate keeps its fail-closed refusal posture
      // (weights never committed): configured as the chain head, its
      // weights-unavailable refusal is RECORDED in the degradation ledger and
      // the chain falls back to the next candidate — degradation, never a
      // crash, never a silent skip. A short decode window keeps the battery
      // time bounded while exercising the full real-media path.
      const clip = loadGateClip("fx-001");
      const pipeline = new RealToSwmPipeline();
      const result = await pipeline.run({
        source: { ...clip.source, authorizationPolicy: gatePolicy() },
        config: {
          sessionId: "sess-j012c-fallback",
          playerDetection: ["model-backed-detector", "contrast-context-detector"],
          decode: { toMs: 2000, maxTotalBytes: 1024 * 1024 * 1024 },
        },
      });
      const detect = result.ledger.stages.find((s) => s.stage === "detect")!;
      const modelBacked = detect.attempted.find((c) => c.technologyId === "model-backed-detector")!;
      expect(modelBacked.outcome).toBe("unavailable");
      expect(modelBacked.failureClassId).toBe("model-backed.weights-unavailable");
      expect(
        detect.degradations.some(
          (d) =>
            d.kind === "candidate-unavailable" &&
            d.detail.includes("model-backed.weights-unavailable"),
        ),
      ).toBe(true);
      const contrast = detect.attempted.find(
        (c) => c.technologyId === "contrast-context-detector",
      )!;
      expect(contrast.outcome).toBe("used");
      // The fallback itself is ledgered.
      expect(
        detect.degradations.some(
          (d) => d.kind === "candidate-fallback" && d.detail.includes("model-backed-detector"),
        ),
      ).toBe(true);
      // And the run still produced a coherent SWM through the fallback.
      const artifact = buildReconstructionArtifact(result, clip.provenance);
      const final = artifact.swm.snapshots[artifact.swm.snapshots.length - 1]!;
      expect(final.entities.filter((e) => e.kind === "participant").length).toBeGreaterThan(0);
    }, 120_000);
  },
);
