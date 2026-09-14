/**
 * The W503 detection proof (the accept criterion's teeth): every defect
 * class is INJECTED into the clean fixture's manifest, and every injection
 * must (a) flip the verdict to FAIL, (b) trip its PRIMARY metric with the
 * exact expected value, and (c) appear in the verdict's failure list. A
 * metric that cannot detect its defect class is rejected — this suite is
 * the rejection mechanism.
 */
import { describe, expect, test } from "bun:test";
import {
  TemporalEvaluationError,
  evaluateRenderOutput,
  injectAppliedSequenceGap,
  injectDispositionFlap,
  injectDuplicateEventAttribution,
  injectGeometryTeleport,
  injectStyleByteInstability,
  injectStyleInstability,
  injectUnexplainedAbsence,
  injectWatermarkRegression,
  injectWindowOverlap,
  renderW503CleanFixture,
} from "../src/index";

/** The clean render output every injection perturbs (fresh per case). */
function cleanOutput() {
  return renderW503CleanFixture();
}

/** Evaluates a perturbed manifest over the clean frames (style bytes on). */
function evaluatePerturbed(
  manifest: ReturnType<typeof cleanOutput>["manifest"],
): ReturnType<typeof evaluateRenderOutput> {
  return evaluateRenderOutput({ ...cleanOutput(), manifest });
}

describe("detection proof — the clean baseline passes", () => {
  test("the clean W502 fixture clip: PASS with all checks green", () => {
    const report = evaluateRenderOutput(cleanOutput());
    expect(report.verdict.pass).toBe(true);
    expect(report.verdict.failures).toEqual([]);
    expect(report.verdict.checks).toHaveLength(21); // 20 + conditional styleBytes
    expect(report.verdict.checks.every((check) => check.pass)).toBe(true);
  });
});

describe("detection proof — identity flicker (unexplained entity absence)", () => {
  test("drawn-then-vanished player-7: flicker 1, verdict FAIL, check listed", () => {
    const perturbed = injectUnexplainedAbsence(cleanOutput().manifest, {
      frameIndex: 2,
      entityId: "player-7",
    });
    const report = evaluatePerturbed(perturbed);
    expect(report.identity.flickerCount).toBe(1);
    expect(report.identity.unexplainedAbsenceCount).toBe(1);
    expect(report.verdict.pass).toBe(false);
    const failing = report.verdict.failures.map((failure) => failure.metric);
    expect(failing).toContain("identity.flickerCount");
    expect(failing).toContain("identity.unexplainedAbsenceCount");
    // The same perturbation honestly floats the possession ring (player-7 is
    // the possession target) — a secondary detection of the same defect.
    expect(failing).toContain("artifacts.possessionDisplayMismatchCount");
  });
});

describe("detection proof — style instability", () => {
  test("one restyled frame: styleStabilityRatio 11/12, verdict FAIL", () => {
    const perturbed = injectStyleInstability(cleanOutput().manifest, {
      frameIndex: 2,
      entityId: "player-7",
    });
    const report = evaluatePerturbed(perturbed);
    expect(report.identity.styleInstabilityFrames).toBe(1);
    expect(report.identity.styleStabilityRatio).toBeCloseTo(11 / 12, 15);
    expect(report.verdict.pass).toBe(false);
    expect(report.verdict.failures.map((failure) => failure.metric)).toEqual([
      "identity.styleStabilityRatio",
    ]);
  });

  test("one restyled SVG marker (manifest token UNTOUCHED): styleBytes 23/24, verdict FAIL", () => {
    const output = cleanOutput();
    const perturbed = injectStyleByteInstability(output, {
      frameIndex: 2,
      entityId: "player-7",
    });
    // The injector never mutates its input.
    expect(perturbed.frames[2]!.svg).not.toBe(output.frames[2]!.svg);
    expect(output.frames[2]!.svg).toBe(cleanOutput().frames[2]!.svg);
    const report = evaluateRenderOutput(perturbed);
    // The manifest-level token measurement sees nothing (the token is unchanged)…
    expect(report.identity.styleStabilityRatio).toBe(1);
    expect(report.identity.styleInstabilityFrames).toBe(0);
    // …the byte-level measurement catches the restyled marker group.
    expect(report.styleBytes!.groupFrames).toBe(24);
    expect(report.styleBytes!.unstableFrames).toBe(1);
    expect(report.styleBytes!.stabilityRatio).toBeCloseTo(23 / 24, 15);
    expect(report.verdict.pass).toBe(false);
    expect(report.verdict.failures.map((failure) => failure.metric)).toEqual([
      "styleBytes.stabilityRatio",
    ]);
  });

  test("the byte-level injector fails loud for an entity without a style token (the ball)", () => {
    const output = cleanOutput();
    try {
      injectStyleByteInstability(output, { frameIndex: 2, entityId: "ball-1" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(TemporalEvaluationError);
      expect((error as TemporalEvaluationError).code).toBe("manifest-malformed");
      expect((error as TemporalEvaluationError).path).toBe("$.frames[2].entities");
    }
  });
});

describe("detection proof — geometry drift (teleported player)", () => {
  test("player teleported 36.7 m in 1 s: jumpCount 2, maxJumpRatio > 1, FAIL", () => {
    const perturbed = injectGeometryTeleport(cleanOutput().manifest, {
      frameIndex: 2,
      entityId: "player-7",
      toMeters: { x: 90, y: 34 },
    });
    const report = evaluatePerturbed(perturbed);
    expect(report.geometry.jumpCount).toBe(2);
    expect(report.geometry.maxJumpRatio).toBeGreaterThan(1);
    expect(report.verdict.pass).toBe(false);
    const failing = report.verdict.failures.map((failure) => failure.metric);
    expect(failing).toContain("geometry.jumpCount");
    expect(failing).toContain("geometry.maxJumpRatio");
  });

  test("a ball teleported 59.5 m in 1 s is ALSO caught (kind-specific bound)", () => {
    const perturbed = injectGeometryTeleport(cleanOutput().manifest, {
      frameIndex: 2,
      entityId: "ball-1",
      toMeters: { x: 10, y: 60 },
    });
    const report = evaluatePerturbed(perturbed);
    expect(report.geometry.jumpCount).toBeGreaterThan(0);
    expect(report.verdict.pass).toBe(false);
  });
});

describe("detection proof — watermark regression", () => {
  test("frame watermark rewound below the previous: both regressions counted, FAIL", () => {
    const perturbed = injectWatermarkRegression(cleanOutput().manifest, { frameIndex: 2 });
    const report = evaluatePerturbed(perturbed);
    expect(report.artifacts.watermarkSequenceRegressionCount).toBe(1);
    expect(report.artifacts.watermarkTimeRegressionCount).toBe(1);
    expect(report.verdict.pass).toBe(false);
    const failing = report.verdict.failures.map((failure) => failure.metric);
    expect(failing).toContain("artifacts.watermarkSequenceRegressionCount");
    expect(failing).toContain("artifacts.watermarkTimeRegressionCount");
  });
});

describe("detection proof — disposition flapping", () => {
  test("drawn -> omitted-no-position -> drawn: flap 1, verdict FAIL", () => {
    const perturbed = injectDispositionFlap(cleanOutput().manifest, {
      frameIndex: 2,
      entityId: "player-9",
    });
    const report = evaluatePerturbed(perturbed);
    expect(report.artifacts.dispositionFlapCount).toBe(1);
    // The boundary holds: the justified omission itself is NOT flicker.
    expect(report.identity.flickerCount).toBe(0);
    expect(report.verdict.pass).toBe(false);
    expect(report.verdict.failures.map((failure) => failure.metric)).toEqual([
      "artifacts.dispositionFlapCount",
    ]);
  });
});

describe("detection proof — applied-sequence gap (silently dropped event)", () => {
  test("shot event (sequence 13) vanishes: gap 1, verdict FAIL", () => {
    const perturbed = injectAppliedSequenceGap(cleanOutput().manifest, {
      frameIndex: 3,
      sequence: 13,
    });
    const report = evaluatePerturbed(perturbed);
    expect(report.artifacts.appliedGapCount).toBe(1);
    expect(report.verdict.pass).toBe(false);
    expect(report.verdict.failures.map((failure) => failure.metric)).toEqual([
      "artifacts.appliedGapCount",
    ]);
  });
});

describe("detection proof — duplicate event attribution", () => {
  test("kickoff captioned in two frames: duplicate counts 1 and 1, FAIL", () => {
    const perturbed = injectDuplicateEventAttribution(cleanOutput().manifest, {
      sequence: 11,
      fromFrameIndex: 0,
      toFrameIndex: 2,
    });
    const report = evaluatePerturbed(perturbed);
    expect(report.artifacts.appliedDuplicateCount).toBe(1);
    expect(report.artifacts.captionDuplicateCount).toBe(1);
    expect(report.verdict.pass).toBe(false);
    const failing = report.verdict.failures.map((failure) => failure.metric);
    expect(failing).toContain("artifacts.appliedDuplicateCount");
    expect(failing).toContain("artifacts.captionDuplicateCount");
  });
});

describe("detection proof — caption window overlap", () => {
  test("frame 2 window widened into frame 3: overlap 1, verdict FAIL", () => {
    const perturbed = injectWindowOverlap(cleanOutput().manifest, { frameIndex: 2 });
    const report = evaluatePerturbed(perturbed);
    expect(report.artifacts.windowOverlapCount).toBe(1);
    expect(report.verdict.pass).toBe(false);
    expect(report.verdict.failures.map((failure) => failure.metric)).toEqual([
      "artifacts.windowOverlapCount",
    ]);
  });
});

describe("detection proof — no injection is silently swallowed", () => {
  test("every failure entry carries metric, threshold, and measured value", () => {
    const perturbed = injectWatermarkRegression(cleanOutput().manifest, { frameIndex: 4 });
    const report = evaluatePerturbed(perturbed);
    for (const failure of report.verdict.failures) {
      expect(failure.metric).toBeString();
      expect(failure.threshold).toBe(0);
      expect(failure.measured).toBeGreaterThan(0);
      expect(failure.operator).toBe("max");
    }
  });
});
