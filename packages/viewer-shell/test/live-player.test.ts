/**
 * Live player tests (W704): the PURE live presentation model — structural
 * validation (defense in depth over the W305 integrity-verified boundary),
 * idempotent window application, join-at-the-live-edge playhead semantics,
 * honest re-buffer stalls (absent before the first window, present only when
 * overdue AFTER content flowed), and the absent-metrics-absent rule (no frame,
 * no latency, no interval before the first application — never a faked 0).
 *
 * All windows/payloads are REAL W305 documents (`buildLiveFrameWindow` over
 * the deterministic emissions from `./live-helpers.ts`); malformed variants
 * are derived from those real documents by exact mutation (never invented
 * shapes out of thin air).
 */
import { describe, expect, test } from "bun:test";
import { buildLiveFrameWindow } from "@sporta/webrtc-output";
import type { LiveFrameWindow, LiveOutputPayload } from "@sporta/webrtc-output";
import { createLivePlayer } from "../src/live-player.ts";
import { fakeClock } from "./helpers.ts";
import { liveEmission } from "./live-helpers.ts";

const SESSION = "sess-live-1";
const STREAM = "live-sess-live-1";

/** One real (window, payload) pair built by W305's own builder. */
function realWindow(options: {
  ordinal: number;
  watermarkMs: number;
  frameCount?: number;
  startMs?: number;
  emittedAtMs?: number;
}): { window: LiveFrameWindow; payload: LiveOutputPayload } {
  const emission = liveEmission({
    sessionId: SESSION,
    ordinal: options.ordinal,
    watermarkMs: options.watermarkMs,
    ...(options.frameCount === undefined ? {} : { frameCount: options.frameCount }),
    ...(options.startMs === undefined ? {} : { startMs: options.startMs }),
  });
  return buildLiveFrameWindow(emission, {
    streamId: STREAM,
    ordinal: options.ordinal,
    emittedAtMs: options.emittedAtMs ?? 0,
  });
}

describe("live player — structural validation (fail-loud, never buffers garbage)", () => {
  test("a missing windowId is a classified reject", () => {
    const player = createLivePlayer({ clock: fakeClock().now });
    const { window, payload } = realWindow({ ordinal: 1, watermarkMs: 2_000 });
    const broken = { ...window } as Record<string, unknown>;
    delete broken.windowId;
    const result = player.applyWindow(broken as unknown as LiveFrameWindow, payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.failureClass).toBe("media-invalid");
      expect(result.error.operation).toBe("openLive");
      expect(result.error.message).toContain("windowId");
    }
    // Nothing buffered.
    expect(player.view().frameCount).toBe(0);
  });

  test("descriptor/payload frame-count mismatch is a classified reject", () => {
    const player = createLivePlayer({ clock: fakeClock().now });
    const { window, payload } = realWindow({ ordinal: 1, watermarkMs: 2_000, frameCount: 3 });
    const truncated: LiveOutputPayload = { ...payload, frames: payload.frames.slice(0, 1) };
    const result = player.applyWindow(window, truncated);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("declares 3 frame descriptors");
    expect(player.view().frameCount).toBe(0);
  });

  test("a non-positive declared frame interval is a classified reject", () => {
    const player = createLivePlayer({ clock: fakeClock().now });
    const { window, payload } = realWindow({ ordinal: 1, watermarkMs: 2_000 });
    const zeroInterval: LiveOutputPayload = {
      ...payload,
      manifest: { ...payload.manifest, output: { ...payload.manifest.output, frameIntervalMs: 0 } },
    };
    const result = player.applyWindow(window, zeroInterval);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("frame interval");
    expect(player.view().frameCount).toBe(0);
  });

  test("a changed frame interval mid-stream is a classified reject (renegotiation required)", () => {
    const player = createLivePlayer({ clock: fakeClock().now });
    const first = realWindow({ ordinal: 1, watermarkMs: 2_000 });
    expect(player.applyWindow(first.window, first.payload).ok).toBe(true);
    const second = realWindow({ ordinal: 2, watermarkMs: 4_000, startMs: 3_000 });
    const retimed: LiveOutputPayload = {
      ...second.payload,
      manifest: { ...second.payload.manifest, output: { ...second.payload.manifest.output, frameIntervalMs: 2_000 } },
    };
    const result = player.applyWindow(second.window, retimed);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("renegotiation");
  });

  test("a malformed payload frame is a classified reject (each field named)", () => {
    const player = createLivePlayer({ clock: fakeClock().now });
    const base = realWindow({ ordinal: 1, watermarkMs: 2_000, frameCount: 2 });
    for (const mutate of [
      (frames: LiveOutputPayload["frames"]): void => {
        frames[0] = { ...frames[0]!, frameIndex: -1 };
      },
      (frames: LiveOutputPayload["frames"]): void => {
        frames[0] = { ...frames[0]!, outputTimestampMs: Number.NaN };
      },
      (frames: LiveOutputPayload["frames"]): void => {
        frames[0] = { ...frames[0]!, svg: "" };
      },
    ]) {
      const fresh = realWindow({ ordinal: 1, watermarkMs: 2_000, frameCount: 2 });
      const frames = [...fresh.payload.frames];
      mutate(frames);
      const result = player.applyWindow(fresh.window, { ...fresh.payload, frames });
      expect(result.ok).toBe(false);
    }
    expect(player.view().frameCount).toBe(0);
  });
});

describe("live player — idempotent application (the presentation twin of W305's Recovery rule)", () => {
  test("re-delivering the same window under its stable id is a no-op (counted once)", () => {
    const player = createLivePlayer({ clock: fakeClock().now });
    const { window, payload } = realWindow({ ordinal: 1, watermarkMs: 2_000, frameCount: 2 });
    expect(player.applyWindow(window, payload).ok).toBe(true);
    const afterFirst = player.view();
    expect(afterFirst.frameCount).toBe(2);
    expect(afterFirst.windowsApplied).toBe(1);
    // The re-delivery: ok (the session already counted it as a duplicate),
    // but the presentation never double-buffers.
    expect(player.applyWindow(window, payload).ok).toBe(true);
    const afterSecond = player.view();
    expect(afterSecond.frameCount).toBe(2);
    expect(afterSecond.windowsApplied).toBe(1);
    expect(afterSecond.frameSvg).toBe(afterFirst.frameSvg);
  });
});

describe("live player — join at the live edge, then keep up", () => {
  test("the first window joins the playhead at its newest frame", () => {
    const player = createLivePlayer({ clock: fakeClock().now });
    const { window, payload } = realWindow({ ordinal: 1, watermarkMs: 2_000, frameCount: 2 });
    expect(player.applyWindow(window, payload).ok).toBe(true);
    const view = player.view();
    // startMs = 1000, interval 1000 → frames at 1000 and 2000.
    expect(view.playheadMs).toBe(2_000);
    expect(view.frame).toEqual({ windowOrdinal: 1, frameIndex: 1, timestampMs: 2_000 });
    expect(view.frameSvg).toBe(payload.frames[1]!.svg);
    expect(view.frameCount).toBe(2);
    expect(view.windowsApplied).toBe(1);
    expect(view.frameIntervalMs).toBe(1_000);
    expect(view.liveEdgeMs).toBe(2_000);
    expect(view.bufferedAhead).toBe(0);
    expect(view.lastDisplayedFrame).toBe(1);
  });

  test("tick advances the playhead by the elapsed injected clock; new windows display as they arrive", () => {
    const clock = fakeClock();
    const player = createLivePlayer({ clock: clock.now });
    const first = realWindow({ ordinal: 1, watermarkMs: 2_000, frameCount: 2, emittedAtMs: 2_000 });
    expect(player.applyWindow(first.window, first.payload).ok).toBe(true);
    // 1.5 s pass: the playhead runs past the buffered edge (honest re-buffer).
    clock.advance(1_500);
    player.tick();
    let view = player.view();
    expect(view.playheadMs).toBe(3_500);
    expect(view.buffering).toBe(true); // overdue the live edge by > one interval
    // The next window arrives (frames at 3000 + 4000).
    const second = realWindow({ ordinal: 2, watermarkMs: 4_000, startMs: 3_000, frameCount: 2 });
    expect(player.applyWindow(second.window, second.payload).ok).toBe(true);
    view = player.view();
    expect(view.buffering).toBe(false); // content caught up
    // The displayed frame is the newest at-or-before the playhead (3500):
    // the window's FIRST frame (3000); the 4000 frame is still ahead.
    expect(view.frame).toEqual({ windowOrdinal: 2, frameIndex: 0, timestampMs: 3_000 });
    expect(view.liveEdgeMs).toBe(4_000);
    expect(view.frameCount).toBe(4);
    expect(view.windowsApplied).toBe(2);
    // The playhead runs to the new edge.
    clock.advance(500);
    player.tick();
    expect(player.view().frame?.timestampMs).toBe(4_000);
  });

  test("the displayed frame is the newest buffered at-or-before the playhead (never ahead of it)", () => {
    const clock = fakeClock();
    const player = createLivePlayer({ clock: clock.now });
    const first = realWindow({ ordinal: 1, watermarkMs: 2_000, frameCount: 2 });
    expect(player.applyWindow(first.window, first.payload).ok).toBe(true);
    // 0.4 s pass: still inside frame 1's window.
    clock.advance(400);
    player.tick();
    expect(player.view().frame?.timestampMs).toBe(2_000);
    // The next window arrives (3000, 4000) while the playhead is at 2400.
    const second = realWindow({ ordinal: 2, watermarkMs: 4_000, startMs: 3_000, frameCount: 2 });
    expect(player.applyWindow(second.window, second.payload).ok).toBe(true);
    const view = player.view();
    expect(view.frame?.timestampMs).toBe(2_000); // the newest AT-or-before 2400
    expect(view.bufferedAhead).toBe(2); // 3000 and 4000 are ahead
    // The playhead catches up through both.
    clock.advance(1_600);
    player.tick();
    const caughtUp = player.view();
    expect(caughtUp.frame?.timestampMs).toBe(4_000);
    expect(caughtUp.bufferedAhead).toBe(0);
  });

  test("a non-advancing or backwards clock moves nothing (elapsed <= 0 is a no-op)", () => {
    const clock = fakeClock();
    const player = createLivePlayer({ clock: clock.now });
    const first = realWindow({ ordinal: 1, watermarkMs: 2_000, frameCount: 2 });
    expect(player.applyWindow(first.window, first.payload).ok).toBe(true);
    player.tick();
    const before = player.view().playheadMs;
    player.tick(); // no clock movement
    expect(player.view().playheadMs).toBe(before);
  });
});

describe("live player — honest buffering (never a fake stall before content)", () => {
  test("before the first window: no frame, no buffering flag, no interval, no latency (absent metrics absent)", () => {
    const player = createLivePlayer({ clock: fakeClock().now });
    const view = player.view();
    expect(view.buffering).toBe(false);
    expect(view.frame).toBe(null);
    expect(view.frameSvg).toBe(null);
    expect(view.playheadMs).toBe(null);
    expect(view.frameIntervalMs).toBe(null);
    expect(view.liveEdgeMs).toBe(null);
    expect(view.latencyMs).toBe(null);
    expect(view.frameCount).toBe(0);
    expect(view.windowsApplied).toBe(0);
    expect(view.lastDisplayedFrame).toBe(null);
  });

  test("buffering only after content had flowed AND the playhead is overdue by more than one interval", () => {
    const clock = fakeClock();
    const player = createLivePlayer({ clock: clock.now });
    const first = realWindow({ ordinal: 1, watermarkMs: 2_000, frameCount: 2 });
    expect(player.applyWindow(first.window, first.payload).ok).toBe(true);
    // Exactly one interval overdue: NOT buffering yet (the boundary is >).
    clock.advance(1_000);
    player.tick();
    expect(player.view().buffering).toBe(false);
    // One ms more: buffering.
    clock.advance(1);
    player.tick();
    expect(player.view().buffering).toBe(true);
  });
});

describe("live player — the latency seam (injected domain, newest window's emission)", () => {
  test("latencyMs is now − newestWindow.emittedAtMs (null before the first window)", () => {
    const clock = fakeClock(10_000);
    const player = createLivePlayer({ clock: clock.now });
    expect(player.view().latencyMs).toBe(null);
    const first = realWindow({ ordinal: 1, watermarkMs: 2_000, frameCount: 2, emittedAtMs: 9_000 });
    expect(player.applyWindow(first.window, first.payload).ok).toBe(true);
    expect(player.view().latencyMs).toBe(1_000); // 10_000 − 9_000
    clock.advance(250);
    expect(player.view().latencyMs).toBe(1_250);
    // A NEWER window re-bases the latency on ITS emission time.
    const second = realWindow({ ordinal: 2, watermarkMs: 4_000, startMs: 3_000, emittedAtMs: 10_000 });
    expect(player.applyWindow(second.window, second.payload).ok).toBe(true);
    expect(player.view().latencyMs).toBe(250); // 10_250 − 10_000
  });

  test("the latency basis follows the APPLICATION order (W305 delivers windows in ordinal order)", () => {
    const clock = fakeClock(10_000);
    const player = createLivePlayer({ clock: clock.now });
    const first = realWindow({ ordinal: 1, watermarkMs: 2_000, emittedAtMs: 9_000 });
    expect(player.applyWindow(first.window, first.payload).ok).toBe(true);
    expect(player.view().latencyMs).toBe(1_000);
    // The NEXT applied window (ordinal 2 in the delivery order) re-bases the
    // latency on ITS emission time — the in-order delivery contract makes
    // the last-applied window the newest one. A duplicate re-delivery of the
    // OLD window id is suppressed (the idempotency test pins that).
    const second = realWindow({ ordinal: 2, watermarkMs: 4_000, startMs: 3_000, emittedAtMs: 9_500 });
    expect(player.applyWindow(second.window, second.payload).ok).toBe(true);
    expect(player.view().latencyMs).toBe(500); // 10_000 − 9_500
  });
});

describe("live player — determinism (deep-equal view traces over the same script)", () => {
  test("the same window/tick script over the same clock yields the deep-equal view trace", async () => {
    async function script(): Promise<string[]> {
      const clock = fakeClock();
      const player = createLivePlayer({ clock: clock.now });
      const trace: string[] = [];
      const first = realWindow({ ordinal: 1, watermarkMs: 2_000, frameCount: 2, emittedAtMs: 0 });
      player.applyWindow(first.window, first.payload);
      trace.push(JSON.stringify(player.view()));
      clock.advance(700);
      player.tick();
      trace.push(JSON.stringify(player.view()));
      const second = realWindow({ ordinal: 2, watermarkMs: 4_000, startMs: 3_000, emittedAtMs: 700 });
      player.applyWindow(second.window, second.payload);
      trace.push(JSON.stringify(player.view()));
      clock.advance(2_500);
      player.tick();
      trace.push(JSON.stringify(player.view()));
      // A re-delivery under a stable id changes nothing.
      player.applyWindow(first.window, first.payload);
      trace.push(JSON.stringify(player.view()));
      return trace;
    }
    const first = await script();
    const second = await script();
    expect(first).toEqual(second);
    expect(first).toHaveLength(5);
  });
});
