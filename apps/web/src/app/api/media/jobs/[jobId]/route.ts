import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/media/jobs/[jobId] — the media pipeline's HONEST poll surface
 * (R103): the real W914-vocabulary state
 * (admitted/dispatched/queued/in-flight/succeeded/failed/cancelled/
 * dead-lettered), the stage-completion trail (upload-complete /
 * normalization-complete / artifact-stored — progress is TIED to these,
 * never fabricated), and once terminal the produced record ids. A job is
 * session-scoped: the caller must own the job's session or hold an
 * operator grant; a job from another session answers a uniform 404 (no
 * cross-session probing).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
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

    const { jobId } = await context.params;
    const job = server.media.jobView(jobId);
    if (job === null) {
      throw new MediaNotFoundError("job", jobId);
    }

    // Session-scoped ownership (uniform denial before existence probing).
    const account = await server.gate.requireAccount(token);
    const ownerId = (await server.ownership.ownerIdOf(job.sessionId)) ?? "not-owned";
    const decision = authorize(account, "media-session.read", { ownerId });
    if (!decision.allowed) {
      // A non-owner learns nothing about the job's existence: uniform 404.
      throw new MediaNotFoundError("job", jobId);
    }

    return jsonResponse(200, job);
  } catch (err) {
    return errorResponse(err);
  }
}
