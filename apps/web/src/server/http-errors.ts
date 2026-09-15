/**
 * Typed-error → HTTP-response mapping for the app's API routes.
 *
 * Mirrors the control plane's own conventions (control-api http.ts +
 * identity http.ts): classified rejections answer
 * `{ error: { failureClass, message, details? } }` with the documented
 * status; unknown failures answer a generic 500 that carries no secrets.
 *
 * The `@sporta/control-api` import is LAZY: its module graph reaches
 * `bun:sqlite` (a Bun-native package) which cannot be evaluated by the
 * Node worker Next.js uses at build time (see ./runtime.ts). It is only
 * needed on the error path, after a request has actually arrived.
 */
import { AuthFlowError } from "./auth-service";

/** The JSON error body every non-2xx API answer uses. */
export interface ApiErrorBody {
  error: { failureClass: string; message: string; details?: Record<string, unknown> };
}

/** JSON response helper (never cacheable). */
export function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** Maps any thrown value onto the API's error-response conventions. */
export async function errorResponse(err: unknown): Promise<Response> {
  if (err instanceof AuthFlowError) {
    return jsonResponse(err.status, {
      error: {
        failureClass: err.failureClass,
        message: err.message,
        ...(Object.keys(err.details).length > 0 ? { details: err.details } : {}),
      },
    } satisfies ApiErrorBody);
  }
  const { CONTROL_HTTP_STATUS, isControlApiError } = await import("@sporta/control-api");
  if (isControlApiError(err)) {
    // The control plane's typed errors carry their own httpStatus (the
    // CONTROL_HTTP_STATUS mapping: rights-denied → 403, validation → 400,
    // unknown-session/render/segment → 404, resource-limit → 413, internal → 500).
    const status = err.httpStatus ?? CONTROL_HTTP_STATUS[err.failureClass];
    return jsonResponse(status, {
      error: {
        failureClass: err.failureClass,
        message: err.message,
        ...(Object.keys(err.details).length > 0 ? { details: err.details } : {}),
      },
    } satisfies ApiErrorBody);
  }
  return jsonResponse(500, {
    error: { failureClass: "internal", message: "unexpected server failure" },
  } satisfies ApiErrorBody);
}

/** Parses a JSON request body (`null` when absent, throws a 400-shaped error). */
export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim().length === 0) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new AuthFlowError(
      400,
      "validation",
      `request body is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
