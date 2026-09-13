/**
 * W103 anchor-extraction tests: video and audio variants (the kind selects
 * the field), empty input -> undefined, single sample, order-independence
 * (min/max over decode-order vs presentation-order), and the fail-loud
 * guards for missing / non-finite sample fields and empty track ids.
 *
 * Deterministic per docs/testing/HARNESS.md: explicit constants, no
 * `Math.random`, no `Date.now`.
 */
import { describe, expect, test } from "bun:test";
import { extractTrackTiming } from "../src/index";
import { InvalidTimelineError, isTimelineError } from "../src/index";
import type { TimingSample } from "../src/index";

describe("extractTrackTiming", () => {
  test("video variant reads presentationMs from every sample", () => {
    const frames: TimingSample[] = [
      { presentationMs: 1_000 },
      { presentationMs: 1_040 },
      { presentationMs: 1_080 },
    ];
    expect(extractTrackTiming("video", frames, "t-0-video")).toEqual({
      trackId: "t-0-video",
      kind: "video",
      firstSampleMs: 1_000,
      lastSampleMs: 1_080,
      sampleCount: 3,
    });
  });

  test("audio variant reads startMs from every sample", () => {
    const chunks: TimingSample[] = [{ startMs: 940 }, { startMs: 1_190 }, { startMs: 1_440 }];
    expect(extractTrackTiming("audio", chunks, "t-1-audio")).toEqual({
      trackId: "t-1-audio",
      kind: "audio",
      firstSampleMs: 940,
      lastSampleMs: 1_440,
      sampleCount: 3,
    });
  });

  test("the kind selects the field when a sample carries both", () => {
    const both: TimingSample[] = [{ presentationMs: 5, startMs: 7 }];
    expect(extractTrackTiming("video", both, "t-0-video")?.firstSampleMs).toBe(5);
    expect(extractTrackTiming("audio", both, "t-1-audio")?.firstSampleMs).toBe(7);
  });

  test("empty input returns undefined for both kinds", () => {
    expect(extractTrackTiming("video", [], "t-0-video")).toBeUndefined();
    expect(extractTrackTiming("audio", [], "t-1-audio")).toBeUndefined();
  });

  test("a single sample yields first === last", () => {
    const single = extractTrackTiming("video", [{ presentationMs: 2_500 }], "t-0-video");
    expect(single).toEqual({
      trackId: "t-0-video",
      kind: "video",
      firstSampleMs: 2_500,
      lastSampleMs: 2_500,
      sampleCount: 1,
    });
  });

  test("first/last are min/max, independent of array order", () => {
    // Presentation order shuffled relative to decode order (reordered
    // streams): the anchors must still be the earliest and latest.
    const shuffled: TimingSample[] = [
      { presentationMs: 1_080 },
      { presentationMs: 1_000 },
      { presentationMs: 1_040 },
    ];
    const timing = extractTrackTiming("video", shuffled, "t-0-video");
    expect(timing?.firstSampleMs).toBe(1_000);
    expect(timing?.lastSampleMs).toBe(1_080);
    expect(timing?.sampleCount).toBe(3);
  });

  test("a sample missing the kind's field fails loud as media-invalid", () => {
    // Video sample without presentationMs (audio-shaped leak, corrupt data).
    expect(() => extractTrackTiming("video", [{ startMs: 940 }], "t-0-video")).toThrow(
      InvalidTimelineError,
    );
    // Audio sample without startMs.
    expect(() => extractTrackTiming("audio", [{ presentationMs: 1_000 }], "t-1-audio")).toThrow(
      InvalidTimelineError,
    );
    try {
      extractTrackTiming("video", [{ startMs: 940 }], "t-0-video");
      expect.unreachable();
    } catch (err) {
      expect(isTimelineError(err)).toBe(true);
      const invalid = err as InvalidTimelineError;
      expect(invalid.terminalFailureClass).toBe("media-invalid");
      expect(invalid.failureClass).toBe("media-invalid");
      expect(invalid.details.trackId).toBe("t-0-video");
    }
  });

  test("non-finite sample fields fail loud", () => {
    expect(() =>
      extractTrackTiming("video", [{ presentationMs: Number.NaN }], "t-0-video"),
    ).toThrow(InvalidTimelineError);
    expect(() =>
      extractTrackTiming("audio", [{ startMs: Number.POSITIVE_INFINITY }], "t-1-audio"),
    ).toThrow(InvalidTimelineError);
  });

  test("an empty track id is rejected", () => {
    expect(() => extractTrackTiming("video", [{ presentationMs: 0 }], "")).toThrow(
      InvalidTimelineError,
    );
  });
});
