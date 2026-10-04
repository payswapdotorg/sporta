/**
 * THE provider-neutral camera intent emission (HF014 — the additive
 * battery): `src/intent.ts` `emitCameraIntent`, `src/intent-validate.ts`
 * `validateIntentDocument`, and `src/intent-selfcheck.ts`
 * `checkCameraIntent`.
 *
 * Pinned here:
 *
 * - **The slot-to-pose resolution** — per canonical W601 slot, every pose
 *   of a window's path carries the slot's position/target verbatim,
 *   `focalMultiplier` 1.0, the uniform frame grid
 *   (`tMs = i · frameIntervalMs`, `i < ceil(duration / interval)`), and
 *   the monotone in-run `sourceFrame` resolution;
 * - **The fixture-class shape** — the document speaks the hf010 pose
 *   vocabulary (`frameIndex/tMs/eye/look/focalMultiplier/sourceFrame`
 *   EXACTLY) and carries the W601 slot-geometry echo verbatim;
 * - **Provenance-carried** — rule + slot geometry version + the plan's
 *   decision record VERBATIM; kind/source/slot/summary verbatim;
 * - **Determinism** — the same plan/steps/options yield a
 *   JSON-byte-identical document (and a JSON round-tripped plan too);
 * - **Fail-closed admission** — invalid options (`intent-invalid`),
 *   invalid plan (`plan-invalid`), the pose budget (`budget-exceeded`);
 *   the emission never mutates the plan or the steps;
 * - **The validator** — fail-closed, unknown keys ignored, every value
 *   rule pinned by a negative case;
 * - **The selfcheck** — stable violation ids, one negative fixture per id;
 * - **BOTH CONSUMER CLASSES** — the same emission's slot geometry equals
 *   the procedural compose manifest's realized camera blocks (the
 *   `render3dDirectedMatch` / `cameraSlotId` seam, UNCHANGED).
 */
import { describe, expect, test } from "bun:test";
import { CANONICAL_CAMERA_SLOTS, CAMERA_SLOT_SET_VERSION } from "@sporta/scene-projection";
import { DEFAULT_DIRECTOR_POLICY } from "../src/policy";
import { DIRECTOR_VERSION } from "../src/policy";
import { direct } from "../src/direct";
import { DirectorError } from "../src/errors";
import { render3dDirectedMatch } from "../src/compose";
import type { CameraPlan, DirectedWindow, PresentationKind } from "../src/types";
import {
  DEFAULT_INTENT_FRAME_RATE,
  INTENT_DOCUMENT_VERSION,
  INTENT_KIND_SLOT_HOLD,
  INTENT_POSE_DECIMALS,
  INTENT_POSE_VOCABULARY,
  emitCameraIntent,
} from "../src/intent";
import type { CameraIntentDocument } from "../src/intent";
import { validateIntentDocument } from "../src/intent-validate";
import { checkCameraIntent } from "../src/intent-selfcheck";
import { buildCandidate, buildDirectorMatch, buildDirectorRequest } from "./helpers";

/** The canonical representative plan: 7 steps, a goal candidate, 3 windows. */
function canonicalPlan(): CameraPlan {
  return direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), [buildCandidate()]);
}

/** A minimal VALID single-window plan directing `slotId` (possession default). */
function singleWindowPlan(slotId: string): CameraPlan {
  const window: DirectedWindow = {
    index: 0,
    kind: "live",
    source: { startMs: 1_000, endMs: 7_000 },
    cameraSlotId: slotId,
    decision: {
      ruleId: "possession-follow",
      possession: { fallback: true, desiredSlotId: "main-touchline" },
      reason: "test: the documented default slot (no usable follow reference)",
    },
  };
  return {
    directorVersion: DIRECTOR_VERSION,
    policy: {
      policyId: DEFAULT_DIRECTOR_POLICY.policyId,
      policyVersion: DEFAULT_DIRECTOR_POLICY.policyVersion,
    },
    timeline: { startMs: 1_000, endMs: 7_000 },
    windows: [window],
    summary: {
      windowCount: 1,
      liveWindowCount: 1,
      reviewWindowCount: 0,
      cutCount: 0,
      suppressedCuts: [],
      eventAccounting: [],
    },
  };
}

/** A deep JSON clone (fixtures are never shared mutable state). */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("emitCameraIntent — the slot-to-pose resolution", () => {
  test("the canonical plan emits one resolved path per directed window (3 windows)", () => {
    const plan = canonicalPlan();
    const intent = emitCameraIntent(plan, buildDirectorMatch());
    expect(intent.windows.length).toBe(3);
    expect(intent.windows.map((window) => window.index)).toEqual([0, 1, 2]);
    expect(intent.windows.map((window) => window.cameraSlotId)).toEqual([
      "main-touchline",
      "behind-goal-x105",
      "behind-goal-x105",
    ]);
  });

  test("every pose of every window is the slot-hold resolution: the W601 constants, verbatim, focalMultiplier 1", () => {
    const plan = canonicalPlan();
    const intent = emitCameraIntent(plan, buildDirectorMatch());
    for (const window of intent.windows) {
      const slot = CANONICAL_CAMERA_SLOTS.find((entry) => entry.slotId === window.cameraSlotId)!;
      expect(window.path.intentKind).toBe(INTENT_KIND_SLOT_HOLD);
      expect(window.path.anchorSlotId).toBe(window.cameraSlotId);
      for (const pose of window.path.poses) {
        expect(pose.eye).toEqual({ x: slot.position.x, y: slot.position.y, z: slot.position.z });
        expect(pose.look).toEqual({ x: slot.target.x, y: slot.target.y, z: slot.target.z });
        expect(pose.focalMultiplier).toBe(1);
      }
    }
  });

  test("the resolution holds for EVERY canonical W601 slot (all five, one plan each)", () => {
    for (const slot of CANONICAL_CAMERA_SLOTS) {
      const intent = emitCameraIntent(singleWindowPlan(slot.slotId), buildDirectorMatch());
      const window = intent.windows[0]!;
      expect(window.path.anchorSlotId).toBe(slot.slotId);
      for (const pose of window.path.poses) {
        expect(pose.eye).toEqual({ x: slot.position.x, y: slot.position.y, z: slot.position.z });
        expect(pose.look).toEqual({ x: slot.target.x, y: slot.target.y, z: slot.target.z });
      }
    }
  });

  test("the frame grid: frameCount = max(1, ceil(duration / interval)), tMs = i·interval, gap-free indices", () => {
    const plan = canonicalPlan();
    const steps = buildDirectorMatch();
    const intent = emitCameraIntent(plan, steps);
    const interval = 62.5; // 16 fps, the default cadence
    expect(intent.emission.frameRate).toBe(DEFAULT_INTENT_FRAME_RATE);
    expect(intent.emission.frameIntervalMs).toBe(interval);
    // [1000,5000] D=4000 → 64; [5000,7000] D=2000 → 32; review [3000,7000] → 64.
    expect(intent.windows.map((window) => window.path.frameCount)).toEqual([64, 32, 64]);
    for (const window of intent.windows) {
      expect(window.path.frameIntervalMs).toBe(interval);
      expect(window.path.fps).toBe(DEFAULT_INTENT_FRAME_RATE);
      expect(window.path.poses.length).toBe(window.path.frameCount);
      for (let i = 0; i < window.path.poses.length; i += 1) {
        const pose = window.path.poses[i]!;
        expect(pose.frameIndex).toBe(i);
        expect(pose.tMs).toBe(Math.round(i * interval * 1000) / 1000);
      }
    }
  });

  test("an explicit frame rate re-grids the emission (5 fps → 200 ms frames, 20/10/20 poses)", () => {
    const intent = emitCameraIntent(canonicalPlan(), buildDirectorMatch(), { frameRate: 5 });
    expect(intent.emission.frameIntervalMs).toBe(200);
    expect(intent.windows.map((window) => window.path.frameCount)).toEqual([20, 10, 20]);
    expect(intent.windows[0]!.path.poses[1]!.tMs).toBe(200);
  });

  test("a non-divisor frame rate quantizes times to 3 decimals (30 fps → 33.333)", () => {
    const intent = emitCameraIntent(canonicalPlan(), buildDirectorMatch(), { frameRate: 30 });
    expect(intent.emission.frameIntervalMs).toBeCloseTo(33.333333, 3);
    expect(intent.windows[0]!.path.poses[1]!.tMs).toBe(33.333);
    expect(intent.emission.poseQuantizationDecimals).toBe(INTENT_POSE_DECIMALS);
  });

  test("sourceFrame: the last step at-or-before the frame's source time, inside the window's run (canonical grid pinned)", () => {
    const steps = buildDirectorMatch();
    const intent = emitCameraIntent(canonicalPlan(), steps);
    // Steps are exactly 1000 ms apart, so the resolution is floor arithmetic.
    const window0 = intent.windows[0]!; // run = steps[0..3] (atMs 1000..4000)
    for (const pose of window0.path.poses) {
      expect(pose.sourceFrame).toBe(Math.floor(pose.tMs / 1000));
    }
    const window1 = intent.windows[1]!; // run = steps[4..6] (atMs 5000..7000)
    for (const pose of window1.path.poses) {
      expect(pose.sourceFrame).toBe(4 + Math.floor(pose.tMs / 1000));
    }
    const window2 = intent.windows[2]!; // review, run = steps[2..6] (atMs 3000..7000)
    for (const pose of window2.path.poses) {
      expect(pose.sourceFrame).toBe(2 + Math.floor(pose.tMs / 1000));
    }
    // Monotone within every window (the source-time convention).
    for (const window of intent.windows) {
      const frames = window.path.poses.map((pose) => pose.sourceFrame);
      for (let i = 1; i < frames.length; i += 1) {
        expect(frames[i]!).toBeGreaterThanOrEqual(frames[i - 1]!);
      }
    }
  });
});

describe("emitCameraIntent — the fixture-class shape (the hf010 vocabulary)", () => {
  test("every pose carries EXACTLY the six vocabulary fields", () => {
    const intent = emitCameraIntent(canonicalPlan(), buildDirectorMatch());
    for (const window of intent.windows) {
      for (const pose of window.path.poses) {
        expect(Object.keys(pose).sort()).toEqual([
          "eye",
          "focalMultiplier",
          "frameIndex",
          "look",
          "sourceFrame",
          "tMs",
        ]);
      }
    }
  });

  test("the document header pins the versions, the pitch geometry, and the W601 slot-geometry echo", () => {
    const plan = canonicalPlan();
    const intent = emitCameraIntent(plan, buildDirectorMatch());
    expect(intent.intentVersion).toBe(INTENT_DOCUMENT_VERSION);
    expect(intent.poseVocabulary).toBe(INTENT_POSE_VOCABULARY);
    expect(INTENT_POSE_VOCABULARY).toBe("hf010.camera-paths@1");
    expect(intent.directorVersion).toBe(plan.directorVersion);
    expect(intent.policy).toEqual(plan.policy);
    expect(intent.timeline).toEqual(plan.timeline);
    expect(intent.pitchGeometry).toEqual({ lengthXMeters: 105, widthYMeters: 68, zUp: true });
    expect(intent.slotGeometry.constantsVersion).toBe(CAMERA_SLOT_SET_VERSION);
    expect(intent.slotGeometry.slots.length).toBe(CANONICAL_CAMERA_SLOTS.length);
    for (let i = 0; i < CANONICAL_CAMERA_SLOTS.length; i += 1) {
      const slot = CANONICAL_CAMERA_SLOTS[i]!;
      const echoed = intent.slotGeometry.slots[i]!;
      expect(echoed.slotId).toBe(slot.slotId);
      expect(echoed.eye).toEqual({ x: slot.position.x, y: slot.position.y, z: slot.position.z });
      expect(echoed.look).toEqual({ x: slot.target.x, y: slot.target.y, z: slot.target.z });
    }
    expect(intent.emission.intentKind).toBe(INTENT_KIND_SLOT_HOLD);
    expect(intent.emission.determinism).toContain("pure");
    expect(intent.emission.sourceTimeConvention).toContain("monotonically");
  });
});

describe("emitCameraIntent — provenance carried verbatim", () => {
  test("every window carries the plan's decision record VERBATIM (rule + slot geometry version)", () => {
    const plan = canonicalPlan();
    const intent = emitCameraIntent(plan, buildDirectorMatch());
    for (let i = 0; i < plan.windows.length; i += 1) {
      const planWindow = plan.windows[i]!;
      const intentWindow = intent.windows[i]!;
      expect(intentWindow.kind).toBe(planWindow.kind);
      expect(intentWindow.source).toEqual(planWindow.source);
      expect(intentWindow.cameraSlotId).toBe(planWindow.cameraSlotId);
      expect(intentWindow.provenance.ruleId).toBe(planWindow.decision.ruleId);
      expect(intentWindow.provenance.slotGeometryVersion).toBe(CAMERA_SLOT_SET_VERSION);
      expect(JSON.stringify(intentWindow.provenance.decision)).toBe(
        JSON.stringify(planWindow.decision),
      );
    }
  });

  test("the summary rides verbatim (the W605 accounting surface)", () => {
    const plan = canonicalPlan();
    const intent = emitCameraIntent(plan, buildDirectorMatch());
    expect(JSON.stringify(intent.summary)).toBe(JSON.stringify(plan.summary));
  });
});

describe("emitCameraIntent — determinism (the direct() doctrine)", () => {
  test("the same plan, steps, and options yield a JSON-BYTE-IDENTICAL document", () => {
    const plan = canonicalPlan();
    const steps = buildDirectorMatch();
    const first = emitCameraIntent(plan, steps);
    const second = emitCameraIntent(plan, steps);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test("a JSON round-tripped plan (data, not the runtime object) emits the identical document", () => {
    const plan = canonicalPlan();
    const steps = buildDirectorMatch();
    const first = emitCameraIntent(plan, steps);
    const second = emitCameraIntent(clone(plan), clone(steps));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test("the emission is pure: the plan and the steps are never mutated", () => {
    const plan = canonicalPlan();
    const steps = buildDirectorMatch();
    const planBefore = JSON.stringify(plan);
    const stepsBefore = JSON.stringify(steps);
    emitCameraIntent(plan, steps);
    expect(JSON.stringify(plan)).toBe(planBefore);
    expect(JSON.stringify(steps)).toBe(stepsBefore);
  });
});

describe("emitCameraIntent — fail-closed admission", () => {
  test("a non-positive or non-finite frameRate is refused (intent-invalid)", () => {
    for (const frameRate of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => emitCameraIntent(canonicalPlan(), buildDirectorMatch(), { frameRate })).toThrow(
        DirectorError,
      );
      try {
        emitCameraIntent(canonicalPlan(), buildDirectorMatch(), { frameRate });
      } catch (error) {
        expect((error as DirectorError).kind).toBe("intent-invalid");
      }
    }
  });

  test("non-object options are refused (intent-invalid)", () => {
    expect(() => emitCameraIntent(canonicalPlan(), buildDirectorMatch(), "fast" as never)).toThrow(
      DirectorError,
    );
  });

  test("a plan that fails the invariant harness is refused (plan-invalid), never partially emitted", () => {
    const plan = canonicalPlan();
    plan.windows[0]!.cameraSlotId = "invented-angle"; // never a canonical slot
    expect(() => emitCameraIntent(plan, buildDirectorMatch())).toThrow(DirectorError);
    try {
      emitCameraIntent(plan, buildDirectorMatch());
    } catch (error) {
      expect((error as DirectorError).kind).toBe("plan-invalid");
    }
  });

  test("the pose budget is enforced (budget-exceeded above MAX_RENDER_FRAMES poses)", () => {
    // 1000 fps over the canonical windows implies 10 000 poses > 3 600.
    expect(() =>
      emitCameraIntent(canonicalPlan(), buildDirectorMatch(), { frameRate: 1000 }),
    ).toThrow(DirectorError);
    try {
      emitCameraIntent(canonicalPlan(), buildDirectorMatch(), { frameRate: 1000 });
    } catch (error) {
      expect((error as DirectorError).kind).toBe("budget-exceeded");
    }
  });
});

describe("both consumer classes — the same emission feeds the procedural path's geometry", () => {
  test("every composed window's REALIZED camera block equals the emission's slot geometry (compose UNCHANGED)", () => {
    const plan = canonicalPlan();
    const steps = buildDirectorMatch();
    const intent = emitCameraIntent(plan, steps);
    const composed = render3dDirectedMatch(buildDirectorRequest(), steps, plan);
    expect(composed.manifest.windows.length).toBe(intent.windows.length);
    for (let i = 0; i < intent.windows.length; i += 1) {
      const composedWindow = composed.manifest.windows[i]!;
      const intentWindow = intent.windows[i]!;
      expect(composedWindow.cameraSlotId).toBe(intentWindow.cameraSlotId);
      expect(composedWindow.camera.position).toEqual(intentWindow.path.poses[0]!.eye);
      expect(composedWindow.camera.target).toEqual(intentWindow.path.poses[0]!.look);
      // The whole path holds the slot: every pose equals the realized block.
      for (const pose of intentWindow.path.poses) {
        expect(pose.eye).toEqual(composedWindow.camera.position);
        expect(pose.look).toEqual(composedWindow.camera.target);
      }
    }
  });

  test("emitting the intent changes NOTHING downstream: compose before/after is byte-identical", () => {
    const plan = canonicalPlan();
    const steps = buildDirectorMatch();
    const before = render3dDirectedMatch(buildDirectorRequest(), steps, plan);
    emitCameraIntent(plan, steps);
    const after = render3dDirectedMatch(buildDirectorRequest(), steps, plan);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});

describe("validateIntentDocument — fail-closed, unknown keys ignored", () => {
  test("the canonical emission validates ok, and the value equals the document", () => {
    const intent = emitCameraIntent(canonicalPlan(), buildDirectorMatch());
    const validation = validateIntentDocument(intent);
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(JSON.stringify(validation.value)).toBe(JSON.stringify(intent));
    }
  });

  test("unknown keys are IGNORED at every level (forward-compatible documents)", () => {
    const intent = clone(emitCameraIntent(canonicalPlan(), buildDirectorMatch()));
    const asRecord = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;
    asRecord(intent).futureTopLevel = { anything: true };
    asRecord(intent.windows[0]!).futureWindowKey = "unknown";
    asRecord(intent.windows[0]!.path).futurePathKey = 7;
    asRecord(intent.windows[0]!.path.poses[0]!).futurePoseKey = null;
    asRecord(intent.windows[0]!.provenance).futureProvenanceKey = [];
    asRecord(intent.emission).futureEmissionKey = "x";
    expect(validateIntentDocument(intent).ok).toBe(true);
  });

  test("a JSON round-trip of the document validates ok (the wire form)", () => {
    const intent = emitCameraIntent(canonicalPlan(), buildDirectorMatch());
    expect(validateIntentDocument(JSON.parse(JSON.stringify(intent))).ok).toBe(true);
  });

  test("a non-object document is refused with one issue (never throws)", () => {
    for (const garbage of [null, undefined, 3, "doc", []]) {
      const validation = validateIntentDocument(garbage);
      expect(validation.ok).toBe(false);
      if (!validation.ok) {
        expect(validation.issues.length).toBeGreaterThan(0);
      }
    }
  });

  test("every documented value rule is fail-closed (one negative case per rule)", () => {
    const base = () => clone(emitCameraIntent(canonicalPlan(), buildDirectorMatch()));
    const cases: Array<[string, (intent: CameraIntentDocument) => void]> = [
      ["a window that is not an object", (intent) => void (intent.windows[0] = null as never)],
      [
        "a pose that is not an object",
        (intent) => void (intent.windows[0]!.path.poses[0] = null as never),
      ],
      ["empty intentVersion", (intent) => void (intent.intentVersion = "")],
      ["empty poseVocabulary", (intent) => void (intent.poseVocabulary = "")],
      ["empty directorVersion", (intent) => void (intent.directorVersion = "")],
      ["policy not a record", (intent) => void (intent.policy = 3 as never)],
      ["empty policyId", (intent) => void (intent.policy.policyId = "")],
      ["timeline end before start", (intent) => void (intent.timeline.endMs = 0)],
      ["pitchGeometry wrong width", (intent) => void (intent.pitchGeometry.widthYMeters = 0)],
      ["pitchGeometry zUp not boolean", (intent) => void (intent.pitchGeometry.zUp = 1 as never)],
      ["slotGeometry empty slots", (intent) => void (intent.slotGeometry.slots = [])],
      ["slotGeometry bad eye", (intent) => void (intent.slotGeometry.slots[0]!.eye.x = Number.NaN)],
      ["emission frameRate 0", (intent) => void (intent.emission.frameRate = 0)],
      [
        "emission intentKind unknown",
        (intent) => void (intent.emission.intentKind = "orbit" as never),
      ],
      [
        "emission decimals negative",
        (intent) => void (intent.emission.poseQuantizationDecimals = -1),
      ],
      ["windows empty", (intent) => void (intent.windows = [])],
      ["window index gap", (intent) => void (intent.windows[1]!.index = 5)],
      [
        "window kind unknown",
        (intent) => void (intent.windows[0]!.kind = "bulletin" as PresentationKind),
      ],
      ["window source inverted", (intent) => void (intent.windows[0]!.source.endMs = 999)],
      ["window slot empty", (intent) => void (intent.windows[0]!.cameraSlotId = "")],
      [
        "provenance ruleId unknown",
        (intent) => void (intent.windows[0]!.provenance.ruleId = "vibes" as never),
      ],
      [
        "provenance slotGeometryVersion empty",
        (intent) => void (intent.windows[0]!.provenance.slotGeometryVersion = ""),
      ],
      [
        "provenance decision missing",
        (intent) => void (intent.windows[0]!.provenance.decision = undefined as never),
      ],
      [
        "decision reason empty",
        (intent) => void (intent.windows[0]!.provenance.decision.reason = ""),
      ],
      [
        "event-focus decision without the verbatim candidate",
        (intent) => void (intent.windows[1]!.provenance.decision.event = undefined as never),
      ],
      [
        "possession decision without the follow inputs",
        (intent) => void (intent.windows[0]!.provenance.decision.possession = undefined as never),
      ],
      ["path frameCount mismatch", (intent) => void (intent.windows[0]!.path.frameCount = 999)],
      ["path poses empty", (intent) => void (intent.windows[0]!.path.poses = [])],
      ["path fps 0", (intent) => void (intent.windows[0]!.path.fps = 0)],
      [
        "pose frameIndex mismatch",
        (intent) => void (intent.windows[0]!.path.poses[3]!.frameIndex = 9),
      ],
      ["pose tMs negative", (intent) => void (intent.windows[0]!.path.poses[0]!.tMs = -1)],
      [
        "pose eye missing an axis",
        (intent) => void (intent.windows[0]!.path.poses[0]!.eye.z = Number.NaN),
      ],
      [
        "pose focalMultiplier 0",
        (intent) => void (intent.windows[0]!.path.poses[0]!.focalMultiplier = 0),
      ],
      [
        "pose sourceFrame negative",
        (intent) => void (intent.windows[0]!.path.poses[0]!.sourceFrame = -1),
      ],
      [
        "pose sourceFrame fractional",
        (intent) => void (intent.windows[0]!.path.poses[0]!.sourceFrame = 1.5),
      ],
      ["summary cutCount not an integer", (intent) => void (intent.summary.cutCount = 1.5)],
      [
        "summary eventAccounting not an array",
        (intent) => void (intent.summary.eventAccounting = {} as never),
      ],
    ];
    expect(cases.length).toBeGreaterThanOrEqual(35);
    for (const [, mutate] of cases) {
      const intent = base();
      mutate(intent);
      const validation = validateIntentDocument(intent);
      expect(validation.ok).toBe(false);
      if (!validation.ok) {
        expect(validation.issues.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("checkCameraIntent — the invariant harness (stable violation ids)", () => {
  test("the canonical emission violates nothing", () => {
    const intent = emitCameraIntent(canonicalPlan(), buildDirectorMatch());
    const check = checkCameraIntent(intent, buildDirectorMatch());
    expect(check.violations).toEqual([]);
    expect(check.ok).toBe(true);
  });

  test("the check is pure and stable: the same input yields the same violations", () => {
    const intent = clone(emitCameraIntent(canonicalPlan(), buildDirectorMatch()));
    intent.windows[0]!.path.poses[2]!.tMs = 999; // a tampered grid
    const first = checkCameraIntent(intent, buildDirectorMatch());
    const second = checkCameraIntent(intent, buildDirectorMatch());
    expect(second.violations).toEqual(first.violations);
  });

  test("garbage input reports violations, never throws (fail-soft)", () => {
    for (const garbage of [null, undefined, 3, "doc", []]) {
      const check = checkCameraIntent(garbage, buildDirectorMatch());
      expect(check.ok).toBe(false);
      expect(check.violations.length).toBeGreaterThan(0);
    }
  });

  test("empty steps are a timeline-consistency violation", () => {
    const intent = emitCameraIntent(canonicalPlan(), buildDirectorMatch());
    const check = checkCameraIntent(intent, []);
    expect(check.ok).toBe(false);
    expect(check.violations[0]!).toContain("timeline-consistency");
  });

  test("one negative fixture per violation id", () => {
    const steps = buildDirectorMatch();
    const base = () => clone(emitCameraIntent(canonicalPlan(), steps));
    const cases: Array<[string, (intent: CameraIntentDocument) => void]> = [
      [
        "intent-shape: a missing top-level block",
        (intent) => void (intent.emission = undefined as never),
      ],
      ["intent-shape: a window index gap", (intent) => void (intent.windows[2]!.index = 9)],
      [
        "pose-vocabulary: a pose carries an extra field",
        (intent) =>
          void ((intent.windows[0]!.path.poses[0] as unknown as Record<string, unknown>).roll = 0),
      ],
      [
        "slot-geometry: a tampered slot echo",
        (intent) => void (intent.slotGeometry.slots[0]!.eye.z = 99),
      ],
      [
        "slot-geometry: the wrong constant-set version",
        (intent) => void (intent.slotGeometry.constantsVersion = "camera-slots@0"),
      ],
      [
        "slot-geometry: a dropped slot from the echo",
        (intent) => void (intent.slotGeometry.slots = intent.slotGeometry.slots.slice(0, 4)),
      ],
      [
        "slot-geometry: the wrong pitch geometry",
        (intent) => void (intent.pitchGeometry.lengthXMeters = 100),
      ],
      [
        "pose-resolution: a tampered pose eye (an invented geometry)",
        (intent) => void (intent.windows[0]!.path.poses[1]!.eye.y = -10),
      ],
      [
        "pose-resolution: a zoom (focalMultiplier ≠ 1)",
        (intent) => void (intent.windows[0]!.path.poses[1]!.focalMultiplier = 1.6),
      ],
      [
        "pose-resolution: a broken time grid",
        (intent) => void (intent.windows[0]!.path.poses[2]!.tMs = 999),
      ],
      [
        "pose-resolution: a source frame outside the run",
        (intent) => void (intent.windows[0]!.path.poses[1]!.sourceFrame = 6),
      ],
      [
        "pose-resolution: a decreasing source frame",
        (intent) => void (intent.windows[0]!.path.poses[17]!.sourceFrame = 0),
      ],
      [
        "pose-resolution: frameCount disagrees with the poses",
        (intent) => void (intent.windows[0]!.path.frameCount = 63),
      ],
      [
        "pose-resolution: the anchor slot disagrees with the window",
        (intent) => void (intent.windows[0]!.path.anchorSlotId = "aerial-tactical"),
      ],
      [
        "provenance-carried: an unknown rule id",
        (intent) => void (intent.windows[0]!.provenance.ruleId = "hand-of-god" as never),
      ],
      [
        "provenance-carried: the decision rule disagrees with the window",
        (intent) => void (intent.windows[0]!.provenance.decision.ruleId = "event-focus"),
      ],
      [
        "provenance-carried: an event-driven decision without the candidate",
        (intent) => void (intent.windows[1]!.provenance.decision.event = undefined as never),
      ],
      [
        "provenance-carried: the wrong slot-geometry version",
        (intent) => void (intent.windows[0]!.provenance.slotGeometryVersion = "camera-slots@2"),
      ],
      [
        "timeline-consistency: the timeline disagrees with the steps",
        (intent) => void (intent.timeline.endMs = 9999),
      ],
      [
        "timeline-consistency: a window boundary off-snapshot",
        (intent) => void (intent.windows[0]!.source.endMs = 4500),
      ],
      [
        "timeline-consistency: broken live tiling",
        (intent) => void (intent.windows[1]!.source.startMs = 4500),
      ],
      [
        "summary-consistency: the wrong window count",
        (intent) => void (intent.summary.windowCount = 9),
      ],
      ["summary-consistency: the wrong cut count", (intent) => void (intent.summary.cutCount = 5)],
    ];
    const seen = new Set<string>();
    for (const [label, mutate] of cases) {
      const intent = base();
      mutate(intent);
      const check = checkCameraIntent(intent, steps);
      expect(check.ok).toBe(false);
      expect(check.violations.length).toBeGreaterThan(0);
      const id = check.violations[0]!.split(":")[0]!;
      expect(id, `${label} → the violation id must be stable and named`).toMatch(
        /^(intent-shape|pose-vocabulary|slot-geometry|pose-resolution|provenance-carried|timeline-consistency|summary-consistency)$/,
      );
      seen.add(id);
    }
    // Every documented violation id is exercised by at least one fixture.
    expect(seen).toEqual(
      new Set([
        "intent-shape",
        "pose-vocabulary",
        "slot-geometry",
        "pose-resolution",
        "provenance-carried",
        "timeline-consistency",
        "summary-consistency",
      ]),
    );
  });

  test("a wire-round-tripped document self-checks clean (the consumer admission path)", () => {
    const intent = emitCameraIntent(canonicalPlan(), buildDirectorMatch());
    const wire = JSON.parse(JSON.stringify(intent)) as CameraIntentDocument;
    expect(checkCameraIntent(wire, buildDirectorMatch()).ok).toBe(true);
    expect(validateIntentDocument(wire).ok).toBe(true);
  });
});
