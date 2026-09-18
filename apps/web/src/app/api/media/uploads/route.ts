import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/media/uploads — THE REAL BROWSER UPLOAD BOUNDARY (R101).
 *
 * multipart/form-data:
 * - `file` — the MP4 (constraints enforced SERVER-SIDE, BEFORE storage:
 *   max 200 MB, magic-byte-sniffed mp4 container, ffprobe-measured
 *   duration ≤ 120 s, ≥ 1 video stream);
 * - `sessionId` — the studio session whose rights govern the media;
 * - `declaredRightsPolicyId` — must reference the session's EXISTING
 *   effective authorization policy (fail-closed; the policy must still
 *   allow `transformation` — the pipeline references source frames).
 *
 * The caller must own the session or hold an operator grant (the identity
 * gate's own denial ordering). A rejected upload answers the typed error
 * and NOTHING is stored; an accepted upload answers 201 with the frozen
 * `SourceAsset` (uploadState "stored", checksumVerified only after the
 * stored bytes were re-read and hash-verified) and the admitted processing
 * job (poll GET /api/media/jobs/[jobId]).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const token = tokenFromRequest(request);
    if (token === "") {
      const { IdentityUnauthenticatedError } = await import("@sporta/identity");
      throw new IdentityUnauthenticatedError();
    }
    const { authorize } = await import("@sporta/identity");

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError("the upload must be multipart/form-data");
    }
    const form = await request.formData();
    const file = form.get("file");
    const sessionId = form.get("sessionId");
    const declaredRightsPolicyId = form.get("declaredRightsPolicyId");
    if (!(file instanceof File)) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError("the 'file' field is required");
    }
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError("the 'sessionId' field is required");
    }
    if (typeof declaredRightsPolicyId !== "string" || declaredRightsPolicyId.length === 0) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError("the 'declaredRightsPolicyId' field is required");
    }

    // Owner/operator gate (the gate's own denial ordering: token → account →
    // grant; a non-owner's denial is uniform whether or not the session id
    // exists — no cross-session probing).
    const account = await server.gate.requireAccount(token);
    const ownerId = (await server.ownership.ownerIdOf(sessionId)) ?? "not-owned";
    const decision = authorize(account, "media-session.read", { ownerId });
    if (!decision.allowed) {
      const { IdentityPermissionDeniedError } = await import("@sporta/identity");
      throw new IdentityPermissionDeniedError("media upload is not authorized for this account", {
        action: "media-session.read",
      });
    }

    // The size pre-check (the measured byte length, never a header claim).
    // LAZY import: the media-platform graph reaches bun:sqlite (the
    // build-time rule — see ./runtime.ts).
    const { UPLOAD_CONSTRAINTS, UploadRejectedError } = await import("@sporta/media-platform");
    if (file.size > UPLOAD_CONSTRAINTS.maxBytes) {
      throw new UploadRejectedError(
        "size-over-limit",
        `the upload measures ${file.size} bytes, over the ${UPLOAD_CONSTRAINTS.maxBytes} byte bound`,
        "resource-limit",
        { byteSize: file.size, maxBytes: UPLOAD_CONSTRAINTS.maxBytes },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const outcome = await server.media.upload({
      bytes,
      sessionId,
      declaredRightsPolicyId,
    });
    return jsonResponse(201, {
      asset: outcome.asset,
      job: outcome.job,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
