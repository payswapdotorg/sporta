import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/media/artifacts/[artifactId] — one produced reality artifact's
 * frozen `RenderArtifactManifest` (R104): the content-addressed identity,
 * the producing renderer, the SWM provenance rules (null + sourceAssetId
 * for the `original` reality), and the integrity verdict (`verified: true`
 * only after the stored bytes were re-read and hash-verified).
 * Session-scoped (owner/operator); a non-owner answers a uniform 404.
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

    const account = await server.gate.requireAccount(token);
    const ownerId = (await server.ownership.ownerIdOf(artifact.sessionId)) ?? "not-owned";
    const decision = authorize(account, "media-session.read", { ownerId });
    if (!decision.allowed) {
      throw new MediaNotFoundError("artifact", artifactId);
    }

    return jsonResponse(200, artifact);
  } catch (err) {
    return errorResponse(err);
  }
}
