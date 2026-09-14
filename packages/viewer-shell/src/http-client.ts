/**
 * The HTTP control client (W702): a {@link ControlClient} adapter over the
 * REAL `createControlServer` (W701) transport using `fetch`.
 *
 * Browser-safe by construction (this module is part of the served ES-module
 * graph): it imports only types from the `@sporta/*` packages and uses the
 * platform `fetch`. A small `fetch` seam is injectable for tests.
 *
 * Fail-closed posture: every non-2xx answer becomes a typed
 * {@link ViewerControlError} built from the control plane's documented error
 * body (`{ error: { failureClass, message, details? } }`); an unrecognized
 * wire class is surfaced as `internal` carrying the raw class (never
 * silently mapped); a connection failure is the viewer-side `network` class;
 * an unreadable body is an `internal` error. OK responses with a non-object
 * body are ALSO errors — the client never hands partial data upward.
 */
import { ViewerControlError, isViewerFailureClass } from "./errors.ts";
import type { ControlClient } from "./ports.ts";
import type {
  CreateRenderInput,
  CreateSessionInput,
  CreateSessionResult,
  GetSessionResult,
  ListRenderersResult,
  ListRendersResult,
  ListSessionsResult,
  RenderEnvelope,
  TerminateSessionResult,
} from "@sporta/control-api";

/**
 * The fetch seam: any standard `fetch`-shaped function (the platform fetch
 * in the browser or bun, a recording/scripted wrapper in tests). Deliberately
 * NOT `typeof fetch` so bun's extended fetch surface does not leak into the
 * contract.
 */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Options for {@link createHttpControlClient}. */
export interface HttpControlClientOptions {
  /**
   * Base URL of the control API (the v1 routes are appended). Same-origin
   * relative URLs (e.g. `"/control"`) work in the browser.
   */
  baseUrl: string;
  /** Fetch seam (defaults to the platform `fetch`; injectable for tests). */
  fetch?: FetchLike;
  /** Request-id factory (default: deterministic per-client `viewer-<n>`). */
  requestId?: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Maps a non-2xx response body (already parsed) onto the viewer error. */
function wireError(status: number, body: unknown): ViewerControlError {
  if (isRecord(body) && isRecord(body.error)) {
    const wire = body.error;
    const message = typeof wire.message === "string" ? wire.message : "control plane error";
    const rawClass = wire.failureClass;
    if (typeof rawClass === "string" && isViewerFailureClass(rawClass)) {
      const details = isRecord(wire.details) ? wire.details : {};
      return new ViewerControlError(rawClass, message, { ...details, httpStatus: status });
    }
    return new ViewerControlError("internal", message, {
      httpStatus: status,
      wireFailureClass: typeof rawClass === "string" ? rawClass : typeof rawClass,
    });
  }
  return new ViewerControlError("internal", "control plane returned a malformed error body", {
    httpStatus: status,
    body: typeof body === "string" ? body.slice(0, 200) : JSON.stringify(body)?.slice(0, 200),
  });
}

/** Creates the HTTP control client (see the module docs). */
export function createHttpControlClient(options: HttpControlClientOptions): ControlClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  let seq = 0;
  const nextRequestId = options.requestId ?? ((): string => `viewer-${(seq += 1)}`);

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      "x-request-id": nextRequestId(),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    };
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      throw new ViewerControlError(
        "network",
        `control server could not be reached (${err instanceof Error ? err.message : "fetch failed"})`,
      );
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new ViewerControlError(
        "internal",
        `control server response was not JSON (status ${String(response.status)})`,
        { httpStatus: response.status },
      );
    }
    if (!response.ok) {
      throw wireError(response.status, parsed);
    }
    if (!isRecord(parsed)) {
      throw new ViewerControlError(
        "internal",
        `control server response body was not an object (status ${String(response.status)})`,
        { httpStatus: response.status },
      );
    }
    // Response documents are produced by the validated control-plane stores
    // (W701 zod-validates every stored document); the client guards shape
    // minimally (object body) and never invents fields.
    return parsed as T;
  }

  const encode = (value: string): string => encodeURIComponent(value);

  return {
    createSession: (input: CreateSessionInput) =>
      call<CreateSessionResult>("POST", "/v1/sessions", input),
    getSession: (sessionId: string) =>
      call<GetSessionResult>("GET", `/v1/sessions/${encode(sessionId)}`),
    listSessions: () => call<ListSessionsResult>("GET", "/v1/sessions"),
    terminateSession: (sessionId: string) =>
      call<TerminateSessionResult>("POST", `/v1/sessions/${encode(sessionId)}/terminate`),
    listRenderers: () => call<ListRenderersResult>("GET", "/v1/renderers"),
    createRender: (sessionId: string, input: CreateRenderInput) =>
      call<RenderEnvelope>("POST", `/v1/sessions/${encode(sessionId)}/renders`, input),
    getRender: (sessionId: string, renderId: string) =>
      call<RenderEnvelope>("GET", `/v1/sessions/${encode(sessionId)}/renders/${encode(renderId)}`),
    listRenders: (sessionId: string) =>
      call<ListRendersResult>("GET", `/v1/sessions/${encode(sessionId)}/renders`),
  };
}
