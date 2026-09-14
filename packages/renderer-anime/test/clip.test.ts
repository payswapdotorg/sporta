import { describe, expect, test } from "bun:test";
import { RendererContractError } from "@sporta/renderer-contract";
import { ANIME_OUTPUT_PROFILE, animeEntityStyle, renderAnimeClip } from "../src/index";
import type { AnimeEntityDisposition } from "../src/index";
import {
  ALLOW_ALL,
  DENY_ALL,
  SESSION_ID,
  buildAnimeRequest,
  buildFixtureClip,
  buildFixtureSnapshot,
} from "./helpers";

/** The canonical 6-step fixture clip (t = 1000..6000, deterministic). */
const steps = buildFixtureClip();

describe("renderAnimeClip — the fixture clip e2e", () => {
  const output = renderAnimeClip(buildAnimeRequest(), steps);

  test("one frame per clip step, each a complete SVG document", () => {
    expect(output.frames).toHaveLength(6);
    expect(output.manifest.frames).toHaveLength(6);
    for (const frame of output.frames) {
      expect(frame.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(frame.svg.endsWith("</svg>")).toBe(true);
      expect(frame.svg).toContain(`<title>anime.prototype frame ${frame.frameIndex}</title>`);
    }
  });

  test("frame output timestamps are the step timestamps", () => {
    expect(output.frames.map((frame) => frame.outputTimestampMs)).toEqual([
      1_000, 2_000, 3_000, 4_000, 5_000, 6_000,
    ]);
  });

  test("segments tile the clip timeline without overlap (R8 shape)", () => {
    const segments = output.result.outputSegments;
    expect(segments.map((segment) => segment.segmentId)).toEqual([
      "anime-0",
      "anime-1",
      "anime-2",
      "anime-3",
      "anime-4",
      "anime-5",
    ]);
    expect(segments.map((segment) => [segment.startMs, segment.endMs])).toEqual([
      [1_000, 2_000],
      [2_000, 3_000],
      [3_000, 4_000],
      [4_000, 5_000],
      [5_000, 6_000],
      [6_000, 7_000],
    ]);
    for (const segment of segments) {
      expect(segment.artifactRef).toMatch(new RegExp(`^anime://${SESSION_ID}/1/\\d+$`));
    }
  });

  test("watermark + provenance: the R6 analog over the whole clip", () => {
    expect(output.result.watermarkAfter).toEqual({ watermarkMs: 7_000, sequence: 15 });
    expect(output.result.provenance).toEqual({ snapshotVersion: 1, lastEventSequence: 15 });
    expect(output.manifest.output).toEqual({
      profile: ANIME_OUTPUT_PROFILE,
      startMs: 1_000,
      frameIntervalMs: 1_000,
      durationMs: 6_000,
    });
    expect(output.manifest.skippedEvents).toEqual([]);
    expect(output.manifest.degradation).toEqual({ degraded: false, reasons: [] });
  });

  test("per-frame provenance links back to each snapshot's watermark (advancing)", () => {
    const watermarks = output.manifest.frames.map((frame) => frame.source.watermark.sequence);
    expect(watermarks).toEqual([10, 11, 12, 13, 14, 15]);
    expect(output.manifest.frames.map((frame) => frame.source.watermark.watermarkMs)).toEqual([
      1_000, 2_000, 3_000, 4_000, 5_000, 6_000,
    ]);
    expect(output.manifest.frames[0]!.source.footballState).toBe(true);
  });

  test("applied event sequences per frame (caption-window attribution)", () => {
    expect(output.manifest.frames.map((frame) => frame.appliedEventSequences)).toEqual([
      [11],
      [],
      [12],
      [13],
      [14],
      [15],
    ]);
  });
});

describe("renderAnimeClip — entity presence accounting (the W503 source)", () => {
  const output = renderAnimeClip(buildAnimeRequest(), steps);

  test("EVERY frame records EVERY snapshot entity id explicitly, in snapshot order", () => {
    for (const frame of output.manifest.frames) {
      expect(frame.entities.map((entity) => entity.entityId)).toEqual([
        "player-7",
        "player-9",
        "player-11",
        "player-out",
        "player-far",
        "team-1",
        "ball-1",
      ]);
    }
  });

  test("dispositions are stable across frames (presence honesty)", () => {
    const dispositions = output.manifest.frames.map((frame) =>
      Object.fromEntries(frame.entities.map((entity) => [entity.entityId, entity.disposition])),
    );
    const expected: Record<string, AnimeEntityDisposition> = {
      "player-7": "rendered",
      "player-9": "rendered",
      "player-11": "omitted-no-position",
      "player-out": "rendered-out-of-play",
      "player-far": "omitted-out-of-play",
      "team-1": "not-rendered-kind",
      "ball-1": "rendered",
    };
    for (const frame of dispositions) {
      expect(frame).toEqual(expected);
    }
  });

  test("identity-stable style tokens are IDENTICAL across every frame (no flicker, by construction)", () => {
    const tokensById = new Map<string, string[]>();
    for (const frame of output.manifest.frames) {
      for (const entity of frame.entities) {
        if (entity.style === undefined) continue;
        const tokens = tokensById.get(entity.entityId) ?? [];
        tokens.push(JSON.stringify(entity.style));
        tokensById.set(entity.entityId, tokens);
      }
    }
    expect(tokensById.get("player-7")).toHaveLength(6);
    expect(new Set(tokensById.get("player-7")!).size).toBe(1);
    expect(new Set(tokensById.get("player-9")!).size).toBe(1);
    expect(tokensById.get("player-7")![0]).toBe(JSON.stringify(animeEntityStyle("player-7")));
    // The omitted entity and non-participants carry no style token at all.
    expect(tokensById.has("player-11")).toBe(false);
    expect(tokensById.has("team-1")).toBe(false);
    expect(tokensById.has("ball-1")).toBe(false);
  });

  test("SVG marker STYLING is byte-identical across frames for the same entityId", () => {
    // Extract the marker group for player-7 in every frame and normalize the
    // position digits away: what remains (style + structure) must be equal.
    const markerGroups = output.frames.map((frame) => {
      const match = frame.svg.match(/<g data-entity="player-7">.*?<\/g>/);
      expect(match).not.toBeNull();
      return match![0]!.replace(/-?\d+(\.\d+)?/g, "#");
    });
    expect(new Set(markerGroups).size).toBe(1);
    // Same proof for the ball (fixed style).
    const ballGroups = output.frames.map((frame) => {
      const match = frame.svg.match(/<g data-entity="ball-1">.*?<\/g>/);
      expect(match).not.toBeNull();
      return match![0]!.replace(/-?\d+(\.\d+)?/g, "#");
    });
    expect(new Set(ballGroups).size).toBe(1);
  });

  test("confidences are copied VERBATIM from the snapshots on every frame", () => {
    for (const frame of output.manifest.frames) {
      const byId = new Map(frame.entities.map((entity) => [entity.entityId, entity]));
      expect(byId.get("ball-1")!.confidence).toBe(0.9);
      expect(byId.get("player-9")!.confidence).toBe(0.7);
      expect(byId.get("player-7")!.confidence).toBeUndefined(); // absent → no claim
      expect(frame.possession!.confidence).toBe(0.75);
    }
  });

  test("TRUE unclamped positions recorded for out-of-play entities (never clamped)", () => {
    for (const frame of output.manifest.frames) {
      const byId = new Map(frame.entities.map((entity) => [entity.entityId, entity]));
      expect(byId.get("player-out")!.positionMeters).toEqual({ x: -3, y: 34 });
      expect(byId.get("player-out")!.svgPosition).toEqual({ x: 30, y: 400 });
      expect(byId.get("player-far")!.positionMeters).toEqual({ x: 120, y: 34 });
      expect(byId.get("player-far")!.svgPosition).toBeUndefined();
    }
  });
});

describe("renderAnimeClip — coherent motion (the W502 acceptance core)", () => {
  const output = renderAnimeClip(buildAnimeRequest(), steps);

  test("player-7 moves along the documented mapping: cx = 60 + 10·(52.5 + 0.8·i)", () => {
    const positions = output.manifest.frames.map(
      (frame) => frame.entities.find((entity) => entity.entityId === "player-7")!.svgPosition,
    );
    expect(positions).toEqual([
      { x: 585, y: 400 },
      { x: 593, y: 400 },
      { x: 601, y: 400 },
      { x: 609, y: 400 },
      { x: 617, y: 400 },
      { x: 625, y: 400 },
    ]);
    // the SVG contains exactly those markers at those coordinates
    for (const frame of output.frames) {
      const index = frame.frameIndex;
      expect(frame.svg).toContain(`cx="${585 + 8 * index}" cy="400"`);
    }
  });

  test("ball-1 moves: cx = 60 + 10·(50.5 + 0.5·i), cy = 405, opacity from confidence", () => {
    const positions = output.manifest.frames.map(
      (frame) => frame.entities.find((entity) => entity.entityId === "ball-1")!.svgPosition,
    );
    expect(positions).toEqual([
      { x: 565, y: 405 },
      { x: 570, y: 405 },
      { x: 575, y: 405 },
      { x: 580, y: 405 },
      { x: 585, y: 405 },
      { x: 590, y: 405 },
    ]);
    expect(output.frames[0]!.svg).toContain('opacity="0.935"'); // 0.35 + 0.65·0.9
  });

  test("captions evolve per frame with VERBATIM phrase-table text only", () => {
    const phrases = output.manifest.frames.map((frame) =>
      frame.captions.events.map((event) => event.phrase),
    );
    expect(phrases).toEqual([["Kick-off"], [], ["Pass"], ["Shot!"], [], ["GOAL!"]]);
    expect(output.frames[0]!.svg).toContain(">Kick-off</text>");
    expect(output.frames[5]!.svg).toContain(">GOAL!</text>");
    // The uncaptionable event is accounted, never displayed, never invented.
    expect(output.manifest.frames[4]!.captions.uncaptionedEvents).toEqual([
      { sequence: 14, eventId: "fe-weird", eventTypeRef: "football/v9/variant-unknown" },
    ]);
    expect(output.frames[4]!.svg).not.toContain("variant-unknown");
    expect(output.frames[4]!.svg).not.toContain("Event");
  });

  test("status line advances with the snapshot clock (verbatim numbers)", () => {
    const lines = output.manifest.frames.map((frame) => frame.captions.statusLine);
    expect(lines[0]).toBe("First half · 01:00 · 1-0?");
    expect(lines[5]).toBe("First half · 01:05 · 1-0?");
    expect(output.frames[5]!.svg).toContain("First half · 01:05 · 1-0?");
  });

  test("possession ring follows the possessing player across frames", () => {
    for (const frame of output.manifest.frames) {
      expect(frame.possession).toEqual({
        status: "uncertain",
        entityId: "player-7",
        confidence: 0.75,
        displayed: true,
      });
      expect(output.frames[frame.frameIndex]!.svg).toContain('r="20"');
    }
  });
});

describe("renderAnimeClip — determinism (deep-equal rerun)", () => {
  test("two independent renders of the same clip are deep-equal end to end", () => {
    const first = renderAnimeClip(buildAnimeRequest(), buildFixtureClip());
    const second = renderAnimeClip(buildAnimeRequest(), buildFixtureClip());
    expect(first.manifest).toEqual(second.manifest);
    expect(first.result).toEqual(second.result);
    expect(first.frames).toEqual(second.frames);
    expect(first.frames[0]!.svg).toBe(second.frames[0]!.svg);
    expect(first.frames[5]!.svg).toBe(second.frames[5]!.svg);
  });
});

describe("renderAnimeClip — fail-closed admission + fail-loud input", () => {
  test("carried source-frame references without rights → rights-denied throw", () => {
    const req = buildAnimeRequest({ rightsCapabilities: DENY_ALL, sourceFrameRefs: ["f-1"] });
    try {
      renderAnimeClip(req, steps);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RendererContractError);
      expect((error as RendererContractError).failureClass).toBe("rights-denied");
    }
  });

  test("SWM-only clip render under denied rights without references is allowed (no over-gating)", () => {
    const req = buildAnimeRequest({ rightsCapabilities: { ...ALLOW_ALL, canShare: false } });
    const output = renderAnimeClip(req, steps);
    expect(output.frames).toHaveLength(6);
  });

  test("empty steps → media-invalid throw", () => {
    try {
      renderAnimeClip(buildAnimeRequest(), []);
      expect.unreachable();
    } catch (error) {
      expect((error as RendererContractError).failureClass).toBe("media-invalid");
    }
  });

  test("non-increasing step timestamps → media-invalid throw (fail-loud, no re-sort)", () => {
    const reversed = [...buildFixtureClip()].reverse();
    try {
      renderAnimeClip(buildAnimeRequest(), reversed);
      expect.unreachable();
    } catch (error) {
      expect((error as RendererContractError).failureClass).toBe("media-invalid");
      expect((error as Error).message).toContain("strictly increasing");
    }
  });

  test("session mismatch between a step snapshot and the request → media-invalid", () => {
    const foreignSteps = [
      { atMs: 1_000, snapshot: buildFixtureSnapshot(0), events: [] },
      {
        atMs: 2_000,
        snapshot: { ...buildFixtureSnapshot(1), sessionId: "sess-other" },
        events: [],
      },
    ];
    try {
      renderAnimeClip(buildAnimeRequest(), foreignSteps);
      expect.unreachable();
    } catch (error) {
      expect((error as RendererContractError).failureClass).toBe("media-invalid");
      expect((error as Error).message).toContain("sess-other");
    }
  });

  test("off-list profile → media-invalid throw (admission is path-independent)", () => {
    const req = buildAnimeRequest({ rendererId: "some.other.renderer" });
    try {
      renderAnimeClip(req, steps);
      expect.unreachable();
    } catch (error) {
      expect((error as RendererContractError).failureClass).toBe("media-invalid");
    }
  });
});
