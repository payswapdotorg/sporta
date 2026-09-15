/**
 * The W602/W603 render paths: validated input → deterministic SVG frame
 * sequence + manifest + contract `RenderResult`.
 *
 * Three entry points share one core (`./scene.ts` `resolve3dFrame` +
 * `./svg.ts` `composeFrame3dSvg`):
 *
 * - {@link render3dFromSnapshot}: the RENDERER-CONTRACT path — one immutable
 *   SWM snapshot plus the ordered events since its watermark (`RenderInput`,
 *   exactly what `RendererPlugin.render` receives). The snapshot + events are
 *   projected through W601 `projectScene` into a `SceneSpecification` (ALL
 *   canonical camera slots carried), and the frame timeline starts at the
 *   snapshot watermark; the scene state is the best-known coherent state, so
 *   entity positions are held while the event-marker HUD evolves per frame
 *   (the honest rendering of a single snapshot — positions are never
 *   invented between watermarks).
 * - {@link render3dClip}: the CLIP path — a timeline of W601 scene
 *   specifications (one per step, e.g. `projectScene(stateAt(engine, t))`
 *   with per-step `eventWindow` markers). Each step renders one frame from
 *   its OWN spec — real per-snapshot motion, per-frame provenance (the W602
 *   benchmark path).
 * - {@link render3dMatch}: the MATCH-PROGRESSION path (W603) — the same
 *   timeline of scene specifications, but rendered as a coherent ANIMATED
 *   sequence at the output profile's frame rate: one frame per frame
 *   interval, with deterministic constant-velocity interpolation between
 *   consecutive snapshots' known positions (the motion model in
 *   `./interpolate.ts`), per-frame interpolation provenance (INFERRED
 *   positions marked, never claimed observed), discontinuities accounted
 *   and never blended across (declared scene cuts, disposition changes,
 *   missing positions, physical-velocity bounds), a stable camera within
 *   each segment, markers landing at their timeline positions, and
 *   score/clock display state advancing exactly as the specs state it.
 *
 * All three are PURE: no clocks, no RNG, no I/O — the same request over the
 * same input yields a deep-equal output on every call (pinned by tests).
 *
 * Fail-closed admission ({@link admitRequest}) is re-run by every render
 * entry point (defense in depth — `render` never assumes prior
 * `validateRequest`), and malformed render input fails LOUD with
 * `RendererContractError` (`media-invalid`): schema-invalid snapshots or
 * event entries, session mismatches, non-ascending event sequences,
 * schema-invalid or version-incompatible scene specifications, unknown or
 * uncarried camera slots, regressing snapshot watermarks (mixed replay
 * branches), and render work beyond {@link MAX_RENDER_FRAMES} are never
 * silently tolerated.
 */
import { WorldEventStreamEntry, WorldSnapshot } from "@sporta/contracts";
import type { RenderRequest, RenderResult } from "@sporta/contracts";
import { RendererContractError } from "@sporta/renderer-contract";
import type { RenderInput, RequestRejection } from "@sporta/renderer-contract";
import {
  CAMERA_SLOT_IDS,
  SceneSpecification,
  isSceneVersionCompatible,
  projectScene,
} from "@sporta/scene-projection";
import type {
  SceneCameraSlot,
  SceneSpecification as SceneSpecificationDoc,
} from "@sporta/scene-projection";
import {
  AVATAR_FIELD_RENDERER_ID,
  AVATAR_FIELD_RENDERER_VERSION,
  DEFAULT_CAMERA_SLOT_ID,
  DEFAULT_DURATION_MS,
  MAX_DURATION_MS,
  MAX_RENDER_FRAMES,
  MIN_DURATION_MS,
  avatarFieldCapability,
} from "./identity";
import { cameraLabel, eventChipText, statusLine } from "./hud";
import { interpolateMatchFrame, sceneCutHeldProvenance } from "./interpolate";
import { resolve3dFrame } from "./scene";
import { composeFrame3dSvg } from "./svg";
import { FOCAL_PX, NEAR_PLANE_METERS } from "./camera";
import { deepEqual, describeValue, issuesOf, isRecord } from "./internal";
import type {
  AvatarField3dClipStep,
  AvatarField3dFrame,
  AvatarField3dManifest,
  AvatarField3dMatchStep,
  AvatarField3dRenderOutput,
  AvatarField3dStyleConfig,
  MatchEntityProvenanceEntry,
  Render3dEntityEntry,
  Render3dFrameEntry,
  Render3dMarkerEntry,
  Render3dSkippedMarker,
} from "./types";

// ---------------------------------------------------------------------------
// Presentation constants of the render paths
// ---------------------------------------------------------------------------

/**
 * The maximum event-marker chips displayed in one frame's HUD (the rest are
 * consumed and accounted — `hud.markersNotDisplayed`). A documented
 * presentation constant.
 */
export const MAX_EVENT_CHIPS = 4;

// ---------------------------------------------------------------------------
// Style configuration + fail-closed request admission
// ---------------------------------------------------------------------------

/**
 * Parses `styleConfig.config`: `undefined` → defaults; `durationMs` must be
 * a finite number in `[1, 3_600_000]` (bounded render work);
 * `cameraSlotId` must be a CANONICAL slot id when present (the default
 * `main-touchline` is used otherwise — a documented presentation default,
 * never a direction policy); `simulateDegradation` must be a boolean.
 * Unknown keys are ignored (forward-compatible style configuration).
 */
export function parseStyleConfig(
  config: unknown,
): { ok: true; value: AvatarField3dStyleConfig } | { ok: false; reason: string } {
  if (config === undefined) {
    return {
      ok: true,
      value: {
        durationMs: DEFAULT_DURATION_MS,
        cameraSlotId: DEFAULT_CAMERA_SLOT_ID,
        simulateDegradation: false,
      },
    };
  }
  if (!isRecord(config)) {
    return {
      ok: false,
      reason: `styleConfig.config must be an object (got ${describeValue(config)})`,
    };
  }
  let durationMs = DEFAULT_DURATION_MS;
  let cameraSlotId = DEFAULT_CAMERA_SLOT_ID;
  let simulateDegradation = false;
  if (config.durationMs !== undefined) {
    if (
      typeof config.durationMs !== "number" ||
      !Number.isFinite(config.durationMs) ||
      config.durationMs < MIN_DURATION_MS ||
      config.durationMs > MAX_DURATION_MS
    ) {
      return {
        ok: false,
        reason: `styleConfig.config.durationMs must be a finite number in [${MIN_DURATION_MS}, ${MAX_DURATION_MS}] (got ${describeValue(config.durationMs)})`,
      };
    }
    durationMs = config.durationMs;
  }
  if (config.cameraSlotId !== undefined) {
    if (typeof config.cameraSlotId !== "string" || !CAMERA_SLOT_IDS.includes(config.cameraSlotId)) {
      return {
        ok: false,
        reason: `styleConfig.config.cameraSlotId must be one of the canonical camera slots (${CAMERA_SLOT_IDS.join(", ")}) (got ${describeValue(config.cameraSlotId)})`,
      };
    }
    cameraSlotId = config.cameraSlotId;
  }
  if (config.simulateDegradation !== undefined) {
    if (typeof config.simulateDegradation !== "boolean") {
      return {
        ok: false,
        reason: `styleConfig.config.simulateDegradation must be a boolean (got ${describeValue(config.simulateDegradation)})`,
      };
    }
    simulateDegradation = config.simulateDegradation;
  }
  return { ok: true, value: { durationMs, cameraSlotId, simulateDegradation } };
}

/** Successful admission: the parsed style configuration. */
export interface RequestAdmission {
  ok: true;
  style: AvatarField3dStyleConfig;
}

/**
 * Fail-closed admission for a render request (R2/R3 + style config). Every
 * render entry point re-runs this — `render` never assumes prior
 * `validateRequest` (defense in depth).
 *
 * Gates, in order:
 *
 * 1. **R3 identity**: `rendererId`/`rendererVersion` must target this
 *    plugin (`media-invalid`).
 * 2. **R3 profile**: `outputProfile` must deep-equal one of the supported
 *    profiles (`media-invalid`).
 * 3. **R3 snapshot version**: `snapshotVersion` must be >= the capability's
 *    `minSnapshotVersion` and an integer (`media-invalid`).
 * 4. **Rights (fail-closed, beyond the R2 baseline)**: a request that
 *    CARRIES source-frame references with
 *    `rightsCapabilities.canReferenceSourceFrames === false` is rejected
 *    with `rights-denied`. This prototype needs no source pixels
 *    (`requiresSourceFrames: false`, a pure SWM → scene projection), so the
 *    R2 baseline probe is n/a for this plugin — but receiving unauthorized
 *    references is refused rather than silently consumed (architecture-lock
 *    §11: transformation never clears rights).
 * 5. **Style config**: parsed and validated (`media-invalid`).
 */
export function admitRequest(req: RenderRequest): RequestAdmission | RequestRejection {
  const capability = avatarFieldCapability();
  if (
    req.rendererId !== AVATAR_FIELD_RENDERER_ID ||
    req.rendererVersion !== AVATAR_FIELD_RENDERER_VERSION
  ) {
    return {
      ok: false,
      reason: `request targets renderer ${req.rendererId}@${req.rendererVersion}, but this plugin is ${AVATAR_FIELD_RENDERER_ID}@${AVATAR_FIELD_RENDERER_VERSION}`,
      failureClass: "media-invalid",
    };
  }
  const profileMatch = capability.supportedOutputProfiles.some((profile) =>
    deepEqual(req.outputProfile, profile),
  );
  if (!profileMatch) {
    return {
      ok: false,
      reason: "outputProfile is not one of the supported output profiles",
      failureClass: "media-invalid",
    };
  }
  if (
    req.snapshotVersion < capability.minSnapshotVersion ||
    !Number.isInteger(req.snapshotVersion)
  ) {
    return {
      ok: false,
      reason: `snapshotVersion ${String(req.snapshotVersion)} is below the minimum supported ${capability.minSnapshotVersion} or not an integer`,
      failureClass: "media-invalid",
    };
  }
  if (req.sourceFrameRefs.length > 0 && !req.rightsCapabilities.canReferenceSourceFrames) {
    return {
      ok: false,
      reason: `request carries ${req.sourceFrameRefs.length} source-frame reference(s) but rightsCapabilities.canReferenceSourceFrames is false`,
      failureClass: "rights-denied",
    };
  }
  const style = parseStyleConfig(req.styleConfig.config);
  if (!style.ok) {
    return { ok: false, reason: style.reason, failureClass: "media-invalid" };
  }
  return { ok: true, style: style.value };
}

/** Throws the contract error for a failed admission (render-time defense). */
function enforceAdmission(req: RenderRequest): AvatarField3dStyleConfig {
  const admission = admitRequest(req);
  if (!admission.ok) {
    throw new RendererContractError(`render refused: ${admission.reason}`, admission.failureClass, {
      rendererId: AVATAR_FIELD_RENDERER_ID,
      rendererVersion: AVATAR_FIELD_RENDERER_VERSION,
      sessionId: req.sessionId,
      reason: admission.reason,
    });
  }
  return admission.style;
}

// ---------------------------------------------------------------------------
// Render-input validation (fail-loud on malformed SWM documents)
// ---------------------------------------------------------------------------

/**
 * Validates the SWM snapshot a render consumes. A schema-invalid snapshot
 * or a session mismatch throws `RendererContractError` (`media-invalid`).
 */
function enforceValidSnapshot(req: RenderRequest, snapshot: WorldSnapshot): void {
  const parsed = WorldSnapshot.safeParse(snapshot);
  if (!parsed.success) {
    throw new RendererContractError(
      `render input snapshot is not a valid WorldSnapshot: ${issuesOf(parsed.error)}`,
      "media-invalid",
      { sessionId: req.sessionId, issues: issuesOf(parsed.error) },
    );
  }
  if (snapshot.sessionId !== req.sessionId) {
    throw new RendererContractError(
      `render input snapshot belongs to session "${snapshot.sessionId}", not the requested "${req.sessionId}"`,
      "media-invalid",
      { sessionId: req.sessionId, snapshotSessionId: snapshot.sessionId },
    );
  }
}

/**
 * Validates the event stream entries a render consumes. A schema-invalid
 * entry, a session mismatch, or a non-ascending sequence throws
 * `RendererContractError` (`media-invalid`).
 */
function enforceValidEvents(
  req: RenderRequest,
  events: readonly unknown[],
  options: { afterSequence?: number },
): void {
  let previousSequence = options.afterSequence;
  for (let i = 0; i < events.length; i += 1) {
    const parsed = WorldEventStreamEntry.safeParse(events[i]);
    if (!parsed.success) {
      throw new RendererContractError(
        `render input events[${i}] is not a valid WorldEventStreamEntry: ${issuesOf(parsed.error)}`,
        "media-invalid",
        { sessionId: req.sessionId, index: i, issues: issuesOf(parsed.error) },
      );
    }
    const entry = parsed.data;
    if (entry.event.sessionId !== req.sessionId) {
      throw new RendererContractError(
        `render input events[${i}] (${entry.event.eventId}) belongs to session "${entry.event.sessionId}", not the requested "${req.sessionId}"`,
        "media-invalid",
        { sessionId: req.sessionId, index: i, eventId: entry.event.eventId },
      );
    }
    if (previousSequence !== undefined && entry.sequence <= previousSequence) {
      throw new RendererContractError(
        `render input events must have strictly ascending sequences (events[${i}].sequence ${entry.sequence} <= ${previousSequence})`,
        "media-invalid",
        { sessionId: req.sessionId, index: i, sequence: entry.sequence },
      );
    }
    previousSequence = entry.sequence;
  }
}

/**
 * Validates one clip step's scene specification: schema-valid against the
 * W601 zod schema, a compatible `sceneSchemaVersion` (fail-closed — never a
 * partial parse of a newer scene), and the request's session. Throws
 * `RendererContractError` (`media-invalid`) otherwise. Returns the parsed
 * (unknown-keys-stripped) scene.
 */
function enforceValidScene(
  req: RenderRequest,
  scene: unknown,
  index: number,
): SceneSpecificationDoc {
  const parsed = SceneSpecification.safeParse(scene);
  if (!parsed.success) {
    throw new RendererContractError(
      `clip steps[${index}].scene is not a valid SceneSpecification: ${issuesOf(parsed.error)}`,
      "media-invalid",
      { sessionId: req.sessionId, index, issues: issuesOf(parsed.error) },
    );
  }
  if (!isSceneVersionCompatible(parsed.data.sceneSchemaVersion)) {
    throw new RendererContractError(
      `clip steps[${index}].scene declares scene schema version "${parsed.data.sceneSchemaVersion}", ` +
        `which is not compatible with this renderer's scene schema support — refuse rather than partially parse`,
      "media-invalid",
      { sessionId: req.sessionId, index, sceneSchemaVersion: parsed.data.sceneSchemaVersion },
    );
  }
  if (parsed.data.sessionId !== req.sessionId) {
    throw new RendererContractError(
      `clip steps[${index}].scene belongs to session "${parsed.data.sessionId}", not the requested "${req.sessionId}"`,
      "media-invalid",
      { sessionId: req.sessionId, index, sceneSessionId: parsed.data.sessionId },
    );
  }
  return parsed.data;
}

/**
 * Resolves the render camera slot: the scene's carried slot with
 * `slotId === cameraSlotId`. The renderer frames FROM a carried slot — it
 * never invents one; an uncarried id is a fail-loud media-invalid.
 */
function enforceCarriedSlot(
  scene: SceneSpecificationDoc,
  cameraSlotId: string,
  stepIndex: number | undefined,
): SceneCameraSlot {
  const slot = scene.cameraSlots.find((candidate) => candidate.slotId === cameraSlotId);
  if (slot === undefined) {
    const where = stepIndex === undefined ? "the scene" : `clip steps[${stepIndex}].scene`;
    throw new RendererContractError(
      `${where} carries camera slots [${scene.cameraSlots.map((entry) => entry.slotId).join(", ")}] — the requested render slot "${cameraSlotId}" is not among them`,
      "media-invalid",
      {
        sessionId: scene.sessionId,
        cameraSlotId,
        carriedSlots: scene.cameraSlots.map((s) => s.slotId),
      },
    );
  }
  return slot;
}

// ---------------------------------------------------------------------------
// Shared assembly
// ---------------------------------------------------------------------------

/** The frame interval implied by the (already admitted) output profile. */
function frameIntervalMsOf(profile: RenderRequest["outputProfile"]): number {
  return 1000 / profile.frameRate;
}

/** Assembles the contract `RenderResult` projection of an output. */
function toRenderResult(options: {
  req: RenderRequest;
  segments: RenderResult["outputSegments"];
  watermarkAfter: { watermarkMs: number; sequence: number };
  provenance: { snapshotVersion: number; lastEventSequence: number };
  degradation: { degraded: boolean; reasons: string[] };
}): RenderResult {
  const { req, segments, watermarkAfter, provenance, degradation } = options;
  const degraded = degradation.degraded;
  return {
    sessionId: req.sessionId,
    rendererId: req.rendererId,
    outputSegments: segments,
    watermarkAfter,
    rendererHealth: {
      lagMs: 0,
      degraded,
      ...(degraded ? { degradationReason: degradation.reasons.join(";") } : {}),
    },
    provenance,
  };
}

/** The artifact URI of one frame (opaque; bytes live with the host). */
function artifactRefOf(req: RenderRequest, frameIndex: number): string {
  return `scene3d://${req.sessionId}/${req.snapshotVersion}/${frameIndex}`;
}

/** The manifest camera block of a carried slot (verbatim slot geometry). */
function cameraBlockOf(slot: SceneCameraSlot): AvatarField3dManifest["camera"] {
  return {
    slotId: slot.slotId,
    position: { x: slot.position.x, y: slot.position.y, z: slot.position.z },
    target: { x: slot.target.x, y: slot.target.y, z: slot.target.z },
    focalPx: FOCAL_PX,
    nearPlaneMeters: NEAR_PLANE_METERS,
  };
}

/** Renders the marker accounting + HUD chips of one frame's marker set. */
function markerAccounting(frameMarkers: readonly SceneSpecificationDoc["eventMarkers"][number][]): {
  markers: Render3dMarkerEntry[];
  chips: string[];
  notDisplayed: number;
} {
  const markers: Render3dMarkerEntry[] = frameMarkers.map((marker) => {
    const text = eventChipText(marker.event.eventTypeRef);
    return {
      sequence: marker.sequence,
      eventId: marker.event.eventId,
      eventTypeRef: marker.event.eventTypeRef,
      eventTimeMs: marker.event.eventTimeMs,
      displayed: false,
      text,
    };
  });
  const chips: string[] = [];
  let displayed = 0;
  for (const marker of markers) {
    if (displayed < MAX_EVENT_CHIPS) {
      chips.push(marker.text);
      marker.displayed = true;
      displayed += 1;
    }
  }
  return { markers, chips, notDisplayed: markers.length - displayed };
}

// ---------------------------------------------------------------------------
// Path 1: the renderer-contract path (single snapshot + events since)
// ---------------------------------------------------------------------------

/**
 * Renders the contract `RenderInput` (one snapshot + ordered events since
 * its watermark) into a frame sequence, the manifest, and the contract
 * `RenderResult`. The input is projected through W601 `projectScene` into a
 * scene specification (the renderer drives EVERYTHING from the spec — never
 * raw SWM); the frame timeline starts at the snapshot watermark; frames are
 * `1000 / outputProfile.frameRate` apart; the scene state is held across
 * frames while the event-marker HUD evolves with the markers in each
 * frame's window `[start + i·interval, start + (i+1)·interval)` (the last
 * window is clipped to `start + durationMs`).
 *
 * Marker application semantics (R5/R6/R7, test-pinned — the W502 event
 * semantics applied to the spec's event markers):
 *
 * - a marker is APPLIED iff its `eventTimeMs` falls in
 *   `[start, start + durationMs)` — it is consumed by exactly one frame;
 * - `provenance.lastEventSequence` is the highest APPLIED sequence (0 when
 *   none), never more;
 * - markers before the window or at/after its end are SKIPPED with an
 *   accounted reason AND flip `rendererHealth.degraded` with the reason
 *   `"markers-outside-render-window"` (explicit degradation, never silent
 *   staleness);
 * - `watermarkAfter.sequence` follows R6: the LAST INPUT event's sequence
 *   (even when it was skipped), or the snapshot watermark sequence when no
 *   events were passed.
 */
export function render3dFromSnapshot(
  req: RenderRequest,
  input: RenderInput,
): AvatarField3dRenderOutput {
  const style = enforceAdmission(req);
  enforceValidSnapshot(req, input.snapshot);
  if (!Array.isArray(input.events)) {
    throw new RendererContractError(
      "render input events must be an array of WorldEventStreamEntry",
      "media-invalid",
      { sessionId: req.sessionId },
    );
  }
  enforceValidEvents(req, input.events, { afterSequence: input.snapshot.watermark.sequence });

  // The W601 projection: the renderer consumes the SceneSpecification (all
  // canonical camera slots carried; the render slot is selected below).
  const scene = projectScene(input.snapshot, { events: input.events });
  const slot = enforceCarriedSlot(scene, style.cameraSlotId, undefined);

  const startMs = input.snapshot.watermark.watermarkMs;
  const intervalMs = frameIntervalMsOf(req.outputProfile);
  const durationMs = style.durationMs;
  const windowEndMs = startMs + durationMs;
  const frameCount = Math.max(1, Math.ceil(durationMs / intervalMs));
  enforceFrameBudget(frameCount, intervalMs);
  const canvas = {
    width: req.outputProfile.resolution.w,
    height: req.outputProfile.resolution.h,
  };

  // One scene → one resolved frame (the state is HELD across frames; only
  // the marker windows and the frame index evolve — never invented motion).
  const resolved = resolve3dFrame({ scene, cameraSlot: slot, canvas });

  const frames: AvatarField3dFrame[] = [];
  const manifestFrames: Render3dFrameEntry[] = [];
  const segments: RenderResult["outputSegments"] = [];
  for (let index = 0; index < frameCount; index += 1) {
    const frameStartMs = startMs + index * intervalMs;
    const frameEndMs = Math.min(frameStartMs + intervalMs, windowEndMs);
    const frameMarkers = scene.eventMarkers.filter(
      (marker) => marker.event.eventTimeMs >= frameStartMs && marker.event.eventTimeMs < frameEndMs,
    );
    const accounting = markerAccounting(frameMarkers);
    const line = statusLine(scene.scoreClock) ?? null;
    const svg = composeFrame3dSvg({
      frameIndex: index,
      camera: resolved.camera,
      canvas,
      field: resolved.field,
      entities: resolved.entities,
      possession: resolved.possessionDrawable,
      hud: {
        statusLine: line,
        cameraLabel: cameraLabel(slot.slotId),
        eventChips: accounting.chips,
      },
    });
    frames.push({ frameIndex: index, outputTimestampMs: frameStartMs, svg });
    manifestFrames.push({
      frameIndex: index,
      outputTimestampMs: frameStartMs,
      windowMs: { startMs: frameStartMs, endMs: frameEndMs },
      source: {
        watermark: {
          sequence: scene.source.watermark.sequence,
          watermarkMs: scene.source.watermark.watermarkMs,
        },
        generatedAtMs: scene.source.generatedAtMs,
        footballState: scene.source.footballState,
        sceneSchemaVersion: scene.sceneSchemaVersion,
      },
      appliedMarkerSequences: accounting.markers.map((marker) => marker.sequence),
      markers: accounting.markers,
      hud: {
        statusLine: line,
        cameraLabel: cameraLabel(slot.slotId),
        eventChips: accounting.chips,
        markersNotDisplayed: accounting.notDisplayed,
      },
      possession: resolved.possession,
      entities: resolved.manifestEntities,
    });
    segments.push({
      segmentId: `scene3d-${index}`,
      startMs: frameStartMs,
      endMs: frameEndMs,
      artifactRef: artifactRefOf(req, index),
    });
  }

  // Marker accounting: applied = within [startMs, windowEndMs).
  const appliedSequences = scene.eventMarkers
    .filter(
      (marker) => marker.event.eventTimeMs >= startMs && marker.event.eventTimeMs < windowEndMs,
    )
    .map((marker) => marker.sequence);
  const skipped: Render3dSkippedMarker[] = scene.eventMarkers
    .filter(
      (marker) => marker.event.eventTimeMs < startMs || marker.event.eventTimeMs >= windowEndMs,
    )
    .map((marker) => ({
      sequence: marker.sequence,
      eventId: marker.event.eventId,
      eventTimeMs: marker.event.eventTimeMs,
      reason:
        marker.event.eventTimeMs < startMs ? ("before-window" as const) : ("after-window" as const),
    }));
  const lastEventSequence =
    appliedSequences.length > 0 ? appliedSequences[appliedSequences.length - 1]! : 0;
  const watermarkAfter = {
    watermarkMs: windowEndMs,
    sequence:
      input.events.length > 0
        ? input.events[input.events.length - 1]!.sequence
        : input.snapshot.watermark.sequence,
  };

  const reasons: string[] = [];
  if (skipped.length > 0) reasons.push("markers-outside-render-window");
  if (style.simulateDegradation) reasons.push("simulated-degradation");

  const manifest: AvatarField3dManifest = {
    renderer: {
      rendererId: AVATAR_FIELD_RENDERER_ID,
      rendererVersion: AVATAR_FIELD_RENDERER_VERSION,
      styleId: req.styleConfig.styleId,
      configSchemaVersion: req.styleConfig.configSchemaVersion,
    },
    camera: cameraBlockOf(slot),
    session: {
      sessionId: req.sessionId,
      snapshotVersion: req.snapshotVersion,
      eventsSinceSequence: req.eventsSinceSequence,
    },
    output: { profile: req.outputProfile, startMs, frameIntervalMs: intervalMs, durationMs },
    provenance: { snapshotVersion: req.snapshotVersion, lastEventSequence },
    watermarkAfter,
    frames: manifestFrames,
    skippedMarkers: skipped,
    degradation: { degraded: reasons.length > 0, reasons },
  };
  const result = toRenderResult({
    req,
    segments,
    watermarkAfter,
    provenance: manifest.provenance,
    degradation: manifest.degradation,
  });
  return { result, frames, manifest };
}

// ---------------------------------------------------------------------------
// Path 2: the clip path (timeline of scene specifications)
// ---------------------------------------------------------------------------

/**
 * Validates clip steps: at least one; finite `atMs >= 0`; strictly
 * increasing; each step's scene a schema-valid, version-compatible,
 * session-consistent `SceneSpecification`.
 */
function enforceValidSteps(req: RenderRequest, steps: readonly AvatarField3dClipStep[]): void {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new RendererContractError(
      "render3dClip requires a non-empty array of clip steps",
      "media-invalid",
      { sessionId: req.sessionId },
    );
  }
  let previousAtMs: number | undefined;
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]!;
    if (step === null || typeof step !== "object" || Array.isArray(step)) {
      throw new RendererContractError(
        `clip steps[${i}] must be an AvatarField3dClipStep object`,
        "media-invalid",
        { sessionId: req.sessionId, index: i },
      );
    }
    const atMs = step.atMs;
    if (typeof atMs !== "number" || !Number.isFinite(atMs) || atMs < 0) {
      throw new RendererContractError(
        `clip steps[${i}].atMs must be a finite number >= 0 (got ${describeValue(atMs)})`,
        "media-invalid",
        { sessionId: req.sessionId, index: i },
      );
    }
    if (previousAtMs !== undefined && atMs <= previousAtMs) {
      throw new RendererContractError(
        `clip steps must have strictly increasing atMs (steps[${i}].atMs ${atMs} <= ${previousAtMs})`,
        "media-invalid",
        { sessionId: req.sessionId, index: i },
      );
    }
    previousAtMs = atMs;
    if (step.scene === undefined) {
      throw new RendererContractError(
        `clip steps[${i}].scene must be a SceneSpecification (got undefined)`,
        "media-invalid",
        { sessionId: req.sessionId, index: i },
      );
    }
    enforceValidScene(req, step.scene, i);
  }
}

/**
 * Renders a short clip: one frame per step, each synthesized from the
 * step's OWN `SceneSpecification` (real per-snapshot motion — never
 * interpolated). The typical construction is `projectScene(stateAt(engine,
 * t).snapshot, { events: eventWindow(...) })` per step (the
 * `@sporta/temporal` + `@sporta/scene-projection` consumer seams).
 *
 * Each frame renders from ITS OWN spec's carried slot with the requested
 * camera id (a spec is the authority for its own framing); the manifest's
 * camera block records the FIRST step's slot. All step markers are consumed
 * (applied): each appears in exactly one frame's HUD or its
 * not-displayed accounting; `skippedMarkers` is therefore always empty and
 * degradation can only come from `simulateDegradation`. `watermarkAfter`
 * follows the R6 analog: the highest input marker sequence, or the last
 * step's scene watermark sequence when no markers were passed at all.
 */
export function render3dClip(
  req: RenderRequest,
  steps: readonly AvatarField3dClipStep[],
): AvatarField3dRenderOutput {
  const style = enforceAdmission(req);
  enforceValidSteps(req, steps);

  const intervalMs = frameIntervalMsOf(req.outputProfile);
  const canvas = {
    width: req.outputProfile.resolution.w,
    height: req.outputProfile.resolution.h,
  };
  const frames: AvatarField3dFrame[] = [];
  const manifestFrames: Render3dFrameEntry[] = [];
  const segments: RenderResult["outputSegments"] = [];
  let lastEventSequence = 0;
  let firstSlot: SceneCameraSlot | undefined;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    const scene = enforceValidScene(req, step.scene, index);
    const slot = enforceCarriedSlot(scene, style.cameraSlotId, index);
    if (index === 0) firstSlot = slot;
    const nextAtMs = index + 1 < steps.length ? steps[index + 1]!.atMs : step.atMs + intervalMs;
    const resolved = resolve3dFrame({ scene, cameraSlot: slot, canvas });
    const accounting = markerAccounting(scene.eventMarkers);
    const line = statusLine(scene.scoreClock) ?? null;
    const svg = composeFrame3dSvg({
      frameIndex: index,
      camera: resolved.camera,
      canvas,
      field: resolved.field,
      entities: resolved.entities,
      possession: resolved.possessionDrawable,
      hud: {
        statusLine: line,
        cameraLabel: cameraLabel(slot.slotId),
        eventChips: accounting.chips,
      },
    });
    frames.push({ frameIndex: index, outputTimestampMs: step.atMs, svg });
    manifestFrames.push({
      frameIndex: index,
      outputTimestampMs: step.atMs,
      windowMs: { startMs: step.atMs, endMs: nextAtMs },
      source: {
        watermark: {
          sequence: scene.source.watermark.sequence,
          watermarkMs: scene.source.watermark.watermarkMs,
        },
        generatedAtMs: scene.source.generatedAtMs,
        footballState: scene.source.footballState,
        sceneSchemaVersion: scene.sceneSchemaVersion,
      },
      appliedMarkerSequences: accounting.markers.map((marker) => marker.sequence),
      markers: accounting.markers,
      hud: {
        statusLine: line,
        cameraLabel: cameraLabel(slot.slotId),
        eventChips: accounting.chips,
        markersNotDisplayed: accounting.notDisplayed,
      },
      possession: resolved.possession,
      entities: resolved.manifestEntities,
    });
    segments.push({
      segmentId: `scene3d-${index}`,
      startMs: step.atMs,
      endMs: nextAtMs,
      artifactRef: artifactRefOf(req, index),
    });
    for (const marker of scene.eventMarkers) {
      if (marker.sequence > lastEventSequence) lastEventSequence = marker.sequence;
    }
  }

  const lastStepScene = enforceValidScene(req, steps[steps.length - 1]!.scene, steps.length - 1);
  const lastStep = steps[steps.length - 1]!;
  const startMs = steps[0]!.atMs;
  const durationMs = lastStep.atMs + intervalMs - startMs;
  const watermarkAfter = {
    watermarkMs: lastStep.atMs + intervalMs,
    sequence: lastEventSequence > 0 ? lastEventSequence : lastStepScene.source.watermark.sequence,
  };
  const reasons: string[] = [];
  if (style.simulateDegradation) reasons.push("simulated-degradation");

  const manifest: AvatarField3dManifest = {
    renderer: {
      rendererId: AVATAR_FIELD_RENDERER_ID,
      rendererVersion: AVATAR_FIELD_RENDERER_VERSION,
      styleId: req.styleConfig.styleId,
      configSchemaVersion: req.styleConfig.configSchemaVersion,
    },
    camera: cameraBlockOf(firstSlot!),
    session: {
      sessionId: req.sessionId,
      snapshotVersion: req.snapshotVersion,
      eventsSinceSequence: req.eventsSinceSequence,
    },
    output: { profile: req.outputProfile, startMs, frameIntervalMs: intervalMs, durationMs },
    provenance: { snapshotVersion: req.snapshotVersion, lastEventSequence },
    watermarkAfter,
    frames: manifestFrames,
    skippedMarkers: [],
    degradation: { degraded: reasons.length > 0, reasons },
  };
  const result = toRenderResult({
    req,
    segments,
    watermarkAfter,
    provenance: manifest.provenance,
    degradation: manifest.degradation,
  });
  return { result, frames, manifest };
}

// ---------------------------------------------------------------------------
// Path 3: the match-progression path (W603 — interpolated timeline)
// ---------------------------------------------------------------------------

/**
 * Validates match steps: the clip-path rules (non-empty; finite
 * `atMs >= 0` strictly increasing; each scene schema-valid,
 * version-compatible, session-consistent) PLUS the match-path rules:
 *
 * - `sceneCutBefore`, when present, must be a boolean (a declared flag —
 *   never a truthy coercion);
 * - every step's scene must CARRY the requested camera slot (fail loud up
 *   front, before any frame is synthesized);
 * - the steps' `source.watermark.sequence` values must be NON-DECREASING —
 *   the W006 engine's snapshots at ascending times have monotone watermark
 *   sequences, so a regression means the caller mixed replay branches;
 *   refusing is safer than interpolating across inconsistent provenance.
 *
 * Returns the parsed scenes (one per step, in step order) so the render
 * loop never re-parses.
 */
function enforceValidMatchSteps(
  req: RenderRequest,
  steps: readonly AvatarField3dMatchStep[],
  cameraSlotId: string,
): SceneSpecificationDoc[] {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new RendererContractError(
      "render3dMatch requires a non-empty array of match steps",
      "media-invalid",
      { sessionId: req.sessionId },
    );
  }
  const scenes: SceneSpecificationDoc[] = [];
  let previousAtMs: number | undefined;
  let previousWatermarkSequence: number | undefined;
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]!;
    if (step === null || typeof step !== "object" || Array.isArray(step)) {
      throw new RendererContractError(
        `match steps[${i}] must be an AvatarField3dMatchStep object`,
        "media-invalid",
        { sessionId: req.sessionId, index: i },
      );
    }
    const atMs = step.atMs;
    if (typeof atMs !== "number" || !Number.isFinite(atMs) || atMs < 0) {
      throw new RendererContractError(
        `match steps[${i}].atMs must be a finite number >= 0 (got ${describeValue(atMs)})`,
        "media-invalid",
        { sessionId: req.sessionId, index: i },
      );
    }
    if (previousAtMs !== undefined && atMs <= previousAtMs) {
      throw new RendererContractError(
        `match steps must have strictly increasing atMs (steps[${i}].atMs ${atMs} <= ${previousAtMs})`,
        "media-invalid",
        { sessionId: req.sessionId, index: i },
      );
    }
    previousAtMs = atMs;
    if (step.sceneCutBefore !== undefined && typeof step.sceneCutBefore !== "boolean") {
      throw new RendererContractError(
        `match steps[${i}].sceneCutBefore must be a boolean when present (got ${describeValue(step.sceneCutBefore)})`,
        "media-invalid",
        { sessionId: req.sessionId, index: i },
      );
    }
    if (step.scene === undefined) {
      throw new RendererContractError(
        `match steps[${i}].scene must be a SceneSpecification (got undefined)`,
        "media-invalid",
        { sessionId: req.sessionId, index: i },
      );
    }
    const scene = enforceValidScene(req, step.scene, i);
    enforceCarriedSlot(scene, cameraSlotId, i);
    const sequence = scene.source.watermark.sequence;
    if (previousWatermarkSequence !== undefined && sequence < previousWatermarkSequence) {
      throw new RendererContractError(
        `match steps[${i}].scene declares watermark sequence ${sequence} < the previous step's ${previousWatermarkSequence} — snapshots from mixed replay branches must not be interpolated across`,
        "media-invalid",
        { sessionId: req.sessionId, index: i, sequence, previousWatermarkSequence },
      );
    }
    previousWatermarkSequence = sequence;
    scenes.push(scene);
  }
  return scenes;
}

/**
 * Enforces the per-render frame budget ({@link MAX_RENDER_FRAMES}): a
 * fail-loud `media-invalid` (bounded render work — the W602 1 fps × 1 h
 * worst case is now the universal bound; longer animated timelines belong
 * to the W304 watermark-batched orchestration seam).
 */
function enforceFrameBudget(frameCount: number, intervalMs: number): void {
  if (frameCount > MAX_RENDER_FRAMES) {
    throw new RendererContractError(
      `the requested render implies ${frameCount} frames at a ${intervalMs} ms interval, beyond the per-render budget of ${MAX_RENDER_FRAMES} frames — reduce the duration or the frame rate (longer animated timelines belong to the watermark-batched orchestration seam)`,
      "media-invalid",
      { frameCount, frameIntervalMs: intervalMs, maxRenderFrames: MAX_RENDER_FRAMES },
    );
  }
}

/** One planned match frame (before rendering). */
interface PlannedMatchFrame {
  /** The frame's timeline position (milliseconds). */
  frameMs: number;
  /** The frame's window end (the next frame position or the segment end). */
  windowEndMs: number;
  /** The authoritative (from) step index. */
  segmentIndex: number;
  /** Observed (on a step's atMs) / interpolated (between steps) / held (scene cut). */
  kind: "observed" | "interpolated" | "held";
  /** The interpolation fraction (0 for observed/held; (0, 1) for interpolated). */
  fraction: number;
}

/**
 * Renders the MATCH PROGRESSION (W603): a timeline of W601 scene
 * specifications (typically `projectScene(stateAt(engine, t).snapshot,
 * { events: eventWindow(...) })` per step — the W402-style snapshot
 * windows) as one coherent animated sequence at the output profile's frame
 * rate. "Match progression rendered from SWM rather than replaying
 * broadcast pixels."
 *
 * ## The frame plan (deterministic; no clock reads — pure arithmetic over
 * the timeline's own `atMs` values)
 *
 * Frames are planned PER SEGMENT (each pair of consecutive steps): frames
 * at `t₀ + j·interval` for `j = 0 … ceil(span/interval) − 1`, each with
 * window `[frameMs, min(frameMs + interval, t₁))`. This guarantees an
 * OBSERVED frame exactly at every step's `atMs` (each snapshot's true state
 * is shown verbatim — never skipped by grid drift), tiles the timeline
 * without overlaps (R8-shape segments), and caps the cadence at the
 * profile's frame rate (snapshots DENSER than the frame interval yield
 * their own observed cadence — the frame rate is a cap, never an
 * invention). The LAST step renders one observed frame covering its tail
 * window `[t_last, t_last + interval)`. Total frames =
 * `Σ ceil(span_i / interval) + 1`, bounded by {@link MAX_RENDER_FRAMES}.
 *
 * ## Motion (the model lives in `./interpolate.ts`)
 *
 * Frames strictly between two steps render the interpolated scene:
 * constant-velocity segments between the snapshots' known positions
 * (INFERRED — every frame's manifest records the snapshot pair + fraction,
 * every interpolated position is marked `positionProvenance:
 * "interpolated"`, never claimed observed); discontinuities are HELD and
 * accounted (declared scene cuts render the from-scene verbatim;
 * disposition changes, missing positions, physical-velocity bounds, and
 * entities absent from the to-spec hold the from-spec's verbatim values).
 *
 * ## Presentation coherence
 *
 * - **Camera**: STABLE within each segment — the from-step's carried slot
 *   (the renderer never moves the camera; a camera change is a W604 cut
 *   that lands at a snapshot boundary, never mid-segment). The manifest's
 *   camera block records the FIRST step's slot (the W602 clip-path
 *   convention); each frame's HUD label shows its own actual slot.
 * - **Score/clock/possession**: the from-step's `scoreClock` VERBATIM —
 *   displayed state advances exactly as the specs state it, at snapshot
 *   boundaries; the clock never ticks by frame time (that would invent
 *   match time).
 * - **Markers**: the union of all steps' event markers (deduplicated by
 *   sequence, first occurrence) assigned to the frame whose window
 *   contains each marker's `eventTimeMs` — every marker appears at its
 *   timeline position in exactly one frame's HUD (or its not-displayed
 *   accounting). Markers outside `[start, end)` are skipped with accounted
 *   reasons AND set `degraded` with `"markers-outside-render-window"` (R7
 *   — the single-snapshot-path semantics).
 * - **`durationMs` is IGNORED** (the timeline's extent IS the duration:
 *   `lastAtMs + interval − firstAtMs`), exactly like the clip path.
 *
 * ## Provenance/watermark (the R5/R6 analogs)
 *
 * - `provenance.lastEventSequence` = the highest APPLIED marker sequence
 *   (0 when none) — never more (R5);
 * - `watermarkAfter.watermarkMs` = the render end (`t_last + interval`);
 *   `watermarkAfter.sequence` = the MAXIMUM of the last step's scene
 *   watermark sequence and every consumed marker sequence — never less
 *   than anything the render consumed (the strict superset of the clip
 *   path's rule, documented).
 */
export function render3dMatch(
  req: RenderRequest,
  steps: readonly AvatarField3dMatchStep[],
): AvatarField3dRenderOutput {
  const style = enforceAdmission(req);
  const scenes = enforceValidMatchSteps(req, steps, style.cameraSlotId);

  const intervalMs = frameIntervalMsOf(req.outputProfile);
  const canvas = {
    width: req.outputProfile.resolution.w,
    height: req.outputProfile.resolution.h,
  };

  // The marker union: every step's markers, deduplicated by sequence
  // (first occurrence wins — steps are in ascending timeline order).
  const markerUnion: SceneSpecificationDoc["eventMarkers"] = [];
  const seenMarkerSequences = new Set<number>();
  let maxMarkerSequence = 0;
  for (const scene of scenes) {
    for (const marker of scene.eventMarkers) {
      if (!seenMarkerSequences.has(marker.sequence)) {
        seenMarkerSequences.add(marker.sequence);
        markerUnion.push(marker);
        if (marker.sequence > maxMarkerSequence) maxMarkerSequence = marker.sequence;
      }
    }
  }

  // The frame plan (per-segment grids + the last step's observed tail).
  const plan: PlannedMatchFrame[] = [];
  for (let i = 0; i + 1 < steps.length; i += 1) {
    const fromMs = steps[i]!.atMs;
    const toMs = steps[i + 1]!.atMs;
    const span = toMs - fromMs;
    const framesInSegment = Math.max(1, Math.ceil(span / intervalMs));
    const sceneCut = steps[i + 1]!.sceneCutBefore === true;
    for (let j = 0; j < framesInSegment; j += 1) {
      const frameMs = fromMs + j * intervalMs;
      // The fraction contract (`Render3dMatchInterpolation`): a nonzero
      // fraction is recorded ONLY on interpolated frames — observed frames
      // sit exactly on a snapshot (no interpolation) and cut-held frames
      // interpolate NOTHING (the whole scene is the from-spec verbatim, so
      // there is no interpolation parameter to report). 0 otherwise.
      const kind: PlannedMatchFrame["kind"] =
        j === 0 ? "observed" : sceneCut ? "held" : "interpolated";
      plan.push({
        frameMs,
        windowEndMs: Math.min(frameMs + intervalMs, toMs),
        segmentIndex: i,
        kind,
        fraction: kind === "interpolated" ? (frameMs - fromMs) / span : 0,
      });
    }
  }
  const lastIndex = steps.length - 1;
  const lastAtMs = steps[lastIndex]!.atMs;
  const endMs = lastAtMs + intervalMs;
  plan.push({
    frameMs: lastAtMs,
    windowEndMs: endMs,
    segmentIndex: lastIndex,
    kind: "observed",
    fraction: 0,
  });
  enforceFrameBudget(plan.length, intervalMs);

  const startMs = steps[0]!.atMs;
  const durationMs = endMs - startMs;

  const frames: AvatarField3dFrame[] = [];
  const manifestFrames: Render3dFrameEntry[] = [];
  const segments: RenderResult["outputSegments"] = [];
  let lastEventSequence = 0;
  let firstSlot: SceneCameraSlot | undefined;
  for (let index = 0; index < plan.length; index += 1) {
    const planned = plan[index]!;
    const segmentIndex = planned.segmentIndex;
    const fromStep = steps[segmentIndex]!;
    const fromScene = scenes[segmentIndex]!;
    const slot = enforceCarriedSlot(fromScene, style.cameraSlotId, segmentIndex);
    if (index === 0) firstSlot = slot;

    // The scene this frame renders + its per-entity position provenance.
    let scene: SceneSpecificationDoc;
    let entityProvenance: MatchEntityProvenanceEntry[] | null = null;
    if (planned.kind === "interpolated") {
      const toScene = scenes[segmentIndex + 1]!;
      const spanMs = steps[segmentIndex + 1]!.atMs - fromStep.atMs;
      const interpolated = interpolateMatchFrame({
        from: fromScene,
        to: toScene,
        fraction: planned.fraction,
        spanMs,
      });
      scene = interpolated.scene;
      entityProvenance = interpolated.entities;
    } else {
      scene = fromScene;
      if (planned.kind === "held") {
        entityProvenance = sceneCutHeldProvenance(fromScene);
      }
    }

    const resolved = resolve3dFrame({ scene, cameraSlot: slot, canvas });
    // Markers: each lands in the ONE frame whose window contains its time.
    const frameMarkers = markerUnion.filter(
      (marker) =>
        marker.event.eventTimeMs >= planned.frameMs &&
        marker.event.eventTimeMs < planned.windowEndMs,
    );
    for (const marker of frameMarkers) {
      if (marker.sequence > lastEventSequence) lastEventSequence = marker.sequence;
    }
    const accounting = markerAccounting(frameMarkers);
    const line = statusLine(scene.scoreClock) ?? null;
    const svg = composeFrame3dSvg({
      frameIndex: index,
      camera: resolved.camera,
      canvas,
      field: resolved.field,
      entities: resolved.entities,
      possession: resolved.possessionDrawable,
      hud: {
        statusLine: line,
        cameraLabel: cameraLabel(slot.slotId),
        eventChips: accounting.chips,
      },
    });
    frames.push({ frameIndex: index, outputTimestampMs: planned.frameMs, svg });
    manifestFrames.push({
      frameIndex: index,
      outputTimestampMs: planned.frameMs,
      windowMs: { startMs: planned.frameMs, endMs: planned.windowEndMs },
      interpolation: {
        kind: planned.kind,
        fromStepIndex: segmentIndex,
        ...(segmentIndex + 1 < steps.length
          ? { toStepIndex: segmentIndex + 1, toAtMs: steps[segmentIndex + 1]!.atMs }
          : {}),
        fromAtMs: fromStep.atMs,
        fraction: planned.fraction,
        sceneCut: planned.kind === "held",
      },
      source: {
        watermark: {
          sequence: scene.source.watermark.sequence,
          watermarkMs: scene.source.watermark.watermarkMs,
        },
        generatedAtMs: scene.source.generatedAtMs,
        footballState: scene.source.footballState,
        sceneSchemaVersion: scene.sceneSchemaVersion,
      },
      appliedMarkerSequences: accounting.markers.map((marker) => marker.sequence),
      markers: accounting.markers,
      hud: {
        statusLine: line,
        cameraLabel: cameraLabel(slot.slotId),
        eventChips: accounting.chips,
        markersNotDisplayed: accounting.notDisplayed,
      },
      possession: resolved.possession,
      entities:
        entityProvenance === null
          ? resolved.manifestEntities
          : applyEntityProvenance(resolved.manifestEntities, entityProvenance),
    });
    segments.push({
      segmentId: `scene3d-${index}`,
      startMs: planned.frameMs,
      endMs: planned.windowEndMs,
      artifactRef: artifactRefOf(req, index),
    });
  }

  // Skipped markers: outside [startMs, endMs) — accounted + degradation.
  const skipped: Render3dSkippedMarker[] = markerUnion
    .filter((marker) => marker.event.eventTimeMs < startMs || marker.event.eventTimeMs >= endMs)
    .map((marker) => ({
      sequence: marker.sequence,
      eventId: marker.event.eventId,
      eventTimeMs: marker.event.eventTimeMs,
      reason:
        marker.event.eventTimeMs < startMs ? ("before-window" as const) : ("after-window" as const),
    }));

  const lastSceneWatermark = scenes[lastIndex]!.source.watermark.sequence;
  const watermarkAfter = {
    watermarkMs: endMs,
    sequence: Math.max(lastSceneWatermark, maxMarkerSequence),
  };

  const reasons: string[] = [];
  if (skipped.length > 0) reasons.push("markers-outside-render-window");
  if (style.simulateDegradation) reasons.push("simulated-degradation");

  const manifest: AvatarField3dManifest = {
    renderer: {
      rendererId: AVATAR_FIELD_RENDERER_ID,
      rendererVersion: AVATAR_FIELD_RENDERER_VERSION,
      styleId: req.styleConfig.styleId,
      configSchemaVersion: req.styleConfig.configSchemaVersion,
    },
    camera: cameraBlockOf(firstSlot!),
    session: {
      sessionId: req.sessionId,
      snapshotVersion: req.snapshotVersion,
      eventsSinceSequence: req.eventsSinceSequence,
    },
    output: { profile: req.outputProfile, startMs, frameIntervalMs: intervalMs, durationMs },
    provenance: { snapshotVersion: req.snapshotVersion, lastEventSequence },
    watermarkAfter,
    frames: manifestFrames,
    skippedMarkers: skipped,
    degradation: { degraded: reasons.length > 0, reasons },
  };
  const result = toRenderResult({
    req,
    segments,
    watermarkAfter,
    provenance: manifest.provenance,
    degradation: manifest.degradation,
  });
  return { result, frames, manifest };
}

/**
 * Overlays the motion model's per-entity provenance onto the resolved
 * manifest entries (fresh objects — the resolved entries are never
 * mutated). Every from-spec entity has exactly one provenance entry
 * (total accounting).
 */
function applyEntityProvenance(
  manifestEntities: readonly Render3dEntityEntry[],
  provenance: readonly MatchEntityProvenanceEntry[],
): Render3dEntityEntry[] {
  const byId = new Map(provenance.map((entry) => [entry.entityId, entry.provenance] as const));
  return manifestEntities.map((entry) => {
    const mark = byId.get(entry.entityId);
    if (mark === undefined) return entry;
    return {
      ...entry,
      positionProvenance: mark.positionProvenance,
      ...(mark.positionProvenance === "held" ? { heldReason: mark.heldReason } : {}),
    };
  });
}
