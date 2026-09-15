/**
 * The EVENT ORDERING dimension (W605 deliverable 4): markers preserve
 * source order, and replay segments re-present in order with accounted
 * boundaries.
 *
 * Ground truths, both real documents:
 *
 * - the SWM's event stream (`input.eventStream` — the engine's log, in log
 *   order): every marker's verbatim fields (event id, type ref, event time)
 *   are checked against the stream entry of its sequence — a marker whose
 *   sequence does not exist, or whose fields drift, is a mismatch (never
 *   invented data);
 * - the RENDER'S OWN INPUT (`input.steps`): each step's scene carries its
 *   event-window markers in log order (checked), and the renderer's
 *   documented marker-union construction — the union of the run's steps'
 *   scene markers, deduplicated by sequence, first occurrence — is
 *   re-derived per window as the expected accounting base.
 *
 * Per window (the whole match in match mode; each directed window in
 * directed mode — every window is one `render3dMatch` run), the accounting
 * is TOTAL: each sequence of the window's expected union is exactly one of
 *
 * 1. DISPLAYED in exactly one of the window's kept frames (at its timeline
 *    position — the containment rule);
 * 2. SKIPPED for that window (the manifest's `skippedMarkers` accounting,
 *    with the correct before/after reason);
 * 3. BOUNDARY-TRANSFERRED — a live non-last window's observed tail frame
 *    (covering `[source.endMs, source.endMs + interval)`) is dropped by the
 *    W604 composition (the cut takes effect at the boundary), carrying its
 *    markers to the window that starts there; a transferred sequence MUST
 *    be re-presented by a later window or it is UNACCOUNTED;
 * 4. UNACCOUNTED — never silent.
 *
 * Reviews re-present existing match time: a sequence displayed in a review
 * window that no LIVE window ever displayed is NOVEL (invented
 * presentation), and the same sequence displayed in two LIVE windows is an
 * unsanctioned duplicate.
 */
import { MAX_EVENT_CHIPS, eventChipText } from "@sporta/renderer-3d";
import type { Render3dMarkerEntry } from "@sporta/renderer-3d";
import type { DirectedRenderManifest } from "@sporta/camera-director";
import type { WorldEventStreamEntry } from "@sporta/contracts";
import type { EvalFrame, ValidatedSceneEvaluationInput } from "./validate";
import type { FindingSink } from "./findings";
import { frameFinding } from "./findings";
import { describeValue } from "./internal";

/** The event-ordering dimension's measured metrics. */
export interface OrderingMetrics {
  /** Steps whose scene's marker sequences are not strictly ascending (log order). */
  stepMarkerLogOrderViolationCount: number;
  /** Frames whose displayed markers are not in the source (union) order. */
  frameMarkerOrderViolationCount: number;
  /** Displayed markers whose verbatim fields drift from the SWM stream entry (or are not in it). */
  markerFieldMismatchCount: number;
  /** Displayed markers whose event time is outside their frame's match-timeline window. */
  markerWindowContainmentViolationCount: number;
  /** Sequences displayed more than once within one window. */
  markerDuplicateDisplayCount: number;
  /** Sequences displayed in more than one LIVE window (unsanctioned re-presentation). */
  markerCrossWindowDuplicateCount: number;
  /** Expected-union sequences neither displayed, skipped, nor boundary-transferred (per window). */
  markerUnaccountedCount: number;
  /** Boundary-transferred sequences never re-presented by a later window. */
  boundaryTransferUnaccountedCount: number;
  /** Review-displayed sequences no live window ever displayed (novel presentation). */
  reviewNovelMarkerCount: number;
  /** Displayed sequences not in the owning window's expected union (invented display). */
  markerNotInUnionDisplayCount: number;
  /** Frames whose displayed/chips/notDisplayed/applied accounting drifts from the derivation. */
  markerDisplayAccountingMismatchCount: number;
  /** Skipped-marker entries whose sequence is not in the window's union or whose reason is wrong. */
  markerSkipAccountingMismatchCount: number;
  /** The marker union size over the whole match timeline (evidence). */
  markerCount: number;
}

/** One evaluated window (a run of the renderer over a step range). */
interface OrderingWindow {
  /** The rundown label for findings (the window index, or `"match"`). */
  label: string;
  /** The window's step run (the steps whose atMs lie in the closed source range). */
  runSteps: readonly ValidatedSceneEvaluationInput["steps"][number][];
  /** The window's kept frames, rundown order. */
  frames: readonly EvalFrame[];
  /** The source range (closed, match timeline). */
  source: { startMs: number; endMs: number };
  /** Whether the run's observed tail frame was kept (reviews + the last live window). */
  tailKept: boolean;
  /** The kind (reviews are sanctioned re-presentations). */
  kind: "live" | "review" | "match";
  /** The run's skipped-marker accounting (verbatim from the manifest). */
  skipped: readonly { sequence: number; eventTimeMs: number; reason: string }[];
}

/** Builds the per-window views (match mode = one window over everything). */
function orderingWindows(input: ValidatedSceneEvaluationInput): OrderingWindow[] {
  if (input.mode === "match") {
    const manifest = input.manifest as Exclude<typeof input.manifest, DirectedRenderManifest>;
    const last = input.steps[input.steps.length - 1]!;
    return [
      {
        label: "match",
        runSteps: input.steps,
        frames: input.frames,
        source: { startMs: input.steps[0]!.atMs, endMs: last.atMs },
        tailKept: true,
        kind: "match",
        skipped: manifest.skippedMarkers.map((entry) => ({
          sequence: entry.sequence,
          eventTimeMs: entry.eventTimeMs,
          reason: entry.reason,
        })),
      },
    ];
  }
  const manifest = input.manifest as DirectedRenderManifest;
  const windows: OrderingWindow[] = [];
  const lastLiveIndex = (() => {
    let last = -1;
    for (const window of manifest.windows) {
      if (window.kind === "live") last = window.index;
    }
    return last;
  })();
  for (const window of manifest.windows) {
    const runSteps = input.steps.filter(
      (step) => step.atMs >= window.source.startMs && step.atMs <= window.source.endMs,
    );
    windows.push({
      label: `window ${window.index}`,
      runSteps,
      frames: input.frames.filter((frame) => frame.windowIndex === window.index),
      source: { startMs: window.source.startMs, endMs: window.source.endMs },
      tailKept: window.kind === "review" || window.index === lastLiveIndex,
      kind: window.kind,
      skipped: manifest.skippedMarkers
        .filter((entry) => entry.windowIndex === window.index)
        .map((entry) => ({
          sequence: entry.sequence,
          eventTimeMs: entry.eventTimeMs,
          reason: entry.reason,
        })),
    });
  }
  return windows;
}

/** The marker-union document of one window's step run (the renderer's own construction). */
function windowMarkerUnion(window: OrderingWindow): {
  /** The union, first-occurrence order (the source order). */
  union: { sequence: number; eventId: string; eventTypeRef: string; eventTimeMs: number }[];
  /** The position of each sequence in the union order. */
  positionBySequence: Map<number, number>;
} {
  const union: { sequence: number; eventId: string; eventTypeRef: string; eventTimeMs: number }[] =
    [];
  const positionBySequence = new Map<number, number>();
  for (const step of window.runSteps) {
    for (const marker of step.scene.eventMarkers) {
      if (positionBySequence.has(marker.sequence)) continue;
      positionBySequence.set(marker.sequence, union.length);
      union.push({
        sequence: marker.sequence,
        eventId: marker.event.eventId,
        eventTypeRef: marker.event.eventTypeRef,
        eventTimeMs: marker.event.eventTimeMs,
      });
    }
  }
  return { union, positionBySequence };
}

/**
 * Measures the event-ordering dimension over the whole rundown. Pure; every
 * violation is a counted finding with its window/frame/sequence coordinates.
 */
export function measureOrdering(options: {
  input: ValidatedSceneEvaluationInput;
  findings: FindingSink;
}): OrderingMetrics {
  const { input, findings } = options;
  const streamBySequence = new Map<number, WorldEventStreamEntry>();
  for (const entry of input.eventStream) {
    streamBySequence.set(entry.sequence, entry);
  }

  let stepMarkerLogOrderViolationCount = 0;
  let frameMarkerOrderViolationCount = 0;
  let markerFieldMismatchCount = 0;
  let markerWindowContainmentViolationCount = 0;
  let markerDuplicateDisplayCount = 0;
  let markerCrossWindowDuplicateCount = 0;
  let markerUnaccountedCount = 0;
  let boundaryTransferUnaccountedCount = 0;
  let reviewNovelMarkerCount = 0;
  let markerNotInUnionDisplayCount = 0;
  let markerDisplayAccountingMismatchCount = 0;
  let markerSkipAccountingMismatchCount = 0;

  // (1) The steps' marker windows preserve the log order (ascending
  // sequences within each step's scene — the engine's log order).
  for (let s = 0; s < input.steps.length; s += 1) {
    const markers = input.steps[s]!.scene.eventMarkers;
    for (let m = 1; m < markers.length; m += 1) {
      if (markers[m]!.sequence <= markers[m - 1]!.sequence) {
        stepMarkerLogOrderViolationCount += 1;
        findings.push({
          dimension: "ordering",
          metric: "ordering.stepMarkerLogOrderViolationCount",
          stepIndex: s,
          path: `$.steps[${s}].scene.eventMarkers[${m}].sequence`,
          expected: describeValue(`> ${markers[m - 1]!.sequence}`),
          actual: describeValue(markers[m]!.sequence),
        });
      }
    }
  }

  const windows = orderingWindows(input);
  const globalUnionSequences = new Set<number>();
  for (const step of input.steps) {
    for (const marker of step.scene.eventMarkers) {
      globalUnionSequences.add(marker.sequence);
    }
  }

  for (const window of windows) {
    const { union, positionBySequence } = windowMarkerUnion(window);
    const interval = window.frames[0]?.frameIntervalMs ?? 0;
    const runEndMs = window.source.endMs;

    // The expected accounting base, per sequence.
    const displayedInWindow = new Map<number, number>();
    for (const frame of window.frames) {
      const markers = frame.entry.markers;
      let previousPosition = -1;
      const displayedIndexes: number[] = [];
      for (let m = 0; m < markers.length; m += 1) {
        const marker = markers[m]!;
        displayedInWindow.set(marker.sequence, (displayedInWindow.get(marker.sequence) ?? 0) + 1);
        if (marker.displayed) displayedIndexes.push(m);

        // (2) Source order within the frame (ascending union positions).
        const position = positionBySequence.get(marker.sequence);
        if (position === undefined || position <= previousPosition) {
          frameMarkerOrderViolationCount += 1;
          findings.push(
            frameFinding(frame, {
              dimension: "ordering",
              metric: "ordering.frameMarkerOrderViolationCount",
              path: `$.output.manifest.frames[${frame.frameIndex}].entry.markers[${m}]`,
              expected: describeValue(
                position === undefined
                  ? `a sequence of ${window.label}'s marker union`
                  : `union position > ${previousPosition}`,
              ),
              actual: describeValue(marker.sequence),
            }),
          );
        }
        if (position !== undefined) previousPosition = position;

        // (3) Verbatim fields vs the SWM's own log entry.
        const streamEntry = streamBySequence.get(marker.sequence);
        const expectedFields = streamEntry?.event;
        const textExpected = eventChipText(marker.eventTypeRef);
        if (
          expectedFields === undefined ||
          expectedFields.eventId !== marker.eventId ||
          expectedFields.eventTypeRef !== marker.eventTypeRef ||
          expectedFields.eventTimeMs !== marker.eventTimeMs ||
          textExpected !== marker.text
        ) {
          markerFieldMismatchCount += 1;
          findings.push(
            frameFinding(frame, {
              dimension: "ordering",
              metric: "ordering.markerFieldMismatchCount",
              path: `$.output.manifest.frames[${frame.frameIndex}].entry.markers[${m}]`,
              expected: describeValue(
                expectedFields === undefined
                  ? { sequence: marker.sequence, note: "no such sequence in the event stream" }
                  : {
                      eventId: expectedFields.eventId,
                      eventTypeRef: expectedFields.eventTypeRef,
                      eventTimeMs: expectedFields.eventTimeMs,
                      text: textExpected,
                    },
              ),
              actual: describeValue({
                eventId: marker.eventId,
                eventTypeRef: marker.eventTypeRef,
                eventTimeMs: marker.eventTimeMs,
                text: marker.text,
              }),
            }),
          );
        }

        // (4) Timeline containment: the marker lands in the frame whose
        // match-timeline window contains its event time.
        if (
          marker.eventTimeMs < frame.entry.windowMs.startMs ||
          marker.eventTimeMs >= frame.entry.windowMs.endMs
        ) {
          markerWindowContainmentViolationCount += 1;
          findings.push(
            frameFinding(frame, {
              dimension: "ordering",
              metric: "ordering.markerWindowContainmentViolationCount",
              path: `$.output.manifest.frames[${frame.frameIndex}].entry.markers[${m}].eventTimeMs`,
              expected: describeValue(frame.entry.windowMs),
              actual: describeValue(marker.eventTimeMs),
            }),
          );
        }
      }

      // (11) The frame's marker display accounting (the chip cap
      // derivation): the first MAX_EVENT_CHIPS markers displayed, chips =
      // their texts, notDisplayed = the rest, applied = the sequences.
      const expectedDisplayed = markers.map((marker, index) => index < MAX_EVENT_CHIPS);
      const displayAccountingDrift =
        markers.some((marker, index) => marker.displayed !== expectedDisplayed[index]) ||
        frame.entry.hud.eventChips.length !== Math.min(markers.length, MAX_EVENT_CHIPS) ||
        frame.entry.hud.markersNotDisplayed !== Math.max(0, markers.length - MAX_EVENT_CHIPS) ||
        frame.entry.appliedMarkerSequences.length !== markers.length ||
        frame.entry.appliedMarkerSequences.some(
          (sequence, index) => sequence !== markers[index]?.sequence,
        ) ||
        frame.entry.hud.eventChips.some(
          (chip, index) => chip !== markers[index]?.text || markers[index]?.displayed !== true,
        );
      if (displayAccountingDrift) {
        markerDisplayAccountingMismatchCount += 1;
        findings.push(
          frameFinding(frame, {
            dimension: "ordering",
            metric: "ordering.markerDisplayAccountingMismatchCount",
            path: `$.output.manifest.frames[${frame.frameIndex}].entry`,
            expected: describeValue({
              applied: markers.map((marker) => marker.sequence),
              displayed: expectedDisplayed,
              chips: markers.slice(0, MAX_EVENT_CHIPS).map((marker) => marker.text),
              notDisplayed: Math.max(0, markers.length - MAX_EVENT_CHIPS),
            }),
            actual: describeValue({
              applied: frame.entry.appliedMarkerSequences,
              displayed: markers.map((marker) => marker.displayed),
              chips: frame.entry.hud.eventChips,
              notDisplayed: frame.entry.hud.markersNotDisplayed,
            }),
          }),
        );
      }
    }

    // (5) Within-window duplicate display.
    for (const [sequence, count] of displayedInWindow) {
      if (count > 1) {
        markerDuplicateDisplayCount += 1;
        findings.push({
          dimension: "ordering",
          metric: "ordering.markerDuplicateDisplayCount",
          path: `$.output.manifest (window ${window.label})`,
          expected: describeValue({ sequence, displays: 1 }),
          actual: describeValue({ sequence, displays: count }),
        });
      }
    }

    // (13) Displayed sequences not in this window's expected union.
    for (const [sequence] of displayedInWindow) {
      if (!positionBySequence.has(sequence)) {
        markerNotInUnionDisplayCount += 1;
        findings.push({
          dimension: "ordering",
          metric: "ordering.markerNotInUnionDisplayCount",
          path: `$.output.manifest (window ${window.label})`,
          expected: describeValue({ sequence, note: "carried by the window's steps" }),
          actual: describeValue({ sequence, note: "not in the window's marker union" }),
        });
      }
    }

    // (12) The skipped-marker accounting: every entry's sequence must be in
    // the window's union, with the correct before/after reason.
    for (const skipped of window.skipped) {
      const expectedReason =
        skipped.eventTimeMs < window.source.startMs
          ? "before-window"
          : skipped.eventTimeMs >= runEndMs + interval
            ? "after-window"
            : "in-window";
      if (!positionBySequence.has(skipped.sequence) || expectedReason === "in-window" || skipped.reason !== expectedReason) {
        markerSkipAccountingMismatchCount += 1;
        findings.push({
          dimension: "ordering",
          metric: "ordering.markerSkipAccountingMismatchCount",
          path: `$.output.manifest.skippedMarkers (window ${window.label})`,
          expected: describeValue({
            sequence: skipped.sequence,
            reason: expectedReason,
            inUnion: positionBySequence.has(skipped.sequence),
          }),
          actual: describeValue(skipped),
        });
      }
    }

    // (7) + (8) The total per-window accounting.
    const boundaryTransferStart = window.tailKept ? Infinity : runEndMs;
    for (const marker of union) {
      const displays = displayedInWindow.get(marker.sequence) ?? 0;
      if (displays > 0) continue;
      const skippedHere = window.skipped.some((entry) => entry.sequence === marker.sequence);
      if (skippedHere) continue;
      if (marker.eventTimeMs >= boundaryTransferStart && marker.eventTimeMs < runEndMs + interval) {
        // Boundary transfer: the dropped tail frame's marker — it must be
        // re-presented by a LATER window (checked after all windows).
        continue;
      }
      markerUnaccountedCount += 1;
      findings.push({
        dimension: "ordering",
        metric: "ordering.markerUnaccountedCount",
        path: `$.output.manifest (window ${window.label})`,
        expected: describeValue({ sequence: marker.sequence, accounting: "displayed|skipped|transferred" }),
        actual: describeValue({ sequence: marker.sequence, accounting: "none" }),
      });
    }
  }

  // The boundary-transfer debt and the live/review cross-window checks.
  for (let w = 0; w < windows.length; w += 1) {
    const window = windows[w]!;
    const { union } = windowMarkerUnion(window);
    if (window.tailKept) continue;
    const runEndMs = window.source.endMs;
    const interval = window.frames[0]?.frameIntervalMs ?? 0;
    for (const marker of union) {
      if (marker.eventTimeMs < runEndMs || marker.eventTimeMs >= runEndMs + interval) continue;
      // A transferred marker: displayed by any LATER window?
      const rePresented = windows
        .slice(w + 1)
        .some((later) =>
          later.frames.some((frame) =>
            frame.entry.markers.some((m) => m.sequence === marker.sequence),
          ),
        );
      if (!rePresented) {
        boundaryTransferUnaccountedCount += 1;
        findings.push({
          dimension: "ordering",
          metric: "ordering.boundaryTransferUnaccountedCount",
          path: `$.output.manifest (window ${window.label})`,
          expected: describeValue({ sequence: marker.sequence, rePresentedBy: "a later window" }),
          actual: describeValue({ sequence: marker.sequence, rePresentedBy: null }),
        });
      }
    }
  }
  for (const window of windows) {
    for (const frame of window.frames) {
      for (const marker of frame.entry.markers as Render3dMarkerEntry[]) {
        if (window.kind === "live" || window.kind === "match") {
          const set = liveDisplayBySequence.get(marker.sequence) ?? new Set<number>();
          set.add(window.kind === "match" ? 0 : Number(window.label.slice("window ".length)));
          liveDisplayBySequence.set(marker.sequence, set);
        }
      }
    }
  }

  // (6) The same sequence in two LIVE windows is an unsanctioned
  // re-presentation (reviews are the sanctioned one).
  for (const [sequence, windowIds] of liveDisplayBySequence) {
    if (windowIds.size > 1) {
      markerCrossWindowDuplicateCount += 1;
      findings.push({
        dimension: "ordering",
        metric: "ordering.markerCrossWindowDuplicateCount",
        path: `$.output.manifest`,
        expected: describeValue({ sequence, liveWindows: 1 }),
        actual: describeValue({ sequence, liveWindows: windowIds.size }),
      });
    }
  }

  // (9) A review displaying a sequence no live window showed is novel.
  for (const window of windows) {
    if (window.kind !== "review") continue;
    for (const frame of window.frames) {
      for (const marker of frame.entry.markers) {
        if (liveDisplayBySequence.has(marker.sequence)) continue;
        reviewNovelMarkerCount += 1;
        findings.push(
          frameFinding(frame, {
            dimension: "ordering",
            metric: "ordering.reviewNovelMarkerCount",
            path: `$.output.manifest.frames[${frame.frameIndex}].entry.markers`,
            expected: describeValue({ sequence: marker.sequence, shownLive: true }),
            actual: describeValue({ sequence: marker.sequence, shownLive: false }),
          }),
        );
      }
    }
  }

  return {
    stepMarkerLogOrderViolationCount,
    frameMarkerOrderViolationCount,
    markerFieldMismatchCount,
    markerWindowContainmentViolationCount,
    markerDuplicateDisplayCount,
    markerCrossWindowDuplicateCount,
    markerUnaccountedCount,
    boundaryTransferUnaccountedCount,
    reviewNovelMarkerCount,
    markerNotInUnionDisplayCount,
    markerDisplayAccountingMismatchCount,
    markerSkipAccountingMismatchCount,
    markerCount: globalUnionSequences.size,
  };
}
