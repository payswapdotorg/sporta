import { describe, expect, test } from "bun:test";
import { GreedyIouTracker } from "../src/tracker";
import type { TrackedBox } from "../src/tracker";
import { detectionsFromGroundTruth, generateFixtureFrames } from "../src/fixture";
import type { FixtureDegrade, FixtureTrackSpec } from "../src/fixture";
import { runTrackingBenchmark } from "../src/benchmark";

/**
 * W204 accept-criteria proof (the identity-continuity benchmark): occlusion
 * (both gap-tolerance regimes), camera cut, identity mixing (purity), and
 * determinism. Every expected number below is HAND-DERIVED from the
 * documented algorithms; the arithmetic is written out at each assertion.
 * No `Date.now`, no `Math.random` — constants only.
 */

/** Runs the tracker over the fixture frames and returns the predicted map. */
function trackFixture(
  specs: readonly FixtureTrackSpec[],
  framesOptions: { frames: number; sceneCutFrames?: ReadonlySet<number> },
  trackerOptions: { maxGap?: number; iouThreshold?: number; onSceneCut?: "close-all" | "ignore" },
  degrade?: FixtureDegrade,
): Map<string, readonly TrackedBox[]> {
  const fixture = generateFixtureFrames(specs, framesOptions);
  const tracker = new GreedyIouTracker(trackerOptions, "tracker-benchmark");
  const predicted = new Map<string, readonly TrackedBox[]>();
  for (const gtFrame of fixture) {
    predicted.set(
      gtFrame.frame.frameId,
      tracker.assign(gtFrame.frame, detectionsFromGroundTruth(gtFrame, { degrade })),
    );
  }
  return predicted;
}

function reportFor(
  specs: readonly FixtureTrackSpec[],
  framesOptions: { frames: number; sceneCutFrames?: ReadonlySet<number> },
  trackerOptions: { maxGap?: number; iouThreshold?: number; onSceneCut?: "close-all" | "ignore" },
  degrade?: FixtureDegrade,
) {
  const groundTruth = generateFixtureFrames(specs, framesOptions);
  const predicted = trackFixture(specs, framesOptions, trackerOptions, degrade);
  return runTrackingBenchmark({ groundTruth, predicted });
}

// ---------------------------------------------------------------------------
// OCCLUSION — the W204 acceptance scenario. Two players; P2 occluded frames
// 40–52 (13 frames). Motion is slow so re-association geometry is never the
// bottleneck: P1 0.30 -> 0.40 (step 0.1/79 ~ 0.00127), P2 0.60 -> 0.62
// (step 0.02/79 ~ 0.00025); boxes are 0.2 wide and the extents stay disjoint
// (P1 right edge 0.4 + 0.1d/79 <= P2 left edge 0.5 + 0.02d/79 for all d).
// P2's reappearance IoU (frame 39 box vs frame 53 box) ~ 0.965 >= 0.5.
// ---------------------------------------------------------------------------

const OCCLUSION_FRAMES = 80;
const OCCLUDED = new Set<number>([40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52]);

const OCCLUSION_SPECS: FixtureTrackSpec[] = [
  {
    gtId: "occ-p1",
    label: "player",
    motion: { kind: "linear", from: { x: 0.3, y: 0.5 }, to: { x: 0.4, y: 0.5 } },
    size: { w: 0.2, h: 0.2 },
  },
  {
    gtId: "occ-p2",
    label: "player",
    motion: { kind: "linear", from: { x: 0.6, y: 0.5 }, to: { x: 0.62, y: 0.5 } },
    size: { w: 0.2, h: 0.2 },
    occludedFrames: OCCLUDED,
  },
];

describe("benchmark — occlusion (acceptance-criteria proof)", () => {
  test("maxGap 20: 0 identity switches, continuityScore 1, fragments 1 each", () => {
    const report = reportFor(OCCLUSION_SPECS, { frames: OCCLUSION_FRAMES }, { maxGap: 20 });

    // Occlusion is 13 frames; gap peaks at 13 <= 20, so P2's track t2
    // SURVIVES and re-associates at frame 53 (IoU ~ 0.965 >= 0.5): every
    // object keeps one id for the whole scene.
    expect(report.iouThreshold).toBe(0.5); // default
    expect(report.matchedDetections).toBe(147); // 80 (p1) + 80 - 13 (p2)
    expect(report.missedDetections).toBe(0);
    expect(report.identitySwitches).toBe(0);
    expect(report.continuityScore).toBe(1);
    expect(report.fragments).toEqual({ "occ-p1": 1, "occ-p2": 1 });
    expect(report.trackPurity).toEqual({ t1: 1, t2: 1 });
    expect(report.meanTrackPurity).toBe(1);
  });

  test("maxGap 5: exact hand-computed switches (1), fragments (2), continuity (144/145)", () => {
    const report = reportFor(OCCLUSION_SPECS, { frames: OCCLUSION_FRAMES }, { maxGap: 5 });

    // ARITHMETIC (hand-derived):
    // - P2's track t2 gaps 1..5 over frames 40-44 (alive), hits gap 6 > 5 at
    //   frame 45 -> CLOSED (terminal). P2 reappears at frame 53 -> fresh id
    //   t3 (seq: t1 = p1, t2 = p2, t3 next).
    // - matched: p1 on all 80 frames; p2 on frames 0-39 (40) and 53-79 (27)
    //   -> 80 + 67 = 147 matched, 0 missed (p2 is ABSENT from GT while
    //   occluded, so occluded frames are not misses).
    // - identity switches: p1's walk [t1 x 80] -> 79 pairs, 0 switches.
    //   p2's walk [t2 x 40, t3 x 27] -> 66 pairs; the single bridge pair
    //   (frame 39 -> frame 53) switches t2 -> t3: 1 switch. Total 1.
    // - continuityScore: total pairs 79 + 66 = 145; identity-preserving
    //   79 + 65 = 144 -> 144/145.
    // - fragments: p1 {t1} = 1; p2 {t2, t3} = 2.
    // - purity: t1 = 80 p1-detections -> 1; t2 = 40 p2 -> 1; t3 = 27 p2 ->
    //   1; meanTrackPurity = 1 (the fragmentation costs ids, not purity —
    //   no id ever carried both objects).
    expect(report.matchedDetections).toBe(147);
    expect(report.missedDetections).toBe(0);
    expect(report.identitySwitches).toBe(1);
    expect(report.continuityScore).toBe(144 / 145);
    expect(report.fragments).toEqual({ "occ-p1": 1, "occ-p2": 2 });
    expect(report.trackPurity).toEqual({ t1: 1, t2: 1, t3: 1 });
    expect(report.meanTrackPurity).toBe(1);
  });

  test("tracker ids in the occlusion scenario are exactly the walk above", () => {
    // Direct evidence from the predicted map: t2 is P2's id on frames 0-39
    // AND 53-79 with maxGap 20; only t3 (never t2 again) after the close
    // with maxGap 5.
    const tolerant = trackFixture(OCCLUSION_SPECS, { frames: OCCLUSION_FRAMES }, { maxGap: 20 });
    expect(tolerant.get("f-0-39")?.map((t) => t.trackId)).toEqual(["t1", "t2"]);
    expect(tolerant.get("f-0-52")?.map((t) => t.trackId)).toEqual(["t1"]); // occluded frame
    expect(tolerant.get("f-0-53")?.map((t) => t.trackId)).toEqual(["t1", "t2"]); // SAME id back

    const strict = trackFixture(OCCLUSION_SPECS, { frames: OCCLUSION_FRAMES }, { maxGap: 5 });
    expect(strict.get("f-0-45")?.map((t) => t.trackId)).toEqual(["t1"]); // t2 still open (gap 5)
    expect(strict.get("f-0-46")?.map((t) => t.trackId)).toEqual(["t1"]); // t2 closed (gap 6 > 5)
    expect(strict.get("f-0-53")?.map((t) => t.trackId)).toEqual(["t1", "t3"]); // fresh id
    // Closed ids never come back for the rest of the scene.
    for (const tracks of strict.values()) {
      for (const tracked of tracks) {
        if (tracked.label === "player") {
          expect(["t1", "t2", "t3"]).toContain(tracked.trackId);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// CAMERA CUT — 120 frames, scene cut at frame 70, GT objects persist across
// the cut (motions run continuously 0..119; the tracker default closes all
// tracks at the cut). A and B move in parallel on disjoint y bands (0.3/0.7,
// boxes 0.15) so they can never be confused with each other.
// ---------------------------------------------------------------------------

const CUT_FRAMES = 120;
const CUT_AT = 70;

const CUT_SPECS: FixtureTrackSpec[] = [
  {
    gtId: "cut-a",
    label: "player",
    motion: { kind: "linear", from: { x: 0.2, y: 0.3 }, to: { x: 0.8, y: 0.3 } },
    size: { w: 0.15, h: 0.15 },
  },
  {
    gtId: "cut-b",
    label: "player",
    motion: { kind: "linear", from: { x: 0.2, y: 0.7 }, to: { x: 0.8, y: 0.7 } },
    size: { w: 0.15, h: 0.15 },
  },
];

describe("benchmark — camera cut", () => {
  test("tracker default: exactly ONE switch per object at the cut; fragments 2; purity 1", () => {
    const report = reportFor(
      CUT_SPECS,
      { frames: CUT_FRAMES, sceneCutFrames: new Set([CUT_AT]) },
      { maxGap: 0 }, // default close-all
    );

    // ARITHMETIC: at frame 70 every active track closes (hard boundary);
    // detections on frame 70 open fresh ids: t3 (cut-a, slot order) and t4
    // (cut-b). Walks: cut-a [t1 x 70, t3 x 50] -> 119 pairs, 1 switch (the
    // 69->70 pair); cut-b [t2 x 70, t4 x 50] -> 1 switch. Total 2 switches.
    // matched = 2 objects x 120 frames = 240; pairs = 238; preserving 236
    // -> continuityScore 236/238 = 118/119. Fragments: 2 per object.
    // Purity: every track carried exactly ONE object -> all 1, mean 1.
    expect(report.matchedDetections).toBe(240);
    expect(report.missedDetections).toBe(0);
    expect(report.identitySwitches).toBe(2); // one per object, at the cut boundary
    expect(report.continuityScore).toBe(236 / 238);
    expect(report.fragments).toEqual({ "cut-a": 2, "cut-b": 2 });
    expect(report.trackPurity).toEqual({ t1: 1, t2: 1, t3: 1, t4: 1 });
    expect(report.meanTrackPurity).toBe(1);

    // Direct id evidence: the switch is exactly AT the cut boundary.
    const predicted = trackFixture(
      CUT_SPECS,
      { frames: CUT_FRAMES, sceneCutFrames: new Set([CUT_AT]) },
      { maxGap: 0 },
    );
    expect(predicted.get("f-0-69")?.map((t) => t.trackId)).toEqual(["t1", "t2"]);
    expect(predicted.get("f-0-70")?.map((t) => t.trackId)).toEqual(["t3", "t4"]); // fresh
    expect(predicted.get("f-0-119")?.map((t) => t.trackId)).toEqual(["t3", "t4"]);
  });

  test('onSceneCut "ignore" keeps ids across the marker (0 switches, no fragmentation)', () => {
    const report = reportFor(
      CUT_SPECS,
      { frames: CUT_FRAMES, sceneCutFrames: new Set([CUT_AT]) },
      { onSceneCut: "ignore" },
    );
    // With "ignore" the cut marker is informational: consecutive IoU
    // (step 0.6/119, ~0.935) still associates across frame 70.
    expect(report.identitySwitches).toBe(0);
    expect(report.continuityScore).toBe(1);
    expect(report.fragments).toEqual({ "cut-a": 1, "cut-b": 1 });
    expect(report.meanTrackPurity).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// PURITY / IDENTITY MIXING — the swapAt scenario. Two players CROSS at
// frame 60 (A: 0.2 -> 0.8, B: 0.8 -> 0.2, same y, boxes 0.15): at the
// crossing each track's BEST candidate is the OTHER object's box (B's frame
// 60 box sits exactly where A's frame 59 box was, and vice versa — the
// reflection of the symmetric motions — cross-IoU ~ 1.0 vs straight ~ 0.935,
// a decisive margin, no float sensitivity), so the greedy association flips
// both track ids onto the other trajectory, and they STAY flipped (the
// trajectories separate again afterwards). The swapAt degrade marks the
// detector-level box exchange that accompanies such crossings.
// ---------------------------------------------------------------------------

const PURITY_FRAMES = 120;
const SWAP_AT = 60;

const PURITY_SPECS: FixtureTrackSpec[] = [
  {
    gtId: "purity-a",
    label: "player",
    motion: { kind: "linear", from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 } },
    size: { w: 0.15, h: 0.15 },
  },
  {
    gtId: "purity-b",
    label: "player",
    motion: { kind: "linear", from: { x: 0.8, y: 0.5 }, to: { x: 0.2, y: 0.5 } },
    size: { w: 0.15, h: 0.15 },
  },
];

const PURITY_DEGRADE: FixtureDegrade = {
  swapAt: { frame: SWAP_AT, gtA: "purity-a", gtB: "purity-b" },
};

describe("benchmark — purity (identity mixing at a crossing)", () => {
  test("swapAt scenario: track ids flip; exact hand-computed purity and switches", () => {
    const report = reportFor(
      PURITY_SPECS,
      { frames: PURITY_FRAMES },
      { maxGap: 0 },
      PURITY_DEGRADE,
    );

    // ARITHMETIC: the flip lands at frame 60 (the crossing). Walks:
    //   purity-a: [t1 x 60 (frames 0-59), t2 x 60 (frames 60-119)]
    //     -> 119 pairs, 1 switch (the 59 -> 60 pair);
    //   purity-b: [t2 x 60, t1 x 60] -> 1 switch.
    // - identitySwitches = 2.
    // - continuityScore = (238 - 2) / 238 = 236/238 = 118/119.
    // - fragments: each object carried by {t1, t2} -> 2 each.
    // - trackPurity: t1 matched A on 60 frames and B on 60 frames ->
    //   majority share 60/120 = 0.5; t2 symmetric -> 0.5.
    // - meanTrackPurity = (0.5 + 0.5) / 2 = 0.5 < 1 (identity mixing).
    // - matched = 2 x 120 = 240; missed = 0.
    expect(report.matchedDetections).toBe(240);
    expect(report.missedDetections).toBe(0);
    expect(report.identitySwitches).toBe(2);
    expect(report.continuityScore).toBe(236 / 238);
    expect(report.fragments).toEqual({ "purity-a": 2, "purity-b": 2 });
    expect(report.trackPurity).toEqual({ t1: 0.5, t2: 0.5 });
    expect(report.meanTrackPurity).toBe(0.5);

    // Direct evidence of the flip in the predicted map: before frame 60,
    // t1 rides A's (rightward) trajectory; from frame 60 on, t1 rides B's
    // (leftward) trajectory — the ids exchanged physical objects.
    const predicted = trackFixture(
      PURITY_SPECS,
      { frames: PURITY_FRAMES },
      { maxGap: 0 },
      PURITY_DEGRADE,
    );
    // Frame 59: A@0.4975 (slot 0 -> t1), B@0.5025 (slot 1 -> t2).
    // Frame 60: the boxes cross — t1 takes the box at 0.4975 (B's), t2 the
    // box at 0.5025 (A's); the ids persist but the trajectories exchange.
    expect(predicted.get("f-0-59")?.map((t) => t.trackId)).toEqual(["t1", "t2"]);
    expect(predicted.get("f-0-60")?.map((t) => t.trackId)).toEqual(["t1", "t2"]);
    // The centers prove the flip: at frame 70, t1's center is LEFT of t2's
    // (t1 rides B's leftward line), while at frame 50 t1's center is LEFT
    // too but on A's line — decisive check: at frame 100, t1 < 0.4 and
    // t2 > 0.6 (A's GT is > 0.6 there, B's < 0.4).
    const at100 = predicted.get("f-0-100")!;
    const t1At100 = at100[0]!;
    const t2At100 = at100[1]!;
    expect(t1At100.box.x + t1At100.box.w / 2).toBeLessThan(0.4); // t1 on B's line
    expect(t2At100.box.x + t2At100.box.w / 2).toBeGreaterThan(0.6); // t2 on A's line
  });

  test("control: WITHOUT the degrade the report is identical (documented set-preservation)", () => {
    // The swapAt exchange preserves the per-frame BOX SET (it swaps which
    // slot carries which trajectory), and both association and the benchmark
    // correspondence are purely geometric — so the degrade alone cannot
    // change tracking. The flip above comes from the CROSSING GEOMETRY; the
    // degrade documents the accompanying detector confusion. This control
    // pins that property honestly (see src/fixture.ts swapAt docs).
    const withSwap = reportFor(
      PURITY_SPECS,
      { frames: PURITY_FRAMES },
      { maxGap: 0 },
      PURITY_DEGRADE,
    );
    const withoutSwap = reportFor(PURITY_SPECS, { frames: PURITY_FRAMES }, { maxGap: 0 });
    expect(withSwap).toEqual(withoutSwap);
  });
});

// ---------------------------------------------------------------------------
// Metric edge cases + determinism.
// ---------------------------------------------------------------------------

describe("benchmark — edge cases", () => {
  const SIMPLE_SPECS: FixtureTrackSpec[] = [
    {
      gtId: "s1",
      label: "player",
      motion: { kind: "static", at: { x: 0.5, y: 0.5 } },
      size: { w: 0.2, h: 0.2 },
    },
  ];

  test("empty ground truth -> all zeros with the documented conventions", () => {
    const report = runTrackingBenchmark({ groundTruth: [], predicted: new Map() });
    expect(report).toEqual({
      iouThreshold: 0.5,
      matchedDetections: 0,
      missedDetections: 0,
      identitySwitches: 0,
      continuityScore: 0, // 0 when no pairs (documented convention)
      fragments: {},
      trackPurity: {},
      meanTrackPurity: 0, // 0 when no tracks (documented convention)
    });
  });

  test("GT present but nothing predicted -> all missed, fragments 0, no crash", () => {
    const groundTruth = generateFixtureFrames(SIMPLE_SPECS, { frames: 4 });
    const report = runTrackingBenchmark({ groundTruth, predicted: new Map() });
    expect(report.matchedDetections).toBe(0);
    expect(report.missedDetections).toBe(4);
    expect(report.identitySwitches).toBe(0);
    expect(report.continuityScore).toBe(0);
    expect(report.fragments).toEqual({ s1: 0 }); // never matched -> 0 (documented)
    expect(report.trackPurity).toEqual({});
    expect(report.meanTrackPurity).toBe(0);
  });

  test("frames with predictions but no GT are ignored; a missing GT frame is fully missed", () => {
    const groundTruth = generateFixtureFrames(SIMPLE_SPECS, { frames: 4 });
    // Tracker output only for frames 1-2 (an interrupted run): frame 0 and
    // 3's GT boxes are missed; frames 1-2 match.
    const predicted = trackFixture(SIMPLE_SPECS, { frames: 4 }, {});
    const partial = new Map<string, readonly TrackedBox[]>([
      ["f-0-1", predicted.get("f-0-1") ?? []],
      ["f-0-2", predicted.get("f-0-2") ?? []],
      // A frame with predictions but NO ground truth entry: ignored.
      ["f-9-9", predicted.get("f-0-2") ?? []],
    ]);
    const report = runTrackingBenchmark({ groundTruth, predicted: partial });
    expect(report.matchedDetections).toBe(2);
    expect(report.missedDetections).toBe(2);
    expect(report.fragments).toEqual({ s1: 1 });
    expect(report.trackPurity).toEqual({ t1: 1 });
  });

  test("iouThreshold is echoed (default 0.5; explicit value respected)", () => {
    const groundTruth = generateFixtureFrames(SIMPLE_SPECS, { frames: 2 });
    const predicted = trackFixture(SIMPLE_SPECS, { frames: 2 }, {});
    expect(runTrackingBenchmark({ groundTruth, predicted }).iouThreshold).toBe(0.5);
    expect(runTrackingBenchmark({ groundTruth, predicted, iouThreshold: 0.99 }).iouThreshold).toBe(
      0.99,
    );
  });
});

describe("benchmark — determinism", () => {
  test("identical inputs -> deep-equal report (rebuilt from scratch)", () => {
    const first = reportFor(OCCLUSION_SPECS, { frames: OCCLUSION_FRAMES }, { maxGap: 5 });
    const second = reportFor(OCCLUSION_SPECS, { frames: OCCLUSION_FRAMES }, { maxGap: 5 });
    expect(first).toEqual(second);
  });

  test("tracker ids stable across two full runs (including a cut + occlusion)", () => {
    function run(): Map<string, readonly TrackedBox[]> {
      const specs: FixtureTrackSpec[] = [
        { ...OCCLUSION_SPECS[0]! },
        { ...OCCLUSION_SPECS[1]!, occludedFrames: new Set(OCCLUDED) },
      ];
      return trackFixture(
        specs,
        { frames: OCCLUSION_FRAMES, sceneCutFrames: new Set([60]) },
        { maxGap: 3 },
      );
    }
    const a = run();
    const b = run();
    expect([...a.keys()]).toEqual([...b.keys()]);
    for (const [frameId, tracks] of a) {
      expect(tracks).toEqual(b.get(frameId) ?? []);
    }
  });
});
