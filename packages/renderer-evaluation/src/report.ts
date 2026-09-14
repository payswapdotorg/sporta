/**
 * The W503 temporal consistency report and verdict (deliverable 2).
 *
 * {@link evaluateTemporalConsistency} runs the whole measurement core
 * (identity flicker, geometry drift, temporal artifacts — plus byte-level
 * style stability when the SVG frames are supplied) over one W502 clip
 * manifest and applies the documented thresholds
 * (`./thresholds.ts` / `THRESHOLDS.md`) to produce a deterministic
 * `TemporalConsistencyReport`:
 *
 * - every check is listed with its metric name, threshold, measured value,
 *   and pass flag — the measured evidence, not just a verdict;
 * - the verdict is PASS iff EVERY check passes (fail-loud, no partial
 *   credit; a metric that cannot detect its defect class would show up as
 *   an always-passing check — rejected by the injected-defect tests);
 * - thresholds are never tuned to force a pass: the zero-defect thresholds
 *   follow from deterministic-renderer purity, the drift bounds from
 *   documented physical ceilings (THRESHOLDS.md §3).
 *
 * Determinism: the report is a pure function of its input — no clock, no
 *   RNG, no I/O; two evaluations of the same input are deep-equal (pinned
 *   by tests). All numbers are JSON-safe.
 */
import type { AnimeClipManifest, AnimeFrame, AnimeRenderOutput } from "@sporta/renderer-anime";
import type { TemporalArtifactMetrics } from "./artifacts";
import { measureTemporalArtifacts } from "./artifacts";
import { TemporalEvaluationError } from "./errors";
import type { IdentityFlickerMetrics, StyleByteStability } from "./identity";
import { measureIdentityFlicker, measureStyleByteStability } from "./identity";
import type { GeometryDriftMetrics } from "./drift";
import { measureGeometryDrift } from "./drift";
import { THRESHOLDS } from "./thresholds";

/** One threshold check with its measured evidence. */
export interface ThresholdCheck {
  /** The metric's report path (e.g. `identity.flickerCount`). */
  metric: string;
  /** `"max"` (measured must be <= threshold) or `"min"` (measured must be >= threshold). */
  operator: "max" | "min";
  /** The threshold value (from THRESHOLDS, documented in THRESHOLDS.md). */
  threshold: number;
  /** The measured value. */
  measured: number;
  pass: boolean;
}

/** The verdict of one evaluation. */
export interface TemporalVerdict {
  pass: boolean;
  /** The failing checks, in check order (empty when pass). */
  failures: ThresholdCheck[];
  /** Every check with its measured value (the full evidence). */
  checks: ThresholdCheck[];
}

/** The full W503 temporal consistency report. */
export interface TemporalConsistencyReport {
  /** Report schema tag: `"sporta/renderer-evaluation/w503@1"`. */
  schemaTag: string;
  /** What was measured and where it came from. */
  input: {
    rendererId: string;
    rendererVersion: string;
    styleId: string;
    sessionId: string;
    snapshotVersion: number;
    frameCount: number;
    frameIntervalMs: number;
    /** Whether SVG frames were supplied (enables byte-level style stability). */
    svgFramesMeasured: boolean;
  };
  identity: IdentityFlickerMetrics;
  /** Present iff SVG frames were supplied. */
  styleBytes?: StyleByteStability;
  geometry: GeometryDriftMetrics;
  artifacts: TemporalArtifactMetrics;
  verdict: TemporalVerdict;
}

/** The report schema tag (versioned with the report shape). */
export const REPORT_SCHEMA_TAG = "sporta/renderer-evaluation/w503@1";

/** Builds one threshold check (max semantics: measured <= threshold). */
function maxCheck(metric: string, threshold: number, measured: number): ThresholdCheck {
  return { metric, operator: "max", threshold, measured, pass: measured <= threshold };
}

/** Builds one threshold check (min semantics: measured >= threshold). */
function minCheck(metric: string, threshold: number, measured: number): ThresholdCheck {
  return { metric, operator: "min", threshold, measured, pass: measured >= threshold };
}

/**
 * Assembles the checks (in fixed order — the report's documented check
 * list) and the verdict from the measured metrics.
 */
function buildVerdict(options: {
  identity: IdentityFlickerMetrics;
  styleBytes: StyleByteStability | undefined;
  geometry: GeometryDriftMetrics;
  artifacts: TemporalArtifactMetrics;
}): TemporalVerdict {
  const { identity, styleBytes, geometry, artifacts } = options;
  const checks: ThresholdCheck[] = [
    maxCheck(
      "identity.unexplainedAbsenceCount",
      THRESHOLDS.MAX_UNEXPLAINED_ABSENCE_COUNT,
      identity.unexplainedAbsenceCount,
    ),
    maxCheck("identity.flickerCount", THRESHOLDS.MAX_IDENTITY_FLICKER_COUNT, identity.flickerCount),
    minCheck(
      "identity.styleStabilityRatio",
      THRESHOLDS.MIN_STYLE_STABILITY_RATIO,
      identity.styleStabilityRatio,
    ),
    maxCheck("geometry.jumpCount", THRESHOLDS.MAX_GEOMETRY_JUMP_COUNT, geometry.jumpCount),
    maxCheck("geometry.maxJumpRatio", THRESHOLDS.MAX_GEOMETRY_JUMP_RATIO, geometry.maxJumpRatio),
    maxCheck(
      "artifacts.windowOverlapCount",
      THRESHOLDS.MAX_WINDOW_OVERLAP_COUNT,
      artifacts.windowOverlapCount,
    ),
    maxCheck(
      "artifacts.invertedWindowCount",
      THRESHOLDS.MAX_INVERTED_WINDOW_COUNT,
      artifacts.invertedWindowCount,
    ),
    maxCheck(
      "artifacts.windowTimestampMismatchCount",
      THRESHOLDS.MAX_WINDOW_TIMESTAMP_MISMATCH_COUNT,
      artifacts.windowTimestampMismatchCount,
    ),
    maxCheck(
      "artifacts.captionDuplicateCount",
      THRESHOLDS.MAX_CAPTION_DUPLICATE_COUNT,
      artifacts.captionDuplicateCount,
    ),
    maxCheck(
      "artifacts.captionUnappliedCount",
      THRESHOLDS.MAX_CAPTION_UNAPPLIED_COUNT,
      artifacts.captionUnappliedCount,
    ),
    maxCheck(
      "artifacts.appliedDuplicateCount",
      THRESHOLDS.MAX_APPLIED_DUPLICATE_COUNT,
      artifacts.appliedDuplicateCount,
    ),
    maxCheck(
      "artifacts.appliedUnsortedCount",
      THRESHOLDS.MAX_APPLIED_UNSORTED_COUNT,
      artifacts.appliedUnsortedCount,
    ),
    maxCheck(
      "artifacts.appliedGapCount",
      THRESHOLDS.MAX_APPLIED_GAP_COUNT,
      artifacts.appliedGapCount,
    ),
    maxCheck(
      "artifacts.appliedUnaccountedCount",
      THRESHOLDS.MAX_APPLIED_UNACCOUNTED_COUNT,
      artifacts.appliedUnaccountedCount,
    ),
    maxCheck(
      "artifacts.watermarkSequenceRegressionCount",
      THRESHOLDS.MAX_WATERMARK_SEQUENCE_REGRESSION_COUNT,
      artifacts.watermarkSequenceRegressionCount,
    ),
    maxCheck(
      "artifacts.watermarkTimeRegressionCount",
      THRESHOLDS.MAX_WATERMARK_TIME_REGRESSION_COUNT,
      artifacts.watermarkTimeRegressionCount,
    ),
    maxCheck(
      "artifacts.watermarkBelowEventsCount",
      THRESHOLDS.MAX_WATERMARK_BELOW_EVENTS_COUNT,
      artifacts.watermarkBelowEventsCount,
    ),
    maxCheck(
      "artifacts.dispositionFlapCount",
      THRESHOLDS.MAX_DISPOSITION_FLAP_COUNT,
      artifacts.dispositionFlapCount,
    ),
    maxCheck(
      "artifacts.kindChangeCount",
      THRESHOLDS.MAX_KIND_CHANGE_COUNT,
      artifacts.kindChangeCount,
    ),
    maxCheck(
      "artifacts.possessionDisplayMismatchCount",
      THRESHOLDS.MAX_POSSESSION_DISPLAY_MISMATCH_COUNT,
      artifacts.possessionDisplayMismatchCount,
    ),
  ];
  if (styleBytes !== undefined) {
    checks.push(
      minCheck(
        "styleBytes.stabilityRatio",
        THRESHOLDS.MIN_STYLE_BYTE_STABILITY_RATIO,
        styleBytes.stabilityRatio,
      ),
    );
  }
  return {
    pass: checks.every((check) => check.pass),
    failures: checks.filter((c) => !c.pass),
    checks,
  };
}

/** The evaluator input: a clip manifest plus (optionally) its SVG frames. */
export interface TemporalEvaluationInput {
  manifest: AnimeClipManifest;
  /**
   * The rendered frames, when available. Must be 1:1 with the manifest
   * frames (same count and order) — enforced fail-loud. Supplying them
   * enables the byte-level style stability measurement.
   */
  frames?: readonly AnimeFrame[];
}

/**
 * Evaluates the temporal consistency of one rendered clip. Pure and
 * deterministic: the same input yields a deep-equal report on every call.
 * Throws `TemporalEvaluationError` on a malformed manifest (fail-loud,
 * never a silent skip) or on frames that do not match the manifest 1:1.
 */
export function evaluateTemporalConsistency(
  input: TemporalEvaluationInput,
): TemporalConsistencyReport {
  const { manifest, frames } = input;
  if (frames !== undefined && frames.length !== manifest.frames.length) {
    throw new TemporalEvaluationError(
      "frames-malformed",
      "$.frames",
      `supplied ${frames.length} SVG frames but the manifest has ${manifest.frames.length} (frames must match the manifest 1:1)`,
    );
  }
  const identity = measureIdentityFlicker(manifest);
  const geometry = measureGeometryDrift(manifest);
  const artifacts = measureTemporalArtifacts(manifest);
  const styleBytes = frames === undefined ? undefined : measureStyleByteStability(frames);
  const verdict = buildVerdict({ identity, styleBytes, geometry, artifacts });
  const report: TemporalConsistencyReport = {
    schemaTag: REPORT_SCHEMA_TAG,
    input: {
      rendererId: manifest.renderer.rendererId,
      rendererVersion: manifest.renderer.rendererVersion,
      styleId: manifest.renderer.styleId,
      sessionId: manifest.session.sessionId,
      snapshotVersion: manifest.session.snapshotVersion,
      frameCount: manifest.frames.length,
      frameIntervalMs: manifest.output.frameIntervalMs,
      svgFramesMeasured: frames !== undefined,
    },
    identity,
    ...(styleBytes === undefined ? {} : { styleBytes }),
    geometry,
    artifacts,
    verdict,
  };
  return report;
}

/**
 * Evaluates the temporal consistency of one full W502 render output
 * (contract result + frames + manifest). The frames enable the byte-level
 * style stability measurement.
 */
export function evaluateRenderOutput(output: AnimeRenderOutput): TemporalConsistencyReport {
  return evaluateTemporalConsistency({ manifest: output.manifest, frames: output.frames });
}
