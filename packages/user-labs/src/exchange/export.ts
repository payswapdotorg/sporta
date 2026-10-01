/**
 * The governed organization export (REL-023).
 *
 * THE CONTRACT: `OrganizationExport` is a governed, VERSIONED and
 * CHECKSUMMED export format carrying the complete organization definition +
 * lineage + benchmark evidence summary + policy dependencies, taken from a
 * REL-022 publication. The checksum is SHA-256 over the canonical JSON of
 * everything except the checksum itself (the registry's own canonical-JSON +
 * sha256 helpers — one hashing truth across the REL program).
 *
 * DATA-ONLY BY CONSTRUCTION: the export schema is a strict zod object over
 * JSON-representable values only — there is no field in the format that can
 * carry executable code, and unknown fields are refused (not stripped) at
 * the import boundary (src/exchange/import.ts). Executable bindings are
 * resolved by the RUNTIME seam, never by export/import.
 *
 * Governance: only a `published` (non-withdrawn) publication may be exported
 * — withdrawal preserves lineage for reading but closes the exchange path.
 * Any tenant may export a published organization (the publication is the
 * public surface); the exporter's identity is recorded in the bundle.
 */
import { z } from "zod";
import {
  BenchmarkEvidenceSummarySchema,
  CapabilityBindingSchema,
  DomainCompatibilitySchema,
  OperatingProfileSchema,
  RightsRequirementSchema,
  SecurityPolicyEvidenceSummarySchema,
  TenantRefSchema,
  deepFreeze,
  requireTenantRef,
} from "../domain";
import type { TenantRef } from "../domain";
import { canonicalJson, sha256Hex } from "@sporta/organization-registry";
import type { Exchange } from "./publish";

// ---------------------------------------------------------------------------
// The export format
// ---------------------------------------------------------------------------

/** The export format version (bump = a breaking format change). */
export const EXPORT_FORMAT_VERSION = 1 as const;

/**
 * The governed export bundle. `organization.provenance.lineage` is the
 * lineage; `organization.policyDependencies` are the rights/policy
 * dependencies the importing scope must satisfy; the evidence summaries are
 * what the publication carried.
 */
export const OrganizationExportSchema = z.strictObject({
  exportFormatVersion: z.literal(EXPORT_FORMAT_VERSION),
  organization: z.strictObject({
    organizationId: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9-]*$/),
    displayName: z.string().min(1),
    domain: DomainCompatibilitySchema,
    capabilities: z.array(CapabilityBindingSchema).min(1),
    profile: OperatingProfileSchema,
    provenance: z.strictObject({
      runId: z.string().min(1),
      sourceRefs: z.array(z.string().min(1)).min(1),
      lineage: z.array(z.string().min(1)).min(1),
    }),
    policyDependencies: z.array(RightsRequirementSchema),
    /** The benchmark evidence summary (null when the publication carried none). */
    benchmarkEvidence: BenchmarkEvidenceSummarySchema.nullable(),
    /** The security/policy evidence summary (null when none was carried). */
    securityPolicyEvidence: SecurityPolicyEvidenceSummarySchema.nullable(),
  }),
  exportedBy: TenantRefSchema,
  exportedAt: z.string().min(1),
  /** SHA-256 hex over the canonical JSON of everything above (no checksum field). */
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
});

export type OrganizationExport = z.infer<typeof OrganizationExportSchema>;

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

export interface ExportGranted {
  outcome: "exported";
  bundle: OrganizationExport;
}

export interface ExportRefused {
  outcome: "refused";
  reason: "publication-withdrawn";
  publicationId: string;
  message: string;
}

export type ExportOutcome = ExportGranted | ExportRefused;

// ---------------------------------------------------------------------------
// The export operation
// ---------------------------------------------------------------------------

/**
 * The canonical preimage of an export's checksum: everything but the
 * `checksum` field, canonicalized (recursively key-sorted, undefined-stripped
 * — the registry's own canonical JSON).
 */
export function exportChecksumPreimage(bundle: Omit<OrganizationExport, "checksum">): string {
  return canonicalJson(bundle);
}

/** Computes the checksum of an export preimage. */
export async function checksumOf(preimage: string): Promise<string> {
  return sha256Hex(preimage);
}

/** Re-derives an export's checksum: `true` iff the bundle is untampered. */
export async function verifyExportChecksum(bundle: OrganizationExport): Promise<boolean> {
  const { checksum, ...rest } = bundle;
  const expected = await sha256Hex(exportChecksumPreimage(rest));
  return checksum === expected;
}

/**
 * Exports a published organization as a governed, checksummed bundle. The
 * publication must exist (typed not-found otherwise) and still be published
 * (typed refusal when withdrawn — withdrawal preserves lineage but closes
 * the exchange path).
 *
 * DETERMINISM: the bundle is a PURE function of (publication, exporter) —
 * `exportedAt` is pinned to the publication record's own timestamp, so the
 * same publication exported by the same tenant always yields the same
 * checksum (reproducible, verifiable, no hidden time source).
 */
export async function exportPublication(
  exchange: Exchange,
  caller: TenantRef,
  request: { publicationId: string },
): Promise<ExportOutcome> {
  requireTenantRef(caller);
  const publication = await exchange.getPublication(request.publicationId);
  if (publication.status === "withdrawn") {
    return {
      outcome: "refused",
      reason: "publication-withdrawn",
      publicationId: request.publicationId,
      message:
        `export refused: publication '${request.publicationId}' is withdrawn — lineage is ` +
        `preserved for reading but the exchange path is closed`,
    } satisfies ExportRefused;
  }
  const snapshot = publication.snapshot;
  const preimage = {
    exportFormatVersion: EXPORT_FORMAT_VERSION,
    organization: {
      organizationId: snapshot.organizationId,
      displayName: snapshot.displayName,
      domain: snapshot.domain,
      capabilities: snapshot.capabilities,
      profile: snapshot.profile,
      provenance: {
        runId: snapshot.provenance.runId,
        sourceRefs: snapshot.provenance.sourceRefs,
        lineage: snapshot.provenance.lineage,
      },
      policyDependencies: snapshot.provenance.rightsRequirements,
      benchmarkEvidence: snapshot.evidence.benchmark ?? null,
      securityPolicyEvidence: snapshot.evidence.securityPolicy ?? null,
    },
    exportedBy: { ...caller },
    exportedAt: publication.publishedAt,
  };
  const checksum = await sha256Hex(exportChecksumPreimage(preimage));
  const bundle = deepFreeze({ ...preimage, checksum }) as OrganizationExport;
  return { outcome: "exported", bundle } satisfies ExportGranted;
}
