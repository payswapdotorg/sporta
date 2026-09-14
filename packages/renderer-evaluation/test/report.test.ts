/**
 * Report assembly + verdict tests (W503): the deterministic
 * `TemporalConsistencyReport` shape, conjunctive verdict, conditional
 * styleBytes measurement, fail-loud frame mismatch, input immutability
 * (purity), and deep-equal rerun determinism.
 */
import { describe, expect, test } from "bun:test";
import { renderAnimeClip } from "@sporta/renderer-anime";
import { TemporalEvaluationError } from "../src/errors";
import {
  REPORT_SCHEMA_TAG,
  buildW503ClipSteps,
  buildW503RenderRequest,
  evaluateRenderOutput,
  evaluateTemporalConsistency,
  injectWatermarkRegression,
  renderW503CleanFixture,
} from "../src/index";

describe("evaluateRenderOutput — report shape", () => {
  const output = renderW503CleanFixture();
  const report = evaluateRenderOutput(output);

  test("schema tag + input echo", () => {
    expect(report.schemaTag).toBe(REPORT_SCHEMA_TAG);
    expect(REPORT_SCHEMA_TAG).toBe("sporta/renderer-evaluation/w503@1");
    expect(report.input.rendererId).toBe("anime.prototype");
    expect(report.input.rendererVersion).toBe("0.1.0");
    expect(report.input.styleId).toBe("style-anime-test");
    expect(report.input.sessionId).toBe("sess-anime-clip");
    expect(report.input.snapshotVersion).toBe(1);
    expect(report.input.frameCount).toBe(6);
    expect(report.input.frameIntervalMs).toBe(1_000);
    expect(report.input.svgFramesMeasured).toBe(true);
  });

  test("styleBytes present when frames are supplied", () => {
    expect(report.styleBytes).toBeDefined();
    expect(report.styleBytes!.stabilityRatio).toBe(1);
  });

  test("the verdict lists every check with its measured value", () => {
    expect(report.verdict.checks).toHaveLength(21);
    const first = report.verdict.checks[0]!;
    expect(first).toEqual({
      metric: "identity.unexplainedAbsenceCount",
      operator: "max",
      threshold: 0,
      measured: 0,
      pass: true,
    });
    const ratio = report.verdict.checks.find((check) => check.metric === "geometry.maxJumpRatio")!;
    expect(ratio.operator).toBe("max");
    expect(ratio.threshold).toBe(1);
    expect(ratio.measured).toBeGreaterThan(0);
    expect(ratio.pass).toBe(true);
  });
});

describe("evaluateTemporalConsistency — manifest-only input", () => {
  const output = renderW503CleanFixture();

  test("without frames: no styleBytes section, 20 checks, still PASS", () => {
    const report = evaluateTemporalConsistency({ manifest: output.manifest });
    expect(report.input.svgFramesMeasured).toBe(false);
    expect(report.styleBytes).toBeUndefined();
    expect(report.verdict.checks).toHaveLength(20);
    expect(report.verdict.pass).toBe(true);
  });

  test("frames not matching the manifest 1:1 fail loud", () => {
    try {
      evaluateTemporalConsistency({ manifest: output.manifest, frames: output.frames.slice(0, 5) });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(TemporalEvaluationError);
      expect((error as TemporalEvaluationError).code).toBe("frames-malformed");
      expect((error as TemporalEvaluationError).path).toBe("$.frames");
    }
  });
});

describe("evaluateTemporalConsistency — the verdict is conjunctive", () => {
  test("one injected defect flips PASS to FAIL with its failure listed", () => {
    const output = renderW503CleanFixture();
    const clean = evaluateRenderOutput(output);
    expect(clean.verdict.pass).toBe(true);

    const perturbed = injectWatermarkRegression(output.manifest, { frameIndex: 2 });
    const report = evaluateTemporalConsistency({ manifest: perturbed, frames: output.frames });
    expect(report.verdict.pass).toBe(false);
    expect(report.verdict.failures).toHaveLength(2);
    expect(report.verdict.failures.map((failure) => failure.metric)).toEqual([
      "artifacts.watermarkSequenceRegressionCount",
      "artifacts.watermarkTimeRegressionCount",
    ]);
  });
});

describe("evaluateRenderOutput — the single-frame boundary", () => {
  // A one-step clip: no consecutive pairs, no transitions, no cross-frame
  // checks — every metric is vacuously clean and the verdict is PASS.
  const singleFrameOutput = renderAnimeClip(
    buildW503RenderRequest(),
    buildW503ClipSteps().slice(0, 1),
  );
  const report = evaluateRenderOutput(singleFrameOutput);

  test("a one-frame clip evaluates cleanly (vacuous PASS)", () => {
    expect(singleFrameOutput.manifest.frames).toHaveLength(1);
    expect(report.input.frameCount).toBe(1);
    expect(report.geometry.measuredPairCount).toBe(0);
    expect(report.geometry.jumpCount).toBe(0);
    expect(report.geometry.maxJumpMeters).toBe(0);
    expect(report.identity.flickerCount).toBe(0);
    expect(report.artifacts.windowOverlapCount).toBe(0);
    expect(report.verdict.pass).toBe(true);
    expect(report.verdict.failures).toEqual([]);
    // 5 entities carry a position on the single frame; no pairs are formed.
    expect(report.geometry.perEntity.every((entity) => entity.series.length === 0)).toBe(true);
  });

  test("every entity's presence series has exactly the one frame", () => {
    expect(report.identity.perEntity).toHaveLength(7);
    for (const entity of report.identity.perEntity) {
      expect(entity.presence).toHaveLength(1);
      expect(entity.firstFrameIndex).toBe(0);
    }
  });
});

describe("evaluateTemporalConsistency — determinism + purity", () => {
  test("two evaluations of the same input are deep-equal", () => {
    const output = renderW503CleanFixture();
    const first = evaluateRenderOutput(output);
    const second = evaluateRenderOutput(renderW503CleanFixture());
    expect(first).toEqual(second);
  });

  test("the evaluated manifest is never mutated (pure measurement)", () => {
    const output = renderW503CleanFixture();
    const snapshot = structuredClone(output.manifest);
    evaluateRenderOutput(output);
    expect(output.manifest).toEqual(snapshot);
  });

  test("serializing the report twice yields identical JSON bytes", () => {
    const output = renderW503CleanFixture();
    const report = evaluateRenderOutput(output);
    expect(JSON.stringify(report)).toBe(JSON.stringify(evaluateRenderOutput(output)));
  });
});
