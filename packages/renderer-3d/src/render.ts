/**
 * The W602 render paths: validated input → deterministic SVG frame
 * sequence + manifest + contract `RenderResult`.
 *
 * Two entry points share one core (`./scene.ts` `resolve3dFrame` +
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
 *   its OWN spec — real motion, per-frame provenance (the W602 benchmark
 *   path).
 *
 * Both are PURE: no clocks, no RNG, no I/O — the same request over the same
 * input yields a deep-equal output on every call (pinned by tests).
 *
 * Fail-closed admission ({@link admitRequest}) is re-run by every render
 * entry point (defense in depth — `render` never assumes prior
 * `validateRequest`), and malformed render input fails LOUD with
 * `RendererContractError` (`media-invalid`): schema-invalid snapshots or
 * event entries, session mismatches, non-ascending event sequences,
 * schema-invalid or version-incompatible scene specifications, and unknown
 * or uncarried camera slots are never silently tolerated.
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
  MIN_DURATION_MS,
  avatarFieldCapability,
} from "./identity";
import { cameraLabel, eventChipText, statusLine } from "./hud";
import { resolve3dFrame } from "./scene";
import { composeFrame3dSvg } from "./svg";
import { FOCAL_PX, NEAR_PLANE_METERS } from "./camera";
import { deepEqual, describeValue, issuesOf, isRecord } from "./internal";
import type {
  AvatarField3dClipStep,
  AvatarField3dFrame,
  AvatarField3dManifest,
  AvatarField3dRenderOutput,
  AvatarField3dStyleConfig,
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
