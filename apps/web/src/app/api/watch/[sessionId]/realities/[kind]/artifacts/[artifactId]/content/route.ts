import { getSportaServer } from "@/server/runtime";
import { assertWatchable, buildWatchArtifactCatalog, isCatalogRealityKind } from "@/server/catalog-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";
import { bodyOf, parseByteRange } from "@/server/http-range";

export const dynamic = "force-dynamic";

/** The HTML5-servable content type (the original-reality artifact container is mp4). */
const VIDEO_CONTENT_TYPE = "video/mp4";

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
 * THE HONEST NOT-VIDEO BOUNDARY: a derived reality's stored artifacts are
 * W504 animated-SVG review segments — this route answers a typed 415 for
 * them (the diagnostic frame player renders those; they are never presented
 * as video). The `original` reality's artifacts are the media platform's
 * real ffmpeg-normalized MP4s — THE primary player's source.
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

    // 4. The honest not-video boundary: only the `original` reality's
    //    artifacts are HTML5 video bytes this wave. A derived reality's
    //    stored artifact is a W504 animated-SVG review segment — 415, typed.
    if (kind !== "original") {
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

    // 5. The original reality: the media platform's real artifact. The
    //    descriptor and the artifact record come from the same store — the
    //    session-scoped read keeps them consistent (defense in depth).
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
