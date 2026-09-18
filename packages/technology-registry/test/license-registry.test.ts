/**
 * R004 — license registry: review records (validation, two-gate rules,
 * supersession), assembly of the effective license record, and the
 * fail-closed promotion gate (`blockingLicenseIssues` non-empty => refused).
 */
import { describe, expect, test } from "bun:test";
import {
  InMemoryTechnologyRegistryStore,
  LicenseRegistry,
  PromotionLicenseError,
  assertPromotableLicense,
  licenseGateIssues,
  parseLicenseReviewDocument,
} from "../src/index";
import { buildLicenseReview, buildTechnologyProfile, TEST_EPOCH_MS } from "./builders";

function makeRegistry() {
  return new LicenseRegistry(new InMemoryTechnologyRegistryStore());
}

describe("LicenseReviewRecord validation (two-gate rules)", () => {
  test("accepts a complete permissive review", () => {
    const review = buildLicenseReview();
    expect(review.status).toBe("permissive");
    expect(review.commercialUse).toBe(true);
  });

  test("an unresolved component cannot affirm commercial use", () => {
    expect(() =>
      parseLicenseReviewDocument(buildLicenseReview({ status: "unresolved", commercialUse: true })),
    ).toThrow(/unresolved component cannot affirm/);
  });

  test("a research-only component cannot affirm commercial use", () => {
    expect(() =>
      parseLicenseReviewDocument(
        buildLicenseReview({
          status: "research-only",
          commercialUse: true,
          licenseId: "CC-BY-NC-4.0",
        }),
      ),
    ).toThrow(/research-only component cannot affirm/);
  });

  test("affirming commercial use requires naming the license", () => {
    expect(() =>
      parseLicenseReviewDocument(buildLicenseReview({ licenseId: undefined, commercialUse: true })),
    ).toThrow(/requires naming the license/);
  });

  test("copyleft CAN affirm commercial use when reviewed (e.g. GPL-family)", () => {
    const review = parseLicenseReviewDocument(
      buildLicenseReview({ status: "copyleft", licenseId: "GPL-3.0-only", commercialUse: true }),
    );
    expect(review.commercialUse).toBe(true);
  });
});

describe("LicenseRegistry reviews", () => {
  test("records reviews and reports supersession", () => {
    const registry = makeRegistry();
    const first = registry.recordReview(
      buildLicenseReview({ reviewId: "rev-1", technologyId: "tech-l", reviewedAtMs: 1_000 }),
    );
    expect(first.supersededReviewId).toBeNull();
    const second = registry.recordReview(
      buildLicenseReview({
        reviewId: "rev-2",
        technologyId: "tech-l",
        status: "unresolved",
        licenseId: undefined,
        commercialUse: undefined,
        reviewedAtMs: 2_000,
      }),
    );
    expect(second.supersededReviewId).toBe("rev-1");
  });

  test("idempotent re-record of the identical review; conflicting re-record refused", () => {
    const registry = makeRegistry();
    const review = buildLicenseReview({ reviewId: "rev-dup", technologyId: "tech-dup" });
    registry.recordReview(review);
    const again = registry.recordReview(review);
    expect(again.supersededReviewId).toBeNull();
    expect(() =>
      registry.recordReview(
        buildLicenseReview({ reviewId: "rev-dup", technologyId: "tech-dup", notes: "changed" }),
      ),
    ).toThrow(/different content/);
  });

  test("the latest review per component is the effective verdict; the trail is kept", () => {
    const registry = makeRegistry();
    registry.recordReview(
      buildLicenseReview({
        reviewId: "r1",
        technologyId: "tech-v",
        component: "code",
        reviewedAtMs: 1_000,
      }),
    );
    registry.recordReview(
      buildLicenseReview({
        reviewId: "r2",
        technologyId: "tech-v",
        component: "code",
        status: "permissive",
        licenseId: "Apache-2.0",
        commercialUse: true,
        reviewedAtMs: 2_000,
      }),
    );
    expect(registry.latestReviewFor("tech-v", "1.0.0", "code")?.reviewId).toBe("r2");
    expect(registry.reviewsFor("tech-v", "1.0.0")).toHaveLength(2);
  });
});

describe("assembledLicenseRecord", () => {
  test("assembles the latest verdicts into the frozen record shape", () => {
    const registry = makeRegistry();
    registry.recordReview(
      buildLicenseReview({
        reviewId: "rc",
        technologyId: "tech-a",
        component: "code",
        status: "permissive",
        licenseId: "Apache-2.0",
        commercialUse: true,
        reviewRef: "https://example.test/r/code",
      }),
    );
    registry.recordReview(
      buildLicenseReview({
        reviewId: "rm",
        technologyId: "tech-a",
        component: "model",
        status: "research-only",
        licenseId: "CC-BY-NC-4.0",
        commercialUse: false,
        reviewRef: "https://example.test/r/model",
      }),
    );
    const record = registry.assembledLicenseRecord("tech-a", "1.0.0");
    expect(record?.code.status).toBe("permissive");
    expect(record?.code.commercialUse).toBe(true);
    expect(record?.model?.status).toBe("research-only");
    expect(record?.model?.commercialUse).toBe(false);
  });

  test("returns null without a code review (code is mandatory)", () => {
    const registry = makeRegistry();
    registry.recordReview(
      buildLicenseReview({ reviewId: "rm", technologyId: "tech-n", component: "model" }),
    );
    expect(registry.assembledLicenseRecord("tech-n", "1.0.0")).toBeNull();
  });

  test("withAssembledLicense refreshes a profile document for re-recording", () => {
    const registry = makeRegistry();
    registry.recordReview(
      buildLicenseReview({
        reviewId: "rc2",
        technologyId: "tech-w",
        component: "code",
        status: "permissive",
        licenseId: "MIT",
        commercialUse: true,
      }),
    );
    const profile = buildTechnologyProfile({ technologyId: "tech-w" });
    const refreshed = registry.withAssembledLicense(profile);
    expect(refreshed.license.code.licenseId).toBe("MIT");
    expect(refreshed.status).toBe(profile.status); // lifecycle untouched
  });
});

describe("the fail-closed promotion gate (R004)", () => {
  test("a fully affirmed permissive profile passes", () => {
    const profile = buildTechnologyProfile();
    expect(licenseGateIssues(profile)).toEqual([]);
    expect(() => assertPromotableLicense(profile)).not.toThrow();
  });

  test("an unresolved model component blocks with a machine-readable reason", () => {
    const profile = buildTechnologyProfile({
      license: {
        code: { status: "permissive", licenseId: "Apache-2.0", commercialUse: true },
        model: { status: "unresolved" },
      },
    });
    const issues = licenseGateIssues(profile);
    expect(issues).toEqual(["license.model: unresolved status"]);
    expect(() => assertPromotableLicense(profile)).toThrow(PromotionLicenseError);
  });

  test("a research-only model component blocks (no commercial use)", () => {
    const profile = buildTechnologyProfile({
      license: {
        code: { status: "permissive", licenseId: "Apache-2.0", commercialUse: true },
        model: { status: "research-only", licenseId: "CC-BY-NC-4.0", commercialUse: false },
      },
    });
    expect(licenseGateIssues(profile)).toContain(
      "license.model: commercial-use not affirmed (status research-only, commercialUse false)",
    );
    expect(() => assertPromotableLicense(profile)).toThrow(PromotionLicenseError);
  });

  test("a resolved component without a license id still blocks (two-gate)", () => {
    const profile = buildTechnologyProfile({
      license: {
        code: { status: "permissive", licenseId: undefined, commercialUse: true },
      },
    });
    expect(licenseGateIssues(profile)).toContain("license.code: resolved without a license id");
  });

  test("absent components never block", () => {
    const profile = buildTechnologyProfile({
      license: { code: { status: "permissive", licenseId: "Apache-2.0", commercialUse: true } },
    });
    expect(licenseGateIssues(profile)).toEqual([]);
  });
});

describe("review timestamps are caller-controlled", () => {
  test("reviewedAtMs comes from the document", () => {
    const registry = makeRegistry();
    const { review } = registry.recordReview(
      buildLicenseReview({ reviewId: "rev-ts", reviewedAtMs: TEST_EPOCH_MS + 999 }),
    );
    expect(review.reviewedAtMs).toBe(TEST_EPOCH_MS + 999);
  });
});
