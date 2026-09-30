/**
 * The MCP tool surface (REL-015) — the contract's example tool families as
 * a 1:1 mapping onto the SAME application services the HTTP surface uses.
 *
 * THE PARITY RULE (the contract's core): "Every exposed MCP tool maps to a
 * versioned application service. MCP is an interaction protocol, not
 * business logic." The tool layer here VALIDATES NOTHING the service does
 * not already validate, DECIDES nothing, and STORES nothing: `callTool`
 * looks up the tool, forwards the input + idempotency key to the service
 * with the connection, and wraps the returned envelope. The parity tests
 * deep-compare this path against the HTTP path per family.
 *
 * Tool families (the contract's own list):
 * search_organizations, inspect_organization, launch_lab, submit_video,
 * submit_feed, get_job, cancel_job, get_output, get_evidence,
 * promote_organization — each carrying the service name + version it maps
 * to, plus a human-facing description and input description (the shape an
 * MCP server would advertise in tools/list).
 */
import type { PlatformConnection } from "./domain";
import type { ExternalServiceEnvelope, ExternalServiceName } from "./domain";
import { EXTERNAL_SERVICE_VERSION } from "./domain";
import type { ExternalPlatformServices } from "./services";
import { toTypedErrorRecord } from "./errors";
import type { TypedErrorRecord } from "./errors";

// ---------------------------------------------------------------------------
// The tool vocabulary
// ---------------------------------------------------------------------------

/** One advertised MCP tool: a 1:1 mapping onto a versioned application service. */
export interface McpToolDefinition {
  /** The tool name (the contract's family list). */
  readonly name: string;
  /** The application service this tool maps onto (1:1). */
  readonly service: ExternalServiceName;
  /** The version of the service surface. */
  readonly version: typeof EXTERNAL_SERVICE_VERSION;
  /** The human-facing description (what an MCP client shows). */
  readonly description: string;
  /** The input description (field names the service validates). */
  readonly input: readonly string[];
}

/** The contract's ten tool families, 1:1 onto the ten services. */
export const MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: "search_organizations",
    service: "searchOrganizations",
    version: EXTERNAL_SERVICE_VERSION,
    description:
      "Discover eligible organizations from the Sporta catalog, each with visible evidence (benchmark, robustness, cost/latency, provenance/rights, version).",
    input: ["query (domain/task/mode/renderer/latency/budget/capabilities)", "ordering?"],
  },
  {
    name: "inspect_organization",
    service: "inspectOrganization",
    version: EXTERNAL_SERVICE_VERSION,
    description: "Inspect one organization's visible evidence and operating profile.",
    input: ["organizationId"],
  },
  {
    name: "launch_lab",
    service: "launchLabRun",
    version: EXTERNAL_SERVICE_VERSION,
    description:
      "Request a lab run. Returns a durable job identifier immediately; poll get_job for status.",
    input: ["labRun (domain/task/organizationId?/budgetUsd?/maxDurationMs?/configuration?)"],
  },
  {
    name: "submit_video",
    service: "submitMedia",
    version: EXTERNAL_SERVICE_VERSION,
    description:
      "Submit media for processing: bytes + declaredBasis + metadata (the upload path), or a source reference (metadata only). Optionally select an organization to process with.",
    input: [
      "bytes? + declaredBasis? + metadata?",
      "reference?",
      "organizationId?",
      "idempotencyKey?",
    ],
  },
  {
    name: "submit_feed",
    service: "submitFeed",
    version: EXTERNAL_SERVICE_VERSION,
    description:
      "Submit a feed for periodic/streamed processing: items (metadata + optional bytes + declared basis) + organization selection (explicit id or query+ordering). Returns the durable feed job id.",
    input: [
      "items[] (metadata, bytes?, declaredBasis?)",
      "organization (organizationId | query + ordering?)",
      "requireTransformation?",
      "idempotencyKey?",
    ],
  },
  {
    name: "get_job",
    service: "getJob",
    version: EXTERNAL_SERVICE_VERSION,
    description: "Poll a job's canonical status (state, attempts, checkpoints, artifacts).",
    input: ["jobId"],
  },
  {
    name: "cancel_job",
    service: "cancelJob",
    version: EXTERNAL_SERVICE_VERSION,
    description: "Request cooperative cancellation of a job (honored at the next checkpoint).",
    input: ["jobId"],
  },
  {
    name: "get_output",
    service: "getOutput",
    version: EXTERNAL_SERVICE_VERSION,
    description:
      "Retrieve the validated output artifact of a COMPLETED job (refuses typed before completion).",
    input: ["jobId"],
  },
  {
    name: "get_evidence",
    service: "getEvidence",
    version: EXTERNAL_SERVICE_VERSION,
    description: "Retrieve the evidence bundle (source lineage + quality gate) of a COMPLETED job.",
    input: ["jobId"],
  },
  {
    name: "promote_organization",
    service: "promoteOrganization",
    version: EXTERNAL_SERVICE_VERSION,
    description:
      "Request an organization's promotion through the automated evidence gates under the platform's named policy, and import a selectable organization into the integration scope.",
    input: ["organizationId", "policy (the versioned promotion policy)", "idempotencyKey?"],
  },
];

// ---------------------------------------------------------------------------
// The call shapes
// ---------------------------------------------------------------------------

/** An MCP tool call request. */
export interface McpToolCallRequest {
  readonly tool: string;
  /** The tool input (maps verbatim onto the service request). */
  readonly input: unknown;
  /** The idempotency key (forwarded for mutating tools). */
  readonly idempotencyKey?: string;
}

/** A successful tool call: the SAME envelope the HTTP path returns. */
export interface McpToolCallSuccess {
  readonly tool: string;
  readonly service: ExternalServiceName;
  readonly version: typeof EXTERNAL_SERVICE_VERSION;
  readonly isError: false;
  readonly envelope: ExternalServiceEnvelope<unknown>;
}

/** A failed tool call: the SAME typed error record the HTTP path returns. */
export interface McpToolCallFailure {
  readonly tool: string;
  readonly isError: true;
  readonly error: TypedErrorRecord;
}

export type McpToolCallOutcome = McpToolCallSuccess | McpToolCallFailure;

/** The MCP tool surface: list + call, both pure dispatch. */
export interface McpToolSurface {
  listTools(): readonly McpToolDefinition[];
  callTool(
    connection: PlatformConnection,
    request: McpToolCallRequest,
  ): Promise<McpToolCallOutcome>;
}

/** Creates the MCP tool surface over the SAME services the HTTP surface uses. */
export function createMcpToolSurface(services: ExternalPlatformServices): McpToolSurface {
  return {
    listTools() {
      return MCP_TOOLS;
    },

    async callTool(connection, request) {
      const tool = MCP_TOOLS.find((candidate) => candidate.name === request.tool);
      if (tool === undefined) {
        return {
          tool: request.tool,
          isError: true,
          error: {
            failureClass: "not-found",
            code: "platform.tool-not-found",
            message: `no MCP tool named "${request.tool}" (the surface exposes exactly the contract's ten families)`,
            details: { tool: request.tool },
          },
        };
      }
      // NO LOGIC LIVES HERE: the input (plus the idempotency key, when the
      // caller set one) maps verbatim onto the service request.
      const base =
        typeof request.input === "object" && request.input !== null
          ? (request.input as Record<string, unknown>)
          : {};
      const serviceRequest =
        request.idempotencyKey === undefined
          ? request.input
          : { ...base, idempotencyKey: request.idempotencyKey };
      try {
        const method = services[tool.service] as (
          connection: PlatformConnection,
          request: unknown,
        ) => Promise<ExternalServiceEnvelope<unknown>>;
        const envelope = await method(connection, serviceRequest);
        return {
          tool: tool.name,
          service: tool.service,
          version: EXTERNAL_SERVICE_VERSION,
          isError: false,
          envelope,
        };
      } catch (error) {
        return { tool: tool.name, isError: true, error: toTypedErrorRecord(error) };
      }
    },
  };
}
