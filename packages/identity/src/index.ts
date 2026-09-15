/**
 * @sporta/identity — real user auth + multi-role authorization (W902).
 *
 * The identity half of the product boundary: accounts with argon2id
 * password credentials and ROLE GRANTS (the `@sporta/capability` vocabulary),
 * opaque-token sessions (hashed at rest, injected clock + entropy), a pure
 * server-side authorization policy (grants + ownership — NEVER the session's
 * active role), an HTTP auth surface (register/login/logout/me/switch-role),
 * and the W701 bridge that makes a verified identity the real source of the
 * control plane's caller-supplied authorization policy. Module map:
 *
 * - `clock`: the injected clock + entropy ports (deterministic defaults)
 * - `accounts`: the account model + persistence port (W911 Neon adapter's
 *   shape; in-memory this wave)
 * - `passwords`: the password-hasher port (REAL default: `Bun.password`
 *   argon2id; deterministic test hasher for the high-volume suites)
 * - `sessions`: opaque-token sessions (SHA-256-at-rest, expiry via injected
 *   clock, active role as a PRESENTATION field only)
 * - `policy`: `authorize(account, action, resource)` — pure, fail-closed on
 *   unknown anything
 * - `control-gate`: the W701 bridge — identity-attested media-session
 *   creation + owner/operator-gated reads, denials BEFORE existence is
 *   revealed (Simulation D) and BEFORE output bytes are exposed
 * - `http`: `createIdentityServer` — the Bun.serve auth transport
 *   (control-api http.ts conventions: routes, typed errors → statuses,
 *   request-id correlation, generic auth failures)
 * - `errors`: the typed error family (`failureClass` + `httpStatus`)
 *
 * Roles are GRANTS, not authority (the architecture-lock no-drift rule):
 * switching the active role changes the workspace presentation only; every
 * protected action is re-authorized server-side against the grants.
 *
 * KNOWN LIMITATIONS (see README.md): no email verification or password reset
 * (deployment stage, W910+); no rate limiting (W913); in-memory persistence
 * only (Neon adapter is W911); hosted browser sign-in evidence is W910/W920.
 */
export {
  IDENTITY_DEFAULT_EPOCH_MS,
  createIdentityDefaultClock,
  createSequentialEntropySource,
  defaultEntropySource,
} from "./clock";
export type { EntropySource } from "./clock";

export {
  AccountConflictError,
  AccountNotFoundError,
  InMemoryAccountStore,
  toAccountSummary,
} from "./accounts";
export type { Account, AccountStore, AccountSummary, NewAccountInput } from "./accounts";

export { argon2PasswordHasher, createDeterministicTestHasher } from "./passwords";
export type { PasswordHasher } from "./passwords";

export {
  DEFAULT_SESSION_TTL_MS,
  InMemorySessionStore,
  SESSION_TOKEN_BYTES,
  SessionService,
  sha256Hex,
  toBase64Url,
} from "./sessions";
export type { IssuedSession, SessionRecord, SessionServiceOptions, SessionStore } from "./sessions";

export { IDENTITY_ACTIONS, authorize, isIdentityAction } from "./policy";
export type {
  AuthorizationDecision,
  IdentityAction,
  IdentityAllowVia,
  IdentityDenialReason,
  PolicyAccount,
  ResourceContext,
} from "./policy";

export { createIdentityControlGate, InMemoryMediaOwnershipStore } from "./control-gate";
export type {
  GatedControlApp,
  IdentityControlGate,
  IdentityControlGateOptions,
  MediaOwnershipStore,
  MediaRightsDeclaration,
} from "./control-gate";

export {
  IDENTITY_HTTP_STATUS,
  IdentityApiError,
  IdentityAuthInvalidError,
  IdentityConflictError,
  IdentityInternalError,
  IdentityPermissionDeniedError,
  IdentityUnauthenticatedError,
  IdentityValidationError,
  asIdentityError,
  errMessage,
  isIdentityError,
} from "./errors";
export type { IdentityError, IdentityErrorDetails, IdentityFailureClass } from "./errors";

export { SESSION_COOKIE, createIdentityServer, extractToken, toIsoUtc } from "./http";
export type {
  AccountView,
  IdentityRoute,
  IdentityServerOptions,
  IdentityTransportFailureClass,
} from "./http";
