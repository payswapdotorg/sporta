/**
 * Organization publishing (REL-022): the governed bridge from a PRIVATE lab
 * candidate to a PUBLIC, immutable publication snapshot.
 *
 * THE CONTRACT (docs/contracts/organization-registry-and-promotion.md §User
 * labs / §Retirement; ADR-013 #11 "Lab outputs are isolated until they pass
 * promotion gates"):
 *
 * - A `PublishRequest` turns a lab candidate into a governed publication
 *   record ONLY when the candidate is COMPLETE (required contract fields),
 *   VERSIONED and LINEAGE-COMPLETE. A candidate missing required fields or
 *   carrying incomplete provenance is REFUSED with a typed error listing
 *   every missing piece — fail closed, useful state (the gaps are the TODO
 *   list; the candidate stays private and revisable).
 * - The publication is an IMMUTABLE snapshot: later candidate revisions never
 *   mutate an existing publication (publish again to publish the new version).
 * - WITHDRAWAL does NOT delete lineage — it mirrors the registry's retirement
 *   rule: a withdrawn publication stays fully readable (snapshot + provenance
 *   intact), it is only excluded from the active list, from export and from
 *   promotion requests.
 * - The publish request RECORDS the disclosure (the human-visible text) and
 *   the incentive policy version it was made under — the REL-021 pairing.
 * - The publication is the ONLY cross-tenant-readable surface in this
 *   package: anyone may read a publication; only its publisher may withdraw
 *   it (typed isolation refusal otherwise).
 *
 * Constitution: all exchange timestamps come from the STORE's injected clock
 * (the append/mark seams stamp them — the registry's own pattern); no wall
 * time, no randomness.
 */
import { z } from "zod";
import type {
  CapabilityBinding,
  CandidateEvidence,
  DomainCompatibility,
  LabCandidate,
  OperatingProfile,
  RightsRequirement,
  TenantRef,
} from "../domain";
import {
  CandidateDefinitionSchema,
  CandidateEvidenceSchema,
  deepFreeze,
  requireTenantRef,
} from "../domain";
import { createUserLabsDefaultClock, createSequentialIdSource, toIsoUtc } from "../clock";
import type { IdSource } from "../clock";
import {
  LabConflictError,
  LabIsolationError,
  LabNotFoundError,
  LabValidationError,
} from "../errors";
import type { UserLabs } from "../lab/store";
import type { PromotionRequestRecord } from "../lab/promotion";

// ---------------------------------------------------------------------------
// The publication record
// ---------------------------------------------------------------------------

export const PUBLICATION_STATUSES = ["published", "withdrawn"] as const;

export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

/** The disclosure recorded with the publish request (REL-021 pairing). */
export interface PublicationDisclosure {
  /** The incentive policy version the disclosure was displayed under. */
  policyVersion: number;
  /** The human-visible disclosure text shown to the user. */
  text: string;
}

const PublicationDisclosureSchema = z.strictObject({
  policyVersion: z.number().int().min(1),
  text: z.string().min(1),
});

/** Where the published snapshot came from. */
export interface PublicationSource {
  labId: string;
  candidateId: string;
  candidateVersion: number;
}

/** The immutable, COMPLETE snapshot of the candidate at publication time. */
export interface PublicationSnapshot {
  organizationId: string;
  displayName: string;
  domain: DomainCompatibility;
  capabilities: CapabilityBinding[];
  profile: OperatingProfile;
  evidence: CandidateEvidence;
  provenance: {
    runId: string;
    sourceRefs: string[];
    lineage: string[];
    rightsRequirements: RightsRequirement[];
  };
}

/** A governed publication of a lab candidate (REL-022). */
export interface PublishedOrganization {
  publicationId: string;
  status: PublicationStatus;
  publishedBy: TenantRef;
  publishedAt: string;
  withdrawnAt: string | null;
  disclosure: PublicationDisclosure;
  source: PublicationSource;
  snapshot: PublicationSnapshot;
}

/** Input for the exchange store's publication append seam (the store stamps time + id). */
export interface NewPublication {
  publishedBy: TenantRef;
  disclosure: PublicationDisclosure;
  source: PublicationSource;
  snapshot: PublicationSnapshot;
}

// ---------------------------------------------------------------------------
// Publication outcomes (typed refusal records — never thrown)
// ---------------------------------------------------------------------------

export interface PublicationGranted {
  outcome: "published";
  publication: PublishedOrganization;
}

export interface PublicationRefused {
  outcome: "refused";
  reason: "incomplete-candidate";
  candidateId: string;
  /** Every missing piece, in words — the useful state REL-022 demands. */
  gaps: string[];
  message: string;
}

export type PublicationOutcome = PublicationGranted | PublicationRefused;

/** The publish request (candidate + the disclosure it publishes under). */
export interface PublishRequest {
  candidateId: string;
  disclosure: PublicationDisclosure;
}

const PublishRequestSchema = z.strictObject({
  candidateId: z.string().min(1),
  disclosure: PublicationDisclosureSchema,
});

// ---------------------------------------------------------------------------
// The exchange store
// ---------------------------------------------------------------------------

/** Options for {@link createExchange}. */
export interface ExchangeOptions {
  /** Injected clock (deterministic default — never `Date.now`). */
  clock?: () => number;
  publicationIds?: IdSource;
}

/**
 * The exchange store: publications + promotion requests. Public reads
 * (`getPublication` / `listPublications`) are the ONLY cross-tenant surface;
 * the append/mark seams are the operation layer's (requestPublication,
 * withdrawPublication, requestPublicationPromotion, ...) — the registry's
 * `appendLifecycleRefusal` precedent. The seams stamp every timestamp from
 * the store's injected clock.
 */
export interface Exchange {
  /** The publication (public read — the cross-tenant surface). */
  getPublication(publicationId: string): Promise<PublishedOrganization>;
  /** Every publication, withdrawn included (lineage preservation). */
  listPublications(): Promise<PublishedOrganization[]>;
  /** Only `published` publications (the active exchange surface). */
  listActivePublications(): Promise<PublishedOrganization[]>;
  /** Operation seam: appends a publication (the store stamps id + time). */
  appendPublication(input: NewPublication): Promise<PublishedOrganization>;
  /** Operation seam: flips status to `withdrawn` (never deletes anything). */
  markPublicationWithdrawn(publicationId: string): Promise<PublishedOrganization>;
  /** Operation seam: appends a promotion request (the store stamps id + time). */
  appendPromotionRequest(input: {
    publicationId: string;
    candidateId: string;
    labId: string;
    requestedBy: TenantRef;
  }): Promise<PromotionRequestRecord>;
  /** Operation seam: every promotion request (callers filter their own). */
  promotionRequests(): Promise<readonly PromotionRequestRecord[]>;
  /** Operation seam: flips a promotion request to `withdrawn`. */
  markPromotionRequestWithdrawn(requestId: string): Promise<PromotionRequestRecord>;
}

/** Builds the in-memory exchange store. */
export function createExchange(options: ExchangeOptions = {}): Exchange {
  const clock = options.clock ?? createUserLabsDefaultClock();
  const publicationIds = options.publicationIds ?? createSequentialIdSource("pub");
  const requestIds = createSequentialIdSource("preq");
  const publications = new Map<string, PublishedOrganization>();
  const requests: PromotionRequestRecord[] = [];

  function publicationOf(publicationId: string): PublishedOrganization {
    const publication = publications.get(publicationId);
    if (publication === undefined) {
      throw new LabNotFoundError("publication not found", { publicationId });
    }
    return publication;
  }

  return {
    async getPublication(publicationId) {
      return publicationOf(publicationId);
    },

    async listPublications() {
      return [...publications.values()];
    },

    async listActivePublications() {
      return [...publications.values()].filter((p) => p.status === "published");
    },

    async appendPublication(input) {
      const now = toIsoUtc(clock());
      const publication = deepFreeze({
        publicationId: publicationIds.nextId(),
        status: "published",
        publishedBy: { ...input.publishedBy },
        publishedAt: now,
        withdrawnAt: null,
        disclosure: { ...input.disclosure },
        source: { ...input.source },
        snapshot: input.snapshot,
      } satisfies PublishedOrganization);
      publications.set(publication.publicationId, publication);
      return publication;
    },

    async markPublicationWithdrawn(publicationId) {
      const current = publicationOf(publicationId);
      if (current.status === "withdrawn") {
        throw new LabConflictError("publication is already withdrawn", { publicationId });
      }
      const next = deepFreeze({
        ...current,
        status: "withdrawn",
        withdrawnAt: toIsoUtc(clock()),
      } satisfies PublishedOrganization);
      publications.set(publicationId, next);
      return next;
    },

    async appendPromotionRequest(input) {
      const request = deepFreeze({
        requestId: requestIds.nextId(),
        publicationId: input.publicationId,
        candidateId: input.candidateId,
        labId: input.labId,
        requestedBy: { ...input.requestedBy },
        requestedAt: toIsoUtc(clock()),
        status: "requested",
        withdrawnAt: null,
      } satisfies PromotionRequestRecord);
      requests.push(request);
      return request;
    },

    async promotionRequests() {
      return [...requests];
    },

    async markPromotionRequestWithdrawn(requestId) {
      const found = requests.find((r) => r.requestId === requestId);
      if (found === undefined) {
        throw new LabNotFoundError("promotion request not found", { requestId });
      }
      const index = requests.indexOf(found);
      const next = deepFreeze({
        ...found,
        status: "withdrawn",
        withdrawnAt: toIsoUtc(clock()),
      } satisfies PromotionRequestRecord);
      requests[index] = next;
      return next;
    },
  };
}

// ---------------------------------------------------------------------------
// The publication gate (fail closed, useful state)
// ---------------------------------------------------------------------------

/**
 * Every piece a candidate must carry before it may publish, in words. Empty
 * list = publishable. This is the REL-022 gate — runs may emit partial
 * candidates, the PUBLICATION boundary refuses them with this list.
 */
export function publicationGaps(candidate: LabCandidate): string[] {
  const gaps: string[] = [];
  const definition = candidate.definition;
  if (definition.organizationId === undefined) {
    gaps.push("definition: organizationId is missing");
  }
  if (definition.displayName === undefined) {
    gaps.push("definition: displayName is missing");
  }
  const domain = definition.domain;
  if (domain === undefined || domain.domains === undefined || domain.domains.length === 0) {
    gaps.push("definition: domain.domains is missing or empty");
  }
  if (domain === undefined || domain.eventTypes === undefined || domain.eventTypes.length === 0) {
    gaps.push("definition: domain.eventTypes is missing or empty");
  }
  if (domain === undefined || domain.modes === undefined || domain.modes.length === 0) {
    gaps.push("definition: domain.modes is missing or empty");
  }
  if (domain === undefined || domain.renderers === undefined || domain.renderers.length === 0) {
    gaps.push("definition: domain.renderers is missing or empty");
  }
  if (definition.capabilities === undefined || definition.capabilities.length === 0) {
    gaps.push("definition: capabilities are missing or empty");
  }
  if (definition.profile === undefined) {
    gaps.push("definition: operating profile (latency/cost) is missing");
  }
  if (candidate.provenance.runId.length === 0) {
    gaps.push("provenance: no lab run reference");
  }
  if (candidate.provenance.sourceRefs.length === 0) {
    gaps.push("provenance: source-data basis is empty");
  }
  if (candidate.provenance.lineage.length === 0) {
    gaps.push("provenance: lineage is empty");
  }
  if (candidate.version < 1) {
    gaps.push("candidate: not versioned (version < 1)");
  }
  return gaps;
}

// ---------------------------------------------------------------------------
// The publish operation
// ---------------------------------------------------------------------------

/**
 * Requests publication of a lab candidate. The candidate is read through the
 * labs store with the caller's tenant — a cross-tenant publish attempt is the
 * candidate store's typed isolation refusal. Incomplete candidates refuse
 * with the full gap list (typed record, never thrown); complete candidates
 * produce an immutable, frozen publication snapshot.
 */
export async function requestPublication(
  exchange: Exchange,
  labs: UserLabs,
  caller: TenantRef,
  request: PublishRequest,
): Promise<PublicationOutcome> {
  requireTenantRef(caller);
  const parsed = PublishRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new LabValidationError("publish request is invalid", zodIssues(parsed.error));
  }
  // Cross-tenant publish attempts refuse HERE (the candidate store's own
  // isolation check — tenant isolation is one law, enforced at every door).
  const candidate = await labs.getCandidate(caller, parsed.data.candidateId);

  const gaps = publicationGaps(candidate);
  if (gaps.length === 0) {
    // Defense in depth: the structural gate and the complete schema must
    // agree before a snapshot is built.
    const parsedDefinition = CandidateDefinitionSchema.safeParse(candidate.definition);
    if (!parsedDefinition.success) {
      gaps.push(...parsedDefinition.error.issues.map((issue) => `definition: ${issue.message}`));
    }
  }
  if (gaps.length > 0) {
    return {
      outcome: "refused",
      reason: "incomplete-candidate",
      candidateId: parsed.data.candidateId,
      gaps,
      message:
        `publication refused: candidate '${parsed.data.candidateId}' is incomplete — ` +
        `${gaps.length} gap(s): ${gaps.join("; ")}`,
    } satisfies PublicationRefused;
  }
  const definition = CandidateDefinitionSchema.parse(candidate.definition);
  const evidence = CandidateEvidenceSchema.parse(candidate.evidence);
  const snapshot: PublicationSnapshot = deepFreeze({
    organizationId: definition.organizationId,
    displayName: definition.displayName,
    domain: definition.domain,
    capabilities: definition.capabilities,
    profile: definition.profile,
    evidence,
    provenance: {
      runId: candidate.provenance.runId,
      sourceRefs: [...candidate.provenance.sourceRefs],
      lineage: [...candidate.provenance.lineage],
      rightsRequirements: candidate.provenance.rightsRequirements.map((r) => ({ ...r })),
    },
  });
  const publication = await exchange.appendPublication({
    publishedBy: { ...caller },
    disclosure: { ...parsed.data.disclosure },
    source: {
      labId: candidate.labId,
      candidateId: candidate.candidateId,
      candidateVersion: candidate.version,
    },
    snapshot,
  });
  return { outcome: "published", publication } satisfies PublicationGranted;
}

/**
 * Withdraws a publication: the snapshot and lineage are preserved untouched
 * (the registry's retirement rule); only the status flips. Only the
 * publishing tenant may withdraw (typed isolation refusal otherwise).
 */
export async function withdrawPublication(
  exchange: Exchange,
  caller: TenantRef,
  publicationId: string,
): Promise<PublishedOrganization> {
  requireTenantRef(caller);
  const publication = await exchange.getPublication(publicationId);
  if (publication.publishedBy.tenantId !== caller.tenantId) {
    throw new LabIsolationError(
      `tenant '${caller.tenantId}' may not withdraw publication '${publicationId}' published by ` +
        `tenant '${publication.publishedBy.tenantId}' — only the publisher withdraws`,
      {
        attemptingTenantId: caller.tenantId,
        owningTenantId: publication.publishedBy.tenantId,
        resourceType: "publication",
        resourceId: publicationId,
      },
    );
  }
  return exchange.markPublicationWithdrawn(publicationId);
}

function zodIssues(error: z.ZodError): unknown[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}
