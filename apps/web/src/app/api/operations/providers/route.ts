import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/operations/providers — the OPERATIONS CONSOLE's provider panel
 * (W918).
 *
 * Usage counters ONLY where a real provider seam exposes them (the R2
 * store's never-silent stats; the compute adapter's accounting identities;
 * the Upstash queue depth), with the documented free-tier limits carried as
 * the W919 seam — explicitly NOT measured usage — and honest `unknown`
 * rows where no counter exists over our seams (Neon usage, Upstash
 * data/commands). OPERATOR GRANT REQUIRED.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const token = tokenFromRequest(request);
    if (token === "") {
      const { IdentityUnauthenticatedError } = await import("@sporta/identity");
      throw new IdentityUnauthenticatedError();
    }
    const snapshot = await server.operations.providersSnapshot(token);
    return jsonResponse(200, snapshot);
  } catch (err) {
    return errorResponse(err);
  }
}
