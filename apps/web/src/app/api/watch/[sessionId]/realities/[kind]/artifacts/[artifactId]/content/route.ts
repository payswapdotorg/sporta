import { getSportaServer } from "@/server/runtime";
import {
  assertWatchable,
  buildWatchArtifactCatalog,
  isCatalogRealityKind,
} from "@/server/catalog-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";
import { bodyOf, parseByteRange } from "@/server/http-range";

export const dynamic = "force-dynamic";

/** The HTML5-servable content type (the original-reality artifact container is mp4). */
const VIDEO_CONTENT_TYPE = "video/mp4";

/**
 * Whether one artifact descriptor's content type names the mp4 container —
 * the honest HTML5-video boundary (R504 → R508-R510): the `original`
 * reality's media artifacts (the `mp4/<codec>` convention) AND the derived
 * realities' R508-R510 MP4s serve as video; everything else (the W504
 * animated-SVG review segments, `image/svg+xml`) does not.
 */
function isMp4ContainerContentType(contentType: string): boolean {
  return contentType === VIDEO_CONTENT_TYPE || contentType.startsWith("mp4/");
}

/**
 * GET /api/watch/[sessionId]/realities/[kind]/artifacts/[artifactId]/content
 * — THE WATCH PLAYER'S HTML5 VIDEO SOURCE (R504): the real encoded MP4 bytes
 * of one REALITY ARTIFACT of ONE match session, served for an HTML5
 * `<video>` element with FULL HTTP Range support.
 *
 * THE GATES, in order (fail-closed — a denial reveals nothing):
 *
 * 1. `assertWatchable` — the watch surface's own content-model rule (the
 *    SAME gate /api/watch/[sessionId] applies: public/unlisted play for
 *    everyone holding the link; private/role-scoped play for the entitled
 *    callers). Non-entitled callers answer the byte-identical
 *    unknown-session 404 — no existence oracle.
 * 2. the catalog's fail-closed rights derivation — a playback-denied
 *    session answers 403 BEFORE any byte is exposed (the W504/W902
 *    posture: the store is never consulted).
 * 3. the artifact must be one of THIS session's catalog descriptors for the
 *    named reality — anything else is the uniform unknown-artifact 404.
 *
 * THE VERIFIED READ (the store's own primitive, not a re-implementation):
 * the stored object is RE-READ and sha-256-verified against the descriptor's
 * `integrityHash` on EVERY playback request (`mediaStorage.verify` — the
 * same "stored bytes were re-read and hash-verified" seam the artifact
 * contract's `integrity.verified` verdict earns). A mismatch answers the
 * typed integrity 500 — NEVER silently served wrong bytes. (Cost honesty:
 * the verify is a full-object read; the Range slice is then a second
 * bounded read. Acceptable at MVP artifact sizes, and stated here.)
 *
 * THE HONEST NOT-VIDEO BOUNDARY: an artifact serves as HTML5 video iff its
 * descriptor's content type names the mp4 container (the original
 * reality's ffmpeg-normalized MP4s and the derived realities' R508-R510
 * R306-encoded MP4s); a derived reality's W504 animated-SVG review
 * segment answers a typed 415 (the diagnostic frame player renders those;
 * they are never presented as video). THE primary player's source is the
 * byte route itself — every video artifact serves from the SAME media
 * store through the SAME verified read.
 */
export async function GET(
  request: Request,
  context: {
    params: Promise<{ sessionId: string; kind: string; artifactId: string }>;
  },
): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const { sessionId, kind, artifactId } = await context.params;

    // 1. The watch gate (uniform unknown-session 404 for non-entitled).
    await assertWatchable(server, request, sessionId);

    // 2. The closed reality vocabulary (a malformed kind is a 400, carrying
    //    the vocabulary — never a silent empty answer).
    if (!isCatalogRealityKind(kind)) {
      return jsonResponse(400, {
        error: {
          failureClass: "validation",
          message: `unknown reality kind '${kind}' (closed vocabulary: original, tactical, three-d-game, anime-npr)`,
        },
      });
    }

    // 3. The catalog's fail-closed rights derivation — deny BEFORE the store.
    const catalog = await buildWatchArtifactCatalog(server, sessionId);
    if (catalog.playback.state !== "authorized" || catalog.realities === null) {
      const { ControlRightsDeniedError } = await import("@sporta/control-api");
      throw new ControlRightsDeniedError(
        `playback access denied: session '${sessionId}' does not grant canStoreDerivatives — no artifact byte is exposed`,
        { sessionId },
      );
    }
    const entry = catalog.realities.find((reality) => reality.kind === kind);
    if (entry === undefined) {
      // Unreachable by construction (the catalog always carries all four
      // entries) — fail closed anyway, never a silent default.
      const { MediaNotFoundError } = await import("@sporta/media-platform");
      throw new MediaNotFoundError("artifact", artifactId);
    }
    const descriptor = entry.artifacts.find((artifact) => artifact.artifactId === artifactId);
    if (descriptor === undefined) {
      const { MediaNotFoundError } = await import("@sporta/media-platform");
      throw new MediaNotFoundError("artifact", artifactId);
    }

    // 4. The honest not-video boundary: an artifact serves as HTML5 video
    //    iff its descriptor's content type names the mp4 container — the
    //    `original` reality's media artifacts AND the derived realities'
    //    R508-R510 MP4s (the R306-encoded artifacts the ingest landed in
    //    the SAME media store, served by the SAME verified-read path
    //    below). Anything else — a W504 animated-SVG review segment —
    //    answers the typed 415: the watch surface's diagnostic frame
    //    player renders those; they are never presented as video.
    if (!isMp4ContainerContentType(descriptor.contentType)) {
      return jsonResponse(415, {
        error: {
          failureClass: "media-invalid",
          message:
            `the '${kind}' reality's stored artifact '${artifactId}' is a review-format segment ` +
            `(${descriptor.contentType}), not an HTML5 video artifact — the watch surface's ` +
            "diagnostic frame player renders it; no video bytes exist to serve",
          details: { artifactId, contentType: descriptor.contentType, kind },
        },
      });
    }

    // 5. The video artifact: the media platform's real record. The
    //    descriptor and the artifact record come from the same store — the
    //    session-scoped read keeps them consistent (defense in depth; the
    //    derived realities' R508-R510 MP4s land in the SAME store through
    //    the ingest's routing writer).
    const { MediaNotFoundError, normalizedMediaKey } = await import("@sporta/media-platform");
    const artifact = server.media
      .artifactsOfSession(sessionId)
      .find((record) => record.artifactId === artifactId);
    if (artifact === undefined || artifact.contentHash !== descriptor.integrityHash) {
      throw new MediaNotFoundError("artifact", artifactId);
    }
    const key = normalizedMediaKey(artifact.contentHash);

    // 6. THE VERIFIED READ — the store re-reads the object and verifies its
    //    CURRENT sha-256 equals the descriptor's integrity hash (typed
    //    integrity 500 on mismatch — wrong bytes are never served).
    await server.mediaStorage.verify(key, descriptor.integrityHash);

    // 7. Range serving (RFC 9110 single-range — the shared parser).
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
          "x-sporta-artifact-source": "watch-catalog",
          "x-sporta-integrity-verified": "sha256",
        },
      });
    }

    const size = await server.mediaStorage.size(key);
    const parsed = parseByteRange(rangeHeader, size);
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
      return new Response(null, {
        status: 416,
        headers: {
          "content-range": `bytes */${size ?? 0}`,
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
        "x-sporta-artifact-source": "watch-catalog",
        "x-sporta-integrity-verified": "sha256",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
