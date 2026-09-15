/**
 * Fail-loud structural validation of the W605 evaluation input (the W503
 * `validateManifest` convention: the evaluator never measures over a
 * document it cannot trust, and never silently skips).
 *
 * {@link validateEvaluationInput} checks, with JSON paths:
 *
 * - the per-step SWM ground-truth documents: each snapshot validates
 *   against the frozen `@sporta/contracts` `WorldSnapshot` schema, one per
 *   step, session-consistent, watermark-monotone;
 * - the source event stream: each entry validates against the frozen
 *   `WorldEventStreamEntry` schema, sequences strictly increasing (the
 *   engine's log order — the ordering ground truth);
 * - the steps: non-empty, `atMs` finite ≥ 0 strictly increasing, each
 *   scene schema-valid (`SceneSpecification` zod, the W601 authority),
 *   `sceneCutBefore` a boolean when present;
 * - the rendered output: the renderer's per-frame entries carry the
 *   documented vocabularies (dispositions, held reasons, style kinds), the
 *   interpolation block is well-formed, frame indexes are contiguous,
 *   rundown timestamps are strictly increasing, and every frame's
 *   `fromAtMs`/`toAtMs` resolve against the steps (alignment);
 * - the directed wrapper (when present): windows gap-free in rundown order,
 *   every frame owned by exactly one window, presentation kinds from the
 *   closed vocabulary.
 *
 * Malformation throws {@link SceneEvaluationError}. Cross-consistency that
 * is a MATTER OF CORRECTNESS (wrong claim, swapped token, misordered
 * marker) is NEVER validated — it is measured (the metric modules) and
 * drives the verdict.
 */
import {
  ENTITY_KINDS,
  OutputProfile,
  WorldEventStreamEntry,
  WorldSnapshot,
  type UncertaintyStatus,
} from "@sporta/contracts";
import { SceneSpecification, SCENE_ENTITY_DISPOSITIONS } from "@sporta/scene-projection";
import type {
  AvatarField3dManifest,
  AvatarField3dMatchStep,
  AvatarField3dRenderOutput,
  MatchHeldReason,
  Render3dEntityDisposition,
  Render3dFrameEntry,
  Render3dStyleKind,
} from "@sporta/renderer-3d";
import type {
  CameraPlan,
  DirectedRenderManifest,
  DirectedRenderOutput,
} from "@sporta/camera-director";
import { SceneEvaluationError } from "./errors";
import type { SceneEvaluationErrorCode } from "./errors";

// ---------------------------------------------------------------------------
// Vocabulary pins (the renderer's own unions, compile-time-checked)
// ---------------------------------------------------------------------------

/** `true` when A and B are the same type; `never` on drift. */
type AssertEquals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : never;

/**
 * The renderer's entity treatment vocabulary (mirror of the exported union).
 * The pin sits in a CONST position, so a vocabulary drift in either this
 * mirror or the renderer's union fails `tsc` ("'true' is not assignable to
 * 'never'") — the W503 compile-time posture, actually biting.
 */
const RENDER_DISPOSITIONS = [
  "rendered",
  "rendered-out-of-play",
  "omitted-off-canvas",
  "omitted-behind-camera",
  "omitted-no-position",
  "omitted-invalid-position",
  "omitted-non-pitch-frame",
  "not-rendered-kind",
] as const;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const renderDispositionPin: AssertEquals<
  (typeof RENDER_DISPOSITIONS)[number],
  Render3dEntityDisposition
> = true;

/** The held-reason vocabulary (mirror of the renderer's union). */
const HELD_REASONS = [
  "scene-cut",
  "disposition-change",
  "position-missing",
  "velocity-bound",
  "entity-absent-in-to",
] as const;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const heldReasonPin: AssertEquals<(typeof HELD_REASONS)[number], MatchHeldReason> = true;

/** The style-kind vocabulary (mirror of the renderer's union). */
const STYLE_KINDS = ["identity", "official-fixed", "ball-fixed", "none"] as const;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const styleKindPin: AssertEquals<(typeof STYLE_KINDS)[number], Render3dStyleKind> = true;

/**
 * The SWM entity kinds: the contracts package's OWN value export (all eight
 * kinds — `match`, `competition`, `team`, `venue`, `camera` entities are
 * legal renderer manifest entries via `not-rendered-kind`). Never mirrored:
 * a partial mirror here once false-rejected real output (the audit fix).
 */
const ENTITY_KIND_VOCABULARY: readonly string[] = ENTITY_KINDS;

/** The uncertainty statuses (mirror of the contracts union). */
const UNCERTAINTY_STATUSES = ["known", "unknown", "uncertain"] as const;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const uncertaintyStatusPin: AssertEquals<(typeof UNCERTAINTY_STATUSES)[number], UncertaintyStatus> =
  true;

// ---------------------------------------------------------------------------
// The unified frame view
// ---------------------------------------------------------------------------

/** One evaluated frame: the renderer's own entry + the directed wrapper. */
export interface EvalFrame {
  /** The frame's rundown index (globally renumbered in directed mode). */
  readonly frameIndex: number;
  /** The frame's position on the RUNDOWN (output) timeline. */
  readonly outputTimestampMs: number;
  /**
   * The frame's position on the MATCH (source) timeline — the renderer
   * entry's own timestamp (directed frames re-present match time).
   */
  readonly matchTimestampMs: number;
  /** The renderer's own manifest entry, verbatim. */
  readonly entry: Render3dFrameEntry;
  /** The owning directed window's index (null in match mode). */
  readonly windowIndex: number | null;
  /** The directed window's slot id (null in match mode). */
  readonly windowSlotId: string | null;
  /** The directed window's presentation kind (null in match mode). */
  readonly presentation: "live" | "review" | null;
  /** The output profile's frame interval the entry's windows were planned on. */
  readonly frameIntervalMs: number;
}

/** The validated evaluation input (everything the metrics need, pre-trusted). */
export interface ValidatedSceneEvaluationInput {
  /** `"directed"` iff the output is a W604 composed rundown. */
  readonly mode: "match" | "directed";
  readonly snapshots: readonly WorldSnapshot[];
  readonly eventStream: readonly WorldEventStreamEntry[];
  readonly steps: readonly AvatarField3dMatchStep[];
  /** The renderer manifest (match mode) or the directed manifest (directed). */
  readonly manifest: AvatarField3dManifest | DirectedRenderManifest;
  readonly frames: readonly EvalFrame[];
  /** The step index for each step `atMs` (the frame-authority lookup). */
  readonly stepIndexByAtMs: ReadonlyMap<number, number>;
  /** The structurally validated caller plan (undefined when not supplied). */
  readonly plan: CameraPlan | undefined;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireFiniteNumber(
  value: unknown,
  path: string,
  minimum?: number,
  code: SceneEvaluationErrorCode = "input-malformed",
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (minimum !== undefined && value < minimum)
  ) {
    throw new SceneEvaluationError(
      code,
      path,
      `must be a finite number${minimum === undefined ? "" : ` >= ${minimum}`} (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

function requireInteger(
  value: unknown,
  path: string,
  minimum: number,
  code: SceneEvaluationErrorCode = "input-malformed",
): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new SceneEvaluationError(
      code,
      path,
      `must be an integer >= ${minimum} (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

function requireString(
  value: unknown,
  path: string,
  code: SceneEvaluationErrorCode = "input-malformed",
): string {
  if (typeof value !== "string" || value.length < 1) {
    throw new SceneEvaluationError(
      code,
      path,
      `must be a non-empty string (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

function requireEnum<T extends string>(
  value: unknown,
  vocabulary: readonly T[],
  path: string,
  code: SceneEvaluationErrorCode = "input-malformed",
): T {
  if (typeof value !== "string" || !vocabulary.includes(value as T)) {
    throw new SceneEvaluationError(
      code,
      path,
      `must be one of ${vocabulary.map((entry) => `"${entry}"`).join(", ")} (got ${JSON.stringify(value)})`,
    );
  }
  return value as T;
}

/** Formats zod issues as `path: message; ...` (the repo's reporting shape). */
function issuesOf(error: {
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
}): string {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
}

// --- structure-specific leaf validators (the error-code taxonomy) ----------
// The shared require* helpers throw `input-malformed`; these wrappers pin
// the code to the STRUCTURE being validated, so a machine reader sees
// `frame-malformed` for a frame-entry leaf, `output-malformed` for an
// output-block leaf, `step-malformed` for a step leaf — never a generic
// code that mislocates the defect.

function frameNumber(value: unknown, path: string, minimum?: number): number {
  return requireFiniteNumber(value, path, minimum, "frame-malformed");
}

function frameInteger(value: unknown, path: string, minimum: number): number {
  return requireInteger(value, path, minimum, "frame-malformed");
}

function frameString(value: unknown, path: string): string {
  return requireString(value, path, "frame-malformed");
}

function frameEnum<T extends string>(value: unknown, vocabulary: readonly T[], path: string): T {
  return requireEnum(value, vocabulary, path, "frame-malformed");
}

function outputNumber(value: unknown, path: string, minimum?: number): number {
  return requireFiniteNumber(value, path, minimum, "output-malformed");
}

function outputInteger(value: unknown, path: string, minimum: number): number {
  return requireInteger(value, path, minimum, "output-malformed");
}

function outputString(value: unknown, path: string): string {
  return requireString(value, path, "output-malformed");
}

function outputEnum<T extends string>(value: unknown, vocabulary: readonly T[], path: string): T {
  return requireEnum(value, vocabulary, path, "output-malformed");
}

/** Validates the per-step ground-truth snapshots. */
function validateSnapshots(value: unknown): WorldSnapshot[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SceneEvaluationError(
      "snapshot-malformed",
      "$.snapshots",
      "must be a non-empty array (one SWM snapshot document per step — the ground truth)",
    );
  }
  const snapshots: WorldSnapshot[] = [];
  let previousSequence: number | undefined;
  let sessionId: string | undefined;
  for (let i = 0; i < value.length; i += 1) {
    const check = WorldSnapshot.safeParse(value[i]);
    if (!check.success) {
      throw new SceneEvaluationError(
        "snapshot-malformed",
        `$.snapshots[${i}]`,
        `not a valid WorldSnapshot — ${issuesOf(check.error)}`,
      );
    }
    const snapshot = check.data;
    if (sessionId === undefined) sessionId = snapshot.sessionId;
    if (snapshot.sessionId !== sessionId) {
      throw new SceneEvaluationError(
        "snapshot-malformed",
        `$.snapshots[${i}].sessionId`,
        `must be "${sessionId}" (snapshots from mixed sessions cannot be one timeline)`,
      );
    }
    const sequence = snapshot.watermark.sequence;
    if (previousSequence !== undefined && sequence < previousSequence) {
      throw new SceneEvaluationError(
        "snapshot-malformed",
        `$.snapshots[${i}].watermark.sequence`,
        `${sequence} < the previous snapshot's ${previousSequence} — the engine's snapshots at ascending times have monotone watermark sequences`,
      );
    }
    previousSequence = sequence;
    snapshots.push(snapshot);
  }
  return snapshots;
}

/** Validates the source event stream (the engine's log, in log order). */
function validateEventStream(value: unknown): WorldEventStreamEntry[] {
  if (!Array.isArray(value)) {
    throw new SceneEvaluationError(
      "event-stream-malformed",
      "$.eventStream",
      "must be an array (the SWM's event log — the ordering ground truth)",
    );
  }
  const entries: WorldEventStreamEntry[] = [];
  let previousSequence: number | undefined;
  let sessionId: string | undefined;
  for (let i = 0; i < value.length; i += 1) {
    const check = WorldEventStreamEntry.safeParse(value[i]);
    if (!check.success) {
      throw new SceneEvaluationError(
        "event-stream-malformed",
        `$.eventStream[${i}]`,
        `not a valid WorldEventStreamEntry — ${issuesOf(check.error)}`,
      );
    }
    const entry = check.data;
    if (sessionId === undefined) sessionId = entry.event.sessionId;
    if (entry.event.sessionId !== sessionId) {
      throw new SceneEvaluationError(
        "event-stream-malformed",
        `$.eventStream[${i}].event.sessionId`,
        `must be "${sessionId}" (a stream from mixed sessions cannot be one log)`,
      );
    }
    const sequence = entry.sequence;
    if (previousSequence !== undefined && sequence <= previousSequence) {
      throw new SceneEvaluationError(
        "event-stream-malformed",
        `$.eventStream[${i}].sequence`,
        `${sequence} <= the previous entry's ${previousSequence} — the stream must be in the engine's log order (sequences strictly increasing)`,
      );
    }
    previousSequence = sequence;
    entries.push(entry);
  }
  return entries;
}

/** Validates the steps (the render's own input) against the W601 schema. */
function validateSteps(value: unknown): AvatarField3dMatchStep[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SceneEvaluationError("step-malformed", "$.steps", "must be a non-empty array");
  }
  const steps: AvatarField3dMatchStep[] = [];
  let previousAtMs: number | undefined;
  for (let i = 0; i < value.length; i += 1) {
    const step = value[i];
    if (!isRecord(step)) {
      throw new SceneEvaluationError(
        "step-malformed",
        `$.steps[${i}]`,
        "must be an AvatarField3dMatchStep object",
      );
    }
    const atMs = requireFiniteNumber(step.atMs, `$.steps[${i}].atMs`, 0, "step-malformed");
    if (previousAtMs !== undefined && atMs <= previousAtMs) {
      throw new SceneEvaluationError(
        "step-malformed",
        `$.steps[${i}].atMs`,
        `${atMs} <= the previous step's ${previousAtMs} — step times must strictly increase`,
      );
    }
    previousAtMs = atMs;
    if (step.sceneCutBefore !== undefined && typeof step.sceneCutBefore !== "boolean") {
      throw new SceneEvaluationError(
        "step-malformed",
        `$.steps[${i}].sceneCutBefore`,
        `must be a boolean when present (got ${JSON.stringify(step.sceneCutBefore)})`,
      );
    }
    const sceneCheck = SceneSpecification.safeParse(step.scene);
    if (!sceneCheck.success) {
      throw new SceneEvaluationError(
        "step-malformed",
        `$.steps[${i}].scene`,
        `not a valid SceneSpecification — ${issuesOf(sceneCheck.error)}`,
      );
    }
    steps.push({
      atMs,
      scene: sceneCheck.data,
      ...(step.sceneCutBefore === true ? { sceneCutBefore: true } : {}),
    });
  }
  return steps;
}

/** Validates one renderer frame entry (shape, vocabularies, invariants). */
function validateFrameEntry(entry: unknown, path: string): Render3dFrameEntry {
  if (!isRecord(entry)) {
    throw new SceneEvaluationError("frame-malformed", path, "must be a Render3dFrameEntry object");
  }
  frameInteger(entry.frameIndex, `${path}.frameIndex`, 0);
  frameNumber(entry.outputTimestampMs, `${path}.outputTimestampMs`, 0);
  const windowMs = entry.windowMs;
  if (!isRecord(windowMs)) {
    throw new SceneEvaluationError("frame-malformed", `${path}.windowMs`, "must be an object");
  }
  const startMs = frameNumber(windowMs.startMs, `${path}.windowMs.startMs`, 0);
  const endMs = frameNumber(windowMs.endMs, `${path}.windowMs.endMs`, 0);
  if (endMs <= startMs) {
    throw new SceneEvaluationError(
      "frame-malformed",
      `${path}.windowMs`,
      `endMs (${endMs}) must be > startMs (${startMs})`,
    );
  }
  if (windowMs.startMs !== entry.outputTimestampMs) {
    throw new SceneEvaluationError(
      "frame-malformed",
      `${path}.windowMs.startMs`,
      `must equal the frame's own outputTimestampMs (${entry.outputTimestampMs})`,
    );
  }
  // The interpolation block (present on EVERY match-path frame).
  const interpolation = entry.interpolation;
  if (!isRecord(interpolation)) {
    throw new SceneEvaluationError(
      "frame-malformed",
      `${path}.interpolation`,
      "must be present on every match-path frame (the W603 provenance contract)",
    );
  }
  frameEnum(interpolation.kind, ["observed", "interpolated", "held"], `${path}.interpolation.kind`);
  frameInteger(interpolation.fromStepIndex, `${path}.interpolation.fromStepIndex`, 0);
  if (interpolation.toStepIndex !== undefined) {
    frameInteger(interpolation.toStepIndex, `${path}.interpolation.toStepIndex`, 0);
  }
  if ((interpolation.toStepIndex === undefined) !== (interpolation.toAtMs === undefined)) {
    throw new SceneEvaluationError(
      "frame-malformed",
      `${path}.interpolation`,
      "toStepIndex and toAtMs must be present TOGETHER (the bracketing step is a pair)",
    );
  }
  frameNumber(interpolation.fromAtMs, `${path}.interpolation.fromAtMs`, 0);
  if (interpolation.toAtMs !== undefined) {
    frameNumber(interpolation.toAtMs, `${path}.interpolation.toAtMs`, 0);
  }
  const fraction = frameNumber(interpolation.fraction, `${path}.interpolation.fraction`, 0);
  // The documented `Render3dMatchInterpolation` contract, enforced
  // structurally (a violation is malformation, never a measured defect):
  // fraction ∈ (0, 1) ONLY on interpolated frames; sceneCut is true ONLY on
  // held frames; an interpolated frame always carries its bracketing pair.
  // (Without these, `interpolateMatchFrame` would throw a bare RangeError
  // mid-measurement — the evaluator never measures over an untrusted doc.)
  if (interpolation.kind === "interpolated") {
    if (fraction <= 0) {
      throw new SceneEvaluationError(
        "frame-malformed",
        `${path}.interpolation.fraction`,
        `an interpolated frame must carry a fraction in (0, 1) (got ${fraction})`,
      );
    }
    if (interpolation.toStepIndex === undefined || interpolation.toAtMs === undefined) {
      throw new SceneEvaluationError(
        "frame-malformed",
        `${path}.interpolation`,
        "an interpolated frame must carry its bracketing to-step",
      );
    }
    if (interpolation.sceneCut !== false) {
      throw new SceneEvaluationError(
        "frame-malformed",
        `${path}.interpolation.sceneCut`,
        `must be false on an interpolated frame (got ${JSON.stringify(interpolation.sceneCut)})`,
      );
    }
  } else {
    if (fraction !== 0) {
      throw new SceneEvaluationError(
        "frame-malformed",
        `${path}.interpolation.fraction`,
        `an ${interpolation.kind} frame interpolates NOTHING — fraction must be 0 (got ${fraction})`,
      );
    }
    if (interpolation.sceneCut !== (interpolation.kind === "held")) {
      throw new SceneEvaluationError(
        "frame-malformed",
        `${path}.interpolation.sceneCut`,
        `must be ${interpolation.kind === "held"} on a ${interpolation.kind} frame (got ${JSON.stringify(interpolation.sceneCut)})`,
      );
    }
  }
  // The source provenance block.
  const source = entry.source;
  if (!isRecord(source)) {
    throw new SceneEvaluationError("frame-malformed", `${path}.source`, "must be an object");
  }
  const watermark = source.watermark;
  if (!isRecord(watermark)) {
    throw new SceneEvaluationError(
      "frame-malformed",
      `${path}.source.watermark`,
      "must be an object",
    );
  }
  frameInteger(watermark.sequence, `${path}.source.watermark.sequence`, 0);
  frameNumber(watermark.watermarkMs, `${path}.source.watermark.watermarkMs`, 0);
  frameNumber(source.generatedAtMs, `${path}.source.generatedAtMs`, 0);
  if (typeof source.footballState !== "boolean") {
    throw new SceneEvaluationError(
      "frame-malformed",
      `${path}.source.footballState`,
      `must be a boolean (got ${JSON.stringify(source.footballState)})`,
    );
  }
  frameString(source.sceneSchemaVersion, `${path}.source.sceneSchemaVersion`);
  // Markers.
  if (!Array.isArray(entry.appliedMarkerSequences)) {
    throw new SceneEvaluationError(
      "frame-malformed",
      `${path}.appliedMarkerSequences`,
      "must be an array",
    );
  }
  if (!Array.isArray(entry.markers)) {
    throw new SceneEvaluationError("frame-malformed", `${path}.markers`, "must be an array");
  }
  for (let m = 0; m < entry.markers.length; m += 1) {
    const marker = entry.markers[m];
    if (!isRecord(marker)) {
      throw new SceneEvaluationError(
        "frame-malformed",
        `${path}.markers[${m}]`,
        "must be an object",
      );
    }
    frameInteger(marker.sequence, `${path}.markers[${m}].sequence`, 0);
    frameString(marker.eventId, `${path}.markers[${m}].eventId`);
    frameString(marker.eventTypeRef, `${path}.markers[${m}].eventTypeRef`);
    frameNumber(marker.eventTimeMs, `${path}.markers[${m}].eventTimeMs`, 0);
    if (typeof marker.displayed !== "boolean") {
      throw new SceneEvaluationError(
        "frame-malformed",
        `${path}.markers[${m}].displayed`,
        `must be a boolean (got ${JSON.stringify(marker.displayed)})`,
      );
    }
    frameString(marker.text, `${path}.markers[${m}].text`);
  }
  // HUD.
  const hud = entry.hud;
  if (!isRecord(hud)) {
    throw new SceneEvaluationError("frame-malformed", `${path}.hud`, "must be an object");
  }
  if (hud.statusLine !== null && typeof hud.statusLine !== "string") {
    throw new SceneEvaluationError(
      "frame-malformed",
      `${path}.hud.statusLine`,
      `must be a string or null (got ${JSON.stringify(hud.statusLine)})`,
    );
  }
  frameString(hud.cameraLabel, `${path}.hud.cameraLabel`);
  if (!Array.isArray(hud.eventChips) || hud.eventChips.some((chip) => typeof chip !== "string")) {
    throw new SceneEvaluationError(
      "frame-malformed",
      `${path}.hud.eventChips`,
      "must be an array of strings",
    );
  }
  frameInteger(hud.markersNotDisplayed, `${path}.hud.markersNotDisplayed`, 0);
  // Possession.
  if (entry.possession !== null) {
    const possession = entry.possession;
    if (!isRecord(possession)) {
      throw new SceneEvaluationError(
        "frame-malformed",
        `${path}.possession`,
        "must be an object or null",
      );
    }
    frameEnum(possession.status, UNCERTAINTY_STATUSES, `${path}.possession.status`);
    if (possession.entityId !== undefined) {
      frameString(possession.entityId, `${path}.possession.entityId`);
    }
    if (possession.confidence !== undefined) {
      frameNumber(possession.confidence, `${path}.possession.confidence`, 0);
    }
    if (typeof possession.displayed !== "boolean") {
      throw new SceneEvaluationError(
        "frame-malformed",
        `${path}.possession.displayed`,
        `must be a boolean (got ${JSON.stringify(possession.displayed)})`,
      );
    }
  }
  // Entities.
  if (!Array.isArray(entry.entities)) {
    throw new SceneEvaluationError("frame-malformed", `${path}.entities`, "must be an array");
  }
  for (let e = 0; e < entry.entities.length; e += 1) {
    const entity = entry.entities[e];
    if (!isRecord(entity)) {
      throw new SceneEvaluationError(
        "frame-malformed",
        `${path}.entities[${e}]`,
        "must be a Render3dEntityEntry object",
      );
    }
    frameString(entity.entityId, `${path}.entities[${e}].entityId`);
    frameEnum(entity.kind, ENTITY_KIND_VOCABULARY, `${path}.entities[${e}].kind`);
    frameInteger(entity.version, `${path}.entities[${e}].version`, 1);
    frameNumber(entity.lastEventTimeMs, `${path}.entities[${e}].lastEventTimeMs`, 0);
    frameEnum(
      entity.sceneDisposition,
      SCENE_ENTITY_DISPOSITIONS,
      `${path}.entities[${e}].sceneDisposition`,
    );
    frameEnum(
      entity.renderDisposition,
      RENDER_DISPOSITIONS,
      `${path}.entities[${e}].renderDisposition`,
    );
    if (entity.positionMeters !== undefined) {
      const position = entity.positionMeters;
      if (!isRecord(position)) {
        throw new SceneEvaluationError(
          "frame-malformed",
          `${path}.entities[${e}].positionMeters`,
          "must be an object",
        );
      }
      frameNumber(position.x, `${path}.entities[${e}].positionMeters.x`);
      frameNumber(position.y, `${path}.entities[${e}].positionMeters.y`);
      if (position.z !== undefined) {
        frameNumber(position.z, `${path}.entities[${e}].positionMeters.z`);
      }
    }
    if (entity.positionProvenance !== undefined) {
      frameEnum(
        entity.positionProvenance,
        ["interpolated", "held"],
        `${path}.entities[${e}].positionProvenance`,
      );
      if (entity.positionProvenance === "held") {
        frameEnum(entity.heldReason, HELD_REASONS, `${path}.entities[${e}].heldReason`);
      } else if (entity.heldReason !== undefined) {
        throw new SceneEvaluationError(
          "frame-malformed",
          `${path}.entities[${e}].heldReason`,
          `must be present exactly when positionProvenance === "held" (found with "${String(entity.positionProvenance)}")`,
        );
      }
    } else if (entity.heldReason !== undefined) {
      throw new SceneEvaluationError(
        "frame-malformed",
        `${path}.entities[${e}].heldReason`,
        "must be absent when positionProvenance is absent",
      );
    }
    if (typeof entity.headingCarried !== "boolean") {
      throw new SceneEvaluationError(
        "frame-malformed",
        `${path}.entities[${e}].headingCarried`,
        `must be a boolean (got ${JSON.stringify(entity.headingCarried)})`,
      );
    }
    if (entity.headingRadians !== undefined) {
      frameNumber(entity.headingRadians, `${path}.entities[${e}].headingRadians`);
    }
    if (entity.positionStatus !== undefined) {
      frameEnum(
        entity.positionStatus,
        UNCERTAINTY_STATUSES,
        `${path}.entities[${e}].positionStatus`,
      );
    }
    if (entity.positionConfidence !== undefined) {
      frameNumber(entity.positionConfidence, `${path}.entities[${e}].positionConfidence`, 0);
    }
    frameEnum(entity.styleKind, STYLE_KINDS, `${path}.entities[${e}].styleKind`);
  }
  // The entry is structurally validated field-by-field above; the cast
  // only restores its static type (the runtime shape was checked — the
  // W602 grep-lesson applied: never trust a bare cast, trust the checks).
  return entry as unknown as Render3dFrameEntry;
}

/** Validates the manifest envelope shared by both modes. */
function validateManifestEnvelope(
  manifest: unknown,
  path: string,
): AvatarField3dManifest | DirectedRenderManifest {
  if (!isRecord(manifest)) {
    throw new SceneEvaluationError("output-malformed", path, "must be a manifest object");
  }
  if (!isRecord(manifest.renderer)) {
    throw new SceneEvaluationError("output-malformed", `${path}.renderer`, "must be an object");
  }
  requireString(manifest.renderer.rendererId, `${path}.renderer.rendererId`);
  requireString(manifest.renderer.rendererVersion, `${path}.renderer.rendererVersion`);
  if (!Array.isArray(manifest.frames) || manifest.frames.length === 0) {
    throw new SceneEvaluationError(
      "output-malformed",
      `${path}.frames`,
      "must be a non-empty array",
    );
  }
  // Structurally validated above (renderer identity + non-empty frames);
  // the cast restores the static type over the checked runtime shape.
  return manifest as unknown as AvatarField3dManifest | DirectedRenderManifest;
}

/** Whether the manifest is a W604 directed rundown manifest. */
function isDirectedManifest(
  manifest: AvatarField3dManifest | DirectedRenderManifest,
): manifest is DirectedRenderManifest {
  return Array.isArray((manifest as DirectedRenderManifest).windows);
}

/**
 * Validates one realized camera block (`Render3dCameraBlock` shape): slot id,
 * position/target points, focal length, near plane. Types only — geometry
 * CORRECTNESS (is it the canonical slot?) is the direction dimension's
 * measured job, never a validation throw.
 */
function validateCameraBlock(camera: unknown, path: string): void {
  if (!isRecord(camera)) {
    throw new SceneEvaluationError("output-malformed", path, "must be a camera block object");
  }
  outputString(camera.slotId, `${path}.slotId`);
  for (const block of ["position", "target"] as const) {
    const point = camera[block];
    if (!isRecord(point)) {
      throw new SceneEvaluationError(
        "output-malformed",
        `${path}.${block}`,
        "must be a point object",
      );
    }
    outputNumber(point.x, `${path}.${block}.x`);
    outputNumber(point.y, `${path}.${block}.y`);
    outputNumber(point.z, `${path}.${block}.z`);
  }
  outputNumber(camera.focalPx, `${path}.focalPx`);
  outputNumber(camera.nearPlaneMeters, `${path}.nearPlaneMeters`);
}

/**
 * Validates the skipped-marker accounting list (the renderer's own honesty
 * surface): array of entries with sequence/eventTimeMs and a closed
 * before/after reason vocabulary; directed entries carry an in-range
 * `windowIndex` (an out-of-range one would vanish from every window's
 * accounting — never silent).
 */
function validateSkippedMarkers(skipped: unknown, path: string, windowCount: number): void {
  if (!Array.isArray(skipped)) {
    throw new SceneEvaluationError("output-malformed", path, "must be an array");
  }
  for (let i = 0; i < skipped.length; i += 1) {
    const entry = skipped[i];
    if (!isRecord(entry)) {
      throw new SceneEvaluationError("output-malformed", `${path}[${i}]`, "must be an object");
    }
    outputInteger(entry.sequence, `${path}[${i}].sequence`, 0);
    outputNumber(entry.eventTimeMs, `${path}[${i}].eventTimeMs`, 0);
    outputEnum(entry.reason, ["before-window", "after-window"], `${path}[${i}].reason`);
    if (windowCount > 0) {
      const windowIndex = outputInteger(entry.windowIndex, `${path}[${i}].windowIndex`, 0);
      if (windowIndex >= windowCount) {
        throw new SceneEvaluationError(
          "output-malformed",
          `${path}[${i}].windowIndex`,
          `${windowIndex} is outside the manifest's ${windowCount} windows (a skipped marker outside every window is unaccountable)`,
        );
      }
    }
  }
}

/**
 * Validates the directed manifest's director provenance block (shape only —
 * plan CONSISTENCY is the direction dimension's measured job). Guarantees the
 * plan-comparison accesses can never crash and never silently skip.
 */
function validateDirectorBlock(director: unknown): void {
  const path = "$.output.manifest.director";
  if (!isRecord(director)) {
    throw new SceneEvaluationError(
      "output-malformed",
      path,
      "must be a director provenance object",
    );
  }
  outputString(director.directorVersion, `${path}.directorVersion`);
  if (!isRecord(director.policy)) {
    throw new SceneEvaluationError("output-malformed", `${path}.policy`, "must be an object");
  }
  outputString(director.policy.policyId, `${path}.policy.policyId`);
  outputString(director.policy.policyVersion, `${path}.policy.policyVersion`);
  if (!isRecord(director.timeline)) {
    throw new SceneEvaluationError("output-malformed", `${path}.timeline`, "must be an object");
  }
  outputNumber(director.timeline.startMs, `${path}.timeline.startMs`, 0);
  outputNumber(director.timeline.endMs, `${path}.timeline.endMs`, 0);
  for (const count of [
    "windowCount",
    "liveWindowCount",
    "reviewWindowCount",
    "cutCount",
  ] as const) {
    outputInteger(director[count], `${path}.${count}`, 0);
  }
  if (!Array.isArray(director.suppressedCuts)) {
    throw new SceneEvaluationError(
      "output-malformed",
      `${path}.suppressedCuts`,
      "must be an array",
    );
  }
  if (!Array.isArray(director.eventAccounting)) {
    throw new SceneEvaluationError(
      "output-malformed",
      `${path}.eventAccounting`,
      "must be an array",
    );
  }
}

/**
 * Structurally validates a caller-supplied `CameraPlan` (shape only — the
 * plan's OWN semantics are W604's `checkCameraPlan` job, and the manifest's
 * agreement with the plan is the direction dimension's measured job). A
 * garbage plan must throw a typed error, never crash the comparison and
 * never silently vanish from it.
 */
function validatePlan(plan: unknown): CameraPlan {
  if (!isRecord(plan)) {
    throw new SceneEvaluationError("input-malformed", "$.plan", "must be a CameraPlan object");
  }
  requireString(plan.directorVersion, "$.plan.directorVersion");
  if (!isRecord(plan.policy)) {
    throw new SceneEvaluationError("input-malformed", "$.plan.policy", "must be an object");
  }
  requireString(plan.policy.policyId, "$.plan.policy.policyId");
  requireString(plan.policy.policyVersion, "$.plan.policy.policyVersion");
  if (!isRecord(plan.timeline)) {
    throw new SceneEvaluationError("input-malformed", "$.plan.timeline", "must be an object");
  }
  const timelineStart = requireFiniteNumber(plan.timeline.startMs, "$.plan.timeline.startMs", 0);
  const timelineEnd = requireFiniteNumber(plan.timeline.endMs, "$.plan.timeline.endMs", 0);
  if (timelineEnd < timelineStart) {
    throw new SceneEvaluationError(
      "input-malformed",
      "$.plan.timeline.endMs",
      `${timelineEnd} < startMs ${timelineStart} — an empty timeline is not a plan`,
    );
  }
  if (!Array.isArray(plan.windows) || plan.windows.length === 0) {
    throw new SceneEvaluationError(
      "input-malformed",
      "$.plan.windows",
      "must be a non-empty array (a plan with no windows cannot be composed)",
    );
  }
  for (let w = 0; w < plan.windows.length; w += 1) {
    const window = plan.windows[w];
    if (!isRecord(window)) {
      throw new SceneEvaluationError(
        "input-malformed",
        `$.plan.windows[${w}]`,
        "must be a DirectedWindow object",
      );
    }
    requireInteger(window.index, `$.plan.windows[${w}].index`, 0);
    requireEnum(window.kind, ["live", "review"], `$.plan.windows[${w}].kind`);
    requireString(window.cameraSlotId, `$.plan.windows[${w}].cameraSlotId`);
    if (!isRecord(window.source)) {
      throw new SceneEvaluationError(
        "input-malformed",
        `$.plan.windows[${w}].source`,
        "must be an object",
      );
    }
    const startMs = requireFiniteNumber(
      window.source.startMs,
      `$.plan.windows[${w}].source.startMs`,
      0,
    );
    const endMs = requireFiniteNumber(window.source.endMs, `$.plan.windows[${w}].source.endMs`, 0);
    if (endMs < startMs) {
      throw new SceneEvaluationError(
        "input-malformed",
        `$.plan.windows[${w}].source.endMs`,
        `${endMs} < startMs ${startMs} — an empty window is not a presentation`,
      );
    }
    if (!isRecord(window.decision)) {
      throw new SceneEvaluationError(
        "input-malformed",
        `$.plan.windows[${w}].decision`,
        "must be a decision record object",
      );
    }
    requireString(window.decision.ruleId, `$.plan.windows[${w}].decision.ruleId`);
  }
  if (!isRecord(plan.summary)) {
    throw new SceneEvaluationError("input-malformed", "$.plan.summary", "must be an object");
  }
  for (const count of [
    "windowCount",
    "liveWindowCount",
    "reviewWindowCount",
    "cutCount",
  ] as const) {
    requireInteger(plan.summary[count], `$.plan.summary.${count}`, 0);
  }
  if (!Array.isArray(plan.summary.suppressedCuts)) {
    throw new SceneEvaluationError(
      "input-malformed",
      "$.plan.summary.suppressedCuts",
      "must be an array",
    );
  }
  if (!Array.isArray(plan.summary.eventAccounting)) {
    throw new SceneEvaluationError(
      "input-malformed",
      "$.plan.summary.eventAccounting",
      "must be an array",
    );
  }
  return plan as unknown as CameraPlan;
}

/**
 * Validates the whole evaluation input. Throws {@link SceneEvaluationError}
 * on any structural problem; returns the trusted, unified view.
 */
export function validateEvaluationInput(input: {
  snapshots: unknown;
  eventStream: unknown;
  steps: unknown;
  output: unknown;
  plan?: unknown;
}): ValidatedSceneEvaluationInput {
  const snapshots = validateSnapshots(input.snapshots);
  const eventStream = validateEventStream(input.eventStream);
  const steps = validateSteps(input.steps);

  if (input.output === null || typeof input.output !== "object") {
    throw new SceneEvaluationError(
      "output-malformed",
      "$.output",
      "must be a render output object",
    );
  }
  const output = input.output as AvatarField3dRenderOutput | DirectedRenderOutput;
  const manifest = validateManifestEnvelope(output.manifest, "$.output.manifest");
  if (!isRecord(output.result)) {
    throw new SceneEvaluationError(
      "output-malformed",
      "$.output.result",
      "must be a RenderResult object",
    );
  }
  const sessionId = snapshots[0]!.sessionId;
  if (output.result.sessionId !== sessionId) {
    throw new SceneEvaluationError(
      "alignment-malformed",
      "$.output.result.sessionId",
      `must be "${sessionId}" (the render must belong to the ground-truth session)`,
    );
  }
  // The renderer's own 1:1 contract: one frame document per manifest entry.
  // (The SVG bytes themselves are NOT the W605 measurement surface — the
  // manifest's per-frame claims are — but a frames/manifest count divergence
  // is a document the evaluator refuses to trust.)
  if (!Array.isArray(output.frames) || output.frames.length !== manifest.frames.length) {
    throw new SceneEvaluationError(
      "output-malformed",
      "$.output.frames",
      `must carry exactly ${manifest.frames.length} frame documents (the renderer's 1:1 frames contract) — got ${
        Array.isArray(output.frames) ? output.frames.length : String(output.frames)
      }`,
    );
  }

  // Step alignment: one snapshot per step, watermark-ordered, and every
  // frame's interpolation fromAtMs/toAtMs resolve against the steps.
  if (snapshots.length !== steps.length) {
    throw new SceneEvaluationError(
      "alignment-malformed",
      "$.snapshots",
      `carries ${snapshots.length} snapshots for ${steps.length} steps — exactly one SWM document per step is required`,
    );
  }
  const stepIndexByAtMs = new Map<number, number>();
  for (let k = 0; k < steps.length; k += 1) {
    const step = steps[k]!;
    const snapshot = snapshots[k]!;
    if (snapshot.watermark.watermarkMs > step.atMs) {
      throw new SceneEvaluationError(
        "alignment-malformed",
        `$.snapshots[${k}].watermark.watermarkMs`,
        `${snapshot.watermark.watermarkMs} > step ${k}'s atMs ${step.atMs} — a snapshot captured after the step time cannot be its ground truth`,
      );
    }
    if (k > 0 && snapshot.watermark.watermarkMs < snapshots[k - 1]!.watermark.watermarkMs) {
      throw new SceneEvaluationError(
        "alignment-malformed",
        `$.snapshots[${k}].watermark.watermarkMs`,
        "must be non-decreasing along the timeline",
      );
    }
    stepIndexByAtMs.set(step.atMs, k);
  }

  const directed = isDirectedManifest(manifest);
  if (!directed) {
    const camera = (manifest as AvatarField3dManifest).camera;
    validateCameraBlock(camera, "$.output.manifest.camera");
  }
  const matchCameraSlotId = directed
    ? null
    : requireString(
        (manifest as AvatarField3dManifest).camera?.slotId,
        "$.output.manifest.camera.slotId",
      );
  if (!directed) {
    const output = (manifest as AvatarField3dManifest).output;
    if (!isRecord(output)) {
      throw new SceneEvaluationError(
        "output-malformed",
        "$.output.manifest.output",
        "must be an object",
      );
    }
    const frameIntervalMs = requireFiniteNumber(
      output.frameIntervalMs,
      "$.output.manifest.output.frameIntervalMs",
      0,
    );
    if (frameIntervalMs <= 0) {
      throw new SceneEvaluationError(
        "output-malformed",
        "$.output.manifest.output.frameIntervalMs",
        `must be > 0 (got ${frameIntervalMs} — a zero interval is not a frame plan)`,
      );
    }
    validateSkippedMarkers(manifest.skippedMarkers, "$.output.manifest.skippedMarkers", 0);
  }
  // The caller-supplied plan: only meaningful for a directed rundown, and
  // structurally validated so the plan-consistency measurement can neither
  // crash on garbage nor silently skip a non-array window list.
  let plan: CameraPlan | undefined;
  if (input.plan !== undefined) {
    if (!directed) {
      throw new SceneEvaluationError(
        "input-malformed",
        "$.plan",
        "a CameraPlan is only meaningful for a directed rundown (match-mode outputs take no plan)",
      );
    }
    plan = validatePlan(input.plan);
  }
  const frames: EvalFrame[] = [];
  let previousOutputTimestamp: number | undefined;
  for (let i = 0; i < manifest.frames.length; i += 1) {
    const path = `$.output.manifest.frames[${i}]`;
    if (directed) {
      const directedFrame = manifest.frames[i]!;
      const entry = validateFrameEntry(directedFrame.entry, `${path}.entry`);
      const windowIndex = requireInteger(directedFrame.windowIndex, `${path}.windowIndex`, 0);
      if (windowIndex >= manifest.windows.length) {
        throw new SceneEvaluationError(
          "window-malformed",
          `${path}.windowIndex`,
          `${windowIndex} is outside the manifest's ${manifest.windows.length} windows`,
        );
      }
      const outputTimestampMs = requireFiniteNumber(
        directedFrame.outputTimestampMs,
        `${path}.outputTimestampMs`,
        0,
      );
      const matchTimestampMs = requireFiniteNumber(
        directedFrame.sourceTimestampMs,
        `${path}.sourceTimestampMs`,
        0,
      );
      if (directedFrame.cameraSlotId !== undefined) {
        requireString(directedFrame.cameraSlotId, `${path}.cameraSlotId`);
      }
      const window = manifest.windows[windowIndex]!;
      frames.push({
        frameIndex: directedFrame.frameIndex,
        outputTimestampMs,
        matchTimestampMs,
        entry,
        windowIndex,
        windowSlotId: window.cameraSlotId,
        presentation: window.kind,
        frameIntervalMs: 1000 / window.outputProfile.frameRate,
      });
    } else {
      const entry = validateFrameEntry(manifest.frames[i]!, path);
      frames.push({
        frameIndex: entry.frameIndex,
        outputTimestampMs: entry.outputTimestampMs,
        matchTimestampMs: entry.outputTimestampMs,
        entry,
        windowIndex: null,
        windowSlotId: null,
        presentation: null,
        frameIntervalMs: manifest.output.frameIntervalMs,
      });
    }
    if (frames[i]!.frameIndex !== i) {
      throw new SceneEvaluationError(
        "frame-malformed",
        `${path}.frameIndex`,
        `${frames[i]!.frameIndex} breaks the contiguous 0-based rundown order (expected ${i})`,
      );
    }
    if (
      previousOutputTimestamp !== undefined &&
      frames[i]!.outputTimestampMs <= previousOutputTimestamp
    ) {
      throw new SceneEvaluationError(
        "frame-malformed",
        `${path}.outputTimestampMs`,
        `${frames[i]!.outputTimestampMs} <= the previous frame's ${previousOutputTimestamp} — rundown timestamps must strictly increase`,
      );
    }
    previousOutputTimestamp = frames[i]!.outputTimestampMs;
    const interpolation = frames[i]!.entry.interpolation!;
    const fromStepIndex = stepIndexByAtMs.get(interpolation.fromAtMs);
    if (fromStepIndex === undefined) {
      throw new SceneEvaluationError(
        "alignment-malformed",
        `${path}.entry.interpolation.fromAtMs`,
        `${interpolation.fromAtMs} is not any step's atMs — every frame's authority step must resolve against the steps`,
      );
    }
    // Slot resolvability (the expectation precondition): the slot in force
    // for this frame must be CARRIED by the frame's from-step's scene — the
    // renderer refuses an uncarried slot, so a manifest claiming one is a
    // document the evaluator cannot derive expectations from (fail loud).
    const frameSlotId = directed
      ? manifest.windows[frames[i]!.windowIndex!]!.cameraSlotId
      : matchCameraSlotId!;
    const fromStep = steps[fromStepIndex]!;
    if (!fromStep.scene.cameraSlots.some((slot) => slot.slotId === frameSlotId)) {
      throw new SceneEvaluationError(
        "alignment-malformed",
        `$.output.manifest.frames[${i}]`,
        `the slot "${frameSlotId}" in force for this frame is not carried by step ${fromStepIndex}'s scene — the expectation cannot resolve`,
      );
    }
    if (interpolation.toAtMs !== undefined && !stepIndexByAtMs.has(interpolation.toAtMs)) {
      throw new SceneEvaluationError(
        "alignment-malformed",
        `${path}.entry.interpolation.toAtMs`,
        `${interpolation.toAtMs} is not any step's atMs — the bracketing snapshot must resolve against the steps`,
      );
    }
  }

  if (directed) {
    validateDirectorBlock(manifest.director);
    validateSkippedMarkers(
      manifest.skippedMarkers,
      "$.output.manifest.skippedMarkers",
      manifest.windows.length,
    );
    for (let w = 0; w < manifest.windows.length; w += 1) {
      const window = manifest.windows[w]!;
      const path = `$.output.manifest.windows[${w}]`;
      if (window.index !== w) {
        throw new SceneEvaluationError(
          "window-malformed",
          `${path}.index`,
          `${window.index} breaks the gap-free rundown order (expected ${w})`,
        );
      }
      requireString(window.cameraSlotId, `${path}.cameraSlotId`);
      requireEnum(window.kind, ["live", "review"], `${path}.kind`);
      validateCameraBlock(window.camera, `${path}.camera`);
      const source = window.source;
      if (!isRecord(source)) {
        throw new SceneEvaluationError("window-malformed", `${path}.source`, "must be an object");
      }
      const startMs = requireFiniteNumber(source.startMs, `${path}.source.startMs`, 0);
      const endMs = requireFiniteNumber(source.endMs, `${path}.source.endMs`, 0);
      if (endMs <= startMs) {
        throw new SceneEvaluationError(
          "window-malformed",
          `${path}.source`,
          `endMs (${endMs}) must be > startMs (${startMs})`,
        );
      }
      // Window boundaries are snapshot boundaries (the W604 composition
      // contract: every directed run starts and ends on a step's atMs — the
      // selfcheck's boundaries-respected rule). The evaluator's run-relative
      // index resolution depends on it, so it fails loud here, never as a
      // bare Error mid-measurement.
      if (!stepIndexByAtMs.has(startMs) || !stepIndexByAtMs.has(endMs)) {
        throw new SceneEvaluationError(
          "window-malformed",
          `${path}.source`,
          `boundaries [${startMs}, ${endMs}] must be step atMs values (snapshot boundaries)`,
        );
      }
      const profileCheck = OutputProfile.safeParse(window.outputProfile);
      if (!profileCheck.success) {
        throw new SceneEvaluationError(
          "window-malformed",
          `${path}.outputProfile`,
          `not a valid OutputProfile — ${issuesOf(profileCheck.error)}`,
        );
      }
      if (window.outputProfile.frameRate < 1 || !Number.isInteger(window.outputProfile.frameRate)) {
        throw new SceneEvaluationError(
          "window-malformed",
          `${path}.outputProfile.frameRate`,
          `must be an integer >= 1 (got ${JSON.stringify(window.outputProfile.frameRate)})`,
        );
      }
    }
    let previousWindowIndex = -1;
    for (const frame of frames) {
      if (frame.windowIndex! < previousWindowIndex) {
        throw new SceneEvaluationError(
          "window-malformed",
          "$.output.manifest.frames",
          "a frame's window index regresses — each window's frames are contiguous in rundown order",
        );
      }
      previousWindowIndex = frame.windowIndex!;
    }
    const ownedWindows = new Set(frames.map((frame) => frame.windowIndex));
    for (let w = 0; w < manifest.windows.length; w += 1) {
      if (!ownedWindows.has(w)) {
        throw new SceneEvaluationError(
          "window-malformed",
          `$.output.manifest.windows[${w}]`,
          "realized no frames (an empty window is a composition defect, never a skip)",
        );
      }
    }
  }

  return {
    mode: directed ? "directed" : "match",
    snapshots,
    eventStream,
    steps,
    manifest,
    frames,
    stepIndexByAtMs,
    plan,
  };
}
