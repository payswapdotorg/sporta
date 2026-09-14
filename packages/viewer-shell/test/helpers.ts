/**
 * Deterministic W702 test fixtures (docs/testing/HARNESS.md — no Date.now,
 * no Math.random; every time is an explicit millisecond constant or a
 * scripted fake clock).
 *
 * - `fakeClock`: a mutable injected time source (deterministic by hand).
 * - policies: the W701 trust-boundary fixtures (full-allow, analysis-only,
 *   analysis+transformation).
 * - `scriptClient`: a `ControlClient` whose every call is scripted (queued
 *   resolutions/rejections) and whose call log is recorded — the exact,
 *   fail-injectable seam for the ViewerCore tests.
 * - `scriptOutput`: the same pattern for `RenderOutputPort`.
 * - `buildHandManifest`: a minimal W502-SHAPED manifest with exact,
 *   non-uniform frame timestamps (the frame-math evidence source) plus
 *   matching frames.
 */
import type { AuthorizationPolicy, RendererCapability, RenderResult } from "@sporta/contracts";
import type {
  CreateRenderInput,
  CreateSessionInput,
  CreateSessionResult,
  GetSessionResult,
  SessionSummary,
} from "@sporta/control-api";
import { TEST_EPOCH_MS, buildMediaSession } from "@sporta/testing";
import { ViewerControlError } from "../src/errors.ts";
import type { ViewerFailureClass } from "../src/errors.ts";
import type {
  BatchRenderOutput,
  ControlClient,
  PlaybackSegmentDocument,
  RenderOutputPort,
  RenderOutputResult,
} from "../src/ports.ts";
import type { AnimeClipManifest, AnimeFrame } from "@sporta/renderer-anime";

/** Far-future expiry for policies that must never expire in a test. */
const FAR_FUTURE_ISO = "2099-12-31T23:59:59.000Z";

/** A policy allowing every operation (the W701 full-allow fixture). */
export const fullAllowPolicy: AuthorizationPolicy = {
  policyId: "policy-full-allow",
  allowedOperations: [
    "analysis",
    "transformation",
    "liveDelivery",
    "derivativeGeneration",
    "storage",
    "sharing",
  ],
  assertedBy: "sporta-test-operator",
  expiresAtIso: FAR_FUTURE_ISO,
};

/** Analysis-only: derives NO capability — creation itself is denied. */
export const analysisOnlyPolicy: AuthorizationPolicy = {
  policyId: "policy-analysis-only",
  allowedOperations: ["analysis"],
  assertedBy: "sporta-test-operator",
  expiresAtIso: FAR_FUTURE_ISO,
};

/** Analysis + transformation: renders, but `canStoreDerivatives` is false. */
export const analysisTransformationPolicy: AuthorizationPolicy = {
  policyId: "policy-analysis-transformation",
  allowedOperations: ["analysis", "transformation"],
  assertedBy: "sporta-test-operator",
  expiresAtIso: FAR_FUTURE_ISO,
};

// ---------------------------------------------------------------------------
// Fake clock
// ---------------------------------------------------------------------------

/** A mutable fake time source: reads return `now`; tests advance it by hand. */
export interface FakeClock {
  now(): number;
  advance(ms: number): void;
}

/** Creates a fake clock starting at TEST_EPOCH_MS. */
export function fakeClock(startMs: number = TEST_EPOCH_MS): FakeClock {
  let now = startMs;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

// ---------------------------------------------------------------------------
// Scripted control client
// ---------------------------------------------------------------------------

/** One scripted outcome: a resolution value or a rejection. */
export type Outcome<T> = { resolve: T } | { reject: unknown };

export function res<T>(value: T): Outcome<T> {
  return { resolve: value };
}

export function rej(error: unknown): Outcome<never> {
  return { reject: error };
}

/** Builds a typed viewer error rejection (the ports' rejection contract). */
export function viewerFailure(
  failureClass: ViewerFailureClass,
  message: string,
  details: Record<string, unknown> = {},
): ViewerControlError {
  return new ViewerControlError(failureClass, message, details);
}

/** A recorded control-client call. */
export interface ControlCall {
  method: string;
  args: unknown[];
}

/**
 * A fully scripted `ControlClient`: every method draws from its queue; an
 * empty queue (or an unscripted method) rejects with a loud
 * "unexpected call" internal error so a test can never silently pass a
 * missing script step.
 */
export interface ScriptedClient extends ControlClient {
  /** The recorded calls, in order. */
  calls: ControlCall[];
}

export function scriptClient(
  script: Partial<{
    [K in keyof ControlClient]: Array<Outcome<Awaited<ReturnType<ControlClient[K]>>>>;
  }>,
): ScriptedClient {
  const calls: ControlCall[] = [];
  function next<T>(
    method: string,
    queue: Array<Outcome<T>> | undefined,
    args: unknown[],
  ): Promise<T> {
    calls.push({ method, args });
    const outcome = queue?.shift();
    if (outcome === undefined) {
      return Promise.reject(
        new Error(`scriptClient: unexpected call to ${method} (no scripted outcome left)`),
      );
    }
    if ("reject" in outcome) return Promise.reject(outcome.reject);
    return Promise.resolve(outcome.resolve);
  }
  return {
    calls,
    createSession: (input: CreateSessionInput) =>
      next("createSession", script.createSession, [input]),
    getSession: (sessionId: string) => next("getSession", script.getSession, [sessionId]),
    listSessions: () => next("listSessions", script.listSessions, []),
    terminateSession: (sessionId: string) =>
      next("terminateSession", script.terminateSession, [sessionId]),
    listRenderers: () => next("listRenderers", script.listRenderers, []),
    createRender: (sessionId: string, input: CreateRenderInput) =>
      next("createRender", script.createRender, [sessionId, input]),
    getRender: (sessionId: string, renderId: string) =>
      next("getRender", script.getRender, [sessionId, renderId]),
    listRenders: (sessionId: string) => next("listRenders", script.listRenders, [sessionId]),
  };
}

/** A scripted `RenderOutputPort` (same pattern as {@link scriptClient}). */
export interface ScriptedOutput extends RenderOutputPort {
  calls: ControlCall[];
}

export function scriptOutput(script: {
  loadOutput: Array<Outcome<RenderOutputResult>>;
}): ScriptedOutput {
  const calls: ControlCall[] = [];
  return {
    calls,
    loadOutput: (sessionId: string, renderId: string) => {
      calls.push({ method: "loadOutput", args: [sessionId, renderId] });
      const outcome = script.loadOutput.shift();
      if (outcome === undefined) {
        return Promise.reject(new Error("scriptOutput: unexpected loadOutput call"));
      }
      if ("reject" in outcome) return Promise.reject(outcome.reject);
      return Promise.resolve(outcome.resolve);
    },
  };
}

/** Wraps a W502 frame output as the `frame-sequence` port result (W705 union). */
export function asFrameOutput(output: BatchRenderOutput): RenderOutputResult {
  return { kind: "frame-sequence", output };
}

// ---------------------------------------------------------------------------
// Result document builders (minimal, deterministic)
// ---------------------------------------------------------------------------

/** A deterministic session summary. */
export function sessionSummary(
  id: string,
  state: SessionSummary["state"] = "authorized",
): SessionSummary {
  return { id, state, createdAt: "2026-09-14T00:00:00.000Z" };
}

/** A deterministic renderer capability document. */
export function rendererCapability(
  rendererId: string,
  rendererVersion = "0.1.0",
): RendererCapability {
  return {
    rendererId,
    rendererVersion,
    rendererClass: "procedural-3d",
    supportedOutputProfiles: [
      {
        resolution: { w: 1170, h: 880 },
        frameRate: 1,
        codec: "svg",
        container: "svg",
        latencyClass: "offline",
      },
    ],
    requiresSourceFrames: false,
    minSnapshotVersion: 0,
  };
}

/** A deterministic (schema-shaped) session document via the W003 builder. */
export function sessionDoc(sessionId: string): ReturnType<typeof buildMediaSession> {
  return buildMediaSession({ sessionId, status: "authorized" }, 42);
}

/** A minimal, deterministic `RenderResult` for scripted envelopes. */
export function renderResult(
  sessionId: string,
  rendererId: string,
  segments: number,
): RenderResult {
  return {
    sessionId,
    rendererId,
    outputSegments: Array.from({ length: segments }, (_, index) => ({
      segmentId: `anime-${index}`,
      startMs: index * 1000,
      endMs: (index + 1) * 1000,
      artifactRef: `anime://${sessionId}/1/${index}`,
    })),
    watermarkAfter: { watermarkMs: segments * 1000, sequence: 0 },
    rendererHealth: { lagMs: 0, degraded: false },
    provenance: { snapshotVersion: 1, lastEventSequence: 0 },
  };
}

/** A scripted create-session/get-session result. */
export function sessionResult(sessionId: string): CreateSessionResult {
  const session = sessionDoc(sessionId);
  return {
    session,
    rightsCapabilities: {
      canReferenceSourceFrames: true,
      canDeliverLive: true,
      canStoreDerivatives: true,
      canShare: true,
    },
  };
}

/** A scripted get-session result (same shape). */
export function getSessionResult(sessionId: string): GetSessionResult {
  return sessionResult(sessionId);
}

// ---------------------------------------------------------------------------
// Hand-authored W502-shaped manifest (exact, NON-UNIFORM timestamps)
// ---------------------------------------------------------------------------

const EMPTY_CAPTIONS = {
  statusLine: null,
  score: null,
  clockText: null,
  events: [],
  uncaptionedEvents: [],
};

/**
 * Builds a minimal W502-shaped manifest whose frames sit at the EXACT given
 * output timestamps (non-uniform allowed — the clip-path shape). Frame
 * windows are `[ts_i, ts_{i+1})`, the last window extends one
 * `frameIntervalMs`; `durationMs = lastTs + interval - firstTs` exactly.
 * Frames get deterministic `svg-<index>` documents.
 */
export function buildHandOutput(
  timestamps: number[],
  options: { frameIntervalMs?: number } = {},
): BatchRenderOutput {
  if (timestamps.length === 0) throw new Error("buildHandOutput requires >= 1 timestamp");
  const intervalMs = options.frameIntervalMs ?? 1000;
  const startMs = timestamps[0]!;
  const windows = timestamps.map((timestamp, index) => ({
    startMs: timestamp,
    endMs: index === timestamps.length - 1 ? timestamp + intervalMs : timestamps[index + 1]!,
  }));
  const frames: AnimeFrame[] = timestamps.map((timestamp, index) => ({
    frameIndex: index,
    outputTimestampMs: timestamp,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" data-frame="${index}">svg-${index}</svg>`,
  }));
  const manifest: AnimeClipManifest = {
    renderer: {
      rendererId: "hand.test-renderer",
      rendererVersion: "0.1.0",
      styleId: "style-hand",
      configSchemaVersion: "1.0",
    },
    session: { sessionId: "sess-hand", snapshotVersion: 1, eventsSinceSequence: 0 },
    output: {
      profile: {
        resolution: { w: 1170, h: 880 },
        frameRate: 1000 / intervalMs,
        codec: "svg",
        container: "svg",
        latencyClass: "offline",
      },
      startMs,
      frameIntervalMs: intervalMs,
      durationMs: timestamps[timestamps.length - 1]! + intervalMs - startMs,
    },
    provenance: { snapshotVersion: 1, lastEventSequence: 0 },
    watermarkAfter: { watermarkMs: windows[windows.length - 1]!.endMs, sequence: 0 },
    frames: timestamps.map((timestamp, index) => ({
      frameIndex: index,
      outputTimestampMs: timestamp,
      windowMs: windows[index]!,
      source: {
        watermark: { sequence: 0, watermarkMs: timestamp },
        generatedAtMs: TEST_EPOCH_MS,
        footballState: false,
      },
      appliedEventSequences: [],
      captions: EMPTY_CAPTIONS,
      possession: null,
      entities: [],
    })),
    skippedEvents: [],
    degradation: { degraded: false, reasons: [] },
  };
  return { frames, manifest };
}

// ---------------------------------------------------------------------------
// Hand-authored W504-shaped segment document (exact, minimal)
// ---------------------------------------------------------------------------

/**
 * Builds a minimal W504-SHAPED stored segment document: a hand-authored
 * animated-SVG document (NOT the real encoder's output — for the real
 * encoded bytes use `@sporta/output-pipeline` `encodeAnimeClip` in the test)
 * plus a container manifest whose timing table is derived EXACTLY from a
 * hand W502 manifest ({@link buildHandOutput}). The content hash is a fixed
 * 64-hex placeholder (client-side re-hashing is the PROVIDER's job; the
 * player checks format + equality only), and the byte length is measured
 * from the document — both honest for the player's contract.
 */
export function buildHandSegment(
  options: { timestamps?: number[]; frameIntervalMs?: number } = {},
): PlaybackSegmentDocument {
  const timestamps = options.timestamps ?? [0, 1_000];
  const base = buildHandOutput(timestamps, { frameIntervalMs: options.frameIntervalMs });
  const manifest = base.manifest;
  const frames = timestamps.map((timestamp, index) => ({
    frameIndex: index,
    outputTimestampMs: timestamp,
    beginMs: timestamp - manifest.output.startMs,
    durMs:
      index === timestamps.length - 1
        ? (options.frameIntervalMs ?? 1_000)
        : (timestamps[index + 1] ?? timestamp) - timestamp,
  }));
  const content = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1170 880"><g data-frame-index="0" display="none"><set attributeName="display" to="inline" begin="0s" dur="1s" fill="remove"/></g></svg>`;
  const segmentId = "anime-clip-0badcafe";
  return {
    sessionId: manifest.session.sessionId,
    renderId: "r-hand",
    segmentId,
    contentType: "image/svg+xml",
    byteLength: new TextEncoder().encode(content).length,
    contentHash: "a".repeat(64),
    content,
    manifest: {
      format: { kind: "animated-svg", version: 1 },
      segmentId,
      sessionId: manifest.session.sessionId,
      frameCount: frames.length,
      totalDurationMs: manifest.output.durationMs,
      contentHash: "a".repeat(64),
      frames,
      sourceManifest: manifest,
    },
  };
}

// ---------------------------------------------------------------------------
// Trace capture (deep-equal determinism evidence)
// ---------------------------------------------------------------------------

/** Collects JSON-stringified view-model snapshots (for deep-equal reruns). */
export function captureTrace<T>(subscribe: (fn: (view: T) => void) => () => void): string[] {
  const trace: string[] = [];
  subscribe((view) => {
    trace.push(JSON.stringify(view));
  });
  return trace;
}
