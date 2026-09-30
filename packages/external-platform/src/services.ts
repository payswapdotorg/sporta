/**
 * The external application services (REL-014) — THE ONE TRUTH both the
 * HTTP surface and the MCP tool surface map onto ("API and MCP expose the
 * same Sporta application capabilities. Neither adapter creates a second
 * job, rights, artifact or promotion authority." — the contract's first
 * principle, frozen).
 *
 * Every operation is a VERSIONED application service
 * (`EXTERNAL_SERVICE_VERSION` rides on every envelope). Long jobs (lab
 * runs, media processing, feed processing) return a DURABLE JOB IDENTIFIER
 * immediately, backed by the real @sporta/durable-jobs store — the
 * embedding WorkerRuntime (with this package's executors registered)
 * executes them; canonical state never leaves Sporta.
 *
 * The laws enforced here (tested):
 * - TENANT/PLATFORM ISOLATION: reads resolve only within the connection's
 *   scope — a foreign job is a typed not-found, never a leak.
 * - IDEMPOTENCY KEYS: a repeat mutation with the same key returns the SAME
 *   envelope; the same key with a DIFFERENT request is a typed conflict
 *   (never silently re-run).
 * - RIGHTS/POLICY DELEGATION: media/feeds ride the corpus state machine
 *   (no declared basis -> `corpus.rights-basis-required` propagates typed);
 *   organization selection requires a SELECTABLE organization; promotion
 *   rides the registry's automated gates with the platform's NAMED policy.
 * - FAIL-CLOSED OUTPUT: `getOutput`/`getEvidence` refuse typed until the
 *   job COMPLETED — a cancelled or failed job has no authoritative output.
 */
import {
  choiceForRequest,
  isSelectableStatus,
  requestPromotion,
  toChoiceCandidate,
} from "@sporta/organization-registry";
import type { OrganizationRegistry } from "@sporta/organization-registry";
import type { CorpusStore, SourceRecord } from "@sporta/historical-corpus";
import type { JobStore } from "@sporta/durable-jobs";
import type { z } from "zod";
import type { PlatformConnection } from "./domain";
import {
  EXTERNAL_SERVICE_VERSION,
  InspectOrganizationRequestSchema,
  JobScopedRequestSchema,
  LaunchLabRunRequestSchema,
  PromoteOrganizationRequestSchema,
  SearchOrganizationsRequestSchema,
  SubmitFeedRequestSchema,
  SubmitMediaRequestSchema,
} from "./domain";
import type {
  CancelJobResult,
  ExternalServiceEnvelope,
  ExternalServiceName,
  GetEvidenceResult,
  GetJobResult,
  GetOutputResult,
  InspectOrganizationResult,
  IntegrationScopeRecord,
  LaunchLabRunResult,
  PromoteOrganizationResult,
  SearchOrganizationsResult,
  SubmitFeedResult,
  SubmitMediaResult,
  TenantScope,
} from "./domain";
import type { PlatformStores } from "./processing";
import {
  PlatformConflictError,
  PlatformJobStateError,
  PlatformNotFoundError,
  PlatformOrganizationPolicyError,
  PlatformValidationError,
} from "./errors";
import { createPlatformDefaultClock } from "./clock";
import type { IdSource } from "./clock";
import { canonicalJson } from "./hash";

// ---------------------------------------------------------------------------
// The services port
// ---------------------------------------------------------------------------

/** The ten versioned application services (one truth, two surfaces). */
export interface ExternalPlatformServices {
  searchOrganizations(
    connection: PlatformConnection,
    request: unknown,
  ): Promise<ExternalServiceEnvelope<SearchOrganizationsResult>>;
  inspectOrganization(
    connection: PlatformConnection,
    request: unknown,
  ): Promise<ExternalServiceEnvelope<InspectOrganizationResult>>;
  launchLabRun(
    connection: PlatformConnection,
    request: unknown,
  ): Promise<ExternalServiceEnvelope<LaunchLabRunResult>>;
  submitMedia(
    connection: PlatformConnection,
    request: unknown,
  ): Promise<ExternalServiceEnvelope<SubmitMediaResult>>;
  submitFeed(
    connection: PlatformConnection,
    request: unknown,
  ): Promise<ExternalServiceEnvelope<SubmitFeedResult>>;
  getJob(
    connection: PlatformConnection,
    request: unknown,
  ): Promise<ExternalServiceEnvelope<GetJobResult>>;
  cancelJob(
    connection: PlatformConnection,
    request: unknown,
  ): Promise<ExternalServiceEnvelope<CancelJobResult>>;
  getOutput(
    connection: PlatformConnection,
    request: unknown,
  ): Promise<ExternalServiceEnvelope<GetOutputResult>>;
  getEvidence(
    connection: PlatformConnection,
    request: unknown,
  ): Promise<ExternalServiceEnvelope<GetEvidenceResult>>;
  promoteOrganization(
    connection: PlatformConnection,
    request: unknown,
  ): Promise<ExternalServiceEnvelope<PromoteOrganizationResult>>;
}

/** Everything the services need (wired by createExternalPlatform). */
export interface ServicesDeps {
  readonly registry: OrganizationRegistry;
  readonly corpus: CorpusStore;
  readonly jobs: JobStore;
  readonly stores: PlatformStores;
  readonly clock?: () => number;
  readonly idSource?: IdSource;
  /** The integration-scope imports (keyed `platform/tenant/organization`). */
  readonly imports: Map<string, IntegrationScopeRecord>;
}

// ---------------------------------------------------------------------------
// The services
// ---------------------------------------------------------------------------

/** Creates the external application services over the shared deps. */
export function createExternalPlatformServices(deps: ServicesDeps): ExternalPlatformServices {
  const clock = deps.clock ?? createPlatformDefaultClock();
  /** The idempotency registry: `tenant/service/key` -> the stored envelope. */
  const idempotent = new Map<string, unknown>();
  /** The idempotency request digests: `tenant/service/key` -> request canonical JSON. */
  const idempotentRequests = new Map<string, string>();

  function scopeOf(connection: PlatformConnection): TenantScope {
    return { platformId: connection.platformId, tenantId: connection.tenantId };
  }

  /** Parses + validates a request against its schema (typed validation error). */
  function parse<T>(schema: z.ZodType<T>, request: unknown, service: ExternalServiceName): T {
    const parsed = schema.safeParse(request);
    if (!parsed.success) {
      throw new PlatformValidationError(
        `the ${service} request violates the contract shape`,
        parsed.error.issues,
      );
    }
    return parsed.data;
  }

  /**
   * The idempotency law: same key + same request -> the SAME envelope;
   * same key + different request -> typed conflict; returns null on a miss.
   */
  function idempotencyHit<T>(
    connection: PlatformConnection,
    service: ExternalServiceName,
    request: { readonly idempotencyKey?: string },
  ): ExternalServiceEnvelope<T> | null {
    const key = request.idempotencyKey;
    if (key === undefined) return null;
    const mapKey = `${connection.platformId}/${connection.tenantId}/${service}/${key}`;
    const digest = canonicalJson({ ...request, idempotencyKey: undefined });
    const priorDigest = idempotentRequests.get(mapKey);
    if (priorDigest !== undefined && priorDigest !== digest) {
      throw new PlatformConflictError(
        `idempotency key ${key} was already used with a DIFFERENT ${service} request (repeat the original request or use a new key; a mutation is never silently re-run)`,
        { service, idempotencyKey: key },
      );
    }
    const prior = idempotent.get(mapKey);
    if (prior !== undefined) {
      return prior as ExternalServiceEnvelope<T>;
    }
    idempotentRequests.set(mapKey, digest);
    return null;
  }

  function remember<T>(
    connection: PlatformConnection,
    service: ExternalServiceName,
    request: { readonly idempotencyKey?: string },
    envelope: ExternalServiceEnvelope<T>,
  ): ExternalServiceEnvelope<T> {
    const key = request.idempotencyKey;
    if (key === undefined) return envelope;
    const mapKey = `${connection.platformId}/${connection.tenantId}/${service}/${key}`;
    idempotent.set(mapKey, deepFreeze(envelope));
    return envelope;
  }

  /** The tenant-scoped job read: a foreign job is a typed not-found, never a leak. */
  async function scopedJob(connection: PlatformConnection, jobId: string) {
    const record = await deps.jobs.get(jobId); // typed jobs.not-found when unknown
    const input = record.input as { scope?: TenantScope } | null;
    const scope =
      typeof input === "object" && input !== null && input.scope !== undefined
        ? input.scope
        : undefined;
    if (
      scope === undefined ||
      scope.platformId !== connection.platformId ||
      scope.tenantId !== connection.tenantId
    ) {
      throw new PlatformNotFoundError(
        `no job with id ${jobId} in this platform/tenant scope (isolation: existence is not leaked)`,
        { jobId },
      );
    }
    return record;
  }

  /** Resolves the selectable organization for a processing request. */
  async function requireSelectableOrganization(organizationId: string): Promise<void> {
    const record = await deps.registry.get(organizationId); // typed registry not-found
    if (!isSelectableStatus(record.status)) {
      throw new PlatformOrganizationPolicyError(
        `organization ${organizationId} is in status ${record.status} — only validated/canary/production organizations are selectable for platform processing (draft/benchmarked carry unproven evidence; retired is dead)`,
        { organizationId, status: record.status },
      );
    }
  }

  const envelope = <T>(service: ExternalServiceName, result: T): ExternalServiceEnvelope<T> => ({
    service,
    version: EXTERNAL_SERVICE_VERSION,
    result: deepFreeze(result),
  });

  return {
    async searchOrganizations(connection, request) {
      const clean = parse(SearchOrganizationsRequestSchema, request, "searchOrganizations");
      const choice = await choiceForRequest(deps.registry, clean.query, clean.ordering);
      return envelope("searchOrganizations", {
        candidates: choice.candidates,
        ordering: choice.ordering,
        orderedBy: choice.orderedBy,
      });
    },

    async inspectOrganization(connection, request) {
      const clean = parse(InspectOrganizationRequestSchema, request, "inspectOrganization");
      const record = await deps.registry.get(clean.organizationId); // typed not-found
      return envelope("inspectOrganization", {
        organization: toChoiceCandidate(record),
      });
    },

    async launchLabRun(connection, request) {
      const clean = parse(LaunchLabRunRequestSchema, request, "launchLabRun");
      const hit = idempotencyHit<LaunchLabRunResult>(connection, "launchLabRun", clean);
      if (hit !== null) return hit;
      // The long job: a durable identifier returned IMMEDIATELY. The lab
      // execution engine (Worker A's lane) attaches behind the kind; the
      // durable store is the canonical state either way.
      const record = await deps.jobs.enqueue({
        kind: "external.lab-run",
        input: { scope: scopeOf(connection), labRun: clean.labRun },
      });
      return remember(
        connection,
        "launchLabRun",
        clean,
        envelope("launchLabRun", {
          jobId: record.jobId,
          kind: "external.lab-run",
          state: record.state,
          acceptedAt: clock(),
        }),
      );
    },

    async submitMedia(connection, request) {
      const clean = parse(SubmitMediaRequestSchema, request, "submitMedia");
      const hit = idempotencyHit<SubmitMediaResult>(connection, "submitMedia", clean);
      if (hit !== null) return hit;

      // The source: through the corpus state machine — RIGHTS ARE DELEGATED.
      // Bytes path: the user-fed law (no declared basis -> the corpus's
      // typed `corpus.rights-basis-required` refusal propagates unchanged).
      // Reference path: metadata only, state `referenced`, never bytes.
      let source: SourceRecord;
      if (clean.bytes !== undefined && clean.metadata !== undefined) {
        source = await deps.corpus.ingestUserUpload({
          bytes: clean.bytes,
          declaredBasis: clean.declaredBasis,
          metadata: clean.metadata,
        });
      } else if (clean.reference !== undefined) {
        source = await deps.corpus.registerReference(clean.reference);
      } else {
        // Unreachable given the schema's refine — fail-closed regardless.
        throw new PlatformValidationError(
          "submit exactly one of bytes+metadata (the upload path) or reference (the reference path)",
          [],
        );
      }

      // The processing job, when an organization was selected.
      let jobId: string | null = null;
      if (clean.organizationId !== undefined) {
        await requireSelectableOrganization(clean.organizationId);
        const job = await deps.jobs.enqueue({
          kind: "external.media-processing",
          input: {
            scope: scopeOf(connection),
            sourceId: source.sourceId,
            organizationId: clean.organizationId,
          },
        });
        jobId = job.jobId;
      }
      return remember(
        connection,
        "submitMedia",
        clean,
        envelope("submitMedia", {
          sourceId: source.sourceId,
          sourceState: source.state,
          canonicalUrl: source.canonicalUrl,
          jobId,
          jobKind: jobId === null ? null : "external.media-processing",
        }),
      );
    },

    async submitFeed(connection, request) {
      const clean = parse(SubmitFeedRequestSchema, request, "submitFeed");
      const hit = idempotencyHit<SubmitFeedResult>(connection, "submitFeed", clean);
      if (hit !== null) return hit;

      // Duplicate canonical references inside one feed are a caller error
      // (the second acquisition would hit an illegal transition).
      const urls = clean.items.map((item) => item.metadata.canonicalUrl);
      if (new Set(urls).size !== urls.length) {
        throw new PlatformValidationError(
          "the feed carries duplicate canonical references (each item must reference distinct content)",
          urls,
        );
      }

      // SOURCE VALIDATION: every item enters through the corpus state
      // machine. Byte items ride the full path (registerReference ->
      // authorizeAccess -> recordAcquiredBytes) preserving the feed's own
      // canonical references; the declared basis is REQUIRED (the corpus
      // gate refuses typed without one). Reference items are indexed only.
      const items: { sourceId: string; transformable: boolean }[] = [];
      for (const item of clean.items) {
        let record = await deps.corpus.getByCanonicalUrl(item.metadata.canonicalUrl);
        if (record === null) {
          record = await deps.corpus.registerReference(item.metadata);
        }
        if (item.bytes !== undefined) {
          const access = await deps.corpus.authorizeAccess(record.sourceId, item.declaredBasis);
          record = await deps.corpus.recordAcquiredBytes(record.sourceId, access, item.bytes, {
            acquisitionMethod: "external-feed:v1",
          });
          items.push({ sourceId: record.sourceId, transformable: true });
        } else {
          items.push({ sourceId: record.sourceId, transformable: false });
        }
      }

      // ORGANIZATION SELECTION from the eligible catalog: explicit (checked
      // selectable) or by query under the DECLARED ordering (no hidden
      // ranking — the choice model's own law).
      let organizationId: string;
      let orderedBy: string | null = null;
      if ("organizationId" in clean.organization) {
        organizationId = clean.organization.organizationId;
        await requireSelectableOrganization(organizationId);
      } else {
        const choice = await choiceForRequest(
          deps.registry,
          clean.organization.query,
          clean.organization.ordering,
        );
        orderedBy = choice.orderedBy;
        const first = choice.candidates[0];
        if (first === undefined) {
          throw new PlatformOrganizationPolicyError(
            "no eligible organization for the feed's selection query (submit one explicitly, or widen the query)",
            { orderedBy: choice.orderedBy },
          );
        }
        organizationId = first.organizationId;
      }

      // THE LONG JOB: the durable feed identifier, returned immediately.
      const requireTransformation = clean.requireTransformation ?? true;
      const job = await deps.jobs.enqueue({
        kind: "external.feed-processing",
        input: {
          scope: scopeOf(connection),
          items,
          organizationId,
          requireTransformation,
        },
      });
      return remember(
        connection,
        "submitFeed",
        clean,
        envelope("submitFeed", {
          jobId: job.jobId,
          kind: "external.feed-processing",
          itemCount: items.length,
          transformableItemCount: items.filter((item) => item.transformable).length,
          organizationId,
          orderedBy,
        }),
      );
    },

    async getJob(connection, request) {
      const clean = parse(JobScopedRequestSchema, request, "getJob");
      const record = await scopedJob(connection, clean.jobId);
      return envelope("getJob", {
        job: {
          jobId: record.jobId,
          kind: record.kind,
          state: record.state,
          attempts: record.attempts,
          checkpointCount: record.checkpoints.length,
          cancellationRequested: record.cancellationRequested,
          outputArtifactRefs: [...record.outputArtifactRefs],
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          completedAt: record.completedAt,
        },
      });
    },

    async cancelJob(connection, request) {
      const clean = parse(JobScopedRequestSchema, request, "cancelJob");
      await scopedJob(connection, clean.jobId); // isolation first
      // The cooperative cancellation request through the durable store
      // (terminal states refuse typed jobs.illegal-transition — fail-closed).
      const record = await deps.jobs.requestCancellation(clean.jobId);
      return envelope("cancelJob", {
        jobId: record.jobId,
        state: record.state,
        cancellationRequested: record.cancellationRequested,
        cancelled: record.state === "cancelled",
      });
    },

    async getOutput(connection, request) {
      const clean = parse(JobScopedRequestSchema, request, "getOutput");
      const record = await scopedJob(connection, clean.jobId);
      if (record.state !== "completed") {
        throw new PlatformJobStateError(
          `no authoritative output for job ${clean.jobId}: the job is ${record.state} (output is published only at completion — cancelled and failed jobs leave none)`,
          { jobId: clean.jobId, state: record.state },
        );
      }
      const artifact = await deps.stores.artifactOf(clean.jobId);
      if (artifact === null) {
        throw new PlatformJobStateError(
          `job ${clean.jobId} completed but carries no platform output artifact (its kind may not be a platform processing job)`,
          { jobId: clean.jobId },
        );
      }
      return envelope("getOutput", { artifact: artifact.record, bytes: artifact.bytes });
    },

    async getEvidence(connection, request) {
      const clean = parse(JobScopedRequestSchema, request, "getEvidence");
      const record = await scopedJob(connection, clean.jobId);
      if (record.state !== "completed") {
        throw new PlatformJobStateError(
          `no evidence bundle for job ${clean.jobId}: the job is ${record.state} (evidence is published only at completion)`,
          { jobId: clean.jobId, state: record.state },
        );
      }
      const evidence = await deps.stores.evidenceOf(clean.jobId);
      if (evidence === null) {
        throw new PlatformJobStateError(
          `job ${clean.jobId} completed but carries no platform evidence bundle (its kind may not be a platform processing job)`,
          { jobId: clean.jobId },
        );
      }
      return envelope("getEvidence", { evidence });
    },

    async promoteOrganization(connection, request) {
      const clean = parse(PromoteOrganizationRequestSchema, request, "promoteOrganization");
      const hit = idempotencyHit<PromoteOrganizationResult>(
        connection,
        "promoteOrganization",
        clean,
      );
      if (hit !== null) return hit;

      // The registry's AUTOMATED decision — one legal forward step through
      // the evidence gates, under the platform's NAMED policy. Refusals are
      // returned records (typed evidence), never throws.
      const outcome = await requestPromotion(deps.registry, {
        organizationId: clean.organizationId,
        policy: clean.policy,
        additionalEvidence: clean.additionalEvidence as never,
      });

      // The integration-scope import: only a SELECTABLE organization (its
      // latest status) enters the platform's scope — "import a validated
      // organization into its integration scope".
      const record = await deps.registry.get(clean.organizationId);
      const importable = isSelectableStatus(record.status);
      let integrationScope: IntegrationScopeRecord | null = null;
      if (importable) {
        const key = `${connection.platformId}/${connection.tenantId}/${clean.organizationId}`;
        const existing = deps.imports.get(key);
        if (existing === undefined || existing.version !== record.version) {
          integrationScope = {
            platformId: connection.platformId,
            tenantId: connection.tenantId,
            organizationId: record.organizationId,
            version: record.version,
            status: record.status,
            importedAt: clock(),
          };
          deps.imports.set(key, integrationScope);
        } else {
          integrationScope = existing; // idempotent re-import
        }
      }
      return remember(
        connection,
        "promoteOrganization",
        clean,
        envelope("promoteOrganization", {
          outcome,
          imported: importable,
          integrationScope,
        }),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Deep freeze (the repo precedent): envelopes handed out are immutable. */
function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === "object") {
    if (value instanceof Uint8Array) return value; // bytes stay usable
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    return Object.freeze(value);
  }
  return value;
}
