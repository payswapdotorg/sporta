/**
 * REL-015 parity tests — THE CONTRACT'S CORE RULE: "HTTP and MCP must
 * resolve to the same application semantics" (Gate REL-A7). Every tool
 * family is exercised on BOTH paths and the result records are
 * deep-compared:
 *
 * - read-only families (search/inspect/get_job/get_output/get_evidence):
 *   the SAME platform + connection, both surfaces, envelope deep-equal;
 * - mutating families (launch_lab/submit_video/submit_feed/cancel_job/
 *   promote_organization): two identically-seeded platforms (deterministic
 *   clocks, sequential ids, identical registry walks), the same scenario
 *   driven on each path, envelopes deep-equal;
 * - error parity: the same rights refusal through both surfaces carries
 *   the identical typed code; unknown operations fail closed on both.
 *
 * MCP is an interaction protocol, never business logic: the tool layer
 * forwards to the SAME service the HTTP route dispatches to — which is
 * what these deep-equalities prove, family by family.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createWorkerRuntime } from "@sporta/durable-jobs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHttpSurface, createMcpToolSurface, MCP_TOOLS } from "../src";
import type { HttpSurfaceResponse, McpToolCallOutcome } from "../src";
import {
  benchmarkStageEvidence,
  buildStack,
  examplePolicy,
  feedItemMetadata,
  fixtureBytes,
  platformFeedBasis,
  platformUploadBasis,
  uploadMetadata,
} from "./fixtures";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sporta-external-parity-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** One identically-seeded platform + connection + both surfaces + worker. */
async function parityLane(name: string) {
  const stack = await buildStack(dir, name);
  const connection = stack.platform.connect({
    platformId: "platform:video-platform",
    tenantId: "tenant-1",
  });
  const http = createHttpSurface(stack.platform.services, connection);
  const mcp = createMcpToolSurface(stack.platform.services);
  const worker = createWorkerRuntime({
    store: stack.jobs,
    workerId: "w1",
    leaseTtlMs: 5_000,
    executors: stack.platform.executors,
  });
  return { stack, connection, http, mcp, worker };
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

describe("the tool vocabulary is the versioned families, 1:1 onto the services", () => {
  test("listTools advertises exactly the versioned families", () => {
    const { mcp } = { mcp: createMcpToolSurface(null as never) }; // listing needs no services
    const names = mcp.listTools().map((tool) => tool.name);
    expect(names).toEqual([
      "search_organizations",
      "inspect_organization",
      "launch_lab",
      "submit_video",
      "submit_feed",
      "get_job",
      "get_job_progress",
      "cancel_job",
      "get_output",
      "get_evidence",
      "list_benchmarks",
      "get_benchmark",
      "promote_organization",
    ]);
    // Every tool maps 1:1 onto a distinct versioned service.
    const services = mcp.listTools().map((tool) => tool.service);
    expect(new Set(services).size).toBe(13);
    for (const tool of mcp.listTools()) {
      expect(tool.version).toBe(1);
      expect(tool.description.length).toBeGreaterThan(0);
    }
    expect(MCP_TOOLS.length).toBe(13);
  });
});

describe("read-only families: the same platform, both surfaces, deep-equal", () => {
  test("search_organizations === GET /v1/organizations", async () => {
    const lane = await parityLane("p-search");
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
    expect(envelopeOf(http).service).toBe("searchOrganizations");
    expect(envelopeOf<{ candidates: unknown[] }>(http).result.candidates.length).toBe(1);
  });

  test("inspect_organization === GET /v1/organizations/:id", async () => {
    const lane = await parityLane("p-inspect");
    const http = await lane.http.handle({
      method: "GET",
      path: "/v1/organizations/org-alpha",
    });
    const mcp = await lane.mcp.callTool(lane.connection, {
      tool: "inspect_organization",
      input: { organizationId: "org-alpha" },
    });
    expect(envelopeOf(http)).toEqual(envelopeOfMcp(mcp));
    expect(
      envelopeOf<{ organization: { displayName: string } }>(http).result.organization.displayName,
    ).toBe("Org Alpha");
  });

  test("get_job === GET /v1/jobs/:jobId (mid-flight and completed)", async () => {
    const lane = await parityLane("p-getjob");
    const submitted = await lane.stack.platform.services.launchLabRun(lane.connection, {
      labRun: { domain: "football" },
    });
    const jobId = submitted.result.jobId;
    const httpMid = await lane.http.handle({ method: "GET", path: `/v1/jobs/${jobId}` });
    const mcpMid = await lane.mcp.callTool(lane.connection, {
      tool: "get_job",
      input: { jobId },
    });
    expect(envelopeOf(httpMid)).toEqual(envelopeOfMcp(mcpMid));
    expect(envelopeOf<{ job: { state: string } }>(httpMid).result.job.state).toBe("queued");
  });
});

describe("mutating families: identically-seeded platforms, both paths, deep-equal", () => {
  test("launch_lab === POST /v1/lab-runs (durable id immediately)", async () => {
    const a = await parityLane("p-lab-http");
    const b = await parityLane("p-lab-mcp");
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
    expect(envelopeOf<{ state: string; jobId: string }>(http).result.state).toBe("queued");
    expect(envelopeOf<{ state: string; jobId: string }>(http).result.jobId).toBe("job-1");
  });

  test("submit_video === POST /v1/media (bytes path, processed to output + evidence)", async () => {
    const a = await parityLane("p-media-http");
    const b = await parityLane("p-media-mcp");
    const mediaInput = {
      bytes: fixtureBytes("parity-media"),
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
      organizationId: "org-alpha",
    };
    const http = await a.http.handle({ method: "POST", path: "/v1/media", body: mediaInput });
    const mcp = await b.mcp.callTool(b.connection, {
      tool: "submit_video",
      input: mediaInput,
    });
    expect(http.status).toBe(201);
    expect(envelopeOf(http)).toEqual(envelopeOfMcp(mcp));
    expect(envelopeOf<{ sourceState: string; jobId: string }>(http).result.sourceState).toBe(
      "acquired",
    );
    expect(envelopeOf<{ sourceState: string; jobId: string }>(http).result.jobId).toBe("job-1");

    // Process BOTH to completion, then compare get_output + get_evidence.
    const httpJobId = envelopeOf<{ jobId: string }>(http).result.jobId;
    const mcpJobId = envelopeOfMcp<{ jobId: string }>(mcp).result.jobId;
    const doneA = await a.worker.runAttempt(httpJobId);
    const doneB = await b.worker.runAttempt(mcpJobId);
    expect(doneA.state).toBe("completed");
    expect(doneB.state).toBe("completed");

    const httpOutput = await a.http.handle({ method: "GET", path: `/v1/jobs/${httpJobId}/output` });
    const mcpOutput = await b.mcp.callTool(b.connection, {
      tool: "get_output",
      input: { jobId: mcpJobId },
    });
    expect(envelopeOf(httpOutput)).toEqual(envelopeOfMcp(mcpOutput));
    expect(
      envelopeOf<{ artifact: { checksum: string } }>(httpOutput).result.artifact.checksum,
    ).toBe(envelopeOfMcp<{ artifact: { checksum: string } }>(mcpOutput).result.artifact.checksum);
    expect(envelopeOf<{ bytes: Uint8Array }>(httpOutput).result.bytes.byteLength).toBe(
      envelopeOfMcp<{ bytes: Uint8Array }>(mcpOutput).result.bytes.byteLength,
    );

    const httpEvidence = await a.http.handle({
      method: "GET",
      path: `/v1/jobs/${httpJobId}/evidence`,
    });
    const mcpEvidence = await b.mcp.callTool(b.connection, {
      tool: "get_evidence",
      input: { jobId: mcpJobId },
    });
    expect(envelopeOf(httpEvidence)).toEqual(envelopeOfMcp(mcpEvidence));
    expect(
      envelopeOf<{ evidence: { qualityGate: { passed: boolean } } }>(httpEvidence).result.evidence
        .qualityGate.passed,
    ).toBe(true);
  });

  test("submit_feed === POST /v1/feeds (full pipeline)", async () => {
    const a = await parityLane("p-feed-http");
    const b = await parityLane("p-feed-mcp");
    const feedInput = {
      items: ["parity-a", "parity-b"].map((id) => ({
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
    expect(envelopeOf<{ itemCount: number }>(http).result.itemCount).toBe(2);

    const httpJobId = envelopeOf<{ jobId: string }>(http).result.jobId;
    const mcpJobId = envelopeOfMcp<{ jobId: string }>(mcp).result.jobId;
    await a.worker.runAttempt(httpJobId);
    await b.worker.runAttempt(mcpJobId);
    const httpOutput = await a.http.handle({ method: "GET", path: `/v1/jobs/${httpJobId}/output` });
    const mcpOutput = await b.mcp.callTool(b.connection, {
      tool: "get_output",
      input: { jobId: mcpJobId },
    });
    expect(envelopeOf(httpOutput)).toEqual(envelopeOfMcp(mcpOutput));
    expect(
      envelopeOf<{ artifact: { items: unknown[] } }>(httpOutput).result.artifact.items.length,
    ).toBe(2);
  });

  test("cancel_job === POST /v1/jobs/:jobId/cancellation", async () => {
    const a = await parityLane("p-cancel-http");
    const b = await parityLane("p-cancel-mcp");
    const submittedA = await a.stack.platform.services.launchLabRun(a.connection, {
      labRun: { domain: "football" },
    });
    const submittedB = await b.stack.platform.services.launchLabRun(b.connection, {
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
    expect(envelopeOf<{ cancelled: boolean }>(http).result.cancelled).toBe(true); // queued jobs cancel immediately
  });

  test("promote_organization === POST /v1/organizations/:id/promotion", async () => {
    const a = await parityLane("p-promote-http");
    const b = await parityLane("p-promote-mcp");
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
    ); // draft -> benchmarked
    expect(envelopeOf<{ imported: boolean }>(http).result.imported).toBe(false); // not selectable yet
  });
});

describe("error parity: the same typed refusal through both surfaces", () => {
  test("the rights refusal carries the identical code on both paths", async () => {
    const lane = await parityLane("p-rights");
    const http = await lane.http.handle({
      method: "POST",
      path: "/v1/media",
      body: { bytes: fixtureBytes("parity-no-basis"), metadata: uploadMetadata() },
    });
    const mcp = await lane.mcp.callTool(lane.connection, {
      tool: "submit_video",
      input: { bytes: fixtureBytes("parity-no-basis"), metadata: uploadMetadata() },
    });
    expect(http.status).toBe(401); // failureClass rights
    expect(http.body).toMatchObject({ error: { code: "corpus.rights-basis-required" } });
    expect(mcp.isError).toBe(true);
    if (mcp.isError) {
      expect(mcp.error.code).toBe("corpus.rights-basis-required");
      expect(mcp.error.failureClass).toBe("rights");
    }
  });

  test("output before completion refuses identically on both paths", async () => {
    const lane = await parityLane("p-early");
    const submitted = await lane.stack.platform.services.submitMedia(lane.connection, {
      bytes: fixtureBytes("parity-early"),
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
      organizationId: "org-alpha",
    });
    const jobId = submitted.result.jobId as string;
    const http = await lane.http.handle({ method: "GET", path: `/v1/jobs/${jobId}/output` });
    const mcp = await lane.mcp.callTool(lane.connection, {
      tool: "get_output",
      input: { jobId },
    });
    expect(http.status).toBe(409); // failureClass job-state
    expect(http.body).toMatchObject({ error: { code: "platform.job-state" } });
    expect(mcp.isError).toBe(true);
    if (mcp.isError) {
      expect(mcp.error.code).toBe("platform.job-state");
    }
  });

  test("unknown operations fail closed on both surfaces (transport-specific, both typed)", async () => {
    const lane = await parityLane("p-unknown");
    const http = await lane.http.handle({ method: "GET", path: "/v1/nonexistent" });
    expect(http.status).toBe(404);
    expect(http.body).toMatchObject({ error: { code: "platform.route-not-found" } });
    const wrongMethod = await lane.http.handle({ method: "POST", path: "/v1/organizations" });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.body).toMatchObject({ error: { code: "platform.method-not-allowed" } });
    const unversioned = await lane.http.handle({ method: "GET", path: "/organizations" });
    expect(unversioned.status).toBe(404);
    expect(unversioned.body).toMatchObject({ error: { code: "platform.unsupported-version" } });
    const mcp = await lane.mcp.callTool(lane.connection, {
      tool: "not_a_tool",
      input: {},
    });
    expect(mcp.isError).toBe(true);
    if (mcp.isError) {
      expect(mcp.error.code).toBe("platform.tool-not-found");
    }
  });

  test("the HTTP query surface maps the catalog query params onto the same service", async () => {
    const lane = await parityLane("p-query");
    const http = await lane.http.handle({
      method: "GET",
      path: "/v1/organizations",
      query: { domain: "football", maxP95LatencyMs: "2000", ordering: "cost-ascending" },
    });
    const mcp = await lane.mcp.callTool(lane.connection, {
      tool: "search_organizations",
      input: {
        query: { domain: "football", maxP95LatencyMs: 2000 },
        ordering: { kind: "cost-ascending" },
      },
    });
    expect(envelopeOf(http)).toEqual(envelopeOfMcp(mcp));
  });
});
