/**
 * @sporta/capability — the product capability contract (W901).
 *
 * The versioned, closed-vocabulary response surface the frontend renders
 * from (auth state, account role grants, renderer availability, live/batch
 * mode availability, quota state, provider health, catalog surface
 * visibility, and a coarse overall summary), plus the transport-free,
 * fail-closed composition that derives it from operational inputs.
 *
 * Package boundary:
 *
 * - `versioning`: the frozen schema version ("1.0")
 * - `roles`: the role vocabulary + the two pinned normative notes
 * - `schema`: every zod schema (response, input, per-entry feeds)
 * - `defaults`: the normative default catalog-surface set
 * - `service`: `buildCapabilityResponse` (pure, fail-closed)
 * - `serialize`: canonical serialization + strict parsing
 * - `errors`: the typed error family (failureClass + httpStatus)
 *
 * Telemetry-neutral by construction: no clock, no randomness, no network, no
 * collection — the composition is a pure function, and the constitution scan
 * (test/boundary.test.ts) keeps it that way.
 */
export {
  CAPABILITY_PACKAGE_VERSION,
  CAPABILITY_SCHEMA_MAJOR,
  CAPABILITY_SCHEMA_MINOR,
  CAPABILITY_SCHEMA_VERSION,
} from "./versioning";

export { ACTIVE_ROLE_CONTEXT_NOTE, ROLES, ROLES_ARE_GRANTS_NOTE, RoleSchema } from "./roles";
export type { Role } from "./roles";

export {
  AuthSection,
  AuthState,
  Availability,
  BatchModeAvailability,
  BatchModeReasonCode,
  CATALOG_SURFACE_IDS,
  CapabilityResponse,
  CapabilityResponseSchema,
  CapabilityServiceInput,
  CatalogSurfaceAvailability,
  CatalogSurfaceId,
  CatalogSurfaceRequest,
  LiveModeAvailability,
  LiveModeReasonCode,
  LiveTransportKind,
  OverallSection,
  OverallState,
  PROVIDER_KINDS,
  ProviderHealth,
  ProviderHealthFeed,
  ProviderHealthState,
  ProviderKind,
  ProviderReasonCode,
  QuotaReasonCode,
  QuotaScope,
  QuotaState,
  RendererAvailability,
  RendererReasonCode,
  RightsAwareness,
  SurfaceReasonCode,
  SurfaceVisibility,
} from "./schema";
export { DENY_ALL_RIGHTS } from "./schema";

export { DEFAULT_CATALOG_SURFACES } from "./defaults";

export { buildCapabilityResponse } from "./service";

export { parseCapabilityResponse, serializeCapabilityResponse } from "./serialize";

export {
  CAPABILITY_HTTP_STATUS,
  CapabilityError,
  CapabilityInputError,
  CapabilityInternalError,
  CapabilityParseError,
  isCapabilityError,
} from "./errors";
export type { CapabilityFailureClass } from "./errors";
