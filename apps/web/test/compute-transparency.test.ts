import { describe, expect, test } from "bun:test";
import type {
  ComputeQuotaStateLike,
  SelectionExplanationLike,
  StudioComputeStatusLike,
} from "../src/lib/api-types";
import {
  allowanceText,
  createFallbackStateOf,
  measuredCostText,
  privacyPostureOf,
  watchFallbackStateOf,
} from "../src/components/compute-transparency";
import type {
  TransparencySelectionView,
  WatchJobView,
} from "../src/components/compute-transparency";

/**
 * THE COMPUTE TRANSPARENCY TESTS (J006) — the pure derivations behind the
 * Create and Watch transparency panels, over FIXTURE route documents (the
 * EXACT shapes the existing routes answer: compute-status's
 * StudioComputeStatus, compute-preview's SelectionExplanation, the J004
 * plan-selection, and the studio job views). The six acceptance facts —
 * compute source, provider, selection reason, measured allowance/cost,
 * privacy posture, fallback state — render honestly: absent data stays
 * the HONEST UNKNOWN, never an invented number, never a zero standing in
 * for an unreadable counter.
 */

// ---------------------------------------------------------------------------
// Fixtures (the route contracts' own shapes — labeled REAL-vs-FIXTURE)
// ---------------------------------------------------------------------------

function fixtureExplanation(
  overrides: Partial<SelectionExplanationLike> = {},
): SelectionExplanationLike {
  return {
    schemaVersion: "sporta.connection-center/1",
    decidedAtMs: 1_888_888_888_000,
    mode: "sporta-auto",
    selectedProviderId: "provider-a",
    selectionReason:
      "the first eligible provider in registration order that survives the caller's preference axes and the broker's policy bounds (the broker's deterministic order)",
    appliedPreference: { privacyPosture: "privacy-any" },
    considered: [
      {
        providerId: "provider-a",
        quote: {
          providerId: "provider-a",
          capability: {
            providerKind: "serverless",
            maxConcurrentJobs: 2,
            maxJobDeadlineMs: 600_000,
            supportedLatencyClasses: ["offline"],
          },
          estimatedCostUsd: 0.04,
          estimatedQueueSeconds: 12,
          quotedAtMs: 1_888_888_888_000,
          validUntilMs: 1_888_888_900_000,
        },
      },
      {
        providerId: "provider-b",
        brokerRefusal: { reason: "quota-exhausted", message: "the daily quota is exhausted" },
      },
    ],
    ...overrides,
  };
}

function fixtureSelection(
  overrides: Partial<TransparencySelectionView> = {},
): TransparencySelectionView {
  const explanation = overrides.explanation ?? fixtureExplanation();
  return {
    providerId: explanation.selectedProviderId,
    mode: explanation.mode,
    explanation,
    ...overrides,
  };
}

const FIXTURE_STATUS: StudioComputeStatusLike = {
  plane: {
    provider: "Sporta hosted compute",
    adapterId: "compute-adapter-hosted",
    providerId: "provider-a",
    executionOwnership: "sporta-managed",
    facts: { privacyZone: "sporta-managed", capabilityClasses: ["serverless"] },
  },
  quotas: [
    {
      quotaId: "daily-render-requests",
      scope: "user",
      used: 3,
      limit: 10,
      remaining: 7,
      exhausted: false,
      reasonCode: "ok",
    },
    {
      quotaId: "daily-metered-compute",
      scope: "user",
      used: null,
      limit: null,
      remaining: null,
      exhausted: false,
      reasonCode: "quota-counter-invalid",
    },
  ],
  usage: null,
};

// ---------------------------------------------------------------------------
// The privacy posture
// ---------------------------------------------------------------------------

describe("privacyPostureOf (J006)", () => {
  test("a selection's applied posture rides verbatim + the plane's zone", () => {
    const view = privacyPostureOf(fixtureExplanation(), FIXTURE_STATUS.plane);
    expect(view).toEqual({ appliedPosture: "privacy-any", zone: "sporta-managed" });
  });

  test("no selection yet: the honest absence + the plane's declared zone", () => {
    const view = privacyPostureOf(null, FIXTURE_STATUS.plane);
    expect(view).toEqual({
      appliedPosture: "not recorded (no selection yet)",
      zone: "sporta-managed",
    });
  });

  test("no selection and no plane: the full honest absence", () => {
    expect(privacyPostureOf(null, null)).toBeNull();
    expect(privacyPostureOf(undefined, null)).toBeNull();
  });

  test("a selection with no plane facts: the posture stands alone", () => {
    const view = privacyPostureOf(
      fixtureExplanation({ appliedPreference: { privacyPosture: "privacy-local-only" } }),
      null,
    );
    expect(view).toEqual({ appliedPosture: "privacy-local-only", zone: null });
  });
});

// ---------------------------------------------------------------------------
// The Create-side fallback state
// ---------------------------------------------------------------------------

describe("createFallbackStateOf (J006)", () => {
  test("no plane configured: the honest no-silent-fallback declaration", () => {
    const view = createFallbackStateOf(null, false);
    expect(view.state).toBe("no-silent-fallback");
    expect(view.detail).toContain("no compute plane is configured");
    expect(view.detail).toContain("nothing falls back to an undeclared provider");
  });

  test("plane configured, no selection run yet: the not-recorded boundary", () => {
    const view = createFallbackStateOf(null, true);
    expect(view.state).toBe("not-recorded");
    expect(view.detail).toContain("no selection has run yet");
  });

  test("a clean selection: the declared no-silent-fallback posture", () => {
    const explanation = fixtureExplanation({
      considered: [
        {
          providerId: "provider-a",
          quote: {
            providerId: "provider-a",
            capability: {
              providerKind: "serverless",
              maxConcurrentJobs: 2,
              maxJobDeadlineMs: 600_000,
              supportedLatencyClasses: ["offline"],
            },
            estimatedCostUsd: 0.04,
            estimatedQueueSeconds: 12,
            quotedAtMs: 1_888_888_888_000,
            validUntilMs: 1_888_888_900_000,
          },
        },
      ],
    });
    const view = createFallbackStateOf(fixtureSelection({ explanation }), true);
    expect(view.state).toBe("no-silent-fallback");
    expect(view.detail).toContain("never silently switches providers");
  });

  test("a selection with refusals: every considered provider's typed reason, verbatim", () => {
    const view = createFallbackStateOf(fixtureSelection(), true);
    expect(view.state).toBe("refused");
    expect(view.detail).toContain("provider-b: quota-exhausted");
    expect(view.detail).toContain("never a silent fallback");
  });

  test("a preference exclusion is shown with its axis", () => {
    const explanation = fixtureExplanation({
      considered: [
        { providerId: "provider-a" },
        {
          providerId: "provider-b",
          preferenceExclusion: {
            axis: "privacy-posture",
            message: "the provider's zone is not local-only",
          },
        },
      ],
    });
    const view = createFallbackStateOf(fixtureSelection({ explanation }), true);
    expect(view.state).toBe("refused");
    expect(view.detail).toContain("provider-b: excluded (privacy-posture)");
  });
});

// ---------------------------------------------------------------------------
// The Watch-side fallback state
// ---------------------------------------------------------------------------

describe("watchFallbackStateOf (J006)", () => {
  test("a viewer without the dispatch record: the honest not-recorded boundary", () => {
    const view = watchFallbackStateOf(null);
    expect(view.state).toBe("not-recorded");
    expect(view.detail).toContain("not visible to this viewer");
  });

  test("an in-flight job: the real state, no fallback engaged", () => {
    const job: WatchJobView = { jobId: "job-1", state: "in-flight" };
    const view = watchFallbackStateOf(job);
    expect(view.state).toBe("in-flight");
    expect(view.detail).toContain("the render job is in-flight");
  });

  test("a succeeded render with a clean ingest: the no-silent-fallback verdict", () => {
    const job: WatchJobView = {
      jobId: "job-1",
      state: "succeeded",
      completion: { status: "succeeded", usage: [{ unitId: "cpu-ms", quantity: 1200 }] },
    };
    const view = watchFallbackStateOf(job);
    expect(view.state).toBe("no-silent-fallback");
    expect(view.detail).toContain("completed on the selected provider");
  });

  test("a failed render: the typed class, shown — never a silent retry elsewhere", () => {
    const job: WatchJobView = {
      jobId: "job-1",
      state: "failed",
      completion: {
        status: "failed",
        failure: {
          errorClass: "resource-limit",
          message: "the deadline was exceeded",
          terminal: "failed",
        },
        usage: [],
      },
    };
    const view = watchFallbackStateOf(job);
    expect(view.state).toBe("failed");
    expect(view.detail).toContain("resource-limit");
    expect(view.detail).toContain("never retried onto an undeclared provider");
  });

  test("a failed ingest on a succeeded render: the honest degraded state", () => {
    const job: WatchJobView = {
      jobId: "job-1",
      state: "succeeded",
      ingest: { status: "failed", error: "the artifact store refused the write" },
      completion: { status: "succeeded", usage: [] },
    };
    const view = watchFallbackStateOf(job);
    expect(view.state).toBe("degraded");
    expect(view.detail).toContain("the artifact store refused the write");
  });

  test("a cancelled render: no fallback, stated", () => {
    const job: WatchJobView = {
      jobId: "job-1",
      state: "cancelled",
      completion: { status: "cancelled", usage: [] },
    };
    expect(watchFallbackStateOf(job).state).toBe("failed");
    expect(watchFallbackStateOf(job).detail).toContain("cancelled");
  });
});

// ---------------------------------------------------------------------------
// The honest measured-cost + allowance texts
// ---------------------------------------------------------------------------

describe("measuredCostText / allowanceText (J006 — absent stays absent)", () => {
  test("usage null reads 'not measured' — never a zero", () => {
    expect(measuredCostText(null)).toBe("not measured");
  });

  test("usage empty reads 'none metered' — an honest zero-length list", () => {
    expect(measuredCostText([])).toBe("none metered");
  });

  test("metered units join with their quantities", () => {
    expect(
      measuredCostText([
        { unitId: "cpu-ms", quantity: 1200 },
        { unitId: "gpu-ms", quantity: 340 },
      ]),
    ).toBe("1200 cpu-ms · 340 gpu-ms");
  });

  test("an unreadable quota counter stays explicit (fail-closed)", () => {
    const quota: ComputeQuotaStateLike = {
      quotaId: "daily-metered-compute",
      scope: "user",
      used: null,
      limit: null,
      remaining: null,
      exhausted: false,
      reasonCode: "quota-counter-invalid",
    };
    expect(allowanceText(quota)).toBe("not measured (unreadable counter — fail-closed)");
  });

  test("a readable quota carries its real counts", () => {
    const quota: ComputeQuotaStateLike = {
      quotaId: "daily-render-requests",
      scope: "user",
      used: 3,
      limit: 10,
      remaining: 7,
      exhausted: false,
      reasonCode: "ok",
    };
    expect(allowanceText(quota)).toBe("3 of 10 used today · 7 remaining");
    const exhausted: ComputeQuotaStateLike = { ...quota, used: 10, remaining: 0, exhausted: true };
    expect(allowanceText(exhausted)).toBe("10 of 10 used today · exhausted");
  });
});

// ---------------------------------------------------------------------------
// The panel wiring contract (the six facts exist on both surfaces)
// ---------------------------------------------------------------------------

describe("the J006 panel wiring (the six facts, structurally)", () => {
  test("the Create panel derives all six facts from the status + selection", () => {
    // The pure derivations the Create panel renders — each fact has a
    // defined honest value for the fixture status/selection pair.
    const selection = fixtureSelection();
    const posture = privacyPostureOf(selection.explanation, FIXTURE_STATUS.plane);
    const fallback = createFallbackStateOf(selection, FIXTURE_STATUS.plane !== null);
    const source = FIXTURE_STATUS.plane?.executionOwnership ?? "no compute plane is configured";
    const provider = FIXTURE_STATUS.plane?.providerId ?? "—";
    const reason = selection.explanation.selectionReason;
    const cost = measuredCostText(FIXTURE_STATUS.usage);
    expect(source).toBe("sporta-managed");
    expect(provider).toBe("provider-a");
    expect(reason.length).toBeGreaterThan(10);
    expect(cost).toBe("not measured");
    expect(posture).not.toBeNull();
    expect(fallback.state).toBe("refused"); // provider-b's refusal rides verbatim
  });

  test("the Watch panel derives all six facts from the job view", () => {
    const job: WatchJobView = {
      jobId: "job-1",
      state: "succeeded",
      selection: fixtureSelection({ mode: "user-explicit", providerId: "provider-a" }),
      completion: { status: "succeeded", usage: [{ unitId: "cpu-ms", quantity: 950 }] },
    };
    const posture = privacyPostureOf(job.selection?.explanation ?? null, null);
    const fallback = watchFallbackStateOf(job);
    const cost = measuredCostText(job.completion?.usage ?? null);
    expect(job.selection?.mode).toBe("user-explicit");
    expect(cost).toBe("950 cpu-ms");
    expect(posture?.appliedPosture).toBe("privacy-any");
    expect(fallback.state).toBe("no-silent-fallback");
  });
});
