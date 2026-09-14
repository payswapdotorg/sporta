/**
 * Frame player tests (W702): frame-index math EXACT from manifest timing
 * (both a REAL W502 render manifest and a hand-authored non-uniform one),
 * seek/pause/step semantics, honest buffering (missing frames stall + flag,
 * never blank), explicit loop/replay, fail-loud manifest validation, and
 * deep-equal determinism reruns.
 */
import { describe, expect, test } from "bun:test";
import {
  ANIME_OUTPUT_PROFILE,
  ANIME_RENDERER_ID,
  ANIME_RENDERER_VERSION,
  renderAnimeClip,
} from "@sporta/renderer-anime";
import type { AnimeClipStep, AnimeFrame } from "@sporta/renderer-anime";
import { buildRenderRequest, buildWorldSnapshot } from "@sporta/testing";
import { createFramePlayer } from "../src/player.ts";
import type { PlayerViewModel } from "../src/player.ts";
import { buildHandOutput, fakeClock } from "./helpers.ts";
import type { BatchRenderOutput } from "../src/ports.ts";

const ALLOW_ALL = {
  canReferenceSourceFrames: true,
  canDeliverLive: true,
  canStoreDerivatives: true,
  canShare: true,
};

/**
 * A REAL W502 render output: 3 clip steps at t = 1000, 2500, 5000 (a
 * deliberately NON-UNIFORM timeline) → manifest windows
 * [1000,2500), [2500,5000), [5000,6000), duration 5000 ms, interval 1000 ms.
 */
function realW502Output(): BatchRenderOutput {
  const sessionId = "sess-player-real";
  const req = buildRenderRequest({
    sessionId,
    rendererId: ANIME_RENDERER_ID,
    rendererVersion: ANIME_RENDERER_VERSION,
    snapshotVersion: 1,
    eventsSinceSequence: 0,
    outputProfile: ANIME_OUTPUT_PROFILE,
    styleConfig: { styleId: "style-player-test", configSchemaVersion: "1.0", config: {} },
    rightsCapabilities: ALLOW_ALL,
    sourceFrameRefs: [],
  });
  const steps: AnimeClipStep[] = [1_000, 2_500, 5_000].map((atMs, index) => ({
    atMs,
    snapshot: buildWorldSnapshot(
      {
        sessionId,
        watermark: { watermarkMs: atMs, sequence: 10 + index },
        entities: [],
      },
      100 + index,
    ),
    events: [],
  }));
  const output = renderAnimeClip(req, steps);
  return { frames: output.frames, manifest: output.manifest };
}

describe("frame player — frame math exact from a real W502 manifest", () => {
  test("the manifest timing is what the tests assert against (evidence)", () => {
    const output = realW502Output();
    const { manifest } = output;
    expect(manifest.output.startMs).toBe(1_000);
    expect(manifest.output.frameIntervalMs).toBe(1_000);
    expect(manifest.output.durationMs).toBe(5_000);
    expect(manifest.frames.map((frame) => frame.outputTimestampMs)).toEqual([1_000, 2_500, 5_000]);
    expect(manifest.frames.map((frame) => frame.windowMs)).toEqual([
      { startMs: 1_000, endMs: 2_500 },
      { startMs: 2_500, endMs: 5_000 },
      { startMs: 5_000, endMs: 6_000 },
    ]);
    expect(output.frames).toHaveLength(3);
    for (const frame of output.frames) {
      expect(frame.svg.startsWith("<svg")).toBe(true);
    }
  });

  test("play + ticks advance through the exact window boundaries", () => {
    const clock = fakeClock();
    const player = createFramePlayer({ clock: () => clock.now() });
    const output = realW502Output();
    expect(player.load({ manifest: output.manifest, frames: output.frames })).toEqual({ ok: true });

    player.play();
    expect(player.view().playback).toBe("playing");
    expect(player.view().positionMs).toBe(0);
    expect(player.view().frameIndex).toBe(0);

    // t + 1499 → still frame 0 (window [1000, 2500) → position [0, 1500)).
    clock.advance(1_499);
    player.tick();
    let view: PlayerViewModel = player.view();
    expect(view.positionMs).toBe(1_499);
    expect(view.frameIndex).toBe(0);
    expect(view.timelineMs).toBe(2_499);
    expect(view.buffering).toBe(false);

    // +1 ms crosses the EXACT boundary: position 1500 → frame 1.
    clock.advance(1);
    player.tick();
    view = player.view();
    expect(view.positionMs).toBe(1_500);
    expect(view.frameIndex).toBe(1);

    // + 2499 → position 3999 (still frame 1: window [2500, 5000)).
    clock.advance(2_499);
    player.tick();
    view = player.view();
    expect(view.positionMs).toBe(3_999);
    expect(view.frameIndex).toBe(1);

    // +1 → position 4000 → frame 2 (window [5000, 6000) → position 4000).
    clock.advance(1);
    player.tick();
    view = player.view();
    expect(view.positionMs).toBe(4_000);
    expect(view.frameIndex).toBe(2);

    // + 999 → 4999: last frame, not ended (duration is 5000, exactly).
    clock.advance(999);
    player.tick();
    view = player.view();
    expect(view.positionMs).toBe(4_999);
    expect(view.frameIndex).toBe(2);
    expect(view.playback).toBe("playing");

    // +1 → target 5000 >= durationMs → ENDED exactly, holding the last frame.
    clock.advance(1);
    player.tick();
    view = player.view();
    expect(view.positionMs).toBe(5_000);
    expect(view.frameIndex).toBe(2);
    expect(view.playback).toBe("ended");
    expect(view.buffering).toBe(false);
  });

  test("seek lands on exact window boundaries and clamps", () => {
    const clock = fakeClock();
    const player = createFramePlayer({ clock: () => clock.now() });
    const output = realW502Output();
    player.load({ manifest: output.manifest, frames: output.frames });

    player.seekToMs(1_499);
    expect(player.view().frameIndex).toBe(0);
    expect(player.view().playback).toBe("paused");

    player.seekToMs(1_500);
    expect(player.view().frameIndex).toBe(1);

    player.seekToMs(4_000);
    expect(player.view().frameIndex).toBe(2);

    player.seekToMs(5_000);
    const view = player.view();
    expect(view.playback).toBe("ended");
    expect(view.frameIndex).toBe(2);

    // Out-of-range seeks clamp (never invented positions).
    player.seekToMs(99_999);
    expect(player.view().positionMs).toBe(5_000);
    player.seekToMs(-50);
    expect(player.view().positionMs).toBe(0);
    expect(player.view().frameIndex).toBe(0);
    expect(player.view().playback).toBe("paused");
  });

  test("seek while playing keeps playing (time base reset, no time debt)", () => {
    const clock = fakeClock();
    const player = createFramePlayer({ clock: () => clock.now() });
    const output = realW502Output();
    player.load({ manifest: output.manifest, frames: output.frames });
    player.play();
    clock.advance(1_000);
    player.tick();
    expect(player.view().positionMs).toBe(1_000);

    player.seekToMs(4_000);
    expect(player.view().playback).toBe("playing");
    clock.advance(500);
    player.tick();
    expect(player.view().positionMs).toBe(4_500);
  });
});

describe("frame player — step / pause / replay semantics (hand manifest)", () => {
  // Windows: [0,1000), [1000,2500), [2500,4000), [4000,5000); duration 5000.
  function makePlayer() {
    const clock = fakeClock();
    const player = createFramePlayer({ clock: () => clock.now() });
    const output = buildHandOutput([0, 1_000, 2_500, 4_000]);
    const result = player.load({ manifest: output.manifest, frames: output.frames });
    expect(result).toEqual({ ok: true });
    return { player, clock, output };
  }

  test("stepForward walks frame starts and ends exactly at durationMs", () => {
    const { player } = makePlayer();
    player.stepForward();
    expect(player.view().positionMs).toBe(1_000);
    expect(player.view().frameIndex).toBe(1);
    expect(player.view().playback).toBe("paused");

    player.stepForward();
    expect(player.view().positionMs).toBe(2_500);
    expect(player.view().frameIndex).toBe(2);

    player.stepForward();
    expect(player.view().positionMs).toBe(4_000);
    expect(player.view().frameIndex).toBe(3);

    player.stepForward();
    const view = player.view();
    expect(view.positionMs).toBe(5_000);
    expect(view.playback).toBe("ended");

    player.stepForward(); // at ended: no-op
    expect(player.view().positionMs).toBe(5_000);
    expect(player.view().playback).toBe("ended");
  });

  test("stepBackward snaps to the current frame start, then to previous frames", () => {
    const { player } = makePlayer();
    player.seekToMs(2_600); // mid frame 2 (window [2500, 4000))
    player.stepBackward();
    expect(player.view().positionMs).toBe(2_500);

    player.stepBackward();
    expect(player.view().positionMs).toBe(1_000);
    expect(player.view().frameIndex).toBe(1);

    player.stepBackward();
    expect(player.view().positionMs).toBe(0);
    expect(player.view().frameIndex).toBe(0);

    player.stepBackward(); // at frame 0: stays
    expect(player.view().positionMs).toBe(0);
    expect(player.view().frameIndex).toBe(0);
  });

  test("stepBackward from ended returns to the last frame start", () => {
    const { player } = makePlayer();
    player.seekToMs(5_000);
    expect(player.view().playback).toBe("ended");
    player.stepBackward();
    const view = player.view();
    expect(view.positionMs).toBe(4_000);
    expect(view.frameIndex).toBe(3);
    expect(view.playback).toBe("paused");
  });

  test("pause freezes the playhead; play at ended is a no-op (replay is explicit)", () => {
    const { player, clock } = makePlayer();
    player.play();
    clock.advance(1_200);
    player.tick();
    expect(player.view().positionMs).toBe(1_200);
    player.pause();
    clock.advance(3_000);
    player.tick();
    expect(player.view().positionMs).toBe(1_200);
    expect(player.view().playback).toBe("paused");

    player.seekToMs(5_000);
    expect(player.view().playback).toBe("ended");
    player.play();
    expect(player.view().playback).toBe("ended");

    player.replay();
    const view = player.view();
    expect(view.positionMs).toBe(0);
    expect(view.frameIndex).toBe(0);
    expect(view.playback).toBe("playing");
    clock.advance(999);
    player.tick();
    expect(player.view().positionMs).toBe(999);
  });
});

describe("frame player — honest buffering (never blank, stalls the playhead)", () => {
  test("a missing frame stalls playback at its window start and shows buffering", () => {
    const clock = fakeClock();
    const player = createFramePlayer({ clock: () => clock.now() });
    const output = buildHandOutput([0, 1_000, 2_500, 4_000]);
    // Only frames 0 and 1 are available at load time.
    player.load({
      manifest: output.manifest,
      frames: [output.frames[0]!, output.frames[1]!],
    });
    player.play();

    clock.advance(1_500);
    player.tick();
    let view = player.view();
    expect(view.positionMs).toBe(1_500);
    expect(view.frameIndex).toBe(1);
    expect(view.buffering).toBe(false);

    // Target 2500 needs frame 2, which is missing: STALL at 2500.
    clock.advance(1_000);
    player.tick();
    view = player.view();
    expect(view.positionMs).toBe(2_500);
    expect(view.frameIndex).toBe(2);
    expect(view.playback).toBe("playing");
    expect(view.buffering).toBe(true);
    expect(view.frameSvg).toBe(null); // honest: no frame to show, flagged

    // The stall holds — the clock keeps running but the playhead does not.
    clock.advance(5_000);
    player.tick();
    view = player.view();
    expect(view.positionMs).toBe(2_500);
    expect(view.buffering).toBe(true);

    // Frame 2 arrives: buffering clears and playback resumes WITHOUT debt.
    expect(player.supplyFrame(output.frames[2]!)).toEqual({ ok: true });
    view = player.view();
    expect(view.buffering).toBe(false);
    expect(view.frameSvg).toBe(output.frames[2]!.svg);
    clock.advance(1_400);
    player.tick();
    expect(player.view().positionMs).toBe(3_900);
    expect(player.view().frameIndex).toBe(2);

    // Frame 3 missing: stall at 4000; supply; then end exactly at 5000.
    clock.advance(1_000);
    player.tick();
    expect(player.view().positionMs).toBe(4_000);
    expect(player.view().buffering).toBe(true);
    player.supplyFrame(output.frames[3]!);
    clock.advance(999);
    player.tick();
    expect(player.view().positionMs).toBe(4_999);
    expect(player.view().playback).toBe("playing");
    clock.advance(1);
    player.tick();
    const final = player.view();
    expect(final.playback).toBe("ended");
    expect(final.positionMs).toBe(5_000);
    expect(final.buffering).toBe(false);
  });

  test("seeking to a missing frame while paused stays honestly buffered", () => {
    const clock = fakeClock();
    const player = createFramePlayer({ clock: () => clock.now() });
    const output = buildHandOutput([0, 1_000, 2_500, 4_000]);
    player.load({ manifest: output.manifest, frames: [output.frames[0]!] });
    player.seekToMs(2_500);
    const view = player.view();
    expect(view.buffering).toBe(true);
    expect(view.frameSvg).toBe(null);
    expect(view.playback).toBe("paused");
    player.supplyFrame(output.frames[2]!);
    expect(player.view().buffering).toBe(false);
  });

  test("an output with no frames yet is buffering from the first view", () => {
    const clock = fakeClock();
    const player = createFramePlayer({ clock: () => clock.now() });
    const output = buildHandOutput([0, 1_000]);
    player.load({ manifest: output.manifest });
    const view = player.view();
    expect(view.frameCount).toBe(2);
    expect(view.availableFrames).toBe(0);
    expect(view.buffering).toBe(true);
    expect(view.frameSvg).toBe(null);
  });
});

describe("frame player — loop and replay are explicit", () => {
  test("loop auto-restarts exactly at the ending tick; no loop stays ended", () => {
    const clock = fakeClock();
    const player = createFramePlayer({ clock: () => clock.now() });
    const output = buildHandOutput([0, 1_000]);
    player.load({ manifest: output.manifest, frames: output.frames });
    player.play();
    clock.advance(2_000);
    player.tick();
    expect(player.view().playback).toBe("ended"); // duration is exactly 2000

    // setLoop AFTER the end does not implicitly replay.
    player.setLoop(true);
    expect(player.view().playback).toBe("ended");

    // Explicit replay with loop armed: the next ending tick restarts.
    player.replay();
    clock.advance(1_500);
    player.tick();
    expect(player.view().positionMs).toBe(1_500);
    clock.advance(500);
    player.tick();
    const view = player.view();
    expect(view.playback).toBe("playing");
    expect(view.positionMs).toBe(0);
    expect(view.frameIndex).toBe(0);
    expect(view.buffering).toBe(false);
  });
});

describe("frame player — fail-loud manifest validation (never invented timing)", () => {
  function loadMutations(output: BatchRenderOutput) {
    const clock = fakeClock();
    const player = createFramePlayer({ clock: () => clock.now() });
    return { player, result: player.load({ manifest: output.manifest, frames: output.frames }) };
  }

  test("a window gap is rejected with the exact violation", () => {
    const output = buildHandOutput([0, 1_000, 3_000]);
    // Make the windows non-contiguous: shift frame 1's window start.
    const broken = structuredClone(output);
    broken.manifest.frames[1]!.windowMs = { startMs: 1_500, endMs: 3_000 };
    broken.manifest.frames[1]!.outputTimestampMs = 1_500;
    const { player, result } = loadMutations(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.failureClass).toBe("media-invalid");
      expect(result.error.message).toContain("contiguous");
      expect(result.error.message).toContain("1500");
    }
    expect(player.view().frameCount).toBe(0); // nothing loaded
  });

  test("the last window must end exactly at startMs + durationMs", () => {
    const output = buildHandOutput([0, 1_000]);
    const broken = structuredClone(output);
    broken.manifest.output.durationMs = 1_999;
    const { result } = loadMutations(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("ends at 2000");
      expect(result.error.message).toContain("1999");
    }
  });

  test("frameIndex must match the array position", () => {
    const output = buildHandOutput([0, 1_000]);
    const broken = structuredClone(output);
    broken.manifest.frames[1]!.frameIndex = 7;
    const { result } = loadMutations(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("frameIndex is 7");
  });

  test("the first window must start at output.startMs", () => {
    const output = buildHandOutput([0, 1_000]);
    const broken = structuredClone(output);
    broken.manifest.frames[0]!.windowMs = { startMs: 100, endMs: 1_100 };
    broken.manifest.frames[0]!.outputTimestampMs = 100;
    const { result } = loadMutations(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("output.startMs");
  });

  test("empty frames, bad interval, and a descending window are rejected", () => {
    const output = buildHandOutput([0, 1_000]);
    const empty = structuredClone(output);
    empty.manifest.frames = [];
    const { result: emptyResult } = loadMutations(empty);
    expect(emptyResult.ok).toBe(false);

    const badInterval = structuredClone(output);
    badInterval.manifest.output.frameIntervalMs = 0;
    const { result: intervalResult } = loadMutations(badInterval);
    expect(intervalResult.ok).toBe(false);

    const descending = structuredClone(output);
    descending.manifest.frames[1]!.windowMs = { startMs: 1_000, endMs: 500 };
    const { result: descResult } = loadMutations(descending);
    expect(descResult.ok).toBe(false);
  });

  test("a frame provided at load that mismatches the manifest rejects the whole load (state untouched)", () => {
    const clock = fakeClock();
    const player = createFramePlayer({ clock: () => clock.now() });
    const good = buildHandOutput([0, 1_000]);
    expect(player.load({ manifest: good.manifest, frames: good.frames })).toEqual({ ok: true });
    player.play();

    const next = buildHandOutput([2_000, 3_000]);
    const badFrames = [{ ...next.frames[0]!, outputTimestampMs: 9_999 }];
    const result = player.load({ manifest: next.manifest, frames: badFrames });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("9999");
    // The previous playback state is untouched.
    const view = player.view();
    expect(view.frameCount).toBe(2);
    expect(view.playback).toBe("playing");
    expect(view.durationMs).toBe(2_000);
  });

  test("load with a duplicate index and DIFFERENT content rejects (never silent last-wins)", () => {
    const clock = fakeClock();
    const player = createFramePlayer({ clock: () => clock.now() });
    const output = buildHandOutput([0, 1_000]);
    expect(player.load({ manifest: output.manifest, frames: output.frames })).toEqual({ ok: true });
    player.play();

    const conflicting: Array<AnimeFrame> = [
      { ...output.frames[0]! },
      { ...output.frames[0]!, svg: "<svg>impostor</svg>" },
    ];
    const result = player.load({ manifest: output.manifest, frames: conflicting });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.failureClass).toBe("media-invalid");
      expect(result.error.message).toContain("supplied twice with different content");
    }
    // The previous playback state is untouched (fail-loud, not overwritten).
    const view = player.view();
    expect(view.playback).toBe("playing");
    expect(view.frameSvg).toBe(output.frames[0]!.svg);
    expect(view.availableFrames).toBe(2);
  });

  test("load with a duplicate index and IDENTICAL content is an idempotent no-op", () => {
    const clock = fakeClock();
    const player = createFramePlayer({ clock: () => clock.now() });
    const output = buildHandOutput([0, 1_000]);
    const doubled: Array<AnimeFrame> = [
      { ...output.frames[0]! },
      { ...output.frames[0]! },
      { ...output.frames[1]! },
    ];
    const result = player.load({ manifest: output.manifest, frames: doubled });
    expect(result).toEqual({ ok: true });
    const view = player.view();
    expect(view.availableFrames).toBe(2);
    expect(view.frameSvg).toBe(output.frames[0]!.svg);
  });

  test("load with a non-frame entry (sparse hole / null) rejects fail-loud (never a crash)", () => {
    const clock = fakeClock();
    const player = createFramePlayer({ clock: () => clock.now() });
    const output = buildHandOutput([0, 1_000]);
    // Sparse array: index 1 is a hole (undefined at runtime).
    const sparse: Array<AnimeFrame> = [output.frames[0]!];
    sparse[2] = output.frames[1]!;
    const sparseResult = player.load({ manifest: output.manifest, frames: sparse });
    expect(sparseResult.ok).toBe(false);
    if (!sparseResult.ok) {
      expect(sparseResult.error.failureClass).toBe("media-invalid");
      expect(sparseResult.error.message).toContain("is not a frame document");
    }
    const withNull = player.load({
      manifest: output.manifest,
      frames: [output.frames[0]!, null as unknown as AnimeFrame],
    });
    expect(withNull.ok).toBe(false);
    // Nothing loaded by either attempt.
    expect(player.view().frameCount).toBe(0);
  });

  test("supplyFrame rejects out-of-range, mismatched, conflicting, and NON-STRING svg frames", () => {
    const clock = fakeClock();
    const player = createFramePlayer({ clock: () => clock.now() });
    const output = buildHandOutput([0, 1_000]);
    player.load({ manifest: output.manifest, frames: output.frames });

    const outOfRange = player.supplyFrame({ frameIndex: 5, outputTimestampMs: 0, svg: "<svg/>" });
    expect(outOfRange.ok).toBe(false);

    const mismatch = player.supplyFrame({
      frameIndex: 1,
      outputTimestampMs: 4_242,
      svg: "<svg/>",
    });
    expect(mismatch.ok).toBe(false);

    const conflict = player.supplyFrame({
      frameIndex: 0,
      outputTimestampMs: 0,
      svg: "<svg>different</svg>",
    });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.message).toContain("different content");

    // A non-string svg is a fail-loud rejection (never a silent blank frame).
    const notString = player.supplyFrame({
      frameIndex: 1,
      outputTimestampMs: 1_000,
      svg: undefined as unknown as string,
    });
    expect(notString.ok).toBe(false);
    if (!notString.ok) {
      expect(notString.error.failureClass).toBe("media-invalid");
      expect(notString.error.message).toContain("non-string svg");
    }

    const sameAgain = player.supplyFrame(output.frames[0]!);
    expect(sameAgain).toEqual({ ok: true });
  });

  test("supplyFrame before any load is rejected", () => {
    const clock = fakeClock();
    const player = createFramePlayer({ clock: () => clock.now() });
    const result = player.supplyFrame({ frameIndex: 0, outputTimestampMs: 0, svg: "<svg/>" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("before an output is loaded");
  });
});

describe("frame player — determinism (deep-equal reruns)", () => {
  test("the same script over the same clock yields a deep-equal view trace", () => {
    function runScript(): string[] {
      const clock = fakeClock();
      const player = createFramePlayer({ clock: () => clock.now() });
      const output = buildHandOutput([0, 1_000, 2_500, 4_000]);
      const trace: string[] = [];
      player.subscribe((view) => trace.push(JSON.stringify(view)));
      player.load({ manifest: output.manifest, frames: [output.frames[0]!, output.frames[1]!] });
      player.play();
      clock.advance(2_600);
      player.tick();
      player.supplyFrame(output.frames[2]!);
      clock.advance(1_500);
      player.tick();
      player.pause();
      player.seekToMs(4_200);
      player.stepBackward();
      player.replay();
      clock.advance(4_999);
      player.tick();
      clock.advance(1);
      player.tick();
      return trace;
    }
    expect(runScript()).toEqual(runScript());
  });
});
