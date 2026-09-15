/**
 * THE frame-expectation core (layer 2): for every rendered frame, the
 * AUTHORITATIVE scene the frame must present — computed through the
 * renderer's OWN public seams (never re-implemented):
 *
 * - an OBSERVED frame (its timestamp sits exactly on its step's `atMs`)
 *   presents that step's spec VERBATIM;
 * - an INTERPOLATED frame presents the REAL motion model's output:
 *   `interpolateMatchFrame({ from, to, fraction, spanMs })` — the same
 *   exported function the renderer calls (positions AND the per-entity
 *   provenance/held-reason decisions);
 * - a HELD frame (a declared scene cut governs the segment) presents the
 *   from-spec VERBATIM with every entity held, reason `"scene-cut"`.
 *
 * The frame's CLAIMED surfaces (the status line, the camera label, the
 * style tokens) are likewise derived through the renderer's own exported
 * presentation functions (`statusLine`, `cameraLabel`,
 * `stableAvatarStyle`) over the expected scene — so a comparison is
 * "rendered vs what the SWM timeline says", both sides through real seams.
 */
import {
  cameraLabel,
  interpolateMatchFrame,
  sceneCutHeldProvenance,
  stableAvatarStyle,
  statusLine,
} from "@sporta/renderer-3d";
import type {
  AvatarField3dManifest,
  AvatarField3dMatchStep,
  MatchEntityProvenanceEntry,
  Render3dFrameEntry,
} from "@sporta/renderer-3d";
import type { SceneEntity, SceneSpecification } from "@sporta/scene-projection";
import type { DirectedRenderManifest } from "@sporta/camera-director";
import type { EvalFrame, ValidatedSceneEvaluationInput } from "./validate";
import { SceneEvaluationError } from "./errors";

/** The per-frame expectation: the scene + provenance + claim surfaces. */
export interface FrameExpectation {
  /** The authoritative (from) step index. */
  fromStepIndex: number;
  /** The bracketing to-step index, when the segment has one. */
  toStepIndex: number | undefined;
  /** The scene the frame must present. */
  scene: SceneSpecification;
  /**
   * The per-entity position provenance the frame must record
   * (`interpolated`, or `held` with its reason — the REAL decisions from
   * the motion model; undefined on observed frames).
   */
  entityProvenance: readonly MatchEntityProvenanceEntry[] | undefined;
  /** The status line the frame's HUD must carry (null when no football state). */
  expectedStatusLine: string | null;
  /** The camera label the frame's HUD must carry. */
  expectedCameraLabel: string;
  /** The expected style key (`"<rendererId>:<rendererVersion>"`, the documented derivation). */
  styleKey: string;
}

/** Computes the expected style token for one entity (the real function). */
export function expectedStyleToken(styleKey: string, entityId: string) {
  return stableAvatarStyle(styleKey, entityId);
}

/**
 * Computes one frame's expectation through the real seams. Pure; throws
 * `SceneEvaluationError` (alignment) when the frame's interpolation block
 * does not resolve against the steps (defense in depth — validate.ts
 * already checked resolvability).
 */
export function frameExpectation(
  input: ValidatedSceneEvaluationInput,
  frame: EvalFrame,
): FrameExpectation {
  const steps: readonly AvatarField3dMatchStep[] = input.steps;
  const entry: Render3dFrameEntry = frame.entry;
  const interpolation = entry.interpolation!;
  const fromStepIndex = input.stepIndexByAtMs.get(interpolation.fromAtMs);
  if (fromStepIndex === undefined) {
    throw new SceneEvaluationError(
      "alignment-malformed",
      `$.output.manifest.frames[${frame.frameIndex}].entry.interpolation.fromAtMs`,
      `${interpolation.fromAtMs} is not any step's atMs`,
    );
  }
  const fromStep = steps[fromStepIndex]!;
  if (interpolation.fromAtMs !== fromStep.atMs) {
    throw new SceneEvaluationError(
      "alignment-malformed",
      `$.output.manifest.frames[${frame.frameIndex}].entry.interpolation.fromAtMs`,
      `${interpolation.fromAtMs} does not equal step ${fromStepIndex}'s atMs`,
    );
  }
  const toStepIndex =
    interpolation.toStepIndex !== undefined
      ? (input.stepIndexByAtMs.get(interpolation.toAtMs) as number)
      : undefined;
  if (toStepIndex !== undefined && toStepIndex !== fromStepIndex + 1) {
    throw new SceneEvaluationError(
      "alignment-malformed",
      `$.output.manifest.frames[${frame.frameIndex}].entry.interpolation.toStepIndex`,
      `the bracketing step must be the from-step's immediate successor (from ${fromStepIndex}, to ${toStepIndex})`,
    );
  }

  const renderer = input.manifest.renderer;
  const styleKey = `${renderer.rendererId}:${renderer.rendererVersion}`;
  let scene: SceneSpecification;
  let entityProvenance: readonly MatchEntityProvenanceEntry[] | undefined;
  if (interpolation.kind === "interpolated") {
    if (toStepIndex === undefined || interpolation.toAtMs === undefined) {
      throw new SceneEvaluationError(
        "alignment-malformed",
        `$.output.manifest.frames[${frame.frameIndex}].entry.interpolation`,
        "an interpolated frame must carry its bracketing to-step",
      );
    }
    const interpolated = interpolateMatchFrame({
      from: fromStep.scene,
      to: steps[toStepIndex]!.scene,
      fraction: interpolation.fraction,
      spanMs: interpolation.toAtMs - interpolation.fromAtMs,
    });
    scene = interpolated.scene;
    entityProvenance = interpolated.entities;
  } else if (interpolation.kind === "held") {
    scene = fromStep.scene;
    entityProvenance = sceneCutHeldProvenance(fromStep.scene);
  } else {
    scene = fromStep.scene;
    entityProvenance = undefined;
  }

  const expectedCameraSlotId =
    frame.windowSlotId ??
    (input.manifest as AvatarField3dManifest).camera.slotId;
  return {
    fromStepIndex,
    toStepIndex,
    scene,
    entityProvenance,
    expectedStatusLine: statusLine(scene.scoreClock) ?? null,
    expectedCameraLabel: cameraLabel(expectedCameraSlotId),
    styleKey,
  };
}

/** The expected style-kind for one expected scene entity (documented mapping). */
export function expectedStyleKind(entity: SceneEntity): "identity" | "official-fixed" | "ball-fixed" | "none" {
  if (
    entity.disposition !== "projected" &&
    entity.disposition !== "projected-out-of-bounds"
  ) {
    return "none";
  }
  if (entity.kind === "ball") return "ball-fixed";
  if (entity.kind === "official") return "official-fixed";
  return "identity";
}

/**
 * The directed manifest's windows when the input is a directed rundown
 * (typed accessor; null in match mode).
 */
export function directedWindows(
  manifest: AvatarField3dManifest | DirectedRenderManifest,
): DirectedRenderManifest["windows"] | null {
  return Array.isArray((manifest as DirectedRenderManifest).windows)
    ? (manifest as DirectedRenderManifest).windows
    : null;
}
