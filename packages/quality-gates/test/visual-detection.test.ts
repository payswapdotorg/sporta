/**
 * The visual-correctness detection proofs (the W503/W605 convention): every
 * verdict the R307 gate claims to produce is PROVEN by injection — real
 * defects through the source packages' own injector seams (wrong score,
 * stuck clock, swapped identity tokens, out-of-order markers, scene-state
 * drift), a REAL encoded frame-flicker artifact (one inverted frame, real
 * encode), a fixture-tier artifact, a missing decode toolchain, a missing
 * conformance envelope, and a corrupted artifact. A gate that cannot
 * detect its failure mode is rejected; a gate that cannot run counts as
 * FAIL (the W803 posture).
 */
import { describe, expect, test } from "bun:test";
import {
  buildCorrectionsMatchFixture,
  injectOutOfOrderMarkers,
  injectSceneStateDrift,
  injectStuckClock,
  injectSwappedStyleTokens,
  injectWrongScoreClaim,
} from "@sporta/scene-evaluation";
import {
  FixtureFrameEncoder,
  bridgeRgbFrames,
  createFfmpegFrameEncoder,
  type EncodedArtifact,
} from "@sporta/encoding";
import {
  SPIKE_ABS_FLOOR,
  SPIKE_RATIO,
  buildDefaultVisualArtifact,
  buildDefaultVisualEnvelope,
  buildVisualFlickerArtifact,
  evaluateVisualCorrectness,
  runVisualCorrectnessGate,
  type VisualFixtureEnvelope,
} from "../src/index";
import { evaluateReleaseReadiness, parseDemoRecord } from "../src/index";

const encoder = createFfmpegFrameEncoder();
const available = encoder !== null;

/** The shared clean envelope (deterministic; built once per test group). */
function cleanEnvelope(): VisualFixtureEnvelope {
  return buildDefaultVisualEnvelope();
}

/** A fixture-tier artifact (NOT video — the honest test tier). */
function fixtureTierArtifact(): EncodedArtifact {
  const frames = Array.from({ length: 8 }, (_, i) => {
    const frame = new Uint8Array(320 * 180 * 3);
    for (let p = 0; p < frame.length; p += 3) {
      frame[p] = (p + i * 7) % 256;
      frame[p + 1] = (p * 3 + i) % 256;
      frame[p + 2] = (p * 7 + i * 3) % 256;
    }
    return frame;
  });
  return bridgeRgbFrames({
    encoder: new FixtureFrameEncoder(),
    frames,
    width: 320,
    height: 180,
    fps: 25,
    origin: { rendererId: "fixture-tier", rendererVersion: "0.0.0", bridge: "raw-frames" },
    sessionId: "sess-visual-fixture-tier",
  });
}

describe("detection — the scene axes bite (the real W605 injectors)", () => {
  test("a WRONG SCORE claim FAILs the score axis and the verdict", () => {
    const envelope = cleanEnvelope();
    envelope.scene = injectWrongScoreClaim(envelope.scene, { frameIndex: 0 });
    const report = evaluateVisualCorrectness(buildDefaultVisualArtifact(encoder!), envelope);
    const score = report.axes.find((axis) => axis.id === "score")!;
    expect(score.status).toBe("FAIL");
    expect(report.verdict.pass).toBe(false);
    expect(report.verdict.reason).toContain("score");
  });

  test("a STUCK CLOCK FAILs the clock axis and the verdict", () => {
    const envelope = cleanEnvelope();
    envelope.scene = injectStuckClock(envelope.scene);
    const report = evaluateVisualCorrectness(buildDefaultVisualArtifact(encoder!), envelope);
    const clock = report.axes.find((axis) => axis.id === "clock")!;
    expect(clock.status).toBe("FAIL");
    expect(report.verdict.pass).toBe(false);
  });

  test("SWAPPED IDENTITY TOKENS FAIL the player-identity-continuity axis", () => {
    const envelope = cleanEnvelope();
    // The corrections fixture (an existing W605 fixture) carries the
    // canonical swap pair scene-evaluation's own detection tests use.
    envelope.scene = injectSwappedStyleTokens(buildCorrectionsMatchFixture(), {
      entityA: "striker-9",
      entityB: "teleport-3",
    });
    const report = evaluateVisualCorrectness(buildDefaultVisualArtifact(encoder!), envelope);
    const identity = report.axes.find((axis) => axis.id === "player-identity-continuity")!;
    expect(identity.status).toBe("FAIL");
    expect(report.verdict.pass).toBe(false);
  });

  test("OUT-OF-ORDER MARKERS FAIL the event-ordering axis", () => {
    const envelope = cleanEnvelope();
    // The corrections fixture carries two-marker frames (frame 17 is the
    // canonical choice from scene-evaluation's own detection tests).
    envelope.scene = injectOutOfOrderMarkers(buildCorrectionsMatchFixture(), { frameIndex: 17 });
    const report = evaluateVisualCorrectness(buildDefaultVisualArtifact(encoder!), envelope);
    const ordering = report.axes.find((axis) => axis.id === "event-ordering")!;
    expect(ordering.status).toBe("FAIL");
    expect(report.verdict.pass).toBe(false);
  });

  test("SCENE-STATE DRIFT FAILs the ball-continuity axis", () => {
    const envelope = cleanEnvelope();
    envelope.scene = injectSceneStateDrift(envelope.scene, {
      frameIndex: 2,
      entityId: "ball-1",
      dxMeters: 3,
    });
    const report = evaluateVisualCorrectness(buildDefaultVisualArtifact(encoder!), envelope);
    const ball = report.axes.find((axis) => axis.id === "ball-continuity")!;
    expect(ball.status).toBe("FAIL");
    expect(report.verdict.pass).toBe(false);
  });
});

describe.skipIf(!available)("detection — the temporal axis bites (real encoded defects)", () => {
  test("a REAL encoded FRAME FLICKER FAILs the temporal axis (zero-threshold)", () => {
    const envelope = cleanEnvelope();
    const report = evaluateVisualCorrectness(buildVisualFlickerArtifact(encoder!), envelope);
    const temporal = report.axes.find((axis) => axis.id === "temporal-stability")!;
    expect(temporal.status).toBe("FAIL");
    expect(temporal.reason).toContain("spike pair");
    expect(report.temporalStability.artifactPlane!.spikePairCount).toBe(2);
    expect(report.verdict.pass).toBe(false);
  });

  test("the clean artifact measures ZERO spike pairs (the measured baseline)", () => {
    const envelope = cleanEnvelope();
    const report = evaluateVisualCorrectness(buildDefaultVisualArtifact(encoder!), envelope);
    expect(report.temporalStability.artifactPlane!.spikePairCount).toBe(0);
    expect(report.temporalStability.artifactPlane!.framesDecoded).toBe(40);
    expect(report.temporalStability.artifactPlane!.pairsCompared).toBe(39);
    expect(report.temporalStability.artifactPlane!.meanAbsDiffMax).toBeLessThan(10);
    expect(report.verdict.pass).toBe(true);
  });
});

describe.skipIf(!available)(
  "detection — not-runnable axes count as FAIL (the W803 posture)",
  () => {
    test("a FIXTURE-TIER artifact (not video) → temporal NOT-RUNNABLE → verdict FAIL", () => {
      const report = evaluateVisualCorrectness(fixtureTierArtifact(), cleanEnvelope());
      const temporal = report.axes.find((axis) => axis.id === "temporal-stability")!;
      expect(temporal.status).toBe("NOT-RUNNABLE");
      expect(report.temporalStability.artifactPlane).toBeNull();
      expect(report.accounting.notRunnableCount).toBeGreaterThan(0);
      expect(report.verdict.pass).toBe(false);
    });

    test("a MISSING decode toolchain → temporal NOT-RUNNABLE → verdict FAIL", () => {
      const report = evaluateVisualCorrectness(
        buildDefaultVisualArtifact(encoder!),
        cleanEnvelope(),
        { ffmpegPath: "/nonexistent/ffmpeg-for-visual-gate" },
      );
      const temporal = report.axes.find((axis) => axis.id === "temporal-stability")!;
      expect(temporal.status).toBe("NOT-RUNNABLE");
      expect(report.verdict.pass).toBe(false);
    });

    test("an envelope with NO conformance reports → renderer-conformance NOT-RUNNABLE → FAIL", () => {
      const envelope = cleanEnvelope();
      const without = { ...envelope, conformance: [] };
      const report = evaluateVisualCorrectness(buildDefaultVisualArtifact(encoder!), without);
      const conformance = report.axes.find((axis) => axis.id === "renderer-conformance")!;
      expect(conformance.status).toBe("NOT-RUNNABLE");
      expect(report.verdict.pass).toBe(false);
    });

    test("a CORRUPTED artifact (hash mismatch) FAILs the artifact-integrity axis", () => {
      const artifact = buildDefaultVisualArtifact(encoder!);
      const corrupted: EncodedArtifact = {
        ...artifact,
        bytes: new Uint8Array([...artifact.bytes, 1, 2, 3]),
      };
      const report = evaluateVisualCorrectness(corrupted, cleanEnvelope());
      const integrity = report.axes.find((axis) => axis.id === "artifact-integrity")!;
      expect(integrity.status).toBe("FAIL");
      expect(report.verdict.pass).toBe(false);
    });
  },
);

describe.skipIf(!available)("the release integration (the 4th blocking gate)", () => {
  test("a visual gate FAIL FAILs the release verdict", () => {
    const gate = runVisualCorrectnessGate({
      artifactSupplier: () => buildVisualFlickerArtifact(encoder!),
    });
    expect(gate.status).toBe("FAIL");
    expect(gate.summary.spikePairCount).toBe(2);
    const report = evaluateReleaseReadiness({
      humanRecord: parseDemoRecord(),
      visualGate: () => gate,
    });
    expect(report.verdict.outcome).toBe("FAIL");
    expect(report.verdict.reason).toContain("visual-correctness");
  });

  test("a visual gate NOT-RUNNABLE FAILs the release verdict (never a silent skip)", () => {
    const report = evaluateReleaseReadiness({
      humanRecord: parseDemoRecord(),
      visualGate: () => ({
        id: "visual-correctness",
        source: "@sporta/encoding",
        status: "NOT-RUNNABLE",
        reason: "simulated unavailable toolchain",
        summary: {},
        blocking: true,
      }),
    });
    expect(report.verdict.outcome).toBe("FAIL");
    expect(report.accounting.notRunnableCount).toBe(1);
  });
});

describe.skipIf(!available)("determinism + the pinned constants", () => {
  test("the same artifact + envelope yield a JSON-byte-identical report", () => {
    const artifact = buildDefaultVisualArtifact(encoder!);
    const envelope = cleanEnvelope();
    const a = JSON.stringify(evaluateVisualCorrectness(artifact, envelope));
    const b = JSON.stringify(evaluateVisualCorrectness(artifact, envelope));
    expect(a).toBe(b);
  });

  test("the spike constants are pinned (the GATES.md §7 measured-evidence table)", () => {
    expect(SPIKE_ABS_FLOOR).toBe(10);
    expect(SPIKE_RATIO).toBe(8);
  });

  test("the default artifact's geometry is pinned (small + fast + real)", () => {
    const artifact = buildDefaultVisualArtifact(encoder!);
    expect(artifact.manifest.geometry).toEqual({
      widthPx: 320,
      heightPx: 180,
      fps: 25,
      frameCount: 40,
      durationMs: 1600,
    });
  });

  test("the artifact's SWM provenance ties to the envelope's scene fixture family", () => {
    const report = evaluateVisualCorrectness(buildDefaultVisualArtifact(encoder!), cleanEnvelope());
    expect(report.swmProvenance.artifact).not.toBeNull();
    expect(report.swmProvenance.artifact!.snapshotVersion).toBe(
      report.swmProvenance.envelopeScene!.snapshotVersion,
    );
    expect(report.artifact.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
