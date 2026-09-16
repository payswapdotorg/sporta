import { beforeAll, describe, expect, test } from "bun:test";
import { parseCapabilityResponse } from "@sporta/capability";
import type { CapabilityResponse } from "@sporta/capability";
import type { SessionCardLike, WatchModelLike, RenderOutputLike, SearchResponseLike } from "../src/lib/api-types";
import {
  collectRealityCards,
  deriveCardPlayback,
  deriveExploreState,
  deriveFollowingState,
  deriveHomeShelves,
  deriveLibraryState,
  deriveLiveState,
  deriveProviderNotices,
  deriveRealityOptions,
  deriveReauthState,
  deriveRendererJobState,
  deriveSearchState,
  deriveSurfaceVisibility,
  deriveWatchState,
  isUxState,
  isWatchable,
  jobInFlight,
  mapOutputToViewModel,
  providerNoticeLine,
  watchVerdictOfOptions,
  withRendererJobStates,
} from "../src/lib/surface-state";

/**
 * THE EXECUTABLE UX-SIMULATION GATE (W904): every frozen W901 capability
 * fixture — the committed deny/degraded paths the product can really meet —
 * is run through the surface-state derivations. Every fixture must produce a
 * defined, honest UI state for Live / Explore / Library / the Reality
 * Switcher, and never a fake ready/live.
 */

const FIXTURES = [
  "anonymous",
  "authenticated-no-roles",
  "live-unavailable",
  "partial-availability",
  "provider-degraded",
  "provider-down",
  "quota-exhausted",
  "rights-denied-renderer",
] as const;

const FIXTURE_DIR = "../../../packages/capability/fixtures/v1";

async function loadFixture(name: (typeof FIXTURES)[number]): Promise<CapabilityResponse> {
  const module = (await import(`${FIXTURE_DIR}/${name}.json`)) as {
    default?: unknown;
  };
  const raw = module.default ?? module;
  // Round-trip through the canonical parser: the fixture must be a VALID
  // W901 capability response, exactly as the wire would deliver it.
  return parseCapabilityResponse(JSON.stringify(raw));
}

const fixtures = new Map<string, CapabilityResponse>();

beforeAll(async () => {
  for (const name of FIXTURES) {
    fixtures.set(name, await loadFixture(name));
  }
});

// ---------------------------------------------------------------------------
// Live (Simulation F) — a capability verdict, never a session property
// ---------------------------------------------------------------------------

describe("deriveLiveState over the W901 fixtures", () => {
  test("the in-process transport fixtures are honestly unavailable (Simulation F)", () => {
    for (const name of FIXTURES) {
      const capability = fixtures.get(name)!;
      const verdict = deriveLiveState(capability);
      expect(verdict.state).not.toBe("ready");
      expect(verdict.state).toBe("unavailable");
      expect(verdict.reason.length).toBeGreaterThan(10);
    }
  });

  test("no fixture may label anything live (no live-network transport exists yet)", () => {
    for (const name of FIXTURES) {
      const capability = fixtures.get(name)!;
      const live = capability.modes.live;
      expect(live.transportKind).not.toBe("live-network");
      expect(deriveLiveState(capability).state).toBe("unavailable");
    }
  });

  test("the live-transport-not-configured reason maps to unavailable with its own words", () => {
    const capability = fixtures.get("partial-availability")!;
    expect(capability.modes.live.reasonCode).toBe("live-transport-not-configured");
    const verdict = deriveLiveState(capability);
    expect(verdict.state).toBe("unavailable");
    expect(verdict.reason).toContain("no live transport is configured");
  });
});

// ---------------------------------------------------------------------------
// Explore — real listings stay real; degraded platforms surface why
// ---------------------------------------------------------------------------

describe("deriveExploreState over the W901 fixtures", () => {
  test("ready platforms with an empty catalog are unavailable, not failed", () => {
    const verdict = deriveExploreState(fixtures.get("anonymous")!, []);
    expect(verdict.state).toBe("unavailable");
    expect(verdict.reason).toContain("catalog is empty");
  });

  test("ready platforms with sessions are ready", () => {
    const verdict = deriveExploreState(fixtures.get("anonymous")!, [watchableCard()]);
    expect(verdict.state).toBe("ready");
  });

  test("degraded platforms degrade the surface but keep the listings real", () => {
    for (const name of [
      "partial-availability",
      "provider-degraded",
      "quota-exhausted",
      "rights-denied-renderer",
    ] as const) {
      const capability = fixtures.get(name)!;
      expect(capability.overall.state).toBe("degraded");
      const verdict = deriveExploreState(capability, [watchableCard()]);
      expect(verdict.state).toBe("degraded");
      expect(verdict.reason).toContain("listings remain real");
    }
  });

  test("an all-renderers-down platform is degraded for exploring, never 'ready'", () => {
    const capability = fixtures.get("provider-down")!;
    expect(capability.overall.state).toBe("unavailable");
    const verdict = deriveExploreState(capability, [watchableCard()]);
    expect(verdict.state).toBe("degraded");
    expect(verdict.reason).toContain("no renderer is currently available");
  });
});

// ---------------------------------------------------------------------------
// Library — authentication-required and role-not-granted are distinct denies
// ---------------------------------------------------------------------------

describe("deriveLibraryState over the W901 fixtures", () => {
  test("anonymous visitors get the authentication-required denied state", () => {
    const capability = fixtures.get("anonymous")!;
    const verdict = deriveLibraryState(capability, null);
    expect(verdict.state).toBe("denied");
    expect(verdict.reason).toContain("signing in is required");
  });

  test("a granted account with a readable library is ready (even empty)", () => {
    const capability = fixtures.get("live-unavailable")!;
    const verdict = deriveLibraryState(capability, []);
    expect(verdict.state).toBe("ready");
    expect(verdict.reason).toContain("Create Studio arrives with W906");
  });

  test("a granted account with sessions is ready and counts them", () => {
    const capability = fixtures.get("live-unavailable")!;
    const verdict = deriveLibraryState(capability, [watchableCard(), watchableCard("ms-2")]);
    expect(verdict.state).toBe("ready");
    expect(verdict.reason).toContain("2 session(s)");
  });

  test("a role-not-granted library answer is denied with the role words", () => {
    const capability = fixtures.get("authenticated-no-roles")!;
    const surface = capability.content.catalogSurfaces.find(
      (entry) => entry.surfaceId === "library",
    );
    expect(surface?.reasonCode).toBe("role-not-granted");
    const verdict = deriveLibraryState(capability, []);
    expect(verdict.state).toBe("denied");
    expect(verdict.reason).toContain("role grant");
  });
});

// ---------------------------------------------------------------------------
// Surface visibility (the role-experience matrix projection)
// ---------------------------------------------------------------------------

describe("deriveSurfaceVisibility over the W901 fixtures", () => {
  test("visible surfaces are ready", () => {
    for (const name of FIXTURES) {
      const capability = fixtures.get(name)!;
      const verdict = deriveSurfaceVisibility(capability, "home");
      expect(verdict.state).toBe("ready");
    }
  });

  test("authentication-required and role-not-granted are both denied with distinct words", () => {
    const anonymous = fixtures.get("anonymous")!;
    expect(deriveSurfaceVisibility(anonymous, "library").state).toBe("denied");
    expect(deriveSurfaceVisibility(anonymous, "library").reason).toContain("signing in");
    const noRoles = fixtures.get("authenticated-no-roles")!;
    expect(deriveSurfaceVisibility(noRoles, "library").state).toBe("denied");
    expect(deriveSurfaceVisibility(noRoles, "library").reason).toContain("role grant");
  });

  test("an unknown surface id answers unavailable, never ready", () => {
    const verdict = deriveSurfaceVisibility(fixtures.get("anonymous")!, "not-a-surface");
    expect(verdict.state).toBe("unavailable");
    expect(verdict.reason).toContain("not part of the capability response");
  });
});

// ---------------------------------------------------------------------------
// Home shelves — the three simultaneous messages
// ---------------------------------------------------------------------------

describe("deriveHomeShelves (the ux-architecture three messages)", () => {
  test("with a watchable card the watch-now shelf is ready; realities list renderer outputs", () => {
    const capability = fixtures.get("anonymous")!;
    const catalog = [watchableCard()];
    const shelves = deriveHomeShelves(capability, catalog);
    expect(shelves.live.state).toBe("unavailable");
    expect(shelves.watchNow.state).toBe("ready");
    expect(shelves.realities.state).toBe("ready");
    const realities = collectRealityCards(capability, catalog);
    expect(realities.length).toBe(1);
    // Only the render that actually has a stored output is offered.
    expect(realities[0]!.rendererId).toBe("anime.prototype");
    expect(realities[0]!.renderId).toBe("r-2");
  });

  test("a renderer-unavailable reality is never offered (provider-down)", () => {
    const capability = fixtures.get("provider-down")!;
    const catalog = [watchableCard()];
    const shelves = deriveHomeShelves(capability, catalog);
    expect(shelves.realities.state).toBe("unavailable");
    expect(collectRealityCards(capability, catalog)).toHaveLength(0);
  });

  test("an empty catalog with no sessions answers unavailable, honestly", () => {
    const shelves = deriveHomeShelves(fixtures.get("anonymous")!, []);
    expect(shelves.watchNow.state).toBe("unavailable");
    expect(shelves.watchNow.reason).toContain("no sessions yet");
  });

  test("an all-denied catalog answers denied (Simulation D posture at Home)", () => {
    const shelves = deriveHomeShelves(fixtures.get("anonymous")!, [deniedCard()]);
    expect(shelves.watchNow.state).toBe("denied");
    expect(shelves.watchNow.reason).toContain("deny stored playback");
  });
});

// ---------------------------------------------------------------------------
// The card model — status, rights-availability, renderer availability
// ---------------------------------------------------------------------------

describe("deriveCardPlayback / isWatchable (card-model mapping)", () => {
  test("an authorized session with an output is watchable and ready", () => {
    const card = watchableCard();
    expect(isWatchable(card)).toBe(true);
    const verdict = deriveCardPlayback(card);
    expect(verdict.state).toBe("ready");
    expect(verdict.reason).toContain("stored output is available");
  });

  test("a denied session is denied and reveals nothing about renders", () => {
    const card = deniedCard();
    expect(isWatchable(card)).toBe(false);
    expect(deriveCardPlayback(card).state).toBe("denied");
    expect(card.renders).toBeNull();
    expect(card.outputCount).toBeNull();
  });

  test("renders without stored outputs are unavailable — never 'coming soon'", () => {
    const card: SessionCardLike = {
      ...watchableCard(),
      outputCount: 0,
      renders: [
        {
          renderId: "r-1",
          rendererId: "sporta.testcard",
          segmentCount: 1,
          hasStoredOutputs: false,
        },
      ],
    };
    const verdict = deriveCardPlayback(card);
    expect(verdict.state).toBe("unavailable");
    expect(verdict.reason).toContain("no stored output has been produced");
  });

  test("a session with no renders at all is unavailable with the render words", () => {
    const card: SessionCardLike = { ...watchableCard(), outputCount: 0, renders: [] };
    const verdict = deriveCardPlayback(card);
    expect(verdict.state).toBe("unavailable");
    expect(verdict.reason).toContain("no render has been produced");
  });
});

// ---------------------------------------------------------------------------
// The Reality Switcher (Simulation G) — the session stays constant
// ---------------------------------------------------------------------------

describe("deriveRealityOptions over the W901 fixtures", () => {
  test("available renderer + stored output = ready, with the segment to play", () => {
    const options = deriveRealityOptions(fixtures.get("anonymous")!, watchModelWithOutput());
    const testcard = options.find((option) => option.rendererId === "sporta.testcard")!;
    expect(testcard.state).toBe("ready");
    expect(testcard.renderId).toBe("r-1");
    expect(testcard.segmentId).toBe("seg-1");
  });

  test("a renderer with no render for this session = requires-render, not hidden", () => {
    const options = deriveRealityOptions(fixtures.get("anonymous")!, watchModelWithOutput());
    const anime = options.find((option) => option.rendererId === "anime.prototype")!;
    expect(anime.state).toBe("requires-render");
    expect(anime.reason).toContain("no render for this match with this renderer has become available yet");
    expect(anime.reason).not.toContain("no render has been requested"); // W908: that claim could be a lie when a job is in flight
  });

  test("a render with no stored output = no-stored-output with the render id", () => {
    const watch = watchModelWithOutput();
    watch.renders = [
      {
        renderId: "r-2",
        rendererId: "sporta.testcard",
        watermarkAfter: { watermarkMs: 6_000, sequence: 6 },
        provenance: { snapshotVersion: 6, lastEventSequence: 6 },
        rendererHealth: { lagMs: 0, degraded: false },
        segmentCount: 1,
        outputs: [],
      },
    ];
    const options = deriveRealityOptions(fixtures.get("anonymous")!, watch);
    const testcard = options.find((option) => option.rendererId === "sporta.testcard")!;
    expect(testcard.state).toBe("no-stored-output");
    expect(testcard.renderId).toBe("r-2");
  });

  test("provider-down renderers are renderer-unavailable for every fixture renderer", () => {
    const options = deriveRealityOptions(fixtures.get("provider-down")!, watchModelWithOutput());
    for (const option of options) {
      expect(option.state).toBe("renderer-unavailable");
    }
  });

  test("rights-denied playback denies every reality, whatever the renderer", () => {
    const watch = watchModelWithOutput();
    watch.playback = { state: "denied", reasonCode: "rights-denied" };
    const options = deriveRealityOptions(fixtures.get("anonymous")!, watch);
    for (const option of options) {
      expect(option.state).toBe("rights-denied");
    }
  });

  test("deriveWatchState follows the ready option when one exists", () => {
    const verdict = deriveWatchState(fixtures.get("anonymous")!, watchModelWithOutput());
    expect(verdict.state).toBe("ready");
    expect(verdict.reason).toContain("sporta.testcard");
  });

  test("deriveWatchState is denied when playback is denied (before renderer detail)", () => {
    const watch = watchModelWithOutput();
    watch.playback = { state: "denied", reasonCode: "rights-denied" };
    expect(deriveWatchState(fixtures.get("anonymous")!, watch).state).toBe("denied");
  });
});

// ---------------------------------------------------------------------------
// The output view model — real manifest data only
// ---------------------------------------------------------------------------

describe("mapOutputToViewModel (the stored artifact → player data)", () => {
  test("maps a real-shaped stored-output manifest without inventing anything", () => {
    const model = mapOutputToViewModel(realOutputDocument());
    expect(model.frameCount).toBe(2);
    expect(model.frames).toHaveLength(2);
    expect(model.rendererId).toBe("anime.prototype");
    expect(model.styleId).toBe("dev-seed-derby");
    expect(model.degraded).toBe(false);
    expect(model.degradationReasons).toEqual([]);
    expect(model.frames[0]!.atMs).toBe(0);
    expect(model.frames[0]!.endMs).toBe(1_000);
    expect(model.frames[0]!.clockText).toBe("00:34");
    expect(model.frames[0]!.entities[0]!.entityId).toBe("seed-striker");
    expect(model.frames[0]!.entities[0]!.positionMeters).toEqual({ x: 51.6, y: 30.2 });
    // The captioned event becomes a timeline marker.
    expect(model.markers).toHaveLength(1);
    expect(model.markers[0]!.phrase).toBe("And we kick off here at the stadium.");
    expect(model.markers[0]!.atMs).toBe(0);
    expect(model.frames[0]!.marker!.eventId).toBe("evt-1");
    // Total duration copied from the manifest, not computed.
    expect(model.totalDurationMs).toBe(2_000);
  });

  test("score text surfaces only when displayed", () => {
    const document = realOutputDocument();
    document.manifest.sourceManifest.frames[1]!.captions.score = {
      displayed: false,
      status: "pending",
    };
    const model = mapOutputToViewModel(document);
    expect(model.frames[1]!.scoreText).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

describe("the UX state vocabulary", () => {
  test("isUxState accepts exactly the seven canonical states", () => {
    for (const state of [
      "loading",
      "ready",
      "processing",
      "degraded",
      "denied",
      "unavailable",
      "failed",
    ]) {
      expect(isUxState(state)).toBe(true);
    }
    expect(isUxState("live")).toBe(false);
    expect(isUxState("ok")).toBe(false);
    expect(isUxState("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Provider notices (Simulation E step 4 — the providers[] feed, made visible)
// ---------------------------------------------------------------------------

describe("deriveProviderNotices over the W901 fixtures (W908)", () => {
  test("every fixture derives a defined notice set — non-ok providers only, never a crash", () => {
    for (const name of FIXTURES) {
      const capability = fixtures.get(name)!;
      const notices = deriveProviderNotices(capability);
      for (const notice of notices) {
        expect(notice.health).not.toBe("ok");
        expect(notice.kind.length).toBeGreaterThan(0);
        expect(notice.reasonCode.length).toBeGreaterThan(0);
        expect(providerNoticeLine(notice).length).toBeGreaterThan(10);
      }
    }
  });

  test("the provider-degraded fixture produces exactly the storage notice, with its actionable meaning", () => {
    const notices = deriveProviderNotices(fixtures.get("provider-degraded")!);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.kind).toBe("storage");
    expect(notices[0]!.health).toBe("degraded");
    expect(notices[0]!.reasonCode).toBe("feed-reported-degraded");
    expect(notices[0]!.detail).toContain("R2 free-tier guardrail");
    expect(notices[0]!.meaning).toContain("existing playback is unaffected");
    const line = providerNoticeLine(notices[0]!);
    expect(line).toContain("storage provider is degraded");
    expect(line).toContain("New batch rendering is admitted more slowly");
  });

  test("the provider-down fixture surfaces the compute provider as down — never smoothed to ok", () => {
    const notices = deriveProviderNotices(fixtures.get("provider-down")!);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.kind).toBe("compute");
    expect(notices[0]!.health).toBe("down");
    expect(notices[0]!.reasonCode).toBe("feed-reported-down");
  });

  test("healthy deployments produce NO notices (no noise, no fake stability banner)", () => {
    for (const name of [
      "anonymous",
      "authenticated-no-roles",
      "live-unavailable",
      "partial-availability",
      "quota-exhausted",
      "rights-denied-renderer",
    ] as const) {
      expect(deriveProviderNotices(fixtures.get(name)!)).toHaveLength(0);
    }
  });

  test("quota exhaustion degrades the platform even with all providers ok (E: guards before providers fail)", () => {
    const capability = fixtures.get("quota-exhausted")!;
    expect(capability.overall.state).toBe("degraded");
    expect(capability.overall.reasonCodes).toContain("quota-exhausted");
    expect(deriveProviderNotices(capability)).toHaveLength(0);
    expect(deriveExploreState(capability, [watchableCard()]).state).toBe("degraded");
  });
});

// ---------------------------------------------------------------------------
// Search (W908 — the W916 data plane, honest surface states)
// ---------------------------------------------------------------------------

describe("deriveSearchState (the W916 search answer → honest surface states)", () => {
  test("a real answer with matches is ready", () => {
    const verdict = deriveSearchState(searchResponse([watchableCard(), deniedCard("ms-2")]));
    expect(verdict.state).toBe("ready");
    expect(verdict.reason).toContain("2 match(es)");
  });

  test("the ZERO-match answer is ready — the search ran; nothing matched (never unavailable/failed)", () => {
    const verdict = deriveSearchState(searchResponse([]));
    expect(verdict.state).toBe("ready");
    expect(verdict.reason).toContain("nothing matched");
    expect(verdict.reason).not.toContain("unavailable");
  });

  test("a degraded listing stays degraded with the results still real (the Explore posture)", () => {
    const verdict = deriveSearchState({
      ...searchResponse([watchableCard()]),
      degraded: { reasonCode: "session-terminated", skippedSessions: 1 },
    });
    expect(verdict.state).toBe("degraded");
    expect(verdict.reason).toContain("1 match(es)");
    expect(verdict.reason).toContain("skipped 1 terminated session(s)");
    expect(verdict.reason).toContain("results remain real");
  });

  test("the viewer summary is carried — an anonymous search only ever saw public sessions", () => {
    const anonymous = searchResponse([watchableCard()]);
    expect(anonymous.viewer.state).toBe("anonymous");
    expect(anonymous.viewer.grants).toEqual([]);
    expect(deriveSearchState(anonymous).state).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// Following (the honest no-follow-graph state)
// ---------------------------------------------------------------------------

describe("deriveFollowingState (no follow graph exists — for anyone)", () => {
  test("anonymous visitors are unavailable, and the reason never suggests signing in creates a feed", () => {
    const verdict = deriveFollowingState("anonymous");
    expect(verdict.state).toBe("unavailable");
    expect(verdict.reason).toContain("signing in alone would not create one");
  });

  test("signed-in visitors are unavailable too — no follow graph exists to read", () => {
    const verdict = deriveFollowingState("authenticated");
    expect(verdict.state).toBe("unavailable");
    expect(verdict.reason).toContain("no follow graph exists");
  });

  test("an invalid session is denied with the re-auth action (and still no feed promise)", () => {
    const verdict = deriveFollowingState("invalid-session");
    expect(verdict.state).toBe("denied");
    expect(verdict.reason).toContain("sign in again");
    expect(verdict.reason).toContain("does not exist yet");
  });
});

// ---------------------------------------------------------------------------
// Render-job progress on the watch surface (W906's create-job states, surfaced)
// ---------------------------------------------------------------------------

describe("deriveRendererJobState / withRendererJobStates (processing is evidence-backed)", () => {
  test("an in-flight job for the renderer presents processing, with the job id and its real state", () => {
    const verdict = deriveRendererJobState(
      [{ jobId: "job-7", state: "in-flight", rendererId: "anime.prototype" }],
      "anime.prototype",
    );
    expect(verdict).not.toBeNull();
    expect(verdict!.state).toBe("processing");
    expect(verdict!.reason).toContain("job-7");
    expect(verdict!.reason).toContain("in-flight");
  });

  test("every admitted non-terminal job state counts as in flight", () => {
    for (const state of ["admitted", "dispatched", "queued", "in-flight"]) {
      expect(jobInFlight(state)).toBe(true);
    }
    for (const state of ["succeeded", "failed", "cancelled", "dead-lettered", "unreadable", ""]) {
      expect(jobInFlight(state)).toBe(false);
    }
  });

  test("a job for a DIFFERENT renderer never presents processing for this one", () => {
    expect(
      deriveRendererJobState(
        [{ jobId: "job-7", state: "in-flight", rendererId: "sporta.testcard" }],
        "anime.prototype",
      ),
    ).toBeNull();
  });

  test("terminal and unreadable jobs claim nothing (fail-closed: processing needs evidence)", () => {
    for (const state of ["succeeded", "failed", "cancelled", "dead-lettered", "unreadable"]) {
      expect(
        deriveRendererJobState(
          [{ jobId: "job-8", state, rendererId: "anime.prototype" }],
          "anime.prototype",
        ),
      ).toBeNull();
    }
  });

  test("withRendererJobStates upgrades requires-render/no-stored-output but never ready or renderer-unavailable", () => {
    const base = deriveRealityOptions(fixtures.get("anonymous")!, watchModelWithOutput());
    const upgraded = withRendererJobStates(base, [
      { jobId: "job-9", state: "admitted", rendererId: "sporta.testcard" },
      { jobId: "job-10", state: "in-flight", rendererId: "anime.prototype" },
    ]);
    // sporta.testcard had a stored output → stays ready (a job for it ran while
    // its output exists; the playable artifact wins).
    expect(upgraded.find((o) => o.rendererId === "sporta.testcard")!.state).toBe("ready");
    // anime.prototype had no render → now processing (a real job is in flight).
    const anime = upgraded.find((o) => o.rendererId === "anime.prototype")!;
    expect(anime.state).toBe("processing");
    expect(anime.reason).toContain("job-10");
    // avatar-field.prototype was requires-render with no job → unchanged honest state.
    const avatar = upgraded.find((o) => o.rendererId === "avatar-field.prototype")!;
    expect(avatar.state).toBe("requires-render");
  });

  test("provider-down renderers stay renderer-unavailable even with a job in flight", () => {
    const base = deriveRealityOptions(fixtures.get("provider-down")!, watchModelWithOutput());
    const upgraded = withRendererJobStates(base, [
      { jobId: "job-11", state: "in-flight", rendererId: "anime.prototype" },
    ]);
    for (const option of upgraded) {
      expect(option.state).toBe("renderer-unavailable");
    }
  });
});

describe("watchVerdictOfOptions (processing beats unavailable on the watch page)", () => {
  test("a processing option makes the match verdict processing, with the renderer named", () => {
    // A match with NO stored output anywhere: without jobs the verdict is
    // unavailable; with an in-flight job it must present processing.
    const watch = watchModelWithOutput();
    watch.renders = [];
    const base = deriveRealityOptions(fixtures.get("anonymous")!, watch);
    expect(watchVerdictOfOptions(base).state).toBe("unavailable");
    const upgraded = withRendererJobStates(base, [
      { jobId: "job-12", state: "in-flight", rendererId: "anime.prototype" },
    ]);
    const verdict = watchVerdictOfOptions(upgraded);
    expect(verdict.state).toBe("processing");
    expect(verdict.reason).toContain("anime.prototype");
    expect(verdict.reason).toContain("job completes");
  });

  test("a ready option still wins over a concurrent processing job (play what exists)", () => {
    const base = deriveRealityOptions(fixtures.get("anonymous")!, watchModelWithOutput());
    const upgraded = withRendererJobStates(base, [
      { jobId: "job-13", state: "in-flight", rendererId: "anime.prototype" },
    ]);
    // sporta.testcard is ready in the base options — the verdict stays ready.
    expect(watchVerdictOfOptions(upgraded).state).toBe("ready");
  });

  test("no jobs → the derived unavailable verdicts are unchanged", () => {
    const base = deriveRealityOptions(fixtures.get("anonymous")!, watchModelWithOutput());
    expect(watchVerdictOfOptions(withRendererJobStates(base, [])).state).toBe("ready");
    const watch = watchModelWithOutput();
    watch.renders = [];
    const empty = deriveRealityOptions(fixtures.get("anonymous")!, watch);
    expect(watchVerdictOfOptions(withRendererJobStates(empty, [])).state).toBe("unavailable");
  });
});

// ---------------------------------------------------------------------------
// The auth-expired state (401 mid-session — re-auth, never a broken page)
// ---------------------------------------------------------------------------

describe("deriveReauthState (the expired-session verdict)", () => {
  test("is denied with the sign-in-again action — never failed, never a retry loop", () => {
    const verdict = deriveReauthState();
    expect(verdict.state).toBe("denied");
    expect(verdict.reason).toContain("sign in again");
    expect(verdict.reason).not.toContain("retry");
  });

  test("carries the server's own detail when the API said more", () => {
    expect(deriveReauthState("session not found").reason).toContain("(session not found)");
  });

  test("an invalid-session capability read is the same honest state on Library (the W901 fail-closed rule)", () => {
    // The anonymous fixture is structurally the invalid-session shape when
    // the auth state changes — the derivation must answer the re-auth words.
    const capability = fixtures.get("anonymous")!;
    const expired = {
      ...capability,
      auth: { ...capability.auth, state: "invalid-session" as const, sessionValid: false },
    };
    const verdict = deriveLibraryState(expired, null);
    expect(verdict.state).toBe("denied");
    expect(verdict.reason).toContain("no longer valid");
    expect(verdict.reason).toContain("sign in again");
  });
});

// ---------------------------------------------------------------------------
// The shared card/watch shapes (inputs aligned with the /api routes' real answers)
// ---------------------------------------------------------------------------

function watchableCard(sessionId = "ms-1"): SessionCardLike {
  return {
    sessionId,
    label: "Derby night at Kings Park — fixture story A",
    status: "authorized",
    createdAtIso: "2026-09-15T20:00:00.000Z",
    playback: { state: "authorized", reasonCode: "ok" },
    renders: [
      { renderId: "r-1", rendererId: "sporta.testcard", segmentCount: 1, hasStoredOutputs: false },
      { renderId: "r-2", rendererId: "anime.prototype", segmentCount: 1, hasStoredOutputs: true },
    ],
    outputCount: 1,
    story: { source: "dev-seed", storyKey: "derby", eventCount: 3 },
  };
}

function deniedCard(sessionId = "ms-denied"): SessionCardLike {
  return {
    sessionId,
    label: "Training ground — fixture story C",
    status: "authorized",
    createdAtIso: "2026-09-15T20:00:00.000Z",
    playback: { state: "denied", reasonCode: "rights-denied" },
    renders: null,
    outputCount: null,
    story: { source: "dev-seed", storyKey: "training", eventCount: 2 },
  };
}

/** A real-shaped /api/catalog/search answer (the W916 route's own shape). */
function searchResponse(
  matches: SessionCardLike[],
  viewer: SearchResponseLike["viewer"] = { state: "anonymous", userId: null, grants: [] },
): SearchResponseLike {
  return {
    catalogSchemaVersion: "1.1",
    viewer,
    query: { q: "derby" },
    matches: matches.map((card) => ({ ...card, matchedOn: ["label"] })),
    ...(matches.length === 0 ? {} : {}),
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
      transcript: [
        {
          startMs: 500,
          endMs: 1_000,
          text: "And we kick off here at the stadium.",
          asrConfidence: 0.95,
        },
      ],
      events: [{ sequence: 1, timeMs: 500, type: "kickoff", phrase: "kick off", confidence: 0.9 }],
      waveCount: 6,
    },
  };
}

/** A real-shaped stored-output document (the playback-gate read's shape). */
function realOutputDocument(): { contentType: string; manifest: RenderOutputLike["manifest"] } {
  return {
    contentType: "image/svg+xml",
    manifest: {
      segmentId: "seg-1",
      frameCount: 2,
      totalDurationMs: 2_000,
      frames: [
        { frameIndex: 0, outputTimestampMs: 0, beginMs: 0, durMs: 1_000 },
        { frameIndex: 1, outputTimestampMs: 1_000, beginMs: 1_000, durMs: 1_000 },
      ],
      sourceManifest: {
        renderer: {
          rendererId: "anime.prototype",
          rendererVersion: "0.1.0",
          styleId: "dev-seed-derby",
        },
        output: { startMs: 0, frameIntervalMs: 1_000, durationMs: 2_000 },
        frames: [
          {
            frameIndex: 0,
            outputTimestampMs: 0,
            windowMs: { startMs: 0, endMs: 1_000 },
            appliedEventSequences: [1],
            captions: {
              statusLine: "First half — underway",
              score: { displayed: true, status: "ok", text: "LIV 0 - 0 MCI" },
              clockText: "00:34",
              events: [
                { sequence: 1, eventId: "evt-1", phrase: "And we kick off here at the stadium." },
              ],
              uncaptionedEvents: [],
            },
            possession: { status: "unknown", displayed: false },
            entities: [
              {
                entityId: "seed-striker",
                kind: "player",
                disposition: "playing",
                positionMeters: { x: 51.6, y: 30.2 },
                svgPosition: { x: 386, y: 268 },
                confidence: 0.9,
              },
            ],
          },
          {
            frameIndex: 1,
            outputTimestampMs: 1_000,
            windowMs: { startMs: 1_000, endMs: 2_000 },
            appliedEventSequences: [],
            captions: {
              statusLine: null,
              score: null,
              clockText: "00:35",
              events: [],
              uncaptionedEvents: [],
            },
            possession: null,
            entities: [],
          },
        ],
        skippedEvents: [],
        degradation: { degraded: false, reasons: [] },
      },
    },
  };
}
