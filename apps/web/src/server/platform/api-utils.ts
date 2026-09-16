/**
 * Shared helpers for the `/api/platform/*` route handlers (W910-W913).
 *
 * Conventions follow `@sporta/identity`'s Bun.serve transport (`http.ts`):
 * JSON-everything, an `x-request-id` correlation header on every response,
 * and a typed error envelope `{ error: { failureClass, message, details? } }`.
 * The failure classes here extend the identity transport set with the
 * platform-specific `provider-unavailable` (503) and `quota-exhausted`
 * (429, with the W901 `QuotaState` as details — the degraded-state emission).
 */
import { randomUUID } from "node:crypto";

/** The platform transport failure classes (identity's set + platform's). */
export type PlatformApiFailureClass =
  | "validation-error"
  | "auth-invalid"
  | "unauthenticated"
  | "permission-denied"
  | "not-found"
  | "conflict"
  | "resource-limit"
  | "provider-unavailable"
  | "internal";

const STATUS_BY_CLASS: Record<PlatformApiFailureClass, number> = {
  "validation-error": 400,
  "auth-invalid": 401,
  unauthenticated: 401,
  "permission-denied": 403,
  "not-found": 404,
  conflict: 409,
  "resource-limit": 413,
  "provider-unavailable": 503,
  internal: 500,
};

/** JSON response with the correlation header. */
export function jsonRespond(
  status: number,
  payload: unknown,
  requestId: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-request-id": requestId,
      ...extraHeaders,
    },
  });
}

/** A typed error response. */
export function apiError(
  failureClass: PlatformApiFailureClass,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
  statusOverride?: number,
): Response {
  const body: Record<string, unknown> = { failureClass, message };
  if (details !== undefined && Object.keys(details).length > 0) body.details = details;
  return jsonRespond(statusOverride ?? STATUS_BY_CLASS[failureClass], { error: body }, requestId);
}

/** New request id (or the caller's forwarded one, truncated). */
export function newRequestId(): string {
  return randomUUID();
}

/** Parses a JSON body, or returns undefined when the body is absent/invalid. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/** The bearer token from `Authorization` (identity's `extractToken` shape). */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header === null) return null;
  const [scheme, ...rest] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || rest.length === 0) return null;
  const token = rest.join(" ").trim();
  return token.length > 0 ? token : null;
}

/** The session token from the cookie (identity's `SESSION_COOKIE` name). */
export function cookieToken(request: Request): string | null {
  const cookie = request.headers.get("cookie");
  if (cookie === null) return null;
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.split("=");
    if (name?.trim() === "sporta_session") return rest.join("=").trim() || null;
  }
  return null;
}

/** The session token from either carrier (bearer wins, like W902's transport). */
export function sessionToken(request: Request): string | null {
  return bearerToken(request) ?? cookieToken(request);
}

/** ISO-8601 UTC (identity's `toIsoUtc` convention). */
export function toIsoUtc(epochMs: number): string {
  return new Date(epochMs).toISOString();
}
