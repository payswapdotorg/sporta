import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse, readJsonBody } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/create/sessions/[sessionId]/renders — dispatch ONE REAL render
 * (W906): the control plane's async compute surface (`createRenderAsync`)
 * through the configured compute adapter — the W914 seam the
 * `/api/compute` worker route also serves. The job executes through the
 * REAL renderer plugin and the REAL W504 encode/store; its outputs are
 * ingested into the playback store the watch surface reads when it
 * settles. The session's own rights gate the render fail-closed (the
 * control plane re-derives before dispatch).
 *
 * Owner/operator only. Body:
 * `{ rendererId, rendererVersion?, styleId?, outputProfile? }` where
 * `outputProfile` is one of the renderer's real supported profiles.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const token = tokenFromRequest(request);
    if (token === "") {
      const { IdentityUnauthenticatedError } = await import("@sporta/identity");
      throw new IdentityUnauthenticatedError();
    }
    const { sessionId } = await context.params;
    const body = await readJsonBody(request);
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError("request body must be a JSON object");
    }
    const record = body as Record<string, unknown>;
    if (typeof record.rendererId !== "string" || record.rendererId.length === 0) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError("rendererId must be a non-empty string");
    }
    const profile = record.outputProfile;
    if (profile !== undefined && (typeof profile !== "object" || profile === null)) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError("outputProfile must be an object when present");
    }
    const dispatch = await server.studio.dispatchRender({
      token,
      sessionId,
      rendererId: record.rendererId,
      ...(typeof record.rendererVersion === "string"
        ? { rendererVersion: record.rendererVersion }
        : {}),
      ...(typeof record.styleId === "string" && record.styleId.length > 0
        ? { styleId: record.styleId }
        : {}),
      ...(isOutputProfileShape(profile)
        ? {
            outputProfile: {
              resolution: {
                w: profile.resolution.w,
                h: profile.resolution.h,
              },
              frameRate: profile.frameRate,
              codec: profile.codec,
              container: profile.container,
              latencyClass: profile.latencyClass,
            },
          }
        : {}),
    });
    return jsonResponse(202, dispatch);
  } catch (err) {
    return errorResponse(err);
  }
}

/** Structural check for one real output profile handed back by /options. */
function isOutputProfileShape(value: unknown): value is {
  resolution: { w: number; h: number };
  frameRate: number;
  codec: string;
  container: string;
  latencyClass: "offline" | "near-live" | "live";
} {
  if (typeof value !== "object" || value === null) return false;
  const profile = value as Record<string, unknown>;
  const resolution = profile.resolution;
  return (
    typeof resolution === "object" &&
    resolution !== null &&
    typeof (resolution as Record<string, unknown>).w === "number" &&
    typeof (resolution as Record<string, unknown>).h === "number" &&
    typeof profile.frameRate === "number" &&
    typeof profile.codec === "string" &&
    typeof profile.container === "string" &&
    typeof profile.latencyClass === "string" &&
    ["offline", "near-live", "live"].includes(profile.latencyClass)
  );
}
