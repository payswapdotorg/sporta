import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse, readJsonBody } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/rights/policies/[sessionId]/visibility — EDITS the session's
 * publication visibility (the W916 content model). Body:
 * `{ visibility: "public" | "private" | "unlisted" | { kind: "role-scoped", roles: [...] } }`.
 *
 * The decision is validated by the publication store's own rules (unknown
 * kind / role-scoped without valid grants → 400, never stored), recorded with
 * the editor's account id, and audited. Effects are the EXISTING gates: the
 * catalog/search listing scope and the watch-surface access rule.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const { sessionId } = await context.params;
    const body = await readJsonBody(request);
    if (
      body === null ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !("visibility" in body)
    ) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError(
        'request body must be { visibility: "public" | "private" | "unlisted" | { kind: "role-scoped", roles: [...] } }',
      );
    }
    const model = await server.rights.setVisibility(
      tokenFromRequest(request),
      sessionId,
      (body as Record<string, unknown>).visibility as never,
    );
    return jsonResponse(200, model);
  } catch (err) {
    return errorResponse(err);
  }
}
