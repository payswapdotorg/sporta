import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/account/compute/connections/[providerId] — THE DISCONNECT
 * ACTION (J005): removes the account's connection record, drops the
 * runtime adapter binding, and audits the removal. Disconnecting an
 * unknown connection is the typed unknown-connection error (never a
 * silent no-op). Requires an authenticated caller (401 anonymous).
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ providerId: string }> },
): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const token = tokenFromRequest(request);
    if (token === "") {
      const { IdentityUnauthenticatedError } = await import("@sporta/identity");
      throw new IdentityUnauthenticatedError();
    }
    const { providerId } = await context.params;
    const record = await server.computeCenter.disconnect(token, providerId);
    return jsonResponse(200, { outcome: "disconnected", record });
  } catch (err) {
    return errorResponse(err);
  }
}
