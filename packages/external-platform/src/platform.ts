/**
 * The external platform (REL-014) — the wiring: one platform instance holds
 * the shared stores (artifacts, evidence, integration-scope imports) and
 * exposes the versioned application services (the ONE truth) plus the job
 * executors an embedding WorkerRuntime registers. The HTTP surface
 * (src/http-surface.ts) and the MCP tool surface (src/mcp-surface.ts) are
 * created over the SAME services — that is the parity guarantee's ground.
 *
 * `connect` mints a PlatformConnection: the tenant/platform isolation
 * scope. State never lives in the connection — a reconnect is a new
 * connection over the same canonical stores (job store, corpus, registry),
 * which is exactly what Gate REL-A7's "reconnect" exercises.
 */
import type { CorpusStore } from "@sporta/historical-corpus";
import type { JobStore, JobExecutor } from "@sporta/durable-jobs";
import type { OrganizationRegistry } from "@sporta/organization-registry";
import type { PlatformConnection } from "./domain";
import { ConnectRequestSchema } from "./domain";
import type { IntegrationScopeRecord } from "./domain";
import { createExternalPlatformServices } from "./services";
import type { ExternalPlatformServices, ServicesDeps } from "./services";
import {
  createFeedProcessingExecutor,
  createHeaderTransformer,
  createMediaProcessingExecutor,
  createPlatformStores,
  createChecksumQualityGate,
} from "./processing";
import type {
  PlatformQualityGate,
  PlatformStores,
  PlatformTransformer,
  ProcessingDeps,
} from "./processing";
import { PlatformValidationError } from "./errors";
import { createPlatformDefaultClock, createDefaultConnectionIdSource } from "./clock";
import type { IdSource } from "./clock";

/** Everything the platform needs. */
export interface ExternalPlatformDeps {
  /** The organization registry (the eligible catalog + promotion gates). */
  readonly registry: OrganizationRegistry;
  /** The historical corpus (the rights-gated source store). */
  readonly corpus: CorpusStore;
  /** The durable job store (the canonical long-job state). */
  readonly jobs: JobStore;
  /** Injected clock (default: the deterministic platform clock). */
  readonly clock?: () => number;
  /** Injected id source (default: `conn-1`, `conn-2`, ...). */
  readonly idSource?: IdSource;
  /** The render/transform port (default: the honest header transformer). */
  readonly transformer?: PlatformTransformer;
  /** The quality-gate port (default: the checksum/lineage gate). */
  readonly qualityGate?: PlatformQualityGate;
  /** Injected platform stores (default: the in-memory stores). */
  readonly stores?: PlatformStores;
}

/** One external platform: services + executors + connection minting. */
export interface ExternalPlatform {
  /** The ten versioned application services (the ONE truth). */
  readonly services: ExternalPlatformServices;
  /**
   * The job executors an embedding WorkerRuntime registers: the
   * media-processing and feed-processing engines (kinds
   * `external.media-processing` / `external.feed-processing`). The
   * `external.lab-run` kind has no executor in this wave — the lab
   * execution engine is Worker A's lane; the durable identifier is the
   * delivery here.
   */
  readonly executors: readonly JobExecutor[];
  /** Opens a connection (the tenant/platform isolation scope carrier). */
  connect(request: unknown): PlatformConnection;
}

/** Creates the external platform over the shared deps. */
export function createExternalPlatform(deps: ExternalPlatformDeps): ExternalPlatform {
  const clock = deps.clock ?? createPlatformDefaultClock();
  const idSource = deps.idSource ?? createDefaultConnectionIdSource();
  const transformer = deps.transformer ?? createHeaderTransformer();
  const qualityGate = deps.qualityGate ?? createChecksumQualityGate();
  const stores = deps.stores ?? createPlatformStores();
  const imports = new Map<string, IntegrationScopeRecord>();

  const processingDeps: ProcessingDeps = {
    corpus: deps.corpus,
    stores,
    transformer,
    qualityGate,
    clock,
    idSource,
  };
  const servicesDeps: ServicesDeps = {
    registry: deps.registry,
    corpus: deps.corpus,
    jobs: deps.jobs,
    stores,
    clock,
    idSource,
    imports,
  };

  return {
    services: createExternalPlatformServices(servicesDeps),
    executors: [
      createMediaProcessingExecutor(processingDeps),
      createFeedProcessingExecutor(processingDeps),
    ],
    connect(request) {
      const parsed = ConnectRequestSchema.safeParse(request);
      if (!parsed.success) {
        throw new PlatformValidationError(
          "the connect request violates the contract shape",
          parsed.error.issues,
        );
      }
      return Object.freeze({
        connectionId: idSource.nextId(),
        platformId: parsed.data.platformId,
        tenantId: parsed.data.tenantId,
        createdAt: clock(),
      });
    },
  };
}
