/**
 * The W605 fail-loud validation battery: every structural malformation
 * throws the typed {@link SceneEvaluationError} with its machine-readable
 * code and JSON path — never a silent skip, never a crash. Correctness
 * matters (wrong claims) are NEVER validated here — they are measured
 * (`test/detection.test.ts`).
 */
import { describe, expect, test } from "bun:test";
import {
  buildCleanMatchFixture,
  buildDirectedReviewFixture,
  evaluateSceneOutput,
  SceneEvaluationError,
  validateEvaluationInput,
} from "../src/index";
import type { SceneEvaluationErrorCode, SceneEvaluationFixture } from "../src/index";

const clean = buildCleanMatchFixture();
const directed = buildDirectedReviewFixture();

// --- mutation-friendly structural views -------------------------------------

interface TestInterpolation {
  kind?: string;
  fromStepIndex?: number;
  toStepIndex?: number;
  fromAtMs?: number;
  toAtMs?: number;
  fraction?: number;
  sceneCut?: boolean;
}

interface TestEntity {
  entityId: string;
  kind?: string;
  heldReason?: string;
  [key: string]: unknown;
}

interface TestFrame {
  frameIndex: number;
  outputTimestampMs: number;
  windowMs: { startMs: number; endMs: number };
  interpolation?: TestInterpolation;
  entities: TestEntity[];
  [key: string]: unknown;
}

interface TestManifest {
  frames: TestFrame[];
  camera?: Record<string, unknown>;
  output?: Record<string, unknown>;
  skippedMarkers?: Array<Record<string, unknown>>;
  renderer: Record<string, unknown>;
  [key: string]: unknown;
}

interface TestDirectedManifest extends TestManifest {
  windows: Array<Record<string, unknown>>;
  director: Record<string, unknown>;
}

/** The (mutable) manifest of an input's output. */
function manifestOf(input: SceneEvaluationFixture): TestManifest {
  return structuredClone(input.output).manifest as unknown as TestManifest;
}

/** Rebuilds an input with a mutated manifest (type-loose: mutations malform). */
function withManifest(input: SceneEvaluationFixture, manifest: TestManifest): unknown {
  return { ...input, output: { ...input.output, manifest } };
}

/** Asserts the typed error (code + path) for a mutated MATCH input. */
function expectTypedError(
  mutate: (input: SceneEvaluationFixture) => unknown,
  code: SceneEvaluationErrorCode,
  path: string,
): void {
  const input = structuredClone(clean);
  const mutated = mutate(input);
  let caught: unknown;
  try {
    validateEvaluationInput(mutated as never);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(SceneEvaluationError);
  const typed = caught as SceneEvaluationError;
  expect(typed.code).toBe(code);
  expect(typed.path).toBe(path);
}

/** Mutates the manifest frames of the (already cloned) input. */
function mutateFrames(
  input: SceneEvaluationFixture,
  mutate: (frames: TestFrame[]) => void,
): unknown {
  const manifest = manifestOf(input);
  mutate(manifest.frames);
  return withManifest(input, manifest);
}

describe("snapshots (the ground-truth layer)", () => {
  test("not an array", () => {
    expectTypedError((input) => ({ ...input, snapshots: {} }), "snapshot-malformed", "$.snapshots");
  });

  test("empty", () => {
    expectTypedError((input) => ({ ...input, snapshots: [] }), "snapshot-malformed", "$.snapshots");
  });

  test("a document that fails the frozen schema", () => {
    expectTypedError(
      (input) => ({
        ...input,
        snapshots: [{ ...input.snapshots[0]!, watermark: "nope" }],
      }),
      "snapshot-malformed",
      "$.snapshots[0]",
    );
  });

  test("mixed sessions", () => {
    expectTypedError(
      (input) => ({
        ...input,
        snapshots: input.snapshots.map((snapshot, index) =>
          index === 1 ? { ...snapshot, sessionId: "sess-other" } : snapshot,
        ),
      }),
      "snapshot-malformed",
      "$.snapshots[1].sessionId",
    );
  });

  test("non-monotone watermark sequences", () => {
    expectTypedError(
      (input) => ({
        ...input,
        snapshots: input.snapshots.map((snapshot, index) =>
          index === 1
            ? { ...snapshot, watermark: { ...snapshot.watermark, sequence: 0 } }
            : snapshot,
        ),
      }),
      "snapshot-malformed",
      "$.snapshots[1].watermark.sequence",
    );
  });
});

describe("event stream (the ordering ground truth)", () => {
  test("not an array", () => {
    expectTypedError(
      (input) => ({ ...input, eventStream: null }),
      "event-stream-malformed",
      "$.eventStream",
    );
  });

  test("a document that fails the frozen schema", () => {
    expectTypedError(
      (input) => ({ ...input, eventStream: [{ ...input.eventStream[0]!, sequence: -1 }] }),
      "event-stream-malformed",
      "$.eventStream[0]",
    );
  });

  test("non-increasing sequences (not log order)", () => {
    expectTypedError(
      (input) => ({ ...input, eventStream: [...input.eventStream].reverse() }),
      "event-stream-malformed",
      "$.eventStream[1].sequence",
    );
  });
});

describe("steps (the render's own input)", () => {
  test("empty", () => {
    expectTypedError((input) => ({ ...input, steps: [] }), "step-malformed", "$.steps");
  });

  test("non-increasing atMs", () => {
    expectTypedError(
      (input) => ({
        ...input,
        steps: input.steps.map((step, index) => (index === 1 ? { ...step, atMs: 500 } : step)),
      }),
      "step-malformed",
      "$.steps[1].atMs",
    );
  });

  test("sceneCutBefore must be a boolean when present", () => {
    expectTypedError(
      (input) => ({
        ...input,
        steps: input.steps.map((step, index) =>
          index === 1 ? { ...step, sceneCutBefore: "yes" } : step,
        ),
      }),
      "step-malformed",
      "$.steps[1].sceneCutBefore",
    );
  });

  test("a scene that fails the W601 schema", () => {
    expectTypedError(
      (input) => ({
        ...input,
        steps: input.steps.map((step, index) =>
          index === 1 ? { ...step, scene: { ...step.scene, sessionId: "" } } : step,
        ),
      }),
      "step-malformed",
      "$.steps[1].scene",
    );
  });
});

describe("output envelope", () => {
  test("null output", () => {
    expectTypedError((input) => ({ ...input, output: null }), "output-malformed", "$.output");
  });

  test("manifest not a record", () => {
    expectTypedError(
      (input) => ({ ...input, output: { ...input.output, manifest: 7 } }),
      "output-malformed",
      "$.output.manifest",
    );
  });

  test("empty frames array", () => {
    expectTypedError(
      (input) => {
        const manifest = manifestOf(input);
        manifest.frames = [];
        return withManifest(input, manifest);
      },
      "output-malformed",
      "$.output.manifest.frames",
    );
  });

  test("result not a record", () => {
    expectTypedError(
      (input) => ({ ...input, output: { ...input.output, result: null } }),
      "output-malformed",
      "$.output.result",
    );
  });

  test("result.sessionId mismatch", () => {
    expectTypedError(
      (input) => ({
        ...input,
        output: {
          ...input.output,
          result: { ...input.output.result, sessionId: "sess-other" },
        },
      }),
      "alignment-malformed",
      "$.output.result.sessionId",
    );
  });

  test("frames/documents count divergence (the 1:1 contract)", () => {
    expectTypedError(
      (input) => ({
        ...input,
        output: { ...input.output, frames: input.output.frames.slice(1) },
      }),
      "output-malformed",
      "$.output.frames",
    );
  });
});

describe("frame entries (the vocabularies and invariants)", () => {
  test("non-contiguous frameIndex", () => {
    expectTypedError(
      (input) =>
        mutateFrames(input, (frames) => {
          frames[2]!.frameIndex = 9;
        }),
      "frame-malformed",
      "$.output.manifest.frames[2].frameIndex",
    );
  });

  test("non-increasing outputTimestampMs", () => {
    expectTypedError(
      (input) =>
        mutateFrames(input, (frames) => {
          frames[3]!.outputTimestampMs = 100;
          frames[3]!.windowMs = { startMs: 100, endMs: 400 };
        }),
      "frame-malformed",
      "$.output.manifest.frames[3].outputTimestampMs",
    );
  });

  test("a windowMs that does not start at the frame's own timestamp", () => {
    expectTypedError(
      (input) =>
        mutateFrames(input, (frames) => {
          frames[1]!.windowMs = { startMs: 999, endMs: 1_400 };
        }),
      "frame-malformed",
      "$.output.manifest.frames[1].windowMs.startMs",
    );
  });

  test("missing interpolation block", () => {
    expectTypedError(
      (input) =>
        mutateFrames(input, (frames) => {
          delete frames[1]!.interpolation;
        }),
      "frame-malformed",
      "$.output.manifest.frames[1].interpolation",
    );
  });

  test("interpolated frame with fraction 0", () => {
    expectTypedError(
      (input) =>
        mutateFrames(input, (frames) => {
          frames[1]!.interpolation!.fraction = 0;
        }),
      "frame-malformed",
      "$.output.manifest.frames[1].interpolation.fraction",
    );
  });

  test("observed frame claiming sceneCut", () => {
    expectTypedError(
      (input) =>
        mutateFrames(input, (frames) => {
          frames[0]!.interpolation!.sceneCut = true;
        }),
      "frame-malformed",
      "$.output.manifest.frames[0].interpolation.sceneCut",
    );
  });

  test("toStepIndex without toAtMs (a half bracketing pair)", () => {
    expectTypedError(
      (input) =>
        mutateFrames(input, (frames) => {
          delete frames[1]!.interpolation!.toAtMs;
        }),
      "frame-malformed",
      "$.output.manifest.frames[1].interpolation",
    );
  });

  test("heldReason without positionProvenance", () => {
    expectTypedError(
      (input) =>
        mutateFrames(input, (frames) => {
          frames[0]!.entities[0]!.heldReason = "scene-cut";
        }),
      "frame-malformed",
      "$.output.manifest.frames[0].entities[0].heldReason",
    );
  });

  test("an entity kind outside the closed vocabulary", () => {
    expectTypedError(
      (input) =>
        mutateFrames(input, (frames) => {
          frames[0]!.entities[0]!.kind = "spaceship";
        }),
      "frame-malformed",
      "$.output.manifest.frames[0].entities[0].kind",
    );
  });

  test("REGRESSION: a team-kind entity is legal renderer output (the audit fix)", () => {
    // The inherited WIP's partial 3-kind mirror once false-rejected real
    // renderer output carrying non-avatar entities. The contracts' FULL
    // eight-kind vocabulary must pass validation — the entity is then
    // MEASURED as a scene defect (the entity-set check), never rejected.
    const input = structuredClone(clean);
    const manifest = manifestOf(input);
    manifest.frames[0]!.entities.push({
      entityId: "team-home",
      kind: "team",
      version: 1,
      lastEventTimeMs: 1_000,
      sceneDisposition: "not-projected-kind",
      renderDisposition: "not-rendered-kind",
      headingCarried: false,
      styleKind: "none",
    });
    const mutated = withManifest(input, manifest) as SceneEvaluationFixture;
    expect(() => validateEvaluationInput(mutated)).not.toThrow();
    const report = evaluateSceneOutput(mutated);
    expect(report.verdict.pass).toBe(false);
    expect(report.sceneState.frameEntitySetMismatchCount).toBeGreaterThan(0);
  });
});

describe("alignment (the steps ↔ frames contract)", () => {
  test("snapshot count != step count", () => {
    expectTypedError(
      (input) => ({ ...input, snapshots: input.snapshots.slice(1) }),
      "alignment-malformed",
      "$.snapshots",
    );
  });

  test("a snapshot captured after its step time", () => {
    expectTypedError(
      (input) => ({
        ...input,
        snapshots: input.snapshots.map((snapshot, index) =>
          index === 1
            ? { ...snapshot, watermark: { ...snapshot.watermark, watermarkMs: 9_999 } }
            : snapshot,
        ),
      }),
      "alignment-malformed",
      "$.snapshots[1].watermark.watermarkMs",
    );
  });

  test("a fromAtMs that is not any step's atMs", () => {
    expectTypedError(
      (input) =>
        mutateFrames(input, (frames) => {
          frames[1]!.interpolation!.fromAtMs = 1_234;
        }),
      "alignment-malformed",
      "$.output.manifest.frames[1].entry.interpolation.fromAtMs",
    );
  });

  test("a slot in force that the from-step's scene does not carry", () => {
    expectTypedError(
      (input) => {
        const manifest = manifestOf(input);
        manifest.camera = { ...manifest.camera, slotId: "nose-cam" };
        return withManifest(input, manifest);
      },
      "alignment-malformed",
      "$.output.manifest.frames[0]",
    );
  });
});

describe("match-mode manifest blocks", () => {
  test("a camera block without position", () => {
    expectTypedError(
      (input) => {
        const manifest = manifestOf(input);
        manifest.camera = {
          slotId: "main-touchline",
          target: { x: 52.5, y: 34, z: 1.22 },
          focalPx: 512,
          nearPlaneMeters: 0.5,
        };
        return withManifest(input, manifest);
      },
      "output-malformed",
      "$.output.manifest.camera.position",
    );
  });

  test("a zero frame interval is not a frame plan", () => {
    expectTypedError(
      (input) => {
        const manifest = manifestOf(input);
        manifest.output = { ...manifest.output, frameIntervalMs: 0 };
        return withManifest(input, manifest);
      },
      "output-malformed",
      "$.output.manifest.output.frameIntervalMs",
    );
  });

  test("a malformed skippedMarkers list", () => {
    expectTypedError(
      (input) => {
        const manifest = manifestOf(input);
        manifest.skippedMarkers = [{ sequence: 1, eventTimeMs: 100, reason: "mid-window" }];
        return withManifest(input, manifest);
      },
      "output-malformed",
      "$.output.manifest.skippedMarkers[0].reason",
    );
  });
});

describe("the directed wrapper", () => {
  /** Asserts a typed error for a mutated DIRECTED input. */
  function expectDirectedError(
    mutate: (manifest: TestDirectedManifest, input: SceneEvaluationFixture) => unknown,
    code: SceneEvaluationErrorCode,
    path: string,
  ): void {
    const input = structuredClone(directed.input);
    const manifest = manifestOf(input) as unknown as TestDirectedManifest;
    const mutated = mutate(manifest, input);
    let caught: unknown;
    try {
      validateEvaluationInput(mutated as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SceneEvaluationError);
    const typed = caught as SceneEvaluationError;
    expect(typed.code).toBe(code);
    expect(typed.path).toBe(path);
  }

  test("a window index gap", () => {
    expectDirectedError(
      (manifest, input) => {
        manifest.windows[2]!.index = 5;
        return withManifest(input, manifest);
      },
      "window-malformed",
      "$.output.manifest.windows[2].index",
    );
  });

  test("window boundaries that are not step atMs values", () => {
    expectDirectedError(
      (manifest, input) => {
        manifest.windows[1]!.source = { startMs: 3_100, endMs: 4_000 };
        return withManifest(input, manifest);
      },
      "window-malformed",
      "$.output.manifest.windows[1].source",
    );
  });

  test("a frame whose windowIndex is out of range", () => {
    expectDirectedError(
      (manifest, input) => {
        (manifest.frames[0]! as unknown as { windowIndex: number }).windowIndex = 99;
        return withManifest(input, manifest);
      },
      "window-malformed",
      "$.output.manifest.frames[0].windowIndex",
    );
  });

  test("a window that realized no frames", () => {
    expectDirectedError(
      (manifest, input) => {
        for (const frame of manifest.frames) {
          if ((frame as unknown as { windowIndex: number }).windowIndex === 1) {
            (frame as unknown as { windowIndex: number }).windowIndex = 0;
          }
        }
        return withManifest(input, manifest);
      },
      "window-malformed",
      "$.output.manifest.windows[1]",
    );
  });

  test("a window camera block without focalPx", () => {
    expectDirectedError(
      (manifest, input) => {
        delete (manifest.windows[0]!.camera as Record<string, unknown>).focalPx;
        return withManifest(input, manifest);
      },
      "output-malformed",
      "$.output.manifest.windows[0].camera.focalPx",
    );
  });

  test("a malformed director provenance block", () => {
    expectDirectedError(
      (manifest, input) => {
        manifest.director = { ...manifest.director, windowCount: "many" };
        return withManifest(input, manifest);
      },
      "output-malformed",
      "$.output.manifest.director.windowCount",
    );
  });

  test("a skipped marker whose windowIndex is out of range", () => {
    expectDirectedError(
      (manifest, input) => {
        manifest.skippedMarkers![0]!.windowIndex = 42;
        return withManifest(input, manifest);
      },
      "output-malformed",
      "$.output.manifest.skippedMarkers[0].windowIndex",
    );
  });
});

describe("the caller-supplied plan", () => {
  test("a plan with a match output is a typed input error", () => {
    const input = structuredClone(clean);
    let caught: unknown;
    try {
      validateEvaluationInput({ ...input, plan: directed.plan } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SceneEvaluationError);
    expect((caught as SceneEvaluationError).code).toBe("input-malformed");
    expect((caught as SceneEvaluationError).path).toBe("$.plan");
  });

  test("a garbage plan throws instead of silently skipping its checks", () => {
    const input = structuredClone(directed.input);
    let caught: unknown;
    try {
      validateEvaluationInput({
        ...input,
        plan: {
          directorVersion: "camera-director@1",
          policy: { policyId: "broadcast-classic", policyVersion: "camera-director.policy@1" },
          timeline: { startMs: 1_000, endMs: 8_000 },
          windows: "nope",
        },
      } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SceneEvaluationError);
    expect((caught as SceneEvaluationError).code).toBe("input-malformed");
    expect((caught as SceneEvaluationError).path).toBe("$.plan.windows");
  });

  test("a plan window without a decision record throws", () => {
    const input = structuredClone(directed.input);
    const plan = structuredClone(directed.plan);
    (plan.windows[0]! as unknown as { decision?: unknown }).decision = undefined;
    let caught: unknown;
    try {
      validateEvaluationInput({ ...input, plan });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SceneEvaluationError);
    expect((caught as SceneEvaluationError).path).toBe("$.plan.windows[0].decision");
  });
});
