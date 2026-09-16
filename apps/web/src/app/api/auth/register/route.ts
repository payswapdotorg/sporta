import { getSportaServer } from "@/server/runtime";
import { errorResponse, jsonResponse, readJsonBody } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/register — create an account. Validation, self-selectable
 * grants (viewer/creator/analyst), and username uniqueness follow identity's
 * semantics; the answer is the client-safe account view. No cookie is set
 * (register then sign in, like identity's own transport).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const body = await readJsonBody(request);
    const account = await server.auth.register(body);
    return jsonResponse(200, account);
  } catch (err) {
    return errorResponse(err);
  }
}
