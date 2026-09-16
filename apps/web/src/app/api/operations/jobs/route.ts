import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/operations/jobs — the OPERATIONS CONSOLE's jobs table (W918).
 *
 * The compute ledger: every studio-dispatched async job with its live state
 * (from the control plane's own projection), its renderer, its dispatcher,
 * its bounded-queue admission state, and once terminal the NEVER-SILENT
 * completion envelope — the failure errorClass/message for FAILED jobs, the
 * input accounting (consumed + unconsumed-with-reason) and the metered
 * usage. A job whose projection is unavailable says so honestly. OPERATOR
 * GRANT REQUIRED.
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
    const snapshot = await server.operations.jobsListing(token);
    return jsonResponse(200, snapshot);
  } catch (err) {
    return errorResponse(err);
  }
}
