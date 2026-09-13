import { describe, expect, test } from "bun:test";
import {
  MediaInvalidError,
  ProcessingStateService,
  ResourceLimitError,
  RightsDeniedError,
  SessionTimelineService,
  WatermarkRegressionError,
} from "../src/index";
import type { ProcessingState, SessionTimeline, Watermark } from "@sporta/contracts";

describe("SessionTimelineService", () => {
  test("defaults to a zeroed, unmeasured timeline", () => {
    const service = new SessionTimelineService();
    expect(service.timeline).toEqual({
      durationMs: 0,
      videoClockOffsetMs: 0,
      audioClockOffsetMs: 0,
      driftMeasured: false,
    });
  });

  test("seeds from a persisted timeline (deep copy both ways)", () => {
    const persisted: SessionTimeline = {
      durationMs: 1000,
      videoClockOffsetMs: 40,
      audioClockOffsetMs: 80,
      driftMeasured: true,
    };
    const service = new SessionTimelineService(persisted);
    persisted.durationMs = 999999; // mutating the seed must not leak in
    expect(service.timeline.durationMs).toBe(1000);

    const snapshot = service.timeline;
    snapshot.videoClockOffsetMs = 999999; // mutating the snapshot must not leak in
    expect(service.timeline.videoClockOffsetMs).toBe(40);
  });

  test("setDuration updates duration and rejects negative values", () => {
    const service = new SessionTimelineService();
    service.setDuration(5520000);
    expect(service.timeline.durationMs).toBe(5520000);
    expect(() => service.setDuration(-1)).toThrow(RangeError);
  });

  test("calibrate records offsets and marks drift as measured", () => {
    const service = new SessionTimelineService();
    const timeline = service.calibrate({ videoClockOffsetMs: 1200, audioClockOffsetMs: 1150 });
    expect(timeline.videoClockOffsetMs).toBe(1200);
    expect(timeline.audioClockOffsetMs).toBe(1150);
    expect(timeline.driftMeasured).toBe(true);
    expect(service.timeline.driftMeasured).toBe(true);
  });

  test("toCanonicalTimeline subtracts the clock offset (video and audio)", () => {
    const service = new SessionTimelineService();
    service.calibrate({ videoClockOffsetMs: 1200, audioClockOffsetMs: 1150 });
    expect(service.toCanonicalTimeline("video", 3200)).toBe(2000);
    expect(service.toCanonicalTimeline("audio", 3150)).toBe(2000);
  });

  test("source times before the offset map to negative canonical positions", () => {
    const service = new SessionTimelineService();
    service.calibrate({ videoClockOffsetMs: 1200, audioClockOffsetMs: 0 });
    expect(service.toCanonicalTimeline("video", 600)).toBe(-600);
  });

  test("driftBetween measures clock drift and marks driftMeasured", () => {
    const service = new SessionTimelineService();
    service.calibrate({ videoClockOffsetMs: 1200, audioClockOffsetMs: 1150 });
    // canonical(video 5000) = 3800, canonical(audio 4600) = 3450 -> +350 (video ahead)
    const drift = service.driftBetween(5000, 4600);
    expect(drift).toBe(350);
    expect(service.timeline.driftMeasured).toBe(true);
  });

  test("driftBetween reports negative drift when the audio clock leads", () => {
    const service = new SessionTimelineService();
    service.calibrate({ videoClockOffsetMs: 100, audioClockOffsetMs: 900 });
    // canonical(video 1000) = 900, canonical(audio 1000) = 100 -> +800 (video ahead)
    expect(service.driftBetween(1000, 1000)).toBe(800);
    // canonical(video 1000) = 900, canonical(audio 2000) = 1100 -> -200 (audio ahead)
    expect(service.driftBetween(1000, 2000)).toBe(-200);
    // canonical(video 200) = 100, canonical(audio 1000) = 100 -> 0
    expect(service.driftBetween(200, 1000)).toBe(0);
  });

  test("driftBetween marks driftMeasured even when never calibrated", () => {
    const service = new SessionTimelineService();
    expect(service.timeline.driftMeasured).toBe(false);
    expect(service.driftBetween(100, 100)).toBe(0);
    expect(service.timeline.driftMeasured).toBe(true);
  });
});

describe("ProcessingStateService watermark monotonicity", () => {
  const service = new ProcessingStateService();

  const base: ProcessingState = { stage: "ingesting" };

  test("sets a watermark on a state without one", () => {
    const state = service.advanceWatermark(base, { watermarkMs: 100, sequence: 1 });
    expect(state.watermark).toEqual({ watermarkMs: 100, sequence: 1 });
  });

  test("advances forward in both components", () => {
    let state = service.advanceWatermark(base, { watermarkMs: 100, sequence: 1 });
    state = service.advanceWatermark(state, { watermarkMs: 250, sequence: 2 });
    expect(state.watermark).toEqual({ watermarkMs: 250, sequence: 2 });
  });

  test("an identical watermark is an idempotent no-op", () => {
    let state = service.advanceWatermark(base, { watermarkMs: 250, sequence: 2 });
    state = service.advanceWatermark(state, { watermarkMs: 250, sequence: 2 });
    expect(state.watermark).toEqual({ watermarkMs: 250, sequence: 2 });
  });

  test("a backwards watermarkMs throws", () => {
    const state = service.advanceWatermark(base, { watermarkMs: 250, sequence: 2 });
    expect(() => service.advanceWatermark(state, { watermarkMs: 249, sequence: 3 })).toThrow(
      WatermarkRegressionError,
    );
  });

  test("a backwards sequence throws", () => {
    const state = service.advanceWatermark(base, { watermarkMs: 250, sequence: 2 });
    expect(() => service.advanceWatermark(state, { watermarkMs: 300, sequence: 1 })).toThrow(
      WatermarkRegressionError,
    );
  });

  test("one component backwards with the other forwards still throws", () => {
    const state = service.advanceWatermark(base, { watermarkMs: 250, sequence: 2 });
    expect(() => service.advanceWatermark(state, { watermarkMs: 249, sequence: 5 })).toThrow(
      WatermarkRegressionError,
    );
  });

  test("WatermarkRegressionError carries from/to", () => {
    const from: Watermark = { watermarkMs: 250, sequence: 2 };
    const state = service.advanceWatermark(base, from);
    try {
      service.advanceWatermark(state, { watermarkMs: 200, sequence: 1 });
      throw new Error("expected WatermarkRegressionError");
    } catch (err) {
      expect(err).toBeInstanceOf(WatermarkRegressionError);
      const e = err as WatermarkRegressionError;
      expect(e.from).toEqual(from);
      expect(e.to).toEqual({ watermarkMs: 200, sequence: 1 });
    }
  });

  test("advanceWatermark does not mutate the input state", () => {
    const state = service.advanceWatermark(base, { watermarkMs: 100, sequence: 1 });
    const snapshot = structuredClone(state);
    const advanced = service.advanceWatermark(state, { watermarkMs: 200, sequence: 2 });
    expect(state).toEqual(snapshot);
    expect(advanced.watermark?.watermarkMs).toBe(200);
    expect(advanced).not.toBe(state);
  });
});

describe("ProcessingStateService noteError", () => {
  const service = new ProcessingStateService();

  test("records an Error message in lastError", () => {
    const state = service.noteError({ stage: "processing" }, new Error("decoder stalled"));
    expect(state.lastError).toBe("decoder stalled");
    expect(state.stage).toBe("processing");
  });

  test("stringifies non-Error values", () => {
    const state = service.noteError({ stage: "processing" }, "plain failure");
    expect(state.lastError).toBe("plain failure");
  });

  test("preserves other fields and does not mutate the input", () => {
    const input: ProcessingState = {
      stage: "rendering",
      watermark: { watermarkMs: 10, sequence: 3 },
    };
    const snapshot = structuredClone(input);
    const state = service.noteError(input, new Error("gpu oom"));
    expect(input).toEqual(snapshot);
    expect(state.watermark).toEqual({ watermarkMs: 10, sequence: 3 });
    expect(state.lastError).toBe("gpu oom");
  });
});

describe("ProcessingStateService classifyFailure", () => {
  const service = new ProcessingStateService();

  test("rights denials classify to rights-denied", () => {
    expect(service.classifyFailure(new RightsDeniedError("missing-policy", "analysis"))).toBe(
      "rights-denied",
    );
  });

  test("media-invalid and resource-limit classify via their error classes", () => {
    expect(service.classifyFailure(new MediaInvalidError("bad container"))).toBe("media-invalid");
    expect(service.classifyFailure(new ResourceLimitError("queue overflow"))).toBe(
      "resource-limit",
    );
  });

  test("unknown errors classify to internal", () => {
    expect(service.classifyFailure(new Error("anything"))).toBe("internal");
    expect(service.classifyFailure("a string")).toBe("internal");
    expect(service.classifyFailure(null)).toBe("internal");
    expect(service.classifyFailure(undefined)).toBe("internal");
    expect(service.classifyFailure(42)).toBe("internal");
  });

  test("duck-typed errors carrying a valid terminalFailureClass classify to it", () => {
    const custom = Object.assign(new Error("custom denial"), {
      terminalFailureClass: "media-invalid",
    });
    expect(service.classifyFailure(custom)).toBe("media-invalid");
  });

  test("bogus terminalFailureClass values fall back to internal (not fail-open)", () => {
    const bogus = Object.assign(new Error("weird"), { terminalFailureClass: "totally-bogus" });
    expect(service.classifyFailure(bogus)).toBe("internal");
  });
});
