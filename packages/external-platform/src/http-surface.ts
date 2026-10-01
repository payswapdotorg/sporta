/**
 * The HTTP-style service surface (REL-014) — a versioned, provider-neutral
 * dispatch over the SAME application services the MCP surface uses. In
 * THIS slice the surface is IN-MEMORY (no network server, no new native
 * dependencies): `handle(request)` maps method + resource path onto the
 * versioned services and returns an HTTP-shaped response (status + typed
 * error bodies). The shape is the contract:
 *
 * - GET    /v1/organizations                     -> searchOrganizations
 * - GET    /v1/organizations/:id                 -> inspectOrganization
 * - POST   /v1/lab-runs                          -> launchLabRun
 * - POST   /v1/media                             -> submitMedia (submit_video)
 * - POST   /v1/feeds                             -> submitFeed (submit_feed)
 * - GET    /v1/jobs/:jobId                       -> getJob
 * - GET    /v1/jobs/:jobId/progress              -> getJobProgress (REL-030)
 * - POST   /v1/jobs/:jobId/cancellation          -> cancelJob
 * - GET    /v1/jobs/:jobId/output                -> getOutput
 * - GET    /v1/jobs/:jobId/evidence              -> getEvidence
 * - GET    /v1/benchmarks                        -> listBenchmarks (REL-030)
 * - GET    /v1/benchmarks/:registrationId        -> getBenchmark (REL-030)
 * - POST   /v1/organizations/:id/promotion       -> promoteOrganization
 *
 * Denied/unknown operations fail closed with useful typed states: unknown
 * routes 404 `platform.route-not-found`, wrong methods 405
 * `platform.method-not-allowed`, non-/v1 versions 404
 * `platform.unsupported-version`, and every typed error of the four
 * families (platform/corpus/registry/jobs) maps by failureClass into a
 * status + the neutral typed error record.
 */
import type { PlatformConnection } from "./domain";
import type { ExternalServiceEnvelope } from "./domain";
import type { ExternalServiceName } from "./domain";
import type { ExternalPlatformServices } from "./services";
import { toTypedErrorRecord } from "./errors";
import type { TypedErrorRecord } from "./errors";

// ---------------------------------------------------------------------------
// The request/response shapes
// ---------------------------------------------------------------------------

/** The HTTP-style request (in-memory dispatch; no network). */
export interface HttpSurfaceRequest {
  readonly method: "GET" | "POST";
  /** The resource path, e.g. "/v1/jobs/job-1/output". */
  readonly path: string;
  /** Query parameters (string values; parsed per route). */
  readonly query?: Readonly<Record<string, string>>;
  /** The request body (already decoded; bytes ride as Uint8Array fields). */
  readonly body?: unknown;
  /** The idempotency key header equivalent. */
  readonly idempotencyKey?: string;
}

/** The success response: an HTTP status + the service envelope verbatim. */
export interface HttpSurfaceSuccess {
  readonly status: 200 | 201;
  readonly body: ExternalServiceEnvelope<unknown>;
}

/** The failure response: an HTTP status + the typed error record. */
export interface HttpSurfaceFailure {
  readonly status: 400 | 401 | 403 | 404 | 405 | 409 | 422 | 500;
  readonly body: { readonly error: TypedErrorRecord };
}

export type HttpSurfaceResponse = HttpSurfaceSuccess | HttpSurfaceFailure;

// ---------------------------------------------------------------------------
// The route table
// ---------------------------------------------------------------------------

/** One dispatched route. */
interface Route {
  readonly method: "GET" | "POST";
  readonly pattern: readonly string[];
  readonly service: ExternalServiceName;
}

const ROUTES: readonly Route[] = [
  { method: "GET", pattern: ["v1", "organizations"], service: "searchOrganizations" },
  { method: "GET", pattern: ["v1", "organizations", ":id"], service: "inspectOrganization" },
  {
    method: "POST",
    pattern: ["v1", "organizations", ":id", "promotion"],
    service: "promoteOrganization",
  },
  { method: "POST", pattern: ["v1", "lab-runs"], service: "launchLabRun" },
  { method: "POST", pattern: ["v1", "media"], service: "submitMedia" },
  { method: "POST", pattern: ["v1", "feeds"], service: "submitFeed" },
  { method: "GET", pattern: ["v1", "jobs", ":jobId"], service: "getJob" },
  { method: "GET", pattern: ["v1", "jobs", ":jobId", "progress"], service: "getJobProgress" },
  { method: "POST", pattern: ["v1", "jobs", ":jobId", "cancellation"], service: "cancelJob" },
  { method: "GET", pattern: ["v1", "jobs", ":jobId", "output"], service: "getOutput" },
  { method: "GET", pattern: ["v1", "jobs", ":jobId", "evidence"], service: "getEvidence" },
  { method: "GET", pattern: ["v1", "benchmarks"], service: "listBenchmarks" },
  {
    method: "GET",
    pattern: ["v1", "benchmarks", ":registrationId"],
    service: "getBenchmark",
  },
];

/** The HTTP status for a typed failure class (the transport mapping). */
export function httpStatusForFailureClass(failureClass: string): 400 | 401 | 403 | 404 | 409 | 500 {
  switch (failureClass) {
    case "validation":
      return 400;
    case "not-found":
    case "store":
      return 404;
    case "unauthorized":
    case "rights":
      return 401;
    case "restriction":
    case "policy":
      return 403;
    case "conflict":
    case "job-state":
    case "illegal-transition":
    case "lease":
      return 409;
    default:
      return 500;
  }
}

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

/** Creates the HTTP-style surface BOUND to a connection (the isolation scope). */
export function createHttpSurface(
  services: ExternalPlatformServices,
  connection: PlatformConnection,
): { handle(request: HttpSurfaceRequest): Promise<HttpSurfaceResponse> } {
  async function dispatch(
    service: ExternalServiceName,
    request: unknown,
  ): Promise<HttpSurfaceResponse> {
    try {
      const method = services[service] as (
        connection: PlatformConnection,
        request: unknown,
      ) => Promise<ExternalServiceEnvelope<unknown>>;
      const envelope = await method(connection, request);
      const status: 200 | 201 =
        service === "launchLabRun" || service === "submitMedia" || service === "submitFeed"
          ? 201
          : 200;
      return { status, body: envelope };
    } catch (error) {
      const typed = toTypedErrorRecord(error);
      return { status: httpStatusForFailureClass(typed.failureClass), body: { error: typed } };
    }
  }

  return {
    async handle(request) {
      const segments = request.path.split("/").filter((segment) => segment.length > 0);
      if (segments.length === 0 || segments[0] !== "v1") {
        return {
          status: 404,
          body: {
            error: {
              failureClass: "not-found",
              code: "platform.unsupported-version",
              message: `the path "${request.path}" is not a versioned external-platform resource (the surface serves /v1; a URL alone grants nothing)`,
              details: { path: request.path },
            },
          },
        };
      }
      // Route match (path params by position; :name segments capture).
      let matched: { route: Route; params: Record<string, string> } | null = null;
      let methodMismatch = false;
      for (const route of ROUTES) {
        if (route.pattern.length !== segments.length) continue;
        const params: Record<string, string> = {};
        let ok = true;
        for (let i = 0; i < route.pattern.length; i += 1) {
          const pattern = route.pattern[i];
          const segment = segments[i];
          if (pattern === undefined || segment === undefined) {
            ok = false;
            break;
          }
          if (pattern.startsWith(":")) {
            params[pattern.slice(1)] = decodeSegment(segment);
          } else if (pattern !== segment) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        if (route.method !== request.method) {
          methodMismatch = true;
          continue;
        }
        matched = { route, params };
        break;
      }
      if (matched === null) {
        if (methodMismatch) {
          return {
            status: 405,
            body: {
              error: {
                failureClass: "validation",
                code: "platform.method-not-allowed",
                message: `method ${request.method} is not allowed on "${request.path}"`,
                details: { path: request.path, method: request.method },
              },
            },
          };
        }
        return {
          status: 404,
          body: {
            error: {
              failureClass: "not-found",
              code: "platform.route-not-found",
              message: `no external-platform resource at "${request.path}"`,
              details: { path: request.path },
            },
          },
        };
      }

      const { route, params } = matched;
      // Build the service request from the route + query + body.
      let serviceRequest: unknown;
      switch (route.service) {
        case "searchOrganizations": {
          serviceRequest = {
            query: parseEligibilityQuery(request.query ?? {}),
            ordering: parseOrdering(request.query?.["ordering"]),
          };
          break;
        }
        case "inspectOrganization": {
          serviceRequest = { organizationId: params.id };
          break;
        }
        case "launchLabRun": {
          const body = (request.body ?? {}) as Record<string, unknown>;
          serviceRequest = {
            labRun: body["labRun"] ?? {},
            idempotencyKey: request.idempotencyKey,
          };
          break;
        }
        case "submitMedia": {
          serviceRequest = {
            ...(request.body as Record<string, unknown>),
            idempotencyKey: request.idempotencyKey,
          };
          break;
        }
        case "submitFeed": {
          serviceRequest = {
            ...(request.body as Record<string, unknown>),
            idempotencyKey: request.idempotencyKey,
          };
          break;
        }
        case "getJob":
        case "cancelJob":
        case "getOutput":
        case "getEvidence":
        case "getJobProgress": {
          serviceRequest = { jobId: params.jobId };
          break;
        }
        case "listBenchmarks": {
          serviceRequest = parseBenchmarkQuery(request.query ?? {});
          break;
        }
        case "getBenchmark": {
          serviceRequest = { registrationId: params.registrationId };
          break;
        }
        case "promoteOrganization": {
          const body = (request.body ?? {}) as Record<string, unknown>;
          serviceRequest = {
            organizationId: params.id,
            policy: body["policy"],
            additionalEvidence: body["additionalEvidence"],
            idempotencyKey: request.idempotencyKey,
          };
          break;
        }
      }
      return dispatch(route.service, serviceRequest);
    },
  };
}

// ---------------------------------------------------------------------------
// Query-parameter parsing (fail-closed, typed)
// ---------------------------------------------------------------------------

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Parses the eligibility query from query params (numbers refuse typed on garbage). */
function parseEligibilityQuery(query: Readonly<Record<string, string>>): Record<string, unknown> {
  const parsed: Record<string, unknown> = {};
  for (const key of ["domain", "task", "mode", "renderer"] as const) {
    const value = query[key];
    if (value !== undefined) parsed[key] = value;
  }
  const numberParams: readonly [string, "maxP95LatencyMs" | "maxBudgetPerRunUsd"][] = [
    ["maxP95LatencyMs", "maxP95LatencyMs"],
    ["maxBudgetPerRunUsd", "maxBudgetPerRunUsd"],
  ];
  for (const [param, field] of numberParams) {
    const value = query[param];
    if (value === undefined) continue;
    const parsedNumber = Number(value);
    if (!Number.isFinite(parsedNumber) || parsedNumber <= 0) {
      // Surface as a validation failure through the service's schema.
      parsed[field] = value;
    } else {
      parsed[field] = parsedNumber;
    }
  }
  const capabilities = query["requiredCapabilities"];
  if (capabilities !== undefined) {
    parsed.requiredCapabilities = capabilities
      .split(",")
      .map((capability) => capability.trim())
      .filter((capability) => capability.length > 0);
  }
  return parsed;
}

/** Parses the ordering param: registry-order | cost-ascending | latency-ascending | quality-descending:<axis>. */
function parseOrdering(value: string | undefined): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (value === "registry-order" || value === "cost-ascending" || value === "latency-ascending") {
    return { kind: value };
  }
  if (value.startsWith("quality-descending:")) {
    return { kind: "quality-descending", axis: value.slice("quality-descending:".length) };
  }
  return { kind: value }; // the service's schema refuses the unknown kind typed
}

/**
 * Parses the benchmark query from query params. Numbers parse when
 * parseable; garbage surfaces as the raw string so the service's schema
 * refuses it typed (fail-closed, the eligibility-query precedent).
 */
function parseBenchmarkQuery(query: Readonly<Record<string, string>>): Record<string, unknown> {
  const parsed: Record<string, unknown> = {};
  for (const key of ["sourceId", "canonicalUrl"] as const) {
    const value = query[key];
    if (value !== undefined) parsed[key] = value;
  }
  const windowStart = query["windowStartMs"];
  const windowEnd = query["windowEndMs"];
  if (windowStart !== undefined || windowEnd !== undefined) {
    parsed.overlappingWindow = {
      startMs: parseNumberOrRaw(windowStart ?? "(missing)"),
      endMs: parseNumberOrRaw(windowEnd ?? "(missing)"),
    };
  }
  const componentName = query["componentName"];
  const componentVersion = query["componentVersion"];
  if (componentName !== undefined || componentVersion !== undefined) {
    parsed.component = {
      name: componentName ?? "(missing)",
      version: componentVersion ?? "(missing)",
    };
  }
  return parsed;
}

/** Parses a query param as a finite non-negative number, or passes the raw string through. */
function parseNumberOrRaw(value: string): number | string {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : value;
}
