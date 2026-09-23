import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse, readJsonBody } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/create/url-sources — THE URL-SOURCE REGISTRATION (W6 Worker B):
 * the operator's canonical source URL + the SAME rights declaration the
 * upload path uses become one registration, born `PENDING_TRANSFER`.
 *
 * JSON body:
 * - `url` — the EXACT source location (fail-closed https parse; stored
 *   VERBATIM — never normalized);
 * - `operations` — the rights declaration's allowed operations (the same
 *   closed vocabulary; the derivation must permit transformation — the
 *   media pipeline references source frames, fail-closed);
 * - `expiresAtIso?`, `storageDurationDays?`, `sharingScope?` — the rest of
 *   the declaration;
 * - `realities?`, `compute?`, `styleId?` — the J004 plan parameters
 *   (replayed verbatim when the transfer lands, exactly like the upload
 *   path's ONE-submission plan).
 *
 * The public oEmbed metadata is fetched HONESTLY at registration (the
 * host's own public endpoint, a bounded timeout): a bot-walled or unknown
 * host records the honest `unavailableReason` — nothing is fabricated.
 *
 * Answers 201 with the registration view + the ONE-TIME acquisition
 * capability (the owner hands it to the acquisition machine — it
 * authorizes the machine's begin/fail/ingest acts, never a user session).
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
    const body = (await readJsonBody(request)) as Record<string, unknown> | null;
    if (body === null) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError("the registration body is required (JSON)");
    }
    const url = body.url;
    if (typeof url !== "string" || url.length === 0) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError("the 'url' field is required (the exact source URL)");
    }
    const operations = body.operations;
    if (
      !Array.isArray(operations) ||
      operations.length === 0 ||
      !operations.every((entry) => typeof entry === "string")
    ) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError(
        "the 'operations' field is required (an array of allowed-operation ids)",
      );
    }
    const registration = await server.urlSources.registerUrlSource({
      token,
      url,
      declaration: {
        operations,
        ...(typeof body.expiresAtIso === "string" ? { expiresAtIso: body.expiresAtIso } : {}),
        ...(typeof body.storageDurationDays === "number"
          ? { storageDurationDays: body.storageDurationDays }
          : {}),
        ...(typeof body.sharingScope === "string" ? { sharingScope: body.sharingScope } : {}),
      },
      ...(Array.isArray(body.realities) && body.realities.every((e) => typeof e === "string")
        ? { realities: body.realities as string[] }
        : {}),
      ...(body.compute !== undefined && typeof body.compute === "object" && body.compute !== null
        ? { compute: body.compute as never }
        : {}),
      ...(typeof body.styleId === "string" ? { styleId: body.styleId } : {}),
    });
    return jsonResponse(201, registration);
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * GET /api/create/url-sources — the caller's registrations (newest first),
 * the honest acquisition states verbatim (PENDING_TRANSFER / ACQUIRING /
 * ACQUIRED + integrity / FAILED + reason). Owner-only.
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
    const registrations = await server.urlSources.listRegistrations(token);
    return jsonResponse(200, { registrations });
  } catch (err) {
    return errorResponse(err);
  }
}
