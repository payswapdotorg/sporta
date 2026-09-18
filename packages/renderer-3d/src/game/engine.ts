/**
 * `Software3DEngine` — THE reference `GameEngineAdapter` implementation
 * (R302/R303/R304): a deterministic, dependency-free software 3D engine
 * that consumes canonical SWM documents and produces staged rgb24 frame
 * sequences for the codec pipeline.
 *
 * Contract posture (the frozen `@sporta/contracts` seam, mirrored from the
 * module docs there):
 *
 * - `describe()` returns the immutable descriptor (deep-equal per call;
 *   `engineKind` is the closed literal `"game-engine"` — no vendor name).
 * - `buildScene()` projects the snapshot through W601 `projectScene`
 *   (INSIDE the adapter — the renderer hands over plain SWM documents,
 *   never live internals) and applies the ordered event tail. The handle
 *   reports `appliedEventSequence` HONESTLY (0 when no events were given).
 * - `applySceneEvents()` is the event-driven presentation update seam:
 *   - **replays** (sequence ≤ the applied sequence) are skipped WITHOUT
 *     degradation (idempotent re-apply);
 *   - **out-of-envelope** entries (schema-invalid, cross-session, or a
 *     non-football taxonomy ref) are skipped WITH degradation and a reason
 *     — never a throw, never a silent drop;
 *   - valid football events extend the scene's marker stream (the chips,
 *     camera emphasis windows, and provenance the presentation consumes).
 * - `renderScene()` rasterizes the scene into a staged frame sequence
 *   (`frames-rgb24`, the descriptor's one output format) and returns the
 *   frame-output union arm with HONEST telemetry (`renderMs` measured wall
 *   time — never in the artifact bytes; `framesRendered` counted;
 *   `droppedFrames` = requested − rendered under budget truncation) and
 *   provenance (`snapshotVersion` + `lastEventSequence` actually applied).
 *
 * Determinism: the engine holds NO ambient state a render depends on —
 * `renderScene` is a pure function of (scene state, request, presentation
 * hints). The staged frame stream is content-addressed (sha-256 over the
 * concatenated frame bytes → `<stagingRoot>/objects/<hash>.rgb24`), so the
 * same input resolves to the same staging reference everywhere.
 *
 * Scene-state honesty: entity positions are the SNAPSHOT's own state (held
 * for the render window); events drive presentation only (chips, emphasis
 * windows); the camera is presentation motion (documented presets). The
 * engine never invents positions, velocities, or team assignments — the
 * W601 S2 no-invented-data discipline, carried through the engine seam.
 */
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, mkdtempSync, openSync, renameSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GameSceneBuildRequest,
  GameSceneRenderRequest,
  GameSceneUpdateResult,
  WorldEventStreamEntry,
  WorldSnapshot,
  type GameEngineDescriptor,
  type GameEngineFrameOutput,
  type GameSceneHandle,
  type GameSceneRenderResult,
} from "@sporta/contracts";
import { projectScene } from "@sporta/scene-projection";
import { emphasisWindowsOf } from "./camera";
import {
  BALL_DEFAULT_HEIGHT_M,
  FrameComposer,
  type BallView,
  type FigureView,
  type FrameMarker,
  type FrameScene,
} from "./frame";
import { entityKit, fnv1a32, jerseyNumberOf } from "./palette";
import { Framebuffer } from "./raster";
import {
  MAX_ENGINE_FRAMES,
  MAX_LIVE_SCENES,
  MAX_SCENE_ENTITIES,
  type GameCameraKey,
  software3dDescriptor,
} from "./identity";

/** The typed error of the reference engine (fail-loud, never swallowed). */
export class Software3DEngineError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "Software3DEngineError";
  }
}

/** Engine construction options (all optional; defaults are self-contained). */
export interface Software3DEngineOptions {
  /**
   * The staging root for rendered frame sequences. Default: a fresh
   * `mkdtemp` under the OS tmpdir (staging is TEMPORARY — the durable
   * artifact is the codec pipeline's content-addressed MP4; hosts may
   * clean the staging root after encode).
   */
  stagingRoot?: string;
}

/** One live scene's state (built from a snapshot + applied events). */
interface SceneState {
  handle: GameSceneHandle;
  renderingStyle: "stylized-3d" | "cel-shaded";
  frameScene: FrameScene;
  /** Cumulative out-of-envelope degradation reasons (build + applies). */
  degradationReasons: string[];
  /** Events at/below this sequence are snapshot content (replays). */
  replayFloor: number;
}

/** The internal event-application accounting of one batch. */
interface EventApplication {
  result: GameSceneUpdateResult;
  markers: FrameMarker[];
  appliedSequence: number;
  outOfEnvelopeReasons: string[];
}

/**
 * THE reference software 3D engine. One instance carries up to
 * {@link MAX_LIVE_SCENES} live scenes; every method is synchronous (the
 * frozen seam allows MaybePromise; a synchronous engine keeps the W501
 * conformance path synchronous end to end).
 */
export class Software3DEngine {
  private readonly stagingRoot: string;
  private readonly scenes = new Map<string, SceneState>();
  private tempCounter = 0;
  private disposed = false;

  constructor(options: Software3DEngineOptions = {}) {
    this.stagingRoot = options.stagingRoot ?? mkdtempSync(join(tmpdir(), "sporta-software3d-"));
    mkdirSync(join(this.stagingRoot, "objects"), { recursive: true });
  }

  /** The immutable descriptor (deep-equal on every call). */
  describe(): GameEngineDescriptor {
    return software3dDescriptor();
  }

  /** The staging root (exposed for hosts that clean up after encode). */
  stagingRootPath(): string {
    return this.stagingRoot;
  }

  /**
   * Builds a scene from an SWM snapshot plus the event tail to apply.
   * The snapshot is projected through W601 inside the adapter; the event
   * tail goes through the same envelope accounting as
   * {@link applySceneEvents}; the handle reports the applied sequence and
   * the scene's carried entity count honestly.
   */
  buildScene(
    request: GameSceneBuildRequest,
    snapshot: WorldSnapshot,
    events: WorldEventStreamEntry[],
  ): GameSceneHandle {
    this.requireLive();
    const parsedRequest = GameSceneBuildRequest.safeParse(request);
    if (!parsedRequest.success) {
      throw new Software3DEngineError(
        `buildScene: the request is not a valid GameSceneBuildRequest (${issuesOf(
          parsedRequest.error,
        )})`,
      );
    }
    if (snapshot.sessionId !== request.sessionId) {
      throw new Software3DEngineError(
        `buildScene: snapshot belongs to session "${snapshot.sessionId}", not "${request.sessionId}"`,
      );
    }
    const descriptor = this.describe();
    if (!descriptor.renderingStyles.includes(request.renderingStyle)) {
      throw new Software3DEngineError(
        `buildScene: rendering style "${request.renderingStyle}" is not one this engine supports`,
        { supported: descriptor.renderingStyles },
      );
    }
    if (this.scenes.size >= MAX_LIVE_SCENES) {
      throw new Software3DEngineError(
        `buildScene: this engine instance already carries ${this.scenes.size} live scenes (bound ${MAX_LIVE_SCENES})`,
      );
    }

    // Scene construction runs the W601 projection INSIDE the adapter: the
    // canonical scene source, never a renderer-side fork of it. ONE
    // projection feeds the score/clock view, the figures, and the ball.
    const scene = projectScene(snapshot, { events: [] });
    const styleKey = styleKeyOf(request.sessionId, request.renderingStyle);
    const figures = resolveFiguresFromProjection(styleKey, snapshot, scene);
    const ball = resolveBallFromProjection(scene);
    const projectableCount = figures.length + (ball !== null ? 1 : 0);
    const figureBudget = MAX_SCENE_ENTITIES - (ball !== null ? 1 : 0); // the ball always carries
    const carriedFigures = figures.slice(0, Math.max(0, figureBudget));
    const droppedEntities = projectableCount - (carriedFigures.length + (ball !== null ? 1 : 0));

    // The event tail: same accounting seam as applySceneEvents (replays —
    // at/below the snapshot watermark OR already applied — skip quietly;
    // out-of-envelope entries degrade with reasons).
    const replayFloor = Math.max(0, snapshot.watermark.sequence);
    const application = applyEventBatch(0, replayFloor, [], request.sessionId, events);
    const degradationReasons = [...application.outOfEnvelopeReasons];
    if (droppedEntities > 0) {
      degradationReasons.push(
        `entity-count-above-envelope: ${projectableCount} projectable entities, envelope ${MAX_SCENE_ENTITIES}`,
      );
    }

    const handle: GameSceneHandle = {
      sceneId: sceneIdOf(request, application.appliedSequence),
      sessionId: request.sessionId,
      snapshotVersion: request.snapshotVersion,
      appliedEventSequence: application.appliedSequence,
      entityCount: carriedFigures.length + (ball !== null ? 1 : 0),
    };
    const frameScene: FrameScene = {
      sessionId: request.sessionId,
      styleKey,
      figures: carriedFigures,
      ball,
      scoreClock: scene.scoreClock,
      markers: application.markers,
      possessionEntityId: possessionEntityIdOf(snapshot),
      watermarkMs: snapshot.watermark.watermarkMs,
    };
    this.scenes.set(handle.sceneId, {
      handle,
      renderingStyle: request.renderingStyle === "cel-shaded" ? "cel-shaded" : "stylized-3d",
      frameScene,
      degradationReasons,
      replayFloor,
    });
    return { ...handle };
  }

  /**
   * Applies ordered events to a built scene. Replays skip quietly; entries
   * outside the supported envelope (schema-invalid, cross-session,
   * non-football taxonomy) skip WITH degradation; valid football events
   * extend the marker stream and bump the applied sequence.
   */
  applySceneEvents(
    handle: GameSceneHandle,
    events: WorldEventStreamEntry[],
  ): GameSceneUpdateResult {
    this.requireLive();
    const state = this.requireScene(handle);
    const application = applyEventBatch(
      state.handle.appliedEventSequence,
      state.replayFloor,
      state.frameScene.markers,
      state.handle.sessionId,
      events,
    );
    state.handle = { ...state.handle, appliedEventSequence: application.appliedSequence };
    state.frameScene = { ...state.frameScene, markers: application.markers };
    state.degradationReasons = [...state.degradationReasons, ...application.outOfEnvelopeReasons];
    return application.result;
  }

  /**
   * Renders the scene into a staged rgb24 frame sequence (the descriptor's
   * one output format). Frames stream to the staging file as they render
   * (the rasterizer reuses one framebuffer); the staged bytes are
   * content-addressed by the sha-256 of the concatenated stream.
   */
  renderScene(request: GameSceneRenderRequest): GameSceneRenderResult {
    this.requireLive();
    const parsed = GameSceneRenderRequest.safeParse(request);
    if (!parsed.success) {
      throw new Software3DEngineError(
        `renderScene: the request is not a valid GameSceneRenderRequest (${issuesOf(parsed.error)})`,
      );
    }
    const state = this.requireSceneByRenderRequest(request);
    const descriptor = this.describe();
    const profile = request.outputProfile;
    if (!descriptor.outputFormats.includes(profile.format)) {
      throw new Software3DEngineError(
        `renderScene: output format "${profile.format}" is not one this engine produces`,
        { produced: descriptor.outputFormats },
      );
    }

    // Frame plan with the honest budget: truncate + count drops.
    const requestedFrames = Math.max(1, Math.ceil((profile.durationMs * profile.fps) / 1000));
    const framesToRender = Math.min(requestedFrames, MAX_ENGINE_FRAMES);
    const droppedFrames = requestedFrames - framesToRender;

    // Presentation hints (engine-interpreted; unknown keys use documented
    // defaults — the frozen seam's hint semantics).
    const cameraHint = request.presentation?.["camera"];
    const behavior: GameCameraKey =
      cameraHint === "sideline-follow" ? "sideline-follow" : "aerial-follow";
    const seed = Number.parseInt(request.presentation?.["seed"] ?? "0", 10) || 0;

    const fb = new Framebuffer(profile.widthPx, profile.heightPx);
    const composer = new FrameComposer(state.renderingStyle, profile.widthPx, profile.heightPx);
    const emphasisWindows = emphasisWindowsOf(state.frameScene.markers);

    // Stream frames to a temp file, hashing as we go; rename to the
    // content-addressed object name once the digest is final.
    const tempRef = join(
      this.stagingRoot,
      "objects",
      `.tmp-${process.pid}-${(this.tempCounter += 1)}.rgb24`,
    );
    const hash = createHash("sha256");
    const startedAt = Date.now();
    const fd = openSync(tempRef, "w");
    try {
      for (let index = 0; index < framesToRender; index += 1) {
        composer.renderFrame({
          fb,
          scene: state.frameScene,
          tMs: (index * 1000) / profile.fps,
          seed,
          behavior,
          emphasisWindows,
        });
        writeSync(fd, fb.bytes);
        hash.update(fb.bytes);
      }
    } finally {
      closeSync(fd);
    }
    const renderMs = Date.now() - startedAt;
    const digest = hash.digest("hex");
    const stagingRef = join(this.stagingRoot, "objects", `${digest}.rgb24`);
    renameSync(tempRef, stagingRef);

    const output: GameEngineFrameOutput = {
      kind: "frame-output",
      stagingRef,
      frameCount: framesToRender,
      widthPx: profile.widthPx,
      heightPx: profile.heightPx,
      fps: profile.fps,
      pixelFormat: "rgb24",
    };

    const reasons = [...state.degradationReasons];
    if (droppedFrames > 0) {
      reasons.push(
        `frame-budget-overrun: ${requestedFrames} frames requested, ${framesToRender} rendered (budget ${MAX_ENGINE_FRAMES})`,
      );
    }
    return {
      output,
      telemetry: { renderMs, framesRendered: framesToRender, droppedFrames },
      provenance: {
        snapshotVersion: state.handle.snapshotVersion,
        lastEventSequence: state.handle.appliedEventSequence,
      },
      degraded: reasons.length > 0,
      ...(reasons.length > 0 ? { degradationReason: reasons.join("; ") } : {}),
    };
  }

  /** Releases the scene registry; terminal for the instance. */
  dispose(): void {
    this.disposed = true;
    this.scenes.clear();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private requireLive(): void {
    if (this.disposed) {
      throw new Software3DEngineError("Software3DEngine is disposed");
    }
  }

  private requireScene(handle: GameSceneHandle): SceneState {
    const state = this.scenes.get(handle.sceneId);
    if (state === undefined) {
      throw new Software3DEngineError(
        `no scene with id "${handle.sceneId}" on this engine instance`,
        { sceneId: handle.sceneId },
      );
    }
    if (state.handle.sessionId !== handle.sessionId) {
      throw new Software3DEngineError(
        `scene "${handle.sceneId}" belongs to session "${state.handle.sessionId}", not "${handle.sessionId}"`,
      );
    }
    return state;
  }

  private requireSceneByRenderRequest(request: GameSceneRenderRequest): SceneState {
    const state = this.scenes.get(request.sceneId);
    if (state === undefined) {
      throw new Software3DEngineError(
        `renderScene: no scene with id "${request.sceneId}" on this engine instance`,
        { sceneId: request.sceneId },
      );
    }
    return state;
  }
}

// ---------------------------------------------------------------------------
// Pure scene-resolution helpers
// ---------------------------------------------------------------------------

/** Formats zod issues as `path: message; ...` (the repo's reporting shape). */
function issuesOf(error: {
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
}): string {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
}

/**
 * Applies one ordered event batch to a marker stream (the shared
 * accounting of `buildScene` and `applySceneEvents`). Pure; returns the
 * public update result plus the internal carriers. `replayFloor` is the
 * snapshot's watermark sequence — events at/below it (or at/below the
 * applied sequence) are replays: skipped WITHOUT degradation.
 */
function applyEventBatch(
  appliedSequence: number,
  replayFloor: number,
  existingMarkers: readonly FrameMarker[],
  sessionRef: string,
  events: WorldEventStreamEntry[],
): EventApplication {
  let applied = appliedSequence;
  let skipped = 0;
  const outOfEnvelopeReasons: string[] = [];
  const markers: FrameMarker[] = [...existingMarkers];
  for (const entry of events) {
    const parsed = WorldEventStreamEntry.safeParse(entry);
    if (!parsed.success) {
      skipped += 1;
      outOfEnvelopeReasons.push("out-of-envelope: entry failed WorldEventStreamEntry validation");
      continue;
    }
    const valid = parsed.data;
    if (valid.event.sessionId !== sessionRef) {
      skipped += 1;
      outOfEnvelopeReasons.push(
        `out-of-envelope: event ${valid.event.eventId} belongs to session "${valid.event.sessionId}", not "${sessionRef}"`,
      );
      continue;
    }
    if (!valid.event.eventTypeRef.startsWith("football/")) {
      skipped += 1;
      outOfEnvelopeReasons.push(
        `out-of-envelope: event ${valid.event.eventId} carries non-football taxonomy ref "${valid.event.eventTypeRef}"`,
      );
      continue;
    }
    if (valid.sequence <= applied || valid.sequence <= replayFloor) {
      // Replay: already applied or already inside the snapshot — skipped
      // WITHOUT degradation.
      skipped += 1;
      continue;
    }
    markers.push({
      sequence: valid.sequence,
      eventId: valid.event.eventId,
      eventTimeMs: valid.event.eventTimeMs,
      eventTypeRef: valid.event.eventTypeRef,
    });
    applied = Math.max(applied, valid.sequence);
  }
  markers.sort((a, b) => a.sequence - b.sequence);
  return {
    result: {
      appliedEventSequence: applied,
      skippedEvents: skipped,
      degraded: outOfEnvelopeReasons.length > 0,
      ...(outOfEnvelopeReasons.length > 0
        ? { degradationReason: [...new Set(outOfEnvelopeReasons)].join("; ") }
        : {}),
    },
    markers,
    appliedSequence: applied,
    outOfEnvelopeReasons,
  };
}

/** The identity-stable style key of one scene build. */
function styleKeyOf(sessionId: string, renderingStyle: string): string {
  return `software3d:${renderingStyle}:${sessionId}`;
}

/** The deterministic scene id of one build. */
function sceneIdOf(request: GameSceneBuildRequest, appliedSequence: number): string {
  return `sw3d-${fnv1a32(
    `${request.sessionId}:${request.snapshotVersion}:${request.renderingStyle}:${appliedSequence}`,
  ).toString(16)}`;
}

/** Reads the possession candidate (verbatim slot or null). */
function possessionEntityIdOf(snapshot: WorldSnapshot): string | null {
  const possession = snapshot.football?.possession;
  if (
    possession !== undefined &&
    possession.status === "known" &&
    typeof possession.value?.entityId === "string"
  ) {
    return possession.value.entityId;
  }
  return null;
}

/** Resolves the drawable figures from ONE projection + the RAW snapshot state. */
function resolveFiguresFromProjection(
  styleKey: string,
  snapshot: WorldSnapshot,
  scene: ReturnType<typeof projectScene>,
): FigureView[] {
  const figures: FigureView[] = [];
  const byId = new Map(snapshot.entities.map((entity) => [entity.entityId, entity]));
  for (const entity of scene.entities) {
    if (entity.kind !== "participant" && entity.kind !== "official") continue;
    if (entity.disposition !== "projected" && entity.disposition !== "projected-out-of-bounds") {
      continue; // accounted by the projection; never placed
    }
    const raw = byId.get(entity.entityId);
    const state = raw?.state ?? {};
    const teamRole = knownString(state["teamRole"]);
    const teamId = knownString(state["teamId"]);
    const jerseyNumber = knownNumber(state["jerseyNumber"]);
    const kit = entityKit({
      styleKey,
      entityId: entity.entityId,
      kind: entity.kind,
      teamRole,
      teamId,
    });
    figures.push({
      entityId: entity.entityId,
      kind: entity.kind,
      x: entity.position?.x ?? 0,
      y: entity.position?.y ?? 0,
      kitColor: kit.color,
      goalkeeper: kit.goalkeeper,
      jersey: jerseyNumberOf(entity.entityId, jerseyNumber),
      headingRad:
        entity.heading?.status === "known" && typeof entity.heading.radians === "number"
          ? entity.heading.radians
          : null,
    });
  }
  return figures;
}

/** Resolves the ball view from the projection (height verbatim when carried). */
function resolveBallFromProjection(scene: ReturnType<typeof projectScene>): BallView | null {
  for (const entity of scene.entities) {
    if (entity.kind !== "ball") continue;
    if (entity.disposition !== "projected" && entity.disposition !== "projected-out-of-bounds") {
      return null;
    }
    return {
      x: entity.position?.x ?? 0,
      y: entity.position?.y ?? 0,
      z:
        entity.height?.status === "known" && typeof entity.height.meters === "number"
          ? entity.height.meters
          : BALL_DEFAULT_HEIGHT_M,
    };
  }
  return null;
}

function knownString(value: unknown): string | null {
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { status?: unknown }).status === "known" &&
    typeof (value as { value?: unknown }).value === "string"
  ) {
    return (value as { value: string }).value;
  }
  return null;
}

function knownNumber(value: unknown): number | null {
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { status?: unknown }).status === "known" &&
    typeof (value as { value?: unknown }).value === "number"
  ) {
    return (value as { value: number }).value;
  }
  return null;
}
