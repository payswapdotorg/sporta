/**
 * Session-scoped identity contracts.
 *
 * Entity identity inside a media session is opaque and stable: a
 * session-local `entityId` plus an `EntityKind`. External identity (league
 * database ids, provider ids, etc.) is optional and must be mapped
 * explicitly with a justification; the core engine never requires it
 * (architecture-lock §9, vendor neutrality).
 */
import { z } from "zod";

/** Pattern for opaque, session-scoped entity ids. */
export const ENTITY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * An opaque, session-scoped entity identifier (1-64 chars of
 * `[A-Za-z0-9_-]`). The id is only meaningful within its media session.
 */
export const EntityId = z
  .string()
  .regex(ENTITY_ID_PATTERN, "entityId must be 1-64 characters of [A-Za-z0-9_-]");
export type EntityId = z.infer<typeof EntityId>;

/** Canonical entity kinds in the Sports World Model. */
export const ENTITY_KINDS = [
  "match",
  "competition",
  "team",
  "participant",
  "official",
  "ball",
  "venue",
  "camera",
] as const;

/** The kind of entity a session-local id refers to. */
export const EntityKind = z.enum(ENTITY_KINDS);
export type EntityKind = z.infer<typeof EntityKind>;

/** A session-local reference to an entity. */
export const LocalEntityRef = z.object({
  entityId: EntityId,
  kind: EntityKind,
});
export type LocalEntityRef = z.infer<typeof LocalEntityRef>;

/**
 * An explicit, optional mapping from a session-local entity to an external
 * system's identity. `justification` records why the external mapping exists
 * (e.g. licensed data feed reconciliation). Absence of a mapping must never
 * block core processing.
 */
export const ExternalIdentityMapping = z.object({
  entityId: EntityId,
  externalSystem: z.string().min(1),
  externalId: z.string().min(1),
  justification: z.string().min(1),
});
export type ExternalIdentityMapping = z.infer<typeof ExternalIdentityMapping>;
