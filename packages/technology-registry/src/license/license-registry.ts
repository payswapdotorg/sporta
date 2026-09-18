/**
 * The License Registry (R004): review records keyed by technologyId +
 * technologyVersion (+ component), storing the reviewed
 * `LicenseComponent` verdicts, the reviewer identity, and the review
 * reference. A technology's promotion path queries this registry.
 *
 * The frozen fail-closed rule (technology.ts): a profile may move toward
 * production only when `blockingLicenseIssues(profile)` is EMPTY — every
 * PRESENT license component resolved AND its reviewed commercial-use
 * verdict `true`. This module implements and enforces that gate
 * ({@link assertPromotableLicense}) and provides the record-level two-gate
 * validations the frozen contract documents:
 *
 * - `commercialUse: true` requires a resolved status AND a license id —
 *   a bare "it's fine" without naming the license is not a verdict;
 * - `research-only` components can never affirm commercial use;
 * - `unresolved` components carry no verdict at all.
 *
 * Reviews are an append-only audit trail: the LATEST review per (technology,
 * version, component) is the effective verdict, but every superseded review
 * remains queryable.
 */
import {
  LicenseComponentStatus,
  TechnologyLicenseRecord,
  blockingLicenseIssues,
  schemaVersionField,
} from "@sporta/contracts";
import type {
  LicenseComponent,
  TechnologyLicenseRecord as TechnologyLicenseRecordDoc,
  TechnologyProfile as TechnologyProfileDoc,
} from "@sporta/contracts";
import { z } from "zod";
import { PromotionLicenseError, RegistryConflictError, RegistryValidationError } from "../errors";
import type { TechnologyRegistryStore } from "../store/store";

/** The license components the frozen record reviews separately. */
export const LicenseReviewComponent = z.enum(["code", "model", "dataset", "assets"]);
export type LicenseReviewComponent = z.infer<typeof LicenseReviewComponent>;

/** One reviewer's verdict for one component of one technology version. */
export const LicenseReviewRecord = z
  .object({
    schemaVersion: schemaVersionField,
    reviewId: z.string().min(1),
    technologyId: z.string().min(1),
    technologyVersion: z.string().min(1),
    component: LicenseReviewComponent,
    status: LicenseComponentStatus,
    /** SPDX identifier or explicit license name (required to affirm commercial use). */
    licenseId: z.string().min(1).optional(),
    /** The reviewed commercial-use verdict; absent means not yet reviewed. */
    commercialUse: z.boolean().optional(),
    /** Who reviewed it (human or service principal), never blank. */
    reviewer: z.string().min(1),
    /** Where the verdict came from (URL, review doc, or registry id). */
    reviewRef: z.string().min(1),
    reviewedAtMs: z.number().int().min(0),
    notes: z.string().optional(),
  })
  .superRefine((review, ctx) => {
    if (review.status === "unresolved" && review.commercialUse === true) {
      ctx.addIssue({
        code: "custom",
        path: ["commercialUse"],
        message: "an unresolved component cannot affirm commercial use",
      });
    }
    if (review.status === "research-only" && review.commercialUse === true) {
      ctx.addIssue({
        code: "custom",
        path: ["commercialUse"],
        message: "a research-only component cannot affirm commercial use",
      });
    }
    if (review.commercialUse === true && review.licenseId === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["licenseId"],
        message: "affirming commercial use requires naming the license (two-gate rule)",
      });
    }
  });
export type LicenseReviewRecord = z.infer<typeof LicenseReviewRecord>;

/** Parse + validate a license review (throws the zod error on invalid input). */
export function parseLicenseReviewDocument(input: unknown): LicenseReviewRecord {
  return LicenseReviewRecord.parse(input);
}

/** The R004 license-registry service over a registry store. */
export class LicenseRegistry {
  constructor(private readonly store: TechnologyRegistryStore) {}

  /**
   * Append a review to the audit trail. The latest review per (technology,
   * version, component) becomes the effective verdict. Same reviewId with
   * identical content is an idempotent no-op; different content is a
   * conflict (reviews are immutable once written).
   */
  recordReview(review: LicenseReviewRecord): {
    review: LicenseReviewRecord;
    supersededReviewId: string | null;
  } {
    const parsed = LicenseReviewRecord.safeParse(review);
    if (!parsed.success) {
      throw new RegistryValidationError("license review failed schema validation", [
        ...parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      ]);
    }
    const doc = parsed.data;

    const existing = this.store.getLicenseReview(doc.reviewId);
    if (existing !== null) {
      if (JSON.stringify(existing) === JSON.stringify(doc)) {
        return { review: doc, supersededReviewId: null }; // idempotent no-op
      }
      throw new RegistryConflictError(
        `license review '${doc.reviewId}' is already recorded with different content`,
      );
    }

    const previous = this.latestReviewFor(doc.technologyId, doc.technologyVersion, doc.component);
    this.store.putLicenseReview(doc);
    return { review: doc, supersededReviewId: previous?.reviewId ?? null };
  }

  /** The latest review for one component, or `null`. */
  latestReviewFor(
    technologyId: string,
    technologyVersion: string,
    component: LicenseReviewComponent,
  ): LicenseReviewRecord | null {
    const reviews = this.store.listLicenseReviews(technologyId, technologyVersion);
    let latest: LicenseReviewRecord | null = null;
    for (const review of reviews) {
      if (review.component === component) latest = review;
    }
    return latest;
  }

  /** The full review audit trail for a technology version, ordered. */
  reviewsFor(technologyId: string, technologyVersion: string): LicenseReviewRecord[] {
    return this.store.listLicenseReviews(technologyId, technologyVersion);
  }

  /**
   * Assemble the effective `TechnologyLicenseRecord` from the latest
   * reviews, or `null` when no `code` review exists (the code component is
   * mandatory in the frozen record — without it there is no record).
   */
  assembledLicenseRecord(
    technologyId: string,
    technologyVersion: string,
  ): TechnologyLicenseRecordDoc | null {
    const component = (name: LicenseReviewComponent): LicenseComponent | undefined => {
      const review = this.latestReviewFor(technologyId, technologyVersion, name);
      if (review === null) return undefined;
      return {
        status: review.status,
        ...(review.licenseId !== undefined ? { licenseId: review.licenseId } : {}),
        ...(review.commercialUse !== undefined ? { commercialUse: review.commercialUse } : {}),
        ...(review.reviewRef !== undefined ? { reviewRef: review.reviewRef } : {}),
      };
    };
    const code = component("code");
    if (code === undefined) return null;
    const record: TechnologyLicenseRecordDoc = {
      code,
      ...(component("model") !== undefined ? { model: component("model") } : {}),
      ...(component("dataset") !== undefined ? { dataset: component("dataset") } : {}),
      ...(component("assets") !== undefined ? { assets: component("assets") } : {}),
    };
    return TechnologyLicenseRecord.parse(record);
  }

  /**
   * Apply the assembled latest reviews to a profile document (the honest
   * way to refresh a profile's license block: record the reviews, then
   * record a NEW adapterVersion of the profile carrying the assembled
   * record — the pipeline's license gate reads the profile).
   */
  withAssembledLicense(profile: TechnologyProfileDoc): TechnologyProfileDoc {
    const assembled = this.assembledLicenseRecord(profile.technologyId, profile.technologyVersion);
    if (assembled === null) {
      throw new RegistryValidationError(
        `no code license review recorded for ${profile.technologyId}@${profile.technologyVersion}; ` +
          `nothing to assemble`,
      );
    }
    return { ...profile, license: assembled };
  }
}

/**
 * The R004 fail-closed promotion gate: `blockingLicenseIssues(profile)`
 * non-empty => promotion REFUSED. Returns the issues (empty = clear).
 * Re-exports the frozen contract rule so callers have one import site.
 */
export function licenseGateIssues(profile: TechnologyProfileDoc): string[] {
  return blockingLicenseIssues(profile);
}

/** Throw {@link PromotionLicenseError} when the profile is not promotable. */
export function assertPromotableLicense(profile: TechnologyProfileDoc): void {
  const issues = blockingLicenseIssues(profile);
  if (issues.length > 0) {
    throw new PromotionLicenseError(
      `license gate refused promotion of ${profile.technologyId}@${profile.technologyVersion}: ` +
        `unresolved or non-affirmed license components`,
      issues,
    );
  }
}
