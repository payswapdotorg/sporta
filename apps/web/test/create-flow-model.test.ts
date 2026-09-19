import { describe, expect, test } from "bun:test";
import {
  capabilityLineOf,
  creationDeniedOf,
  emptyDraft,
  jobProgressOf,
  meteredFractionOf,
  rendererDispatchabilityOf,
  stepSatisfied,
  submissionVerdictOf,
} from "../src/lib/create-flow";
import type { RightsPreviewLike, StudioJobLike } from "../src/lib/api-types";

/**
 * CREATE FLOW MODEL TESTS (W906): the pure client-side mappings — job
 * states → progress presentation (the REAL compute-state vocabulary),
 * metered fractions (real progress events only), and the rights-preview
 * presentation over SERVER-derived capabilities. These functions never
 * invent rights or progress semantics; they map what the routes answered.
 */

function capabilitiesOf(
  overrides: Partial<RightsPreviewLike["capabilities"]>,
): RightsPreviewLike["capabilities"] {
  return {
    canReferenceSourceFrames: false,
    canDeliverLive: false,
    canStoreDerivatives: false,
    canShare: false,
    ...overrides,
  };
}

function previewOf(capabilities: RightsPreviewLike["capabilities"]): RightsPreviewLike {
  return {
    capabilities,
    sessionCreation: {
      allowed: !creationDeniedOf(capabilities),
      reason: creationDeniedOf(capabilities) ? "denied" : "allowed",
    },
    effects: [],
  };
}

function jobOf(events: StudioJobLike["events"], state = "in-flight"): StudioJobLike {
  return {
    jobId: "render-job-test-1",
    sessionId: "ms-test",
    state,
    events,
    ingest: { status: "pending" },
  };
}

describe("jobProgressOf (the real compute states → the studio's presentation)", () => {
  test("live states present as processing", () => {
    for (const state of ["admitted", "dispatched", "queued"]) {
      const view = jobProgressOf(state);
      expect(view.phase).toBe("processing");
      expect(view.terminal).toBe(false);
      expect(view.label).toContain("Queued");
    }
  });

  test("in-flight renders present as processing with the rendering label", () => {
    const view = jobProgressOf("in-flight");
    expect(view.phase).toBe("processing");
    expect(view.label).toContain("Rendering");
    expect(view.terminal).toBe(false);
  });

  test("succeeded presents as ready and terminal", () => {
    const view = jobProgressOf("succeeded");
    expect(view.phase).toBe("ready");
    expect(view.terminal).toBe(true);
    expect(view.label).toContain("complete");
  });

  test("the failure dispositions present as terminal with their own first-class phases", () => {
    for (const state of ["failed", "dead-lettered"]) {
      const view = jobProgressOf(state);
      expect(view.phase).toBe("failed");
      expect(view.terminal).toBe(true);
    }
    // R502: cancellation is a FIRST-CLASS phase — never a generic failed
    // spinner, never smoothed over.
    const cancelled = jobProgressOf("cancelled");
    expect(cancelled.phase).toBe("cancelled");
    expect(cancelled.terminal).toBe(true);
    expect(cancelled.label).toContain("cancelled");
    expect(jobProgressOf("dead-lettered").label).toContain("dead-lettered");
  });

  test("the honest boundary marker presents as unreadable — never a guessed state", () => {
    const view = jobProgressOf("unreadable");
    expect(view.phase).toBe("unreadable");
    expect(view.terminal).toBe(true);
    expect(view.label).toContain("could not be read");
  });

  test("an unknown state fails closed into the presentation (never smoothed over)", () => {
    const view = jobProgressOf("mysterious");
    expect(view.phase).toBe("failed");
    expect(view.terminal).toBe(true);
    expect(view.label).toContain("mysterious");
    expect(view.label).toContain("fail-closed");
  });
});

describe("meteredFractionOf (real progress events only)", () => {
  test("no metered events answer null — never an invented number", () => {
    expect(meteredFractionOf(jobOf([]))).toBeNull();
    expect(meteredFractionOf(jobOf([{ atMs: 1, type: "submitted" }]))).toBeNull();
  });

  test("the LAST metered fraction wins", () => {
    const job = jobOf([
      { atMs: 1, type: "submitted" },
      { atMs: 2, type: "progress", fraction: 0.25, stage: "rendering" },
      { atMs: 3, type: "progress", fraction: 0.75 },
      { atMs: 4, type: "succeeded" },
    ]);
    expect(meteredFractionOf(job)).toBe(0.75);
  });

  test("a terminal job keeps its last metered fraction (the record stays honest)", () => {
    const job = jobOf([{ atMs: 2, type: "progress", fraction: 0.5 }], "succeeded");
    expect(meteredFractionOf(job)).toBe(0.5);
  });
});

describe("creationDeniedOf + capabilityLineOf (server-derived capabilities)", () => {
  test("all-false capabilities deny creation", () => {
    expect(creationDeniedOf(capabilitiesOf({}))).toBe(true);
  });

  test("any single capability avoids the deny", () => {
    expect(creationDeniedOf(capabilitiesOf({ canShare: true }))).toBe(false);
    expect(creationDeniedOf(capabilitiesOf({ canDeliverLive: true }))).toBe(false);
    expect(creationDeniedOf(capabilitiesOf({ canStoreDerivatives: true }))).toBe(false);
    expect(creationDeniedOf(capabilitiesOf({ canReferenceSourceFrames: true }))).toBe(false);
  });

  test("the capability lines mirror the four derived capabilities", () => {
    const lines = capabilityLineOf(
      capabilitiesOf({ canReferenceSourceFrames: true, canStoreDerivatives: true }),
    );
    expect(lines).toHaveLength(4);
    expect(lines.find((line) => line.key === "canReferenceSourceFrames")!.allowed).toBe(true);
    expect(lines.find((line) => line.key === "canStoreDerivatives")!.allowed).toBe(true);
    expect(lines.find((line) => line.key === "canDeliverLive")!.allowed).toBe(false);
    expect(lines.find((line) => line.key === "canShare")!.allowed).toBe(false);
  });
});

describe("submissionVerdictOf (the honest submit gating)", () => {
  test("a derivation with nothing denies the submission", () => {
    const verdict = submissionVerdictOf(previewOf(capabilitiesOf({})));
    expect(verdict.state).toBe("denied");
    expect(verdict.warning).toBe("denied");
  });

  test("a render-capable policy without storage warns about playback denial", () => {
    const verdict = submissionVerdictOf(
      previewOf(capabilitiesOf({ canReferenceSourceFrames: true })),
    );
    expect(verdict.state).toBe("ready");
    expect(verdict.warning).toContain("cannot be previewed");
  });

  test("a fully-capable policy submits clean", () => {
    const verdict = submissionVerdictOf(
      previewOf(capabilitiesOf({ canReferenceSourceFrames: true, canStoreDerivatives: true })),
    );
    expect(verdict.state).toBe("ready");
    expect(verdict.warning).toBeNull();
  });
});

describe("rendererDispatchabilityOf (the honest artifact-handoff state)", () => {
  test("a renderer with the detailed surface is dispatchable", () => {
    const view = rendererDispatchabilityOf({
      rendererId: "anime.prototype",
      rendererVersion: "1",
      rendererClass: "stylized",
      requiresSourceFrames: false,
      supportedOutputProfiles: [],
      artifactHandoff: { supported: true, reason: "the W502 detailed surface" },
    });
    expect(view.state).toBe("ready");
    expect(view.reason).toContain("W502");
  });

  test("a renderer without it is unavailable with its real reason", () => {
    const view = rendererDispatchabilityOf({
      rendererId: "sporta.testcard",
      rendererVersion: "1",
      rendererClass: "reference",
      requiresSourceFrames: false,
      supportedOutputProfiles: [],
      artifactHandoff: {
        supported: false,
        reason: "renderer 'sporta.testcard' does not expose the W502 detailed render surface",
      },
    });
    expect(view.state).toBe("unavailable");
    expect(view.reason).toContain("W502");
  });
});

describe("the draft + step gating", () => {
  test("the empty draft starts at source with a transformation-forward default", () => {
    const draft = emptyDraft();
    expect(draft.sourceKey).toBeNull();
    expect(draft.file).toBeNull();
    expect(draft.sourceKind).toBe("upload");
    expect(draft.operations).toEqual([
      "analysis",
      "transformation",
      "derivativeGeneration",
      "storage",
    ]);
    expect(draft.sharingScope).toBe("private");
  });

  test("each step gates on what it actually needs", () => {
    const draft = emptyDraft();
    expect(stepSatisfied("source", draft)).toBe(false);
    expect(stepSatisfied("rights", draft)).toBe(true);
    expect(stepSatisfied("renderer", draft)).toBe(false);
    expect(stepSatisfied("recipe", draft)).toBe(false);
    const complete = {
      ...draft,
      sourceKind: "fixture" as const,
      sourceKey: "derby",
      rendererId: "anime.prototype",
      styleId: "my-style",
    };
    expect(stepSatisfied("source", complete)).toBe(true);
    expect(stepSatisfied("renderer", complete)).toBe(true);
    expect(stepSatisfied("recipe", complete)).toBe(true);
    expect(stepSatisfied("recipe", { ...complete, styleId: "  " })).toBe(false);
    expect(stepSatisfied("rights", { ...complete, operations: [] })).toBe(false);
  });

  test("R501: the upload source path gates on a picked file (the fixture key alone is not enough)", () => {
    const draft = emptyDraft();
    // upload kind, no file: unsatisfied even with a fixture key set.
    expect(stepSatisfied("source", { ...draft, sourceKey: "derby" })).toBe(false);
    // upload kind with a picked file: satisfied.
    expect(
      stepSatisfied("source", {
        ...draft,
        file: new File([new Uint8Array([1, 2, 3])], "clip.mp4", { type: "video/mp4" }),
      }),
    ).toBe(true);
    // fixture kind without a key: unsatisfied.
    expect(stepSatisfied("source", { ...draft, sourceKind: "fixture" as const })).toBe(false);
  });

  test("R501: the compute step gates on the directive (auto, or an explicit provider pick)", () => {
    const draft = emptyDraft();
    expect(stepSatisfied("compute", draft)).toBe(true); // sporta-auto needs no pick
    expect(stepSatisfied("compute", { ...draft, computeMode: "user-explicit" as const })).toBe(
      false,
    );
    expect(
      stepSatisfied("compute", {
        ...draft,
        computeMode: "user-explicit" as const,
        computeProviderId: "sporta-compute-worker-1",
      }),
    ).toBe(true);
  });
});
