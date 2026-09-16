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
import { ROUTE_PATHS } from "@/lib/navigation";

describe("W909 E2E inventory — the acceptance coverage model", () => {
  test("every acceptance flow id has exactly one spec", () => {
    expect(E2E_FLOW_IDS).toHaveLength(E2E_FLOW_INVENTORY.length);
    const ids = new Set(E2E_FLOW_INVENTORY.map((flow) => flow.id));
    expect(ids.size).toBe(E2E_FLOW_INVENTORY.length);
    for (const id of E2E_FLOW_IDS) expect(ids.has(id)).toBe(true);
  });

  test("each flow names its W909 acceptance line and reaches only real shell routes", () => {
    for (const flow of E2E_FLOW_INVENTORY) {
      expect(flow.covers).toContain("W909");
      expect(flow.routes.length).toBeGreaterThan(0);
      expect(flow.title.length).toBeGreaterThan(0);
    }
    expect(unknownInventoryRoutes()).toEqual([]);
  });

  test("the route availability model fails closed on an unknown route", () => {
    expect(unknownInventoryRoutes([{ id: "sign-in", title: "t", covers: "W909: x", routes: ["/nope"] }])).toEqual([
      "sign-in: /nope",
    ]);
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
    const allCovers = E2E_FLOW_INVENTORY.map((flow) => flow.covers).join(" ").toLowerCase();
    for (const keyword of ["sign-in", "watch", "render", "denial", "switch", "playback", "accessibility"]) {
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
    expect(coveringNudgeDelta({ top: 200 }, { bottom: 60 })).toBe(
      200 - 60 - COVERING_NUDGE_MARGIN,
    );
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
