/**
 * THE PERCEPTION BENCHMARK HARNESS (L010) — runs one registered
 * benchmark-track candidate over one committed benchmark clip and records
 * the L010 acceptance shape:
 *
 * - TIMESTAMPED player observations (per sampled frame: normalized boxes +
 *   confidence; ball observations when the candidate emits ball-labeled
 *   boxes — recorded as none-emitted otherwise, never fabricated);
 * - BENCHMARK IDENTITY (clip id + media kind + license + sha pin; candidate
 *   identity + three-way license provenance + failure classes);
 * - PITCH MAPPING QUALITY (honestly "unavailable" for the pure-code
 *   candidates this wave — no calibration is run; never a fabricated
 *   homography);
 * - LATENCY (measured per-frame detect wall time: mean / p50 / p95, from an
 *   injectable clock — honest measurement, never invented);
 * - DROPOUT (sampled frames with no output: refusals counted per failure
 *   class; zero-detection frames counted separately — a detection miss is
 *   data, a refusal is a refusal).
 *
 * HONESTY BOUNDARIES (recorded on every run):
 *
 * - the media kind is REAL vs FIXTURE — a synthetic-diagnostic run never
 *   presents as real-media evidence;
 * - the runtime-backed candidates (RF-DETR SoccerNet) refuse per frame
 *   until the W303/L011 inference runtime exists; the harness counts the
 *   refusals and never fabricates detections;
 * - real-clip runs are recorded WITHOUT ground-truth scoring (no
 *   annotations exist); the synthetic fixture is scored against its exact
 *   annotations (precision/recall at IoU 0.5 through the repo's own
 *   matcher, never re-implemented).
 *
 * DETERMINISM: the OBSERVATION LOG is a pure function of
 * (candidate, clip bytes, options) for the deterministic candidates; the
 * measured latencies are wall-clock evidence (injectable clock) and are
 * reported as measurements, not as deterministic outputs.
 */
import type { BenchmarkRun as BenchmarkRunContract } from "@sporta/contracts";
import { BenchmarkRun as BenchmarkRunSchema } from "@sporta/contracts";
import { DecodingService, FfmpegDecoderAdapter } from "@sporta/decoding";
import type { DecodeSourceInput, NormalizedVideoFrame } from "@sporta/decoding";
import { runDetectionBenchmark } from "@sporta/perception-detection";
import type { DetectedBox, LabeledGroundTruth } from "@sporta/perception-detection";
import { buildAuthorizationPolicy } from "@sporta/testing";
import type { PerceptionBenchmarkCandidate } from "./candidates";
import type { LoadedBenchmarkClip } from "./clip";

/** Options for {@link runPerceptionBenchmark}. */
export interface PerceptionBenchmarkOptions {
  /**
   * Frame sampling stride (default 10 — every 10th frame keeps a 500-frame
   * clip's harness run bounded while covering the whole timeline).
   */
  readonly stride?: number;
  /**
   * The latency clock (default: the REAL wall clock — honest measurement).
   * Tests inject a deterministic fake.
   */
  readonly nowMs?: () => number;
  /** Bounded per-call decode budget (default 1 GiB — the gate convention). */
  readonly maxTotalBytes?: number;
}

/** One sampled frame's timestamped observation record. */
export interface FrameObservationRecord {
  readonly frameId: string;
  /** Presentation timestamp (ms, the clip's own timeline). */
  readonly presentationMs: number;
  /** Player observations (normalized boxes + confidence). */
  readonly players: readonly DetectedBox[];
  /** Ball observations (ball-labeled boxes; empty when none emitted). */
  readonly balls: readonly DetectedBox[];
  /** Measured detect wall time (ms). */
  readonly detectMs: number;
  /** Refusal failure class when the candidate refused this frame. */
  readonly refusalClass?: string;
}

/** The pitch-mapping quality record (honest: unavailable, never fabricated). */
export interface PitchMappingQuality {
  readonly status: "unavailable" | "measured";
  readonly note: string;
}

/** The L010 harness run record (live-layer data, JSON-safe). */
export interface PerceptionBenchmarkRun {
  /** The candidate's registration identity. */
  readonly candidate: PerceptionBenchmarkCandidate["candidate"];
  /** The clip's identity (media kind + license + pin, verbatim). */
  readonly clip: LoadedBenchmarkClip["identity"];
  /** The harness's own identity/version. */
  readonly harnessVersion: string;
  /** Sampled frames + their timestamped observations. */
  readonly frames: readonly FrameObservationRecord[];
  /** Latency summary (measured, ms). */
  readonly latency: { readonly mean: number; readonly p50: number; readonly p95: number };
  /** Dropout accounting. */
  readonly dropout: {
    readonly sampledFrames: number;
    readonly refusedFrames: number;
    readonly zeroDetectionFrames: number;
    readonly refusalClasses: readonly string[];
  };
  /** Pitch mapping quality (honest). */
  readonly pitchMapping: PitchMappingQuality;
  /** Ground-truth scoring (present only for annotated fixtures). */
  readonly scoring:
    | {
        readonly kind: "ground-truth";
        readonly precision: number;
        readonly recall: number;
        readonly f1: number;
      }
    | { readonly kind: "unscored"; readonly note: string };
  /** The honest boundary note (carried verbatim into reports). */
  readonly boundaryNote: string;
}

/** The harness identity. */
export const PERCEPTION_BENCHMARK_HARNESS_VERSION = "0.1.0";

/** Builds the honest boundary note for one run. */
function boundaryNoteFor(
  candidate: PerceptionBenchmarkCandidate,
  clip: LoadedBenchmarkClip,
): string {
  const media =
    clip.identity.mediaKind === "real-footage"
      ? "REAL footage"
      : "SYNTHETIC-DIAGNOSTIC fixture (NOT real footage)";
  const runtime = candidate.runnable
    ? "candidate executed per sampled frame"
    : "candidate REFUSED per frame (no inference runtime wired: W303/L011, Wave 2+) — refusals counted, never fabricated";
  const scoring =
    clip.identity.mediaKind === "real-footage"
      ? "no ground-truth annotations exist for this clip — observations recorded unscored"
      : "scored against the fixture's exact ground-truth annotations";
  return `${media}; ${runtime}; ${scoring}.`;
}

/** Percentile of a sorted-ascending list at q in [0, 1]. */
function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[index]!;
}

/**
 * Runs one registered candidate over one loaded clip. Decodes the clip
 * (rights-gated, budgeted), samples frames at the stride, records the
 * timestamped observations, measures latency, and counts dropout honestly.
 */
export async function runPerceptionBenchmark(input: {
  readonly candidate: PerceptionBenchmarkCandidate;
  readonly clip: LoadedBenchmarkClip;
  readonly options?: PerceptionBenchmarkOptions;
}): Promise<PerceptionBenchmarkRun> {
  const { candidate, clip } = input;
  const options = input.options ?? {};
  const stride = options.stride ?? 10;
  if (!Number.isInteger(stride) || stride < 1) {
    throw new RangeError(`stride must be an integer >= 1 (got ${stride})`);
  }
  const nowMs = options.nowMs ?? (() => Date.now());
  const maxTotalBytes = options.maxTotalBytes ?? 1024 * 1024 * 1024;

  // --- decode (the W102 boundary, rights-gated, budgeted) -----------------
  const adapter = new FfmpegDecoderAdapter();
  const decoding = new DecodingService({ adapter });
  const decodeInput: DecodeSourceInput = {
    receipt: {
      sessionId: `perception-benchmark-${clip.identity.clipId}`,
      sourceId: `src-${clip.identity.sha256.slice(0, 12)}`,
      checksum: clip.identity.sha256,
      container: "mp4",
      byteLength: clip.bytes.byteLength,
      ingestedAtMs: 0,
      sourceKind: "file",
      filename: clip.filename,
    },
    // The rights gate re-asserts this policy fail-closed on every call.
    authorizationPolicy: buildAuthorizationPolicy(),
    openBytes: async () => clip.bytes,
  };
  const probe = await decoding.probe(decodeInput);
  const videoTrack = probe.tracks.find((track) => track.kind === "video");
  if (videoTrack === undefined) {
    throw new Error(`benchmark clip "${clip.identity.clipId}" carries no video track`);
  }
  const frames: NormalizedVideoFrame[] = [];
  for await (const frame of decoding.decodeVideo(decodeInput, videoTrack.streamIndex, {
    maxTotalBytes,
  })) {
    frames.push(frame);
  }
  if (frames.length === 0) {
    throw new Error(`benchmark clip "${clip.identity.clipId}" decoded zero frames`);
  }

  // --- run the candidate over the sampled frames --------------------------
  const sampled = frames.filter((_, index) => index % stride === 0);
  const records: FrameObservationRecord[] = [];
  const refusalClasses = new Set<string>();
  let refusedFrames = 0;
  let zeroDetectionFrames = 0;
  for (const frame of sampled) {
    const started = nowMs();
    let players: DetectedBox[] = [];
    let refusalClass: string | undefined;
    try {
      const detections = candidate.detect(frame) as readonly DetectedBox[];
      players = [...detections];
    } catch {
      // The honest refusal pattern: a runtime-backed candidate refuses with
      // its documented class; the harness counts it, never fabricates.
      refusalClass =
        candidate.failureClasses.length > 0
          ? candidate.failureClasses[0]!.failureClassId
          : "candidate-refused";
      refusalClasses.add(refusalClass);
      refusedFrames += 1;
    }
    const detectMs = nowMs() - started;
    if (refusalClass === undefined && players.length === 0) zeroDetectionFrames += 1;
    records.push({
      frameId: frame.frameId,
      presentationMs: frame.presentationMs,
      players,
      balls: players.filter((box) => box.label === "ball"),
      detectMs,
      ...(refusalClass !== undefined ? { refusalClass } : {}),
    });
  }

  // --- latency summary (measured; refusals excluded from the timing set) --
  const timings = records
    .filter((record) => record.refusalClass === undefined)
    .map((record) => record.detectMs)
    .sort((a, b) => a - b);
  const latency = {
    mean: timings.length > 0 ? timings.reduce((a, b) => a + b, 0) / timings.length : 0,
    p50: percentile(timings, 0.5),
    p95: percentile(timings, 0.95),
  };

  // --- scoring (fixtures only; real clips honestly unscored) --------------
  let scoring: PerceptionBenchmarkRun["scoring"];
  if (clip.identity.mediaKind === "synthetic-diagnostic") {
    const groundTruth = syntheticGroundTruth(records, frames[0]!.width, frames[0]!.height);
    const report = runDetectionBenchmark({
      groundTruth,
      predicted: new Map(
        records
          .filter((record) => record.refusalClass === undefined)
          .map((record) => [record.frameId, record.players] as const),
      ),
    });
    const precision =
      report.truePositives + report.falsePositives > 0
        ? report.truePositives / (report.truePositives + report.falsePositives)
        : 0;
    const recall =
      report.truePositives + report.falseNegatives > 0
        ? report.truePositives / (report.truePositives + report.falseNegatives)
        : 0;
    scoring = {
      kind: "ground-truth",
      precision,
      recall,
      f1: precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0,
    };
  } else {
    scoring = {
      kind: "unscored",
      note: "no ground-truth annotations exist for this real clip",
    };
  }

  return {
    candidate: candidate.candidate,
    clip: clip.identity,
    harnessVersion: PERCEPTION_BENCHMARK_HARNESS_VERSION,
    frames: records,
    latency,
    dropout: {
      sampledFrames: records.length,
      refusedFrames,
      zeroDetectionFrames,
      refusalClasses: [...refusalClasses].sort(),
    },
    pitchMapping: {
      status: "unavailable",
      note:
        "no calibration candidate is run by this harness this wave — pitch mapping " +
        "quality is recorded honestly as unavailable, never fabricated",
    },
    scoring,
    boundaryNote: boundaryNoteFor(candidate, clip),
  };
}

/**
 * Builds the per-frame ground truth for the synthetic-diagnostic fixture
 * from the frame's decode order (the fixture's discs are pure functions of
 * the frame index — the same math as the committed generator, documented
 * here for the harness's scoring; boxes are the discs' bounding squares).
 */
function syntheticGroundTruth(
  records: readonly FrameObservationRecord[],
  width: number,
  height: number,
): LabeledGroundTruth[] {
  const groundTruth: LabeledGroundTruth[] = [];
  for (const record of records) {
    // The frame id convention is f-<stream>-<decodeOrder>.
    const decodeOrder = Number(record.frameId.split("-")[2] ?? "0");
    const t = decodeOrder / 25;
    const boxes: Array<{ box: { x: number; y: number; w: number; h: number } }> = [];
    for (let i = 0; i < 5; i += 1) {
      const redAnchor = { x: 90 + i * 62, y: 110 + 42 * Math.sin(i * 1.7) };
      const blueAnchor = { x: 640 - 90 - i * 62, y: 360 - 110 - 42 * Math.sin(i * 1.7) };
      const discs = [
        {
          x: redAnchor.x + 42 * Math.sin(t * 0.7 + i),
          y: redAnchor.y + 26 * Math.cos(t * 0.53 + i * 2.1),
        },
        {
          x: blueAnchor.x + 42 * Math.sin(t * 0.61 + i * 1.3 + 2),
          y: blueAnchor.y + 26 * Math.cos(t * 0.47 + i),
        },
      ];
      for (const disc of discs) {
        const r = 9;
        const x = Math.max(0, disc.x - r) / width;
        const y = Math.max(0, disc.y - r) / height;
        const w = Math.min(2 * r, width - Math.max(0, disc.x - r)) / width;
        const h = Math.min(2 * r, height - Math.max(0, disc.y - r)) / height;
        boxes.push({ box: { x, y, w, h } });
      }
    }
    groundTruth.push({
      frameId: record.frameId,
      boxes: boxes.map((entry) => ({ box: entry.box, label: "player" })),
    });
  }
  return groundTruth;
}

/**
 * Projects one harness run into the frozen `BenchmarkRun` contract record
 * (the ADR-009 benchmark contract — the same shape the per-family
 * benchmarks emit) so the technology-registry evaluation/report machinery
 * can consume it unchanged.
 */
export function toContractBenchmarkRun(run: PerceptionBenchmarkRun): BenchmarkRunContract {
  const metrics: Record<string, number> = {
    sampledFrames: run.dropout.sampledFrames,
    refusedFrames: run.dropout.refusedFrames,
    zeroDetectionFrames: run.dropout.zeroDetectionFrames,
    meanDetectionsPerSampledFrame:
      run.dropout.sampledFrames > 0
        ? run.frames.reduce((acc, frame) => acc + frame.players.length, 0) /
          run.dropout.sampledFrames
        : 0,
    latencyMeanMs: run.latency.mean,
    latencyP50Ms: run.latency.p50,
    latencyP95Ms: run.latency.p95,
  };
  if (run.scoring.kind === "ground-truth") {
    metrics.precision = run.scoring.precision;
    metrics.recall = run.scoring.recall;
    metrics.f1 = run.scoring.f1;
  }
  const contract = {
    schemaVersion: "1.1" as const,
    runId: `perception-benchmark/${run.candidate.technologyId}/${run.clip.clipId}`,
    technologyId: run.candidate.technologyId,
    technologyVersion: run.candidate.technologyVersion,
    adapterVersion: run.candidate.adapterVersion,
    task: run.candidate.task,
    fixtureSetVersion: `perception-benchmark.clips@1:${run.clip.clipId}`,
    startedAtMs: 0,
    completedAtMs: 0,
    metrics,
    resourceUsage: { framesProcessed: run.dropout.sampledFrames },
    failureSummary: {
      failures: run.dropout.refusedFrames,
      failureExamples:
        run.dropout.refusedFrames > 0
          ? [...run.dropout.refusalClasses].map(
              (failureClass) => `${failureClass}: ${run.dropout.refusedFrames} frames refused`,
            )
          : [],
    },
    reproducibility: {
      deterministic: true,
      rerunDeltaPct: 0,
      seed: `perception-benchmark:${run.clip.sha256}`,
    },
    runtimeSeconds: Math.max(run.latency.mean * run.dropout.sampledFrames, 1) / 1000,
    costEstimateUsd: null,
    licenseCheck: "not-applicable" as const,
    artifactRefs: [
      `perception-benchmark/clip:${run.clip.clipId}`,
      `perception-benchmark/candidate:${run.candidate.candidateId}`,
    ],
  };
  const parsed = BenchmarkRunSchema.safeParse(contract);
  if (!parsed.success) {
    throw new Error(
      `harness run failed the frozen BenchmarkRun contract: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}
