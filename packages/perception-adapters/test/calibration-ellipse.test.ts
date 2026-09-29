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
import {
  BROADCAST_LINE_FIELD_CALIBRATOR_FAILURE_CLASSES,
  BroadcastLineCalibrator,
  evaluateBroadcastEllipseGridGeometry,
  evaluateBroadcastLineFit,
  fitBroadcastEllipseEvidence,
} from "../src/calibration/broadcast-line";
import {
  CENTER_CIRCLE,
  FRAME_COUNT,
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
  test(
    "the arc window: v0.1.0 line-only refuses, the ellipse-constrained path calibrates within 2.5 m",
    () => {
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
    },
    120_000,
  );

  test(
    "the ellipse-path arc evidence diagnostics record the fitted conic",
    () => {
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
    },
    60_000,
  );

  test(
    "an occluded circle refuses honestly (v0.3.0: at the hypothesis/validation stage — the flank-recovery explain admits the fixture's penalty arcs as quota-passing evidence)",
    () => {
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
    },
    60_000,
  );

  test(
    "arc evidence below quota (a 40° painted arc) refuses honestly (v0.3.0: at the hypothesis/validation stage)",
    () => {
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
    },
    60_000,
  );

  test(
    "v0.4.0 conic selection: a dominant non-circle curve — the v0.3.0 surface anchors to the curve and refuses; the chain's circle candidate passes the ellipse gates",
    () => {
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
          Math.hypot(
            candidate.centerPx.x - 337.3,
            candidate.centerPx.y - 140.5,
          ) < 12 &&
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
    },
    120_000,
  );

  test(
    "the ellipseMultiConicSelection option validates fail-loud (RangeError)",
    () => {
      expect(
        () => new BroadcastLineCalibrator({ ellipseMultiConicSelection: 1 as unknown as boolean }),
      ).toThrow(RangeError);
      expect(
        () =>
          fitBroadcastEllipseEvidence({ frames: arcWindowFrames() }, {
            ellipseMultiConicSelection: "yes" as unknown as boolean,
          }),
      ).toThrow(RangeError);
    },
    60_000,
  );

  test(
    "a degenerate grazing view refuses honestly at the earliest stage (no pitch visible)",
    () => {
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
    },
    60_000,
  );

  test(
    "non-degradation: a window the line path calibrates returns byte-identical results",
    () => {
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
      const hQuad = solveHomography(
        [...GT_IMAGE_CORNERS],
        [...CANONICAL_PITCH_CORNERS],
      ); // image -> pitch
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
    },
    120_000,
  );

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
    expect(() =>
      fitBroadcastEllipseEvidence({ frames }, { minPitchFraction: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      evaluateBroadcastLineFit({ frames }, [1, 2, 3] as unknown as Homography),
    ).toThrow(RangeError);
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
  test(
    "a healthy chain calibration is byte-identical with the hardening on (the chain-on plain window equals the chain-off result)",
    () => {
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
    },
    120_000,
  );

  test(
    "the b3-a class (a static non-green structure on the grass): the chain refuses the structure's conic pre-solve with the typed grass class; the default surface is unchanged",
    () => {
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
    },
    120_000,
  );

  test(
    "the projected-grid geometry gate: the FROZEN b3-a chain homography is the degenerate class; a healthy solve's quad contains its conic",
    () => {
      // The frozen record (scripts/evidence/r606-ellipse-constrained/
      // measurement.json, window b3-a, path v040Chain — the WITHHELD
      // claim): the solved homography, at full recorded precision, and
      // the winning conic's geometry (conicCandidates[1]). The measured
      // defect: the WHOLE pitch (corners, interior, circle rim) projects
      // to image (575, 98) — a point-collapse on the goal-structure
      // conic that satisfied every v0.4.0 machine gate.
      const H_B3A: Homography = [
        -88.36795791427605, 68.61881390163505, 60.73539142302648,
        -60.681864133921415, 60.247400824810356, 38.14191934597057,
        -1.5103647140254437, 1.3130296284410223, 1,
      ];
      const CONIC_B3A = conicOfGeometry(
        574.2750799089282, 78.96140444447796,
        20.321122464326212, 16.722515225559825,
        (102.27707209379237 * Math.PI) / 180,
      );
      const degenerate = evaluateBroadcastEllipseGridGeometry(H_B3A, CONIC_B3A, 640, 360);
      expect(degenerate.ok).toBe(false);
      // The conic's area recovers the frozen geometry (~1068 px²)…
      expect(Math.abs(degenerate.conicAreaPx - Math.PI * 20.321122464326212 * 16.722515225559825))
        .toBeLessThan(1);
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
      const healthy = evaluateBroadcastEllipseGridGeometry(
        result.homography, conic, 640, 360,
      );
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
      expect(() =>
        evaluateBroadcastEllipseGridGeometry(H_B3A, CONIC_B3A, 0, 360),
      ).toThrow(RangeError);
    },
    120_000,
  );

  test("the hardening's failure classes are additive on the exported taxonomy", () => {
    const ids = BROADCAST_LINE_FIELD_CALIBRATOR_FAILURE_CLASSES.map((record) => record.failureClassId);
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
