/**
 * The Organization Registry store (REL-017): versioned records + an
 * append-only, hash-chained transition log.
 *
 * THE INVARIANT PAIR (docs/contracts/organization-registry-and-promotion.md
 * + §Retirement):
 * - every mutation of an organization record produces a NEW VERSION (v1 is
 *   the draft registration; nothing is ever edited in place);
 * - every version-producing operation AND every refused lifecycle attempt
 *   appends one entry to the transition log (actor/system, gate results,
 *   evidence summary, from -> to, timestamp) — the log is the audit trail.
 *
 * The log is tamper-evident: each entry's hash covers its full canonical
 * content plus the previous entry's hash (a single chain across the whole
 * log), so `verifyTransitionLog()` re-derives the chain and any mutation,
 * removal or reordering of history breaks it.
 *
 * Lifecycle status changes enter ONLY through `applyLifecycleTransition`,
 * which re-checks the state machine (src/state-machine.ts) — the promotion
 * service evaluates gates and produces typed refusals; this store is the
 * last line of defense against an illegal edge.
 *
 * Constitution: no wall time, no randomness — clock + entry ids are
 * injected (src/clock.ts). In-memory this wave; the store shape is the
 * port-friendly seam for a future durable adapter.
 */
import { z } from "zod";
import type {
  ActorRef,
  AdditionalEvidence,
  EligibilityQuery,
  OrganizationRecord,
  OrganizationStatus,
  RollbackTrigger,
} from "./domain";
import {
  AdditionalEvidenceSchema,
  EligibilityQuerySchema,
  EvidenceBundleSchema,
  NewOrganizationInputSchema,
  isSelectableStatus,
  matchesQuery,
} from "./domain";
import { createDefaultEntryIdSource, createRegistryDefaultClock, toIsoUtc } from "./clock";
import type { IdSource } from "./clock";
import {
  RegistryConflictError,
  RegistryInternalError,
  RegistryNotFoundError,
  RegistryValidationError,
} from "./errors";
import type { GateResult } from "./gates";
import { lifecycleEdge } from "./state-machine";

// ---------------------------------------------------------------------------
// The transition log
// ---------------------------------------------------------------------------

/** What kind of operation produced (or refused) a log entry. */
export type LogOperation = "registration" | "evidence-update" | "promotion" | "rollback";

/**
 * One append-only log entry. Granted lifecycle attempts bump the record
 * version and change the status; refused attempts keep both and carry a
 * `refusalReason`. Every entry is hash-chained to its predecessor.
 */
export interface TransitionLogEntry {
  entryId: string;
  organizationId: string;
  operation: LogOperation;
  /** The record version before the operation (0 for registration). */
  fromVersion: number;
  /** The record version after (equal to fromVersion on a refusal). */
  toVersion: number;
  /** Status before (null for registration). */
  fromStatus: OrganizationStatus | null;
  /** Status after (equal to fromStatus on a refusal / evidence update). */
  toStatus: OrganizationStatus;
  /** Who performed it: a user/account or the automated policy engine. */
  actor: ActorRef;
  /** The gate results evaluated for this attempt (empty for registration / evidence updates). */
  gateResults: readonly GateResult[];
  /** Human-auditable summary naming the law and the numbers. */
  detail: string;
  /** Present iff a lifecycle attempt was refused — the typed refusal reason. */
  refusalReason?: string;
  /** Present iff a rollback was granted — the recorded trigger. */
  rollbackTrigger?: RollbackTrigger;
  /** ISO-8601 UTC, from the injected clock. */
  recordedAt: string;
  /** The previous entry's hash ("GENESIS" for the first entry of the log). */
  previousEntryHash: string;
  /** SHA-256 over the canonical JSON of everything above. */
  entryHash: string;
}

/** The predecessor hash of the first entry of the log. */
export const GENESIS_HASH = "GENESIS";

// ---------------------------------------------------------------------------
// Canonical JSON + hashing
// ---------------------------------------------------------------------------

/** Recursively key-sorted, `undefined`-stripped canonical JSON form. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const record: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) record[key] = canonicalize(item);
    }
    return record;
  }
  return value;
}

/** SHA-256 hex digest of a string (the repo's sessions.ts precedent). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The canonical hash preimage of a log entry (everything but the hashes). */
type EntryPreimage = Omit<TransitionLogEntry, "entryHash" | "previousEntryHash">;

function entryPreimage(entry: EntryPreimage, previousEntryHash: string): string {
  return canonicalJson({ ...entry, previousEntryHash });
}

// ---------------------------------------------------------------------------
// Deep freeze (records and entries are handed out immutable)
// ---------------------------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    return Object.freeze(value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/** Options for {@link createOrganizationRegistry}. */
export interface OrganizationRegistryOptions {
  /** Injected clock (deterministic default — never `Date.now`). */
  clock?: () => number;
  /** Injected entry-id source (deterministic default: `entry-1`, ...). */
  entryIds?: IdSource;
}

/** A lifecycle transition request (the promotion/rollback seam). */
export interface LifecycleTransitionRequest {
  toStatus: OrganizationStatus;
  operation: "promotion" | "rollback";
  actor: ActorRef;
  gateResults: readonly GateResult[];
  detail: string;
  rollbackTrigger?: RollbackTrigger;
}

/** The result of a granted lifecycle transition. */
export interface LifecycleTransitionResult {
  record: OrganizationRecord;
  entry: TransitionLogEntry;
}

/** A refused lifecycle attempt to append to the audit log. */
export interface RefusalLogRequest {
  operation: "promotion" | "rollback";
  actor: ActorRef;
  gateResults: readonly GateResult[];
  detail: string;
  refusalReason: string;
}

/** The Organization Registry port. */
export interface OrganizationRegistry {
  /** Registers a new organization: draft, version 1, genesis log entry. */
  register(input: unknown, actor: ActorRef): Promise<OrganizationRecord>;
  /** The latest version of a record (typed not-found when unknown). */
  get(organizationId: string): Promise<OrganizationRecord>;
  /** A specific version (typed not-found when unknown). */
  getVersion(organizationId: string, version: number): Promise<OrganizationRecord>;
  /** Latest versions of all organizations, in registration order. */
  list(): Promise<OrganizationRecord[]>;
  /** Every version of one organization, oldest first. */
  listVersions(organizationId: string): Promise<OrganizationRecord[]>;
  /**
   * Merges additional evidence into a record: new version, same status,
   * `evidence-update` log entry. Evidence is data — adding it never promotes.
   */
  recordEvidence(
    organizationId: string,
    additional: AdditionalEvidence,
    actor: ActorRef,
    note?: string,
  ): Promise<OrganizationRecord>;
  /**
   * REL-017 query: production-eligible organizations by domain / task /
   * latency / budget (selectable statuses only). Same matching rule the
   * choice read model uses (one truth: `matchesQuery`).
   */
  queryEligible(query: EligibilityQuery): Promise<OrganizationRecord[]>;
  /**
   * The ONLY path to a lifecycle status change: re-checks the state machine
   * and throws a typed conflict if the edge is illegal (defense in depth —
   * the promotion layer refuses typed first).
   */
  applyLifecycleTransition(
    organizationId: string,
    request: LifecycleTransitionRequest,
  ): Promise<LifecycleTransitionResult>;
  /** Appends a refused lifecycle attempt to the audit log (no version bump). */
  appendLifecycleRefusal(
    organizationId: string,
    request: RefusalLogRequest,
  ): Promise<TransitionLogEntry>;
  /** The append-only log (whole log, or one organization's slice). */
  transitionLog(organizationId?: string): Promise<readonly TransitionLogEntry[]>;
  /** Re-derives the hash chain: `true` iff the log is untampered. */
  verifyTransitionLog(): Promise<boolean>;
}

/** Builds an in-memory Organization Registry. */
export function createOrganizationRegistry(
  options: OrganizationRegistryOptions = {},
): OrganizationRegistry {
  const clock = options.clock ?? createRegistryDefaultClock();
  const entryIds = options.entryIds ?? createDefaultEntryIdSource();
  /** organizationId -> all versions, oldest first (last = latest). */
  const records = new Map<string, OrganizationRecord[]>();
  /** The single append-only log, chained across all organizations. */
  const log: TransitionLogEntry[] = [];

  async function appendEntry(entry: EntryPreimage): Promise<TransitionLogEntry> {
    const previous = log.length > 0 ? log[log.length - 1] : undefined;
    const previousEntryHash = previous !== undefined ? previous.entryHash : GENESIS_HASH;
    const entryHash = await sha256Hex(entryPreimage(entry, previousEntryHash));
    const frozen = deepFreeze({ ...entry, previousEntryHash, entryHash });
    log.push(frozen);
    return frozen;
  }

  function versionsOf(organizationId: string): OrganizationRecord[] {
    const versions = records.get(organizationId);
    if (versions === undefined) {
      throw new RegistryNotFoundError("organization not found", { organizationId });
    }
    return versions;
  }

  function latestOf(organizationId: string): OrganizationRecord {
    const versions = versionsOf(organizationId);
    const latest = versions[versions.length - 1];
    if (latest === undefined) {
      throw new RegistryInternalError("registry invariant broken: empty version list", {
        organizationId,
      });
    }
    return latest;
  }

  function pushVersion(next: OrganizationRecord): void {
    const versions = records.get(next.organizationId);
    if (versions === undefined) {
      throw new RegistryNotFoundError("organization not found", {
        organizationId: next.organizationId,
      });
    }
    versions.push(next);
  }

  function zodIssues(error: z.ZodError): unknown[] {
    return error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    }));
  }

  function storeRecord(record: OrganizationRecord): OrganizationRecord {
    return deepFreeze(record);
  }

  return {
    async register(input, actor) {
      const parsed = NewOrganizationInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new RegistryValidationError(
          "organization registration input is invalid",
          zodIssues(parsed.error),
        );
      }
      const value = parsed.data;
      if (records.has(value.organizationId)) {
        throw new RegistryConflictError("organizationId already registered", {
          organizationId: value.organizationId,
        });
      }
      const now = toIsoUtc(clock());
      const record = storeRecord({
        organizationId: value.organizationId,
        version: 1,
        displayName: value.displayName,
        status: "draft",
        domain: value.domain,
        capabilities: value.capabilities,
        profile: value.profile,
        evidence: value.evidence ?? {},
        provenance: value.provenance,
        createdAt: now,
        updatedAt: now,
      });
      records.set(record.organizationId, [record]);
      await appendEntry({
        entryId: entryIds.nextId(),
        organizationId: record.organizationId,
        operation: "registration",
        fromVersion: 0,
        toVersion: 1,
        fromStatus: null,
        toStatus: "draft",
        actor,
        gateResults: [],
        detail: `registered '${record.displayName}' in draft from ${
          record.provenance.createdFrom !== null
            ? `lab run ${record.provenance.createdFrom.labRunId}`
            : "direct hand-engineered registration"
        }`,
        recordedAt: now,
      });
      return record;
    },

    async get(organizationId) {
      return latestOf(organizationId);
    },

    async getVersion(organizationId, version) {
      const found = versionsOf(organizationId).find((r) => r.version === version);
      if (found === undefined) {
        throw new RegistryNotFoundError("organization version not found", {
          organizationId,
          version,
        });
      }
      return found;
    },

    async list() {
      const latest: OrganizationRecord[] = [];
      for (const versions of records.values()) {
        const record = versions[versions.length - 1];
        if (record === undefined) {
          throw new RegistryInternalError("registry invariant broken: empty version list");
        }
        latest.push(record);
      }
      return latest;
    },

    async listVersions(organizationId) {
      return [...versionsOf(organizationId)];
    },

    async recordEvidence(organizationId, additional, actor, note) {
      const current = latestOf(organizationId);
      const parsedAdditional = AdditionalEvidenceSchema.safeParse(additional);
      if (!parsedAdditional.success) {
        throw new RegistryValidationError(
          "additional evidence is invalid",
          zodIssues(parsedAdditional.error),
        );
      }
      const merged = { ...current.evidence, ...parsedAdditional.data };
      const parsedMerged = EvidenceBundleSchema.safeParse(merged);
      if (!parsedMerged.success) {
        throw new RegistryValidationError(
          "merged evidence bundle is invalid",
          zodIssues(parsedMerged.error),
        );
      }
      const now = toIsoUtc(clock());
      const next = storeRecord({
        ...current,
        version: current.version + 1,
        evidence: parsedMerged.data,
        updatedAt: now,
      });
      pushVersion(next);
      const added = Object.keys(parsedAdditional.data);
      await appendEntry({
        entryId: entryIds.nextId(),
        organizationId,
        operation: "evidence-update",
        fromVersion: current.version,
        toVersion: next.version,
        fromStatus: current.status,
        toStatus: next.status,
        actor,
        gateResults: [],
        detail:
          note ??
          `evidence added: ${added.length > 0 ? added.join(", ") : "(none)"} (status unchanged)`,
        recordedAt: now,
      });
      return next;
    },

    async queryEligible(query) {
      const parsed = EligibilityQuerySchema.safeParse(query);
      if (!parsed.success) {
        throw new RegistryValidationError("eligibility query is invalid", zodIssues(parsed.error));
      }
      const latest = await this.list();
      return latest.filter(
        (record) => isSelectableStatus(record.status) && matchesQuery(record, parsed.data),
      );
    },

    async applyLifecycleTransition(organizationId, request) {
      const current = latestOf(organizationId);
      const edge = lifecycleEdge(current.status, request.toStatus);
      if (edge === null || edge.operation !== request.operation) {
        throw new RegistryConflictError(
          `illegal lifecycle transition refused at the store: ${current.status} -> ${request.toStatus} as ${request.operation}`,
          { organizationId, from: current.status, to: request.toStatus },
        );
      }
      const now = toIsoUtc(clock());
      const next = storeRecord({
        ...current,
        version: current.version + 1,
        status: request.toStatus,
        updatedAt: now,
      });
      pushVersion(next);
      const entry = await appendEntry({
        entryId: entryIds.nextId(),
        organizationId,
        operation: request.operation,
        fromVersion: current.version,
        toVersion: next.version,
        fromStatus: current.status,
        toStatus: next.status,
        actor: request.actor,
        gateResults: request.gateResults,
        detail: request.detail,
        ...(request.rollbackTrigger !== undefined
          ? { rollbackTrigger: request.rollbackTrigger }
          : {}),
        recordedAt: now,
      });
      return { record: next, entry };
    },

    async appendLifecycleRefusal(organizationId, request) {
      const current = latestOf(organizationId);
      const now = toIsoUtc(clock());
      return appendEntry({
        entryId: entryIds.nextId(),
        organizationId,
        operation: request.operation,
        fromVersion: current.version,
        toVersion: current.version,
        fromStatus: current.status,
        toStatus: current.status,
        actor: request.actor,
        gateResults: request.gateResults,
        detail: request.detail,
        refusalReason: request.refusalReason,
        recordedAt: now,
      });
    },

    async transitionLog(organizationId) {
      const entries =
        organizationId === undefined
          ? log
          : log.filter((entry) => entry.organizationId === organizationId);
      return [...entries];
    },

    async verifyTransitionLog() {
      let previousEntryHash = GENESIS_HASH;
      for (const entry of log) {
        if (entry.previousEntryHash !== previousEntryHash) return false;
        const { entryHash, ...rest } = entry;
        const expected = await sha256Hex(entryPreimage(rest, entry.previousEntryHash));
        if (entryHash !== expected) return false;
        previousEntryHash = entryHash;
      }
      return true;
    },
  };
}
