/**
 * `createControlServer` — the HTTP transport for the control plane (W701).
 *
 * A thin `Bun.serve` wrapper over {@link createControlApp}: routes, JSON
 * bodies, typed-error → status mapping, and request-id correlation. The
 * transport holds no domain logic; every decision comes from the app (which
 * also emits the one structured log line + counters per request that reaches
 * it). Requests the transport rejects itself (unknown route, method
 * mismatch, unreadable/non-JSON body) emit their own single
 * `control-api`-stage line and bump the same counters, so EVERY request
 * produces exactly one line and one `control_requests_total` increment.
 *
 * Routes (v1):
 *
 * - `POST /v1/sessions` — create a session (JSON body)
 * - `GET /v1/sessions` — list session summaries
 * - `GET /v1/sessions/:id` — inspect a session
 * - `POST /v1/sessions/:id/terminate` — terminate (idempotent)
 * - `GET /v1/renderers` — list registered renderer capabilities
 * - `POST /v1/sessions/:id/renders` — create a render (JSON body)
 * - `GET /v1/sessions/:id/renders` — list render summaries (playback gate)
 * - `GET /v1/sessions/:id/renders/:renderId` — get a stored render (gate)
 * - `GET /v1/sessions/:id/renders/:renderId/outputs` — list stored render
 *   output segments (playback gate; W504)
 * - `GET /v1/sessions/:id/renders/:renderId/outputs/:segmentId` — get one
 *   stored render output segment: bytes + content type + manifest (gate;
 *   W504)
 *
 * Status mapping: success → 200 with the payload; rights-denied → 403;
 * media-invalid/validation → 400; resource-limit → 413; internal → 500;
 * unknown-session/unknown-render/unknown-segment → 404. Errors always
 * answer `{ error: { failureClass, message, details? } }`; transport-level
 * rejections use the classes `validation` (400), `unknown-route` (404), and
 * `method-not-allowed` (405).
 *
 * Request id: the `x-request-id` header is echoed (or a deterministic
 * `req-<n>` is generated), echoed back on the response, and logged as the
 * correlation id on the request's log line. No CORS configuration (the W701
 * tests are same-origin).
 */
import { CONTROL_API_STAGE, CONTROL_METRIC_NAMES, createControlApp } from "./app";
import type {
  ControlAppOptions,
  ControlCallContext,
  ControlRoute,
  CreateRenderInput,
  CreateSessionInput,
} from "./app";
import { ControlApiError, errMessage } from "./errors";

/** Options for {@link createControlServer}: app options plus the port. */
export interface ControlServerOptions extends ControlAppOptions {
  /**
   * Listen port. `0` (the default) asks the OS for an ephemeral port — the
   * actual port is on `server.port`.
   */
  port?: number;
}

/** The concrete server type produced by `Bun.serve` without websockets. */
export type ControlServer = Bun.Server<undefined>;

/** Transport-level failure classes (app-level classes live in ./errors). */
export type TransportFailureClass = "validation" | "unknown-route" | "method-not-allowed";

const TRANSPORT_HTTP_STATUS: Readonly<Record<TransportFailureClass, number>> = {
  validation: 400,
  "unknown-route": 404,
  "method-not-allowed": 405,
};

/** Route label used when a request maps to no route+method. */
const UNKNOWN_ROUTE_LABEL = "unknown";

interface RouteSpec {
  readonly method: "GET" | "POST";
  readonly segments: readonly string[];
  readonly name: ControlRoute;
}

const ROUTES: readonly RouteSpec[] = [
  { method: "POST", segments: ["v1", "sessions"], name: "create_session" },
  { method: "GET", segments: ["v1", "sessions"], name: "list_sessions" },
  { method: "GET", segments: ["v1", "sessions", ":id"], name: "get_session" },
  { method: "POST", segments: ["v1", "sessions", ":id", "terminate"], name: "terminate_session" },
  { method: "GET", segments: ["v1", "renderers"], name: "list_renderers" },
  { method: "POST", segments: ["v1", "sessions", ":id", "renders"], name: "create_render" },
  { method: "GET", segments: ["v1", "sessions", ":id", "renders"], name: "list_renders" },
  {
    method: "GET",
    segments: ["v1", "sessions", ":id", "renders", ":renderId"],
    name: "get_render",
  },
  {
    method: "GET",
    segments: ["v1", "sessions", ":id", "renders", ":renderId", "outputs"],
    name: "list_render_outputs",
  },
  {
    method: "GET",
    segments: ["v1", "sessions", ":id", "renders", ":renderId", "outputs", ":segmentId"],
    name: "get_render_output",
  },
];

type RouteMatch =
  | { kind: "handler"; spec: RouteSpec; params: Record<string, string> }
  | { kind: "method-mismatch"; allow: string }
  | { kind: "not-found" };

function shapeMatches(spec: RouteSpec, segments: string[]): boolean {
  if (spec.segments.length !== segments.length) return false;
  for (let i = 0; i < spec.segments.length; i += 1) {
    const literal = spec.segments[i];
    if (literal === undefined) return false;
    if (!literal.startsWith(":") && literal !== segments[i]) return false;
  }
  return true;
}

function matchRoute(method: string, segments: string[]): RouteMatch {
  const shapes = ROUTES.filter((spec) => shapeMatches(spec, segments));
  if (shapes.length === 0) return { kind: "not-found" };
  const handler = shapes.find((spec) => spec.method === method);
  if (handler !== undefined) {
    const params: Record<string, string> = {};
    for (let i = 0; i < handler.segments.length; i += 1) {
      const literal = handler.segments[i];
      if (literal !== undefined && literal.startsWith(":")) {
        params[literal.slice(1)] = segments[i] ?? "";
      }
    }
    return { kind: "handler", spec: handler, params };
  }
  const allow = [...new Set(shapes.map((spec) => spec.method))].sort().join(", ");
  return { kind: "method-mismatch", allow };
}

/** Path → decoded segments (empty segments are dropped). */
function splitPath(pathname: string): string[] {
  return pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

type BodyResult = { ok: true; value: unknown } | { ok: false; message: string };

async function readJsonBody(request: Request): Promise<BodyResult> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, message: "request body could not be read" };
  }
  if (text.trim().length === 0) {
    return { ok: false, message: "request body is required" };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, message: `request body is not valid JSON: ${errMessage(err)}` };
  }
}

/**
 * Creates the control-plane HTTP server. The app (and its observability
 * seams) is built from `options`; the returned `Bun.Server` exposes the
 * actual bound port as `server.port`. Stop it with `server.stop(true)`.
 */
export function createControlServer(options: ControlServerOptions = {}): ControlServer {
  const app = createControlApp(options);
  const logger = app.observability.logger;
  const metrics = app.observability.metrics;
  const stageLogger = logger.child({ stage: CONTROL_API_STAGE });
  let requestSeq = 0;

  function respond(
    status: number,
    payload: unknown,
    requestId: string,
    extraHeaders: Record<string, string> = {},
  ): Response {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json", "x-request-id": requestId, ...extraHeaders },
    });
  }

  /** Transport-level rejection: one line + counters + error response. */
  function transportFailure(
    failureClass: TransportFailureClass,
    message: string,
    requestId: string,
    route: string,
    extraHeaders: Record<string, string> = {},
  ): Response {
    const status = TRANSPORT_HTTP_STATUS[failureClass];
    metrics.counter(CONTROL_METRIC_NAMES.requestsTotal, { route }).inc();
    metrics.counter(CONTROL_METRIC_NAMES.failuresTotal, { failure_class: failureClass }).inc();
    stageLogger.child({ correlationId: requestId }).warn(`control.${route}`, {
      route,
      outcome: "failed",
      failureClass,
      message,
    });
    return respond(status, { error: { failureClass, message } }, requestId, extraHeaders);
  }

  function appErrorResponse(err: unknown, requestId: string): Response {
    if (err instanceof ControlApiError) {
      const body: { failureClass: string; message: string; details?: Record<string, unknown> } = {
        failureClass: err.failureClass,
        message: err.message,
      };
      if (Object.keys(err.details).length > 0) body.details = err.details;
      return respond(err.httpStatus, { error: body }, requestId);
    }
    // Unreachable in practice (the app wraps every failure), kept defensive:
    // log the line the app never emitted, then answer 500.
    metrics.counter(CONTROL_METRIC_NAMES.requestsTotal, { route: UNKNOWN_ROUTE_LABEL }).inc();
    metrics.counter(CONTROL_METRIC_NAMES.failuresTotal, { failure_class: "internal" }).inc();
    stageLogger.child({ correlationId: requestId }).error("control.internal", {
      route: UNKNOWN_ROUTE_LABEL,
      outcome: "failed",
      failureClass: "internal",
      message: errMessage(err),
    });
    return respond(
      500,
      { error: { failureClass: "internal", message: errMessage(err) } },
      requestId,
    );
  }

  async function handle(request: Request): Promise<Response> {
    const headerId = request.headers.get("x-request-id");
    const requestId =
      headerId !== null && headerId.trim().length > 0
        ? headerId.trim()
        : `req-${(requestSeq += 1)}`;
    const ctx: ControlCallContext = { requestId };

    const url = new URL(request.url);
    const segments = splitPath(url.pathname);
    const match = matchRoute(request.method, segments);

    if (match.kind === "not-found") {
      return transportFailure(
        "unknown-route",
        `no route for ${request.method} ${url.pathname}`,
        requestId,
        UNKNOWN_ROUTE_LABEL,
      );
    }
    if (match.kind === "method-mismatch") {
      return transportFailure(
        "method-not-allowed",
        `method ${request.method} is not allowed for ${url.pathname}`,
        requestId,
        UNKNOWN_ROUTE_LABEL,
        { allow: match.allow },
      );
    }

    const { spec, params } = match;
    try {
      switch (spec.name) {
        case "create_session": {
          const body = await readJsonBody(request);
          if (!body.ok) {
            return transportFailure("validation", body.message, requestId, spec.name);
          }
          // The app re-validates the untrusted body (zod contracts + scalar
          // guards); the cast only satisfies the typed in-process surface.
          const payload = await app.createSession(body.value as CreateSessionInput, ctx);
          return respond(200, payload, requestId);
        }
        case "list_sessions": {
          const payload = await app.listSessions(ctx);
          return respond(200, payload, requestId);
        }
        case "get_session": {
          const payload = await app.getSession(params.id ?? "", ctx);
          return respond(200, payload, requestId);
        }
        case "terminate_session": {
          const payload = await app.terminateSession(params.id ?? "", ctx);
          return respond(200, payload, requestId);
        }
        case "list_renderers": {
          const payload = await app.listRenderers(ctx);
          return respond(200, payload, requestId);
        }
        case "create_render": {
          const body = await readJsonBody(request);
          if (!body.ok) {
            return transportFailure("validation", body.message, requestId, spec.name);
          }
          // The app re-validates the untrusted body (see create_session).
          const payload = await app.createRender(
            params.id ?? "",
            body.value as CreateRenderInput,
            ctx,
          );
          return respond(200, payload, requestId);
        }
        case "list_renders": {
          const payload = await app.listRenders(params.id ?? "", ctx);
          return respond(200, payload, requestId);
        }
        case "get_render": {
          const payload = await app.getRender(params.id ?? "", params.renderId ?? "", ctx);
          return respond(200, payload, requestId);
        }
        case "list_render_outputs": {
          const payload = await app.listRenderOutputs(params.id ?? "", params.renderId ?? "", ctx);
          return respond(200, payload, requestId);
        }
        case "get_render_output": {
          const payload = await app.getRenderOutput(
            params.id ?? "",
            params.renderId ?? "",
            params.segmentId ?? "",
            ctx,
          );
          return respond(200, payload, requestId);
        }
      }
    } catch (err) {
      return appErrorResponse(err, requestId);
    }
    // Exhaustive switch above; unreachable.
    return transportFailure("unknown-route", "unreachable", requestId, UNKNOWN_ROUTE_LABEL);
  }

  return Bun.serve({
    port: options.port ?? 0,
    fetch: (request: Request): Promise<Response> => handle(request),
  });
}
