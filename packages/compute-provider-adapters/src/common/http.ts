/**
 * The provider HTTP transport (R402-R405): EVERY remote REST call the four
 * real provider adapters make goes through {@link providerFetch} — plain
 * `fetch` ONLY (no provider SDK, no vendored client code; the package README
 * records the license provenance), wrapped with:
 *
 * - an EXPLICIT timeout per call (`AbortController` + `setTimeout`; abort
 *   maps to the `timeout` transport kind → refusal reason
 *   `provider-unavailable` — never an unbounded hang);
 * - typed transport failures: a thrown `fetch` (DNS, refused, TLS) is the
 *   `network` kind; a non-2xx status is surfaced with its status code for
 *   the caller's HTTP-status mapping (401/403 → `credential-invalid`,
 *   429 → `quota-exhausted`, 5xx → `provider-unavailable` —
 *   ./refusal.ts carries the class map);
 * - the NO-RETRY-STORM posture: at most ONE retry of an IDEMPOTENT GET
 *   (a transient network/timeout failure), and ZERO retries of any
 *   dispatch-affecting call (POST/DELETE/PATCH never retry — a duplicate
 *   submit could double-execute on the provider).
 *
 * The transport is INJECTED (`fetchFn`): tests replay recorded fixtures
 * (fixtures/…) through a fixture transport; the conditional integration
 * tier injects the real `fetch`. No clock read happens here (timeouts are
 * scheduler work, not clock reads; every `atMs` the ledger stamps comes
 * from the adapter's injected `nowMs`).
 */

/** The typed transport outcome of one provider REST call. */
export type ProviderFetchOutcome =
  { ok: true; status: number; body: unknown } | { ok: false; failure: ProviderTransportFailure };

/** The typed transport failure (never a raw thrown error crossing seams). */
export interface ProviderTransportFailure {
  /** The failure kind (closed vocabulary). */
  kind: "network" | "timeout";
  /** Human-readable evidence (never empty). */
  message: string;
}

/** The fetch-like seam the provider transport consumes (structural — the
 *  full `typeof fetch` (with `preconnect` etc.) is more than the seam needs). */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Options for {@link providerFetch}. */
export interface ProviderFetchOptions {
  /** The injected fetch implementation (tests replay fixtures through it). */
  fetchFn?: FetchLike;
  /** The explicit per-call timeout in ms (REQUIRED — no unbounded calls). */
  timeoutMs: number;
  /**
   * How many times an IDEMPOTENT GET may be retried after a transient
   * network/timeout failure. Forced to `0` for every non-GET method —
   * dispatch calls never retry (no retry storms).
   */
  retries?: number;
}

/** One prepared provider REST request (plain fetch, JSON bodies). */
export interface ProviderFetchRequest {
  /** The absolute URL (composed by the provider client, never relative). */
  url: string;
  /** The HTTP method (uppercase). */
  method: "GET" | "POST" | "DELETE" | "PATCH";
  /** Request headers (auth lives here; NEVER log or persist these values). */
  headers?: Record<string, string>;
  /** The JSON body (POST/PATCH; `undefined` for GET/DELETE). */
  body?: unknown;
}

/** Runs one (possibly retried) provider call. */
async function runOnce(
  request: ProviderFetchRequest,
  fetchFn: FetchLike,
  timeoutMs: number,
): Promise<ProviderFetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchFn(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
      signal: controller.signal,
    });
    let body: unknown;
    const text = await response.text();
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    } else {
      body = undefined;
    }
    return { ok: true, status: response.status, body };
  } catch (err) {
    const aborted = controller.signal.aborted === true;
    const message = err instanceof Error ? err.message : `provider transport threw ${String(err)}`;
    return {
      ok: false,
      failure: {
        kind: aborted ? "timeout" : "network",
        message: aborted
          ? `provider call timed out after ${timeoutMs}ms (${request.method} ${safeUrlOf(request.url)})`
          : `provider network error: ${message} (${request.method} ${safeUrlOf(request.url)})`,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The ONE provider REST primitive: fetch with an explicit timeout, typed
 * transport failures, and the bounded retry posture (one retry for
 * idempotent GETs, none for anything else). NEVER throws — a transport
 * failure is a VALUE; the provider clients map it onto the refusal
 * vocabulary.
 */
export async function providerFetch(
  request: ProviderFetchRequest,
  options: ProviderFetchOptions,
): Promise<ProviderFetchOutcome> {
  const fetchFn = options.fetchFn ?? fetch;
  const isGet = request.method === "GET";
  const maxAttempts = isGet ? 1 + (options.retries ?? 1) : 1;
  let outcome = await runOnce(request, fetchFn, options.timeoutMs);
  // At most ONE retry, GETs only, transient failures only (an HTTP status
  // — even a 5xx — is NOT retried here: the provider answered).
  for (let attempt = 1; attempt < maxAttempts && !outcome.ok; attempt += 1) {
    outcome = await runOnce(request, fetchFn, options.timeoutMs);
  }
  return outcome;
}

/** Redacts query strings for logs/messages (a token never leaks into text). */
export function safeUrlOf(url: string): string {
  const queryAt = url.indexOf("?");
  return queryAt === -1 ? url : `${url.slice(0, queryAt)}?…`;
}

/**
 * Maps an HTTP status onto the R401 refusal reason (the transport-status
 * half of the credential/failure matrix; see ./refusal.ts for the classes):
 *
 * - 401 / 403 → `credential-invalid` (the provider REJECTED the auth);
 * - 429 → `quota-exhausted` (the bounded quota refused);
 * - 404 → `provider-unavailable` (the named resource is gone — the caller
 *   decides whether that is permanent for its endpoint family);
 * - any other non-2xx → `provider-unavailable` (the provider plane could
 *   not serve the call).
 */
export function refusalReasonOfStatus(
  status: number,
): "credential-invalid" | "quota-exhausted" | "provider-unavailable" {
  if (status === 401 || status === 403) return "credential-invalid";
  if (status === 429) return "quota-exhausted";
  return "provider-unavailable";
}
