/**
 * The W502 render paths: snapshot/event input → frame sequence + manifest +
 * contract `RenderResult`.
 *
 * Two entry points share one core (`./scene.ts` `resolveFrame` +
 * `./svg.ts` `composeFrameSvg`):
 *
 * - {@link renderAnimeFromSnapshot}: the RENDERER-CONTRACT path — one
 *   immutable SWM snapshot plus the ordered events since its watermark
 *   (`RenderInput`, exactly what `RendererPlugin.render` receives). The
 *   output timeline starts at the snapshot watermark; the snapshot state is
 *   the best-known coherent state, so entity positions are held while
 *   event captions evolve per frame (the honest rendering of a single
 *   snapshot — positions are never invented between watermarks).
 * - {@link renderAnimeClip}: the CLIP path — a timeline of snapshots (one
 *   per step, e.g. `@sporta/temporal` `stateAt` results) with per-step
 *   caption windows (e.g. `eventWindow`). Each step renders one frame from
 *   its own snapshot — real motion, per-frame provenance.
 *
 * Both are PURE: no clocks, no RNG, no I/O — the same request over the
 * same input yields a deep-equal output on every call (pinned by tests).
 *
 * Fail-closed admission ({@link admitRequest}) is re-run by every render
 * entry point (defense in depth — `render` never assumes prior
 * `validateRequest`), and malformed render input fails LOUD with
 * `RendererContractError` (`media-invalid`): schema-invalid snapshots or
 * event entries, session mismatches, or non-ascending event sequences are
 * never silently tolerated.
 */
import { WorldEventStreamEntry, WorldSnapshot } from "@sporta/contracts";
import type { OutputProfile, RenderRequest, RenderResult } from "@sporta/contracts";
import { RendererContractError } from "@sporta/renderer-contract";
import type { RenderInput, RequestRejection } from "@sporta/renderer-contract";
import {
  ANIME_RENDERER_ID,
  ANIME_RENDERER_VERSION,
  DEFAULT_DURATION_MS,
  MAX_DURATION_MS,
  MIN_DURATION_MS,
  animeCapability,
} from "./identity";
import { resolveFrame } from "./scene";
import { composeFrameSvg } from "./svg";
import type {
  AnimeClipManifest,
  AnimeClipStep,
  AnimeFrame,
  AnimeRenderOutput,
  AnimeSkippedEvent,
  AnimeStyleConfig,
} from "./types";
// ---------------------------------------------------------------------------
// Small structural helpers (JSON-space, like the renderer-contract internal)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep equality over JSON-safe values (primitives, arrays, records). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    return (
      keysA.length === keysB.length && keysA.every((key) => key in b && deepEqual(a[key], b[key]))
    );
  }
  return false;
}

function describeValue(value: unknown): string {
  if (typeof value === "string") return `string "${value}"`;
  if (typeof value === "number") return `number ${String(value)}`;
  if (typeof value === "boolean") return `boolean ${String(value)}`;
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function issuesOf(error: {
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
}): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.map(String).join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
}

// ---------------------------------------------------------------------------
// Style configuration + fail-closed request admission
// ---------------------------------------------------------------------------

/**
 * Parses `styleConfig.config`: `undefined` → defaults; `durationMs` must be
 * a finite number in `[1, 3_600_000]` (bounded render work);
 * `simulateDegradation` must be a boolean. Unknown keys are ignored
 * (forward-compatible style configuration).
 */
export function parseStyleConfig(
  config: unknown,
): { ok: true; value: AnimeStyleConfig } | { ok: false; reason: string } {
  if (config === undefined) {
    return {
      ok: true,
      value: { durationMs: DEFAULT_DURATION_MS, simulateDegradation: false },
    };
  }
  if (!isRecord(config)) {
    return {
      ok: false,
      reason: `styleConfig.config must be an object (got ${describeValue(config)})`,
    };
  }
  let durationMs = DEFAULT_DURATION_MS;
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
  if (config.simulateDegradation !== undefined) {
    if (typeof config.simulateDegradation !== "boolean") {
      return {
        ok: false,
        reason: `styleConfig.config.simulateDegradation must be a boolean (got ${describeValue(config.simulateDegradation)})`,
      };
    }
    simulateDegradation = config.simulateDegradation;
  }
  return { ok: true, value: { durationMs, simulateDegradation } };
}

/** Successful admission: the parsed style configuration. */
export interface RequestAdmission {
  ok: true;
  style: AnimeStyleConfig;
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
 *    `minSnapshotVersion` and, being a schema `int >= 0`, never negative
 *    (`media-invalid`).
 * 4. **Rights (fail-closed, beyond the R2 baseline)**: a request that
 *    CARRIES source-frame references with
 *    `rightsCapabilities.canReferenceSourceFrames === false` is rejected
 *    with `rights-denied`. The anime prototype itself needs no source
 *    pixels (`requiresSourceFrames: false`, pure SWM projection), so the
 *    R2 baseline probe is n/a for this plugin — but receiving unauthorized
 *    references is refused rather than silently consumed. Storage/sharing
 *    capabilities are host-side concerns (W701 gates delivery; renderer
 *    gates references).
 * 5. **Style config**: parsed and validated (`media-invalid`).
 */
export function admitRequest(req: RenderRequest): RequestAdmission | RequestRejection {
  const capability = animeCapability();
  if (req.rendererId !== ANIME_RENDERER_ID || req.rendererVersion !== ANIME_RENDERER_VERSION) {
    return {
      ok: false,
      reason: `request targets renderer ${req.rendererId}@${req.rendererVersion}, but this plugin is ${ANIME_RENDERER_ID}@${ANIME_RENDERER_VERSION}`,
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
function enforceAdmission(req: RenderRequest): AnimeStyleConfig {
  const admission = admitRequest(req);
  if (!admission.ok) {
    throw new RendererContractError(`render refused: ${admission.reason}`, admission.failureClass, {
      rendererId: ANIME_RENDERER_ID,
      rendererVersion: ANIME_RENDERER_VERSION,
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
 * Validates the SWM documents a render consumes. A schema-invalid snapshot
 * or event entry, a session mismatch, or (single-snapshot path only) a
 * non-ascending event sequence / sequence not after the snapshot watermark
 * throws `RendererContractError` (`media-invalid`) — never a silent
 * fallback, never a guessed render.
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

// ---------------------------------------------------------------------------
// Shared assembly
// ---------------------------------------------------------------------------

/** The frame interval implied by the (already admitted) output profile. */
function frameIntervalMsOf(profile: OutputProfile): number {
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

/** The artifact URI of one frame (opaque; bytes live with the host/W504). */
function artifactRefOf(req: RenderRequest, frameIndex: number): string {
  return `anime://${req.sessionId}/${req.snapshotVersion}/${frameIndex}`;
}

// ---------------------------------------------------------------------------
// Path 1: the renderer-contract path (single snapshot + events since)
// ---------------------------------------------------------------------------

/**
 * Renders the contract `RenderInput` (one snapshot + ordered events since
 * its watermark) into a frame sequence, the manifest, and the contract
 * `RenderResult`. The frame timeline starts at the snapshot watermark;
 * frames are `1000 / outputProfile.frameRate` apart; the snapshot state is
 * held across frames while captions evolve with the events in each frame's
 * window `[start + i·interval, start + (i+1)·interval)` (the last window is
 * clipped to `start + durationMs`).
 *
 * Event application semantics (R5/R6/R7, test-pinned):
 *
 * - an event is APPLIED iff its `eventTimeMs` falls in
 *   `[start, start + durationMs)` — it is consumed by exactly one frame;
 * - `provenance.lastEventSequence` is the highest APPLIED sequence (0 when
 *   none), never more;
 * - events before the window or at/after its end are SKIPPED with an
 *   accounted reason AND flip `rendererHealth.degraded` with the reason
 *   `"events-outside-render-window"` (explicit degradation, never silent
 *   staleness);
 * - `watermarkAfter.sequence` follows R6: the LAST INPUT event's sequence
 *   (even when it was skipped), or the snapshot watermark sequence when no
 *   events were passed.
 */
export function renderAnimeFromSnapshot(req: RenderRequest, input: RenderInput): AnimeRenderOutput {
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

  const startMs = input.snapshot.watermark.watermarkMs;
  const intervalMs = frameIntervalMsOf(req.outputProfile);
  const durationMs = style.durationMs;
  const windowEndMs = startMs + durationMs;
  const frameCount = Math.max(1, Math.ceil(durationMs / intervalMs));

  const frames: AnimeFrame[] = [];
  const manifestFrames: AnimeClipManifest["frames"] = [];
  const segments: RenderResult["outputSegments"] = [];
  for (let index = 0; index < frameCount; index += 1) {
    const frameStartMs = startMs + index * intervalMs;
    const frameEndMs = Math.min(frameStartMs + intervalMs, windowEndMs);
    const captionEvents = input.events.filter(
      (entry) => entry.event.eventTimeMs >= frameStartMs && entry.event.eventTimeMs < frameEndMs,
    );
    const resolved = resolveFrame({ snapshot: input.snapshot, events: captionEvents });
    resolved.scene.frameIndex = index;
    const svg = composeFrameSvg(resolved.scene);
    frames.push({ frameIndex: index, outputTimestampMs: frameStartMs, svg });
    manifestFrames.push({
      frameIndex: index,
      outputTimestampMs: frameStartMs,
      windowMs: { startMs: frameStartMs, endMs: frameEndMs },
      source: resolved.entry.source,
      appliedEventSequences: resolved.entry.appliedEventSequences,
      captions: resolved.entry.captions,
      possession: resolved.entry.possession,
      entities: resolved.entry.entities,
    });
    segments.push({
      segmentId: `anime-${index}`,
      startMs: frameStartMs,
      endMs: frameEndMs,
      artifactRef: artifactRefOf(req, index),
    });
  }

  // Event accounting: applied = within [startMs, windowEndMs).
  const applied = input.events.filter(
    (entry) => entry.event.eventTimeMs >= startMs && entry.event.eventTimeMs < windowEndMs,
  );
  const skipped: AnimeSkippedEvent[] = input.events
    .filter((entry) => entry.event.eventTimeMs < startMs || entry.event.eventTimeMs >= windowEndMs)
    .map((entry) => ({
      sequence: entry.sequence,
      eventId: entry.event.eventId,
      eventTimeMs: entry.event.eventTimeMs,
      reason:
        entry.event.eventTimeMs < startMs ? ("before-window" as const) : ("after-window" as const),
    }));
  const lastEventSequence = applied.length > 0 ? applied[applied.length - 1]!.sequence : 0;
  const watermarkAfter = {
    watermarkMs: windowEndMs,
    sequence:
      input.events.length > 0
        ? input.events[input.events.length - 1]!.sequence
        : input.snapshot.watermark.sequence,
  };

  const reasons: string[] = [];
  if (skipped.length > 0) reasons.push("events-outside-render-window");
  if (style.simulateDegradation) reasons.push("simulated-degradation");

  const manifest: AnimeClipManifest = {
    renderer: {
      rendererId: ANIME_RENDERER_ID,
      rendererVersion: ANIME_RENDERER_VERSION,
      styleId: req.styleConfig.styleId,
      configSchemaVersion: req.styleConfig.configSchemaVersion,
    },
    session: {
      sessionId: req.sessionId,
      snapshotVersion: req.snapshotVersion,
      eventsSinceSequence: req.eventsSinceSequence,
    },
    output: { profile: req.outputProfile, startMs, frameIntervalMs: intervalMs, durationMs },
    provenance: { snapshotVersion: req.snapshotVersion, lastEventSequence },
    watermarkAfter,
    frames: manifestFrames,
    skippedEvents: skipped,
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
// Path 2: the clip path (timeline of snapshots + per-step caption windows)
// ---------------------------------------------------------------------------

/**
 * Validates clip steps: at least one; finite `atMs >= 0`; strictly
 * increasing; each snapshot a schema-valid session-consistent
 * `WorldSnapshot`; each step's events valid, session-consistent, and
 * strictly ascending within the step (cross-step attribution is the
 * caller's `eventWindow` choice and may legitimately overlap).
 */
function enforceValidSteps(req: RenderRequest, steps: readonly AnimeClipStep[]): void {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new RendererContractError(
      "renderAnimeClip requires a non-empty array of clip steps",
      "media-invalid",
      { sessionId: req.sessionId },
    );
  }
  let previousAtMs: number | undefined;
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]!;
    if (step === null || typeof step !== "object" || Array.isArray(step)) {
      throw new RendererContractError(
        `clip steps[${i}] must be an AnimeClipStep object`,
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
    enforceValidSnapshot(req, step.snapshot);
    if (!Array.isArray(step.events)) {
      throw new RendererContractError(
        `clip steps[${i}].events must be an array of WorldEventStreamEntry`,
        "media-invalid",
        { sessionId: req.sessionId, index: i },
      );
    }
    enforceValidEvents(req, step.events, {});
  }
}

/**
 * Renders a short clip: one frame per step, each synthesized from the
 * step's own SWM snapshot with the step's events as its caption window
 * (input order preserved). The typical construction is
 * `stateAt(engine, t)` + `eventWindow(entries, {fromMs, toMs})` per step
 * (the `@sporta/temporal` W402 seams — see the integration tests).
 *
 * `styleConfig.config.durationMs` is NOT used on this path (the step
 * timestamps define the timeline); it is still validated for admission
 * uniformity. All step events are consumed (applied): each appears in
 * exactly one frame's captions or its uncaptioned accounting;
 * `skippedEvents` is therefore always empty and degradation can only come
 * from `simulateDegradation`. `watermarkAfter` follows the R6 analog: the
 * highest input event sequence, or the last snapshot's watermark sequence
 * when no events were passed at all.
 */
export function renderAnimeClip(
  req: RenderRequest,
  steps: readonly AnimeClipStep[],
): AnimeRenderOutput {
  const style = enforceAdmission(req);
  enforceValidSteps(req, steps);

  const intervalMs = frameIntervalMsOf(req.outputProfile);
  const frames: AnimeFrame[] = [];
  const manifestFrames: AnimeClipManifest["frames"] = [];
  const segments: RenderResult["outputSegments"] = [];
  let lastEventSequence = 0;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    const nextAtMs = index + 1 < steps.length ? steps[index + 1]!.atMs : step.atMs + intervalMs;
    const resolved = resolveFrame({ snapshot: step.snapshot, events: step.events });
    resolved.scene.frameIndex = index;
    const svg = composeFrameSvg(resolved.scene);
    frames.push({ frameIndex: index, outputTimestampMs: step.atMs, svg });
    manifestFrames.push({
      frameIndex: index,
      outputTimestampMs: step.atMs,
      windowMs: { startMs: step.atMs, endMs: nextAtMs },
      source: resolved.entry.source,
      appliedEventSequences: resolved.entry.appliedEventSequences,
      captions: resolved.entry.captions,
      possession: resolved.entry.possession,
      entities: resolved.entry.entities,
    });
    segments.push({
      segmentId: `anime-${index}`,
      startMs: step.atMs,
      endMs: nextAtMs,
      artifactRef: artifactRefOf(req, index),
    });
    for (const entry of step.events) {
      if (entry.sequence > lastEventSequence) lastEventSequence = entry.sequence;
    }
  }

  const lastStep = steps[steps.length - 1]!;
  const startMs = steps[0]!.atMs;
  const durationMs = lastStep.atMs + intervalMs - startMs;
  const watermarkAfter = {
    watermarkMs: lastStep.atMs + intervalMs,
    sequence: lastEventSequence > 0 ? lastEventSequence : lastStep.snapshot.watermark.sequence,
  };
  const reasons: string[] = [];
  if (style.simulateDegradation) reasons.push("simulated-degradation");

  const manifest: AnimeClipManifest = {
    renderer: {
      rendererId: ANIME_RENDERER_ID,
      rendererVersion: ANIME_RENDERER_VERSION,
      styleId: req.styleConfig.styleId,
      configSchemaVersion: req.styleConfig.configSchemaVersion,
    },
    session: {
      sessionId: req.sessionId,
      snapshotVersion: req.snapshotVersion,
      eventsSinceSequence: req.eventsSinceSequence,
    },
    output: { profile: req.outputProfile, startMs, frameIntervalMs: intervalMs, durationMs },
    provenance: { snapshotVersion: req.snapshotVersion, lastEventSequence },
    watermarkAfter,
    frames: manifestFrames,
    skippedEvents: [],
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
