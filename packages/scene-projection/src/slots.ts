/**
 * The documented SWM state-slot keys the scene projection READS (W601).
 *
 * `WorldEntity.state` keys are kind-specific and "documented per entity kind
 * by downstream consumers" (the frozen world-model contract) — this module
 * is that documentation for the scene projection. The slot RECONCILIATION
 * rule below closes the seam the G4 exit demo measured
 * (docs/status/work-item-status.md, W504 evidence): W401 fusion writes track
 * positions into the `"position"` slot with a caller-declared
 * `"spatialFrame"` slot, while the @sporta/testing builders (and
 * renderer-anime) use `"pitchPosition"`. The scene projection reads BOTH,
 * with an explicit precedence and an explicit frame guard — a raw fused
 * snapshot therefore projects cleanly (pitch-framed entities) or is honestly
 * accounted (`omitted-non-pitch-frame`), never silently misplaced.
 */
import type { EntityKind, UncertainValue } from "@sporta/contracts";
import { isFiniteNumber } from "./internal";

/**
 * The canonical pitch-frame position slot (used by the @sporta/testing
 * `buildWorldSnapshot` builder and renderer-anime). Its value is a pitch
 * `PitchPoint` `{x, y}` in canonical meters — the KEY names the frame.
 */
export const PITCH_POSITION_SLOT_KEY = "pitchPosition";

/**
 * The W401 fusion position slot (from track observations). The value is a
 * frame-less `{x, y}` — the frame is declared by the SEPARATE
 * {@link SPATIAL_FRAME_SLOT_KEY} slot, so this slot projects ONLY when the
 * frame is established as `"pitch"`.
 */
export const FUSION_POSITION_SLOT_KEY = "position";

/** The W401 fusion spatial-frame declaration slot ("image" | "pitch"). */
export const SPATIAL_FRAME_SLOT_KEY = "spatialFrame";

/**
 * The ball height slot (meters above the pitch plane). Ball entities only —
 * for other kinds a `height` slot is not elevation semantics and is never
 * re-interpreted.
 */
export const HEIGHT_SLOT_KEY = "height";

/**
 * The heading slot (radians in the pitch plane, measured from +x toward +y).
 * Read for every projectable kind, carried verbatim when present.
 */
export const HEADING_SLOT_KEY = "heading";

/** Entity kinds that denote things physically located on the pitch plane. */
export const PROJECTABLE_KINDS = ["participant", "official", "ball"] as const;
export type ProjectableKind = (typeof PROJECTABLE_KINDS)[number];

/** Kinds that sit ON the pitch plane (z = 0, the documented frame constant). */
export const PLANE_KINDS = ["participant", "official"] as const;

/** Whether `kind` denotes something physically located on the pitch plane. */
export function isProjectableKind(kind: EntityKind): kind is ProjectableKind {
  return (PROJECTABLE_KINDS as readonly string[]).includes(kind);
}

/** A finite `{x, y}` pitch point, or `undefined` when the value is not one. */
export function asFinitePitchPoint(value: unknown): { x: number; y: number } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (!isFiniteNumber(record.x) || !isFiniteNumber(record.y)) return undefined;
  return { x: record.x, y: record.y };
}

/** The verbatim slot fields every resolution outcome carries. */
interface SlotFields {
  /** Which documented slot key was consulted. */
  slotKey: "pitchPosition" | "position";
  /** The consulted slot's uncertainty status, verbatim. */
  status: UncertainValue["status"];
  /** The consulted slot's confidence, verbatim, when the slot carried one. */
  confidence?: number;
}

/**
 * The outcome of resolving one entity's position slots (discriminated by
 * `outcome`):
 *
 * - `"point"` — a finite `{x, y}` value, pitch-framed and projectable;
 * - `"no-value"` — the slot is `unknown` or valueless (`omitted-no-position`);
 * - `"invalid-value"` — the value exists but is not a finite `{x, y}` pair
 *   (`omitted-invalid-position`);
 * - `"non-pitch-frame"` — a usable point in the `"position"` slot whose
 *   `spatialFrame` is not established `"pitch"` (`omitted-non-pitch-frame`).
 */
export type PositionSlotResolution =
  | (SlotFields & { outcome: "point"; point: { x: number; y: number } })
  | (SlotFields & { outcome: "no-value" })
  | (SlotFields & { outcome: "invalid-value" })
  | (SlotFields & { outcome: "non-pitch-frame" });

/** Whether the slot has a value to inspect (shape is judged by the caller). */
function hasValue(slot: UncertainValue): boolean {
  return slot.status !== "unknown" && slot.value !== undefined;
}

/** Whether the fusion spatial frame is ESTABLISHED as pitch. */
function frameEstablishedAsPitch(state: Record<string, UncertainValue>): boolean {
  const frame = state[SPATIAL_FRAME_SLOT_KEY];
  return frame !== undefined && frame.status === "known" && frame.value === "pitch";
}

/**
 * Resolves one entity's position slot by the documented precedence:
 *
 * 1. `pitchPosition` when that KEY exists (the key names the pitch frame);
 * 2. otherwise `position` when that KEY exists;
 * 3. otherwise the entity has no consulted position slot at all — the
 *    caller records `omitted-no-position` with NO slot fields;
 *
 * then, for the consulted slot: value usability first (a valueless slot is
 * `no-value`; a non-finite-`{x,y}` value is `invalid-value`), and the frame
 * guard second (the fusion `position` slot projects only when the
 * `spatialFrame` slot is `known "pitch"` — an `image` frame, a missing
 * declaration, or a mere `uncertain "pitch"` candidate is
 * `non-pitch-frame`, never a guessed mapping).
 *
 * There is NO fallback between the two slot keys: a snapshot carrying both
 * is resolved by the canonical `pitchPosition` key alone (documented rule —
 * ambiguity never blends data sources).
 */
export function resolvePositionSlot(
  state: Record<string, UncertainValue>,
): PositionSlotResolution | undefined {
  let slotKey: "pitchPosition" | "position";
  let slot: UncertainValue | undefined;
  if (state[PITCH_POSITION_SLOT_KEY] !== undefined) {
    slotKey = PITCH_POSITION_SLOT_KEY;
    slot = state[PITCH_POSITION_SLOT_KEY];
  } else if (state[FUSION_POSITION_SLOT_KEY] !== undefined) {
    slotKey = FUSION_POSITION_SLOT_KEY;
    slot = state[FUSION_POSITION_SLOT_KEY];
  } else {
    return undefined;
  }
  const fields: SlotFields = {
    slotKey,
    status: slot.status,
    ...(slot.confidence !== undefined ? { confidence: slot.confidence } : {}),
  };
  if (!hasValue(slot)) {
    return { ...fields, outcome: "no-value" };
  }
  const point = asFinitePitchPoint(slot.value);
  if (point === undefined) {
    return { ...fields, outcome: "invalid-value" };
  }
  if (slotKey === FUSION_POSITION_SLOT_KEY && !frameEstablishedAsPitch(state)) {
    return { ...fields, outcome: "non-pitch-frame" };
  }
  return { ...fields, outcome: "point", point: { x: point.x, y: point.y } };
}

/** A carried optional-slot record (height/heading), verbatim. */
export interface CarriedSlot {
  status: UncertainValue["status"];
  /** The verbatim numeric value, present iff the slot carried a finite number. */
  value?: number;
  /** The slot's confidence, verbatim, when present. */
  confidence?: number;
  /**
   * The slot carried a value that is NOT a finite number — accounted in the
   * entity's `invalidSlotKeys`, never coerced.
   */
  unusableValue: boolean;
}

/**
 * Reads an optional numeric slot (height/heading) VERBATIM: the status (and
 * confidence, when present) always; the numeric value only when the slot
 * carried a finite number; `unusableValue` flags a present-but-unusable
 * value for the entity's accounting.
 */
export function readNumericSlot(slot: UncertainValue | undefined): CarriedSlot | undefined {
  if (slot === undefined) return undefined;
  const carried: CarriedSlot = {
    status: slot.status,
    ...(slot.confidence !== undefined ? { confidence: slot.confidence } : {}),
    unusableValue: false,
  };
  if (slot.value !== undefined) {
    if (isFiniteNumber(slot.value)) {
      carried.value = slot.value;
    } else {
      carried.unusableValue = true;
    }
  }
  return carried;
}
