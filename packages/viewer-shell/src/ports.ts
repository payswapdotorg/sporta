/**
 * The viewer-shell ports (W702): the seams ViewerCore consumes.
 *
 * `ControlClient` mirrors the transport-free `ControlApp` operation surface
 * (W701) — the same input/result document shapes, minus the call context
 * (adapters own request ids). Implementations:
 *
 * - in-process: wraps a real `ControlApp` (headless integration, tests);
 * - HTTP: talks to a real `createControlServer` over `fetch` (browser).
 *
 * `RenderOutputPort` loads the PLAYABLE batch output for a render — the
 * W502-shaped `{ frames, manifest }` document. W701's control plane stores
 * the contract `RenderResult` (segments reference frames through opaque
 * artifact refs); retrieving the actual stored output behind the control
 * plane is the W504 concern. W702 ships an explicit stand-in seam:
 * a server-side capture store (see `./render-output-store.ts`) plus a thin
 * HTTP route on the viewer server (see `./serve.ts`). The gap is surfaced
 * through the `unsupported-output` failure class — never by faking playback.
 *
 * THE W705 WIRING POINT (documented honestly): W504 (merged on main AFTER
 * this branch's base 446c316) delivers the real playback routes
 * `GET /v1/sessions/:id/renders/:renderId/outputs[/:segmentId]` —
 * rights-gated (the W701 gate re-derives at read time), answering a JSON
 * envelope `{ content, contentType, hash, manifest }` per segment, where
 * `content` is the encoded artifact (a self-contained animated-SVG document
 * with an embedded SMIL timeline), `hash` its content hash, and `manifest`
 * the deterministic container manifest carrying the W502 render manifest
 * verbatim. W705's `RenderOutputPort` implementation will fetch those
 * envelopes and assemble the playable `BatchRenderOutput` from them
 * (segment artifact(s) → frame supply / manifest read verbatim), reusing
 * this package's player, state machine, and error taxonomy UNCHANGED. The
 * seam is already shaped for it: `BatchRenderOutput` is exactly the
 * renderer-anime clip shape (SVG frames + the clip manifest), the HTTP
 * provider honors the control plane's failure classes VERBATIM (see
 * `./output-provider.ts` — a rights-gated 403 surfaces as `rights-denied`,
 * never as a retryable "server error"), and the player validates the
 * manifest's own timing (never an invented timeline). The one W705-owned
 * adaptation: today's W504 artifact is ONE animated-SVG document per render
 * (a SMIL timeline, not per-frame statics), so W705 either renders the
 * artifact document directly or decodes it into per-frame supplies — that
 * decision belongs to W705, not to this shell.
 *
 * Every port method rejects with a {@link ViewerControlError} (classified,
 * JSON-safe) — never a raw error.
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

/** Loads the playable output for a stored render. */
export interface RenderOutputPort {
  loadOutput(sessionId: string, renderId: string): Promise<BatchRenderOutput>;
}

/** Shared rejection type of every port method (see `./errors.ts`). */
export type PortError = ViewerControlError;
