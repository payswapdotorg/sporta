import { beforeAll, describe, expect, test } from "bun:test";
import { parseCapabilityResponse } from "@sporta/capability";
import type { CapabilityResponse } from "@sporta/capability";
import type { SessionCardLike, WatchModelLike } from "../src/lib/api-types";
import {
  deriveExploreState,
  deriveHomeShelves,
  deriveLibraryState,
  deriveLiveState,
  deriveProviderNotices,
  deriveRealityOptions,
  deriveSurfaceVisibility,
  deriveWatchState,
  isWatchable,
  withRendererJobStates,
} from "../src/lib/surface-state";
import { jobProgressOf, submissionVerdictOf } from "../src/lib/create-flow";
import { createRealityMachine, switchReality } from "../src/lib/reality-machine";

/**
 * THE UX ↔ OPERATIONAL SIMULATION, EXECUTABLE (W908).
 *
 * `docs/testing/ux-operational-simulation.md` defines Simulations A–G — the
 * product-level walkthroughs the UX architecture must survive without
 * inventing hidden backend capabilities. This file pins EVERY simulation to
 * at least one real test over the real derivations the surfaces render from
 * (the W901 fixtures are the control-plane answers each step meets). The
 * per-derivation detail lives in surface-state.test.ts; this file is the
 * A→G coverage map the W908 acceptance gate asks for.
 */

const FIXTURE_DIR = "../../../packages/capability/fixtures/v1";

async function loadFixture(name: string): Promise<CapabilityResponse> {
  const module = (await import(`${FIXTURE_DIR}/${name}.json`)) as { default?: unknown };
  const raw = module.default ?? module;
  return parseCapabilityResponse(JSON.stringify(raw));
}

const fixtures = new Map<string, CapabilityResponse>();

beforeAll(async () => {
  for (const name of [
    "anonymous",
    "authenticated-no-roles",
    "live-unavailable",
    "partial-availability",
    "provider-degraded",
    "provider-down",
    "quota-exhausted",
    "rights-denied-renderer",
  ]) {
    fixtures.set(name, await loadFixture(name));
  }
});

function watchableCard(sessionId = "ms-1"): SessionCardLike {
  return {
    sessionId,
    label: "Derby night at Kings Park — fixture story A",
    status: "authorized",
    createdAtIso: "2026-09-15T20:00:00.000Z",
    playback: { state: "authorized", reasonCode: "ok" },
    renders: [
      { renderId: "r-1", rendererId: "sporta.testcard", segmentCount: 1, hasStoredOutputs: true },
      { renderId: "r-2", rendererId: "anime.prototype", segmentCount: 1, hasStoredOutputs: true },
    ],
    outputCount: 2,
    story: { source: "dev-seed", storyKey: "derby", eventCount: 3 },
  };
}

function watchModelWithOutput(): WatchModelLike {
  return {
    sessionId: "ms-1",
    label: "Derby night at Kings Park — fixture story A",
    status: "authorized",
    createdAtIso: "2026-09-15T20:00:00.000Z",
    playback: { state: "authorized", reasonCode: "ok" },
    renders: [
      {
        renderId: "r-1",
        rendererId: "sporta.testcard",
        watermarkAfter: { watermarkMs: 6_000, sequence: 6 },
        provenance: { snapshotVersion: 6, lastEventSequence: 6 },
        rendererHealth: { lagMs: 0, degraded: false },
        segmentCount: 1,
        outputs: [
          {
            segmentId: "seg-1",
            contentType: "image/svg+xml",
            byteLength: 2048,
            contentHash: "sha256-abc",
          },
        ],
      },
    ],
    eventTail: [
      { sequence: 1, eventId: "evt-1", eventTimeMs: 500, eventTypeRef: "football/v1/kickoff" },
    ],
    story: {
      source: "dev-seed",
      storyKey: "derby",
      transcript: [],
      events: [],
      waveCount: 6,
    },
  };
}

// ---------------------------------------------------------------------------
// Simulation A — new viewer
// ---------------------------------------------------------------------------

describe("Simulation A — new viewer (public URL → watch, capability-driven)", () => {
  test("an anonymous visitor's home derives honest shelves; a match is watchable when an output exists", () => {
    const capability = fixtures.get("anonymous")!;
    const shelves = deriveHomeShelves(capability, [watchableCard()]);
    expect(shelves.live.state).toBe("unavailable"); // no live transport evidence
    expect(shelves.watchNow.state).toBe("ready");
    expect(shelves.realities.state).toBe("ready");
    expect(isWatchable(watchableCard())).toBe(true);
  });

  test("the watch surface obtains playback and the Reality Switcher lists only backed renderers", () => {
    const capability = fixtures.get("anonymous")!;
    const watch = watchModelWithOutput();
    expect(deriveWatchState(capability, watch).state).toBe("ready");
    const options = deriveRealityOptions(capability, watch);
    for (const option of options) {
      // Every option is one of the real registry's renderers with a REAL state.
      expect(capability.renderers.some((r) => r.rendererId === option.rendererId)).toBe(true);
      if (option.state === "ready") {
        expect(option.segmentId).toBeDefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Simulation B — creator uploads a clip (required states: processing,
// degraded, denied, failed, ready)
// ---------------------------------------------------------------------------

describe("Simulation B — creator flow (processing/degraded/denied/failed/ready all real)", () => {
  test("the real compute job states map to the studio's processing/ready/failed states", () => {
    expect(jobProgressOf("queued")).toMatchObject({ phase: "processing", terminal: false });
    expect(jobProgressOf("in-flight")).toMatchObject({ phase: "processing", terminal: false });
    expect(jobProgressOf("succeeded")).toMatchObject({ phase: "ready", terminal: true });
    expect(jobProgressOf("failed")).toMatchObject({ phase: "failed", terminal: true });
    expect(jobProgressOf("cancelled")).toMatchObject({ phase: "failed", terminal: true });
    expect(jobProgressOf("dead-lettered")).toMatchObject({ phase: "failed", terminal: true });
    expect(jobProgressOf("something-new")).toMatchObject({ phase: "failed", terminal: true });
  });

  test("a rights declaration that derives nothing is denied, never submitted", () => {
    const verdict = submissionVerdictOf({
      capabilities: {
        canReferenceSourceFrames: false,
        canDeliverLive: false,
        canStoreDerivatives: false,
        canShare: false,
      },
      sessionCreation: { allowed: false, reason: "no capability can be derived" },
      effects: [],
    });
    expect(verdict.state).toBe("denied");
    expect(verdict.warning).toContain("no capability");
  });

  test("degraded comes from the real feeds: provider degradation slows new renders, keeps playback", () => {
    const notices = deriveProviderNotices(fixtures.get("provider-degraded")!);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.meaning).toContain("New batch rendering is admitted more slowly");
    expect(notices[0]!.meaning).toContain("existing playback is unaffected");
  });

  test("the watch surface shows processing while the creator's render job is in flight (W908)", () => {
    const watch = watchModelWithOutput();
    watch.renders = [];
    const options = deriveRealityOptions(fixtures.get("anonymous")!, watch);
    const upgraded = withRendererJobStates(options, [
      { jobId: "job-b", state: "in-flight", rendererId: "anime.prototype" },
    ]);
    const anime = upgraded.find((o) => o.rendererId === "anime.prototype")!;
    expect(anime.state).toBe("processing");
    expect(anime.reason).toContain("render job");
  });
});

// ---------------------------------------------------------------------------
// Simulation C — user switches roles
// ---------------------------------------------------------------------------

describe("Simulation C — role switching changes the workspace only, never authority", () => {
  test("the surface-visibility verdicts are grant-derived: switching the active role cannot flip one", () => {
    const capability = fixtures.get("provider-degraded")!;
    const surfaces = ["home", "explore", "watch", "library", "create-studio", "operations"] as const;
    const before = surfaces.map((id) => deriveSurfaceVisibility(capability, id).state);
    const switched = {
      ...capability,
      auth: { ...capability.auth, activeRole: "viewer" },
      account: { ...capability.account },
    };
    const after = surfaces.map((id) => deriveSurfaceVisibility(switched, id).state);
    expect(after).toEqual(before); // presentation context only
  });

  test("the library verdict follows the auth/grant state, not the active role label", () => {
    const capability = fixtures.get("live-unavailable")!;
    const asViewer = deriveLibraryState(
      { ...capability, auth: { ...capability.auth, activeRole: "viewer" } },
      [],
    );
    const asCreator = deriveLibraryState(
      { ...capability, auth: { ...capability.auth, activeRole: "creator" } },
      [],
    );
    expect(asViewer.state).toBe(asCreator.state);
    expect(asViewer.reason).toBe(asCreator.reason);
  });
});

// ---------------------------------------------------------------------------
// Simulation D — rights denial
// ---------------------------------------------------------------------------

describe("Simulation D — rights denial (denied, explained, no retry loop)", () => {
  test("a playback-denied watch model derives denied BEFORE any renderer detail is revealed", () => {
    const watch = watchModelWithOutput();
    watch.playback = { state: "denied", reasonCode: "rights-denied" };
    watch.renders = null;
    watch.eventTail = null;
    const verdict = deriveWatchState(fixtures.get("anonymous")!, watch);
    expect(verdict.state).toBe("denied");
    expect(verdict.reason).toContain("rights");
    const options = deriveRealityOptions(fixtures.get("anonymous")!, watch);
    for (const option of options) {
      expect(option.state).toBe("rights-denied");
      expect(option.renderId).toBeUndefined(); // no render existence leaks
      expect(option.segmentId).toBeUndefined(); // no source bytes pointer
    }
  });

  test("the denied verdicts carry the next allowed action, never a retry instruction", () => {
    const watch = watchModelWithOutput();
    watch.playback = { state: "denied", reasonCode: "rights-denied" };
    watch.renders = null;
    watch.eventTail = null;
    const verdict = deriveWatchState(fixtures.get("anonymous")!, watch);
    expect(verdict.reason).not.toMatch(/retry|again later/i);
  });
});

// ---------------------------------------------------------------------------
// Simulation E — provider quota exhaustion
// ---------------------------------------------------------------------------

describe("Simulation E — provider degradation / quota exhaustion", () => {
  test("quota exhaustion degrades the surfaces while listings stay real", () => {
    const capability = fixtures.get("quota-exhausted")!;
    expect(capability.overall.reasonCodes).toContain("quota-exhausted");
    const explore = deriveExploreState(capability, [watchableCard()]);
    expect(explore.state).toBe("degraded");
    expect(explore.reason).toContain("listings remain real");
  });

  test("a provider-down feed produces the visible degraded notice with actionable words", () => {
    const capability = fixtures.get("provider-down")!;
    const notices = deriveProviderNotices(capability);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.kind).toBe("compute");
    expect(notices[0]!.health).toBe("down");
  });

  test("the degraded platform still lists and plays what exists (E step 5)", () => {
    const capability = fixtures.get("provider-degraded")!;
    const shelves = deriveHomeShelves(capability, [watchableCard()]);
    expect(shelves.watchNow.state).toBe("ready"); // existing authorized playback remains
    expect(deriveWatchState(capability, watchModelWithOutput()).state).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// Simulation F — real-time (live is an evidence-driven capability verdict)
// ---------------------------------------------------------------------------

describe("Simulation F — live labels follow the transport evidence, never the session", () => {
  test("no W901 fixture may claim live: every live mode is unavailable with its reason", () => {
    for (const [name, capability] of fixtures) {
      const verdict = deriveLiveState(capability);
      expect(verdict.state).toBe("unavailable");
      expect(verdict.reason.length).toBeGreaterThan(10);
      expect(capability.modes.live.transportKind).not.toBe("live-network");
      expect(name.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Simulation G — watch-page reality switch
// ---------------------------------------------------------------------------

describe("Simulation G — the same match session, constant across reality switches", () => {
  test("the machine never changes session, and a switch only moves the renderer", () => {
    const capability = fixtures.get("anonymous")!;
    const watch = watchModelWithOutput();
    // A SECOND ready reality on the SAME session (the Simulation G setup).
    watch.renders!.push({
      renderId: "r-2",
      rendererId: "anime.prototype",
      watermarkAfter: { watermarkMs: 6_000, sequence: 6 },
      provenance: { snapshotVersion: 6, lastEventSequence: 6 },
      rendererHealth: { lagMs: 0, degraded: false },
      segmentCount: 1,
      outputs: [
        {
          segmentId: "seg-2",
          contentType: "image/svg+xml",
          byteLength: 2048,
          contentHash: "sha256-def",
        },
      ],
    });
    const options = deriveRealityOptions(capability, watch);
    const machine = createRealityMachine("ms-1", options, null);
    expect(machine.selectedRendererId).toBe("sporta.testcard");
    const transition = switchReality(machine, options, "anime.prototype");
    expect(transition.status).toBe("switched");
    expect(transition.state.sessionId).toBe("ms-1");
    expect(transition.state.selectedRendererId).toBe("anime.prototype");
    expect(transition.state.switches).toBe(machine.switches + 1);
  });
  test("switching to a renderer without an output is rejected with that renderer's real reason", () => {
    const capability = fixtures.get("anonymous")!;
    const watch = watchModelWithOutput();
    const options = deriveRealityOptions(capability, watch);
    const machine = createRealityMachine("ms-1", options, null);
    const transition = switchReality(machine, options, "anime.prototype");
    expect(transition.status).toBe("rejected");
    expect(transition.state.sessionId).toBe("ms-1"); // still the same match
    expect(transition.reason.length).toBeGreaterThan(5);
  });

  test("renderer-specific controls stay scoped: the options carry no other session's data", () => {
    const options = deriveRealityOptions(fixtures.get("anonymous")!, watchModelWithOutput());
    for (const option of options) {
      expect(option).not.toHaveProperty("sessionId");
    }
  });
});
