import { getSportaServer } from "@/server/runtime";
import { errorResponse, jsonResponse, readJsonBody } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/create/url-source-oembed-preview — the Create Studio URL
 * mode's pre-registration lookup (W6 Worker B): the host's PUBLIC oEmbed
 * metadata for the pasted URL, or the HONEST reason it is absent (a
 * bot-walled host, an unknown endpoint, a timeout — never a fabricated
 * title). An unparsable url answers the typed 400.
 *
 * This is a PUBLIC-metadata lookup only — no rights declaration is
 * implied, nothing is registered, and no video bytes are claimed. The
 * registration itself (the rights flow) is POST /api/create/url-sources.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const body = (await readJsonBody(request)) as Record<string, unknown> | null;
    if (body === null) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError("the preview body is required (JSON with a 'url' field)");
    }
    const url = body.url;
    if (typeof url !== "string" || url.length === 0) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError("the 'url' field is required (the exact source URL)");
    }
    const preview = await server.urlSources.previewOEmbed({ url });
    return jsonResponse(200, preview);
  } catch (err) {
    return errorResponse(err);
  }
}
