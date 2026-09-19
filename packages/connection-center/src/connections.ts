/**
 * THE COMPUTE CONNECTION CENTER (R406): the in-product provider connection
 * surface — connect, verify, disconnect, and the honest per-account status
 * report — over the FROZEN provider plane (`@sporta/compute-provider-adapters`
 * R402-R405 adapters behind the W914 `ComputeAdapterPort`).
 *
 * ## The accept criteria, restated
 *
 * - **No provider master passwords** — a password-class presentation
 *   (`account-password | console-password | master-password`) is refused
 *   fail-closed with the typed {@link MasterPasswordRefusalError} BEFORE
 *   anything is stored or verified, AND the refusal is RECORDED in the
 *   audit trail (refused ≠ dropped). Only the scoped kinds the adapters
 *   document (`scoped-api-key | scoped-token-pair | oauth-access-token`)
 *   are accepted;
 * - **A connected account can be verified** — `verify` drives the
 *   provider adapter's REAL `verifyCredentials()` call and records the
 *   honest four-state answer (`verified | invalid | present-unverified |
 *   missing | not-applicable`) verbatim (the adapter is the authority);
 * - **…and disconnected** — `disconnect` removes the record, drops the
 *   runtime adapter binding, and audits the removal; disconnecting an
 *   unknown connection is a typed error (never a silent no-op).
 *
 * ## The composition this center rides
 *
 * The center owns NO provider knowledge of its own: every provider is a
 * {@link ConnectionPlaneProvider} ENTRY (data — id, the credential kinds
 * its adapter documents, and a FACTORY that builds the adapter with the
 * presented credential injected). The presented credential VALUE is
 * consumed transiently by the factory and by the adapter's verification
 * call — it is never stored, logged, or reported (the record holds only
 * the sha-256 fingerprint reference; test-pinned fail-closed).
 *
 * ## Account isolation
 *
 * Every record, audit entry, and runtime binding is keyed by the account
 * id (`AccountId` — the `@sporta/identity` W902 `Account["userId"]` shape:
 * a non-empty NUL-free string). The center implements NO authentication —
 * callers derive the account from a verified identity (the W701 control
 * gate precedent) and hand it down.
 *
 * ## Honest boundaries (documented, not hidden)
 *
 * - The center cannot SEMANTICALLY prove a presented string is scoped (a
 *   provider's server-side scope is unknowable from here) — it enforces
 *   the closed KIND vocabulary and lets the provider's own verification
 *   call be the authority (the R402-R405 posture, unchanged);
 * - Runtime adapter bindings are in-memory: after a process restart the
 *   durable records remain, but `verify` on a credential-backed
 *   connection fails loudly with {@link ConnectionBindingAbsentError}
 *   (re-present the credential) — the center never fabricates a binding;
 * - A provider that needs no credential (the R405 local plane) is
 *   `connected-verified` by construction and its binding is rebuilt
 *   lazily on demand (nothing secret to re-present).
 */
import type { ComputeAdapterPort } from "@sporta/compute-adapter";
import type { ProviderCredentialStatus } from "@sporta/compute-provider-adapters";
import type { ComputeBrokerProvider } from "@sporta/compute-adapter";
import {
  AcceptedCredentialPresentation,
  CredentialPresentation,
  MasterPasswordRefusalError,
  credentialFingerprint,
} from "./credentials";
import type {
  AcceptedCredentialKind,
  AcceptedCredentialPresentation as AcceptedPresentationDoc,
  CredentialPresentationKind,
} from "./credentials";
import {
  ConnectionStatusReport,
  CONNECTION_SCHEMA_VERSION,
  type ConnectionRecord,
  type ConnectionStatusReport as StatusReport,
} from "./schema";
import { ConnectionConflictError, InMemoryConnectionStore, assertScopeValid } from "./store";
import type { ConnectionAuditEntry, ConnectionStore, ConnectionStoreOptions } from "./store";

// ---------------------------------------------------------------------------
// Account ids (the W902 shape — consumed, not re-implemented)
// ---------------------------------------------------------------------------

/**
 * An account id: the `@sporta/identity` W902 `Account["userId"]` shape (a
 * non-empty NUL-free string). The center performs NO authentication — the
 * caller derives this from a verified identity.
 */
export type AccountId = string;

// ---------------------------------------------------------------------------
// The provider-plane entry (data + a factory — never provider knowledge)
// ---------------------------------------------------------------------------

/**
 * The adapter seam the connection center drives: the W914 port PLUS the
 * honest credential surface every R402-R405 adapter exposes
 * (`credentialStatus()` / `verifyCredentials()` — the
 * `ProviderLedgerAdapter` surface, restated as a narrow interface so
 * tests can stand in without the REST machinery).
 */
export interface CredentialVerifiableAdapter extends ComputeAdapterPort {
  /** The adapter's honest credential snapshot (never a credential value). */
  credentialStatus(): ProviderCredentialStatus;
  /** ONE real authenticated provider call (connectivity + credentials). */
  verifyCredentials(): Promise<ProviderCredentialStatus>;
}

/** One provider entry in the connection plane (all DATA + one factory). */
export interface ConnectionPlaneProvider {
  /** The provider identity (data — unique per plane; never a vocabulary member). */
  providerId: string;
  /** The scoped credential kinds this provider's adapter supports. */
  supportedCredentialKinds: readonly AcceptedCredentialKind[];
  /** Whether connecting requires a credential at all (local: `false`). */
  requiresCredential: boolean;
  /**
   * Builds the adapter with the presented credential INJECTED (the value
   * is consumed here transiently — never stored, never logged). `null`
   * for credential-less providers.
   */
  createAdapter(presentation: AcceptedPresentationDoc | null): CredentialVerifiableAdapter;
}

// ---------------------------------------------------------------------------
// The typed error family (closed messages, fail-loud)
// ---------------------------------------------------------------------------

/** The base class (classified like the repo's boundary errors). */
export class ConnectionCenterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionCenterError";
  }
}

/** A structurally invalid input (malformed presentation / account id). */
export class ConnectionValidationError extends ConnectionCenterError {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`connection input failed validation: ${issues.join("; ")}`);
    this.name = "ConnectionValidationError";
    this.issues = issues;
  }
}

/** The referenced provider is not in the plane. */
export class UnknownConnectionProviderError extends ConnectionCenterError {
  readonly providerId: string;

  constructor(providerId: string) {
    super(
      `provider '${providerId}' is not registered in this connection plane (provider ids are data — check the plane's entries)`,
    );
    this.name = "UnknownConnectionProviderError";
    this.providerId = providerId;
  }
}

/** The presented accepted KIND is not one THIS provider supports. */
export class CredentialKindUnsupportedError extends ConnectionCenterError {
  readonly providerId: string;
  readonly presentedKind: CredentialPresentationKind;

  constructor(providerId: string, presentedKind: CredentialPresentationKind) {
    super(
      `provider '${providerId}' does not accept credentials of kind '${presentedKind}' (check the provider's supportedCredentialKinds — the closed accepted vocabulary is scoped-api-key | scoped-token-pair | oauth-access-token)`,
    );
    this.name = "CredentialKindUnsupportedError";
    this.providerId = providerId;
    this.presentedKind = presentedKind;
  }
}

/** verify/disconnect targeted a connection that does not exist. */
export class UnknownConnectionError extends ConnectionCenterError {
  readonly accountId: string;
  readonly providerId: string;

  constructor(accountId: string, providerId: string, action: string) {
    super(
      `no connection exists for (account '${accountId}', provider '${providerId}') — ${action} targets a live connection`,
    );
    this.name = "UnknownConnectionError";
    this.accountId = accountId;
    this.providerId = providerId;
  }
}

/** The runtime adapter binding is absent (post-restart); re-present. */
export class ConnectionBindingAbsentError extends ConnectionCenterError {
  readonly accountId: string;
  readonly providerId: string;

  constructor(accountId: string, providerId: string) {
    super(
      `the durable connection record for (account '${accountId}', provider '${providerId}') exists but its runtime adapter binding does not (process restart) — re-present the credential to rebind (the center never fabricates a binding)`,
    );
    this.name = "ConnectionBindingAbsentError";
    this.accountId = accountId;
    this.providerId = providerId;
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for {@link ConnectionCenter}. */
export interface ConnectionCenterOptions extends ConnectionStoreOptions {
  /** The provider plane (at least one entry; ids unique). */
  providers: readonly ConnectionPlaneProvider[];
  /**
   * The store (default: {@link InMemoryConnectionStore}). Durable runs
   * pass a `SqliteConnectionStore`.
   */
  store?: ConnectionStore;
  /** The injected clock (REQUIRED — the repo's no-wall-clock constitution). */
  nowMs: () => number;
}

// ---------------------------------------------------------------------------
// The center
// ---------------------------------------------------------------------------

/** One runtime adapter binding (the in-memory, non-secret runtime half). */
interface AdapterBinding {
  providerId: string;
  fingerprint: string | null;
  adapter: CredentialVerifiableAdapter;
}

/**
 * THE compute connection center (R406). One instance per product plane;
 * account isolation is by construction (every operation is scoped).
 */
export class ConnectionCenter {
  private readonly providers: readonly ConnectionPlaneProvider[];
  private readonly providerIds: ReadonlySet<string>;
  private readonly store: ConnectionStore;
  private readonly nowMs: () => number;
  private readonly maxHistoryEntries: number;
  private readonly bindings = new Map<string, AdapterBinding>();
  /** Cached abstract descriptor summaries (DATA — one per provider). */
  private readonly descriptorCache = new Map<string, ReturnType<ConnectionCenter["describeOf"]>>();

  constructor(options: ConnectionCenterOptions) {
    if (options.providers.length === 0) {
      throw new ConnectionCenterError("a connection plane needs at least one provider entry");
    }
    const seen = new Set<string>();
    for (const provider of options.providers) {
      if (provider.providerId.length === 0 || provider.providerId.includes("\u0000")) {
        throw new ConnectionValidationError([
          `provider id '${provider.providerId}' must be non-empty and NUL-free`,
        ]);
      }
      if (seen.has(provider.providerId)) {
        throw new ConnectionCenterError(
          `duplicate connection-plane provider id '${provider.providerId}'`,
        );
      }
      seen.add(provider.providerId);
    }
    this.providers = options.providers;
    this.providerIds = seen;
    this.store = options.store ?? new InMemoryConnectionStore(options);
    this.nowMs = options.nowMs;
    this.maxHistoryEntries = options.maxHistoryEntries ?? 64;
  }

  // -------------------------------------------------------------------------
  // Validation helpers (fail-loud, closed messages)
  // -------------------------------------------------------------------------

  private validateAccountId(accountId: AccountId): void {
    if (accountId.length === 0 || accountId.includes("\u0000")) {
      throw new ConnectionValidationError([
        "accountId must be a non-empty NUL-free string (the W902 userId shape)",
      ]);
    }
  }

  private providerOrFail(providerId: string): ConnectionPlaneProvider {
    if (!this.providerIds.has(providerId)) {
      throw new UnknownConnectionProviderError(providerId);
    }
    return this.providers.find((provider) => provider.providerId === providerId)!;
  }

  private bindingKey(accountId: string, providerId: string): string {
    return `${accountId}\u0000${providerId}`;
  }

  /** Trims history to the bound, oldest-first, never silently. */
  private trimmed(history: ConnectionRecord["history"]): ConnectionRecord["history"] {
    if (history.length > this.maxHistoryEntries) {
      return history.slice(history.length - this.maxHistoryEntries);
    }
    return history;
  }

  private async audit(entry: Omit<ConnectionAuditEntry, "schemaVersion">): Promise<void> {
    await this.store.appendAudit({ schemaVersion: "1.0", ...entry });
  }

  // -------------------------------------------------------------------------
  // connect
  // -------------------------------------------------------------------------

  /**
   * Connects one provider for one account with the presented credential.
   *
   * - password-class presentations: typed {@link MasterPasswordRefusalError}
   *   + an audit entry (`connect-refused-master-password`) — refused AND
   *   recorded, never dropped;
   * - malformed presentations: typed {@link ConnectionValidationError}
   *   (nothing stored);
   * - same credential re-presented: counted duplicate (`connect-duplicate`
   *   event + audit; the record is returned unchanged in shape);
   * - a DIFFERENT credential over a live connection: fail-loud
   *   `ConnectionConflictError` from the store (never silently replaced);
   * - otherwise: a record in `connected-unverified` (credential-backed)
   *   or `connected-verified` (credential-less, by construction), plus the
   *   runtime adapter binding (the credential value consumed by the
   *   factory, never stored).
   */
  async connect(
    accountId: AccountId,
    providerId: string,
    presentation: CredentialPresentation | null,
  ): Promise<ConnectionRecord> {
    this.validateAccountId(accountId);
    assertScopeValid(accountId, providerId);
    const provider = this.providerOrFail(providerId);

    // The closed presentation vocabulary: parse first (fail-loud), then
    // refuse the password class BEFORE anything is stored.
    let parsed: CredentialPresentation | null = null;
    if (presentation !== null) {
      const attempt = CredentialPresentation.safeParse(presentation);
      if (!attempt.success) {
        throw new ConnectionValidationError(
          attempt.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
        );
      }
      parsed = attempt.data;
    }
    if (
      parsed !== null &&
      parsed.kind !== "scoped-api-key" &&
      parsed.kind !== "scoped-token-pair" &&
      parsed.kind !== "oauth-access-token"
    ) {
      // The password class: refused fail-closed, recorded, never dropped.
      await this.audit({
        accountId,
        providerId,
        outcome: "connect-refused-master-password",
        atMs: this.nowMs(),
        detail: `presented kind '${parsed.kind}' (a password-class credential is never accepted)`,
      });
      throw new MasterPasswordRefusalError({
        surface: "connect",
        presentedKind: parsed.kind,
        providerId,
        accountId,
      });
    }

    // Credential-requirement honesty both directions.
    if (provider.requiresCredential && parsed === null) {
      throw new ConnectionValidationError([
        `provider '${providerId}' requires a credential (kind among ${provider.supportedCredentialKinds.join(" | ")})`,
      ]);
    }
    if (!provider.requiresCredential && parsed !== null) {
      throw new CredentialKindUnsupportedError(providerId, parsed.kind);
    }
    if (parsed !== null && !provider.supportedCredentialKinds.includes(parsed.kind)) {
      throw new CredentialKindUnsupportedError(providerId, parsed.kind);
    }

    const accepted = parsed === null ? null : AcceptedCredentialPresentation.parse(parsed);
    const now = this.nowMs();
    const fingerprint = accepted === null ? null : credentialFingerprint(accepted);

    // Conflict / duplicate detection against the durable record.
    const existing = await this.store.findRecord(accountId, providerId);
    if (existing !== null) {
      const existingFp = existing.credential?.fingerprint ?? null;
      if (existingFp === fingerprint) {
        // The same credential re-presented: counted duplicate — AND the
        // runtime binding is (re)built, so a post-restart re-present of
        // the same credential rebinds the adapter on this same path.
        const rebound = provider.createAdapter(accepted);
        this.bindings.set(this.bindingKey(accountId, providerId), {
          providerId,
          fingerprint,
          adapter: rebound,
        });
        const updated: ConnectionRecord = {
          ...existing,
          revision: existing.revision + 1,
          history: this.trimmed([...existing.history, { type: "connect-duplicate", atMs: now }]),
        };
        await this.store.updateRecord(updated);
        await this.audit({ accountId, providerId, outcome: "connect-duplicate", atMs: now });
        return updated;
      }
      await this.audit({
        accountId,
        providerId,
        outcome: "connect-conflict",
        atMs: now,
        detail: `existing fingerprint ${existingFp} differs from presented ${fingerprint}`,
      });
      // The store's typed conflict (never silently replaced).
      throw new ConnectionConflictError({
        accountId,
        providerId,
        existingFingerprint: existingFp,
        presentedFingerprint: fingerprint,
      });
    }

    // The record (credential REFERENCE only — the value never persists).
    const record: ConnectionRecord = provider.requiresCredential
      ? {
          schemaVersion: CONNECTION_SCHEMA_VERSION,
          accountId,
          providerId,
          state: "connected-unverified",
          credential:
            accepted === null
              ? null
              : {
                  kind: accepted.kind,
                  fingerprint: fingerprint!,
                  presentedAtMs: now,
                },
          connectedAtMs: now,
          revision: 1,
          history: [{ type: "connected", atMs: now }],
        }
      : {
          schemaVersion: CONNECTION_SCHEMA_VERSION,
          accountId,
          providerId,
          state: "connected-verified",
          credential: null,
          connectedAtMs: now,
          lastVerifiedAtMs: now,
          lastVerifiedState: "not-applicable",
          revision: 1,
          history: [{ type: "connected", atMs: now }],
        };

    // The runtime binding: the factory consumes the credential VALUE here.
    const adapter = provider.createAdapter(accepted);
    this.bindings.set(this.bindingKey(accountId, providerId), {
      providerId,
      fingerprint,
      adapter,
    });
    await this.store.insertRecord(record);
    await this.audit({
      accountId,
      providerId,
      outcome: "connected",
      atMs: now,
      ...(fingerprint !== null
        ? { detail: `credential ${accepted!.kind} fingerprint ${fingerprint}` }
        : {}),
    });
    return record;
  }

  // -------------------------------------------------------------------------
  // verify
  // -------------------------------------------------------------------------

  /**
   * Verifies one connection with the adapter's REAL verification call and
   * records the honest answer:
   *
   * - `verified` (or `not-applicable`) → `connected-verified`;
   * - a provider rejection → `connected-invalid`;
   * - verification could not complete (network/timeout) →
   *   `connected-unverified` (honest unknown — the provider proves
   *   nothing about the credential when it is unreachable).
   */
  async verify(accountId: AccountId, providerId: string): Promise<ConnectionRecord> {
    this.validateAccountId(accountId);
    assertScopeValid(accountId, providerId);
    const provider = this.providerOrFail(providerId);
    const record = await this.store.findRecord(accountId, providerId);
    if (record === null) {
      throw new UnknownConnectionError(accountId, providerId, "verify");
    }

    // The runtime binding (lazily rebuilt for credential-less providers).
    let binding = this.bindings.get(this.bindingKey(accountId, providerId));
    if (binding === undefined) {
      if (provider.requiresCredential) {
        throw new ConnectionBindingAbsentError(accountId, providerId);
      }
      binding = {
        providerId,
        fingerprint: null,
        adapter: provider.createAdapter(null),
      };
      this.bindings.set(this.bindingKey(accountId, providerId), binding);
    }
    const bindingFp = binding.fingerprint ?? null;
    const recordFp = record.credential?.fingerprint ?? null;
    if (bindingFp !== recordFp) {
      // Defensive honesty: the binding and record disagree — refuse loudly.
      throw new ConnectionConflictError({
        accountId,
        providerId,
        existingFingerprint: recordFp,
        presentedFingerprint: bindingFp,
      });
    }

    const status = await binding.adapter.verifyCredentials();
    const now = this.nowMs();
    return this.applyVerification(accountId, record, status, now);
  }

  /** Maps the adapter's honest status onto the durable record + audit. */
  private async applyVerification(
    accountId: AccountId,
    record: ConnectionRecord,
    status: ProviderCredentialStatus,
    now: number,
  ): Promise<ConnectionRecord> {
    let state: ConnectionRecord["state"];
    let outcome: "verified" | "credential-invalid" | "verify-failed" | "verify-skipped";
    let eventType: "verified" | "credential-invalid" | "verify-failed" | "verify-skipped";
    switch (status.state) {
      case "verified":
        state = "connected-verified";
        outcome = "verified";
        eventType = "verified";
        break;
      case "invalid":
        state = "connected-invalid";
        outcome = "credential-invalid";
        eventType = "credential-invalid";
        break;
      case "not-applicable":
        state = "connected-verified";
        outcome = "verify-skipped";
        eventType = "verify-skipped";
        break;
      case "missing":
      case "present-unverified":
      default:
        state = "connected-unverified";
        outcome = "verify-failed";
        eventType = "verify-failed";
        break;
    }

    const updated: ConnectionRecord = {
      ...record,
      state,
      ...(state === "connected-verified" ? { lastVerifiedAtMs: now } : {}),
      lastVerifiedState: status.state,
      revision: record.revision + 1,
      history: this.trimmed([
        ...record.history,
        {
          type: eventType,
          atMs: now,
          ...(status.detail !== undefined ? { detail: status.detail } : {}),
        },
      ]),
    };
    await this.store.updateRecord(updated);
    await this.audit({
      accountId,
      providerId: record.providerId,
      outcome,
      atMs: now,
      ...(status.detail !== undefined ? { detail: status.detail } : {}),
    });
    return updated;
  }

  // -------------------------------------------------------------------------
  // disconnect
  // -------------------------------------------------------------------------

  /**
   * Disconnects one connection: the record is REMOVED (returned), the
   * runtime binding dropped, and the removal audited. Disconnecting an
   * unknown connection is the typed {@link UnknownConnectionError} —
   * never a silent no-op.
   */
  async disconnect(accountId: AccountId, providerId: string): Promise<ConnectionRecord> {
    this.validateAccountId(accountId);
    assertScopeValid(accountId, providerId);
    this.providerOrFail(providerId);
    const removed = await this.store.deleteRecord(accountId, providerId);
    if (removed === null) {
      throw new UnknownConnectionError(accountId, providerId, "disconnect");
    }
    this.bindings.delete(this.bindingKey(accountId, providerId));
    const now = this.nowMs();
    await this.audit({
      accountId,
      providerId,
      outcome: "disconnected",
      atMs: now,
      detail: `connection removed after ${removed.history.length} recorded events`,
    });
    return removed;
  }

  // -------------------------------------------------------------------------
  // status + the account's compute plane
  // -------------------------------------------------------------------------

  /**
   * The honest per-account status report: ONE line per registered
   * provider (registration order), each with its posture
   * (`connected-verified | connected-unverified | connected-invalid |
   * disconnected | never-connected`), its abstract descriptor summary,
   * and its supported credential kinds. A past disconnect distinguishes
   * `disconnected` from `never-connected` (the audit trail is the truth).
   */
  async status(accountId: AccountId): Promise<StatusReport[]> {
    this.validateAccountId(accountId);
    assertScopeValid(accountId, "status-scope");
    const records = new Map(
      (await this.store.listRecords(accountId)).map((record) => [record.providerId, record]),
    );
    const audit = await this.store.listAudit(accountId, 1_000);
    const disconnectedEver = new Set(
      audit.filter((entry) => entry.outcome === "disconnected").map((entry) => entry.providerId),
    );
    const reports: StatusReport[] = [];
    for (const provider of this.providers) {
      const record = records.get(provider.providerId);
      const descriptor = this.describeOf(provider);
      const base = {
        schemaVersion: CONNECTION_SCHEMA_VERSION,
        accountId,
        providerId: provider.providerId,
        descriptor,
        supportedCredentialKinds: [...provider.supportedCredentialKinds],
      };
      if (record !== undefined) {
        const posture =
          record.state === "connected-verified"
            ? ("connected-verified" as const)
            : record.state === "connected-invalid"
              ? ("connected-invalid" as const)
              : ("connected-unverified" as const);
        reports.push({ ...base, posture, connection: record });
        continue;
      }
      reports.push({
        ...base,
        posture: disconnectedEver.has(provider.providerId) ? "disconnected" : "never-connected",
      });
    }
    return reports;
  }

  /** The abstract descriptor summary of one provider's adapter (cached). */
  private describeOf(provider: ConnectionPlaneProvider): {
    providerKind: "in-memory" | "cpu-worker" | "gpu-worker" | "managed-actor";
    supportedRenderers: string[];
    supportedLatencyClasses: ("offline" | "near-live" | "live")[];
    maxConcurrentJobs: number;
    maxJobDeadlineMs: number;
  } {
    const cached = this.descriptorCache.get(provider.providerId);
    if (cached !== undefined) return cached;
    const descriptor = provider.createAdapter(null).describe();
    const summary = {
      providerKind: descriptor.providerKind,
      supportedRenderers: descriptor.supportedRenderers.map((entry) => entry.rendererId),
      supportedLatencyClasses: [...descriptor.supportedLatencyClasses],
      maxConcurrentJobs: descriptor.maxConcurrentJobs,
      maxJobDeadlineMs: descriptor.maxJobDeadlineMs,
    };
    this.descriptorCache.set(provider.providerId, summary);
    return summary;
  }

  /**
   * The account's connected provider adapters as broker-ready entries
   * (`ComputeBrokerProvider[]`): connected adapters only (verified or not
   * — the adapter's own credential gate refuses dispatch pre-network for
   * `missing`/`invalid`, so the W914/R401 honesty is untouched). This is
   * the R406→R407 bridge: hand these to an `InMemoryComputeBroker` and
   * the SelectionDirector composes per-account selection.
   */
  connectedAdapters(accountId: AccountId): ComputeBrokerProvider[] {
    this.validateAccountId(accountId);
    const out: ComputeBrokerProvider[] = [];
    for (const provider of this.providers) {
      const binding = this.bindings.get(this.bindingKey(accountId, provider.providerId));
      if (binding === undefined) continue;
      out.push({ providerId: provider.providerId, adapter: binding.adapter });
    }
    return out;
  }

  /**
   * One account's live adapter binding (or `null`): the runtime surface
   * for direct dispatch/status/usage (the W914 port verbatim).
   */
  adapterOf(accountId: AccountId, providerId: string): CredentialVerifiableAdapter | null {
    this.validateAccountId(accountId);
    const binding = this.bindings.get(this.bindingKey(accountId, providerId));
    return binding?.adapter ?? null;
  }

  /** The honest store counters (the W004 counted-duplicates posture). */
  storeStats(): ReturnType<ConnectionStore["stats"]> {
    return this.store.stats();
  }

  /** The store (for durable runs' lifecycle: close it when done). */
  get backingStore(): ConnectionStore {
    return this.store;
  }
}

/** Re-exported so consumers validate reports without importing schema.ts. */
export { ConnectionStatusReport };
