/**
 * THE LIVE TELEMETRY CORE (L006) — the frozen `docs/contracts/live-reality.md`
 * §9 "Minimum operational telemetry" counters, implemented as a PURE
 * collector over the pipeline's REAL stage seams.
 *
 * THE §9 TRUTH (verbatim, frozen): source-to-ingest latency;
 * ingest-to-SWM latency; SWM-to-render latency; end-to-end presentation
 * latency; watermark lag; dropped observations; extrapolated observations;
 * identity switches; reconnects; renderer frame drops; effective update
 * rate. These names are the vocabulary — a gap in what a stage can measure
 * is a contract-change request, never a patch-around (and never a
 * fabricated number standing in for a measurement).
 *
 * HONEST ACCOUNTING (the L006 acceptance):
 * - every LATENCY is a real-clock span between two SEAM STAMPS the caller
 *   provides (the injectable `nowMs` — the repo convention; no wall clock,
 *   no env, no I/O in this module). Nothing is interpolated: a stage that
 *   was never entered has a `count` of 0 and `null` statistics — never 0ms;
 * - every COUNTER is a counted fact from the observation/frame stream:
 *   dropped observations are VISIBLE sequence gaps (never renumbered),
 *   reconnects are the observation's own `recovery` accounting,
 *   extrapolated observations are the undetected-entity carries the source
 *   honestly marks, identity switches are observed track-id rebindings,
 *   frame drops are the transport's counted drop-oldest losses;
 * - the WATERMARK LAG is the observation's own dual-clock data
 *   (`eventTimeMs - watermark.watermarkMs`) — the frozen temporal rule's
 *   lag exposure, never a fabricated "current" guess;
 * - the EFFECTIVE UPDATE RATE is delivered frames over the real-clock span
 *   between the first and last delivery — honest for bursty and gapped
 *   streams alike.
 *
 * THE PIPELINE SEAMS (where the stamps come from — the L006 plumbing):
 *
 * ```
 * L002 source ──(pulledAtMs→ingestedAtMs)── the INGEST seam
 *             ──(ingestedAtMs→swmAtMs)────── the SWM-stage port
 *             ──(swmAtMs→renderedAtMs)────── the render stage
 *             ──(renderedAtMs→presentedAtMs)─ the transport delivery
 * ```
 *
 * Worker A's L003/L004 engine (this wave, parallel lane) plugs in at the
 * SWM-stage port through the FROZEN contract shapes (`LiveObservation` in,
 * world-state out) — `noteWorldStateUpdated` is the seam it reports
 * through; no shared files, no provider shapes.
 */
import type { LiveObservation } from "./observation";

// ---------------------------------------------------------------------------
// The closed §9 vocabulary (DATA — the frozen contract's own names)
// ---------------------------------------------------------------------------

/**
 * The §9 counter ids, verbatim from the frozen contract's list. Every
 * snapshot member below is keyed by these names — operators read the
 * contract's vocabulary, never an invented one.
 */
export const LIVE_TELEMETRY_COUNTER_IDS = [
  "source-to-ingest-latency",
  "ingest-to-swm-latency",
  "swm-to-render-latency",
  "end-to-end-presentation-latency",
  "watermark-lag",
  "dropped-observations",
  "extrapolated-observations",
  "identity-switches",
  "reconnects",
  "renderer-frame-drops",
  "effective-update-rate",
] as const;
export type LiveTelemetryCounterId = (typeof LIVE_TELEMETRY_COUNTER_IDS)[number];

// ---------------------------------------------------------------------------
// The stage latency statistics (exact, deterministic)
// ---------------------------------------------------------------------------

/** One stage's measured latency statistics (real-clock spans only). */
export interface LiveStageLatencyStats {
  /** How many real spans were measured (0 = the stage never ran). */
  count: number;
  /** The sum of every measured span (ms) — exact accumulation. */
  sumMs: number;
  /** The smallest measured span (null before the first). */
  minMs: number | null;
  /** The largest measured span (null before the first). */
  maxMs: number | null;
  /** The most recently measured span (null before the first). */
  lastMs: number | null;
}

/** The empty stage statistics (a stage that never ran — never a fake 0). */
function emptyStats(): LiveStageLatencyStats {
  return { count: 0, sumMs: 0, minMs: null, maxMs: null, lastMs: null };
}

function noteSpan(stats: LiveStageLatencyStats, spanMs: number): void {
  stats.count += 1;
  stats.sumMs += spanMs;
  stats.minMs = stats.minMs === null ? spanMs : Math.min(stats.minMs, spanMs);
  stats.maxMs = stats.maxMs === null ? spanMs : Math.max(stats.maxMs, spanMs);
  stats.lastMs = spanMs;
}

// ---------------------------------------------------------------------------
// The §9 snapshot (the operator-facing record — renderer-consumable too)
// ---------------------------------------------------------------------------

/** The honest measurement note for one latency stage. */
export interface LiveLatencyStageView {
  /** The §9 counter id this stage reports (verbatim). */
  counterId: LiveTelemetryCounterId;
  /** What this span measures on THIS pipeline (honest labeling). */
  measurement: string;
  /** The measured statistics (count 0 = never entered — never a fake 0). */
  stats: LiveStageLatencyStats;
}

/**
 * The §9 telemetry snapshot for one live session — every frozen counter,
 * each either measured (real spans) or counted (facts from the stream), or
 * honestly absent (the stage never ran).
 */
export interface LiveTelemetrySnapshot {
  /** The session this snapshot accounts (the collector's own key). */
  sessionId: string;
  /** The source id the observations ride (the stream's own identity). */
  sourceId: string | null;
  /** The §9 latency stages, in pipeline order. */
  latencies: {
    sourceToIngest: LiveLatencyStageView;
    ingestToSwm: LiveLatencyStageView;
    swmToRender: LiveLatencyStageView;
    endToEndPresentation: LiveLatencyStageView;
  };
  /** The watermark lag (the observation's own dual-clock data), last/max. */
  watermarkLag: {
    counterId: "watermark-lag";
    /** The most recent observation's eventTime − watermarkMs (ms). */
    lastMs: number | null;
    /** The largest lag observed so far (null before the first). */
    maxMs: number | null;
    /** How many observations carried a positive lag. */
    observationsWithLag: number;
  };
  /** Observations whose sequence gap is a VISIBLE drop (counted, never smoothed). */
  droppedObservations: {
    counterId: "dropped-observations";
    count: number;
    /** The counted gap windows (from-sequence → to-sequence), capped. */
    gaps: { fromSequence: number; toSequence: number; missed: number }[];
  };
  /** Observations that carried extrapolated (undetected) entity carries. */
  extrapolatedObservations: {
    counterId: "extrapolated-observations";
    /** Observations with at least one undetected-entity carry. */
    observations: number;
    /** The total undetected entity rows carried (the honest carry count). */
    entityRows: number;
  };
  /** Observed identity switches (a track-id rebinding onto another entityRef). */
  identitySwitches: { counterId: "identity-switches"; count: number };
  /** The reconnect windows the observations accounted (their own recovery member). */
  reconnects: {
    counterId: "reconnects";
    count: number;
    /** The accounted missed-update totals (summed from the recovery members). */
    missedUpdates: number;
  };
  /** The renderer/transport frame drops (the counted drop-oldest losses). */
  frameDrops: { counterId: "renderer-frame-drops"; count: number };
  /** The effective update rate over the real delivery span. */
  effectiveUpdateRate: {
    counterId: "effective-update-rate";
    /** Delivered frames ÷ the real-clock span between first and last (Hz). */
    hz: number | null;
    /** Frames really presented to consumers. */
    presentedFrames: number;
    /** The real-clock span the rate was measured over (ms; null < 2 frames). */
    spanMs: number | null;
  };
  /** The window's own bounds (real stamps; null before any activity). */
  window: {
    firstIngestedAtMs: number | null;
    lastIngestedAtMs: number | null;
    ingestedObservations: number;
  };
  /** When this snapshot was taken (the injected clock — never Date.now). */
  capturedAtMs: number;
}

// ---------------------------------------------------------------------------
// The collector
// ---------------------------------------------------------------------------

/** The ingest seam's report for one observation (all stamps REAL clocks). */
export interface LiveIngestReport {
  /** The observation entering the pipeline (the frozen §1 shape). */
  observation: LiveObservation;
  /** When the source was polled (the pull-based source's emission moment). */
  pulledAtMs: number;
  /** When the ingest seam accepted the observation (AFTER any validation). */
  ingestedAtMs: number;
}

/** The SWM-stage completion report (Worker A's L003/L004 seam). */
export interface LiveSwmUpdateReport {
  /** When the world-state update over the observation COMPLETED. */
  swmAtMs: number;
  /** The entities the stage reports as carried-undetected (extrapolated). */
  extrapolatedEntityRows?: number;
}

/** The render-stage completion report. */
export interface LiveRenderReport {
  /** When the frame render COMPLETED (the frame is renderer-consumable). */
  renderedAtMs: number;
}

/** The transport presentation report (one delivered frame). */
export interface LivePresentationReport {
  /** When the frame was handed to a consumer (the delivery boundary). */
  presentedAtMs: number;
}

/** A malformed telemetry input (fail-loud — never a silently wrong counter). */
export class LiveTelemetryValidationError extends Error {
  constructor(issues: readonly string[]) {
    super(`live telemetry input failed validation: ${issues.join("; ")}`);
    this.name = "LiveTelemetryValidationError";
  }
}

/** The tracked per-source identity binding (identity-switch detection). */
type TrackBinding = { entityRef: string; sinceObservation: number };

/** Options for {@link LiveTelemetryCollector}. */
export interface LiveTelemetryCollectorOptions {
  /** The session this collector accounts (rides the snapshot). */
  sessionId: string;
  /** The injected clock (REQUIRED — the repo's no-wall-clock constitution). */
  nowMs: () => number;
  /** How many gap windows the dropped-observations ledger keeps (default 32). */
  maxGapWindows?: number;
}

/**
 * THE live telemetry collector (L006): accumulates the frozen §9 counters
 * from the pipeline's REAL stage reports. Pure: no clock reads beyond the
 * injected one, no env, no I/O — deterministic under a pinned clock (the
 * test battery drives scenario-shaped delays and asserts EXACT values).
 */
export class LiveTelemetryCollector {
  private readonly sessionId: string;
  private readonly nowMs: () => number;
  private readonly maxGapWindows: number;
  /** The in-flight ledger's bound (dropped frames release nothing). */
  private readonly maxPending = 512;

  private sourceId: string | null = null;
  private lastSequence: number | null = null;
  private readonly sourceToIngest = emptyStats();
  private readonly ingestToSwm = emptyStats();
  private readonly swmToRender = emptyStats();
  private readonly endToEnd = emptyStats();
  /** The in-flight observation's stage stamps (the pipeline's own ledger). */
  private readonly pendingIngest = new Map<
    number,
    { pulledAtMs: number; ingestedAtMs: number; swmAtMs?: number; extrapolatedRows: number }
  >();
  private watermarkLag = {
    lastMs: null as number | null,
    maxMs: null as number | null,
    observationsWithLag: 0,
  };
  private droppedObservations = 0;
  private readonly gapWindows: { fromSequence: number; toSequence: number; missed: number }[] = [];
  private extrapolatedObservations = 0;
  private extrapolatedEntityRows = 0;
  private identitySwitches = 0;
  private readonly trackBindings = new Map<string, TrackBinding>();
  private reconnects = 0;
  private reconnectMissedUpdates = 0;
  private frameDrops = 0;
  private presentedFrames = 0;
  private firstPresentedAtMs: number | null = null;
  private lastPresentedAtMs: number | null = null;
  private firstIngestedAtMs: number | null = null;
  private lastIngestedAtMs: number | null = null;
  private ingestedObservations = 0;

  constructor(options: LiveTelemetryCollectorOptions) {
    const issues: string[] = [];
    if (options.sessionId.length === 0 || options.sessionId.length > 128) {
      issues.push("sessionId must be 1..128 characters");
    }
    if (typeof options.nowMs !== "function") {
      issues.push("nowMs must be an injected clock function");
    }
    if (issues.length > 0) throw new LiveTelemetryValidationError(issues);
    this.sessionId = options.sessionId;
    this.nowMs = options.nowMs;
    this.maxGapWindows = options.maxGapWindows ?? 32;
  }

  // -----------------------------------------------------------------------
  // The stage seams (the plumbing's report points)
  // -----------------------------------------------------------------------

  /**
   * THE INGEST SEAM (source-to-ingest): records the observation's arrival —
   * the real span from the source pull to the ingest acceptance, the
   * sequence-gap accounting (drops), the reconnect accounting, the watermark
   * lag, the extrapolated carries, and the identity-binding continuity.
   */
  noteIngested(report: LiveIngestReport): void {
    const { observation, pulledAtMs, ingestedAtMs } = report;
    const issues: string[] = [];
    if (ingestedAtMs < pulledAtMs) {
      issues.push(`ingestedAtMs (${ingestedAtMs}) is before pulledAtMs (${pulledAtMs})`);
    }
    if (observation.entityObservations.length === 0) {
      issues.push("observation carries no entity rows");
    }
    if (issues.length > 0) throw new LiveTelemetryValidationError(issues);

    if (this.sourceId === null) this.sourceId = observation.sourceId;
    // source-to-ingest: the REAL span from the source's emission moment (the
    // pull) to the ingest seam's acceptance — the honest measured latency of
    // THIS architecture's ingest boundary.
    noteSpan(this.sourceToIngest, ingestedAtMs - pulledAtMs);

    // Dropped observations: a VISIBLE sequence gap (the frozen rule — gaps
    // are never renumbered). A gap larger than 1 is counted honestly: the
    // sequences between the last seen and this one never arrived HERE.
    // When the observation carries a `recovery` member, the member itself
    // accounts its reconnect window — only the sequences BEFORE that window
    // (scattered drops ahead of a reconnect) fall to the general counter.
    const recoveryStart =
      observation.recovery !== undefined ? observation.recovery.fromSequence : observation.sequence;
    if (this.lastSequence !== null && recoveryStart > this.lastSequence + 1) {
      const missed = recoveryStart - this.lastSequence - 1;
      this.droppedObservations += missed;
      this.noteGapWindow(this.lastSequence + 1, recoveryStart - 1);
    }
    this.lastSequence = observation.sequence;

    // Reconnects: the observation's OWN recovery accounting (the additive
    // L002 member) — the missed window is counted, never smoothed over.
    if (observation.recovery !== undefined) {
      this.reconnects += 1;
      this.reconnectMissedUpdates += observation.recovery.missedUpdates;
      this.noteGapWindow(observation.recovery.fromSequence, observation.recovery.toSequence);
    }

    // Watermark lag: the observation's own dual-clock data.
    const lag = Math.max(0, observation.eventTimeMs - observation.watermark.watermarkMs);
    this.watermarkLag.lastMs = lag;
    this.watermarkLag.maxMs = Math.max(this.watermarkLag.maxMs ?? 0, lag);
    if (lag > 0) this.watermarkLag.observationsWithLag += 1;

    // Extrapolated observations: the honest undetected carries (the frozen
    // temporal rule — a miss is DATA, marked, never fabricated certainty).
    const undetected = observation.entityObservations.filter((row) => !row.detected).length;
    if (undetected > 0) {
      this.extrapolatedObservations += 1;
      this.extrapolatedEntityRows += undetected;
    }

    // Identity continuity: a source-local track id re-binding onto a
    // DIFFERENT canonical entityRef is an identity switch (counted, visible).
    for (const row of observation.entityObservations) {
      if (row.sourceLocalTrackId === undefined) continue;
      const binding = this.trackBindings.get(row.sourceLocalTrackId);
      if (binding === undefined) {
        this.trackBindings.set(row.sourceLocalTrackId, {
          entityRef: row.entityRef,
          sinceObservation: observation.sequence,
        });
      } else if (binding.entityRef !== row.entityRef) {
        this.identitySwitches += 1;
        this.trackBindings.set(row.sourceLocalTrackId, {
          entityRef: row.entityRef,
          sinceObservation: observation.sequence,
        });
      }
    }

    if (this.firstIngestedAtMs === null) this.firstIngestedAtMs = ingestedAtMs;
    this.lastIngestedAtMs = ingestedAtMs;
    this.ingestedObservations += 1;
    this.pendingIngest.set(observation.sequence, {
      pulledAtMs,
      ingestedAtMs,
      extrapolatedRows: undetected,
    });
    // A bounded in-flight ledger: frames the transport drops never reach the
    // presentation report, so the oldest entries are evicted past the cap
    // (the counted facts they fed are already banked — only the pending
    // stamps are released, never a counter).
    if (this.pendingIngest.size > this.maxPending) {
      const oldest = this.pendingIngest.keys().next().value;
      if (oldest !== undefined) this.pendingIngest.delete(oldest);
    }
  }

  /**
   * THE SWM STAGE (ingest-to-SWM): records the world-state update's
   * completion over one ingested observation. Worker A's L003/L004 engine
   * reports here through the frozen shapes; today's view-model projection
   * is the stand-in reporter on the same seam. The stage reference needs
   * only the observation's sequence (the ingest ledger's key).
   */
  noteWorldStateUpdated(observation: { sequence: number }, report: LiveSwmUpdateReport): void {
    const pending = this.pendingIngest.get(observation.sequence);
    if (pending === undefined) {
      // A stage report for an observation the ingest seam never saw is a
      // plumbing bug — fail loud, never a guessed span.
      throw new LiveTelemetryValidationError([
        `SWM-stage report for sequence ${observation.sequence} has no ingest record`,
      ]);
    }
    if (report.swmAtMs < pending.ingestedAtMs) {
      throw new LiveTelemetryValidationError([
        `swmAtMs (${report.swmAtMs}) is before the ingest stamp (${pending.ingestedAtMs})`,
      ]);
    }
    noteSpan(this.ingestToSwm, report.swmAtMs - pending.ingestedAtMs);
    pending.swmAtMs = report.swmAtMs;
    if (report.extrapolatedEntityRows !== undefined) {
      // The stage's own carry accounting refines the ingest count (a later,
      // more authoritative count replaces the provisional one — never adds).
      this.extrapolatedEntityRows = Math.max(
        this.extrapolatedEntityRows - pending.extrapolatedRows,
        0,
      );
      this.extrapolatedEntityRows += report.extrapolatedEntityRows;
      pending.extrapolatedRows = report.extrapolatedEntityRows;
    }
  }

  /**
   * THE RENDER STAGE (SWM-to-render): records the frame render's completion
   * over one observation (the frame the renderer consumes). The stage
   * reference needs only the observation's sequence.
   */
  noteFrameRendered(observation: { sequence: number }, report: LiveRenderReport): void {
    const pending = this.pendingIngest.get(observation.sequence);
    if (pending === undefined) {
      throw new LiveTelemetryValidationError([
        `render-stage report for sequence ${observation.sequence} has no ingest record`,
      ]);
    }
    if (pending.swmAtMs === undefined) {
      // The SWM stage never reported for this observation — a stage was
      // skipped in the plumbing. Fail loud: a missing span is never a fake 0.
      throw new LiveTelemetryValidationError([
        `render-stage report for sequence ${observation.sequence} has no SWM-stage record`,
      ]);
    }
    if (report.renderedAtMs < pending.swmAtMs) {
      throw new LiveTelemetryValidationError([
        `renderedAtMs (${report.renderedAtMs}) is before the SWM stamp (${pending.swmAtMs})`,
      ]);
    }
    noteSpan(this.swmToRender, report.renderedAtMs - pending.swmAtMs);
  }

  /**
   * THE TRANSPORT DELIVERY (end-to-end presentation): records one frame
   * handed to a consumer — the real span from the observation's SOURCE
   * EMISSION (the pull) to the consumer's receipt (the true end-to-end),
   * plus the effective update rate over the delivery span. The stage
   * reference needs only the observation's sequence (the wire frame's
   * `sourceSequence` carries it to the delivery boundary).
   */
  noteFramePresented(observation: { sequence: number }, report: LivePresentationReport): void {
    const pending = this.pendingIngest.get(observation.sequence);
    if (pending === undefined) {
      throw new LiveTelemetryValidationError([
        `presentation report for sequence ${observation.sequence} has no ingest record`,
      ]);
    }
    noteSpan(this.endToEnd, report.presentedAtMs - pending.pulledAtMs);
    this.presentedFrames += 1;
    if (this.firstPresentedAtMs === null) this.firstPresentedAtMs = report.presentedAtMs;
    this.lastPresentedAtMs = report.presentedAtMs;
    // The observation's pipeline accounting is complete — release it.
    this.pendingIngest.delete(observation.sequence);
  }

  /**
   * Records renderer/transport frame drops (the counted drop-oldest losses
   * at the delivery boundary — the transport's own honest counters).
   */
  noteFrameDrops(count: number): void {
    if (!Number.isInteger(count) || count < 0) {
      throw new LiveTelemetryValidationError([
        `frame drop count (${count}) must be a non-negative integer`,
      ]);
    }
    this.frameDrops += count;
  }

  // -----------------------------------------------------------------------
  // The snapshot (the §9 record — renderer-consumable + operator-facing)
  // -----------------------------------------------------------------------

  /** The frozen §9 counters as one honest document. */
  snapshot(): LiveTelemetrySnapshot {
    const spanMs =
      this.firstPresentedAtMs !== null &&
      this.lastPresentedAtMs !== null &&
      this.lastPresentedAtMs > this.firstPresentedAtMs
        ? this.lastPresentedAtMs - this.firstPresentedAtMs
        : null;
    return {
      sessionId: this.sessionId,
      sourceId: this.sourceId,
      latencies: {
        sourceToIngest: {
          counterId: "source-to-ingest-latency",
          measurement:
            "real-clock span from the live source's emission moment (the pull on the pull-based L002 source; the feed's own arrival stamp on a network provider) to the ingest seam's acceptance",
          stats: { ...this.sourceToIngest },
        },
        ingestToSwm: {
          counterId: "ingest-to-swm-latency",
          measurement:
            "real-clock span from the ingest seam's acceptance to the world-state update's completion over that observation",
          stats: { ...this.ingestToSwm },
        },
        swmToRender: {
          counterId: "swm-to-render-latency",
          measurement:
            "real-clock span from the world-state update's completion to the frame render's completion",
          stats: { ...this.swmToRender },
        },
        endToEndPresentation: {
          counterId: "end-to-end-presentation-latency",
          measurement:
            "real-clock span from the live source's emission moment to the frame being handed to a consumer at the delivery boundary (the true end-to-end)",
          stats: { ...this.endToEnd },
        },
      },
      watermarkLag: { counterId: "watermark-lag", ...this.watermarkLag },
      droppedObservations: {
        counterId: "dropped-observations",
        count: this.droppedObservations,
        gaps: [...this.gapWindows],
      },
      extrapolatedObservations: {
        counterId: "extrapolated-observations",
        observations: this.extrapolatedObservations,
        entityRows: this.extrapolatedEntityRows,
      },
      identitySwitches: { counterId: "identity-switches", count: this.identitySwitches },
      reconnects: {
        counterId: "reconnects",
        count: this.reconnects,
        missedUpdates: this.reconnectMissedUpdates,
      },
      frameDrops: { counterId: "renderer-frame-drops", count: this.frameDrops },
      effectiveUpdateRate: {
        counterId: "effective-update-rate",
        hz:
          spanMs !== null && this.presentedFrames > 1
            ? Math.round(((this.presentedFrames - 1) / (spanMs / 1000)) * 1000) / 1000
            : null,
        presentedFrames: this.presentedFrames,
        spanMs,
      },
      window: {
        firstIngestedAtMs: this.firstIngestedAtMs,
        lastIngestedAtMs: this.lastIngestedAtMs,
        ingestedObservations: this.ingestedObservations,
      },
      capturedAtMs: this.nowMs(),
    };
  }

  /** Records one visible gap window (capped ledger — the count is the truth). */
  private noteGapWindow(fromSequence: number, toSequence: number): void {
    if (this.gapWindows.length >= this.maxGapWindows) return;
    this.gapWindows.push({
      fromSequence,
      toSequence,
      missed: toSequence - fromSequence + 1,
    });
  }
}
