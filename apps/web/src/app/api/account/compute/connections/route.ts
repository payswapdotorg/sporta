import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/account/compute/connections — THE CONNECT ACTION (J005).
 *
 * Body: `{ providerId: string, credential?: { kind, ...fields } | null }` —
 * the credential presentation is the connection-center's closed vocabulary:
 *
 * - the ACCEPTED kinds (`scoped-api-key | scoped-token-pair |
 *   oauth-access-token`) connect the provider (the credential VALUE is
 *   consumed transiently by the adapter factory — never stored, never
 *   logged; the record keeps only the sha-256 fingerprint);
 * - the PASSWORD-CLASS kinds are refused fail-closed BEFORE anything is
 *   stored (the typed refusal + the audit entry) — the answer is the
 *   honest `refused-master-password` outcome, never a 500;
 * - `credential: null` connects a credential-less provider (local, when
 *   configured) and is a validation error for credential-backed ones.
 *
 * Requires an authenticated caller (401 anonymous).
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
    const body = (await request.json().catch(() => null)) as {
      providerId?: unknown;
      credential?: unknown;
    } | null;
    if (
      body === null ||
      typeof body !== "object" ||
      typeof body.providerId !== "string" ||
      body.providerId.length === 0
    ) {
      return jsonResponse(400, {
        error: {
          failureClass: "validation",
          message: "the connect body must be { providerId: string, credential?: object | null }",
        },
      });
    }
    const answer = await server.computeCenter.connect(
      token,
      body.providerId,
      (body.credential ?? null) as never,
    );
    return jsonResponse(answer.outcome === "connected" ? 201 : 200, answer);
  } catch (err) {
    return errorResponse(err);
  }
}
