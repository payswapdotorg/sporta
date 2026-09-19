/**
 * THE VOCABULARY + POLICY TESTS (the closed-vocabulary constitution):
 *
 * - every closed vocabulary is pinned to its exact member list (a new
 *   member is a deliberate, reviewed change — never an accident);
 * - the R401 refusal vocabulary is REUSED verbatim (imported and
 *   equality-checked — never forked, never extended silently);
 * - the R406 credential kinds are exactly the scoped shapes the provider
 *   adapters document + the three refused password-class kinds;
 * - every schema version is "1.0" (the repo convention);
 * - the shipped policy is pinned byte-for-byte by the committed golden
 *   (`fixtures/golden/default-policy.json`), validates through the
 *   published validator, REJECTS tampered documents, and IGNORES
 *   unknown keys (the camera-director config-not-code posture).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMPUTE_BROKER_REFUSALS } from "@sporta/compute-adapter";
import { PROVIDER_CREDENTIAL_STATES } from "@sporta/compute-provider-adapters";
import {
  ACCEPTED_CREDENTIAL_KINDS,
  CREDENTIAL_PRESENTATION_KINDS,
  MASTER_PASSWORD_KINDS,
  MASTER_PASSWORD_REFUSAL_MESSAGES,
  CONNECTION_AUDIT_OUTCOMES,
  CONNECTION_EVENT_TYPES,
  CONNECTION_POSTURES,
  CONNECTION_SCHEMA_VERSION,
  CONNECTION_STATES,
  EXECUTION_OWNERSHIPS,
  MANAGED_REFUSAL_BOUNDS,
  PROVIDER_FACT_ZONES,
  SELECTION_DIRECTIVE_MODES,
  SELECTION_EXCLUSION_AXES,
  SELECTION_PRIVACY_POSTURES,
  DEFAULT_CONNECTION_POLICY,
  validateConnectionPolicy,
  CONNECTION_POLICY_VERSION,
} from "../src/index";

/** The committed golden policy document. */
const GOLDEN = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "fixtures", "golden", "default-policy.json"), "utf8"),
) as unknown;

describe("the closed vocabularies (pinned, deliberate)", () => {
  test("the accepted credential kinds are exactly the scoped shapes", () => {
    expect([...ACCEPTED_CREDENTIAL_KINDS]).toEqual([
      "scoped-api-key",
      "scoped-token-pair",
      "oauth-access-token",
    ]);
  });

  test("the refused password-class kinds are exactly three", () => {
    expect([...MASTER_PASSWORD_KINDS]).toEqual([
      "account-password",
      "console-password",
      "master-password",
    ]);
  });

  test("the full presentation vocabulary is accepted + refused, nothing else", () => {
    expect([...CREDENTIAL_PRESENTATION_KINDS]).toEqual([
      "scoped-api-key",
      "scoped-token-pair",
      "oauth-access-token",
      "account-password",
      "console-password",
      "master-password",
    ]);
  });

  test("the master-password refusal messages are the closed set (two surfaces)", () => {
    expect(Object.keys(MASTER_PASSWORD_REFUSAL_MESSAGES).sort()).toEqual([
      "connect",
      "unknownPresentation",
    ]);
  });

  test("the connection states, events, postures, and audit outcomes are pinned", () => {
    expect([...CONNECTION_STATES]).toEqual([
      "connected-unverified",
      "connected-verified",
      "connected-invalid",
    ]);
    expect([...CONNECTION_EVENT_TYPES]).toEqual([
      "connected",
      "connect-duplicate",
      "verified",
      "verify-failed",
      "credential-invalid",
      "verify-skipped",
      "disconnected",
    ]);
    expect([...CONNECTION_POSTURES]).toEqual([
      "connected-verified",
      "connected-unverified",
      "connected-invalid",
      "disconnected",
      "never-connected",
    ]);
    expect([...CONNECTION_AUDIT_OUTCOMES]).toEqual([
      "connected",
      "connect-duplicate",
      "connect-conflict",
      "connect-refused-master-password",
      "verified",
      "verify-failed",
      "credential-invalid",
      "verify-skipped",
      "disconnected",
    ]);
  });

  test("the R406 lastVerifiedState mirrors the adapters' credential states verbatim", () => {
    // The record's lastVerifiedState echoes the honest five-state answer.
    expect([...PROVIDER_CREDENTIAL_STATES]).toEqual([
      "missing",
      "present-unverified",
      "verified",
      "invalid",
      "not-applicable",
    ]);
  });

  test("the selection vocabularies are pinned", () => {
    expect([...SELECTION_PRIVACY_POSTURES]).toEqual(["privacy-local-only", "privacy-any"]);
    expect([...PROVIDER_FACT_ZONES]).toEqual([
      "user-controlled",
      "provider-cloud",
      "sporta-managed",
    ]);
    expect([...SELECTION_EXCLUSION_AXES]).toEqual(["privacy", "vram", "capability"]);
    expect([...SELECTION_DIRECTIVE_MODES]).toEqual(["user-explicit", "sporta-auto"]);
  });

  test("the R408/R409 vocabularies are pinned", () => {
    expect([...EXECUTION_OWNERSHIPS]).toEqual(["user-owned-provider", "sporta-managed"]);
    expect([...MANAGED_REFUSAL_BOUNDS]).toEqual([
      "no-entitlement",
      "period-exhausted",
      "concurrency-full",
      "unit-exhausted",
    ]);
  });

  test("the R401 refusal vocabulary is reused VERBATIM (imported, never forked)", () => {
    expect([...COMPUTE_BROKER_REFUSALS]).toEqual([
      "no-compatible-gpu",
      "quota-exhausted",
      "credential-invalid",
      "budget-exceeded",
      "provider-unavailable",
    ]);
  });

  test("every schema/policy version is 1.0 (the repo convention)", () => {
    expect(CONNECTION_SCHEMA_VERSION).toBe("1.0");
    expect(CONNECTION_POLICY_VERSION).toBe("1.0");
  });
});

describe("the policy document (versioned DATA, golden-pinned)", () => {
  test("the shipped default equals the committed golden byte-for-byte", () => {
    expect(JSON.parse(JSON.stringify(DEFAULT_CONNECTION_POLICY))).toEqual(GOLDEN);
  });

  test("the golden validates through the published validator", () => {
    expect(() => validateConnectionPolicy(GOLDEN)).not.toThrow();
  });

  test("tampered documents are rejected loudly (never a silent default)", () => {
    const tampered = JSON.parse(JSON.stringify(GOLDEN)) as Record<string, unknown>;
    const selection = tampered["selection"] as Record<string, unknown>;
    selection["explicitMustWin"] = false;
    expect(() => validateConnectionPolicy(tampered)).toThrow(/validation/);
    const badThresholds = JSON.parse(JSON.stringify(GOLDEN)) as Record<string, unknown>;
    const managed = badThresholds["managed"] as Record<string, unknown>;
    managed["alarmThresholds"] = [];
    expect(() => validateConnectionPolicy(badThresholds)).toThrow(/validation/);
    const badVersion = JSON.parse(JSON.stringify(GOLDEN)) as Record<string, unknown>;
    badVersion["policyVersion"] = "not-a-version";
    expect(() => validateConnectionPolicy(badVersion)).toThrow(/validation/);
  });

  test("unknown keys are IGNORED (config, not code — forward compatibility)", () => {
    const extended = JSON.parse(JSON.stringify(GOLDEN)) as Record<string, unknown>;
    extended["futureField"] = { anything: true };
    const selection = extended["selection"] as Record<string, unknown>;
    selection["anotherFutureField"] = 7;
    const validated = validateConnectionPolicy(extended);
    expect(validated.policyVersion).toBe("1.0");
  });
});
