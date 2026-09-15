/**
 * The W901 capability-response contract — versioned, closed-vocabulary zod
 * schemas for everything the frontend renders from.
 *
 * DESIGN RULES (the acceptance gate "frontend can render entirely from
 * capability responses" made structural):
 *
 * - **Exact keys**: every object is a `z.strictObject` — unknown keys are
 *   REJECTED, never stripped, so a producer/consumer drift fails loud.
 * - **Closed vocabularies**: every enumerated field is a `z.enum` literal
 *   union. Free-form text appears only where it is explicitly allowed to be
 *   free-form (a provider feed's verbatim `detail`/`degradedMeaning`).
 * - **Pinned literals**: the schema version and the two normative notes
 *   (active-role context, grants-not-authority) are `z.literal`s — they are
 *   part of the frozen seam, not data.
 * - **Cross-field invariants are schema-level**, so an INVALID response
 *   cannot even be parsed (fail-closed at the trust boundary):
 *   - `auth.state === "authenticated"` requires a valid session and a userId;
 *   - `auth.activeRole`, when non-null, must be one of `account.roles`;
 *   - a renderer/mode marked `available` must carry reason code `ok` (and
 *     vice-versa: non-`ok` reason codes require non-`available`);
 *   - **Simulation F (architecture no-drift rule: in-process transport is
 *     never live network)**: `modes.live.availability === "available"`
 *     requires `modes.live.transportKind === "live-network"`;
 *   - an exhausted quota has zero remaining;
 *   - `overall.state === "ready"` if and only if `overall.reasonCodes` is
 *     empty (a degraded/unavailable response MUST explain itself).
 *
 * The response carries NO timestamps and NO generated identifiers: this
 * package is telemetry-neutral (no clock, no randomness, no collection). Time
 * and request identity are the CALLER's context (`requestContext.requestId`
 * is an echo of what the caller supplied, never generated here).
 */
import { z } from "zod";
import { RendererClass, RightsCapabilities } from "@sporta/contracts";
import { ACTIVE_ROLE_CONTEXT_NOTE, ROLES_ARE_GRANTS_NOTE, RoleSchema } from "./roles";
import { CAPABILITY_SCHEMA_VERSION } from "./versioning";

// ---------------------------------------------------------------------------
// Shared closed vocabularies
// ---------------------------------------------------------------------------

/** Coarse availability of one addressable capability (renderer, mode). */
export const Availability = z.enum(["available", "degraded", "unavailable"]);
export type Availability = z.infer<typeof Availability>;

/** The four canonical provider kinds the capability surface always reports. */
export const PROVIDER_KINDS = ["control-plane", "storage", "queue-cache", "compute"] as const;
export const ProviderKind = z.enum(PROVIDER_KINDS);
export type ProviderKind = z.infer<typeof ProviderKind>;

// ---------------------------------------------------------------------------
// requestContext
// ---------------------------------------------------------------------------

/** Caller-supplied request context (echo only — never generated here). */
export const RequestContext = z.strictObject({
  /** Caller's correlation id, echoed verbatim when one was supplied. */
  requestId: z.string().min(1).optional(),
});
export type RequestContext = z.infer<typeof RequestContext>;

// ---------------------------------------------------------------------------
// auth (auth state: authenticated/anonymous, session validity, active role)
// ---------------------------------------------------------------------------

/**
 * The resolved authentication state.
 *
 * - `authenticated` — a valid session backs the request;
 * - `anonymous` — no session was presented;
 * - `invalid-session` — a session was presented but is expired, revoked, or
 *   its account data could not be resolved (fail-closed: the frontend must
 *   re-authenticate, NEVER fall back to silently treating it as anonymous).
 */
export const AuthState = z.enum(["authenticated", "anonymous", "invalid-session"]);
export type AuthState = z.infer<typeof AuthState>;

export const AuthSection = z.strictObject({
  state: AuthState,
  /** Whether the presented session is currently valid (`false` for anonymous). */
  sessionValid: z.boolean(),
  /** The per-session presentation role, or `null` when none is active. */
  activeRole: RoleSchema.nullable(),
  /** The pinned context note (literal — see ./roles.ts). */
  activeRoleContextNote: z.literal(ACTIVE_ROLE_CONTEXT_NOTE),
});
export type AuthSection = z.infer<typeof AuthSection>;

// ---------------------------------------------------------------------------
// account (roles as grants, not authority)
// ---------------------------------------------------------------------------

export const AccountSection = z.strictObject({
  /** `true` iff `auth.state === "authenticated"`. */
  authenticated: z.boolean(),
  /** Stable account id — present if and only if `authenticated`. */
  userId: z.string().min(1).optional(),
  /** Role GRANTS held by the account (may be empty). */
  roles: z.array(RoleSchema),
  /** The pinned grants note (literal — see ./roles.ts). */
  rolesAreGrantsNote: z.literal(ROLES_ARE_GRANTS_NOTE),
});
export type AccountSection = z.infer<typeof AccountSection>;

// ---------------------------------------------------------------------------
// renderers (renderer availability entries)
// ---------------------------------------------------------------------------

/** Why a renderer entry has its availability (closed vocabulary). */
export const RendererReasonCode = z.enum([
  "ok",
  "renderer-registry-degraded",
  "renderer-not-registered",
  "rights-denied",
  "provider-down",
  "provider-degraded",
  "provider-health-unknown",
  "renderer-input-invalid",
]);
export type RendererReasonCode = z.infer<typeof RendererReasonCode>;

/**
 * Whether the availability of this renderer entry was materially derived from
 * the caller's rights state (`rights-evaluated` — it requires source frames,
 * so the fail-closed rights derivation gates it) or rights are not relevant to
 * it (`rights-not-relevant`).
 */
export const RightsAwareness = z.enum(["rights-evaluated", "rights-not-relevant"]);
export type RightsAwareness = z.infer<typeof RightsAwareness>;

export const RendererAvailability = z.strictObject({
  /** Renderer id (the `RendererCapability.rendererId` seam). */
  rendererId: z.string().min(1),
  /** Renderer version, when the registry knows one. */
  rendererVersion: z.string().min(1).optional(),
  /** Renderer class (the frozen `@sporta/contracts` vocabulary). */
  rendererClass: RendererClass.optional(),
  availability: Availability,
  reasonCode: RendererReasonCode,
  /** Whether this renderer consumes source frames (rights-relevant). */
  requiresSourceFrames: z.boolean(),
  rightsAwareness: RightsAwareness,
});
export type RendererAvailability = z.infer<typeof RendererAvailability>;

// ---------------------------------------------------------------------------
// modes (live/batch)
// ---------------------------------------------------------------------------

/** What live transport evidence backs the live mode entry. */
export const LiveTransportKind = z.enum(["live-network", "in-process", "none"]);
export type LiveTransportKind = z.infer<typeof LiveTransportKind>;

export const LiveModeReasonCode = z.enum([
  "ok",
  "in-process-transport-not-live",
  "live-transport-not-configured",
  "live-transport-input-invalid",
  "rights-denied",
  "provider-down",
  "provider-degraded",
  "provider-health-unknown",
]);
export type LiveModeReasonCode = z.infer<typeof LiveModeReasonCode>;

export const BatchModeReasonCode = z.enum([
  "ok",
  "provider-down",
  "provider-degraded",
  "provider-health-unknown",
  "batch-transport-input-invalid",
]);
export type BatchModeReasonCode = z.infer<typeof BatchModeReasonCode>;

export const LiveModeAvailability = z.strictObject({
  availability: Availability,
  reasonCode: LiveModeReasonCode,
  /** The transport evidence — NEVER claimed as live network unless it is. */
  transportKind: LiveTransportKind,
});
export type LiveModeAvailability = z.infer<typeof LiveModeAvailability>;

export const BatchModeAvailability = z.strictObject({
  availability: Availability,
  reasonCode: BatchModeReasonCode,
});
export type BatchModeAvailability = z.infer<typeof BatchModeAvailability>;

export const ModesSection = z.strictObject({
  live: LiveModeAvailability,
  batch: BatchModeAvailability,
});
export type ModesSection = z.infer<typeof ModesSection>;

// ---------------------------------------------------------------------------
// quotas
// ---------------------------------------------------------------------------

export const QuotaScope = z.enum(["user", "job"]);
export type QuotaScope = z.infer<typeof QuotaScope>;

export const QuotaReasonCode = z.enum(["ok", "quota-exhausted", "quota-counter-invalid"]);
export type QuotaReasonCode = z.infer<typeof QuotaReasonCode>;

/**
 * One quota's state. `null` numbers mean the counter could not be read
 * (fail-closed: `exhausted` is then `true` — unreadable capacity admits no new
 * work, Simulation E's admission-stop semantics — and the reason code says
 * why).
 */
export const QuotaState = z.strictObject({
  quotaId: z.string().min(1),
  /** `null` when the counter was unreadable. */
  scope: QuotaScope.nullable(),
  used: z.number().int().min(0).nullable(),
  limit: z.number().int().min(0).nullable(),
  remaining: z.number().int().min(0).nullable(),
  exhausted: z.boolean(),
  reasonCode: QuotaReasonCode,
});
export type QuotaState = z.infer<typeof QuotaState>;

export const QuotasSection = z.array(QuotaState);

// ---------------------------------------------------------------------------
// providers (provider health)
// ---------------------------------------------------------------------------

/**
 * How the capability layer knows this provider's health. `health-feed-missing`
 * and `health-feed-invalid` are the fail-closed no-data states; the
 * `feed-reported-*` codes carry a feed's verdict.
 */
export const ProviderReasonCode = z.enum([
  "ok",
  "health-feed-missing",
  "health-feed-invalid",
  "feed-reported-degraded",
  "feed-reported-down",
]);
export type ProviderReasonCode = z.infer<typeof ProviderReasonCode>;

/**
 * A provider's health. `unknown` is NOT "ok": it is the fail-closed state for
 * a missing or unreadable feed (the W805 health-rollup precedent:
 * no-data → unknown, never invented health). Downstream, a renderer that
 * depends on an `unknown` provider is `unavailable` with
 * `provider-health-unknown` — never optimistically available.
 */
export const ProviderHealthState = z.enum(["ok", "degraded", "down", "unknown"]);
export type ProviderHealthState = z.infer<typeof ProviderHealthState>;

export const ProviderHealth = z.strictObject({
  kind: ProviderKind,
  health: ProviderHealthState,
  reasonCode: ProviderReasonCode,
  /** The feed's verbatim detail line, when it supplied one. */
  detail: z.string().min(1).optional(),
  /** What the degraded state means for the user, when the feed explained it. */
  degradedMeaning: z.string().min(1).optional(),
});
export type ProviderHealth = z.infer<typeof ProviderHealth>;

/** The providers section always carries each canonical kind exactly once. */
export const ProvidersSection = z
  .array(ProviderHealth)
  .length(PROVIDER_KINDS.length)
  .refine(
    (providers) => {
      const kinds = providers.map((provider) => provider.kind);
      return (
        kinds.length === new Set(kinds).size &&
        PROVIDER_KINDS.every((expected) => kinds.includes(expected))
      );
    },
    { message: "the providers section must carry each provider kind exactly once" },
  );

// ---------------------------------------------------------------------------
// content (catalog surface visibility)
// ---------------------------------------------------------------------------

/**
 * The catalog/product surfaces (the role-experience matrix's product surface
 * map, closed vocabulary). `audit` appears once and serves both the
 * rights-holder (rights scope) and operator (system scope) surfaces.
 */
export const CATALOG_SURFACE_IDS = [
  "home",
  "live",
  "explore",
  "watch",
  "library",
  "create-studio",
  "jobs",
  "match-lab",
  "clips",
  "notes",
  "rights-center",
  "catalog",
  "audit",
  "operations",
  "health",
  "providers",
] as const;
export const CatalogSurfaceId = z.enum(CATALOG_SURFACE_IDS);
export type CatalogSurfaceId = z.infer<typeof CatalogSurfaceId>;

export const SurfaceVisibility = z.enum(["visible", "hidden"]);
export type SurfaceVisibility = z.infer<typeof SurfaceVisibility>;

/** Why a surface has its visibility (closed vocabulary). */
export const SurfaceReasonCode = z.enum([
  "surface-visible",
  "authentication-required",
  "role-not-granted",
  "surface-request-invalid",
]);
export type SurfaceReasonCode = z.infer<typeof SurfaceReasonCode>;

export const CatalogSurfaceAvailability = z.strictObject({
  surfaceId: CatalogSurfaceId,
  visibility: SurfaceVisibility,
  reasonCode: SurfaceReasonCode,
});
export type CatalogSurfaceAvailability = z.infer<typeof CatalogSurfaceAvailability>;

export const ContentSection = z.strictObject({
  catalogSurfaces: z.array(CatalogSurfaceAvailability),
});
export type ContentSection = z.infer<typeof ContentSection>;

// ---------------------------------------------------------------------------
// overall (the coarse app-level summary)
// ---------------------------------------------------------------------------

/**
 * The coarse worst-state across the response. Per-section entries remain
 * AUTHORITATIVE for UI state (a single unavailable renderer must not make
 * the whole app "unavailable"); `overall` exists for app-shell decisions
 * (e.g. an empty-state page when nothing can be rendered).
 *
 * DELIBERATELY EXCLUDES the live mode: a live-mode gap is the Live surface's
 * own `unavailable` state (Simulation F — live is absent until W915), not an
 * app-wide degradation; the app must not render globally degraded for it.
 * Overall summarizes the RENDER-capable surfaces: renderers, batch mode,
 * provider health, and quotas.
 */
export const OverallState = z.enum(["ready", "degraded", "unavailable"]);
export type OverallState = z.infer<typeof OverallState>;

export const OverallSection = z.strictObject({
  state: OverallState,
  /** Sorted, deduplicated reason codes from the non-ok sections; empty iff `ready`. */
  reasonCodes: z.array(z.string().min(1)),
});
export type OverallSection = z.infer<typeof OverallSection>;

// ---------------------------------------------------------------------------
// The response
// ---------------------------------------------------------------------------

/**
 * The W901 capability response (schema version 1.0). The frozen seam W904
 * consumes: every field the frontend needs to render discovery, watch,
 * create, and role workspaces — including every deny/degraded path — is
 * derived from real operational inputs by `./service.ts` and validated
 * against this schema.
 */
export const CapabilityResponse = z.strictObject({
  schemaVersion: z.literal(CAPABILITY_SCHEMA_VERSION),
  requestContext: RequestContext,
  auth: AuthSection,
  account: AccountSection,
  renderers: z.array(RendererAvailability),
  modes: ModesSection,
  quotas: QuotasSection,
  providers: ProvidersSection,
  content: ContentSection,
  overall: OverallSection,
});
export type CapabilityResponse = z.infer<typeof CapabilityResponse>;

// ---------------------------------------------------------------------------
// The service input (validated by ./service.ts)
// ---------------------------------------------------------------------------

/**
 * One renderer entry in the caller's registry snapshot. Entries are validated
 * INDIVIDUALLY by the service; an invalid entry becomes an explicit
 * `unavailable`/`renderer-input-invalid` response entry, never a silent drop.
 */
export const RendererRegistryEntry = z.strictObject({
  rendererId: z.string().min(1),
  rendererVersion: z.string().min(1).optional(),
  rendererClass: RendererClass.optional(),
  /** Whether the renderer consumes source frames (rights-relevant). */
  requiresSourceFrames: z.boolean(),
  registryStatus: z.enum(["registered", "unregistered", "degraded"]),
  /** Provider kinds this renderer's availability depends on (default none). */
  dependsOnProviders: z.array(ProviderKind).default([]),
});
export type RendererRegistryEntry = z.infer<typeof RendererRegistryEntry>;

/** A provider health feed entry (operational input). */
export const ProviderHealthFeed = z.strictObject({
  kind: ProviderKind,
  health: z.enum(["ok", "degraded", "down"]),
  /** Verbatim operational detail, carried through to the response. */
  detail: z.string().min(1).optional(),
  /** What a degraded state means for the user. */
  degradedMeaning: z.string().min(1).optional(),
});
export type ProviderHealthFeed = z.infer<typeof ProviderHealthFeed>;

/** A quota counter snapshot (operational input). */
export const QuotaCounter = z.strictObject({
  quotaId: z.string().min(1),
  scope: QuotaScope,
  used: z.number().int().min(0),
  limit: z.number().int().min(0),
});
export type QuotaCounter = z.infer<typeof QuotaCounter>;

/** A requested catalog surface with its visibility requirements. */
export const CatalogSurfaceRequest = z.strictObject({
  surfaceId: CatalogSurfaceId,
  requiresAuthenticated: z.boolean(),
  /** Any-of: the account must hold at least one of these grants. */
  requiredRoles: z.array(RoleSchema),
});
export type CatalogSurfaceRequest = z.infer<typeof CatalogSurfaceRequest>;

/** The live transport evidence input. */
export const LiveTransportInput = z.strictObject({
  kind: LiveTransportKind,
});

/**
 * The capability service input. `session` is REQUIRED (an undeterminable auth
 * state must never be invented); the operational feeds are optional and
 * degrade fail-closed per-entry (see ./service.ts):
 *
 * - `rights` — the derived fail-closed rights capabilities
 *   (`deriveRightsCapabilities` from `@sporta/contracts`, evaluated by the
 *   CALLER with its clock). Missing → DENY-ALL semantics (the frozen
 *   contracts rule: a missing rights decision denies).
 * - `renderers` — registry snapshot. Missing → no renderer availability is
 *   claimed at all (and `overall` records `renderer-registry-feed-missing`).
 * - `liveTransport` — the delivery adapter's evidence. Missing →
 *   `live-transport-not-configured`.
 * - `quotas` — counter snapshots. Missing → no quota entries.
 * - `providers` — health feeds. Missing → every kind surfaces `unknown`.
 * - `catalogSurfaces` — surface requests. Missing → the normative default
 *   set (./defaults.ts, pinned to the role-experience-matrix).
 */
export const CapabilityServiceInput = z.strictObject({
  requestContext: RequestContext.optional(),
  session: z.strictObject({
    authenticated: z.boolean(),
    valid: z.boolean(),
    userId: z.string().min(1).optional(),
    activeRole: RoleSchema.nullable().optional(),
  }),
  account: z
    .strictObject({
      userId: z.string().min(1).optional(),
      roles: z.array(RoleSchema).optional(),
    })
    .optional(),
  rights: RightsCapabilities.optional(),
  renderers: z.array(z.unknown()).optional(),
  liveTransport: LiveTransportInput.optional(),
  quotas: z.array(z.unknown()).optional(),
  providers: z.array(z.unknown()).optional(),
  catalogSurfaces: z.array(z.unknown()).optional(),
});
export type CapabilityServiceInput = z.infer<typeof CapabilityServiceInput>;

/**
 * The deny-all capabilities (mirrors `@sporta/contracts`' internal DENY_ALL
 * for a missing rights decision). Exported so tests can pin the fail-closed
 * semantics without importing contracts internals.
 */
export const DENY_ALL_RIGHTS: RightsCapabilities = {
  canReferenceSourceFrames: false,
  canDeliverLive: false,
  canStoreDerivatives: false,
  canShare: false,
};

// ---------------------------------------------------------------------------
// Cross-field response invariants (schema-level, fail-closed at parse time)
// ---------------------------------------------------------------------------

export const CapabilityResponseValidated = CapabilityResponse.superRefine((response, ctx) => {
  // Auth ↔ account consistency.
  if (response.auth.state === "authenticated") {
    if (!response.auth.sessionValid) {
      ctx.addIssue({
        code: "custom",
        path: ["auth", "sessionValid"],
        message: "an authenticated state requires a valid session",
      });
    }
    if (response.account.authenticated !== true || response.account.userId === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["account"],
        message: "an authenticated state requires account.authenticated and account.userId",
      });
    }
  } else {
    if (response.account.authenticated !== false || response.account.userId !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["account"],
        message: "only an authenticated state may carry account.userId",
      });
    }
    if (response.auth.activeRole !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["auth", "activeRole"],
        message: "only an authenticated state may carry an active role",
      });
    }
  }
  if (response.auth.state === "invalid-session" && response.auth.sessionValid) {
    ctx.addIssue({
      code: "custom",
      path: ["auth"],
      message: "an invalid-session state cannot claim a valid session",
    });
  }
  // The active role must be a grant the account actually holds.
  if (response.auth.activeRole !== null && !response.account.roles.includes(response.auth.activeRole)) {
    ctx.addIssue({
      code: "custom",
      path: ["auth", "activeRole"],
      message: "the active role must be one of the account's role grants",
    });
  }
  // Renderer availability ⟺ reason code "ok".
  for (const [index, renderer] of response.renderers.entries()) {
    if (renderer.availability === "available" && renderer.reasonCode !== "ok") {
      ctx.addIssue({
        code: "custom",
        path: ["renderers", index, "reasonCode"],
        message: "an available renderer must carry reason code ok",
      });
    }
    if (renderer.availability !== "available" && renderer.reasonCode === "ok") {
      ctx.addIssue({
        code: "custom",
        path: ["renderers", index, "reasonCode"],
        message: "a non-available renderer must carry a non-ok reason code",
      });
    }
    if (renderer.requiresSourceFrames && renderer.rightsAwareness !== "rights-evaluated") {
      ctx.addIssue({
        code: "custom",
        path: ["renderers", index, "rightsAwareness"],
        message: "a source-frame renderer must be rights-evaluated",
      });
    }
    if (!renderer.requiresSourceFrames && renderer.rightsAwareness !== "rights-not-relevant") {
      ctx.addIssue({
        code: "custom",
        path: ["renderers", index, "rightsAwareness"],
        message: "a renderer that does not require source frames is rights-not-relevant",
      });
    }
  }
  // Simulation F: in-process transport is never live network.
  if (response.modes.live.availability === "available") {
    if (response.modes.live.transportKind !== "live-network") {
      ctx.addIssue({
        code: "custom",
        path: ["modes", "live", "transportKind"],
        message:
          "live may only be available when the transport evidence is live-network (Simulation F)",
      });
    }
    if (response.modes.live.reasonCode !== "ok") {
      ctx.addIssue({
        code: "custom",
        path: ["modes", "live", "reasonCode"],
        message: "an available live mode must carry reason code ok",
      });
    }
  }
  if (response.modes.live.availability !== "available" && response.modes.live.reasonCode === "ok") {
    ctx.addIssue({
      code: "custom",
      path: ["modes", "live", "reasonCode"],
      message: "a non-available live mode must carry a non-ok reason code",
    });
  }
  if (response.modes.batch.availability === "available" && response.modes.batch.reasonCode !== "ok") {
    ctx.addIssue({
      code: "custom",
      path: ["modes", "batch", "reasonCode"],
      message: "an available batch mode must carry reason code ok",
    });
  }
  if (
    response.modes.batch.availability !== "available" &&
    response.modes.batch.reasonCode === "ok"
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["modes", "batch", "reasonCode"],
      message: "a non-available batch mode must carry a non-ok reason code",
    });
  }
  if (
    response.modes.live.transportKind === "in-process" &&
    response.modes.live.reasonCode !== "in-process-transport-not-live"
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["modes", "live", "reasonCode"],
      message:
        "in-process transport must be reported as in-process-transport-not-live (Simulation F)",
    });
  }
  // Quotas: exhausted ⟹ zero remaining; readable counters are fully populated.
  for (const [index, quota] of response.quotas.entries()) {
    if (quota.exhausted && quota.remaining !== 0 && quota.remaining !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["quotas", index, "remaining"],
        message: "an exhausted quota must have zero remaining",
      });
    }
    if (quota.reasonCode === "quota-counter-invalid") {
      if (!quota.exhausted || quota.used !== null || quota.limit !== null || quota.remaining !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["quotas", index],
          message:
            "an invalid quota counter must be exhausted with null used/limit/remaining (fail-closed)",
        });
      }
    } else {
      if (quota.used === null || quota.limit === null || quota.remaining === null) {
        ctx.addIssue({
          code: "custom",
          path: ["quotas", index],
          message: "a readable quota counter must carry non-null used/limit/remaining",
        });
      }
      if (quota.reasonCode === "quota-exhausted" && !quota.exhausted) {
        ctx.addIssue({
          code: "custom",
          path: ["quotas", index, "exhausted"],
          message: "reason code quota-exhausted requires exhausted true",
        });
      }
      if (quota.reasonCode === "ok" && quota.exhausted) {
        ctx.addIssue({
          code: "custom",
          path: ["quotas", index, "exhausted"],
          message: "reason code ok requires exhausted false",
        });
      }
    }
  }
  // Providers: an ok provider carries reason code ok; unknown/down are never ok.
  for (const [index, provider] of response.providers.entries()) {
    if (provider.health === "ok" && provider.reasonCode !== "ok") {
      ctx.addIssue({
        code: "custom",
        path: ["providers", index, "reasonCode"],
        message: "an ok provider must carry reason code ok",
      });
    }
    if (provider.health !== "ok" && provider.reasonCode === "ok") {
      ctx.addIssue({
        code: "custom",
        path: ["providers", index, "reasonCode"],
        message: "a non-ok provider must carry a non-ok reason code",
      });
    }
  }
  // Content: visible surfaces carry surface-visible; hidden carry a denial code.
  for (const [index, surface] of response.content.catalogSurfaces.entries()) {
    if (surface.visibility === "visible" && surface.reasonCode !== "surface-visible") {
      ctx.addIssue({
        code: "custom",
        path: ["content", "catalogSurfaces", index, "reasonCode"],
        message: "a visible surface must carry reason code surface-visible",
      });
    }
    if (
      surface.visibility === "hidden" &&
      surface.reasonCode !== "authentication-required" &&
      surface.reasonCode !== "role-not-granted" &&
      surface.reasonCode !== "surface-request-invalid"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["content", "catalogSurfaces", index, "reasonCode"],
        message: "a hidden surface must carry a denial reason code",
      });
    }
  }
  // Overall: ready ⟺ no reason codes.
  if (response.overall.state === "ready" && response.overall.reasonCodes.length !== 0) {
    ctx.addIssue({
      code: "custom",
      path: ["overall", "reasonCodes"],
      message: "a ready overall state must carry no reason codes",
    });
  }
  if (response.overall.state !== "ready" && response.overall.reasonCodes.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["overall", "reasonCodes"],
      message: "a non-ready overall state must explain itself with reason codes",
    });
  }
});

/**
 * The validated capability response schema — what `parseCapabilityResponse`
 * and `buildCapabilityResponse` check against (the plain {@link
 * CapabilityResponse} shape plus every cross-field invariant above).
 */
export const CapabilityResponseSchema = CapabilityResponseValidated;
