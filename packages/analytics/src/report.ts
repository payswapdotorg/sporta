/**
 * The W804 product analytics report — TYPES + the pure computation.
 *
 * `computeProductAnalytics` is a PURE, DETERMINISTIC function of a recorded
 * W706 viewer telemetry event stream: same events in → byte-identical report
 * out (the canonical serializer in `./canonical.ts` pins that). It performs
 * NO collection, NO network, NO clock reads — analytics runs OFFLINE over
 * streams that were already recorded by the W706 sinks.
 *
 * Every metric derives from the funnel definition in `./funnel.ts` (the
 * normative stages, boundaries, and attribution rules — see `../FUNNEL.md`
 * for the full catalog with formulas). Accounting is NEVER SILENT: every
 * input event is either classified or counted as unclassifiable WITH a
 * reason, and the identity `eventsIn === classified + Σ unclassifiable` is
 * enforced (throws `AnalyticsAccountingError` on violation) and re-checked by
 * the report schema.
 *
 * PRIVACY: the input is re-validated event-by-event through the REAL W706
 * validator before any computation (a wider event fails loudly, naming the
 * field). The OUTPUT is aggregate-only: no session ids, no error messages,
 * nothing beyond counts over the closed vocabulary (test-pinned).
 */
import {
  REMEDIATION_HINTS,
  TELEMETRY_OPERATIONS,
  TELEMETRY_SCHEMA_VERSION,
  TELEMETRY_TIMED_OPERATIONS,
} from "@sporta/viewer-shell";
import type {
  ErrorOccurredEvent,
  StateTransitionEvent,
  TimedOperation,
  UserFeedbackKind,
  ViewerFailureClass,
  ViewerOperation,
  ViewerStatus,
  ViewerTelemetryEvent,
} from "@sporta/viewer-shell";
import { AnalyticsAccountingError } from "./errors.ts";
import { parseRecordedEvents, validateRecordedEvent } from "./input.ts";
import { timingStats } from "./percentiles.ts";
import type { TimingStats } from "./percentiles.ts";
import {
  BATCH_STAGES,
  BOUNDARIES,
  FAILURE_CLASSES,
  FUNNEL_SPEC_VERSION,
  LIVE_STAGES,
  OWNER_NOTES,
  STAGE_EVIDENCE_TARGET,
  isEstablishmentEvidence,
  stageOfTransitionTarget,
} from "./funnel.ts";
import type {
  DropOffAttributionKind,
  FunnelBoundary,
  FunnelStageId,
  SessionOutcomeKind,
} from "./funnel.ts";
import { parseAnalyticsReport } from "./schema.ts";
import { ANALYTICS_REPORT_SCHEMA_TAG, ANALYTICS_REPORT_SCHEMA_VERSION } from "./schema.ts";

export { ANALYTICS_REPORT_SCHEMA_TAG, ANALYTICS_REPORT_SCHEMA_VERSION };

// ---------------------------------------------------------------------------
// Report types (the machine-readable, zod-validated shape — FUNNEL.md §5)
// ---------------------------------------------------------------------------

/** One funnel stage row: the cohort count + the conversion from the previous stage. */
export interface FunnelStageRow {
  stage: FunnelStageId;
  /** Cohorts that EVIDENCED the stage (a window-truncated cohort counts). */
  reached: number;
  /** `reached(this) / reached(previous)`; `null` for the first stage or a zero denominator (absent stays absent). */
  conversionFromPrevious: number | null;
  /** The evidence rule, verbatim (a constant string per stage). */
  evidence: string;
}

/** One path's funnel table (the ordered stages + their conversions). */
export interface FunnelSection {
  path: "batch" | "live";
  stages: FunnelStageRow[];
}

/** One drop-off attribution category with its count at a boundary. */
export interface DropOffAttributionRow {
  kind: DropOffAttributionKind;
  /** Present exactly when `kind === "error"` (the verbatim failure class). */
  failureClass?: ViewerFailureClass;
  count: number;
}

/** One funnel boundary's drop-off accounting. */
export interface BoundaryRow {
  boundary: string;
  scope: "session" | "viewer";
  /** `sessions` for session scope (cohorts), `attempts` for viewer scope (events). */
  unit: "sessions" | "attempts";
  fromStage: string;
  toStage: string;
  /** Cohorts (session scope) or failed attempts (viewer scope) at the boundary. */
  dropOffs: number;
  attribution: DropOffAttributionRow[];
}

/** One session-outcome class with its cohort count (the terminal failure metrics). */
export interface SessionOutcomeRow {
  outcome: SessionOutcomeKind;
  failureClass?: ViewerFailureClass;
  count: number;
}

/** One failure class's histogram bucket (actionable: hint + owner pointer). */
export interface FailureClassBucket {
  failureClass: ViewerFailureClass;
  /** `error-occurred` events of this class (verbatim, never re-mapped). */
  events: number;
  /** The per-operation split (the full closed operation vocabulary, zeros included). */
  byOperation: Record<ViewerOperation, number>;
  /** Events carrying a session id (attributable to a cohort). */
  sessionScoped: number;
  /** Events carrying no session id (viewer-scope failures). */
  viewerScoped: number;
  /** The W706 remediation hint, VERBATIM from the viewer-owned table. */
  remediationHint: string;
  /** The W804 owner/actionability note (see `./funnel.ts` `OWNER_NOTES`). */
  ownerNote: string;
}

/** The viewer-level connection block (outside the session funnel — unit honesty). */
export interface ConnectionBlock {
  /** `connecting` transitions observed (the connect dispatch evidence). */
  attempts: number;
  /** `connecting → browsing-sessions` transitions observed (connect successes). */
  successes: number;
  /** `error-occurred` events with operation `connect`. */
  failures: number;
  /** The connect startup timing (nearest-rank; `null` when none was observed). */
  timing: TimingStats | null;
}

/** The rebuffer-stall and integrity aggregates (playback health). */
export interface PlaybackHealthBlock {
  rebufferStalls: {
    events: number;
    sessions: number;
    /** Σ and max of `frameCount − availableFrames` per stall (frames missing at the stall). */
    frameDeficit: { total: number; max: number };
  };
  integrityVerified: {
    events: number;
    sessions: number;
    maxByteLength: number;
    maxFrameCount: number;
  };
}

/** The never-silent accounting block. */
export interface AccountingBlock {
  eventsIn: number;
  classified: number;
  /** Observed-only, sorted by reason ascending. */
  unclassifiable: Array<{ reason: string; count: number }>;
  /** Adjacent `sequence` non-increase (a new emitter run or reordered lines; array order preserved). */
  sequenceAnomalies: number;
  /** Distinct session cohorts observed (any event carrying the id). */
  sessionsObserved: number;
  /** Cohorts whose establishment transition is NOT in the window (counted, never dropped). */
  partialSessions: number;
}

/** The W804 product analytics report (see `../FUNNEL.md` for the semantics). */
export interface ProductAnalyticsReport {
  schemaVersion: typeof ANALYTICS_REPORT_SCHEMA_VERSION;
  schemaTag: typeof ANALYTICS_REPORT_SCHEMA_TAG;
  /** The vocabularies the report was computed against (drift-visible). */
  vocabulary: {
    telemetrySchemaVersion: number;
    funnelSpecVersion: number;
  };
  funnel: {
    batch: FunnelSection;
    live: FunnelSection;
    /** Cohorts that evidenced `playing` OR `live-playing` (either path's goal). */
    playbackStartedOverall: number;
    /** `playbackStartedOverall / reached(session-engaged)`; `null` when the denominator is 0. */
    engagedToPlaybackStarted: number | null;
    /** Cohorts that evidenced `ended` (a batch clip played through). */
    batchPlaybackCompleted: number;
    /** Cohorts that evidenced `live-ended` (a live stream completed/stopped honestly). */
    liveEndedObserved: number;
  };
  connection: ConnectionBlock;
  failures: {
    byClass: FailureClassBucket[];
    viewerBoundaries: BoundaryRow[];
    sessionBoundaries: BoundaryRow[];
    sessionOutcomes: SessionOutcomeRow[];
  };
  playbackHealth: PlaybackHealthBlock;
  feedback: Record<UserFeedbackKind, number>;
  timings: Record<TimedOperation, TimingStats | null>;
  accounting: AccountingBlock;
}

// ---------------------------------------------------------------------------
// Internal derivation state
// ---------------------------------------------------------------------------

/** One cohort-attributed error event (array order = the authoritative order). */
interface CohortError {
  index: number;
  event: ErrorOccurredEvent;
}

/** The per-session-cohort derivation state (the funnel's unit). */
interface Cohort {
  readonly sessionId: string;
  readonly stages: Set<FunnelStageId>;
  established: boolean;
  readonly errors: CohortError[];
  /**
   * Index of the LAST stage-evidencing transition (new OR repeated — a
   * recovery that re-reaches a previously-seen stage is still observed
   * recovery motion, so it must clear an earlier error; see the
   * `error-terminal` rule in `../FUNNEL.md` §6). `-1` when none.
   */
  lastStageEvidenceIndex: number;
  outputsPendingObserved: boolean;
  loadingOutputObserved: boolean;
  selectionCancelled: boolean;
  batchEndedObserved: boolean;
  liveEndedObserved: boolean;
  /** The cohort's transitions in order (the cancel-adjacency evidence). */
  readonly transitions: Array<{ from: ViewerStatus; to: ViewerStatus }>;
}

function newCohort(sessionId: string): Cohort {
  return {
    sessionId,
    stages: new Set<FunnelStageId>(),
    established: false,
    errors: [],
    lastStageEvidenceIndex: -1,
    outputsPendingObserved: false,
    loadingOutputObserved: false,
    selectionCancelled: false,
    batchEndedObserved: false,
    liveEndedObserved: false,
    transitions: [],
  };
}

function zeroOperations(): Record<ViewerOperation, number> {
  const record = {} as Record<ViewerOperation, number>;
  for (const operation of TELEMETRY_OPERATIONS) record[operation] = 0;
  return record;
}

function zeroFeedback(): Record<UserFeedbackKind, number> {
  return { "playback-good": 0, "playback-stalled": 0, "playback-poor": 0 };
}

function emptyTimingSamples(): Record<TimedOperation, number[]> {
  const record = {} as Record<TimedOperation, number[]>;
  for (const operation of TELEMETRY_TIMED_OPERATIONS) record[operation] = [];
  return record;
}

function stageEvidenceDescription(stage: FunnelStageId): string {
  return `state-transition to "${STAGE_EVIDENCE_TARGET[stage]}"`;
}

/** Cohorts that evidenced a stage. */
function reached(cohorts: readonly Cohort[], stage: FunnelStageId): number {
  return cohorts.filter((cohort) => cohort.stages.has(stage)).length;
}

/** The batch-path stages EXCLUDING the shared first stage (the batch evidence set). */
const BATCH_PATH_STAGES: readonly FunnelStageId[] = BATCH_STAGES.slice(1);

// ---------------------------------------------------------------------------
// The computation (pure, deterministic)
// ---------------------------------------------------------------------------

/**
 * Computes the product analytics report from a RECORDED W706 event stream.
 *
 * The array's order is the authoritative total order (a JSONL reader supplies
 * line order). Every event is re-validated through the REAL W706 validator
 * first (the privacy pin — wider events fail loudly with W706's reason).
 */
export function computeProductAnalytics(
  events: readonly ViewerTelemetryEvent[],
): ProductAnalyticsReport {
  const stream = events.map((event, index) => validateRecordedEvent(event, index));

  const cohorts = new Map<string, Cohort>();
  const unclassifiable = new Map<string, number>();
  let classified = 0;
  let sequenceAnomalies = 0;
  let connectAttempts = 0;
  let connectSuccesses = 0;
  const byClass = new Map<ViewerFailureClass, Record<ViewerOperation, number>>();
  for (const failureClass of FAILURE_CLASSES) byClass.set(failureClass, zeroOperations());
  const timingSamples = emptyTimingSamples();
  let stallEvents = 0;
  const stallSessions = new Set<string>();
  let stallDeficitTotal = 0;
  let stallDeficitMax = 0;
  let integrityEvents = 0;
  const integritySessions = new Set<string>();
  let integrityMaxByteLength = 0;
  let integrityMaxFrameCount = 0;
  const feedback = zeroFeedback();

  function count(reason: string): void {
    unclassifiable.set(reason, (unclassifiable.get(reason) ?? 0) + 1);
  }

  function cohortOf(sessionId: string): Cohort {
    const existing = cohorts.get(sessionId);
    if (existing !== undefined) return existing;
    const created = newCohort(sessionId);
    cohorts.set(sessionId, created);
    return created;
  }

  /** Applies one state-transition event (the funnel's evidence spine). */
  function onTransition(event: StateTransitionEvent, index: number): void {
    if (event.to === "connecting") {
      connectAttempts += 1;
      classified += 1;
      return;
    }
    if (event.to === "browsing-sessions") {
      // connect success (from `connecting`) vs a session close (from a
      // session view) — both classified, only the first is a connect success.
      if (event.from === "connecting") connectSuccesses += 1;
      classified += 1;
      return;
    }
    const stage = stageOfTransitionTarget(event.to);
    if (event.sessionId === null) {
      if (stage === null) {
        classified += 1; // viewer-level navigation (e.g. a close landing)
        return;
      }
      // A stage-evidencing transition with NO cohort to attribute it to —
      // impossible in a real W706 stream (the emitter stamps the session id
      // before the establishing transition); counted, never dropped.
      count("stage-evidence-without-session-id");
      return;
    }
    const cohort = cohortOf(event.sessionId);
    if (stage !== null) {
      // ANY stage-evidencing transition moves the marker (a recovery that
      // re-reaches a previously-seen stage is observed recovery motion — the
      // `error-terminal` rule in `../FUNNEL.md` §6 compares against THIS).
      cohort.lastStageEvidenceIndex = index;
      cohort.stages.add(stage);
    } else {
      // Non-stage signals used by attribution (FUNNEL.md §4).
      if (event.to === "outputs-pending") cohort.outputsPendingObserved = true;
      if (event.to === "loading-output") cohort.loadingOutputObserved = true;
      if (event.to === "ended") cohort.batchEndedObserved = true;
      if (event.to === "live-ended") cohort.liveEndedObserved = true;
    }
    if (isEstablishmentEvidence(event.from, event.to)) cohort.established = true;
    cohort.transitions.push({ from: event.from, to: event.to });
    classified += 1;
  }

  let previousSequence: number | null = null;
  for (let index = 0; index < stream.length; index += 1) {
    const event = stream[index] as ViewerTelemetryEvent;
    if (previousSequence !== null && event.sequence <= previousSequence) {
      sequenceAnomalies += 1;
    }
    previousSequence = event.sequence;

    switch (event.kind) {
      case "state-transition": {
        onTransition(event, index);
        break;
      }
      case "operation-timing": {
        const samples = timingSamples[event.operation];
        if (samples === undefined) {
          count(`unknown timed operation '${String(event.operation)}'`);
          break;
        }
        samples.push(event.durationMs);
        classified += 1;
        break;
      }
      case "error-occurred": {
        const perOperation = byClass.get(event.failureClass);
        if (perOperation === undefined) {
          // Unreachable under schema v1 (the validator closed the class set);
          // counted, never dropped, for the day the vocabulary grows.
          count(`unknown failure class '${String(event.failureClass)}'`);
          break;
        }
        perOperation[event.operation] += 1;
        if (event.sessionId === null) {
          // viewer-scope failure (no session id on the event)
        } else {
          cohortOf(event.sessionId).errors.push({ index, event });
        }
        classified += 1;
        break;
      }
      case "rebuffer-stall": {
        stallEvents += 1;
        const deficit = event.frameCount - event.availableFrames;
        stallDeficitTotal += deficit;
        stallDeficitMax = Math.max(stallDeficitMax, deficit);
        if (event.sessionId !== null) stallSessions.add(event.sessionId);
        classified += 1;
        break;
      }
      case "integrity-verified": {
        integrityEvents += 1;
        integrityMaxByteLength = Math.max(integrityMaxByteLength, event.byteLength);
        integrityMaxFrameCount = Math.max(integrityMaxFrameCount, event.frameCount);
        if (event.sessionId !== null) integritySessions.add(event.sessionId);
        classified += 1;
        break;
      }
      case "user-feedback": {
        feedback[event.feedback] += 1;
        classified += 1;
        break;
      }
      default: {
        // Unreachable under schema v1 (the validator closed the kind set);
        // counted, never dropped, for the day the vocabulary grows.
        const kind = (event as { kind: string }).kind;
        count(`unknown event kind '${String(kind)}'`);
        break;
      }
    }
  }

  // Post-pass: the cancel-adjacency signal (a selection exit not followed by
  // a createRender dispatch — `cancelRenderSelection`'s honest evidence).
  for (const cohort of cohorts.values()) {
    for (let i = 0; i < cohort.transitions.length; i += 1) {
      const transition = cohort.transitions[i] as { from: ViewerStatus; to: ViewerStatus };
      if (transition.from !== "renderer-selection" || transition.to !== "session-detail") continue;
      const next = cohort.transitions[i + 1];
      const followedByDispatch =
        next !== undefined && next.from === "session-detail" && next.to === "render-queued";
      if (!followedByDispatch) cohort.selectionCancelled = true;
    }
  }

  const cohortList = [...cohorts.values()];
  cohortList.sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));

  // Never-silent accounting identity (fail-loud internal consistency).
  const unclassifiableTotal = [...unclassifiable.values()].reduce((sum, value) => sum + value, 0);
  if (classified + unclassifiableTotal !== stream.length) {
    throw new AnalyticsAccountingError(
      `accounting identity violated: ${String(classified)} classified + ${String(unclassifiableTotal)} unclassifiable !== ${String(stream.length)} events in`,
    );
  }

  // --- funnel tables ---------------------------------------------------------
  function funnelRow(stage: FunnelStageId, previous: FunnelStageId | null): FunnelStageRow {
    const stageReached = reached(cohortList, stage);
    const previousReached = previous === null ? null : reached(cohortList, previous);
    return {
      stage,
      reached: stageReached,
      conversionFromPrevious:
        previousReached === null || previousReached === 0 ? null : stageReached / previousReached,
      evidence: stageEvidenceDescription(stage),
    };
  }

  const batchRows = BATCH_STAGES.map((stage, position) =>
    funnelRow(stage, position === 0 ? null : (BATCH_STAGES[position - 1] as FunnelStageId)),
  );
  const liveRows = LIVE_STAGES.map((stage, position) =>
    funnelRow(stage, position === 0 ? null : (LIVE_STAGES[position - 1] as FunnelStageId)),
  );

  const playbackStartedOverall = cohortList.filter(
    (cohort) => cohort.stages.has("batch-playing") || cohort.stages.has("live-playing"),
  ).length;
  const engagedReached = reached(cohortList, "session-engaged");

  // --- session outcomes (the terminal failure metrics) ------------------------
  const outcomes = new Map<string, number>();
  function countOutcome(key: string): void {
    outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
  }
  for (const cohort of cohortList) {
    if (cohort.stages.has("batch-playing") || cohort.stages.has("live-playing")) {
      countOutcome("playback-started");
      continue;
    }
    const lastError = cohort.errors[cohort.errors.length - 1];
    // An error followed by ANY stage-evidencing transition (new OR repeated)
    // was recovered — the session moved on (retried, dismissed back to the
    // session view, took the other path…). Only an error with NO subsequent
    // stage evidence is the session's terminal failure: the error was the
    // cohort's last observed funnel-relevant fact.
    if (lastError !== undefined && lastError.index > cohort.lastStageEvidenceIndex) {
      countOutcome(`error-terminal:${lastError.event.failureClass}`);
      continue;
    }
    countOutcome("no-terminal-error");
  }

  // --- boundary drop-offs ------------------------------------------------------
  /** The last (authoritative order) error at a boundary's operations. */
  function boundaryError(
    cohort: Cohort,
    operations: readonly ViewerOperation[],
  ): ErrorOccurredEvent | null {
    let found: ErrorOccurredEvent | null = null;
    for (const error of cohort.errors) {
      if (operations.includes(error.event.operation)) found = error.event;
    }
    return found;
  }

  function namedAttributionOf(kind: DropOffAttributionKind, cohort: Cohort): boolean {
    switch (kind) {
      case "live-path-taken":
        return cohort.stages.has("live-requested") || cohort.stages.has("live-playing");
      case "batch-path-taken":
        return BATCH_PATH_STAGES.some((stage) => cohort.stages.has(stage));
      case "outputs-pending":
        return cohort.outputsPendingObserved;
      case "load-in-progress":
        return cohort.loadingOutputObserved;
      case "selection-cancelled":
        return cohort.selectionCancelled;
      case "no-error-observed":
        return true;
      case "error":
        return false; // handled separately (the verbatim class)
    }
  }

  function sessionBoundaryRow(boundary: FunnelBoundary): BoundaryRow {
    const inScope = cohortList.filter(
      (cohort) =>
        cohort.stages.has(boundary.fromStage as FunnelStageId) &&
        !cohort.stages.has(boundary.toStage as FunnelStageId),
    );
    const errorCounts = new Map<ViewerFailureClass, number>();
    const namedCounts = new Map<DropOffAttributionKind, number>();
    for (const failureClass of FAILURE_CLASSES) errorCounts.set(failureClass, 0);
    for (const kind of boundary.namedAttributions) namedCounts.set(kind, 0);
    for (const cohort of inScope) {
      const error = boundaryError(cohort, boundary.boundaryOperations);
      if (error !== null) {
        errorCounts.set(error.failureClass, (errorCounts.get(error.failureClass) ?? 0) + 1);
        continue;
      }
      for (const kind of boundary.namedAttributions) {
        if (namedAttributionOf(kind, cohort)) {
          namedCounts.set(kind, (namedCounts.get(kind) ?? 0) + 1);
          break;
        }
      }
    }
    const attribution: DropOffAttributionRow[] = [];
    for (const failureClass of FAILURE_CLASSES) {
      attribution.push({
        kind: "error",
        failureClass,
        count: errorCounts.get(failureClass) ?? 0,
      });
    }
    for (const kind of boundary.namedAttributions) {
      attribution.push({ kind, count: namedCounts.get(kind) ?? 0 });
    }
    return {
      boundary: boundary.id,
      scope: "session",
      unit: "sessions",
      fromStage: boundary.fromStage,
      toStage: boundary.toStage,
      dropOffs: inScope.length,
      attribution,
    };
  }

  function viewerBoundaryRow(boundary: FunnelBoundary): BoundaryRow {
    const errorCounts = new Map<ViewerFailureClass, number>();
    for (const failureClass of FAILURE_CLASSES) errorCounts.set(failureClass, 0);
    let total = 0;
    for (const event of stream) {
      if (event.kind !== "error-occurred") continue;
      if (!boundary.boundaryOperations.includes(event.operation)) continue;
      errorCounts.set(event.failureClass, (errorCounts.get(event.failureClass) ?? 0) + 1);
      total += 1;
    }
    const attribution: DropOffAttributionRow[] = FAILURE_CLASSES.map((failureClass) => ({
      kind: "error" as const,
      failureClass,
      count: errorCounts.get(failureClass) ?? 0,
    }));
    return {
      boundary: boundary.id,
      scope: "viewer",
      unit: "attempts",
      fromStage: boundary.fromStage,
      toStage: boundary.toStage,
      dropOffs: total,
      attribution,
    };
  }

  const sessionBoundaries = BOUNDARIES.filter((boundary) => boundary.scope === "session").map(
    sessionBoundaryRow,
  );
  const viewerBoundaries = BOUNDARIES.filter((boundary) => boundary.scope === "viewer").map(
    viewerBoundaryRow,
  );

  // --- failure histogram --------------------------------------------------------
  const failureBuckets: FailureClassBucket[] = FAILURE_CLASSES.map((failureClass) => {
    const perOperation = byClass.get(failureClass) ?? zeroOperations();
    const eventsOf = TELEMETRY_OPERATIONS.reduce(
      (sum, operation) => sum + (perOperation[operation] ?? 0),
      0,
    );
    return {
      failureClass,
      events: eventsOf,
      byOperation: perOperation,
      sessionScoped: 0, // split below (single passes over cohort errors + stream)
      viewerScoped: 0,
      remediationHint: REMEDIATION_HINTS[failureClass],
      ownerNote: OWNER_NOTES[failureClass],
    };
  });
  {
    const sessionScopedByClass = new Map<ViewerFailureClass, number>();
    const viewerScopedByClass = new Map<ViewerFailureClass, number>();
    for (const cohort of cohortList) {
      for (const error of cohort.errors) {
        const key = error.event.failureClass;
        sessionScopedByClass.set(key, (sessionScopedByClass.get(key) ?? 0) + 1);
      }
    }
    for (const event of stream) {
      if (event.kind !== "error-occurred" || event.sessionId !== null) continue;
      const key = event.failureClass;
      viewerScopedByClass.set(key, (viewerScopedByClass.get(key) ?? 0) + 1);
    }
    for (const bucket of failureBuckets) {
      bucket.sessionScoped = sessionScopedByClass.get(bucket.failureClass) ?? 0;
      bucket.viewerScoped = viewerScopedByClass.get(bucket.failureClass) ?? 0;
    }
  }

  let connectFailures = 0;
  for (const event of stream) {
    if (event.kind === "error-occurred" && event.operation === "connect") connectFailures += 1;
  }

  // --- assemble -------------------------------------------------------------------
  const report: ProductAnalyticsReport = {
    schemaVersion: ANALYTICS_REPORT_SCHEMA_VERSION,
    schemaTag: ANALYTICS_REPORT_SCHEMA_TAG,
    vocabulary: {
      telemetrySchemaVersion: TELEMETRY_SCHEMA_VERSION,
      funnelSpecVersion: FUNNEL_SPEC_VERSION,
    },
    funnel: {
      batch: { path: "batch", stages: batchRows },
      live: { path: "live", stages: liveRows },
      playbackStartedOverall,
      engagedToPlaybackStarted:
        engagedReached === 0 ? null : playbackStartedOverall / engagedReached,
      batchPlaybackCompleted: cohortList.filter((cohort) => cohort.batchEndedObserved).length,
      liveEndedObserved: cohortList.filter((cohort) => cohort.liveEndedObserved).length,
    },
    connection: {
      attempts: connectAttempts,
      successes: connectSuccesses,
      failures: connectFailures,
      timing: timingSamples.connect.length > 0 ? timingStats(timingSamples.connect) : null,
    },
    failures: {
      byClass: failureBuckets,
      viewerBoundaries,
      sessionBoundaries,
      sessionOutcomes: [
        { outcome: "playback-started", count: outcomes.get("playback-started") ?? 0 },
        ...FAILURE_CLASSES.map((failureClass) => ({
          outcome: "error-terminal" as const,
          failureClass,
          count: outcomes.get(`error-terminal:${failureClass}`) ?? 0,
        })),
        { outcome: "no-terminal-error", count: outcomes.get("no-terminal-error") ?? 0 },
      ],
    },
    playbackHealth: {
      rebufferStalls: {
        events: stallEvents,
        sessions: stallSessions.size,
        frameDeficit: { total: stallDeficitTotal, max: stallDeficitMax },
      },
      integrityVerified: {
        events: integrityEvents,
        sessions: integritySessions.size,
        maxByteLength: integrityMaxByteLength,
        maxFrameCount: integrityMaxFrameCount,
      },
    },
    feedback,
    timings: {
      connect: timingSamples.connect.length > 0 ? timingStats(timingSamples.connect) : null,
      "load-output":
        timingSamples["load-output"].length > 0 ? timingStats(timingSamples["load-output"]) : null,
      openLive: timingSamples.openLive.length > 0 ? timingStats(timingSamples.openLive) : null,
    },
    accounting: {
      eventsIn: stream.length,
      classified,
      unclassifiable: [...unclassifiable.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0)),
      sequenceAnomalies,
      sessionsObserved: cohortList.length,
      partialSessions: cohortList.filter((cohort) => !cohort.established).length,
    },
  };

  // Self-validation: the constructed report MUST satisfy the versioned zod
  // schema (a shape bug fails loud here, never reaches a consumer).
  return parseAnalyticsReport(report);
}

/**
 * Convenience pipeline: parse + validate a recorded stream of unknown JSON
 * values (e.g. the parsed lines of a W706 JSONL recording) and compute the
 * report. Fails loud on the first non-W706 value (the privacy boundary).
 */
export function analyzeRecordedStream(values: readonly unknown[]): ProductAnalyticsReport {
  return computeProductAnalytics(parseRecordedEvents(values));
}
