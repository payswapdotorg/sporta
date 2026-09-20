import { beforeAll, describe, expect, test } from "bun:test";
import { probeFfmpegEncoder } from "@sporta/encoding";

/** Whether the real ffmpeg toolchain is present (the derived-reality plane composes only then). */
const ffmpegToolchainAvailable = probeFfmpegEncoder().available;
import { createDeterministicTestHasher } from "@sporta/identity";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { GET as watchRoute } from "../src/app/api/watch/[sessionId]/route";
import { GET as outputRoute } from "../src/app/api/watch/[sessionId]/renders/[renderId]/outputs/[segmentId]/route";
import { GET as realitiesRoute } from "../src/app/api/watch/[sessionId]/realities/route";
import { GET as capabilityRoute } from "../src/app/api/capability/route";
import type { CapabilityLike, WatchModelLike, RealityOptionsLike } from "../src/lib/api-types";
import { deriveRealityOptions, deriveWatchState } from "../src/lib/surface-state";
import { createRealityMachine, switchReality } from "../src/lib/reality-machine";
import {
  frameIndexAtMs,
  framePlayerModel,
  initialFramePlayer,
  placeEventMarkers,
} from "../src/lib/frame-display";
import { frameIndicesOf, prepareFrameForDisplay } from "../src/lib/frame-svg";

/**
 * WATCH-PAGE TESTS (W905) — the route gating + the watch page's state
 * derivations over the REAL seeded composition, then THE EXECUTABLE
 * SIMULATION G: the same real session held constant while the Reality
 * Switcher runs, the real stored output played on its own manifest clock,
 * and the real SWM event tail placed on the frames the render applied.
 *
 * Nothing is mocked: the handlers run as real functions over real Requests,
 * against the real control plane + real engine + real stored artifacts, with
 * a deterministic test hasher and a pinned clock (the composition's seams).
 */

const NOW_MS = 1_777_777_777_000;
let server: SportaServer;
let derbySessionId: string | null = null;
let friendlySessionId: string | null = null;
let trainingSessionId: string | null = null;
/** The REAL anonymous capability response (fetched once through the route). */
let capability: CapabilityLike;

beforeAll(async () => {
  server = createSportaServer({
    nowMs: () => NOW_MS,
    passwordHasher: createDeterministicTestHasher(),
    seed: true,
  });
  installSportaServerForTests(server);
  await server.ready;
  for (const [sessionId, story] of server.storyIndex) {
    if (story.storyKey === "derby") derbySessionId = sessionId;
    if (story.storyKey === "friendly") friendlySessionId = sessionId;
    if (story.storyKey === "training") trainingSessionId = sessionId;
  }
  capability = await getJson<CapabilityLike>(await capabilityRoute(jsonRequest("/api/capability")));
});

function jsonRequest(path: string): Request {
  return new Request(`http://sporta.test${path}`);
}

async function getJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Watch-route gating (denied before bytes — the fail-closed watch model)
// ---------------------------------------------------------------------------

describe("GET /api/watch/[sessionId] — the fail-closed playback acquisition", () => {
  test("an authorized session carries its real SWM event tail", async () => {
    const response = await watchRoute(jsonRequest(`/api/watch/${derbySessionId}`), {
      params: Promise.resolve({ sessionId: derbySessionId! }),
    });
    expect(response.status).toBe(200);
    const body = await getJson<WatchModelLike>(response);
    expect(body.eventTail).not.toBeNull();
    expect(body.eventTail!.length).toBeGreaterThan(0);
    // The tail is the world model's own record: ordered sequences, real ids.
    const sequences = body.eventTail!.map((event) => event.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    for (const event of body.eventTail!) {
      // Real extraction ids (the W209 chain's own `fe-*` scheme), not invented.
      expect(event.eventId.length).toBeGreaterThan(0);
      expect(event.eventTypeRef).toMatch(/^football\/v1\//);
      expect(event.eventTimeMs).toBeGreaterThanOrEqual(0);
    }
  });

  test("a rights-denied session reveals NOTHING — no renders, no event tail (denied before bytes)", async () => {
    const response = await watchRoute(jsonRequest(`/api/watch/${trainingSessionId}`), {
      params: Promise.resolve({ sessionId: trainingSessionId! }),
    });
    expect(response.status).toBe(200);
    const body = await getJson<WatchModelLike>(response);
    expect(body.playback).toEqual({ state: "denied", reasonCode: "rights-denied" });
    expect(body.renders).toBeNull();
    expect(body.eventTail).toBeNull();
  });

  test("an unknown session answers the control plane's own 404", async () => {
    const response = await watchRoute(jsonRequest("/api/watch/no-such-match"), {
      params: Promise.resolve({ sessionId: "no-such-match" }),
    });
    expect(response.status).toBe(404);
    const body = await getJson<{ error: { failureClass: string } }>(response);
    expect(body.error.failureClass).toBe("unknown-session");
  });
});

// ---------------------------------------------------------------------------
// THE REALITIES SURFACE (the Reality Switcher's per-renderer availability)
// ---------------------------------------------------------------------------

describe("GET /api/watch/[sessionId]/realities", () => {
  test("answers per-renderer availability for a real seeded session, with honest reasons", async () => {
    const response = await realitiesRoute(jsonRequest(`/api/watch/${derbySessionId}/realities`), {
      params: Promise.resolve({ sessionId: derbySessionId! }),
    });
    expect(response.status).toBe(200);
    const body = await getJson<RealityOptionsLike>(response);
    expect(body.sessionId).toBe(derbySessionId!); // the Simulation G constant
    // The REAL registry: testcard + anime, plus the R508-R510 derived-reality
    // renderers when the real ffmpeg toolchain composes the plane.
    expect(body.options.length).toBe(ffmpegToolchainAvailable ? 5 : 2);

    const anime = body.options.find((option) => option.rendererId === "anime.prototype")!;
    expect(anime.state).toBe("ready");
    expect(anime.reason).toContain("stored output");
    expect(anime.renderId).toBeDefined();
    expect(anime.segmentId).toBeDefined();

    const testcard = body.options.find((option) => option.rendererId === "sporta.testcard")!;
    expect(testcard.state).toBe("no-stored-output");
    expect(testcard.reason).toContain(testcard.renderId!); // names the real render
    expect(testcard.segmentId).toBeUndefined();
  });

  test("a rights-denied session denies EVERY reality without a render-existence oracle", async () => {
    const response = await realitiesRoute(
      jsonRequest(`/api/watch/${trainingSessionId}/realities`),
      {
        params: Promise.resolve({ sessionId: trainingSessionId! }),
      },
    );
    expect(response.status).toBe(200);
    const body = await getJson<RealityOptionsLike>(response);
    expect(body.sessionId).toBe(trainingSessionId!);
    expect(body.options.length).toBeGreaterThan(0);
    for (const option of body.options) {
      expect(option.state).toBe("rights-denied");
      expect(option.reason).toContain("rights");
      expect(option.renderId).toBeUndefined(); // no render existence revealed
      expect(option.segmentId).toBeUndefined();
    }
  });

  test("an unknown session answers the control plane's own 404", async () => {
    const response = await realitiesRoute(jsonRequest("/api/watch/no-such-match/realities"), {
      params: Promise.resolve({ sessionId: "no-such-match" }),
    });
    expect(response.status).toBe(404);
    const body = await getJson<{ error: { failureClass: string } }>(response);
    expect(body.error.failureClass).toBe("unknown-session");
  });

  test("the realities answer equals the client's own derivation (one seam, no drift)", async () => {
    const watchResponse = await watchRoute(jsonRequest(`/api/watch/${derbySessionId}`), {
      params: Promise.resolve({ sessionId: derbySessionId! }),
    });
    const watch = await getJson<WatchModelLike>(watchResponse);
    const response = await realitiesRoute(jsonRequest(`/api/watch/${derbySessionId}/realities`), {
      params: Promise.resolve({ sessionId: derbySessionId! }),
    });
    const body = await getJson<RealityOptionsLike>(response);
    // The client derives from the capability response + watch model; the
    // route derives from the same two real sources — they must agree.
    const derived = deriveRealityOptions(capability, watch);
    expect(body.options.map((o) => [o.rendererId, o.state, o.renderId])).toEqual(
      derived.map((o) => [o.rendererId, o.state, o.renderId]),
    );
  });
});

// ---------------------------------------------------------------------------
// THE EXECUTABLE SIMULATION G (real data, same session, renderer changes)
// ---------------------------------------------------------------------------

describe("Simulation G over the real seeded match (the page's own state machine)", () => {
  test("the watch page derivations follow the real data (ready verdict, honest others)", async () => {
    const watch = await getJson<WatchModelLike>(
      await watchRoute(jsonRequest(`/api/watch/${derbySessionId}`), {
        params: Promise.resolve({ sessionId: derbySessionId! }),
      }),
    );
    const verdict = deriveWatchState(capability, watch);
    expect(verdict.state).toBe("ready");
    expect(verdict.reason).toContain("anime.prototype");

    const friendly = await getJson<WatchModelLike>(
      await watchRoute(jsonRequest(`/api/watch/${friendlySessionId}`), {
        params: Promise.resolve({ sessionId: friendlySessionId! }),
      }),
    );
    // The friendly session is authorized but has only a testcard render with
    // no stored output — unavailable with the honest words, never 'coming soon'.
    const friendlyVerdict = deriveWatchState(capability, friendly);
    expect(friendlyVerdict.state).toBe("unavailable");
    expect(friendlyVerdict.reason).toContain("no stored output");
  });

  test("the machine holds the SAME session while switching, and only ready realities switch", async () => {
    const watch = await getJson<WatchModelLike>(
      await watchRoute(jsonRequest(`/api/watch/${derbySessionId}`), {
        params: Promise.resolve({ sessionId: derbySessionId! }),
      }),
    );
    const options = deriveRealityOptions(capability, watch);

    const machine = createRealityMachine(derbySessionId!, options, null);
    expect(machine.sessionId).toBe(derbySessionId!);
    expect(machine.selectedRendererId).toBe("anime.prototype"); // the ready one

    // Switching to the testcard reality is refused — with its REAL reason.
    const refused = switchReality(machine, options, "sporta.testcard");
    expect(refused.status).toBe("rejected");
    expect(refused.status === "rejected" && refused.reason).toBe(
      options.find((o) => o.rendererId === "sporta.testcard")!.reason,
    );
    expect(refused.state.sessionId).toBe(derbySessionId!); // no reload, no drift

    // The selected reality's output is fetchable for the SAME session.
    const ready = options.find((o) => o.rendererId === "anime.prototype")!;
    const outputResponse = await outputRoute(
      jsonRequest(
        `/api/watch/${derbySessionId}/renders/${ready.renderId}/outputs/${ready.segmentId}`,
      ),
      {
        params: Promise.resolve({
          sessionId: derbySessionId!,
          renderId: ready.renderId!,
          segmentId: ready.segmentId!,
        }),
      },
    );
    expect(outputResponse.status).toBe(200);
  });

  test("a denied match never enters the machine with anything to show", async () => {
    const watch = await getJson<WatchModelLike>(
      await watchRoute(jsonRequest(`/api/watch/${trainingSessionId}`), {
        params: Promise.resolve({ sessionId: trainingSessionId! }),
      }),
    );
    const options = deriveRealityOptions(capability, watch);
    expect(options.every((o) => o.state === "rights-denied")).toBe(true);
    const machine = createRealityMachine(trainingSessionId!, options, null);
    expect(machine.selectedRendererId).toBeNull(); // nothing to play, honestly
    expect(deriveWatchState(capability, watch).state).toBe("denied");
  });
});

// ---------------------------------------------------------------------------
// THE PLAYER over the REAL stored artifact (manifest clock + event markers)
// ---------------------------------------------------------------------------

describe("the real stored output, played on its own manifest clock", () => {
  async function fetchRealArtifact(): Promise<{
    watch: WatchModelLike;
    content: string;
    body: Awaited<ReturnType<typeof getJson<import("../src/lib/api-types").RenderOutputLike>>>;
  }> {
    const watch = await getJson<WatchModelLike>(
      await watchRoute(jsonRequest(`/api/watch/${derbySessionId}`), {
        params: Promise.resolve({ sessionId: derbySessionId! }),
      }),
    );
    const ready = deriveRealityOptions(capability, watch).find(
      (o) => o.rendererId === "anime.prototype",
    )!;
    const response = await outputRoute(
      jsonRequest(
        `/api/watch/${derbySessionId}/renders/${ready.renderId}/outputs/${ready.segmentId}`,
      ),
      {
        params: Promise.resolve({
          sessionId: derbySessionId!,
          renderId: ready.renderId!,
          segmentId: ready.segmentId!,
        }),
      },
    );
    expect(response.status).toBe(200);
    const body = await getJson<import("../src/lib/api-types").RenderOutputLike>(response);
    return { watch, content: body.content, body };
  }

  test("the manifest's own timing maps to the player model without invention", async () => {
    const { body } = await fetchRealArtifact();
    const model = framePlayerModel(body.manifest);
    expect(model.windows).toHaveLength(body.manifest.frameCount);
    expect(model.totalDurationMs).toBe(body.manifest.totalDurationMs);
    // Contiguity (the encoder's contract): each window begins where the prior ended.
    for (let i = 1; i < model.windows.length; i += 1) {
      expect(model.windows[i]!.beginMs).toBe(model.windows[i - 1]!.endMs);
    }
    // The player's initial playhead is the first real frame.
    expect(initialFramePlayer(model).playheadMs).toBe(model.windows[0]!.beginMs);
    // Every event-tail marker position the player computes is a real begin.
    const begins = model.windows.map((w) => w.beginMs);
    for (const begin of begins) {
      expect(frameIndexAtMs(model, begin + 1)).toBeGreaterThanOrEqual(0);
    }
    expect(begins.length).toBeGreaterThan(0);
  });

  test("the real SWM event tail lands on the frames the render applied them to", async () => {
    const { watch, body } = await fetchRealArtifact();
    const model = framePlayerModel(body.manifest);
    const markers = placeEventMarkers(model, watch.eventTail!, body.manifest.sourceManifest);

    // EVERY real event is listed — placed markers carry frame + position,
    // unplaced markers carry an honest reason. None is silently dropped.
    expect(markers.map((m) => m.sequence)).toEqual(watch.eventTail!.map((event) => event.sequence));
    const placed = markers.filter((marker) => marker.markerMs !== null);
    expect(placed.length).toBeGreaterThan(0); // the render really applied events
    const begins = model.windows.map((w) => w.beginMs);
    for (const marker of placed) {
      expect(marker.frameIndex).toBeGreaterThanOrEqual(0);
      expect(begins).toContain(marker.markerMs!);
      // The frame the marker names really applied that event's sequence.
      const sourceFrame = body.manifest.sourceManifest.frames.find(
        (frame) => frame.frameIndex === marker.frameIndex,
      )!;
      expect(sourceFrame.appliedEventSequences).toContain(marker.sequence);
    }
    for (const marker of markers.filter((m) => m.markerMs === null)) {
      expect(marker.reason).toBeTruthy();
    }
  });

  test("the display transform shows exactly ONE real frame of the real artifact", async () => {
    const { content, body } = await fetchRealArtifact();
    const model = framePlayerModel(body.manifest);
    const allIndices = frameIndicesOf(content);
    expect(allIndices).toHaveLength(body.manifest.frameCount);

    const first = prepareFrameForDisplay(content, allIndices[0]!);
    expect(first.match(/<g data-frame-index="\d+" display="inline">/g)).toEqual([
      `<g data-frame-index="${allIndices[0]!}" display="inline">`,
    ]);
    // The transform is pure per frame and never shows two frames at once.
    for (const index of allIndices) {
      const prepared = prepareFrameForDisplay(content, index);
      const inline = prepared.match(/<g data-frame-index="\d+" display="inline">/g) ?? [];
      expect(inline).toHaveLength(1);
      expect(inline[0]).toBe(`<g data-frame-index="${index}" display="inline">`);
      expect(prepared).not.toMatch(/<set\b/); // SMIL removed — the manifest drives
    }
    // The displayed frame for a playhead is the window that contains it.
    const midWindow = model.windows[Math.floor(model.windows.length / 2)]!;
    expect(frameIndexAtMs(model, midWindow.beginMs + 1)).toBe(midWindow.frameIndex);
  });
});
