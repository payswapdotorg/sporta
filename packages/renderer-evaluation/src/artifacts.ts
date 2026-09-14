/**
 * Temporal artifact metrics over a W502 clip manifest (W503, deliverable 1c).
 *
 * Every count below is a TEMPORAL CONSISTENCY defect of the rendered clip's
 * own accounting — each has a threshold of 0 (THRESHOLDS.md) and each is
 * proven detectable by an injected-defect test. The families:
 *
 * - **Caption window anomalies**: inverted windows (`startMs >= endMs`),
 *   consecutive windows overlapping (the previous frame's window still
 *   running into the next frame's), and a window that does not start at its
 *   frame's output timestamp (the W502 construction invariant — both render
 *   paths tile the output timeline exactly).
 * - **Caption/event attribution anomalies**: an event sequence captioned in
 *   more than one frame (or twice in one frame); a captioned or uncaptioned
 *   sequence that is NOT in the frame's `appliedEventSequences` (displayed
 *   without accounting); an applied sequence attributed to more than one
 *   frame; `appliedEventSequences` not strictly ascending within a frame;
 *   an interior sequence of the applied range that is neither applied nor
 *   accounted in `skippedEvents` (a silently dropped event); an applied
 *   sequence accounted in NEITHER the captioned nor the uncaptioned list.
 * - **Watermark monotonicity**: a frame whose `source.watermark.sequence`
 *   (or `watermarkMs`) is below the previous frame's — the render went
 *   backwards in the event log; and `watermarkAfter.sequence` below the
 *   highest applied-or-skipped event sequence (the R6 contract breach: the
 *   output watermark no longer covers the events the render consumed).
 * - **Disposition-transition anomalies**: drawn→omitted→drawn FLAPPING with
 *   exactly one omitted frame between two drawn frames (the briefest
 *   visible identity oscillation; longer justified omissions are not
 *   flapping); an entity whose recorded `kind` changes across frames (an
 *   identity-level inconsistency — same id, different thing).
 * - **Possession consistency**: `possession.displayed === true` while the
 *   possessing entity is not drawn in that frame (the ring would float
 *   without its marker).
 *
 * Justified omissions are never defects here either: transitions are
 * measured over RECORDED dispositions only, and a frame where the entity is
 * absent entirely is already the identity metric's defect (unexplained
 * absence) — never silently reused here.
 *
 * Pure functions: no clock, no RNG, no I/O; deep-equal reruns. The anomaly
 * record order is deterministic (metric-family order, then frame order).
 */
import type { AnimeClipManifest, AnimeEntityDisposition } from "@sporta/renderer-anime";
import { isDrawnDisposition } from "./identity";
import { validateManifest } from "./validate";

/** One measured defect occurrence (deterministic order, human-readable detail). */
export interface TemporalAnomaly {
  /** The anomaly family (one of the documented artifact kinds). */
  kind: string;
  /** The frame the anomaly was detected on (the later frame for pair anomalies); null for clip-scoped anomalies. */
  frameIndex: number | null;
  /** The entity involved, when the anomaly is entity-scoped. */
  entityId?: string;
  /** Deterministic human-readable detail (exact values). */
  detail: string;
}

/** The temporal artifact metrics of one manifest. */
export interface TemporalArtifactMetrics {
  frameCount: number;
  /** Previous frame's window extends past this frame's window start. */
  windowOverlapCount: number;
  /** Windows with startMs >= endMs. */
  invertedWindowCount: number;
  /** Windows whose startMs differs from the frame's outputTimestampMs. */
  windowTimestampMismatchCount: number;
  /** Event sequences captioned in more than one frame (or twice in one frame). */
  captionDuplicateCount: number;
  /** Captioned/uncaptioned sequences missing from the frame's appliedEventSequences. */
  captionUnappliedCount: number;
  /** Applied sequences attributed to more than one frame (or twice in one frame). */
  appliedDuplicateCount: number;
  /** Frames whose appliedEventSequences are not strictly ascending. */
  appliedUnsortedCount: number;
  /** Interior sequences of the applied range neither applied nor skipped-accounted. */
  appliedGapCount: number;
  /** Applied sequences accounted in neither the captioned nor the uncaptioned list. */
  appliedUnaccountedCount: number;
  /** Frames whose source watermark sequence is below the previous frame's. */
  watermarkSequenceRegressionCount: number;
  /** Frames whose source watermarkMs is below the previous frame's. */
  watermarkTimeRegressionCount: number;
  /** watermarkAfter.sequence below the highest applied-or-skipped sequence. */
  watermarkBelowEventsCount: number;
  /** Drawn→omitted→drawn disposition flaps (exactly one omitted frame). */
  dispositionFlapCount: number;
  /** Total drawn↔omitted transitions (context; no threshold — not a defect alone). */
  dispositionTransitionCount: number;
  /** Entities whose recorded kind differs across frames. */
  kindChangeCount: number;
  /** Frames with possession.displayed true while the possessing entity is not drawn. */
  possessionDisplayMismatchCount: number;
  /** Every defect occurrence, in deterministic order. */
  anomalies: TemporalAnomaly[];
}

/** A running counter bundle (kept as one object to keep the walk readable). */
interface Counters {
  windowOverlap: number;
  invertedWindow: number;
  windowTimestampMismatch: number;
  captionDuplicate: number;
  captionUnapplied: number;
  appliedDuplicate: number;
  appliedUnsorted: number;
  appliedGap: number;
  appliedUnaccounted: number;
  watermarkSequenceRegression: number;
  watermarkTimeRegression: number;
  watermarkBelowEvents: number;
  dispositionFlap: number;
  dispositionTransition: number;
  kindChange: number;
  possessionDisplayMismatch: number;
}

/**
 * Measures temporal artifacts over a validated clip manifest. Throws
 * `TemporalEvaluationError` (`manifest-malformed`) on structurally invalid
 * input.
 */
export function measureTemporalArtifacts(manifest: AnimeClipManifest): TemporalArtifactMetrics {
  validateManifest(manifest);
  const frames = manifest.frames;
  const anomalies: TemporalAnomaly[] = [];
  const counters: Counters = {
    windowOverlap: 0,
    invertedWindow: 0,
    windowTimestampMismatch: 0,
    captionDuplicate: 0,
    captionUnapplied: 0,
    appliedDuplicate: 0,
    appliedUnsorted: 0,
    appliedGap: 0,
    appliedUnaccounted: 0,
    watermarkSequenceRegression: 0,
    watermarkTimeRegression: 0,
    watermarkBelowEvents: 0,
    dispositionFlap: 0,
    dispositionTransition: 0,
    kindChange: 0,
    possessionDisplayMismatch: 0,
  };

  // --- Window + watermark + caption-accounting walk (frame order) --------
  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i]!;
    const window = frame.windowMs;

    if (window.startMs >= window.endMs) {
      counters.invertedWindow += 1;
      anomalies.push({
        kind: "inverted-window",
        frameIndex: i,
        detail: `windowMs [${window.startMs}, ${window.endMs}) has startMs >= endMs`,
      });
    }
    if (i > 0) {
      const previous = frames[i - 1]!;
      if (previous.windowMs.endMs > window.startMs) {
        counters.windowOverlap += 1;
        anomalies.push({
          kind: "window-overlap",
          frameIndex: i,
          detail: `frame ${i - 1} window ends at ${previous.windowMs.endMs} after frame ${i} window starts at ${window.startMs}`,
        });
      }
    }
    if (window.startMs !== frame.outputTimestampMs) {
      counters.windowTimestampMismatch += 1;
      anomalies.push({
        kind: "window-timestamp-mismatch",
        frameIndex: i,
        detail: `windowMs.startMs ${window.startMs} does not match outputTimestampMs ${frame.outputTimestampMs}`,
      });
    }

    if (i > 0) {
      const previous = frames[i - 1]!;
      if (frame.source.watermark.sequence < previous.source.watermark.sequence) {
        counters.watermarkSequenceRegression += 1;
        anomalies.push({
          kind: "watermark-sequence-regression",
          frameIndex: i,
          detail: `source watermark sequence ${frame.source.watermark.sequence} < previous frame's ${previous.source.watermark.sequence}`,
        });
      }
      if (frame.source.watermark.watermarkMs < previous.source.watermark.watermarkMs) {
        counters.watermarkTimeRegression += 1;
        anomalies.push({
          kind: "watermark-time-regression",
          frameIndex: i,
          detail: `source watermarkMs ${frame.source.watermark.watermarkMs} < previous frame's ${previous.source.watermark.watermarkMs}`,
        });
      }
    }

    // Caption accounting: every displayed or accounted event must be applied.
    const appliedThisFrame = new Set(frame.appliedEventSequences);
    for (const event of frame.captions.events) {
      if (!appliedThisFrame.has(event.sequence)) {
        counters.captionUnapplied += 1;
        anomalies.push({
          kind: "caption-unapplied",
          frameIndex: i,
          detail: `captioned event ${event.eventId} (sequence ${event.sequence}) is not in the frame's appliedEventSequences`,
        });
      }
    }
    for (const event of frame.captions.uncaptionedEvents) {
      if (!appliedThisFrame.has(event.sequence)) {
        counters.captionUnapplied += 1;
        anomalies.push({
          kind: "caption-unapplied",
          frameIndex: i,
          detail: `uncaptioned event ${event.eventId} (sequence ${event.sequence}) is not in the frame's appliedEventSequences`,
        });
      }
    }
    // Every applied event must be accounted in the captions (one of the lists).
    const accountedSequences = new Set<number>();
    for (const event of frame.captions.events) accountedSequences.add(event.sequence);
    for (const event of frame.captions.uncaptionedEvents) accountedSequences.add(event.sequence);
    for (const sequence of frame.appliedEventSequences) {
      if (!accountedSequences.has(sequence)) {
        counters.appliedUnaccounted += 1;
        anomalies.push({
          kind: "applied-unaccounted",
          frameIndex: i,
          detail: `applied sequence ${sequence} is in neither captions.events nor captions.uncaptionedEvents`,
        });
      }
    }
    // Applied sequences strictly ascending within the frame.
    for (let s = 1; s < frame.appliedEventSequences.length; s += 1) {
      if (frame.appliedEventSequences[s]! <= frame.appliedEventSequences[s - 1]!) {
        counters.appliedUnsorted += 1;
        anomalies.push({
          kind: "applied-unsorted",
          frameIndex: i,
          detail: `appliedEventSequences are not strictly ascending: ${frame.appliedEventSequences[s]} <= ${frame.appliedEventSequences[s - 1]}`,
        });
      }
    }

    // Possession display consistency: a displayed ring needs a drawn entity.
    const possession = frame.possession;
    if (possession !== null && possession.displayed) {
      const target = possession.entityId;
      const drawn =
        target !== undefined &&
        frame.entities.some(
          (entity) => entity.entityId === target && isDrawnDisposition(entity.disposition),
        );
      if (!drawn) {
        counters.possessionDisplayMismatch += 1;
        anomalies.push({
          kind: "possession-display-mismatch",
          frameIndex: i,
          detail: `possession.displayed is true but entity ${target ?? "<none>"} is not drawn in this frame`,
        });
      }
    }
  }

  // --- Cross-frame attribution: duplicates + interior gaps ----------------
  const appliedOccurrences = new Map<number, number>();
  const captionedOccurrences = new Map<number, number>();
  for (const frame of frames) {
    for (const sequence of frame.appliedEventSequences) {
      appliedOccurrences.set(sequence, (appliedOccurrences.get(sequence) ?? 0) + 1);
    }
    for (const event of frame.captions.events) {
      captionedOccurrences.set(event.sequence, (captionedOccurrences.get(event.sequence) ?? 0) + 1);
    }
  }
  for (const [sequence, occurrences] of appliedOccurrences) {
    if (occurrences > 1) {
      counters.appliedDuplicate += 1;
      anomalies.push({
        kind: "applied-duplicate",
        frameIndex: frames.findIndex((frame) => frame.appliedEventSequences.includes(sequence)),
        detail: `applied sequence ${sequence} occurs ${occurrences} times across the clip`,
      });
    }
  }
  for (const [sequence, occurrences] of captionedOccurrences) {
    if (occurrences > 1) {
      counters.captionDuplicate += 1;
      anomalies.push({
        kind: "caption-duplicate",
        frameIndex: frames.findIndex((frame) =>
          frame.captions.events.some((event) => event.sequence === sequence),
        ),
        detail: `captioned sequence ${sequence} occurs ${occurrences} times across the clip`,
      });
    }
  }
  const skippedSequences = new Set(manifest.skippedEvents.map((event) => event.sequence));
  if (appliedOccurrences.size > 0) {
    const sequences = [...appliedOccurrences.keys()];
    let min = sequences[0]!;
    let max = sequences[0]!;
    for (const sequence of sequences) {
      if (sequence < min) min = sequence;
      if (sequence > max) max = sequence;
    }
    let maxEventSequence = max;
    for (const sequence of skippedSequences) {
      if (sequence > maxEventSequence) maxEventSequence = sequence;
    }
    for (let sequence = min + 1; sequence < max; sequence += 1) {
      if (!appliedOccurrences.has(sequence) && !skippedSequences.has(sequence)) {
        counters.appliedGap += 1;
        anomalies.push({
          kind: "applied-gap",
          frameIndex: null,
          detail: `event sequence ${sequence} is strictly between applied sequences ${min} and ${max} but is neither applied nor accounted in skippedEvents`,
        });
      }
    }
    if (manifest.watermarkAfter.sequence < maxEventSequence) {
      counters.watermarkBelowEvents += 1;
      anomalies.push({
        kind: "watermark-below-events",
        frameIndex: frames.length - 1,
        detail: `watermarkAfter.sequence ${manifest.watermarkAfter.sequence} < highest applied-or-skipped event sequence ${maxEventSequence}`,
      });
    }
  }

  // --- Disposition transitions + flapping + kind changes ------------------
  const order: string[] = [];
  const dispositionsById = new Map<
    string,
    Array<{ frameIndex: number; disposition: AnimeEntityDisposition; kind: string }>
  >();
  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i]!;
    for (const entity of frame.entities) {
      let series = dispositionsById.get(entity.entityId);
      if (series === undefined) {
        series = [];
        dispositionsById.set(entity.entityId, series);
        order.push(entity.entityId);
      }
      series.push({ frameIndex: i, disposition: entity.disposition, kind: entity.kind });
    }
  }
  for (const entityId of order) {
    const series = dispositionsById.get(entityId)!;
    const drawn = series.map((entry) => isDrawnDisposition(entry.disposition));

    // Transitions between RECORDED consecutive frames (absence is the
    // identity metric's defect, never reused here).
    for (let i = 1; i < series.length; i += 1) {
      if (series[i]!.frameIndex === series[i - 1]!.frameIndex + 1 && drawn[i] !== drawn[i - 1]) {
        counters.dispositionTransition += 1;
      }
    }
    // Immediate flapping: drawn, omitted, drawn on three consecutive frames.
    for (let i = 2; i < series.length; i += 1) {
      const consecutive =
        series[i]!.frameIndex === series[i - 1]!.frameIndex + 1 &&
        series[i - 1]!.frameIndex === series[i - 2]!.frameIndex + 1;
      if (consecutive && drawn[i] && !drawn[i - 1] && drawn[i - 2]) {
        counters.dispositionFlap += 1;
        anomalies.push({
          kind: "disposition-flap",
          frameIndex: series[i - 1]!.frameIndex,
          entityId,
          detail: `entity ${entityId} drawn at frame ${series[i - 2]!.frameIndex}, ${series[i - 1]!.disposition} at frame ${series[i - 1]!.frameIndex}, drawn again at frame ${series[i]!.frameIndex}`,
        });
      }
    }
    // Kind changes across frames.
    const kinds = new Set(series.map((entry) => entry.kind));
    if (kinds.size > 1) {
      counters.kindChange += 1;
      anomalies.push({
        kind: "kind-change",
        frameIndex: series[series.length - 1]!.frameIndex,
        entityId,
        detail: `entity ${entityId} recorded with kinds ${[...kinds].join(", ")}`,
      });
    }
  }

  return {
    frameCount: frames.length,
    windowOverlapCount: counters.windowOverlap,
    invertedWindowCount: counters.invertedWindow,
    windowTimestampMismatchCount: counters.windowTimestampMismatch,
    captionDuplicateCount: counters.captionDuplicate,
    captionUnappliedCount: counters.captionUnapplied,
    appliedDuplicateCount: counters.appliedDuplicate,
    appliedUnsortedCount: counters.appliedUnsorted,
    appliedGapCount: counters.appliedGap,
    appliedUnaccountedCount: counters.appliedUnaccounted,
    watermarkSequenceRegressionCount: counters.watermarkSequenceRegression,
    watermarkTimeRegressionCount: counters.watermarkTimeRegression,
    watermarkBelowEventsCount: counters.watermarkBelowEvents,
    dispositionFlapCount: counters.dispositionFlap,
    dispositionTransitionCount: counters.dispositionTransition,
    kindChangeCount: counters.kindChange,
    possessionDisplayMismatchCount: counters.possessionDisplayMismatch,
    anomalies,
  };
}
