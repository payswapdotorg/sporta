/**
 * W909 E2E harness unit tests — the PURE parts of the browser-E2E suite:
 * the flow inventory / route-availability model, the order integrity, the
 * assertion recorder + run summarizer, and the WCAG contrast math the
 * a11y smoke relies on. (The browser flows themselves are the on-demand
 * `bun run e2e` harness — intentionally NOT part of this root suite.)
 */
import { describe, expect, test } from "bun:test";
import {
  E2E_FLOW_INVENTORY,
  E2E_FLOW_IDS,
  flowSpecOf,
  isE2EFlowId,
  orderCoversInventory,
  recommendedFlowOrder,
  unknownInventoryRoutes,
} from "../e2e/lib/inventory";
import { FlowRecorder, summarizeRun, type FlowOutcome } from "../e2e/lib/harness";
import {
  COVERING_NUDGE_MARGIN,
  coveringNudgeDelta,
  isCoveredByRefusal,
} from "../e2e/lib/browser-driver";
import {
  WCAG_AA_NORMAL,
  contrastRatio,
  meetsWcagAaNormal,
  parseCssColor,
  relativeLuminance,
} from "../e2e/lib/contrast";
import {
  auditIdentityContinuity,
  cadenceVerdict,
  determinismFingerprint,
  findRecoveryAccounting,
  finiteSourceOf,
  interArrivalIntervals,
  medianWithinTolerance,
  measuredLatencyStats,
  nearestRankPercentile,
  positionDeltaStats,
  scenarioSourceOf,
  sourceSequenceGaps,
  type CapturedWorldFrame,
  type LiveSourceRow,
} from "../e2e/lib/live-instrument";
import { ROUTE_PATHS } from "@/lib/navigation";

describe("W909 E2E inventory — the acceptance coverage model", () => {
  test("every acceptance flow id has exactly one spec", () => {
    expect(E2E_FLOW_IDS).toHaveLength(E2E_FLOW_INVENTORY.length);
    const ids = new Set(E2E_FLOW_INVENTORY.map((flow) => flow.id));
    expect(ids.size).toBe(E2E_FLOW_INVENTORY.length);
    for (const id of E2E_FLOW_IDS) expect(ids.has(id)).toBe(true);
  });

  test("each flow names its acceptance line and reaches only real shell routes", () => {
    for (const flow of E2E_FLOW_INVENTORY) {
      // W909's own flows carry the W909 acceptance line; the three live
      // gates carry their L015/L016/L017 work-item lines (the final live
      // acceptance gates — the same inventory discipline, their own ids).
      expect(flow.covers).toMatch(/^(W909|L01[567]):/);
      expect(flow.routes.length).toBeGreaterThan(0);
      expect(flow.title.length).toBeGreaterThan(0);
    }
    expect(unknownInventoryRoutes()).toEqual([]);
  });

  test("the route availability model fails closed on an unknown route", () => {
    expect(
      unknownInventoryRoutes([{ id: "sign-in", title: "t", covers: "W909: x", routes: ["/nope"] }]),
    ).toEqual(["sign-in: /nope"]);
    expect(unknownInventoryRoutes(E2E_FLOW_INVENTORY, ROUTE_PATHS)).toEqual([]);
    expect(unknownInventoryRoutes(E2E_FLOW_INVENTORY, ["/"])).not.toEqual([]);
  });

  test("the execution order covers the inventory exactly once", () => {
    expect(orderCoversInventory()).toBe(true);
    expect(orderCoversInventory([])).toBe(false);
    // The signed-in viewer flows come after sign-in; the watch-family flows
    // run anonymously before the render flow registers its creator.
    const order = recommendedFlowOrder();
    expect(order.indexOf("sign-in")).toBeLessThan(order.indexOf("rights-denial"));
    expect(order.indexOf("watch")).toBeLessThan(order.indexOf("reality-switch"));
    expect(order.indexOf("reality-switch")).toBeLessThan(order.indexOf("output-playback"));
    expect(order.indexOf("sign-in")).toBeLessThan(order.indexOf("role-switch"));
    // The live gates run AFTER the W909 surface is proven unchanged (each
    // signs in its own fresh account — order-independent among themselves).
    expect(order.indexOf("role-switch")).toBeLessThan(order.indexOf("live-tactical-gate"));
    expect(order.indexOf("live-tactical-gate")).toBeLessThan(order.indexOf("live-journey"));
    expect(order.indexOf("live-journey")).toBeLessThan(order.indexOf("live-to-replay"));
  });

  test("the live-gate flows reach the live entry and the auth surface the journeys need", () => {
    const liveFlows = E2E_FLOW_INVENTORY.filter((flow) =>
      ["live-tactical-gate", "live-journey", "live-to-replay"].includes(flow.id),
    );
    expect(liveFlows).toHaveLength(3);
    for (const flow of liveFlows) {
      expect(flow.routes).toContain("/live");
      expect(flow.routes).toContain("/auth/signin");
    }
    // The L016 journey starts from a fresh browser's landing (the home
    // entry) — the full user journey, not a deep link.
    expect(flowSpecOf("live-journey").routes).toContain("/");
  });

  test("flowSpecOf resolves every id and rejects none of the known ones", () => {
    for (const id of E2E_FLOW_IDS) {
      expect(flowSpecOf(id).id).toBe(id);
      expect(isE2EFlowId(id)).toBe(true);
    }
    expect(isE2EFlowId("not-a-flow")).toBe(false);
    expect(() => flowSpecOf("not-a-flow" as never)).toThrow();
  });

  test("the inventory covers every W909 acceptance keyword the work order names", () => {
    const allCovers = E2E_FLOW_INVENTORY.map((flow) => flow.covers)
      .join(" ")
      .toLowerCase();
    for (const keyword of [
      "sign-in",
      "watch",
      "render",
      "denial",
      "switch",
      "playback",
      "accessibility",
    ]) {
      expect(allCovers).toContain(keyword);
    }
  });
});

describe("W909 E2E recorder — assertion + outcome accounting", () => {
  /** Mirrors the runner: a hard failure throws (flow aborts), record kept. */
  function outcomeOf(hardPass: boolean, softFails: number): FlowOutcome {
    const recorder = new FlowRecorder("x", "X");
    try {
      recorder.assert("hard", hardPass, "evidence");
    } catch {
      // the recorder keeps the failed record — the flow aborts after it
    }
    for (let i = 0; i < softFails; i += 1) recorder.check(`soft fail ${i}`, false, "evidence");
    return recorder.outcome();
  }

  test("a flow with all-passing assertions is a pass", () => {
    const recorder = new FlowRecorder("a", "A");
    recorder.assert("one", true, "e1");
    recorder.check("two", true, "e2");
    const outcome = recorder.outcome();
    expect(outcome.status).toBe("passed");
    expect(outcome.assertions).toHaveLength(2);
  });

  test("a failing HARD assertion throws (the flow aborts) and the outcome is failed", () => {
    const recorder = new FlowRecorder("a", "A");
    expect(() => recorder.assert("boom", false, "the evidence")).toThrow(/boom/);
    expect(recorder.outcome().status).toBe("failed");
    expect(recorder.outcome().assertions[0]!.pass).toBe(false);
  });

  test("a failing SOFT check records and continues", () => {
    const recorder = new FlowRecorder("a", "A");
    expect(recorder.check("soft", false, "e")).toBe(false);
    recorder.assert("later still runs", true, "e");
    expect(recorder.outcome().status).toBe("failed");
    expect(recorder.outcome().assertions).toHaveLength(2);
  });

  test("summarizeRun counts flows and assertions and sets the exit code", () => {
    const clean = summarizeRun([outcomeOf(true, 0), outcomeOf(true, 0)]);
    expect(clean).toEqual({ passed: 2, failed: 0, assertions: { pass: 2, fail: 0 }, exitCode: 0 });

    const dirty = summarizeRun([outcomeOf(true, 0), outcomeOf(false, 2)]);
    expect(dirty.passed).toBe(1);
    expect(dirty.failed).toBe(1);
    expect(dirty.assertions).toEqual({ pass: 1, fail: 3 });
    expect(dirty.exitCode).toBe(1);
  });

  test("an aborted flow with zero recorded assertions is FAILED (never a vacuous pass)", () => {
    // The real run hit exactly this: a browser crash before the first
    // assertion must not count as passed via `[].every() === true`.
    const recorder = new FlowRecorder("a", "A");
    recorder.abort("browser error");
    const outcome = recorder.outcome();
    expect(outcome.assertions).toHaveLength(0);
    expect(outcome.status).toBe("failed");
    expect(summarizeRun([outcome]).exitCode).toBe(1);
  });

  test("an aborted flow with ALREADY-PASSING assertions is FAILED (no partial pass)", () => {
    // The other real shape (run mu3v0hdl): a browser element-not-found
    // error mid-flow after passing assertions must not count as passed
    // just because every RECORDED assertion happened to pass — the flow
    // never reached its verdict.
    const recorder = new FlowRecorder("a", "A");
    recorder.assert("passed before the crash", true, "e");
    recorder.abort("agent-browser get attr … failed: Element not found");
    const outcome = recorder.outcome();
    expect(outcome.status).toBe("failed");
    expect(outcome.assertions).toHaveLength(1);
    expect(outcome.assertions[0]!.pass).toBe(true);
    expect(outcome.notes.join(" ")).toContain("FLOW ABORTED");
    expect(summarizeRun([outcome]).exitCode).toBe(1);
    expect(summarizeRun([outcome]).failed).toBe(1);
  });

  test("notes and screenshots ride along in the outcome", () => {
    const recorder = new FlowRecorder("a", "A");
    recorder.note("a note");
    recorder.screenshots.push("shot.png");
    const outcome = recorder.outcome();
    expect(outcome.notes).toEqual(["a note"]);
    expect(outcome.screenshots).toEqual(["shot.png"]);
  });
});

describe("W909 driver click machinery — the covered-click settle math", () => {
  // The observed real failure: agent-browser REFUSED the .player-toggle
  // click because the sticky .site-header-inner covered its click point
  // while the page's CSS smooth-scroll was still settling.
  test("isCoveredByRefusal matches the CLI's real refusal wording only", () => {
    const real =
      "agent-browser click .player-toggle failed: ✗ Element '.player-toggle' is covered by <div.site-header-inner> at its click point, so the input would land on that element instead.";
    expect(isCoveredByRefusal(real)).toBe(true);
    expect(isCoveredByRefusal("element is covered by something")).toBe(false);
    expect(isCoveredByRefusal("Element '.x' not found")).toBe(false);
    expect(isCoveredByRefusal("timeout waiting for selector")).toBe(false);
  });

  test("coveringNudgeDelta scrolls the target clear below a sticky top header", () => {
    // Header occupies viewport [0..60]; the toggle's top is at 40 — under it.
    // The nudge must be NEGATIVE (scroll up ⇒ the target moves down-screen)
    // and large enough to clear the header's bottom edge + margin.
    const delta = coveringNudgeDelta({ top: 40 }, { bottom: 60 });
    expect(delta).toBe(40 - 60 - COVERING_NUDGE_MARGIN);
    expect(delta).toBeLessThan(0);
    // After scrollBy(delta): the target's top = 40 - delta = header bottom + margin.
    expect(40 - delta).toBe(60 + COVERING_NUDGE_MARGIN);
  });

  test("coveringNudgeDelta shrinks toward zero as the target clears the cover", () => {
    expect(coveringNudgeDelta({ top: 200 }, { bottom: 60 })).toBe(200 - 60 - COVERING_NUDGE_MARGIN);
    // A custom margin is honored (the driver's page-side twin uses the same constant).
    expect(coveringNudgeDelta({ top: 40 }, { bottom: 60 }, 4)).toBe(-24);
  });
});

describe("W909 a11y smoke — the WCAG contrast math", () => {
  test("parseCssColor handles hex, rgb and rgba", () => {
    expect(parseCssColor("#fff")).toEqual([255, 255, 255, 1]);
    expect(parseCssColor("#0a141f")).toEqual([10, 20, 31, 1]);
    expect(parseCssColor("rgb(1, 2, 3)")).toEqual([1, 2, 3, 1]);
    expect(parseCssColor("rgba(1, 2, 3, 0.5)")).toEqual([1, 2, 3, 0.5]);
    expect(parseCssColor("garbage")).toBeNull();
  });

  test("relativeLuminance is the WCAG curve (black 0, white 1)", () => {
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 6);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 6);
  });

  test("contrastRatio knows the canonical pairs", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
    expect(contrastRatio("#777777", "#ffffff")!).toBeLessThan(WCAG_AA_NORMAL);
    expect(contrastRatio("#101010", "#f5f2ea")!).toBeGreaterThan(WCAG_AA_NORMAL);
    expect(contrastRatio("nope", "#ffffff")).toBeNull();
  });

  test("the shell's own palette pairs clear WCAG AA for normal text", () => {
    // The night-stadium canvas (globals.css :root): body text on the canvas
    // and the dim hint text — the pairs the a11y smoke spot-checks at
    // runtime against what the browser actually renders.
    expect(meetsWcagAaNormal(contrastRatio("#e9eefb", "#0a0e18")!)).toBe(true);
    expect(meetsWcagAaNormal(contrastRatio("#a7b3cd", "#0a0e18")!)).toBe(true);
    // The light theme's paper pair.
    expect(meetsWcagAaNormal(contrastRatio("#0a0e18", "#f2f5fa")!)).toBe(true);
    // A same-value pair must NOT pass (the boundary honesty check).
    expect(meetsWcagAaNormal(contrastRatio("#101624", "#0a0e18")!)).toBe(false);
  });
});

describe("L015-L017 live gates — the measurement instrument (the pure model)", () => {
  // The percentile formula is the EXACT replica of
  // packages/latency-benchmark/src/percentiles.ts (W306 nearest-rank):
  // pinned here against that module's own documented examples.
  test("nearestRankPercentile matches the W306 original's documented examples", () => {
    const oneToHundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(nearestRankPercentile(oneToHundred, 50)).toBe(50);
    expect(nearestRankPercentile(oneToHundred, 95)).toBe(95);
    // 20 samples: rank(95) = ceil(19) = 19 → the 19th of 20 sorted samples.
    const twenty = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(nearestRankPercentile(twenty, 95)).toBe(19);
    expect(nearestRankPercentile(twenty, 50)).toBe(10);
    // One sample: every percentile is that sample.
    expect(nearestRankPercentile([42], 50)).toBe(42);
    expect(nearestRankPercentile([42], 95)).toBe(42);
  });

  test("nearestRankPercentile fails loud on empty or malformed input (never a silent 0)", () => {
    expect(() => nearestRankPercentile([], 50)).toThrow();
    expect(() => nearestRankPercentile([1, 2], 0)).toThrow();
    expect(() => nearestRankPercentile([1, 2], 101)).toThrow();
    expect(() => nearestRankPercentile([1, -5, 2], 50)).toThrow();
    // Unsorted input is sorted internally (the same trace in, same out).
    // nearest-rank p50 of [1,3,5,9]: rank = ceil(0.5·4) = 2 → the 2nd sample.
    expect(nearestRankPercentile([9, 1, 5, 3], 50)).toBe(3);
  });

  test("measuredLatencyStats summarizes count/min/max/p50/p95", () => {
    const stats = measuredLatencyStats([4, 1, 3, 2, 5]);
    expect(stats.count).toBe(5);
    expect(stats.minMs).toBe(1);
    expect(stats.maxMs).toBe(5);
    expect(stats.p50Ms).toBe(3);
    expect(stats.p95Ms).toBe(5);
    expect(() => measuredLatencyStats([])).toThrow();
  });

  test("interArrivalIntervals + cadenceVerdict + medianWithinTolerance model the cadence audit", () => {
    expect(interArrivalIntervals([1000])).toEqual([]);
    expect(interArrivalIntervals([1000, 1500, 2000, 2500])).toEqual([500, 500, 500]);
    const verdict = cadenceVerdict([400, 520, 480, 600]);
    expect(verdict.samples).toBe(4);
    // nearest-rank median of [400,480,520,600] = 480 (rank 2).
    expect(verdict.medianIntervalMs).toBe(480);
    expect(verdict.minIntervalMs).toBe(400);
    expect(verdict.maxIntervalMs).toBe(600);
    // The tolerance decision stays with the caller: 480 vs declared 500 at
    // ±10% holds; 480 vs 5000 never holds; no samples never holds.
    expect(medianWithinTolerance(480, 500, 0.1)).toBe(true);
    expect(medianWithinTolerance(480, 5000, 0.45)).toBe(false);
    expect(medianWithinTolerance(null, 500, 0.45)).toBe(false);
  });

  const frame = (overrides: Partial<CapturedWorldFrame>): CapturedWorldFrame => ({
    sessionId: "sess-live",
    ordinal: 1,
    worldVersion: 1,
    eventTimeMs: 100,
    generatedAtMs: 1_000,
    sourceSequence: 1,
    quality: "nominal",
    entities: [
      { entityRef: "ball-1", kind: "BALL", xMeters: 5, yMeters: 5, detected: true },
      { entityRef: "p-home-1", kind: "PLAYER", xMeters: 10, yMeters: 20, detected: true },
    ],
    frameEvents: [],
    receivedAtMs: 1_010,
    ...overrides,
  });

  test("auditIdentityContinuity: a stable entityRef set audits clean (0 switches)", () => {
    const frames = [
      frame({ worldVersion: 1 }),
      frame({
        worldVersion: 2,
        entities: [
          { entityRef: "ball-1", kind: "BALL", xMeters: 6, yMeters: 6, detected: true },
          { entityRef: "p-home-1", kind: "PLAYER", xMeters: 11, yMeters: 21, detected: true },
        ],
      }),
      frame({ worldVersion: 3 }),
    ];
    const audit = auditIdentityContinuity(frames);
    expect(audit.framesAudited).toBe(3);
    expect(audit.entitiesTracked).toBe(2);
    expect(audit.switches).toEqual([]);
    expect(audit.lateAppearances).toEqual([]);
  });

  test("auditIdentityContinuity: a late appearance is only honest WITH an event; a kind change is a switch", () => {
    const frames = [
      frame({
        worldVersion: 1,
        entities: [
          { entityRef: "p-home-1", kind: "PLAYER", xMeters: 10, yMeters: 20, detected: true },
        ],
      }),
      // An entity appears at frame 1 WITH the honest entity-appeared event.
      frame({
        worldVersion: 2,
        entities: [
          { entityRef: "p-home-1", kind: "PLAYER", xMeters: 10, yMeters: 20, detected: true },
          { entityRef: "p-away-2", kind: "PLAYER", xMeters: 30, yMeters: 20, detected: true },
        ],
        frameEvents: [{ type: "entity-appeared", atMs: 200, detail: { entityRef: "p-away-2" } }],
      }),
      // A re-identification: the ball appears LATE without an event AND a
      // ref changes kind — both are switch-class problems.
      frame({
        worldVersion: 3,
        entities: [
          { entityRef: "p-home-1", kind: "REFEREE", xMeters: 10, yMeters: 20, detected: true },
          { entityRef: "p-away-2", kind: "PLAYER", xMeters: 30, yMeters: 20, detected: true },
        ],
      }),
    ];
    const audit = auditIdentityContinuity(frames);
    // p-home-1's kind change PLAYER→REFEREE is an unexplained switch.
    expect(audit.switches).toHaveLength(1);
    expect(audit.switches[0]!.entityRef).toBe("p-home-1");
    expect(audit.switches[0]!.problem).toContain("kind changed");
  });

  test("positionDeltaStats measures consecutive movement (the meaningful-change threshold input)", () => {
    const frames = [
      frame({
        entities: [{ entityRef: "ball-1", kind: "BALL", xMeters: 0, yMeters: 0, detected: true }],
      }),
      frame({
        entities: [{ entityRef: "ball-1", kind: "BALL", xMeters: 3, yMeters: 4, detected: true }],
      }),
      frame({
        entities: [{ entityRef: "ball-1", kind: "BALL", xMeters: 3, yMeters: 4, detected: false }],
      }),
    ];
    const stats = positionDeltaStats(frames, "ball-1")!;
    expect(stats.samples).toBe(2);
    expect(stats.maxDeltaMeters).toBe(5);
    expect(stats.meanDeltaMeters).toBe(2.5);
    expect(positionDeltaStats(frames.slice(0, 1), "ball-1")).toBeNull();
    expect(positionDeltaStats(frames, "ball-404")).toBeNull();
  });

  test("findRecoveryAccounting + sourceSequenceGaps read the honest gap accounting", () => {
    const frames = [
      frame({ worldVersion: 1, sourceSequence: 1 }),
      frame({ worldVersion: 2, sourceSequence: 2 }),
      frame({
        worldVersion: 3,
        sourceSequence: 11,
        frameEvents: [
          { type: "source-recovery", atMs: 1100, detail: { missedUpdates: 8, gapDurationMs: 800 } },
        ],
      }),
      frame({ worldVersion: 4, sourceSequence: 12 }),
    ];
    const recovery = findRecoveryAccounting(frames);
    expect(recovery).toEqual({ frameIndex: 2, missedUpdates: 8, gapDurationMs: 800 });
    expect(findRecoveryAccounting(frames.slice(0, 2))).toBeNull();
    // The drop scenario's visible per-tick gaps: seq 2 → 11 is 8 lost ticks.
    expect(sourceSequenceGaps(frames)).toEqual([{ afterFrameIndex: 1, gap: 8 }]);
    expect(sourceSequenceGaps(frames.slice(0, 2))).toEqual([]);
  });

  test("determinismFingerprint: the same seeded sequence fingerprints identically", () => {
    const a = [
      frame({ worldVersion: 1, eventTimeMs: 100, sourceSequence: 1 }),
      frame({ worldVersion: 2, eventTimeMs: 200, sourceSequence: 2 }),
    ];
    const b = [
      frame({ worldVersion: 1, eventTimeMs: 100, sourceSequence: 1 }),
      frame({ worldVersion: 2, eventTimeMs: 200, sourceSequence: 2 }),
    ];
    const c = [
      frame({ worldVersion: 1, eventTimeMs: 100, sourceSequence: 1 }),
      frame({ worldVersion: 2, eventTimeMs: 201, sourceSequence: 2 }),
    ];
    expect(determinismFingerprint(a)).toBe("v1@100#seq1 v2@200#seq2");
    expect(determinismFingerprint(a)).toBe(determinismFingerprint(b));
    expect(determinismFingerprint(a)).not.toBe(determinismFingerprint(c));
  });

  test("the live-source finders resolve the scenario and finite sessions from the product listing", () => {
    const listing: LiveSourceRow[] = [
      {
        sessionId: "sess-story",
        label: "Derby night at Kings Park",
        storyKey: "derby",
        sourceKind: "story",
      },
      {
        sessionId: "sess-normal",
        label: "Synthetic live tracking — normal delivery",
        storyKey: "live-tactical-synthetic",
        sourceKind: "tactical",
        sourceNote: "every tick delivered in order",
      },
      {
        sessionId: "sess-reconnect",
        label: "Synthetic live tracking — reconnect",
        storyKey: "live-tactical-synthetic",
        sourceKind: "tactical",
      },
      {
        sessionId: "sess-drop",
        label: "Synthetic live tracking — scattered drops",
        storyKey: "live-tactical-synthetic",
        sourceKind: "tactical",
      },
      {
        sessionId: "sess-finite",
        label: "Synthetic live tracking — finite window + replay",
        storyKey: "live-tactical-synthetic",
        sourceKind: "tactical",
        finiteWindow: true,
      },
    ];
    expect(scenarioSourceOf(listing, "normal")?.sessionId).toBe("sess-normal");
    expect(scenarioSourceOf(listing, "reconnect")?.sessionId).toBe("sess-reconnect");
    // The drop scenario is listed as "scattered drops" — the fragment map
    // must match the dev seed's REAL labels (a mismatch fails gates loud).
    expect(scenarioSourceOf(listing, "drop")?.sessionId).toBe("sess-drop");
    // The finite session is NOT a scenario session (and vice versa).
    expect(scenarioSourceOf(listing, "normal")?.finiteWindow).toBeFalsy();
    expect(finiteSourceOf(listing)?.sessionId).toBe("sess-finite");
    expect(scenarioSourceOf(listing, "jitter")).toBeNull();
    expect(finiteSourceOf(listing.filter((row) => row.sessionId !== "sess-finite"))).toBeNull();
  });

  test("the scenario finder accepts the full L002 vocabulary (the finders stay total)", () => {
    // Every scenario kind resolves against a listing that carries the dev
    // seed's own exact label strings (the same strings /api/live serves).
    const fullListing: LiveSourceRow[] = [
      {
        sessionId: "sess-normal",
        label: "Synthetic live tracking — normal delivery",
        storyKey: "live-tactical-synthetic",
        sourceKind: "tactical",
      },
      {
        sessionId: "sess-jitter",
        label: "Synthetic live tracking — jitter",
        storyKey: "live-tactical-synthetic",
        sourceKind: "tactical",
      },
      {
        sessionId: "sess-delay",
        label: "Synthetic live tracking — delay window",
        storyKey: "live-tactical-synthetic",
        sourceKind: "tactical",
      },
      {
        sessionId: "sess-drop",
        label: "Synthetic live tracking — scattered drops",
        storyKey: "live-tactical-synthetic",
        sourceKind: "tactical",
      },
      {
        sessionId: "sess-ooo",
        label: "Synthetic live tracking — out-of-order",
        storyKey: "live-tactical-synthetic",
        sourceKind: "tactical",
      },
      {
        sessionId: "sess-reconnect",
        label: "Synthetic live tracking — reconnect",
        storyKey: "live-tactical-synthetic",
        sourceKind: "tactical",
      },
    ];
    for (const scenario of [
      "normal",
      "jitter",
      "delay",
      "drop",
      "out-of-order",
      "reconnect",
    ] as const) {
      expect(scenarioSourceOf(fullListing, scenario)?.sessionId).toBe(
        `sess-${scenario === "out-of-order" ? "ooo" : scenario}`,
      );
    }
  });
});
