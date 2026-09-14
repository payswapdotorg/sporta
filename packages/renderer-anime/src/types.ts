/**
 * Public types of the anime renderer prototype (W502): the clip input
 * (a timeline of SWM snapshots + per-step event windows), the frame output
 * (SVG documents), and the render manifest — the per-frame accounting
 * document W503 (temporal consistency evaluation) will measure identity
 * flicker from, so EVERY frame records its entity ids explicitly.
 *
 * The manifest is the "render report" the renderer contract's degradation
 * semantics require: every omission is accounted (entity dispositions),
 * every skipped event is listed, every confidence is copied verbatim from
 * the SWM snapshot (never invented), and every frame links back to the SWM
 * watermark/event sequences it was synthesized from.
 */
import type {
  EntityKind,
  OutputProfile,
  RenderResult,
  UncertaintyStatus,
  WorldEventStreamEntry,
  WorldSnapshot,
} from "@sporta/contracts";

/**
 * One clip step: an SWM snapshot at a timeline position plus the ordered
 * event-stream entries to render as that step's caption window (typically
 * produced with `@sporta/temporal` `stateAt` + `eventWindow` — the W402
 * consumer seams).
 */
export interface AnimeClipStep {
  /** The step's position on the canonical media timeline (milliseconds). */
  atMs: number;
  /** The best-known coherent state at `atMs` (e.g. `stateAt(engine, atMs).snapshot`). */
  snapshot: WorldSnapshot;
  /** Ordered events attributed to this step's caption window (input order preserved). */
  events: WorldEventStreamEntry[];
}

/**
 * How one snapshot entity was treated in one frame. Dispositions are
 * exhaustive and recorded for EVERY entity in the snapshot — W503's
 * per-frame entity presence accounting.
 */
export type AnimeEntityDisposition =
  /** In play: drawn at its true position with normal styling. */
  | "rendered"
  /**
   * Out of pitch bounds but within the drawable canvas: drawn at its TRUE
   * position with explicit out-of-play styling (never clamped).
   */
  | "rendered-out-of-play"
  /**
   * Out of pitch bounds beyond the drawable canvas (or over the caption
   * band): omitted, true position recorded verbatim in the manifest.
   */
  | "omitted-out-of-play"
  /**
   * No `pitchPosition` slot, or the slot's status is `unknown`, or the slot
   * carries no value: omitted (never invented).
   */
  | "omitted-no-position"
  /** The slot's value is not a finite `{x, y}` number pair: omitted (never coerced). */
  | "omitted-invalid-position"
  /** Entity kind is neither `participant` nor `ball`: not rendered (accounted). */
  | "not-rendered-kind";

/** Per-entity accounting for one frame (one entry per snapshot entity). */
export interface AnimeEntityEntry {
  /** The session-scoped entity id, verbatim (W503 flicker measurement key). */
  entityId: string;
  /** The entity's kind, verbatim from the snapshot. */
  kind: EntityKind;
  /** How the entity was treated in this frame. */
  disposition: AnimeEntityDisposition;
  /**
   * The TRUE pitch-space position in meters, copied verbatim from the
   * snapshot (never clamped, never rounded). Present whenever a numeric
   * position exists — including for omitted out-of-play entities.
   */
  positionMeters?: { x: number; y: number };
  /** The canvas position actually drawn (2-decimal serialization). Rendered dispositions only. */
  svgPosition?: { x: number; y: number };
  /** The position slot's uncertainty status, when a slot exists. */
  positionStatus?: UncertaintyStatus;
  /** The position slot's confidence, verbatim, when present (drives opacity). */
  confidence?: number;
  /**
   * The identity-stable style token (participants only; the ball style is
   * fixed and versioned with the renderer). Constant across frames for a
   * given entityId — the no-flicker proof artifact.
   */
  style?: { paletteIndex: number; jersey: string; trim: string };
}

/** One captioned event in a frame (phrase from the fixed table). */
export interface AnimeCaptionEvent {
  sequence: number;
  eventId: string;
  phrase: string;
}

/** One event consumed by a frame but not captioned (no invented phrase). */
export interface AnimeUncaptionedEvent {
  sequence: number;
  eventId: string;
  eventTypeRef: string;
}

/** The caption accounting for one frame. */
export interface AnimeFrameCaptions {
  /** The assembled status line, or `null` when the snapshot has no football state. */
  statusLine: string | null;
  /** The score part and whether it was displayed; `null` when no football state exists. */
  score: { displayed: boolean; status: UncertaintyStatus; text?: string } | null;
  /** The clock text (`MM:SS`), or `null` when no football state exists. */
  clockText: string | null;
  /** Captioned events in input order. */
  events: AnimeCaptionEvent[];
  /** Events consumed by the frame that have no caption phrase (accounted). */
  uncaptionedEvents: AnimeUncaptionedEvent[];
}

/** Possession accounting for one frame (from the snapshot's football state). */
export interface AnimePossessionEntry {
  status: UncertaintyStatus;
  entityId?: string;
  /** Verbatim possession confidence, when present. */
  confidence?: number;
  /** Whether the possession ring was drawn (requires a rendered participant). */
  displayed: boolean;
}

/** Per-frame manifest entry: provenance, captions, and entity accounting. */
export interface AnimeFrameEntry {
  frameIndex: number;
  /** The frame's position on the output timeline (milliseconds). */
  outputTimestampMs: number;
  /** The output window this frame covers on the session timeline. */
  windowMs: { startMs: number; endMs: number };
  /** Provenance: the SWM snapshot the frame was synthesized from. */
  source: {
    watermark: { sequence: number; watermarkMs: number };
    generatedAtMs: number;
    footballState: boolean;
  };
  /** Provenance: the input event sequences consumed by this frame (displayed or accounted). */
  appliedEventSequences: number[];
  captions: AnimeFrameCaptions;
  /** Possession accounting, or `null` when the snapshot has no football state. */
  possession: AnimePossessionEntry | null;
  /** EVERY snapshot entity, in snapshot order, with its disposition. */
  entities: AnimeEntityEntry[];
}

/** One input event that fell outside the render window (accounted, never silent). */
export interface AnimeSkippedEvent {
  sequence: number;
  eventId: string;
  eventTimeMs: number;
  reason: "before-window" | "after-window";
}

/** The clip-level render manifest (the render report). */
export interface AnimeClipManifest {
  /** The renderer identity and the style configuration recorded verbatim. */
  renderer: {
    rendererId: string;
    rendererVersion: string;
    styleId: string;
    configSchemaVersion: string;
  };
  session: { sessionId: string; snapshotVersion: number; eventsSinceSequence: number };
  output: {
    profile: OutputProfile;
    startMs: number;
    frameIntervalMs: number;
    durationMs: number;
  };
  /** Contract provenance: echoes the request snapshot version + last APPLIED event sequence. */
  provenance: { snapshotVersion: number; lastEventSequence: number };
  /** Contract watermark after rendering (R6 semantics). */
  watermarkAfter: { watermarkMs: number; sequence: number };
  frames: AnimeFrameEntry[];
  /** Input events not applied to any frame (empty in the steps path). */
  skippedEvents: AnimeSkippedEvent[];
  /** Explicit degradation state (mirrored into `RenderResult.rendererHealth`). */
  degradation: { degraded: boolean; reasons: string[] };
}

/** One rendered frame: its index, output timestamp, and full SVG document. */
export interface AnimeFrame {
  frameIndex: number;
  outputTimestampMs: number;
  svg: string;
}

/** Parsed `styleConfig.config` for the anime prototype. */
export interface AnimeStyleConfig {
  /** Rendered clip duration in milliseconds (default 6000; clip path ignores it). */
  durationMs: number;
  /** R7 explicit-degradation pattern: force `degraded` with a fixed reason. */
  simulateDegradation: boolean;
}

/** The full W502 prototype render output: contract result + frames + manifest. */
export interface AnimeRenderOutput {
  /** The contract-compliant `RenderResult` (segments reference the frames). */
  result: RenderResult;
  /** The frame sequence, one SVG document per frame. */
  frames: AnimeFrame[];
  /** The render manifest (per-frame provenance/accounting — the W503 source). */
  manifest: AnimeClipManifest;
}
