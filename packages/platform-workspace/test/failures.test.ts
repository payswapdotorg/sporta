/**
 * REL-024 — the typed failure paths for EVERY stage boundary of the
 * platform processing journey. Each boundary's refusal comes from the
 * AUTHORITY that owns it (the composition never swallows or re-wraps):
 *
 * - upload boundary: the corpus's typed `corpus.rights-basis-required`
 *   (no declared basis), the corpus's typed conflict (identical bytes,
 *   different declared metadata), the workspace's typed validation;
 * - selection boundary: the platform's typed not-found (unknown org) and
 *   organization-policy refusal (draft is not selectable), the workspace's
 *   typed no-eligible-organization refusal;
 * - processing boundary: the workspace's typed staging refusal (a source
 *   never uploaded through this scope — including a CROSS-TENANT source),
 *   the registry's typed not-found, the platform's typed policy refusal,
 *   and the executor's fail-closed typed job failure (a reference-only
 *   source can never be transformed);
 * - quality-gate boundary: the declared-quality gate's typed refusals
 *   (declared-quality-consistent on a lying interval; declared-quality-
 *   floor below the declared floor) — the JOB FAILS, nothing is published,
 *   and the retrieval boundary refuses typed;
 * - retrieval boundary: the platform's typed job-state refusals (before
 *   completion, after failure), the typed tenant-isolation not-found (a
 *   foreign job is indistinguishable from an unknown one), the workspace's
 *   typed unknown-journey refusal, and the runtime's typed refusal when
 *   driving a terminal job.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { isJobsError } from "@sporta/durable-jobs";
import { isCorpusError } from "@sporta/historical-corpus";
import { isPlatformError } from "@sporta/external-platform";
import { isRegistryError } from "@sporta/organization-registry";
import { WorkspaceNotFoundError } from "../src";
import {
  WorkspaceOrganizationSelectionError,
  WorkspaceValidationError,
  isWorkspaceError,
} from "../src";
import {
  buildQualityFloorStack,
  buildWorkspaceStack,
  cleanupScratch,
  fixtureBytes,
  OTHER_PLATFORM,
  platformUploadBasis,
  SIMULATED_PLATFORM,
  uploadMetadata,
} from "./fixtures";

afterAll(() => {
  cleanupScratch();
});

describe("the upload boundary (the corpus is the authority)", () => {
  test("no declared basis -> the corpus's typed rights-basis refusal propagates through the composition", async () => {
    const stack = await buildWorkspaceStack("fail-upload-basis");
    const session = stack.workspace.connect({ ...SIMULATED_PLATFORM });
    // The service surface accepts bytes+metadata without a basis; the CORPUS
    // refuses — the typed error propagates unchanged (never swallowed).
    try {
      await stack.workspace.services.submitMedia(session.connection, {
        bytes: fixtureBytes("no-basis-clip", 32),
        metadata: uploadMetadata(),
      });
      throw new Error("expected the corpus's typed rights-basis refusal");
    } catch (error) {
      expect(isCorpusError(error)).toBe(true);
      expect((error as { code?: string }).code).toBe("corpus.rights-basis-required");
      expect((error as Error).message).toContain("not proof of transformation rights");
    }
  });

  test("malformed workspace upload request -> typed workspace validation refusal with issues", async () => {
    const stack = await buildWorkspaceStack("fail-upload-shape");
    const session = stack.workspace.connect({ ...SIMULATED_PLATFORM });
    try {
      await session.uploadVideo({
        declaredBasis: platformUploadBasis(),
        metadata: uploadMetadata(),
        // bytes missing
      });
      throw new Error("expected a typed workspace validation refusal");
    } catch (error) {
      expect(isWorkspaceError(error)).toBe(true);
      expect(error).toBeInstanceOf(WorkspaceValidationError);
      expect((error as { details: { issues: unknown[] } }).details.issues.length).toBeGreaterThan(
        0,
      );
    }
  });

  test("identical bytes with different declared metadata -> the corpus's typed conflict", async () => {
    const stack = await buildWorkspaceStack("fail-upload-conflict");
    const session = stack.workspace.connect({ ...SIMULATED_PLATFORM });
    const bytes = fixtureBytes("conflict-clip", 40);
    await session.uploadVideo({
      bytes,
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
    });
    try {
      await session.uploadVideo({
        bytes,
        declaredBasis: platformUploadBasis(),
        metadata: uploadMetadata({ title: "A different declaration" }),
      });
      throw new Error("expected the corpus's typed conflict");
    } catch (error) {
      expect(isCorpusError(error)).toBe(true);
      expect((error as { code?: string }).code).toBe("corpus.conflict");
    }
  });
});

describe("the selection boundary (the choice model + registry are the authorities)", () => {
  test("choosing a DRAFT organization -> the platform's typed organization-policy refusal", async () => {
    const stack = await buildWorkspaceStack("fail-select-draft");
    const session = stack.workspace.connect({ ...SIMULATED_PLATFORM });
    try {
      await session.chooseOrganization({ organizationId: stack.draftOrganizationId });
      throw new Error("expected the platform's typed organization-policy refusal");
    } catch (error) {
      expect(isPlatformError(error)).toBe(true);
      expect((error as { failureClass?: string }).failureClass).toBe("policy");
      expect((error as Error).message).toContain("draft");
    }
  });

  test("choosing an UNKNOWN organization -> the registry's typed not-found propagates", async () => {
    const stack = await buildWorkspaceStack("fail-select-unknown");
    const session = stack.workspace.connect({ ...SIMULATED_PLATFORM });
    try {
      await session.chooseOrganization({ organizationId: "org-nope" });
      throw new Error("expected the registry's typed not-found");
    } catch (error) {
      // The service's inspect rides the registry directly — the registry's
      // own typed family propagates unchanged through the composition.
      expect(isRegistryError(error)).toBe(true);
      expect((error as { failureClass?: string }).failureClass).toBe("not-found");
    }
  });

  test("auto-selecting with an empty eligible set -> the workspace's typed no-organization refusal", async () => {
    const stack = await buildWorkspaceStack("fail-select-empty");
    const session = stack.workspace.connect({ ...SIMULATED_PLATFORM });
    try {
      await session.autoSelectOrganization({ query: { domain: "basketball" } });
      throw new Error("expected the workspace's typed organization-selection refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceOrganizationSelectionError);
      expect(isWorkspaceError(error)).toBe(true);
      const selection = error as WorkspaceOrganizationSelectionError;
      expect(selection.details.orderedBy).toContain("quality descending");
      expect(selection.message).toContain("no eligible organization");
    }
  });

  test("auto-selecting with a hidden-ranking-shaped ordering -> typed validation refusal", async () => {
    const stack = await buildWorkspaceStack("fail-select-shape");
    const session = stack.workspace.connect({ ...SIMULATED_PLATFORM });
    try {
      await session.autoSelectOrganization({
        query: { domain: "football" },
        ordering: { kind: "secret-score" } as never,
      });
      throw new Error("expected a typed validation refusal");
    } catch (error) {
      expect(isWorkspaceError(error)).toBe(true);
    }
  });
});

describe("the processing boundary (the staging discipline + the authorities)", () => {
  test("processing a source never uploaded -> the workspace's typed staging refusal", async () => {
    const stack = await buildWorkspaceStack("fail-process-unknown-source");
    const session = stack.workspace.connect({ ...SIMULATED_PLATFORM });
    try {
      await session.processVideo({
        sourceId: "source-999",
        organizationId: stack.strongOrganizationId,
      });
      throw new Error("expected the workspace's typed staging refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceNotFoundError);
      expect((error as Error).message).toContain("no upload of source");
    }
  });

  test("processing ANOTHER tenant's uploaded source -> typed not-found (existence not leaked)", async () => {
    const stack = await buildWorkspaceStack("fail-process-cross-tenant");
    const sessionA = stack.workspace.connect({ ...SIMULATED_PLATFORM });
    const sessionB = stack.workspace.connect({ ...OTHER_PLATFORM });
    const upload = await sessionA.uploadVideo({
      bytes: fixtureBytes("tenant-a-clip", 40),
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
    });
    try {
      await sessionB.processVideo({
        sourceId: upload.sourceId,
        organizationId: stack.strongOrganizationId,
      });
      throw new Error("expected the workspace's typed cross-tenant staging refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceNotFoundError);
      // Identical shape to the unknown-source refusal: no existence leak.
      expect((error as { details: Record<string, unknown> }).details).toEqual({
        sourceId: upload.sourceId,
      });
    }
  });

  test("processing with a DRAFT organization -> the platform's typed policy refusal", async () => {
    const stack = await buildWorkspaceStack("fail-process-draft");
    const session = stack.workspace.connect({ ...SIMULATED_PLATFORM });
    const upload = await session.uploadVideo({
      bytes: fixtureBytes("draft-org-clip", 40),
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
    });
    try {
      await session.processVideo({
        sourceId: upload.sourceId,
        organizationId: stack.draftOrganizationId,
      });
      throw new Error("expected the platform's typed policy refusal");
    } catch (error) {
      expect(isPlatformError(error)).toBe(true);
      expect((error as Error).message).toContain("draft");
    }
  });

  test("processing with an UNKNOWN organization -> the registry's typed not-found propagates", async () => {
    const stack = await buildWorkspaceStack("fail-process-unknown-org");
    const session = stack.workspace.connect({ ...SIMULATED_PLATFORM });
    const upload = await session.uploadVideo({
      bytes: fixtureBytes("unknown-org-clip", 40),
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
    });
    try {
      await session.processVideo({
        sourceId: upload.sourceId,
        organizationId: "org-nope",
      });
      throw new Error("expected the registry's typed not-found");
    } catch (error) {
      expect(isRegistryError(error)).toBe(true);
      expect((error as { failureClass?: string }).failureClass).toBe("not-found");
    }
  });

  test("a REFERENCE-ONLY source fails the job closed (a URL is not transformation rights)", async () => {
    const stack = await buildWorkspaceStack("fail-process-reference");
    const session = stack.workspace.connect({ ...SIMULATED_PLATFORM });
    // The reference path: metadata only, never bytes — registered through
    // the service's own reference branch (the corpus authority).
    const reference = await stack.workspace.services.submitMedia(session.connection, {
      reference: {
        provider: "platform-feed",
        providerContentId: "ref-1",
        canonicalUrl: "https://platform.example/clips/ref-1",
        ownerRef: "platform:video-platform",
        observedAt: 1_700_000_000_000,
        availability: "publicly-listed",
        restrictions: [],
        title: "A reference-only clip",
        description: "metadata only — never acquired",
      },
    });
    expect(reference.result.sourceState).toBe("referenced");
    // The workspace's staging ledger does not carry the reference (it was
    // not uploaded through uploadVideo) — the typed staging refusal fires.
    try {
      await session.processVideo({
        sourceId: reference.result.sourceId,
        organizationId: stack.strongOrganizationId,
      });
      throw new Error("expected the workspace's typed staging refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceNotFoundError);
    }
    // And even a reference source enqueued DIRECTLY on the shared durable
    // store (the executor's own input shape) fails closed: the corpus state
    // machine is the authority, the job FAILS, nothing is published.
    const job = await stack.jobs.enqueue({
      kind: "external.media-processing",
      input: {
        scope: {
          platformId: SIMULATED_PLATFORM.platformId,
          tenantId: SIMULATED_PLATFORM.tenantId,
        },
        sourceId: reference.result.sourceId,
        organizationId: stack.strongOrganizationId,
      },
    });
    const driven = await stack.workspace.runtime.runAttempt(job.jobId);
    expect(driven.state).toBe("failed");
    expect(driven.failure?.message).toContain("transformation requires acquired+normalized bytes");
    await expect(session.output({ jobId: job.jobId })).rejects.toMatchObject({
      failureClass: "job-state",
    });
  });
});

describe("the quality-gate boundary (the declared policy refuses typed)", () => {
  test("a self-inconsistent declared interval fails the job and the retrieval refuses typed", async () => {
    const stack = await buildWorkspaceStack("fail-gate-lying");
    const session = stack.workspace.connect({ ...SIMULATED_PLATFORM });
    const upload = await session.uploadVideo({
      bytes: fixtureBytes("lying-org-clip", 40),
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
    });
    const selection = await session.chooseOrganization({
      organizationId: stack.lyingOrganizationId,
    });
    expect(selection.organization.status).toBe("validated"); // legally selectable
    const processing = await session.processVideo({
      sourceId: upload.sourceId,
      organizationId: stack.lyingOrganizationId,
    });
    const driven = await session.runJob({ jobId: processing.jobId });
    expect(driven.job.state).toBe("failed");
    // The failure NAMES the failed check (typed refusal, never silent).
    const record = await stack.jobs.get(processing.jobId);
    expect(record.failure?.message).toContain("declared-quality-consistent");
    expect(record.failure?.message).toContain("organization-declared-quality/v1");
    // Nothing is published: output AND evidence refuse typed; the chain too.
    await expect(session.output({ jobId: processing.jobId })).rejects.toMatchObject({
      failureClass: "job-state",
    });
    await expect(session.evidence({ jobId: processing.jobId })).rejects.toMatchObject({
      failureClass: "job-state",
    });
    await expect(session.evidenceChain({ jobId: processing.jobId })).rejects.toMatchObject({
      failureClass: "job-state",
    });
  });

  test("a declared floor the organization does not clear fails the job (the floor stack)", async () => {
    const stack = await buildQualityFloorStack("fail-gate-floor");
    const session = stack.workspace.connect({ ...SIMULATED_PLATFORM });
    const upload = await session.uploadVideo({
      bytes: fixtureBytes("lowbound-clip", 40),
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
    });
    const processing = await session.processVideo({
      sourceId: upload.sourceId,
      organizationId: stack.lowBoundOrganizationId,
    });
    await session.runJob({ jobId: processing.jobId });
    const record = await stack.jobs.get(processing.jobId);
    expect(record.state).toBe("failed");
    expect(record.failure?.message).toContain("declared-quality-floor");
    // The control: the premium org's journey on the SAME floor stack passes.
    const uploadPremium = await session.uploadVideo({
      bytes: fixtureBytes("premium-clip", 40),
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
    });
    const processingPremium = await session.processVideo({
      sourceId: uploadPremium.sourceId,
      organizationId: stack.premiumOrganizationId,
    });
    const driven = await session.runJob({ jobId: processingPremium.jobId });
    expect(driven.job.state).toBe("completed");
    const chain = await session.evidenceChain({ jobId: processingPremium.jobId });
    expect(chain.evidence.qualityGate.passed).toBe(true);
    const floorCheck = chain.evidence.qualityGate.checks.find(
      (check) => check.name === "declared-quality-floor",
    );
    expect(floorCheck?.passed).toBe(true);
  });
});

describe("the retrieval boundary (fail-closed until completion; isolation)", () => {
  test("output/evidence/chain before completion -> the platform's typed job-state refusals", async () => {
    const stack = await buildWorkspaceStack("fail-retrieve-early");
    const session = stack.workspace.connect({ ...SIMULATED_PLATFORM });
    const upload = await session.uploadVideo({
      bytes: fixtureBytes("early-clip", 40),
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
    });
    const processing = await session.processVideo({
      sourceId: upload.sourceId,
      organizationId: stack.strongOrganizationId,
    });
    // The job is still queued — nothing is published yet.
    await expect(session.output({ jobId: processing.jobId })).rejects.toMatchObject({
      failureClass: "job-state",
      code: "platform.job-state",
    });
    await expect(session.evidence({ jobId: processing.jobId })).rejects.toMatchObject({
      failureClass: "job-state",
    });
    await expect(session.evidenceChain({ jobId: processing.jobId })).rejects.toMatchObject({
      failureClass: "job-state",
    });
    expect((processing.state as string) ?? "queued").toBe("queued");
  });

  test("an unknown journey -> the workspace's typed not-found", async () => {
    const stack = await buildWorkspaceStack("fail-retrieve-unknown");
    const session = stack.workspace.connect({ ...SIMULATED_PLATFORM });
    try {
      await session.evidenceChain({ jobId: "job-nope" });
      throw new Error("expected the workspace's typed unknown-journey refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceNotFoundError);
      expect((error as Error).message).toContain("no journey with job id");
    }
  });

  test("a foreign platform/tenant sees NOTHING: job, output, evidence and chain all refuse identically", async () => {
    const stack = await buildWorkspaceStack("fail-retrieve-foreign");
    const sessionA = stack.workspace.connect({ ...SIMULATED_PLATFORM });
    const sessionB = stack.workspace.connect({ ...OTHER_PLATFORM });
    const upload = await sessionA.uploadVideo({
      bytes: fixtureBytes("foreign-clip", 40),
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
    });
    const processing = await sessionA.processVideo({
      sourceId: upload.sourceId,
      organizationId: stack.strongOrganizationId,
    });
    await sessionA.runJob({ jobId: processing.jobId });
    // The foreign session's reads are typed not-founds (existence not
    // leaked) — job, output, evidence through the services; the chain
    // through the workspace ledger.
    await expect(sessionB.job({ jobId: processing.jobId })).rejects.toMatchObject({
      failureClass: "not-found",
      code: "platform.not-found",
    });
    await expect(sessionB.output({ jobId: processing.jobId })).rejects.toMatchObject({
      failureClass: "not-found",
    });
    await expect(sessionB.evidence({ jobId: processing.jobId })).rejects.toMatchObject({
      failureClass: "not-found",
    });
    try {
      await sessionB.evidenceChain({ jobId: processing.jobId });
      throw new Error("expected the workspace's typed foreign-journey refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceNotFoundError);
    }
    // And the foreign session cannot DRIVE tenant A's job either (a
    // cross-tenant write attempt is a typed not-found, never a run).
    await expect(sessionB.runJob({ jobId: processing.jobId })).rejects.toMatchObject({
      failureClass: "not-found",
    });
  });

  test("the foreign session's OWN journey still works (isolation never degrades capability)", async () => {
    const stack = await buildWorkspaceStack("fail-retrieve-foreign-own");
    const sessionA = stack.workspace.connect({ ...SIMULATED_PLATFORM });
    const sessionB = stack.workspace.connect({ ...OTHER_PLATFORM });
    // Tenant A drives a full journey first.
    const uploadA = await sessionA.uploadVideo({
      bytes: fixtureBytes("foreign-own-a", 40),
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
    });
    const processingA = await sessionA.processVideo({
      sourceId: uploadA.sourceId,
      organizationId: stack.strongOrganizationId,
    });
    await sessionA.runJob({ jobId: processingA.jobId });
    // Tenant B's own journey: upload -> explicit select -> process ->
    // retrieve, unaffected by A's presence.
    const uploadB = await sessionB.uploadVideo({
      bytes: fixtureBytes("foreign-own-b", 44),
      declaredBasis: platformUploadBasis({
        grantRef: "declaration:platform-upload-b-1",
        declaredBy: "platform:other-platform",
      }),
      metadata: uploadMetadata({ ownerRef: "platform:other-platform" }),
    });
    const selectionB = await sessionB.chooseOrganization({
      organizationId: stack.strongOrganizationId,
    });
    expect(selectionB.organization.organizationId).toBe(stack.strongOrganizationId);
    const processingB = await sessionB.processVideo({
      sourceId: uploadB.sourceId,
      organizationId: stack.strongOrganizationId,
    });
    const drivenB = await sessionB.runJob({ jobId: processingB.jobId });
    expect(drivenB.job.state).toBe("completed");
    const chainB = await sessionB.evidenceChain({ jobId: processingB.jobId });
    expect(chainB.scope).toEqual({
      platformId: OTHER_PLATFORM.platformId,
      tenantId: OTHER_PLATFORM.tenantId,
    });
    expect(chainB.upload.sourceId).toBe(uploadB.sourceId);
    // A's chain is still A's (scopes never crossed).
    const chainA = await sessionA.evidenceChain({ jobId: processingA.jobId });
    expect(chainA.scope.platformId).toBe(SIMULATED_PLATFORM.platformId);
    expect(chainA.upload.sourceId).toBe(uploadA.sourceId);
  });

  test("driving a TERMINAL job refuses typed (the durable store's own law)", async () => {
    const stack = await buildWorkspaceStack("fail-drive-terminal");
    const session = stack.workspace.connect({ ...SIMULATED_PLATFORM });
    const upload = await session.uploadVideo({
      bytes: fixtureBytes("terminal-clip", 40),
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
    });
    const processing = await session.processVideo({
      sourceId: upload.sourceId,
      organizationId: stack.strongOrganizationId,
    });
    await session.runJob({ jobId: processing.jobId });
    // The completed job cannot be driven again — the typed jobs family.
    try {
      await session.runJob({ jobId: processing.jobId });
      throw new Error("expected the store's typed refusal for a terminal job");
    } catch (error) {
      expect(isJobsError(error)).toBe(true);
    }
  });
});
