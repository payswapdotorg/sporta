/**
 * The Agent Body contract (REL-004) — EVERY required field of
 * docs/contracts/agent-body-and-organization.md §Agent Body:
 *
 * bodyId; version; role; domain compatibility; input schema; output
 * schema; tools/capabilities; permissions; memory interfaces;
 * communication interface; action interface; budget; latency limits;
 * evaluator hooks; safety/policy constraints.
 *
 * Bodies are DOMAIN-GENERIC (football semantics live in the football
 * domain pack) and MODEL-INDEPENDENT: a body never imports a provider SDK
 * as domain code — models inhabit bodies through the Model Runtime seam
 * (./model-runtime). The binding is execution metadata, never domain truth.
 *
 * `validateAgentBody` enforces the contract COLLECTIVELY: one throw lists
 * every missing required field and every malformed field (`BodyContractError`
 * with `missingFields` / `invalidFields`).
 */
import { z } from "zod";
import { BodyContractError } from "../errors";
import { LabProvenanceClass } from "../provenance";

// ---------------------------------------------------------------------------
// The fifteen required fields (frozen contract order)
// ---------------------------------------------------------------------------

/** The required body fields, in the frozen contract's order. */
export const REQUIRED_BODY_FIELDS: readonly string[] = [
  "bodyId",
  "version",
  "role",
  "domainCompatibility",
  "inputSchema",
  "outputSchema",
  "tools",
  "permissions",
  "memoryInterfaces",
  "communicationInterface",
  "actionInterface",
  "budget",
  "latencyLimits",
  "evaluatorHooks",
  "safetyPolicy",
];

export interface AgentRoleDescriptor {
  roleId: string;
  description: string;
}

export interface ToolRef {
  capabilityId: string;
  version: string;
}

export interface PermissionGrant {
  permissionId: string;
  scope: string;
}

export interface MemoryInterfaceRef {
  storeId: string;
  access: "read" | "write" | "read-write";
}

export interface CommunicationChannelRef {
  channelId: string;
  direction: "subscribe" | "publish" | "both";
}

export interface AgentBudgetSpec {
  maxCallsPerRun: number;
  maxCostUsdPerRun: number;
}

export interface AgentLatencyLimits {
  softMs: number;
  hardMs: number;
}

export interface EvaluatorHookRef {
  evaluatorId: string;
  version: string;
}

export interface SafetyPolicyConstraints {
  policyIds: readonly string[];
  hardRules: readonly string[];
}

/** The Agent Body definition — the stable executable role contract. */
export interface AgentBodyDefinition {
  bodyId: string;
  version: string;
  role: AgentRoleDescriptor;
  domainCompatibility: { domainPackIds: readonly string[]; notes: string };
  /** Runtime-checked zod schema for body inputs. */
  inputSchema: z.ZodType<unknown, unknown>;
  /** Runtime-checked zod schema for body outputs. */
  outputSchema: z.ZodType<unknown, unknown>;
  tools: readonly ToolRef[];
  permissions: readonly PermissionGrant[];
  memoryInterfaces: readonly MemoryInterfaceRef[];
  communicationInterface: { channels: readonly CommunicationChannelRef[] };
  actionInterface: { allowedActionIds: readonly string[] };
  budget: AgentBudgetSpec;
  latencyLimits: AgentLatencyLimits;
  evaluatorHooks: readonly EvaluatorHookRef[];
  safetyPolicy: SafetyPolicyConstraints;
}

// ---------------------------------------------------------------------------
// The v0 lab body I/O contract (generic; used by the generalist body)
// ---------------------------------------------------------------------------

/** What a body sees on one invocation (generic observation stream + shared memory). */
export const LabBodyInputSchema = z.object({
  runId: z.string().min(1),
  tickIndex: z.number().int().min(0),
  clockMs: z.number().int().min(0),
  /**
   * The domain's period/phase label (REL-032): football runs 1|2 halves,
   * basketball 1..4 quarters — the generic body contract carries ANY
   * positive integer; the DOMAIN PACK defines its semantics (the
   * DomainSimulationProfile's `periodOf` supplies the value). Widened from
   * the v0 football literal union `1|2` when the seam generalized — every
   * previously-valid football input (1, 2) remains valid.
   */
  period: z.number().int().min(1),
  observations: z.array(
    z.object({
      observationId: z.string().min(1),
      kindId: z.string().min(1),
      tickIndex: z.number().int().min(0),
      clockMs: z.number().int().min(0),
      provenanceClass: LabProvenanceClass,
      confidence: z.number().min(0).max(1).optional(),
      /** The pack-specific payload, opaque to generic body code (kept as-is). */
      payload: z.unknown().optional(),
    }),
  ),
  sharedMemory: z.record(z.string(), z.unknown()),
});
export type LabBodyInput = z.infer<typeof LabBodyInputSchema>;

export const EmitCanonicalEventActionSchema = z.object({
  actionId: z.literal("emit-canonical-event"),
  claimId: z.string().min(1),
  eventKindId: z.string().min(1),
  evidenceRef: z.string().min(1),
  clockMs: z.number().int().min(0),
  provenanceClass: LabProvenanceClass.optional(),
});

export const EmitIdentityAssertionActionSchema = z.object({
  actionId: z.literal("emit-identity-assertion"),
  claimId: z.string().min(1),
  entityId: z.string().min(1),
  presentedAs: z.enum(["fact", "inference"]),
  basis: z.enum(["observed", "inferred"]),
  evidenceRef: z.string().min(1),
  provenanceClass: LabProvenanceClass.optional(),
});

export const RequestRenderActionSchema = z.object({
  actionId: z.literal("request-render"),
  claimId: z.string().min(1),
  renderTargetId: z.string().min(1),
  rightsBasis: z.string().min(1).nullable(),
  clockMs: z.number().int().min(0),
  artifactLineage: z.array(z.string()).optional(),
  provenanceClass: LabProvenanceClass.optional(),
});

export const EscalateUncertaintyActionSchema = z.object({
  actionId: z.literal("escalate-uncertainty"),
  note: z.string(),
  clockMs: z.number().int().min(0),
});

export const LabBodyActionSchema = z.discriminatedUnion("actionId", [
  EmitCanonicalEventActionSchema,
  EmitIdentityAssertionActionSchema,
  RequestRenderActionSchema,
  EscalateUncertaintyActionSchema,
]);
export type LabBodyAction = z.infer<typeof LabBodyActionSchema>;

/** What a body returns per invocation. */
export const LabBodyOutputSchema = z.object({
  actions: z.array(LabBodyActionSchema),
  sharedMemoryWrite: z.record(z.string(), z.unknown()).optional(),
});
export type LabBodyOutput = z.infer<typeof LabBodyOutputSchema>;

// ---------------------------------------------------------------------------
// Validation — collective, typed, in words
// ---------------------------------------------------------------------------

const BodyMetaShapeSchema = z.object({
  bodyId: z.string().min(1),
  version: z.string().min(1),
  role: z.object({ roleId: z.string().min(1), description: z.string() }),
  domainCompatibility: z.object({
    domainPackIds: z.array(z.string().min(1)).min(1),
    notes: z.string(),
  }),
  tools: z.array(z.object({ capabilityId: z.string().min(1), version: z.string().min(1) })),
  permissions: z.array(z.object({ permissionId: z.string().min(1), scope: z.string() })),
  memoryInterfaces: z.array(
    z.object({
      storeId: z.string().min(1),
      access: z.enum(["read", "write", "read-write"]),
    }),
  ),
  communicationInterface: z.object({
    channels: z.array(
      z.object({
        channelId: z.string().min(1),
        direction: z.enum(["subscribe", "publish", "both"]),
      }),
    ),
  }),
  actionInterface: z.object({ allowedActionIds: z.array(z.string().min(1)) }),
  budget: z.object({
    maxCallsPerRun: z.number().int().min(1),
    maxCostUsdPerRun: z.number().min(0),
  }),
  latencyLimits: z.object({
    softMs: z.number().min(0),
    hardMs: z.number().min(0),
  }),
  evaluatorHooks: z.array(z.object({ evaluatorId: z.string().min(1), version: z.string().min(1) })),
  safetyPolicy: z.object({
    policyIds: z.array(z.string()),
    hardRules: z.array(z.string()),
  }),
});

function looksLikeZodSchema(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)["safeParse"] === "function"
  );
}

/**
 * Validate an Agent Body definition against the frozen contract. Throws
 * `BodyContractError` listing EVERY missing required field and EVERY
 * malformed field; returns the definition (typed) when clean.
 */
export function validateAgentBody(candidate: unknown): AgentBodyDefinition {
  if (typeof candidate !== "object" || candidate === null) {
    throw new BodyContractError(
      "agent body definition must be an object",
      [{ found: typeof candidate }],
      ["<all>"],
      [],
    );
  }
  const record = candidate as Record<string, unknown>;
  const missing = REQUIRED_BODY_FIELDS.filter((field) => record[field] === undefined);
  const invalid: string[] = [];
  const parsedMeta = BodyMetaShapeSchema.safeParse(record);
  if (!parsedMeta.success) {
    for (const issue of parsedMeta.error.issues) {
      const root = issue.path[0];
      if (typeof root === "string" && !missing.includes(root) && !invalid.includes(root)) {
        invalid.push(root);
      }
    }
  }
  for (const schemaField of ["inputSchema", "outputSchema"] as const) {
    if (record[schemaField] === undefined) continue; // already reported missing
    if (!looksLikeZodSchema(record[schemaField]) && !invalid.includes(schemaField)) {
      invalid.push(schemaField);
    }
  }
  if (missing.length > 0 || invalid.length > 0) {
    throw new BodyContractError(
      `agent body definition violates the frozen contract: ${missing.length} missing, ` +
        `${invalid.length} malformed field(s)`,
      [],
      missing,
      invalid,
    );
  }
  return candidate as AgentBodyDefinition;
}

// ---------------------------------------------------------------------------
// The generalist body — the mandatory single-agent baseline's inhabitant
// ---------------------------------------------------------------------------

/**
 * The generalist Agent Body: ONE body that ingests the whole observation
 * stream and emits every decision. This is the inhabitant of the mandatory
 * generalist single-agent organization baseline
 * (`createGeneralistOrganization` in ./organization).
 */
export function createGeneralistBody(options: {
  domainPackId: string;
  evaluator: { evaluatorId: string; version: string };
  hardRuleIds: readonly string[];
}): AgentBodyDefinition {
  return {
    bodyId: "generalist-1",
    version: "0.1.0",
    role: {
      roleId: "generalist",
      description:
        "A single body that ingests every observation kind and emits every decision " +
        "(events, identities, render requests, escalations).",
    },
    domainCompatibility: {
      domainPackIds: [options.domainPackId],
      notes: "v0 generalist: consumes the generic observation stream of the declared pack.",
    },
    inputSchema: LabBodyInputSchema,
    outputSchema: LabBodyOutputSchema,
    tools: [
      { capabilityId: "perception.broadcast-frame-ingest", version: "0.1.0" },
      { capabilityId: "perception.tracking-ingest", version: "0.1.0" },
      { capabilityId: "event.fusion", version: "0.1.0" },
      { capabilityId: "identity.resolution", version: "0.1.0" },
      { capabilityId: "render.tactical", version: "0.1.0" },
    ],
    permissions: [{ permissionId: "lab.simulate", scope: "lab-run" }],
    memoryInterfaces: [{ storeId: "org-shared", access: "read-write" }],
    communicationInterface: {
      channels: [{ channelId: "org-bus", direction: "both" }],
    },
    actionInterface: {
      allowedActionIds: [
        "emit-canonical-event",
        "emit-identity-assertion",
        "request-render",
        "escalate-uncertainty",
      ],
    },
    budget: { maxCallsPerRun: 10_000, maxCostUsdPerRun: 5 },
    latencyLimits: { softMs: 500, hardMs: 2_000 },
    evaluatorHooks: [
      { evaluatorId: options.evaluator.evaluatorId, version: options.evaluator.version },
    ],
    safetyPolicy: {
      policyIds: ["adr-013-hard-gates"],
      // The pack's hard invalidity rules, declared as BINDING on this body.
      hardRules: [...options.hardRuleIds],
    },
  };
}
