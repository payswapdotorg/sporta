import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/media/assets/[assetId] — one uploaded source asset's frozen
 * record (R101): the content-addressed identity, the measured media facts,
 * the declared rights policy, and the upload lifecycle state
 * (`checksumVerified: true` means the stored bytes were re-read and
 * hash-verified). Session-scoped (owner/operator); the asset's session is
 * derived from its job ledger — a non-owner answers a uniform 404.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
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

    const { assetId } = await context.params;
    const asset = server.media.asset(assetId);
    if (asset === null) {
      throw new MediaNotFoundError("asset", assetId);
    }
    // The asset's session, derived from its job ledger (the frozen
    // SourceAsset contract carries no session field by design).
    const jobs = await server.media.jobsForAsset(assetId);
    const sessionId = jobs[0]?.sessionId ?? null;

    const account = await server.gate.requireAccount(token);
    const ownerId = (await server.ownership.ownerIdOf(sessionId ?? assetId)) ?? "not-owned";
    const decision = authorize(account, "media-session.read", { ownerId });
    if (!decision.allowed) {
      throw new MediaNotFoundError("asset", assetId);
    }

    return jsonResponse(200, {
      asset,
      ...(server.media.manifestOf(assetId) !== null
        ? { manifest: server.media.manifestOf(assetId) }
        : {}),
      jobs: jobs.map((job) => ({
        jobId: job.jobId,
        state: job.state,
        terminal: job.terminal,
        progress: job.progress,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
