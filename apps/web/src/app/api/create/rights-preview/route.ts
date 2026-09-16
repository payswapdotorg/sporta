import { getSportaServer } from "@/server/runtime";
import { errorResponse, jsonResponse, readJsonBody } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/create/rights-preview — what a rights declaration REALLY
 * permits (W906): the fail-closed derivation from `@sporta/contracts`
 * (`deriveRightsCapabilities`) over the caller-supplied declaration, plus
 * whether the control plane would admit a session under it. Semantics come
 * from the contract only — this route never invents rights meaning.
 *
 * Stateless (no session is created, nothing is stored); body:
 * `{ operations: string[], expiresAtIso?, storageDurationDays?, sharingScope? }`.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const body = await readJsonBody(request);
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError("request body must be a JSON object");
    }
    const record = body as Record<string, unknown>;
    if (!Array.isArray(record.operations)) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError("operations must be an array of allowed-operation ids");
    }
    const preview = server.studio.previewRights({
      operations: record.operations as string[],
      ...(typeof record.expiresAtIso === "string" ? { expiresAtIso: record.expiresAtIso } : {}),
      ...(typeof record.storageDurationDays === "number"
        ? { storageDurationDays: record.storageDurationDays }
        : {}),
      ...(typeof record.sharingScope === "string" ? { sharingScope: record.sharingScope } : {}),
    });
    return jsonResponse(200, preview);
  } catch (err) {
    return errorResponse(err);
  }
}
