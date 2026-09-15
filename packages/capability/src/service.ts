/**
 * `buildCapabilityResponse` — the transport-free capability service (W901).
 *
 * A PURE composition: well-defined inputs → a VALIDATED
 * {@link CapabilityResponse}. No network, no clock, no randomness, no
 * collection — this package is the contract + composition layer only.
 *
 * FAIL-CLOSED RULES (the acceptance gate "never silent success, never
 * invented availability"):
 *
 * 1. **Structural input failures throw** (`CapabilityInputError`): a missing
 *    `session`, unknown top-level keys, or inconsistent identity data
 *    (anonymous + a claimed user id / active role, or an active role the
 *    account does not hold) never produce a response.
 * 2. **Operational feed failures degrade per-entry with explicit reason
 *    codes**: an invalid renderer registry entry becomes an `unavailable` /
 *    `renderer-input-invalid` entry; an unreadable quota counter becomes an
 *    exhausted `quota-counter-invalid` entry (admission stops — Simulation
 *    E); a missing provider health feed surfaces as `unknown` /
 *    `health-feed-missing` and anything depending on it is
 *    `provider-health-unknown`.
 * 3. **A missing rights input is a DENY-ALL rights decision** (the frozen
 *    `@sporta/contracts` rule: a missing decision denies), so rights-gated
 *    renderers and live delivery are refused with `rights-denied`.
 * 4. **The response is re-validated against its own schema before it is
 *    returned** — if the composition ever produced an invalid document, that
 *    is an internal error, never a silently-malformed response.
 */
import type {
  Availability,
  BatchModeAvailability,
  CapabilityResponse,
  CapabilityServiceInput,
  CatalogSurfaceAvailability,
  LiveModeAvailability,
  ProviderHealth,
  ProviderHealthFeed,
  QuotaCounter,
  QuotaState,
  RendererAvailability,
  RendererRegistryEntry,
  CatalogSurfaceRequest,
} from "./schema";
import {
  CATALOG_SURFACE_IDS,
  CapabilityResponseSchema,
  CapabilityServiceInput as CapabilityServiceInputSchema,
  CatalogSurfaceRequest as CatalogSurfaceRequestSchema,
  DENY_ALL_RIGHTS,
  PROVIDER_KINDS,
  ProviderHealthFeed as ProviderHealthFeedSchema,
  QuotaCounter as QuotaCounterSchema,
  RendererRegistryEntry as RendererRegistryEntrySchema,
} from "./schema";
import { CapabilityInternalError, CapabilityInputError } from "./errors";
import { DEFAULT_CATALOG_SURFACES } from "./defaults";
import { ACTIVE_ROLE_CONTEXT_NOTE, ROLES_ARE_GRANTS_NOTE, type Role } from "./roles";
import { CAPABILITY_SCHEMA_VERSION } from "./versioning";
import type { RightsCapabilities } from "@sporta/contracts";

/** Formats zod issues as `"path: message"` strings (the repo convention). */
function issuesOf(error: { issues: { path: PropertyKey[]; message: string }[] }): string[] {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Auth + account derivation
// ---------------------------------------------------------------------------

interface DerivedIdentity {
  authState: "authenticated" | "anonymous" | "invalid-session";
  sessionValid: boolean;
  activeRole: Role | null;
  userId: string | undefined;
  roles: Role[];
}

function deriveIdentity(input: CapabilityServiceInput): DerivedIdentity {
  const session = input.session;

  if (!session.authenticated) {
    // An anonymous request may not claim an active role or a user id.
    if (session.activeRole !== undefined && session.activeRole !== null) {
      throw new CapabilityInputError(
        "session.activeRole must be null when the session is not authenticated",
        { field: "session.activeRole" },
      );
    }
    if (session.userId !== undefined) {
      throw new CapabilityInputError(
        "session.userId must be absent when the session is not authenticated",
        { field: "session.userId" },
      );
    }
    return {
      authState: "anonymous",
      sessionValid: false,
      activeRole: null,
      userId: undefined,
      roles: [],
    };
  }

  // Authenticated: the session must be valid AND backed by consistent account
  // data, otherwise it degrades to invalid-session (fail-closed — never a
  // half-trusted authenticated state).
  if (!session.valid) {
    return {
      authState: "invalid-session",
      sessionValid: false,
      activeRole: null,
      userId: undefined,
      roles: [],
    };
  }
  const account = input.account;
  if (account === undefined || account.userId === undefined || account.userId !== session.userId) {
    return {
      authState: "invalid-session",
      sessionValid: false,
      activeRole: null,
      userId: undefined,
      roles: [],
    };
  }
  const roles = account.roles ?? [];
  if (roles.length !== new Set(roles).size) {
    throw new CapabilityInputError("account.roles must not contain duplicates", {
      field: "account.roles",
    });
  }
  const activeRole = session.activeRole ?? null;
  if (activeRole !== null && !roles.includes(activeRole)) {
    // A session claiming an active role the account does not hold is a caller
    // bug, not an operational degrade: fail loud (never silently coerce).
    throw new CapabilityInputError(
      `session.activeRole '${activeRole}' is not held by account '${account.userId}'`,
      { field: "session.activeRole", userId: account.userId, activeRole },
    );
  }
  return {
    authState: "authenticated",
    sessionValid: true,
    activeRole,
    userId: account.userId,
    roles,
  };
}

// ---------------------------------------------------------------------------
// Provider health feeds (per-entry fail-closed)
// ---------------------------------------------------------------------------

interface ProviderHealthIndex {
  byKind: Map<ProviderHealth["kind"], { health: ProviderHealth["health"]; entry: ProviderHealth }>;
  invalidFeedCount: number;
}

function indexProviderFeeds(rawFeeds: readonly unknown[]): ProviderHealthIndex {
  const byKind = new Map<ProviderHealth["kind"], { health: ProviderHealth["health"]; entry: ProviderHealth }>();
  let invalidFeedCount = 0;
  for (const raw of rawFeeds) {
    const parsed = ProviderHealthFeedSchema.safeParse(raw);
    if (!parsed.success) {
      // Best-effort attribution: a feed whose KIND is readable poisons that
      // kind's entry; an unattributable feed is counted (never silently
      // dropped — it surfaces in overall.reasonCodes as provider-feed-invalid).
      const kind = isRecord(raw) && typeof raw.kind === "string" ? raw.kind : undefined;
      if (kind !== undefined && (PROVIDER_KINDS as readonly string[]).includes(kind)) {
        byKind.set(kind as ProviderHealth["kind"], {
          health: "unknown",
          entry: {
            kind: kind as ProviderHealth["kind"],
            health: "unknown",
            reasonCode: "health-feed-invalid",
          },
        });
      } else {
        invalidFeedCount += 1;
      }
      continue;
    }
    const feed: ProviderHealthFeed = parsed.data;
    const reasonCode =
      feed.health === "ok"
        ? "ok"
        : feed.health === "degraded"
          ? "feed-reported-degraded"
          : "feed-reported-down";
    byKind.set(feed.kind, {
      health: feed.health,
      entry: {
        kind: feed.kind,
        health: feed.health,
        reasonCode,
        ...(feed.detail !== undefined ? { detail: feed.detail } : {}),
        ...(feed.degradedMeaning !== undefined ? { degradedMeaning: feed.degradedMeaning } : {}),
      },
    });
  }
  return { byKind, invalidFeedCount };
}

function providersSection(index: ProviderHealthIndex): ProviderHealth[] {
  // Every canonical kind is always present, in canonical order. Missing feed
  // → unknown/health-feed-missing (fail-closed: no invented health).
  return PROVIDER_KINDS.map(
    (kind) =>
      index.byKind.get(kind)?.entry ?? {
        kind,
        health: "unknown",
        reasonCode: "health-feed-missing",
      },
  );
}

/**
 * Worst-first provider dependency verdict for one renderer/mode. A `down`
 * dependency makes the thing unavailable; an `unknown` one ALSO makes it
 * unavailable (fail-closed: unobserved health is never treated as ok); a
 * merely degraded one degrades.
 */
function providerDependencyVerdict(
  dependencies: readonly ProviderHealth["kind"][],
  index: ProviderHealthIndex,
): {
  availability: Availability;
  reasonCode: "provider-down" | "provider-degraded" | "provider-health-unknown";
} | null {
  let sawDegraded = false;
  for (const kind of dependencies) {
    const health = index.byKind.get(kind)?.health ?? "unknown";
    if (health === "down") return { availability: "unavailable", reasonCode: "provider-down" };
    if (health === "unknown") {
      return { availability: "unavailable", reasonCode: "provider-health-unknown" };
    }
    if (health === "degraded") sawDegraded = true;
  }
  return sawDegraded ? { availability: "degraded", reasonCode: "provider-degraded" } : null;
}

// ---------------------------------------------------------------------------
// Renderer availability derivation
// ---------------------------------------------------------------------------

function renderersSection(
  rawRenderers: readonly unknown[],
  rights: RightsCapabilities,
  index: ProviderHealthIndex,
): RendererAvailability[] {
  const renderers: RendererAvailability[] = [];
  for (const raw of rawRenderers) {
    const parsed = RendererRegistryEntrySchema.safeParse(raw);
    if (!parsed.success) {
      // Fail-closed per-entry: salvage the id when readable, otherwise use a
      // fixed marker; never silently drop, never assume availability.
      const id =
        isRecord(raw) && typeof raw.rendererId === "string" && raw.rendererId.length >= 1
          ? raw.rendererId
          : "unknown-renderer-entry";
      renderers.push({
        rendererId: id,
        availability: "unavailable",
        reasonCode: "renderer-input-invalid",
        requiresSourceFrames: false,
        rightsAwareness: "rights-not-relevant",
      });
      continue;
    }
    renderers.push(rendererEntryOf(parsed.data, rights, index));
  }
  return renderers;
}

function rendererEntryOf(
  entry: RendererRegistryEntry,
  rights: RightsCapabilities,
  index: ProviderHealthIndex,
): RendererAvailability {
  const rightsAwareness: RendererAvailability["rightsAwareness"] = entry.requiresSourceFrames
    ? "rights-evaluated"
    : "rights-not-relevant";
  const base = {
    rendererId: entry.rendererId,
    ...(entry.rendererVersion !== undefined ? { rendererVersion: entry.rendererVersion } : {}),
    ...(entry.rendererClass !== undefined ? { rendererClass: entry.rendererClass } : {}),
    requiresSourceFrames: entry.requiresSourceFrames,
    rightsAwareness,
  };

  // Worst-first lattice (documented order):
  // unregistered > rights-denied > provider dependency > registry-degraded > ok.
  if (entry.registryStatus === "unregistered") {
    return { ...base, availability: "unavailable", reasonCode: "renderer-not-registered" };
  }
  if (entry.requiresSourceFrames && !rights.canReferenceSourceFrames) {
    return { ...base, availability: "unavailable", reasonCode: "rights-denied" };
  }
  const dependency = providerDependencyVerdict(entry.dependsOnProviders, index);
  if (dependency !== null) {
    return { ...base, availability: dependency.availability, reasonCode: dependency.reasonCode };
  }
  if (entry.registryStatus === "degraded") {
    return { ...base, availability: "degraded", reasonCode: "renderer-registry-degraded" };
  }
  return { ...base, availability: "available", reasonCode: "ok" };
}

// ---------------------------------------------------------------------------
// Modes derivation
// ---------------------------------------------------------------------------

function liveModeSection(
  raw: CapabilityServiceInput["liveTransport"],
  rights: RightsCapabilities,
  index: ProviderHealthIndex,
): LiveModeAvailability {
  // Simulation F (architecture no-drift rule + ux-operational-simulation):
  // controlled/in-process streaming is NEVER presented as live network, and
  // the live label is only claimable with live-network transport evidence.
  if (raw === undefined || raw.kind === "none") {
    return {
      availability: "unavailable",
      reasonCode: "live-transport-not-configured",
      transportKind: "none",
    };
  }
  if (raw.kind === "in-process") {
    return {
      availability: "unavailable",
      reasonCode: "in-process-transport-not-live",
      transportKind: "in-process",
    };
  }
  // live-network transport: rights gate, then the delivery providers.
  if (!rights.canDeliverLive) {
    return {
      availability: "unavailable",
      reasonCode: "rights-denied",
      transportKind: "live-network",
    };
  }
  const dependency = providerDependencyVerdict(["storage", "queue-cache"], index);
  if (dependency !== null) {
    return {
      availability: dependency.availability,
      reasonCode: dependency.reasonCode,
      transportKind: "live-network",
    };
  }
  return { availability: "available", reasonCode: "ok", transportKind: "live-network" };
}

function batchModeSection(index: ProviderHealthIndex): BatchModeAvailability {
  // Batch (offline) rendering depends on the compute provider. Rendering is
  // compute, not playback: it is not rights-gated (the control-plane
  // precedent); playback is gated separately downstream.
  const dependency = providerDependencyVerdict(["compute"], index);
  if (dependency !== null) {
    return { availability: dependency.availability, reasonCode: dependency.reasonCode };
  }
  return { availability: "available", reasonCode: "ok" };
}

// ---------------------------------------------------------------------------
// Quotas derivation
// ---------------------------------------------------------------------------

function quotasSection(rawQuotas: readonly unknown[]): QuotaState[] {
  return rawQuotas.map((raw) => {
    const parsed = QuotaCounterSchema.safeParse(raw);
    if (!parsed.success) {
      // Fail-closed: an unreadable counter admits no new work.
      const id =
        isRecord(raw) && typeof raw.quotaId === "string" && raw.quotaId.length >= 1
          ? raw.quotaId
          : "unknown-quota";
      return {
        quotaId: id,
        scope: null,
        used: null,
        limit: null,
        remaining: null,
        exhausted: true,
        reasonCode: "quota-counter-invalid",
      };
    }
    const counter: QuotaCounter = parsed.data;
    const remaining = Math.max(0, counter.limit - counter.used);
    const exhausted = counter.used >= counter.limit;
    return {
      quotaId: counter.quotaId,
      scope: counter.scope,
      used: counter.used,
      limit: counter.limit,
      remaining,
      exhausted,
      reasonCode: exhausted ? "quota-exhausted" : "ok",
    };
  });
}

// ---------------------------------------------------------------------------
// Content derivation
// ---------------------------------------------------------------------------

function contentSection(
  rawSurfaces: readonly unknown[],
  identity: DerivedIdentity,
): { catalogSurfaces: CatalogSurfaceAvailability[]; invalidRequestCount: number } {
  const authenticated = identity.authState === "authenticated";
  const requests: CatalogSurfaceRequest[] =
    rawSurfaces.length === 0 ? [...DEFAULT_CATALOG_SURFACES] : [];
  const invalidSurfaces: CatalogSurfaceAvailability[] = [];
  let invalidRequestCount = 0;

  for (const raw of rawSurfaces) {
    const parsed = CatalogSurfaceRequestSchema.safeParse(raw);
    if (!parsed.success) {
      // Fail-closed per-entry: a readable surface id keeps a hidden
      // surface-request-invalid entry; an unattributable one is counted (it
      // surfaces in overall.reasonCodes as catalog-surface-request-invalid).
      invalidRequestCount += 1;
      const id =
        isRecord(raw) && typeof raw.surfaceId === "string" ? raw.surfaceId : undefined;
      if (id !== undefined && (CATALOG_SURFACE_IDS as readonly string[]).includes(id)) {
        invalidSurfaces.push({
          surfaceId: id as CatalogSurfaceAvailability["surfaceId"],
          visibility: "hidden",
          reasonCode: "surface-request-invalid",
        });
      }
      continue;
    }
    requests.push(parsed.data);
  }

  const derived = requests.map((request): CatalogSurfaceAvailability => {
    if (request.requiresAuthenticated && !authenticated) {
      return { surfaceId: request.surfaceId, visibility: "hidden", reasonCode: "authentication-required" };
    }
    if (
      request.requiredRoles.length > 0 &&
      !request.requiredRoles.some((role) => identity.roles.includes(role))
    ) {
      return { surfaceId: request.surfaceId, visibility: "hidden", reasonCode: "role-not-granted" };
    }
    return { surfaceId: request.surfaceId, visibility: "visible", reasonCode: "surface-visible" };
  });

  return { catalogSurfaces: [...invalidSurfaces, ...derived], invalidRequestCount };
}

// ---------------------------------------------------------------------------
// Overall derivation
// ---------------------------------------------------------------------------

function overallSection(
  response: Omit<CapabilityResponse, "overall">,
  extras: readonly string[],
): CapabilityResponse["overall"] {
  const codes = new Set<string>(extras);
  for (const renderer of response.renderers) {
    if (renderer.reasonCode !== "ok") codes.add(renderer.reasonCode);
  }
  // Live is deliberately excluded (see the OverallSection doc in ./schema.ts):
  // a live-mode gap is the Live surface's own unavailable state, not an
  // app-wide degradation. Batch IS a render-capable surface.
  if (response.modes.batch.reasonCode !== "ok") codes.add(response.modes.batch.reasonCode);
  for (const provider of response.providers) {
    if (provider.health !== "ok") codes.add(`provider-${provider.health}`);
  }
  for (const quota of response.quotas) {
    if (quota.reasonCode !== "ok") codes.add(quota.reasonCode);
  }
  const reasonCodes = [...codes].sort();

  // "unavailable" = nothing renderable at all (no renderers, or every
  // renderer unavailable). Otherwise any non-ok signal degrades; a fully-ok
  // response is ready. Per-section entries remain authoritative for UI state.
  const allRenderersUnavailable =
    response.renderers.length === 0 ||
    response.renderers.every((renderer) => renderer.availability === "unavailable");
  const state = allRenderersUnavailable ? "unavailable" : reasonCodes.length > 0 ? "degraded" : "ready";
  return { state, reasonCodes };
}

// ---------------------------------------------------------------------------
// The composition
// ---------------------------------------------------------------------------

/**
 * Builds a validated capability response from the caller's operational
 * inputs. Pure and deterministic: the same input always produces the same
 * response bytes (pinned by the round-trip tests).
 *
 * @throws {@link CapabilityInputError} when the input is structurally
 *   unusable (see the module docs — never an invented response).
 */
export function buildCapabilityResponse(input: unknown): CapabilityResponse {
  const parsedInput = CapabilityServiceInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new CapabilityInputError(
      "capability service input failed validation (fail-closed: no response is built from an unusable input)",
      { issues: issuesOf(parsedInput.error) },
    );
  }
  const validated = parsedInput.data;

  // 1. Identity (fail-closed; throws on inconsistent identity data).
  const identity = deriveIdentity(validated);

  // 2. Rights: missing → DENY-ALL (the frozen contracts rule).
  const rights = validated.rights ?? DENY_ALL_RIGHTS;

  // 3. Provider health feeds (per-entry fail-closed).
  const providerIndex = indexProviderFeeds(validated.providers ?? []);
  const providers = providersSection(providerIndex);

  // 4. Renderers (per-entry fail-closed).
  const renderers = renderersSection(validated.renderers ?? [], rights, providerIndex);

  // 5. Modes (Simulation F pinned in the schema: in-process ≠ live network).
  const live = liveModeSection(validated.liveTransport, rights, providerIndex);
  const batch = batchModeSection(providerIndex);

  // 6. Quotas (per-entry fail-closed admission).
  const quotas = quotasSection(validated.quotas ?? []);

  // 7. Content (default surface set when the caller supplied none).
  const content = contentSection(validated.catalogSurfaces ?? [], identity);

  // Extra overall reason codes for feed-level failures that have no
  // per-entry home: a missing renderer registry feed, an unattributable
  // provider feed, an unattributable invalid catalog-surface request.
  const extras: string[] = [];
  if (validated.renderers === undefined) extras.push("renderer-registry-feed-missing");
  if (providerIndex.invalidFeedCount > 0) extras.push("provider-feed-invalid");
  if (content.invalidRequestCount > 0) extras.push("catalog-surface-request-invalid");

  const partial = {
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
    requestContext: { ...(validated.requestContext ?? {}) },
    auth: {
      state: identity.authState,
      sessionValid: identity.sessionValid,
      activeRole: identity.activeRole,
      activeRoleContextNote: ACTIVE_ROLE_CONTEXT_NOTE,
    },
    account: {
      authenticated: identity.authState === "authenticated",
      ...(identity.userId !== undefined ? { userId: identity.userId } : {}),
      roles: [...identity.roles],
      rolesAreGrantsNote: ROLES_ARE_GRANTS_NOTE,
    },
    renderers,
    modes: { live, batch },
    quotas,
    providers,
    content: { catalogSurfaces: content.catalogSurfaces },
  } satisfies Omit<CapabilityResponse, "overall">;

  const response: CapabilityResponse = { ...partial, overall: overallSection(partial, extras) };

  // 8. Self-check: the composition must produce a schema-valid response.
  const check = CapabilityResponseSchema.safeParse(response);
  if (!check.success) {
    throw new CapabilityInternalError(
      "built capability response failed its own schema (never return an invalid document)",
      { issues: issuesOf(check.error) },
    );
  }
  return check.data;
}
