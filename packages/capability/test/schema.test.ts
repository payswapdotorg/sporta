/**
 * Schema pins (W901): exact keys, closed vocabularies, pinned literals, and
 * the cross-field invariants that make an invalid response UNPARSEABLE — the
 * fail-closed trust boundary a frontend consumes.
 */
import { describe, expect, test } from "bun:test";
import {
  ACTIVE_ROLE_CONTEXT_NOTE,
  CAPABILITY_SCHEMA_VERSION,
  CapabilityInputError,
  CapabilityResponseSchema,
  DENY_ALL_RIGHTS,
  ROLES_ARE_GRANTS_NOTE,
  buildCapabilityResponse,
  parseCapabilityResponse,
  serializeCapabilityResponse,
} from "../src/index";
import type { CapabilityResponse } from "../src/index";

/** A minimal healthy response the mutation tests start from. */
function healthyResponse(): CapabilityResponse {
  return buildCapabilityResponse({
    requestContext: { requestId: "req-schema-001" },
    session: { authenticated: true, valid: true, userId: "u-1", activeRole: "viewer" },
    account: { userId: "u-1", roles: ["viewer"] },
    rights: {
      canReferenceSourceFrames: true,
      canDeliverLive: true,
      canStoreDerivatives: true,
      canShare: true,
    },
    renderers: [
      {
        rendererId: "sporta.testcard",
        rendererVersion: "0.1.0",
        rendererClass: "tactical",
        requiresSourceFrames: false,
        registryStatus: "registered",
        dependsOnProviders: ["compute"],
      },
    ],
    liveTransport: { kind: "live-network" },
    quotas: [{ quotaId: "user.daily-renders", scope: "user", used: 0, limit: 10 }],
    providers: [
      { kind: "control-plane", health: "ok" },
      { kind: "storage", health: "ok" },
      { kind: "queue-cache", health: "ok" },
      { kind: "compute", health: "ok" },
    ],
  });
}

describe("schema basics", () => {
  test("a healthy response validates", () => {
    const response = healthyResponse();
    const result = CapabilityResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
    expect(response.schemaVersion).toBe(CAPABILITY_SCHEMA_VERSION);
    expect(response.overall.state).toBe("ready");
    expect(response.overall.reasonCodes).toEqual([]);
  });

  test("the schema version is a pinned literal, not a free string", () => {
    const response = healthyResponse();
    expect(CapabilityResponseSchema.safeParse({ ...response, schemaVersion: "2.0" }).success).toBe(
      false,
    );
    expect(CapabilityResponseSchema.safeParse({ ...response, schemaVersion: "1.1" }).success).toBe(
      false,
    );
    expect(CapabilityResponseSchema.safeParse({ ...response, schemaVersion: 1.0 }).success).toBe(
      false,
    );
  });

  test("the two normative notes are pinned literals", () => {
    const response = healthyResponse();
    expect(response.auth.activeRoleContextNote).toBe(ACTIVE_ROLE_CONTEXT_NOTE);
    expect(response.account.rolesAreGrantsNote).toBe(ROLES_ARE_GRANTS_NOTE);
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        auth: { ...response.auth, activeRoleContextNote: "roles are whatever" },
      }).success,
    ).toBe(false);
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        account: { ...response.account, rolesAreGrantsNote: "roles are authority" },
      }).success,
    ).toBe(false);
  });
});

describe("unknown-key rejection (exact-key objects)", () => {
  test("an unknown top-level key is rejected", () => {
    const response = healthyResponse();
    const result = CapabilityResponseSchema.safeParse({ ...response, extra: true });
    expect(result.success).toBe(false);
  });

  test("unknown keys are rejected in every nested section", () => {
    const response = healthyResponse();
    const mutations: Array<(r: CapabilityResponse) => unknown> = [
      (r) => ({ ...r, auth: { ...r.auth, token: "secret" } }),
      (r) => ({ ...r, account: { ...r.account, isAdmin: true } }),
      (r) => ({ ...r, renderers: [{ ...r.renderers[0]!, gpu: "h100" }] }),
      (r) => ({ ...r, modes: { ...r.modes, live: { ...r.modes.live, lateness: 5 } } }),
      (r) => ({ ...r, quotas: [{ ...r.quotas[0]!, reset: "tomorrow" }] }),
      (r) => ({ ...r, providers: [{ ...r.providers[0]!, region: "eu" }] }),
      (r) => ({
        ...r,
        content: { catalogSurfaces: [{ ...r.content.catalogSurfaces[0]!, badge: "new" }] },
      }),
      (r) => ({ ...r, overall: { ...r.overall, score: 0.9 } }),
    ];
    for (const mutate of mutations) {
      expect(CapabilityResponseSchema.safeParse(mutate(response)).success, String(mutate)).toBe(
        false,
      );
    }
  });

  test("unknown service-input keys are rejected (the input seam is exact too)", () => {
    let threw = false;
    try {
      buildCapabilityResponse({
        session: { authenticated: false, valid: false },
        sneakyField: 1,
      });
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(CapabilityInputError);
    }
    expect(threw).toBe(true);
  });
});

describe("closed vocabularies", () => {
  test("auth state vocabulary is closed", () => {
    const response = healthyResponse();
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        auth: { ...response.auth, state: "superuser" },
      }).success,
    ).toBe(false);
  });

  test("role vocabulary is closed", () => {
    const response = healthyResponse();
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        account: { ...response.account, roles: ["admin"] },
      }).success,
    ).toBe(false);
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        auth: { ...response.auth, activeRole: "superuser" },
      }).success,
    ).toBe(false);
  });

  test("availability vocabulary is closed", () => {
    const response = healthyResponse();
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        renderers: [{ ...response.renderers[0]!, availability: "flaky" }],
      }).success,
    ).toBe(false);
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        renderers: [{ ...response.renderers[0]!, reasonCode: "just-because" }],
      }).success,
    ).toBe(false);
  });

  test("provider kind and health vocabularies are closed", () => {
    const response = healthyResponse();
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        providers: [{ ...response.providers[0]!, kind: "gpu-cloud" }],
      }).success,
    ).toBe(false);
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        providers: [{ ...response.providers[0]!, health: "on-fire" }],
      }).success,
    ).toBe(false);
  });

  test("the providers section must carry each canonical kind exactly once", () => {
    const response = healthyResponse();
    const missingOne = response.providers.slice(0, 3);
    expect(CapabilityResponseSchema.safeParse({ ...response, providers: missingOne }).success).toBe(
      false,
    );
    const duplicated = [
      response.providers[0]!,
      response.providers[0]!,
      response.providers[2]!,
      response.providers[3]!,
    ];
    expect(
      CapabilityResponseSchema.safeParse({ ...response, providers: duplicated }).success,
    ).toBe(false);
  });

  test("quota scope and surface vocabularies are closed", () => {
    const response = healthyResponse();
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        quotas: [{ ...response.quotas[0]!, scope: "team" }],
      }).success,
    ).toBe(false);
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        content: { catalogSurfaces: [{ ...r0(response), surfaceId: "arcade" }] },
      }).success,
    ).toBe(false);
  });

  test("overall state vocabulary is closed and reason codes are strings", () => {
    const response = healthyResponse();
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        overall: { state: "broken", reasonCodes: ["x"] },
      }).success,
    ).toBe(false);
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        overall: { state: "degraded", reasonCodes: [42] },
      }).success,
    ).toBe(false);
  });
});

function r0(response: CapabilityResponse): CapabilityResponse["content"]["catalogSurfaces"][number] {
  return response.content.catalogSurfaces[0]!;
}

describe("cross-field invariants (invalid responses are unparseable)", () => {
  test("an authenticated state requires a valid session and account data", () => {
    const response = healthyResponse();
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        auth: { ...response.auth, sessionValid: false },
      }).success,
    ).toBe(false);
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        account: { ...response.account, authenticated: false },
      }).success,
    ).toBe(false);
    const { userId, ...accountWithoutId } = response.account;
    expect(userId).toBe("u-1");
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        account: { ...accountWithoutId, authenticated: true },
      }).success,
    ).toBe(false);
  });

  test("an anonymous state may not carry a userId or active role", () => {
    const response = healthyResponse();
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        auth: { ...response.auth, state: "anonymous" },
      }).success,
    ).toBe(false);
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        auth: { ...response.auth, activeRole: "operator" },
        account: { ...response.account, authenticated: false, roles: ["operator"] },
      }).success,
    ).toBe(false);
  });

  test("the active role must be one of the account's grants", () => {
    const response = healthyResponse();
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        auth: { ...response.auth, activeRole: "operator" },
      }).success,
    ).toBe(false);
  });

  test("renderer availability and reason code must agree (both directions)", () => {
    const response = healthyResponse();
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        renderers: [{ ...response.renderers[0]!, availability: "degraded", reasonCode: "ok" }],
      }).success,
    ).toBe(false);
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        renderers: [
          { ...response.renderers[0]!, availability: "available", reasonCode: "rights-denied" },
        ],
      }).success,
    ).toBe(false);
  });

  test("rights-awareness must match requiresSourceFrames", () => {
    const response = healthyResponse();
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        renderers: [{ ...response.renderers[0]!, rightsAwareness: "rights-evaluated" }],
      }).success,
    ).toBe(false);
  });

  test("SIMULATION F: live can only be available with live-network transport evidence", () => {
    const response = healthyResponse();
    // The healthy response here IS live-network available; flip the evidence
    // to in-process while keeping availability — must become unparseable.
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        modes: {
          ...response.modes,
          live: { availability: "available", reasonCode: "ok", transportKind: "in-process" },
        },
      }).success,
    ).toBe(false);
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        modes: {
          ...response.modes,
          live: { availability: "available", reasonCode: "ok", transportKind: "none" },
        },
      }).success,
    ).toBe(false);
  });

  test("in-process transport is always reported as in-process-transport-not-live", () => {
    const response = healthyResponse();
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        modes: {
          ...response.modes,
          live: {
            availability: "unavailable",
            reasonCode: "live-transport-not-configured",
            transportKind: "in-process",
          },
        },
      }).success,
    ).toBe(false);
  });

  test("mode availability and reason codes must agree", () => {
    const response = healthyResponse();
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        modes: { ...response.modes, batch: { availability: "available", reasonCode: "provider-down" } },
      }).success,
    ).toBe(false);
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        modes: { ...response.modes, batch: { availability: "unavailable", reasonCode: "ok" } },
      }).success,
    ).toBe(false);
  });

  test("an exhausted quota has zero remaining; invalid counters are fully nulled", () => {
    const response = healthyResponse();
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        quotas: [{ ...response.quotas[0]!, exhausted: true, used: 9, limit: 10, remaining: 1 }],
      }).success,
    ).toBe(false);
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        quotas: [
          { ...response.quotas[0]!, reasonCode: "quota-counter-invalid", used: 5, limit: 5 },
        ],
      }).success,
    ).toBe(false);
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        quotas: [{ ...response.quotas[0]!, reasonCode: "quota-exhausted", exhausted: false }],
      }).success,
    ).toBe(false);
  });

  test("provider health and reason codes must agree", () => {
    const response = healthyResponse();
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        providers: [{ ...response.providers[0]!, health: "ok", reasonCode: "health-feed-missing" }],
      }).success,
    ).toBe(false);
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        providers: [{ ...response.providers[0]!, health: "down", reasonCode: "ok" }],
      }).success,
    ).toBe(false);
  });

  test("surface visibility and reason codes must agree", () => {
    const response = healthyResponse();
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        content: { catalogSurfaces: [{ ...r0(response), reasonCode: "role-not-granted" }] },
      }).success,
    ).toBe(false);
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        content: {
          catalogSurfaces: [{ ...r0(response), visibility: "hidden", reasonCode: "surface-visible" }],
        },
      }).success,
    ).toBe(false);
  });

  test("overall ready iff no reason codes (both directions)", () => {
    const response = healthyResponse();
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        overall: { state: "ready", reasonCodes: ["provider-degraded"] },
      }).success,
    ).toBe(false);
    expect(
      CapabilityResponseSchema.safeParse({
        ...response,
        overall: { state: "degraded", reasonCodes: [] },
      }).success,
    ).toBe(false);
  });
});

describe("serialization round-trips", () => {
  test("serialize → parse → serialize is byte-identical", () => {
    const response = healthyResponse();
    const first = serializeCapabilityResponse(response);
    const reparsed = parseCapabilityResponse(first);
    const second = serializeCapabilityResponse(reparsed);
    expect(second).toBe(first);
  });

  test("parseCapabilityResponse rejects invalid JSON bytes", () => {
    let threw = false;
    try {
      parseCapabilityResponse("{not json");
    } catch (err) {
      threw = true;
      expect((err as { name: string }).name).toBe("CapabilityParseError");
    }
    expect(threw).toBe(true);
  });

  test("parseCapabilityResponse rejects schema-invalid bytes", () => {
    const response = healthyResponse();
    const tampered = JSON.parse(serializeCapabilityResponse(response)) as Record<string, unknown>;
    const auth = tampered.auth as Record<string, unknown>;
    auth.state = "root";
    let threw = false;
    try {
      parseCapabilityResponse(JSON.stringify(tampered));
    } catch (err) {
      threw = true;
      const details = (err as { details: { issues: string[] } }).details.issues.join(" ");
      expect(details.includes("auth")).toBe(true);
    }
    expect(threw).toBe(true);
  });

  test("the same input produces byte-identical responses (determinism)", () => {
    const input = {
      session: { authenticated: false, valid: false },
      renderers: [
        {
          rendererId: "anime.prototype",
          requiresSourceFrames: false,
          registryStatus: "registered",
        },
      ],
      quotas: [{ quotaId: "q", scope: "user" as const, used: 1, limit: 2 }],
    };
    const a = serializeCapabilityResponse(buildCapabilityResponse(input));
    const b = serializeCapabilityResponse(buildCapabilityResponse(input));
    expect(a).toBe(b);
  });
});

describe("DENY_ALL_RIGHTS export", () => {
  test("the exported deny-all matches the contracts fail-closed derivation", () => {
    expect(DENY_ALL_RIGHTS).toEqual({
      canReferenceSourceFrames: false,
      canDeliverLive: false,
      canStoreDerivatives: false,
      canShare: false,
    });
  });
});
