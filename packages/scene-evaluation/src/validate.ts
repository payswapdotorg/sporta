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
  WorldEventStreamEntry,
  WorldSnapshot,
  type EntityKind,
  type UncertaintyStatus,
} from "@sporta/contracts";
import {
  SceneSpecification,
  SCENE_ENTITY_DISPOSITIONS,
  type SceneEntityDisposition,
} from "@sporta/scene-projection";
import type {
  AvatarField3dManifest,
  AvatarField3dMatchStep,
  AvatarField3dRenderOutput,
  MatchHeldReason,
  Render3dEntityDisposition,
  Render3dFrameEntry,
  Render3dStyleKind,
} from "@sporta/renderer-3d";
import type { DirectedRenderManifest, DirectedRenderOutput } from "@sporta/camera-director";
import { SceneEvaluationError } from "./errors";

// ---------------------------------------------------------------------------
// Vocabulary pins (the renderer's own unions, compile-time-checked)
// ---------------------------------------------------------------------------

/** Compile-time equality assert (a drifted vocabulary fails typecheck). */
type AssertEquals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : never;

/** The renderer's entity treatment vocabulary (mirror of the exported union). */
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

/** Pin: the local vocabulary is EXACTLY the renderer's exported union. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type RenderDispositionPin = AssertEquals<
  (typeof RENDER_DISPOSITIONS)[number],
  Render3dEntityDisposition
>;

/** The scene's own disposition vocabulary (the W601 authority, imported). */
const SCENE_DISPOSITIONS: readonly string[] = SCENE_ENTITY_DISPOSITIONS;
type SceneDispositionPin = AssertEquals<
  (typeof SCENE_ENTITY_DISPOSITIONS)[number],
  SceneEntityDisposition
>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _SceneDispositionPin = SceneDispositionPin;

/** The held-reason vocabulary (mirror of the renderer's union). */
const HELD_REASONS = [
  "scene-cut",
  "disposition-change",
  "position-missing",
  "velocity-bound",
  "entity-absent-in-to",
] as const;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type HeldReasonPin = AssertEquals<(typeof HELD_REASONS)[number], MatchHeldReason>;

/** The style-kind vocabulary (mirror of the renderer's union). */
const STYLE_KINDS = ["identity", "official-fixed", "ball-fixed", "none"] as const;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type StyleKindPin = AssertEquals<(typeof STYLE_KINDS)[number], Render3dStyleKind>;

/** The SWM entity kinds (mirror of the contracts union). */
const ENTITY_KINDS = ["participant", "official", "ball"] as const;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type EntityKindPin = AssertEquals<(typeof ENTITY_KINDS)[number], EntityKind>;

/** The uncertainty statuses (mirror of the contracts union). */
const UNCERTAINTY_STATUSES = ["known", "uncertain", "unknown"] as const;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type UncertaintyStatusPin = AssertEquals<(typeof UNCERTAINTY_STATUSES)[number], UncertaintyStatus>;

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
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireFiniteNumber(value: unknown, path: string, minimum?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (minimum !== undefined && value < minimum)) {
    throw new SceneEvaluationError(
      "input-malformed",
      path,
      `must be a finite number${minimum === undefined ? "" : ` >= ${minimum}`} (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

function requireInteger(value: unknown, path: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new SceneEvaluationError(
      "input-malformed",
      path,
      `must be an integer >= ${minimum} (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length < 1) {
    throw new SceneEvaluationError(
      "input-malformed",
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
): T {
  if (typeof value !== "string" || !vocabulary.includes(value as T)) {
    throw new SceneEvaluationError(
      "input-malformed",
      path,
      `must be one of ${vocabulary.map((entry) => `"${entry}"`).join(", ")} (got ${JSON.stringify(value)})`,
    );
  }
  return value as T;
}

/** Formats zod issues as `path: message; ...` (the repo's reporting shape). */
function issuesOf(error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
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
    const atMs = requireFiniteNumber(step.atMs, `$.steps[${i}].atMs`, 0);
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
    steps.push({ atMs, scene: sceneCheck.data, ...(step.sceneCutBefore === true ? { sceneCutBefore: true } : {}) });
  }
  return steps;
}

/** Validates one renderer frame entry (shape, vocabularies, invariants). */
function validateFrameEntry(entry: unknown, path: string): Render3dFrameEntry {
  if (!isRecord(entry)) {
    throw new SceneEvaluationError("frame-malformed", path, "must be a Render3dFrameEntry object");
  }
  requireInteger(entry.frameIndex, `${path}.frameIndex`, 0);
  requireFiniteNumber(entry.outputTimestampMs, `${path}.outputTimestampMs`, 0);
  const windowMs = entry.windowMs;
  if (!isRecord(windowMs)) {
    throw new SceneEvaluationError("frame-malformed", `${path}.windowMs`, "must be an object");
  }
  const startMs = requireFiniteNumber(windowMs.startMs, `${path}.windowMs.startMs`, 0);
  const endMs = requireFiniteNumber(windowMs.endMs, `${path}.windowMs.endMs`, 0);
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
  requireEnum(interpolation.kind, ["observed", "interpolated", "held"], `${path}.interpolation.kind`);
  requireInteger(interpolation.fromStepIndex, `${path}.interpolation.fromStepIndex`, 0);
  if (interpolation.toStepIndex !== undefined) {
    requireInteger(interpolation.toStepIndex, `${path}.interpolation.toStepIndex`, 0);
  }
  requireFiniteNumber(interpolation.fromAtMs, `${path}.interpolation.fromAtMs`, 0);
  if (interpolation.toAtMs !== undefined) {
    requireFiniteNumber(interpolation.toAtMs, `${path}.interpolation.toAtMs`, 0);
  }
  const fraction = requireFiniteNumber(interpolation.fraction, `${path}.interpolation.fraction`, 0);
  if (fraction >= 1) {
    throw new SceneEvaluationError(
      "frame-malformed",
      `${path}.interpolation.fraction`,
      `must be in [0, 1) (got ${fraction})`,
    );
  }
  if (typeof interpolation.sceneCut !== "boolean") {
    throw new SceneEvaluationError(
      "frame-malformed",
      `${path}.interpolation.sceneCut`,
      `must be a boolean (got ${JSON.stringify(interpolation.sceneCut)})`,
    );
  }
  // The source provenance block.
  const source = entry.source;
  if (!isRecord(source)) {
    throw new SceneEvaluationError("frame-malformed", `${path}.source`, "must be an object");
  }
  requireInteger(source.watermark?.sequence, `${path}.source.watermark.sequence`, 0);
  requireFiniteNumber(source.watermark?.watermarkMs, `${path}.source.watermark.watermarkMs`, 0);
  requireFiniteNumber(source.generatedAtMs, `${path}.source.generatedAtMs`, 0);
  if (typeof source.footballState !== "boolean") {
    throw new SceneEvaluationError(
      "frame-malformed",
      `${path}.source.footballState`,
      `must be a boolean (got ${JSON.stringify(source.footballState)})`,
    );
  }
  requireString(source.sceneSchemaVersion, `${path}.source.sceneSchemaVersion`);
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
      throw new SceneEvaluationError("frame-malformed", `${path}.markers[${m}]`, "must be an object");
    }
    requireInteger(marker.sequence, `${path}.markers[${m}].sequence`, 1);
    requireString(marker.eventId, `${path}.markers[${m}].eventId`);
    requireString(marker.eventTypeRef, `${path}.markers[${m}].eventTypeRef`);
    requireFiniteNumber(marker.eventTimeMs, `${path}.markers[${m}].eventTimeMs`, 0);
    if (typeof marker.displayed !== "boolean") {
      throw new SceneEvaluationError(
        "frame-malformed",
        `${path}.markers[${m}].displayed`,
        `must be a boolean (got ${JSON.stringify(marker.displayed)})`,
      );
    }
    requireString(marker.text, `${path}.markers[${m}].text`);
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
  requireString(hud.cameraLabel, `${path}.hud.cameraLabel`);
  if (!Array.isArray(hud.eventChips) || hud.eventChips.some((chip) => typeof chip !== "string")) {
    throw new SceneEvaluationError(
      "frame-malformed",
      `${path}.hud.eventChips`,
      "must be an array of strings",
    );
  }
  requireInteger(hud.markersNotDisplayed, `${path}.hud.markersNotDisplayed`, 0);
  // Possession.
  if (entry.possession !== null) {
    const possession = entry.possession;
    if (!isRecord(possession)) {
      throw new SceneEvaluationError("frame-malformed", `${path}.possession`, "must be an object or null");
    }
    requireEnum(possession.status, UNCERTAINTY_STATUSES, `${path}.possession.status`);
    if (possession.entityId !== undefined) {
      requireString(possession.entityId, `${path}.possession.entityId`);
    }
    if (possession.confidence !== undefined) {
      requireFiniteNumber(possession.confidence, `${path}.possession.confidence`, 0);
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
    requireString(entity.entityId, `${path}.entities[${e}].entityId`);
    requireEnum(entity.kind, ENTITY_KINDS, `${path}.entities[${e}].kind`);
    requireInteger(entity.version, `${path}.entities[${e}].version`, 1);
    requireFiniteNumber(entity.lastEventTimeMs, `${path}.entities[${e}].lastEventTimeMs`, 0);
    requireEnum(entity.sceneDisposition, SCENE_DISPOSITIONS, `${path}.entities[${e}].sceneDisposition`);
    requireEnum(entity.renderDisposition, RENDER_DISPOSITIONS, `${path}.entities[${e}].renderDisposition`);
    if (entity.positionMeters !== undefined) {
      const position = entity.positionMeters;
      if (!isRecord(position)) {
        throw new SceneEvaluationError(
          "frame-malformed",
          `${path}.entities[${e}].positionMeters`,
          "must be an object",
        );
      }
      requireFiniteNumber(position.x, `${path}.entities[${e}].positionMeters.x`);
      requireFiniteNumber(position.y, `${path}.entities[${e}].positionMeters.y`);
      if (position.z !== undefined) {
        requireFiniteNumber(position.z, `${path}.entities[${e}].positionMeters.z`);
      }
    }
    if (entity.positionProvenance !== undefined) {
      requireEnum(
        entity.positionProvenance,
        ["interpolated", "held"],
        `${path}.entities[${e}].positionProvenance`,
      );
      if (entity.positionProvenance === "held") {
        requireEnum(entity.heldReason, HELD_REASONS, `${path}.entities[${e}].heldReason`);
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
      requireFiniteNumber(entity.headingRadians, `${path}.entities[${e}].headingRadians`);
    }
    if (entity.positionStatus !== undefined) {
      requireEnum(entity.positionStatus, UNCERTAINTY_STATUSES, `${path}.entities[${e}].positionStatus`);
    }
    if (entity.positionConfidence !== undefined) {
      requireFiniteNumber(entity.positionConfidence, `${path}.entities[${e}].positionConfidence`, 0);
    }
    requireEnum(entity.styleKind, STYLE_KINDS, `${path}.entities[${e}].styleKind`);
  }
  return entry as Render3dFrameEntry;
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
  return manifest as AvatarField3dManifest | DirectedRenderManifest;
}

/** Whether the manifest is a W604 directed rundown manifest. */
function isDirectedManifest(
  manifest: AvatarField3dManifest | DirectedRenderManifest,
): manifest is DirectedRenderManifest {
  return Array.isArray((manifest as DirectedRenderManifest).windows);
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
}): ValidatedSceneEvaluationInput {
  const snapshots = validateSnapshots(input.snapshots);
  const eventStream = validateEventStream(input.eventStream);
  const steps = validateSteps(input.steps);

  if (input.output === null || typeof input.output !== "object") {
    throw new SceneEvaluationError("output-malformed", "$.output", "must be a render output object");
  }
  const output = input.output as AvatarField3dRenderOutput | DirectedRenderOutput;
  const manifest = validateManifestEnvelope(output.manifest, "$.output.manifest");
  const sessionId = snapshots[0]!.sessionId;
  if (output.result.sessionId !== sessionId) {
    throw new SceneEvaluationError(
      "alignment-malformed",
      "$.output.result.sessionId",
      `must be "${sessionId}" (the render must belong to the ground-truth session)`,
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
    if (previousOutputTimestamp !== undefined && frames[i]!.outputTimestampMs <= previousOutputTimestamp) {
      throw new SceneEvaluationError(
        "frame-malformed",
        `${path}.outputTimestampMs`,
        `${frames[i]!.outputTimestampMs} <= the previous frame's ${previousOutputTimestamp} — rundown timestamps must strictly increase`,
      );
    }
    previousOutputTimestamp = frames[i]!.outputTimestampMs;
    const interpolation = frames[i]!.entry.interpolation!;
    if (!stepIndexByAtMs.has(interpolation.fromAtMs)) {
      throw new SceneEvaluationError(
        "alignment-malformed",
        `${path}.entry.interpolation.fromAtMs`,
        `${interpolation.fromAtMs} is not any step's atMs — the frame's authority must resolve against the steps`,
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
  };
}
