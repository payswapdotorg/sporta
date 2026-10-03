import { describe, expect, test } from "bun:test";
import { FieldMappingPayload } from "@sporta/contracts";
import {
  CANONICAL_PITCH_CORNERS,
  applyHomography,
  invertHomography,
  solveHomography,
} from "@sporta/field-mapping";
import type { Homography } from "@sporta/field-mapping";
import { makeDetectorFrameInput } from "../src/index";
import type { DetectorFrameInput } from "../src/index";
import { CandidateFailureError } from "../src/errors";
import {
  BROADCAST_LINE_FIELD_CALIBRATOR_FAILURE_CLASSES,
  BroadcastLineCalibrator,
  buildBroadcastEllipseAnchorFrame,
  convertBroadcastEllipseAnchor,
  evaluateBroadcastEllipseGridGeometry,
  evaluateBroadcastLineFit,
  evaluateBroadcastPriorQuadContainment,
  evaluateBroadcastPriorWorldCircle,
  fitBroadcastEllipseEvidence,
  invert3x3,
  jacobiEigenSym3,
  poleOfLine,
} from "../src/calibration/broadcast-line";
import type { EllipseConic } from "../src/calibration/broadcast-line";
import {
  CENTER_CIRCLE,
  FRAME_COUNT,
  H_GT,
  M_PITCH_TO_IMAGE,
  PROBE_PITCH_POINTS,
  arcWindowFrames,
  projectImage,
  projectPitchNormalized,
  refusalClassOf,
  WIDTH,
  HEIGHT,
  BACKGROUND,
  GRASS,
  LINE,
  LEFT_PENALTY_ARC,
  MODEL_SEGMENTS,
  RIGHT_PENALTY_ARC,
  paintArc,
  setPixel,
  crossVec,
  dotVec,
  normalizeVec,
} from "./arc-window-fixture";

// ---------------------------------------------------------------------------
// The tests.
// ---------------------------------------------------------------------------

describe("BroadcastLineCalibrator v0.2.0 — the ellipse/circle-constrained path", () => {
  test("the arc window: v0.1.0 line-only refuses, the ellipse-constrained path calibrates within 2.5 m", () => {
    const frames = arcWindowFrames();
    // (a) The v0.1.0-equivalent line-only path refuses this window — the
    //     R606 record's arc-segment class.
    const lineOnly = refusalClassOf(() =>
      new BroadcastLineCalibrator({ ellipseConstrained: false }).calibrate({ frames }),
    );
    expect(lineOnly.classId).toBe("broadcast-line.no-consistent-homography");
    // (b) The v0.2.0 default calibrates it.
    const result = new BroadcastLineCalibrator().calibrate({ frames });
    let worstMeters = 0;
    for (const [pitchX, pitchY] of PROBE_PITCH_POINTS) {
      const image = projectPitchNormalized(M_PITCH_TO_IMAGE, pitchX, pitchY);
      // Fixture sanity: every probe lands inside the frame.
      expect(image.x).toBeGreaterThan(0);
      expect(image.x).toBeLessThan(1);
      expect(image.y).toBeGreaterThan(0);
      expect(image.y).toBeLessThan(1);
      const recovered = applyHomography(result.homography, image);
      worstMeters = Math.max(worstMeters, Math.hypot(recovered.x - pitchX, recovered.y - pitchY));
    }
    expect(worstMeters).toBeLessThan(2.5);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.confidence).toBeLessThanOrEqual(1);
    // 5 anchors: the 4 circle point anchors + the conic (documented).
    expect(result.correspondenceCount).toBe(5);
    expect(result.cornerSet.cornerOrder).toBe("tl, tr, br, bl");
    expect(result.cornerSet.corners.length).toBe(4);
    const parsed = FieldMappingPayload.safeParse(result.mapping);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.cameraHomographyRef).toContain("homography-");
    expect(result.homography[8]).toBeCloseTo(1, 12);
    // The fit quality the validation measured (the same gates the line
    // path uses, never lower): lineFit >= 0.6 over the full scored set,
    // backward <= 10 px, and the ellipse residual <= 4 px.
    const metrics = evaluateBroadcastLineFit({ frames }, result.homography);
    expect(metrics.lineFit).toBeGreaterThanOrEqual(0.6);
    expect(metrics.backwardPx ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(10);
    expect(metrics.ellipseMeanPx ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(4);
  }, 120_000);

  test("the ellipse-path arc evidence diagnostics record the fitted conic", () => {
    const frames = arcWindowFrames();
    const diagnostics = fitBroadcastEllipseEvidence({ frames });
    expect(diagnostics.fitted).toBe(true);
    expect(diagnostics.arcPixels).toBeGreaterThan(300);
    expect(diagnostics.supportPx ?? 0).toBeGreaterThanOrEqual(90);
    expect(diagnostics.coverageBins ?? 0).toBeGreaterThanOrEqual(12);
    // The fitted geometry approximates the TRUE projected circle
    // (center (337.3, 140.5) px, axes 100.4 x 19.3 px) within a few px.
    expect(Math.abs((diagnostics.centerPx?.x ?? 0) - 337.3)).toBeLessThan(4);
    expect(Math.abs((diagnostics.centerPx?.y ?? 0) - 140.5)).toBeLessThan(4);
    expect(Math.abs((diagnostics.semiMajorPx ?? 0) - 100.4)).toBeLessThan(4);
    expect(Math.abs((diagnostics.semiMinorPx ?? 0) - 19.3)).toBeLessThan(4);
  }, 60_000);

  test("an occluded circle refuses honestly (v0.3.0: at the hypothesis/validation stage — the flank-recovery explain admits the fixture's penalty arcs as quota-passing evidence)", () => {
    const frames = arcWindowFrames({ skipCenterCircle: true });
    // The line-only path still refuses (the arc window shape).
    const lineOnly = refusalClassOf(() =>
      new BroadcastLineCalibrator({ ellipseConstrained: false }).calibrate({ frames }),
    );
    expect(lineOnly.classId).toBe("broadcast-line.no-consistent-homography");
    // The ellipse path refuses honestly. v0.2.0: the arc evidence could
    // not support a center-circle conic fit (ellipse-evidence-
    // insufficient). v0.3.0 (straightness-aware explain — the flank
    // recovery): the fixture's PENALTY ARCS survive as arc evidence, the
    // quota PASSES on them, and the refusal moves to the LATER honest
    // stage — no conic-anchored hypothesis survives validation (a
    // penalty-arc conic is not the center circle; the solve refuses
    // rather than guessing). Both stages are typed refusals; the bar is
    // the same — never a calibration from non-circle evidence.
    const refusal = refusalClassOf(() => new BroadcastLineCalibrator().calibrate({ frames }));
    expect(refusal.classId).toBe("broadcast-line.ellipse-no-consistent-homography");
    // The measured evidence numbers ride the refusal.
    expect(refusal.details.arcPixels ?? refusal.details.linePathFailureDetails).toBeDefined();
    // And the recorded line-path refusal is carried.
    expect(refusal.details.linePathFailureClass).toBe("broadcast-line.no-consistent-homography");
    // The v0.2.0 class surface is reproducible with BOTH post-v0.2.0
    // increments off (straightness-aware explain AND multi-conic
    // selection — the chain alone moves a quota-passing sub-dominant
    // component's refusal to the validation stage).
    const v020 = refusalClassOf(() =>
      new BroadcastLineCalibrator({
        ellipseStraightnessAwareExplain: false,
        ellipseMultiConicSelection: false,
      }).calibrate({ frames }),
    );
    expect(v020.classId).toBe("broadcast-line.ellipse-evidence-insufficient");
  }, 60_000);

  test("arc evidence below quota (a 40° painted arc) refuses honestly (v0.3.0: at the hypothesis/validation stage)", () => {
    const frames = arcWindowFrames({ centerCircleSpanDeg: 40 });
    const refusal = refusalClassOf(() => new BroadcastLineCalibrator().calibrate({ frames }));
    // v0.2.0: the coverage quota (12 of 36 bins) refused the 40° arc.
    // v0.3.0: the straightness-aware explain admits the fixture's
    // penalty arcs; the quota passes on them and the honest refusal
    // moves to the validation stage (a partial circle + penalty arcs
    // still cannot anchor a valid solve).
    expect(refusal.classId).toBe("broadcast-line.ellipse-no-consistent-homography");
    // The v0.2.0 class surface is reproducible with BOTH post-v0.2.0
    // increments off (see the occluded-circle test).
    const v020 = refusalClassOf(() =>
      new BroadcastLineCalibrator({
        ellipseStraightnessAwareExplain: false,
        ellipseMultiConicSelection: false,
      }).calibrate({ frames }),
    );
    expect(v020.classId).toBe("broadcast-line.ellipse-evidence-insufficient");
    expect(
      v020.details.coverageBins === undefined || (v020.details.coverageBins as number) < 12,
    ).toBe(true);
  }, 60_000);

  test("v0.4.0 conic selection: a dominant non-circle curve — the v0.3.0 surface anchors to the curve and refuses; the chain's circle candidate passes the ellipse gates", () => {
    // The real-window conic-selection class (b8p3-b/b8p3-f, VLM-verified
    // on the committed overlays): a dominant non-circle CURVE whose
    // RANSAC winner outranks the center circle. The fixture curve (a
    // ~2500-px arc near the near touchline; the halfway line omitted —
    // its Hough-quantization shadow pollutes the circle's component)
    // makes the global RANSAC winner a curve fit (support ~1800) while
    // the circle's arc stays quota-passing evidence (~1818 support,
    // 36-of-36 coverage, its component fit the TRUE conic (337.3, 140.5)).
    const frames = arcWindowFrames({ hoardingCurve: true });
    // (a) The line-only path still refuses (the arc-window shape).
    const lineOnly = refusalClassOf(() =>
      new BroadcastLineCalibrator({ ellipseConstrained: false }).calibrate({ frames }),
    );
    expect(lineOnly.classId).toBe("broadcast-line.no-consistent-homography");
    // (b) The DEFAULT (v0.3.0-exact — the chain is opt-in since the
    //     b3-a visual-gate FAIL) refuses: the curve conic is the RANSAC
    //     winner, and its anchored solve fails validation (a curve is
    //     not the center circle; measured ellipse residual ~15.7 px
    //     > 4).
    const v030 = refusalClassOf(() =>
      new BroadcastLineCalibrator({ ellipseMultiConicSelection: false }).calibrate({ frames }),
    );
    expect(v030.classId).toBe("broadcast-line.ellipse-no-consistent-homography");
    const defaultRefusal = refusalClassOf(() =>
      new BroadcastLineCalibrator().calibrate({ frames }),
    );
    expect(defaultRefusal.classId).toBe(v030.classId);
    // (c) The OPT-IN chain: runs every quota-passing candidate, and the
    //     CHAIN RECORD proves the conic selection recovered the true
    //     circle — the circle candidate's outcome PASSES the ellipse
    //     gates (mean conic residual <= 4 px on the TRUE conic,
    //     backward chamfer <= 10 px) where the v0.3.0 primary's fails
    //     (~15.7 px). The window still refuses — only the lineFit bar
    //     fails, on the synthetic curve's own pixel mass (~40% of this
    //     fixture's scored set — a noise floor the real windows do not
    //     have; the REAL corpus's same mechanism machine-recovers b3-a
    //     at lineFit 0.731, VLM-verified as the goal-structure conic
    //     class — the reason the chain stays opt-in). The honest
    //     synthetic boundary, recorded here rather than laundered away.
    const refusal = refusalClassOf(() =>
      new BroadcastLineCalibrator({ ellipseMultiConicSelection: true }).calibrate({ frames }),
    );
    expect(refusal.classId).toBe("broadcast-line.ellipse-no-consistent-homography");
    const chain = refusal.details.conicChain as ReadonlyArray<Record<string, unknown>>;
    expect(chain.length).toBeGreaterThanOrEqual(2);
    // The primary's outcome: the ellipse gates FAIL (the curve conic).
    expect(chain[0]!.ellipseMeanPx as number).toBeGreaterThan(4);
    // The circle candidate's outcome: the ellipse gates PASS — the
    // conic selection delivered the true circle to the validation.
    const circleOutcome = chain.find((entry) => (entry.ellipseMeanPx as number) <= 4);
    expect(circleOutcome).toBeDefined();
    expect(circleOutcome!.backwardPx as number).toBeLessThanOrEqual(10);
    // The diagnostics record the candidate chain (opt-in: the default
    // records the primary alone): >= 2 candidates, the primary (the
    // curve) first, the circle among the alternatives.
    const diagnostics = fitBroadcastEllipseEvidence(
      { frames },
      { ellipseMultiConicSelection: true },
    );
    const candidates = diagnostics.conicCandidates ?? [];
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates[0]?.quotaPassed).toBe(true);
    // The primary is NOT the circle: its center is far from the true
    // projected circle center (~(337.3, 140.5) px — the v0.2.0 test's
    // recorded ground truth).
    expect(
      Math.hypot(
        (candidates[0]?.centerPx.x ?? 0) - 337.3,
        (candidates[0]?.centerPx.y ?? 0) - 140.5,
      ),
    ).toBeGreaterThan(40);
    // Some candidate IS the circle (within a few px of the ground truth).
    const circleCandidate = candidates.find(
      (candidate) =>
        Math.hypot(candidate.centerPx.x - 337.3, candidate.centerPx.y - 140.5) < 12 &&
        Math.abs(candidate.semiMajorPx - 100.4) < 12,
    );
    expect(circleCandidate).toBeDefined();
    expect(circleCandidate?.quotaPassed).toBe(true);
    // Deterministic: a second run deep-equals the first (the chain order
    // and every candidate's numbers).
    const diagnostics2 = fitBroadcastEllipseEvidence(
      { frames },
      { ellipseMultiConicSelection: true },
    );
    expect(diagnostics2).toEqual(diagnostics);
    // The default diagnostics records the primary alone (the chain is
    // opt-in) with the identical primary fields.
    const defaultDiagnostics = fitBroadcastEllipseEvidence({ frames });
    expect((defaultDiagnostics.conicCandidates ?? []).length).toBe(1);
    expect(defaultDiagnostics.arcPixels).toBe(diagnostics.arcPixels);
    expect(defaultDiagnostics.centerPx).toEqual(diagnostics.centerPx);
  }, 120_000);

  test("the ellipseMultiConicSelection option validates fail-loud (RangeError)", () => {
    expect(
      () => new BroadcastLineCalibrator({ ellipseMultiConicSelection: 1 as unknown as boolean }),
    ).toThrow(RangeError);
    expect(() =>
      fitBroadcastEllipseEvidence(
        { frames: arcWindowFrames() },
        {
          ellipseMultiConicSelection: "yes" as unknown as boolean,
        },
      ),
    ).toThrow(RangeError);
  }, 60_000);

  test("a degenerate grazing view refuses honestly at the earliest stage (no pitch visible)", () => {
    // A very low, far camera sees the pitch as a thin sliver: the
    // green-union gate refuses before any line/ellipse stage — the
    // honest earliest-incorrect-stage refusal, exactly as v0.1.0.
    // Render under a second pinhole ground truth.
    const position: readonly [number, number, number] = [52.5, -110, 2.2];
    const target: readonly [number, number, number] = [52.5, 40, 0];
    const zAxis = normalizeVec([
      target[0] - position[0],
      target[1] - position[1],
      target[2] - position[2],
    ]);
    const xAxis = normalizeVec(crossVec(zAxis, [0, 0, 1]));
    const yAxis = crossVec(zAxis, xAxis);
    const translation: readonly [number, number, number] = [
      -dotVec(xAxis, position),
      -dotVec(yAxis, position),
      -dotVec(zAxis, position),
    ];
    const mSliver: Homography = [
      (900 * xAxis[0] + (WIDTH / 2) * zAxis[0]) / WIDTH,
      (900 * xAxis[1] + (WIDTH / 2) * zAxis[1]) / WIDTH,
      (900 * translation[0] + (WIDTH / 2) * translation[2]) / WIDTH,
      (900 * yAxis[0] + (HEIGHT / 2) * zAxis[0]) / HEIGHT,
      (900 * yAxis[1] + (HEIGHT / 2) * zAxis[1]) / HEIGHT,
      (900 * translation[1] + (HEIGHT / 2) * translation[2]) / HEIGHT,
      zAxis[0],
      zAxis[1],
      translation[2],
    ];
    const hSliver = invertHomography(mSliver);
    const frames: DetectorFrameInput[] = [];
    for (let index = 0; index < FRAME_COUNT; index += 1) {
      const bytes = new Uint8Array(WIDTH * HEIGHT * 3);
      for (let i = 0; i < bytes.length; i += 3) {
        bytes[i] = BACKGROUND[0];
        bytes[i + 1] = BACKGROUND[1];
        bytes[i + 2] = BACKGROUND[2];
      }
      for (let y = 0; y < HEIGHT; y += 1) {
        for (let x = 0; x < WIDTH; x += 1) {
          const pitch = projectImage(hSliver, x / WIDTH, y / HEIGHT);
          if (pitch.x >= 0 && pitch.x <= 105 && pitch.y >= 0 && pitch.y <= 68) {
            const variation = ((x * 31 + y * 17) % 7) - 3;
            const pixel = (y * WIDTH + x) * 3;
            bytes[pixel] = GRASS[0] + variation;
            bytes[pixel + 1] = GRASS[1] + variation;
            bytes[pixel + 2] = GRASS[2] + variation;
          }
        }
      }
      frames.push(
        makeDetectorFrameInput({
          bytes,
          width: WIDTH,
          height: HEIGHT,
          decodeOrder: index,
          presentationMs: index * 40,
        }),
      );
    }
    const refusal = refusalClassOf(() => new BroadcastLineCalibrator().calibrate({ frames }));
    expect(refusal.classId).toBe("broadcast-line.no-pitch-visible");
    // Both paths refuse identically (the ellipse path never runs).
    const lineOnly = refusalClassOf(() =>
      new BroadcastLineCalibrator({ ellipseConstrained: false }).calibrate({ frames }),
    );
    expect(lineOnly.classId).toBe("broadcast-line.no-pitch-visible");
  }, 60_000);

  test("non-degradation: a window the line path calibrates returns byte-identical results", () => {
    // The FULL-MARKINGS broadcast-perspective fixture of the v0.1.0 test
    // suite (all boundary/interior lines + all circles visible): the line
    // path calibrates it, and the v0.2.0 default returns the IDENTICAL
    // result (the ellipse path never fires on a calibrated window).
    const GT_IMAGE_CORNERS = [
      { x: 0.08, y: 0.88 },
      { x: 0.95, y: 0.9 },
      { x: 0.74, y: 0.16 },
      { x: 0.3, y: 0.11 },
    ];
    const hQuad = solveHomography([...GT_IMAGE_CORNERS], [...CANONICAL_PITCH_CORNERS]); // image -> pitch
    const hQuadInverse = invertHomography(hQuad); // pitch -> image
    // Render a simple full-markings quad fixture (grass + every model
    // marking projected through the quad homography).
    const frames: DetectorFrameInput[] = [];
    for (let index = 0; index < FRAME_COUNT; index += 1) {
      const bytes = new Uint8Array(WIDTH * HEIGHT * 3);
      for (let i = 0; i < bytes.length; i += 3) {
        bytes[i] = BACKGROUND[0];
        bytes[i + 1] = BACKGROUND[1];
        bytes[i + 2] = BACKGROUND[2];
      }
      for (let y = 0; y < HEIGHT; y += 1) {
        for (let x = 0; x < WIDTH; x += 1) {
          const pitch = projectImage(hQuad, x / WIDTH, y / HEIGHT);
          if (pitch.x >= 0 && pitch.x <= 105 && pitch.y >= 0 && pitch.y <= 68) {
            const variation = ((x * 31 + y * 17) % 7) - 3;
            const pixel = (y * WIDTH + x) * 3;
            bytes[pixel] = GRASS[0] + variation;
            bytes[pixel + 1] = GRASS[1] + variation;
            bytes[pixel + 2] = GRASS[2] + variation;
          }
        }
      }
      const projectQuad = (px: number, py: number): { x: number; y: number } => {
        const image = projectPitchNormalized(hQuadInverse, px, py);
        return { x: image.x * WIDTH, y: image.y * HEIGHT };
      };
      const paintQuad = (px: number, py: number): void => {
        const image = projectQuad(px, py);
        const x = Math.round(image.x);
        const y = Math.round(image.y);
        setPixel(bytes, x, y, LINE);
        setPixel(bytes, x + 1, y, LINE);
        setPixel(bytes, x, y + 1, LINE);
        setPixel(bytes, x + 1, y + 1, LINE);
      };
      for (const [x0, y0, x1, y1] of MODEL_SEGMENTS) {
        const length = Math.hypot(x1 - x0, y1 - y0);
        const steps = Math.max(1, Math.ceil(length / 0.25));
        for (let step = 0; step <= steps; step += 1) {
          const t = step / steps;
          paintQuad(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
        }
      }
      for (const arc of [CENTER_CIRCLE, LEFT_PENALTY_ARC, RIGHT_PENALTY_ARC]) {
        paintArc(bytes, arc);
      }
      frames.push(
        makeDetectorFrameInput({
          bytes,
          width: WIDTH,
          height: HEIGHT,
          decodeOrder: index,
          presentationMs: index * 40,
        }),
      );
    }
    const withEllipse = new BroadcastLineCalibrator().calibrate({ frames });
    const withoutEllipse = new BroadcastLineCalibrator({ ellipseConstrained: false }).calibrate({
      frames,
    });
    expect(withEllipse).toEqual(withoutEllipse);
    expect(withEllipse.correspondenceCount).toBe(4);
  }, 120_000);

  test("deterministic: two ellipse-path calibrations deep-equal", () => {
    const calibrator = new BroadcastLineCalibrator();
    const frames = arcWindowFrames();
    const input = { frames };
    expect(calibrator.calibrate(input)).toEqual(calibrator.calibrate(input));
  }, 120_000);

  test("the ellipseConstrained option validates fail-loud (RangeError)", () => {
    expect(
      () => new BroadcastLineCalibrator({ ellipseConstrained: "yes" as unknown as boolean }),
    ).toThrow(RangeError);
    expect(
      () => new BroadcastLineCalibrator({ ellipseConstrained: 1 as unknown as boolean }),
    ).toThrow(RangeError);
  });

  test("the diagnostic exports validate fail-loud (RangeError)", () => {
    const frames = arcWindowFrames();
    expect(() => fitBroadcastEllipseEvidence({ frames }, { minPitchFraction: 0 })).toThrow(
      RangeError,
    );
    expect(() => evaluateBroadcastLineFit({ frames }, [1, 2, 3] as unknown as Homography)).toThrow(
      RangeError,
    );
  });
});

/** Exported for the development-time probe scripts (harness-only). */
export { arcWindowFrames };

// ---------------------------------------------------------------------------
// v0.4.1 — the validation-gate hardening (chain-only; the b3-a class).
// ---------------------------------------------------------------------------

/**
 * Builds the EllipseConic (coefficient form) of an ellipse geometry — the
 * exact algebraic inverse of the module's `conicGeometry` decomposition —
 * so the FROZEN b3-a record's geometry (center/semis/rotation, transcribed
 * at full precision from the committed measurement.json) can drive the
 * pure grid-geometry gate test.
 */
function conicOfGeometry(
  centerX: number,
  centerY: number,
  semiMajor: number,
  semiMinor: number,
  rotation: number,
): { a: number; b: number; c: number; d: number; e: number; f: number } {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const invA2 = 1 / (semiMajor * semiMajor);
  const invB2 = 1 / (semiMinor * semiMinor);
  const q11 = cos * cos * invA2 + sin * sin * invB2;
  const q22 = sin * sin * invA2 + cos * cos * invB2;
  const q12 = cos * sin * (invA2 - invB2);
  return {
    a: q11,
    b: 2 * q12,
    c: q22,
    d: -2 * (q11 * centerX + q12 * centerY),
    e: -2 * (q12 * centerX + q22 * centerY),
    f: q11 * centerX * centerX + 2 * q12 * centerX * centerY + q22 * centerY * centerY - 1,
  };
}

describe("BroadcastLineCalibrator v0.4.1 — the validation-gate hardening (chain-only)", () => {
  test("a healthy chain calibration is byte-identical with the hardening on (the chain-on plain window equals the chain-off result)", () => {
    // The plain arc window calibrates through the PRIMARY (the true
    // circle, quota-passing, grass-supported, its solve a real quad):
    // the hardening's two gates must PASS it and the chain-on result
    // must deep-equal the v0.3.0-exact single-conic result — the
    // hardening adds discrimination, never a disturbance.
    const frames = arcWindowFrames();
    const chainOff = new BroadcastLineCalibrator({
      ellipseMultiConicSelection: false,
    }).calibrate({ frames });
    const chainOn = new BroadcastLineCalibrator({
      ellipseMultiConicSelection: true,
    }).calibrate({ frames });
    expect(chainOn).toEqual(chainOff);
    expect(chainOn.confidence).toBeGreaterThan(0.5);
    expect(chainOn.correspondenceCount).toBe(5);
  }, 120_000);

  test("the b3-a class (a static non-green structure on the grass): the chain refuses the structure's conic pre-solve with the typed grass class; the default surface is unchanged", () => {
    // The netStructure fixture: the center circle omitted (out of view —
    // the real b3-a recorded fact) and a static filled white disk on the
    // grass whose rim band is a quota-passing conic — the goal/net
    // structure class the v0.4.0 chain anchored its (VLM-refuted) solve
    // on. The v0.4.1 grass-support gate must refuse that candidate
    // BEFORE its solve, the measured median riding the typed refusal.
    const frames = arcWindowFrames({ netStructure: true });
    const refusal = refusalClassOf(() =>
      new BroadcastLineCalibrator({ ellipseMultiConicSelection: true }).calibrate({ frames }),
    );
    expect(refusal.classId).toBe("broadcast-line.ellipse-conic-off-pitch");
    // The measured discrimination: the disk's interior is white in every
    // frame (median ~0.02 measured; a real circle's interior is grass —
    // 0.90 on the plain fixture, measured) over a full in-bounds sample grid.
    expect(refusal.details.greenInteriorMedian as number).toBeLessThan(0.1);
    expect(refusal.details.samplesInBounds as number).toBeGreaterThanOrEqual(50);
    expect(refusal.details.conicIndex).toBe(0);
    // The additive chain record: the refused structure candidate FIRST,
    // then the solved (grass-backed) alternatives with their honest
    // validation outcomes — every candidate's measured outcome recorded.
    const chain = refusal.details.conicChain as ReadonlyArray<Record<string, unknown>>;
    expect(chain.length).toBeGreaterThanOrEqual(2);
    expect(chain[0]!.failureClassId).toBe("broadcast-line.ellipse-conic-off-pitch");
    expect(chain[0]!.greenInteriorMedian as number).toBeLessThan(0.1);
    // The DEFAULT surface (chain off) on the same fixture: the honest
    // v0.3.0 refusal (the quota fails on the global winner) — the
    // hardening never touches the default path.
    const v030 = refusalClassOf(() =>
      new BroadcastLineCalibrator({ ellipseMultiConicSelection: false }).calibrate({ frames }),
    );
    expect(v030.classId).toBe("broadcast-line.ellipse-evidence-insufficient");
    // The recorded line-path refusal rides both.
    expect(refusal.details.linePathFailureClass).toBe("broadcast-line.no-consistent-homography");
  }, 120_000);

  test("the projected-grid geometry gate: the FROZEN b3-a chain homography is the degenerate class; a healthy solve's quad contains its conic", () => {
    // The frozen record (scripts/evidence/r606-ellipse-constrained/
    // measurement.json, window b3-a, path v040Chain — the WITHHELD
    // claim): the solved homography, at full recorded precision, and
    // the winning conic's geometry (conicCandidates[1]). The measured
    // defect: the WHOLE pitch (corners, interior, circle rim) projects
    // to image (575, 98) — a point-collapse on the goal-structure
    // conic that satisfied every v0.4.0 machine gate.
    const H_B3A: Homography = [
      -88.36795791427605, 68.61881390163505, 60.73539142302648, -60.681864133921415,
      60.247400824810356, 38.14191934597057, -1.5103647140254437, 1.3130296284410223, 1,
    ];
    const CONIC_B3A = conicOfGeometry(
      574.2750799089282,
      78.96140444447796,
      20.321122464326212,
      16.722515225559825,
      (102.27707209379237 * Math.PI) / 180,
    );
    const degenerate = evaluateBroadcastEllipseGridGeometry(H_B3A, CONIC_B3A, 640, 360);
    expect(degenerate.ok).toBe(false);
    // The conic's area recovers the frozen geometry (~1068 px²)…
    expect(
      Math.abs(degenerate.conicAreaPx - Math.PI * 20.321122464326212 * 16.722515225559825),
    ).toBeLessThan(1);
    // …while the projected pitch quad has ~no area and ~no corner
    // separation (all four corners at (575, 98): the point-collapse).
    expect(degenerate.quadAreaPx).toBeLessThan(5);
    expect(degenerate.cornerMinSeparationPx).toBeLessThan(1);
    // The healthy surface: the plain fixture's solved homography + its
    // fitted conic — the projected quad CONTAINS the conic (the
    // containment invariant) with the measured ~41x area ratio.
    const frames = arcWindowFrames();
    const result = new BroadcastLineCalibrator({ ellipseMultiConicSelection: true }).calibrate({
      frames,
    });
    const conic = fitBroadcastEllipseEvidence({ frames }).conic!;
    const healthy = evaluateBroadcastEllipseGridGeometry(result.homography, conic, 640, 360);
    expect(healthy.ok).toBe(true);
    expect(healthy.quadAreaPx).toBeGreaterThanOrEqual(healthy.conicAreaPx);
    expect(healthy.quadAreaPx / healthy.conicAreaPx).toBeGreaterThan(10);
    expect(healthy.cornerMinSeparationPx).toBeGreaterThan(100);
    // Deterministic: a second evaluation deep-equals.
    expect(evaluateBroadcastEllipseGridGeometry(H_B3A, CONIC_B3A, 640, 360)).toEqual(degenerate);
    // Fail-loud validation (the module's diagnostic-export contract).
    expect(() =>
      evaluateBroadcastEllipseGridGeometry([1, 2, 3] as unknown as Homography, CONIC_B3A, 640, 360),
    ).toThrow(RangeError);
    expect(() =>
      evaluateBroadcastEllipseGridGeometry(H_B3A, { a: 1, b: 0, c: 1, d: 0, e: 0, f: 0 }, 640, 360),
    ).toThrow(RangeError);
    expect(() => evaluateBroadcastEllipseGridGeometry(H_B3A, CONIC_B3A, 0, 360)).toThrow(
      RangeError,
    );
  }, 120_000);

  test("the hardening's failure classes are additive on the exported taxonomy", () => {
    const ids = BROADCAST_LINE_FIELD_CALIBRATOR_FAILURE_CLASSES.map(
      (record) => record.failureClassId,
    );
    // The two v0.4.1 typed classes (the grass-support leg + the
    // projected-grid geometry leg), additive — every prior class present.
    expect(ids.filter((id) => id === "broadcast-line.ellipse-conic-off-pitch").length).toBe(1);
    expect(ids.filter((id) => id === "broadcast-line.ellipse-degenerate-grid").length).toBe(1);
    expect(ids).toContain("broadcast-line.no-pitch-visible");
    expect(ids).toContain("broadcast-line.camera-motion");
    expect(ids).toContain("broadcast-line.insufficient-line-evidence");
    expect(ids).toContain("broadcast-line.no-consistent-homography");
    expect(ids).toContain("broadcast-line.ellipse-evidence-insufficient");
    expect(ids).toContain("broadcast-line.ellipse-no-consistent-homography");
    const newRecords = BROADCAST_LINE_FIELD_CALIBRATOR_FAILURE_CLASSES.filter(
      (record) =>
        record.failureClassId === "broadcast-line.ellipse-conic-off-pitch" ||
        record.failureClassId === "broadcast-line.ellipse-degenerate-grid",
    );
    for (const record of newRecords) {
      expect(record.retryable).toBe(false);
      expect(record.description.length).toBeGreaterThan(40);
    }
  });
});

// ---------------------------------------------------------------------------
// v0.5.0 — the E4b anchor conversion (the Lorentz-frame J-orthogonal exact
// closure; OPT-IN `ellipseAnchorConversion`, default false — module docs E4b).
// ---------------------------------------------------------------------------

/** Row-major 3x3 matrix product A·B (the test's own, independent helper). */
function mat3Mul(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(9);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      out[row * 3 + col] =
        a[row * 3]! * b[col]! + a[row * 3 + 1]! * b[3 + col]! + a[row * 3 + 2]! * b[6 + col]!;
    }
  }
  return out;
}

/** The transpose of a row-major 3x3 matrix. */
function mat3Transpose(m: readonly number[]): number[] {
  return [m[0]!, m[3]!, m[6]!, m[1]!, m[4]!, m[7]!, m[2]!, m[5]!, m[8]!];
}

/** The congruence Mᵀ·C·M of row-major 3x3 matrices. */
function mat3Congruence(m: readonly number[], c: readonly number[]): number[] {
  return mat3Mul(mat3Transpose(m), mat3Mul(c, m));
}

/** The matrix-vector product A·v of a row-major 3x3 and a 3-vector. */
function mat3Apply(m: readonly number[], v: readonly number[]): number[] {
  return [
    m[0]! * v[0]! + m[1]! * v[1]! + m[2]! * v[2]!,
    m[3]! * v[0]! + m[4]! * v[1]! + m[5]! * v[2]!,
    m[6]! * v[0]! + m[7]! * v[1]! + m[8]! * v[2]!,
  ];
}

/** The homogeneous point application of a row-major 3x3 (general z ≠ 1). */
function mat3ApplyPoint(m: readonly number[], x: number, y: number): { x: number; y: number } {
  const denominator = m[6]! * x + m[7]! * y + m[8]!;
  return {
    x: (m[0]! * x + m[1]! * y + m[2]!) / denominator,
    y: (m[3]! * x + m[4]! * y + m[5]!) / denominator,
  };
}

/** Relative Frobenius deviation ||a − b||_F / ||b||_F of two 3x3 matrices. */
function relativeFrobenius3(a: readonly number[], b: readonly number[]): number {
  let diff = 0;
  let norm = 0;
  for (let k = 0; k < 9; k += 1) {
    diff += (a[k]! - b[k]!) ** 2;
    norm += b[k]! ** 2;
  }
  return Math.sqrt(diff / norm);
}

/** The Lorentz form J = diag(1, 1, −1), row-major. */
const LORENTZ_J: readonly number[] = [1, 0, 0, 0, 1, 0, 0, 0, -1];
const IDENTITY_3: readonly number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * The world center circle's homogeneous conic matrix (pitch meters), built
 * from the fixture's model circle (52.5, 34, r = 9.15) — the W side of the
 * E4b factorization, re-derived independently of the module's constant.
 */
function worldCircleConic(): number[] {
  const cx = CENTER_CIRCLE.cx;
  const cy = CENTER_CIRCLE.cy;
  const r = CENTER_CIRCLE.r;
  return [1, 0, -cx, 0, 1, -cy, -cx, -cy, cx * cx + cy * cy - r * r];
}

/**
 * The GROUND-TRUTH image conic in PIXELS: Q_px = S⁻ᵀ·(H_GTᵀ·C_w·H_GT)·S⁻¹
 * with S = diag(WIDTH, HEIGHT, 1) — the image of the world circle under the
 * fixture's true pinhole homography, expressed in px coordinates (the
 * machinery's homographies map NORMALIZED image coords → pitch, so its
 * internal conic is Q̂ = Sᵀ·Q_px·S; the frame construction must make that
 * conversion itself — the coordinate-convention trap this suite pins).
 */
function groundTruthConicPx(): EllipseConic {
  const qHat = mat3Congruence(H_GT, worldCircleConic());
  const sInv = [1 / WIDTH, 0, 0, 0, 1 / HEIGHT, 0, 0, 0, 1]; // S diagonal ⟹ S⁻ᵀ = S⁻¹
  const qPx = mat3Mul(sInv, mat3Mul(qHat, sInv));
  return {
    a: qPx[0]!,
    b: 2 * qPx[1]!,
    c: qPx[4]!,
    d: 2 * qPx[2]!,
    e: 2 * qPx[5]!,
    f: qPx[8]!,
  };
}

describe("BroadcastLineCalibrator v0.5.0 — the E4b anchor conversion (the Lorentz-frame J-orthogonal exact closure)", () => {
  test("invert3x3 unit contract: the inverse composes to the identity on both sides; singular and non-finite inputs refuse", () => {
    const m = [2, 1, 0.5, 1, 3, 0.25, 0.5, 0.25, 1.75];
    const inverse = invert3x3(m);
    expect(inverse).toBeDefined();
    // M·M⁻¹ = I and M⁻¹·M = I (both orders — the defining contract).
    const right = mat3Mul(m, inverse!);
    const left = mat3Mul(inverse!, m);
    for (let k = 0; k < 9; k += 1) {
      expect(Math.abs(right[k]! - IDENTITY_3[k]!)).toBeLessThan(1e-12);
      expect(Math.abs(left[k]! - IDENTITY_3[k]!)).toBeLessThan(1e-12);
    }
    // An analytic case: diag(2, 4, 8)⁻¹ = diag(1/2, 1/4, 1/8) exactly.
    expect(invert3x3([2, 0, 0, 0, 4, 0, 0, 0, 8])).toEqual([0.5, 0, 0, 0, 0.25, 0, 0, 0, 0.125]);
    // Rank-deficient input (rows 0 and 1 proportional) refuses.
    expect(invert3x3([1, 2, 3, 2, 4, 6, 7, 8, 9])).toBeUndefined();
    // Non-finite input refuses (never a silently NaN-carrying inverse).
    expect(invert3x3([1, 0, 0, 0, 1, 0, 0, 0, Number.NaN])).toBeUndefined();
  });

  test("poleOfLine unit contract: the polar of the pole is the line (the pole-polar duality); the analytic Lorentz pole; singular conics refuse", () => {
    // (a) The duality round trip: p = C⁻¹·l ⟹ C·p ∝ l — the polar of the
    //     pole IS the line, the property every projective map preserves (the
    //     E4b near-line pole row's exactness rests on it).
    const cWorld = worldCircleConic();
    const line: [number, number, number] = [0.6, 0.8, -1];
    const pole = poleOfLine(cWorld, line);
    expect(pole).toBeDefined();
    const polar = mat3Apply(cWorld, pole!);
    const scale = Math.max(Math.abs(polar[0]!), Math.abs(polar[1]!), Math.abs(polar[2]!));
    for (let k = 0; k < 3; k += 1) {
      expect(Math.abs(polar[k]! / scale - line[k]!)).toBeLessThan(1e-12);
    }
    // (b) The analytic contract against the Lorentz form itself: the pole of
    //     the line x = 2 w.r.t. the unit circle x² + y² − z² = 0 is the
    //     point (1/2, 0, 1) (the polar of (1/2, 0) is x = 2 — the classic
    //     duality), max-abs normalized.
    expect(poleOfLine(LORENTZ_J, [1, 0, -2])).toEqual([0.5, 0, 1]);
    // (c) A singular conic refuses (the pole is undefined).
    expect(poleOfLine([1, 2, 3, 2, 4, 6, 3, 6, 9], [1, 0, 0])).toBeUndefined();
  });

  test("jacobiEigenSym3 unit contract: A·v = λ·v for every eigenpair, V orthogonal, the analytic spectrum, deterministic", () => {
    const a = [2, 1, 0, 1, 2, 1, 0, 1, 2];
    const eigen = jacobiEigenSym3(a);
    // (a) The DEFINING contract: A·vⱼ = λⱼ·vⱼ for every eigenpair (COLUMN j
    //     of `vectors` is the unit eigenvector of `values[j]`).
    for (let j = 0; j < 3; j += 1) {
      const v = [eigen.vectors[j]!, eigen.vectors[3 + j]!, eigen.vectors[6 + j]!];
      const av = mat3Apply(a, v);
      for (let k = 0; k < 3; k += 1) {
        expect(Math.abs(av[k]! - eigen.values[j]! * v[k]!)).toBeLessThan(1e-12);
      }
      expect(Math.hypot(v[0]!, v[1]!, v[2]!)).toBeCloseTo(1, 12);
    }
    // (b) V is orthogonal: Vᵀ·V = I.
    const vt = mat3Transpose(eigen.vectors);
    const vtv = mat3Mul(vt, eigen.vectors);
    for (let k = 0; k < 9; k += 1) {
      expect(Math.abs(vtv[k]! - IDENTITY_3[k]!)).toBeLessThan(1e-12);
    }
    // (c) The analytic spectrum: the tridiagonal (2,1,0;1,2,1;0,1,2) has
    //     eigenvalues exactly {2 − √2, 2, 2 + √2}.
    const sorted = [...eigen.values].sort((x, y) => x - y);
    const expected = [2 - Math.SQRT2, 2, 2 + Math.SQRT2];
    for (let k = 0; k < 3; k += 1) {
      expect(sorted[k]).toBeCloseTo(expected[k]!, 12);
    }
    // (d) Deterministic: a second decomposition deep-equals the first.
    expect(jacobiEigenSym3(a)).toEqual(eigen);
    // (e) An already-diagonal matrix returns its own diagonal and the
    //     identity basis (the sweep breaks before any rotation).
    const diagonal = jacobiEigenSym3([3, 0, 0, 0, 1, 0, 0, 0, 7]);
    expect(diagonal.values).toEqual([3, 1, 7]);
    expect(diagonal.vectors).toEqual([...IDENTITY_3]);
  });

  test("the ground-truth conic canonicalization: GᵀJG = Q̂ re-derived independently; W·W⁻¹ = I; the sign twin converts; the IMAGINARY class refuses (the px-vs-normalized coordinate-convention trap)", () => {
    const cWorld = worldCircleConic();
    const conicPx = groundTruthConicPx();
    // Sanity of the construction itself: every world-circle sample point
    // projected through the true pinhole map (pitch → NORMALIZED image →
    // px, i.e. multiplied by WIDTH/HEIGHT) lies ON the px conic — the
    // algebraic-to-geometric distance |F| / ‖∇F‖ at the boundary.
    for (let i = 0; i < 24; i += 1) {
      const angle = (i * 2 * Math.PI) / 24;
      const image = projectPitchNormalized(
        M_PITCH_TO_IMAGE,
        CENTER_CIRCLE.cx + CENTER_CIRCLE.r * Math.cos(angle),
        CENTER_CIRCLE.cy + CENTER_CIRCLE.r * Math.sin(angle),
      );
      const x = image.x * WIDTH;
      const y = image.y * HEIGHT;
      const value =
        conicPx.a * x * x +
        conicPx.b * x * y +
        conicPx.c * y * y +
        conicPx.d * x +
        conicPx.e * y +
        conicPx.f;
      const gradientX = 2 * conicPx.a * x + conicPx.b * y + conicPx.d;
      const gradientY = conicPx.b * x + 2 * conicPx.c * y + conicPx.e;
      expect(Math.abs(value) / Math.hypot(gradientX, gradientY)).toBeLessThan(1e-9);
    }
    // The frame: G with GᵀJG = Q̂ — re-derived HERE, independently of the
    // module's congruence helpers. C_w carries the (2, 1) inertia and the
    // congruence preserves inertia, so the J-matching representative is
    // +Q̂ exactly (measured 1.3e-15 relative; the −Q̂ twin sits at 2.0).
    const frame = buildBroadcastEllipseAnchorFrame(conicPx, WIDTH, HEIGHT);
    expect(frame).toBeDefined();
    const qHat = mat3Congruence(H_GT, cWorld);
    const gJg = mat3Congruence(frame!.g, LORENTZ_J);
    expect(relativeFrobenius3(gJg, qHat)).toBeLessThan(1e-9);
    expect(relativeFrobenius3(frame!.qCanon, qHat)).toBeLessThan(1e-9);
    // The world side: W with WᵀJW = C_w, and both inverses compose to I.
    expect(relativeFrobenius3(mat3Congruence(frame!.w, LORENTZ_J), cWorld)).toBeLessThan(1e-9);
    expect(relativeFrobenius3(mat3Mul(frame!.w, frame!.wInverse), IDENTITY_3)).toBeLessThan(1e-12);
    expect(relativeFrobenius3(mat3Mul(frame!.g, frame!.gInverse), IDENTITY_3)).toBeLessThan(1e-12);
    // THE SIGN TWIN −Q_px (the same conic — conic matrices are scale-free)
    // canonicalizes IDENTICALLY: the arrangement is by sign class and the
    // representative by inertia, never by the input's sign (measured
    // bit-exact), and the twin CONVERTS the true homography.
    const conicNeg: EllipseConic = {
      a: -conicPx.a,
      b: -conicPx.b,
      c: -conicPx.c,
      d: -conicPx.d,
      e: -conicPx.e,
      f: -conicPx.f,
    };
    const twinFrame = buildBroadcastEllipseAnchorFrame(conicNeg, WIDTH, HEIGHT);
    expect(twinFrame).toBeDefined();
    expect(twinFrame!.g).toEqual(frame!.g);
    const twinConversion = convertBroadcastEllipseAnchor(conicNeg, WIDTH, HEIGHT, H_GT);
    expect(twinConversion.kind).toBe("converted");
    if (twinConversion.kind === "converted") {
      for (let k = 0; k < 9; k += 1) {
        expect(Math.abs(twinConversion.homography[k]! - H_GT[k]!)).toBeLessThan(1e-9);
      }
    }
    // THE IMAGINARY CLASS refuses: an all-same-sign conic (x² + y² + 1 = 0
    // — no real points) cannot carry the x² + y² − z² = 0 Lorentz form.
    const imaginary: EllipseConic = { a: 1, b: 0, c: 1, d: 0, e: 0, f: 1 };
    expect(buildBroadcastEllipseAnchorFrame(imaginary, WIDTH, HEIGHT)).toBeUndefined();
    const imaginaryConversion = convertBroadcastEllipseAnchor(imaginary, WIDTH, HEIGHT, H_GT);
    expect(imaginaryConversion.kind).toBe("unconverted");
    if (imaginaryConversion.kind === "unconverted") {
      expect(imaginaryConversion.reason).toBe("conic-canonicalization");
    }
  }, 60_000);

  test("the fixed point and the perturbed-H₀ conic-exact closure (world-circle residual < 1e-6 m²)", () => {
    const conicPx = groundTruthConicPx();
    // (a) THE FIXED POINT: the closure of the TRUE homography against the
    //     ground-truth conic is the true homography itself — measured
    //     EXACTLY (max entry diff 0): N = μ·J fires the fast path
    //     (deviation ~4.9e-15), which returns M₀/√μ = W⁻¹·P·G/√μ whose
    //     canonical h[8] = 1 renormalization collapses back onto the input.
    //     This is also the coordinate-convention proof: the machinery maps
    //     NORMALIZED image coords → pitch, so the px-conic + true-H pair
    //     closes over exactly (a px-convention mistake breaks it).
    const fixed = convertBroadcastEllipseAnchor(conicPx, WIDTH, HEIGHT, H_GT);
    expect(fixed.kind).toBe("converted");
    if (fixed.kind === "converted") {
      expect(fixed.fastPath).toBe(true);
      expect(fixed.relativeDeviation).toBeLessThan(1e-9);
      for (let k = 0; k < 9; k += 1) {
        expect(Math.abs(fixed.homography[k]! - H_GT[k]!)).toBeLessThan(1e-9);
      }
    }
    // (b) THE PERTURBED H₀: a slightly-off homography (entry [2] +1e-3,
    //     entry [6] −2e-4 — measured deviation 9.1e-5, far from the fast
    //     path, well inside the admissibility bound) converts through the
    //     EIGENDECOMPOSITION path, and the closure is conic-EXACT: every
    //     world-circle sample projected through Ĥ⁻¹ to the image and back
    //     through H_GT lands ON the world circle (measured worst squared
    //     residual 4.6e-27 m²).
    const hPert = H_GT.map((value, k) => (k === 2 ? value + 1e-3 : k === 6 ? value - 2e-4 : value));
    const perturbed = convertBroadcastEllipseAnchor(conicPx, WIDTH, HEIGHT, hPert as Homography);
    expect(perturbed.kind).toBe("converted");
    if (perturbed.kind === "converted") {
      expect(perturbed.fastPath).toBe(false);
      expect(perturbed.relativeDeviation).toBeGreaterThan(1e-9);
      expect(perturbed.relativeDeviation).toBeLessThan(0.1);
      const inverse = invert3x3(perturbed.homography);
      expect(inverse).toBeDefined();
      let worstResidual = 0;
      for (let i = 0; i < 72; i += 1) {
        const angle = (i * 2 * Math.PI) / 72;
        const worldX = CENTER_CIRCLE.cx + CENTER_CIRCLE.r * Math.cos(angle);
        const worldY = CENTER_CIRCLE.cy + CENTER_CIRCLE.r * Math.sin(angle);
        // Ĥ⁻¹: pitch → NORMALIZED image (the machinery's convention).
        const image = mat3ApplyPoint(inverse!, worldX, worldY);
        // H_GT: normalized image → pitch — the round trip must land back
        // on the circle (the conic-exact closure property).
        const back = projectImage(H_GT, image.x, image.y);
        const radial = Math.hypot(back.x - CENTER_CIRCLE.cx, back.y - CENTER_CIRCLE.cy);
        worstResidual = Math.max(worstResidual, (radial - CENTER_CIRCLE.r) ** 2);
      }
      expect(worstResidual).toBeLessThan(1e-6);
    }
    // (c) THE ADMISSIBILITY BOUND's refusing leg: a direction-changing
    //     scale error (entry [0] doubled — measured deviation 4.4, far
    //     over the bound) stays UNCONVERTED with the typed reason — the
    //     closure is never fabricated from anchors that never agreed with
    //     the conic. (A pure translation shift, by contrast, stays inside
    //     the bound and converts — the closure PROJECTS it back to
    //     conic-exactness; the bound refuses inconsistent DIRECTIONS, not
    //     consistent maps with shifted line rows.)
    const hWild = H_GT.map((value, k) => (k === 0 ? value * 2 : value));
    const wild = convertBroadcastEllipseAnchor(conicPx, WIDTH, HEIGHT, hWild as Homography);
    expect(wild.kind).toBe("unconverted");
    if (wild.kind === "unconverted") {
      expect(wild.reason).toBe("admissibility-bound");
      expect(wild.relativeDeviation).toBeGreaterThan(0.1);
    }
  }, 60_000);

  test("the anchors-fight pipeline record: the plain fixture refuses at the unchanged bar (the conic-exact closure contradicts the line evidence)", () => {
    const frames = arcWindowFrames();
    // The DEFAULT surface calibrates this fixture (the v0.2.0 test): the
    // mixed-DLT solve + the E5 refinement COMPROMISE the conic
    // correspondence against the line evidence and pass the bar.
    const compromise = new BroadcastLineCalibrator().calibrate({ frames });
    expect(compromise.confidence).toBeGreaterThan(0.9);
    // The OPT-IN conversion path replaces the flow with the J-orthogonal
    // exact closure: the conic correspondence becomes exact BY
    // CONSTRUCTION, the finalists run the UNCHANGED validation bar WITHOUT
    // the refinement — and the bar REFUSES honestly. The globally
    // re-balanced line rows land at lineFit 0.467 (< 0.60) where the
    // compromise scored confidence 0.921 on the same pixels (the
    // anchors-fight outcome: the closure makes the conic/line
    // inconsistency EXPLICIT instead of compromising it away; nothing
    // laundered).
    const refusal = refusalClassOf(() =>
      new BroadcastLineCalibrator({ ellipseAnchorConversion: true }).calibrate({ frames }),
    );
    expect(refusal.classId).toBe("broadcast-line.ellipse-no-consistent-homography");
    // The per-candidate ANCHOR RECORD rides the refusal: 30240 scan solves
    // enumerated, 8 converted (the near-conic-consistent cluster inside
    // the admissibility bound), and the converted count IS the hypothesis
    // count on the conversion path.
    expect(refusal.details.anchorScanSolves).toBe(30240);
    expect(refusal.details.anchorConverted).toBe(8);
    expect(refusal.details.hypotheses).toBe(8);
    // The conic-exact residual rides the refusal (machine epsilon — the
    // closure IS conic-exact) alongside the failing line-evidence numbers.
    expect(refusal.details.ellipseMeanPx as number).toBeLessThan(1e-9);
    expect(refusal.details.lineFit as number).toBeLessThan(0.6);
    expect(refusal.details.lineFit as number).toBeCloseTo(0.4669, 3);
    expect(refusal.details.backwardPx as number).toBeCloseTo(4.793, 2);
    // The chain entry carries the same anchor record (single-conic path:
    // a one-entry chain).
    const chain = refusal.details.conicChain as ReadonlyArray<Record<string, unknown>>;
    expect(chain.length).toBe(1);
    expect(chain[0]!.anchorScanSolves).toBe(30240);
    expect(chain[0]!.anchorConverted).toBe(8);
    // The line path's refusal rides it (the ellipse path ran after it).
    expect(refusal.details.linePathFailureClass).toBe("broadcast-line.no-consistent-homography");
  }, 120_000);

  test("the anchors-fight pipeline record: the offsetCircle fixture (a real grass-backed circle 17 m off the model center) refuses at the unchanged bar on BOTH gates", () => {
    // The v0.5.0 fixture: the FULL grass-backed circle painted at
    // (~(69.5, 34), r 9.15) instead of the true center circle — the b5-b
    // real-window class. The fitted conic is a REAL quota-passing circle,
    // but the E4b machinery's world-side anchor is the MODEL circle at
    // (52.5, 34): the closure is conic-exact against the WRONG world
    // circle and the unchanged bar refuses honestly on BOTH gates (the
    // conic-exact survivors' line rows fight).
    const frames = arcWindowFrames({ offsetCircle: true });
    const refusal = refusalClassOf(() =>
      new BroadcastLineCalibrator({ ellipseAnchorConversion: true }).calibrate({ frames }),
    );
    expect(refusal.classId).toBe("broadcast-line.ellipse-no-consistent-homography");
    // The per-candidate anchor record: 30240 enumerated / 12 converted.
    expect(refusal.details.anchorScanSolves).toBe(30240);
    expect(refusal.details.anchorConverted).toBe(12);
    expect(refusal.details.hypotheses).toBe(12);
    // The conic-exact residual (machine epsilon) rides the refusal, and
    // BOTH validation gates fail on this fixture: lineFit 0.340 < 0.60
    // AND backward 11.37 px > 10.
    expect(refusal.details.ellipseMeanPx as number).toBeLessThan(1e-9);
    expect(refusal.details.lineFit as number).toBeLessThan(0.6);
    expect(refusal.details.lineFit as number).toBeCloseTo(0.3404, 3);
    expect(refusal.details.backwardPx as number).toBeGreaterThan(10);
    expect(refusal.details.backwardPx as number).toBeCloseTo(11.373, 2);
    const chain = refusal.details.conicChain as ReadonlyArray<Record<string, unknown>>;
    expect(chain.length).toBe(1);
    expect(chain[0]!.anchorScanSolves).toBe(30240);
    expect(chain[0]!.anchorConverted).toBe(12);
    expect(refusal.details.linePathFailureClass).toBe("broadcast-line.no-consistent-homography");
  }, 120_000);

  test("the ellipseAnchorConversion option and the E4b diagnostic exports validate fail-loud (RangeError)", () => {
    expect(
      () => new BroadcastLineCalibrator({ ellipseAnchorConversion: "yes" as unknown as boolean }),
    ).toThrow(RangeError);
    expect(
      () => new BroadcastLineCalibrator({ ellipseAnchorConversion: 1 as unknown as boolean }),
    ).toThrow(RangeError);
    const conicPx = groundTruthConicPx();
    // The frame export's input contract (finite positive dims, finite
    // coefficients).
    expect(() => buildBroadcastEllipseAnchorFrame(conicPx, 0, HEIGHT)).toThrow(RangeError);
    expect(() => buildBroadcastEllipseAnchorFrame(conicPx, WIDTH, Number.NaN)).toThrow(RangeError);
    expect(() =>
      buildBroadcastEllipseAnchorFrame(
        { a: Number.NaN, b: 0, c: 1, d: 0, e: 0, f: -1 },
        WIDTH,
        HEIGHT,
      ),
    ).toThrow(RangeError);
    // The single-shot conversion export's input contract.
    expect(() => convertBroadcastEllipseAnchor(conicPx, WIDTH, -5, H_GT)).toThrow(RangeError);
    expect(() =>
      convertBroadcastEllipseAnchor(conicPx, WIDTH, HEIGHT, [1, 2, 3] as unknown as Homography),
    ).toThrow(RangeError);
    expect(() =>
      convertBroadcastEllipseAnchor(
        conicPx,
        WIDTH,
        HEIGHT,
        H_GT.map((value, k) => (k === 3 ? Number.NaN : value)) as unknown as Homography,
      ),
    ).toThrow(RangeError);
  });

  test("the conversion-path refusal records are deterministic (two runs deep-equal, both fixtures)", () => {
    for (const variant of [{}, { offsetCircle: true }] as const) {
      const frames = arcWindowFrames(variant);
      const run = (): { classId: string; details: Record<string, unknown> } =>
        refusalClassOf(() =>
          new BroadcastLineCalibrator({ ellipseAnchorConversion: true }).calibrate({ frames }),
        );
      const first = run();
      const second = run();
      expect(second).toEqual(first);
    }
  }, 120_000);

  test("the v0.5.0 failure class is additive on the exported taxonomy", () => {
    const ids = BROADCAST_LINE_FIELD_CALIBRATOR_FAILURE_CLASSES.map(
      (record) => record.failureClassId,
    );
    // The v0.5.0 typed class (the unconvertible closure), additive — every
    // prior class present exactly once and no duplicates anywhere.
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === "broadcast-line.ellipse-anchor-unconvertible").length).toBe(1);
    expect(ids).toContain("broadcast-line.no-pitch-visible");
    expect(ids).toContain("broadcast-line.camera-motion");
    expect(ids).toContain("broadcast-line.insufficient-line-evidence");
    expect(ids).toContain("broadcast-line.no-consistent-homography");
    expect(ids).toContain("broadcast-line.ellipse-evidence-insufficient");
    expect(ids).toContain("broadcast-line.ellipse-no-consistent-homography");
    expect(ids).toContain("broadcast-line.ellipse-conic-off-pitch");
    expect(ids).toContain("broadcast-line.ellipse-degenerate-grid");
    const record = BROADCAST_LINE_FIELD_CALIBRATOR_FAILURE_CLASSES.find(
      (entry) => entry.failureClassId === "broadcast-line.ellipse-anchor-unconvertible",
    );
    expect(record).toBeDefined();
    expect(record!.retryable).toBe(false);
    expect(record!.description.length).toBeGreaterThan(40);
  });
});

// ---------------------------------------------------------------------------
// v0.6.0 — the penalty-arc-conic prior (E2d; OPT-IN `penaltyArcPrior`,
// default false) + flight 4's WORLD-CIRCLE / HORIZON class closure (the
// typed `broadcast-line.ellipse-prior-world-circle` gate, prior-only).
// ---------------------------------------------------------------------------

describe("BroadcastLineCalibrator v0.6.0 — the penalty-arc-conic prior", () => {
  test("the penaltyArcPrior option validates fail-loud; the default is OFF (the default chain carries no prior entries)", () => {
    // (a) Non-boolean refusals, fail-loud, on both surfaces.
    expect(
      () => new BroadcastLineCalibrator({ penaltyArcPrior: "yes" as unknown as boolean }),
    ).toThrow(RangeError);
    expect(() => new BroadcastLineCalibrator({ penaltyArcPrior: 1 as unknown as boolean })).toThrow(
      RangeError,
    );
    expect(() =>
      fitBroadcastEllipseEvidence(
        { frames: arcWindowFrames() },
        { penaltyArcPrior: "yes" as unknown as boolean },
      ),
    ).toThrow(RangeError);
    // (b) The default is OFF, proven BEHAVIORALLY on the discriminating
    //     fixture: the occluded-circle window's default chain carries ONLY
    //     evidence-derived entries (no `prior` field anywhere); with the
    //     prior ON the same window's chain gains 8 prior-seeded entries —
    //     if the default were on, the default chain would carry them too.
    const frames = arcWindowFrames({ skipCenterCircle: true });
    const defaultRefusal = refusalClassOf(() =>
      new BroadcastLineCalibrator({ ellipseMultiConicSelection: true }).calibrate({ frames }),
    );
    const defaultChain = defaultRefusal.details.conicChain as ReadonlyArray<
      Record<string, unknown>
    >;
    expect(defaultChain.length).toBe(3);
    expect(defaultChain.every((entry) => entry.prior === undefined)).toBe(true);
    const priorRefusal = refusalClassOf(() =>
      new BroadcastLineCalibrator({
        ellipseMultiConicSelection: true,
        penaltyArcPrior: true,
      }).calibrate({ frames }),
    );
    const priorChain = priorRefusal.details.conicChain as ReadonlyArray<Record<string, unknown>>;
    expect(priorChain.length).toBe(11);
    expect(priorChain.filter((entry) => entry.prior === "penalty-arc").length).toBe(8);
    // The two extra entries beyond the prior's 8: the same 3 evidence-derived
    // candidates the default ran (the prior appends AFTER every evidence
    // candidate — the fixed-geometry family is the LAST supply).
    expect(priorChain.slice(0, 3).every((entry) => entry.prior === undefined)).toBe(true);
  }, 120_000);

  test("identity: penaltyArcPrior off (explicit) is byte-identical to the default surface on every fixture class; the option never fires outside the ellipse path", () => {
    // (a) The calibrated class (plain fixture): default ≡ explicit false,
    //     full-result JSON byte-identical.
    const plain = arcWindowFrames();
    const defaultResult = new BroadcastLineCalibrator().calibrate({ frames: plain });
    const priorOffResult = new BroadcastLineCalibrator({ penaltyArcPrior: false }).calibrate({
      frames: plain,
    });
    expect(JSON.stringify(priorOffResult)).toBe(JSON.stringify(defaultResult));
    // (b) The refusing classes: occluded-circle (quota-passer exists) and
    //     netStructure (structure conic) — refusal details byte-identical.
    for (const variant of [{ skipCenterCircle: true }, { netStructure: true }] as const) {
      const frames = arcWindowFrames(variant);
      const run = (opts?: { penaltyArcPrior?: boolean }): string => {
        try {
          const result = new BroadcastLineCalibrator({
            ellipseMultiConicSelection: true,
            ...opts,
          }).calibrate({ frames });
          return JSON.stringify({ kind: "calibrated", result });
        } catch (error) {
          if (!(error instanceof CandidateFailureError)) throw error;
          return JSON.stringify({
            kind: "refused",
            classId: error.details.failureClassId,
            details: error.details,
          });
        }
      };
      expect(run({ penaltyArcPrior: false })).toBe(run(undefined));
    }
    // (c) The diagnostics surface: explicit false ≡ option absent.
    const occluded = arcWindowFrames({ skipCenterCircle: true });
    expect(
      JSON.stringify(
        fitBroadcastEllipseEvidence(
          { frames: occluded },
          { ellipseMultiConicSelection: true, penaltyArcPrior: false },
        ),
      ),
    ).toBe(
      JSON.stringify(
        fitBroadcastEllipseEvidence({ frames: occluded }, { ellipseMultiConicSelection: true }),
      ),
    );
    // (d) The option never fires outside the ellipse-constrained path: the
    //     line-only path with the prior ON is the v0.1.0 surface exactly.
    const lineOnly = refusalClassOf(() =>
      new BroadcastLineCalibrator({ ellipseConstrained: false, penaltyArcPrior: true }).calibrate({
        frames: occluded,
      }),
    );
    expect(lineOnly.classId).toBe("broadcast-line.no-consistent-homography");
    expect(lineOnly.details.priorSeededCandidates).toBeUndefined();
  }, 180_000);

  test("a healthy window never reaches the prior: the prior-on result is byte-identical to the default (the evidence candidate calibrates first)", () => {
    const frames = arcWindowFrames();
    const defaultResult = new BroadcastLineCalibrator().calibrate({ frames });
    const priorOnResult = new BroadcastLineCalibrator({
      ellipseMultiConicSelection: true,
      penaltyArcPrior: true,
    }).calibrate({ frames });
    expect(JSON.stringify(priorOnResult)).toBe(JSON.stringify(defaultResult));
    expect(priorOnResult.confidence).toBeCloseTo(0.921, 3);
    // The diagnostics prove the prior WOULD have seeded on this window (the
    // candidates exist under the family quota) — the chain simply never
    // reached them: a window any evidence candidate calibrates never runs
    // the fixed-geometry family (the LAST-supply discipline).
    const diagnostics = fitBroadcastEllipseEvidence(
      { frames },
      { ellipseMultiConicSelection: true, penaltyArcPrior: true },
    );
    const prior = (diagnostics.conicCandidates ?? []).filter((c) => c.prior !== undefined);
    expect(prior.length).toBeGreaterThan(0);
    expect(prior.every((c) => c.prior === "penalty-arc")).toBe(true);
    expect(prior.every((c) => c.priorEnd === "left" || c.priorEnd === "right")).toBe(true);
  }, 120_000);

  test('quota/provenance: a below-family-quota fixture refuses with the typed unevidenced class; the full-paint "D" passes the family quota the same evidence\'s center-circle quota refuses', () => {
    // The fixture (touchlines + arcs only — see skipBoxMarkings): the arc
    // evidence reduces to the painted penalty arcs themselves. A 40°
    // fragment's sources cannot carry a conic past the family quota (the
    // painted "D" demands 10 of the 36 bins — a floor DERIVED from the
    // fixed geometry, not chosen), and the center-circle quota (12 bins)
    // never passed either — the prior seeded NOTHING.
    const fragment = arcWindowFrames({
      skipCenterCircle: true,
      skipBoxMarkings: true,
      penaltyArcSpanDeg: 40,
    });
    const refusal = refusalClassOf(() =>
      new BroadcastLineCalibrator({
        ellipseMultiConicSelection: true,
        penaltyArcPrior: true,
      }).calibrate({ frames: fragment }),
    );
    expect(refusal.classId).toBe("broadcast-line.ellipse-penalty-arc-prior-unevidenced");
    expect(refusal.details.priorSeededCandidates).toBe(0);
    expect(refusal.details.arcPixels).toBe(851);
    // The refusal carries the line path's own failure (the ellipse path ran
    // after it) — never a calibration fabricated from the fixed geometry.
    expect(refusal.details.linePathFailureClass).toBe("broadcast-line.no-consistent-homography");
    // The pre-prior surface on the SAME fixture: the v0.2.0 quota class
    // (the option-off identity on this fixture class).
    const priorOff = refusalClassOf(() =>
      new BroadcastLineCalibrator({ ellipseMultiConicSelection: true }).calibrate({
        frames: fragment,
      }),
    );
    expect(priorOff.classId).toBe("broadcast-line.ellipse-evidence-insufficient");
    // (b) The full-paint control — the SAME fixture with the arcs painted
    //     at their full "D" span: the family quota PASSES on the painted
    //     marking's own geometry (the seeded candidate measures support
    //     186 px / coverage 32 bins against the 90-px + 10-bin family
    //     bar) where the 40° fragment seeded NOTHING — the family quota
    //     boundary is the painted span itself (the measured candidate
    //     pool: the wild global-fit conic (support 601, coverage 5)
    //     fails EVERY quota; the painted-arc sliver is both the window's
    //     evidence quota-passer and the prior's seeded conic — the same
    //     image-side fit machinery, the family threading is the only
    //     difference).
    const fullPaint = arcWindowFrames({ skipCenterCircle: true, skipBoxMarkings: true });
    const diagnostics = fitBroadcastEllipseEvidence(
      { frames: fullPaint },
      { ellipseMultiConicSelection: true, penaltyArcPrior: true },
    );
    const candidates = diagnostics.conicCandidates ?? [];
    const prior = candidates.filter((c) => c.prior !== undefined);
    expect(candidates.length).toBe(4);
    expect(prior.length).toBe(2);
    expect(prior[0]!.quotaPassed).toBe(true);
    expect(prior[0]!.supportPx).toBe(186);
    expect(prior[0]!.coverageBins).toBe(32);
    // The evidence-derived primary (the wild global fit over the whole arc
    // pool) fails its quota — `fitted` records the PRIMARY's outcome.
    expect(diagnostics.fitted).toBe(false);
    expect(candidates[0]!.quotaPassed).toBe(false);
    expect(candidates[0]!.coverageBins).toBe(5);
  }, 120_000);

  test("the prior gates (1): the grass gate refuses prior-seeded structure candidates with provenance (the b3-a class cannot re-enter through the prior)", () => {
    const frames = arcWindowFrames({ netStructure: true });
    const refusal = refusalClassOf(() =>
      new BroadcastLineCalibrator({
        ellipseMultiConicSelection: true,
        penaltyArcPrior: true,
      }).calibrate({ frames }),
    );
    // The window refuses (first candidate = the structure conic, refused
    // pre-solve by the v0.4.1 grass gate — the existing hardening surface).
    expect(refusal.classId).toBe("broadcast-line.ellipse-conic-off-pitch");
    const chain = refusal.details.conicChain as ReadonlyArray<Record<string, unknown>>;
    // The prior seeded 8 candidates on this window (4 conics x 2 ends) and
    // EVERY prior-seeded candidate refused — two of them at the grass gate
    // itself, carrying the prior provenance + the measured green median:
    // the structure class cannot re-enter through the fixed-geometry prior.
    expect(refusal.details.priorSeededCandidates).toBe(8);
    const priorEntries = chain.filter((entry) => entry.prior === "penalty-arc");
    expect(priorEntries.length).toBe(8);
    const grassEntries = priorEntries.filter(
      (entry) => entry.failureClassId === "broadcast-line.ellipse-conic-off-pitch",
    );
    expect(grassEntries.length).toBe(2);
    for (const entry of grassEntries) {
      expect(entry.greenInteriorMedian as number).toBeCloseTo(0.0231, 3);
      expect(entry.greenInteriorMedian as number).toBeLessThan(0.2);
      expect(entry.samplesInBounds).toBe(1257);
      expect(entry.priorEnd === "left" || entry.priorEnd === "right").toBe(true);
    }
    // Nothing calibrated — the fixture's honest outcome.
    expect(chain.length).toBe(11);
  }, 120_000);

  test("the prior gates (2): the geometric containment gate refuses a machine-passing prior solve (the penalty-spot-outside class) — chain-level and window-level", () => {
    // (a) Chain-level on the netStructure fixture: the prior candidate at
    //     chain[5] PASSED every machine gate (lineFit 0.613 >= 0.6,
    //     backward 2.13 <= 10 px, ellipse residual 0.245 <= 4 px) and the
    //     grass gate (a different conic's candidate), then the projected
    //     pitch quad refused to contain the prior conic's center — the
    //     typed class with the prior provenance riding.
    const frames = arcWindowFrames({ netStructure: true });
    const refusal = refusalClassOf(() =>
      new BroadcastLineCalibrator({
        ellipseMultiConicSelection: true,
        penaltyArcPrior: true,
      }).calibrate({ frames }),
    );
    const chain = refusal.details.conicChain as ReadonlyArray<Record<string, unknown>>;
    const quadEntries = chain.filter(
      (entry) => entry.failureClassId === "broadcast-line.ellipse-prior-quad-containment",
    );
    expect(quadEntries.length).toBe(1);
    const quad = quadEntries[0]!;
    expect(quad.prior).toBe("penalty-arc");
    expect(quad.priorEnd).toBe("left");
    // The machine-passing numbers of the refused solve (the gate fired
    // AFTER validation, never instead of it).
    expect(quad.lineFit as number).toBeCloseTo(0.6135, 3);
    expect(quad.lineFit as number).toBeGreaterThanOrEqual(0.6);
    expect(quad.backwardPx as number).toBeCloseTo(2.134, 2);
    expect(quad.backwardPx as number).toBeLessThanOrEqual(10);
    expect(quad.ellipseMeanPx as number).toBeCloseTo(0.245, 2);
    expect(quad.ellipseMeanPx as number).toBeLessThanOrEqual(4);
    // (b) Window-level on the touchlines + 70°-fragment fixture: the prior
    //     is the ONLY candidate supply, and its FIRST candidate's solve
    //     passes every machine gate (lineFit 0.837, backward 7.30,
    //     ellipse residual 1.14) while projecting the pitch as a
    //     NON-CONVEX quad with the prior conic's center 12.4 px OUTSIDE it
    //     — the window itself refuses with the typed class (the purest
    //     penalty-spot-outside pin: a machine-passing solve, a containment
    //     violation, a typed refusal — never a laundered calibration).
    const fragment = arcWindowFrames({
      skipCenterCircle: true,
      skipBoxMarkings: true,
      penaltyArcSpanDeg: 70,
    });
    const window = refusalClassOf(() =>
      new BroadcastLineCalibrator({
        ellipseMultiConicSelection: true,
        penaltyArcPrior: true,
      }).calibrate({ frames: fragment }),
    );
    expect(window.classId).toBe("broadcast-line.ellipse-prior-quad-containment");
    expect(window.details.prior).toBe("penalty-arc");
    expect(window.details.priorEnd).toBe("left");
    expect(window.details.lineFit as number).toBeCloseTo(0.8371, 3);
    expect(window.details.lineFit as number).toBeGreaterThanOrEqual(0.6);
    expect(window.details.backwardPx as number).toBeCloseTo(7.302, 2);
    expect(window.details.ellipseMeanPx as number).toBeCloseTo(1.144, 2);
    expect(window.details.quadConvex).toBe(false);
    expect(window.details.minSignedEdgeDistancePx as number).toBeCloseTo(-12.395, 2);
    expect(window.details.minSignedEdgeDistancePx as number).toBeLessThan(0);
    expect(window.details.priorSeededCandidates).toBe(2);
  }, 180_000);

  test("determinism: two prior-path runs serialize byte-identically on every fixture class", () => {
    for (const variant of [
      { skipCenterCircle: true },
      { netStructure: true },
      { skipCenterCircle: true, skipBoxMarkings: true, penaltyArcSpanDeg: 70 },
    ] as const) {
      const frames = arcWindowFrames(variant);
      const run = (): string => {
        try {
          const result = new BroadcastLineCalibrator({
            ellipseMultiConicSelection: true,
            penaltyArcPrior: true,
          }).calibrate({ frames });
          return JSON.stringify({ kind: "calibrated", result });
        } catch (error) {
          if (!(error instanceof CandidateFailureError)) throw error;
          return JSON.stringify({
            kind: "refused",
            classId: error.details.failureClassId,
            details: error.details,
          });
        }
      };
      expect(run()).toBe(run());
    }
  }, 240_000);

  // -------------------------------------------------------------------------
  // LEG B (flight 4) — THE CLASS CLOSURE: the recorded 116.5 m false-
  // positive. Flight 3 measured (c284d7c, the pre-gate tree): the
  // occluded-circle fixture CALIBRATED on the prior path at machine-passing
  // gates — lineFit 0.666 / backward 9.65 px / ellipse residual 0.755 px /
  // conf 0.636 — with worst probe error 116.5 m over PROBE_PITCH_POINTS
  // (per-probe 21.9/48.1/19.4/116.5/19.6/56.2 m): a convex, containment-
  // passing, GLOBALLY-WRONG solve class the then-current gates did NOT
  // close. The world-circle/horizon gate at this tree closes it.
  // -------------------------------------------------------------------------

  /** The frozen PRE-GATE solve (flight 3, c284d7c — full recorded precision). */
  const FROZEN_PREGATE_H: Homography = [
    110.93377906728517, -462.9521542152892, 68.11093698895705, -1.2643936944088772,
    52.77814074111005, -38.94485343364842, 0.16089441679279665, -5.876753546734526, 1,
  ];

  /**
   * The two penalty-arc families, re-derived from the canonical model the
   * way the module derives its own (module-private) constants: spot 11/94,
   * midline 34, r 9.15, painted clip at x >= 16.5 / x <= 88.5 — the painted
   * half angle acos(5.5/9.15), the apex scan anchors at angle 0 / π.
   */
  const PAINTED_HALF = Math.acos((16.5 - 11) / 9.15);
  const LEFT_PENALTY_FAMILY = {
    cx: 11,
    cy: 34,
    r: 9.15,
    angle0: -PAINTED_HALF,
    span: 2 * PAINTED_HALF,
    scanAngle: 0,
  };
  const RIGHT_PENALTY_FAMILY = {
    cx: 94,
    cy: 34,
    r: 9.15,
    angle0: Math.PI - PAINTED_HALF,
    span: 2 * PAINTED_HALF,
    scanAngle: Math.PI,
  };

  /**
   * Rebuild an EllipseConic from (center, semis, rotation) — exact algebra,
   * the same five numbers the diagnostics record for every fitted conic.
   */
  function conicFromEllipseGeometry(
    cx: number,
    cy: number,
    semiMajor: number,
    semiMinor: number,
    rotationDeg: number,
  ): EllipseConic {
    const theta = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const a2inv = 1 / (semiMajor * semiMajor);
    const b2inv = 1 / (semiMinor * semiMinor);
    const m00 = cos * cos * a2inv + sin * sin * b2inv;
    const m01 = cos * sin * (a2inv - b2inv);
    const m11 = sin * sin * a2inv + cos * cos * b2inv;
    return {
      a: m00,
      b: 2 * m01,
      c: m11,
      d: -2 * (m00 * cx + m01 * cy),
      e: -2 * (m01 * cx + m11 * cy),
      f: m00 * cx * cx + 2 * m01 * cx * cy + m11 * cy * cy - 1,
    };
  }

  test("LEG B — the 116.5 m class is CLOSED: the occluded-circle fixture refuses with the typed world-circle class, the prior candidate's measured world-side worst error pinned", () => {
    const frames = arcWindowFrames({ skipCenterCircle: true });
    const refusal = refusalClassOf(() =>
      new BroadcastLineCalibrator({
        ellipseMultiConicSelection: true,
        penaltyArcPrior: true,
      }).calibrate({ frames }),
    );
    // The window REFUSES (flight 3 calibrated it at conf 0.636; the claim
    // is now withheld) — the first candidate's honest validation class
    // rides the window with the additive chain record.
    expect(refusal.classId).toBe("broadcast-line.ellipse-no-consistent-homography");
    expect(refusal.details.priorSeededCandidates).toBe(8);
    // The closure: exactly ONE chain entry refused by the world-circle
    // gate — the prior candidate whose solve passed EVERY machine gate at
    // the flight-3 numbers (lineFit 0.6657 / backward 9.6508 / residual
    // 0.7547 — the very solve that calibrated at conf 0.636 pre-gate).
    const chain = refusal.details.conicChain as ReadonlyArray<Record<string, unknown>>;
    const worldEntries = chain.filter(
      (entry) => entry.failureClassId === "broadcast-line.ellipse-prior-world-circle",
    );
    expect(worldEntries.length).toBe(1);
    const world = worldEntries[0]!;
    expect(world.prior).toBe("penalty-arc");
    expect(world.priorEnd).toBe("right");
    // The measured world-side numbers (re-measured at this tree; the bar
    // is the calibration's OWN model-distance radius, 1.0 m).
    expect(world.priorWorldWorstProbeErrorM as number).toBeCloseTo(8.2279, 3);
    expect(world.priorWorldWorstProbeErrorM as number).toBeGreaterThan(
      world.priorWorldProbeBarM as number,
    );
    expect(world.priorWorldProbeBarM).toBe(1);
    expect(world.priorWorldProbeSamples).toBe(180);
    expect(world.priorWorldMeanProbeErrorM as number).toBeCloseTo(1.9792, 3);
    // The horizon leg PASSED on this solve (both legs ride the record:
    // the world-probe leg is the refusing one — the full-circle world
    // side, exactly the direction the painted-arc image residual leaves
    // open).
    expect(world.priorWorldHorizonSideConsistent).toBe(true);
    // The refused solve's machine-passing numbers — the gate fired AFTER
    // every machine gate, on a solve that pre-gate CALIBRATED.
    expect(world.lineFit as number).toBeCloseTo(0.6657, 3);
    expect(world.lineFit as number).toBeGreaterThanOrEqual(0.6);
    expect(world.backwardPx as number).toBeCloseTo(9.6508, 2);
    expect(world.backwardPx as number).toBeLessThanOrEqual(10);
    expect(world.ellipseMeanPx as number).toBeCloseTo(0.7547, 3);
    expect(world.ellipseMeanPx as number).toBeLessThanOrEqual(4);
    // No prior candidate calibrated: every one of the 8 refused.
    expect(chain.filter((entry) => entry.prior === "penalty-arc").length).toBe(8);
    // The default surface on the same fixture is UNCHANGED (the existing
    // v0.3.0 test pins it; asserted here for the closure's prior-only
    // additivity).
    const defaultRefusal = refusalClassOf(() =>
      new BroadcastLineCalibrator().calibrate({ frames }),
    );
    expect(defaultRefusal.classId).toBe("broadcast-line.ellipse-no-consistent-homography");
    expect(defaultRefusal.details.priorSeededCandidates).toBeUndefined();
  }, 120_000);

  test("LEG B — the frozen pre-gate record: the pure world-circle export refuses the flight-3 116.5 m solve (regression lock); the one-directional gates that passed it", () => {
    // The frozen solve's prior candidate: the RIGHT family paired with the
    // arc-crumb sliver conic (center (17.53, 107.53) px, semis 24.93 x
    // 6.96, rotation 167.903° — the recorded geometry of the conic that
    // seeded the conf-0.636 calibration at c284d7c).
    const sliverConic = conicFromEllipseGeometry(
      17.53080650518137,
      107.52756428620168,
      24.930194598078188,
      6.960671735616222,
      167.9031199954711,
    );
    // Leg 1 — the world-side probe: the back-projected FULL 360° conic
    // lands 8.23 m off the family's fixed world circle (worst of 180
    // samples; the bar is 1.0 m) — the gate refuses the frozen solve.
    const rightFamily = RIGHT_PENALTY_FAMILY;
    const world = evaluateBroadcastPriorWorldCircle(
      FROZEN_PREGATE_H,
      sliverConic,
      WIDTH,
      HEIGHT,
      rightFamily,
    );
    expect(world.ok).toBe(false);
    expect(world.probeSamples).toBe(180);
    expect(world.worstProbeErrorM).toBeCloseTo(8.2279, 3);
    expect(world.worstProbeErrorM).toBeGreaterThan(1.0);
    expect(world.meanProbeErrorM).toBeCloseTo(1.9792, 3);
    // The horizon leg alone does NOT catch this solve (one strict side —
    // the recorded reason the gate needs BOTH legs).
    expect(world.horizonSideConsistent).toBe(true);
    // The LEFT family pairing of the same frozen solve refuses harder
    // (73.4 m worst — the mirrored end).
    const leftWorld = evaluateBroadcastPriorWorldCircle(
      FROZEN_PREGATE_H,
      sliverConic,
      WIDTH,
      HEIGHT,
      LEFT_PENALTY_FAMILY,
    );
    expect(leftWorld.ok).toBe(false);
    expect(leftWorld.worstProbeErrorM).toBeCloseTo(73.364, 2);
    // Leg 2 — the one-directional gates the frozen solve PASSED (the
    // measured gap the world-circle leg closes): the geometric
    // containment invariant holds on this solve (a convex quad containing
    // the conic center) — quad-containment alone could not close the
    // class; the world-circle leg does.
    const quad = evaluateBroadcastPriorQuadContainment(
      FROZEN_PREGATE_H,
      sliverConic,
      WIDTH,
      HEIGHT,
    );
    expect(quad.ok).toBe(true);
    expect(quad.convex).toBe(true);
    // The export's fail-loud input contract (RangeError).
    expect(() =>
      evaluateBroadcastPriorWorldCircle(
        [1, 2, 3] as unknown as Homography,
        sliverConic,
        WIDTH,
        HEIGHT,
        rightFamily,
      ),
    ).toThrow(RangeError);
    expect(() =>
      evaluateBroadcastPriorWorldCircle(
        FROZEN_PREGATE_H,
        { a: Number.NaN, b: 0, c: 1, d: 0, e: 0, f: -1 },
        WIDTH,
        HEIGHT,
        rightFamily,
      ),
    ).toThrow(RangeError);
    expect(() =>
      evaluateBroadcastPriorWorldCircle(FROZEN_PREGATE_H, sliverConic, 0, HEIGHT, rightFamily),
    ).toThrow(RangeError);
    expect(() =>
      evaluateBroadcastPriorWorldCircle(FROZEN_PREGATE_H, sliverConic, WIDTH, HEIGHT, {
        ...LEFT_PENALTY_FAMILY,
        cx: Number.NaN,
      }),
    ).toThrow(RangeError);
    expect(() =>
      evaluateBroadcastPriorQuadContainment(
        [1, 2, 3] as unknown as Homography,
        sliverConic,
        WIDTH,
        HEIGHT,
      ),
    ).toThrow(RangeError);
    expect(() =>
      evaluateBroadcastPriorQuadContainment(
        FROZEN_PREGATE_H,
        { a: Number.NaN, b: 0, c: 1, d: 0, e: 0, f: -1 },
        WIDTH,
        HEIGHT,
      ),
    ).toThrow(RangeError);
  });

  test("the v0.6.0 failure classes are additive on the exported taxonomy", () => {
    const ids = BROADCAST_LINE_FIELD_CALIBRATOR_FAILURE_CLASSES.map(
      (record) => record.failureClassId,
    );
    // The three v0.6.0 typed classes (the prior's unevidenced supply
    // refusal, the geometric containment gate, the world-circle/horizon
    // class closure), additive — every prior class present exactly once
    // and no duplicates anywhere.
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      ids.filter((id) => id === "broadcast-line.ellipse-penalty-arc-prior-unevidenced").length,
    ).toBe(1);
    expect(ids.filter((id) => id === "broadcast-line.ellipse-prior-quad-containment").length).toBe(
      1,
    );
    expect(ids.filter((id) => id === "broadcast-line.ellipse-prior-world-circle").length).toBe(1);
    expect(ids).toContain("broadcast-line.no-pitch-visible");
    expect(ids).toContain("broadcast-line.camera-motion");
    expect(ids).toContain("broadcast-line.insufficient-line-evidence");
    expect(ids).toContain("broadcast-line.no-consistent-homography");
    expect(ids).toContain("broadcast-line.ellipse-evidence-insufficient");
    expect(ids).toContain("broadcast-line.ellipse-no-consistent-homography");
    expect(ids).toContain("broadcast-line.ellipse-conic-off-pitch");
    expect(ids).toContain("broadcast-line.ellipse-degenerate-grid");
    expect(ids).toContain("broadcast-line.ellipse-anchor-unconvertible");
    const newRecords = BROADCAST_LINE_FIELD_CALIBRATOR_FAILURE_CLASSES.filter(
      (record) =>
        record.failureClassId === "broadcast-line.ellipse-penalty-arc-prior-unevidenced" ||
        record.failureClassId === "broadcast-line.ellipse-prior-quad-containment" ||
        record.failureClassId === "broadcast-line.ellipse-prior-world-circle",
    );
    for (const record of newRecords) {
      expect(record.retryable).toBe(false);
      expect(record.description.length).toBeGreaterThan(40);
    }
  });
});
