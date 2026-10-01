/**
 * The platform processing workspace (REL-024) — Gate REL-A10 as a real,
 * tested composition:
 *
 * ```
 * upload video -> choose/auto-select organization -> process
 *   -> quality gate -> retrieve transformed video + evidence chain
 * ```
 *
 * THE COMPOSITION LAW (binding): the workspace is a TYPED CLIENT AND
 * COMPOSER over the imported authorities — it is NEVER a second job,
 * rights, artifact, promotion or quality authority:
 *
 * - `createExternalPlatform` (imported from @sporta/external-platform)
 *   builds the services + the media/feed executors over the shared
 *   registry/corpus/job-store; the workspace wires its quality gate and
 *   nothing else. `submitMedia` rides the corpus state machine (the
 *   rights gate at birth, real digests); `searchOrganizations` /
 *   `inspectOrganization` ride the registry's choice read model; `getJob` /
 *   `getOutput` / `getEvidence` are the tenant-scoped reads (a foreign job
 *   is a typed not-found — existence is not leaked).
 * - the durable job surface is @sporta/durable-jobs' own: the store is the
 *   canonical long-job state, and the EMBEDDED WorkerRuntime executes the
 *   platform's executors (`external.media-processing` /
 *   `external.feed-processing`) with real lease/checkpoint discipline. A
 *   second runtime over `workspace.executors` + the same store resumes
 *   after a crash (the durability test proves it).
 * - the quality gate (src/quality.ts) composes the imported checksum gate
 *   with the organization record's DECLARED quality policy — typed
 *   refusals on failure, never silent passes.
 * - the evidence chain (evidenceChain) assembles the authorities' own
 *   records: corpus provenance + digests, the choice model's ordering
 *   statement, the organization record VERSION (the registry authority),
 *   the output artifact digests and the platform evidence bundle.
 *
 * The design permits future YouTube-like integrations without coupling
 * Sporta to any single platform: the workspace is provider-neutral (the
 * connection carries platformId/tenantId; nothing here knows a provider
 * name), and a real platform adapter plugs in BEHIND the same session
 * surface exactly where the fixtures' simulated platform sits.
 *
 * THE AUTO-SELECTION LAW: auto-select rides the choice model under a
 * DECLARED ordering — the workspace default (quality-descending on the
 * configured axis) or the caller's own — and the outcome records the
 * model's own `orderedBy` statement verbatim. There is no hidden ranking
 * field anywhere: the candidates considered are counted, the ordering is
 * in words, and an empty eligible set refuses typed.
 */
import { isSelectableStatus } from "@sporta/organization-registry";
import type { OrganizationRegistry } from "@sporta/organization-registry";
import type { ChoiceCandidate, ChoiceOrdering } from "@sporta/organization-registry";
import { createWorkerRuntime } from "@sporta/durable-jobs";
import type { JobExecutor, JobStore, WorkerRuntime } from "@sporta/durable-jobs";
import { createExternalPlatform } from "@sporta/external-platform";
import { PlatformOrganizationPolicyError } from "@sporta/external-platform";
import type {
  ExternalPlatform,
  ExternalPlatformServices,
  GetEvidenceResult,
  GetJobResult,
  GetOutputResult,
  PlatformConnection,
  PlatformQualityGate,
  PlatformStores,
  PlatformTransformer,
  SubmitMediaResult,
  TenantScope,
} from "@sporta/external-platform";
import type { BenchmarkRegistrar, CorpusStore } from "@sporta/historical-corpus";
import type { z } from "zod";
import { createOrganizationQualityGate } from "./quality";
import type { DeclaredQualityGateOptions } from "./quality";
import {
  AutoSelectionRequestSchema,
  ExplicitSelectionRequestSchema,
  JobScopedRequestSchema,
  OrganizationCatalogRequestSchema,
  ProcessVideoRequestSchema,
  UploadVideoRequestSchema,
} from "./domain";
import type {
  CatalogOutcome,
  JourneyEvidenceChain,
  ProcessingOutcome,
  SelectionMode,
  SelectionOutcome,
  UploadOutcome,
} from "./domain";
import {
  WorkspaceNotFoundError,
  WorkspaceOrganizationSelectionError,
  WorkspaceValidationError,
} from "./errors";
import { createDefaultConnectionIdSource, createWorkspaceDefaultClock } from "./clock";
import type { IdSource } from "./clock";

// ---------------------------------------------------------------------------
// The wiring options + the workspace port
// ---------------------------------------------------------------------------

/**
 * The DECLARED default auto-selection ordering: quality-descending on the
 * benchmark axis "fidelity" (the registry's own first-axis precedent). A
 * workspace may configure its own; the choice model's `orderedBy` statement
 * rides every auto-selection outcome, so the default is DOCUMENTED, never
 * hidden.
 */
export const DEFAULT_AUTO_ORDERING: ChoiceOrdering = {
  kind: "quality-descending",
  axis: "fidelity",
};

/** Everything the workspace composition needs. */
export interface PlatformWorkspaceOptions {
  /** The organization registry (the eligible catalog + record versions). */
  readonly registry: OrganizationRegistry;
  /** The historical corpus (the rights-gated source store). */
  readonly corpus: CorpusStore;
  /** The durable job store (the canonical long-job state). */
  readonly jobs: JobStore;
  /** The benchmark registrar (optional; the platform's default wiring applies). */
  readonly benchmarks?: BenchmarkRegistrar;
  /** Injected clock (default: the deterministic workspace clock). */
  readonly clock?: () => number;
  /** Injected id source (default: `conn-1`, `conn-2`, ...). */
  readonly idSource?: IdSource;
  /** The render/transform port (default: the platform's honest header transformer). */
  readonly transformer?: PlatformTransformer;
  /**
   * The quality-gate port (default: the organization-declared quality gate
   * over this registry — src/quality.ts).
   */
  readonly qualityGate?: PlatformQualityGate;
  /** Injected platform stores (default: the in-memory artifact/evidence stores). */
  readonly stores?: PlatformStores;
  /** The declared-quality floor the default gate enforces (default 0). */
  readonly qualityFloor?: DeclaredQualityGateOptions["qualityFloor"];
  /** The workspace's declared default auto-selection ordering. */
  readonly autoOrdering?: ChoiceOrdering;
  /** The embedded runtime's worker id (default "worker:workspace-1"). */
  readonly workerId?: string;
}

/** One platform workspace: the imported services + executors + sessions. */
export interface PlatformWorkspace {
  /** The versioned application services (THE ONE TRUTH — called, never re-implemented). */
  readonly services: ExternalPlatformServices;
  /**
   * The platform's job executors (`external.media-processing`,
   * `external.feed-processing`). The embedded runtime registers them; a
   * second runtime (crash-resume, extra workers) registers the SAME set.
   */
  readonly executors: readonly JobExecutor[];
  /** The durable job store the composition rides (the canonical long-job state). */
  readonly jobs: JobStore;
  /** The embedded worker runtime (one `runJob` = one driven attempt). */
  readonly runtime: WorkerRuntime;
  /** Opens a tenant-scoped session (the connection is the isolation carrier). */
  connect(request: unknown): WorkspaceSession;
}

// ---------------------------------------------------------------------------
// The session port (the tenant-scoped journey stages)
// ---------------------------------------------------------------------------

/** A tenant-scoped workspace session over one PlatformConnection. */
export interface WorkspaceSession {
  /** The connection (the platform/tenant isolation scope carrier). */
  readonly connection: PlatformConnection;

  // stage 1 — upload (the corpus gate rides underneath; real digests)
  uploadVideo(request: unknown): Promise<UploadOutcome>;

  // stage 2 — selection (the choice read model; declared ordering only)
  listOrganizations(request: unknown): Promise<CatalogOutcome>;
  chooseOrganization(request: unknown): Promise<SelectionOutcome>;
  autoSelectOrganization(request: unknown): Promise<SelectionOutcome>;

  // stage 3 — processing (the durable job surface)
  processVideo(request: unknown): Promise<ProcessingOutcome>;

  // stage 4 — drive + retrieve
  runJob(request: unknown): Promise<GetJobResult>;
  job(request: unknown): Promise<GetJobResult>;
  output(request: unknown): Promise<GetOutputResult>;
  evidence(request: unknown): Promise<GetEvidenceResult>;
  /** The full journey evidence chain (refuses typed until completion). */
  evidenceChain(request: unknown): Promise<JourneyEvidenceChain>;
}

// ---------------------------------------------------------------------------
// Internal journey state (the workspace's own staging discipline)
// ---------------------------------------------------------------------------

/** One recorded upload: the source + the scope that uploaded it. */
interface UploadLedgerEntry {
  readonly scope: TenantScope;
  readonly sourceId: string;
}

/** One recorded journey: the job + the stages that produced it. */
interface JourneyLedgerEntry {
  readonly scope: TenantScope;
  readonly jobId: string;
  readonly sourceId: string;
  readonly organizationId: string;
  readonly selection: { readonly mode: SelectionMode; readonly orderedBy: string | null };
}

// ---------------------------------------------------------------------------
// The composition
// ---------------------------------------------------------------------------

/** Builds the platform workspace over the shared deps. */
export function createPlatformWorkspace(options: PlatformWorkspaceOptions): PlatformWorkspace {
  const clock = options.clock ?? createWorkspaceDefaultClock();
  const idSource = options.idSource ?? createDefaultConnectionIdSource();
  const qualityGate =
    options.qualityGate ??
    createOrganizationQualityGate({
      registry: options.registry,
      qualityFloor: options.qualityFloor,
    });
  const autoOrdering = options.autoOrdering ?? DEFAULT_AUTO_ORDERING;

  // The imported platform: services + executors over the shared stores.
  const platform: ExternalPlatform = createExternalPlatform({
    registry: options.registry,
    corpus: options.corpus,
    jobs: options.jobs,
    ...(options.benchmarks !== undefined ? { benchmarks: options.benchmarks } : {}),
    clock,
    idSource,
    ...(options.transformer !== undefined ? { transformer: options.transformer } : {}),
    qualityGate,
    ...(options.stores !== undefined ? { stores: options.stores } : {}),
  });

  // The embedded runtime: the platform's executors over the shared store.
  const runtime = createWorkerRuntime({
    store: options.jobs,
    workerId: options.workerId ?? "worker:workspace-1",
    executors: platform.executors,
  });

  /** sourceId -> the scope that uploaded it (the staging discipline). */
  const uploads = new Map<string, UploadLedgerEntry>();
  /** jobId -> the journey record (scope + stages). */
  const journeys = new Map<string, JourneyLedgerEntry>();
  /** `platform/tenant/organizationId` -> the session-recorded selection statement. */
  const selections = new Map<string, { mode: SelectionMode; orderedBy: string | null }>();

  function parse<T>(schema: z.ZodType<T>, request: unknown, stage: string): T {
    const parsed = schema.safeParse(request);
    if (!parsed.success) {
      throw new WorkspaceValidationError(
        `the ${stage} request violates the workspace contract shape`,
        parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      );
    }
    return parsed.data;
  }

  function scopeOf(connection: PlatformConnection): TenantScope {
    return { platformId: connection.platformId, tenantId: connection.tenantId };
  }

  /** The selection statement for an organization as THIS scope last chose it. */
  function selectionOf(
    scope: TenantScope,
    organizationId: string,
  ): {
    mode: SelectionMode;
    orderedBy: string | null;
  } {
    return (
      selections.get(`${scope.platformId}/${scope.tenantId}/${organizationId}`) ?? {
        mode: "direct",
        orderedBy: null,
      }
    );
  }

  /** Deep freeze (the repo precedent): outcomes handed out are immutable. */
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

  return {
    services: platform.services,
    executors: platform.executors,
    jobs: options.jobs,
    runtime,

    connect(request) {
      const connection = platform.connect(request); // zod-validated, frozen

      return {
        connection,

        async uploadVideo(request) {
          const clean = parse(UploadVideoRequestSchema, request, "uploadVideo");
          // THE UPLOAD rides the service's bytes path: the corpus state
          // machine is the authority (rights basis at birth, real digests).
          // No organizationId: the upload stage ends at the source.
          const envelope = await platform.services.submitMedia(connection, {
            bytes: clean.bytes,
            declaredBasis: clean.declaredBasis,
            metadata: clean.metadata,
          });
          const submitted: SubmitMediaResult = envelope.result;
          uploads.set(submitted.sourceId, {
            scope: scopeOf(connection),
            sourceId: submitted.sourceId,
          });
          // The real digests come from the corpus record (the authority).
          const record = await options.corpus.get(submitted.sourceId);
          const outcome: UploadOutcome = deepFreeze({
            sourceId: record.sourceId,
            sourceState: record.state,
            canonicalUrl: record.canonicalUrl,
            acquiredChecksum: record.acquiredChecksum,
            metadataDigest: record.metadataDigest,
            rightsBasis: {
              basisType: record.rightsBasis?.basisType as UploadOutcome["rightsBasis"]["basisType"],
              grantRef: record.rightsBasis?.grantRef ?? "",
              declaredBy: record.rightsBasis?.declaredBy ?? "",
            },
          });
          return outcome;
        },

        async listOrganizations(request) {
          const clean = parse(OrganizationCatalogRequestSchema, request, "listOrganizations");
          const envelope = await platform.services.searchOrganizations(connection, {
            query: clean.query,
            ...(clean.ordering !== undefined ? { ordering: clean.ordering } : {}),
          });
          return deepFreeze({
            candidates: envelope.result.candidates,
            orderedBy: envelope.result.orderedBy,
          } satisfies CatalogOutcome);
        },

        async chooseOrganization(request) {
          const clean = parse(ExplicitSelectionRequestSchema, request, "chooseOrganization");
          // The service's own inspect: typed not-found when unknown; the
          // candidate carries status + visible evidence.
          const envelope = await platform.services.inspectOrganization(connection, {
            organizationId: clean.organizationId,
          });
          const candidate: ChoiceCandidate = envelope.result.organization;
          if (!isSelectableStatus(candidate.status)) {
            throw new PlatformOrganizationPolicyError(
              `organization ${clean.organizationId} is in status ${candidate.status} — only ` +
                `validated/canary/production organizations are selectable for platform processing ` +
                `(draft/benchmarked carry unproven evidence; retired is dead)`,
              { organizationId: clean.organizationId, status: candidate.status },
            );
          }
          selections.set(
            `${connection.platformId}/${connection.tenantId}/${clean.organizationId}`,
            {
              mode: "explicit",
              orderedBy: null,
            },
          );
          return deepFreeze({
            organization: candidate,
            organizationId: clean.organizationId,
            mode: "explicit",
            orderedBy: null,
            candidatesConsidered: 1,
          } satisfies SelectionOutcome);
        },

        async autoSelectOrganization(request) {
          const clean = parse(AutoSelectionRequestSchema, request, "autoSelectOrganization");
          const ordering = clean.ordering ?? autoOrdering;
          const envelope = await platform.services.searchOrganizations(connection, {
            query: clean.query,
            ordering,
          });
          const result = envelope.result;
          const first = result.candidates[0];
          if (first === undefined) {
            throw new WorkspaceOrganizationSelectionError(
              `no eligible organization for the auto-selection query (domain ` +
                `${clean.query.domain ?? "any"}, task ${clean.query.task ?? "any"}) under the ` +
                `declared ordering — submit an explicit organizationId or widen the query`,
              { orderedBy: result.orderedBy },
            );
          }
          selections.set(
            `${connection.platformId}/${connection.tenantId}/${first.organizationId}`,
            {
              mode: "auto",
              orderedBy: result.orderedBy,
            },
          );
          return deepFreeze({
            organization: first,
            organizationId: first.organizationId,
            mode: "auto",
            orderedBy: result.orderedBy,
            candidatesConsidered: result.candidates.length,
          } satisfies SelectionOutcome);
        },

        async processVideo(request) {
          const clean = parse(ProcessVideoRequestSchema, request, "processVideo");
          // The staging discipline: the source must have been uploaded
          // through THIS platform/tenant scope (typed refusal otherwise —
          // cross-tenant staging never silently proceeds).
          const upload = uploads.get(clean.sourceId);
          if (
            upload === undefined ||
            upload.scope.platformId !== connection.platformId ||
            upload.scope.tenantId !== connection.tenantId
          ) {
            throw new WorkspaceNotFoundError(
              `no upload of source '${clean.sourceId}' in this platform/tenant scope — the ` +
                `journey stages in order (uploadVideo first; isolation: existence is not leaked)`,
              { sourceId: clean.sourceId },
            );
          }
          // The organization must be SELECTABLE — the platform's own typed
          // policy family, exact same semantics as the service boundary.
          const record = await options.registry.get(clean.organizationId); // typed not-found
          if (!isSelectableStatus(record.status)) {
            throw new PlatformOrganizationPolicyError(
              `organization ${clean.organizationId} is in status ${record.status} — only ` +
                `validated/canary/production organizations are selectable for platform processing ` +
                `(draft/benchmarked carry unproven evidence; retired is dead)`,
              { organizationId: clean.organizationId, status: record.status },
            );
          }
          // THE JOB rides the durable store with the exact input shape the
          // platform's own service stamps (scope + source + organization).
          const job = await options.jobs.enqueue({
            kind: "external.media-processing",
            input: {
              scope: scopeOf(connection),
              sourceId: clean.sourceId,
              organizationId: clean.organizationId,
            },
          });
          const selection = selectionOf(scopeOf(connection), clean.organizationId);
          journeys.set(job.jobId, {
            scope: scopeOf(connection),
            jobId: job.jobId,
            sourceId: clean.sourceId,
            organizationId: clean.organizationId,
            selection,
          });
          return deepFreeze({
            jobId: job.jobId,
            kind: "external.media-processing",
            state: job.state,
            sourceId: clean.sourceId,
            organizationId: clean.organizationId,
            selection,
          } satisfies ProcessingOutcome);
        },

        async runJob(request) {
          const clean = parse(JobScopedRequestSchema, request, "runJob");
          // Isolation FIRST (a foreign job is a typed not-found; running
          // another scope's job is a cross-tenant write — refused here).
          await platform.services.getJob(connection, { jobId: clean.jobId });
          await runtime.runAttempt(clean.jobId); // one driven attempt, typed store faults surface
          const envelope = await platform.services.getJob(connection, { jobId: clean.jobId });
          return envelope.result;
        },

        async job(request) {
          const clean = parse(JobScopedRequestSchema, request, "job");
          const envelope = await platform.services.getJob(connection, { jobId: clean.jobId });
          return envelope.result;
        },

        async output(request) {
          const clean = parse(JobScopedRequestSchema, request, "output");
          const envelope = await platform.services.getOutput(connection, { jobId: clean.jobId });
          return envelope.result;
        },

        async evidence(request) {
          const clean = parse(JobScopedRequestSchema, request, "evidence");
          const envelope = await platform.services.getEvidence(connection, {
            jobId: clean.jobId,
          });
          return envelope.result;
        },

        async evidenceChain(request) {
          const clean = parse(JobScopedRequestSchema, request, "evidenceChain");
          // The journey record (scope-checked; a foreign journey is a typed
          // not-found — existence is not leaked).
          const journey = journeys.get(clean.jobId);
          if (
            journey === undefined ||
            journey.scope.platformId !== connection.platformId ||
            journey.scope.tenantId !== connection.tenantId
          ) {
            throw new WorkspaceNotFoundError(
              `no journey with job id '${clean.jobId}' in this platform/tenant scope — the ` +
                `evidence chain is scoped to the session that created it (isolation: existence ` +
                `is not leaked)`,
              { jobId: clean.jobId },
            );
          }
          // The output/evidence reads refuse typed until completion
          // (fail-closed: a failed or cancelled journey has no chain).
          const outputEnvelope = await platform.services.getOutput(connection, {
            jobId: clean.jobId,
          });
          const evidenceEnvelope = await platform.services.getEvidence(connection, {
            jobId: clean.jobId,
          });
          const jobEnvelope = await platform.services.getJob(connection, { jobId: clean.jobId });
          // The upload provenance leg — the corpus record (the authority).
          const source = await options.corpus.get(journey.sourceId);
          // The organization record version leg — the registry (the authority).
          const organization = await options.registry.get(journey.organizationId);
          const benchmark = organization.evidence.benchmark;
          const intervals = new Map(benchmark?.uncertainty.map((u) => [u.axis, u] as const) ?? []);
          const declaredQuality =
            benchmark === undefined
              ? null
              : benchmark.metrics.map((metric) => {
                  const interval = intervals.get(metric.axis);
                  return {
                    axis: metric.axis,
                    value: metric.value,
                    ciLow: interval?.ciLow ?? 0,
                    ciHigh: interval?.ciHigh ?? 0,
                  };
                });
          const artifact = outputEnvelope.result.artifact;
          const chain: JourneyEvidenceChain = deepFreeze({
            jobId: clean.jobId,
            scope: scopeOf(connection),
            job: jobEnvelope.result.job,
            upload: {
              sourceId: source.sourceId,
              canonicalUrl: source.canonicalUrl,
              provider: source.provider,
              sourceState: source.state,
              rightsBasis:
                source.rightsBasis === null
                  ? null
                  : {
                      basisType: source.rightsBasis.basisType,
                      grantRef: source.rightsBasis.grantRef,
                      declaredBy: source.rightsBasis.declaredBy,
                    },
              acquiredChecksum: source.acquiredChecksum,
              normalizedChecksum: source.normalized?.normalizedChecksum ?? null,
              metadataDigest: source.metadataDigest,
              restrictions: [...source.restrictions],
            },
            selection: {
              organizationId: journey.organizationId,
              mode: journey.selection.mode,
              orderedBy: journey.selection.orderedBy,
            },
            organization: {
              organizationId: organization.organizationId,
              version: organization.version,
              status: organization.status,
              displayName: organization.displayName,
              declaredQuality,
            },
            output: {
              artifactId: artifact.artifactId,
              artifactRef: artifact.artifactRef,
              checksum: artifact.checksum,
              byteLength: artifact.byteLength,
              kind: artifact.kind,
              items: artifact.items.map((item) => ({ ...item })),
              organizationId: artifact.organizationId,
            },
            evidence: evidenceEnvelope.result.evidence,
          });
          return chain;
        },
      };
    },
  };
}
