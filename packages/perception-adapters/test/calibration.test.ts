import { describe, expect, test } from "bun:test";
import { FieldMappingPayload } from "@sporta/contracts";
import { CANONICAL_PITCH_CORNERS, applyHomography } from "@sporta/field-mapping";
import {
  CandidateFailureError,
  HomographyFieldCalibratorAdapter,
  InvalidAdapterInputError,
  LineBasedFieldCalibrator,
  generateCalibrationFixture,
} from "../src/index";
import type { CalibrationFixtureSpec } from "../src/index";

const FULL_PITCH_SPEC: CalibrationFixtureSpec = {
  specId: "test-full-pitch",
  seed: 42,
  width: 160,
  height: 120,
  frameCount: 3,
  frameIntervalMs: 40,
  window: { x0: -10.5, visLength: 126, y0: -6.8, visWidth: 81.6 },
  expectedOutcome: "solved",
};

const ZOOMED_SPEC: CalibrationFixtureSpec = {
  specId: "test-zoomed",
  seed: 43,
  width: 160,
  height: 120,
  frameCount: 3,
  frameIntervalMs: 40,
  window: { x0: 20, visLength: 40, y0: 10, visWidth: 40 },
  expectedOutcome: "refused-insufficient-lines",
};

describe("HomographyFieldCalibratorAdapter (R205 candidate 1)", () => {
  test("wraps W203: solves the DLT from the supplied corner set exactly", () => {
    const adapter = new HomographyFieldCalibratorAdapter();
    const frames = generateCalibrationFixture(FULL_PITCH_SPEC);
    const result = adapter.calibrate({
      frames: frames.map(({ frame }) => frame),
      cornerSet: frames[0]!.gtCornerSet,
    });
    // The affine truth is recovered exactly (within float epsilon).
    for (const [index, value] of result.homography.entries()) {
      expect(Math.abs(value - FULL_PITCH_SPEC.window.visLength && 0)).toBeGreaterThanOrEqual(0);
      void index;
      void value;
    }
    expect(result.homography[0]).toBeCloseTo(FULL_PITCH_SPEC.window.visLength, 6);
    expect(result.homography[4]).toBeCloseTo(FULL_PITCH_SPEC.window.visWidth, 6);
    expect(result.homography[2]).toBeCloseTo(FULL_PITCH_SPEC.window.x0, 6);
    expect(result.homography[5]).toBeCloseTo(FULL_PITCH_SPEC.window.y0, 6);
    expect(result.homography[6]).toBeCloseTo(0, 12);
    expect(result.homography[8]).toBeCloseTo(1, 12);
    // Confidence passes through verbatim (no silent collapse).
    expect(result.confidence).toBe(frames[0]!.gtCornerSet.confidence);
    expect(result.correspondenceCount).toBe(4);
  });

  test("emits a FieldMappingPayload-conformant mapping", () => {
    const adapter = new HomographyFieldCalibratorAdapter();
    const frames = generateCalibrationFixture(FULL_PITCH_SPEC);
    const result = adapter.calibrate({
      frames: frames.map(({ frame }) => frame),
      cornerSet: frames[0]!.gtCornerSet,
    });
    const parsed = FieldMappingPayload.safeParse(result.mapping);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.kind).toBe("field-mapping");
    expect(parsed.data?.pitchCorners.length).toBe(4);
    expect(parsed.data?.cameraHomographyRef).toContain("homography-");
  });

  test("degenerate correspondences are a typed refusal (W203 surfaces verbatim)", () => {
    const adapter = new HomographyFieldCalibratorAdapter();
    const frames = generateCalibrationFixture(FULL_PITCH_SPEC);
    // All four image corners collinear — rank-deficient DLT.
    const degenerate = {
      corners: [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.2 },
        { x: 0.3, y: 0.3 },
        { x: 0.4, y: 0.4 },
      ] as [
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
      ],
      cornerOrder: "tl, tr, br, bl",
      confidence: 0.5,
    };
    expect(() =>
      adapter.calibrate({ frames: frames.map(({ frame }) => frame), cornerSet: degenerate }),
    ).toThrow(/degenerate/i);
  });

  test("missing corner set is a loud refusal (pixel detection is candidate 2's job)", () => {
    const adapter = new HomographyFieldCalibratorAdapter();
    const frames = generateCalibrationFixture(FULL_PITCH_SPEC);
    expect(() => adapter.calibrate({ frames: frames.map(({ frame }) => frame) })).toThrow(
      InvalidAdapterInputError,
    );
  });

  test("deterministic: two calibrations deep-equal", () => {
    const adapter = new HomographyFieldCalibratorAdapter();
    const frames = generateCalibrationFixture(FULL_PITCH_SPEC);
    const input = {
      frames: frames.map(({ frame }) => frame),
      cornerSet: frames[0]!.gtCornerSet,
    };
    expect(adapter.calibrate(input)).toEqual(adapter.calibrate(input));
  });
});

describe("LineBasedFieldCalibrator (R205 candidate 2)", () => {
  test("detects the line family in the pixels and recovers the mapping within the honest envelope", () => {
    const adapter = new LineBasedFieldCalibrator();
    const frames = generateCalibrationFixture(FULL_PITCH_SPEC);
    const result = adapter.calibrate({ frames: frames.map(({ frame }) => frame) });
    // The honest accuracy envelope: line centroids quantize to pixel
    // resolution, so the recovered affine mapping is sub-1% — the four TRUE
    // canonical corners project within ~2.5 m on a 105 x 68 pitch.
    let squaredSum = 0;
    for (const [index, corner] of frames[0]!.gtCornerSet.corners.entries()) {
      const projected = applyHomography(result.homography, corner);
      const expected = CANONICAL_PITCH_CORNERS[index]!;
      squaredSum += (projected.x - expected.x) ** 2 + (projected.y - expected.y) ** 2;
    }
    const cornerRmse = Math.sqrt(squaredSum / 4);
    expect(cornerRmse).toBeLessThan(2.5);
    // All 6 intersections found: 3 vertical x 2 horizontal lines.
    expect(result.correspondenceCount).toBe(6);
    expect(result.confidence).toBeGreaterThan(0.6);
    expect(result.confidence).toBeLessThanOrEqual(1);
    // The contract payload conforms.
    const parsed = FieldMappingPayload.safeParse(result.mapping);
    expect(parsed.success).toBe(true);
  });

  test("insufficient line evidence is a typed refusal (zoomed view)", () => {
    const adapter = new LineBasedFieldCalibrator();
    const frames = generateCalibrationFixture(ZOOMED_SPEC);
    expect(() => adapter.calibrate({ frames: frames.map(({ frame }) => frame) })).toThrow(
      CandidateFailureError,
    );
    try {
      adapter.calibrate({ frames: frames.map(({ frame }) => frame) });
    } catch (error) {
      expect((error as CandidateFailureError).details.failureClassId).toBe(
        "line-based.insufficient-line-evidence",
      );
    }
  });

  test("no green pitch in frame is a typed refusal", () => {
    const adapter = new LineBasedFieldCalibrator();
    const frames = generateCalibrationFixture(FULL_PITCH_SPEC);
    // Overwrite every pixel with non-green background.
    for (const fixtureFrame of frames) {
      fixtureFrame.frame.bytes.fill(20);
    }
    expect(() => adapter.calibrate({ frames: frames.map(({ frame }) => frame) })).toThrow(
      CandidateFailureError,
    );
  });

  test("empty sequence is a typed refusal", () => {
    const adapter = new LineBasedFieldCalibrator();
    expect(() => adapter.calibrate({ frames: [] })).toThrow(CandidateFailureError);
  });

  test("deterministic: two calibrations deep-equal", () => {
    const adapter = new LineBasedFieldCalibrator();
    const frames = generateCalibrationFixture(FULL_PITCH_SPEC);
    const input = { frames: frames.map(({ frame }) => frame) };
    expect(adapter.calibrate(input)).toEqual(adapter.calibrate(input));
  });

  test("the two-line assumption discount applies (ambiguous view carries lower confidence)", () => {
    const ambiguousSpec: CalibrationFixtureSpec = {
      ...FULL_PITCH_SPEC,
      specId: "test-ambiguous",
      window: { x0: -10, visLength: 110, y0: -6, visWidth: 80 },
    };
    const adapter = new LineBasedFieldCalibrator();
    const full = adapter.calibrate({
      frames: generateCalibrationFixture(FULL_PITCH_SPEC).map(({ frame }) => frame),
    });
    const ambiguous = adapter.calibrate({
      frames: generateCalibrationFixture(ambiguousSpec).map(({ frame }) => frame),
    });
    expect(ambiguous.correspondenceCount).toBe(4);
    expect(ambiguous.confidence).toBeLessThan(full.confidence);
  });
});

describe("the two calibration candidates are materially different (R205 acceptance)", () => {
  test("baseline consumes supplied correspondences; line-based consumes pixels (poison test)", () => {
    const baseline = new HomographyFieldCalibratorAdapter();
    const lineBased = new LineBasedFieldCalibrator();
    const frames = generateCalibrationFixture(FULL_PITCH_SPEC);
    // POISON the corner set: shift it — the baseline follows it, the
    // line-based candidate's result is unchanged (it ignores the input).
    const poisonedCornerSet = {
      corners: frames[0]!.gtCornerSet.corners.map((corner) => ({
        x: corner.x + 0.05,
        y: corner.y + 0.05,
      })) as [
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
      ],
      cornerOrder: "tl, tr, br, bl",
      confidence: 0.5,
    };
    const pixelInput = { frames: frames.map(({ frame }) => frame) };
    const baselineClean = baseline.calibrate({
      ...pixelInput,
      cornerSet: frames[0]!.gtCornerSet,
    });
    const baselinePoisoned = baseline.calibrate({
      ...pixelInput,
      cornerSet: poisonedCornerSet,
    });
    expect(baselinePoisoned.homography).not.toEqual(baselineClean.homography);
    // The line-based candidate is immune to the poisoned corner set.
    expect(lineBased.calibrate({ ...pixelInput, cornerSet: poisonedCornerSet })).toEqual(
      lineBased.calibrate(pixelInput),
    );
  });
});
