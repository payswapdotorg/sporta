/**
 * The viewer-shell ports (W702 + W705): the seams ViewerCore consumes.
 *
 * `ControlClient` mirrors the transport-free `ControlApp` operation surface
 * (W701) — the same input/result document shapes, minus the call context
 * (adapters own request ids). Implementations:
 *
 * - in-process: wraps a real `ControlApp` (headless integration, tests);
 * - HTTP: talks to a real `createControlServer` over `fetch` (browser).
 *
 * `RenderOutputPort` loads the PLAYABLE batch output for a render. W705
 * DELIVERS the real wiring the W702 docblock promised: the port's result is a
 * THREE-KIND union (see {@link RenderOutputResult}):
 *
 * - `"animated-segment"` — the REAL W504 path. The provider (see
 *   `./playback-provider.ts`) fetches the control plane's playback routes
 *   `GET /v1/sessions/:id/renders/:renderId/outputs[/:segmentId]`
 *   (rights-gated, fail-closed), parses the JSON envelope, verifies the
 *   served bytes against the declared sha-256 content hash, and hands the
 *   player ONE self-contained animated-SVG document (an embedded SMIL
 *   timeline) plus the deterministic container manifest (which carries the
 *   W502 render manifest VERBATIM in `sourceManifest`). Wire failure classes
 *   pass through VERBATIM: a rights denial (403 `rights-denied`) stays
 *   `rights-denied` — never a retryable "server error".
 * - `"frame-sequence"` — the W502-shaped `{ frames, manifest }` document
 *   (the W702 stand-in path; the capture-store seam and its HTTP route
 *   remain for their own tests — see `./render-output-store.ts`).
 * - `"outputs-pending"` — the honest processing state: NOTHING is stored
 *   under the requested `(sessionId, renderId)` scope yet — W504's
 *   encode→store step runs HOST-side after the render completes, so an
 *   empty list is a real, observable "not yet" state — surfaced as a clear
 *   pending UI state, never as a fake player and never as an invented
 *   error. Caller contract (honest seam note): the W504 LIST route is a
 *   pure store projection and does not itself classify unknown render ids,
 *   so the render-EXISTS half of the pending story is the caller's
 *   guarantee — the viewer core's `getRender` gate always runs BEFORE
 *   `loadOutput` (see `./playback-provider.ts` for the full note).
 *
 * The W705 presentation model for the SMIL artifact is documented on
 * `./segment-player.ts` (ONE self-animating document presented with its
 * manifest metadata — no per-frame supply, no faked frame-by-frame content).
 */
import type {
  CreateRenderInput,
  CreateSessionInput,
  CreateSessionResult,
  GetSessionResult,
  ListRenderersResult,
  ListRendersResult,
  ListSessionsResult,
  RenderEnvelope,
  TerminateSessionResult,
} from "@sporta/control-api";
import type { ViewerControlError } from "./errors.ts";
import type { AnimeClipManifest, AnimeFrame } from "@sporta/renderer-anime";
import type { AnimeSegmentManifest } from "@sporta/output-pipeline";

/**
 * The control-plane client port. Shapes are the W701 `ControlApp` operation
 * shapes (typed against `@sporta/control-api`; the package is imported
 * read-only — the viewer never modifies it).
 */
export interface ControlClient {
  /** Creates a media session from a caller-supplied authorization policy. */
  createSession(input: CreateSessionInput): Promise<CreateSessionResult>;
  /** Inspects one session plus its fail-closed derived capabilities. */
  getSession(sessionId: string): Promise<GetSessionResult>;
  /** Lists session summaries. */
  listSessions(): Promise<ListSessionsResult>;
  /** Terminates a session (idempotent). */
  terminateSession(sessionId: string): Promise<TerminateSessionResult>;
  /** Lists registered renderer capabilities (capability-driven selection). */
  listRenderers(): Promise<ListRenderersResult>;
  /** Creates a render on a session. */
  createRender(sessionId: string, input: CreateRenderInput): Promise<RenderEnvelope>;
  /**
   * Gets a stored render (W701 playback gate: requires
   * `canStoreDerivatives` — denial is typed, never partial data).
   */
  getRender(sessionId: string, renderId: string): Promise<RenderEnvelope>;
  /** Lists render summaries for a session (same playback gate). */
  listRenders(sessionId: string): Promise<ListRendersResult>;
}

/** The playable batch output document — the W502 render output shape. */
export interface BatchRenderOutput {
  /** The SVG frame sequence (may be partial while loading — see the player). */
  frames: AnimeFrame[];
  /** The clip manifest: per-frame timing, provenance, accounting. */
  manifest: AnimeClipManifest;
}

/**
 * One stored render-output segment document (the W504 playback envelope,
 * parsed): the encoded segment (a self-contained animated-SVG document with
 * an embedded SMIL timeline) plus its integrity fields and the deterministic
 * container manifest, VERBATIM. The container manifest's `sourceManifest`
 * carries the complete W502 clip manifest unchanged.
 */
export interface PlaybackSegmentDocument {
  sessionId: string;
  renderId: string;
  segmentId: string;
  /** Media type of the segment document (`image/svg+xml` for this encoder). */
  contentType: string;
  /** UTF-8 byte length of `content` (as served). */
  byteLength: number;
  /** sha-256 of `content`, 64 lowercase hex digits (the content-addressed artifact id). */
  contentHash: string;
  /** The full encoded segment document, UTF-8 text. */
  content: string;
  /** The deterministic container manifest, verbatim. */
  manifest: AnimeSegmentManifest;
}

/**
 * The result of loading a render's output through the port (W705 union —
 * see the module docs for the honest semantics of each kind).
 */
export type RenderOutputResult =
  /** The W502-shaped frame sequence (the stand-in path). */
  | { kind: "frame-sequence"; output: BatchRenderOutput }
  /** The W504 stored animated-SVG segment (the real playback path). */
  | { kind: "animated-segment"; segment: PlaybackSegmentDocument }
  /** The render exists but has no stored outputs yet (honest pending state). */
  | { kind: "outputs-pending" };

/** Loads the playable output for a stored render. */
export interface RenderOutputPort {
  loadOutput(sessionId: string, renderId: string): Promise<RenderOutputResult>;
}

/** Shared rejection type of every port method (see `./errors.ts`). */
export type PortError = ViewerControlError;
