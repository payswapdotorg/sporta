/**
 * Identity flicker metrics over a W502 clip manifest (W503, deliverable 1a).
 *
 * **What "identity flicker" means here (the honest split):**
 *
 * The W502 manifest records, for EVERY frame, EVERY snapshot entity id with
 * an explicit disposition. The dispositions split into:
 *
 * - **drawn**: `rendered`, `rendered-out-of-play` (a marker was drawn);
 * - **justified omissions**: `omitted-no-position`,
 *   `omitted-invalid-position`, `omitted-out-of-play`, `not-rendered-kind`
 *   — HONEST accounting (no invented position, no coerced value, no
 *   off-canvas clamp). A degradation from drawn to a justified omission is
 *   NOT flicker: the renderer reported exactly why the entity is missing.
 * - **absent**: the entity id does not appear in the frame's entity list at
 *   all. The W502 accounting contract (`manifest.frames[i].entities` = EVERY
 *   snapshot entity) means an absent id is UNEXPLAINED — either the renderer
 *   dropped the accounting entry (an accounting breach) or the entity
 *   vanished from the world model mid-clip (an upstream identity break that
 *   pops out of the render). Both are unexplained absence; when the entity
 *   was drawn in the previous frame it is the visual pop-out the product
 *   calls identity flicker.
 *
 * **Style stability** (the measured counterpart of W502's byte-identity
 * proof): the manifest's per-frame `style` token (`{paletteIndex, jersey,
 * trim}`) for each drawn in-play participant is compared across the frames
 * where it appears. Frames without a token (justified omissions, balls,
 * non-participants) break the token series — they are NEVER counted as
 * instability; only a CHANGING token is. `styleStabilityRatio` is
 * stable-token-frames over token-frames (1.0 = perfectly stable; defined as
 * 1.0 when there are no token frames at all — vacuous, not unstable).
 *
 * A second, byte-level measurement ({@link measureStyleByteStability})
 * compares each entity's SVG marker GROUP across the supplied frames with
 * geometry (cx, cy, x, y attributes) and confidence-driven `opacity`
 * stripped: what remains is identity style plus structure, and it must be
 * byte-identical for one entity. This measures, rather than assumes, the
 * property W502's tests prove. It is W502-serialization-specific
 * (`<g data-entity="…">` groups — documented limitation) and is only run
 * when the evaluator was given the SVG frames.
 *
 * Pure functions: no clock, no RNG, no I/O; deep-equal reruns.
 */
import type {
  AnimeClipManifest,
  AnimeEntityDisposition,
  AnimeEntityEntry,
  AnimeFrame,
} from "@sporta/renderer-anime";
import { TemporalEvaluationError, fail } from "./errors";
import { validateManifest } from "./validate";

/** Per-entity identity series: presence, flicker, and style-token stability. */
export interface IdentityEntitySeries {
  entityId: string;
  /** The first-seen entity kind (kind changes are measured in artifacts). */
  kind: string;
  /** The frame index of this entity's first recorded entry. */
  firstFrameIndex: number;
  /** Drawn at frame N (rendered / rendered-out-of-play), absent at N+1. */
  flickerCount: number;
  /** Recorded at frame N (any disposition), absent at N+1. */
  unexplainedAbsenceCount: number;
  /** Absent at frame N, recorded again at N+1 (context; not a defect). */
  reappearanceCount: number;
  /**
   * One entry per frame FROM THE ENTITY'S FIRST APPEARANCE onward, in frame
   * order: the recorded disposition or "absent". Frames before the first
   * appearance are not part of the series (an entity entering the world
   * mid-clip is not a reappearance).
   */
  presence: Array<AnimeEntityDisposition | "absent">;
  /** Frames carrying a style token for this entity. */
  styleTokenFrames: number;
  /** Frames whose token equals the entity's modal (most frequent) token. */
  styleStableFrames: number;
  /** Distinct tokens recorded for this entity (> 1 = unstable styling). */
  distinctStyleTokens: number;
}

/** The identity flicker metrics of one manifest. */
export interface IdentityFlickerMetrics {
  frameCount: number;
  /** Distinct entity ids ever recorded (first-appearance order). */
  entityIds: string[];
  /** Total recorded-then-vanished transitions (any prior disposition). */
  unexplainedAbsenceCount: number;
  /** Total drawn-then-vanished transitions (the visual pop-outs). */
  flickerCount: number;
  /** Total absent-then-recorded transitions (context, not a defect). */
  reappearanceCount: number;
  perEntity: IdentityEntitySeries[];
  /** Total frames carrying any style token. */
  styleTokenFrames: number;
  /** Frames whose token equals the owning entity's modal token. */
  styleStableFrames: number;
  /** Token frames deviating from the modal token (the defect count). */
  styleInstabilityFrames: number;
  /** stable / token frames; 1.0 when no token frames (vacuously stable). */
  styleStabilityRatio: number;
}

/** The canonical string form of a style token (deterministic comparison). */
function styleTokenKey(style: NonNullable<AnimeEntityEntry["style"]>): string {
  return `${style.paletteIndex}:${style.jersey}:${style.trim}`;
}

/** Whether a disposition draws a marker. */
export function isDrawnDisposition(disposition: AnimeEntityDisposition): boolean {
  return disposition === "rendered" || disposition === "rendered-out-of-play";
}

/**
 * Measures identity flicker over a validated clip manifest. Throws
 * `TemporalEvaluationError` (`manifest-malformed`) on structurally invalid
 * input (never measures over a manifest it cannot trust).
 */
export function measureIdentityFlicker(manifest: AnimeClipManifest): IdentityFlickerMetrics {
  validateManifest(manifest);
  const frames = manifest.frames;

  // Entity universe in first-appearance order (deterministic: frames are ordered).
  const order: string[] = [];
  const byId = new Map<
    string,
    { kind: string; presence: Array<AnimeEntityDisposition | "absent">; tokens: string[] }
  >();
  for (const frame of frames) {
    const seenThisFrame = new Set<string>();
    for (const entity of frame.entities) {
      if (!seenThisFrame.has(entity.entityId)) {
        seenThisFrame.add(entity.entityId);
      }
      let record = byId.get(entity.entityId);
      if (record === undefined) {
        record = { kind: entity.kind, presence: [], tokens: [] };
        byId.set(entity.entityId, record);
        order.push(entity.entityId);
      }
    }
    // Presence walk in frame order: every known entity gets an entry per frame.
    for (const entityId of order) {
      const record = byId.get(entityId)!;
      const entry = seenThisFrame.has(entityId)
        ? frame.entities.find((entity) => entity.entityId === entityId)
        : undefined;
      record.presence.push(entry === undefined ? "absent" : entry.disposition);
      if (entry?.style !== undefined) {
        record.tokens.push(styleTokenKey(entry.style));
      }
    }
  }

  // Per-entity transition and style metrics.
  let totalAbsence = 0;
  let totalFlicker = 0;
  let totalReappearance = 0;
  let totalTokenFrames = 0;
  let totalStableFrames = 0;
  const perEntity: IdentityEntitySeries[] = [];
  for (const entityId of order) {
    const record = byId.get(entityId)!;
    let absence = 0;
    let flicker = 0;
    let reappear = 0;
    for (let i = 1; i < record.presence.length; i += 1) {
      const previous = record.presence[i - 1]!;
      const current = record.presence[i]!;
      if (previous !== "absent" && current === "absent") {
        absence += 1;
        if (isDrawnDisposition(previous)) flicker += 1;
      } else if (previous === "absent" && current !== "absent") {
        reappear += 1;
      }
    }
    // Modal token: most frequent; ties broken by first appearance.
    const counts = new Map<string, number>();
    for (const token of record.tokens) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    let modalToken: string | undefined;
    let modalCount = -1;
    for (const [token, count] of counts) {
      if (count > modalCount) {
        modalToken = token;
        modalCount = count;
      }
    }
    const stableFrames = record.tokens.filter((token) => token === modalToken).length;
    totalTokenFrames += record.tokens.length;
    totalStableFrames += stableFrames;
    totalAbsence += absence;
    totalFlicker += flicker;
    totalReappearance += reappear;
    perEntity.push({
      entityId,
      kind: record.kind,
      firstFrameIndex: frames.length - record.presence.length,
      flickerCount: flicker,
      unexplainedAbsenceCount: absence,
      reappearanceCount: reappear,
      presence: record.presence,
      styleTokenFrames: record.tokens.length,
      styleStableFrames: stableFrames,
      distinctStyleTokens: counts.size,
    });
  }

  return {
    frameCount: frames.length,
    entityIds: order,
    unexplainedAbsenceCount: totalAbsence,
    flickerCount: totalFlicker,
    reappearanceCount: totalReappearance,
    perEntity,
    styleTokenFrames: totalTokenFrames,
    styleStableFrames: totalStableFrames,
    styleInstabilityFrames: totalTokenFrames - totalStableFrames,
    styleStabilityRatio: totalTokenFrames === 0 ? 1 : totalStableFrames / totalTokenFrames,
  };
}

// ---------------------------------------------------------------------------
// Byte-level style stability (SVG marker groups)
// ---------------------------------------------------------------------------

/** Per-entity byte-level marker stability over the supplied SVG frames. */
export interface StyleByteEntitySeries {
  entityId: string;
  /** Marker groups found for this entity. */
  groupFrames: number;
  /** Distinct normalized marker-group byte strings (> 1 = unstable). */
  distinctGroups: number;
  /** Groups not byte-identical to the entity's modal group. */
  unstableFrames: number;
}

/** The byte-level style stability metrics (needs the SVG frames). */
export interface StyleByteStability {
  /** Entities with at least one marker group, in first-appearance order. */
  perEntity: StyleByteEntitySeries[];
  /** Total marker groups measured. */
  groupFrames: number;
  /** Groups byte-identical to their entity's modal group. */
  stableFrames: number;
  /** Groups deviating from the modal group (the defect count). */
  unstableFrames: number;
  /** stable / groups; 1.0 when no groups (vacuously stable). */
  stabilityRatio: number;
}

/** Extracts every `<g data-entity="…">…</g>` marker group from an SVG frame. */
function markerGroupsOf(svg: string): Array<{ entityId: string; group: string }> {
  const pattern = /<g data-entity="([^"]+)"[^>]*>([\s\S]*?)<\/g>/g;
  const out: Array<{ entityId: string; group: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(svg)) !== null) {
    out.push({ entityId: match[1]!, group: match[0]! });
  }
  return out;
}

/**
 * Strips geometry and confidence-opacity from a marker group: the `cx`, `cy`,
 * `x`, `y` attributes (positions) and the `opacity` attribute (confidence
 * weight — honest per-frame data, not identity style). What remains is the
 * identity style + structure byte string.
 */
function normalizeMarkerGroup(group: string): string {
  return group.replace(/\s(?:cx|cy|x|y|opacity)="-?\d+(?:\.\d+)?"/g, "");
}

/**
 * Measures byte-level marker style stability across SVG frames. Each
 * entity's `<g data-entity="…">` groups are normalized (geometry + opacity
 * stripped) and compared byte-for-byte; an entity whose normalized group
 * changes between frames has unstable styling.
 *
 * Frames must correspond 1:1 (same order and count) to a manifest's frames
 * — validated by the caller; this function only checks the frames' shape
 * (each must be a string containing at least the SVG root tag).
 */
export function measureStyleByteStability(frames: readonly AnimeFrame[]): StyleByteStability {
  for (let i = 0; i < frames.length; i += 1) {
    const svg = frames[i]!.svg;
    if (typeof svg !== "string" || !svg.startsWith("<svg") || !svg.endsWith("</svg>")) {
      fail(
        "frames-malformed",
        `$.frames[${i}].svg`,
        `must be a complete SVG document string (got ${typeof svg === "string" ? "a non-SVG string" : String(typeof svg)})`,
      );
    }
  }
  const order: string[] = [];
  const groupsById = new Map<string, string[]>();
  for (const frame of frames) {
    for (const { entityId, group } of markerGroupsOf(frame.svg)) {
      let list = groupsById.get(entityId);
      if (list === undefined) {
        list = [];
        groupsById.set(entityId, list);
        order.push(entityId);
      }
      list.push(normalizeMarkerGroup(group));
    }
  }
  let totalGroups = 0;
  let totalStable = 0;
  const perEntity: StyleByteEntitySeries[] = [];
  for (const entityId of order) {
    const groups = groupsById.get(entityId)!;
    const counts = new Map<string, number>();
    for (const group of groups) {
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    let modal: string | undefined;
    let modalCount = -1;
    for (const [group, count] of counts) {
      if (count > modalCount) {
        modal = group;
        modalCount = count;
      }
    }
    const stable = groups.filter((group) => group === modal).length;
    totalGroups += groups.length;
    totalStable += stable;
    perEntity.push({
      entityId,
      groupFrames: groups.length,
      distinctGroups: counts.size,
      unstableFrames: groups.length - stable,
    });
  }
  return {
    perEntity,
    groupFrames: totalGroups,
    stableFrames: totalStable,
    unstableFrames: totalGroups - totalStable,
    stabilityRatio: totalGroups === 0 ? 1 : totalStable / totalGroups,
  };
}

export { TemporalEvaluationError };
