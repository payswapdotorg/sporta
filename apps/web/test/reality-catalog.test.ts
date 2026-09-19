/**
 * THE REALITY CATALOG MODEL TESTS (R504/R505) — the pure, test-pinned
 * derivations the Watch surface runs over the R503 artifact catalog:
 * the selection function (URL + catalog data → the selected reality), the
 * video-source resolution, the switcher's availability projection, and the
 * browser's honest video status mapping. Every case pins the deterministic
 * behavior the acceptance names: no hidden state, no silent fallbacks.
 */
import { describe, expect, test } from "bun:test";
import type {
  RealityArtifactEntryLike,
  SessionArtifactCatalogLike,
} from "../src/lib/api-types";
import {
  REALITY_LABELS,
  isRealityKind,
  isVideoArtifact,
  realityKindOfRenderer,
  selectedRealityOf,
  switcherStateOf,
  videoDescriptorOf,
  videoSourceOf,
  videoStatusOf,
  watchUrlOf,
} from "../src/lib/reality-catalog";

/** A catalog fixture builder over the REAL shapes (test data, clearly local). */
function catalogOf(overrides: {
  playback?: SessionArtifactCatalogLike["playback"];
  realities?: RealityArtifactEntryLike[] | null;
}): SessionArtifactCatalogLike {
  return {
    sessionId: "s-test",
    label: "Test match",
    status: "authorized",
    createdAtIso: "2026-01-01T00:00:00.000Z",
    playback: overrides.playback ?? { state: "authorized", reasonCode: "ok" },
    realities:
      overrides.realities === undefined
        ? null
        : overrides.realities,
    readyRealityCount: null,
  };
}

function entryOf(
  kind: RealityArtifactEntryLike["kind"],
  availability: RealityArtifactEntryLike["availability"],
  artifacts: RealityArtifactEntryLike["artifacts"] = [],
): RealityArtifactEntryLike {
  return { kind, availability, reason: `the honest ${kind} reason`, artifacts };
}

describe("the reality vocabulary + labels (R505)", () => {
  test("the four frozen kinds carry their presentation labels", () => {
    expect(REALITY_LABELS.original).toBe("Original");
    expect(REALITY_LABELS.tactical).toBe("Tactical");
    expect(REALITY_LABELS["three-d-game"]).toBe("3D");
    expect(REALITY_LABELS["anime-npr"]).toBe("Anime");
  });

  test("kind validation is closed: only the frozen vocabulary passes", () => {
    expect(isRealityKind("original")).toBe(true);
    expect(isRealityKind("anime-npr")).toBe(true);
    expect(isRealityKind("three-d-game")).toBe(true);
    expect(isRealityKind("tactical")).toBe(true);
    expect(isRealityKind("Original")).toBe(false);
    expect(isRealityKind("3d")).toBe(false);
    expect(isRealityKind("")).toBe(false);
    expect(isRealityKind(null)).toBe(false);
  });

  test("the watch deep link is URL-addressable and shareable", () => {
    expect(watchUrlOf("s 1", "anime-npr")).toBe(
      "/watch?session=s%201&reality=anime-npr",
    );
  });
});

describe("the video-source resolution (R504)", () => {
  test("only mp4-family content types are HTML5-video playable — SVG is honestly not", () => {
    expect(isVideoArtifact("mp4/h264")).toBe(true);
    expect(isVideoArtifact("video/mp4")).toBe(true);
    expect(isVideoArtifact("image/svg+xml")).toBe(false);
  });

  test("the FIRST video artifact of a reality is selected deterministically", () => {
    const entry = entryOf("original", "ready", [
      {
        artifactId: "svg-first",
        kind: "original",
        manifestLink: "/api/watch/s/realities/original/artifacts/svg-first",
        integrityHash: "a".repeat(64),
        byteSize: 10,
        contentType: "image/svg+xml",
        producerId: "media-platform/normalize",
      },
      {
        artifactId: "mp4-second",
        kind: "original",
        manifestLink: "/api/media/artifacts/mp4-second",
        integrityHash: "b".repeat(64),
        byteSize: 2048,
        contentType: "mp4/h264",
        producerId: "media-platform/normalize",
      },
    ]);
    const descriptor = videoDescriptorOf(entry);
    expect(descriptor?.artifactId).toBe("mp4-second");
    expect(videoDescriptorOf(entryOf("tactical", "producer-unavailable"))).toBeNull();
  });

  test("the byte route URL is derived from the session + the descriptor's identity", () => {
    expect(videoSourceOf("s 1", "original", "art/1")).toBe(
      "/api/watch/s%201/realities/original/artifacts/art%2F1/content",
    );
  });
});

describe("THE SELECTION FUNCTION (R505 — URL + catalog data, pure)", () => {
  test("a playback-denied catalog reveals NOTHING and selects nothing", () => {
    const selection = selectedRealityOf(
      "original",
      catalogOf({ playback: { state: "denied", reasonCode: "rights-denied" }, realities: null }),
    );
    expect(selection.kind).toBeNull();
    expect(selection.reason).toContain("denied");
  });

  test("a URL that names a valid kind SELECTS it — even when it is not ready (the deep link is the state)", () => {
    const catalog = catalogOf({
      realities: [
        entryOf("original", "requires-upload"),
        entryOf("tactical", "producer-unavailable"),
        entryOf("three-d-game", "producer-unavailable"),
        entryOf("anime-npr", "ready"),
      ],
    });
    const selection = selectedRealityOf("tactical", catalog);
    expect(selection.kind).toBe("tactical");
    expect(selection.fromUrl).toBe(true);
  });

  test("without a URL the FIRST ready reality in the frozen contract order wins", () => {
    const catalog = catalogOf({
      realities: [
        entryOf("original", "ready"),
        entryOf("tactical", "producer-unavailable"),
        entryOf("three-d-game", "producer-unavailable"),
        entryOf("anime-npr", "ready"),
      ],
    });
    expect(selectedRealityOf(null, catalog).kind).toBe("original");
    // original absent → the next ready kind in the frozen order.
    const noOriginal = catalogOf({
      realities: [
        entryOf("original", "requires-upload"),
        entryOf("tactical", "producer-unavailable"),
        entryOf("three-d-game", "producer-unavailable"),
        entryOf("anime-npr", "ready"),
      ],
    });
    expect(selectedRealityOf(null, noOriginal).kind).toBe("anime-npr");
  });

  test("an invalid URL parameter falls back to the deterministic first-ready rule", () => {
    const catalog = catalogOf({
      realities: [
        entryOf("original", "ready"),
        entryOf("tactical", "producer-unavailable"),
        entryOf("three-d-game", "producer-unavailable"),
        entryOf("anime-npr", "requires-render"),
      ],
    });
    const selection = selectedRealityOf("not-a-kind", catalog);
    expect(selection.kind).toBe("original");
    expect(selection.fromUrl).toBe(false);
  });

  test("a catalog with no ready reality selects nothing (the honest verdict)", () => {
    const catalog = catalogOf({
      realities: [
        entryOf("original", "requires-upload"),
        entryOf("tactical", "producer-unavailable"),
        entryOf("three-d-game", "producer-unavailable"),
        entryOf("anime-npr", "requires-render"),
      ],
    });
    const selection = selectedRealityOf(null, catalog);
    expect(selection.kind).toBeNull();
    expect(selection.reason).toContain("no reality");
  });

  test("the legacy ?renderer= alias maps through the catalog's own producer data", () => {
    const catalog = catalogOf({
      realities: [
        entryOf("original", "requires-upload"),
        entryOf("tactical", "producer-unavailable"),
        entryOf("three-d-game", "producer-unavailable"),
        entryOf("anime-npr", "ready", [
          {
            artifactId: "seg-1",
            kind: "anime-npr",
            manifestLink: "/api/watch/s/realities/anime-npr/artifacts/seg-1",
            integrityHash: "c".repeat(64),
            byteSize: 4096,
            contentType: "image/svg+xml",
            producerId: "anime.prototype",
          },
        ]),
      ],
    });
    expect(realityKindOfRenderer("anime.prototype", catalog)).toBe("anime-npr");
    // A renderer with no stored artifact cannot be mapped — null, never a guess.
    expect(realityKindOfRenderer("unknown.renderer", catalog)).toBeNull();
    expect(realityKindOfRenderer("anime.prototype", catalogOf({ realities: null }))).toBeNull();
  });
});

describe("the switcher's availability projection (R505 — catalog states verbatim)", () => {
  test("every catalog availability maps onto the UX state contract", () => {
    expect(switcherStateOf("ready")).toBe("ready");
    expect(switcherStateOf("job-in-flight")).toBe("processing");
    expect(switcherStateOf("job-failed")).toBe("failed");
    expect(switcherStateOf("requires-render")).toBe("unavailable");
    expect(switcherStateOf("requires-upload")).toBe("unavailable");
    expect(switcherStateOf("producer-unavailable")).toBe("unavailable");
  });
});

describe("the video player's honest status (R504 — the browser's state, verbatim)", () => {
  test("a typed MediaError carries its name and the browser's message verbatim", () => {
    const status = videoStatusOf({
      networkState: 3,
      readyState: 0,
      paused: true,
      ended: false,
      error: { code: 4, message: "no supported source" },
    });
    expect(status.phase).toBe("error");
    expect(status.reason).toBe("MEDIA_ERR_SRC_NOT_SUPPORTED: no supported source");
    const aborted = videoStatusOf({
      networkState: 3,
      readyState: 0,
      paused: true,
      ended: false,
      error: { code: 1, message: "" },
    });
    expect(aborted.reason).toBe("MEDIA_ERR_ABORTED");
  });

  test("the real playback phases surface honestly", () => {
    expect(
      videoStatusOf({ networkState: 2, readyState: 0, paused: true, ended: false, error: null })
        .phase,
    ).toBe("loading");
    expect(
      videoStatusOf({ networkState: 1, readyState: 4, paused: true, ended: false, error: null })
        .phase,
    ).toBe("ready");
    expect(
      videoStatusOf({ networkState: 1, readyState: 4, paused: false, ended: false, error: null })
        .phase,
    ).toBe("playing");
    expect(
      videoStatusOf({ networkState: 1, readyState: 4, paused: true, ended: true, error: null })
        .phase,
    ).toBe("ended");
  });
});
