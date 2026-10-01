/**
 * Promotion REQUESTS from a user lab (REL-020's final step).
 *
 * THE LAW (binding): a user lab can REQUEST promotion of a PUBLISHED
 * candidate — and that is ALL it can do. The promotion DECISION stays with
 * the registry's promotion pipeline (REL-018, already delivered in
 * `@sporta/organization-registry`): reproducibility, benchmark, robustness,
 * rights/provenance, cost/latency, security/policy, canary — the same gates
 * a hand-engineered organization passes (the promotion invariant: "a lab
 * breakthrough is not a product feature until it passes the same
 * promotion/evidence gates").
 *
 * There is no decision field on a promotion request record, and there never
 * will be one. This module records that a lab ASKED; the registry answers.
 *
 * The request targets a PUBLICATION (REL-022's governed snapshot), never a
 * raw private candidate — publishing first is the only path to promotion.
 * Only the publishing tenant may request (typed isolation refusal
 * otherwise); withdrawn publications refuse (lineage preserved, path
 * closed); duplicate active requests refuse instead of double-queueing.
 */
import { z } from "zod";
import type { TenantRef } from "../domain";
import { requireTenantRef } from "../domain";
import { LabIsolationError, LabNotFoundError, LabValidationError } from "../errors";
import type { Exchange } from "../exchange/publish";

// ---------------------------------------------------------------------------
// The promotion request record
// ---------------------------------------------------------------------------

export const PROMOTION_REQUEST_STATUSES = ["requested", "withdrawn"] as const;

export type PromotionRequestStatus = (typeof PROMOTION_REQUEST_STATUSES)[number];

/**
 * A promotion REQUEST record — a request, nothing more. The DECISION is the
 * registry pipeline's; it is not modeled here because it does not happen
 * here.
 */
export interface PromotionRequestRecord {
  requestId: string;
  publicationId: string;
  candidateId: string;
  labId: string;
  requestedBy: TenantRef;
  requestedAt: string;
  status: PromotionRequestStatus;
  withdrawnAt: string | null;
}

// ---------------------------------------------------------------------------
// Outcomes (typed refusal records — never thrown)
// ---------------------------------------------------------------------------

export interface PromotionRequestGranted {
  outcome: "requested";
  request: PromotionRequestRecord;
}

export interface PromotionRequestRefused {
  outcome: "refused";
  reason: "publication-withdrawn" | "already-requested";
  publicationId: string;
  message: string;
}

export type PromotionRequestOutcome = PromotionRequestGranted | PromotionRequestRefused;

const PromotionRequestInputSchema = z.strictObject({
  publicationId: z.string().min(1),
});

function zodIssues(error: z.ZodError): unknown[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

// ---------------------------------------------------------------------------
// The operations
// ---------------------------------------------------------------------------

/**
 * Requests promotion of a PUBLISHED candidate on the registry pipeline's
 * behalf. REQUEST ONLY — this function never evaluates a gate, never
 * promotes, and never writes to the organization registry.
 */
export async function requestPublicationPromotion(
  exchange: Exchange,
  caller: TenantRef,
  request: { publicationId: string },
): Promise<PromotionRequestOutcome> {
  requireTenantRef(caller);
  const parsed = PromotionRequestInputSchema.safeParse(request);
  if (!parsed.success) {
    throw new LabValidationError("promotion request input is invalid", zodIssues(parsed.error));
  }
  const publication = await exchange.getPublication(parsed.data.publicationId);
  if (publication.publishedBy.tenantId !== caller.tenantId) {
    throw new LabIsolationError(
      `tenant '${caller.tenantId}' may not request promotion of publication ` +
        `'${parsed.data.publicationId}' published by tenant '${publication.publishedBy.tenantId}' — ` +
        `only the publishing lab may request promotion`,
      {
        attemptingTenantId: caller.tenantId,
        owningTenantId: publication.publishedBy.tenantId,
        resourceType: "publication",
        resourceId: parsed.data.publicationId,
      },
    );
  }
  if (publication.status === "withdrawn") {
    return {
      outcome: "refused",
      reason: "publication-withdrawn",
      publicationId: parsed.data.publicationId,
      message:
        `promotion request refused: publication '${parsed.data.publicationId}' is withdrawn — ` +
        `the lineage is preserved but the path to promotion is closed`,
    } satisfies PromotionRequestRefused;
  }
  const existing = (await exchange.promotionRequests()).find(
    (r) => r.publicationId === parsed.data.publicationId && r.status === "requested",
  );
  if (existing !== undefined) {
    return {
      outcome: "refused",
      reason: "already-requested",
      publicationId: parsed.data.publicationId,
      message:
        `promotion request refused: request '${existing.requestId}' is already active for ` +
        `publication '${parsed.data.publicationId}'`,
    } satisfies PromotionRequestRefused;
  }
  const record = await exchange.appendPromotionRequest({
    publicationId: publication.publicationId,
    candidateId: publication.source.candidateId,
    labId: publication.source.labId,
    requestedBy: { ...caller },
  });
  return { outcome: "requested", request: record } satisfies PromotionRequestGranted;
}

/** Withdraws a promotion request (the requesting tenant only). */
export async function withdrawPromotionRequest(
  exchange: Exchange,
  caller: TenantRef,
  requestId: string,
): Promise<PromotionRequestRecord> {
  requireTenantRef(caller);
  const found = (await exchange.promotionRequests()).find((r) => r.requestId === requestId);
  if (found === undefined) {
    throw new LabNotFoundError("promotion request not found", { requestId });
  }
  if (found.requestedBy.tenantId !== caller.tenantId) {
    throw new LabIsolationError(
      `tenant '${caller.tenantId}' may not withdraw promotion request '${requestId}' made by ` +
        `tenant '${found.requestedBy.tenantId}'`,
      {
        attemptingTenantId: caller.tenantId,
        owningTenantId: found.requestedBy.tenantId,
        resourceType: "promotion-request",
        resourceId: requestId,
      },
    );
  }
  return exchange.markPromotionRequestWithdrawn(requestId);
}

/** Lists the caller's own promotion requests (oldest first). */
export async function listPromotionRequests(
  exchange: Exchange,
  caller: TenantRef,
): Promise<PromotionRequestRecord[]> {
  requireTenantRef(caller);
  const all = await exchange.promotionRequests();
  return all.filter((r) => r.requestedBy.tenantId === caller.tenantId);
}
