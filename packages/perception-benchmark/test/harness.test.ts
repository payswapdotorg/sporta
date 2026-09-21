/**
 * L010 harness tests — the acceptance shape proven on the committed inputs:
 *
 * 1. CANDIDATE REGISTRATIONS: every registered candidate carries the
 *    Technology-Plane conventions (identity, three-way license provenance,
 *    failure classes, resources); the RF-DETR SoccerNet record carries the
 *    three-way license VERBATIM (code + checkpoint apache-2.0 per the model
 *    card; dataset lineage honestly unresolved) and its refusal classes.
 * 2. FIXTURE PROOF: the contrast-context production candidate over the
 *    synthetic-diagnostic fixture — timestamped observations, ground-truth
 *    scoring, measured latency, honest dropout, contract-conformant
 *    BenchmarkRun projection.
 * 3. REAL-MEDIA PROOF: the production candidate over BOTH real licensed
 *    gate clips (unscored, honestly labeled), and the RF-DETR candidate's
 *    honest per-frame refusal posture on real media (counted, never
 *    fabricated).
 * 4. FAIL-CLOSED: drifted/unknown clips refuse.
 *
 * CONDITIONAL on ffmpeg (the W102 integration-test convention).
 */
import { describe, expect, test } from "bun:test";
import { FfmpegDecoderAdapter } from "@sporta/decoding";
import { BenchmarkRun, TechnologyCandidate } from "@sporta/contracts";
import {
  RFDETR_SOCCERNET_CANDIDATE,
  RFDETR_SOCCERNET_LICENSE,
  contrastContextBenchmarkCandidate,
  heuristicColorBenchmarkCandidate,
  loadBenchmarkClip,
  registeredBenchmarkCandidates,
  rfdetrSoccernetBenchmarkCandidate,
  runPerceptionBenchmark,
  toContractBenchmarkRun,
} from "../src/index";

const available = await FfmpegDecoderAdapter.detect().then((probe) => probe.available);
if (!available) {
  console.warn("ffmpeg unavailable — skipping the L010 harness media tests");
}

describe("benchmark-track candidate registrations (Technology Plane conventions)", () => {
  test("every registered candidate carries identity + license + failure classes + resources", () => {
    const candidates = registeredBenchmarkCandidates();
    expect(candidates.map((candidate) => candidate.candidate.technologyId)).toEqual([
      "contrast-context-detector",
      "heuristic-color-detector",
      "hf.rfdetr.soccernet",
    ]);
    for (const candidate of candidates) {
      // The registration record parses against the frozen contract.
      expect(TechnologyCandidate.safeParse(candidate.candidate).success).toBe(true);
      expect(candidate.failureClasses.length).toBeGreaterThan(0);
      expect(candidate.resourceRequirements.gpuRequired).toBe(candidate.runnable === false);
      // The license record exists and its components are honestly labeled.
      expect(candidate.license.code).toBeDefined();
    }
  });

  test("the RF-DETR SoccerNet three-way license provenance is recorded VERBATIM", () => {
    // CODE: apache-2.0 (RF-DETR architecture, Roboflow lineage).
    expect(RFDETR_SOCCERNET_LICENSE.code.licenseId).toBe("Apache-2.0");
    expect(RFDETR_SOCCERNET_LICENSE.code.commercialUse).toBe(true);
    // CHECKPOINT: apache-2.0 per the model card (download permitted for
    // evaluation; never committed, never vendored).
    expect(RFDETR_SOCCERNET_LICENSE.model?.licenseId).toBe("Apache-2.0");
    expect(RFDETR_SOCCERNET_LICENSE.model?.commercialUse).toBe(true);
    expect(RFDETR_SOCCERNET_LICENSE.model?.reviewRef).toContain("julianzu9612/RFDETR-Soccernet");
    // DATASET: SoccerNet lineage — honestly unresolved, never fabricated.
    expect(RFDETR_SOCCERNET_LICENSE.dataset?.status).toBe("unresolved");
    expect(RFDETR_SOCCERNET_LICENSE.dataset?.commercialUse).toBeUndefined();
    expect(RFDETR_SOCCERNET_LICENSE.dataset?.licenseId).toContain("SoccerNet");
    // The refusal classes (pre-runtime honesty).
    expect(rfdetrSoccernetBenchmarkCandidate().failureClasses.map((f) => f.failureClassId)).toEqual(
      ["rfdetr-soccernet.inference-runtime-unavailable", "rfdetr-soccernet.weights-not-downloaded"],
    );
    // The registration notes state the benchmark-track posture.
    expect(RFDETR_SOCCERNET_CANDIDATE.notes).toContain("never vendored");
  });
});

describe.skipIf(!available)("L010 harness: fixture proof (synthetic-diagnostic)", () => {
  test("the production candidate produces the acceptance shape over the fixture", async () => {
    const clip = loadBenchmarkClip("synthetic-diagnostic-01");
    const run = await runPerceptionBenchmark({
      candidate: contrastContextBenchmarkCandidate(),
      clip,
      options: { stride: 25 },
    });

    // --- the L010 acceptance shape --------------------------------------
    // Benchmark identity: clip + media kind + license + candidate.
    expect(run.clip.clipId).toBe("synthetic-diagnostic-01");
    expect(run.clip.mediaKind).toBe("synthetic-diagnostic");
    expect(run.candidate.technologyId).toBe("contrast-context-detector");
    // Timestamped player observations over the sampled timeline.
    expect(run.frames.length).toBeGreaterThan(0);
    for (const frame of run.frames) {
      expect(frame.presentationMs).toBeGreaterThanOrEqual(0);
      for (const player of frame.players) {
        expect(player.label).toBe("player");
        expect(player.confidence).toBeGreaterThan(0);
        expect(player.confidence).toBeLessThanOrEqual(1);
      }
    }
    // Ground-truth scoring (the fixture has exact annotations): the
    // production path detects the discs with honest, non-vacuous quality.
    expect(run.scoring.kind).toBe("ground-truth");
    if (run.scoring.kind === "ground-truth") {
      expect(run.scoring.recall).toBeGreaterThan(0.3);
      expect(run.scoring.precision).toBeGreaterThan(0.3);
    }
    // Latency measured (honest wall clock).
    expect(run.latency.mean).toBeGreaterThanOrEqual(0);
    // Dropout accounting: no refusals; zero-detection frames counted.
    expect(run.dropout.refusedFrames).toBe(0);
    expect(run.dropout.sampledFrames).toBe(run.frames.length);
    // Pitch mapping honestly unavailable (never fabricated).
    expect(run.pitchMapping.status).toBe("unavailable");
    // The boundary note states the fixture truth.
    expect(run.boundaryNote).toContain("SYNTHETIC-DIAGNOSTIC");
    expect(run.boundaryNote).toContain("NOT real footage");
    // The contract projection parses against the frozen BenchmarkRun schema.
    const contract = toContractBenchmarkRun(run);
    expect(BenchmarkRun.safeParse(contract).success).toBe(true);
  }, 120_000);

  test("the weak baseline runs too (comparison candidate), with its own identity", async () => {
    const clip = loadBenchmarkClip("synthetic-diagnostic-01");
    const run = await runPerceptionBenchmark({
      candidate: heuristicColorBenchmarkCandidate(),
      clip,
      options: { stride: 50 },
    });
    expect(run.candidate.technologyId).toBe("heuristic-color-detector");
    expect(run.dropout.refusedFrames).toBe(0);
    // On the green-pitch fixture the color baseline also detects (its
    // calibrated envelope) — the harness records both honestly.
    expect(run.frames.length).toBeGreaterThan(0);
  }, 120_000);
});

describe.skipIf(!available)("L010 harness: real-media proof (licensed gate clips)", () => {
  test("the production candidate records unscored observations on fx-001 (CC0)", async () => {
    const clip = loadBenchmarkClip("fx-001");
    const run = await runPerceptionBenchmark({
      candidate: contrastContextBenchmarkCandidate(),
      clip,
      options: { stride: 50 },
    });
    expect(run.clip.mediaKind).toBe("real-footage");
    expect(run.clip.licenseId).toBe("CC0-1.0");
    // Honest unscored recording.
    expect(run.scoring.kind).toBe("unscored");
    // Timestamped observations exist on the real timeline.
    expect(run.frames.length).toBeGreaterThan(0);
    const totalPlayers = run.frames.reduce((acc, frame) => acc + frame.players.length, 0);
    expect(totalPlayers).toBeGreaterThan(0);
    // The boundary note states the real-media truth.
    expect(run.boundaryNote).toContain("REAL footage");
    expect(run.boundaryNote).toContain("unscored");
  }, 120_000);

  test("the production candidate records unscored observations on fx-004 (CC BY-SA 3.0 nl, attribution carried)", async () => {
    const clip = loadBenchmarkClip("fx-004");
    const run = await runPerceptionBenchmark({
      candidate: contrastContextBenchmarkCandidate(),
      clip,
      options: { stride: 100 },
    });
    expect(run.clip.licenseId).toBe("CC-BY-SA-3.0-nl");
    expect(run.clip.licenseAttribution).toContain("Open Beelden");
    expect(run.scoring.kind).toBe("unscored");
    const totalPlayers = run.frames.reduce((acc, frame) => acc + frame.players.length, 0);
    expect(totalPlayers).toBeGreaterThan(0);
  }, 120_000);

  test("the RF-DETR SoccerNet candidate REFUSES per frame on real media — counted, never fabricated", async () => {
    const clip = loadBenchmarkClip("fx-001");
    const run = await runPerceptionBenchmark({
      candidate: rfdetrSoccernetBenchmarkCandidate(),
      clip,
      options: { stride: 100 },
    });
    // The honest pre-runtime posture: every sampled frame refused with the
    // documented class; ZERO fabricated detections.
    expect(run.dropout.refusedFrames).toBe(run.dropout.sampledFrames);
    expect(run.dropout.refusalClasses).toEqual(["rfdetr-soccernet.inference-runtime-unavailable"]);
    for (const frame of run.frames) {
      expect(frame.players).toEqual([]);
      expect(frame.refusalClass).toBe("rfdetr-soccernet.inference-runtime-unavailable");
    }
    // The boundary note states the runtime truth.
    expect(run.boundaryNote).toContain("REFUSED per frame");
    expect(run.boundaryNote).toContain("W303/L011");
    // The contract projection counts the failures honestly.
    const contract = toContractBenchmarkRun(run);
    expect(contract.failureSummary.failures).toBe(run.dropout.sampledFrames);
    expect(contract.failureSummary.failureExamples.join("; ")).toContain(
      "rfdetr-soccernet.inference-runtime-unavailable",
    );
  }, 120_000);
});

describe("L010 fail-closed clip loading", () => {
  test("an unknown clip id refuses", () => {
    expect(() => loadBenchmarkClip("not-a-clip")).toThrow(/not committed/);
  });
});
