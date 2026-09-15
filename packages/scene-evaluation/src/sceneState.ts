/**
 * The SCENE STATE CORRECTNESS dimension (W605 deliverable 5): dispositions
 * accounted per the W603 vocabulary, positions never invented — inferred
 * frames carry pair+fraction, held frames carry heldReason, ball z only
 * when carried, possession consistent, camera slots consistent with the
 * plan's directed slots (the slot half lives in `./direction.ts`).
 *
 * The expectation is derived through the renderer's OWN public seams —
 * never re-implemented:
 *
 * - the frame's authoritative scene comes from `./expected.ts` (the
 *   from-step verbatim, or `interpolateMatchFrame` for interpolated frames,
 *   or the from-step verbatim with scene-cut provenance for held frames);
 * - the expected per-entity manifest entries are `resolve3dFrame`'s own
 *   output over that scene at the frame's slot and canvas — the SAME
 *   exported function the renderer calls (`@sporta/renderer-3d`); a
 *   rendered entry that drifts from it in ANY field (disposition, TRUE
 *   position, screen position, depth, height-carried, heading, confidence,
 *   style token, kind, version) is a measured defect;
 * - the expected position provenance is the real motion model's decision
 *   (`interpolateMatchFrame`'s / `sceneCutHeldProvenance`'s own output):
 *   every interpolated position must be marked INFERRED, every held one
 *   must carry the right reason, and observed frames must carry none.
 *
 * The frame-level interpolation claims are checked too (the W603 frame
 * plan contract): an observed frame sits exactly on its step's `atMs`, an
 * interpolated frame's match-timeline position equals
 * `fromAtMs + fraction × (toAtMs − fromAtMs)` within the documented
 * numerical headroom, and the recorded (run-relative) step indexes resolve
 * through the window base to the recorded atMs values (the pair is real).
 */
import { resolve3dFrame } from "@sporta/renderer-3d";
import type { MatchEntityProvenanceEntry, Render3dEntityEntry } from "@sporta/renderer-3d";
import type { DirectedRenderManifest } from "@sporta/camera-director";
import type { EvalFrame, ValidatedSceneEvaluationInput } from "./validate";
import type { FrameExpectation } from "./expected";
import type { FindingSink } from "./findings";
import { frameFinding } from "./findings";
import { deepEqualJson, describeValue } from "./internal";

/**
 * The numerical headroom for the interpolated-timestamp re-derivation:
 * the renderer's frame times are pure arithmetic (`t₀ + j·interval`) and
 * the fraction is `(frameMs − fromMs) / span`, so re-deriving
 * `fromAtMs + fraction × span` can differ from the recorded timestamp by
 * floating-point rounding only. 1e-6 ms is four orders below the smallest
 * honest cadence step (1 ms) — a tampered timestamp is off by whole
 * milliseconds, never by rounding (the W503 POSITION_EPSILON posture:
 * numerical headroom, never a semantic tolerance).
 */
export const INTERPOLATION_TIME_EPSILON_MS = 1e-6;

/** The scene-state dimension's measured metrics. */
export interface SceneStateMetrics {
  /** Frames whose interpolation claim contradicts the W603 frame-plan contract. */
  frameInterpolationMismatchCount: number;
  /** Frames whose recorded (run-relative) step pair does not resolve to the recorded atMs values. */
  interpolationIndexMismatchCount: number;
  /** Frames whose rendered entity id set ≠ the expected scene's (invented or dropped). */
  frameEntitySetMismatchCount: number;
  /** (frame, entity) pairs whose rendered entry ≠ the resolve3dFrame expectation (any field). */
  frameEntityStateMismatchCount: number;
  /** (frame, entity) pairs whose scene or render disposition is wrong. */
  dispositionMismatchCount: number;
  /** (frame, entity) pairs whose TRUE position is wrong (positions are never invented). */
  positionMismatchCount: number;
  /** (frame, entity) pairs whose position provenance/held reason is wrong. */
  provenanceMismatchCount: number;
  /** Ball (frame) pairs whose z / heightCarried is wrong (z only when carried). */
  ballHeightMismatchCount: number;
  /** Frames whose possession accounting ≠ the resolve3dFrame expectation. */
  possessionMismatchCount: number;
  /** (frame, entity) pairs compared (evidence). */
  entityFrameCount: number;
  /** Frames checked (evidence). */
  frameCount: number;
}

/** The window base step index for a frame (run-relative → global index resolution). */
function windowBaseStepIndex(input: ValidatedSceneEvaluationInput, frame: EvalFrame): number {
  if (input.mode === "match") return 0;
  const manifest = input.manifest as DirectedRenderManifest;
  const window = manifest.windows[frame.windowIndex!]!;
  const base = input.stepIndexByAtMs.get(window.source.startMs);
  if (base === undefined) {
    throw new Error(
      `sceneState: window ${window.index}'s source.startMs ${window.source.startMs} is not a step's atMs (validate should have caught this)`,
    );
  }
  return base;
}

/**
 * Applies the expected provenance to the expected manifest entries — the
 * renderer's own overlay rule (`render.ts` `applyEntityProvenance`,
 * replicated here because it is module-private): the motion model's
 * per-entity decision over `resolve3dFrame`'s entries. The parameter is the
 * REAL renderer type, so a provenance-shape drift fails typecheck.
 */
function applyExpectedProvenance(
  entries: readonly Render3dEntityEntry[],
  provenance: readonly MatchEntityProvenanceEntry[] | undefined,
): Render3dEntityEntry[] {
  if (provenance === undefined) return [...entries];
  const byId = new Map(provenance.map((entry) => [entry.entityId, entry.provenance] as const));
  return entries.map((entry) => {
    const mark = byId.get(entry.entityId);
    if (mark === undefined) return entry;
    return {
      ...entry,
      positionProvenance: mark.positionProvenance,
      ...(mark.positionProvenance === "held" ? { heldReason: mark.heldReason } : {}),
    };
  });
}

/**
 * EVERY field of {@link Render3dEntityEntry}, in fixed documented order — a
 * rendered entry that drifts from the expectation in ANY field is a
 * measured defect (the module docblock's contract; the named sub-counts
 * below classify the field classes a defect falls into).
 */
const ENTITY_FIELDS: readonly (keyof Render3dEntityEntry)[] = [
  "entityId",
  "kind",
  "version",
  "lastEventTimeMs",
  "sceneDisposition",
  "renderDisposition",
  "positionMeters",
  "positionProvenance",
  "heldReason",
  "screenPosition",
  "depthMeters",
  "heightCarried",
  "headingCarried",
  "headingRadians",
  "positionStatus",
  "positionConfidence",
  "style",
  "styleKind",
];

/**
 * Measures the scene-state dimension over every frame. Pure; every defect
 * is a counted finding with its frame/entity coordinates and the expected
 * vs actual (bounded) evidence.
 */
export function measureSceneState(options: {
  input: ValidatedSceneEvaluationInput;
  frames: readonly EvalFrame[];
  expectations: readonly FrameExpectation[];
  findings: FindingSink;
}): SceneStateMetrics {
  const { input, frames, expectations, findings } = options;

  let frameInterpolationMismatchCount = 0;
  let interpolationIndexMismatchCount = 0;
  let frameEntitySetMismatchCount = 0;
  let frameEntityStateMismatchCount = 0;
  let dispositionMismatchCount = 0;
  let positionMismatchCount = 0;
  let provenanceMismatchCount = 0;
  let ballHeightMismatchCount = 0;
  let possessionMismatchCount = 0;
  let entityFrameCount = 0;

  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i]!;
    const expectation = expectations[i]!;
    const interpolation = frame.entry.interpolation!;

    // --- The frame's interpolation claims (the W603 frame-plan contract).
    const framePath = `$.output.manifest.frames[${frame.frameIndex}]`;
    let interpolationClaimOk = true;
    if (interpolation.kind === "observed") {
      interpolationClaimOk = frame.matchTimestampMs === interpolation.fromAtMs;
    } else if (interpolation.kind === "interpolated") {
      const span = interpolation.toAtMs! - interpolation.fromAtMs;
      const derived = interpolation.fromAtMs + interpolation.fraction * span;
      interpolationClaimOk = Math.abs(derived - frame.matchTimestampMs) <= INTERPOLATION_TIME_EPSILON_MS;
    } else {
      // A held frame is strictly between its from and to steps (the cut
      // pair); its scene is the from-step's verbatim.
      interpolationClaimOk =
        frame.matchTimestampMs > interpolation.fromAtMs &&
        frame.matchTimestampMs < (interpolation.toAtMs ?? Number.POSITIVE_INFINITY);
    }
    if (!interpolationClaimOk) {
      frameInterpolationMismatchCount += 1;
      findings.push(
        frameFinding(frame, {
          dimension: "scene-state",
          metric: "sceneState.frameInterpolationMismatchCount",
          path: `${framePath}.entry.interpolation`,
          expected: describeValue({
            kind: interpolation.kind,
            fromAtMs: interpolation.fromAtMs,
            toAtMs: interpolation.toAtMs,
            fraction: interpolation.fraction,
          }),
          actual: describeValue(frame.matchTimestampMs),
        }),
      );
    }

    // --- The recorded (run-relative) step pair resolves through the
    // window base to the recorded atMs values (the pair is real).
    const base = windowBaseStepIndex(input, frame);
    const globalFrom = base + interpolation.fromStepIndex;
    const fromAtMsOk =
      input.steps[globalFrom] !== undefined &&
      input.steps[globalFrom]!.atMs === interpolation.fromAtMs;
    const toAtMsOk =
      interpolation.toStepIndex === undefined ||
      (input.steps[base + interpolation.toStepIndex] !== undefined &&
        input.steps[base + interpolation.toStepIndex]!.atMs === interpolation.toAtMs);
    if (!fromAtMsOk || !toAtMsOk) {
      interpolationIndexMismatchCount += 1;
      findings.push(
        frameFinding(frame, {
          dimension: "scene-state",
          metric: "sceneState.interpolationIndexMismatchCount",
          path: `${framePath}.entry.interpolation.fromStepIndex`,
          expected: describeValue({
            fromStepIndex: input.stepIndexByAtMs.get(interpolation.fromAtMs),
            toStepIndex: interpolation.toAtMs === undefined ? undefined : input.stepIndexByAtMs.get(interpolation.toAtMs),
          }),
          actual: describeValue({
            fromStepIndex: interpolation.fromStepIndex,
            toStepIndex: interpolation.toStepIndex,
          }),
        }),
      );
    }

    // --- The expected entity entries: the renderer's own resolve3dFrame
    // over the expected scene, at the frame's slot and canvas.
    const slot =
      expectation.scene.cameraSlots.find(
        (candidate) => candidate.slotId === expectation.expectedCameraSlotId,
      ) ?? undefined;
    if (slot === undefined) {
      throw new Error(
        `sceneState: frame ${frame.frameIndex}'s slot ${expectation.expectedCameraSlotId} is not carried by its expected scene (validate should have caught this)`,
      );
    }
    const profile = directedProfileOf(input, frame);
    const resolved = resolve3dFrame({
      scene: expectation.scene,
      cameraSlot: slot,
      canvas: { width: profile.w, height: profile.h },
    });
    const expectedEntities = applyExpectedProvenance(resolved.manifestEntities, expectation.entityProvenance);

    // The entity id set: never invented, never dropped.
    const expectedIds = expectedEntities.map((entry) => entry.entityId);
    const actualIds = frame.entry.entities.map((entry) => entry.entityId);
    if (!deepEqualJson(expectedIds, actualIds)) {
      frameEntitySetMismatchCount += 1;
      findings.push(
        frameFinding(frame, {
          dimension: "scene-state",
          metric: "sceneState.frameEntitySetMismatchCount",
          path: `${framePath}.entry.entities`,
          expected: describeValue(expectedIds),
          actual: describeValue(actualIds),
        }),
      );
    }

    // Field-wise comparison (index-aligned; the id-set check above catches
    // divergence in the ids themselves).
    for (let e = 0; e < Math.min(expectedEntities.length, frame.entry.entities.length); e += 1) {
      const expected = expectedEntities[e]!;
      const actual = frame.entry.entities[e]!;
      entityFrameCount += 1;
      const mismatchedFields: string[] = [];
      for (const field of ENTITY_FIELDS) {
        if (!deepEqualJson(expected[field], actual[field])) {
          mismatchedFields.push(String(field));
          if (field === "sceneDisposition" || field === "renderDisposition") {
            dispositionMismatchCount += 1;
          }
          if (field === "positionMeters") {
            positionMismatchCount += 1;
            // The ball's z specifically (its carried height — the only
            // entity whose z is ever more than a frame constant): a z-only
            // drift is a height-accounting defect even when x/y match.
            if (
              actual.kind === "ball" &&
              !deepEqualJson(expected.positionMeters?.z, actual.positionMeters?.z)
            ) {
              ballHeightMismatchCount += 1;
              mismatchedFields.push("positionMeters.z");
            }
          }
          if (field === "positionProvenance" || field === "heldReason") {
            provenanceMismatchCount += 1;
          }
          if (field === "heightCarried" && actual.kind === "ball") {
            ballHeightMismatchCount += 1;
          }
        }
      }
      if (mismatchedFields.length > 0) {
        frameEntityStateMismatchCount += 1;
        findings.push(
          frameFinding(frame, {
            dimension: "scene-state",
            metric: "sceneState.frameEntityStateMismatchCount",
            entityId: actual.entityId,
            path: `${framePath}.entry.entities[${e}]`,
            expected: describeValue(
              Object.fromEntries(
                mismatchedFields.map((field) => [
                  field,
                  (expected as unknown as Record<string, unknown>)[field],
                ]),
              ),
            ),
            actual: describeValue(
              Object.fromEntries(
                mismatchedFields.map((field) => [
                  field,
                  (actual as unknown as Record<string, unknown>)[field],
                ]),
              ),
            ),
          }),
        );
      }
    }

    // --- The possession accounting (the renderer's own resolve output).
    if (!deepEqualJson(resolved.possession, frame.entry.possession)) {
      possessionMismatchCount += 1;
      findings.push(
        frameFinding(frame, {
          dimension: "scene-state",
          metric: "sceneState.possessionMismatchCount",
          path: `${framePath}.entry.possession`,
          expected: describeValue(resolved.possession),
          actual: describeValue(frame.entry.possession),
        }),
      );
    }
  }

  return {
    frameInterpolationMismatchCount,
    interpolationIndexMismatchCount,
    frameEntitySetMismatchCount,
    frameEntityStateMismatchCount,
    dispositionMismatchCount,
    positionMismatchCount,
    provenanceMismatchCount,
    ballHeightMismatchCount,
    possessionMismatchCount,
    entityFrameCount,
    frameCount: frames.length,
  };
}

/** The frame's output-profile resolution (the canvas the run rendered at). */
function directedProfileOf(
  input: ValidatedSceneEvaluationInput,
  frame: EvalFrame,
): { w: number; h: number } {
  if (input.mode === "match") {
    const manifest = input.manifest as Exclude<typeof input.manifest, DirectedRenderManifest>;
    return {
      w: manifest.output.profile.resolution.w,
      h: manifest.output.profile.resolution.h,
    };
  }
  const manifest = input.manifest as DirectedRenderManifest;
  const window = manifest.windows[frame.windowIndex!]!;
  return { w: window.outputProfile.resolution.w, h: window.outputProfile.resolution.h };
}
