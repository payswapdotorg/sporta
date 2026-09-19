/**
 * Shared deterministic fixtures for the connection-center tests
 * (R406-R409): a manual clock, a credential-verifiable STUB adapter over
 * the REAL W914 in-memory reference adapter (dispatch/usage/stats run the
 * frozen contract code — only the credential surface is stubbed), plane
 * provider entries, W914 document builders, and a REPLAY transport that
 * consumes the `@sporta/compute-provider-adapters` committed fixtures
 * (never re-recording them — the recorded-fixture tier's rule).
 */
import { readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import {
  ComputeJobDescription,
  ComputeUsageRecord,
  InMemoryComputeAdapter,
  ComputeQuoteRequest,
} from "@sporta/compute-adapter";
import type {
  ComputeAdapterDescriptor,
  ComputeAdapterStats,
  ComputeCancelOutcome,
  ComputeDispatchOutcome,
  ComputeJobEvent,
  ComputeJobSnapshot,
  ComputeSubscription,
  ComputeUsageQuery,
  ComputeUsageRecord as UsageRecordDoc,
  MeterUsageFn,
} from "@sporta/compute-adapter";
import type { ProviderCredentialStatus } from "@sporta/compute-provider-adapters";
import type { CredentialVerifiableAdapter } from "../src/connections";
import type { AcceptedCredentialPresentation, AcceptedCredentialKind } from "../src/credentials";

/** The fetch shape the provider adapters' rest layer accepts (local restatement). */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------
// Clocks
// ---------------------------------------------------------------------------

/** A deterministic epoch for the injected clocks. */
export const TEST_EPOCH_MS = 1_700_000_000_000;

/** A manual clock: every read advances by `stepMs` (default 1). */
export function manualClock(startMs: number = TEST_EPOCH_MS, stepMs: number = 1): () => number {
  let current = startMs;
  return () => {
    const value = current;
    current += stepMs;
    return value;
  };
}

/** A frozen clock (one reading, forever — snapshot determinism). */
export function frozenClock(atMs: number = TEST_EPOCH_MS): () => number {
  return () => atMs;
}

// ---------------------------------------------------------------------------
// The credential-verifiable stub adapter (W914 real semantics + stub creds)
// ---------------------------------------------------------------------------

/**
 * A `CredentialVerifiableAdapter` over the REAL W914 in-memory reference
 * adapter: every compute method (dispatch/getJob/subscribe/cancel/usage/
 * stats) runs the frozen contract code; ONLY the credential surface is
 * stubbed (the tests set the honest status the "provider" would answer).
 */
export class StubVerifiableAdapter implements CredentialVerifiableAdapter {
  private readonly inner: InMemoryComputeAdapter;
  private currentStatus: ProviderCredentialStatus;

  constructor(options: {
    descriptor?: ComputeAdapterDescriptor;
    nowMs?: () => number;
    status?: ProviderCredentialStatus;
    meterUsage?: MeterUsageFn;
  }) {
    this.inner = new InMemoryComputeAdapter({
      descriptor:
        options.descriptor ??
        makeDescriptor({ adapterId: "adapter-stub", providerKind: "in-memory" }),
      nowMs: options.nowMs,
      ...(options.meterUsage !== undefined ? { meterUsage: options.meterUsage } : {}),
    });
    this.currentStatus = options.status ?? { state: "present-unverified" };
  }

  describe(): ComputeAdapterDescriptor {
    return this.inner.describe();
  }

  /** The in-memory adapter's simulated provider seam (drives jobs to terminal). */
  get innerProvider(): import("@sporta/compute-adapter").ComputeProviderPort {
    return this.inner.provider;
  }

  async dispatch(job: ComputeJobDescription): Promise<ComputeDispatchOutcome> {
    return this.inner.dispatch(job);
  }

  async getJob(jobId: string): Promise<ComputeJobSnapshot | null> {
    return this.inner.getJob(jobId);
  }

  async getJobOrFail(jobId: string): Promise<ComputeJobSnapshot> {
    return this.inner.getJobOrFail(jobId);
  }

  subscribe(jobId: string, sink: (event: ComputeJobEvent) => void): ComputeSubscription {
    return this.inner.subscribe(jobId, sink);
  }

  async cancel(jobId: string): Promise<ComputeCancelOutcome> {
    return this.inner.cancel(jobId);
  }

  async usage(query?: ComputeUsageQuery): Promise<UsageRecordDoc[]> {
    return this.inner.usage(query);
  }

  stats(): ComputeAdapterStats {
    return this.inner.stats();
  }

  credentialStatus(): ProviderCredentialStatus {
    return this.currentStatus;
  }

  async verifyCredentials(): Promise<ProviderCredentialStatus> {
    return this.currentStatus;
  }

  /** The test's honest provider verdict (what the REAL call would answer). */
  setStatus(status: ProviderCredentialStatus): void {
    this.currentStatus = status;
  }
}

// ---------------------------------------------------------------------------
// Descriptors, jobs, usage, quote requests (the W914 shapes)
// ---------------------------------------------------------------------------

/** A valid W914 descriptor for the stub plane (overridable). */
export function makeDescriptor(overrides: Record<string, unknown> = {}): ComputeAdapterDescriptor {
  return {
    schemaVersion: "1.0",
    adapterId: "adapter-stub",
    adapterVersion: "1.0",
    providerKind: "in-memory",
    supportedRenderers: [{ rendererId: "anime.prototype" }, { rendererId: "sporta.testcard" }],
    supportedLatencyClasses: ["offline"],
    maxConcurrentJobs: 2,
    dispatchTimeoutMs: 5_000,
    maxJobDeadlineMs: 600_000,
    costUnits: [
      { unitId: "compute-ms", unitKind: "time-ms", description: "injected-clock execution ms" },
      { unitId: "jobs", unitKind: "count", description: "one per settled job" },
    ],
    ...overrides,
  } as ComputeAdapterDescriptor;
}

/** A valid W914 job description (the R40x provider-adapter shape). */
export function buildJob(overrides: Record<string, unknown> = {}): ComputeJobDescription {
  const { rendererId, ...rest } = overrides;
  const job = {
    schemaVersion: "1.0",
    jobId: "cc-job-1",
    idempotencyKey: "cc-idem-1",
    sessionId: "cc-session-1",
    correlationId: "cc-corr-1",
    traceId: "cc-trace-1",
    renderer: {
      rendererId: (rendererId as string | undefined) ?? "anime.prototype",
    },
    recipe: { styleId: "style.default", configSchemaVersion: "1.0", config: { tone: "original" } },
    inputs: [{ inputId: "input-snapshot-1", kind: "swm-snapshot", ref: "sporta://swm/snapshot/1" }],
    outputProfile: {
      resolution: { w: 1280, h: 720 },
      frameRate: 30,
      codec: "av1",
      container: "mp4",
      latencyClass: "offline",
    },
    rights: { policyRef: "sporta://policy/dev", canReferenceSourceFrames: true },
    constraints: { deadlineMs: 60_000 },
    ...rest,
  };
  const parsed = ComputeJobDescription.safeParse(job);
  if (!parsed.success) {
    throw new Error(
      "test job builder produced an invalid ComputeJobDescription: " +
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }
  return parsed.data;
}

/** A valid W914 usage record (the ledger/settlement payload). */
export function buildUsageRecord(overrides: Record<string, unknown> = {}): UsageRecordDoc {
  const record = {
    schemaVersion: "1.0",
    jobId: "cc-job-1",
    idempotencyKey: "cc-idem-1",
    sessionId: "cc-session-1",
    adapterId: "adapter-stub",
    providerId: "provider.stub",
    terminalDisposition: "succeeded",
    timing: { queueWaitMs: 3, executionMs: 42 },
    attempts: 1,
    claims: 1,
    costUnits: [
      { unitId: "compute-ms", quantity: 42 },
      { unitId: "jobs", quantity: 1 },
    ],
    meteredAtMs: TEST_EPOCH_MS + 100,
    ...overrides,
  };
  const parsed = ComputeUsageRecord.safeParse(record);
  if (!parsed.success) {
    throw new Error(
      "test usage builder produced an invalid ComputeUsageRecord: " +
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }
  return parsed.data;
}

/** A valid R401 quote request (the logical workload). */
export function buildQuoteRequest(overrides: Record<string, unknown> = {}): ComputeQuoteRequest {
  return ComputeQuoteRequest.parse({
    schemaVersion: "1.0",
    rendererId: "anime.prototype",
    latencyClass: "offline",
    deadlineMs: 60_000,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Plane provider entries (the DATA + factory composition)
// ---------------------------------------------------------------------------

/** What a stub provider entry observed (the factory's transient view). */
export interface StubProviderObservations {
  /** Every presentation the factory consumed (values — TEST-ONLY memory). */
  presentations: Array<AcceptedCredentialPresentation | null>;
  /** The most recently built adapter. */
  lastAdapter: StubVerifiableAdapter | null;
}

/** Builds one stub provider entry (unique ids per test, please). */
export function stubPlaneProvider(options: {
  providerId: string;
  supportedCredentialKinds?: readonly AcceptedCredentialKind[];
  requiresCredential?: boolean;
  status?: ProviderCredentialStatus;
  descriptor?: ComputeAdapterDescriptor;
  nowMs?: () => number;
  meterUsage?: MeterUsageFn;
}): {
  provider: import("../src/connections").ConnectionPlaneProvider;
  observations: StubProviderObservations;
} {
  const observations: StubProviderObservations = {
    presentations: [],
    lastAdapter: null,
  };
  const kinds: readonly AcceptedCredentialKind[] = options.supportedCredentialKinds ?? [
    "scoped-api-key",
    "scoped-token-pair",
    "oauth-access-token",
  ];
  const requiresCredential = options.requiresCredential ?? kinds.length > 0;
  return {
    provider: {
      providerId: options.providerId,
      supportedCredentialKinds: kinds,
      requiresCredential,
      createAdapter: (presentation) => {
        const adapter = new StubVerifiableAdapter({
          // The descriptor id matches the plane's provider id (the broker
          // registers by provider id and the director walks descriptor
          // ids — the two must agree, exactly as the REAL provider
          // adapters' descriptor ids do).
          descriptor:
            options.descriptor ??
            makeDescriptor({ adapterId: options.providerId, providerKind: "in-memory" }),
          ...(options.nowMs !== undefined ? { nowMs: options.nowMs } : {}),
          ...(options.meterUsage !== undefined ? { meterUsage: options.meterUsage } : {}),
          ...(options.status !== undefined ? { status: options.status } : {}),
        });
        // Null presentations are descriptor probes (no credential rides
        // them) — only credential presentations are recorded as consumed.
        if (presentation !== null) observations.presentations.push(presentation);
        observations.lastAdapter = adapter;
        return adapter;
      },
    },
    observations,
  };
}

// ---------------------------------------------------------------------------
// The recorded-fixture tier (consumes the provider-adapters pins)
// ---------------------------------------------------------------------------

/** One recorded fixture (the pinned artifact under the sibling fixtures/). */
export interface PinnedFixture {
  scenario: string;
  provenance: { source: string; recordedAt: string; note: string };
  request: { method: string; pathSuffix: string };
  response?: { status: number; body?: unknown };
  networkError?: string;
}

/** Loads one recorded fixture from the provider-adapters package (fail-loud). */
export function loadProviderFixture(provider: string, scenario: string): PinnedFixture {
  const path = join(
    import.meta.dir,
    "..",
    "..",
    "compute-provider-adapters",
    "fixtures",
    provider,
    `${scenario}.json`,
  );
  return JSON.parse(readFileSync(path, "utf8")) as PinnedFixture;
}

/** One recorded transport call (credential header VALUES redacted). */
export interface RecordedCall {
  method: string;
  url: string;
  headers: Record<string, string>;
}

/**
 * The replay transport (the recorded-fixture tier): replays the pinned
 * fixtures in order, records every call (redacting credential-ish header
 * VALUES — never evidence), asserts the request matches the pin. This
 * MIRRORS the provider-adapters `FixtureTransport` (that helper lives in
 * their test tree, not the package exports — so the tier restates the
 * ~40 lines it needs rather than importing a foreign test module).
 */
export class ReplayTransport {
  readonly calls: RecordedCall[] = [];
  private readonly queue: PinnedFixture[];

  constructor(fixtures: PinnedFixture[]) {
    this.queue = [...fixtures];
  }

  readonly fetch: FetchLike = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const rawHeaders = (init?.headers ?? {}) as Record<string, string>;
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(rawHeaders)) {
      headers[name] = /token|secret|authorization|api[-_]?key/i.test(name) ? "***" : value;
    }
    this.calls.push({ method, url, headers });
    const next = this.queue.shift();
    if (next === undefined) {
      throw new Error(`replay transport exhausted at ${method} ${url}`);
    }
    if (!url.endsWith(next.request.pathSuffix) || method !== next.request.method) {
      throw new Error(
        `pinned request mismatch: ${method} ${url} vs pin ${next.request.method} *${next.request.pathSuffix} (scenario '${next.scenario}')`,
      );
    }
    if (next.networkError !== undefined) {
      throw new TypeError(next.networkError);
    }
    const status = next.response?.status ?? 200;
    const body = next.response?.body;
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };

  get callCount(): number {
    return this.calls.length;
  }
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** A fresh temp dir for sqlite-backed test runs (cleaned by the OS/CI). */
export function withTempDir(): string {
  return mkdtempSync(join(import.meta.dir, ".tmp-cc-"));
}
