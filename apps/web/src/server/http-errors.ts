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
import { CatalogQueryError } from "./catalog-service";
import { IdentityApiError } from "@sporta/identity";
import { QueueFullError, RateLimitedError } from "./platform/upstash/guards";
import { ProviderCapacityLimitError } from "./platform/guardrails";

/** The JSON error body every non-2xx API answer uses. */
export interface ApiErrorBody {
  error: { failureClass: string; message: string; details?: Record<string, unknown> };
}

/** JSON response helper (never cacheable). */
export function jsonResponse(
  status: number,
  payload: unknown,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...(extraHeaders ?? {}),
    },
  });
}

/** Maps any thrown value onto the API's error-response conventions. */
export async function errorResponse(err: unknown): Promise<Response> {
  if (err instanceof RateLimitedError) {
    // W913: an exhausted quota is an honest 429 — the W901 QuotaState rides
    // in `details.quota` and the standard Retry-After header carries the
    // window's remaining seconds.
    return jsonResponse(
      err.status,
      {
        error: {
          failureClass: err.failureClass,
          message: err.message,
          details: { quota: err.quota, retryAfterSeconds: err.retryAfterSeconds },
        },
      } satisfies ApiErrorBody,
      { "retry-after": String(err.retryAfterSeconds) },
    );
  }
  if (err instanceof QueueFullError) {
    // W913: platform capacity, not the caller's fault — 503 + Retry-After.
    return jsonResponse(
      err.status,
      {
        error: {
          failureClass: err.failureClass,
          message: err.message,
          details: { depth: err.depth, maxDepth: err.maxDepth },
        },
      } satisfies ApiErrorBody,
      { "retry-after": String(err.retryAfterSeconds) },
    );
  }
  if (err instanceof ProviderCapacityLimitError) {
    // W919: a provider free-tier limit (or per-user daily usage quota) is at
    // its hard threshold — the refusal PRECEDES the provider's own failure,
    // and carries the REAL reason (limit id, scope, measured usage vs the
    // threshold). 503 + Retry-After, capacity not the caller's fault.
    return jsonResponse(
      err.status,
      {
        error: {
          failureClass: err.failureClass,
          message: err.message,
          details: {
            scope: err.scope,
            reasonCode: err.reasonCode,
            retryAfterSeconds: err.retryAfterSeconds,
            limit: {
              limitId: err.evaluation.limitId,
              provider: err.evaluation.provider,
              state: err.evaluation.state,
              used: err.evaluation.used,
              limit: err.evaluation.limit,
              unit: err.evaluation.unit,
              source: err.evaluation.source,
            },
          },
        },
      } satisfies ApiErrorBody,
      { "retry-after": String(err.retryAfterSeconds) },
    );
  }
  if (err instanceof AuthFlowError) {
    return jsonResponse(err.status, {
      error: {
        failureClass: err.failureClass,
        message: err.message,
        ...(Object.keys(err.details).length > 0 ? { details: err.details } : {}),
      },
    } satisfies ApiErrorBody);
  }
  if (err instanceof CatalogQueryError) {
    // W916: a malformed catalog query (unknown closed-vocabulary filter,
    // empty search) answers the typed 400 — never a silent empty answer.
    return jsonResponse(err.status, {
      error: {
        failureClass: err.failureClass,
        message: err.message,
      },
    } satisfies ApiErrorBody);
  }
  if (err instanceof IdentityApiError) {
    // W906: identity-typed failures (the control gate's 401/403, the
    // identity package's own classes) carry their derived status + class.
    return jsonResponse(err.httpStatus, {
      error: {
        failureClass: err.failureClass,
        message: err.message,
        ...(Object.keys(err.details).length > 0 ? { details: err.details } : {}),
      },
    } satisfies ApiErrorBody);
  }
  let controlApi: typeof import("@sporta/control-api") | null = null;
  try {
    controlApi = await import("@sporta/control-api");
  } catch (importErr) {
    // Observability: the error-class import itself failing must be visible —
    // and must not mask the ORIGINAL error with the fallback 500.
    console.error("[api] control-api error classes unavailable:", importErr);
  }
  if (controlApi !== null && controlApi.isControlApiError(err)) {
    // The control plane's typed errors carry their own httpStatus (the
    // CONTROL_HTTP_STATUS mapping: rights-denied → 403, validation → 400,
    // unknown-session/render/segment → 404, resource-limit → 413, internal → 500).
    const status = err.httpStatus ?? controlApi.CONTROL_HTTP_STATUS[err.failureClass];
    return jsonResponse(status, {
      error: {
        failureClass: err.failureClass,
        message: err.message,
        ...(Object.keys(err.details).length > 0 ? { details: err.details } : {}),
      },
    } satisfies ApiErrorBody);
  }
  // Observability (the W920 final-gate finding): an unknown failure is LOGGED
  // with its real cause — name, message, stack — before the secret-free
  // generic 500 answers. A silent 500 hid the exact class of intermittent
  // deployed defect (≈25-30% of watch reads under a cold parallel burst) from
  // the runtime logs entirely; the honest-degradation contract requires the
  // cause visible server-side even when the client answer stays generic. The
  // random errorId rides in both the log line and the response body so a
  // reported failure can be correlated with its log entry.
  const errorId = crypto.randomUUID();
  console.error(`[api] unhandled error (${errorId}):`, err);
  return jsonResponse(500, {
    error: {
      failureClass: "internal",
      message: "unexpected server failure",
      details: { errorId },
    },
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
