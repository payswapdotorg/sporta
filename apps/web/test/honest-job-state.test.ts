/**
 * THE HONEST JOB-STATE MAPPING BOUNDARY TESTS (R502) — pinning that every
 * VISIBLE state maps 1:1 to the control plane's REAL job projection:
 *
 * - every member of the closed W914 vocabulary has its OWN pinned
 *   presentation (phase + label + terminal), distinct per state — no two
 *   states present identically, no state presents as another;
 * - cancellation is a FIRST-CLASS phase (never "failed", never a generic
 *   spinner), and dead-lettering is distinct from plain failure;
 * - the honest boundary marker (`unreadable`) presents as unreadable —
 *   never a guessed state, never claimed as in-flight;
 * - progress is the METERED fraction ONLY (the last real progress event /
 *   the media stage table) — `null` when nothing was metered, never an
 *   invented number;
 * - the typed failure reasons are carried VERBATIM (error class + message
 *   + terminal disposition, exactly as the server reported them);
 * - an unknown state NEVER presents as a known one (fail-closed).
 */
import { describe, expect, test } from "bun:test";
import {
  HONEST_COMPUTE_STATES,
  HONEST_TERMINAL_STATES,
  HONEST_UNREADABLE_STATE,
  chipStateOf,
  honestComputePresentationOf,
  honestComputeProgressOf,
  honestFailureLineOf,
  honestMediaFailureLineOf,
  honestMediaPresentationOf,
  honestMediaProgressOf,
} from "../src/lib/honest-job-state";

describe("the closed vocabulary (R502: every visible state is a server state)", () => {
  test("the W914 vocabulary is exactly the eight control-plane states", () => {
    expect([...HONEST_COMPUTE_STATES]).toEqual([
      "admitted",
      "dispatched",
      "queued",
      "in-flight",
      "succeeded",
      "failed",
      "cancelled",
      "dead-lettered",
    ]);
    expect([...HONEST_TERMINAL_STATES]).toEqual([
      "succeeded",
      "failed",
      "cancelled",
      "dead-lettered",
    ]);
  });
});

describe("honestComputePresentationOf (each state's pinned presentation)", () => {
  test("every closed-vocabulary state has its OWN pinned presentation", () => {
    const seen = new Map<string, ReturnType<typeof honestComputePresentationOf>>();
    for (const state of HONEST_COMPUTE_STATES) {
      const view = honestComputePresentationOf(state);
      expect(view.state).toBe(state);
      expect(view.known).toBe(true);
      expect(view.label.length).toBeGreaterThan(0);
      // 1:1: no two states share a presentation (phase+label pair).
      const key = `${view.phase}|${view.label}`;
      expect(seen.has(key)).toBe(false);
      seen.set(key, view);
    }
  });

  test("the live states present as processing and NOT terminal", () => {
    for (const state of ["admitted", "dispatched", "queued", "in-flight"] as const) {
      const view = honestComputePresentationOf(state);
      expect(view.phase).toBe("processing");
      expect(view.terminal).toBe(false);
    }
  });

  test("succeeded presents as ready; terminal is exactly the four dispositions", () => {
    const view = honestComputePresentationOf("succeeded");
    expect(view.phase).toBe("ready");
    expect(view.terminal).toBe(true);
    for (const state of HONEST_TERMINAL_STATES) {
      expect(honestComputePresentationOf(state).terminal).toBe(true);
    }
    for (const state of ["admitted", "dispatched", "queued", "in-flight"] as const) {
      expect(honestComputePresentationOf(state).terminal).toBe(false);
    }
  });

  test("R502: cancellation is a FIRST-CLASS phase — never failed, never generic", () => {
    const view = honestComputePresentationOf("cancelled");
    expect(view.phase).toBe("cancelled");
    expect(view.terminal).toBe(true);
    expect(view.label).toContain("cancelled");
    expect(chipStateOf(view)).toBe("cancelled");
  });

  test("failed and dead-lettered are distinct failed presentations", () => {
    const failed = honestComputePresentationOf("failed");
    const dead = honestComputePresentationOf("dead-lettered");
    expect(failed.phase).toBe("failed");
    expect(dead.phase).toBe("failed");
    expect(failed.label).not.toBe(dead.label);
    expect(dead.label).toContain("dead-lettered");
    expect(chipStateOf(failed)).toBe("failed");
    expect(chipStateOf(dead)).toBe("failed");
  });

  test("the honest boundary marker presents as unreadable — never a guessed state", () => {
    const view = honestComputePresentationOf(HONEST_UNREADABLE_STATE);
    expect(view.phase).toBe("unreadable");
    expect(view.terminal).toBe(true);
    expect(view.label).toContain("could not be read");
    expect(view.label).not.toContain("Rendering");
    expect(chipStateOf(view)).toBe("unavailable");
  });

  test("an unknown state NEVER presents as a known one (fail-closed)", () => {
    const view = honestComputePresentationOf("mysterious-state");
    expect(view.known).toBe(false);
    expect(view.phase).toBe("failed");
    expect(view.terminal).toBe(true);
    expect(view.label).toContain("mysterious-state");
    expect(view.label).toContain("fail-closed");
    expect(chipStateOf(view)).toBe("unavailable"); // distinct from a REAL failure
  });

  test("the mapping is deterministic (same input → same output)", () => {
    for (let i = 0; i < 3; i += 1) {
      expect(honestComputePresentationOf("in-flight")).toEqual(
        honestComputePresentationOf("in-flight"),
      );
    }
  });
});

describe("honestMediaPresentationOf (the media pipeline's states, media labels)", () => {
  test("every closed-vocabulary state maps with a media-pipeline label", () => {
    for (const state of HONEST_COMPUTE_STATES) {
      const view = honestMediaPresentationOf(state);
      expect(view.state).toBe(state);
      expect(view.known).toBe(true);
      expect(view.phase).toBe(honestComputePresentationOf(state).phase);
      expect(view.terminal).toBe(honestComputePresentationOf(state).terminal);
    }
    expect(honestMediaPresentationOf("in-flight").label).toContain("Normalizing");
    expect(honestMediaPresentationOf("succeeded").label).toContain("stored");
    expect(honestMediaPresentationOf("cancelled").phase).toBe("cancelled");
  });
});

describe("honestComputeProgressOf (metered fractions ONLY — never interpolated)", () => {
  test("no progress events → null (never an invented number)", () => {
    expect(honestComputeProgressOf({ events: [] })).toBeNull();
    expect(
      honestComputeProgressOf({ events: [{ type: "admitted" }, { type: "claimed" }] }),
    ).toBeNull();
  });

  test("the LAST real progress fraction wins; non-progress events never count", () => {
    expect(
      honestComputeProgressOf({
        events: [
          { type: "progress", fraction: 0.25 },
          { type: "progress", fraction: 0.5 },
          { type: "note" },
        ],
      }),
    ).toBe(0.5);
  });
});

describe("honestMediaProgressOf (the stage table's own derived fraction)", () => {
  test("an empty stage table → null; otherwise the last stage's fraction", () => {
    expect(honestMediaProgressOf({ stages: [] })).toBeNull();
    expect(
      honestMediaProgressOf({
        stages: [
          { stage: "created", atMs: 1, fraction: 0 },
          { stage: "upload-complete", atMs: 2, fraction: 1 / 3 },
        ],
      }),
    ).toBeCloseTo(1 / 3, 5);
  });
});

describe("the typed failure reasons (carried VERBATIM from the server)", () => {
  test("the compute failure line carries errorClass + message + terminal verbatim", () => {
    expect(
      honestFailureLineOf({
        errorClass: "render-refused",
        message: "renderer rejected the request: style unknown",
        terminal: "non-retryable",
      }),
    ).toBe(
      "render-refused: renderer rejected the request: style unknown (terminal: non-retryable)",
    );
  });

  test("the media failure line carries failureClass + message verbatim", () => {
    expect(
      honestMediaFailureLineOf({
        failureClass: "resource-limit",
        message: "decode budget exceeded",
      }),
    ).toBe("resource-limit: decode budget exceeded");
  });
});
