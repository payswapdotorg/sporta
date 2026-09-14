/**
 * Snapshot → frame resolution (W502): the shared core both render paths use.
 *
 * `resolveFrame` turns ONE validated `WorldSnapshot` plus the ordered
 * events attributed to that frame's caption window into
 *
 * - an {@link SvgFrameInput} (what `composeFrameSvg` draws), and
 * - the frame's manifest entry skeleton (provenance + honest accounting).
 *
 * Honesty rules enforced here (constitution; renderer contract failure
 * behavior):
 *
 * - **No invented positions**: an entity without a usable `pitchPosition`
 *   slot (missing, `unknown`, or valueless) is OMITTED with an accounted
 *   disposition — never a guessed position.
 * - **No coerced positions**: a slot value that is not a finite
 *   `{x, y}` pair is `omitted-invalid-position` (fail-visible accounting,
 *   not a crash and not a silent default).
 * - **Never clamped**: out-of-bounds positions classify into
 *   `rendered-out-of-play` (drawn at the TRUE position) or
 *   `omitted-out-of-play` (true meters recorded in the manifest).
 * - **Confidence verbatim**: slot confidences are copied through and drive
 *   visual weight (opacity) only when present; absent confidence renders
 *   with NO opacity attribute (a neutral no-claim style).
 * - **No invented captions**: only fixed-table phrases; everything else is
 *   accounted as uncaptioned.
 * - **Identity stability**: participant style tokens come from
 *   `animeEntityStyle(entityId)` — a pure function of
 *   (entityId, renderer version).
 */
import type { UncertainValue, WorldEventStreamEntry, WorldSnapshot } from "@sporta/contracts";
import { captionForEvent, formatClock, scorePart, statusLine } from "./captions";
import { classifyPosition, toCanvasRounded } from "./geometry";
import { animeEntityStyle } from "./palette";
import type { AnimeEntityEntry, AnimeFrameCaptions, AnimePossessionEntry } from "./types";
import type { SvgFrameInput, SvgMarker, SvgPossession } from "./svg";

/** The position slot key this renderer consumes (documented per entity kind). */
export const POSITION_SLOT_KEY = "pitchPosition";

/** A finite `{x, y}` pitch point, or `undefined` when the value is not one. */
function asPitchPoint(value: unknown): { x: number; y: number } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.x !== "number" || typeof record.y !== "number") return undefined;
  if (!Number.isFinite(record.x) || !Number.isFinite(record.y)) return undefined;
  return { x: record.x, y: record.y };
}

/** Resolves one entity's position slot into its manifest entry + marker. */
function resolveEntity(
  entityId: string,
  kind: string,
  slot: UncertainValue | undefined,
): { entry: AnimeEntityEntry; marker: SvgMarker | undefined } {
  const base: Omit<AnimeEntityEntry, "disposition"> = {
    entityId,
    kind: kind as AnimeEntityEntry["kind"],
  };
  if (slot !== undefined) {
    base.positionStatus = slot.status;
    if (slot.confidence !== undefined) base.confidence = slot.confidence;
  }
  if (kind !== "participant" && kind !== "ball") {
    return { entry: { ...base, disposition: "not-rendered-kind" }, marker: undefined };
  }
  const noPosition = (): { entry: AnimeEntityEntry; marker: undefined } => ({
    entry: { ...base, disposition: "omitted-no-position" },
    marker: undefined,
  });
  if (slot === undefined || slot.status === "unknown" || slot.value === undefined) {
    return noPosition();
  }
  const position = asPitchPoint(slot.value);
  if (position === undefined) {
    return { entry: { ...base, disposition: "omitted-invalid-position" }, marker: undefined };
  }
  const entry: Omit<AnimeEntityEntry, "disposition"> = {
    ...base,
    positionMeters: { x: position.x, y: position.y },
  };
  const classification = classifyPosition(position);
  if (classification === "out-of-play-off-canvas") {
    return { entry: { ...entry, disposition: "omitted-out-of-play" }, marker: undefined };
  }
  const canvas = toCanvasRounded(position);
  const outOfPlay = classification === "out-of-play-near";
  const style = kind === "participant" ? animeEntityStyle(entityId) : undefined;
  const marker: SvgMarker = {
    entityId,
    kind: kind as "participant" | "ball",
    canvas,
    outOfPlay,
    uncertain: slot.status === "uncertain",
    ...(slot.confidence !== undefined ? { confidence: slot.confidence } : {}),
    ...(style !== undefined ? { style } : {}),
  };
  if (style !== undefined && !outOfPlay) {
    // The identity-stable style token is recorded for in-play participants
    // (out-of-play markers draw the generic out-of-play style instead).
    entry.style = { ...style };
  }
  entry.svgPosition = { x: canvas.x, y: canvas.y };
  return {
    entry: { ...entry, disposition: outOfPlay ? "rendered-out-of-play" : "rendered" },
    marker,
  };
}

/** The possession ring info, matched against the RENDERED participants. */
function resolvePossession(
  snapshot: WorldSnapshot,
  rendered: ReadonlyMap<string, { marker: SvgMarker; kind: string }>,
): AnimePossessionEntry | null {
  const football = snapshot.football;
  if (football === undefined) return null;
  const slot = football.possession;
  const entry: AnimePossessionEntry = {
    status: slot.status,
    ...(slot.confidence !== undefined ? { confidence: slot.confidence } : {}),
    displayed: false,
  };
  if (slot.status === "unknown" || slot.value === undefined) return entry;
  const value = slot.value as { entityId?: unknown };
  if (typeof value.entityId !== "string") return entry;
  const target = rendered.get(value.entityId);
  // The ring is drawn only around a RENDERED participant (possession of an
  // omitted entity, a ball, or a non-participant is accounted, not drawn).
  if (target === undefined || target.kind !== "participant") return entry;
  return { ...entry, entityId: value.entityId, displayed: true };
}

/** What `resolveFrame` produces: the drawable scene + the manifest skeleton. */
export interface ResolvedFrame {
  scene: SvgFrameInput;
  entry: {
    source: {
      watermark: { sequence: number; watermarkMs: number };
      generatedAtMs: number;
      footballState: boolean;
    };
    appliedEventSequences: number[];
    captions: AnimeFrameCaptions;
    possession: AnimePossessionEntry | null;
    entities: AnimeEntityEntry[];
  };
}

/**
 * Resolves one frame: `snapshot` + the caption-window `events` (input
 * order). Pure — a pure function of its arguments (identity-stable styling
 * included). Both render paths (single snapshot, clip steps) call this.
 */
export function resolveFrame(options: {
  snapshot: WorldSnapshot;
  events: readonly WorldEventStreamEntry[];
}): ResolvedFrame {
  const { snapshot, events } = options;
  const markers: SvgMarker[] = [];
  const entities: AnimeEntityEntry[] = [];
  const rendered = new Map<string, { marker: SvgMarker; kind: string }>();
  for (const entity of snapshot.entities) {
    const { entry, marker } = resolveEntity(
      entity.entityId,
      entity.kind,
      entity.state[POSITION_SLOT_KEY],
    );
    entities.push(entry);
    if (marker !== undefined) {
      markers.push(marker);
      rendered.set(entity.entityId, { marker, kind: entity.kind });
    }
  }
  const possession = resolvePossession(snapshot, rendered);
  const possessionScene: SvgPossession | null =
    possession !== null && possession.displayed && possession.entityId !== undefined
      ? {
          entityId: possession.entityId,
          canvas: rendered.get(possession.entityId)!.marker.canvas,
          ...(possession.confidence !== undefined ? { confidence: possession.confidence } : {}),
        }
      : null;

  const captionEvents: AnimeFrameCaptions["events"] = [];
  const uncaptionedEvents: AnimeFrameCaptions["uncaptionedEvents"] = [];
  const appliedEventSequences: number[] = [];
  for (const entry of events) {
    appliedEventSequences.push(entry.sequence);
    const phrase = captionForEvent(entry.event.eventTypeRef);
    if (phrase === undefined) {
      uncaptionedEvents.push({
        sequence: entry.sequence,
        eventId: entry.event.eventId,
        eventTypeRef: entry.event.eventTypeRef,
      });
    } else {
      captionEvents.push({
        sequence: entry.sequence,
        eventId: entry.event.eventId,
        phrase,
      });
    }
  }

  const football = snapshot.football;
  const score = football === undefined ? undefined : scorePart(football.score);
  const captions: AnimeFrameCaptions = {
    statusLine: football === undefined ? null : statusLine(football),
    score:
      football === undefined
        ? null
        : {
            displayed: score !== undefined,
            status: football.score.status.status,
            ...(score !== undefined ? { text: score } : {}),
          },
    clockText: football === undefined ? null : formatClock(football.clock.clockMs),
    events: captionEvents,
    uncaptionedEvents,
  };

  const scene: SvgFrameInput = {
    frameIndex: 0, // the render paths assign the real index
    markers,
    possession: possessionScene,
    statusLine: captions.statusLine,
    eventPhrases: captionEvents.map((event) => event.phrase),
  };

  return {
    scene,
    entry: {
      source: {
        watermark: {
          sequence: snapshot.watermark.sequence,
          watermarkMs: snapshot.watermark.watermarkMs,
        },
        generatedAtMs: snapshot.generatedAtMs,
        footballState: snapshot.football !== undefined,
      },
      appliedEventSequences,
      captions,
      possession,
      entities,
    },
  };
}
