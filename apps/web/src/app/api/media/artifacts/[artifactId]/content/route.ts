import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/** The HTML5-servable content type (the artifact container is mp4). */
const VIDEO_CONTENT_TYPE = "video/mp4";

/**
 * Builds the response body: an ArrayBuffer-backed copy of the stored view
 * (TS 5.9's `Uint8Array<ArrayBufferLike>` is not a `BlobPart`; the copy
 * narrows to a plain `ArrayBuffer` backing — and the copy is caller-owned
 * anyway, so nothing aliases the store's buffer).
 */
function bodyOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * GET /api/media/artifacts/[artifactId]/content — the artifact PLAYBACK
 * route (R104): streams the artifact's stored bytes for an HTML5 `<video>`
 * element, with FULL HTTP Range support:
 *
 * - `Range: bytes=start-end` → `206 Partial Content` + `Content-Range:
 *   bytes start-end/total` (the single-range form every browser issues);
 * - no Range → `200 OK` with the whole object + `Accept-Ranges: bytes`;
 * - an unsatisfiable range (start beyond the object) → `416` with a
 *   `Content-Range: bytes STARSLASH total` proof (the RFC 9110 unsatisfied
 *   range evidence).
 *
 * Session-scoped (owner/operator — a non-owner answers a uniform 404
 * BEFORE any byte is exposed). The bytes are the SAME content-addressed
 * object the `RenderArtifactManifest` names (`integrity.verified` was
 * earned by re-reading and hash-verifying exactly these bytes).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ artifactId: string }> },
): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const token = tokenFromRequest(request);
    if (token === "") {
      const { IdentityUnauthenticatedError } = await import("@sporta/identity");
      throw new IdentityUnauthenticatedError();
    }
    const { authorize } = await import("@sporta/identity");
    const { MediaNotFoundError } = await import("@sporta/media-platform");

    const { artifactId } = await context.params;
    const artifact = server.media.artifact(artifactId);
    if (artifact === null) {
      throw new MediaNotFoundError("artifact", artifactId);
    }

    // Owner/operator gate — BEFORE any byte is exposed (the W902 posture).
    const account = await server.gate.requireAccount(token);
    const ownerId = (await server.ownership.ownerIdOf(artifact.sessionId)) ?? "not-owned";
    const decision = authorize(account, "media-session.read", { ownerId });
    if (!decision.allowed) {
      throw new MediaNotFoundError("artifact", artifactId);
    }

    // The content-addressed object the manifest names (LAZY import: the
    // media-platform graph reaches bun:sqlite — the build-time rule).
    const { normalizedMediaKey } = await import("@sporta/media-platform");
    const key = normalizedMediaKey(artifact.contentHash);
    const rangeHeader = request.headers.get("range");

    if (rangeHeader === null) {
      const view = await server.mediaStorage.open(key);
      if (view === null) {
        throw new MediaNotFoundError("artifact", artifactId);
      }
      return new Response(bodyOf(view.bytes), {
        status: 200,
        headers: {
          "content-type": VIDEO_CONTENT_TYPE,
          "content-length": String(view.length),
          "accept-ranges": "bytes",
          "cache-control": "no-store",
          "x-sporta-artifact-source": "media-platform",
        },
      });
    }

    // Single-range parsing (the `bytes=start-end` form; `bytes=start-` and
    // a suffix form are normalized; a malformed Range is ignored per RFC
    // 9110 §14.2 — the whole object answers 200).
    const parsed = parseByteRange(rangeHeader, await server.mediaStorage.size(key));
    if (parsed === "malformed") {
      const view = await server.mediaStorage.open(key);
      if (view === null) {
        throw new MediaNotFoundError("artifact", artifactId);
      }
      return new Response(bodyOf(view.bytes), {
        status: 200,
        headers: {
          "content-type": VIDEO_CONTENT_TYPE,
          "content-length": String(view.length),
          "accept-ranges": "bytes",
          "cache-control": "no-store",
        },
      });
    }
    if (parsed === "unsatisfiable") {
      const total = await server.mediaStorage.size(key);
      return new Response(null, {
        status: 416,
        headers: {
          "content-range": `bytes */${total ?? 0}`,
          "cache-control": "no-store",
        },
      });
    }

    const view = await server.mediaStorage.open(key, parsed);
    if (view === null) {
      throw new MediaNotFoundError("artifact", artifactId);
    }
    return new Response(bodyOf(view.bytes), {
      status: 206,
      headers: {
        "content-type": VIDEO_CONTENT_TYPE,
        "content-length": String(view.length),
        "content-range": `bytes ${view.offset}-${view.offset + view.length - 1}/${view.totalSize}`,
        "accept-ranges": "bytes",
        "cache-control": "no-store",
        "x-sporta-artifact-source": "media-platform",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Parsed Range outcome: a bounded range, malformed (ignore), or 416. */
type RangeParse = { start: number; end?: number } | "malformed" | "unsatisfiable";

/**
 * Parses one `Range` header against the object's total size (RFC 9110's
 * single `bytes=` range; multi-range is treated as malformed → the whole
 * object answers 200 — the honest minimal implementation).
 */
function parseByteRange(header: string, totalSize: number | null): RangeParse {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null || (match[1] === "" && match[2] === "")) {
    return "malformed";
  }
  const total = totalSize ?? Number.NaN;
  if (match[1] === "") {
    // Suffix form `bytes=-N`: the LAST N bytes.
    const suffix = Number.parseInt(match[2]!, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return "malformed";
    if (!Number.isFinite(total)) return "malformed";
    if (suffix >= total) {
      return total === 0 ? "unsatisfiable" : { start: 0 };
    }
    return { start: total - suffix };
  }
  const start = Number.parseInt(match[1]!, 10);
  if (!Number.isFinite(start) || start < 0) return "malformed";
  if (Number.isFinite(total) && (total === 0 || start >= total)) {
    return "unsatisfiable";
  }
  const end = match[2] === "" ? undefined : Number.parseInt(match[2]!, 10);
  if (end !== undefined && (!Number.isFinite(end) || end < start)) return "malformed";
  return { start, ...(end !== undefined ? { end } : {}) };
}
