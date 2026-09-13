/**
 * W103 TimelineSynchronizer tests: canonical zero-point, two-anchor drift
 * measurement (500 ppm / -500 ppm / 5000 ppm anomaly clamp), single-anchor
 * fallback, duration as the max corrected end, typed rejections
 * (zero-length tracks, inverted spans, kind mismatches, bad durations),
 * determinism (deep-equal on repeated align), ensureMonotonic /
 * mapSample, and the observability contract (one structured info line per
 * align, warn lines + labeled counters on refusals and anomalies).
 *
 * SEMANTICS NOTE (documented deviation from the assignment's §3.5 example):
 * the assignment's own §3.3.1 formula — `videoClockOffsetMs =
 * video.firstSampleMs - min(video.first, audio.first)` — yields offsets
 * 60 / 0 for video first 1000 / audio first 940 (audio first is the
 * earliest, so audio gets offset 0), and its stated invariant "offsets shift
 * both tracks non-negative" rules out the §3.5 example's "0 / -60" (a
 * negative offset). The formula governs: audio (the leading track) sits at
 * session 0, video starts 60 ms in.
 *
 * Deterministic per docs/testing/HARNESS.md: explicit millisecond constants,
 * a fixed injected clock for log timestamps — no `Math.random`, no
 * `Date.now`.
 */
import { describe, expect, test } from "bun:test";
import { SessionTimeline } from "@sporta/contracts";
import { MetricsRegistry, createLogger } from "@sporta/observability";
import type { Logger } from "@sporta/observability";
import { TEST_EPOCH_MS } from "@sporta/testing";
import {
  DRIFT_CLAMP_PPM,
  TIMELINE_METRIC_NAMES,
  TimelineSynchronizer,
  ensureMonotonic,
  mapSample,
} from "../src/index";
import { InvalidTimelineError, isTimelineError } from "../src/index";
import { toSessionMs } from "../src/index";
import type { AlignInput, SyncResult, TrackTiming } from "../src/index";

// --- helpers ---------------------------------------------------------------

/** A video track timing summary on the shared source timeline. */
function videoTiming(overrides: Partial<TrackTiming> = {}): TrackTiming {
  return {
    trackId: "t-0-video",
    kind: "video",
    firstSampleMs: 0,
    lastSampleMs: 59_990,
    sampleCount: 1_500,
    ...overrides,
  };
}

/** An audio track timing summary on the shared source timeline. */
function audioTiming(overrides: Partial<TrackTiming> = {}): TrackTiming {
  return {
    trackId: "t-1-audio",
    kind: "audio",
    firstSampleMs: 0,
    lastSampleMs: 59_750,
    sampleCount: 240,
    ...overrides,
  };
}

/**
 * The canonical drift construction: coincident first samples, a 60 000 ms
 * overlap (audio end 60 000), and a known end misalignment (the end-anchor
 * session difference: video end = 60 000 + misalignment).
 */
function driftInput(endMisalignmentMs: number): AlignInput {
  return {
    video: videoTiming({ lastSampleMs: 60_000 - 40 + endMisalignmentMs }),
    audio: audioTiming({ lastSampleMs: 60_000 - 250 }),
    videoFrameDurationMs: 40,
    audioChunkDurationMs: 250,
  };
}

/** A silent synchronizer (no observability) for pure-math assertions. */
function silentSynchronizer(): TimelineSynchronizer {
  return new TimelineSynchronizer();
}

/** Capturing observability: every JSON log line + a metrics registry. */
function capturingObservability(): { lines: string[]; logger: Logger; metrics: MetricsRegistry } {
  const lines: string[] = [];
  const logger = createLogger({ sink: (line) => lines.push(line), now: () => TEST_EPOCH_MS });
  const metrics = new MetricsRegistry();
  return { lines, logger, metrics };
}

// --- canonical zero-point ---------------------------------------------------

describe("canonical zero-point", () => {
  test("video first 1000 / audio first 940 -> offsets 60 / 0 (audio leads)", () => {
    const result = silentSynchronizer().align({
      video: videoTiming({ firstSampleMs: 1_000, lastSampleMs: 61_000, sampleCount: 1_801 }),
      audio: audioTiming({ firstSampleMs: 940, lastSampleMs: 60_940, sampleCount: 241 }),
    });

    // §3.3.1 formula verbatim: first - min(firsts); the earliest track (the
    // leading audio track) gets offset 0. (See the semantics note atop this
    // file for why the assignment example's "0 / -60" cannot hold.)
    expect(result.timeline.videoClockOffsetMs).toBe(60);
    expect(result.timeline.audioClockOffsetMs).toBe(0);

    // Both tracks' session times are non-negative: the earliest samples map
    // to 60 and 0, and every later sample maps higher.
    expect(toSessionMs(result.clocks.video, 1_000)).toBe(60);
    expect(toSessionMs(result.clocks.audio, 940)).toBe(0);

    // The clocks carry the shared -min(firsts) mapping shift...
    expect(result.clocks.video.offsetMs).toBe(-940);
    expect(result.clocks.audio.offsetMs).toBe(-940);
    // ...so mapping each track's first sample reproduces its contract field.
    expect(toSessionMs(result.clocks.video, 1_000)).toBe(result.timeline.videoClockOffsetMs);
    expect(toSessionMs(result.clocks.audio, 940)).toBe(result.timeline.audioClockOffsetMs);

    // Single-anchor fallback without sample durations: honest drift state.
    expect(result.timeline.driftMeasured).toBe(false);
    expect(result.driftMeasured).toBe(false);
    expect(result.driftPpm).toBe(0);
    expect(result.driftAnomaly).toBe(false);
    expect(result.anchors).toEqual([{ at: "start", videoSessionMs: 60, audioSessionMs: 0 }]);
  });

  test("durationMs is the max end sessionMs across tracks (video-driven)", () => {
    const result = silentSynchronizer().align({
      video: videoTiming({ firstSampleMs: 1_000, lastSampleMs: 61_000 }),
      audio: audioTiming({ firstSampleMs: 940, lastSampleMs: 60_940 }),
    });
    // Video ends at session 61 000 - 940 = 60 060; audio at 60 000.
    expect(result.timeline.durationMs).toBe(60_060);
  });

  test("durationMs is the max end sessionMs across tracks (audio-driven)", () => {
    const result = silentSynchronizer().align({
      video: videoTiming({ firstSampleMs: 1_000, lastSampleMs: 61_000 }),
      audio: audioTiming({ firstSampleMs: 940, lastSampleMs: 61_940 }),
    });
    // Audio ends at session 61 940 - 940 = 61 000; video at 60 060.
    expect(result.timeline.durationMs).toBe(61_000);
  });

  test("the earliest track flips when video leads audio", () => {
    const result = silentSynchronizer().align({
      video: videoTiming({ firstSampleMs: 900, lastSampleMs: 60_900 }),
      audio: audioTiming({ firstSampleMs: 1_000, lastSampleMs: 61_000 }),
    });
    expect(result.timeline.videoClockOffsetMs).toBe(0);
    expect(result.timeline.audioClockOffsetMs).toBe(100);
    expect(result.clocks.video.offsetMs).toBe(-900);
    expect(result.clocks.audio.offsetMs).toBe(-900);
  });

  test("canonical timeline fields parse against the contracts zod schema", () => {
    const result = silentSynchronizer().align(driftInput(30));
    expect(() => SessionTimeline.parse(result.timeline)).not.toThrow();
    expect(SessionTimeline.parse(result.timeline)).toEqual(result.timeline);

    // Negative control: the schema genuinely rejects a bad timeline.
    expect(() =>
      SessionTimeline.parse({
        durationMs: -1,
        videoClockOffsetMs: 0,
        audioClockOffsetMs: 0,
        driftMeasured: false,
      }),
    ).toThrow();
  });
});

// --- two-anchor drift -------------------------------------------------------

describe("two-anchor drift measurement", () => {
  test("30 ms end misalignment over 60 000 ms -> 500 ppm within +/-1", () => {
    const result = silentSynchronizer().align(driftInput(30));

    expect(result.driftMeasured).toBe(true);
    expect(result.timeline.driftMeasured).toBe(true);
    expect(Math.abs(result.driftPpm - 500)).toBeLessThanOrEqual(1);

    // The end anchor pair records the measured misalignment in session ms.
    expect(result.anchors).toHaveLength(2);
    expect(result.anchors[0]).toEqual({ at: "start", videoSessionMs: 0, audioSessionMs: 0 });
    expect(result.anchors[1]?.at).toBe("end");
    expect(result.anchors[1]?.videoSessionMs).toBe(60_030);
    expect(result.anchors[1]?.audioSessionMs).toBe(60_000);

    // No anomaly at 500 ppm.
    expect(result.driftAnomaly).toBe(false);

    // The audio clock is the rate reference; the video clock carries the
    // corrective drift (a fast video clock maps down onto the timeline).
    expect(result.clocks.audio.driftPpm).toBe(0);
    expect(result.clocks.video.driftPpm).toBe(-result.driftPpm);
    expect(Math.abs(result.clocks.video.driftPpm + 500)).toBeLessThanOrEqual(1);

    // durationMs = max corrected end: the corrected video end re-aligns with
    // the audio end (60 000), so the canonical duration is 60 000.
    expect(Math.abs(result.timeline.durationMs - 60_000)).toBeLessThanOrEqual(0.1);
  });

  test("negative end misalignment -> negative drift (video clock slow)", () => {
    const result = silentSynchronizer().align(driftInput(-30));

    expect(result.driftMeasured).toBe(true);
    expect(Math.abs(result.driftPpm + 500)).toBeLessThanOrEqual(1);
    expect(result.driftAnomaly).toBe(false);
    expect(Math.abs(result.clocks.video.driftPpm - 500)).toBeLessThanOrEqual(1);
    expect(result.anchors[1]).toEqual({
      at: "end",
      videoSessionMs: 59_970,
      audioSessionMs: 60_000,
    });
  });

  test("5 000 ppm is a data fault: clamped to 1000, driftAnomaly true", () => {
    const result = silentSynchronizer().align(driftInput(300));

    expect(result.driftPpm).toBe(DRIFT_CLAMP_PPM);
    expect(result.driftAnomaly).toBe(true);
    expect(result.driftMeasured).toBe(true);
    // The clamped corrective drift still applies to the video clock.
    expect(result.clocks.video.driftPpm).toBe(-DRIFT_CLAMP_PPM);
    // Duration reflects the clamped (honest) correction: 60 300 - 60.3.
    expect(result.timeline.durationMs).toBeCloseTo(60_239.7, 6);
  });

  test("drift exactly at the clamp is NOT an anomaly", () => {
    // 60 ms over 60 000 ms -> exactly 1000 ppm: within, not beyond.
    const result = silentSynchronizer().align(driftInput(60));
    expect(Math.abs(result.driftPpm - 1_000)).toBeLessThanOrEqual(1);
    expect(result.driftAnomaly).toBe(false);
  });
});

// --- single-anchor fallback -------------------------------------------------

describe("single-anchor fallback", () => {
  test("either unknown duration -> drift 0, driftMeasured false, no end anchor", () => {
    const canonical = driftInput(30);
    const onlyVideoDuration = silentSynchronizer().align({
      video: canonical.video,
      audio: canonical.audio,
      videoFrameDurationMs: canonical.videoFrameDurationMs,
    });
    expect(onlyVideoDuration.driftMeasured).toBe(false);
    expect(onlyVideoDuration.driftPpm).toBe(0);
    expect(onlyVideoDuration.driftAnomaly).toBe(false);
    expect(onlyVideoDuration.anchors).toHaveLength(1);
    expect(onlyVideoDuration.clocks.video.driftPpm).toBe(0);
    expect(onlyVideoDuration.clocks.audio.driftPpm).toBe(0);

    const onlyAudioDuration = silentSynchronizer().align({
      video: canonical.video,
      audio: canonical.audio,
      audioChunkDurationMs: canonical.audioChunkDurationMs,
    });
    expect(onlyAudioDuration.driftMeasured).toBe(false);
    expect(onlyAudioDuration.driftPpm).toBe(0);
    expect(onlyAudioDuration.anchors).toHaveLength(1);
  });

  test("non-overlapping session spans -> not measurable, driftMeasured false", () => {
    const { lines, logger, metrics } = capturingObservability();
    const synchronizer = new TimelineSynchronizer({
      observability: { logger, metrics },
    });

    const result = synchronizer.align({
      video: videoTiming({ firstSampleMs: 0, lastSampleMs: 960 }),
      audio: audioTiming({ firstSampleMs: 2_000, lastSampleMs: 5_000 }),
      videoFrameDurationMs: 40,
      audioChunkDurationMs: 250,
    });

    expect(result.driftMeasured).toBe(false);
    expect(result.driftPpm).toBe(0);
    expect(result.driftAnomaly).toBe(false);
    expect(result.anchors).toHaveLength(1);
    // The honest fallback is warned about (durations were supplied, but the
    // tracks share no session time to measure drift over).
    const warn = lines.map((l) => JSON.parse(l)).find((r) => r.level === "warn");
    expect(warn?.msg).toBe("timeline drift not measurable");
    expect(warn?.fields?.reason).toBe("no-session-overlap");
  });
});

// --- typed rejections -------------------------------------------------------

describe("typed rejections (media-invalid)", () => {
  test("zero-length track (sampleCount 0) is rejected", () => {
    const synchronizer = silentSynchronizer();
    try {
      synchronizer.align({
        video: videoTiming({ sampleCount: 0 }),
        audio: audioTiming(),
      });
      expect.unreachable();
    } catch (err) {
      expect(isTimelineError(err)).toBe(true);
      const invalid = err as InvalidTimelineError;
      expect(invalid.terminalFailureClass).toBe("media-invalid");
      expect(invalid.failureClass).toBe("media-invalid");
      expect(invalid.message).toContain("zero-length");
      expect(invalid.details.sampleCount).toBe("0");
    }
  });

  test("inverted sample span (last < first) is rejected", () => {
    expect(() =>
      silentSynchronizer().align({
        video: videoTiming({ firstSampleMs: 1_000, lastSampleMs: 900 }),
        audio: audioTiming(),
      }),
    ).toThrow(InvalidTimelineError);
  });

  test("kind mismatch (audio timing in the video slot) is rejected", () => {
    try {
      silentSynchronizer().align({
        video: audioTiming(),
        audio: audioTiming(),
      });
      expect.unreachable();
    } catch (err) {
      expect(isTimelineError(err)).toBe(true);
      expect((err as InvalidTimelineError).details.expectedKind).toBe("video");
    }
  });

  test("non-finite timing values are rejected", () => {
    expect(() =>
      silentSynchronizer().align({
        video: videoTiming({ firstSampleMs: Number.NaN }),
        audio: audioTiming(),
      }),
    ).toThrow(InvalidTimelineError);
    expect(() =>
      silentSynchronizer().align({
        video: videoTiming({ lastSampleMs: Number.POSITIVE_INFINITY }),
        audio: audioTiming(),
      }),
    ).toThrow(InvalidTimelineError);
  });

  test("non-positive or non-finite sample durations are rejected", () => {
    const base = { video: videoTiming(), audio: audioTiming() };
    expect(() => silentSynchronizer().align({ ...base, videoFrameDurationMs: 0 })).toThrow(
      InvalidTimelineError,
    );
    expect(() => silentSynchronizer().align({ ...base, audioChunkDurationMs: -250 })).toThrow(
      InvalidTimelineError,
    );
    expect(() => silentSynchronizer().align({ ...base, videoFrameDurationMs: Number.NaN })).toThrow(
      InvalidTimelineError,
    );
    expect(() =>
      silentSynchronizer().align({ ...base, audioChunkDurationMs: Number.POSITIVE_INFINITY }),
    ).toThrow(InvalidTimelineError);
  });
});

// --- determinism -------------------------------------------------------------

describe("determinism", () => {
  test("the same input aligns to a deep-equal result, twice", () => {
    const synchronizer = silentSynchronizer();
    const input = driftInput(30);
    const first: SyncResult = synchronizer.align(input);
    const second: SyncResult = synchronizer.align(input);
    expect(second).toEqual(first);

    // A second synchronizer instance is equally deterministic (no hidden
    // state leaks between instances either).
    const other = new TimelineSynchronizer().align(driftInput(30));
    expect(other).toEqual(first);
  });
});

// --- stream mapping ----------------------------------------------------------

describe("mapSample and ensureMonotonic", () => {
  test("mapSample delegates to the affine clock map", () => {
    const result = silentSynchronizer().align({
      video: videoTiming({ firstSampleMs: 1_000, lastSampleMs: 61_000 }),
      audio: audioTiming({ firstSampleMs: 940, lastSampleMs: 60_940 }),
    });
    expect(mapSample(result.clocks.video, 1_000)).toBe(toSessionMs(result.clocks.video, 1_000));
    expect(mapSample(result.clocks.video, 1_000)).toBe(60);
    expect(mapSample(result.clocks.audio, 940)).toBe(0);
  });

  test("regression is clamped to the previous session position", () => {
    expect(ensureMonotonic(5_000, 4_999)).toBe(5_000);
    expect(ensureMonotonic(5_000, 0)).toBe(5_000);
    expect(ensureMonotonic(0, -5)).toBe(0);
  });

  test("equal and increasing candidates pass through unchanged", () => {
    expect(ensureMonotonic(5_000, 5_000)).toBe(5_000);
    expect(ensureMonotonic(5_000, 5_001)).toBe(5_001);
    expect(ensureMonotonic(0, 60_000)).toBe(60_000);
  });

  test("non-finite arguments fail loud", () => {
    expect(() => ensureMonotonic(Number.NaN, 1)).toThrow(RangeError);
    expect(() => ensureMonotonic(1, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

// --- observability -----------------------------------------------------------

describe("observability contract", () => {
  test("one structured info line per successful align", () => {
    const { lines, logger, metrics } = capturingObservability();
    const synchronizer = new TimelineSynchronizer({
      observability: { logger, metrics },
    });

    synchronizer.align(driftInput(30));

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] as string);
    expect(record.ts).toBe(TEST_EPOCH_MS);
    expect(record.level).toBe("info");
    expect(record.msg).toBe("timeline aligned");
    expect(record.stage).toBe("timeline-sync");
    expect(record.fields.videoTrackId).toBe("t-0-video");
    expect(record.fields.audioTrackId).toBe("t-1-audio");
    expect(record.fields.driftMeasured).toBe(true);
    expect(record.fields.driftAnomaly).toBe(false);
    expect(record.fields.anchorCount).toBe(2);
    expect(Math.abs(record.fields.driftPpm - 500)).toBeLessThanOrEqual(1);
    expect(Math.abs(record.fields.durationMs - 60_000)).toBeLessThanOrEqual(0.1);
  });

  test("an anomaly adds a warn line and bumps the anomaly counter", () => {
    const { lines, logger, metrics } = capturingObservability();
    const synchronizer = new TimelineSynchronizer({
      observability: { logger, metrics },
    });

    synchronizer.align(driftInput(300));

    expect(lines).toHaveLength(2);
    const warn = JSON.parse(lines[0] as string);
    expect(warn.level).toBe("warn");
    expect(warn.msg).toBe("timeline drift clamped");
    expect(Math.abs(warn.fields.rawDriftPpm - 5_000)).toBeLessThanOrEqual(1);
    expect(warn.fields.driftPpm).toBe(DRIFT_CLAMP_PPM);
    expect(warn.fields.limitPpm).toBe(DRIFT_CLAMP_PPM);
    const info = JSON.parse(lines[1] as string);
    expect(info.level).toBe("info");
    expect(info.fields.driftAnomaly).toBe(true);
  });

  test("metrics: alignment, anomaly, and |drift| histogram series", () => {
    const { lines, logger, metrics } = capturingObservability();
    const synchronizer = new TimelineSynchronizer({
      observability: { logger, metrics },
    });

    synchronizer.align(driftInput(30)); // |500| ppm, measured
    synchronizer.align(driftInput(300)); // clamped to |1000| ppm, anomaly

    const snapshot = metrics.snapshot();
    const counter = (name: string): number | undefined =>
      snapshot.counters.find((c) => c.name === name)?.value;
    expect(counter(TIMELINE_METRIC_NAMES.alignmentsTotal)).toBe(2);
    expect(counter(TIMELINE_METRIC_NAMES.driftAnomaliesTotal)).toBe(1);
    expect(counter(TIMELINE_METRIC_NAMES.failuresTotal)).toBeUndefined();

    const histogram = snapshot.histograms.find((h) => h.name === TIMELINE_METRIC_NAMES.absDriftPpm);
    expect(histogram?.stats.count).toBe(2);
    expect(Math.abs((histogram?.stats.min ?? 0) - 500)).toBeLessThanOrEqual(1);
    expect(histogram?.stats.max ?? 0).toBe(1_000);

    // The single-anchor path observes nothing (drift was not measured).
    synchronizer.align({ video: videoTiming(), audio: audioTiming() });
    expect(lines).toHaveLength(4); // 1 info + (1 warn + 1 info) + 1 info lines
    const histogramAfter = metrics
      .snapshot()
      .histograms.find((h) => h.name === TIMELINE_METRIC_NAMES.absDriftPpm);
    expect(histogramAfter?.stats.count).toBe(2);
  });

  test("a classified refusal warns and bumps labeled failure counters", () => {
    const { lines, logger, metrics } = capturingObservability();
    const synchronizer = new TimelineSynchronizer({
      observability: { logger, metrics },
    });

    expect(() =>
      synchronizer.align({ video: videoTiming({ sampleCount: 0 }), audio: audioTiming() }),
    ).toThrow(InvalidTimelineError);

    expect(lines).toHaveLength(1);
    const warn = JSON.parse(lines[0] as string);
    expect(warn.level).toBe("warn");
    expect(warn.msg).toBe("timeline refused");
    expect(warn.fields.failureClass).toBe("media-invalid");

    const snapshot = metrics.snapshot();
    const unlabeled = snapshot.counters.find(
      (c) => c.name === TIMELINE_METRIC_NAMES.failuresTotal && Object.keys(c.labels).length === 0,
    );
    const labeled = snapshot.counters.find(
      (c) => c.name === TIMELINE_METRIC_NAMES.failuresTotal && c.labels.failure_class,
    );
    expect(unlabeled?.value).toBe(1);
    expect(labeled?.value).toBe(1);
    expect(labeled?.labels.failure_class).toBe("media-invalid");
  });

  test("a correlation context binds ids onto every line", () => {
    const { lines, logger, metrics } = capturingObservability();
    const synchronizer = new TimelineSynchronizer({
      observability: {
        logger,
        metrics,
        correlation: {
          sessionId: "sess-timeline",
          correlationId: "corr-7",
          traceId: "trace-7",
        },
      },
    });

    synchronizer.align(driftInput(30));

    const record = JSON.parse(lines[0] as string);
    expect(record.sessionId).toBe("sess-timeline");
    expect(record.correlationId).toBe("corr-7");
    expect(record.traceId).toBe("trace-7");
    expect(record.stage).toBe("timeline-sync");
  });

  test("absent observability is silent (no lines, no crash)", () => {
    const result = silentSynchronizer().align(driftInput(30));
    expect(result.driftMeasured).toBe(true);
  });
});
