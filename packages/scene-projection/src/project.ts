/**
 * THE projection function (W601): `projectScene(snapshot, options)` — the
 * pure, total, deterministic projection of one SWM snapshot (plus the
 * caller's ordered event tail) into a {@link SceneSpecification}.
 *
 * Purity and determinism (rule S5): no clocks, no RNG, no I/O — the same
 * snapshot plus the same options always produce a deep-equal spec whose
 * canonical serialization (`serializeScene`) is byte-identical. Every output
 * object is FRESH (the input snapshot, its entities, the events, and the
 * camera-slot constants are never shared by reference with the output).
 *
 * Totality (rule S3): every snapshot entity gets exactly one accounted
 * disposition — see `SCENE_ENTITY_DISPOSITIONS` and `./slots.ts` for the
 * documented slot-reading rules (including the W401 fusion
 * `position`/`spatialFrame` reconciliation that closes the seam the G4 exit
 * demo measured). No invented data (rule S2): every emitted number is either
 * a VERBATIM slot value (position, height, heading, score, clock,
 * confidences — never rounded, never averaged) or an explicit documented
 * constant (pitch furniture, camera slots).
 *
 * Fail-loud input validation (the repo convention): a snapshot or event that
 * does not validate against the frozen `@sporta/contracts` schemas throws
 * {@link SceneProjectionError}; events from another session throw; malformed
 * options throw. Malformed DATA inside a valid snapshot never throws — it is
 * accounted (`omitted-invalid-position`, `invalidSlotKeys`, …).
 */
import {
  PITCH_LENGTH_AXIS_METERS,
  PITCH_WIDTH_AXIS_METERS,
  WorldEventStreamEntry,
  WorldSnapshot,
} from "@sporta/contracts";
import type { WorldEntity } from "@sporta/contracts";
import { SceneProjectionError } from "./errors";
import { cloneJson } from "./internal";
import {
  CAMERA_SLOT_IDS,
  CANONICAL_CAMERA_SLOTS,
  CANONICAL_PITCH_FRAME,
  CENTER_CIRCLE_RADIUS_METERS,
  CORNER_ARC_RADIUS_METERS,
  GOAL_AREA_DEPTH_METERS,
  GOAL_CENTER_Y,
  GOAL_HALF_WIDTH_METERS,
  GOAL_HEIGHT_METERS,
  GOAL_WIDTH_METERS,
  PENALTY_AREA_DEPTH_METERS,
  PENALTY_SPOT_DISTANCE_METERS,
  PITCH_CENTER_X,
  PITCH_CENTER_Y,
} from "./constants";
import {
  HEIGHT_SLOT_KEY,
  HEADING_SLOT_KEY,
  PLANE_KINDS,
  isProjectableKind,
  readNumericSlot,
  resolvePositionSlot,
} from "./slots";
import {
  SCENE_SCHEMA_VERSION,
  type SceneCameraSlot,
  type SceneEntity,
  type SceneEventMarker,
  type ScenePitchFurniture,
  type SceneScoreClock,
  type SceneSpecification,
} from "./schema";

/** Options for {@link projectScene}. */
export interface ProjectionOptions {
  /**
   * The ordered event stream entries to project as markers (typically
   * `engine.eventsSince(snapshot.watermark.sequence)` or a temporal
   * `eventWindow` slice). Input order is preserved verbatim; every entry is
   * validated against the frozen contract and must belong to the snapshot's
   * session. Default: no markers.
   */
  events?: readonly WorldEventStreamEntry[];
  /**
   * The camera slots to include, selected from the canonical set. The
   * output lists the selection in CANONICAL order (selection semantics, not
   * reordering). Unknown or duplicate ids throw. Default: every canonical
   * slot.
   */
  cameraSlotIds?: readonly string[];
}

/** Formats zod issues as `path: message; ...` (the repo's reporting shape). */
function issuesOf(error: {
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
}): string {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
}

/** Validates the input snapshot against the frozen contract (fail loud). */
function validateSnapshot(snapshot: WorldSnapshot): WorldSnapshot {
  const check = WorldSnapshot.safeParse(snapshot);
  if (!check.success) {
    throw new SceneProjectionError(
      `projectScene: the snapshot is not a valid WorldSnapshot — ${issuesOf(check.error)}`,
    );
  }
  return check.data;
}

/** Validates one event entry (fail loud) and returns the parsed clone. */
function validateEvent(entry: WorldEventStreamEntry, index: number): WorldEventStreamEntry {
  const check = WorldEventStreamEntry.safeParse(entry);
  if (!check.success) {
    throw new SceneProjectionError(
      `projectScene: options.events[${index}] is not a valid WorldEventStreamEntry — ${issuesOf(check.error)}`,
    );
  }
  return check.data;
}

/** A fresh clone of one canonical camera slot (consumers can never mutate the constants). */
function cloneCameraSlot(slot: (typeof CANONICAL_CAMERA_SLOTS)[number]): SceneCameraSlot {
  return cloneJson(slot);
}

/** Validates the camera-slot selection (fail loud) and resolves it. */
function resolveCameraSlots(cameraSlotIds: readonly string[] | undefined): SceneCameraSlot[] {
  if (cameraSlotIds === undefined) {
    return CANONICAL_CAMERA_SLOTS.map(cloneCameraSlot);
  }
  if (!Array.isArray(cameraSlotIds) || cameraSlotIds.length === 0) {
    throw new SceneProjectionError(
      "projectScene: options.cameraSlotIds must be a non-empty array of camera slot ids (omit it for all slots)",
    );
  }
  const requested = new Set<string>();
  for (const id of cameraSlotIds) {
    if (typeof id !== "string") {
      throw new SceneProjectionError(
        `projectScene: options.cameraSlotIds entries must be strings (got ${String(id)})`,
      );
    }
    if (!CAMERA_SLOT_IDS.includes(id)) {
      throw new SceneProjectionError(
        `projectScene: unknown camera slot id "${id}" (canonical slots: ${CAMERA_SLOT_IDS.join(", ")})`,
      );
    }
    if (requested.has(id)) {
      throw new SceneProjectionError(`projectScene: duplicate camera slot id "${id}"`);
    }
    requested.add(id);
  }
  // Canonical order: the selection is a SET; the output order is the
  // constant set's own order (deterministic regardless of input order).
  return CANONICAL_CAMERA_SLOTS.filter((slot) => requested.has(slot.slotId)).map(cloneCameraSlot);
}

/** Builds the pitch furniture: pure derivation of the IFAB Law 1 constants. */
export function buildPitchFurniture(): ScenePitchFurniture {
  const goalHalf = GOAL_HALF_WIDTH_METERS;
  const penaltyHalf = goalHalf + PENALTY_AREA_DEPTH_METERS;
  const goalAreaHalf = goalHalf + GOAL_AREA_DEPTH_METERS;
  return {
    constantsVersion: "ifab-law1-standard@1",
    goals: [
      {
        goalLine: "x0",
        center: { x: 0, y: GOAL_CENTER_Y },
        widthMeters: GOAL_WIDTH_METERS,
        heightMeters: GOAL_HEIGHT_METERS,
      },
      {
        goalLine: "x105",
        center: { x: PITCH_LENGTH_AXIS_METERS, y: GOAL_CENTER_Y },
        widthMeters: GOAL_WIDTH_METERS,
        heightMeters: GOAL_HEIGHT_METERS,
      },
    ],
    goalAreas: [
      {
        goalLine: "x0",
        bounds: {
          xMin: 0,
          xMax: GOAL_AREA_DEPTH_METERS,
          yMin: GOAL_CENTER_Y - goalAreaHalf,
          yMax: GOAL_CENTER_Y + goalAreaHalf,
        },
      },
      {
        goalLine: "x105",
        bounds: {
          xMin: PITCH_LENGTH_AXIS_METERS - GOAL_AREA_DEPTH_METERS,
          xMax: PITCH_LENGTH_AXIS_METERS,
          yMin: GOAL_CENTER_Y - goalAreaHalf,
          yMax: GOAL_CENTER_Y + goalAreaHalf,
        },
      },
    ],
    penaltyAreas: [
      {
        goalLine: "x0",
        bounds: {
          xMin: 0,
          xMax: PENALTY_AREA_DEPTH_METERS,
          yMin: GOAL_CENTER_Y - penaltyHalf,
          yMax: GOAL_CENTER_Y + penaltyHalf,
        },
      },
      {
        goalLine: "x105",
        bounds: {
          xMin: PITCH_LENGTH_AXIS_METERS - PENALTY_AREA_DEPTH_METERS,
          xMax: PITCH_LENGTH_AXIS_METERS,
          yMin: GOAL_CENTER_Y - penaltyHalf,
          yMax: GOAL_CENTER_Y + penaltyHalf,
        },
      },
    ],
    penaltySpots: [
      { goalLine: "x0", position: { x: PENALTY_SPOT_DISTANCE_METERS, y: GOAL_CENTER_Y } },
      {
        goalLine: "x105",
        position: { x: PITCH_LENGTH_AXIS_METERS - PENALTY_SPOT_DISTANCE_METERS, y: GOAL_CENTER_Y },
      },
    ],
    centerCircle: {
      center: { x: PITCH_CENTER_X, y: PITCH_CENTER_Y },
      radiusMeters: CENTER_CIRCLE_RADIUS_METERS,
    },
    centerMark: { position: { x: PITCH_CENTER_X, y: PITCH_CENTER_Y } },
    cornerArcs: [
      {
        corner: "x0y0",
        center: { x: 0, y: 0 },
        radiusMeters: CORNER_ARC_RADIUS_METERS,
      },
      {
        corner: "x105y0",
        center: { x: PITCH_LENGTH_AXIS_METERS, y: 0 },
        radiusMeters: CORNER_ARC_RADIUS_METERS,
      },
      {
        corner: "x0y68",
        center: { x: 0, y: PITCH_WIDTH_AXIS_METERS },
        radiusMeters: CORNER_ARC_RADIUS_METERS,
      },
      {
        corner: "x105y68",
        center: { x: PITCH_LENGTH_AXIS_METERS, y: PITCH_WIDTH_AXIS_METERS },
        radiusMeters: CORNER_ARC_RADIUS_METERS,
      },
    ],
  };
}

/** Whether a point is inside the INCLUSIVE play bounds [0, 105] × [0, 68]. */
function inPlayBounds(point: { x: number; y: number }): boolean {
  return (
    point.x >= 0 &&
    point.x <= PITCH_LENGTH_AXIS_METERS &&
    point.y >= 0 &&
    point.y <= PITCH_WIDTH_AXIS_METERS
  );
}

/**
 * Projects ONE snapshot entity into its scene entry (the shared core of
 * `projectScene` and the conformance harness's verbatim re-derivation).
 * Pure; emits a fresh object.
 */
export function resolveSceneEntity(entity: WorldEntity): SceneEntity {
  const state = entity.state;
  const projectable = isProjectableKind(entity.kind);
  const resolution = projectable ? resolvePositionSlot(state) : undefined;

  let disposition: SceneEntity["disposition"];
  let position: { x: number; y: number; z?: number } | undefined;
  if (!projectable) {
    disposition = "not-projected-kind";
  } else if (resolution === undefined || resolution.outcome === "no-value") {
    disposition = "omitted-no-position";
  } else if (resolution.outcome === "invalid-value") {
    disposition = "omitted-invalid-position";
  } else if (resolution.outcome === "non-pitch-frame") {
    disposition = "omitted-non-pitch-frame";
  } else {
    const point = resolution.point;
    disposition = inPlayBounds(point) ? "projected" : "projected-out-of-bounds";
    if ((PLANE_KINDS as readonly string[]).includes(entity.kind)) {
      // Rule S4: non-ball entities sit ON the pitch plane — z = 0 is the
      // documented frame constant (the plane's own definition), not data.
      position = { x: point.x, y: point.y, z: 0 };
    } else {
      // The ball: z IS its carried height (rule S6) — set below, after the
      // height slot is read; absent when the SWM carries none (never faked).
      position = { x: point.x, y: point.y };
    }
  }

  // Ball height: verbatim, whenever the slot exists on a ball entity.
  let height: SceneEntity["height"];
  const heightSlot = entity.kind === "ball" ? state[HEIGHT_SLOT_KEY] : undefined;
  const carriedHeight = readNumericSlot(heightSlot);
  if (carriedHeight !== undefined) {
    height = {
      status: carriedHeight.status,
      ...(carriedHeight.value !== undefined ? { meters: carriedHeight.value } : {}),
      ...(carriedHeight.confidence !== undefined ? { confidence: carriedHeight.confidence } : {}),
    };
    if (position !== undefined && carriedHeight.value !== undefined) {
      position = { ...position, z: carriedHeight.value };
    }
  }

  // Heading: verbatim, whenever the slot exists on a projectable entity.
  let heading: SceneEntity["heading"];
  const headingSlot = projectable ? state[HEADING_SLOT_KEY] : undefined;
  const carriedHeading = readNumericSlot(headingSlot);
  if (carriedHeading !== undefined) {
    heading = {
      status: carriedHeading.status,
      ...(carriedHeading.value !== undefined ? { radians: carriedHeading.value } : {}),
      ...(carriedHeading.confidence !== undefined ? { confidence: carriedHeading.confidence } : {}),
    };
  }

  const invalidSlotKeys: SceneEntity["invalidSlotKeys"] = [];
  if (carriedHeight?.unusableValue) invalidSlotKeys.push("height");
  if (carriedHeading?.unusableValue) invalidSlotKeys.push("heading");

  return {
    entityId: entity.entityId,
    kind: entity.kind,
    version: entity.version,
    lastEventTimeMs: entity.lastEventTimeMs,
    disposition,
    ...(position !== undefined ? { position } : {}),
    ...(resolution !== undefined ? { positionSlotKey: resolution.slotKey } : {}),
    ...(resolution !== undefined ? { positionStatus: resolution.status } : {}),
    ...(resolution?.confidence !== undefined ? { positionConfidence: resolution.confidence } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(heading !== undefined ? { heading } : {}),
    ...(invalidSlotKeys.length > 0 ? { invalidSlotKeys } : {}),
  };
}

/** Projects the snapshot's football extension into the display state (verbatim). */
export function resolveScoreClock(snapshot: WorldSnapshot): SceneScoreClock {
  const football = snapshot.football;
  if (football === undefined) {
    return { footballState: false };
  }
  const possession = football.possession;
  return {
    footballState: true,
    score: cloneJson(football.score),
    clock: cloneJson(football.clock),
    possession: {
      status: possession.status,
      ...(possession.value !== undefined ? { value: cloneJson(possession.value) } : {}),
      ...(possession.confidence !== undefined ? { confidence: possession.confidence } : {}),
    },
    eventTaxonomyVersion: football.eventTaxonomyVersion,
  };
}

/** Projects one event stream entry into a marker (verbatim + anchoring). */
function toMarker(entry: WorldEventStreamEntry): SceneEventMarker {
  return {
    sequence: entry.sequence,
    snapshotVersionAfter: entry.snapshotVersionAfter,
    event: cloneJson(entry.event),
    anchoring: "timeline",
  };
}

/**
 * Projects one SWM snapshot (plus options) into a deterministic 3D scene
 * specification. Pure and total; see the module docblock.
 */
export function projectScene(
  snapshot: WorldSnapshot,
  options: ProjectionOptions = {},
): SceneSpecification {
  if (options === null || typeof options !== "object") {
    throw new SceneProjectionError("projectScene: options must be a ProjectionOptions object");
  }
  const valid = validateSnapshot(snapshot);

  const events: SceneEventMarker[] = [];
  const inputEvents = options.events;
  if (inputEvents !== undefined) {
    if (!Array.isArray(inputEvents)) {
      throw new SceneProjectionError(
        "projectScene: options.events must be an array of WorldEventStreamEntry",
      );
    }
    for (let i = 0; i < inputEvents.length; i += 1) {
      const entry = validateEvent(inputEvents[i]!, i);
      if (entry.event.sessionId !== valid.sessionId) {
        throw new SceneProjectionError(
          `projectScene: options.events[${i}] (eventId "${entry.event.eventId}") belongs to session ` +
            `"${entry.event.sessionId}", not the snapshot's session "${valid.sessionId}" — event markers ` +
            "must not be mixed across sessions",
        );
      }
      events.push(toMarker(entry));
    }
  }

  const cameraSlots = resolveCameraSlots(options.cameraSlotIds);

  const football = valid.football;
  const pitch: SceneSpecification["world"]["pitch"] = {
    frame: football !== undefined ? cloneJson(football.pitch) : cloneJson(CANONICAL_PITCH_FRAME),
    frameSource:
      football !== undefined ? ("snapshot-football" as const) : ("contracts-constant" as const),
    bounds: { xMin: 0, xMax: PITCH_LENGTH_AXIS_METERS, yMin: 0, yMax: PITCH_WIDTH_AXIS_METERS },
    planeZMeters: 0,
    furniture: buildPitchFurniture(),
  };

  return {
    sceneSchemaVersion: SCENE_SCHEMA_VERSION,
    sessionId: valid.sessionId,
    source: {
      schemaVersion: valid.schemaVersion,
      watermark: cloneJson(valid.watermark),
      generatedAtMs: valid.generatedAtMs,
      footballState: football !== undefined,
      entityCount: valid.entities.length,
    },
    world: {
      coordinateSystem: {
        units: "meters",
        handedness: "right-handed",
        origin: "pitch-corner-0-0-0",
        axes: { x: "touchline", y: "goal-line", z: "up" },
      },
      pitch,
    },
    entities: valid.entities.map(resolveSceneEntity),
    scoreClock: resolveScoreClock(valid),
    eventMarkers: events,
    cameraSlots,
  };
}
