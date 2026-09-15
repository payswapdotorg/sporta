/**
 * The server-side authorization policy tests (W902): the grants/ownership
 * decision matrix, fail-closed on unknown everything, and the pinned
 * invariant that the ACTIVE ROLE never influences a decision.
 */
import { describe, expect, test } from "bun:test";
import { IDENTITY_ACTIONS, authorize, isIdentityAction } from "../src/index";
import type { IdentityAction, PolicyAccount } from "../src/index";

function account(userId: string, roles: PolicyAccount["roles"]): PolicyAccount {
  return { userId, roles };
}

describe("the closed action vocabulary", () => {
  test("is exactly the seven W902 actions", () => {
    const expected: IdentityAction[] = [
      "account.read",
      "account.switch-role",
      "media-session.create",
      "media-session.read",
      "media-session.terminate",
      "provider-health.read",
      "render-output.read",
    ];
    expect([...IDENTITY_ACTIONS].sort()).toEqual(expected.sort());
  });

  test("isIdentityAction accepts members and rejects everything else", () => {
    expect(isIdentityAction("media-session.read")).toBe(true);
    expect(isIdentityAction("media-session.write")).toBe(false);
    expect(isIdentityAction("")).toBe(false);
    expect(isIdentityAction(42)).toBe(false);
    expect(isIdentityAction(null)).toBe(false);
  });
});

describe("fail-closed: no account / unknown action / unknown resource", () => {
  test("an unauthenticated caller denies EVERY action", () => {
    for (const action of IDENTITY_ACTIONS) {
      expect(authorize(null, action)).toEqual({ allowed: false, reason: "unauthenticated" });
      expect(authorize(undefined, action)).toEqual({ allowed: false, reason: "unauthenticated" });
    }
  });

  test("an unknown action denies (a typo can never fall through to allow)", () => {
    const user = account("u-1", ["operator"]);
    expect(authorize(user, "media-session.write" as never)).toEqual({
      allowed: false,
      reason: "unknown-action",
    });
    expect(authorize(user, "" as never)).toEqual({ allowed: false, reason: "unknown-action" });
  });

  test("a resource action without an owner denies (unknown-resource)", () => {
    const user = account("u-1", ["creator"]);
    expect(authorize(user, "media-session.read", {})).toEqual({
      allowed: false,
      reason: "unknown-resource",
    });
    expect(authorize(user, "render-output.read", {})).toEqual({
      allowed: false,
      reason: "unknown-resource",
    });
  });

  test("switch-role without a target (or an invalid one) denies (unknown-resource)", () => {
    const user = account("u-1", ["viewer"]);
    expect(authorize(user, "account.switch-role", {})).toEqual({
      allowed: false,
      reason: "unknown-resource",
    });
    expect(authorize(user, "account.switch-role", { targetRole: "wizard" as never })).toEqual({
      allowed: false,
      reason: "unknown-resource",
    });
  });
});

describe("the grants matrix (role-experience-matrix rows)", () => {
  test("account.read: any authenticated account", () => {
    expect(authorize(account("u-1", []), "account.read")).toEqual({
      allowed: true,
      via: "authenticated-self",
    });
  });

  test("media-session.create: creator, rights-holder, operator — NOT viewer/analyst", () => {
    expect(authorize(account("u-1", ["viewer"]), "media-session.create")).toEqual({
      allowed: false,
      reason: "role-not-granted",
    });
    expect(authorize(account("u-2", ["analyst"]), "media-session.create")).toEqual({
      allowed: false,
      reason: "role-not-granted",
    });
    expect(authorize(account("u-3", ["creator"]), "media-session.create")).toEqual({
      allowed: true,
      via: "grant:creator",
    });
    expect(authorize(account("u-4", ["rights-holder"]), "media-session.create")).toEqual({
      allowed: true,
      via: "grant:rights-holder",
    });
    expect(authorize(account("u-5", ["operator"]), "media-session.create")).toEqual({
      allowed: true,
      via: "grant:operator",
    });
    // a mixed grant takes a deterministic precedence (first matching in the
    // closed grant order: creator > rights-holder > operator)
    expect(authorize(account("u-6", ["operator", "creator"]), "media-session.create")).toEqual({
      allowed: true,
      via: "grant:creator",
    });
  });

  test("media-session.read / terminate / render-output.read: the OWNER, or an operator — nobody else", () => {
    const owner = account("u-owner", ["creator"]);
    const otherCreator = account("u-other", ["creator", "analyst"]);
    const operator = account("u-op", ["operator", "viewer"]);
    for (const action of ["media-session.read", "media-session.terminate", "render-output.read"] as const) {
      expect(authorize(owner, action, { ownerId: "u-owner" })).toEqual({
        allowed: true,
        via: "resource-owner",
      });
      expect(authorize(otherCreator, action, { ownerId: "u-owner" })).toEqual({
        allowed: false,
        reason: "not-resource-owner",
      });
      expect(authorize(operator, action, { ownerId: "u-owner" })).toEqual({
        allowed: true,
        via: "grant:operator",
      });
    }
  });

  test("provider-health.read: operator only (the matrix's operational view)", () => {
    expect(authorize(account("u-1", ["creator", "rights-holder"]), "provider-health.read")).toEqual(
      { allowed: false, reason: "role-not-granted" },
    );
    expect(authorize(account("u-2", ["operator"]), "provider-health.read")).toEqual({
      allowed: true,
      via: "grant:operator",
    });
  });

  test("account.switch-role: allowed exactly for held roles", () => {
    const user = account("u-1", ["viewer", "creator"]);
    expect(authorize(user, "account.switch-role", { targetRole: "creator" })).toEqual({
      allowed: true,
      via: "authenticated-self",
    });
    expect(authorize(user, "account.switch-role", { targetRole: "operator" })).toEqual({
      allowed: false,
      reason: "role-not-granted",
    });
  });
});

describe("the ACTIVE ROLE never influences a decision (roles-are-grants)", () => {
  test("an operator grant decides, regardless of any active-role presentation", () => {
    const accountWithOperator = account("u-1", ["viewer", "operator"]);
    // The policy receives grants only; there is no activeRole input at all —
    // pin that the decision type cannot even express one.
    const decision = authorize(accountWithOperator, "provider-health.read");
    expect(decision).toEqual({ allowed: true, via: "grant:operator" });
  });

  test("a viewer-only account is denied operator actions even with every OTHER grant present", () => {
    const user = account("u-2", ["viewer", "creator", "analyst", "rights-holder"]);
    expect(authorize(user, "provider-health.read")).toEqual({
      allowed: false,
      reason: "role-not-granted",
    });
    expect(authorize(user, "media-session.read", { ownerId: "someone-else" })).toEqual({
      allowed: false,
      reason: "not-resource-owner",
    });
  });

  test("decisions are pure: the same inputs always yield the same decision object", () => {
    const user = account("u-1", ["creator"]);
    expect(authorize(user, "media-session.read", { ownerId: "u-1" })).toEqual(
      authorize(user, "media-session.read", { ownerId: "u-1" }),
    );
    expect(authorize(user, "media-session.read", { ownerId: "u-2" })).toEqual(
      authorize(user, "media-session.read", { ownerId: "u-2" }),
    );
  });
});
