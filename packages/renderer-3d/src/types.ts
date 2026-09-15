/**
 * Public types of the avatar/field 3D prototype (W602 + W603): the clip
 * input (a timeline of W601 scene specifications), the match-timeline input
 * (W603 — snapshots plus interpolation), the frame output (SVG documents
 * through a perspective camera), and the render manifest — the per-frame
 * provenance/accounting document (the W502 manifest posture: every omission
 * accounted, every confidence verbatim, every frame linked back to the
 * scene specification it was rendered from; W603 adds interpolation
 * provenance — INFERRED positions are marked, never claimed observed).
 */
import type { EntityKind, OutputProfile, RenderResult, UncertaintyStatus } from "@sporta/contracts";
import type { SceneEntityDisposition, SceneSpecification } from "@sporta/scene-projection";
import type { AvatarStyle } from "./style";

/**
 * One clip step: a W601 `SceneSpecification` at a timeline position. Each
 * step renders one frame from its OWN spec — real per-snapshot motion, per
 * frame provenance (the W502 clip posture applied to scene documents; the
 * typical construction is `projectScene(stateAt(engine, t).snapshot,
 * { events: eventWindow(...) })` per step — the `@sporta/temporal` +
 * `@sporta/scene-projection` consumer seams).
 */
export interface AvatarField3dClipStep {
  /** The step's position on the canonical media timeline (milliseconds). */
  atMs: number;
  /** The validated scene specification rendered at `atMs`. */
  scene: SceneSpecification;
}

/**
 * One match-timeline step (W603): a clip step plus an optional DECLARED
 * hard boundary. The match path interpolates constant-velocity motion
 * between consecutive steps — never across a declared cut.
 *
 * `sceneCutBefore` follows the W204 tracker-frame `sceneCut` posture: the
 * flag is DECLARED by the caller (upstream knows when the broadcast cut or
 * the replay branch broke), never DETECTED here — no honest detection
 * signal exists inside a `SceneSpecification`, and inventing one would
 * fabricate discontinuity knowledge.
 */
export interface AvatarField3dMatchStep extends AvatarField3dClipStep {
  /**
   * When `true`, the boundary INTO this step is a hard scene cut: frames
   * strictly between the previous step and this one HOLD the previous
   * step's scene verbatim (per-entity `held` provenance, reason
   * `"scene-cut"`), and this step's scene takes effect at its own `atMs`.
   * Default `false`.
   */
  sceneCutBefore?: boolean;
}

/**
 * Why one entity's position was HELD (not interpolated) on a match-path
 * frame — the honest discontinuity vocabulary (accounted, never blended):
 *
 * - `"scene-cut"` — the segment is governed by a declared cut: the whole
 *   scene state is the from-step's verbatim.
 * - `"disposition-change"` — the entity's scene disposition differs
 *   between the bracketing specs (e.g. `projected` → `omitted-no-position`):
 *   the last OBSERVED treatment is held until the next snapshot boundary.
 * - `"position-missing"` — at least one bracketing spec carries no usable
 *   position for the entity (or neither spec places it): a position is
 *   never invented for an unplaced entity.
 * - `"velocity-bound"` — the straight-line segment between the two known
 *   positions implies a speed above the documented physical ceiling for
 *   the entity's kind (a teleport, not motion): the last OBSERVED position
 *   is held rather than animated as a fabricated trajectory.
 * - `"entity-absent-in-to"` — the entity exists in the from-step but not
 *   in the to-step: its last observed state is held (it disappears at the
 *   next snapshot boundary, exactly as the spec says).
 */
export type MatchHeldReason =
  | "scene-cut"
  | "disposition-change"
  | "position-missing"
  | "velocity-bound"
  | "entity-absent-in-to";

/**
 * Per-entity position provenance on a match-path frame (the W205 posture:
 * interpolated state is inference, never observation):
 *
 * - `"interpolated"` — the position was derived by the documented
 *   constant-velocity motion model between the bracketing snapshots'
 *   positions (INFERRED data: the manifest records the pair + fraction at
 *   the frame level; the position is never claimed observed).
 * - `"held"` — the position is the from-spec's VERBATIM value (the last
 *   OBSERVED position; see {@link MatchHeldReason} for why it was not
 *   interpolated).
 */
export type MatchEntityProvenance =
  | { positionProvenance: "interpolated" }
  | { positionProvenance: "held"; heldReason: MatchHeldReason };

/** One entity's interpolation provenance entry (from-step entity order). */
export interface MatchEntityProvenanceEntry {
  entityId: string;
  provenance: MatchEntityProvenance;
}

/**
 * Per-frame match provenance (W603): which snapshot pair a frame came from
 * and at what interpolation fraction. Present on EVERY match-path frame;
 * absent on the W602 paths (whose frames are per-spec verbatim).
 */
export interface Render3dMatchInterpolation {
  /**
   * - `"observed"` — the frame sits exactly on a step's `atMs`: its scene
   *     is that step's spec VERBATIM (all positions observed).
   * - `"interpolated"` — the frame sits strictly between two steps: entity
   *     positions follow the motion model (per-entity provenance marked).
   * - `"held"` — the segment is governed by a declared scene cut: the
   *     from-step's scene is rendered VERBATIM (all entities held).
   */
  kind: "observed" | "interpolated" | "held";
  /** The authoritative (from) step index. */
  fromStepIndex: number;
  /** The bracketing to-step index, when a next step exists. */
  toStepIndex?: number;
  /** The from step's timeline position (milliseconds). */
  fromAtMs: number;
  /** The to step's timeline position, when a next step exists. */
  toAtMs?: number;
  /** The interpolation fraction in (0, 1) for interpolated frames; 0 otherwise. */
  fraction: number;
  /** Whether a declared scene cut governs this frame's segment. */
  sceneCut: boolean;
}

/**
 * How one scene entity was TREATED by the renderer. The vocabulary EXTENDS
 * the scene's own dispositions: the renderer never re-derives slot
 * semantics (it consumes the spec's dispositions verbatim — the
 * `omitted-*` / `not-projected-kind` values pass through unchanged), and
 * adds only CAMERA-SPACE honesty for positioned entities:
 *
 * - `rendered` — scene `projected`, on-screen below the HUD band, drawn;
 * - `rendered-out-of-play` — scene `projected-out-of-bounds`, drawn at its
 *   TRUE projected position with explicit out-of-play styling;
 * - `omitted-off-canvas` — projects outside the drawable region (the
 *   canvas below the HUD band): omitted, TRUE position recorded verbatim;
 * - `omitted-behind-camera` — behind the camera's near plane: omitted,
 *   TRUE position recorded verbatim (never a half-drawn figure).
 */
export type Render3dEntityDisposition =
  | "rendered"
  | "rendered-out-of-play"
  | "omitted-off-canvas"
  | "omitted-behind-camera"
  | "omitted-no-position"
  | "omitted-invalid-position"
  | "omitted-non-pitch-frame"
  | "not-rendered-kind";

/** How the entity's colors were derived (the manifest's style accounting). */
export type Render3dStyleKind =
  /** Identity-stable palette entry — pure function of (styleKey, entityId). */
  | "identity"
  /** The fixed official marker style (officials dress uniformly). */
  | "official-fixed"
  /** The fixed ball style (constant, not hashed). */
  | "ball-fixed"
  /** No style token (omitted or non-figure entities). */
  | "none";

/** Per-entity accounting for one frame (one entry per spec entity). */
export interface Render3dEntityEntry {
  /** The session-scoped entity id, verbatim (the no-flicker measurement key). */
  entityId: string;
  /** The entity's kind, verbatim from the spec. */
  kind: EntityKind;
  /** The entity's version, verbatim (NOT a style input — see style.ts). */
  version: number;
  /** The entity's last event time, verbatim. */
  lastEventTimeMs: number;
  /** The spec's own disposition for this entity, VERBATIM (W601 S3). */
  sceneDisposition: SceneEntityDisposition;
  /** The renderer's treatment (the extended vocabulary above). */
  renderDisposition: Render3dEntityDisposition;
  /**
   * The TRUE position in scene meters, copied VERBATIM from the spec
   * (never clamped, never rounded). Present whenever the spec carried one
   * — including for omitted entities. On INTERPOLATED match frames this
   * is the motion model's INFERRED position (marked by
   * `positionProvenance` below — never a claim of observed data).
   */
  positionMeters?: { x: number; y: number; z?: number };
  /**
   * Match-path provenance of this entry's POSITION (W603): present only
   * on frames whose `interpolation.kind` is `"interpolated"` or
   * `"held"`; absent on observed frames and on every W602 path
   * (verbatim = observed, the default posture). See
   * {@link MatchEntityProvenance}.
   */
  positionProvenance?: "interpolated" | "held";
  /**
   * Why a held entity was not interpolated (present exactly when
   * `positionProvenance === "held"` on a match frame). See
   * {@link MatchHeldReason}.
   */
  heldReason?: MatchHeldReason;
  /** The screen position actually drawn (2-decimal serialization). Drawn dispositions only. */
  screenPosition?: { x: number; y: number };
  /** The camera depth (meters) of the drawn figure. Drawn dispositions only. */
  depthMeters?: number;
  /** Ball only: whether the spec carried the ball's height (`position.z`, or a `height` slot with a usable meters value when the ball is unpositioned). */
  heightCarried?: boolean;
  /** Whether the spec carried a usable `heading` for this entity. */
  headingCarried: boolean;
  /** The heading radians, verbatim, when carried. */
  headingRadians?: number;
  /** The position slot's uncertainty status, verbatim, when the spec carried one. */
  positionStatus?: UncertaintyStatus;
  /** The position slot's confidence, verbatim, when present (drives opacity). */
  positionConfidence?: number;
  /** The identity-stable style token, for identity-styled entities. */
  style?: AvatarStyle;
  /** How the entity's colors were derived. */
  styleKind: Render3dStyleKind;
}

/** One event marker consumed by a frame (the spec's marker, accounted). */
export interface Render3dMarkerEntry {
  /** The marker's stream sequence, verbatim. */
  sequence: number;
  /** The marker's event id, verbatim. */
  eventId: string;
  /** The marker's event type reference, verbatim. */
  eventTypeRef: string;
  /** The marker's event time, verbatim (milliseconds). */
  eventTimeMs: number;
  /** Whether the marker was displayed as an HUD chip. */
  displayed: boolean;
  /** The chip text actually rendered (a fixed phrase or the VERBATIM ref). */
  text: string;
}

/** Possession accounting for one frame (from the spec's score/clock block). */
export interface Render3dPossessionEntry {
  /** The spec's possession status, verbatim. */
  status: UncertaintyStatus;
  /** The possessing entity id, verbatim, when the spec carried one. */
  entityId?: string;
  /** Verbatim possession confidence, when present. */
  confidence?: number;
  /** Whether the ring was drawn (requires a rendered participant). */
  displayed: boolean;
}

/** The HUD annotation state of one frame (all text verbatim-derived). */
export interface Render3dHudState {
  /** The assembled status line, or `null` when the scene has no football state. */
  statusLine: string | null;
  /** The camera-slot annotation (`"CAM · <slotId>"`, slot id verbatim). */
  cameraLabel: string;
  /** The event-chip texts displayed (in marker order, capped). */
  eventChips: string[];
  /** Markers consumed by the frame but beyond the chip cap (accounted). */
  markersNotDisplayed: number;
}

/** Per-frame manifest entry: provenance, markers, HUD, entity accounting. */
export interface Render3dFrameEntry {
  frameIndex: number;
  /** The frame's position on the output timeline (milliseconds). */
  outputTimestampMs: number;
  /** The output window this frame covers on the session timeline. */
  windowMs: { startMs: number; endMs: number };
  /**
   * Match-path interpolation provenance (W603): present on every
   * `render3dMatch` frame (which snapshot pair + fraction the frame came
   * from); ABSENT on the W602 paths (per-spec verbatim frames).
   */
  interpolation?: Render3dMatchInterpolation;
  /** Provenance: the scene specification the frame was rendered from. */
  source: {
    watermark: { sequence: number; watermarkMs: number };
    generatedAtMs: number;
    footballState: boolean;
    /** The W601 scene schema version of the source spec, verbatim. */
    sceneSchemaVersion: string;
  };
  /** Provenance: the marker sequences consumed by this frame (displayed or accounted). */
  appliedMarkerSequences: number[];
  /** EVERY spec marker with its display accounting (never a silent drop). */
  markers: Render3dMarkerEntry[];
  hud: Render3dHudState;
  possession: Render3dPossessionEntry | null;
  /** EVERY spec entity, in spec order, with its dispositions. */
  entities: Render3dEntityEntry[];
}

/** One input marker that fell outside the render window (accounted). */
export interface Render3dSkippedMarker {
  sequence: number;
  eventId: string;
  eventTimeMs: number;
  reason: "before-window" | "after-window";
}

/** The camera block of the render manifest (the framing that was used). */
export interface Render3dCameraBlock {
  /** The slot id, verbatim from the spec's carried camera slot. */
  slotId: string;
  /** The slot position, verbatim (scene meters). */
  position: { x: number; y: number; z: number };
  /** The slot target, verbatim (scene meters). */
  target: { x: number; y: number; z: number };
  /** The renderer's fixed focal length in pixels (a presentation constant). */
  focalPx: number;
  /** The renderer's fixed near-plane distance in meters. */
  nearPlaneMeters: number;
}

/** The clip-level render manifest (the render report). */
export interface AvatarField3dManifest {
  /** The renderer identity and the style configuration recorded verbatim. */
  renderer: {
    rendererId: string;
    rendererVersion: string;
    styleId: string;
    configSchemaVersion: string;
  };
  /** The camera slot the frames were rendered FROM (never chosen). */
  camera: Render3dCameraBlock;
  session: { sessionId: string; snapshotVersion: number; eventsSinceSequence: number };
  output: {
    profile: OutputProfile;
    startMs: number;
    frameIntervalMs: number;
    durationMs: number;
  };
  /** Contract provenance: echoes the request snapshot version + last APPLIED marker sequence. */
  provenance: { snapshotVersion: number; lastEventSequence: number };
  /** Contract watermark after rendering (R6 semantics). */
  watermarkAfter: { watermarkMs: number; sequence: number };
  frames: Render3dFrameEntry[];
  /** Input markers not applied to any frame (empty in the steps path). */
  skippedMarkers: Render3dSkippedMarker[];
  /** Explicit degradation state (mirrored into `RenderResult.rendererHealth`). */
  degradation: { degraded: boolean; reasons: string[] };
}

/** One rendered frame: its index, output timestamp, and full SVG document. */
export interface AvatarField3dFrame {
  frameIndex: number;
  outputTimestampMs: number;
  svg: string;
}

/** Parsed `styleConfig.config` for the avatar/field prototype. */
export interface AvatarField3dStyleConfig {
  /**
   * Rendered clip duration in milliseconds (default 6000; the clip path
   * ignores it — steps set the timeline — and the match path ignores it
   * too: the match timeline's extent is the steps' span plus one frame
   * interval).
   */
  durationMs: number;
  /**
   * The camera slot to render from (default `main-touchline`). Must be one
   * of the spec's carried camera slots — the renderer frames FROM a slot,
   * it never chooses one.
   */
  cameraSlotId: string;
  /** R7 explicit-degradation pattern: force `degraded` with a fixed reason. */
  simulateDegradation: boolean;
}

/** The full W602 prototype render output: contract result + frames + manifest. */
export interface AvatarField3dRenderOutput {
  /** The contract-compliant `RenderResult` (segments reference the frames). */
  result: RenderResult;
  /** The frame sequence, one SVG document per frame. */
  frames: AvatarField3dFrame[];
  /** The render manifest (per-frame provenance/accounting). */
  manifest: AvatarField3dManifest;
}
