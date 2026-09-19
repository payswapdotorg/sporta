import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse, readJsonBody } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/create/compute-preview — THE COMPUTE STEP (R501): the REAL R407
 * SelectionDirector's decision over the workload the render dispatch will
 * run — the caller's directive (user-explicit provider choice or
 * sporta-auto) answered with the broker's selection VERBATIM plus the
 * auditable explanation (every considered provider's quote, typed refusal,
 * or preference exclusion).
 *
 * Authenticated callers only (the studio's own surface). Body:
 * `{ rendererId, rendererVersion?, latencyClass, deadlineMs?, compute: {
 * mode, providerId?, preference? } }` — `latencyClass` is one of the
 * renderer's real output-profile classes. Deterministic: the same inputs
 * produce the same decision the dispatch later verifies.
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
    if (
      record.latencyClass !== "offline" &&
      record.latencyClass !== "near-live" &&
      record.latencyClass !== "live"
    ) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError(
        "latencyClass must be one of 'offline' | 'near-live' | 'live'",
      );
    }
    const compute = record.compute;
    if (
      typeof compute !== "object" ||
      compute === null ||
      Array.isArray(compute) ||
      ((compute as Record<string, unknown>).mode !== "user-explicit" &&
        (compute as Record<string, unknown>).mode !== "sporta-auto")
    ) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError(
        "compute must be the selection directive: { mode: 'user-explicit' | 'sporta-auto', providerId?, preference? }",
      );
    }
    const directive = compute as {
      mode: "user-explicit" | "sporta-auto";
      providerId?: string;
      preference?: {
        privacyPosture: "privacy-local-only" | "privacy-any";
        maxEstimatedCostUsd?: number;
        maxEstimatedQueueSeconds?: number;
        vramFloorMb?: number;
        capabilityClass?: string;
      };
    };

    const selection = await server.studio.computeSelection({
      token,
      rendererId: record.rendererId,
      ...(typeof record.rendererVersion === "string" && record.rendererVersion.length > 0
        ? { rendererVersion: record.rendererVersion }
        : {}),
      latencyClass: record.latencyClass,
      ...(typeof record.deadlineMs === "number" && Number.isFinite(record.deadlineMs)
        ? { deadlineMs: record.deadlineMs }
        : {}),
      directive,
    });
    return jsonResponse(200, selection);
  } catch (err) {
    return errorResponse(err);
  }
}
