import { getSportaServer } from "@/server/runtime";
import { capabilityForRequest } from "@/server/capability-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/capability — the W901 capability response for THIS request
 * (auth state, roles, renderer availability, live/batch modes, provider
 * health, catalog-surface visibility, overall). The frozen seam every
 * product surface renders from.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const requestId = new URL(request.url).searchParams.get("requestId") ?? undefined;
    const response = await capabilityForRequest(server, request, requestId ?? undefined);
    return jsonResponse(200, response);
  } catch (err) {
    return errorResponse(err);
  }
}
