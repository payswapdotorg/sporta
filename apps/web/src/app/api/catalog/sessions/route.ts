import { getSportaServer } from "@/server/runtime";
import { buildCatalog } from "@/server/catalog-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalog/sessions — the public catalog: every real control-plane
 * session as a card model (real status, real playback-rights decision, real
 * render/output availability; fail-closed `renders: null` for denied
 * sessions).
 */
export async function GET(): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const sessions = await buildCatalog(server);
    return jsonResponse(200, { sessions, catalogSource: "dev-seed" });
  } catch (err) {
    return errorResponse(err);
  }
}
