/**
 * THE composition (W604): `render3dDirectedMatch(req, steps, plan)` — the
 * camera plan DRIVES the W603 match path (`render3dMatch`) window by
 * window, through the renderer's own `styleConfig.config.cameraSlotId`
 * seam (the documented "W604 directs" seam of RENDERER.md §3 — this
 * package never re-implements rendering, never moves a camera, never
 * invents a slot: it calls the real renderer per directed window).
 *
 * ## The composition algorithm (deterministic; POLICY.md §6 is the record)
 *
 * 1. **Fail-closed admission.** The plan is self-checked against the steps
 *    (`./selfcheck.ts` — the plan's totality/boundary invariants) and the
 *    TOTAL composed frame budget is enforced ({@link MAX_RENDER_FRAMES}).
 * 2. **Per window, one `render3dMatch` call.** The window's step RUN is
 *    the steps whose `atMs` lie in the window's closed source range
 *    (boundary-INCLUSIVE: the run renders the segment crossing INTO the
 *    next window so the crossing's interpolated frames come from THIS
 *    window's slot; the boundary snapshot itself belongs to the NEXT
 *    window). The run's request carries the window's slot
 *    (`cameraSlotId`) and profile: live windows use the caller's output
 *    profile, review windows use the W603 review profile
 *    (`AVATAR_FIELD_ANIMATED_OUTPUT_PROFILE`, 5 fps — the "animated-review
 *    cadence"; a review re-renders EXISTING steps, authoring no new
 *    content).
 * 3. **Boundary-tail drop.** Every live run's render ends with an
 *    observed TAIL frame at its last step (render3dMatch's tail
 *    semantics). For every live window EXCEPT the last, that tail frame
 *    (at the shared boundary) is DROPPED — the boundary snapshot renders
 *    from the next window's slot (the cut takes effect AT the boundary).
 *    The last live window keeps its tail (the match's final observed
 *    frame); review windows keep their tails (self-contained
 *    re-presentations of their closed ranges).
 * 4. **The rundown timeline.** Frames renumber globally; each frame's
 *    output position = its window's rundown start + (source position −
 *    window source start). The result: a no-review plan is 1:1 with the
 *    match timeline in frame COUNT and output POSITIONS (output == source
 *    — each live window's frames occupy exactly its source range; a
 *    single-window plan at the same slot as an undirected render's config
 *    is even byte-identical to that `render3dMatch` call — test-pinned);
 *    each review window inserts its realized duration, shifting later
 *    windows. (Per-window runs keep their OWN SVG `<title>` frame index
 *    and manifest `entry.frameIndex` — the renderer's per-run document;
 *    the composed `frameIndex`/`outputTimestampMs` are the rundown
 *    coordinates. Both are recorded per frame, never conflated.)
 * 5. **Provenance.** The composed manifest carries, per frame, the
 *    underlying renderer manifest entry VERBATIM (interpolation
 *    provenance, entity accounting — source-timeline timestamps) PLUS the
 *    director's fields (window index, slot, presentation kind); per
 *    window, the realized camera block + the plan's decision record
 *    (rule + verbatim event). Watermarks/provenance aggregate as the MAX
 *    across runs (never less than anything any run consumed).
 */
import type { OutputProfile, RenderRequest, RenderResult } from "@sporta/contracts";
import {
  AVATAR_FIELD_ANIMATED_OUTPUT_PROFILE,
  MAX_RENDER_FRAMES,
  render3dMatch,
} from "@sporta/renderer-3d";
import type {
  AvatarField3dFrame,
  AvatarField3dMatchStep,
  AvatarField3dRenderOutput,
  Render3dCameraBlock,
  Render3dFrameEntry,
  Render3dSkippedMarker,
} from "@sporta/renderer-3d";
import { DirectorError } from "./errors";
import { isRecord } from "./internal";
import { checkCameraPlan } from "./selfcheck";
import type { CameraPlan, DirectedWindow, PresentationKind } from "./types";

/**
 * The output profile review windows render at: W603's animated-review
 * cadence (1280×720 SVG, 5 fps, 200 ms frames — the hand-inspectable
 * review profile of RENDERER.md §1). Replay emphasis SELECTS this
 * profile; it never re-times or re-authors content.
 */
export const REVIEW_OUTPUT_PROFILE: OutputProfile = AVATAR_FIELD_ANIMATED_OUTPUT_PROFILE;

/** One realized directed window in the composed manifest. */
export interface DirectedWindowEntry {
  /** The window's rundown index (verbatim from the plan). */
  index: number;
  kind: PresentationKind;
  /** The match-timeline range presented (verbatim from the plan). */
  source: { startMs: number; endMs: number };
  /** The REALIZED rundown range [startMs, endMs) of this window's frames. */
  output: { startMs: number; endMs: number };
  /** The directed camera slot (verbatim from the plan). */
  cameraSlotId: string;
  /** The plan's decision record, VERBATIM (rule + verbatim event). */
  decision: DirectedWindow["decision"];
  /** The realized camera block (the run's manifest camera block, verbatim). */
  camera: Render3dCameraBlock;
  /** The output profile this window rendered at. */
  outputProfile: OutputProfile;
  /** The window's frame count. */
  frameCount: number;
  /** The window's first global frame index. */
  firstFrameIndex: number;
}

/** One realized frame of the directed rundown. */
export interface DirectedFrameEntry {
  frameIndex: number;
  /** The frame's position on the RUNDOWN (output) timeline (milliseconds). */
  outputTimestampMs: number;
  /** The frame's window (rundown) end — the output segment extent. */
  outputWindowMs: { startMs: number; endMs: number };
  /** The frame's position on the MATCH (source) timeline — the underlying render's own timestamp. */
  sourceTimestampMs: number;
  /** The directed window this frame belongs to. */
  windowIndex: number;
  /** The camera slot this frame rendered from (the directed slot). */
  cameraSlotId: string;
  presentation: PresentationKind;
  /**
   * The underlying renderer-3d manifest entry, VERBATIM (its own
   * timestamps/window are match-timeline values; its interpolation
   * provenance, marker accounting, and entity accounting are the
   * renderer's own honest report).
   */
  entry: Render3dFrameEntry;
}

/** A marker skipped by one window's run (accounted, never silent). */
export interface DirectedSkippedMarker extends Render3dSkippedMarker {
  /** The rundown window whose run skipped this marker. */
  windowIndex: number;
}

/** The composed manifest: the renderer's report + the director's provenance. */
export interface DirectedRenderManifest {
  /** The director provenance (version, policy, plan summary — verbatim). */
  director: {
    directorVersion: string;
    policy: { policyId: string; policyVersion: string };
    reviewOutputProfile: OutputProfile;
    timeline: { startMs: number; endMs: number };
    output: { startMs: number; endMs: number };
    windowCount: number;
    liveWindowCount: number;
    reviewWindowCount: number;
    cutCount: number;
    suppressedCuts: CameraPlan["summary"]["suppressedCuts"];
    eventAccounting: CameraPlan["summary"]["eventAccounting"];
  };
  /** The renderer identity + style configuration, verbatim from the runs. */
  renderer: AvatarField3dRenderOutput["manifest"]["renderer"];
  /** The output profiles + frame counts. */
  output: {
    profile: OutputProfile;
    frameIntervalMs: number;
    reviewFrameIntervalMs: number;
    frameCount: number;
  };
  /** The realized directed windows (rundown order). */
  windows: DirectedWindowEntry[];
  /** The realized frames (rundown order, globally renumbered). */
  frames: DirectedFrameEntry[];
  /** Markers skipped by a window's run (per-window accounting). */
  skippedMarkers: DirectedSkippedMarker[];
  /** Explicit degradation state (the union of the runs' reasons). */
  degradation: { degraded: boolean; reasons: string[] };
  /** Contract provenance: snapshot version + the MAXIMUM last applied event sequence. */
  provenance: { snapshotVersion: number; lastEventSequence: number };
  /** Contract watermark after rendering (the MAXIMUM across runs). */
  watermarkAfter: { watermarkMs: number; sequence: number };
}

/** The composed directed render output: contract result + frames + manifest. */
export interface DirectedRenderOutput {
  /** The contract-compliant `RenderResult` (segments reference the rundown timeline). */
  result: RenderResult;
  /** The frame sequence (globally renumbered, rundown timestamps). */
  frames: AvatarField3dFrame[];
  /** The directed manifest. */
  manifest: DirectedRenderManifest;
}

/** The frame interval of an output profile (pure arithmetic). */
function frameIntervalMsOf(profile: OutputProfile): number {
  return 1000 / profile.frameRate;
}

/** The index of the step whose `atMs === t` (must exist: plan-checked). */
function stepIndexOf(times: readonly number[], t: number): number {
  for (let i = 0; i < times.length; i += 1) {
    if (times[i] === t) return i;
  }
  return -1;
}

/**
 * THE composition: renders the match timeline under a camera plan — one
 * `render3dMatch` call per directed window through the renderer's own
 * `cameraSlotId` seam, stitched into one rundown. Pure: no clock, no RNG,
 * no I/O (the same request, steps, and plan yield a deep-equal output on
 * every call — test-pinned, cross-subprocess byte-identical).
 *
 * @throws {@link DirectorError} (`plan-invalid`) when the plan violates
 *   the documented invariants against these steps, and
 *   (`budget-exceeded`) when the composed frame count exceeds
 *   {@link MAX_RENDER_FRAMES}. Renderer-side admission failures
 *   (unsupported profiles, uncarried slots, malformed scenes) propagate
 *   as the renderer's own `RendererContractError` — never swallowed.
 */
export function render3dDirectedMatch(
  req: RenderRequest,
  steps: readonly AvatarField3dMatchStep[],
  plan: CameraPlan,
): DirectedRenderOutput {
  const check = checkCameraPlan(plan, steps);
  if (!check.ok) {
    throw new DirectorError("plan-invalid", "the camera plan violates its documented invariants", {
      violations: check.violations,
    });
  }
  const times = steps.map((step) => step.atMs);
  const liveWindowIndexes = plan.windows
    .map((window, index) => (window.kind === "live" ? index : -1))
    .filter((index) => index >= 0);
  const lastLiveWindowRundownIndex = liveWindowIndexes[liveWindowIndexes.length - 1]!;

  const frames: AvatarField3dFrame[] = [];
  const manifestFrames: DirectedFrameEntry[] = [];
  const manifestWindows: DirectedWindowEntry[] = [];
  const segments: RenderResult["outputSegments"] = [];
  const skippedMarkers: DirectedSkippedMarker[] = [];
  const degradationReasons: string[] = [];
  let watermarkAfter = { watermarkMs: -Infinity, sequence: -Infinity };
  let lastEventSequence = 0;
  let rendererBlock: AvatarField3dRenderOutput["manifest"]["renderer"] | undefined;

  // The rundown cursor: output positions start at the match timeline start
  // (a plan with no reviews is 1:1 with the match timeline).
  let cursor = plan.timeline.startMs;
  let windowFirstFrameIndex = 0;
  for (const window of plan.windows) {
    const outputProfile: OutputProfile =
      window.kind === "review" ? REVIEW_OUTPUT_PROFILE : req.outputProfile;
    const runStart = stepIndexOf(times, window.source.startMs);
    const runEnd = stepIndexOf(times, window.source.endMs);
    const runSteps = steps.slice(runStart, runEnd + 1);
    const windowConfig: Record<string, unknown> = isRecord(req.styleConfig.config)
      ? { ...req.styleConfig.config }
      : {};
    windowConfig.cameraSlotId = window.cameraSlotId;
    const windowReq: RenderRequest = {
      ...req,
      outputProfile,
      styleConfig: { ...req.styleConfig, config: windowConfig },
    };
    const run = render3dMatch(windowReq, runSteps);

    // Boundary-tail drop: every live run except the LAST live window drops
    // its observed tail frame (the shared boundary belongs to the next
    // window — the cut takes effect AT the boundary).
    const isLastLiveWindow = window.kind === "live" && window.index === lastLiveWindowRundownIndex;
    const kept: number[] = [];
    for (let i = 0; i < run.frames.length; i += 1) {
      const frameMs = run.frames[i]!.outputTimestampMs;
      const dropBoundaryTail =
        !isLastLiveWindow && window.kind === "live" && frameMs >= window.source.endMs;
      if (!dropBoundaryTail) kept.push(i);
    }
    const keptCount = kept.length;
    if (keptCount === 0) {
      throw new DirectorError("plan-invalid", `window ${window.index} realized no frames`, {
        windowIndex: window.index,
      });
    }
    if (frames.length + keptCount > MAX_RENDER_FRAMES) {
      throw new DirectorError(
        "budget-exceeded",
        `the composed directed render implies more than ${MAX_RENDER_FRAMES} frames — reduce the timeline, the frame rate, or the review windows`,
        {
          windowIndex: window.index,
          framesSoFar: frames.length,
          windowFrames: keptCount,
          maxRenderFrames: MAX_RENDER_FRAMES,
        },
      );
    }

    const windowOutputStart = cursor;
    let windowOutputEnd = cursor;
    for (const i of kept) {
      const globalIndex = frames.length;
      const frame = run.frames[i]!;
      const entry = run.manifest.frames[i]!;
      const outputTimestampMs =
        windowOutputStart + (frame.outputTimestampMs - window.source.startMs);
      const outputWindowStart =
        windowOutputStart + (entry.windowMs.startMs - window.source.startMs);
      const outputWindowEnd = windowOutputStart + (entry.windowMs.endMs - window.source.startMs);
      frames.push({
        frameIndex: globalIndex,
        outputTimestampMs,
        svg: frame.svg,
      });
      manifestFrames.push({
        frameIndex: globalIndex,
        outputTimestampMs,
        outputWindowMs: { startMs: outputWindowStart, endMs: outputWindowEnd },
        sourceTimestampMs: frame.outputTimestampMs,
        windowIndex: window.index,
        cameraSlotId: window.cameraSlotId,
        presentation: window.kind,
        entry,
      });
      segments.push({
        segmentId: `scene3d-${globalIndex}`,
        startMs: outputWindowStart,
        endMs: outputWindowEnd,
        artifactRef: `scene3d://${req.sessionId}/${req.snapshotVersion}/${globalIndex}`,
      });
      if (outputWindowEnd > windowOutputEnd) windowOutputEnd = outputWindowEnd;
    }
    manifestWindows.push({
      index: window.index,
      kind: window.kind,
      source: { startMs: window.source.startMs, endMs: window.source.endMs },
      output: { startMs: windowOutputStart, endMs: windowOutputEnd },
      cameraSlotId: window.cameraSlotId,
      decision: window.decision,
      camera: run.manifest.camera,
      outputProfile,
      frameCount: keptCount,
      firstFrameIndex: windowFirstFrameIndex,
    });
    windowFirstFrameIndex += keptCount;
    cursor = windowOutputEnd;

    for (const skipped of run.manifest.skippedMarkers) {
      skippedMarkers.push({ ...skipped, windowIndex: window.index });
    }
    for (const reason of run.manifest.degradation.reasons) {
      if (!degradationReasons.includes(reason)) degradationReasons.push(reason);
    }
    watermarkAfter = {
      watermarkMs: Math.max(watermarkAfter.watermarkMs, run.manifest.watermarkAfter.watermarkMs),
      sequence: Math.max(watermarkAfter.sequence, run.manifest.watermarkAfter.sequence),
    };
    lastEventSequence = Math.max(lastEventSequence, run.manifest.provenance.lastEventSequence);
    if (rendererBlock === undefined) {
      rendererBlock = run.manifest.renderer;
    }
  }

  const degraded = degradationReasons.length > 0;
  const result: RenderResult = {
    sessionId: req.sessionId,
    rendererId: req.rendererId,
    outputSegments: segments,
    watermarkAfter: { watermarkMs: watermarkAfter.watermarkMs, sequence: watermarkAfter.sequence },
    rendererHealth: {
      lagMs: 0,
      degraded,
      ...(degraded ? { degradationReason: degradationReasons.join(";") } : {}),
    },
    provenance: { snapshotVersion: req.snapshotVersion, lastEventSequence },
  };

  const manifest: DirectedRenderManifest = {
    director: {
      directorVersion: plan.directorVersion,
      policy: { ...plan.policy },
      reviewOutputProfile: REVIEW_OUTPUT_PROFILE,
      timeline: { ...plan.timeline },
      output: { startMs: plan.timeline.startMs, endMs: cursor },
      windowCount: plan.summary.windowCount,
      liveWindowCount: plan.summary.liveWindowCount,
      reviewWindowCount: plan.summary.reviewWindowCount,
      cutCount: plan.summary.cutCount,
      suppressedCuts: plan.summary.suppressedCuts,
      eventAccounting: plan.summary.eventAccounting,
    },
    renderer: rendererBlock!,
    output: {
      profile: req.outputProfile,
      frameIntervalMs: frameIntervalMsOf(req.outputProfile),
      reviewFrameIntervalMs: frameIntervalMsOf(REVIEW_OUTPUT_PROFILE),
      frameCount: frames.length,
    },
    windows: manifestWindows,
    frames: manifestFrames,
    skippedMarkers,
    degradation: { degraded, reasons: degradationReasons },
    provenance: { snapshotVersion: req.snapshotVersion, lastEventSequence },
    watermarkAfter: { watermarkMs: watermarkAfter.watermarkMs, sequence: watermarkAfter.sequence },
  };
  return { result, frames, manifest };
}
