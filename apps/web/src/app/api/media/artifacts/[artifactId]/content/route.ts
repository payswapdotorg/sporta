import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse } from "@/server/http-errors";
import { bodyOf, parseByteRange } from "@/server/http-range";

export const dynamic = "force-dynamic";

/** The HTML5-servable content type (the artifact container is mp4). */
const VIDEO_CONTENT_TYPE = "video/mp4";

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
