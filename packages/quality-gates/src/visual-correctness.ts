/**
 * THE visual correctness gate (R307): the deterministic per-axis verdict
 * over ONE encoded artifact (an R306 `EncodedArtifact`) evaluated against
 * the MVP fixture envelope — the existing clean match fixtures plus the
 * R301/R303/R304 conformance fixtures (never new fixtures).
 *
 * ## Composition (the W803 rule: re-implement NOTHING, compose the REAL
 * evaluations; a gate verdict is a real evaluation's own verdict)
 *
 * - **score / clock / player-identity-continuity / event-ordering /
 *   ball-continuity** — `@sporta/scene-evaluation`'s real
 *   `evaluateSceneOutput` over the envelope's scene fixture (the W605
 *   clean match fixture): each axis IS that report's own dimension
 *   verdict (all-zero thresholds — the renderer is deterministic); ball
 *   continuity is the scene-state dimension (the scene-state truth:
 *   per-entity entry comparison incl. the ball's height/carried
 *   continuity).
 * - **temporal-stability** — the `@sporta/renderer-evaluation` POSTURE
 *   (frame-to-frame identity/palette stability MEASURED, never
 *   asserted), composed from TWO planes:
 *   (a) the REAL W503 evaluation over the envelope's temporal fixture
 *   (`renderW503CleanFixture` — identity flicker / style-token stability
 *   / geometry drift measured on the render-document plane, its own
 *   verdict and numbers);
 *   (b) the ARTIFACT plane: the artifact's actual MP4 frames decoded
 *   (real ffmpeg rawvideo decode) and MEASURED — per-pair mean absolute
 *   RGB difference (min/median/max, numbers with provenance: which
 *   frames, which metric) plus the zero-threshold flicker signature
 *   (spike pairs — see below).
 * - **artifact-integrity** — the artifact's own container manifest
 *   validated, its bytes re-hashed to the recorded content hash, and the
 *   ffprobe cross-check (codec/profile/geometry) — the R306 verify plane.
 * - **renderer-conformance** — the envelope's R301/R303/R304 conformance
 *   reports (the W501 harness over the real plugins — the existing
 *   conformance fixtures): every supplied report must have passed.
 *
 * ## The flicker signature (the zero-threshold, with measured evidence)
 *
 * A pair `(i, i+1)` of decoded frames is a SPIKE pair iff
 * `pairDiff(i, i+1) > max(SPIKE_ABS_FLOOR, SPIKE_RATIO × medianPairDiff)`.
 * The gate's temporal axis requires `spikePairCount === 0` — a
 * zero-threshold, justified by the MEASURED evidence (recorded in
 * docs/GATES.md §7): across the clean MVP envelope artifacts (game-3d,
 * anime-npr, tactical) the max pair diff measured ≤ 4.12 with ratio ≤
 * 2.40 (zero spike pairs); the injected frame-flicker fixtures (one
 * inverted frame) measured max ≥ 58.6 with ratio ≥ 34.2 (exactly 2 spike
 * pairs — the two pairs around the corrupted frame). The constants sit
 * between with >4× margins on both sides.
 *
 * ## The W803 accounting posture (never silent)
 *
 * Per-axis statuses are PASS / FAIL / NOT-RUNNABLE; `axisCount = pass +
 * fail + not-runnable` reconciles on every report; **an axis that cannot
 * run counts as FAIL for the verdict** (a fixture-tier artifact whose
 * bytes are not video → the artifact-plane measurement is NOT-RUNNABLE →
 * the verdict FAILs; a missing ffmpeg → decode NOT-RUNNABLE → FAIL). The
 * artifact's content hash is pinned in the report.
 */
import type { ConformanceReport } from "@sporta/renderer-contract";
import { runConformance } from "@sporta/renderer-contract";
import {
  createAnimeNprRenderer,
  createGame3DRenderer,
  Software3DEngine,
} from "@sporta/renderer-3d";
import { createTacticalRenderer } from "@sporta/renderer-tactical";
import type { SceneEvaluationInput } from "@sporta/scene-evaluation";
import type { WorldEventStreamEntry, WorldSnapshot } from "@sporta/contracts";
import { buildCleanMatchFixture, evaluateSceneOutput } from "@sporta/scene-evaluation";
import { evaluateRenderOutput, renderW503CleanFixture } from "@sporta/renderer-evaluation";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EncodingError,
  bridgeGameFrameOutput,
  bridgeRgbFrames,
  createFfmpegFrameEncoder,
  decodeEncodedFrames,
  probeEncodedArtifact,
  sha256Of,
  validateEncodedManifest,
  type EncodedArtifact,
  type FrameEncoderPort,
  type GameEngineFrameOutput,
} from "@sporta/encoding";
import type { GateResult } from "./gates";

/** The report schema tag (versioned with the report shape). */
export const VISUAL_REPORT_SCHEMA_TAG = "sporta/quality-gates/visual-correctness@1";

/** The spike-pair absolute floor (see the module docs for the measured evidence). */
export const SPIKE_ABS_FLOOR = 10;

/** The spike-pair ratio over the median pair diff (see the measured evidence). */
export const SPIKE_RATIO = 8;

/** The spike definition, one place (recorded in every report). */
export const SPIKE_DEFINITION =
  `pairDiff > max(${SPIKE_ABS_FLOOR}, ${SPIKE_RATIO} × medianPairDiff), where pairDiff is the ` +
  `mean absolute per-channel RGB difference (0-255) between consecutive decoded frames`;

/** The temporal-stability fixture's shape (referenced through the W503 seam). */
export type TemporalFixture = ReturnType<typeof renderW503CleanFixture>;

/** The MVP fixture envelope: the existing fixtures, composed (never new ones). */
export interface VisualFixtureEnvelope {
  /** The scene-correctness fixture (the W605 clean match fixture convention). */
  scene: SceneEvaluationInput;
  /** The temporal-stability fixture (the W503 clean fixture). */
  temporal: TemporalFixture;
  /** The R301/R303/R304 conformance reports (the W501 harness over the real plugins). */
  conformance: readonly ConformanceReport[];
}

/** One axis's executed result. */
export interface VisualAxisResult {
  id:
    | "score"
    | "clock"
    | "player-identity-continuity"
    | "event-ordering"
    | "ball-continuity"
    | "temporal-stability"
    | "artifact-integrity"
    | "renderer-conformance";
  status: "PASS" | "FAIL" | "NOT-RUNNABLE";
  reason?: string;
  /** Measured values carried VERBATIM from the source evaluations (evidence). */
  evidence: Record<string, number | string | boolean>;
}

/** The artifact-plane temporal measurements (numbers with provenance). */
export interface ArtifactTemporalMeasurements {
  framesDecoded: number;
  pairsCompared: number;
  meanAbsDiffMin: number;
  meanAbsDiffMedian: number;
  meanAbsDiffMax: number;
  spikePairCount: number;
  spikeDefinition: string;
  provenance: string;
}

/** The full visual-correctness report (deterministic; no wall clock). */
export interface VisualCorrectnessReport {
  schemaTag: string;
  artifact: {
    /** The artifact's sha-256 content hash — PINNED in every report. */
    contentHash: string;
    byteSize: number;
    kind: "mp4" | "fixture";
    bridge: string;
    sourceRendererId: string;
    sourceRendererVersion: string;
    encoderKind: string;
    frameCount: number;
    widthPx: number;
    heightPx: number;
    fps: number;
    durationMs: number;
  };
  fixtureEnvelope: {
    sceneSessionId: string;
    temporalSessionId: string;
    conformanceRendererIds: string[];
  };
  /** The artifact's SWM provenance tie + the envelope's own SWM values (evidence). */
  swmProvenance: {
    artifact: { snapshotVersion: number; lastEventSequence: number } | null;
    envelopeScene: { snapshotVersion: number; lastEventSequence: number } | null;
  };
  axes: VisualAxisResult[];
  temporalStability: {
    /** The REAL W503 evaluation's own verdict + numbers (the render-document plane). */
    w503: {
      verdictPass: boolean;
      identityFlickerCount: number;
      styleStabilityRatio: number;
      styleByteStabilityRatio: number | null;
      geometryJumpCount: number;
      checkCount: number;
      failingCheckCount: number;
    };
    /** The artifact-plane measurements (decoded MP4 frames). */
    artifactPlane: ArtifactTemporalMeasurements | null;
  };
  accounting: {
    axisCount: number;
    passCount: number;
    failCount: number;
    notRunnableCount: number;
    /** axisCount === pass + fail + not-runnable (never silent). */
    reconciles: boolean;
  };
  verdict: {
    /** PASS iff every axis PASSes (a NOT-RUNNABLE axis FAILs the verdict). */
    pass: boolean;
    reason?: string;
  };
}

/** Options for {@link evaluateVisualCorrectness}. */
export interface VisualCorrectnessOptions {
  /** The ffmpeg binary for the artifact-plane decode (default "ffmpeg"). */
  ffmpegPath?: string;
}

/** A defensive per-axis runner: a throwing evaluation is NOT-RUNNABLE (the W803 posture). */
function safeAxis(id: VisualAxisResult["id"], run: () => VisualAxisResult): VisualAxisResult {
  try {
    return run();
  } catch (error) {
    return {
      id,
      status: "NOT-RUNNABLE",
      reason: `the axis evaluation threw: ${(error as Error).message}`,
      evidence: {},
    };
  }
}

/** Measures the artifact plane: decodes every frame + the pair-diff + spike statistics. */
function measureArtifactPlane(
  artifact: EncodedArtifact,
  options: VisualCorrectnessOptions,
): ArtifactTemporalMeasurements {
  const frames = decodeEncodedFrames(artifact, { ffmpegPath: options.ffmpegPath });
  if (frames.length < 2) {
    throw new EncodingError(
      "media-invalid",
      "verify-failed",
      "the artifact has fewer than 2 frames (no pairs to measure)",
    );
  }
  const diffs: number[] = [];
  for (let i = 1; i < frames.length; i += 1) {
    let sum = 0;
    const a = frames[i - 1]!;
    const b = frames[i]!;
    for (let p = 0; p < a.length; p += 1) {
      sum += Math.abs(a[p]! - b[p]!);
    }
    diffs.push(sum / a.length);
  }
  const sorted = [...diffs].sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const spikeThreshold = Math.max(SPIKE_ABS_FLOOR, SPIKE_RATIO * median);
  const spikePairCount = diffs.filter((d) => d > spikeThreshold).length;
  return {
    framesDecoded: frames.length,
    pairsCompared: diffs.length,
    meanAbsDiffMin: round(sorted[0]!),
    meanAbsDiffMedian: round(median),
    meanAbsDiffMax: round(sorted[sorted.length - 1]!),
    spikePairCount,
    spikeDefinition: SPIKE_DEFINITION,
    provenance:
      `decoded rgb24 frames 0..${frames.length - 1} of the artifact (sha-256 ` +
      `${artifact.contentHash.slice(0, 16)}…); pairDiff = mean |a−b| over all RGB channels (0-255)`,
  };
}

/** Rounds a measurement to a stable serialization domain. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * THE visual correctness gate (R307): `evaluateVisualCorrectness(artifact,
 * fixtureEnvelope)` → the deterministic per-axis report. Pure given its
 * inputs (the artifact + the envelope documents + the decode toolchain —
 * no wall clock, no randomness): the same inputs yield a deep-equal,
 * JSON-byte-identical report.
 */
export function evaluateVisualCorrectness(
  artifact: EncodedArtifact,
  envelope: VisualFixtureEnvelope,
  options: VisualCorrectnessOptions = {},
): VisualCorrectnessReport {
  const axes: VisualAxisResult[] = [];

  // --- The scene-correctness axes (the REAL W605 evaluation, its own verdicts).
  const sceneAxis = (
    id: VisualAxisResult["id"],
    dimension: "score" | "clock" | "identity" | "ordering" | "sceneState",
  ): VisualAxisResult =>
    safeAxis(id, () => {
      const report = evaluateSceneOutput({ ...envelope.scene });
      const verdict = report.dimensions[dimension];
      return {
        id,
        status: verdict.pass ? "PASS" : "FAIL",
        ...(verdict.pass
          ? {}
          : {
              reason: `${verdict.failures.length} failing check(s): ${verdict.failures
                .map((f) => f.metric)
                .slice(0, 5)
                .join(", ")}`,
            }),
        evidence: {
          checkCount: verdict.checks.length,
          failingCheckCount: verdict.failures.length,
          schemaTag: report.schemaTag,
        },
      };
    });
  axes.push(sceneAxis("score", "score"));
  axes.push(sceneAxis("clock", "clock"));
  axes.push(sceneAxis("player-identity-continuity", "identity"));
  axes.push(sceneAxis("event-ordering", "ordering"));
  axes.push(sceneAxis("ball-continuity", "sceneState"));

  // --- The temporal-stability axis (the W503 posture on two planes).
  let artifactPlane: ArtifactTemporalMeasurements | null = null;
  const temporalAxis = safeAxis("temporal-stability", () => {
    const w503 = evaluateRenderOutput(envelope.temporal);
    const plane = measureArtifactPlane(artifact, options);
    artifactPlane = plane;
    const reasons: string[] = [];
    if (!w503.verdict.pass) {
      reasons.push(`the W503 fixture evaluation failed ${w503.verdict.failures.length} check(s)`);
    }
    if (plane.spikePairCount !== 0) {
      reasons.push(`${plane.spikePairCount} spike pair(s) — frame flicker (zero-threshold)`);
    }
    return {
      id: "temporal-stability",
      status: reasons.length === 0 ? "PASS" : "FAIL",
      ...(reasons.length === 0 ? {} : { reason: reasons.join("; ") }),
      evidence: {
        w503Verdict: w503.verdict.pass,
        w503FailingChecks: w503.verdict.failures.length,
        framesDecoded: plane.framesDecoded,
        pairsCompared: plane.pairsCompared,
        meanAbsDiffMax: plane.meanAbsDiffMax,
        spikePairCount: plane.spikePairCount,
      },
    };
  });
  axes.push(temporalAxis);

  // --- The artifact-integrity axis (the R306 verify plane).
  axes.push(
    safeAxis("artifact-integrity", (): VisualAxisResult => {
      const manifestCheck = validateEncodedManifest(artifact.manifest);
      if (!manifestCheck.ok) {
        return {
          id: "artifact-integrity",
          status: "FAIL",
          reason: `the container manifest failed validation: ${manifestCheck.issues.slice(0, 3).join("; ")}`,
          evidence: { manifestValid: false },
        };
      }
      const measuredHash = sha256Of(artifact.bytes);
      if (measuredHash !== artifact.contentHash || measuredHash !== artifact.manifest.contentHash) {
        return {
          id: "artifact-integrity",
          status: "FAIL",
          reason: "the artifact's bytes do not re-hash to the recorded content hash",
          evidence: { declared: artifact.contentHash, measured: measuredHash },
        };
      }
      const probe = probeEncodedArtifact(artifact, { ffmpegPath: options.ffmpegPath });
      return {
        id: "artifact-integrity",
        status: "PASS",
        evidence: {
          manifestValid: true,
          contentHashVerified: true,
          probeCodec: probe.codecName,
          probeProfile: probe.profile,
          probeFrameCount: probe.frameCount,
          probeDurationMs: probe.durationMs,
        },
      };
    }),
  );

  // --- The renderer-conformance axis (the R301/R303/R304 conformance fixtures).
  axes.push(
    safeAxis("renderer-conformance", (): VisualAxisResult => {
      if (envelope.conformance.length === 0) {
        return {
          id: "renderer-conformance",
          status: "NOT-RUNNABLE",
          reason:
            "the envelope carries no conformance reports (the R301/R303/R304 conformance fixtures are part of the MVP envelope)",
          evidence: { reportCount: 0 },
        };
      }
      const failing = envelope.conformance.filter((report) => !report.passed);
      return {
        id: "renderer-conformance",
        status: failing.length === 0 ? "PASS" : "FAIL",
        ...(failing.length === 0
          ? {}
          : {
              reason: `${failing.length} conformance report(s) failed: ${failing.map((r) => r.plugin.rendererId).join(", ")}`,
            }),
        evidence: {
          reportCount: envelope.conformance.length,
          failedReportCount: failing.length,
          rendererIds: envelope.conformance.map((r) => r.plugin.rendererId).join(","),
        },
      };
    }),
  );

  // --- The accounting (never silent; a NOT-RUNNABLE axis FAILs the verdict).
  const passCount = axes.filter((axis) => axis.status === "PASS").length;
  const failCount = axes.filter((axis) => axis.status === "FAIL").length;
  const notRunnableCount = axes.filter((axis) => axis.status === "NOT-RUNNABLE").length;
  const axisCount = axes.length;
  const reconciles = axisCount === passCount + failCount + notRunnableCount;
  const notGreen = axes.filter((axis) => axis.status !== "PASS");

  // The envelope's scene fixture is the W605 INPUT document (unknown-typed
  // fields by contract); the SWM evidence readers guard at runtime — a
  // malformed envelope shape is reported as absent evidence, never a crash.
  const sceneSnapshots = Array.isArray(envelope.scene.snapshots)
    ? (envelope.scene.snapshots as unknown[])
    : [];
  const sceneEvents = Array.isArray(envelope.scene.eventStream)
    ? (envelope.scene.eventStream as unknown[])
    : [];
  const lastSnapshot = readSnapshotWatermark(sceneSnapshots[sceneSnapshots.length - 1]);
  const lastEvent = readEventSequence(sceneEvents[sceneEvents.length - 1]);
  const sceneSessionId = readSessionIdOfOutput(envelope.scene.output);

  const report: VisualCorrectnessReport = {
    schemaTag: VISUAL_REPORT_SCHEMA_TAG,
    artifact: {
      contentHash: artifact.contentHash,
      byteSize: artifact.byteSize,
      kind: artifact.kind,
      bridge: artifact.manifest.bridge,
      sourceRendererId: artifact.manifest.source.rendererId,
      sourceRendererVersion: artifact.manifest.source.rendererVersion,
      encoderKind: artifact.manifest.encoder.kind,
      frameCount: artifact.manifest.geometry.frameCount,
      widthPx: artifact.manifest.geometry.widthPx,
      heightPx: artifact.manifest.geometry.heightPx,
      fps: artifact.manifest.geometry.fps,
      durationMs: artifact.manifest.geometry.durationMs,
    },
    fixtureEnvelope: {
      sceneSessionId,
      temporalSessionId: envelope.temporal.result.sessionId,
      conformanceRendererIds: envelope.conformance.map((r) => r.plugin.rendererId),
    },
    swmProvenance: {
      artifact: artifact.manifest.swm === null ? null : { ...artifact.manifest.swm },
      envelopeScene:
        lastSnapshot === null
          ? null
          : {
              snapshotVersion: lastSnapshot.snapshotVersion,
              lastEventSequence: lastEvent === null ? 0 : lastEvent.lastEventSequence,
            },
    },
    axes,
    temporalStability: {
      w503: w503SummaryOf(envelope),
      artifactPlane,
    },
    accounting: { axisCount, passCount, failCount, notRunnableCount, reconciles },
    verdict: {
      pass: notGreen.length === 0,
      ...(notGreen.length === 0
        ? {}
        : {
            reason: notGreen
              .map((axis) => `${axis.id}=${axis.status}${axis.reason ? ` (${axis.reason})` : ""}`)
              .join("; "),
          }),
    },
  };
  return report;
}

/** The W503 summary (the real evaluation's numbers, verbatim). */
function w503SummaryOf(
  envelope: VisualFixtureEnvelope,
): VisualCorrectnessReport["temporalStability"]["w503"] {
  const w503 = evaluateRenderOutput(envelope.temporal);
  return {
    verdictPass: w503.verdict.pass,
    identityFlickerCount: w503.identity.flickerCount,
    styleStabilityRatio: w503.identity.styleStabilityRatio,
    styleByteStabilityRatio: w503.styleBytes?.stabilityRatio ?? null,
    geometryJumpCount: w503.geometry.jumpCount,
    checkCount: w503.verdict.checks.length,
    failingCheckCount: w503.verdict.failures.length,
  };
}

// ---------------------------------------------------------------------------
// The default MVP envelope + artifact (the existing fixtures, composed)
// ---------------------------------------------------------------------------

/** The canonical geometry of the default visual artifact (small + fast + real). */
export const DEFAULT_VISUAL_GEOMETRY = {
  widthPx: 320,
  heightPx: 180,
  fps: 25,
  durationMs: 1_600,
} as const;

/** Builds the default visual artifact: the clean match fixture's SWM through the REAL engine + REAL encode. */
export function buildDefaultVisualArtifact(encoder?: FrameEncoderPort): EncodedArtifact {
  const resolved = encoder ?? createFfmpegFrameEncoder() ?? undefined;
  if (resolved === undefined) {
    throw new EncodingError(
      "resource-limit",
      "encoder-unavailable",
      "the default visual artifact requires a working ffmpeg/libx264 encoder",
    );
  }
  const fixture = buildCleanMatchFixture();
  return encodeSceneThroughEngine({
    snapshot: fixture.snapshots[fixture.snapshots.length - 1]!,
    eventStream: fixture.eventStream,
    renderingStyle: "stylized-3d",
    bridge: "game-3d",
    encoder: resolved,
  });
}

/** Encodes one scene (snapshot + event tail) through the REAL Software3DEngine + bridge. */
export function encodeSceneThroughEngine(options: {
  snapshot: WorldSnapshot;
  /** The event tail (readonly at this seam; the engine's own admission validates it). */
  eventStream: readonly WorldEventStreamEntry[];
  renderingStyle: "stylized-3d" | "cel-shaded";
  bridge: "game-3d" | "anime-npr";
  encoder: FrameEncoderPort;
  geometry?: { widthPx: number; heightPx: number; fps: number; durationMs: number };
}): EncodedArtifact {
  const geometry = options.geometry ?? DEFAULT_VISUAL_GEOMETRY;
  const stagingRoot = mkdtempSync(join(tmpdir(), "sporta-visual-gate-"));
  try {
    const engine = new Software3DEngine({ stagingRoot });
    const handle = engine.buildScene(
      {
        schemaVersion: "1.1",
        sessionId: options.snapshot.sessionId,
        snapshotVersion: options.snapshot.watermark.sequence,
        renderingStyle: options.renderingStyle,
      },
      options.snapshot,
      [...options.eventStream],
    );
    const rendered = engine.renderScene({
      schemaVersion: "1.1",
      sceneId: handle.sceneId,
      outputProfile: { ...geometry, format: "frames-rgb24" },
      presentation: { camera: "aerial-follow", seed: "11" },
    });
    const output = rendered.output as GameEngineFrameOutput;
    const artifact = bridgeGameFrameOutput({
      encoder: options.encoder,
      frameOutput: output,
      sessionId: options.snapshot.sessionId,
      origin: {
        rendererId: options.bridge === "game-3d" ? "game-3d.prototype" : "anime-npr.prototype",
        rendererVersion: "0.1.0",
        bridge: options.bridge,
        engineId: engine.describe().engineId,
        engineVersion: engine.describe().engineVersion,
      },
      swm: {
        snapshotVersion: handle.snapshotVersion,
        lastEventSequence: rendered.provenance.lastEventSequence,
      },
    });
    engine.dispose();
    return artifact;
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

/** Builds the default MVP fixture envelope (the existing fixtures, composed). */
export function buildDefaultVisualEnvelope(): VisualFixtureEnvelope {
  return {
    scene: buildCleanMatchFixture(),
    temporal: renderW503CleanFixture(),
    conformance: [
      runTacticalConformance(),
      runConformance(createGame3DRenderer()),
      runConformance(createAnimeNprRenderer()),
    ],
  };
}

/** The tactical conformance run (a fresh staging root per run). */
function runTacticalConformance(): ConformanceReport {
  const staging = mkdtempSync(join(tmpdir(), "sporta-visual-tactical-"));
  try {
    return runConformance(createTacticalRenderer({ stagingDir: staging }));
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * The frame-flicker defect fixture (the detection proof): the default
 * artifact's frame stream with ONE inverted frame (a visible, isolated
 * corruption), re-encoded through the REAL encoder — the gate's temporal
 * axis MUST catch it (2 spike pairs, zero-threshold).
 */
export function buildVisualFlickerArtifact(
  encoder?: FrameEncoderPort,
  frameIndex = Math.floor(
    (DEFAULT_VISUAL_GEOMETRY.durationMs * DEFAULT_VISUAL_GEOMETRY.fps) / 2000,
  ),
): EncodedArtifact {
  const resolved = encoder ?? createFfmpegFrameEncoder() ?? undefined;
  if (resolved === undefined) {
    throw new EncodingError(
      "resource-limit",
      "encoder-unavailable",
      "the flicker defect fixture requires a working ffmpeg/libx264 encoder",
    );
  }
  const fixture = buildCleanMatchFixture();
  const snapshot = fixture.snapshots[fixture.snapshots.length - 1]!;
  const stagingRoot = mkdtempSync(join(tmpdir(), "sporta-visual-flicker-"));
  try {
    const engine = new Software3DEngine({ stagingRoot });
    const handle = engine.buildScene(
      {
        schemaVersion: "1.1",
        sessionId: snapshot.sessionId,
        snapshotVersion: snapshot.watermark.sequence,
        renderingStyle: "stylized-3d",
      },
      snapshot,
      [...fixture.eventStream],
    );
    const rendered = engine.renderScene({
      schemaVersion: "1.1",
      sceneId: handle.sceneId,
      outputProfile: { ...DEFAULT_VISUAL_GEOMETRY, format: "frames-rgb24" },
      presentation: { camera: "aerial-follow", seed: "11" },
    });
    const output = rendered.output as GameEngineFrameOutput;
    const frameBytes = DEFAULT_VISUAL_GEOMETRY.widthPx * DEFAULT_VISUAL_GEOMETRY.heightPx * 3;
    const raw = readFileSync(output.stagingRef);
    const frames: Uint8Array[] = [];
    for (let i = 0; i < output.frameCount; i += 1) {
      const frame = new Uint8Array(raw.subarray(i * frameBytes, (i + 1) * frameBytes));
      if (i === frameIndex) {
        for (let p = 0; p < frame.length; p += 1) {
          frame[p] = 255 - frame[p]!;
        }
      }
      frames.push(frame);
    }
    engine.dispose();
    return bridgeRgbFrames({
      encoder: resolved,
      frames,
      width: DEFAULT_VISUAL_GEOMETRY.widthPx,
      height: DEFAULT_VISUAL_GEOMETRY.heightPx,
      fps: DEFAULT_VISUAL_GEOMETRY.fps,
      origin: { rendererId: "game-3d.prototype", rendererVersion: "0.1.0", bridge: "game-3d" },
      sessionId: snapshot.sessionId,
      swm: {
        snapshotVersion: handle.snapshotVersion,
        lastEventSequence: rendered.provenance.lastEventSequence,
      },
    });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

/**
 * The W803-shaped gate runner: the visual-correctness evaluation over the
 * default MVP envelope + the default artifact (real engine + real
 * encode). A gate that cannot run is NOT-RUNNABLE (and counts as FAIL for
 * the release verdict — never a silent skip).
 */
export function runVisualCorrectnessGate(options?: {
  artifactSupplier?: () => EncodedArtifact;
  envelopeSupplier?: () => VisualFixtureEnvelope;
  ffmpegPath?: string;
}): GateResult {
  const base = {
    id: "visual-correctness" as const,
    source: "@sporta/encoding" as const,
    blocking: true,
  };
  try {
    const artifact = (options?.artifactSupplier ?? buildDefaultVisualArtifact)();
    const envelope = (options?.envelopeSupplier ?? buildDefaultVisualEnvelope)();
    const report = evaluateVisualCorrectness(artifact, envelope, {
      ...(options?.ffmpegPath === undefined ? {} : { ffmpegPath: options.ffmpegPath }),
    });
    return {
      ...base,
      status: report.verdict.pass ? "PASS" : "FAIL",
      ...(report.verdict.pass ? {} : { reason: report.verdict.reason }),
      summary: {
        verdict: report.verdict.pass,
        axisCount: report.accounting.axisCount,
        passCount: report.accounting.passCount,
        failCount: report.accounting.failCount,
        notRunnableCount: report.accounting.notRunnableCount,
        contentHash: report.artifact.contentHash,
        spikePairCount: report.temporalStability.artifactPlane?.spikePairCount ?? -1,
        schemaTag: report.schemaTag,
      },
    };
  } catch (error) {
    return {
      ...base,
      status: "NOT-RUNNABLE",
      reason: `the visual-correctness gate threw: ${(error as Error).message}`,
      summary: { verdict: false },
    };
  }
}

/** Reads one snapshot's watermark sequence (guarded; null when absent). */
function readSnapshotWatermark(value: unknown): { snapshotVersion: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const watermark = (value as { watermark?: { sequence?: unknown } }).watermark;
  if (
    typeof watermark !== "object" ||
    watermark === null ||
    typeof (watermark as { sequence?: unknown }).sequence !== "number"
  ) {
    return null;
  }
  return { snapshotVersion: (watermark as { sequence: number }).sequence };
}

/** Reads one event-stream entry's sequence (guarded; null when absent). */
function readEventSequence(value: unknown): { lastEventSequence: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const sequence = (value as { sequence?: unknown }).sequence;
  if (typeof sequence !== "number") return null;
  return { lastEventSequence: sequence };
}

/** Reads the scene fixture's render-output session id (guarded). */
function readSessionIdOfOutput(output: unknown): string {
  if (typeof output !== "object" || output === null) return "(unknown)";
  const result = (output as { result?: { sessionId?: unknown } }).result;
  if (typeof result !== "object" || result === null) return "(unknown)";
  const sessionId = (result as { sessionId?: unknown }).sessionId;
  return typeof sessionId === "string" ? sessionId : "(unknown)";
}
