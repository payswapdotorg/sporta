/**
 * The normative funnel-table pins (W804): the constant tables in
 * `src/funnel.ts` ARE the funnel definition (FUNNEL.md §4–§5), so every
 * structural property is pinned here — stages/evidence round-trip against
 * the REAL W706 status vocabulary, boundary adjacency along the two spines,
 * closed attribution kinds, the owner-note table's totality, and the
 * failure-class vocabulary's identity with the viewer model.
 */
import { describe, expect, test } from "bun:test";
import {
  BATCH_STAGES,
  BOUNDARIES,
  FAILURE_CLASSES,
  FUNNEL_SPEC_VERSION,
  FUNNEL_STAGE_IDS,
  LIVE_STAGES,
  OWNER_NOTES,
  STAGE_EVIDENCE_TARGET,
  isEstablishmentEvidence,
  stageOfTransitionTarget,
} from "../src/funnel.ts";
import type { DropOffAttributionKind, FunnelBoundary } from "../src/funnel.ts";
import {
  TELEMETRY_OPERATIONS,
  TELEMETRY_VIEWER_STATUSES,
  VIEWER_FAILURE_CLASSES,
} from "@sporta/viewer-shell";

describe("the stage set and its evidence", () => {
  test("the closed stage set (7 ids, verbatim)", () => {
    expect(FUNNEL_STAGE_IDS).toEqual([
      "session-engaged",
      "renderer-selection",
      "render-requested",
      "output-ready",
      "batch-playing",
      "live-requested",
      "live-playing",
    ]);
  });

  test("every stage's evidence target is a REAL viewer status (the W706 vocabulary)", () => {
    for (const stage of FUNNEL_STAGE_IDS) {
      expect(TELEMETRY_VIEWER_STATUSES).toContain(STAGE_EVIDENCE_TARGET[stage]);
    }
  });

  test("stageOfTransitionTarget inverts the evidence table exactly (no extra stage statuses)", () => {
    const stageTargets = new Set(FUNNEL_STAGE_IDS.map((stage) => STAGE_EVIDENCE_TARGET[stage]));
    expect(stageTargets.size).toBe(FUNNEL_STAGE_IDS.length); // the map is injective
    for (const status of TELEMETRY_VIEWER_STATUSES) {
      const stage = stageOfTransitionTarget(status);
      if (stage !== null) {
        expect(STAGE_EVIDENCE_TARGET[stage]).toBe(status);
      } else {
        expect(stageTargets.has(status)).toBe(false);
      }
    }
  });

  test("the documented non-stage statuses are exactly the null-mapped ones", () => {
    const nonStage = TELEMETRY_VIEWER_STATUSES.filter(
      (status) => stageOfTransitionTarget(status) === null,
    );
    expect(nonStage).toEqual([
      "disconnected",
      "connecting",
      "browsing-sessions",
      "loading-output",
      "outputs-pending",
      "paused",
      "ended",
      "live-reconnecting",
      "live-ended",
      "error",
    ]);
  });

  test("the batch spine and the live branch, in order, sharing the first stage", () => {
    expect(BATCH_STAGES).toEqual([
      "session-engaged",
      "renderer-selection",
      "render-requested",
      "output-ready",
      "batch-playing",
    ]);
    expect(LIVE_STAGES).toEqual(["session-engaged", "live-requested", "live-playing"]);
    expect(BATCH_STAGES[0]).toBe(LIVE_STAGES[0]);
  });

  test("establishment evidence is exactly the openSession success transition", () => {
    expect(isEstablishmentEvidence("browsing-sessions", "session-detail")).toBe(true);
    expect(isEstablishmentEvidence("connecting", "session-detail")).toBe(false);
    expect(isEstablishmentEvidence("browsing-sessions", "renderer-selection")).toBe(false);
  });

  test("the funnel spec is versioned", () => {
    expect(FUNNEL_SPEC_VERSION).toBe(1);
  });
});

describe("the boundary table", () => {
  /** The session-scope boundaries must advance along one of the two spines. */
  function adjacentInSpine(from: string, to: string): boolean {
    const spines: readonly string[][] = [BATCH_STAGES as string[], LIVE_STAGES as string[]];
    return spines.some(
      (spine) => spine.indexOf(from) !== -1 && spine.indexOf(to) === spine.indexOf(from) + 1,
    );
  }

  test("eight boundaries with unique ids, in the documented order", () => {
    expect(BOUNDARIES.map((boundary) => boundary.id)).toEqual([
      "viewer→connected",
      "connected→session-engaged",
      "session-engaged→renderer-selection",
      "renderer-selection→render-requested",
      "render-requested→output-ready",
      "output-ready→batch-playing",
      "session-engaged→live-requested",
      "live-requested→live-playing",
    ]);
  });

  test("every boundary's error operations are entries of the REAL W706 operation vocabulary", () => {
    for (const boundary of BOUNDARIES) {
      for (const operation of boundary.boundaryOperations) {
        expect(TELEMETRY_OPERATIONS).toContain(operation);
      }
    }
  });

  test("session-scope boundaries advance along a spine; viewer-scope boundaries are the pre-session seam", () => {
    for (const boundary of BOUNDARIES) {
      if (boundary.scope === "session") {
        expect(boundary.fromStage).not.toBe("viewer");
        expect(boundary.fromStage).not.toBe("connected");
        expect(adjacentInSpine(boundary.fromStage, boundary.toStage)).toBe(true);
      } else {
        expect(
          boundary.fromStage === "viewer" || boundary.fromStage === "connected",
          `viewer boundary ${boundary.id} must sit in the pre-session seam`,
        ).toBe(true);
        expect(boundary.toStage).not.toBe("viewer");
      }
    }
  });

  test("every named attribution is one of the closed kinds; the honest catch-all is always last", () => {
    const closed: readonly DropOffAttributionKind[] = [
      "error",
      "live-path-taken",
      "batch-path-taken",
      "outputs-pending",
      "load-in-progress",
      "selection-cancelled",
      "no-error-observed",
    ];
    for (const boundary of BOUNDARIES) {
      for (const kind of boundary.namedAttributions) {
        expect(closed).toContain(kind);
      }
      const last = boundary.namedAttributions[boundary.namedAttributions.length - 1];
      if (boundary.namedAttributions.length > 0) {
        expect(last).toBe("no-error-observed");
      }
    }
  });

  test("the session-engaged→renderer-selection boundary carries BOTH path-taken kinds (the skip-path honesty)", () => {
    const boundary = BOUNDARIES.find(
      (entry) => entry.id === "session-engaged→renderer-selection",
    ) as FunnelBoundary;
    expect(boundary.namedAttributions).toEqual([
      "live-path-taken",
      "batch-path-taken",
      "no-error-observed",
    ]);
    expect(boundary.boundaryOperations).toEqual(["beginRender"]);
  });

  test("the two no-operations boundaries are the documented local-command seams", () => {
    const dispatch = BOUNDARIES.find(
      (entry) => entry.id === "renderer-selection→render-requested",
    ) as FunnelBoundary;
    const play = BOUNDARIES.find(
      (entry) => entry.id === "output-ready→batch-playing",
    ) as FunnelBoundary;
    expect(dispatch.boundaryOperations).toEqual([]);
    expect(dispatch.namedAttributions).toEqual(["selection-cancelled", "no-error-observed"]);
    expect(play.boundaryOperations).toEqual([]);
    expect(play.namedAttributions).toEqual(["no-error-observed"]);
  });

  test("the live boundaries carry openLive (the W704 rights pre-check fails at the request boundary)", () => {
    const request = BOUNDARIES.find(
      (entry) => entry.id === "session-engaged→live-requested",
    ) as FunnelBoundary;
    const attach = BOUNDARIES.find(
      (entry) => entry.id === "live-requested→live-playing",
    ) as FunnelBoundary;
    expect(request.boundaryOperations).toEqual(["openLive"]);
    expect(attach.boundaryOperations).toEqual(["openLive"]);
  });

  test("the viewer boundaries count the connect and session-open operations", () => {
    const connect = BOUNDARIES.find((entry) => entry.id === "viewer→connected") as FunnelBoundary;
    const open = BOUNDARIES.find(
      (entry) => entry.id === "connected→session-engaged",
    ) as FunnelBoundary;
    expect(connect.boundaryOperations).toEqual(["connect"]);
    expect(open.boundaryOperations).toEqual(["createSession", "openSession"]);
    expect(connect.scope).toBe("viewer");
    expect(open.scope).toBe("viewer");
  });
});

describe("the actionability tables", () => {
  test("the failure-class vocabulary is EXACTLY the viewer model's, in order (verbatim, never re-mapped)", () => {
    expect(FAILURE_CLASSES).toEqual(VIEWER_FAILURE_CLASSES);
    expect(FAILURE_CLASSES).toHaveLength(12);
  });

  test("OWNER_NOTES covers every failure class exactly, with non-empty owner pointers", () => {
    expect(Object.keys(OWNER_NOTES).sort()).toEqual([...VIEWER_FAILURE_CLASSES].sort());
    for (const note of Object.values(OWNER_NOTES)) {
      expect(note.length).toBeGreaterThan(0);
      expect(note).toMatch(/Owner:/);
    }
  });

  test("every owner note names a real owner (the actionable pointer, spot-checked)", () => {
    expect(OWNER_NOTES["rights-denied"]).toContain("product/policy");
    expect(OWNER_NOTES["unknown-segment"]).toContain("W504");
    expect(OWNER_NOTES["unsupported-output"]).toContain("W705");
    expect(OWNER_NOTES.network).toContain("deployment/network");
  });
});
