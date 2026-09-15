/**
 * THE match-progression motion model (W603): deterministic interpolation
 * between consecutive W601 scene specifications.
 *
 * Work item W603: "match progression rendered from SWM rather than
 * replaying broadcast pixels." This module owns the documented MOTION
 * MODEL — everything the match render path (`./render.ts` `render3dMatch`)
 * derives between two consecutive snapshots' known positions:
 *
 * ## The motion model (documented, deterministic)
 *
 * - **Constant-velocity segments.** For an entity placed (`projected` or
 *   `projected-out-of-bounds`) in BOTH bracketing specs with the SAME
 *   disposition and usable positions, an interpolated frame at fraction
 *   `f ∈ (0, 1)` of the segment `[t₀, t₁]` places the entity at
 *   `p₀ + f·(p₁ − p₀)` per coordinate — the straight-line constant-velocity
 *   path between the two KNOWN positions. This is INFERRED data (the W205
 *   posture: interpolated state is inference, never observation): the
 *   render manifest marks every interpolated position with
 *   `positionProvenance: "interpolated"` and every frame with the snapshot
 *   pair + fraction it came from (`./types.ts`).
 * - **Ball height.** `z` interpolates ONLY when BOTH endpoints carry a `z`;
 *   when either endpoint lacks it the interpolated position carries NO `z`
 *   (the W602 height-unknown posture — never a faked 0, never a stale
 *   carried height presented as current).
 * - **Heading is NEVER interpolated.** The from-spec's heading slot is
 *   carried verbatim (rotation has no motion model here — presenting the
 *   last OBSERVED facing is the honest no-claim; a heading model is future
 *   work). Positions interpolate; facings do not invent rotation.
 * - **Confidence/status verbatim.** The from-spec's `positionStatus` /
 *   `positionConfidence` are carried verbatim (the last OBSERVED values);
 *   interpolation adds no confidence model — never invented decay.
 * - **Honest discontinuity handling — nothing is ever blended across a
 *   discontinuity.** An entity's position is HELD at the from-spec's
 *   verbatim value (with an accounted reason, see {@link MatchHeldReason})
 *   whenever:
 *   1. the segment is governed by a DECLARED scene cut
 *      (`AvatarField3dMatchStep.sceneCutBefore` — the W204 declared-flag
 *      posture; the renderer never DETECTS cuts);
 *   2. the entity's scene DISPOSITION differs between the specs
 *      (e.g. `projected` → `omitted-no-position`, or a bounds change);
 *   3. a usable position is missing in either spec (never invented);
 *   4. the implied straight-line speed exceeds the documented physical
 *      ceiling for the entity's kind (a teleport, not motion — animating
 *      it would fabricate a trajectory);
 *   5. the entity is absent from the to-spec (its last observed state is
 *      held; it disappears at the next snapshot boundary).
 *   Entities present only in the TO spec are NOT interpolated into
 *   existence: they first appear at their own step's `atMs`.
 * - **Scene blocks stay verbatim.** The interpolated scene's world,
 *   score/clock, camera slots, source provenance, and event markers are
 *   the FROM spec's verbatim (the last known state — the single-snapshot
 *   honesty posture applied between snapshots). The clock NEVER ticks by
 *   frame time: displayed clock/score state advances at snapshot
 *   boundaries, exactly as the specs state them.
 *
 * Purity: no clocks, no RNG, no I/O; inputs are never mutated (every
 * output object is a fresh clone — the W601 `projectScene` posture). The
 * speed ceilings below re-state the W503 renderer-evaluation derivations
 * (this package stays isolated from that one — the fnv1a32 precedent).
 */
import type { SceneEntity, SceneSpecification } from "@sporta/scene-projection";
import type { MatchEntityProvenance, MatchEntityProvenanceEntry } from "./types";

// ---------------------------------------------------------------------------
// Physical-plausibility bounds (documented derivations; the W503 precedent)
// ---------------------------------------------------------------------------

/**
 * The maximum plausible PLAYER speed used by the motion model:
 * 12.5 m/s — Usain Bolt's Berlin 2009 100 m average was 10.44 m/s with a
 * ~12.4 m/s peak (public athletics record data). Participants and
 * officials (people) interpolate only below this.
 */
export const PLAYER_MAX_SPEED_MPS = 12.5;

/**
 * The maximum plausible BALL speed used by the motion model: 40 m/s — a
 * hard-struck football reaches ~130–140 km/h (≈ 36–39 m/s; public
 * football physics data). 40 m/s covers every legal strike.
 */
export const BALL_MAX_SPEED_MPS = 40;

/**
 * The numerical epsilon added to both ceilings (a position pair implying
 * 12.5 + ε m/s is rounding, not a teleport): 0.01 m/s — the W503
 * `POSITION_EPSILON` derivation (1 cm of positional noise per second).
 */
export const SPEED_EPSILON_MPS = 0.01;

/** The player (participant/official) interpolation speed bound (m/s). */
export const PLAYER_INTERPOLATION_BOUND_MPS = PLAYER_MAX_SPEED_MPS + SPEED_EPSILON_MPS;

/** The ball interpolation speed bound (m/s). */
export const BALL_INTERPOLATION_BOUND_MPS = BALL_MAX_SPEED_MPS + SPEED_EPSILON_MPS;

// ---------------------------------------------------------------------------
// The interpolation core
// ---------------------------------------------------------------------------

/** A synthesized interpolated match frame: the scene + per-entity provenance. */
export interface InterpolatedMatchFrame {
  /**
   * The synthesized scene specification at the interpolated time: the FROM
   * spec's blocks verbatim with entity positions replaced by the motion
   * model's outputs (INFERRED — the renderer's manifest marks them; the
   * spec itself is an internal intermediate, never emitted as observed
   * data). Schema-valid by construction (test-pinned).
   */
  scene: SceneSpecification;
  /** Every from-spec entity's interpolation provenance, in from-spec order. */
  entities: MatchEntityProvenanceEntry[];
}

/** A finite usable position point (the spec's `SceneEntity.position`). */
interface Point3 {
  x: number;
  y: number;
  z?: number;
}

/** The speed bound for one entity kind (people vs the ball). */
function boundForKind(kind: SceneEntity["kind"]): number {
  return kind === "ball" ? BALL_INTERPOLATION_BOUND_MPS : PLAYER_INTERPOLATION_BOUND_MPS;
}

/**
 * Whether the straight-line segment between two known positions implies a
 * plausible speed for the entity's kind (distance includes `z` when both
 * endpoints carry it — the animated path's true length).
 */
function speedWithinBound(
  fromPos: Point3,
  toPos: Point3,
  spanMs: number,
  kind: SceneEntity["kind"],
): boolean {
  const dx = toPos.x - fromPos.x;
  const dy = toPos.y - fromPos.y;
  const dz = fromPos.z !== undefined && toPos.z !== undefined ? toPos.z - fromPos.z : 0;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const speed = distance / (spanMs / 1000);
  return speed <= boundForKind(kind);
}

/**
 * The interpolation decision for ONE from-spec entity against its to-spec
 * counterpart (reason precedence: disposition-change > position-missing >
 * velocity-bound; every other case interpolates). Pure.
 */
function provenanceFor(
  fromEntity: SceneEntity,
  toEntity: SceneEntity | undefined,
  spanMs: number,
): MatchEntityProvenance {
  if (toEntity === undefined) {
    return { positionProvenance: "held", heldReason: "entity-absent-in-to" };
  }
  if (fromEntity.disposition !== toEntity.disposition) {
    return { positionProvenance: "held", heldReason: "disposition-change" };
  }
  if (
    fromEntity.disposition !== "projected" &&
    fromEntity.disposition !== "projected-out-of-bounds"
  ) {
    // Same disposition but not a placed one (omitted-*/not-projected-kind):
    // the spec's own accounting passes through — nothing to interpolate.
    return { positionProvenance: "held", heldReason: "position-missing" };
  }
  const fromPos = fromEntity.position;
  const toPos = toEntity.position;
  if (fromPos === undefined || toPos === undefined) {
    return { positionProvenance: "held", heldReason: "position-missing" };
  }
  if (!speedWithinBound(fromPos, toPos, spanMs, fromEntity.kind)) {
    return { positionProvenance: "held", heldReason: "velocity-bound" };
  }
  return { positionProvenance: "interpolated" };
}

/**
 * Synthesizes the interpolated scene at `fraction` between two consecutive
 * match steps' specifications.
 *
 * The result is a FRESH document (the inputs are never mutated, never
 * shared by reference): the from spec is deep-cloned and its entity
 * positions are replaced by the motion model's outputs. Every other block
 * (world, score/clock, camera slots, source provenance, markers) stays the
 * FROM spec's verbatim — the interpolated frame is the last-known state
 * with inferred positions, never a blend of two scenes' furniture or
 * display state.
 *
 * Fail-loud preconditions (`RangeError`): `fraction` must be a finite
 * number in `(0, 1)` (interpolated frames are strictly between snapshots —
 * the observed endpoints are rendered verbatim by the match path), and
 * `spanMs` a finite number > 0 (the steps' atMs difference).
 */
export function interpolateMatchFrame(options: {
  from: SceneSpecification;
  to: SceneSpecification;
  fraction: number;
  spanMs: number;
}): InterpolatedMatchFrame {
  const { from, to, fraction, spanMs } = options;
  if (
    typeof fraction !== "number" ||
    !Number.isFinite(fraction) ||
    fraction <= 0 ||
    fraction >= 1
  ) {
    throw new RangeError(
      `interpolateMatchFrame: fraction must be a finite number in (0, 1) (got ${String(fraction)}) — observed endpoints render verbatim`,
    );
  }
  if (typeof spanMs !== "number" || !Number.isFinite(spanMs) || spanMs <= 0) {
    throw new RangeError(
      `interpolateMatchFrame: spanMs must be a finite number > 0 (got ${String(spanMs)})`,
    );
  }
  const scene: SceneSpecification = cloneJson(from);
  const toById = new Map<string, SceneEntity>();
  for (const toEntity of to.entities) toById.set(toEntity.entityId, toEntity);
  const entities: MatchEntityProvenanceEntry[] = [];
  scene.entities = from.entities.map((fromEntity) => {
    const cloned: SceneEntity = cloneJson(fromEntity);
    const provenance = provenanceFor(fromEntity, toById.get(fromEntity.entityId), spanMs);
    entities.push({ entityId: fromEntity.entityId, provenance });
    if (provenance.positionProvenance === "interpolated") {
      const toEntity = toById.get(fromEntity.entityId)!;
      const fromPos = fromEntity.position!;
      const toPos = toEntity.position!;
      cloned.position = {
        x: fromPos.x + fraction * (toPos.x - fromPos.x),
        y: fromPos.y + fraction * (toPos.y - fromPos.y),
        ...(fromPos.z !== undefined && toPos.z !== undefined
          ? { z: fromPos.z + fraction * (toPos.z - fromPos.z) }
          : {}),
      };
    }
    return cloned;
  });
  return { scene, entities };
}

/**
 * The per-entity provenance of a HELD frame (a declared scene cut governs
 * the segment): every from-spec entity is held with reason `"scene-cut"`,
 * in from-spec order. The held frame's scene is the from spec VERBATIM (no
 * synthesis) — this helper provides only the accounting.
 */
export function sceneCutHeldProvenance(scene: SceneSpecification): MatchEntityProvenanceEntry[] {
  return scene.entities.map((entity) => ({
    entityId: entity.entityId,
    provenance: { positionProvenance: "held" as const, heldReason: "scene-cut" as const },
  }));
}

/** A deep clone over JSON-safe values (the W601 `cloneJson` posture). */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
