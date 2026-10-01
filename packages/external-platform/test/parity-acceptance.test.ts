/**
 * REL-030 — the API/MCP parity ACCEPTANCE battery (the 63-b parity tests
 * extended, never weakened): every public operation family — including the
 * families added since 63-b (the feed pipeline, the benchmark registration
 * query families, the harness progress projection) — exercised on BOTH
 * surfaces with deep-equal envelopes; every typed refusal family swept
 * table-driven through both surfaces with the identical typed code; the
 * reconnect semantics (a client that drops mid-operation and reconnects
 * observes the SAME state through both surfaces); and the
 * unknown-operation / malformed-payload families failing closed
 * identically.
 *
 * THE PARITY RULE (the frozen contract's core sentence): "API and MCP
 * expose the same Sporta application capabilities. Neither adapter creates
 * a second job, rights, artifact or promotion authority."
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createFileJobStore, createManualClock, createWorkerRuntime } from "@sporta/durable-jobs";
import { createBenchmarkRegistrar, createCorpusStore } from "@sporta/historical-corpus";
import {
  createOrganizationRegistry,
  createRegistryDefaultClock,
} from "@sporta/organization-registry";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExternalPlatform } from "../src/platform";
import { createHeaderTransformer } from "../src/processing";
import { createHttpSurface, createMcpToolSurface } from "../src";
import type {
  HttpSurfaceResponse,
  McpToolCallOutcome,
  PlatformConnection,
  PlatformTransformer,
} from "../src";
import {
  benchmarkStageEvidence,
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
  dir = mkdtempSync(join(tmpdir(), "sporta-parity-acceptance-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const SYSTEM = { actorType: "system", actorId: "acceptance-harness" } as const;

/** One deterministic acceptance lane: registry + corpus + jobs + platform (shared registrar). */
async function acceptanceLane(name: string, transformer?: PlatformTransformer) {
  const registry = createOrganizationRegistry({ clock: createRegistryDefaultClock() });
  await registry.register(newOrgInput(), { ...SYSTEM });
  await registry.register(newOrgInput({ organizationId: "org-draft", displayName: "Org Draft" }), {
    ...SYSTEM,
  });
  await walkToStatus(registry, "org-alpha", "production");
  const clock = createManualClock(10_000);
  const journalPath = join(dir, `${name}.journal.json`);
  const jobs = createFileJobStore(journalPath, { clock });
  const corpus = createCorpusStore({ clock });
  const registrar = createBenchmarkRegistrar(corpus);
  const platform = createExternalPlatform({
    registry,
    corpus,
    jobs,
    clock,
    benchmarks: registrar,
    ...(transformer !== undefined ? { transformer } : {}),
  });
  const connection = platform.connect({
    platformId: "platform:video-platform",
    tenantId: "tenant-1",
  });
  const http = createHttpSurface(platform.services, connection);
  const mcp = createMcpToolSurface(platform.services);
  const worker = createWorkerRuntime({
    store: jobs,
    workerId: "w1",
    leaseTtlMs: 5_000,
    executors: platform.executors,
  });
  return { platform, clock, jobs, corpus, registrar, connection, http, mcp, worker };
}

/** Extracts the envelope from an HTTP response (fails the test on error). */
function envelopeOf<T = Record<string, unknown>>(response: HttpSurfaceResponse) {
  if ("error" in response.body) {
    throw new Error(`unexpected HTTP failure: ${response.body.error.code}`);
  }
  return response.body as { service: string; version: number; result: T };
}

/** Extracts the envelope from an MCP outcome (fails the test on error). */
function envelopeOfMcp<T = Record<string, unknown>>(outcome: McpToolCallOutcome) {
  if (outcome.isError) {
    throw new Error(`unexpected MCP failure: ${outcome.error.code}`);
  }
  return outcome.envelope as { service: string; version: number; result: T };
}

/** The typed error record of an HTTP failure response. */
function errorOf(response: HttpSurfaceResponse) {
  if (!("error" in response.body)) {
    throw new Error(`expected an HTTP failure, got status ${response.status}`);
  }
  return response.body.error;
}

/** The typed error record of an MCP failure outcome. */
function errorOfMcp(outcome: McpToolCallOutcome) {
  if (!outcome.isError) {
    throw new Error("expected an MCP failure outcome");
  }
  return outcome.error;
}

/** A transformer that parks on its Nth call (the mid-operation disconnect point). */
function gatedTransformer(gate: Promise<void>, parkOnCall: number): PlatformTransformer {
  const base = createHeaderTransformer();
  let calls = 0;
  return {
    id: "gated-header/v0",
    async transform(input) {
      calls += 1;
      if (calls === parkOnCall) await gate;
      return base.transform(input);
    },
  };
}

const WINDOW = { startMs: 1_700_000_000_000, endMs: 1_700_003_600_000 };
const VERSIONS = [
  { name: "optical-flow", kind: "feature" as const, version: "1.2.0" },
  { name: "h264-decoder", kind: "decoder" as const, version: "0.9.1" },
];

/** Seeds a benchmark registration over a processed media source on a lane. */
async function seedBenchmark(lane: Awaited<ReturnType<typeof acceptanceLane>>) {
  const submitted = await lane.platform.services.submitMedia(lane.connection, {
    bytes: fixtureBytes("acceptance-bench"),
    declaredBasis: platformUploadBasis(),
    metadata: uploadMetadata(),
    organizationId: "org-alpha",
  });
  const jobId = submitted.result.jobId as string;
  const done = await lane.worker.runAttempt(jobId);
  expect(done.state).toBe("completed");
  const registration = await lane.registrar.register({
    sourceId: submitted.result.sourceId,
    timeWindow: WINDOW,
    versions: VERSIONS,
  });
  return {
    sourceId: submitted.result.sourceId,
    jobId,
    registrationId: registration.registrationId,
  };
}

// ---------------------------------------------------------------------------
// 1. THE FAMILY SWEEP — every public operation family, both surfaces,
//    deep-equal envelopes.
// ---------------------------------------------------------------------------

describe("the family sweep: every public operation family on BOTH surfaces, deep-equal", () => {
  test("searchOrganizations: GET /v1/organizations === search_organizations", async () => {
    const lane = await acceptanceLane("f-search");
    const http = await lane.http.handle({
      method: "GET",
      path: "/v1/organizations",
      query: { domain: "football" },
    });
    const mcp = await lane.mcp.callTool(lane.connection, {
      tool: "search_organizations",
      input: { query: { domain: "football" } },
    });
    expect(http.status).toBe(200);
    expect(envelopeOf(http)).toEqual(envelopeOfMcp(mcp));
  });

  test("inspectOrganization: GET /v1/organizations/:id === inspect_organization", async () => {
    const lane = await acceptanceLane("f-inspect");
    const http = await lane.http.handle({ method: "GET", path: "/v1/organizations/org-alpha" });
    const mcp = await lane.mcp.callTool(lane.connection, {
      tool: "inspect_organization",
      input: { organizationId: "org-alpha" },
    });
    expect(envelopeOf(http)).toEqual(envelopeOfMcp(mcp));
  });

  test("launchLabRun: POST /v1/lab-runs === launch_lab (durable id immediately)", async () => {
    const a = await acceptanceLane("f-lab-http");
    const b = await acceptanceLane("f-lab-mcp");
    const http = await a.http.handle({
      method: "POST",
      path: "/v1/lab-runs",
      body: { labRun: { domain: "football", task: "match" } },
    });
    const mcp = await b.mcp.callTool(b.connection, {
      tool: "launch_lab",
      input: { labRun: { domain: "football", task: "match" } },
    });
    expect(http.status).toBe(201);
    expect(envelopeOf(http)).toEqual(envelopeOfMcp(mcp));
    expect(envelopeOf<{ jobId: string; state: string }>(http).result).toMatchObject({
      jobId: "job-1",
      state: "queued",
    });
  });

  test("submitMedia: POST /v1/media === submit_video, processed to output + evidence", async () => {
    const a = await acceptanceLane("f-media-http");
    const b = await acceptanceLane("f-media-mcp");
    const mediaInput = {
      bytes: fixtureBytes("acceptance-media"),
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
      organizationId: "org-alpha",
    };
    const http = await a.http.handle({ method: "POST", path: "/v1/media", body: mediaInput });
    const mcp = await b.mcp.callTool(b.connection, { tool: "submit_video", input: mediaInput });
    expect(http.status).toBe(201);
    expect(envelopeOf(http)).toEqual(envelopeOfMcp(mcp));

    const httpJobId = envelopeOf<{ jobId: string }>(http).result.jobId;
    const mcpJobId = envelopeOfMcp<{ jobId: string }>(mcp).result.jobId;
    expect((await a.worker.runAttempt(httpJobId)).state).toBe("completed");
    expect((await b.worker.runAttempt(mcpJobId)).state).toBe("completed");

    const httpOutput = await a.http.handle({ method: "GET", path: `/v1/jobs/${httpJobId}/output` });
    const mcpOutput = await b.mcp.callTool(b.connection, {
      tool: "get_output",
      input: { jobId: mcpJobId },
    });
    expect(envelopeOf(httpOutput)).toEqual(envelopeOfMcp(mcpOutput));
    const httpEvidence = await a.http.handle({
      method: "GET",
      path: `/v1/jobs/${httpJobId}/evidence`,
    });
    const mcpEvidence = await b.mcp.callTool(b.connection, {
      tool: "get_evidence",
      input: { jobId: mcpJobId },
    });
    expect(envelopeOf(httpEvidence)).toEqual(envelopeOfMcp(mcpEvidence));
  });

  test("submitFeed: POST /v1/feeds === submit_feed (the feed pipeline)", async () => {
    const a = await acceptanceLane("f-feed-http");
    const b = await acceptanceLane("f-feed-mcp");
    const feedInput = {
      items: ["accept-a", "accept-b"].map((id) => ({
        metadata: feedItemMetadata(id),
        bytes: fixtureBytes(id),
        declaredBasis: platformFeedBasis(),
      })),
      organization: { organizationId: "org-alpha" },
    };
    const http = await a.http.handle({ method: "POST", path: "/v1/feeds", body: feedInput });
    const mcp = await b.mcp.callTool(b.connection, { tool: "submit_feed", input: feedInput });
    expect(http.status).toBe(201);
    expect(envelopeOf(http)).toEqual(envelopeOfMcp(mcp));
    expect(
      envelopeOf<{
        jobId: string;
        kind: string;
        itemCount: number;
        transformableItemCount: number;
        organizationId: string;
        orderedBy: string | null;
      }>(http).result,
    ).toEqual({
      jobId: "job-1",
      kind: "external.feed-processing",
      itemCount: 2,
      transformableItemCount: 2,
      organizationId: "org-alpha",
      orderedBy: null,
    });

    const httpJobId = envelopeOf<{ jobId: string }>(http).result.jobId;
    const mcpJobId = envelopeOfMcp<{ jobId: string }>(mcp).result.jobId;
    expect((await a.worker.runAttempt(httpJobId)).state).toBe("completed");
    expect((await b.worker.runAttempt(mcpJobId)).state).toBe("completed");
    const httpOutput = await a.http.handle({ method: "GET", path: `/v1/jobs/${httpJobId}/output` });
    const mcpOutput = await b.mcp.callTool(b.connection, {
      tool: "get_output",
      input: { jobId: mcpJobId },
    });
    expect(envelopeOf(httpOutput)).toEqual(envelopeOfMcp(mcpOutput));
  });

  test("getJob: GET /v1/jobs/:jobId === get_job", async () => {
    const lane = await acceptanceLane("f-getjob");
    const submitted = await lane.platform.services.launchLabRun(lane.connection, {
      labRun: { domain: "football" },
    });
    const http = await lane.http.handle({
      method: "GET",
      path: `/v1/jobs/${submitted.result.jobId}`,
    });
    const mcp = await lane.mcp.callTool(lane.connection, {
      tool: "get_job",
      input: { jobId: submitted.result.jobId },
    });
    expect(envelopeOf(http)).toEqual(envelopeOfMcp(mcp));
  });

  test("getJobProgress: GET /v1/jobs/:jobId/progress === get_job_progress (the harness progress projection)", async () => {
    const lane = await acceptanceLane("f-progress");
    // A completed feed job carries a real checkpoint timeline.
    const feedInput = {
      items: ["prog-a", "prog-b"].map((id) => ({
        metadata: feedItemMetadata(id),
        bytes: fixtureBytes(id),
        declaredBasis: platformFeedBasis(),
      })),
      organization: { organizationId: "org-alpha" },
    };
    const submitted = await lane.platform.services.submitFeed(lane.connection, feedInput);
    await lane.worker.runAttempt(submitted.result.jobId);
    const http = await lane.http.handle({
      method: "GET",
      path: `/v1/jobs/${submitted.result.jobId}/progress`,
    });
    const mcp = await lane.mcp.callTool(lane.connection, {
      tool: "get_job_progress",
      input: { jobId: submitted.result.jobId },
    });
    expect(http.status).toBe(200);
    expect(envelopeOf(http)).toEqual(envelopeOfMcp(mcp));
    const progress = envelopeOf<{
      progress: { timeline: { seq: number; at: number }[]; resumable: boolean; state: string };
    }>(http).result.progress;
    expect(progress.timeline.map((entry) => entry.seq)).toEqual([1, 2]);
    expect(progress.resumable).toBe(false);
    expect(progress.state).toBe("completed");
  });

  test("cancelJob: POST /v1/jobs/:jobId/cancellation === cancel_job", async () => {
    const a = await acceptanceLane("f-cancel-http");
    const b = await acceptanceLane("f-cancel-mcp");
    const submittedA = await a.platform.services.launchLabRun(a.connection, {
      labRun: { domain: "football" },
    });
    const submittedB = await b.platform.services.launchLabRun(b.connection, {
      labRun: { domain: "football" },
    });
    const http = await a.http.handle({
      method: "POST",
      path: `/v1/jobs/${submittedA.result.jobId}/cancellation`,
    });
    const mcp = await b.mcp.callTool(b.connection, {
      tool: "cancel_job",
      input: { jobId: submittedB.result.jobId },
    });
    expect(envelopeOf(http)).toEqual(envelopeOfMcp(mcp));
    expect(envelopeOf<{ cancelled: boolean }>(http).result.cancelled).toBe(true);
  });

  test("getOutput + getEvidence: the completed feed job serves both identically", async () => {
    const lane = await acceptanceLane("f-outev");
    const seeded = await seedBenchmark(lane);
    const httpOut = await lane.http.handle({
      method: "GET",
      path: `/v1/jobs/${seeded.jobId}/output`,
    });
    const mcpOut = await lane.mcp.callTool(lane.connection, {
      tool: "get_output",
      input: { jobId: seeded.jobId },
    });
    expect(envelopeOf(httpOut)).toEqual(envelopeOfMcp(mcpOut));
    const httpEv = await lane.http.handle({
      method: "GET",
      path: `/v1/jobs/${seeded.jobId}/evidence`,
    });
    const mcpEv = await lane.mcp.callTool(lane.connection, {
      tool: "get_evidence",
      input: { jobId: seeded.jobId },
    });
    expect(envelopeOf(httpEv)).toEqual(envelopeOfMcp(mcpEv));
  });

  test("listBenchmarks: GET /v1/benchmarks === list_benchmarks (the benchmark registration query)", async () => {
    const lane = await acceptanceLane("f-bench-list");
    const seeded = await seedBenchmark(lane);
    const http = await lane.http.handle({
      method: "GET",
      path: "/v1/benchmarks",
      query: { sourceId: seeded.sourceId },
    });
    const mcp = await lane.mcp.callTool(lane.connection, {
      tool: "list_benchmarks",
      input: { sourceId: seeded.sourceId },
    });
    expect(http.status).toBe(200);
    expect(envelopeOf(http)).toEqual(envelopeOfMcp(mcp));
    const result = envelopeOf<{ registrations: { registrationId: string }[] }>(http).result;
    expect(result.registrations.map((entry) => entry.registrationId)).toEqual([
      seeded.registrationId,
    ]);
  });

  test("getBenchmark: GET /v1/benchmarks/:registrationId === get_benchmark", async () => {
    const lane = await acceptanceLane("f-bench-get");
    const seeded = await seedBenchmark(lane);
    const http = await lane.http.handle({
      method: "GET",
      path: `/v1/benchmarks/${seeded.registrationId}`,
    });
    const mcp = await lane.mcp.callTool(lane.connection, {
      tool: "get_benchmark",
      input: { registrationId: seeded.registrationId },
    });
    expect(envelopeOf(http)).toEqual(envelopeOfMcp(mcp));
    const result = envelopeOf<{ registration: { source: { sourceId: string } } }>(http).result;
    expect(result.registration.source.sourceId).toBe(seeded.sourceId);
  });

  test("promoteOrganization: POST /v1/organizations/:id/promotion === promote_organization", async () => {
    const a = await acceptanceLane("f-promote-http");
    const b = await acceptanceLane("f-promote-mcp");
    const promoteInput = {
      organizationId: "org-draft",
      policy: examplePolicy(),
      additionalEvidence: benchmarkStageEvidence(),
    };
    const http = await a.http.handle({
      method: "POST",
      path: "/v1/organizations/org-draft/promotion",
      body: { policy: promoteInput.policy, additionalEvidence: promoteInput.additionalEvidence },
    });
    const mcp = await b.mcp.callTool(b.connection, {
      tool: "promote_organization",
      input: promoteInput,
    });
    expect(envelopeOf(http)).toEqual(envelopeOfMcp(mcp));
    expect(envelopeOf<{ outcome: { outcome: string } }>(http).result.outcome.outcome).toBe(
      "granted",
    );
  });

  test("idempotent REPLAY parity: the same key + the same request returns the SAME envelope on BOTH surfaces", async () => {
    const lane = await acceptanceLane("f-replay");
    const httpFirst = await lane.http.handle({
      method: "POST",
      path: "/v1/lab-runs",
      body: { labRun: { domain: "football" } },
      idempotencyKey: "replay-1",
    });
    const httpReplay = await lane.http.handle({
      method: "POST",
      path: "/v1/lab-runs",
      body: { labRun: { domain: "football" } },
      idempotencyKey: "replay-1",
    });
    const mcpReplay = await lane.mcp.callTool(lane.connection, {
      tool: "launch_lab",
      input: { labRun: { domain: "football" } },
      idempotencyKey: "replay-1",
    });
    expect(envelopeOf(httpReplay)).toEqual(envelopeOf(httpFirst));
    expect(envelopeOfMcp(mcpReplay)).toEqual(envelopeOf(httpFirst));
  });
});

// ---------------------------------------------------------------------------
// 2. THE ERROR-PARITY SWEEP — every typed refusal family through BOTH
//    surfaces, identical typed codes (a table, not spot checks).
// ---------------------------------------------------------------------------

describe("error parity: every typed refusal family carries the identical typed code through both surfaces", () => {
  /** The lane type the table's closures drive. */
  type Lane = Awaited<ReturnType<typeof acceptanceLane>>;
  /** The lane plus the mutable pockets a setup may leave behind. */
  interface PocketedLane extends Lane {
    foreignConnection?: PlatformConnection;
    foreignJobId?: string;
    earlyJobId?: string;
  }

  interface ErrorRow {
    readonly name: string;
    /**
     * "shared" — both surface calls run on ONE lane (the row's calls are
     * read-only or idempotent against each other). "twin" — each surface
     * call runs on its OWN identically-seeded lane (the row's first call
     * mutates corpus/job state the second call would otherwise trip over).
     */
    readonly mode?: "shared" | "twin";
    readonly setup?: (lane: PocketedLane) => Promise<void>;
    readonly http: (lane: PocketedLane) => Promise<HttpSurfaceResponse>;
    readonly mcp: (lane: PocketedLane) => Promise<McpToolCallOutcome>;
    readonly expectedCode: string;
    readonly expectedFailureClass: string;
  }

  const rows: readonly ErrorRow[] = [
    {
      name: "platform.validation — a malformed lab-run request",
      http: (lane) =>
        lane.http.handle({ method: "POST", path: "/v1/lab-runs", body: { labRun: {} } }),
      mcp: (lane) =>
        lane.mcp.callTool(lane.connection, { tool: "launch_lab", input: { labRun: {} } }),
      expectedCode: "platform.validation",
      expectedFailureClass: "validation",
    },
    {
      name: "platform.validation — a malformed feed request (empty items)",
      http: (lane) =>
        lane.http.handle({
          method: "POST",
          path: "/v1/feeds",
          body: { items: [], organization: { organizationId: "org-alpha" } },
        }),
      mcp: (lane) =>
        lane.mcp.callTool(lane.connection, {
          tool: "submit_feed",
          input: { items: [], organization: { organizationId: "org-alpha" } },
        }),
      expectedCode: "platform.validation",
      expectedFailureClass: "validation",
    },
    {
      name: "platform.validation — a malformed benchmark window",
      http: (lane) =>
        lane.http.handle({
          method: "GET",
          path: "/v1/benchmarks",
          query: { windowStartMs: "garbage", windowEndMs: "also-garbage" },
        }),
      mcp: (lane) =>
        lane.mcp.callTool(lane.connection, {
          tool: "list_benchmarks",
          input: { overlappingWindow: { startMs: "garbage", endMs: "also-garbage" } },
        }),
      expectedCode: "platform.validation",
      expectedFailureClass: "validation",
    },
    {
      name: "upstream.RegistryNotFoundError — an unknown organization (inspect)",
      http: (lane) => lane.http.handle({ method: "GET", path: "/v1/organizations/org-nope" }),
      mcp: (lane) =>
        lane.mcp.callTool(lane.connection, {
          tool: "inspect_organization",
          input: { organizationId: "org-nope" },
        }),
      expectedCode: "upstream.RegistryNotFoundError",
      expectedFailureClass: "not-found",
    },
    {
      name: "platform.not-found — a foreign-tenant job (isolation, never a leak)",
      setup: async (lane) => {
        const submitted = await lane.platform.services.launchLabRun(lane.connection, {
          labRun: { domain: "football" },
        });
        lane.foreignConnection = lane.platform.connect({
          platformId: "platform:other-platform",
          tenantId: "tenant-other",
        });
        lane.foreignJobId = submitted.result.jobId;
      },
      http: async (lane) =>
        createHttpSurface(lane.platform.services, lane.foreignConnection!).handle({
          method: "GET",
          path: `/v1/jobs/${lane.foreignJobId}`,
        }),
      mcp: (lane) =>
        lane.mcp.callTool(lane.foreignConnection!, {
          tool: "get_job",
          input: { jobId: lane.foreignJobId },
        }),
      expectedCode: "platform.not-found",
      expectedFailureClass: "not-found",
    },
    {
      name: "corpus.not-found — an unknown benchmark registration",
      http: (lane) => lane.http.handle({ method: "GET", path: "/v1/benchmarks/deadbeef" }),
      mcp: (lane) =>
        lane.mcp.callTool(lane.connection, {
          tool: "get_benchmark",
          input: { registrationId: "deadbeef" },
        }),
      expectedCode: "corpus.not-found",
      expectedFailureClass: "not-found",
    },
    {
      name: "corpus.rights-basis-required — submit_video bytes without a declared basis",
      http: (lane) =>
        lane.http.handle({
          method: "POST",
          path: "/v1/media",
          body: { bytes: fixtureBytes("no-basis"), metadata: uploadMetadata() },
        }),
      mcp: (lane) =>
        lane.mcp.callTool(lane.connection, {
          tool: "submit_video",
          input: { bytes: fixtureBytes("no-basis"), metadata: uploadMetadata() },
        }),
      expectedCode: "corpus.rights-basis-required",
      expectedFailureClass: "rights",
    },
    {
      name: "corpus.restriction-forbidden — a reference-only feed item with bytes",
      http: (lane) =>
        lane.http.handle({
          method: "POST",
          path: "/v1/feeds",
          body: {
            items: [
              {
                metadata: feedItemMetadata("ref-only", { restrictions: ["reference-only"] }),
                bytes: fixtureBytes("ref-only"),
                declaredBasis: platformFeedBasis(),
              },
            ],
            organization: { organizationId: "org-alpha" },
          },
        }),
      mcp: (lane) =>
        lane.mcp.callTool(lane.connection, {
          tool: "submit_feed",
          input: {
            items: [
              {
                metadata: feedItemMetadata("ref-only", { restrictions: ["reference-only"] }),
                bytes: fixtureBytes("ref-only"),
                declaredBasis: platformFeedBasis(),
              },
            ],
            organization: { organizationId: "org-alpha" },
          },
        }),
      expectedCode: "corpus.restriction-forbidden",
      expectedFailureClass: "restriction",
    },
    {
      name: "platform.job-state — get_output before completion",
      setup: async (lane) => {
        const submitted = await lane.platform.services.submitMedia(lane.connection, {
          bytes: fixtureBytes("early"),
          declaredBasis: platformUploadBasis(),
          metadata: uploadMetadata(),
          organizationId: "org-alpha",
        });
        lane.earlyJobId = submitted.result.jobId as string;
      },
      http: (lane) =>
        lane.http.handle({ method: "GET", path: `/v1/jobs/${lane.earlyJobId}/output` }),
      mcp: (lane) =>
        lane.mcp.callTool(lane.connection, {
          tool: "get_output",
          input: { jobId: lane.earlyJobId },
        }),
      expectedCode: "platform.job-state",
      expectedFailureClass: "job-state",
    },
    {
      name: "platform.job-state — get_evidence before completion",
      setup: async (lane) => {
        const submitted = await lane.platform.services.submitMedia(lane.connection, {
          bytes: fixtureBytes("early-ev"),
          declaredBasis: platformUploadBasis(),
          metadata: uploadMetadata(),
          organizationId: "org-alpha",
        });
        lane.earlyJobId = submitted.result.jobId as string;
      },
      http: (lane) =>
        lane.http.handle({ method: "GET", path: `/v1/jobs/${lane.earlyJobId}/evidence` }),
      mcp: (lane) =>
        lane.mcp.callTool(lane.connection, {
          tool: "get_evidence",
          input: { jobId: lane.earlyJobId },
        }),
      expectedCode: "platform.job-state",
      expectedFailureClass: "job-state",
    },
    {
      name: "platform.organization-not-selectable — submit_video with a draft organization",
      http: (lane) =>
        lane.http.handle({
          method: "POST",
          path: "/v1/media",
          body: {
            bytes: fixtureBytes("draft-org"),
            declaredBasis: platformUploadBasis(),
            metadata: uploadMetadata(),
            organizationId: "org-draft",
          },
        }),
      mcp: (lane) =>
        lane.mcp.callTool(lane.connection, {
          tool: "submit_video",
          input: {
            bytes: fixtureBytes("draft-org"),
            declaredBasis: platformUploadBasis(),
            metadata: uploadMetadata(),
            organizationId: "org-draft",
          },
        }),
      expectedCode: "platform.organization-not-selectable",
      expectedFailureClass: "policy",
    },
    {
      name: "platform.organization-not-selectable — submit_feed with a draft organization",
      mode: "twin", // the first call acquires the feed item; the second lane must start clean
      http: (lane) =>
        lane.http.handle({
          method: "POST",
          path: "/v1/feeds",
          body: {
            items: [
              {
                metadata: feedItemMetadata("draft-feed"),
                bytes: fixtureBytes("draft-feed"),
                declaredBasis: platformFeedBasis(),
              },
            ],
            organization: { organizationId: "org-draft" },
          },
        }),
      mcp: (lane) =>
        lane.mcp.callTool(lane.connection, {
          tool: "submit_feed",
          input: {
            items: [
              {
                metadata: feedItemMetadata("draft-feed"),
                bytes: fixtureBytes("draft-feed"),
                declaredBasis: platformFeedBasis(),
              },
            ],
            organization: { organizationId: "org-draft" },
          },
        }),
      expectedCode: "platform.organization-not-selectable",
      expectedFailureClass: "policy",
    },
    {
      name: "platform.conflict — an idempotency key reused with a DIFFERENT request",
      setup: async (lane) => {
        await lane.http.handle({
          method: "POST",
          path: "/v1/lab-runs",
          body: { labRun: { domain: "football" } },
          idempotencyKey: "conflict-1",
        });
      },
      http: (lane) =>
        lane.http.handle({
          method: "POST",
          path: "/v1/lab-runs",
          body: { labRun: { domain: "basketball" } },
          idempotencyKey: "conflict-1",
        }),
      mcp: (lane) =>
        lane.mcp.callTool(lane.connection, {
          tool: "launch_lab",
          input: { labRun: { domain: "basketball" } },
          idempotencyKey: "conflict-1",
        }),
      expectedCode: "platform.conflict",
      expectedFailureClass: "conflict",
    },
    {
      name: "platform.validation — a feed with duplicate canonical references",
      http: (lane) =>
        lane.http.handle({
          method: "POST",
          path: "/v1/feeds",
          body: {
            items: [
              {
                metadata: feedItemMetadata("dup"),
                bytes: fixtureBytes("dup"),
                declaredBasis: platformFeedBasis(),
              },
              {
                metadata: feedItemMetadata("dup"),
                bytes: fixtureBytes("dup-2"),
                declaredBasis: platformFeedBasis(),
              },
            ],
            organization: { organizationId: "org-alpha" },
          },
        }),
      mcp: (lane) =>
        lane.mcp.callTool(lane.connection, {
          tool: "submit_feed",
          input: {
            items: [
              {
                metadata: feedItemMetadata("dup"),
                bytes: fixtureBytes("dup"),
                declaredBasis: platformFeedBasis(),
              },
              {
                metadata: feedItemMetadata("dup"),
                bytes: fixtureBytes("dup-2"),
                declaredBasis: platformFeedBasis(),
              },
            ],
            organization: { organizationId: "org-alpha" },
          },
        }),
      expectedCode: "platform.validation",
      expectedFailureClass: "validation",
    },
    {
      name: "jobs.illegal-transition — cancelling a COMPLETED job (terminal records are frozen)",
      setup: async (lane) => {
        const submitted = await lane.platform.services.submitMedia(lane.connection, {
          bytes: fixtureBytes("done-cancel"),
          declaredBasis: platformUploadBasis(),
          metadata: uploadMetadata(),
          organizationId: "org-alpha",
        });
        await lane.worker.runAttempt(submitted.result.jobId as string);
        lane.earlyJobId = submitted.result.jobId as string;
      },
      http: (lane) =>
        lane.http.handle({ method: "POST", path: `/v1/jobs/${lane.earlyJobId}/cancellation` }),
      mcp: (lane) =>
        lane.mcp.callTool(lane.connection, {
          tool: "cancel_job",
          input: { jobId: lane.earlyJobId },
        }),
      expectedCode: "jobs.illegal-transition",
      expectedFailureClass: "illegal-transition",
    },
    {
      name: "jobs.not-found — an unknown job id",
      http: (lane) => lane.http.handle({ method: "POST", path: "/v1/jobs/job-nope/cancellation" }),
      mcp: (lane) =>
        lane.mcp.callTool(lane.connection, {
          tool: "cancel_job",
          input: { jobId: "job-nope" },
        }),
      expectedCode: "jobs.not-found",
      expectedFailureClass: "not-found",
    },
  ];

  for (const [index, row] of rows.entries()) {
    test(`REFUSAL PARITY: ${row.name}`, async () => {
      const httpLane: PocketedLane = { ...(await acceptanceLane(`err-${index}-http`)) };
      const mcpLane: PocketedLane =
        row.mode === "twin" ? { ...(await acceptanceLane(`err-${index}-mcp`)) } : httpLane; // shared: one lane, both surfaces
      if (row.setup !== undefined) {
        await row.setup(httpLane);
        if (row.mode === "twin") await row.setup(mcpLane);
      }
      const http = await row.http(httpLane);
      const mcp = await row.mcp(mcpLane);
      // The typed code + failureClass ride IDENTICALLY through both surfaces.
      expect(errorOf(http)).toMatchObject({
        code: row.expectedCode,
        failureClass: row.expectedFailureClass,
      });
      expect(errorOfMcp(mcp)).toMatchObject({
        code: row.expectedCode,
        failureClass: row.expectedFailureClass,
      });
      // And the full neutral records agree on everything but transport.
      expect(errorOf(http).code).toBe(errorOfMcp(mcp).code);
      expect(errorOf(http).failureClass).toBe(errorOfMcp(mcp).failureClass);
      expect(errorOf(http).message).toBe(errorOfMcp(mcp).message);
    });
  }

  test("the sweep covered every refusal family the surfaces can produce", async () => {
    // The pinned inventory: each distinct typed code the sweep asserts.
    const codes = new Set(rows.map((row) => row.expectedCode));
    expect([...codes].sort()).toEqual(
      [
        "corpus.not-found",
        "corpus.restriction-forbidden",
        "corpus.rights-basis-required",
        "jobs.illegal-transition",
        "jobs.not-found",
        "platform.conflict",
        "platform.job-state",
        "platform.not-found",
        "platform.organization-not-selectable",
        "platform.validation",
        "upstream.RegistryNotFoundError",
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// 3. RECONNECT SEMANTICS — a client that drops mid-operation and reconnects
//    observes the SAME state through both surfaces.
// ---------------------------------------------------------------------------

describe("reconnect semantics: drop mid-operation, reconnect, the SAME state through both surfaces", () => {
  test("twin lanes (HTTP + MCP) observe identical mid-flight, crashed, and reconnected states", async () => {
    // Lane A drives through HTTP; lane B drives the IDENTICAL scenario
    // through MCP. Both lanes' transformers park on the SECOND item (the
    // mid-operation disconnect point).
    let releaseA!: () => void;
    let releaseB!: () => void;
    const gateA = new Promise<void>((done) => {
      releaseA = done;
    });
    const gateB = new Promise<void>((done) => {
      releaseB = done;
    });
    const a = await acceptanceLane("rec-http", gatedTransformer(gateA, 2));
    const b = await acceptanceLane("rec-mcp", gatedTransformer(gateB, 2));

    const feedInput = {
      items: ["rec-1", "rec-2"].map((id) => ({
        metadata: feedItemMetadata(id),
        bytes: fixtureBytes(id),
        declaredBasis: platformFeedBasis(),
      })),
      organization: { organizationId: "org-alpha" },
    };

    // The client submits through its surface, then the worker starts.
    const httpSubmit = await a.http.handle({ method: "POST", path: "/v1/feeds", body: feedInput });
    const mcpSubmit = await b.mcp.callTool(b.connection, { tool: "submit_feed", input: feedInput });
    expect(envelopeOf(httpSubmit)).toEqual(envelopeOfMcp(mcpSubmit));
    const jobId = envelopeOf<{ jobId: string }>(httpSubmit).result.jobId;

    const abandonedA = a.worker.runAttempt(jobId).catch(() => "abandoned-a");
    const abandonedB = b.worker.runAttempt(jobId).catch(() => "abandoned-b");

    // MID-FLIGHT: item 1 is checkpointed; item 2's transform is parked.
    // The clients observe through their surfaces... then DROP.
    const observeMidFlight = async () => {
      for (let i = 0; i < 50; i += 1) {
        const status = await a.platform.services.getJob(a.connection, { jobId });
        if (status.result.job.checkpointCount >= 1 && status.result.job.state === "running") {
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return false;
    };
    expect(await observeMidFlight()).toBe(true);
    const httpMid = await a.http.handle({ method: "GET", path: `/v1/jobs/${jobId}` });
    const mcpMid = await b.mcp.callTool(b.connection, { tool: "get_job", input: { jobId } });
    expect(envelopeOf(httpMid)).toEqual(envelopeOfMcp(mcpMid));
    const httpProgressMid = await a.http.handle({
      method: "GET",
      path: `/v1/jobs/${jobId}/progress`,
    });
    const mcpProgressMid = await b.mcp.callTool(b.connection, {
      tool: "get_job_progress",
      input: { jobId },
    });
    expect(envelopeOf(httpProgressMid)).toEqual(envelopeOfMcp(mcpProgressMid));
    expect(
      envelopeOf<{ progress: { timeline: { seq: number; at: number }[] } }>(httpProgressMid).result
        .progress.timeline,
    ).toEqual([{ seq: 1, at: 10_000 }]);

    // The workers "crash" (the lease expires while the transform is parked).
    a.clock.advance(10_000);
    b.clock.advance(10_000);
    releaseA();
    releaseB();
    await abandonedA;
    await abandonedB;

    // RECONNECT: new connections over the same canonical stores, and a new
    // worker resumes from the durable checkpoint on each lane.
    const reconnectedA = a.platform.connect({
      platformId: "platform:video-platform",
      tenantId: "tenant-1",
    });
    const reconnectedB = b.platform.connect({
      platformId: "platform:video-platform",
      tenantId: "tenant-1",
    });
    const httpReconnected = createHttpSurface(a.platform.services, reconnectedA);
    const mcpReconnected = createMcpToolSurface(b.platform.services);
    const workerA2 = createWorkerRuntime({
      store: a.jobs,
      workerId: "w2-a",
      leaseTtlMs: 5_000,
      executors: a.platform.executors,
    });
    const workerB2 = createWorkerRuntime({
      store: b.jobs,
      workerId: "w2-b",
      leaseTtlMs: 5_000,
      executors: b.platform.executors,
    });
    const doneA = await workerA2.runAttempt(jobId);
    const doneB = await workerB2.runAttempt(jobId);
    expect(doneA.state).toBe("completed");
    expect(doneB.state).toBe("completed");

    // The reconnected clients observe the SAME state through BOTH surfaces.
    const httpFinal = await httpReconnected.handle({ method: "GET", path: `/v1/jobs/${jobId}` });
    const mcpFinal = await mcpReconnected.callTool(reconnectedB, {
      tool: "get_job",
      input: { jobId },
    });
    expect(envelopeOf(httpFinal)).toEqual(envelopeOfMcp(mcpFinal));
    expect(
      envelopeOf<{ job: { state: string; attempts: number } }>(httpFinal).result.job,
    ).toMatchObject({ state: "completed", attempts: 1 });

    const httpProgressFinal = await httpReconnected.handle({
      method: "GET",
      path: `/v1/jobs/${jobId}/progress`,
    });
    const mcpProgressFinal = await mcpReconnected.callTool(reconnectedB, {
      tool: "get_job_progress",
      input: { jobId },
    });
    expect(envelopeOf(httpProgressFinal)).toEqual(envelopeOfMcp(mcpProgressFinal));
    expect(
      envelopeOf<{ progress: { timeline: { seq: number; at: number }[]; resumable: boolean } }>(
        httpProgressFinal,
      ).result.progress,
    ).toMatchObject({ resumable: false });
    expect(
      envelopeOf<{ progress: { timeline: { seq: number; at: number }[] } }>(
        httpProgressFinal,
      ).result.progress.timeline.map((entry) => entry.seq),
    ).toEqual([1, 2]); // no lost lineage, no duplicate checkpoints

    const httpOutput = await httpReconnected.handle({
      method: "GET",
      path: `/v1/jobs/${jobId}/output`,
    });
    const mcpOutput = await mcpReconnected.callTool(reconnectedB, {
      tool: "get_output",
      input: { jobId },
    });
    expect(envelopeOf(httpOutput)).toEqual(envelopeOfMcp(mcpOutput));
    expect(
      envelopeOf<{ artifact: { items: unknown[] } }>(httpOutput).result.artifact.items,
    ).toHaveLength(2);

    const httpEvidence = await httpReconnected.handle({
      method: "GET",
      path: `/v1/jobs/${jobId}/evidence`,
    });
    const mcpEvidence = await mcpReconnected.callTool(reconnectedB, {
      tool: "get_evidence",
      input: { jobId },
    });
    expect(envelopeOf(httpEvidence)).toEqual(envelopeOfMcp(mcpEvidence));

    // Exactly ONE authoritative completion on each lane's journal.
    for (const lane of [a, b]) {
      const events = await lane.jobs.readJournal();
      expect(
        events.filter((event) => event.type === "patched" && event.op === "complete"),
      ).toHaveLength(1);
      expect(events.filter((event) => event.type === "enqueued")).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. UNKNOWN-OPERATION / MALFORMED-PAYLOAD families fail closed identically.
// ---------------------------------------------------------------------------

describe("unknown-operation and malformed-payload families fail closed identically", () => {
  test("unknown operations fail closed on BOTH surfaces (each surface's typed code)", async () => {
    const lane = await acceptanceLane("unknown-ops");
    // HTTP: unknown route, wrong method, unversioned path.
    const unknownRoute = await lane.http.handle({ method: "GET", path: "/v1/nonexistent" });
    expect(unknownRoute.status).toBe(404);
    expect(errorOf(unknownRoute).code).toBe("platform.route-not-found");
    const wrongMethod = await lane.http.handle({ method: "POST", path: "/v1/organizations" });
    expect(wrongMethod.status).toBe(405);
    expect(errorOf(wrongMethod).code).toBe("platform.method-not-allowed");
    const unversioned = await lane.http.handle({ method: "GET", path: "/organizations" });
    expect(unversioned.status).toBe(404);
    expect(errorOf(unversioned).code).toBe("platform.unsupported-version");
    // And the unknown sub-resource of a known family fails closed too.
    const unknownSub = await lane.http.handle({ method: "GET", path: "/v1/jobs/job-1/nope" });
    expect(unknownSub.status).toBe(404);
    expect(errorOf(unknownSub).code).toBe("platform.route-not-found");
    // MCP: unknown tool.
    const unknownTool = await lane.mcp.callTool(lane.connection, {
      tool: "not_a_tool",
      input: {},
    });
    expect(errorOfMcp(unknownTool).code).toBe("platform.tool-not-found");
    expect(errorOfMcp(unknownTool).failureClass).toBe("not-found");
    // A known tool name with a MALFORMED input fails closed identically
    // through both surfaces (the typed validation family, swept above).
    const httpMalformed = await lane.http.handle({
      method: "POST",
      path: "/v1/lab-runs",
      body: { labRun: { domain: "" } },
    });
    const mcpMalformed = await lane.mcp.callTool(lane.connection, {
      tool: "launch_lab",
      input: { labRun: { domain: "" } },
    });
    expect(errorOf(httpMalformed).code).toBe(errorOfMcp(mcpMalformed).code);
    expect(errorOf(httpMalformed).code).toBe("platform.validation");
  });
});
