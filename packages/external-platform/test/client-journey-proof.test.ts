/**
 * REL-035 — the EXTERNAL PLATFORM PROOF (Gate REL-A7 at JOURNEY grade):
 * a simulated external client walks the FULL A7 journey —
 *
 * ```
 * discover -> submit (media + feed) -> drop -> reconnect -> status
 *          -> cancel -> retrieve validated output + evidence
 * ```
 *
 * — through BOTH surfaces (the HTTP resource surface and the MCP tool
 * surface) with IDENTICAL application semantics. This is NOT the REL-030
 * per-operation parity sweep (that battery stands on its own); it is ONE
 * CONTINUOUS CLIENT STORY per surface, recorded as a typed JOURNEY RECORD:
 * every client-visible step (the operation, and either the versioned
 * service envelope or the typed refusal record) is appended in order, and
 * the HTTP lane's record must DEEP-EQUAL the MCP lane's record — the
 * REL-030 parity law ("API and MCP expose the same Sporta application
 * capabilities") proven as one client story, not a table.
 *
 * The twin lanes are IDENTICALLY SEEDED (registry walk, corpus, manual
 * clock, id sources, journal), so every identifier (job-N, source-N,
 * conn-N) and every timestamp is deterministic: the same seed reproduces
 * deep-equal journey records (asserted by independent re-runs).
 *
 * The journey's checkpoints, each asserted inline AND carried in the record:
 * - DISCOVER (the A5 visibility law at the external boundary): >= 2
 *   eligible organizations, each carrying version, visible evidence
 *   (benchmark metrics + uncertainty, robustness) and operating limits
 *   (latency/cost), ordered only by a DECLARED ordering whose statement is
 *   recorded — and NO hidden ranking field anywhere in the candidate shape.
 * - SUBMIT: a media job and a feed job; the feed's organization selection
 *   rides the SAME declared-ordering discovery (query + ordering, the
 *   orderedBy statement recorded verbatim).
 * - RECONNECT + STATUS: the client drops mid-feed-job (the worker's
 *   transform parks; its lease then expires), reconnects through a NEW
 *   connection over the same canonical stores, and a second worker resumes
 *   from the durable checkpoints: exactly one completion, the checkpoint
 *   timeline unbroken (no lost lineage, no duplicates).
 * - CANCEL: a second feed job is cancelled mid-flight — the request is
 *   honored at the next checkpoint boundary, the job dies `cancelled`, and
 *   get_output/get_evidence refuse typed on BOTH surfaces: NO partial
 *   authoritative output ever exists for a cancelled job.
 * - RETRIEVE: the reconnected client retrieves the validated output (the
 *   artifact checksum re-derives from the bytes; the content address is
 *   `artifact://<sha256>`) and the full evidence bundle (per-source lineage
 *   with acquired + normalized checksums, the quality-gate verdict).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createFileJobStore, createManualClock, createWorkerRuntime } from "@sporta/durable-jobs";
import type { JobExecutor, JobRecord, ManualClock } from "@sporta/durable-jobs";
import { createCorpusStore } from "@sporta/historical-corpus";
import type { AdditionalEvidence } from "@sporta/organization-registry";
import {
  createOrganizationRegistry,
  createRegistryDefaultClock,
  requestPromotion,
} from "@sporta/organization-registry";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExternalPlatform } from "../src/platform";
import { createHeaderTransformer } from "../src/processing";
import { createHttpSurface, createMcpToolSurface, sha256HexBytes } from "../src";
import type {
  ExternalPlatform,
  HttpSurfaceRequest,
  HttpSurfaceResponse,
  McpToolCallOutcome,
  McpToolCallRequest,
  PlatformConnection,
  PlatformTransformer,
  TypedErrorRecord,
} from "../src";
import {
  examplePolicy,
  feedItemMetadata,
  fixtureBytes,
  newOrgInput,
  platformFeedBasis,
  platformUploadBasis,
  uploadMetadata,
  walkToStatus,
} from "./fixtures";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sporta-client-journey-proof-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const SYSTEM = { actorType: "system", actorId: "journey-proof-harness" } as const;
const CLIENT = { platformId: "platform:video-platform", tenantId: "tenant-1" } as const;

// ---------------------------------------------------------------------------
// The second eligible organization (org-beta): validated with a HIGHER
// declared fidelity than org-alpha, so the declared quality-descending
// ordering is a real ordering (not a tie-break) and the discovered top pick
// is unambiguous.
// ---------------------------------------------------------------------------

/** org-beta's declared benchmark: fidelity 8.9 [8.5, 9.2] (the top pick). */
function betaBenchmark(): AdditionalEvidence["benchmark"] {
  return {
    corpusVersion: "corpus-v1",
    evaluatorVersion: "eval-v1",
    metrics: [
      { axis: "fidelity", value: 8.9 },
      { axis: "stylization", value: 7.8 },
      { axis: "temporal", value: 7.6 },
    ],
    uncertainty: [
      { axis: "fidelity", ciLow: 8.5, ciHigh: 9.2 },
      { axis: "stylization", ciLow: 7.4, ciHigh: 8.1 },
      { axis: "temporal", ciLow: 7.1, ciHigh: 8.0 },
    ],
    artifactRefs: ["artifact-beta-bench-1"],
  };
}

/** org-beta's non-benchmark evidence legs (the fixtures' shapes). */
function betaNonBenchmarkEvidence(): AdditionalEvidence {
  return {
    reproducibility: {
      // The record's createdFrom lab run (newOrgInput's own "run-1") — the
      // reproducibility gate matches the evidence against it.
      labRunId: "run-1",
      configurationVersion: "cfg-beta-1",
      seed: "seed-42",
      reproductionRuns: 2,
      identicalRuns: 2,
      artifactRefs: ["artifact-beta-repro-1", "artifact-beta-repro-2"],
    },
    robustness: {
      seedsTested: 4,
      seedsPassed: 4,
      outOfDistributionScore: 7.0,
      simulatorModelAgreement: 0.88,
      benchmarkCorpusCoverage: 0.8,
      knownFailureEnvelope: ["degrades on extreme low-light clips"],
      artifactRefs: ["artifact-beta-robust-1"],
    },
    rightsProvenance: {
      basisType: "licensed",
      rightsBasisId: "rb-beta-1",
      licenses: [{ licenseId: "l-beta-1", scope: "match-rendering" }],
      provenanceLineage: ["lin-beta-1"],
      artifactRefs: ["artifact-beta-rights-1"],
    },
    securityPolicy: {
      policyVersion: "sec-v1",
      checks: [
        { checkId: "content-policy", passed: true },
        { checkId: "secret-scan", passed: true },
        { checkId: "rights-basis-audit", passed: true },
      ],
      artifactRefs: ["artifact-beta-sec-1"],
    },
    costLatency: {
      sampleCount: 30,
      artifactRefs: ["artifact-beta-cost-1"],
    },
  };
}

/** Walks org-beta to `validated` with the beta-declared benchmark evidence. */
async function betaWalkToValidated(
  registry: ReturnType<typeof createOrganizationRegistry>,
): Promise<void> {
  const policy = examplePolicy();
  const evidence = betaNonBenchmarkEvidence();
  await requestPromotion(registry, {
    organizationId: "org-beta",
    policy,
    additionalEvidence: {
      reproducibility: evidence.reproducibility,
      benchmark: betaBenchmark(),
    },
  });
  await requestPromotion(registry, {
    organizationId: "org-beta",
    policy,
    additionalEvidence: {
      robustness: evidence.robustness,
      rightsProvenance: evidence.rightsProvenance,
      securityPolicy: evidence.securityPolicy,
      costLatency: evidence.costLatency,
    },
  });
}

// ---------------------------------------------------------------------------
// The parking transformer (the mid-job disconnect points, deterministic)
// ---------------------------------------------------------------------------

/** One parked transform call: its entered signal and its release gate. */
interface Park {
  readonly entered: Promise<void>;
  notify(): void;
  readonly gate: Promise<void>;
  release(): void;
}

/**
 * A transformer that PARKS FOREVER on the given transform-call numbers (the
 * simulated mid-job disconnect points) until the test releases them. The
 * `entered(call)` promise resolves exactly when call N enters its park —
 * the deterministic replacement for polling.
 */
function parkingTransformer(parkOnCalls: readonly number[]): {
  readonly transformer: PlatformTransformer;
  entered(call: number): Promise<void>;
  release(call: number): void;
} {
  const base = createHeaderTransformer();
  let calls = 0;
  const parks = new Map<number, Park>();
  for (const call of parkOnCalls) {
    let notify!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((done) => {
      notify = done;
    });
    const gate = new Promise<void>((done) => {
      release = done;
    });
    parks.set(call, { entered, notify, gate, release });
  }
  return {
    transformer: {
      id: "parking-header/v0",
      async transform(input) {
        calls += 1;
        const park = parks.get(calls);
        if (park !== undefined) {
          park.notify();
          await park.gate;
        }
        return base.transform(input);
      },
    },
    entered(call) {
      const park = parks.get(call);
      if (park === undefined) {
        throw new Error(`fixture invariant broken: no park at transform call ${call}`);
      }
      return park.entered;
    },
    release(call) {
      parks.get(call)?.release();
    },
  };
}

// ---------------------------------------------------------------------------
// The journey lane (one identically-seeded platform stack)
// ---------------------------------------------------------------------------

/** One deterministic journey lane: registry + corpus + jobs + platform. */
interface JourneyLane {
  readonly platform: ExternalPlatform;
  readonly clock: ManualClock;
  readonly jobs: ReturnType<typeof createFileJobStore>;
  readonly connection: PlatformConnection;
  readonly http: { handle(request: HttpSurfaceRequest): Promise<HttpSurfaceResponse> };
  readonly mcp: {
    callTool(
      connection: PlatformConnection,
      request: McpToolCallRequest,
    ): Promise<McpToolCallOutcome>;
  };
  readonly worker: { runAttempt(jobId: string): Promise<JobRecord> };
  readonly executors: readonly JobExecutor[];
}

/** Builds one journey lane (org-alpha production + org-beta validated + draft). */
async function journeyLane(
  parentDir: string,
  name: string,
  transformer: PlatformTransformer,
): Promise<JourneyLane> {
  const registry = createOrganizationRegistry({ clock: createRegistryDefaultClock() });
  await registry.register(newOrgInput(), { ...SYSTEM });
  await walkToStatus(registry, "org-alpha", "production");
  await registry.register(
    newOrgInput({
      organizationId: "org-beta",
      displayName: "Org Beta",
      profile: {
        latency: { p50Ms: 900, p95Ms: 1700, p99Ms: 2400 },
        cost: { perRunUsd: 1.1 },
      },
    }),
    { ...SYSTEM },
  );
  await betaWalkToValidated(registry);
  await registry.register(newOrgInput({ organizationId: "org-draft", displayName: "Org Draft" }), {
    ...SYSTEM,
  });
  const clock = createManualClock(10_000);
  const journalPath = join(parentDir, `${name}.journal.json`);
  const jobs = createFileJobStore(journalPath, { clock });
  const corpus = createCorpusStore({ clock });
  const platform = createExternalPlatform({ registry, corpus, jobs, clock, transformer });
  const connection = platform.connect({ ...CLIENT });
  const http = createHttpSurface(platform.services, connection);
  const mcp = createMcpToolSurface(platform.services);
  const worker = createWorkerRuntime({
    store: jobs,
    workerId: "w1",
    leaseTtlMs: 5_000,
    executors: platform.executors,
  });
  return { platform, clock, jobs, connection, http, mcp, worker, executors: platform.executors };
}

// ---------------------------------------------------------------------------
// The journey record (the typed transcript both lanes must agree on)
// ---------------------------------------------------------------------------

/** One client-visible journey step: the operation + its application semantics. */
interface JourneyStep {
  readonly step: string;
  readonly kind: "ok" | "refused";
  readonly envelope?: unknown;
  readonly error?: TypedErrorRecord;
}

/** Records the client's journey as comparable typed steps. */
function journeyRecorder() {
  const steps: JourneyStep[] = [];
  return {
    steps,
    http(step: string, response: HttpSurfaceResponse): void {
      if ("error" in response.body) {
        steps.push({ step, kind: "refused", error: response.body.error });
      } else {
        steps.push({ step, kind: "ok", envelope: response.body });
      }
    },
    mcp(step: string, outcome: McpToolCallOutcome): void {
      if (outcome.isError) {
        steps.push({ step, kind: "refused", error: outcome.error });
      } else {
        steps.push({ step, kind: "ok", envelope: outcome.envelope });
      }
    },
  };
}

/** The versioned envelope carried by a successful step. */
interface StepEnvelope<T> {
  readonly service: string;
  readonly version: number;
  readonly result: T;
}

/** Extracts the envelope from an HTTP response (fails the test on error). */
function envelopeOf<T = Record<string, unknown>>(response: HttpSurfaceResponse): StepEnvelope<T> {
  if ("error" in response.body) {
    throw new Error(`unexpected HTTP failure: ${response.body.error.code}`);
  }
  return response.body as StepEnvelope<T>;
}

/** Extracts the envelope from an MCP outcome (fails the test on error). */
function envelopeOfMcp<T = Record<string, unknown>>(outcome: McpToolCallOutcome): StepEnvelope<T> {
  if (outcome.isError) {
    throw new Error(`unexpected MCP failure: ${outcome.error.code}`);
  }
  return outcome.envelope as StepEnvelope<T>;
}

/** The typed error record of an HTTP failure response. */
function errorOf(response: HttpSurfaceResponse): TypedErrorRecord {
  if (!("error" in response.body)) {
    throw new Error(`expected an HTTP failure, got status ${response.status}`);
  }
  return response.body.error;
}

/** The typed error record of an MCP failure outcome. */
function errorOfMcp(outcome: McpToolCallOutcome): TypedErrorRecord {
  if (!outcome.isError) {
    throw new Error("expected an MCP failure outcome");
  }
  return outcome.error;
}

/** The candidate read model the A5 assertions inspect. */
interface CandidateView {
  readonly organizationId: string;
  readonly version: number;
  readonly status: string;
  readonly displayName: string;
  readonly evidence: {
    readonly benchmark: {
      readonly metrics: readonly unknown[];
      readonly uncertainty: readonly unknown[];
    } | null;
    readonly robustness: unknown;
    readonly rightsRequirements: readonly unknown[];
  };
  readonly profile: {
    readonly latency: { readonly p95Ms: number };
    readonly cost: { readonly perRunUsd: number };
  };
}

/** Byte-for-byte equality (avoids the Uint8Array<ArrayBuffer> overload trap). */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// THE JOURNEY — one continuous client story per surface
// ---------------------------------------------------------------------------

/**
 * Runs the FULL A7 client journey on twin identically-seeded lanes: lane A
 * drives every client operation through the HTTP surface, lane B through
 * the MCP tool surface. Returns both journey records.
 */
async function runClientJourney(
  parentDir: string,
  runId: string,
): Promise<{ http: readonly JourneyStep[]; mcp: readonly JourneyStep[] }> {
  // The park points (identical on both lanes — the journeys are the same):
  // call 1 = the media job's transform; calls 2-3 = feed #1 items (item 2
  // parks — the drop point); calls 4-5 = the takeover's re-derivations;
  // calls 6-7 = feed #2 items (item 2 parks — the cancellation boundary).
  const parkA = parkingTransformer([3, 7]);
  const parkB = parkingTransformer([3, 7]);
  const laneA = await journeyLane(parentDir, `${runId}-http`, parkA.transformer);
  const laneB = await journeyLane(parentDir, `${runId}-mcp`, parkB.transformer);
  const recA = journeyRecorder();
  const recB = journeyRecorder();

  // -- DISCOVER: the eligible organizations with version/evidence/limits ----
  const httpSearch = await laneA.http.handle({
    method: "GET",
    path: "/v1/organizations",
    query: { domain: "football", task: "match", ordering: "quality-descending:fidelity" },
  });
  const mcpSearch = await laneB.mcp.callTool(laneB.connection, {
    tool: "search_organizations",
    input: {
      query: { domain: "football", task: "match" },
      ordering: { kind: "quality-descending", axis: "fidelity" },
    },
  });
  recA.http("discover: searchOrganizations", httpSearch);
  recB.mcp("discover: searchOrganizations", mcpSearch);

  // THE A5 VISIBILITY LAW, asserted at the external boundary (on the HTTP
  // lane's answer; the MCP lane's answer deep-equals it at journey grade).
  const search = envelopeOf<{ candidates: CandidateView[]; orderedBy: string }>(httpSearch).result;
  expect(search.candidates.length).toBeGreaterThanOrEqual(2);
  const first = search.candidates[0];
  if (first === undefined) {
    throw new Error("fixture invariant broken: no discovered candidate");
  }
  // No hidden ranking field: the candidate carries EXACTLY the choice
  // read model's shape (no rank, no score, no weight).
  expect(Object.keys(first).sort()).toEqual(
    [
      "domain",
      "displayName",
      "evidence",
      "knownLimitations",
      "organizationId",
      "profile",
      "status",
      "version",
    ].sort(),
  );
  expect(Object.keys(first.evidence).sort()).toEqual(
    ["benchmark", "provenance", "rightsRequirements", "robustness", "simulatorReward"].sort(),
  );
  for (const candidate of search.candidates) {
    expect(candidate.version).toBeGreaterThan(0);
    expect(["validated", "canary", "production"]).toContain(candidate.status);
    expect(candidate.displayName.length).toBeGreaterThan(0);
    expect(candidate.evidence.benchmark).not.toBeNull();
    expect(candidate.evidence.benchmark?.metrics.length).toBeGreaterThan(0);
    expect(candidate.evidence.benchmark?.uncertainty.length).toBeGreaterThan(0);
    expect(candidate.evidence.robustness).not.toBeNull();
    expect(Array.isArray(candidate.evidence.rightsRequirements)).toBe(true);
    expect(candidate.profile.latency.p95Ms).toBeGreaterThan(0);
    expect(candidate.profile.cost.perRunUsd).toBeGreaterThan(0);
  }
  // The declared ordering is real: beta (fidelity 8.9) precedes alpha (8.4).
  expect(search.candidates.map((candidate) => candidate.organizationId)).toEqual([
    "org-beta",
    "org-alpha",
  ]);
  expect(search.orderedBy).toContain("quality descending");
  expect(search.orderedBy).toContain("fidelity");

  // The detailed discovery read of the top pick.
  const httpInspect = await laneA.http.handle({
    method: "GET",
    path: "/v1/organizations/org-beta",
  });
  const mcpInspect = await laneB.mcp.callTool(laneB.connection, {
    tool: "inspect_organization",
    input: { organizationId: "org-beta" },
  });
  recA.http("discover: inspectOrganization", httpInspect);
  recB.mcp("discover: inspectOrganization", mcpInspect);
  const inspected = envelopeOf<{ organization: { version: number; status: string } }>(httpInspect)
    .result.organization;
  expect(inspected.version).toBe(first.version);
  expect(inspected.status).toBe("validated");

  // -- SUBMIT: a media job, then a feed job ---------------------------------
  const mediaBytes = fixtureBytes("journey-media", 96);
  const httpMedia = await laneA.http.handle({
    method: "POST",
    path: "/v1/media",
    body: {
      bytes: mediaBytes,
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
      organizationId: "org-beta",
    },
  });
  const mcpMedia = await laneB.mcp.callTool(laneB.connection, {
    tool: "submit_video",
    input: {
      bytes: mediaBytes,
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
      organizationId: "org-beta",
    },
  });
  recA.http("submit: submitMedia", httpMedia);
  recB.mcp("submit: submitMedia", mcpMedia);
  expect(httpMedia.status).toBe(201);
  const media = envelopeOf<{
    sourceId: string;
    sourceState: string;
    jobId: string;
    jobKind: string;
  }>(httpMedia).result;
  expect(media.sourceState).toBe("acquired");
  expect(media.jobKind).toBe("external.media-processing");
  const mediaJobId = media.jobId;

  const feedItems = ["journey-feed-1", "journey-feed-2"].map((id) => ({
    metadata: feedItemMetadata(id),
    bytes: fixtureBytes(id),
    declaredBasis: platformFeedBasis(),
  }));
  const httpFeed = await laneA.http.handle({
    method: "POST",
    path: "/v1/feeds",
    body: {
      items: feedItems,
      organization: {
        query: { domain: "football" },
        ordering: { kind: "quality-descending", axis: "fidelity" },
      },
    },
  });
  const mcpFeed = await laneB.mcp.callTool(laneB.connection, {
    tool: "submit_feed",
    input: {
      items: feedItems,
      organization: {
        query: { domain: "football" },
        ordering: { kind: "quality-descending", axis: "fidelity" },
      },
    },
  });
  recA.http("submit: submitFeed", httpFeed);
  recB.mcp("submit: submitFeed", mcpFeed);
  expect(httpFeed.status).toBe(201);
  const feed = envelopeOf<{
    jobId: string;
    itemCount: number;
    transformableItemCount: number;
    organizationId: string;
    orderedBy: string | null;
  }>(httpFeed).result;
  expect(feed.itemCount).toBe(2);
  expect(feed.transformableItemCount).toBe(2);
  // The feed's selection rode the SAME declared ordering (no hidden ranking).
  expect(feed.organizationId).toBe("org-beta");
  expect(feed.orderedBy).toContain("quality descending");
  const feedJobId = feed.jobId;

  // -- STATUS: the queued media job, then drive it to completion ------------
  const httpMediaStatus = await laneA.http.handle({
    method: "GET",
    path: `/v1/jobs/${mediaJobId}`,
  });
  const mcpMediaStatus = await laneB.mcp.callTool(laneB.connection, {
    tool: "get_job",
    input: { jobId: mediaJobId },
  });
  recA.http("status: getJob(media, queued)", httpMediaStatus);
  recB.mcp("status: getJob(media, queued)", mcpMediaStatus);
  expect(
    envelopeOf<{ job: { state: string; attempts: number } }>(httpMediaStatus).result.job,
  ).toMatchObject({ state: "queued", attempts: 0 });

  const mediaDone = await laneA.worker.runAttempt(mediaJobId);
  expect(mediaDone.state).toBe("completed");
  await laneB.worker.runAttempt(mediaJobId);

  // -- THE DROP + RECONNECT: the feed job parks mid-flight ------------------
  // Worker 1 starts the feed job; item 1 checkpoints durably; item 2's
  // transform parks (transform call 3 — the disconnect point).
  const abandonedA = laneA.worker.runAttempt(feedJobId).catch(() => "abandoned-a");
  const abandonedB = laneB.worker.runAttempt(feedJobId).catch(() => "abandoned-b");
  await parkA.entered(3);
  await parkB.entered(3);

  // MID-FLIGHT: the clients observe status + progress through their surfaces.
  const httpMid = await laneA.http.handle({
    method: "GET",
    path: `/v1/jobs/${feedJobId}`,
  });
  const mcpMid = await laneB.mcp.callTool(laneB.connection, {
    tool: "get_job",
    input: { jobId: feedJobId },
  });
  recA.http("reconnect: getJob(feed, mid-flight)", httpMid);
  recB.mcp("reconnect: getJob(feed, mid-flight)", mcpMid);
  expect(
    envelopeOf<{ job: { state: string; checkpointCount: number } }>(httpMid).result.job,
  ).toMatchObject({ state: "running", checkpointCount: 1 });

  const httpMidProgress = await laneA.http.handle({
    method: "GET",
    path: `/v1/jobs/${feedJobId}/progress`,
  });
  const mcpMidProgress = await laneB.mcp.callTool(laneB.connection, {
    tool: "get_job_progress",
    input: { jobId: feedJobId },
  });
  recA.http("reconnect: getJobProgress(feed, mid-flight)", httpMidProgress);
  recB.mcp("reconnect: getJobProgress(feed, mid-flight)", mcpMidProgress);
  expect(
    envelopeOf<{
      progress: {
        timeline: { seq: number; at: number }[];
        resumable: boolean;
        state: string;
        cancellationRequested: boolean;
      };
    }>(httpMidProgress).result.progress,
  ).toMatchObject({
    timeline: [{ seq: 1, at: 10_000 }],
    resumable: true,
    state: "running",
    cancellationRequested: false,
  });

  // The premature retrieval refuses typed (identically on both surfaces).
  const httpEarlyOutput = await laneA.http.handle({
    method: "GET",
    path: `/v1/jobs/${feedJobId}/output`,
  });
  const mcpEarlyOutput = await laneB.mcp.callTool(laneB.connection, {
    tool: "get_output",
    input: { jobId: feedJobId },
  });
  recA.http("reconnect: getOutput(feed, premature)", httpEarlyOutput);
  recB.mcp("reconnect: getOutput(feed, premature)", mcpEarlyOutput);
  expect(errorOf(httpEarlyOutput)).toMatchObject({ code: "platform.job-state" });
  expect(errorOfMcp(mcpEarlyOutput)).toMatchObject({ code: "platform.job-state" });
  expect(errorOf(httpEarlyOutput).details).toMatchObject({ jobId: feedJobId, state: "running" });

  // THE CLIENTS DROP. The workers' leases expire while parked; the parked
  // transforms complete but their checkpoint writes are refused (the lease
  // law) — the attempts land nowhere terminal.
  laneA.clock.advance(10_000);
  laneB.clock.advance(10_000);
  parkA.release(3);
  parkB.release(3);
  expect(await abandonedA).toBe("abandoned-a");
  expect(await abandonedB).toBe("abandoned-b");

  // RECONNECT: NEW connections over the same canonical stores — the state
  // never lived in the connection. A second worker takes over the expired
  // lease and resumes from the durable checkpoints.
  const reconnectedA = laneA.platform.connect({ ...CLIENT });
  const reconnectedB = laneB.platform.connect({ ...CLIENT });
  const httpReconnected = createHttpSurface(laneA.platform.services, reconnectedA);
  const mcpReconnected = createMcpToolSurface(laneB.platform.services);
  const workerA2 = createWorkerRuntime({
    store: laneA.jobs,
    workerId: "w2-a",
    leaseTtlMs: 5_000,
    executors: laneA.executors,
  });
  const workerB2 = createWorkerRuntime({
    store: laneB.jobs,
    workerId: "w2-b",
    leaseTtlMs: 5_000,
    executors: laneB.executors,
  });
  const resumedA = await workerA2.runAttempt(feedJobId);
  const resumedB = await workerB2.runAttempt(feedJobId);
  expect(resumedA.state).toBe("completed");
  expect(resumedB.state).toBe("completed");

  // STATUS after the resume: exactly one attempt, the checkpoint timeline
  // unbroken (no lost lineage, no duplicate checkpoints).
  const httpResumed = await httpReconnected.handle({
    method: "GET",
    path: `/v1/jobs/${feedJobId}`,
  });
  const mcpResumed = await mcpReconnected.callTool(reconnectedB, {
    tool: "get_job",
    input: { jobId: feedJobId },
  });
  recA.http("reconnect: getJob(feed, resumed)", httpResumed);
  recB.mcp("reconnect: getJob(feed, resumed)", mcpResumed);
  expect(
    envelopeOf<{ job: { state: string; attempts: number; checkpointCount: number } }>(httpResumed)
      .result.job,
  ).toMatchObject({ state: "completed", attempts: 1, checkpointCount: 2 });

  const httpResumedProgress = await httpReconnected.handle({
    method: "GET",
    path: `/v1/jobs/${feedJobId}/progress`,
  });
  const mcpResumedProgress = await mcpReconnected.callTool(reconnectedB, {
    tool: "get_job_progress",
    input: { jobId: feedJobId },
  });
  recA.http("reconnect: getJobProgress(feed, resumed)", httpResumedProgress);
  recB.mcp("reconnect: getJobProgress(feed, resumed)", mcpResumedProgress);
  expect(
    envelopeOf<{
      progress: {
        timeline: { seq: number; at: number }[];
        resumable: boolean;
        state: string;
        leaseExpired: boolean;
      };
    }>(httpResumedProgress).result.progress,
  ).toMatchObject({
    timeline: [
      { seq: 1, at: 10_000 },
      { seq: 2, at: 20_000 },
    ],
    resumable: false,
    state: "completed",
    leaseExpired: false,
  });

  // The journal: exactly ONE enqueued and ONE completion for the feed job
  // (no duplicate authoritative completion; the evidence trail is the fold).
  for (const lane of [laneA, laneB]) {
    const events = await lane.jobs.readJournal();
    const scoped = events.filter(
      (event) =>
        (event.type === "patched" && event.jobId === feedJobId) ||
        (event.type === "enqueued" && event.record.jobId === feedJobId),
    );
    expect(scoped.filter((event) => event.type === "enqueued")).toHaveLength(1);
    expect(
      scoped.filter((event) => event.type === "patched" && event.op === "complete"),
    ).toHaveLength(1);
  }

  // -- RETRIEVE: the reconnected client takes the validated artifacts -------
  const httpFeedOutput = await httpReconnected.handle({
    method: "GET",
    path: `/v1/jobs/${feedJobId}/output`,
  });
  const mcpFeedOutput = await mcpReconnected.callTool(reconnectedB, {
    tool: "get_output",
    input: { jobId: feedJobId },
  });
  recA.http("retrieve: getOutput(feed)", httpFeedOutput);
  recB.mcp("retrieve: getOutput(feed)", mcpFeedOutput);
  const feedOutput = envelopeOf<{
    artifact: {
      kind: string;
      organizationId: string | null;
      artifactRef: string;
      checksum: string;
      byteLength: number;
      items: { sourceId: string; checksum: string }[];
    };
    bytes: Uint8Array;
  }>(httpFeedOutput).result;
  expect(feedOutput.artifact.kind).toBe("feed-output");
  expect(feedOutput.artifact.organizationId).toBe("org-beta");
  expect(feedOutput.artifact.items).toHaveLength(2);
  // REAL DIGESTS: the artifact checksum re-derives from the bytes; the
  // content address is the checksum.
  expect(feedOutput.artifact.checksum).toBe(await sha256HexBytes(feedOutput.bytes));
  expect(feedOutput.artifact.artifactRef).toBe(`artifact://${feedOutput.artifact.checksum}`);
  expect(feedOutput.artifact.byteLength).toBe(feedOutput.bytes.byteLength);

  const httpFeedEvidence = await httpReconnected.handle({
    method: "GET",
    path: `/v1/jobs/${feedJobId}/evidence`,
  });
  const mcpFeedEvidence = await mcpReconnected.callTool(reconnectedB, {
    tool: "get_evidence",
    input: { jobId: feedJobId },
  });
  recA.http("retrieve: getEvidence(feed)", httpFeedEvidence);
  recB.mcp("retrieve: getEvidence(feed)", mcpFeedEvidence);
  const feedEvidence = envelopeOf<{
    evidence: {
      sourceLineage: {
        sourceId: string;
        outcome: string;
        acquiredChecksum: string | null;
        normalizedChecksum: string | null;
      }[];
      qualityGate: { gateId: string; passed: boolean; checks: { name: string }[] };
    };
  }>(httpFeedEvidence).result.evidence;
  expect(feedEvidence.sourceLineage).toHaveLength(2);
  for (const item of feedEvidence.sourceLineage) {
    expect(item.outcome).toBe("transformed");
    expect(item.acquiredChecksum).not.toBeNull();
    expect(item.normalizedChecksum).toBe(item.acquiredChecksum);
  }
  expect(feedEvidence.qualityGate.passed).toBe(true);
  expect(feedEvidence.qualityGate.checks.map((check) => check.name)).toEqual([
    "output-non-empty",
    "lineage-complete",
    "no-data-loss",
  ]);

  // The media job's validated output + evidence, retrieved by the SAME
  // reconnected client.
  const httpMediaOutput = await httpReconnected.handle({
    method: "GET",
    path: `/v1/jobs/${mediaJobId}/output`,
  });
  const mcpMediaOutput = await mcpReconnected.callTool(reconnectedB, {
    tool: "get_output",
    input: { jobId: mediaJobId },
  });
  recA.http("retrieve: getOutput(media)", httpMediaOutput);
  recB.mcp("retrieve: getOutput(media)", mcpMediaOutput);
  const mediaOutput = envelopeOf<{
    artifact: { kind: string; items: { sourceId: string }[]; checksum: string };
    bytes: Uint8Array;
  }>(httpMediaOutput).result;
  expect(mediaOutput.artifact.kind).toBe("transformed-media");
  expect(mediaOutput.artifact.items).toHaveLength(1);
  expect(mediaOutput.artifact.items[0]?.sourceId).toBe(media.sourceId);
  expect(mediaOutput.artifact.checksum).toBe(await sha256HexBytes(mediaOutput.bytes));
  // The honest v0 transform: the deterministic header + the normalized bytes.
  const header = new TextEncoder().encode(`SPORTA-TRANSFORM/org-beta/${media.sourceId}\n`);
  expect(mediaOutput.bytes.byteLength).toBe(header.byteLength + mediaBytes.byteLength);
  expect(bytesEqual(mediaOutput.bytes.slice(0, header.byteLength), header)).toBe(true);
  expect(bytesEqual(mediaOutput.bytes.slice(header.byteLength), mediaBytes)).toBe(true);

  const httpMediaEvidence = await httpReconnected.handle({
    method: "GET",
    path: `/v1/jobs/${mediaJobId}/evidence`,
  });
  const mcpMediaEvidence = await mcpReconnected.callTool(reconnectedB, {
    tool: "get_evidence",
    input: { jobId: mediaJobId },
  });
  recA.http("retrieve: getEvidence(media)", httpMediaEvidence);
  recB.mcp("retrieve: getEvidence(media)", mcpMediaEvidence);

  // -- CANCEL: a second feed journey dies at the checkpoint boundary --------
  const cancelItems = ["journey-cancel-1", "journey-cancel-2"].map((id) => ({
    metadata: feedItemMetadata(id),
    bytes: fixtureBytes(id),
    declaredBasis: platformFeedBasis(),
  }));
  const httpCancelFeed = await httpReconnected.handle({
    method: "POST",
    path: "/v1/feeds",
    body: { items: cancelItems, organization: { organizationId: "org-beta" } },
  });
  const mcpCancelFeed = await mcpReconnected.callTool(reconnectedB, {
    tool: "submit_feed",
    input: { items: cancelItems, organization: { organizationId: "org-beta" } },
  });
  recA.http("cancel: submitFeed", httpCancelFeed);
  recB.mcp("cancel: submitFeed", mcpCancelFeed);
  const cancelJobId = envelopeOf<{ jobId: string }>(httpCancelFeed).result.jobId;

  // Worker 3 runs it; item 1 checkpoints; item 2's transform parks (call 7).
  const cancelAttemptA = laneA.worker.runAttempt(cancelJobId);
  const cancelAttemptB = laneB.worker.runAttempt(cancelJobId);
  await parkA.entered(7);
  await parkB.entered(7);

  // The clients request cancellation through their surfaces while the job
  // is mid-flight (running, item 1 durable).
  const httpCancel = await httpReconnected.handle({
    method: "POST",
    path: `/v1/jobs/${cancelJobId}/cancellation`,
  });
  const mcpCancel = await mcpReconnected.callTool(reconnectedB, {
    tool: "cancel_job",
    input: { jobId: cancelJobId },
  });
  recA.http("cancel: cancelJob", httpCancel);
  recB.mcp("cancel: cancelJob", mcpCancel);
  // The typed cancellation record: the request acknowledged, not yet honored.
  const cancellation = envelopeOf<{
    jobId: string;
    state: string;
    cancellationRequested: boolean;
    cancelled: boolean;
  }>(httpCancel).result;
  expect(cancellation).toEqual({
    jobId: cancelJobId,
    state: "running",
    cancellationRequested: true,
    cancelled: false,
  });
  expect(
    envelopeOfMcp<{
      jobId: string;
      state: string;
      cancellationRequested: boolean;
      cancelled: boolean;
    }>(mcpCancel).result,
  ).toEqual(cancellation);

  // Release: the item-2 checkpoint lands, the request is honored AT the
  // boundary, and the job dies cancelled — BEFORE any publication.
  parkA.release(7);
  parkB.release(7);
  const cancelledA = await cancelAttemptA;
  const cancelledB = await cancelAttemptB;
  expect(cancelledA.state).toBe("cancelled");
  expect(cancelledB.state).toBe("cancelled");

  const httpCancelledStatus = await httpReconnected.handle({
    method: "GET",
    path: `/v1/jobs/${cancelJobId}`,
  });
  const mcpCancelledStatus = await mcpReconnected.callTool(reconnectedB, {
    tool: "get_job",
    input: { jobId: cancelJobId },
  });
  recA.http("cancel: getJob(cancelled)", httpCancelledStatus);
  recB.mcp("cancel: getJob(cancelled)", mcpCancelledStatus);
  expect(
    envelopeOf<{ job: { state: string; cancellationRequested: boolean; checkpointCount: number } }>(
      httpCancelledStatus,
    ).result.job,
  ).toMatchObject({ state: "cancelled", cancellationRequested: true, checkpointCount: 2 });

  // NO PARTIAL AUTHORITATIVE OUTPUT: both retrieval families refuse typed,
  // identically on both surfaces.
  const httpCancelledOutput = await httpReconnected.handle({
    method: "GET",
    path: `/v1/jobs/${cancelJobId}/output`,
  });
  const mcpCancelledOutput = await mcpReconnected.callTool(reconnectedB, {
    tool: "get_output",
    input: { jobId: cancelJobId },
  });
  recA.http("cancel: getOutput(cancelled)", httpCancelledOutput);
  recB.mcp("cancel: getOutput(cancelled)", mcpCancelledOutput);
  expect(errorOf(httpCancelledOutput)).toMatchObject({ code: "platform.job-state" });
  expect(errorOf(httpCancelledOutput).details).toMatchObject({
    jobId: cancelJobId,
    state: "cancelled",
  });
  expect(errorOfMcp(mcpCancelledOutput).code).toBe(errorOf(httpCancelledOutput).code);
  expect(errorOfMcp(mcpCancelledOutput).message).toBe(errorOf(httpCancelledOutput).message);

  const httpCancelledEvidence = await httpReconnected.handle({
    method: "GET",
    path: `/v1/jobs/${cancelJobId}/evidence`,
  });
  const mcpCancelledEvidence = await mcpReconnected.callTool(reconnectedB, {
    tool: "get_evidence",
    input: { jobId: cancelJobId },
  });
  recA.http("cancel: getEvidence(cancelled)", httpCancelledEvidence);
  recB.mcp("cancel: getEvidence(cancelled)", mcpCancelledEvidence);
  expect(errorOf(httpCancelledEvidence)).toMatchObject({ code: "platform.job-state" });

  // The journal confirms it: NO completion event for the cancelled job.
  for (const lane of [laneA, laneB]) {
    const events = await lane.jobs.readJournal();
    const scoped = events.filter(
      (event) => event.type === "patched" && event.jobId === cancelJobId,
    );
    expect(
      scoped.filter((event) => event.type === "patched" && event.op === "complete"),
    ).toHaveLength(0);
    expect(
      scoped.filter((event) => event.type === "patched" && event.op === "cancel"),
    ).toHaveLength(1);
  }

  return { http: recA.steps, mcp: recB.steps };
}

// ---------------------------------------------------------------------------
// The proof
// ---------------------------------------------------------------------------

describe("REL-035: the external client journey proof (Gate REL-A7, journey grade)", () => {
  test("the full client journey — discover, submit, drop, reconnect, status, cancel, retrieve — resolves IDENTICALLY through HTTP and MCP as ONE continuous client story", async () => {
    const run = await runClientJourney(dir, "run-1");
    // JOURNEY-GRADE PARITY: every step's application semantics — the
    // versioned envelopes on success AND the typed error records on
    // refusal — resolve identically through both surfaces.
    expect(run.http).toEqual(run.mcp);
  }, 180_000);

  test("determinism: the same seed reproduces deep-equal journey records on BOTH surfaces", async () => {
    const runA = await runClientJourney(dir, "run-2");
    const runB = await runClientJourney(dir, "run-3");
    expect(runA.http).toEqual(runB.http);
    expect(runA.mcp).toEqual(runB.mcp);
    expect(runA.http).toEqual(runA.mcp);
  }, 180_000);
});
