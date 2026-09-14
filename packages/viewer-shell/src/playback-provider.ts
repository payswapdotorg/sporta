/**
 * The HTTP playback provider (W705) — the REAL {@link RenderOutputPort} over
 * the W504 control-plane playback routes:
 *
 * - `GET /v1/sessions/:id/renders/:renderId/outputs` — the stored-segment
 *   summaries (rights-gated, fail-closed);
 * - `GET /v1/sessions/:id/renders/:renderId/outputs/:segmentId` — one
 *   segment envelope `{ sessionId, renderId, segmentId, contentType,
 *   byteLength, contentHash, content, manifest }` (same gate).
 *
 * `loadOutput` composes them exactly as the W702 wiring point prescribed:
 * list the outputs, fetch the segment, parse the envelope, and hand the
 * player the SMIL animated-SVG segment + container manifest. Honesty rules:
 *
 * - **Error classes VERBATIM** (the wiring contract): a well-formed error
 *   envelope carrying a RECOGNIZED failure class passes through unchanged —
 *   a rights denial (403 `rights-denied`) stays `rights-denied` (label
 *   "Rights denied", NOT retryable), never a reclassified "server error".
 *   An UNRECOGNIZED class surfaces as `internal` carrying the raw class; an
 *   envelope-less body maps to the documented `unsupported-output` default.
 *   Connection failures are the viewer-side `network` class.
 * - **Integrity, client-side**: the served `content` is re-hashed
 *   (WebCrypto SHA-256 — zero dependencies, browser + bun) and compared to
 *   the envelope's declared `contentHash`, and its measured UTF-8 byte
 *   length to the declared `byteLength`. Transport corruption or a lying
 *   envelope fails LOUD as `media-invalid` — never partially-trusted data.
 *   HONEST LIMITATION: requires WebCrypto (secure context; `localhost` is
 *   one); where the platform lacks it the provider fails closed (`internal`
 *   with a clear message) rather than skipping the check silently.
 * - **Scope guard**: the envelope must answer within the requested
 *   `(sessionId, renderId, segmentId)` — a server answering outside the
 *   requested scope is a contract violation the client never trusts.
 * - **No invented data**: an empty outputs list is the honest
 *   `outputs-pending` result (nothing stored under the requested scope
 *   yet — the host-side encode→store step has not run). More than one
 *   stored segment is an honest capability gap: this viewer's presentation
 *   model presents ONE segment document per render, so the surplus fails
 *   LOUD as `unsupported-output` (multi-segment playback is a future work
 *   item), never a silent first-segment-wins.
 *
 *   CALLER CONTRACT (honest seam note): the W504 LIST route is a pure store
 *   projection — it answers `200 { segments: [] }` for ANY (session,
 *   renderId) scope with nothing stored and does NOT classify unknown
 *   render ids (unlike the W701 getRender/listRenders routes and the
 *   SEGMENT route). `outputs-pending` therefore means exactly "nothing
 *   stored under this scope"; the render-EXISTS half of the pending story
 *   is the CALLER's guarantee — the viewer core's `getRender` gate runs
 *   BEFORE `loadOutput` (the W705 composition, test-pinned end-to-end in
 *   `test/playback-e2e.test.ts`). Direct hosts of this port must apply the
 *   same gate.
 */
import { ViewerControlError, isViewerFailureClass } from "./errors.ts";
import type { RenderOutputPort, RenderOutputResult } from "./ports.ts";
import type { PlaybackSegmentDocument } from "./ports.ts";
import type { FetchLike } from "./http-client.ts";

/** One entry of the outputs-list route answer. */
export interface PlaybackSegmentSummary {
  segmentId: string;
  contentType: string;
  byteLength: number;
  contentHash: string;
}

/** Options for {@link createHttpPlaybackProvider}. */
export interface HttpPlaybackProviderOptions {
  /**
   * Base URL of the control API (the v1 playback routes are appended).
   * Same-origin relative URLs work — the browser bootstrap passes `"/control"`
   * (the viewer server's same-origin proxy).
   */
  baseUrl: string;
  /** Fetch seam (defaults to the platform `fetch`; injectable for tests). */
  fetch?: FetchLike;
  /** Request-id factory (default: deterministic per-provider `viewer-out-<n>`). */
  requestId?: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Maps a non-2xx response body (already parsed) onto the viewer error. */
function wireError(status: number, body: unknown, context: string): ViewerControlError {
  if (isRecord(body) && isRecord(body.error)) {
    const wire = body.error;
    const message = typeof wire.message === "string" ? wire.message : "control plane error";
    const rawClass = wire.failureClass;
    if (typeof rawClass === "string" && isViewerFailureClass(rawClass)) {
      const details = isRecord(wire.details) ? wire.details : {};
      // The verbatim passthrough is the W705 wiring contract: the playback
      // routes answer the CONTROL failure classes — a rights denial is 403
      // `rights-denied`, NOT a retryable "server error".
      return new ViewerControlError(rawClass, message, { ...details, httpStatus: status });
    }
    return new ViewerControlError("internal", message, {
      httpStatus: status,
      context,
      wireFailureClass: typeof rawClass === "string" ? rawClass : typeof rawClass,
    });
  }
  return new ViewerControlError("internal", "control plane returned a malformed error body", {
    httpStatus: status,
    context,
    body: typeof body === "string" ? body.slice(0, 200) : JSON.stringify(body)?.slice(0, 200),
  });
}

/** sha-256 of the UTF-8 bytes of `content`, 64 lowercase hex digits (WebCrypto). */
async function sha256Hex(content: string): Promise<string> {
  if (typeof crypto === "undefined" || crypto.subtle === undefined) {
    throw new ViewerControlError(
      "internal",
      "WebCrypto (crypto.subtle) is unavailable — the playback provider's client-side integrity check cannot run (fail-closed, never skipped)",
      { context: "playback-provider integrity check" },
    );
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] ?? 0;
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * The real W504 playback provider: a {@link RenderOutputPort} plus the two
 * granular operations it composes (`listSegments` / `fetchSegment` — exposed
 * for hosts and tests that need the raw seams).
 */
export interface HttpPlaybackProvider extends RenderOutputPort {
  /** Lists the stored output segments of a render (the outputs route). */
  listSegments(sessionId: string, renderId: string): Promise<PlaybackSegmentSummary[]>;
  /**
   * Fetches one stored segment envelope, parsed + integrity-verified
   * (`media-invalid` on any drift; wire classes verbatim on refusal).
   */
  fetchSegment(
    sessionId: string,
    renderId: string,
    segmentId: string,
  ): Promise<PlaybackSegmentDocument>;
}

/** Creates the HTTP playback provider (see the module docs). */
export function createHttpPlaybackProvider(
  options: HttpPlaybackProviderOptions,
): HttpPlaybackProvider {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  let seq = 0;
  const nextRequestId = options.requestId ?? ((): string => `viewer-out-${(seq += 1)}`);
  const encode = (value: string): string => encodeURIComponent(value);

  /** One GET against the playback routes, JSON-parsed with typed errors. */
  async function getJson(path: string, context: string): Promise<unknown> {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method: "GET",
        headers: { accept: "application/json", "x-request-id": nextRequestId() },
      });
    } catch (err) {
      throw new ViewerControlError(
        "network",
        `control server could not be reached (${err instanceof Error ? err.message : "fetch failed"})`,
        { context },
      );
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new ViewerControlError(
        "internal",
        `control server response was not JSON (status ${String(response.status)})`,
        { httpStatus: response.status, context },
      );
    }
    if (!response.ok) {
      throw wireError(response.status, parsed, context);
    }
    if (!isRecord(parsed)) {
      throw new ViewerControlError(
        "internal",
        `control server response body was not an object (status ${String(response.status)})`,
        { httpStatus: response.status, context },
      );
    }
    return parsed;
  }

  async function listSegments(
    sessionId: string,
    renderId: string,
  ): Promise<PlaybackSegmentSummary[]> {
    const body = await getJson(
      `/v1/sessions/${encode(sessionId)}/renders/${encode(renderId)}/outputs`,
      "listRenderOutputs",
    );
    const segments = (body as { segments?: unknown }).segments;
    if (!Array.isArray(segments)) {
      throw new ViewerControlError(
        "internal",
        "render outputs list response was not the expected { segments } document",
        { context: "listRenderOutputs" },
      );
    }
    const summaries: PlaybackSegmentSummary[] = [];
    for (let i = 0; i < segments.length; i += 1) {
      const entry = segments[i];
      if (
        !isRecord(entry) ||
        typeof entry.segmentId !== "string" ||
        typeof entry.contentType !== "string" ||
        typeof entry.byteLength !== "number" ||
        typeof entry.contentHash !== "string"
      ) {
        throw new ViewerControlError(
          "internal",
          `render outputs list entry ${String(i)} was not a segment summary`,
          { context: "listRenderOutputs" },
        );
      }
      summaries.push({
        segmentId: entry.segmentId,
        contentType: entry.contentType,
        byteLength: entry.byteLength,
        contentHash: entry.contentHash,
      });
    }
    return summaries;
  }

  async function fetchSegment(
    sessionId: string,
    renderId: string,
    segmentId: string,
  ): Promise<PlaybackSegmentDocument> {
    const body = await getJson(
      `/v1/sessions/${encode(sessionId)}/renders/${encode(renderId)}/outputs/${encode(segmentId)}`,
      "getRenderOutput",
    );
    if (
      !isRecord(body) ||
      body.sessionId !== sessionId ||
      body.renderId !== renderId ||
      body.segmentId !== segmentId
    ) {
      throw new ViewerControlError(
        "media-invalid",
        "segment envelope did not answer within the requested (sessionId, renderId, segmentId) scope",
        { context: "getRenderOutput", requested: { sessionId, renderId, segmentId } },
      );
    }
    if (
      typeof body.contentType !== "string" ||
      typeof body.byteLength !== "number" ||
      typeof body.contentHash !== "string" ||
      typeof body.content !== "string" ||
      !isRecord(body.manifest)
    ) {
      throw new ViewerControlError(
        "media-invalid",
        "segment envelope was not the expected { contentType, byteLength, contentHash, content, manifest } document",
        { context: "getRenderOutput" },
      );
    }
    const segment: PlaybackSegmentDocument = {
      sessionId,
      renderId,
      segmentId,
      contentType: body.contentType,
      byteLength: body.byteLength,
      contentHash: body.contentHash,
      content: body.content,
      manifest: body.manifest as unknown as PlaybackSegmentDocument["manifest"],
    };
    // Client-side integrity: the served bytes must re-hash to the declared
    // content hash, and their measured byte length must match. Transport
    // corruption or a lying envelope fails LOUD (never trusted data).
    const measuredByteLength = new TextEncoder().encode(segment.content).length;
    if (measuredByteLength !== segment.byteLength) {
      throw new ViewerControlError(
        "media-invalid",
        `segment '${segmentId}' byte length mismatch: envelope declares ${String(segment.byteLength)}, content measures ${String(measuredByteLength)}`,
        { context: "getRenderOutput", segmentId, declaredByteLength: segment.byteLength },
      );
    }
    const measuredHash = await sha256Hex(segment.content);
    if (measuredHash !== segment.contentHash) {
      throw new ViewerControlError(
        "media-invalid",
        `segment '${segmentId}' content hash mismatch: envelope declares ${segment.contentHash}, content re-hashes to ${measuredHash}`,
        { context: "getRenderOutput", segmentId, declaredContentHash: segment.contentHash },
      );
    }
    return segment;
  }

  async function loadOutput(sessionId: string, renderId: string): Promise<RenderOutputResult> {
    const segments = await listSegments(sessionId, renderId);
    if (segments.length === 0) {
      // Honest processing state: nothing stored under the requested scope
      // yet (the W504 host-side encode→store step has not run). The list
      // route is a pure store projection — see the module docs' caller
      // contract: the render-EXISTS guarantee is the caller's (the viewer
      // core's getRender gate runs before loadOutput).
      return { kind: "outputs-pending" };
    }
    if (segments.length > 1) {
      // Honest capability gap: this viewer presents ONE segment document per
      // render; a surplus fails loud, never a silent first-segment-wins.
      throw new ViewerControlError(
        "unsupported-output",
        `render '${renderId}' has ${String(segments.length)} stored output segments; this viewer's playback model presents one segment document per render (multi-segment playback is a future work item)`,
        { context: "loadOutput", renderId, segmentIds: segments.map((s) => s.segmentId) },
      );
    }
    const summary = segments[0]!;
    const segment = await fetchSegment(sessionId, renderId, summary.segmentId);
    // The listed summary and the fetched envelope must agree (defense in
    // depth on top of each layer's own checks).
    if (
      segment.contentHash !== summary.contentHash ||
      segment.byteLength !== summary.byteLength ||
      segment.contentType !== summary.contentType
    ) {
      throw new ViewerControlError(
        "media-invalid",
        `segment '${summary.segmentId}' envelope disagrees with the outputs list summary (hash/length/type)`,
        { context: "loadOutput", segmentId: summary.segmentId },
      );
    }
    return { kind: "animated-segment", segment };
  }

  return { listSegments, fetchSegment, loadOutput };
}
