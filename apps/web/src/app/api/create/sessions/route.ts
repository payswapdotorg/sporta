import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse, readJsonBody } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/create/sessions — step 2 of the guided flow: create a media
 * session under the caller's RIGHTS DECLARATION (W906).
 *
 * The declaration travels the W902 control-gate path: the identity gate
 * verifies the session token, requires the `media-session.create` grant,
 * re-attests the policy to the VERIFIED account (`assertedBy`), records
 * ownership, and the control plane applies its own fail-closed admission
 * (a policy that derives no capability denies creation). The selected
 * fixture source is then run through the REAL engine chain, registered
 * before any render — exactly the dev seed's own wiring.
 *
 * Body: `{ sourceKey, operations: string[], expiresAtIso?,
 * storageDurationDays?, sharingScope?, label? }`.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const token = tokenFromRequest(request);
    if (token === null) {
      const { IdentityUnauthenticatedError } = await import("@sporta/identity");
      throw new IdentityUnauthenticatedError();
    }
    const body = await readJsonBody(request);
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError("request body must be a JSON object");
    }
    const record = body as Record<string, unknown>;
    if (typeof record.sourceKey !== "string") {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError("sourceKey must be a string (an authorized source key)");
    }
    if (!Array.isArray(record.operations)) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError("operations must be an array of allowed-operation ids");
    }
    const session = await server.studio.createSession({
      token,
      sourceKey: record.sourceKey,
      declaration: {
        operations: record.operations as string[],
        ...(typeof record.expiresAtIso === "string" ? { expiresAtIso: record.expiresAtIso } : {}),
        ...(typeof record.storageDurationDays === "number"
          ? { storageDurationDays: record.storageDurationDays }
          : {}),
        ...(typeof record.sharingScope === "string" ? { sharingScope: record.sharingScope } : {}),
      },
      ...(typeof record.label === "string" && record.label.length > 0
        ? { label: record.label }
        : {}),
    });
    return jsonResponse(201, session);
  } catch (err) {
    return errorResponse(err);
  }
}
