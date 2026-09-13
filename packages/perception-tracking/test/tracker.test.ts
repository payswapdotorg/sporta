import { describe, expect, test } from "bun:test";
import type { DetectedBox, NormalizedBox } from "@sporta/perception-detection";
import { GreedyIouTracker } from "../src/tracker";
import type { TrackerFrameInput } from "../src/tracker";

/**
 * W204 tracker unit tests: association semantics, gap tolerance, scene-cut
 * policy, determinism, and construction validation. Every expected id and
 * box below is hand-derived from the documented algorithm (see
 * `src/tracker.ts`); no RNG, no clock — constants only.
 */

function frame(d: number, sceneCut?: boolean): TrackerFrameInput {
  return {
    frameId: `f-0-${d}`,
    presentationMs: d * 40,
    decodeOrder: d,
    ...(sceneCut === true ? { sceneCut: true } : {}),
  };
}

function det(box: NormalizedBox, label = "player", confidence = 0.9): DetectedBox {
  return { box, label, confidence };
}

// Binary-exact boxes for hand-computed IoUs (0.25/0.5/0.75 are dyadic).
const BOX_A: NormalizedBox = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
const BOX_A_SHIFT_0_01: NormalizedBox = { x: 0.41, y: 0.4, w: 0.2, h: 0.2 };
const BOX_A_SHIFT_0_04: NormalizedBox = { x: 0.44, y: 0.4, w: 0.2, h: 0.2 };
const BOX_FAR: NormalizedBox = { x: 0.8, y: 0.8, w: 0.1, h: 0.1 };

describe("GreedyIouTracker — construction validation", () => {
  test("rejects out-of-range iouThreshold, negative/fractional maxGap, bad policy, bad trackerId", () => {
    expect(() => new GreedyIouTracker({ iouThreshold: 1.5 }, "trk")).toThrow(RangeError);
    expect(() => new GreedyIouTracker({ iouThreshold: -0.1 }, "trk")).toThrow(RangeError);
    expect(() => new GreedyIouTracker({ maxGap: -1 }, "trk")).toThrow(RangeError);
    expect(() => new GreedyIouTracker({ maxGap: 1.5 }, "trk")).toThrow(RangeError);
    expect(() => new GreedyIouTracker({ onSceneCut: "freeze" as never }, "trk")).toThrow(
      RangeError,
    );
    expect(() => new GreedyIouTracker({}, "")).toThrow(RangeError);
    expect(() => new GreedyIouTracker({}, "bad id!")).toThrow(RangeError);
    // Valid boundary options construct fine.
    expect(new GreedyIouTracker({ iouThreshold: 0, maxGap: 0 }, "trk-a")).toBeDefined();
    expect(new GreedyIouTracker({ iouThreshold: 1, maxGap: 100 }, "trk-a")).toBeDefined();
  });

  test("trackerId is exposed and does NOT prefix track ids", () => {
    const tracker = new GreedyIouTracker({}, "trk-1");
    expect(tracker.trackerId).toBe("trk-1");
    const [first] = tracker.assign(frame(0), [det(BOX_A)]);
    expect(first?.trackId).toBe("t1"); // exactly t<seq>, no prefix
  });
});

describe("GreedyIouTracker — association", () => {
  test("a matched detection extends the SAME track id and updates its box", () => {
    const tracker = new GreedyIouTracker({}, "trk");
    const out0 = tracker.assign(frame(0), [det(BOX_A)]);
    const out1 = tracker.assign(frame(1), [det(BOX_A_SHIFT_0_01)]);
    expect(out0.map((t) => t.trackId)).toEqual(["t1"]);
    expect(out1.map((t) => t.trackId)).toEqual(["t1"]); // same id
    expect(out1[0]?.box).toEqual(BOX_A_SHIFT_0_01); // box updated to the new detection
    // IoU(BOX_A, BOX_A_SHIFT_0_01) = 0.19/0.21 ≈ 0.905 >= 0.5 -> matched.
  });

  test("an unmatched detection opens a NEW deterministic id (t1, t2, …)", () => {
    const tracker = new GreedyIouTracker({}, "trk");
    const out0 = tracker.assign(frame(0), [det(BOX_A)]);
    // BOX_FAR is disjoint from BOX_A: IoU 0 < 0.5 -> no association.
    const out1 = tracker.assign(frame(1), [det(BOX_FAR)]);
    expect(out0.map((t) => t.trackId)).toEqual(["t1"]);
    expect(out1.map((t) => t.trackId)).toEqual(["t2"]);
  });

  test("two detections never join one track (greedy one-to-one)", () => {
    const tracker = new GreedyIouTracker({}, "trk");
    tracker.assign(frame(0), [det(BOX_A)]);
    // Both detections pass the gate against t1's lastBox:
    //   IoU(BOX_A, SHIFT_0_01) = 0.19/0.21 ≈ 0.905 (higher — consumed first)
    //   IoU(BOX_A, SHIFT_0_04) = 0.16/0.24 ≈ 0.667 (still >= 0.5)
    // Best-first gives SHIFT_0_01 to t1; SHIFT_0_04 must open t2.
    const out1 = tracker.assign(frame(1), [det(BOX_A_SHIFT_0_01), det(BOX_A_SHIFT_0_04)]);
    expect(out1.map((t) => t.trackId)).toEqual(["t1", "t2"]);
    expect(out1[0]?.box).toEqual(BOX_A_SHIFT_0_01);
    expect(out1[1]?.box).toEqual(BOX_A_SHIFT_0_04);
  });

  test("label-gated: a ball detection never extends a player track", () => {
    const tracker = new GreedyIouTracker({}, "trk");
    tracker.assign(frame(0), [det(BOX_A, "player")]);
    // Identical box, different label: candidates require label equality,
    // so this detection cannot extend the player track — it opens t2.
    const out1 = tracker.assign(frame(1), [det(BOX_A, "ball")]);
    expect(out1).toHaveLength(1);
    expect(out1[0]?.trackId).toBe("t2");
    expect(out1[0]?.label).toBe("ball");
    // And the player track is still open: a later player detection at the
    // same box re-extends t1 (gap 1 <= maxGap 0? No — default maxGap 0
    // CLOSED it after one missed frame; use maxGap 1 to keep it alive).
    const lenient = new GreedyIouTracker({ maxGap: 1 }, "trk");
    lenient.assign(frame(0), [det(BOX_A, "player")]);
    lenient.assign(frame(1), [det(BOX_A, "ball")]);
    const out2 = lenient.assign(frame(2), [det(BOX_A, "player")]);
    expect(out2[0]?.trackId).toBe("t1"); // the player track survived, ball rode t2
  });

  test("threshold boundary: IoU exactly equal to the threshold associates", () => {
    // Hand-computed exact IoU: boxes {0,0.25,0.75,0.5} and {0.25,0.25,0.75,0.5}
    // x-extents [0,0.75] and [0.25,1.0]: inter width 0.5; y-extents equal:
    // inter 0.5 x 0.5 = 0.25; areas 0.375 each; union 0.5; IoU = 0.25/0.5
    // = 0.5 EXACTLY (all values dyadic -> binary-exact).
    const first: NormalizedBox = { x: 0, y: 0.25, w: 0.75, h: 0.5 };
    const second: NormalizedBox = { x: 0.25, y: 0.25, w: 0.75, h: 0.5 };

    const atThreshold = new GreedyIouTracker({ iouThreshold: 0.5 }, "trk");
    atThreshold.assign(frame(0), [det(first)]);
    expect(atThreshold.assign(frame(1), [det(second)]).map((t) => t.trackId)).toEqual(["t1"]);

    const aboveThreshold = new GreedyIouTracker({ iouThreshold: 0.5000001 }, "trk");
    aboveThreshold.assign(frame(0), [det(first)]);
    // IoU 0.5 < 0.5000001: no association -> fresh id.
    expect(aboveThreshold.assign(frame(1), [det(second)]).map((t) => t.trackId)).toEqual(["t2"]);
  });

  test("confidence is passed through verbatim (no collapse)", () => {
    const tracker = new GreedyIouTracker({}, "trk");
    tracker.assign(frame(0), [det(BOX_A, "player", 0.42)]);
    const out = tracker.assign(frame(1), [det(BOX_A_SHIFT_0_01, "player", 0.123)]);
    expect(out[0]?.confidence).toBe(0.123); // the NEW detection's value, verbatim
    // And the first frame's output carried the first detection's value.
    const fresh = new GreedyIouTracker({}, "trk");
    expect(fresh.assign(frame(0), [det(BOX_A, "player", 0.42)])[0]?.confidence).toBe(0.42);
  });

  test("output is in input detection order and boxes are copies", () => {
    const tracker = new GreedyIouTracker({}, "trk");
    const d0 = det(BOX_A);
    const out = tracker.assign(frame(0), [d0]);
    expect(out[0]?.box).toEqual(d0.box);
    expect(out[0]?.box).not.toBe(d0.box); // shallow-copied, not aliased
    // Order preserved for mixed labels.
    const out1 = tracker.assign(frame(1), [det(BOX_A_SHIFT_0_01, "ball"), det(BOX_A_SHIFT_0_01)]);
    expect(out1.map((t) => t.label)).toEqual(["ball", "player"]);
    expect(out1.map((t) => t.trackId)).toEqual(["t2", "t1"]);
  });

  test("empty detections -> empty output (tracks still age)", () => {
    const tracker = new GreedyIouTracker({ maxGap: 1 }, "trk");
    tracker.assign(frame(0), [det(BOX_A)]);
    expect(tracker.assign(frame(1), [])).toEqual([]);
    // Track aged (gap 1 <= 1): still matchable at frame 2.
    expect(tracker.assign(frame(2), [det(BOX_A_SHIFT_0_01)])[0]?.trackId).toBe("t1");
  });
});

describe("GreedyIouTracker — gap tolerance", () => {
  // Frames 0,1,2 have the detection; frames 3,4 (and 5 in the second case)
  // miss it; it reappears afterwards. Motion is a 0.01-per-frame drift.
  function gapScenario(maxGap: number, missingFrames: number): string[] {
    const tracker = new GreedyIouTracker({ maxGap }, "trk");
    const ids: string[] = [];
    for (let d = 0; d <= 3 + missingFrames + 3; d += 1) {
      const isMissing = d >= 3 && d < 3 + missingFrames;
      const drift = 0.01 * d;
      const detections = isMissing ? [] : [det({ x: 0.4 + drift, y: 0.4, w: 0.2, h: 0.2 })];
      const out = tracker.assign(frame(d), detections);
      ids.push(out[0]?.trackId ?? "-");
    }
    return ids;
  }

  test("maxGap = 2: missing 2 frames then reappearing -> SAME id (gap survived)", () => {
    const ids = gapScenario(2, 2);
    // Frames 0..2 -> t1; frames 3,4 -> no output (gap 1 then 2 <= 2);
    // frame 5 -> t1 again (gap survived), frames 5..7 -> t1.
    expect(ids.slice(0, 3)).toEqual(["t1", "t1", "t1"]);
    expect(ids.slice(3, 5)).toEqual(["-", "-"]);
    expect(ids.slice(5)).toEqual(["t1", "t1", "t1", "t1"]);
  });

  test("maxGap = 2: missing 3 frames -> NEW id (fragmentation)", () => {
    const ids = gapScenario(2, 3);
    // Frame 3: gap 1; frame 4: gap 2 (still alive); frame 5: gap 3 > 2 ->
    // CLOSED (terminal). Frame 6: reappearing detection opens t2.
    expect(ids.slice(0, 3)).toEqual(["t1", "t1", "t1"]);
    expect(ids.slice(3, 6)).toEqual(["-", "-", "-"]);
    expect(ids.slice(6)).toEqual(["t2", "t2", "t2", "t2"]);
  });

  test("a closed track never re-opens (its id is never reissued)", () => {
    const tracker = new GreedyIouTracker({ maxGap: 0 }, "trk");
    tracker.assign(frame(0), [det(BOX_A)]);
    tracker.assign(frame(1), []); // gap 1 > 0 -> t1 closed (terminal)
    const out2 = tracker.assign(frame(2), [det(BOX_A)]);
    expect(out2[0]?.trackId).toBe("t2"); // fresh id, not t1
    const out3 = tracker.assign(frame(3), [det(BOX_A_SHIFT_0_01)]);
    expect(out3[0]?.trackId).toBe("t2"); // t2 continues; t1 never returns
    // Ids minted so far: t1, t2 — the counter never rewinds, even across
    // many further tracks (no reuse of closed ids anywhere).
    const out4 = tracker.assign(frame(4), [det(BOX_FAR)]);
    expect(out4[0]?.trackId).toBe("t3");
  });
});

describe("GreedyIouTracker — scene cut", () => {
  test("default close-all closes EVERY active track at a cut frame; ids after are fresh", () => {
    const tracker = new GreedyIouTracker({}, "trk"); // default onSceneCut
    const out0 = tracker.assign(frame(0), [det(BOX_A), det(BOX_FAR, "ball")]);
    expect(out0.map((t) => t.trackId)).toEqual(["t1", "t2"]);
    // Cut frame: same boxes would normally re-match (IoU 1); with the
    // default policy every track closed first -> BOTH ids are fresh.
    const out1 = tracker.assign(frame(1, true), [det(BOX_A), det(BOX_FAR, "ball")]);
    expect(out1.map((t) => t.trackId)).toEqual(["t3", "t4"]);
    // And association continues normally after the cut.
    const out2 = tracker.assign(frame(2), [det(BOX_A_SHIFT_0_01), det(BOX_FAR, "ball")]);
    expect(out2.map((t) => t.trackId)).toEqual(["t3", "t4"]);
  });

  test('onSceneCut "ignore" still associates across the marker', () => {
    const tracker = new GreedyIouTracker({ onSceneCut: "ignore" }, "trk");
    tracker.assign(frame(0), [det(BOX_A)]);
    const out1 = tracker.assign(frame(1, true), [det(BOX_A_SHIFT_0_01)]);
    expect(out1.map((t) => t.trackId)).toEqual(["t1"]); // associated across the cut
    const out2 = tracker.assign(frame(2), [det(BOX_A_SHIFT_0_04)]);
    expect(out2.map((t) => t.trackId)).toEqual(["t1"]);
  });

  test("a cut with no active tracks is a no-op; a cut frame's detections open fresh ids", () => {
    const tracker = new GreedyIouTracker({}, "trk");
    const out0 = tracker.assign(frame(0, true), [det(BOX_A)]);
    expect(out0.map((t) => t.trackId)).toEqual(["t1"]); // nothing to close; new track
  });
});

describe("GreedyIouTracker — determinism", () => {
  const FRAME_COUNT = 12;
  function buildDetections(d: number): DetectedBox[] {
    const drift = 0.01 * d;
    return [
      det({ x: 0.4 + drift, y: 0.4, w: 0.2, h: 0.2 }),
      det({ x: 0.1 + 0.5 * drift, y: 0.7, w: 0.15, h: 0.15 }, "ball", 0.75),
    ];
  }

  test("two trackers fed identical input produce identical ids and boxes", () => {
    const a = new GreedyIouTracker({ maxGap: 2 }, "trk-a");
    const b = new GreedyIouTracker({ maxGap: 2 }, "trk-b");
    for (let d = 0; d < FRAME_COUNT; d += 1) {
      const detections = buildDetections(d);
      expect(a.assign(frame(d, d === 6), detections)).toEqual(
        b.assign(frame(d, d === 6), detections),
      );
    }
  });

  test("ids are stable across two runs on the same tracker input", () => {
    function run(): string[] {
      const tracker = new GreedyIouTracker({ maxGap: 1 }, "trk");
      const ids: string[] = [];
      for (let d = 0; d < FRAME_COUNT; d += 1) {
        // Missed at d = 4, 5 (two consecutive frames -> gap 2 > maxGap 1 ->
        // t1/t2 close; frames 6+ mint t3/t4) and at d = 9 (single frame ->
        // gap 1 <= 1 -> t3/t4 survive).
        const detections = d === 4 || d === 5 || d === 9 ? [] : buildDetections(d);
        for (const tracked of tracker.assign(frame(d), detections)) {
          ids.push(tracked.trackId);
        }
      }
      return ids;
    }
    expect(run()).toEqual(run());
    // The id sequence is exactly the documented scheme: opening order.
    const first = run();
    expect(new Set(first)).toEqual(new Set(["t1", "t2", "t3", "t4"]));
  });
});
