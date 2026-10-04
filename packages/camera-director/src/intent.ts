/**
 * THE provider-neutral camera intent emission (HF014 — the Camera Director
 * integration): `emitCameraIntent(plan, steps, options?)` →
 * {@link CameraIntentDocument}.
 *
 * This module is ADDITIVE to the W604 director: it DERIVES a
 * provider-neutral camera intent/path document FROM an existing
 * {@link CameraPlan} — it never replaces the plan, never re-directs, never
 * invents a slot, a pose, or a decision. The plan (the slot-CUT rundown)
 * stays the single decision surface; the emission is the SAME decision
 * spoken in the pose vocabulary a NEURAL renderer can consume (the
 * procedural renderer consumes the plan through the untouched
 * `./compose.ts` `cameraSlotId` seam — byte-identical, unchanged).
 *
 * ## The pose vocabulary (the hf010 fixture class)
 *
 * The wave's HF010 flight authored the provider-neutral pose vocabulary by
 * hand (`scripts/evidence/hf-portfolio/hf010/fixtures/hf010-camera-paths.json`,
 * `hf010.camera-paths@1`): per-frame `tMs/eye/look/focalMultiplier/
 * sourceFrame` + the window/slot/kind directed-window language. THIS module
 * makes the DIRECTOR emit the same DOCUMENT CLASS from its own CameraPlan:
 * every pose carries exactly those six fields, every window carries the
 * slot/kind provenance, and the document pins the W601 slot geometry it
 * resolved from. The adapter to any specific renderer (which conditioning
 * format, which model) is Technology Plane configuration — the emission
 * carries NO model name, NO provider name, NO conditioning format
 * (architecture-lock §9; docs/architecture/technology-plane.md).
 *
 * ## The slot-to-pose resolution (the honest derivation)
 *
 * Per directed window, the window's canonical slot + the W601 slot geometry
 * (`CANONICAL_CAMERA_SLOTS`, `camera-slots@1`) resolve to a deterministic
 * parametric camera path:
 *
 * - **`slot-hold`** — the ONE intent kind the director's decision vocabulary
 *   can emit. The director's plan is slot CUTS only (POLICY.md §7: the
 *   slots are fixed W601 geometry — no camera motion, no interpolation of
 *   camera positions), so every pose of a window's path carries the SAME
 *   `eye`/`look` — the slot's position/target, verbatim — and
 *   `focalMultiplier` 1.0 (the renderer-3d fixed-focal posture: "the
 *   renderer never zooms"). The motion-intent kinds of the hf010 fixtures
 *   (dolly-in/orbit/pan/crane/zoom-optical/bullet-time-orbit) are the
 *   hand-AUTHORED fixture classes — they stay authored; the director
 *   honestly emits the decision it actually made, never a motion it did
 *   not. (This boundary is the emission's own honest limit, recorded here
 *   and in the evidence: the intent kinds are extensible when the director
 *   gains a motion vocabulary, without changing the pose vocabulary.)
 * - **The frame grid** — poses are sampled uniformly at the emission's
 *   `frameRate` (default {@link DEFAULT_INTENT_FRAME_RATE} 16 fps, the
 *   hf010 fixture cadence): `frameCount = max(1, ceil(duration /
 *   frameIntervalMs))` poses at window-relative `tMs = i ·
 *   frameIntervalMs` — the renderer-3d fixed-rate clip convention, so the
 *   intent grid and the renderer's own frame grid agree by construction.
 *   The CameraPlan itself stays presentation-format-independent data; the
 *   frame rate is an EMISSION parameter (a Technology-Plane cadence
 *   decision), never a plan field.
 * - **`sourceFrame`** — the index (into `steps`) of the last step whose
 *   `atMs` is at or before the frame's source time
 *   (`window.source.startMs + tMs`), clamped to the window's step RUN
 *   `[runStart, runEnd]` (the closed range the composition renders).
 *   Source frames advance monotonically through the window's snapshot run
 *   — the director never freezes match time (bullet time is an hf010
 *   authored-fixture class, not a director decision) and never authors new
 *   time (review windows re-present existing match time).
 * - **Provenance** — every window carries which rule fired
 *   (`decision.ruleId`), the slot geometry version the poses resolved
 *   from (`camera-slots@1`), and the plan's decision record VERBATIM
 *   (`decision`, a structural deep clone — the no-invented-data rule: the
 *   emission quotes the plan, it never re-derives it).
 *
 * ## Admission (fail-closed, the `./compose.ts` posture)
 *
 * The emission re-runs the plan invariant harness (`./selfcheck.ts`
 * `checkCameraPlan`) against the steps — an invalid plan is REFUSED, never
 * partially emitted; the options must carry a finite `frameRate > 0`
 * (`intent-invalid`); and the TOTAL pose count across windows is bounded
 * by the renderer-3d {@link MAX_RENDER_FRAMES} budget (`budget-exceeded`
 * — the same budget the composed procedural render enforces).
 *
 * ## Determinism (the `direct()` doctrine)
 *
 * Pure function: no clock, no RNG, no I/O. The same plan, steps, and
 * options yield a deep-equal, JSON-byte-identical document on every call
 * (object keys are constructed in a fixed literal order; every computed
 * time is quantized to {@link INTENT_POSE_DECIMALS} decimals — the hf010
 * fixture byte-stability convention). Test-pinned.
 */
import { PITCH_LENGTH_AXIS_METERS, PITCH_WIDTH_AXIS_METERS } from "@sporta/contracts";
import { MAX_RENDER_FRAMES } from "@sporta/renderer-3d";
import type { AvatarField3dMatchStep } from "@sporta/renderer-3d";
import { CANONICAL_CAMERA_SLOTS, CAMERA_SLOT_SET_VERSION } from "@sporta/scene-projection";
import { DirectorError } from "./errors";
import { cloneJson, isFiniteNumber, isRecord } from "./internal";
import { checkCameraPlan } from "./selfcheck";
import type {
  CameraPlan,
  CameraPlanSummary,
  DirectorRuleId,
  PresentationKind,
  WindowDecision,
} from "./types";

/**
 * The version of THIS intent document shape. Bumping it is a breaking
 * change to the emission contract (additive fields are a MINOR bump of the
 * document, recorded here).
 */
export const INTENT_DOCUMENT_VERSION = "camera-director.intent@1";

/**
 * The provider-neutral pose vocabulary class this document speaks (the
 * hf010 authored fixture family's version id, quoted as the CLASS — the
 * per-frame `tMs/eye/look/focalMultiplier/sourceFrame` fields + the
 * window/slot/kind directed-window language).
 */
export const INTENT_POSE_VOCABULARY = "hf010.camera-paths@1";

/**
 * The default emission frame rate (16 fps — the hf010 fixture cadence,
 * 62.5 ms frames). A caller overrides it with the consumer's own cadence;
 * the plan itself stays presentation-format-independent.
 */
export const DEFAULT_INTENT_FRAME_RATE = 16;

/**
 * The pose time quantization (3 decimals — the hf010 fixture
 * byte-stability convention: quantized values make the document
 * JSON-byte-stable for any rational frame rate).
 */
export const INTENT_POSE_DECIMALS = 3;

/** The one intent kind the director's decision vocabulary emits today. */
export const INTENT_KIND_SLOT_HOLD = "slot-hold" as const;

/** The emission's determinism doctrine, carried verbatim in the document. */
export const INTENT_DETERMINISM_NOTE =
  "every pose is a pure function of (CameraPlan window, W601 slot geometry, frameRate, frameIndex): " +
  "the slot-hold resolution is exact slot constants (no RNG, no solver, no fitting), times are quantized to 3 decimals, " +
  "and emitCameraIntent(plan, steps, options) is pure — the same inputs yield a JSON-byte-identical document";

/** The emission's source-time convention, carried verbatim in the document. */
export const INTENT_SOURCE_TIME_NOTE =
  "slot-hold source frames advance monotonically through the window's snapshot run " +
  "(the CameraPlan boundary semantics: the boundary snapshot belongs to the window starting there); " +
  "the director never freezes match time (bullet time is an authored hf010 fixture class) and never authors new time";

/** A 3-component position/aim vector in scene coordinates (meters, z up). */
export interface IntentVec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * One pose of a window's camera path — EXACTLY the hf010 pose vocabulary
 * fields (no more, no less: the class is the contract).
 */
export interface CameraIntentPose {
  /** The pose's index within the window's path (0-based, gap-free). */
  frameIndex: number;
  /** The pose's window-relative time (ms; `0` for the first pose). */
  tMs: number;
  /** The camera position (the slot's W601 position, verbatim). */
  eye: IntentVec3;
  /** The camera aim target (the slot's W601 target, verbatim). */
  look: IntentVec3;
  /** The focal multiplier (`1.0` — the fixed-focal posture). */
  focalMultiplier: number;
  /** The source match frame (step index) this output pose presents. */
  sourceFrame: number;
}

/**
 * One window's resolved camera path. The `intentKind` records WHICH
 * parametric resolution produced the poses (today: `slot-hold` only — the
 * honest vocabulary of the director's decisions).
 */
export interface CameraIntentPath {
  /** The parametric resolution class (`"slot-hold"`). */
  intentKind: typeof INTENT_KIND_SLOT_HOLD;
  /** The canonical slot the path is anchored to (=== the window's slot). */
  anchorSlotId: string;
  /** The path's pose count (=== `poses.length`). */
  frameCount: number;
  /** The path's frame interval (ms, `1000 / frameRate`). */
  frameIntervalMs: number;
  /** The emission frame rate (frames per second). */
  fps: number;
  /** The poses, `frameIndex` order. */
  poses: CameraIntentPose[];
}

/**
 * The per-window provenance: which rule fired, which slot geometry the
 * poses resolved from, and the plan's decision record VERBATIM.
 */
export interface CameraIntentWindowProvenance {
  /** Which director rule fired (closed vocabulary, from the plan). */
  ruleId: DirectorRuleId;
  /** The W601 camera-slot constant set the poses resolved from. */
  slotGeometryVersion: string;
  /** The plan's decision record, VERBATIM (structural deep clone). */
  decision: WindowDecision;
}

/** One directed window of the intent document (rundown order). */
export interface CameraIntentWindow {
  /** The window's index in rundown order (verbatim from the plan). */
  index: number;
  /** The presentation kind (verbatim from the plan). */
  kind: PresentationKind;
  /** The match-timeline range this window presents (verbatim, closed). */
  source: { startMs: number; endMs: number };
  /** The canonical W601 camera slot id (verbatim from the plan). */
  cameraSlotId: string;
  /** The provenance record (rule + slot geometry version + decision). */
  provenance: CameraIntentWindowProvenance;
  /** The resolved provider-neutral camera path. */
  path: CameraIntentPath;
}

/**
 * The W601 slot geometry the emission resolved from, echoed per slot (the
 * pose resolution's own input, recorded so a consumer can attribute every
 * pose to a named constant set — the S2 no-invented-data rule).
 */
export interface CameraIntentSlotGeometry {
  slotId: string;
  /** The slot's position (the W601 constant, verbatim). */
  eye: IntentVec3;
  /** The slot's aim target (the W601 constant, verbatim). */
  look: IntentVec3;
}

/** The emission parameters (a Technology-Plane cadence decision). */
export interface IntentEmitOptions {
  /**
   * The frame rate the poses are sampled at (frames per second). Finite
   * and `> 0`; defaults to {@link DEFAULT_INTENT_FRAME_RATE} (16 fps, the
   * hf010 fixture cadence).
   */
  frameRate?: number;
}

/**
 * THE provider-neutral camera intent/path document (HF014): the CameraPlan
 * re-spoken in the hf010 pose vocabulary — one resolved path per directed
 * window, provenance carried verbatim, NO model/provider/conditioning
 * names anywhere (model selection is Technology Plane configuration).
 */
export interface CameraIntentDocument {
  /** The intent document contract version (`camera-director.intent@1`). */
  intentVersion: string;
  /** The pose vocabulary class the document speaks (`hf010.camera-paths@1`). */
  poseVocabulary: string;
  /** The director contract version (verbatim from the plan). */
  directorVersion: string;
  /** The policy identity the plan was directed by (verbatim). */
  policy: { policyId: string; policyVersion: string };
  /** The match timeline extent (verbatim from the plan). */
  timeline: { startMs: number; endMs: number };
  /** The canonical pitch geometry (meters, z up — the W601 frame). */
  pitchGeometry: { lengthXMeters: number; widthYMeters: number; zUp: boolean };
  /** The W601 slot geometry echo (the pose resolution's input). */
  slotGeometry: { constantsVersion: string; slots: CameraIntentSlotGeometry[] };
  /** The emission parameters + doctrine notes. */
  emission: {
    intentKind: typeof INTENT_KIND_SLOT_HOLD;
    frameRate: number;
    frameIntervalMs: number;
    poseQuantizationDecimals: number;
    determinism: string;
    sourceTimeConvention: string;
  };
  /** The directed windows, rundown order (one resolved path each). */
  windows: CameraIntentWindow[];
  /** The plan's accounting summary, VERBATIM (the W605 surface). */
  summary: CameraPlanSummary;
}

/** Quantizes to {@link INTENT_POSE_DECIMALS} decimals (byte-stable JSON). */
function quantizeTime(ms: number): number {
  const factor = 10 ** INTENT_POSE_DECIMALS;
  return Math.round(ms * factor) / factor;
}

/** The W601 slot geometry echo (verbatim constants, fixed key order). */
function slotGeometryEcho(): CameraIntentDocument["slotGeometry"] {
  return {
    constantsVersion: CAMERA_SLOT_SET_VERSION,
    slots: CANONICAL_CAMERA_SLOTS.map((slot) => ({
      slotId: slot.slotId,
      eye: { x: slot.position.x, y: slot.position.y, z: slot.position.z },
      look: { x: slot.target.x, y: slot.target.y, z: slot.target.z },
    })),
  };
}

/** The index of the step whose `atMs === t` (−1 when absent). */
function stepIndexOf(times: readonly number[], t: number): number {
  for (let i = 0; i < times.length; i += 1) {
    if (times[i] === t) return i;
  }
  return -1;
}

/**
 * The source match frame (step index) a window-relative time presents: the
 * last step whose `atMs` is at or before `window.source.startMs + tMs`,
 * clamped to the window's step RUN `[runStart, runEnd]`.
 */
function sourceFrameOf(
  times: readonly number[],
  runStart: number,
  runEnd: number,
  windowStartMs: number,
  tMs: number,
): number {
  let index = runStart;
  const sourceTimeMs = windowStartMs + tMs;
  for (let i = runStart; i <= runEnd; i += 1) {
    if (times[i]! <= sourceTimeMs) index = i;
    else break;
  }
  return index;
}

/**
 * THE provider-neutral camera intent emission (HF014): derives the
 * hf010-pose-vocabulary intent/path document from a directed
 * {@link CameraPlan}. Pure and deterministic — the same plan, steps, and
 * options yield a JSON-byte-identical document on every call
 * (test-pinned). ADDITIVE: the plan is never replaced, mutated, or
 * re-directed; the procedural composition path (`./compose.ts`) is
 * untouched and stays byte-identical.
 *
 * @throws {@link DirectorError} (`intent-invalid`) when the options carry
 *   a non-finite or non-positive `frameRate`; (`plan-invalid`) when the
 *   plan fails the documented invariants against these steps (the
 *   composition admission posture); and (`budget-exceeded`) when the
 *   emission implies more than {@link MAX_RENDER_FRAMES} poses — the same
 *   frame budget the composed procedural render enforces.
 */
export function emitCameraIntent(
  plan: CameraPlan,
  steps: readonly AvatarField3dMatchStep[],
  options: IntentEmitOptions = {},
): CameraIntentDocument {
  // Admission 1: the options (the emission's own input shape).
  if (!isRecord(options)) {
    throw new DirectorError("intent-invalid", "options must be an object when present", {
      options: String(options),
    });
  }
  const frameRate = options.frameRate ?? DEFAULT_INTENT_FRAME_RATE;
  if (!isFiniteNumber(frameRate) || frameRate <= 0) {
    throw new DirectorError(
      "intent-invalid",
      `frameRate must be a finite number > 0 (got ${String(frameRate)})`,
      { frameRate: String(frameRate) },
    );
  }
  const frameIntervalMs = 1000 / frameRate;

  // Admission 2: the plan invariants against the steps (compose posture).
  const check = checkCameraPlan(plan, steps);
  if (!check.ok) {
    throw new DirectorError("plan-invalid", "the camera plan violates its documented invariants", {
      violations: check.violations,
    });
  }
  const times = steps.map((step) => step.atMs);

  // Admission 3: the pose budget (the composed-render budget, mirrored).
  let poseCount = 0;
  for (const window of plan.windows) {
    const durationMs = window.source.endMs - window.source.startMs;
    poseCount += Math.max(1, Math.ceil(durationMs / frameIntervalMs));
  }
  if (poseCount > MAX_RENDER_FRAMES) {
    throw new DirectorError(
      "budget-exceeded",
      `the intent emission implies ${poseCount} poses at a ${frameIntervalMs} ms interval, beyond the per-render budget of ${MAX_RENDER_FRAMES} frames — reduce the timeline or the frame rate`,
      { poseCount, frameIntervalMs, maxRenderFrames: MAX_RENDER_FRAMES },
    );
  }

  // The windows: one resolved slot-hold path per directed window.
  const slotById = new Map(CANONICAL_CAMERA_SLOTS.map((slot) => [slot.slotId, slot]));
  const windows: CameraIntentWindow[] = plan.windows.map((window) => {
    const slot = slotById.get(window.cameraSlotId);
    if (slot === undefined) {
      // Defense in depth: the plan admission already pins canonical slot
      // ids; an unknown id here is a bug, never an invented geometry.
      throw new DirectorError("plan-invalid", `window ${window.index} carries an unknown slot`, {
        windowIndex: window.index,
        cameraSlotId: window.cameraSlotId,
      });
    }
    const runStart = stepIndexOf(times, window.source.startMs);
    const runEnd = stepIndexOf(times, window.source.endMs);
    const durationMs = window.source.endMs - window.source.startMs;
    const frameCount = Math.max(1, Math.ceil(durationMs / frameIntervalMs));
    const poses: CameraIntentPose[] = [];
    for (let i = 0; i < frameCount; i += 1) {
      const tMs = quantizeTime(i * frameIntervalMs);
      poses.push({
        frameIndex: i,
        tMs,
        // The slot-hold resolution: the W601 constants, verbatim, every frame.
        eye: { x: slot.position.x, y: slot.position.y, z: slot.position.z },
        look: { x: slot.target.x, y: slot.target.y, z: slot.target.z },
        focalMultiplier: 1.0,
        sourceFrame: sourceFrameOf(times, runStart, runEnd, window.source.startMs, tMs),
      });
    }
    return {
      index: window.index,
      kind: window.kind,
      source: { startMs: window.source.startMs, endMs: window.source.endMs },
      cameraSlotId: window.cameraSlotId,
      provenance: {
        ruleId: window.decision.ruleId,
        slotGeometryVersion: CAMERA_SLOT_SET_VERSION,
        decision: cloneJson(window.decision),
      },
      path: {
        intentKind: INTENT_KIND_SLOT_HOLD,
        anchorSlotId: window.cameraSlotId,
        frameCount,
        frameIntervalMs,
        fps: frameRate,
        poses,
      },
    };
  });

  // Fixed literal key order everywhere above → JSON-byte-stable document.
  return {
    intentVersion: INTENT_DOCUMENT_VERSION,
    poseVocabulary: INTENT_POSE_VOCABULARY,
    directorVersion: plan.directorVersion,
    policy: { policyId: plan.policy.policyId, policyVersion: plan.policy.policyVersion },
    timeline: { startMs: plan.timeline.startMs, endMs: plan.timeline.endMs },
    pitchGeometry: {
      lengthXMeters: PITCH_LENGTH_AXIS_METERS,
      widthYMeters: PITCH_WIDTH_AXIS_METERS,
      zUp: true,
    },
    slotGeometry: slotGeometryEcho(),
    emission: {
      intentKind: INTENT_KIND_SLOT_HOLD,
      frameRate,
      frameIntervalMs,
      poseQuantizationDecimals: INTENT_POSE_DECIMALS,
      determinism: INTENT_DETERMINISM_NOTE,
      sourceTimeConvention: INTENT_SOURCE_TIME_NOTE,
    },
    windows,
    summary: cloneJson(plan.summary),
  };
}
