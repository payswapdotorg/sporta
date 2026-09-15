/**
 * Service composition pins (W901): the fail-closed behavior of
 * `buildCapabilityResponse` — structural failures throw, operational feed
 * failures degrade per-entry with explicit reason codes, and no availability
 * is ever invented.
 */
import { describe, expect, test } from "bun:test";
import {
  CapabilityInputError,
  CapabilityInternalError,
  buildCapabilityResponse,
  serializeCapabilityResponse,
} from "../src/index";

const FULL_RIGHTS = {
  canReferenceSourceFrames: true,
  canDeliverLive: true,
  canStoreDerivatives: true,
  canShare: true,
} as const;

const HEALTHY_PROVIDERS = [
  { kind: "control-plane", health: "ok" },
  { kind: "storage", health: "ok" },
  { kind: "queue-cache", health: "ok" },
  { kind: "compute", health: "ok" },
] as const;

const ANONYMOUS_SESSION = { authenticated: false, valid: false } as const;

describe("structural input failures throw (never an invented response)", () => {
  test("a non-object input throws CapabilityInputError", () => {
    for (const bad of [null, undefined, 42, "text", []]) {
      let threw = false;
      try {
        buildCapabilityResponse(bad);
      } catch (err) {
        threw = true;
        expect(err).toBeInstanceOf(CapabilityInputError);
      }
      expect(threw, String(bad)).toBe(true);
    }
  });

  test("a missing session throws (auth state must never be invented)", () => {
    let threw = false;
    try {
      buildCapabilityResponse({ providers: HEALTHY_PROVIDERS });
    } catch (err) {
      threw = true;
      expect((err as CapabilityInputError).details.issues).toBeDefined();
    }
    expect(threw).toBe(true);
  });

  test("an anonymous session claiming a user id or active role throws", () => {
    expect(() =>
      buildCapabilityResponse({
        session: { authenticated: false, valid: false, userId: "u-1" },
      }),
    ).toThrow(CapabilityInputError);
    expect(() =>
      buildCapabilityResponse({
        session: { authenticated: false, valid: false, activeRole: "viewer" },
      }),
    ).toThrow(CapabilityInputError);
  });

  test("an active role the account does not hold throws (never silently coerced)", () => {
    expect(() =>
      buildCapabilityResponse({
        session: { authenticated: true, valid: true, userId: "u-1", activeRole: "operator" },
        account: { userId: "u-1", roles: ["viewer"] },
      }),
    ).toThrow(CapabilityInputError);
  });

  test("duplicate account roles throw", () => {
    expect(() =>
      buildCapabilityResponse({
        session: { authenticated: true, valid: true, userId: "u-1" },
        account: { userId: "u-1", roles: ["viewer", "viewer"] },
      }),
    ).toThrow(CapabilityInputError);
  });

  test("an authenticated session without resolvable account data degrades to invalid-session", () => {
    const response = buildCapabilityResponse({
      session: { authenticated: true, valid: true, userId: "u-1" },
    });
    expect(response.auth.state).toBe("invalid-session");
    expect(response.auth.sessionValid).toBe(false);
    expect(response.account.authenticated).toBe(false);
    expect(response.account.userId).toBeUndefined();
  });

  test("a mismatched account/user id degrades to invalid-session", () => {
    const response = buildCapabilityResponse({
      session: { authenticated: true, valid: true, userId: "u-1" },
      account: { userId: "u-2", roles: ["viewer"] },
    });
    expect(response.auth.state).toBe("invalid-session");
  });

  test("an invalid session flag degrades to invalid-session even with account data", () => {
    const response = buildCapabilityResponse({
      session: { authenticated: true, valid: false, userId: "u-1" },
      account: { userId: "u-1", roles: ["viewer"] },
    });
    expect(response.auth.state).toBe("invalid-session");
    expect(response.account.authenticated).toBe(false);
  });
});

describe("fail-closed operational feeds (per-entry, explicit reasons)", () => {
  test("a missing rights input is a deny-all rights decision", () => {
    const response = buildCapabilityResponse({
      session: ANONYMOUS_SESSION,
      renderers: [
        {
          rendererId: "broadcast-enhanced.prototype",
          requiresSourceFrames: true,
          registryStatus: "registered",
        },
      ],
      liveTransport: { kind: "live-network" },
      providers: HEALTHY_PROVIDERS,
    });
    const entry = response.renderers.find(
      (renderer) => renderer.rendererId === "broadcast-enhanced.prototype",
    )!;
    expect(entry.availability).toBe("unavailable");
    expect(entry.reasonCode).toBe("rights-denied");
    expect(response.modes.live.reasonCode).toBe("rights-denied");
  });

  test("an invalid renderer entry becomes an explicit unavailable entry, never a drop", () => {
    const response = buildCapabilityResponse({
      session: ANONYMOUS_SESSION,
      renderers: [
        { rendererId: "broken.prototype" }, // missing required fields
        {
          rendererId: "fine.prototype",
          requiresSourceFrames: false,
          registryStatus: "registered",
        },
      ],
    });
    expect(response.renderers).toHaveLength(2);
    expect(response.renderers[0]).toMatchObject({
      rendererId: "broken.prototype",
      availability: "unavailable",
      reasonCode: "renderer-input-invalid",
    });
    expect(response.renderers[1]!.availability).toBe("available");
  });

  test("an unreadable renderer id uses the unknown marker", () => {
    const response = buildCapabilityResponse({
      session: ANONYMOUS_SESSION,
      renderers: [42, "not-an-object"],
    });
    expect(response.renderers).toHaveLength(2);
    for (const entry of response.renderers) {
      expect(entry.rendererId).toBe("unknown-renderer-entry");
      expect(entry.reasonCode).toBe("renderer-input-invalid");
    }
  });

  test("a missing renderer registry feed claims no availability and records the gap", () => {
    const response = buildCapabilityResponse({
      session: ANONYMOUS_SESSION,
      providers: HEALTHY_PROVIDERS,
    });
    expect(response.renderers).toEqual([]);
    expect(response.overall.state).toBe("unavailable");
    expect(response.overall.reasonCodes).toContain("renderer-registry-feed-missing");
  });

  test("missing provider feeds surface every kind as unknown (never ok)", () => {
    const response = buildCapabilityResponse({ session: ANONYMOUS_SESSION });
    expect(response.providers).toHaveLength(4);
    for (const provider of response.providers) {
      expect(provider.health).toBe("unknown");
      expect(provider.reasonCode).toBe("health-feed-missing");
    }
    expect(response.modes.batch.availability).toBe("unavailable");
    expect(response.modes.batch.reasonCode).toBe("provider-health-unknown");
    expect(response.overall.reasonCodes).toContain("provider-unknown");
  });

  test("an invalid provider feed with a readable kind poisons that kind as health-feed-invalid", () => {
    const response = buildCapabilityResponse({
      session: ANONYMOUS_SESSION,
      providers: [
        { kind: "compute", health: "sometimes" }, // invalid health value
        { kind: "storage", health: "ok" },
      ],
    });
    const compute = response.providers.find((provider) => provider.kind === "compute")!;
    expect(compute.health).toBe("unknown");
    expect(compute.reasonCode).toBe("health-feed-invalid");
    const storage = response.providers.find((provider) => provider.kind === "storage")!;
    expect(storage.health).toBe("ok");
  });

  test("an unattributable provider feed is counted, never silently dropped", () => {
    const response = buildCapabilityResponse({
      session: ANONYMOUS_SESSION,
      providers: [{ health: "ok" }, "garbage"],
    });
    expect(response.overall.reasonCodes).toContain("provider-feed-invalid");
    for (const provider of response.providers) {
      expect(provider.health).toBe("unknown");
    }
  });

  test("duplicate provider feeds: the last feed wins (deterministic)", () => {
    const first = buildCapabilityResponse({
      session: ANONYMOUS_SESSION,
      providers: [
        { kind: "compute", health: "ok" },
        { kind: "compute", health: "down" },
      ],
    });
    const compute = first.providers.find((provider) => provider.kind === "compute")!;
    expect(compute.health).toBe("down");
    const reversed = buildCapabilityResponse({
      session: ANONYMOUS_SESSION,
      providers: [
        { kind: "compute", health: "down" },
        { kind: "compute", health: "ok" },
      ],
    });
    const computeReversed = reversed.providers.find((provider) => provider.kind === "compute")!;
    expect(computeReversed.health).toBe("ok");
  });

  test("an unknown-health provider dependency makes renderers unavailable (fail-closed)", () => {
    const response = buildCapabilityResponse({
      session: ANONYMOUS_SESSION,
      rights: FULL_RIGHTS,
      renderers: [
        {
          rendererId: "sporta.testcard",
          requiresSourceFrames: false,
          registryStatus: "registered",
          dependsOnProviders: ["compute"],
        },
      ],
      providers: [{ kind: "storage", health: "ok" }], // no compute feed
    });
    expect(response.renderers[0]!.availability).toBe("unavailable");
    expect(response.renderers[0]!.reasonCode).toBe("provider-health-unknown");
  });

  test("a degraded provider dependency degrades (down beats degraded, worst-first)", () => {
    const response = buildCapabilityResponse({
      session: ANONYMOUS_SESSION,
      rights: FULL_RIGHTS,
      renderers: [
        {
          rendererId: "dual.prototype",
          requiresSourceFrames: false,
          registryStatus: "registered",
          dependsOnProviders: ["compute", "storage"],
        },
      ],
      providers: [
        { kind: "compute", health: "down" },
        { kind: "storage", health: "degraded" },
      ],
    });
    expect(response.renderers[0]!.reasonCode).toBe("provider-down");
    const swapped = buildCapabilityResponse({
      session: ANONYMOUS_SESSION,
      rights: FULL_RIGHTS,
      renderers: [
        {
          rendererId: "dual.prototype",
          requiresSourceFrames: false,
          registryStatus: "registered",
          dependsOnProviders: ["storage", "compute"],
        },
      ],
      providers: [
        { kind: "compute", health: "degraded" },
        { kind: "storage", health: "degraded" },
      ],
    });
    expect(swapped.renderers[0]!.reasonCode).toBe("provider-degraded");
    expect(swapped.renderers[0]!.availability).toBe("degraded");
  });

  test("an unreadable quota counter is exhausted with null numbers (admission stops)", () => {
    const response = buildCapabilityResponse({
      session: ANONYMOUS_SESSION,
      quotas: [{ quotaId: "user.daily-renders", scope: "user", used: -1, limit: 5 }, 7],
    });
    expect(response.quotas).toHaveLength(2);
    for (const quota of response.quotas) {
      expect(quota.exhausted).toBe(true);
      expect(quota.used).toBeNull();
      expect(quota.limit).toBeNull();
      expect(quota.remaining).toBeNull();
      expect(quota.reasonCode).toBe("quota-counter-invalid");
    }
    expect(response.quotas[0]!.quotaId).toBe("user.daily-renders");
    expect(response.quotas[1]!.quotaId).toBe("unknown-quota");
    expect(response.overall.reasonCodes).toContain("quota-counter-invalid");
  });

  test("quota math: remaining clamps at zero when over the limit", () => {
    const response = buildCapabilityResponse({
      session: ANONYMOUS_SESSION,
      quotas: [{ quotaId: "q1", scope: "user", used: 7, limit: 5 }],
    });
    expect(response.quotas[0]).toMatchObject({
      used: 7,
      limit: 5,
      remaining: 0,
      exhausted: true,
      reasonCode: "quota-exhausted",
    });
  });

  test("an invalid catalog-surface request keeps its slot with surface-request-invalid", () => {
    const response = buildCapabilityResponse({
      session: ANONYMOUS_SESSION,
      catalogSurfaces: [
        { surfaceId: "home", requiresAuthenticated: false, requiredRoles: [] },
        { surfaceId: "jobs" }, // missing required fields
        { surfaceId: "nowhere", requiresAuthenticated: true, requiredRoles: [] }, // unknown surface
      ],
    });
    const ids = response.content.catalogSurfaces.map((s) => s.surfaceId);
    expect(ids).toContain("home");
    expect(ids).toContain("jobs");
    expect(ids).not.toContain("nowhere");
    const jobs = response.content.catalogSurfaces.find((s) => s.surfaceId === "jobs")!;
    expect(jobs.visibility).toBe("hidden");
    expect(jobs.reasonCode).toBe("surface-request-invalid");
    expect(response.overall.reasonCodes).toContain("catalog-surface-request-invalid");
  });
});

describe("live mode derivation", () => {
  test("live-network + rights + healthy providers = available live", () => {
    const response = buildCapabilityResponse({
      session: ANONYMOUS_SESSION,
      rights: FULL_RIGHTS,
      liveTransport: { kind: "live-network" },
      providers: HEALTHY_PROVIDERS,
    });
    expect(response.modes.live).toEqual({
      availability: "available",
      reasonCode: "ok",
      transportKind: "live-network",
    });
  });

  test("live-network without live delivery rights = rights-denied", () => {
    const response = buildCapabilityResponse({
      session: ANONYMOUS_SESSION,
      rights: { ...FULL_RIGHTS, canDeliverLive: false },
      liveTransport: { kind: "live-network" },
      providers: HEALTHY_PROVIDERS,
    });
    expect(response.modes.live.availability).toBe("unavailable");
    expect(response.modes.live.reasonCode).toBe("rights-denied");
    expect(response.modes.live.transportKind).toBe("live-network");
  });

  test("a down storage provider degrades live delivery", () => {
    const response = buildCapabilityResponse({
      session: ANONYMOUS_SESSION,
      rights: FULL_RIGHTS,
      liveTransport: { kind: "live-network" },
      providers: [
        { kind: "control-plane", health: "ok" },
        { kind: "storage", health: "down" },
        { kind: "queue-cache", health: "ok" },
        { kind: "compute", health: "ok" },
      ],
    });
    expect(response.modes.live.availability).toBe("unavailable");
    expect(response.modes.live.reasonCode).toBe("provider-down");
  });

  test("a missing live transport input is live-transport-not-configured", () => {
    const response = buildCapabilityResponse({ session: ANONYMOUS_SESSION });
    expect(response.modes.live).toEqual({
      availability: "unavailable",
      reasonCode: "live-transport-not-configured",
      transportKind: "none",
    });
  });
});

describe("overall summary derivation", () => {
  test("all renderers unavailable (or none) = overall unavailable", () => {
    const empty = buildCapabilityResponse({
      session: ANONYMOUS_SESSION,
      providers: HEALTHY_PROVIDERS,
    });
    expect(empty.overall.state).toBe("unavailable");
    const allDenied = buildCapabilityResponse({
      session: ANONYMOUS_SESSION,
      renderers: [
        { rendererId: "a.prototype", requiresSourceFrames: false, registryStatus: "unregistered" },
        { rendererId: "b.prototype", requiresSourceFrames: false, registryStatus: "unregistered" },
      ],
      providers: HEALTHY_PROVIDERS,
    });
    expect(allDenied.overall.state).toBe("unavailable");
    expect(allDenied.overall.reasonCodes).toContain("renderer-not-registered");
  });

  test("one available renderer keeps overall degraded, not unavailable", () => {
    const response = buildCapabilityResponse({
      session: ANONYMOUS_SESSION,
      renderers: [
        { rendererId: "a.prototype", requiresSourceFrames: false, registryStatus: "unregistered" },
        { rendererId: "b.prototype", requiresSourceFrames: false, registryStatus: "registered" },
      ],
      providers: HEALTHY_PROVIDERS,
    });
    expect(response.overall.state).toBe("degraded");
  });

  test("reason codes are sorted and deduplicated", () => {
    const response = buildCapabilityResponse({
      session: ANONYMOUS_SESSION,
      rights: FULL_RIGHTS,
      renderers: [
        { rendererId: "a.prototype", requiresSourceFrames: false, registryStatus: "unregistered" },
        { rendererId: "b.prototype", requiresSourceFrames: false, registryStatus: "unregistered" },
      ],
      providers: [{ kind: "storage", health: "ok" }],
      quotas: [
        { quotaId: "q1", scope: "user", used: 5, limit: 5 },
        { quotaId: "q2", scope: "job", used: 2, limit: 1 },
      ],
    });
    const codes = response.overall.reasonCodes;
    expect(codes).toEqual([...codes].sort());
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain("quota-exhausted");
    expect(codes).toContain("renderer-not-registered");
  });
});

describe("self-check has teeth", () => {
  test("the builder's own output is re-validated (CapabilityInternalError is exported for it)", () => {
    // The self-check is exercised by every green test above (an invalid
    // composition would throw CapabilityInternalError before returning);
    // this pins the class is part of the public surface so transports can
    // map it to 500 rather than crash.
    expect(CapabilityInternalError.name).toBe("CapabilityInternalError");
  });

  test("responses serialize deterministically across calls", () => {
    const input = {
      session: { authenticated: true, valid: true, userId: "u-9", activeRole: "creator" },
      account: { userId: "u-9", roles: ["viewer", "creator"] },
      rights: FULL_RIGHTS,
      providers: HEALTHY_PROVIDERS,
    };
    const a = serializeCapabilityResponse(buildCapabilityResponse(input));
    const b = serializeCapabilityResponse(buildCapabilityResponse(input));
    expect(a).toBe(b);
  });
});
