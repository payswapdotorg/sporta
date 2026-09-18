import { describe, expect, test } from "bun:test";
import {
  GreedyIouTrackerAdapter,
  InvalidAdapterInputError,
  TwoStageHungarianTracker,
  countApparentIdentitySwitches,
  detectionSequenceFromFixture,
  generateDetectionFixture,
} from "../src/index";
import type { DetectionFixtureSpec } from "../src/index";

const CROSSING_SPEC: DetectionFixtureSpec = {
  specId: "test-crossing",
  seed: 55,
  width: 160,
  height: 120,
  frameCount: 6,
  frameIntervalMs: 40,
  players: [
    {
      gtId: "p1",
      jersey: { r: 180, g: 30, b: 30 },
      from: { x: 0.2, y: 0.4 },
      to: { x: 0.8, y: 0.6 },
      boxW: 0.06,
      boxH: 0.12,
    },
    {
      gtId: "p2",
      jersey: { r: 30, g: 60, b: 200 },
      from: { x: 0.8, y: 0.4 },
      to: { x: 0.2, y: 0.6 },
      boxW: 0.06,
      boxH: 0.12,
    },
  ],
  ball: null,
  paintPitchLines: false,
};

/** A clean detection sequence (no degrade): both trackers must be near-perfect. */
function cleanSequence() {
  const frames = generateDetectionFixture(CROSSING_SPEC);
  return detectionSequenceFromFixture(
    frames,
    { missProbability: 0, jitter: 0 },
    CROSSING_SPEC.seed,
  );
}

describe("both player-tracking candidates conform to the family interface (R203)", () => {
  const candidates = [
    ["greedy-iou-tracker", () => new GreedyIouTrackerAdapter()],
    ["hungarian-tracker", () => new TwoStageHungarianTracker()],
  ] as const;

  for (const [name, construct] of candidates) {
    test(`${name}: clean sequence — every detection tracked, per-frame parity, no switches`, () => {
      const adapter = construct();
      const sequence = cleanSequence();
      const result = adapter.track(sequence);
      expect(result.perFrame.length).toBe(sequence.length);
      let totalDetections = 0;
      for (const [index, frame] of sequence.entries()) {
        const tracked = result.perFrame[index]!;
        expect(tracked.length).toBe(frame.detections.length);
        for (const [detectionIndex, trackedBox] of tracked.entries()) {
          totalDetections += 1;
          expect(trackedBox.label).toBe(frame.detections[detectionIndex]!.label);
          expect(trackedBox.confidence).toBe(frame.detections[detectionIndex]!.confidence);
          expect(trackedBox.box).toEqual(frame.detections[detectionIndex]!.box);
          expect(trackedBox.trackId).toMatch(/^t\d+$/);
        }
      }
      expect(totalDetections).toBe(12);
      // Clean input: no apparent identity switches.
      expect(result.identitySwitches).toBe(0);
    });

    test(`${name}: deterministic — two runs over the same sequence deep-equal`, () => {
      const adapter = construct();
      const sequence = cleanSequence();
      expect(adapter.track(sequence)).toEqual(adapter.track(sequence));
    });

    test(`${name}: repeatable — one track() call is one session (ids restart, no state leak)`, () => {
      const adapter = construct();
      const sequence = cleanSequence();
      const first = adapter.track(sequence);
      const second = adapter.track(sequence);
      expect(second).toEqual(first);
    });

    test(`${name}: malformed input is refused loudly (untrusted-input law)`, () => {
      const adapter = construct();
      const sequence = cleanSequence();
      const malformed = [
        ...sequence,
        {
          frame: sequence[0]!.frame,
          detections: [
            { box: { x: -0.5, y: 0.1, w: 0.1, h: 0.2 }, label: "player", confidence: 0.9 },
          ],
        },
      ];
      expect(() => adapter.track(malformed)).toThrow(InvalidAdapterInputError);
      const unordered = [sequence[1]!, sequence[0]!];
      expect(() => adapter.track(unordered)).toThrow(InvalidAdapterInputError);
    });
  }
});

describe("identity-switch counting (the typed count, R203)", () => {
  test("a gap-induced id change is counted as an apparent switch", () => {
    // Frame 0: two boxes; frame 1: player 1's box MOVES far away (below the
    // association gate) so it opens a new id; the strongly-overlapping pair
    // (player 2) keeps its id -> zero switches. Then frame 2 drops player 2
    // entirely and re-adds it at a new position: the re-added box overlaps
    // nothing -> no switch evidence either. The counted case: frame 3's box
    // strongly overlaps frame 2's box but carries a different id.
    const perFrame = [
      [
        {
          box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
          label: "player",
          confidence: 0.9,
          trackId: "t1",
        },
        {
          box: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
          label: "player",
          confidence: 0.9,
          trackId: "t2",
        },
      ],
      [
        {
          box: { x: 0.12, y: 0.1, w: 0.1, h: 0.1 },
          label: "player",
          confidence: 0.9,
          trackId: "t1",
        },
        {
          box: { x: 0.52, y: 0.5, w: 0.1, h: 0.1 },
          label: "player",
          confidence: 0.9,
          trackId: "t2",
        },
      ],
      [
        {
          box: { x: 0.12, y: 0.1, w: 0.1, h: 0.1 },
          label: "player",
          confidence: 0.9,
          trackId: "t3",
        },
        {
          box: { x: 0.52, y: 0.5, w: 0.1, h: 0.1 },
          label: "player",
          confidence: 0.9,
          trackId: "t2",
        },
      ],
    ];
    // Frame1->frame2: the t1 box at (0.12,...) is tracked as t3 -> switch.
    expect(countApparentIdentitySwitches(perFrame)).toBe(1);
  });

  test("no switches on stable ids; zero on disjoint boxes", () => {
    const stable = [
      [
        {
          box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
          label: "player",
          confidence: 0.9,
          trackId: "t1",
        },
      ],
      [
        {
          box: { x: 0.12, y: 0.1, w: 0.1, h: 0.1 },
          label: "player",
          confidence: 0.9,
          trackId: "t1",
        },
      ],
    ];
    expect(countApparentIdentitySwitches(stable)).toBe(0);
    const disjoint = [
      [
        {
          box: { x: 0.1, y: 0.1, w: 0.05, h: 0.05 },
          label: "player",
          confidence: 0.9,
          trackId: "t1",
        },
      ],
      [
        {
          box: { x: 0.8, y: 0.8, w: 0.05, h: 0.05 },
          label: "player",
          confidence: 0.9,
          trackId: "t2",
        },
      ],
    ];
    expect(countApparentIdentitySwitches(disjoint)).toBe(0);
  });

  test("a label change never counts as a switch (different objects)", () => {
    const labelChange = [
      [
        {
          box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
          label: "player",
          confidence: 0.9,
          trackId: "t1",
        },
      ],
      [{ box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, label: "ball", confidence: 0.9, trackId: "t2" }],
    ];
    expect(countApparentIdentitySwitches(labelChange)).toBe(0);
  });

  test("the threshold validates its range", () => {
    expect(() => countApparentIdentitySwitches([], 1.5)).toThrow(RangeError);
  });
});

describe("the two candidates are materially different (R203 acceptance)", () => {
  test("constructed divergence: greedy best-first vs global optimum (the designed difference)", () => {
    // Frame 0 opens t1@(0.00) and t2@(0.18); frame 1's detections sit at
    // 0.10 and 0.30. Both candidates run with the SAME association gate
    // (0.2) so the difference shown is purely the ASSIGNMENT ALGORITHM.
    // Greedy best-first pairs (t2, 0.10) first (IoU 0.43), leaving t1
    // without an in-gate partner -> 0.10 extends t2 and 0.30 opens t3.
    // The Hungarian maximizes matched pairs globally: (t1, 0.10) +
    // (t2, 0.30) — the ONLY cardinality-2 matching. The outputs differ by
    // design; this is the constructed case the difference exists for.
    const box = (x: number): { x: number; y: number; w: number; h: number } => ({
      x,
      y: 0.4,
      w: 0.2,
      h: 0.2,
    });
    const frame = (decodeOrder: number, xs: readonly number[]) => ({
      frame: {
        frameId: `f-0-${decodeOrder}`,
        presentationMs: decodeOrder * 40,
        width: 160,
        height: 120,
        bytes: new Uint8Array(160 * 120 * 3),
        decodeOrder,
        streamIndex: 0,
      },
      detections: xs.map((x) => ({ box: box(x), label: "player", confidence: 0.9 })),
    });
    const sequence = [frame(0, [0.0, 0.18]), frame(1, [0.1, 0.3])];
    const greedy = new GreedyIouTrackerAdapter({ iouThreshold: 0.2 }).track(sequence);
    const hungarian = new TwoStageHungarianTracker({ iouGate: 0.2 }).track(sequence);
    const greedyFrame1 = greedy.perFrame[1]!.map((tracked) => tracked.trackId);
    const hungarianFrame1 = hungarian.perFrame[1]!.map((tracked) => tracked.trackId);
    // Greedy: 0.10 extends t2, 0.30 opens t3.
    expect(greedyFrame1).toEqual(["t2", "t3"]);
    // Hungarian: the global two-pair assignment extends both tracks.
    expect(hungarianFrame1).toEqual(["t1", "t2"]);
  });

  test("gap tolerance closes tracks and re-opens fresh ids (fragmentation is honest)", () => {
    const adapter = new GreedyIouTrackerAdapter({ maxGap: 0 });
    const frames = generateDetectionFixture(CROSSING_SPEC);
    // Detections present only on even frames -> every gap closes the track.
    const gapped = frames
      .map((fixtureFrame, index) => ({
        frame: fixtureFrame.frame,
        detections:
          index % 2 === 0
            ? fixtureFrame.groundTruth.map((gt) => ({
                box: gt.box,
                label: "player",
                confidence: 0.9,
              }))
            : [],
      }))
      .filter((_, index) => index < 4);
    const result = adapter.track(gapped);
    // Frames 0 and 2 carry detections; each opens fresh ids (t1, t2, then t3, t4).
    const ids = result.perFrame.flat().map((box) => box.trackId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(4);
  });
});
