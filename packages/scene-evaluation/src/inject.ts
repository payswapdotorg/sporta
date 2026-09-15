/**
 * The W605 injected-defect teeth (the W503 `test/detection.test.ts`
 * convention, as reusable pure functions): every injector perturbs EXACTLY
 * ONE defect class in a cloned render output, keeping the document
 * structurally VALID (the defect is MEASURED, never mistaken for
 * malformation). Each injector:
 *
 * - deep-clones the output — the input is never mutated (pinned by tests);
 * - throws `RangeError` when its target does not exist (a test-authoring
 *   bug, never an evaluation result);
 * - produces a DETERMINISTIC perturbation (same input → same output).
 *
 * The evaluation of a perturbed input must flip the verdict to FAIL with the
 * defect's PRIMARY metric nonzero — `test/detection.test.ts` is the
 * rejection mechanism for any metric that cannot detect its class.
 */
import { MAX_EVENT_CHIPS } from "@sporta/renderer-3d";
import type {
  AvatarField3dManifest,
  AvatarField3dRenderOutput,
  Render3dFrameEntry,
} from "@sporta/renderer-3d";
import type { DirectedRenderManifest, DirectedRenderOutput } from "@sporta/camera-director";
import type { SceneEvaluationInput } from "./report";

/** Any W605-renderable output (the match render or the directed rundown). */
type AnyRenderOutput = AvatarField3dRenderOutput | DirectedRenderOutput;

/** The manifest of an output (either mode). */
function manifestOf(output: AnyRenderOutput): AvatarField3dManifest | DirectedRenderManifest {
  return output.manifest;
}

/** The manifest frame ENTRY at a rundown array index (either mode). */
function frameEntryAt(output: AnyRenderOutput, arrayIndex: number): Render3dFrameEntry {
  const manifest = manifestOf(output);
  const frame = manifest.frames[arrayIndex];
  if (frame === undefined) {
    throw new RangeError(`inject: no manifest frame at array index ${arrayIndex}`);
  }
  return (frame as unknown as { entry: Render3dFrameEntry }).entry ?? (frame as Render3dFrameEntry);
}

/** The directed windows when the output is a rundown (null in match mode). */
function windowsOf(output: AnyRenderOutput): DirectedRenderManifest["windows"] | null {
  const windows = (manifestOf(output) as DirectedRenderManifest).windows;
  return Array.isArray(windows) ? windows : null;
}

/** Clones the input with a deep-cloned output (the original is untouched). */
function withClonedOutput(input: SceneEvaluationInput): {
  input: SceneEvaluationInput;
  output: AnyRenderOutput;
} {
  const output = structuredClone(input.output) as AnyRenderOutput;
  return { input: { ...input, output }, output };
}

/** Re-derives one frame's marker display accounting from its marker list. */
function recomputeMarkerAccounting(entry: Render3dFrameEntry): void {
  let displayed = 0;
  const chips: string[] = [];
  for (const marker of entry.markers) {
    if (displayed < MAX_EVENT_CHIPS) {
      marker.displayed = true;
      chips.push(marker.text);
      displayed += 1;
    } else {
      marker.displayed = false;
    }
  }
  entry.hud.eventChips = chips;
  entry.hud.markersNotDisplayed = entry.markers.length - displayed;
  entry.appliedMarkerSequences = entry.markers.map((marker) => marker.sequence);
}

/**
 * A WRONG SCORE/CLOCK CLAIM: one frame's HUD status line is replaced by
 * another frame's (the combined score+clock claim drifts from the source
 * timeline's state — the score and clock dimensions both measure it).
 */
export function injectWrongScoreClaim(
  input: SceneEvaluationInput,
  options: { frameIndex: number },
): SceneEvaluationInput {
  const { input: cloned, output } = withClonedOutput(input);
  const manifest = manifestOf(output);
  const entry = frameEntryAt(output, options.frameIndex);
  const donorIndex = options.frameIndex === 0 ? manifest.frames.length - 1 : 0;
  const donorEntry = frameEntryAt(output, donorIndex);
  if (donorEntry.hud.statusLine === entry.hud.statusLine) {
    throw new RangeError(
      "injectWrongScoreClaim: the donor frame's status line equals the target's — pick a frame whose claim differs",
    );
  }
  entry.hud.statusLine = donorEntry.hud.statusLine;
  return cloned;
}

/**
 * A STUCK CLOCK: every frame after the first carries the FIRST frame's
 * status line — the displayed clock/score state never advances past the
 * first snapshot's, while the source timeline's does.
 */
export function injectStuckClock(input: SceneEvaluationInput): SceneEvaluationInput {
  const { input: cloned, output } = withClonedOutput(input);
  const manifest = manifestOf(output);
  const stuckLine = frameEntryAt(output, 0).hud.statusLine;
  for (let i = 1; i < manifest.frames.length; i += 1) {
    frameEntryAt(output, i).hud.statusLine = stuckLine;
  }
  return cloned;
}

/**
 * A STYLE TOKEN SWAP: two identity-styled entities exchange their tokens on
 * EVERY frame — each entity is internally "stable", so only the cross-entity
 * match (the swap signature) exposes the exchange.
 */
export function injectSwappedStyleTokens(
  input: SceneEvaluationInput,
  options: { entityA: string; entityB: string },
): SceneEvaluationInput {
  const { input: cloned, output } = withClonedOutput(input);
  const manifest = manifestOf(output);
  let swapped = 0;
  for (let i = 0; i < manifest.frames.length; i += 1) {
    const entry = frameEntryAt(output, i);
    let tokenA: { paletteIndex: number; jersey: string; trim: string } | undefined;
    let tokenB: { paletteIndex: number; jersey: string; trim: string } | undefined;
    for (const entity of entry.entities) {
      if (entity.entityId === options.entityA) tokenA = entity.style;
      if (entity.entityId === options.entityB) tokenB = entity.style;
    }
    if (tokenA === undefined || tokenB === undefined) continue;
    if (
      swapped === 0 &&
      tokenA.paletteIndex === tokenB.paletteIndex &&
      tokenA.jersey === tokenB.jersey &&
      tokenA.trim === tokenB.trim
    ) {
      throw new RangeError(
        `injectSwappedStyleTokens: "${options.entityA}" and "${options.entityB}" carry the SAME palette token (a hash collision) — pick two entities with different tokens`,
      );
    }
    for (const entity of entry.entities) {
      if (entity.entityId === options.entityA) entity.style = tokenB as typeof entity.style;
      if (entity.entityId === options.entityB) entity.style = tokenA as typeof entity.style;
    }
    swapped += 1;
  }
  if (swapped === 0) {
    throw new RangeError(
      `injectSwappedStyleTokens: no frame carries styled tokens for both "${options.entityA}" and "${options.entityB}"`,
    );
  }
  return cloned;
}

/**
 * OUT-OF-ORDER MARKERS: one frame's marker list (and its applied-sequence
 * accounting) is reversed — the displayed markers leave the source (union)
 * order. Pick a frame carrying at least two markers.
 */
export function injectOutOfOrderMarkers(
  input: SceneEvaluationInput,
  options: { frameIndex: number },
): SceneEvaluationInput {
  const { input: cloned, output } = withClonedOutput(input);
  const entry = frameEntryAt(output, options.frameIndex);
  if (entry.markers.length < 2) {
    throw new RangeError(
      `injectOutOfOrderMarkers: frame ${options.frameIndex} carries ${entry.markers.length} markers — pick a frame with at least two`,
    );
  }
  entry.markers.reverse();
  entry.appliedMarkerSequences.reverse();
  recomputeMarkerAccounting(entry);
  return cloned;
}

/**
 * A SCENE-STATE MISMATCH: one entity's TRUE position drifts on one frame —
 * positions are never invented, so any drift is a measured defect.
 */
export function injectSceneStateDrift(
  input: SceneEvaluationInput,
  options: { frameIndex: number; entityId: string; dxMeters: number },
): SceneEvaluationInput {
  const { input: cloned, output } = withClonedOutput(input);
  const entry = frameEntryAt(output, options.frameIndex);
  const entity = entry.entities.find((candidate) => candidate.entityId === options.entityId);
  if (entity === undefined || entity.positionMeters === undefined) {
    throw new RangeError(
      `injectSceneStateDrift: entity "${options.entityId}" has no position on frame ${options.frameIndex}`,
    );
  }
  entity.positionMeters = {
    ...entity.positionMeters,
    x: entity.positionMeters.x + options.dxMeters,
  };
  return cloned;
}

/**
 * A MIS-DIRECTED WINDOW: one directed window's slot id is rewritten to
 * another (valid, carried) slot — the frames' own slot claims, HUD camera
 * labels, realized camera block, and (when the plan is supplied) the plan
 * comparison all diverge.
 */
export function injectMisDirectedWindow(
  input: SceneEvaluationInput,
  options: { windowIndex: number; toSlotId: string },
): SceneEvaluationInput {
  const { input: cloned, output } = withClonedOutput(input);
  const windows = windowsOf(output);
  if (windows === null) {
    throw new RangeError("injectMisDirectedWindow: the output is not a directed rundown");
  }
  const window = windows.find((candidate) => candidate.index === options.windowIndex);
  if (window === undefined) {
    throw new RangeError(`injectMisDirectedWindow: no window with index ${options.windowIndex}`);
  }
  if (window.cameraSlotId === options.toSlotId) {
    throw new RangeError("injectMisDirectedWindow: pick a DIFFERENT slot id");
  }
  window.cameraSlotId = options.toSlotId;
  return cloned;
}

/**
 * A HELD CLAIM WITHOUT A DECLARED CUT: one interpolated frame's
 * interpolation block is rewritten to claim `held` (scene cut) although the
 * bracketing step declares no cut — the W603 frame-plan contract violation
 * the scene-state dimension's claim justification check measures.
 */
export function injectHeldWithoutDeclaredCut(
  input: SceneEvaluationInput,
  options: { frameIndex: number },
): SceneEvaluationInput {
  const { input: cloned, output } = withClonedOutput(input);
  const entry = frameEntryAt(output, options.frameIndex);
  const interpolation = entry.interpolation;
  if (
    interpolation === undefined ||
    interpolation.kind !== "interpolated" ||
    interpolation.toStepIndex === undefined
  ) {
    throw new RangeError(
      `injectHeldWithoutDeclaredCut: frame ${options.frameIndex} is not an interpolated frame with a bracketing step`,
    );
  }
  interpolation.kind = "held";
  interpolation.sceneCut = true;
  interpolation.fraction = 0;
  return cloned;
}

/**
 * A CAMERA BLOCK DRIFT: one directed window's realized camera focal length
 * is tampered — the camera block must be the canonical slot geometry plus
 * the renderer's own constants, exactly.
 */
export function injectCameraBlockDrift(
  input: SceneEvaluationInput,
  options: { windowIndex: number; focalPx: number },
): SceneEvaluationInput {
  const { input: cloned, output } = withClonedOutput(input);
  const windows = windowsOf(output);
  if (windows === null) {
    throw new RangeError("injectCameraBlockDrift: the output is not a directed rundown");
  }
  const window = windows.find((candidate) => candidate.index === options.windowIndex);
  if (window === undefined) {
    throw new RangeError(`injectCameraBlockDrift: no window with index ${options.windowIndex}`);
  }
  window.camera.focalPx = options.focalPx;
  return cloned;
}

/**
 * A SILENTLY DROPPED MARKER: one sequence vanishes from EVERY frame that
 * carried it (the frame-level display accounting is re-derived so the
 * dropping itself is the ONLY defect) — the marker becomes unaccounted
 * (and, when it rode a dropped boundary tail frame, an unaccounted boundary
 * transfer).
 */
export function injectDroppedMarker(
  input: SceneEvaluationInput,
  options: { sequence: number },
): SceneEvaluationInput {
  const { input: cloned, output } = withClonedOutput(input);
  const manifest = manifestOf(output);
  let dropped = 0;
  for (let i = 0; i < manifest.frames.length; i += 1) {
    const entry = frameEntryAt(output, i);
    if (!entry.markers.some((marker) => marker.sequence === options.sequence)) continue;
    entry.markers = entry.markers.filter((marker) => marker.sequence !== options.sequence);
    recomputeMarkerAccounting(entry);
    dropped += 1;
  }
  if (dropped === 0) {
    throw new RangeError(
      `injectDroppedMarker: no frame carries a marker with sequence ${options.sequence}`,
    );
  }
  return cloned;
}
