/**
 * Schema versioning for `@sporta/contracts`.
 *
 * Every versioned document carries a `schemaVersion` string in MAJOR.MINOR
 * form (for example "1.0"). MAJOR is incremented for breaking changes, MINOR
 * for additive changes. The full compatibility policy lives in
 * `docs/contracts/COMPATIBILITY.md`.
 */
import { z } from "zod";

/** Current contract major version. Bumping this is a breaking change (ADR required). */
export const SCHEMA_MAJOR = 1;

/** Current contract minor version. Bumped for additive, backward-compatible changes. */
export const SCHEMA_MINOR = 0;

/** Current schema version as `"MAJOR.MINOR"`. */
export const SCHEMA_VERSION = `${SCHEMA_MAJOR}.${SCHEMA_MINOR}`;

const SCHEMA_VERSION_PATTERN = /^\d+\.\d+$/;

/**
 * Base shape shared by every versioned document: a `schemaVersion` string in
 * `"MAJOR.MINOR"` form (e.g. `"1.0"`).
 */
export const SchemaVersioned = z.object({
  schemaVersion: z
    .string()
    .regex(SCHEMA_VERSION_PATTERN, 'schemaVersion must be "MAJOR.MINOR" (e.g. "1.0")'),
});
export type SchemaVersioned = z.infer<typeof SchemaVersioned>;

/** The `schemaVersion` field schema, reused by every document schema. */
export const schemaVersionField = SchemaVersioned.shape.schemaVersion;
export type SchemaVersionString = z.infer<typeof schemaVersionField>;

/**
 * Returns `true` when a payload declaring version `v` is consumable by the
 * current contracts: same MAJOR and payload MINOR <= {@link SCHEMA_MINOR}.
 *
 * - Same major, older or equal minor: compatible (additive changes only).
 * - Newer minor than current: not consumable by these contracts.
 * - Different major: breaking change, not compatible.
 * - Malformed version strings: not compatible.
 */
export function isCompatibleVersion(v: string): boolean {
  if (!SCHEMA_VERSION_PATTERN.test(v)) return false;
  const [major, minor] = v.split(".").map((part) => Number.parseInt(part, 10)) as [number, number];
  return major === SCHEMA_MAJOR && minor <= SCHEMA_MINOR;
}
