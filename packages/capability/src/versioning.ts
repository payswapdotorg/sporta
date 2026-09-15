/**
 * Schema versioning for `@sporta/capability` (W901).
 *
 * The capability response is a FROZEN-SEAM contract: Worker A's W904
 * (Home/Live/Explore/Library) renders entirely from it. Every response
 * document carries `schemaVersion: "MAJOR.MINOR"`. MAJOR increments are
 * breaking (ADR required, per the architecture-lock §14 procedure); MINOR
 * increments are additive.
 *
 * Unlike `@sporta/contracts` (whose `schemaVersion` accepts any
 * `"MAJOR.MINOR"` string), the capability response pins the version with a
 * zod LITERAL: a response declaring any other version is INVALID, so a
 * producer/consumer version mismatch fails closed instead of degrading
 * silently.
 */

/** Current capability-contract major version. Bumping this is a breaking change (ADR required). */
export const CAPABILITY_SCHEMA_MAJOR = 1 as const;

/** Current capability-contract minor version. Bumped for additive, backward-compatible changes. */
export const CAPABILITY_SCHEMA_MINOR = 0 as const;

/** Current capability schema version as `"MAJOR.MINOR"`. */
export const CAPABILITY_SCHEMA_VERSION = `${CAPABILITY_SCHEMA_MAJOR}.${CAPABILITY_SCHEMA_MINOR}` as const;

/** Package version of @sporta/capability. */
export const CAPABILITY_PACKAGE_VERSION = "0.1.0";
