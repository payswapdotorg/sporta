/**
 * Segment player tests (W705): the SMIL segment presentation player for the
 * REAL W504 stored output.
 *
 * Fixtures: hand-built container manifests + segment documents (exact,
 * minimal — `buildHandSegment`) AND real encoder output
 * (`@sporta/output-pipeline` `encodeAnimeClip` of a real `renderAnimeClip`
 * output). Pinned:
 *
 * - load validation: every documented rejection (container format, content
 *   type, id/hash/byte-length mismatches, non-contiguous / non-anchored
 *   timing, timing-vs-sourceManifest disagreement, malformed document);
 * - the honest presentation model: ONE document in the view (never per-frame
 *   swaps), no buffering ever, metadata verbatim;
 * - declared-timeline playback math (exact frame windows, end at duration,
 *   loop restart), seek/step/replay semantics;
 * - the SMIL sync instruction: `seekMs` exactly on discontinuous moves
 *   (load/play/pause/seek/step/replay/loop-restart), `null` on natural ticks;
 * - determinism: the same command/tick script yields a deep-equal trace.
 */
import { describe, expect, test } from "bun:test";
import { createSegmentPlayer } from "../src/segment-player.ts";
import type { SegmentPlayerSource } from "../src/segment-player.ts";
import type { PlaybackSegmentDocument } from "../src/ports.ts";
import { buildHandSegment, fakeClock } from "./helpers.ts";
import {
  ANIME_OUTPUT_PROFILE,
  ANIME_RENDERER_ID,
  ANIME_RENDERER_VERSION,
  renderAnimeClip,
} from "@sporta/renderer-anime";
import type { AnimeClipStep } from "@sporta/renderer-anime";
import { buildRenderRequest, buildWorldSnapshot } from "@sporta/testing";
import { encodeAnimeClip } from "@sporta/output-pipeline";
import type { AnimeSegmentManifest } from "@sporta/output-pipeline";

const ALLOW_ALL = {
  canReferenceSourceFrames: true,
  canDeliverLive: true,
  canStoreDerivatives: true,
  canShare: true,
};

/** A REAL W504 encoded segment (the encoder's exact bytes + manifest). */
function realEncodedSegment(): PlaybackSegmentDocument {
  const sessionId = "sess-segment-player";
  const req = buildRenderRequest({
    sessionId,
    rendererId: ANIME_RENDERER_ID,
    rendererVersion: ANIME_RENDERER_VERSION,
    snapshotVersion: 1,
    eventsSinceSequence: 0,
    outputProfile: ANIME_OUTPUT_PROFILE,
    styleConfig: { styleId: "style-segment-test", configSchemaVersion: "1.0", config: {} },
    rightsCapabilities: ALLOW_ALL,
    sourceFrameRefs: [],
  });
  const steps: AnimeClipStep[] = [0, 1_000, 2_000].map((atMs, index) => ({
    atMs,
    snapshot: buildWorldSnapshot(
      { sessionId, watermark: { watermarkMs: atMs, sequence: 10 + index }, entities: [] },
      200 + index,
    ),
    events: [],
  }));
  const encoded = encodeAnimeClip(renderAnimeClip(req, steps));
  return {
    sessionId,
    renderId: "r-1",
    segmentId: encoded.segmentId,
    contentType: encoded.contentType,
    byteLength: encoded.byteLength,
    contentHash: encoded.contentHash,
    content: encoded.content,
    manifest: encoded.manifest,
  };
}

/** Loads a hand segment and expects success. */
function loadHand(
  options: { timestamps?: number[]; frameIntervalMs?: number } = {},
): ReturnType<typeof createSegmentPlayer> {
  const player = createSegmentPlayer({ clock: fakeClock().now });
  const segment = buildHandSegment(options);
  const result = player.load({ segment, manifest: segment.manifest });
  expect(result.ok).toBe(true);
  return player;
}

describe("segment player — load validation (fail-loud, exact messages)", () => {
  test("a real encoder output loads (the honest W504 shape)", () => {
    const player = createSegmentPlayer({ clock: fakeClock().now });
    const segment = realEncodedSegment();
    const result = player.load({ segment, manifest: segment.manifest });
    expect(result.ok).toBe(true);
    const view = player.view();
    expect(view.kind).toBe("segment");
    expect(view.playback).toBe("ready");
    expect(view.document).toBe(segment.content);
    expect(view.frameCount).toBe(3);
    expect(view.durationMs).toBe(3_000);
    expect(view.segmentId).toBe(segment.segmentId);
    expect(view.contentHash).toBe(segment.contentHash);
    expect(view.byteLength).toBe(segment.byteLength);
    expect(view.buffering).toBe(false);
    expect(view.renderer.rendererId).toBe(ANIME_RENDERER_ID);
    expect(view.output.frameIntervalMs).toBe(1_000);
  });

  test("a container format this player cannot present → unsupported-output", () => {
    const player = createSegmentPlayer({ clock: fakeClock().now });
    const segment = buildHandSegment();
    // Deliberately out-of-contract at RUNTIME (the player must reject it);
    // the double assertion carries the honest non-overlapping literal past
    // compile-time narrowing without pretending it is a valid manifest.
    const manifest = {
      ...structuredClone(segment.manifest),
      format: { kind: "raster-video", version: 1 },
    } as unknown as AnimeSegmentManifest;
    const result = player.load({ segment, manifest });
    if (!result.ok) {
      expect(result.error.failureClass).toBe("unsupported-output");
      expect(result.error.message).toContain("animated-svg");
    } else {
      throw new Error("expected a rejection");
    }
  });

  test("a non-SVG content type → unsupported-output (presentation model)", () => {
    const player = createSegmentPlayer({ clock: fakeClock().now });
    const segment: PlaybackSegmentDocument = {
      ...buildHandSegment(),
      contentType: "video/mp4",
    };
    const result = player.load({ segment, manifest: segment.manifest });
    if (!result.ok) {
      expect(result.error.failureClass).toBe("unsupported-output");
      expect(result.error.message).toContain("video/mp4");
    } else {
      throw new Error("expected a rejection");
    }
  });

  test("segment id / content hash / byte length mismatches → media-invalid", () => {
    const clock = fakeClock().now;
    const idMismatch: PlaybackSegmentDocument = {
      ...buildHandSegment(),
      segmentId: "anime-clip-other",
    };
    const idResult = createSegmentPlayer({ clock }).load({
      segment: idMismatch,
      manifest: idMismatch.manifest,
    });
    if (!idResult.ok) expect(idResult.error.message).toContain("must equal manifest.segmentId");
    else throw new Error("expected a rejection");

    const hashMismatch: PlaybackSegmentDocument = {
      ...buildHandSegment(),
      contentHash: "b".repeat(64),
    };
    const hashResult = createSegmentPlayer({ clock }).load({
      segment: hashMismatch,
      manifest: hashMismatch.manifest,
    });
    if (!hashResult.ok)
      expect(hashResult.error.message).toContain("must equal manifest.contentHash");
    else throw new Error("expected a rejection");

    const badHashFormat: PlaybackSegmentDocument = {
      ...buildHandSegment(),
    };
    badHashFormat.manifest = { ...badHashFormat.manifest, contentHash: "not-hex" };
    badHashFormat.contentHash = "not-hex";
    const formatResult = createSegmentPlayer({ clock }).load({
      segment: badHashFormat,
      manifest: badHashFormat.manifest,
    });
    if (!formatResult.ok) expect(formatResult.error.message).toContain("64 lowercase hex");
    else throw new Error("expected a rejection");

    const lengthMismatch: PlaybackSegmentDocument = {
      ...buildHandSegment(),
      byteLength: 999,
    };
    const lengthResult = createSegmentPlayer({ clock }).load({
      segment: lengthMismatch,
      manifest: lengthMismatch.manifest,
    });
    if (!lengthResult.ok) expect(lengthResult.error.message).toContain("byte length");
    else throw new Error("expected a rejection");
  });

  test("non-contiguous / non-anchored timing tables → media-invalid", () => {
    const clock = fakeClock().now;
    // First window not starting at 0 (beginMs is 0-based on the segment
    // timeline; the first frame must anchor it).
    const anchored = buildHandSegment();
    const anchoredManifest = structuredClone(anchored.manifest);
    anchoredManifest.frames = [
      { frameIndex: 0, outputTimestampMs: 0, beginMs: 500, durMs: 1_000 },
      { frameIndex: 1, outputTimestampMs: 1_500, beginMs: 1_500, durMs: 1_000 },
    ];
    const anchoredResult = createSegmentPlayer({ clock }).load({
      segment: anchored,
      manifest: anchoredManifest,
    });
    if (!anchoredResult.ok) expect(anchoredResult.error.message).toContain("beginMs must be 0");
    else throw new Error("expected a rejection");

    // A gap between windows (frames 0..1000, then 1500..2500).
    const gapped = buildHandSegment();
    const gappedManifest = structuredClone(gapped.manifest);
    gappedManifest.frames = [
      { frameIndex: 0, outputTimestampMs: 0, beginMs: 0, durMs: 1_000 },
      { frameIndex: 1, outputTimestampMs: 1_500, beginMs: 1_500, durMs: 1_000 },
    ];
    const gappedResult = createSegmentPlayer({ clock }).load({
      segment: gapped,
      manifest: gappedManifest,
    });
    if (!gappedResult.ok)
      expect(gappedResult.error.message).toContain("continue the previous window");
    else throw new Error("expected a rejection");

    // The last window not ending at totalDurationMs.
    const short = buildHandSegment();
    const shortManifest = structuredClone(short.manifest);
    shortManifest.frames = [
      { frameIndex: 0, outputTimestampMs: 0, beginMs: 0, durMs: 1_000 },
      { frameIndex: 1, outputTimestampMs: 1_000, beginMs: 1_000, durMs: 1_000 },
    ];
    shortManifest.totalDurationMs = 3_000;
    const shortResult = createSegmentPlayer({ clock }).load({
      segment: short,
      manifest: shortManifest,
    });
    if (!shortResult.ok) expect(shortResult.error.message).toContain("totalDurationMs is 3000");
    else throw new Error("expected a rejection");

    // frameCount disagreeing with the table length.
    const counted = buildHandSegment();
    const countedManifest = structuredClone(counted.manifest);
    countedManifest.frameCount = 5;
    const countedResult = createSegmentPlayer({ clock }).load({
      segment: counted,
      manifest: countedManifest,
    });
    if (!countedResult.ok) expect(countedResult.error.message).toContain("frameCount (5)");
    else throw new Error("expected a rejection");
  });

  test("timing that DISAGREES with sourceManifest → media-invalid (never a guessed timeline)", () => {
    const player = createSegmentPlayer({ clock: fakeClock().now });
    const segment = buildHandSegment();
    const manifest = structuredClone(segment.manifest);
    // The container timing stays internally consistent (contiguous,
    // anchored) — but the embedded W502 window for frame 1 moved to
    // [1800, 2800), so the container's begin (1000) no longer derives from
    // the source manifest: drift, never silently presented.
    manifest.sourceManifest = structuredClone(segment.manifest.sourceManifest);
    manifest.sourceManifest.frames[1]!.windowMs = { startMs: 1_800, endMs: 2_800 };
    const result = player.load({ segment, manifest });
    if (!result.ok) {
      expect(result.error.failureClass).toBe("media-invalid");
      expect(result.error.message).toContain("disagrees with sourceManifest.frames[1]");
    } else {
      throw new Error("expected a rejection");
    }
  });

  test("a malformed document → media-invalid (pragmatic structural check)", () => {
    const clock = fakeClock().now;
    const notSvg: PlaybackSegmentDocument = { ...buildHandSegment(), content: "hello world" };
    const notSvgResult = createSegmentPlayer({ clock }).load({
      segment: notSvg,
      manifest: notSvg.manifest,
    });
    if (!notSvgResult.ok) expect(notSvgResult.error.message).toContain("<svg");
    else throw new Error("expected a rejection");

    const noManifest: SegmentPlayerSource = {
      segment: buildHandSegment(),
      manifest: undefined as unknown as SegmentPlayerSource["manifest"],
    };
    const noManifestResult = createSegmentPlayer({ clock }).load(noManifest);
    expect(noManifestResult.ok).toBe(false);
  });

  test("a rejected load leaves the previous playback untouched", () => {
    const player = createSegmentPlayer({ clock: fakeClock().now });
    const good = buildHandSegment();
    expect(player.load({ segment: good, manifest: good.manifest }).ok).toBe(true);
    player.play();
    const before = player.view();
    const bad: PlaybackSegmentDocument = { ...buildHandSegment(), content: "not svg" };
    const result = player.load({ segment: bad, manifest: bad.manifest });
    expect(result.ok).toBe(false);
    const after = player.view();
    expect(after.playback).toBe(before.playback);
    expect(after.positionMs).toBe(before.positionMs);
    expect(after.document).toBe(good.content);
  });
});

describe("segment player — the honest presentation model", () => {
  test("the view exposes the ONE document with manifest metadata (no per-frame swaps, no buffering)", () => {
    const clock = fakeClock();
    const player = createSegmentPlayer({ clock: clock.now });
    const segment = buildHandSegment({ timestamps: [0, 1_000, 2_000, 3_000] });
    player.load({ segment, manifest: segment.manifest });
    player.play();
    for (let i = 0; i < 4; i += 1) {
      clock.advance(900);
      player.tick();
      const view = player.view();
      // ONE document, constant across ticks — the SMIL timeline animates it.
      expect(view.document).toBe(segment.content);
      expect(view.buffering).toBe(false);
      expect(view.frameCount).toBe(4);
    }
  });

  test("declared-timeline playback math is exact from the manifest windows", () => {
    const clock = fakeClock();
    const player = createSegmentPlayer({ clock: clock.now });
    const segment = buildHandSegment({ timestamps: [0, 1_000, 2_000, 3_000, 4_000] });
    player.load({ segment, manifest: segment.manifest });
    player.play();
    clock.advance(2_500);
    player.tick();
    let view = player.view();
    expect(view.positionMs).toBe(2_500);
    expect(view.frameIndex).toBe(2);
    expect(view.playback).toBe("playing");
    clock.advance(2_500);
    player.tick();
    view = player.view();
    expect(view.positionMs).toBe(5_000);
    expect(view.playback).toBe("ended"); // exact: position === duration
    expect(view.frameIndex).toBe(4);
  });

  test("loop re-seeks the document clock to 0 at the ending tick", () => {
    const clock = fakeClock();
    const player = createSegmentPlayer({ clock: clock.now });
    const segment = buildHandSegment({ timestamps: [0, 1_000] });
    player.load({ segment, manifest: segment.manifest });
    player.setLoop(true);
    player.play();
    clock.advance(2_500);
    player.tick();
    const view = player.view();
    // The ending tick re-seeks to 0 and discards the clock debt (the same
    // semantics as the frame player's loop).
    expect(view.playback).toBe("playing");
    expect(view.positionMs).toBe(0);
    expect(view.frameIndex).toBe(0);
    expect(view.smil.seekMs).toBe(0); // the restart re-locked the document clock
    expect(view.smil.paused).toBe(false);
  });

  test("seek/step/replay semantics mirror the frame player", () => {
    const player = loadHand({ timestamps: [0, 1_000, 2_000, 3_000] });
    player.play();
    player.seekToMs(1_234);
    expect(player.view().positionMs).toBe(1_234);
    expect(player.view().playback).toBe("playing");
    player.pause();
    player.stepForward();
    expect(player.view().positionMs).toBe(2_000);
    expect(player.view().playback).toBe("paused");
    player.stepBackward();
    expect(player.view().positionMs).toBe(1_000);
    player.stepBackward();
    expect(player.view().positionMs).toBe(0);
    player.seekToMs(99_999); // clamped to the end
    expect(player.view().positionMs).toBe(4_000);
    expect(player.view().playback).toBe("ended");
    player.stepBackward(); // ended → last window start
    expect(player.view().positionMs).toBe(3_000);
    player.replay();
    const view = player.view();
    expect(view.positionMs).toBe(0);
    expect(view.playback).toBe("playing");
    // play at ended is a no-op (restart is replay, never implicit).
    player.seekToMs(4_000);
    player.play();
    expect(player.view().playback).toBe("ended");
  });
});

describe("segment player — the SMIL sync instruction (DOM edge contract)", () => {
  function syncTrace(timestamps: number[]): string[] {
    const clock = fakeClock();
    const player = createSegmentPlayer({ clock: clock.now });
    const segment = buildHandSegment({ timestamps });
    const trace: string[] = [];
    player.subscribe((view) => {
      trace.push(JSON.stringify(view.smil));
    });
    player.load({ segment, manifest: segment.manifest });
    player.play();
    clock.advance(500);
    player.tick(); // natural
    player.pause(); // discontinuity + pause
    player.play(); // discontinuity + resume
    clock.advance(500);
    player.tick(); // natural
    player.seekToMs(1_000); // discontinuity
    player.stepForward(); // discontinuity (pauses)
    player.play(); // discontinuity + resume
    player.setLoop(true); // no playhead move — natural
    clock.advance(2_500);
    player.tick(); // ending tick with loop → restart (seek 0)
    return trace;
  }

  test("seekMs exactly on discontinuous moves; null on natural ticks", () => {
    const trace = syncTrace([0, 1_000, 2_000]);
    // load, play, tick(natural), pause, play, tick(natural), seek, step,
    // play, setLoop, tick(loop restart)
    expect(trace).toHaveLength(11);
    expect(JSON.parse(trace[0]!)).toEqual({ paused: true, seekMs: 0 }); // load: ready, locked to 0
    expect(JSON.parse(trace[1]!)).toEqual({ paused: false, seekMs: 0 }); // play: resume at 0
    expect(JSON.parse(trace[2]!)).toEqual({ paused: false, seekMs: null }); // natural tick
    expect(JSON.parse(trace[3]!)).toEqual({ paused: true, seekMs: 500 }); // pause re-locks
    expect(JSON.parse(trace[4]!)).toEqual({ paused: false, seekMs: 500 }); // play re-locks
    expect(JSON.parse(trace[5]!)).toEqual({ paused: false, seekMs: null }); // natural tick
    expect(JSON.parse(trace[6]!)).toEqual({ paused: false, seekMs: 1_000 }); // seek
    expect(JSON.parse(trace[7]!)).toEqual({ paused: true, seekMs: 2_000 }); // stepForward (pauses)
    expect(JSON.parse(trace[8]!)).toEqual({ paused: false, seekMs: 2_000 }); // play re-locks
    expect(JSON.parse(trace[9]!)).toEqual({ paused: false, seekMs: null }); // setLoop: no move
    expect(JSON.parse(trace[10]!)).toEqual({ paused: false, seekMs: 0 }); // loop restart
  });

  test("the ended state pauses the document (frozen last frame) without seeking", () => {
    const clock = fakeClock();
    const player = createSegmentPlayer({ clock: clock.now });
    const segment = buildHandSegment({ timestamps: [0, 1_000] });
    player.load({ segment, manifest: segment.manifest });
    player.play();
    clock.advance(2_000);
    player.tick();
    const view = player.view();
    expect(view.playback).toBe("ended");
    expect(view.smil).toEqual({ paused: true, seekMs: null });
  });
});

describe("segment player — determinism", () => {
  test("the same command/tick script over the same clock yields a deep-equal view trace", () => {
    function run(): string[] {
      const clock = fakeClock();
      const player = createSegmentPlayer({ clock: clock.now });
      const segment = realEncodedSegment();
      const trace: string[] = [];
      player.subscribe((view) => trace.push(JSON.stringify(view)));
      player.load({ segment, manifest: segment.manifest });
      player.play();
      clock.advance(1_200);
      player.tick();
      player.pause();
      player.seekToMs(2_000);
      player.stepBackward();
      player.replay();
      clock.advance(9_999);
      player.tick();
      return trace;
    }
    expect(run()).toEqual(run());
  });
});
