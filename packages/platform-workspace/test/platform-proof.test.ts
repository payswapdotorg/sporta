/**
 * REL-035 — the PLATFORM TRANSFORMATION PROOF (Gate REL-A10 at the
 * COMPOSITION grade): a simulated external video platform walks the full
 * transformation journey —
 *
 * ```
 * upload video -> choose/auto-select organization -> process
 *              -> quality gate -> retrieve transformed video + evidence chain
 * ```
 *
 * — over the platform-workspace composition, AND the artifacts it
 * retrieves through the EXTERNAL surfaces (the HTTP resource surface and
 * the MCP tool surface, both created over the workspace's OWN imported
 * services) are the SAME artifacts the composition's session retrieves:
 * digests and provenance verified end-to-end against the authorities that
 * own them (the corpus's checksums, the registry's record version, the
 * durable job's canonical state, the artifact content address, the
 * declared-quality gate's verdict).
 *
 * THE ONE-TRUTH SEAM (the point of this proof): the workspace is a typed
 * client and composer over the imported authorities — it is NEVER a second
 * job, rights, artifact, promotion or quality authority. Therefore, for the
 * SAME completed job:
 *
 * ```
 * session.output(jobId) === HTTP GET /v1/jobs/:jobId/output
 *                        === MCP get_output(jobId)          (deep-equal)
 * session.evidence(jobId) === HTTP evidence === MCP get_evidence (ditto)
 * ```
 *
 * — and the session's own submissions (the external client's media + feed
 * jobs) are executed by the composition's embedded runtime and retrieved
 * identically through all three clients. The journey runs on TWIN
 * identically-seeded workspace stacks (HTTP lane + MCP lane), every step
 * recorded as a typed JOURNEY RECORD whose HTTP and MCP lanes must
 * DEEP-EQUAL; independent re-runs must reproduce the records (same seed,
 * deep-equal journey records).
 *
 * The reconnect leg (REL-A7 over the composition): the session client
 * DROPS after processing is requested (before the job runs), reconnects
 * through a NEW session over the same canonical stores, and drives the
 * jobs to completion from there — the state never lived in the session.
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
  createHttpSurface,
  createMcpToolSurface,
  toTypedErrorRecord,
} from "@sporta/external-platform";
import type {
  GetEvidenceResult,
  GetOutputResult,
  HttpSurfaceRequest,
  HttpSurfaceResponse,
  McpToolCallOutcome,
  McpToolCallRequest,
  PlatformConnection,
  TypedErrorRecord,
} from "@sporta/external-platform";
import type { RightsBasis, SourceMetadata } from "@sporta/historical-corpus";
import {
  buildWorkspaceStack,
  cleanupScratch,
  fixtureBytes,
  platformUploadBasis,
  sha256HexBytes,
  SIMULATED_PLATFORM,
  uploadMetadata,
} from "./fixtures";
import type { WorkspaceStack } from "./fixtures";
import { DECLARED_QUALITY_GATE_ID } from "../src";
import type { WorkspaceSession } from "../src";

afterAll(() => {
  cleanupScratch();
});

// ---------------------------------------------------------------------------
// The composed lane (one identically-seeded workspace stack + both surfaces)
// ---------------------------------------------------------------------------

/** One composed lane: the workspace stack + a session + one bound surface. */
interface ComposedLane {
  readonly stack: WorkspaceStack;
  readonly session: WorkspaceSession;
  readonly http: { handle(request: HttpSurfaceRequest): Promise<HttpSurfaceResponse> };
  readonly mcp: {
    callTool(
      connection: PlatformConnection,
      request: McpToolCallRequest,
    ): Promise<McpToolCallOutcome>;
  };
}

/** Builds one composed lane over an identically-seeded workspace stack. */
async function composedLane(name: string): Promise<ComposedLane> {
  const stack = await buildWorkspaceStack(name);
  const session = stack.workspace.connect({ ...SIMULATED_PLATFORM });
  return {
    stack,
    session,
    http: createHttpSurface(stack.workspace.services, session.connection),
    mcp: createMcpToolSurface(stack.workspace.services),
  };
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
    ok(step: string, result: unknown): void {
      steps.push({ step, kind: "ok", envelope: result });
    },
    refused(step: string, error: TypedErrorRecord): void {
      steps.push({ step, kind: "refused", error });
    },
  };
}

/** The versioned envelope carried by a successful surface step. */
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

/** Runs a session stage, recording its SUCCESS in the journey record. */
async function sessionOk<T>(
  rec: ReturnType<typeof journeyRecorder>,
  step: string,
  fn: () => Promise<T>,
): Promise<T> {
  const result = await fn(); // a typed refusal fails the test honestly
  rec.ok(step, result);
  return result;
}

/**
 * Runs a session stage EXPECTING its typed refusal; records the neutral
 * typed error record (the same shape the surfaces serve).
 */
async function sessionRefused(
  rec: ReturnType<typeof journeyRecorder>,
  step: string,
  fn: () => Promise<unknown>,
): Promise<TypedErrorRecord> {
  try {
    await fn();
  } catch (error) {
    const typed = toTypedErrorRecord(error);
    rec.refused(step, typed);
    return typed;
  }
  throw new Error(`expected a typed refusal at journey step '${step}'`);
}

// ---------------------------------------------------------------------------
// The proof's fixture inputs (the simulated platform's submissions)
// ---------------------------------------------------------------------------

/** The feed items the external client submits (the durability precedent). */
function proofFeedItems(ids: readonly string[]): {
  metadata: SourceMetadata;
  bytes: Uint8Array;
  declaredBasis: RightsBasis;
}[] {
  return ids.map((id) => ({
    metadata: {
      provider: "platform-feed",
      providerContentId: id,
      canonicalUrl: `https://platform.example/feeds/${id}`,
      ownerRef: "platform:video-platform",
      observedAt: 1_700_000_000_000,
      availability: "publicly-listed" as const,
      restrictions: [],
      title: `Feed item ${id}`,
      description: "platform feed item",
    },
    bytes: fixtureBytes(id, 48),
    declaredBasis: {
      basisType: "authorized-feed" as const,
      grantRef: "agreement:platform-feed-77",
      scope: "acquisition for normalization and transformation",
      declaredBy: "platform:video-platform",
    },
  }));
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

// ---------------------------------------------------------------------------
// THE COMPOSED JOURNEY — one continuous client story per surface
// ---------------------------------------------------------------------------

/**
 * Runs the full composed journey on twin identically-seeded workspace
 * stacks: lane A drives the external-surface steps through HTTP, lane B
 * through MCP; BOTH lanes walk the SAME session composition. Returns both
 * journey records.
 */
async function runComposedJourney(
  runId: string,
): Promise<{ http: readonly JourneyStep[]; mcp: readonly JourneyStep[] }> {
  const laneA = await composedLane(`${runId}-http`);
  const laneB = await composedLane(`${runId}-mcp`);
  const recA = journeyRecorder();
  const recB = journeyRecorder();
  const topPick = laneA.stack.secondStrongOrganizationId;

  // -- DISCOVER: the eligible organizations through BOTH surfaces AND the
  //    composition's own catalog (three clients, one read model) ----------
  const httpSearch = await laneA.http.handle({
    method: "GET",
    path: "/v1/organizations",
    query: { domain: "football", task: "match", ordering: "quality-descending:fidelity" },
  });
  const mcpSearch = await laneB.mcp.callTool(laneB.session.connection, {
    tool: "search_organizations",
    input: {
      query: { domain: "football", task: "match" },
      ordering: { kind: "quality-descending", axis: "fidelity" },
    },
  });
  recA.http("discover: searchOrganizations", httpSearch);
  recB.mcp("discover: searchOrganizations", mcpSearch);

  // THE A5 VISIBILITY LAW at the composed boundary: >= 2 eligible
  // organizations, each with version, visible evidence and limits, ordered
  // only by the DECLARED ordering — no hidden ranking field.
  const search = envelopeOf<{ candidates: readonly CandidateView[]; orderedBy: string }>(
    httpSearch,
  ).result;
  expect(search.candidates.length).toBeGreaterThanOrEqual(2);
  const first = search.candidates[0];
  if (first === undefined) {
    throw new Error("fixture invariant broken: no discovered candidate");
  }
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
  for (const candidate of search.candidates) {
    expect(candidate.version).toBeGreaterThan(0);
    expect(["validated", "canary", "production"]).toContain(candidate.status);
    expect(candidate.evidence.benchmark).not.toBeNull();
    expect(candidate.evidence.benchmark?.metrics.length).toBeGreaterThan(0);
    expect(candidate.evidence.benchmark?.uncertainty.length).toBeGreaterThan(0);
    expect(candidate.evidence.robustness).not.toBeNull();
    expect(candidate.profile.latency.p95Ms).toBeGreaterThan(0);
    expect(candidate.profile.cost.perRunUsd).toBeGreaterThan(0);
  }
  // The declared ordering applied: beta-strong (fidelity 8.9) first; the
  // 8.4 tie between org-lying and org-strong breaks by organization id
  // (the choice model's own recorded law, never a hidden weight).
  expect(search.candidates.map((candidate) => candidate.organizationId)).toEqual([
    topPick,
    laneA.stack.lyingOrganizationId,
    laneA.stack.strongOrganizationId,
  ]);
  expect(search.orderedBy).toContain("quality descending");
  expect(search.orderedBy).toContain("fidelity");

  // The composition's OWN catalog serves the SAME candidates + statement.
  const catalogA = await sessionOk(recA, "discover: listOrganizations(session)", () =>
    laneA.session.listOrganizations({
      query: { domain: "football", task: "match" },
      ordering: { kind: "quality-descending", axis: "fidelity" },
    }),
  );
  const catalogB = await sessionOk(recB, "discover: listOrganizations(session)", () =>
    laneB.session.listOrganizations({
      query: { domain: "football", task: "match" },
      ordering: { kind: "quality-descending", axis: "fidelity" },
    }),
  );
  expect(search.candidates).toEqual(catalogA.candidates);
  expect(catalogA.orderedBy).toBe(search.orderedBy);
  expect(catalogB.candidates).toEqual(catalogA.candidates);

  // -- SUBMIT: a media job + a feed job through BOTH surfaces --------------
  const mediaBytes = fixtureBytes("proof-media", 96);
  const mediaInput = {
    bytes: mediaBytes,
    declaredBasis: platformUploadBasis(),
    metadata: uploadMetadata(),
    organizationId: topPick,
  };
  const httpMedia = await laneA.http.handle({
    method: "POST",
    path: "/v1/media",
    body: mediaInput,
  });
  const mcpMedia = await laneB.mcp.callTool(laneB.session.connection, {
    tool: "submit_video",
    input: mediaInput,
  });
  recA.http("submit: submitMedia", httpMedia);
  recB.mcp("submit: submitMedia", mcpMedia);
  expect(httpMedia.status).toBe(201);
  const media = envelopeOf<{ sourceId: string; sourceState: string; jobId: string }>(
    httpMedia,
  ).result;
  expect(media.sourceState).toBe("acquired");
  const mediaJobId = media.jobId;

  const feedItems = proofFeedItems(["proof-feed-1", "proof-feed-2"]);
  const feedInput = { items: feedItems, organization: { organizationId: topPick } };
  const httpFeed = await laneA.http.handle({ method: "POST", path: "/v1/feeds", body: feedInput });
  const mcpFeed = await laneB.mcp.callTool(laneB.session.connection, {
    tool: "submit_feed",
    input: feedInput,
  });
  recA.http("submit: submitFeed", httpFeed);
  recB.mcp("submit: submitFeed", mcpFeed);
  expect(httpFeed.status).toBe(201);
  const feed = envelopeOf<{
    jobId: string;
    itemCount: number;
    transformableItemCount: number;
    organizationId: string;
  }>(httpFeed).result;
  expect(feed.itemCount).toBe(2);
  expect(feed.transformableItemCount).toBe(2);
  expect(feed.organizationId).toBe(topPick);
  const feedJobId = feed.jobId;

  // -- STATUS: the queued media job through both surfaces ------------------
  const httpMediaStatus = await laneA.http.handle({
    method: "GET",
    path: `/v1/jobs/${mediaJobId}`,
  });
  const mcpMediaStatus = await laneB.mcp.callTool(laneB.session.connection, {
    tool: "get_job",
    input: { jobId: mediaJobId },
  });
  recA.http("status: getJob(media, queued)", httpMediaStatus);
  recB.mcp("status: getJob(media, queued)", mcpMediaStatus);
  expect(
    envelopeOf<{ job: { state: string; attempts: number } }>(httpMediaStatus).result.job,
  ).toMatchObject({ state: "queued", attempts: 0 });

  // -- THE A10 COMPOSITION JOURNEY (the session walks the transformation) --
  // upload -> auto-select -> process; the client then DROPS before running.
  const sessionBytes = fixtureBytes("proof-session", 96);
  const uploadA = await sessionOk(recA, "composition: uploadVideo", () =>
    laneA.session.uploadVideo({
      bytes: sessionBytes,
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
    }),
  );
  const uploadB = await sessionOk(recB, "composition: uploadVideo", () =>
    laneB.session.uploadVideo({
      bytes: sessionBytes,
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
    }),
  );
  // REAL DIGESTS: the corpus computed them; the test re-derives them.
  expect(uploadA.sourceState).toBe("acquired");
  expect(uploadA.acquiredChecksum).toBe(await sha256HexBytes(sessionBytes));
  expect(uploadA.acquiredChecksum).toHaveLength(64);
  expect(uploadB.acquiredChecksum).toBe(uploadA.acquiredChecksum);

  const selectionA = await sessionOk(recA, "composition: autoSelectOrganization", () =>
    laneA.session.autoSelectOrganization({ query: { domain: "football", task: "match" } }),
  );
  const selectionB = await sessionOk(recB, "composition: autoSelectOrganization", () =>
    laneB.session.autoSelectOrganization({ query: { domain: "football", task: "match" } }),
  );
  // The documented default ordering (quality-descending on fidelity) picks
  // the SAME top organization the external discovery saw — visibly.
  expect(selectionA.organizationId).toBe(topPick);
  expect(selectionA.mode).toBe("auto");
  expect(selectionA.orderedBy).toContain("quality descending");
  expect(selectionA.candidatesConsidered).toBe(3);
  expect(selectionB.orderedBy).toBe(selectionA.orderedBy);

  const processingA = await sessionOk(recA, "composition: processVideo", () =>
    laneA.session.processVideo({
      sourceId: uploadA.sourceId,
      organizationId: selectionA.organizationId,
    }),
  );
  const processingB = await sessionOk(recB, "composition: processVideo", () =>
    laneB.session.processVideo({
      sourceId: uploadB.sourceId,
      organizationId: selectionB.organizationId,
    }),
  );
  expect(processingA.kind).toBe("external.media-processing");
  expect(processingA.state).toBe("queued");
  expect(processingA.selection).toEqual({ mode: "auto", orderedBy: selectionA.orderedBy });
  const journeyJobId = processingA.jobId;
  // The twin lanes stage the journey identically (deterministic job ids).
  expect(processingB.jobId).toBe(journeyJobId);
  expect(processingB.state).toBe("queued");

  // -- RECONNECT: the client DROPS; a NEW session over the same canonical
  //    stores drives every job to completion from there --------------------
  const sessionA2 = laneA.stack.workspace.connect({ ...SIMULATED_PLATFORM });
  const sessionB2 = laneB.stack.workspace.connect({ ...SIMULATED_PLATFORM });
  const httpA2 = createHttpSurface(laneA.stack.workspace.services, sessionA2.connection);
  const mcpB2 = createMcpToolSurface(laneB.stack.workspace.services);

  // The reconnected session drives the EXTERNAL submissions AND its own
  // journey's job — one embedded runtime, one canonical job surface.
  const runMedia = await sessionOk(recA, "reconnect: runJob(media)", () =>
    sessionA2.runJob({ jobId: mediaJobId }),
  );
  await sessionOk(recB, "reconnect: runJob(media)", () => sessionB2.runJob({ jobId: mediaJobId }));
  expect(runMedia.job.state).toBe("completed");
  const runFeed = await sessionOk(recA, "reconnect: runJob(feed)", () =>
    sessionA2.runJob({ jobId: feedJobId }),
  );
  await sessionOk(recB, "reconnect: runJob(feed)", () => sessionB2.runJob({ jobId: feedJobId }));
  expect(runFeed.job.state).toBe("completed");
  expect(runFeed.job.checkpointCount).toBe(2); // per-item durable checkpoints
  const runJourney = await sessionOk(recA, "reconnect: runJob(journey)", () =>
    sessionA2.runJob({ jobId: journeyJobId }),
  );
  await sessionOk(recB, "reconnect: runJob(journey)", () =>
    sessionB2.runJob({ jobId: journeyJobId }),
  );
  expect(runJourney.job.state).toBe("completed");
  expect(runJourney.job.attempts).toBe(1);

  // -- RETRIEVE: the transformed video + evidence, through ALL clients -----
  // THE ONE-TRUTH SEAM: the session's output IS the HTTP surface's output
  // IS the MCP surface's output — the same job, the same artifact.
  const sessionOutputA = await sessionOk(recA, "retrieve: output(session)", () =>
    sessionA2.output({ jobId: journeyJobId }),
  );
  const sessionOutputB = await sessionOk(recB, "retrieve: output(session)", () =>
    sessionB2.output({ jobId: journeyJobId }),
  );
  const httpJourneyOutput = await httpA2.handle({
    method: "GET",
    path: `/v1/jobs/${journeyJobId}/output`,
  });
  const mcpJourneyOutput = await mcpB2.callTool(sessionB2.connection, {
    tool: "get_output",
    input: { jobId: journeyJobId },
  });
  recA.http("retrieve: getOutput(journey)", httpJourneyOutput);
  recB.mcp("retrieve: getOutput(journey)", mcpJourneyOutput);
  expect(envelopeOf<GetOutputResult>(httpJourneyOutput).result).toEqual(sessionOutputA);
  expect(envelopeOfMcp<GetOutputResult>(mcpJourneyOutput).result).toEqual(sessionOutputB);

  // DIGESTS, verified against the authorities end-to-end:
  expect(sessionOutputA.artifact.kind).toBe("transformed-media");
  expect(sessionOutputA.artifact.organizationId).toBe(topPick);
  expect(sessionOutputA.artifact.checksum).toBe(await sha256HexBytes(sessionOutputA.bytes));
  expect(sessionOutputA.artifact.artifactRef).toBe(
    `artifact://${sessionOutputA.artifact.checksum}`,
  );
  expect(sessionOutputA.artifact.byteLength).toBe(sessionOutputA.bytes.byteLength);
  expect(sessionOutputA.artifact.items).toHaveLength(1);
  expect(sessionOutputA.artifact.items[0]?.sourceId).toBe(uploadA.sourceId);
  // The honest v0 transform: the deterministic header + the normalized bytes.
  const header = new TextEncoder().encode(`SPORTA-TRANSFORM/${topPick}/${uploadA.sourceId}\n`);
  expect(sessionOutputA.bytes.byteLength).toBe(header.byteLength + sessionBytes.byteLength);
  expect(sessionOutputA.bytes.slice(0, header.byteLength)).toEqual(header);
  expect(sessionOutputA.bytes.slice(header.byteLength)).toEqual(sessionBytes);

  const sessionEvidenceA = await sessionOk(recA, "retrieve: evidence(session)", () =>
    sessionA2.evidence({ jobId: journeyJobId }),
  );
  const sessionEvidenceB = await sessionOk(recB, "retrieve: evidence(session)", () =>
    sessionB2.evidence({ jobId: journeyJobId }),
  );
  const httpJourneyEvidence = await httpA2.handle({
    method: "GET",
    path: `/v1/jobs/${journeyJobId}/evidence`,
  });
  const mcpJourneyEvidence = await mcpB2.callTool(sessionB2.connection, {
    tool: "get_evidence",
    input: { jobId: journeyJobId },
  });
  recA.http("retrieve: getEvidence(journey)", httpJourneyEvidence);
  recB.mcp("retrieve: getEvidence(journey)", mcpJourneyEvidence);
  expect(envelopeOf<GetEvidenceResult>(httpJourneyEvidence).result).toEqual(sessionEvidenceA);
  expect(envelopeOfMcp<GetEvidenceResult>(mcpJourneyEvidence).result).toEqual(sessionEvidenceB);
  // The evidence bundle: lineage + the DECLARED-quality verdict.
  expect(sessionEvidenceA.evidence.sourceLineage).toHaveLength(1);
  expect(sessionEvidenceA.evidence.sourceLineage[0]).toMatchObject({
    sourceId: uploadA.sourceId,
    outcome: "transformed",
    acquiredChecksum: uploadA.acquiredChecksum,
    normalizedChecksum: uploadA.acquiredChecksum,
  });
  expect(sessionEvidenceA.evidence.qualityGate.gateId).toBe(DECLARED_QUALITY_GATE_ID);
  expect(sessionEvidenceA.evidence.qualityGate.passed).toBe(true);

  // THE FULL A10 EVIDENCE CHAIN (the session's own composition read): the
  // job, the upload provenance + digests, the selection record, the
  // organization record version, the output digests, the evidence bundle.
  const chain = await sessionOk(recA, "retrieve: evidenceChain(session)", () =>
    sessionA2.evidenceChain({ jobId: journeyJobId }),
  );
  await sessionOk(recB, "retrieve: evidenceChain(session)", () =>
    sessionB2.evidenceChain({ jobId: journeyJobId }),
  );
  expect(chain.scope).toEqual({
    platformId: SIMULATED_PLATFORM.platformId,
    tenantId: SIMULATED_PLATFORM.tenantId,
  });
  expect(chain.job.state).toBe("completed");
  expect(chain.job.kind).toBe("external.media-processing");
  expect(chain.job.outputArtifactRefs).toEqual([`artifact://${sessionOutputA.artifact.checksum}`]);
  // The upload leg: the corpus's own digests + provenance.
  expect(chain.upload.sourceId).toBe(uploadA.sourceId);
  expect(chain.upload.acquiredChecksum).toBe(uploadA.acquiredChecksum);
  expect(chain.upload.normalizedChecksum).toBe(uploadA.acquiredChecksum);
  expect(chain.upload.metadataDigest).toBe(uploadA.metadataDigest);
  expect(chain.upload.provider).toBe("user-upload");
  expect(chain.upload.rightsBasis?.grantRef).toBe("declaration:platform-upload-42");
  // The selection leg: the documented ordering, recorded verbatim.
  expect(chain.selection).toEqual({
    organizationId: topPick,
    mode: "auto",
    orderedBy: selectionA.orderedBy,
  });
  // The organization leg: the registry's record version + declared quality.
  expect(chain.organization.organizationId).toBe(topPick);
  expect(chain.organization.status).toBe("validated");
  expect(chain.organization.version).toBeGreaterThan(0);
  expect(chain.organization.declaredQuality).toEqual([
    { axis: "fidelity", value: 8.9, ciLow: 8.5, ciHigh: 9.2 },
    { axis: "stylization", value: 7.8, ciLow: 7.4, ciHigh: 8.1 },
    { axis: "temporal", value: 7.6, ciLow: 7.1, ciHigh: 8.0 },
  ]);
  // The output leg: the digests again, one record.
  expect(chain.output.checksum).toBe(sessionOutputA.artifact.checksum);
  expect(chain.output.artifactRef).toBe(sessionOutputA.artifact.artifactRef);
  expect(chain.output.byteLength).toBe(sessionOutputA.artifact.byteLength);
  expect(chain.output.items).toEqual(sessionOutputA.artifact.items.map((item) => ({ ...item })));
  // The evidence leg: the bundle the surfaces serve.
  expect(chain.evidence).toEqual(sessionEvidenceA.evidence);
  expect(chain.evidence.qualityGate.checks.map((check) => check.name)).toEqual([
    "output-non-empty",
    "lineage-complete",
    "no-data-loss",
    "declared-quality-present",
    "declared-quality-consistent",
    "declared-quality-floor",
  ]);

  // -- RETRIEVE the EXTERNAL submissions' artifacts through all clients ----
  // The feed job the external client submitted: executed by the
  // composition's runtime, retrieved identically everywhere.
  const httpFeedOutput = await httpA2.handle({
    method: "GET",
    path: `/v1/jobs/${feedJobId}/output`,
  });
  const mcpFeedOutput = await mcpB2.callTool(sessionB2.connection, {
    tool: "get_output",
    input: { jobId: feedJobId },
  });
  recA.http("retrieve: getOutput(feed)", httpFeedOutput);
  recB.mcp("retrieve: getOutput(feed)", mcpFeedOutput);
  const feedOutput = envelopeOf<{
    artifact: {
      kind: string;
      organizationId: string | null;
      items: readonly unknown[];
      checksum: string;
    };
    bytes: Uint8Array;
  }>(httpFeedOutput).result;
  expect(feedOutput.artifact.kind).toBe("feed-output");
  expect(feedOutput.artifact.organizationId).toBe(topPick);
  expect(feedOutput.artifact.items).toHaveLength(2);
  expect(feedOutput.artifact.checksum).toBe(await sha256HexBytes(feedOutput.bytes));
  const sessionFeedOutput = await sessionOk(recA, "retrieve: output(feed, session)", () =>
    sessionA2.output({ jobId: feedJobId }),
  );
  await sessionOk(recB, "retrieve: output(feed, session)", () =>
    sessionB2.output({ jobId: feedJobId }),
  );
  expect(feedOutput).toEqual(sessionFeedOutput);

  const httpFeedEvidence = await httpA2.handle({
    method: "GET",
    path: `/v1/jobs/${feedJobId}/evidence`,
  });
  const mcpFeedEvidence = await mcpB2.callTool(sessionB2.connection, {
    tool: "get_evidence",
    input: { jobId: feedJobId },
  });
  recA.http("retrieve: getEvidence(feed)", httpFeedEvidence);
  recB.mcp("retrieve: getEvidence(feed)", mcpFeedEvidence);
  const feedEvidence = envelopeOf<{
    evidence: {
      sourceLineage: { outcome: string; acquiredChecksum: string | null }[];
      qualityGate: { gateId: string; passed: boolean };
    };
  }>(httpFeedEvidence).result.evidence;
  expect(feedEvidence.sourceLineage).toHaveLength(2);
  for (const item of feedEvidence.sourceLineage) {
    expect(item.outcome).toBe("transformed");
    expect(item.acquiredChecksum).not.toBeNull();
  }
  expect(feedEvidence.qualityGate.gateId).toBe(DECLARED_QUALITY_GATE_ID);
  expect(feedEvidence.qualityGate.passed).toBe(true);
  await sessionOk(recA, "retrieve: evidence(feed, session)", () =>
    sessionA2.evidence({ jobId: feedJobId }),
  );
  await sessionOk(recB, "retrieve: evidence(feed, session)", () =>
    sessionB2.evidence({ jobId: feedJobId }),
  );

  // The chain composes ONLY the journeys the session itself staged — the
  // external submission's job serves its evidence through the surfaces,
  // and the CHAIN refuses it typed (the staging discipline, honestly).
  const chainRefusalA = await sessionRefused(recA, "retrieve: evidenceChain(feed, session)", () =>
    sessionA2.evidenceChain({ jobId: feedJobId }),
  );
  const chainRefusalB = await sessionRefused(recB, "retrieve: evidenceChain(feed, session)", () =>
    sessionB2.evidenceChain({ jobId: feedJobId }),
  );
  expect(chainRefusalA).toMatchObject({ code: "workspace.not-found", failureClass: "not-found" });
  expect(chainRefusalB.code).toBe(chainRefusalA.code);

  // The media job the external client submitted, retrieved through both
  // surfaces — the artifact identical to what the surfaces promised.
  const httpMediaOutput = await httpA2.handle({
    method: "GET",
    path: `/v1/jobs/${mediaJobId}/output`,
  });
  const mcpMediaOutput = await mcpB2.callTool(sessionB2.connection, {
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
  expect(mediaOutput.artifact.items[0]?.sourceId).toBe(media.sourceId);
  expect(mediaOutput.artifact.checksum).toBe(await sha256HexBytes(mediaOutput.bytes));

  // The harness progress projection over the composed stack (the REL-013
  // view a reconnecting harness thread renders), identical on both surfaces.
  const httpProgress = await httpA2.handle({
    method: "GET",
    path: `/v1/jobs/${feedJobId}/progress`,
  });
  const mcpProgress = await mcpB2.callTool(sessionB2.connection, {
    tool: "get_job_progress",
    input: { jobId: feedJobId },
  });
  recA.http("retrieve: getJobProgress(feed)", httpProgress);
  recB.mcp("retrieve: getJobProgress(feed)", mcpProgress);
  expect(
    envelopeOf<{ progress: { timeline: { seq: number }[]; state: string; resumable: boolean } }>(
      httpProgress,
    ).result.progress,
  ).toMatchObject({ timeline: [{ seq: 1 }, { seq: 2 }], state: "completed", resumable: false });

  // -- CANCEL over the composed stack: a queued job dies immediately, and
  //    NO authoritative output exists for it on ANY client ---------------
  const cancelBytes = fixtureBytes("proof-cancel", 64);
  const cancelInput = {
    bytes: cancelBytes,
    declaredBasis: platformUploadBasis(),
    metadata: uploadMetadata(),
    organizationId: topPick,
  };
  const httpCancelSubmit = await httpA2.handle({
    method: "POST",
    path: "/v1/media",
    body: cancelInput,
  });
  const mcpCancelSubmit = await mcpB2.callTool(sessionB2.connection, {
    tool: "submit_video",
    input: cancelInput,
  });
  recA.http("cancel: submitMedia", httpCancelSubmit);
  recB.mcp("cancel: submitMedia", mcpCancelSubmit);
  const cancelJobId = envelopeOf<{ jobId: string }>(httpCancelSubmit).result.jobId;

  const httpCancel = await httpA2.handle({
    method: "POST",
    path: `/v1/jobs/${cancelJobId}/cancellation`,
  });
  const mcpCancel = await mcpB2.callTool(sessionB2.connection, {
    tool: "cancel_job",
    input: { jobId: cancelJobId },
  });
  recA.http("cancel: cancelJob", httpCancel);
  recB.mcp("cancel: cancelJob", mcpCancel);
  // The typed cancellation record: a queued job dies immediately.
  expect(
    envelopeOf<{
      jobId: string;
      state: string;
      cancellationRequested: boolean;
      cancelled: boolean;
    }>(httpCancel).result,
  ).toEqual({
    jobId: cancelJobId,
    state: "cancelled",
    cancellationRequested: false,
    cancelled: true,
  });
  expect(
    envelopeOfMcp<{
      jobId: string;
      state: string;
      cancellationRequested: boolean;
      cancelled: boolean;
    }>(mcpCancel).result,
  ).toEqual(
    envelopeOf<{
      jobId: string;
      state: string;
      cancellationRequested: boolean;
      cancelled: boolean;
    }>(httpCancel).result,
  );

  // NO PARTIAL AUTHORITATIVE OUTPUT: every client refuses typed, identically.
  const httpCancelledOutput = await httpA2.handle({
    method: "GET",
    path: `/v1/jobs/${cancelJobId}/output`,
  });
  const mcpCancelledOutput = await mcpB2.callTool(sessionB2.connection, {
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
  const sessionCancelledOutput = await sessionRefused(recA, "cancel: output(session)", () =>
    sessionA2.output({ jobId: cancelJobId }),
  );
  await sessionRefused(recB, "cancel: output(session)", () =>
    sessionB2.output({ jobId: cancelJobId }),
  );
  expect(sessionCancelledOutput).toEqual(errorOf(httpCancelledOutput));

  return { http: recA.steps, mcp: recB.steps };
}

// ---------------------------------------------------------------------------
// The proof
// ---------------------------------------------------------------------------

describe("REL-035: the platform-workspace transformation proof (Gate REL-A10, composition grade)", () => {
  test("the composed transformation journey — upload, auto-select, process, reconnect, retrieve — resolves IDENTICALLY through HTTP, MCP and the workspace session, the artifacts flowing through the composition with digests + provenance verified end-to-end", async () => {
    const run = await runComposedJourney("run-1");
    // JOURNEY-GRADE PARITY over the composed stack: every step's
    // application semantics — envelopes AND typed refusals — identical.
    expect(run.http).toEqual(run.mcp);
  }, 180_000);

  test("determinism: the same seed reproduces deep-equal composed journey records on BOTH surfaces", async () => {
    const runA = await runComposedJourney("run-2");
    const runB = await runComposedJourney("run-3");
    expect(runA.http).toEqual(runB.http);
    expect(runA.mcp).toEqual(runB.mcp);
    expect(runA.http).toEqual(runA.mcp);
  }, 180_000);
});
