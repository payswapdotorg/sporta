/**
 * The governed organization import (REL-023).
 *
 * THE CONTRACT: import an exported organization into a SCOPE with an
 * eligibility re-check AT IMPORT TIME — rights/policy dependencies
 * satisfiable, security/policy pass — producing a REGISTRY-COMPATIBLE
 * record via the local seam. NO REGISTRY MUTATION ever happens from this
 * package: the imported record is returned to the caller, and registering it
 * is the registry's own pipeline (the product submits it; the same gates as
 * a hand-engineered organization apply — the promotion invariant).
 *
 * THE DATA-ONLY LAW (tested explicitly): import NEVER injects untrusted
 * organization code into any production runtime — the import surface is
 * data-only (definitions/records); executable bindings are resolved by the
 * RUNTIME seam, not by the import. Enforcement, in order:
 *
 * 1. The bundle is parsed by a STRICT zod schema over JSON-representable
 *    values: unknown fields (an executable-binding stowaway, for instance)
 *    are REFUSED, not stripped, and function-valued fields fail their type
 *    checks — typed `invalid-bundle` refusal.
 * 2. The checksum is re-derived from the canonical preimage — any mutation
 *    of definition, lineage, evidence or dependencies after export is a
 *    typed `checksum-mismatch` refusal.
 * 3. Every rights/policy dependency must be satisfied by the importing
 *    scope's declarations — typed `unsatisfiable-dependency` refusal naming
 *    each missing dependency.
 * 4. The security/policy evidence must be PRESENT and PASSED — a missing or
 *    failed check is a typed `security-policy-failed` refusal (fail closed:
 *    no evidence is no pass).
 *
 * Registry compatibility is proven, not asserted: the assembled record is
 * validated against `@sporta/organization-registry`'s own exported
 * `NewOrganizationInputSchema` (a read-only use — this package never touches
 * the registry's storage). A record the registry would reject refuses with
 * typed `registry-incompatible` (defense in depth; it should be unreachable).
 */
import { z } from "zod";
import { NewOrganizationInputSchema, sha256Hex } from "@sporta/organization-registry";
import type { NewOrganizationInput } from "@sporta/organization-registry";
import type { TenantRef } from "../domain";
import { TenantRefSchema, requireTenantRef } from "../domain";
import { toIsoUtc } from "../clock";
import { createUserLabsDefaultClock } from "../clock";
import { LabValidationError } from "../errors";
import { OrganizationExportSchema, exportChecksumPreimage } from "./export";
import type { OrganizationExport } from "./export";

// ---------------------------------------------------------------------------
// The importing scope
// ---------------------------------------------------------------------------

/**
 * The integration scope an organization is imported into: the importing
 * tenant plus the rights/policy requirement ids it can SATISFY at import
 * time (licenses, rights bases, policy acceptances it actually holds).
 */
export const ImportScopeSchema = z.strictObject({
  tenant: TenantRefSchema,
  satisfiedRightsRequirements: z.array(z.string().min(1)),
});

export type ImportScope = z.infer<typeof ImportScopeSchema>;

// ---------------------------------------------------------------------------
// Outcomes (typed refusal records — never thrown)
// ---------------------------------------------------------------------------

export type ImportRefusalReason =
  | "invalid-bundle"
  | "checksum-mismatch"
  | "unsatisfiable-dependency"
  | "security-policy-failed"
  | "registry-incompatible";

export interface ImportRefused {
  outcome: "refused";
  reason: ImportRefusalReason;
  message: string;
  /** Zod issue list (invalid-bundle / registry-incompatible). */
  issues?: unknown[];
  /** Unsatisfiable requirement ids (unsatisfiable-dependency). */
  missing?: string[];
}

export interface ImportGranted {
  outcome: "imported";
  /**
   * The registry-compatible record — DATA ONLY. Registration goes through
   * the registry's own pipeline (never this package); executable bindings
   * are resolved by the runtime seam, not by anything here.
   */
  record: NewOrganizationInput;
  importedBy: TenantRef;
  importedAt: string;
  exportChecksum: string;
}

export type ImportOutcome = ImportGranted | ImportRefused;

/** Options for {@link importOrganization}. */
export interface ImportOptions {
  /** Injected clock for the import stamp (deterministic default). */
  clock?: () => number;
}

// ---------------------------------------------------------------------------
// The data-only law's reusable checker
// ---------------------------------------------------------------------------

/**
 * Lists the paths of every function-valued property reachable in `value`
 * (own enumerable properties, arrays included). The data-only import surface
 * must always yield an empty list; the product can run the same check on any
 * other import surface it adds.
 */
export function findExecutableValues(value: unknown): string[] {
  const found: string[] = [];
  walk(value, "$", found, new Set());
  return found;
}

function walk(value: unknown, path: string, found: string[], seen: Set<unknown>): void {
  if (typeof value === "function") {
    found.push(path);
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      walk(item, `${path}[${index}]`, found, seen);
    }
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    walk(item, `${path}.${key}`, found, seen);
  }
}

// ---------------------------------------------------------------------------
// The import operation
// ---------------------------------------------------------------------------

function zodIssues(error: z.ZodError): unknown[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

/**
 * Imports an exported organization into a scope. The scope is CALLER input
 * (malformed scope = typed validation error at the boundary); the BUNDLE is
 * untrusted external data — every problem with it is a typed refusal record,
 * never a throw, never a silent strip.
 */
export async function importOrganization(
  scope: ImportScope,
  bundle: unknown,
  options: ImportOptions = {},
): Promise<ImportOutcome> {
  const parsedScope = ImportScopeSchema.safeParse(scope);
  if (!parsedScope.success) {
    throw new LabValidationError("import scope is invalid", zodIssues(parsedScope.error));
  }
  requireTenantRef(parsedScope.data.tenant);
  const clock = options.clock ?? createUserLabsDefaultClock();

  // 1. THE DATA-ONLY LAW, enforced at the schema: strict shape over
  //    JSON-representable values — unknown fields refuse, functions fail.
  const parsedBundle = OrganizationExportSchema.safeParse(bundle);
  if (!parsedBundle.success) {
    return {
      outcome: "refused",
      reason: "invalid-bundle",
      message:
        "import refused: the export bundle is not a valid governed export — the import surface " +
        "is data-only and refuses anything it does not declare",
      issues: zodIssues(parsedBundle.error),
    } satisfies ImportRefused;
  }
  const value: OrganizationExport = parsedBundle.data;

  // 2. Tamper-evidence: the checksum re-derives from the canonical preimage.
  const { checksum, ...preimage } = value;
  const expected = await sha256Hex(exportChecksumPreimage(preimage));
  if (checksum !== expected) {
    return {
      outcome: "refused",
      reason: "checksum-mismatch",
      message:
        `import refused: export checksum mismatch for organization ` +
        `'${value.organization.organizationId}' — the bundle was mutated after export`,
    } satisfies ImportRefused;
  }

  // 3. Eligibility re-check, part one: every rights/policy dependency must
  //    be satisfiable by the importing scope's declarations.
  const held = new Set(parsedScope.data.satisfiedRightsRequirements);
  const missing = value.organization.policyDependencies
    .filter((dependency) => !held.has(dependency.requirementId))
    .map((dependency) => dependency.requirementId);
  if (missing.length > 0) {
    const described = value.organization.policyDependencies
      .filter((dependency) => missing.includes(dependency.requirementId))
      .map((dependency) => `${dependency.requirementId} (${dependency.description})`)
      .join("; ");
    return {
      outcome: "refused",
      reason: "unsatisfiable-dependency",
      message:
        `import refused: the importing scope cannot satisfy ${missing.length} rights/policy ` +
        `dependency(ies): ${described}`,
      missing,
    } satisfies ImportRefused;
  }

  // 4. Eligibility re-check, part two: the security/policy evidence must be
  //    present and passed — no evidence is no pass (fail closed).
  const security = value.organization.securityPolicyEvidence;
  if (security === null) {
    return {
      outcome: "refused",
      reason: "security-policy-failed",
      message:
        `import refused: the export carries no security/policy evidence for organization ` +
        `'${value.organization.organizationId}' — absence of evidence is not a pass`,
    } satisfies ImportRefused;
  }
  const failedChecks = security.checks.filter((check) => !check.passed).map((c) => c.checkId);
  if (failedChecks.length > 0) {
    return {
      outcome: "refused",
      reason: "security-policy-failed",
      message:
        `import refused: security/policy evidence for organization ` +
        `'${value.organization.organizationId}' has failing check(s): ${failedChecks.join(", ")}`,
    } satisfies ImportRefused;
  }

  // 5. Registry-compatible record, validated by the registry's OWN schema
  //    (read-only use; this package registers nothing anywhere).
  const record: NewOrganizationInput = {
    organizationId: value.organization.organizationId,
    displayName: value.organization.displayName,
    domain: value.organization.domain,
    capabilities: value.organization.capabilities,
    profile: value.organization.profile,
    provenance: {
      owner: value.exportedBy.tenantId,
      lineage: value.organization.provenance.lineage,
      rightsRequirements: value.organization.policyDependencies,
      createdFrom: { labRunId: value.organization.provenance.runId },
    },
    evidence: {
      ...(value.organization.benchmarkEvidence !== null
        ? { benchmark: value.organization.benchmarkEvidence }
        : {}),
      securityPolicy: security,
    },
  };
  const parsedRecord = NewOrganizationInputSchema.safeParse(record);
  if (!parsedRecord.success) {
    return {
      outcome: "refused",
      reason: "registry-incompatible",
      message:
        `import refused: the assembled record for organization ` +
        `'${value.organization.organizationId}' does not satisfy the organization registry's ` +
        `registration schema`,
      issues: zodIssues(parsedRecord.error),
    } satisfies ImportRefused;
  }

  return {
    outcome: "imported",
    record: parsedRecord.data,
    importedBy: { ...parsedScope.data.tenant },
    importedAt: toIsoUtc(clock()),
    exportChecksum: checksum,
  } satisfies ImportGranted;
}
