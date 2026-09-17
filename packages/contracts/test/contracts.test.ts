import { describe, expect, test } from "bun:test";
import {
  CONTRACTS_PACKAGE_VERSION,
  FOOTBALL_EVENT_TYPES,
  SCHEMA_MAJOR,
  SCHEMA_MINOR,
  SCHEMA_VERSION,
  UncertainValue,
  deriveRightsCapabilities,
  isCompatibleVersion,
  type AuthorizationPolicy,
  type RightsCapabilities,
} from "../src/index";

const DENY_ALL: RightsCapabilities = {
  canReferenceSourceFrames: false,
  canDeliverLive: false,
  canStoreDerivatives: false,
  canShare: false,
};

describe("schema versioning", () => {
  test("current schema version is MAJOR.MINOR", () => {
    expect(SCHEMA_VERSION).toBe(`${SCHEMA_MAJOR}.${SCHEMA_MINOR}`);
    expect(SCHEMA_VERSION).toBe("1.1");
  });

  test("isCompatibleVersion accepts the current version", () => {
    expect(isCompatibleVersion("1.1")).toBe(true);
    expect(isCompatibleVersion("1.0")).toBe(true);
  });

  test("isCompatibleVersion rejects a newer minor (payload ahead of contracts)", () => {
    expect(isCompatibleVersion("1.2")).toBe(false);
  });

  test("isCompatibleVersion rejects other majors", () => {
    expect(isCompatibleVersion("0.9")).toBe(false);
    expect(isCompatibleVersion("2.0")).toBe(false);
  });

  test("isCompatibleVersion rejects malformed versions", () => {
    for (const v of ["1", "1.0.0", "v1.0", "", "1.x", "1.-0"]) {
      expect(isCompatibleVersion(v)).toBe(false);
    }
  });

  test("isCompatibleVersion is lenient about non-canonical leading zeros", () => {
    // "01.0" matches the MAJOR.MINOR shape and numerically equals 1.0.
    expect(isCompatibleVersion("01.0")).toBe(true);
  });
});

describe("rights capabilities derivation (fail-closed)", () => {
  const fullPolicy: AuthorizationPolicy = {
    policyId: "pol_test_full",
    allowedOperations: [
      "analysis",
      "transformation",
      "liveDelivery",
      "derivativeGeneration",
      "storage",
      "sharing",
    ],
    assertedBy: "rights-operator@example.test",
  };

  test("a missing policy denies everything", () => {
    expect(deriveRightsCapabilities(undefined)).toEqual(DENY_ALL);
    expect(deriveRightsCapabilities(null)).toEqual(DENY_ALL);
  });

  test("an expired policy denies everything", () => {
    const expired: AuthorizationPolicy = {
      ...fullPolicy,
      expiresAtIso: "2020-01-01T00:00:00Z",
    };
    expect(deriveRightsCapabilities(expired, new Date("2024-06-01T00:00:00Z"))).toEqual(DENY_ALL);
  });

  test("a policy expiring in the future remains valid", () => {
    const valid: AuthorizationPolicy = {
      ...fullPolicy,
      expiresAtIso: "2030-01-01T00:00:00Z",
    };
    expect(deriveRightsCapabilities(valid, new Date("2024-06-01T00:00:00Z"))).not.toEqual(DENY_ALL);
  });

  test("a full, valid policy grants all capabilities", () => {
    expect(deriveRightsCapabilities(fullPolicy)).toEqual({
      canReferenceSourceFrames: true,
      canDeliverLive: true,
      canStoreDerivatives: true,
      canShare: true,
    });
  });

  test("storing derivatives requires both derivativeGeneration and storage", () => {
    const noStorage: AuthorizationPolicy = {
      ...fullPolicy,
      allowedOperations: ["analysis", "transformation", "derivativeGeneration"],
    };
    const capabilities = deriveRightsCapabilities(noStorage);
    expect(capabilities.canReferenceSourceFrames).toBe(true);
    expect(capabilities.canStoreDerivatives).toBe(false);
  });

  test("an operation never granted stays denied", () => {
    const analysisOnly: AuthorizationPolicy = {
      ...fullPolicy,
      allowedOperations: ["analysis"],
    };
    expect(deriveRightsCapabilities(analysisOnly)).toEqual(DENY_ALL);
  });
});

describe("uncertainty pattern", () => {
  test('status "known" requires a value', () => {
    const result = UncertainValue.safeParse({ status: "known" });
    expect(result.success).toBe(false);
  });

  test('status "unknown" carries no value', () => {
    const result = UncertainValue.safeParse({ status: "unknown" });
    expect(result.success).toBe(true);
  });

  test('status "uncertain" carries a candidate value and confidence', () => {
    const result = UncertainValue.safeParse({ status: "uncertain", value: 7, confidence: 0.55 });
    expect(result.success).toBe(true);
  });

  test("confidence is bounded to [0, 1]", () => {
    const result = UncertainValue.safeParse({ status: "uncertain", value: 7, confidence: 1.5 });
    expect(result.success).toBe(false);
  });
});

describe("football extension", () => {
  test("event taxonomy contains the core football event types", () => {
    for (const eventType of [
      "kickoff",
      "pass",
      "carry",
      "tackle",
      "shot",
      "save",
      "goal",
      "card",
      "substitution",
      "offside",
      "restart",
      "possession-change",
      "injury-pause",
      "referee-decision",
      "replay-cue",
      "commentary-emphasis",
    ]) {
      expect(
        FOOTBALL_EVENT_TYPES.includes(eventType as (typeof FOOTBALL_EVENT_TYPES)[number]),
      ).toBe(true);
    }
  });

  test("event taxonomy is exactly the v1 set", () => {
    expect(FOOTBALL_EVENT_TYPES).toHaveLength(16);
  });
});

describe("@sporta/contracts", () => {
  test("exposes the package version", () => {
    expect(CONTRACTS_PACKAGE_VERSION).toBe("0.1.0");
  });
});
