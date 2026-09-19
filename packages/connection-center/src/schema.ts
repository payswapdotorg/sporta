/**
 * The connection-center SCHEMAS (R406-R409): the versioned, zod-validated
 * documents the product plane persists and reports. One module so every
 * store, report, and test pins the SAME vocabulary (the
 * `@sporta/compute-adapter` `schemas.ts` precedent).
 *
 * Honest boundaries:
 *
 * - the connection STATE vocabulary is the product-side mirror of the
 *   adapters' credential states (`./connections.ts` maps them — the
 *   adapter's `ProviderCredentialStatus` remains the authority);
 * - a connection's credential is a REFERENCE ONLY (kind + fingerprint +
 *   presented-at — ./credentials.ts); no credential VALUE can appear in
 *   any document here (zod-strict, test-pinned);
 * - the ledger's usage records REUSE the W914 `ComputeUsageRecord`
 *   vocabulary verbatim (imported, never forked);
 * - every document is `.strict()` — unknown fields fail loudly, so a
 *   future field is a schema change, never a silent rider.
 */
import { z } from "zod";
import type { ProviderCredentialState } from "@sporta/compute-provider-adapters";
import { ACCEPTED_CREDENTIAL_KINDS } from "./credentials";

/** The package's schema version (MAJOR.MINOR — the repo convention). */
export const CONNECTION_SCHEMA_VERSION = "1.0" as const;

// ---------------------------------------------------------------------------
// R406 — the connection record
// ---------------------------------------------------------------------------

/** The product-side connection state (closed vocabulary). */
export const CONNECTION_STATES = [
  /** Connected; no successful provider verification yet. */
  "connected-unverified",
  /** Connected; the provider authenticated the credential. */
  "connected-verified",
  /** Connected; the provider REJECTED the credential (observed 401/403). */
  "connected-invalid",
] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

/** The closed event vocabulary riding a record's bounded history. */
export const CONNECTION_EVENT_TYPES = [
  "connected",
  "connect-duplicate",
  "verified",
  "verify-failed",
  "credential-invalid",
  "verify-skipped",
  "disconnected",
] as const;
export type ConnectionEventType = (typeof CONNECTION_EVENT_TYPES)[number];

/** One history event (honest evidence; NEVER a credential value). */
export const ConnectionEvent = z
  .object({
    type: z.enum(CONNECTION_EVENT_TYPES),
    atMs: z.number().finite().min(0),
    detail: z.string().min(1).optional(),
  })
  .strict();
export type ConnectionEvent = z.infer<typeof ConnectionEvent>;

/** The credential reference embedded in a record (reference ONLY). */
const EmbeddedCredentialReference = z
  .object({
    kind: z.enum(ACCEPTED_CREDENTIAL_KINDS),
    fingerprint: z
      .string()
      .regex(/^[0-9a-f]{16}$/, "a credential fingerprint is 16 lowercase hex chars"),
    presentedAtMs: z.number().finite().min(0),
  })
  .strict();

/**
 * One account's connection to one provider. The adapter's own credential
 * state is echoed honestly (`lastVerifiedState`) — the adapter remains the
 * authority; this record is the product's durable view.
 */
export const ConnectionRecordSchema = z
  .object({
    schemaVersion: z.literal(CONNECTION_SCHEMA_VERSION),
    accountId: z.string().min(1),
    providerId: z.string().min(1),
    state: z.enum(CONNECTION_STATES),
    /** The connected credential reference (`null` when none is needed). */
    credential: EmbeddedCredentialReference.nullable(),
    /** Record creation time (the injected clock domain). */
    connectedAtMs: z.number().finite().min(0),
    /** Last successful verification time (present iff ever verified). */
    lastVerifiedAtMs: z.number().finite().min(0).optional(),
    /** The adapter's honest credential state at last verification. */
    lastVerifiedState: z
      .enum(["missing", "present-unverified", "verified", "invalid", "not-applicable"] satisfies [
        ProviderCredentialState,
        ...ProviderCredentialState[],
      ])
      .optional(),
    /** Monotone write revision (stale writes fail loudly). */
    revision: z.number().int().min(1),
    /** Bounded event history (oldest-first). */
    history: z.array(ConnectionEvent).max(1024),
  })
  .strict()
  .superRefine((record, ctx) => {
    if (record.credential === null && record.state !== "connected-verified") {
      // A provider needing no credential is verified by construction.
      ctx.addIssue({
        code: "custom",
        path: ["state"],
        message: "a credential-less connection is verified by construction (not-applicable)",
      });
    }
    if (record.state === "connected-verified" && record.lastVerifiedAtMs === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["lastVerifiedAtMs"],
        message: "a verified connection records when it was verified",
      });
    }
  });
export type ConnectionRecord = z.infer<typeof ConnectionRecordSchema>;

// ---------------------------------------------------------------------------
// R406 — the status report (one honest line per known provider)
// ---------------------------------------------------------------------------

/** The closed report posture per provider (never a bespoke string). */
export const CONNECTION_POSTURES = [
  /** Connected and the provider authenticated the credential. */
  "connected-verified",
  /** Connected but not yet verified. */
  "connected-unverified",
  /** Connected but the provider rejected the credential. */
  "connected-invalid",
  /** Known provider, no connection for this account. */
  "disconnected",
  /** Known provider, never connected by this account. */
  "never-connected",
] as const;
export type ConnectionPosture = (typeof CONNECTION_POSTURES)[number];

/** One provider's honest status line for one account. */
export const ConnectionStatusReport = z
  .object({
    schemaVersion: z.literal(CONNECTION_SCHEMA_VERSION),
    accountId: z.string().min(1),
    providerId: z.string().min(1),
    posture: z.enum(CONNECTION_POSTURES),
    /** The connection record (present iff posture is connected-*). */
    connection: ConnectionRecordSchema.optional(),
    /** The provider's abstract descriptor summary (DATA — never a vendor name in a vocabulary member). */
    descriptor: z
      .object({
        providerKind: z.enum(["in-memory", "cpu-worker", "gpu-worker", "managed-actor"]),
        supportedRenderers: z.array(z.string().min(1)).min(1),
        supportedLatencyClasses: z.array(z.enum(["offline", "near-live", "live"])).min(1),
        maxConcurrentJobs: z.number().int().min(1),
        maxJobDeadlineMs: z.number().finite().positive(),
      })
      .strict(),
    /** The credential kinds this provider accepts (closed vocabulary data). */
    supportedCredentialKinds: z.array(z.enum(ACCEPTED_CREDENTIAL_KINDS)),
  })
  .strict();
export type ConnectionStatusReport = z.infer<typeof ConnectionStatusReport>;
