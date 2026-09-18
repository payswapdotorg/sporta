/**
 * The shared REST→refusal mapping (R402-R405): ONE helper every provider
 * client uses to turn a {@link providerFetch} outcome into a typed
 * {@link ProviderCall} — so the credential/failure mapping matrix
 * (network → `provider-unavailable`; 401/403 → `credential-invalid`;
 * 429 → `quota-exhausted`; 404 → the endpoint-specific not-found posture)
 * is implemented ONCE and pinned by every adapter's fixture tier.
 *
 * The 404 specialization is per-endpoint on purpose: a 404 on a STATUS
 * poll means the provider no longer knows the job (PERMANENT — the ledger
 * dead-letters with the real cause, the R404 pod-not-found posture), while
 * a 404 on credential verification is an endpoint-configuration fault
 * (also permanent for that call). Callers pass their own not-found
 * refusal; the shared default is the permanent honest form.
 */
import type { FetchLike, ProviderFetchRequest, ProviderFetchOutcome } from "./http";
import { providerFetch, refusalReasonOfStatus, safeUrlOf } from "./http";
import type { ProviderCall } from "./ledger";
import type { ProviderRefusal } from "./refusal";

/** Options for {@link restCall}. */
export interface RestCallOptions {
  /** The injected fetch (tests replay recorded fixtures through it). */
  fetchFn?: FetchLike;
  /** The explicit per-call timeout in ms (REQUIRED). */
  timeoutMs: number;
  /** IDEMPOTENT GET retry budget (default 1; forced 0 for non-GET). */
  retries?: number;
}

/** The per-call response mapping a provider client supplies. */
export interface RestCallMapping<T> {
  /** The endpoint-family label (DATA carried in transport evidence). */
  endpoint: string;
  /** Maps a 2xx answer onto the typed value (or a typed refusal). */
  ok: (status: number, body: unknown) => ProviderCall<T>;
  /** The endpoint's 404 posture (default: permanent provider-unavailable). */
  notFound?: (body: unknown) => ProviderRefusal;
}

/** Extracts the provider's own error message when it answers one. */
export function errorMessageOf(body: unknown, fallback: string): string {
  if (body !== null && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const error = record["error"];
    if (error !== null && typeof error === "object" && error !== undefined) {
      const message = (error as Record<string, unknown>)["message"];
      if (typeof message === "string" && message.length > 0) return message;
    }
    for (const key of ["message", "detail", "error"]) {
      const value = record[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
  }
  if (typeof body === "string" && body.length > 0 && body.length <= 500) return body;
  return fallback;
}

/** Maps a transport failure onto the honest refusal (never invented). */
function transportRefusal(
  endpoint: string,
  failure: { kind: "network" | "timeout"; message: string },
): ProviderRefusal {
  return {
    reason: "provider-unavailable",
    message: failure.message,
    transport: { kind: failure.kind, endpoint },
  };
}

/**
 * ONE provider REST call through the shared mapping: fetch (timeout,
 * bounded GET retry) → 2xx → the caller's `ok` mapping; 401/403 →
 * `credential-invalid`; 429 → `quota-exhausted`; 404 → the endpoint's
 * not-found posture; any other non-2xx → `provider-unavailable`; a
 * network/timeout failure → `provider-unavailable` (transport evidence).
 * NEVER throws.
 */
export async function restCall<T>(
  request: ProviderFetchRequest,
  options: RestCallOptions,
  mapping: RestCallMapping<T>,
): Promise<ProviderCall<T>> {
  const outcome: ProviderFetchOutcome = await providerFetch(request, {
    fetchFn: options.fetchFn,
    timeoutMs: options.timeoutMs,
    retries: options.retries,
  });
  if (!outcome.ok) {
    return { ok: false, refusal: transportRefusal(mapping.endpoint, outcome.failure) };
  }
  const { status, body } = outcome;
  if (status >= 200 && status < 300) {
    return mapping.ok(status, body);
  }
  if (status === 404) {
    const refusal =
      mapping.notFound?.(body) ??
      ({
        reason: "provider-unavailable",
        message: `${mapping.endpoint} answered 404 for ${request.method} ${safeUrlOf(request.url)}: ${errorMessageOf(body, "not found")}`,
        transport: { kind: "http", status, endpoint: mapping.endpoint },
        permanent: true,
      } satisfies ProviderRefusal);
    return { ok: false, refusal };
  }
  const reason = refusalReasonOfStatus(status);
  const fallback = `${mapping.endpoint} answered HTTP ${status} for ${request.method} ${safeUrlOf(request.url)}`;
  return {
    ok: false,
    refusal: {
      reason,
      message: `${fallback}: ${errorMessageOf(body, "no provider error body")}`,
      transport: { kind: "http", status, endpoint: mapping.endpoint },
    },
  };
}
