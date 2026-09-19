import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/create/upload-sessions — THE STUDIO'S REAL UPLOAD FLOW (R501):
 * one authorized MP4 upload becomes one media session whose world model is
 * derived from the UPLOADED clip.
 *
 * multipart/form-data:
 * - `file` — the MP4 (constraints enforced SERVER-SIDE through the REAL
 *   R101 boundary: max 200 MB, magic-byte-sniffed mp4 container,
 *   ffprobe-measured duration ≤ 120 s, ≥ 1 video stream — every rejection
 *   typed, nothing stored);
 * - `operations` — the rights declaration's allowed operations (a JSON
 *   array or a single repeated field; re-attested to the verified identity,
 *   fail-closed — the same preview the studio's rights step already showed);
 * - `expiresAtIso?`, `storageDurationDays?`, `sharingScope?` — the rest of
 *   the declaration;
 * - `label?` — the session's display label.
 *
 * Server sequence (every seam REAL): the W902 identity gate → the R101
 * constraint pre-check → the R207 real-to-SWM pipeline over the uploaded
 * bytes (the session's fused engine) → the control-plane session creation →
 * the R101 upload boundary (durable hash-verified SourceAsset + the
 * admitted media job: normalization → the `original`-reality artifact) →
 * the W921 durable write-through (`upload:<assetId>` source key).
 *
 * Answers 201 with the session + the durable source state + the honest
 * perception summary. The media job's honest states are polled through
 * GET /api/media/jobs/[jobId]; the render dispatches through the SAME
 * renders route the fixture path uses.
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

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError("the upload must be multipart/form-data");
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError("the 'file' field is required");
    }
    // The declaration's operations: a JSON array or a plain single value.
    let operations: string[] | null = null;
    const operationsEntry = form.get("operations");
    if (typeof operationsEntry === "string") {
      const trimmed = operationsEntry.trim();
      if (trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
            operations = parsed as string[];
          }
        } catch {
          operations = null;
        }
      }
      if (operations === null) {
        operations = [operationsEntry];
      }
    } else {
      const all = form.getAll("operations");
      if (all.length > 0 && all.every((entry) => typeof entry === "string")) {
        operations = all as string[];
      }
    }
    if (operations === null || operations.length === 0) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError(
        "the 'operations' field is required (a JSON array of allowed-operation ids)",
      );
    }
    const expiresAtIso = form.get("expiresAtIso");
    const storageDurationDays = form.get("storageDurationDays");
    const sharingScope = form.get("sharingScope");
    const label = form.get("label");
    const storageDays =
      typeof storageDurationDays === "string" && storageDurationDays.length > 0
        ? Number(storageDurationDays)
        : undefined;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const session = await server.studio.createUploadSession({
      token,
      bytes,
      ...(typeof file.name === "string" && file.name.length > 0 ? { filename: file.name } : {}),
      declaration: {
        operations,
        ...(typeof expiresAtIso === "string" && expiresAtIso.length > 0 ? { expiresAtIso } : {}),
        ...(storageDays !== undefined && Number.isFinite(storageDays)
          ? { storageDurationDays: storageDays }
          : {}),
        ...(typeof sharingScope === "string" && sharingScope.length > 0 ? { sharingScope } : {}),
      },
      ...(typeof label === "string" && label.length > 0 ? { label } : {}),
    });
    return jsonResponse(201, session);
  } catch (err) {
    return errorResponse(err);
  }
}
