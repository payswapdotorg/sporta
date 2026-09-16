/**
 * THE LIVE FRAME PRODUCER (W915) — the REAL generation path behind the live
 * network transport.
 *
 * On every tick, the producer takes the NEXT step of the live session's real
 * story timeline (the dev-seed's per-wave `{ atMs, snapshot, events }` — the
 * same engine outputs the stored-output render consumes) and renders it
 * through the REAL W502 anime renderer (`renderAnimeClip`, the same real
 * package function the dev seed's stored-output path calls), producing ONE
 * complete SVG frame.
 *
 * HONESTY (the labels that travel with every frame):
 *
 * - The CONTENT is the checked-in dev-seed fixture story timeline (labeled
 *   `source: dev-seed` in the `hello` event — never presented as a real
 *   broadcast); the timeline CYCLES when it runs past its authored end.
 * - The GENERATION is real per tick: each frame's SVG is composed at its
 *   tick by the real renderer from the real story step (the render duration
 *   is measured on the real clock and travels in the frame).
 * - The CADENCE is the transport's real emission interval (env-configurable,
 *   default 500 ms) — frames are generated when they are sent, not batched.
 * - The renderer's own gates run on every tick (`enforceAdmission` /
 *   `enforceValidSteps` inside `renderAnimeClip`), and the request carries
 *   the session's REAL policy-derived rights capabilities (never invented).
 *
 * PURITY: no wall-clock reads (the `nowMs` seam is injected — the transport
 * injects the real clock, tests inject deterministic ones), no randomness,
 * no network — the only inputs are the story steps and the request.
 */
import { SCHEMA_VERSION } from "@sporta/contracts";
import type { AuthorizationPolicy, RenderRequest, RightsCapabilities } from "@sporta/contracts";
import { deriveRightsCapabilities } from "@sporta/contracts";
import {
  ANIME_OUTPUT_PROFILE,
  ANIME_RENDERER_ID,
  ANIME_RENDERER_VERSION,
  renderAnimeClip,
} from "@sporta/renderer-anime";
import type { AnimeClipStep } from "@sporta/renderer-anime";
import type { LiveFrameDoc } from "@/lib/live-sse";

/** Everything one live frame carries that is not the frame itself. */
export interface LiveFrameMeta {
  sessionId: string;
  ordinal: number;
}

/** Options for {@link createStoryFrameProducer}. */
export interface StoryFrameProducerOptions {
  /** The live session's id (travels in every frame). */
  sessionId: string;
  /** The story timeline steps (the dev-seed's real engine outputs). */
  steps: readonly AnimeClipStep[];
  /** The session's identity-attested policy (rights derived per render). */
  policy: AuthorizationPolicy;
  /** The engine's current snapshot version (the render's admission gate). */
  snapshotVersion: number;
  /** The engine's watermark sequence (the render's event cursor). */
  watermarkSequence: number;
  /** The injected clock (epoch ms; the transport injects the real one). */
  nowMs: () => number;
  /** The story key (labels the request's style id). */
  storyKey: string;
}

/**
 * The real live producer: `next()` renders the next story step through the
 * REAL renderer and returns the frame document with its real timestamps.
 * The timeline cycles (the fixture story is 6 s; a live session outlives it
 * — the cycle is labeled, and every frame is still a fresh real render).
 */
export function createStoryFrameProducer(options: StoryFrameProducerOptions): {
  /** Renders the next frame (one real `renderAnimeClip` call). */
  next: (meta: LiveFrameMeta) => LiveFrameDoc;
  /** How many story steps the timeline has. */
  readonly stepCount: number;
} {
  if (options.steps.length === 0) {
    throw new Error("a live source needs at least one story step");
  }
  let cursor = 0;
  return {
    stepCount: options.steps.length,
    next(meta: LiveFrameMeta): LiveFrameDoc {
      const stepIndex = cursor;
      const step = options.steps[stepIndex]!;
      cursor = (cursor + 1) % options.steps.length;

      // The REAL policy-derived rights, evaluated with the LIVE clock every
      // tick (an expired policy stops authorizing frames the moment it
      // expires — fail-closed, never cached).
      const rights: RightsCapabilities = deriveRightsCapabilities(
        options.policy,
        new Date(options.nowMs()),
      );
      const request: RenderRequest = {
        sessionId: options.sessionId,
        schemaVersion: SCHEMA_VERSION,
        rendererId: ANIME_RENDERER_ID,
        rendererVersion: ANIME_RENDERER_VERSION,
        styleConfig: {
          styleId: `live-${options.storyKey}`,
          configSchemaVersion: "1.0",
          config: {},
        },
        snapshotVersion: options.snapshotVersion,
        eventsSinceSequence: options.watermarkSequence,
        outputProfile: ANIME_OUTPUT_PROFILE,
        rightsCapabilities: rights,
        sourceFrameRefs: [],
      };
      const startedAtMs = options.nowMs();
      // ONE step → ONE frame through the REAL W502 renderer (the same
      // function the dev seed's stored-output path calls — its admission and
      // event-accounting gates run on every tick).
      const clip = renderAnimeClip(request, [step]);
      const frame = clip.frames[0]!;
      const generatedAtMs = options.nowMs();
      return {
        schemaVersion: "sporta.live-sse/1",
        sessionId: options.sessionId,
        ordinal: meta.ordinal,
        storyStepIndex: stepIndex,
        storyAtMs: frame.outputTimestampMs,
        svg: frame.svg,
        byteLength: frame.svg.length,
        generatedAtMs,
        renderDurationMs: Math.max(0, generatedAtMs - startedAtMs),
      };
    },
  };
}
