/**
 * The W503 evaluation fixtures (deliverables 3 and 4).
 *
 * **The clean fixture** ({@link renderW503CleanFixture}): a replication, in
 * this package, of the canonical W502 fixture clip — the 6-step clip
 * (t = 1000..6000) over one session with 3 positioned participants (one
 * moving at 0.8 m/s, one uncertain-moving at 0.6 m/s, one static), a
 * no-position participant (justified omission every frame), near- and
 * off-canvas out-of-play participants, a non-renderable kind, a moving ball
 * with confidence 0.9, a football state (possession of player-7), and the
 * 5-event caption stream (one uncaptionable). It is built by DRIVING THE
 * REAL RENDERER (`renderAnimeClip` from `@sporta/renderer-anime`) through
 * `@sporta/testing` builders — the W502 package's own test helpers are NOT
 * importable from src (test-only), so the fixture construction is
 * replicated here verbatim (same session, same entities, same motions,
 * same event stream). The clean fixture MUST pass every threshold, with
 * the measured values pinned by tests (flicker 0, styleStability 1.0, …).
 *
 * **The defect injections** (`inject*`): pure manifest-level perturbations.
 * Each deep-clones the manifest and mutates ONE thing to simulate one
 * defect class an (honest-but-buggy or adversarial) renderer could produce.
 * Each is proven detected by `test/detection.test.ts` — a metric that
 * cannot detect its defect class is rejected (the accept criterion's
 * teeth). The injections never repair or reflow anything else: the
 * perturbed manifest stays structurally valid (validation passes) so the
 * DEFECT is measured, not the malformation.
 *
 * Deterministic: fixed constants, no clock, no RNG.
 */
import type {
  AnimeClipManifest,
  AnimeClipStep,
  AnimeEntityEntry,
  AnimeFrame,
  AnimeRenderOutput,
} from "@sporta/renderer-anime";
import {
  ANIME_OUTPUT_PROFILE,
  ANIME_RENDERER_ID,
  ANIME_RENDERER_VERSION,
  PLAYER_PALETTE,
  renderAnimeClip,
  toCanvasRounded,
} from "@sporta/renderer-anime";
import type {
  RenderRequest,
  RightsCapabilities,
  WorldEventStreamEntry,
  WorldSnapshot,
} from "@sporta/contracts";
import { buildEventEnvelope, buildRenderRequest, buildWorldSnapshot } from "@sporta/testing";
import type { DeepPartial } from "@sporta/testing";
import { TemporalEvaluationError } from "./errors";

/** The fixture session (the same session the W502 fixture clip uses). */
export const W503_SESSION_ID = "sess-anime-clip";

/** Full-allow rights (the happy-path capability set). */
export const W503_ALLOW_ALL: RightsCapabilities = {
  canReferenceSourceFrames: true,
  canDeliverLive: true,
  canStoreDerivatives: true,
  canShare: true,
};

/** A deterministic, contract-valid render request targeting the W502 plugin. */
export function buildW503RenderRequest(overrides: DeepPartial<RenderRequest> = {}): RenderRequest {
  return buildRenderRequest({
    sessionId: W503_SESSION_ID,
    rendererId: ANIME_RENDERER_ID,
    rendererVersion: ANIME_RENDERER_VERSION,
    snapshotVersion: 1,
    eventsSinceSequence: 0,
    outputProfile: ANIME_OUTPUT_PROFILE,
    styleConfig: { styleId: "style-anime-test", configSchemaVersion: "1.0", config: {} },
    rightsCapabilities: W503_ALLOW_ALL,
    sourceFrameRefs: [],
    ...overrides,
  });
}

/** The fixture snapshot at step `index` (0-based; atMs = (index+1)·1000). */
export function buildW503Snapshot(index: number): WorldSnapshot {
  const atMs = (index + 1) * 1_000;
  const player7X = 52.5 + 0.8 * index; // 52.5 → 56.5
  const player9Y = 20 + 0.6 * index; // 20 → 23
  const ballX = 50.5 + 0.5 * index; // 50.5 → 53
  return buildWorldSnapshot(
    {
      sessionId: W503_SESSION_ID,
      watermark: { watermarkMs: atMs, sequence: 10 + index },
      generatedAtMs: 1_736_164_800_000,
      entities: [
        {
          entityId: "player-7",
          kind: "participant",
          version: 2,
          lastEventTimeMs: atMs,
          state: { pitchPosition: { status: "known", value: { x: player7X, y: 34 } } },
        },
        {
          entityId: "player-9",
          kind: "participant",
          version: 3,
          lastEventTimeMs: atMs,
          state: {
            pitchPosition: { status: "uncertain", value: { x: 30, y: player9Y }, confidence: 0.7 },
          },
        },
        {
          // Present in every snapshot WITHOUT a position slot: a justified,
          // accounted omission in every frame (flicker must stay 0).
          entityId: "player-11",
          kind: "participant",
          version: 1,
          lastEventTimeMs: atMs,
          state: { teamRole: { status: "known", value: "midfielder" } },
        },
        {
          // Out-of-play near: (-3, 34) projects inside the canvas margin.
          entityId: "player-out",
          kind: "participant",
          version: 1,
          lastEventTimeMs: atMs,
          state: { pitchPosition: { status: "known", value: { x: -3, y: 34 } } },
        },
        {
          // Out-of-play off-canvas: (120, 34) — true position recorded, marker omitted.
          entityId: "player-far",
          kind: "participant",
          version: 1,
          lastEventTimeMs: atMs,
          state: { pitchPosition: { status: "known", value: { x: 120, y: 34 } } },
        },
        {
          // Non-renderable kind: accounted, never drawn.
          entityId: "team-1",
          kind: "team",
          version: 1,
          lastEventTimeMs: atMs,
          state: { teamName: { status: "known", value: "Team 1" } },
        },
        {
          entityId: "ball-1",
          kind: "ball",
          version: 4,
          lastEventTimeMs: atMs,
          state: {
            pitchPosition: { status: "uncertain", value: { x: ballX, y: 34.5 }, confidence: 0.9 },
          },
        },
      ],
      football: {
        pitch: {
          lengthAxisMeters: 105,
          widthAxisMeters: 68,
          origin: "corner",
          axes: "x=touchline, y=goal-line",
        },
        clock: { period: "first-half", clockMs: 60_000 + index * 1_000, stoppage: false },
        score: {
          home: 1,
          away: 0,
          status: { status: "uncertain", value: "provisional", confidence: 0.8 },
        },
        possession: { status: "uncertain", value: { entityId: "player-7" }, confidence: 0.75 },
        eventTaxonomyVersion: "v1",
      },
    },
    1234 + index,
  );
}

/** A caption event for the fixture stream (deterministic ids/sequences). */
export function buildW503Event(
  eventId: string,
  eventTimeMs: number,
  eventTypeRef: string,
  sequence: number,
): WorldEventStreamEntry {
  const event = buildEventEnvelope(
    { eventId, sessionId: W503_SESSION_ID, eventTimeMs, eventTypeRef, confidence: 0.9 },
    4321 + sequence,
  );
  return { sequence, snapshotVersionAfter: sequence + 20, event };
}

/**
 * The fixture caption stream: kickoff@1000, pass@2500, shot@4000, an
 * uncaptionable taxonomy@4700, goal@5500 (sequences 11..15).
 */
export function buildW503EventStream(): WorldEventStreamEntry[] {
  return [
    buildW503Event("fe-kickoff", 1_000, "football/v1/kickoff", 11),
    buildW503Event("fe-pass", 2_500, "football/v1/pass", 12),
    buildW503Event("fe-shot", 4_000, "football/v1/shot", 13),
    buildW503Event("fe-weird", 4_700, "football/v9/variant-unknown", 14),
    buildW503Event("fe-goal", 5_500, "football/v1/goal", 15),
  ];
}

/** The canonical 6-step fixture clip: steps at t = 1000..6000. */
export function buildW503ClipSteps(): AnimeClipStep[] {
  const events = buildW503EventStream();
  const steps: AnimeClipStep[] = [];
  for (let index = 0; index < 6; index += 1) {
    const atMs = (index + 1) * 1_000;
    const windowFrom = index === 0 ? 0 : index * 1_000;
    steps.push({
      atMs,
      snapshot: buildW503Snapshot(index),
      events: events.filter(
        (entry) => entry.event.eventTimeMs > windowFrom && entry.event.eventTimeMs <= atMs,
      ),
    });
  }
  return steps;
}

/**
 * Renders the clean fixture clip through the REAL W502 renderer: the
 * manifest + SVG frames the evaluation measures. Deep-equal on every call.
 */
export function renderW503CleanFixture(): AnimeRenderOutput {
  return renderAnimeClip(buildW503RenderRequest(), buildW503ClipSteps());
}

// ---------------------------------------------------------------------------
// Defect injections (pure manifest perturbations)
// ---------------------------------------------------------------------------

/** Deep-clones a manifest (JSON-safe structure). */
function cloneManifest(manifest: AnimeClipManifest): AnimeClipManifest {
  return structuredClone(manifest);
}

/** Finds a frame by index (fail-loud when out of range). */
function frameAt(
  manifest: AnimeClipManifest,
  frameIndex: number,
): AnimeClipManifest["frames"][number] {
  const frame = manifest.frames[frameIndex];
  if (frame === undefined) {
    throw new TemporalEvaluationError(
      "manifest-malformed",
      `$.frames[${frameIndex}]`,
      `no such frame (the manifest has ${manifest.frames.length})`,
    );
  }
  return frame;
}

/** Finds a frame's entity entry (fail-loud when the entity is absent). */
function entityOf(
  frame: AnimeClipManifest["frames"][number],
  entityId: string,
  frameIndex: number,
): AnimeEntityEntry {
  const entity = frame.entities.find((entry) => entry.entityId === entityId);
  if (entity === undefined) {
    throw new TemporalEvaluationError(
      "manifest-malformed",
      `$.frames[${frameIndex}].entities`,
      `no entry for entity "${entityId}" in frame ${frameIndex}`,
    );
  }
  return entity;
}

/**
 * **Identity flicker — unexplained absence**: deletes the entity's
 * accounting entry from one frame entirely (the renderer "forgot" the
 * entity: no disposition, no justification). The entity was drawn in the
 * previous frame → drawn-then-vanished → flicker.
 */
export function injectUnexplainedAbsence(
  manifest: AnimeClipManifest,
  options: { frameIndex: number; entityId: string },
): AnimeClipManifest {
  const perturbed = cloneManifest(manifest);
  const frame = frameAt(perturbed, options.frameIndex);
  const index = frame.entities.findIndex((entity) => entity.entityId === options.entityId);
  if (index < 0) {
    throw new TemporalEvaluationError(
      "manifest-malformed",
      `$.frames[${options.frameIndex}].entities`,
      `no entry for entity "${options.entityId}" in frame ${options.frameIndex}`,
    );
  }
  frame.entities.splice(index, 1);
  return perturbed;
}

/**
 * **Style instability**: replaces the entity's style token on one frame
 * with a DIFFERENT palette entry (the renderer restyled one entity for one
 * frame — a visual style flicker). Fail-loud when the entity carries no
 * style token on that frame (pick an in-play participant frame).
 */
export function injectStyleInstability(
  manifest: AnimeClipManifest,
  options: { frameIndex: number; entityId: string },
): AnimeClipManifest {
  const perturbed = cloneManifest(manifest);
  const entity = entityOf(
    frameAt(perturbed, options.frameIndex),
    options.entityId,
    options.frameIndex,
  );
  if (entity.style === undefined) {
    throw new TemporalEvaluationError(
      "manifest-malformed",
      `$.frames[${options.frameIndex}].entities`,
      `entity "${options.entityId}" carries no style token in frame ${options.frameIndex} (pick a frame where it is drawn in play)`,
    );
  }
  const rotated = PLAYER_PALETTE[(entity.style.paletteIndex + 1) % PLAYER_PALETTE.length]!;
  entity.style = { paletteIndex: rotated.paletteIndex, jersey: rotated.jersey, trim: rotated.trim };
  return perturbed;
}

/**
 * **Geometry drift — teleported entity**: moves the entity's recorded true
 * position on one frame to `toMeters` (both `positionMeters` and the
 * canvas-serialized `svgPosition` via the renderer's own documented affine
 * mapping, so the perturbed manifest stays internally consistent except
 * for the physics). The displacement between the adjacent frames is
 * physically impossible → a drift jump.
 */
export function injectGeometryTeleport(
  manifest: AnimeClipManifest,
  options: { frameIndex: number; entityId: string; toMeters: { x: number; y: number } },
): AnimeClipManifest {
  const perturbed = cloneManifest(manifest);
  const entity = entityOf(
    frameAt(perturbed, options.frameIndex),
    options.entityId,
    options.frameIndex,
  );
  if (entity.positionMeters === undefined) {
    throw new TemporalEvaluationError(
      "manifest-malformed",
      `$.frames[${options.frameIndex}].entities`,
      `entity "${options.entityId}" has no recorded position in frame ${options.frameIndex}`,
    );
  }
  entity.positionMeters = { ...options.toMeters };
  entity.svgPosition = toCanvasRounded(options.toMeters);
  return perturbed;
}

/**
 * **Watermark regression**: rewinds one frame's source watermark below the
 * previous frame's (the render's provenance went backwards in the event
 * log). Both the sequence and the watermark time regress.
 */
export function injectWatermarkRegression(
  manifest: AnimeClipManifest,
  options: { frameIndex: number },
): AnimeClipManifest {
  const perturbed = cloneManifest(manifest);
  if (options.frameIndex < 1) {
    throw new TemporalEvaluationError(
      "manifest-malformed",
      `$.frames[${options.frameIndex}]`,
      "watermark regression needs frameIndex >= 1 (there must be a previous frame)",
    );
  }
  const frame = frameAt(perturbed, options.frameIndex);
  const previous = perturbed.frames[options.frameIndex - 1]!;
  frame.source.watermark = {
    sequence: Math.max(0, previous.source.watermark.sequence - 5),
    watermarkMs: Math.max(0, previous.source.watermark.watermarkMs - 1_000),
  };
  return perturbed;
}

/**
 * **Disposition flapping**: one frame's entity disposition becomes a
 * JUSTIFIED omission (`omitted-no-position`, position dropped — the honest
 * per-frame rendering of an unknown slot) between two drawn frames: the
 * per-frame omission is honest, but the drawn→omitted→drawn oscillation is
 * the flapping artifact.
 */
export function injectDispositionFlap(
  manifest: AnimeClipManifest,
  options: { frameIndex: number; entityId: string },
): AnimeClipManifest {
  const perturbed = cloneManifest(manifest);
  const entity = entityOf(
    frameAt(perturbed, options.frameIndex),
    options.entityId,
    options.frameIndex,
  );
  entity.disposition = "omitted-no-position";
  entity.positionStatus = "unknown";
  delete entity.positionMeters;
  delete entity.svgPosition;
  delete entity.style;
  return perturbed;
}

/**
 * **Applied-sequence gap**: removes one event's accounting from a frame
 * (its `appliedEventSequences` entry, its caption, and its uncaptioned
 * record) — the event silently vanished between two applied sequences.
 */
export function injectAppliedSequenceGap(
  manifest: AnimeClipManifest,
  options: { frameIndex: number; sequence: number },
): AnimeClipManifest {
  const perturbed = cloneManifest(manifest);
  const frame = frameAt(perturbed, options.frameIndex);
  const applied = frame.appliedEventSequences.indexOf(options.sequence);
  if (applied < 0) {
    throw new TemporalEvaluationError(
      "manifest-malformed",
      `$.frames[${options.frameIndex}].appliedEventSequences`,
      `sequence ${options.sequence} is not applied in frame ${options.frameIndex}`,
    );
  }
  frame.appliedEventSequences.splice(applied, 1);
  frame.captions.events = frame.captions.events.filter(
    (event) => event.sequence !== options.sequence,
  );
  frame.captions.uncaptionedEvents = frame.captions.uncaptionedEvents.filter(
    (event) => event.sequence !== options.sequence,
  );
  return perturbed;
}

/**
 * **Duplicate event attribution**: one frame additionally applies (and
 * captions) an event that another frame already applied — the same event
 * shown twice.
 */
export function injectDuplicateEventAttribution(
  manifest: AnimeClipManifest,
  options: { sequence: number; fromFrameIndex: number; toFrameIndex: number },
): AnimeClipManifest {
  const perturbed = cloneManifest(manifest);
  const source = frameAt(perturbed, options.fromFrameIndex);
  const captioned = source.captions.events.find((event) => event.sequence === options.sequence);
  const uncaptioned = source.captions.uncaptionedEvents.find(
    (event) => event.sequence === options.sequence,
  );
  const target = frameAt(perturbed, options.toFrameIndex);
  target.appliedEventSequences = [...target.appliedEventSequences, options.sequence].sort(
    (a, b) => a - b,
  );
  if (captioned !== undefined) {
    target.captions.events = [...target.captions.events, { ...captioned }];
  } else if (uncaptioned !== undefined) {
    target.captions.uncaptionedEvents = [...target.captions.uncaptionedEvents, { ...uncaptioned }];
  } else {
    throw new TemporalEvaluationError(
      "manifest-malformed",
      `$.frames[${options.fromFrameIndex}].captions`,
      `sequence ${options.sequence} is neither captioned nor uncaptioned in frame ${options.fromFrameIndex}`,
    );
  }
  return perturbed;
}

/**
 * **Caption window overlap**: widens one frame's window so its end runs
 * past the NEXT frame's window start (both windows still start at their
 * frame's output timestamp — the overlap is the only injected defect).
 */
export function injectWindowOverlap(
  manifest: AnimeClipManifest,
  options: { frameIndex: number },
): AnimeClipManifest {
  const perturbed = cloneManifest(manifest);
  if (options.frameIndex < 0 || options.frameIndex + 1 >= perturbed.frames.length) {
    throw new TemporalEvaluationError(
      "manifest-malformed",
      `$.frames[${options.frameIndex}]`,
      "window overlap needs a following frame",
    );
  }
  const frame = frameAt(perturbed, options.frameIndex);
  const next = perturbed.frames[options.frameIndex + 1]!;
  frame.windowMs = {
    startMs: frame.windowMs.startMs,
    endMs: next.windowMs.startMs + (next.windowMs.endMs - next.windowMs.startMs) / 2,
  };
  return perturbed;
}

/**
 * **SVG byte-level style instability**: restyles ONE entity's marker group in
 * ONE frame's SVG document to a different palette entry — the manifest (and
 * its style token) is UNTOUCHED, so only the byte-level marker measurement
 * can see it: the exact defect class the manifest token cannot detect.
 * Operates on the W502 marker serialization (`<g data-entity="…">` with the
 * first `fill="#…"` on the marker circle being the participant jersey);
 * fails loud when the entity carries no style token or no marker group.
 */
export function injectStyleByteInstability(
  output: AnimeRenderOutput,
  options: { frameIndex: number; entityId: string },
): AnimeRenderOutput {
  const { frameIndex, entityId } = options;
  const manifestFrame = output.manifest.frames[frameIndex];
  if (manifestFrame === undefined) {
    throw new TemporalEvaluationError(
      "manifest-malformed",
      `$.frames[${frameIndex}]`,
      `no such frame (the manifest has ${output.manifest.frames.length})`,
    );
  }
  const style = manifestFrame.entities.find((entity) => entity.entityId === entityId)?.style;
  if (style === undefined) {
    throw new TemporalEvaluationError(
      "manifest-malformed",
      `$.frames[${frameIndex}].entities`,
      `entity "${entityId}" carries no style token in frame ${frameIndex} (pick an in-play participant frame)`,
    );
  }
  const frames = structuredClone(output.frames) as AnimeFrame[];
  const frame = frames[frameIndex]!;
  const groupStart = frame.svg.indexOf(`<g data-entity="${entityId}"`);
  if (groupStart < 0) {
    throw new TemporalEvaluationError(
      "frames-malformed",
      `$.frames[${frameIndex}].svg`,
      `no marker group for entity "${entityId}" in frame ${frameIndex}`,
    );
  }
  const groupEnd = frame.svg.indexOf("</g>", groupStart);
  if (groupEnd < 0) {
    throw new TemporalEvaluationError(
      "frames-malformed",
      `$.frames[${frameIndex}].svg`,
      `marker group for entity "${entityId}" is not closed`,
    );
  }
  const group = frame.svg.slice(groupStart, groupEnd);
  const rotated = PLAYER_PALETTE[(style.paletteIndex + 1) % PLAYER_PALETTE.length]!;
  const restyled = group.replace(/fill="#[0-9a-fA-F]{6}"/, `fill="${rotated.jersey}"`);
  if (restyled === group) {
    throw new TemporalEvaluationError(
      "frames-malformed",
      `$.frames[${frameIndex}].svg`,
      `no jersey fill attribute in entity "${entityId}"'s marker group`,
    );
  }
  frame.svg = frame.svg.slice(0, groupStart) + restyled + frame.svg.slice(groupEnd);
  return {
    result: structuredClone(output.result),
    frames,
    manifest: cloneManifest(output.manifest),
  };
}
