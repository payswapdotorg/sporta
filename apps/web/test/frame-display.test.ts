import { describe, expect, test } from "bun:test";
import {
  DISPLAY_RATES,
  advanceFramePlayer,
  deriveFrameRateProfile,
  formatDisplayMs,
  frameIndexAtMs,
  framePlayerModel,
  initialFramePlayer,
  pauseFramePlayer,
  placeEventMarkers,
  playFramePlayer,
  seekFramePlayer,
  setDisplayRate,
  snapToNearestFrame,
  type FramePlayerModel,
} from "../src/lib/frame-display";
import { FrameSvgError, frameIndicesOf, prepareFrameForDisplay } from "../src/lib/frame-svg";

/**
 * THE FRAME-DISPLAY MODEL (W905) — the player's honest clock. The manifest's
 * numbers are the ONLY numbers: the model maps manifest timing to display,
 * seeking SNAPS to real frames, playback ends at the real end, and event
 * markers land on the frames the render itself applied each event to.
 */

/** A real-shaped three-frame manifest: 0–1000, 1000–2500, 2500–4000 ms. */
function threeFrameManifest() {
  return {
    totalDurationMs: 4_000,
    frames: [
      { frameIndex: 0, beginMs: 0, durMs: 1_000 },
      { frameIndex: 1, beginMs: 1_000, durMs: 1_500 },
      { frameIndex: 2, beginMs: 2_500, durMs: 1_500 },
    ],
  };
}

describe("framePlayerModel (manifest timing → display)", () => {
  test("maps the manifest's windows verbatim, sorted by begin", () => {
    const model = framePlayerModel({
      totalDurationMs: 4_000,
      frames: [
        { frameIndex: 2, beginMs: 2_500, durMs: 1_500 },
        { frameIndex: 0, beginMs: 0, durMs: 1_000 },
        { frameIndex: 1, beginMs: 1_000, durMs: 1_500 },
      ],
    });
    expect(model.windows.map((w) => w.frameIndex)).toEqual([0, 1, 2]);
    expect(model.windows.map((w) => w.beginMs)).toEqual([0, 1_000, 2_500]);
    expect(model.windows.map((w) => w.endMs)).toEqual([1_000, 2_500, 4_000]);
    expect(model.totalDurationMs).toBe(4_000);
  });

  test("the total never lies below the last window's real end", () => {
    const model = framePlayerModel({
      totalDurationMs: 3_000, // under-reports
      frames: threeFrameManifest().frames,
    });
    expect(model.totalDurationMs).toBe(4_000);
  });

  test("an empty manifest yields an empty, ended model", () => {
    const model = framePlayerModel({ totalDurationMs: 0, frames: [] });
    expect(model.windows).toEqual([]);
    const initial = initialFramePlayer(model);
    expect(initial.playheadMs).toBe(0);
    expect(initial.playing).toBe(false);
    expect(initial.ended).toBe(true);
  });
});

describe("initialFramePlayer + frameIndexAtMs (the displayed frame is always real)", () => {
  const model = framePlayerModel(threeFrameManifest());

  test("the player starts paused on the first real frame", () => {
    const initial = initialFramePlayer(model);
    expect(initial.playheadMs).toBe(0);
    expect(initial.playing).toBe(false);
    expect(initial.rate).toBe(1);
    expect(initial.ended).toBe(false);
  });

  test("each playhead position maps to the frame whose window contains it", () => {
    expect(frameIndexAtMs(model, 0)).toBe(0);
    expect(frameIndexAtMs(model, 999)).toBe(0);
    expect(frameIndexAtMs(model, 1_000)).toBe(1);
    expect(frameIndexAtMs(model, 2_499)).toBe(1);
    expect(frameIndexAtMs(model, 2_500)).toBe(2);
    expect(frameIndexAtMs(model, 3_999)).toBe(2);
  });

  test("positions outside the artifact clamp to the first/last real frame", () => {
    expect(frameIndexAtMs(model, -50)).toBe(0);
    expect(frameIndexAtMs(model, 99_999)).toBe(2);
    expect(frameIndexAtMs(model, Number.NaN)).toBe(0);
    expect(frameIndexAtMs(framePlayerModel({ totalDurationMs: 0, frames: [] }), 100)).toBe(-1);
  });

  test("a gap between windows falls back to the last window that started at/before it", () => {
    const gapped = framePlayerModel({
      totalDurationMs: 4_000,
      frames: [
        { frameIndex: 0, beginMs: 0, durMs: 1_000 },
        { frameIndex: 1, beginMs: 2_000, durMs: 2_000 },
      ],
    });
    expect(frameIndexAtMs(gapped, 1_500)).toBe(0);
  });
});

describe("snapToNearestFrame (seek snapping — frames are discrete)", () => {
  const model = framePlayerModel(threeFrameManifest());

  test("seek snaps to the nearest real frame boundary, ties to the earlier", () => {
    expect(snapToNearestFrame(model, 0)).toEqual({ frameIndex: 0, playheadMs: 0 });
    expect(snapToNearestFrame(model, 400)).toEqual({ frameIndex: 0, playheadMs: 0 });
    // 500 is equidistant between 0 and 1000 — the EARLIER frame wins.
    expect(snapToNearestFrame(model, 500)).toEqual({ frameIndex: 0, playheadMs: 0 });
    expect(snapToNearestFrame(model, 501)).toEqual({ frameIndex: 1, playheadMs: 1_000 });
    expect(snapToNearestFrame(model, 1_751)).toEqual({ frameIndex: 2, playheadMs: 2_500 });
    // 1750 is equidistant between 1000 and 2500 — earlier wins.
    expect(snapToNearestFrame(model, 1_750)).toEqual({ frameIndex: 1, playheadMs: 1_000 });
    expect(snapToNearestFrame(model, 3_900)).toEqual({ frameIndex: 2, playheadMs: 2_500 });
  });

  test("out-of-range positions snap to the real boundary frames", () => {
    expect(snapToNearestFrame(model, -9_999)).toEqual({ frameIndex: 0, playheadMs: 0 });
    expect(snapToNearestFrame(model, 9_999)).toEqual({ frameIndex: 2, playheadMs: 2_500 });
    expect(snapToNearestFrame(model, Number.NaN)).toEqual({ frameIndex: 0, playheadMs: 0 });
    expect(snapToNearestFrame(framePlayerModel({ totalDurationMs: 0, frames: [] }), 5)).toEqual({
      frameIndex: -1,
      playheadMs: 0,
    });
  });

  test("every snapped playhead is a REAL frame begin (no invented positions)", () => {
    const begins = model.windows.map((w) => w.beginMs);
    for (let ms = 0; ms <= 4_000; ms += 137) {
      expect(begins).toContain(snapToNearestFrame(model, ms).playheadMs);
    }
  });
});

describe("the transport (play/pause/advance/seek/rate)", () => {
  const model = framePlayerModel(threeFrameManifest());

  test("advance moves the playhead by real elapsed time at rate 1", () => {
    let state = playFramePlayer(initialFramePlayer(model), model);
    expect(state.playing).toBe(true);
    state = advanceFramePlayer(state, model, 700);
    expect(state.playheadMs).toBe(700);
    expect(frameIndexAtMs(model, state.playheadMs)).toBe(0);
    state = advanceFramePlayer(state, model, 800);
    expect(state.playheadMs).toBe(1_500);
    expect(frameIndexAtMs(model, state.playheadMs)).toBe(1);
  });

  test("the display rate scales real elapsed time, never invents a frame", () => {
    let state = setDisplayRate(playFramePlayer(initialFramePlayer(model), model), 2);
    state = advanceFramePlayer(state, model, 700);
    expect(state.playheadMs).toBe(1_400); // 700 ms real × 2 display
    let half = setDisplayRate(playFramePlayer(initialFramePlayer(model), model), 0.5);
    half = advanceFramePlayer(half, model, 1_000);
    expect(half.playheadMs).toBe(500);
  });

  test("only the supported display rates are accepted (fail-closed cadence)", () => {
    const state = playFramePlayer(initialFramePlayer(model), model);
    expect(setDisplayRate(state, 3).rate).toBe(1);
    expect(setDisplayRate(state, 0).rate).toBe(1);
    expect(setDisplayRate(state, Number.NaN).rate).toBe(1);
    expect(setDisplayRate(state, 0.5).rate).toBe(0.5);
    expect(DISPLAY_RATES).toEqual([0.5, 1, 2]);
  });

  test("reaching the REAL end ends playback paused at the real total", () => {
    let state = playFramePlayer(initialFramePlayer(model), model);
    state = advanceFramePlayer(state, model, 10_000);
    expect(state).toEqual({ playheadMs: 4_000, playing: false, rate: 1, ended: true });
    // advancing an ended player is a no-op
    expect(advanceFramePlayer(state, model, 500)).toBe(state);
  });

  test("play after end restarts from the first real frame", () => {
    const ended = advanceFramePlayer(
      playFramePlayer(initialFramePlayer(model), model),
      model,
      10_000,
    );
    const replay = playFramePlayer(ended, model);
    expect(replay.playheadMs).toBe(0);
    expect(replay.playing).toBe(true);
    expect(replay.ended).toBe(false);
  });

  test("pause keeps the playhead; advancing while paused is a no-op", () => {
    const state = advanceFramePlayer(
      playFramePlayer(initialFramePlayer(model), model),
      model,
      1_200,
    );
    const paused = pauseFramePlayer(state);
    expect(paused.playing).toBe(false);
    expect(paused.playheadMs).toBe(1_200);
    expect(advanceFramePlayer(paused, model, 500)).toBe(paused);
    expect(pauseFramePlayer(paused)).toBe(paused); // idempotent
  });

  test("seek snaps to a real frame boundary and clears ended, keeping transport", () => {
    const ended = advanceFramePlayer(
      playFramePlayer(initialFramePlayer(model), model),
      model,
      10_000,
    );
    const sought = seekFramePlayer(ended, model, 2_100);
    expect(sought.playheadMs).toBe(2_500); // nearest real begin
    expect(sought.ended).toBe(false);
    expect(sought.playing).toBe(false); // was paused-at-end
    const playing = seekFramePlayer(
      advanceFramePlayer(playFramePlayer(initialFramePlayer(model), model), model, 200),
      model,
      3_800,
    );
    expect(playing.playing).toBe(true); // still playing across the seek
    expect(playing.playheadMs).toBe(2_500);
    // A model without frames ignores seeks entirely.
    const empty: FramePlayerModel = { windows: [], totalDurationMs: 0 };
    expect(seekFramePlayer(ended, empty, 100)).toBe(ended);
  });
});

describe("deriveFrameRateProfile + formatDisplayMs", () => {
  test("the base cadence is the MEDIAN real window", () => {
    const profile = deriveFrameRateProfile(framePlayerModel(threeFrameManifest()));
    expect(profile.supported).toBe(true);
    expect(profile.baseFrameMs).toBe(1_500); // median of [1000, 1500, 1500]
    expect(profile.rates).toBe(DISPLAY_RATES);
    expect(profile.reason).toContain("3 real frames");
  });

  test("no frame windows — the control honestly does not apply", () => {
    const profile = deriveFrameRateProfile(framePlayerModel({ totalDurationMs: 0, frames: [] }));
    expect(profile.supported).toBe(false);
    expect(profile.baseFrameMs).toBeNull();
    expect(profile.rates).toEqual([]);
    expect(profile.reason).toContain("no frame manifest");
  });

  test("formatDisplayMs formats the document clock for display only", () => {
    expect(formatDisplayMs(0)).toBe("0:00");
    expect(formatDisplayMs(59_999)).toBe("0:59");
    expect(formatDisplayMs(60_000)).toBe("1:00");
    expect(formatDisplayMs(65_000)).toBe("1:05");
    expect(formatDisplayMs(-1)).toBe("0:00");
    expect(formatDisplayMs(Number.NaN)).toBe("0:00");
  });
});

// ---------------------------------------------------------------------------
// Event markers (the real SWM event tail → the artifact's frames)
// ---------------------------------------------------------------------------

function markerModel(): FramePlayerModel {
  return framePlayerModel(threeFrameManifest());
}

function markerSourceManifest() {
  return {
    frames: [
      { frameIndex: 0, appliedEventSequences: [1] },
      { frameIndex: 1, appliedEventSequences: [2, 3] },
      { frameIndex: 2, appliedEventSequences: [] },
    ],
    skippedEvents: [{ sequence: 4, reason: "after the output window" }],
  };
}

const TAIL = [
  {
    sequence: 1,
    eventId: "evt-1",
    eventTimeMs: 500,
    eventTypeRef: "football/v1/kickoff",
    confidence: 0.9,
  },
  { sequence: 2, eventId: "evt-2", eventTimeMs: 1_400, eventTypeRef: "football/v1/shot" },
  {
    sequence: 3,
    eventId: "evt-3",
    eventTimeMs: 2_200,
    eventTypeRef: "football/v1/goal",
    confidence: 0.72,
  },
  { sequence: 4, eventId: "evt-4", eventTimeMs: 9_000, eventTypeRef: "football/v1/full-time" },
  { sequence: 5, eventId: "evt-5", eventTimeMs: 300, eventTypeRef: "football/v1/unused" },
];

describe("placeEventMarkers (real events on the frames the render applied them to)", () => {
  test("an applied event marks the frame its sequence was applied to, at that frame's begin", () => {
    const markers = placeEventMarkers(markerModel(), TAIL, markerSourceManifest());
    const bySequence = new Map(markers.map((m) => [m.sequence, m]));
    expect(bySequence.get(1)).toMatchObject({
      frameIndex: 0,
      markerMs: 0,
      reason: null,
      confidence: 0.9,
    });
    expect(bySequence.get(2)).toMatchObject({ frameIndex: 1, markerMs: 1_000, reason: null });
    expect(bySequence.get(3)).toMatchObject({ frameIndex: 1, markerMs: 1_000, reason: null });
  });

  test("events outside the render's output window are listed with the render's own reason", () => {
    const markers = placeEventMarkers(markerModel(), TAIL, markerSourceManifest());
    const skipped = markers.find((m) => m.sequence === 4)!;
    expect(skipped.frameIndex).toBeNull();
    expect(skipped.markerMs).toBeNull();
    expect(skipped.reason).toBe("outside this render's output window (after the output window)");
  });

  test("events no frame applied are listed, never dropped silently", () => {
    const markers = placeEventMarkers(markerModel(), TAIL, markerSourceManifest());
    const unused = markers.find((m) => m.sequence === 5)!;
    expect(unused.frameIndex).toBeNull();
    expect(unused.reason).toBe("not applied to any frame of this render");
  });

  test("a manifest frame the artifact lacks is reported, not guessed", () => {
    const markers = placeEventMarkers(markerModel(), TAIL, {
      frames: [{ frameIndex: 7, appliedEventSequences: [1] }],
      skippedEvents: [],
    });
    const stray = markers.find((m) => m.sequence === 1)!;
    expect(stray.frameIndex).toBeNull();
    expect(stray.reason).toBe(
      "the render manifest references a frame this artifact does not contain",
    );
  });

  test("every placed marker position is a real frame boundary of the artifact", () => {
    const markers = placeEventMarkers(markerModel(), TAIL, markerSourceManifest());
    const begins = markerModel().windows.map((w) => w.beginMs);
    for (const marker of markers) {
      if (marker.markerMs !== null) expect(begins).toContain(marker.markerMs);
      else expect(marker.reason).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Frame-SVG preparation (displaying one real frame, fail-closed)
// ---------------------------------------------------------------------------

/** A minimal encoder-shaped animated SVG (two frame groups + their SMIL sets). */
function artifactSvg(): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 405">`,
    `<g data-frame-index="0" display="none"><rect width="720" height="405" fill="#101820"/></g>`,
    `<g data-frame-index="1" display="none"><rect width="720" height="405" fill="#1b2a38"/></g>`,
    `</svg>`,
  ].join("");
}

describe("prepareFrameForDisplay (one real frame, fail-closed)", () => {
  test("selects exactly the requested frame and strips the SMIL timing", () => {
    const prepared = prepareFrameForDisplay(artifactSvg(), 1);
    expect(prepared).not.toMatch(/<set\b/);
    expect(prepared).toMatch(
      /<g data-frame-index="1" display="inline"><rect width="720" height="405" fill="#1b2a38"\/><\/g>/,
    );
    expect(prepared).toMatch(/<g data-frame-index="0" display="none">/); // untouched
    expect(frameIndicesOf(artifactSvg())).toEqual([0, 1]);
  });

  test("the transform is pure — the same bytes always yield the same display", () => {
    expect(prepareFrameForDisplay(artifactSvg(), 0)).toBe(prepareFrameForDisplay(artifactSvg(), 0));
  });

  test("a frame the artifact does not carry refuses", () => {
    expect(() => prepareFrameForDisplay(artifactSvg(), 2)).toThrow(FrameSvgError);
    expect(() => prepareFrameForDisplay(artifactSvg(), -1)).toThrow(FrameSvgError);
    expect(() => prepareFrameForDisplay(artifactSvg(), 1.5)).toThrow(FrameSvgError);
  });

  test("scripts, event handlers and external references refuse, always", () => {
    const script = artifactSvg().replace("</svg>", `<script>alert(1)</script></svg>`);
    expect(() => prepareFrameForDisplay(script, 0)).toThrow(/script element/);
    const handler = artifactSvg().replace(
      `<rect width="720" height="405" fill="#101820"/>`,
      `<rect width="720" height="405" fill="#101820" onclick="go()"/>`,
    );
    expect(() => prepareFrameForDisplay(handler, 0)).toThrow(/event handler/);
    const external = artifactSvg().replace(
      `<rect width="720" height="405" fill="#1b2a38"/>`,
      `<image href="https://evil.test/x.png"/>`,
    );
    expect(() => prepareFrameForDisplay(external, 1)).toThrow(/external resource/);
  });

  test("same-document fragment references stay allowed", () => {
    const withFragment = artifactSvg().replace(
      `<rect width="720" height="405" fill="#101820"/>`,
      `<use href="#pitch"/>`,
    );
    expect(() => prepareFrameForDisplay(withFragment, 0)).not.toThrow();
  });
});
