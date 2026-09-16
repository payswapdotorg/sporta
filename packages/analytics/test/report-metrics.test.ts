/**
 * The W804 metric-correctness tests — constructed REAL-shaped streams (every
 * event is a valid W706 event, re-validated by the real validator at compute
 * time), covering: the happy paths, EVERY terminal failure class, partial
 * sessions, the unclassifiable-event accounting, per-boundary drop-off
 * attribution (every named kind), the terminal-vs-recovered outcome rule,
 * the failure histogram's scope split + verbatim remediation/owner tables,
 * playback health, timings, the connection block, sequence anomalies, and
 * the representative composite stream (the funnel-table evidence).
 */
import { describe, expect, test } from "bun:test";
import { computeProductAnalytics } from "../src/report.ts";
import type { BoundaryRow, ProductAnalyticsReport } from "../src/report.ts";
import { FAILURE_CLASSES, OWNER_NOTES, STAGE_EVIDENCE_TARGET } from "../src/funnel.ts";
import { REMEDIATION_HINTS, TELEMETRY_OPERATIONS } from "@sporta/viewer-shell";
import { Stream, connectAttempt, establish } from "./helpers.ts";

/** The funnel table of one path as plain `[stage, reached, conversion]` rows. */
function funnelTable(
  report: ProductAnalyticsReport,
  path: "batch" | "live",
): Array<[string, number, number | null]> {
  return report.funnel[path].stages.map((row) => [
    row.stage,
    row.reached,
    row.conversionFromPrevious,
  ]);
}

/** One boundary's attribution rows as `kind[:class] → count`, dropping zeros. */
function attributionOf(report: ProductAnalyticsReport, id: string): Record<string, number> {
  const rows = [...report.failures.viewerBoundaries, ...report.failures.sessionBoundaries].filter(
    (row) => row.boundary === id,
  );
  expect(rows).toHaveLength(1);
  const out: Record<string, number> = {};
  for (const entry of rows[0]!.attribution) {
    if (entry.count === 0) continue;
    const key = entry.kind === "error" ? `error:${entry.failureClass}` : entry.kind;
    out[key] = entry.count;
  }
  return out;
}

function boundaryRow(report: ProductAnalyticsReport, id: string): BoundaryRow {
  const rows = [...report.failures.viewerBoundaries, ...report.failures.sessionBoundaries].filter(
    (row) => row.boundary === id,
  );
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

/** The session-outcome rows as `outcome[:class] → count`, dropping zeros. */
function outcomesOf(report: ProductAnalyticsReport): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of report.failures.sessionOutcomes) {
    if (row.count === 0) continue;
    out[row.outcome === "error-terminal" ? `error-terminal:${row.failureClass}` : row.outcome] =
      row.count;
  }
  return out;
}

describe("the empty stream — an all-zero report is still a complete report", () => {
  const report = computeProductAnalytics([]);

  test("funnel tables are the full stage sets, all zero, conversions null (absent stays absent)", () => {
    expect(funnelTable(report, "batch")).toEqual([
      ["session-engaged", 0, null],
      ["renderer-selection", 0, null],
      ["render-requested", 0, null],
      ["output-ready", 0, null],
      ["batch-playing", 0, null],
    ]);
    expect(funnelTable(report, "live")).toEqual([
      ["session-engaged", 0, null],
      ["live-requested", 0, null],
      ["live-playing", 0, null],
    ]);
    expect(report.funnel.playbackStartedOverall).toBe(0);
    expect(report.funnel.engagedToPlaybackStarted).toBeNull();
  });

  test("the histogram is complete (all 12 classes, zeros included) with verbatim guidance", () => {
    expect(report.failures.byClass.map((bucket) => bucket.failureClass)).toEqual([
      ...FAILURE_CLASSES,
    ]);
    for (const bucket of report.failures.byClass) {
      expect(bucket.events).toBe(0);
      expect(bucket.sessionScoped).toBe(0);
      expect(bucket.viewerScoped).toBe(0);
      expect(Object.keys(bucket.byOperation)).toEqual([...TELEMETRY_OPERATIONS]);
      expect(bucket.remediationHint).toBe(REMEDIATION_HINTS[bucket.failureClass]);
      expect(bucket.ownerNote).toBe(OWNER_NOTES[bucket.failureClass]);
    }
  });

  test("accounting is empty but consistent", () => {
    expect(report.accounting).toEqual({
      eventsIn: 0,
      classified: 0,
      unclassifiable: [],
      sequenceAnomalies: 0,
      sessionsObserved: 0,
      partialSessions: 0,
    });
  });
});

describe("the happy batch path — one session walked end to end", () => {
  const stream = new Stream();
  connectAttempt(stream, "success");
  stream.timing("connect", 120);
  establish(stream, "sess-1");
  stream.transition("session-detail", "renderer-selection", "sess-1");
  stream.transition("renderer-selection", "session-detail", "sess-1"); // beginRender's landing context (createRender begin)
  stream.transition("session-detail", "render-queued", "sess-1");
  stream.transition("render-queued", "loading-output", "sess-1");
  stream.integrity({ byteLength: 4096, frameCount: 6 }, "sess-1");
  stream.timing("load-output", 240);
  stream.transition("loading-output", "ready", "sess-1");
  stream.transition("ready", "playing", "sess-1");
  stream.stall({ frameIndex: 4, frameCount: 6, availableFrames: 4 }, "sess-1");
  stream.feedback("playback-good", "sess-1");
  stream.transition("playing", "ended", "sess-1");
  const report = computeProductAnalytics(stream.events);

  test("the funnel table: every stage reached once, every conversion 1, evidence named", () => {
    expect(funnelTable(report, "batch")).toEqual([
      ["session-engaged", 1, null],
      ["renderer-selection", 1, 1],
      ["render-requested", 1, 1],
      ["output-ready", 1, 1],
      ["batch-playing", 1, 1],
    ]);
    for (const row of report.funnel.batch.stages) {
      expect(row.evidence).toBe(`state-transition to "${STAGE_EVIDENCE_TARGET[row.stage]}"`);
    }
    expect(report.funnel.playbackStartedOverall).toBe(1);
    expect(report.funnel.engagedToPlaybackStarted).toBe(1);
    expect(report.funnel.batchPlaybackCompleted).toBe(1);
    expect(report.funnel.liveEndedObserved).toBe(0);
  });

  test("the live table stays empty (the session never took the live path)", () => {
    expect(funnelTable(report, "live")).toEqual([
      ["session-engaged", 1, null],
      ["live-requested", 0, 0],
      ["live-playing", 0, null], // zero denominator: absent stays absent
    ]);
  });

  test("connection block: one attempt, one success, the timed connect", () => {
    expect(report.connection).toEqual({
      attempts: 1,
      successes: 1,
      failures: 0,
      timing: { count: 1, minMs: 120, maxMs: 120, meanMs: 120, p50Ms: 120, p95Ms: 120 },
    });
    expect(report.timings["load-output"]).toEqual({
      count: 1,
      minMs: 240,
      maxMs: 240,
      meanMs: 240,
      p50Ms: 240,
      p95Ms: 240,
    });
    expect(report.timings.openLive).toBeNull();
  });

  test("playback health + feedback: the honest seams", () => {
    expect(report.playbackHealth.rebufferStalls).toEqual({
      events: 1,
      sessions: 1,
      frameDeficit: { total: 2, max: 2 }, // frameCount 6 − available 4
    });
    expect(report.playbackHealth.integrityVerified).toEqual({
      events: 1,
      sessions: 1,
      maxByteLength: 4096,
      maxFrameCount: 6,
    });
    expect(report.feedback).toEqual({
      "playback-good": 1,
      "playback-stalled": 0,
      "playback-poor": 0,
    });
  });

  test("accounting: 15 events in, all classified, one observed session, not partial", () => {
    expect(report.accounting).toEqual({
      eventsIn: 15,
      classified: 15,
      unclassifiable: [],
      sequenceAnomalies: 0,
      sessionsObserved: 1,
      partialSessions: 0,
    });
  });

  test("outcome: playback-started; no drop-offs on the walked batch spine", () => {
    expect(outcomesOf(report)).toEqual({ "playback-started": 1 });
    for (const id of [
      "session-engaged→renderer-selection",
      "renderer-selection→render-requested",
      "render-requested→output-ready",
      "output-ready→batch-playing",
    ]) {
      expect(boundaryRow(report, id).dropOffs).toBe(0);
    }
    // The LIVE boundary sees this batch cohort (unit honesty — it counts):
    expect(boundaryRow(report, "session-engaged→live-requested").dropOffs).toBe(1);
    expect(attributionOf(report, "session-engaged→live-requested")).toEqual({
      "batch-path-taken": 1,
    });
  });
});

describe("the happy live path — the W704 branch", () => {
  const stream = new Stream();
  establish(stream, "sess-7");
  stream.transition("session-detail", "live-connecting", "sess-7");
  stream.timing("openLive", 310);
  stream.transition("live-connecting", "live-playing", "sess-7");
  stream.stall({ frameIndex: 9, frameCount: 12, availableFrames: 7 }, "sess-7");
  stream.transition("live-playing", "live-ended", "sess-7");
  const report = computeProductAnalytics(stream.events);

  test("the live funnel table: reached once, conversions 1", () => {
    expect(funnelTable(report, "live")).toEqual([
      ["session-engaged", 1, null],
      ["live-requested", 1, 1],
      ["live-playing", 1, 1],
    ]);
    expect(report.funnel.playbackStartedOverall).toBe(1);
    expect(report.funnel.liveEndedObserved).toBe(1);
    expect(report.funnel.batchPlaybackCompleted).toBe(0);
  });

  test("the batch table shares the first stage only", () => {
    expect(funnelTable(report, "batch")).toEqual([
      ["session-engaged", 1, null],
      ["renderer-selection", 0, 0],
      ["render-requested", 0, null], // zero denominators stay null
      ["output-ready", 0, null],
      ["batch-playing", 0, null],
    ]);
  });

  test("the openLive timing is reported; the live stall is the rebuffer aggregate", () => {
    expect(report.timings.openLive).toEqual({
      count: 1,
      minMs: 310,
      maxMs: 310,
      meanMs: 310,
      p50Ms: 310,
      p95Ms: 310,
    });
    expect(report.playbackHealth.rebufferStalls.frameDeficit).toEqual({ total: 5, max: 5 });
    expect(outcomesOf(report)).toEqual({ "playback-started": 1 });
  });
});

describe("every terminal failure class — the verbatim histogram and outcome rows", () => {
  const stream = new Stream();
  const classes = [...FAILURE_CLASSES];
  classes.forEach((failureClass, index) => {
    const sessionId = `sess-${index + 1}`;
    establish(stream, sessionId);
    stream.failure("beginRender", failureClass, `terminal ${failureClass}`, sessionId);
    stream.transition("session-detail", "error", sessionId);
  });
  const report = computeProductAnalytics(stream.events);

  test("one error-terminal outcome row per class, count 1, verbatim class names", () => {
    expect(outcomesOf(report)).toEqual(
      Object.fromEntries(classes.map((c) => [`error-terminal:${c}`, 1])),
    );
  });

  test("the histogram counts each class once, under beginRender, session-scoped", () => {
    for (const bucket of report.failures.byClass) {
      expect(bucket.events).toBe(1);
      expect(bucket.byOperation.beginRender).toBe(1);
      expect(bucket.sessionScoped).toBe(1);
      expect(bucket.viewerScoped).toBe(0);
    }
  });

  test("the session-engaged→renderer-selection boundary attributes all 14 by verbatim class", () => {
    const row = boundaryRow(report, "session-engaged→renderer-selection");
    expect(row.dropOffs).toBe(14);
    expect(row.unit).toBe("sessions");
    expect(row.scope).toBe("session");
    const errorRows = row.attribution.filter((entry) => entry.kind === "error");
    expect(errorRows).toEqual(
      FAILURE_CLASSES.map((failureClass) => ({
        kind: "error",
        failureClass,
        count: 1, // every class exactly once, verbatim
      })),
    );
    const namedRows = row.attribution.filter((entry) => entry.kind !== "error");
    expect(namedRows.map((entry) => entry.kind)).toEqual([
      "live-path-taken",
      "batch-path-taken",
      "no-error-observed",
    ]);
    for (const entry of namedRows) expect(entry.count).toBe(0);
  });

  test("accounting balances: 42 events in (14×3), all classified, 14 sessions", () => {
    expect(report.accounting.eventsIn).toBe(42);
    expect(report.accounting.classified).toBe(42);
    expect(report.accounting.sessionsObserved).toBe(14);
    expect(report.accounting.partialSessions).toBe(0);
  });
});

describe("partial sessions — counted and flagged, never dropped", () => {
  test("a cohort whose window began mid-session (no establishment observed)", () => {
    const stream = new Stream();
    stream.transition("session-detail", "renderer-selection", "sess-p");
    stream.transition("renderer-selection", "render-queued", "sess-p");
    stream.transition("render-queued", "loading-output", "sess-p");
    stream.transition("loading-output", "ready", "sess-p");
    const report = computeProductAnalytics(stream.events);

    expect(report.accounting.sessionsObserved).toBe(1);
    expect(report.accounting.partialSessions).toBe(1);
    // Its observed evidence counts — but session-engaged was never observed:
    expect(funnelTable(report, "batch")).toEqual([
      ["session-engaged", 0, null],
      ["renderer-selection", 1, null], // zero denominator: conversion stays null
      ["render-requested", 1, 1],
      ["output-ready", 1, 1],
      ["batch-playing", 0, 0],
    ]);
    expect(report.funnel.engagedToPlaybackStarted).toBeNull();
    expect(outcomesOf(report)).toEqual({ "no-terminal-error": 1 });
  });

  test("an established cohort alongside a partial one — only the partial is flagged", () => {
    const stream = new Stream();
    establish(stream, "sess-full");
    stream.transition("session-detail", "renderer-selection", "sess-full");
    stream.transition("session-detail", "render-queued", "sess-half");
    const report = computeProductAnalytics(stream.events);
    expect(report.accounting.sessionsObserved).toBe(2);
    expect(report.accounting.partialSessions).toBe(1);
  });
});

describe("unclassifiable-event accounting — events in = classified + unclassifiable-with-reason", () => {
  test("stage evidence with no session id is counted unclassifiable (impossible from the real emitter)", () => {
    const stream = new Stream();
    establish(stream, "sess-1");
    stream.transition("loading-output", "ready", null); // valid W706 event, unattributable cohort
    stream.transition("session-detail", "renderer-selection", "sess-1");
    const report = computeProductAnalytics(stream.events);

    expect(report.accounting.eventsIn).toBe(3);
    expect(report.accounting.classified).toBe(2);
    expect(report.accounting.unclassifiable).toEqual([
      { reason: "stage-evidence-without-session-id", count: 1 },
    ]);
    // The identity the schema re-checks on every parse:
    expect(
      report.accounting.classified +
        report.accounting.unclassifiable.reduce((sum, row) => sum + row.count, 0),
    ).toBe(report.accounting.eventsIn);
    // The orphan stage did NOT leak into the funnel:
    expect(funnelTable(report, "batch")[3]).toEqual(["output-ready", 0, null]);
  });

  test("multiple orphan reasons sort by reason ascending (deterministic rows)", () => {
    const stream = new Stream();
    stream.transition("loading-output", "ready", null);
    stream.transition("ready", "playing", null);
    const report = computeProductAnalytics(stream.events);
    expect(report.accounting.unclassifiable).toEqual([
      { reason: "stage-evidence-without-session-id", count: 2 },
    ]);
    expect(report.accounting.classified).toBe(0);
  });

  test("viewer-level transitions (connecting, browsing-sessions) are CLASSIFIED, not unclassifiable", () => {
    const stream = new Stream();
    connectAttempt(stream, "success");
    stream.transition("session-detail", "browsing-sessions", null); // closeSession (id already cleared)
    const report = computeProductAnalytics(stream.events);
    expect(report.accounting.classified).toBe(3);
    expect(report.accounting.unclassifiable).toEqual([]);
    expect(report.connection.attempts).toBe(1);
    expect(report.connection.successes).toBe(1);
  });
});

describe("boundary drop-off attribution — every named kind on real-shaped flows", () => {
  test("live-path-taken: a live cohort is not a renderer-selection drop-off", () => {
    const stream = new Stream();
    establish(stream, "sess-live");
    stream.transition("session-detail", "live-connecting", "sess-live");
    stream.transition("live-connecting", "live-playing", "sess-live");
    const report = computeProductAnalytics(stream.events);
    expect(attributionOf(report, "session-engaged→renderer-selection")).toEqual({
      "live-path-taken": 1,
    });
  });

  test("batch-path-taken at the LIVE boundary: a batch cohort is not a live drop-off", () => {
    const stream = new Stream();
    establish(stream, "sess-b");
    stream.transition("session-detail", "renderer-selection", "sess-b");
    stream.transition("session-detail", "render-queued", "sess-b");
    const report = computeProductAnalytics(stream.events);
    expect(attributionOf(report, "session-engaged→live-requested")).toEqual({
      "batch-path-taken": 1,
    });
  });

  test("batch-path-taken at the RENDERER-SELECTION boundary: the selectRender skip path (a session with pre-existing renders)", () => {
    // The real W705 entry point: session-detail → loading-output → ready,
    // never entering the selection screen.
    const stream = new Stream();
    establish(stream, "sess-skip");
    stream.transition("session-detail", "loading-output", "sess-skip");
    stream.transition("loading-output", "ready", "sess-skip");
    const report = computeProductAnalytics(stream.events);
    expect(attributionOf(report, "session-engaged→renderer-selection")).toEqual({
      "batch-path-taken": 1,
    });
    // And the cohort IS in the funnel at output-ready (evidence counts, skip documented):
    expect(funnelTable(report, "batch")).toEqual([
      ["session-engaged", 1, null],
      ["renderer-selection", 0, 0],
      ["render-requested", 0, null], // zero denominator
      ["output-ready", 1, null], // zero denominator (the skip path)
      ["batch-playing", 0, 0],
    ]);
  });

  test("outputs-pending: the W705 processing state ended the window", () => {
    const stream = new Stream();
    establish(stream, "sess-op");
    stream.transition("session-detail", "renderer-selection", "sess-op");
    stream.transition("renderer-selection", "render-queued", "sess-op");
    stream.transition("render-queued", "outputs-pending", "sess-op");
    const report = computeProductAnalytics(stream.events);
    expect(attributionOf(report, "render-requested→output-ready")).toEqual({
      "outputs-pending": 1,
    });
  });

  test("load-in-progress: the load was in flight when the window ended", () => {
    const stream = new Stream();
    establish(stream, "sess-lip");
    stream.transition("session-detail", "renderer-selection", "sess-lip");
    stream.transition("renderer-selection", "render-queued", "sess-lip");
    stream.transition("render-queued", "loading-output", "sess-lip");
    const report = computeProductAnalytics(stream.events);
    expect(attributionOf(report, "render-requested→output-ready")).toEqual({
      "load-in-progress": 1,
    });
  });

  test("selection-cancelled: exited selection without a following dispatch", () => {
    const stream = new Stream();
    establish(stream, "sess-c");
    stream.transition("session-detail", "renderer-selection", "sess-c");
    stream.transition("renderer-selection", "session-detail", "sess-c"); // cancelRenderSelection
    const report = computeProductAnalytics(stream.events);
    expect(attributionOf(report, "renderer-selection→render-requested")).toEqual({
      "selection-cancelled": 1,
    });
  });

  test("a cancel followed by the dispatch is not a cancellation — and a truncated selection is not one either (the adjacency rule)", () => {
    // Cohort A cancels, re-enters, cancels again, then DISPATCHES: it
    // reached render-requested, so it is not a boundary drop-off at all.
    const stream = new Stream();
    establish(stream, "sess-cc");
    stream.transition("session-detail", "renderer-selection", "sess-cc");
    stream.transition("renderer-selection", "session-detail", "sess-cc"); // cancel…
    stream.transition("session-detail", "renderer-selection", "sess-cc"); // …re-entered
    stream.transition("renderer-selection", "session-detail", "sess-cc"); // cancel again
    stream.transition("session-detail", "render-queued", "sess-cc"); // …then dispatched
    // Cohort B's window was truncated while the selection screen was open
    // (entered, never exited): no CANCEL was observed — the honest catch-all
    // answers, not the cancellation kind.
    establish(stream, "sess-open");
    stream.transition("session-detail", "renderer-selection", "sess-open");
    const report = computeProductAnalytics(stream.events);
    expect(boundaryRow(report, "renderer-selection→render-requested").dropOffs).toBe(1);
    expect(attributionOf(report, "renderer-selection→render-requested")).toEqual({
      "no-error-observed": 1, // sess-open; sess-cc is not in scope (it dispatched)
    });
  });

  test("no-error-observed: the honest catch-all (engaged, then nothing)", () => {
    const stream = new Stream();
    establish(stream, "sess-idle");
    const report = computeProductAnalytics(stream.events);
    expect(attributionOf(report, "session-engaged→renderer-selection")).toEqual({
      "no-error-observed": 1,
    });
    expect(attributionOf(report, "session-engaged→live-requested")).toEqual({
      "no-error-observed": 1,
    });
  });

  test("errors win over signals (the priority rule) — a beginRender failure after a live attempt", () => {
    const stream = new Stream();
    establish(stream, "sess-x");
    stream.failure("beginRender", "resource-limit", "busy", "sess-x");
    stream.transition("session-detail", "error", "sess-x");
    stream.transition("error", "session-detail", "sess-x"); // dismissed
    stream.transition("session-detail", "live-connecting", "sess-x"); // took the live path after all
    const report = computeProductAnalytics(stream.events);
    // Still in scope for renderer-selection (never reached it), and the ERROR
    // is attributed, not the path taken:
    expect(attributionOf(report, "session-engaged→renderer-selection")).toEqual({
      "error:resource-limit": 1,
    });
  });

  test("the W704 rights pre-check denial fails at the REQUEST boundary (never reached live-connecting)", () => {
    const stream = new Stream();
    establish(stream, "sess-r");
    stream.failure("openLive", "rights-denied", "no liveDelivery capability", "sess-r");
    stream.transition("session-detail", "error", "sess-r");
    const report = computeProductAnalytics(stream.events);
    expect(attributionOf(report, "session-engaged→live-requested")).toEqual({
      "error:rights-denied": 1,
    });
  });

  test("the viewer-scope boundaries count failed ATTEMPTS by verbatim class", () => {
    const stream = new Stream();
    stream.failure("connect", "internal", "server down"); // no session id: viewer-scoped
    stream.transition("disconnected", "connecting");
    stream.transition("connecting", "error");
    stream.failure("openSession", "network", "unreachable"); // failed open: viewer-scoped by construction
    const report = computeProductAnalytics(stream.events);
    expect(boundaryRow(report, "viewer→connected")).toMatchObject({
      scope: "viewer",
      unit: "attempts",
      dropOffs: 1,
    });
    expect(attributionOf(report, "viewer→connected")).toEqual({ "error:internal": 1 });
    expect(attributionOf(report, "connected→session-engaged")).toEqual({ "error:network": 1 });
  });
});

describe("session outcomes — the terminal rule", () => {
  test("an error with NO subsequent stage evidence is terminal (the window ended on it)", () => {
    const stream = new Stream();
    establish(stream, "sess-t");
    stream.failure("selectRender", "unknown-render", "gone", "sess-t");
    stream.transition("session-detail", "error", "sess-t");
    const report = computeProductAnalytics(stream.events);
    expect(outcomesOf(report)).toEqual({ "error-terminal:unknown-render": 1 });
  });

  test("a recovery that RE-REACHES a previously-seen stage clears the error (re-dismissed motion counts)", () => {
    // ready was reached; a selectRender error followed; the error was then
    // dismissed back to the session view (a REAL observed recovery
    // transition), and the window ended. The error is NOT the terminal fact.
    const stream = new Stream();
    establish(stream, "sess-rec");
    stream.transition("session-detail", "renderer-selection", "sess-rec");
    stream.transition("session-detail", "render-queued", "sess-rec");
    stream.transition("render-queued", "loading-output", "sess-rec");
    stream.transition("loading-output", "ready", "sess-rec");
    stream.failure("selectRender", "unknown-render", "gone", "sess-rec");
    stream.transition("session-detail", "error", "sess-rec");
    stream.transition("error", "session-detail", "sess-rec"); // the dismissal — stage evidence
    const report = computeProductAnalytics(stream.events);
    expect(outcomesOf(report)).toEqual({ "no-terminal-error": 1 });
  });

  test("an error followed by a NEW stage (a successful retry) is not terminal", () => {
    const stream = new Stream();
    establish(stream, "sess-retry");
    stream.failure("beginRender", "resource-limit", "busy", "sess-retry");
    stream.transition("session-detail", "error", "sess-retry");
    stream.transition("error", "session-detail", "sess-retry"); // retry's landing
    stream.transition("session-detail", "renderer-selection", "sess-retry"); // the retry SUCCEEDED
    const report = computeProductAnalytics(stream.events);
    expect(outcomesOf(report)).toEqual({ "no-terminal-error": 1 });
  });

  test("playback-started outranks later errors (reached is reached)", () => {
    const stream = new Stream();
    establish(stream, "sess-play");
    stream.transition("session-detail", "renderer-selection", "sess-play");
    stream.transition("session-detail", "render-queued", "sess-play");
    stream.transition("render-queued", "loading-output", "sess-play");
    stream.transition("loading-output", "ready", "sess-play");
    stream.transition("ready", "playing", "sess-play");
    stream.transition("playing", "session-detail", "sess-play"); // closePlayback
    stream.failure("beginRender", "internal", "boom", "sess-play"); // a later, new failure
    stream.transition("session-detail", "error", "sess-play");
    const report = computeProductAnalytics(stream.events);
    expect(outcomesOf(report)).toEqual({ "playback-started": 1 });
  });

  test("the LAST error is the terminal one when several precede it without recovery", () => {
    const stream = new Stream();
    establish(stream, "sess-multi");
    stream.failure("beginRender", "network", "down", "sess-multi");
    stream.transition("session-detail", "error", "sess-multi");
    stream.transition("error", "session-detail", "sess-multi"); // dismissed (stage evidence)
    stream.failure("beginRender", "internal", "broken", "sess-multi"); // the LAST error…
    stream.transition("session-detail", "error", "sess-multi"); // …and nothing follows
    const report = computeProductAnalytics(stream.events);
    expect(outcomesOf(report)).toEqual({ "error-terminal:internal": 1 });
  });
});

describe("the failure histogram — scope split, operation split, verbatim guidance", () => {
  test("session-scoped vs viewer-scoped split sums to events (schema-pinned identity)", () => {
    const stream = new Stream();
    establish(stream, "sess-a");
    stream.failure("beginRender", "network", "down", "sess-a");
    stream.failure("selectRender", "network", "down again", "sess-a");
    establish(stream, "sess-b");
    stream.failure("createRender", "network", "down too", "sess-b");
    stream.failure("connect", "network", "viewer-scope"); // no session id
    const report = computeProductAnalytics(stream.events);
    const network = report.failures.byClass.find((bucket) => bucket.failureClass === "network")!;
    expect(network.events).toBe(4);
    expect(network.sessionScoped).toBe(3);
    expect(network.viewerScoped).toBe(1);
    expect(network.byOperation).toEqual({
      connect: 1,
      refreshSessions: 0,
      createSession: 0,
      openSession: 0,
      terminateSession: 0,
      beginRender: 1,
      createRender: 1,
      selectRender: 1,
      openLive: 0,
    });
  });

  test("every bucket carries the W706 remediation hint and the W804 owner note VERBATIM", () => {
    const stream = new Stream();
    stream.failure("openLive", "rights-denied", "denied");
    const report = computeProductAnalytics(stream.events);
    for (const bucket of report.failures.byClass) {
      expect(bucket.remediationHint).toBe(REMEDIATION_HINTS[bucket.failureClass]);
      expect(bucket.ownerNote).toBe(OWNER_NOTES[bucket.failureClass]);
    }
    const denied = report.failures.byClass.find(
      (bucket) => bucket.failureClass === "rights-denied",
    )!;
    expect(denied.ownerNote).toContain("product/policy");
    expect(denied.remediationHint).toContain("authorization policy");
  });

  test("the connect failure count equals the connection block's failures (the schema cross-total)", () => {
    const stream = new Stream();
    stream.failure("connect", "internal", "one");
    stream.failure("connect", "network", "two");
    const report = computeProductAnalytics(stream.events);
    expect(report.connection.failures).toBe(2);
    expect(
      report.failures.byClass.reduce((sum, bucket) => sum + bucket.byOperation.connect, 0),
    ).toBe(2);
  });
});

describe("timings — nearest-rank stats over the timed operations", () => {
  test("multiple samples per operation, exact hand-computed stats", () => {
    const stream = new Stream();
    stream.timing("connect", 100);
    stream.timing("connect", 300);
    stream.timing("connect", 200);
    stream.timing("load-output", 50);
    stream.timing("load-output", 150);
    stream.timing("openLive", 80);
    const report = computeProductAnalytics(stream.events);

    expect(report.timings.connect).toEqual({
      count: 3,
      minMs: 100,
      maxMs: 300,
      meanMs: 200,
      p50Ms: 200, // sorted [100,200,300]; rank ceil(1.5)=2 → 200
      p95Ms: 300, // rank ceil(2.85)=3 → 300
    });
    expect(report.timings["load-output"]).toEqual({
      count: 2,
      minMs: 50,
      maxMs: 150,
      meanMs: 100,
      p50Ms: 50, // nearest-rank, no interpolation: the lower median
      p95Ms: 150,
    });
    expect(report.timings.openLive).toEqual({
      count: 1,
      minMs: 80,
      maxMs: 80,
      meanMs: 80,
      p50Ms: 80,
      p95Ms: 80,
    });
    expect(report.connection.timing).toEqual(report.timings.connect);
  });

  test("playback health aggregates across sessions", () => {
    const stream = new Stream();
    establish(stream, "sess-1");
    establish(stream, "sess-2");
    stream.stall({ frameIndex: 2, frameCount: 10, availableFrames: 4 }, "sess-1"); // deficit 6
    stream.stall({ frameIndex: 5, frameCount: 8, availableFrames: 5 }, "sess-2"); // deficit 3
    stream.stall({ frameIndex: 1, frameCount: 8, availableFrames: 1 }, "sess-2"); // deficit 7
    stream.integrity({ byteLength: 1024, frameCount: 6 }, "sess-1");
    stream.integrity({ byteLength: 4096, frameCount: 12 }, "sess-2");
    stream.feedback("playback-good", "sess-1");
    stream.feedback("playback-good", "sess-2");
    stream.feedback("playback-stalled", "sess-2");
    const report = computeProductAnalytics(stream.events);

    expect(report.playbackHealth.rebufferStalls).toEqual({
      events: 3,
      sessions: 2,
      frameDeficit: { total: 16, max: 7 },
    });
    expect(report.playbackHealth.integrityVerified).toEqual({
      events: 2,
      sessions: 2,
      maxByteLength: 4096,
      maxFrameCount: 12,
    });
    expect(report.feedback).toEqual({
      "playback-good": 2,
      "playback-stalled": 1,
      "playback-poor": 0,
    });
  });
});

describe("sequence anomalies — counted, never reordered", () => {
  test("an adjacent non-increase is one anomaly; the event itself is still classified", () => {
    const stream = new Stream();
    establish(stream, "sess-1");
    const raw = stream.transition("session-detail", "renderer-selection", "sess-1").events[1]!;
    // Re-mint with a stale sequence (a reordered line / a new emitter run's
    // first counter overlapping the window):
    stream.raw({ ...raw, sequence: 1 });
    const report = computeProductAnalytics(stream.events);

    expect(report.accounting.sequenceAnomalies).toBe(1);
    expect(report.accounting.eventsIn).toBe(3);
    expect(report.accounting.classified).toBe(3);
    expect(funnelTable(report, "batch")[1]).toEqual(["renderer-selection", 1, 1]);
  });

  test("a monotonically increasing run has zero anomalies", () => {
    const stream = new Stream();
    establish(stream, "sess-1");
    expect(computeProductAnalytics(stream.events).accounting.sequenceAnomalies).toBe(0);
  });
});

describe("the report is aggregate-only — privacy beyond the input", () => {
  test("no session id and no error message text crosses into the report (serialized bytes scanned)", () => {
    const stream = new Stream();
    establish(stream, "sess-very-identifiable-1");
    establish(stream, "sess-very-identifiable-2");
    stream.failure(
      "beginRender",
      "internal",
      "UNIQUE-CRAFTED-MESSAGE-XYZZY-42",
      "sess-very-identifiable-1",
    );
    stream.transition("session-detail", "error", "sess-very-identifiable-1");
    stream.stall({ frameIndex: 1, frameCount: 4, availableFrames: 2 }, "sess-very-identifiable-2");
    const report = computeProductAnalytics(stream.events);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("sess-very-identifiable");
    expect(serialized).not.toContain("sess-"); // no cohort id of ANY shape
    expect(serialized).not.toContain("UNIQUE-CRAFTED-MESSAGE-XYZZY-42");
    // The facts survive as aggregates:
    const internal = report.failures.byClass.find((b) => b.failureClass === "internal")!;
    expect(internal.events).toBe(1);
    expect(report.playbackHealth.rebufferStalls.events).toBe(1);
  });
});

describe("the representative composite stream — the funnel-table evidence", () => {
  // Five cohorts exercising every attribution kind:
  //   sess-1: the happy batch walk (played, ended)
  //   sess-2: the live path (attached, live-ended)
  //   sess-3: a terminal beginRender failure
  //   sess-4: the selectRender skip path (pre-existing render, played, ended)
  //   sess-5: stuck in outputs-pending (the render exists, no stored output yet)
  const stream = new Stream();
  connectAttempt(stream, "success"); // viewer run 1
  establish(stream, "sess-1");
  stream.transition("session-detail", "renderer-selection", "sess-1");
  stream.transition("renderer-selection", "session-detail", "sess-1");
  stream.transition("session-detail", "render-queued", "sess-1");
  stream.transition("render-queued", "loading-output", "sess-1");
  stream.integrity({ byteLength: 4096, frameCount: 6 }, "sess-1");
  stream.timing("load-output", 240);
  stream.transition("loading-output", "ready", "sess-1");
  stream.transition("ready", "playing", "sess-1");
  stream.stall({ frameIndex: 4, frameCount: 6, availableFrames: 4 }, "sess-1");
  stream.transition("playing", "ended", "sess-1");
  establish(stream, "sess-2");
  stream.transition("session-detail", "live-connecting", "sess-2");
  stream.timing("openLive", 310);
  stream.transition("live-connecting", "live-playing", "sess-2");
  stream.transition("live-playing", "live-ended", "sess-2");
  establish(stream, "sess-3");
  stream.failure("beginRender", "network", "control plane unreachable", "sess-3");
  stream.transition("session-detail", "error", "sess-3");
  establish(stream, "sess-4");
  stream.transition("session-detail", "loading-output", "sess-4");
  stream.timing("load-output", 180, "sess-4");
  stream.transition("loading-output", "ready", "sess-4");
  stream.transition("ready", "playing", "sess-4");
  stream.transition("playing", "ended", "sess-4");
  establish(stream, "sess-5");
  stream.transition("session-detail", "renderer-selection", "sess-5");
  stream.transition("renderer-selection", "session-detail", "sess-5");
  stream.transition("session-detail", "render-queued", "sess-5");
  stream.transition("render-queued", "outputs-pending", "sess-5");
  stream.transition("disconnected", "connecting"); // viewer run 2
  stream.failure("connect", "internal", "server fault"); // its failure (viewer-scoped)
  stream.transition("connecting", "error");
  const report = computeProductAnalytics(stream.events);

  test("the batch funnel table", () => {
    expect(funnelTable(report, "batch")).toEqual([
      ["session-engaged", 5, null],
      ["renderer-selection", 2, 0.4],
      ["render-requested", 2, 1],
      ["output-ready", 2, 1],
      ["batch-playing", 2, 1],
    ]);
  });

  test("the live funnel table", () => {
    expect(funnelTable(report, "live")).toEqual([
      ["session-engaged", 5, null],
      ["live-requested", 1, 0.2],
      ["live-playing", 1, 1],
    ]);
  });

  test("the overall conversion + enrichment counters", () => {
    expect(report.funnel.playbackStartedOverall).toBe(3); // sess-1, sess-2, sess-4
    expect(report.funnel.engagedToPlaybackStarted).toBe(0.6);
    expect(report.funnel.batchPlaybackCompleted).toBe(2); // sess-1, sess-4
    expect(report.funnel.liveEndedObserved).toBe(1); // sess-2
  });

  test("the connection block (its own unit — outside the funnel)", () => {
    expect(report.connection).toEqual({
      attempts: 2,
      successes: 1,
      failures: 1,
      timing: null, // no connect timing events in this stream
    });
  });

  test("the session boundaries: drop-offs with their attribution", () => {
    expect(boundaryRow(report, "session-engaged→renderer-selection").dropOffs).toBe(3);
    expect(attributionOf(report, "session-engaged→renderer-selection")).toEqual({
      "error:network": 1, // sess-3
      "live-path-taken": 1, // sess-2
      "batch-path-taken": 1, // sess-4 (the selectRender skip)
    });
    expect(boundaryRow(report, "renderer-selection→render-requested").dropOffs).toBe(0);
    expect(boundaryRow(report, "render-requested→output-ready").dropOffs).toBe(1);
    expect(attributionOf(report, "render-requested→output-ready")).toEqual({
      "outputs-pending": 1, // sess-5
    });
    expect(boundaryRow(report, "output-ready→batch-playing").dropOffs).toBe(0);
    expect(boundaryRow(report, "session-engaged→live-requested").dropOffs).toBe(4);
    expect(attributionOf(report, "session-engaged→live-requested")).toEqual({
      "batch-path-taken": 3, // sess-1, sess-4, sess-5
      "no-error-observed": 1, // sess-3
    });
    expect(boundaryRow(report, "live-requested→live-playing").dropOffs).toBe(0);
  });

  test("the viewer boundaries", () => {
    expect(attributionOf(report, "viewer→connected")).toEqual({ "error:internal": 1 });
    expect(boundaryRow(report, "connected→session-engaged").dropOffs).toBe(0);
  });

  test("the session outcomes (every cohort lands in exactly one)", () => {
    expect(outcomesOf(report)).toEqual({
      "playback-started": 3, // sess-1, sess-2, sess-4
      "error-terminal:network": 1, // sess-3
      "no-terminal-error": 1, // sess-5
    });
  });

  test("the failure histogram + playback health of the composite", () => {
    const network = report.failures.byClass.find((b) => b.failureClass === "network")!;
    expect(network.events).toBe(1);
    expect(network.byOperation.beginRender).toBe(1);
    const internal = report.failures.byClass.find((b) => b.failureClass === "internal")!;
    expect(internal.events).toBe(1);
    expect(internal.viewerScoped).toBe(1);
    expect(report.playbackHealth.rebufferStalls).toEqual({
      events: 1,
      sessions: 1,
      frameDeficit: { total: 2, max: 2 },
    });
    expect(report.playbackHealth.integrityVerified).toEqual({
      events: 1,
      sessions: 1,
      maxByteLength: 4096,
      maxFrameCount: 6,
    });
  });

  test("the accounting ledger", () => {
    expect(report.accounting).toEqual({
      eventsIn: 35,
      classified: 35,
      unclassifiable: [],
      sequenceAnomalies: 0,
      sessionsObserved: 5,
      partialSessions: 0,
    });
    expect(report.accounting.eventsIn).toBe(stream.events.length);
  });
});
