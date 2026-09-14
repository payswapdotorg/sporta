/**
 * Temporal artifact metric tests (W503): clean zeros, and one targeted
 * detection case per artifact family (window overlap, inverted window,
 * window/timestamp mismatch, caption duplication, caption-unapplied,
 * applied duplication, applied unsorted, applied gap, applied unaccounted,
 * watermark sequence/time regressions, watermarkBelowEvents, disposition
 * flapping, kind change, possession display mismatch).
 */
import { describe, expect, test } from "bun:test";
import type { AnimeClipManifest } from "@sporta/renderer-anime";
import {
  injectAppliedSequenceGap,
  injectDispositionFlap,
  injectDuplicateEventAttribution,
  injectUnexplainedAbsence,
  injectWatermarkRegression,
  injectWindowOverlap,
  measureTemporalArtifacts,
  renderW503CleanFixture,
} from "../src/index";

function cleanManifest(): AnimeClipManifest {
  return structuredClone(renderW503CleanFixture().manifest);
}

describe("measureTemporalArtifacts — the clean W502 fixture (all zeros)", () => {
  const metrics = measureTemporalArtifacts(cleanManifest());

  test("every artifact count is zero", () => {
    expect(metrics.frameCount).toBe(6);
    expect(metrics.windowOverlapCount).toBe(0);
    expect(metrics.invertedWindowCount).toBe(0);
    expect(metrics.windowTimestampMismatchCount).toBe(0);
    expect(metrics.captionDuplicateCount).toBe(0);
    expect(metrics.captionUnappliedCount).toBe(0);
    expect(metrics.appliedDuplicateCount).toBe(0);
    expect(metrics.appliedUnsortedCount).toBe(0);
    expect(metrics.appliedGapCount).toBe(0);
    expect(metrics.appliedUnaccountedCount).toBe(0);
    expect(metrics.watermarkSequenceRegressionCount).toBe(0);
    expect(metrics.watermarkTimeRegressionCount).toBe(0);
    expect(metrics.watermarkBelowEventsCount).toBe(0);
    expect(metrics.dispositionFlapCount).toBe(0);
    expect(metrics.dispositionTransitionCount).toBe(0);
    expect(metrics.kindChangeCount).toBe(0);
    expect(metrics.possessionDisplayMismatchCount).toBe(0);
  });

  test("no anomaly records", () => {
    expect(metrics.anomalies).toEqual([]);
  });

  test("justified dispositions produce no transitions (constant dispositions)", () => {
    // player-11 (omitted-no-position), player-far (omitted-out-of-play) and
    // team-1 (not-rendered-kind) are constant across frames: no transitions.
    expect(metrics.dispositionTransitionCount).toBe(0);
  });
});

describe("measureTemporalArtifacts — window anomalies", () => {
  test("overlapping windows are detected with the exact overlap detail", () => {
    const perturbed = injectWindowOverlap(cleanManifest(), { frameIndex: 2 });
    const metrics = measureTemporalArtifacts(perturbed);
    expect(metrics.windowOverlapCount).toBe(1);
    expect(metrics.invertedWindowCount).toBe(0);
    expect(metrics.windowTimestampMismatchCount).toBe(0);
    expect(metrics.anomalies).toHaveLength(1);
    expect(metrics.anomalies[0]!.kind).toBe("window-overlap");
    expect(metrics.anomalies[0]!.frameIndex).toBe(3);
    expect(metrics.anomalies[0]!.detail).toContain("frame 2 window ends at 4500");
  });

  test("inverted window (startMs === endMs) is detected", () => {
    const perturbed = cleanManifest();
    perturbed.frames[2]!.windowMs = { startMs: 3_000, endMs: 3_000 };
    const metrics = measureTemporalArtifacts(perturbed);
    expect(metrics.invertedWindowCount).toBe(1);
    expect(metrics.windowOverlapCount).toBe(0);
    expect(metrics.anomalies[0]!.kind).toBe("inverted-window");
  });

  test("a window not starting at its frame timestamp is detected", () => {
    const perturbed = cleanManifest();
    perturbed.frames[2]!.windowMs = { startMs: 3_500, endMs: 4_000 };
    const metrics = measureTemporalArtifacts(perturbed);
    expect(metrics.windowTimestampMismatchCount).toBe(1);
    expect(metrics.windowOverlapCount).toBe(0);
    expect(metrics.anomalies[0]!.kind).toBe("window-timestamp-mismatch");
  });
});

describe("measureTemporalArtifacts — watermark monotonicity", () => {
  test("regressed watermark (sequence + time) is detected on both counters", () => {
    const perturbed = injectWatermarkRegression(cleanManifest(), { frameIndex: 2 });
    const metrics = measureTemporalArtifacts(perturbed);
    expect(metrics.watermarkSequenceRegressionCount).toBe(1);
    expect(metrics.watermarkTimeRegressionCount).toBe(1);
    const kinds = metrics.anomalies.map((anomaly) => anomaly.kind);
    expect(kinds).toContain("watermark-sequence-regression");
    expect(kinds).toContain("watermark-time-regression");
  });

  test("equal watermarks across frames are NOT a regression (single-snapshot path)", () => {
    const perturbed = cleanManifest();
    for (const frame of perturbed.frames) {
      frame.source.watermark = { sequence: 10, watermarkMs: 1_000 };
    }
    const metrics = measureTemporalArtifacts(perturbed);
    expect(metrics.watermarkSequenceRegressionCount).toBe(0);
    expect(metrics.watermarkTimeRegressionCount).toBe(0);
  });

  test("watermarkAfter below the highest consumed event sequence (R6 breach)", () => {
    const perturbed = cleanManifest();
    perturbed.watermarkAfter = { watermarkMs: 7_000, sequence: 14 };
    const metrics = measureTemporalArtifacts(perturbed);
    expect(metrics.watermarkBelowEventsCount).toBe(1);
    expect(metrics.anomalies[0]!.kind).toBe("watermark-below-events");
    expect(metrics.anomalies[0]!.detail).toContain(
      "14 < highest applied-or-skipped event sequence 15",
    );
  });
});

describe("measureTemporalArtifacts — event attribution anomalies", () => {
  test("a silently dropped interior event (applied gap) is detected", () => {
    const perturbed = injectAppliedSequenceGap(cleanManifest(), {
      frameIndex: 3,
      sequence: 13,
    });
    const metrics = measureTemporalArtifacts(perturbed);
    expect(metrics.appliedGapCount).toBe(1);
    expect(metrics.captionUnappliedCount).toBe(0); // its caption was removed too
    expect(metrics.anomalies[0]!.kind).toBe("applied-gap");
    expect(metrics.anomalies[0]!.detail).toContain("sequence 13");
  });

  test("duplicate attribution (event applied and captioned twice) is detected", () => {
    const perturbed = injectDuplicateEventAttribution(cleanManifest(), {
      sequence: 11,
      fromFrameIndex: 0,
      toFrameIndex: 2,
    });
    const metrics = measureTemporalArtifacts(perturbed);
    expect(metrics.appliedDuplicateCount).toBe(1);
    expect(metrics.captionDuplicateCount).toBe(1);
    expect(metrics.appliedUnsortedCount).toBe(0); // the injector re-sorts
    const kinds = metrics.anomalies.map((anomaly) => anomaly.kind).sort();
    expect(kinds).toEqual(["applied-duplicate", "caption-duplicate"]);
  });

  test("applied sequences out of order within a frame are detected", () => {
    // Move the shot (13, frame 3) into frame 2's applied list BEFORE 12 —
    // descending within the frame, still globally unique and accounted (its
    // caption moves with it), so UNSORTED is the only anomaly.
    const perturbed = cleanManifest();
    const frame2 = perturbed.frames[2]!;
    const frame3 = perturbed.frames[3]!;
    const shot = frame3.captions.events.find((event) => event.sequence === 13)!;
    frame2.appliedEventSequences = [13, 12];
    frame2.captions.events = [...frame2.captions.events, shot];
    frame3.appliedEventSequences = [];
    frame3.captions.events = [];
    const metrics = measureTemporalArtifacts(perturbed);
    expect(metrics.appliedUnsortedCount).toBe(1);
    expect(metrics.appliedDuplicateCount).toBe(0);
    expect(metrics.captionDuplicateCount).toBe(0);
    expect(metrics.appliedGapCount).toBe(0);
    expect(metrics.captionUnappliedCount).toBe(0);
    expect(metrics.appliedUnaccountedCount).toBe(0);
    expect(metrics.anomalies).toHaveLength(1);
    expect(metrics.anomalies[0]!.kind).toBe("applied-unsorted");
    expect(metrics.anomalies[0]!.frameIndex).toBe(2);
  });

  test("a captioned event missing from appliedEventSequences is detected", () => {
    const perturbed = cleanManifest();
    perturbed.frames[0]!.captions.events = [
      ...perturbed.frames[0]!.captions.events,
      { sequence: 99, eventId: "fe-ghost", phrase: "Ghost" },
    ];
    const metrics = measureTemporalArtifacts(perturbed);
    expect(metrics.captionUnappliedCount).toBe(1);
    expect(metrics.anomalies[0]!.kind).toBe("caption-unapplied");
    expect(metrics.anomalies[0]!.detail).toContain("fe-ghost");
  });

  test("an applied event accounted in neither caption list is detected", () => {
    const perturbed = cleanManifest();
    // Keep sequence 13 applied but remove its caption accounting.
    perturbed.frames[3]!.captions.events = [];
    const metrics = measureTemporalArtifacts(perturbed);
    expect(metrics.appliedUnaccountedCount).toBe(1);
    expect(metrics.captionUnappliedCount).toBe(0);
    expect(metrics.anomalies[0]!.kind).toBe("applied-unaccounted");
  });

  test("skippedEvents legitimately account an interior sequence (no gap flagged)", () => {
    const perturbed = cleanManifest();
    // Drop sequence 13 from frame 3 AND account it as skipped.
    const gapless = injectAppliedSequenceGap(perturbed, { frameIndex: 3, sequence: 13 });
    gapless.skippedEvents = [
      {
        sequence: 13,
        eventId: "fe-shot",
        eventTimeMs: 4_000,
        reason: "after-window",
      },
    ];
    const metrics = measureTemporalArtifacts(gapless);
    expect(metrics.appliedGapCount).toBe(0);
  });
});

describe("measureTemporalArtifacts — disposition anomalies", () => {
  test("drawn -> omitted-no-position -> drawn flapping is detected", () => {
    const perturbed = injectDispositionFlap(cleanManifest(), {
      frameIndex: 2,
      entityId: "player-9",
    });
    const metrics = measureTemporalArtifacts(perturbed);
    expect(metrics.dispositionFlapCount).toBe(1);
    expect(metrics.dispositionTransitionCount).toBe(2);
    expect(metrics.anomalies).toHaveLength(1);
    expect(metrics.anomalies[0]!.kind).toBe("disposition-flap");
    expect(metrics.anomalies[0]!.entityId).toBe("player-9");
    expect(metrics.anomalies[0]!.frameIndex).toBe(2);
  });

  test("a longer justified omission that reverses is a transition, not a flap", () => {
    const perturbed = cleanManifest();
    for (const frameIndex of [2, 3]) {
      const entity = perturbed.frames[frameIndex]!.entities.find(
        (entry) => entry.entityId === "player-9",
      )!;
      entity.disposition = "omitted-no-position";
      entity.positionStatus = "unknown";
      delete entity.positionMeters;
      delete entity.svgPosition;
      delete entity.style;
    }
    const metrics = measureTemporalArtifacts(perturbed);
    expect(metrics.dispositionFlapCount).toBe(0);
    expect(metrics.dispositionTransitionCount).toBe(2);
  });

  test("an entity kind change is detected", () => {
    const perturbed = cleanManifest();
    const entity = perturbed.frames[3]!.entities.find((entry) => entry.entityId === "ball-1")!;
    entity.kind = "official";
    const metrics = measureTemporalArtifacts(perturbed);
    expect(metrics.kindChangeCount).toBe(1);
    expect(metrics.anomalies[0]!.kind).toBe("kind-change");
    expect(metrics.anomalies[0]!.entityId).toBe("ball-1");
  });
});

describe("measureTemporalArtifacts — possession consistency", () => {
  test("a displayed ring around a non-drawn entity is detected", () => {
    const perturbed = cleanManifest();
    perturbed.frames[2]!.possession = {
      status: "uncertain",
      entityId: "player-11",
      confidence: 0.75,
      displayed: true,
    };
    const metrics = measureTemporalArtifacts(perturbed);
    expect(metrics.possessionDisplayMismatchCount).toBe(1);
    expect(metrics.anomalies[0]!.kind).toBe("possession-display-mismatch");
    expect(metrics.anomalies[0]!.detail).toContain("player-11");
  });

  test("a displayed ring around a drawn entity is clean (the fixture default)", () => {
    const metrics = measureTemporalArtifacts(cleanManifest());
    expect(metrics.possessionDisplayMismatchCount).toBe(0);
  });

  test("an unexplained absence ALSO floats the possession ring (same perturbation, honest secondary detection)", () => {
    const perturbed = injectUnexplainedAbsence(cleanManifest(), {
      frameIndex: 2,
      entityId: "player-7",
    });
    const metrics = measureTemporalArtifacts(perturbed);
    expect(metrics.possessionDisplayMismatchCount).toBe(1);
  });
});

describe("measureTemporalArtifacts — determinism", () => {
  test("two measurements of the same manifest are deep-equal", () => {
    const manifest = cleanManifest();
    expect(measureTemporalArtifacts(manifest)).toEqual(measureTemporalArtifacts(manifest));
  });
});
