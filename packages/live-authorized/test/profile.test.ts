/**
 * THE L009 REGISTRATION + HEALTH BATTERY — the §6 TechnologyProfile with
 * the honest BLOCKED license posture (the dataset component unresolved —
 * the R004 fail-closed rule), the profile's contract-validity, and the
 * operator-facing capability panel.
 */
import { describe, expect, test } from "bun:test";
import { TechnologyProfile, blockingLicenseIssues } from "@sporta/contracts";
import {
  SKILLCORNER_AUTHORIZED_PROFILE,
  SKILLCORNER_AUTHORIZED_LICENSE,
  SKILLCORNER_AUTHORIZED_PROFILE_TECHNOLOGY_ID,
} from "../src/profile";
import { authorizedLiveProviderHealth } from "../src/health";
import {
  SKILLCORNER_USERNAME_ENV,
  SKILLCORNER_PASSWORD_ENV,
  SKILLCORNER_MATCH_ID_ENV,
} from "../src/env";

describe("L009 — the §6 registration (the frozen TechnologyProfile contract)", () => {
  test("the profile parses against the frozen contract schema", () => {
    const parsed = TechnologyProfile.safeParse(SKILLCORNER_AUTHORIZED_PROFILE);
    expect(parsed.success).toBe(true);
  });

  test("the DATASET license component is honestly UNRESOLVED (no feed access — never fabricated)", () => {
    const dataset = SKILLCORNER_AUTHORIZED_LICENSE.dataset;
    if (dataset === undefined) throw new Error("the dataset component must exist");
    expect(dataset.status).toBe("unresolved");
    expect(dataset.reviewRef).toContain("NO credentials");
  });

  test("blockingLicenseIssues is NON-EMPTY — the candidate is blocked beyond the adapter shape (R004 fail-closed)", () => {
    const issues = blockingLicenseIssues(SKILLCORNER_AUTHORIZED_PROFILE);
    expect(issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(issues)).toContain("dataset");
  });

  test("the blocked posture is stated in the registration's own display + execution status", () => {
    expect(SKILLCORNER_AUTHORIZED_PROFILE.displayName).toContain("BLOCKED");
    expect(SKILLCORNER_AUTHORIZED_PROFILE.executionRequirements).toMatchObject({
      status: "blocked-pending-feed-access",
    });
    expect(SKILLCORNER_AUTHORIZED_PROFILE_TECHNOLOGY_ID).toBe("skillcorner-authorized-tracking");
  });

  test("the failure classes document the exact honest postures (gate/auth/schema/unknown)", () => {
    const ids = SKILLCORNER_AUTHORIZED_PROFILE.failureClasses.map(
      (record) => record.failureClassId,
    );
    expect(ids).toContain("skillcorner-authorized.credentials-missing");
    expect(ids).toContain("skillcorner-authorized.auth-rejected");
    expect(ids).toContain("skillcorner-authorized.page-schema-mismatch");
    expect(ids).toContain("skillcorner-authorized.frame-schema-mismatch");
    expect(ids).toContain("skillcorner-authorized.unknown-provider-fields");
  });
});

describe("L009 — the operator capability/health panel", () => {
  test("an unconfigured deployment: one BLOCKED row with the exact missing bindings (no secrets)", () => {
    const panel = authorizedLiveProviderHealth({});
    expect(panel.providers).toHaveLength(1);
    const row = panel.providers[0]!;
    expect(row.state).toBe("blocked");
    expect(row.missingBindings).toEqual([
      SKILLCORNER_USERNAME_ENV,
      SKILLCORNER_PASSWORD_ENV,
      SKILLCORNER_MATCH_ID_ENV,
    ]);
    expect(panel.summary).toMatchObject({ ready: 0, blocked: 1 });
    expect(row.adapterId).toBe("live-authorized.skillcorner-tracking");
    expect(JSON.stringify(panel)).not.toContain("a-real-secret");
  });

  test("a configured deployment: one READY row that STILL carries the first-pull verification note", () => {
    const panel = authorizedLiveProviderHealth({
      [SKILLCORNER_USERNAME_ENV]: "u",
      [SKILLCORNER_PASSWORD_ENV]: "a-real-secret",
      [SKILLCORNER_MATCH_ID_ENV]: "2017461",
    });
    const row = panel.providers[0]!;
    expect(row.state).toBe("ready");
    expect(row.matchId).toBe("2017461");
    expect(panel.summary).toMatchObject({ ready: 1, blocked: 0 });
    expect(row.note).toContain("verify");
    expect(JSON.stringify(panel)).not.toContain("a-real-secret");
  });
});
