/**
 * REL-014 service tests — the versioned application surface: logical
 * resources, idempotency keys, tenant isolation, fail-closed typed errors,
 * durable job identifiers for long jobs, rights delegation to the corpus
 * state machine, and the promotion + integration-scope import.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createFileJobStore, createManualClock, createWorkerRuntime } from "@sporta/durable-jobs";
import { createCorpusStore } from "@sporta/historical-corpus";
import {
  createOrganizationRegistry,
  createRegistryDefaultClock,
} from "@sporta/organization-registry";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExternalPlatform } from "../src";
import {
  benchmarkStageEvidence,
  buildStack,
  examplePolicy,
  failingQualityGate,
  feedItemMetadata,
  fixtureBytes,
  newOrgInput,
  platformUploadBasis,
  uploadMetadata,
  validationStageEvidence,
  walkToStatus,
} from "./fixtures";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sporta-external-services-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A stack + a connected platform + a worker runtime with the executors. */
async function liveStack(name: string, workerId = "w1") {
  const stack = await buildStack(dir, name);
  const connection = stack.platform.connect({
    platformId: "platform:video-platform",
    tenantId: "tenant-1",
  });
  const worker = createWorkerRuntime({
    store: stack.jobs,
    workerId,
    leaseTtlMs: 5_000,
    executors: stack.platform.executors,
  });
  return { stack, connection, worker, jobs: stack.jobs };
}

describe("the organization catalog (OrganizationCatalogQuery / OrganizationSelection)", () => {
  test("search returns eligible organizations with visible evidence; drafts are excluded", async () => {
    const { stack, connection } = await liveStack("catalog");
    const envelope = await stack.platform.services.searchOrganizations(connection, {
      query: { domain: "football" },
    });
    expect(envelope.service).toBe("searchOrganizations");
    expect(envelope.version).toBe(1);
    const ids = envelope.result.candidates.map((candidate) => candidate.organizationId);
    expect(ids).toEqual([stack.productionOrganizationId]); // the draft is not selectable
    const candidate = envelope.result.candidates[0];
    expect(candidate?.evidence.benchmark?.metrics.length).toBeGreaterThan(0);
    expect(candidate?.evidence.rightsRequirements.length).toBeGreaterThan(0);
    expect(candidate?.version).toBeGreaterThan(1);
  });

  test("inspect returns one organization's evidence; unknown ids refuse typed", async () => {
    const { stack, connection } = await liveStack("inspect");
    const envelope = await stack.platform.services.inspectOrganization(connection, {
      organizationId: stack.draftOrganizationId,
    });
    expect(envelope.result.organization.organizationId).toBe(stack.draftOrganizationId);
    expect(envelope.result.organization.status).toBe("draft");
    await expect(
      stack.platform.services.inspectOrganization(connection, {
        organizationId: "org-unknown",
      }),
    ).rejects.toMatchObject({ failureClass: "not-found" });
  });
});

describe("long jobs return durable identifiers immediately", () => {
  test("launchLabRun enqueues into the REAL durable store and returns the id at once", async () => {
    const { stack, connection, jobs } = await liveStack("labrun");
    const envelope = await stack.platform.services.launchLabRun(connection, {
      labRun: { domain: "football", task: "match", budgetUsd: 5 },
    });
    expect(envelope.result.kind).toBe("external.lab-run");
    expect(envelope.result.state).toBe("queued");
    const record = await jobs.get(envelope.result.jobId);
    expect(record.kind).toBe("external.lab-run");
    expect(record.state).toBe("queued"); // durable, canonical, immediately visible
  });

  test("submitMedia enqueues the media-processing job over the corpus-acquired source", async () => {
    const { stack, connection, jobs } = await liveStack("media-enqueue");
    const envelope = await stack.platform.services.submitMedia(connection, {
      bytes: fixtureBytes("media-1"),
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
      organizationId: stack.productionOrganizationId,
    });
    expect(envelope.result.sourceState).toBe("acquired"); // born through the user-fed law
    expect(envelope.result.jobKind).toBe("external.media-processing");
    const record = await jobs.get(envelope.result.jobId as string);
    expect(record.kind).toBe("external.media-processing");
    expect(record.state).toBe("queued");
  });
});

describe("the full media pipeline (submit -> process -> output + evidence)", () => {
  test("a completed job publishes the artifact + evidence; getOutput/getEvidence serve them", async () => {
    const { stack, connection, worker } = await liveStack("media-full");
    const submitted = await stack.platform.services.submitMedia(connection, {
      bytes: fixtureBytes("media-2"),
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
      organizationId: stack.productionOrganizationId,
    });
    const jobId = submitted.result.jobId as string;

    // Fail-closed BEFORE completion.
    await expect(stack.platform.services.getOutput(connection, { jobId })).rejects.toMatchObject({
      code: "platform.job-state",
    });
    await expect(stack.platform.services.getEvidence(connection, { jobId })).rejects.toMatchObject({
      code: "platform.job-state",
    });

    const done = await worker.runAttempt(jobId);
    expect(done.state).toBe("completed");

    const status = await stack.platform.services.getJob(connection, { jobId });
    expect(status.result.job.state).toBe("completed");
    expect(status.result.job.outputArtifactRefs.length).toBe(1);

    const output = await stack.platform.services.getOutput(connection, { jobId });
    expect(output.result.artifact.kind).toBe("transformed-media");
    expect(output.result.artifact.organizationId).toBe(stack.productionOrganizationId);
    expect(output.result.artifact.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(output.result.bytes.byteLength).toBeGreaterThan(fixtureBytes("media-2").byteLength);

    const evidence = await stack.platform.services.getEvidence(connection, { jobId });
    expect(evidence.result.evidence.qualityGate.passed).toBe(true);
    expect(evidence.result.evidence.sourceLineage.length).toBe(1);
    expect(evidence.result.evidence.sourceLineage[0]?.outcome).toBe("transformed");
    expect(evidence.result.evidence.sourceLineage[0]?.acquiredChecksum).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a reference-submitted source cannot be transformed: the job FAILS with the corpus's law", async () => {
    const { stack, connection, worker } = await liveStack("media-refusal");
    const submitted = await stack.platform.services.submitMedia(connection, {
      reference: feedItemMetadata("ref-only-1", {
        restrictions: ["reference-only"],
      }),
      organizationId: stack.productionOrganizationId,
    });
    expect(submitted.result.sourceState).toBe("referenced");
    const done = await worker.runAttempt(submitted.result.jobId as string);
    expect(done.state).toBe("failed");
    expect(done.failure?.message).toContain("transformation requires acquired+normalized bytes");
    // Fail-closed: no output, no evidence.
    await expect(
      stack.platform.services.getOutput(connection, { jobId: submitted.result.jobId as string }),
    ).rejects.toMatchObject({ code: "platform.job-state" });
  });

  test("THE RIGHTS LAW: bytes without a declared basis refuse typed through the platform", async () => {
    const { stack, connection } = await liveStack("media-rights");
    await expect(
      stack.platform.services.submitMedia(connection, {
        bytes: fixtureBytes("no-basis"),
        metadata: uploadMetadata(),
      }),
    ).rejects.toMatchObject({
      code: "corpus.rights-basis-required",
      failureClass: "rights",
    });
  });

  test("a quality-gate failure fails the job and publishes nothing (injected gate)", async () => {
    const registry = createOrganizationRegistry({ clock: createRegistryDefaultClock() });
    await registry.register(newOrgInput(), { actorType: "system", actorId: "test-harness" });
    await walkToStatus(registry, "org-alpha", "production");
    const clock = createManualClock(10_000);
    const journalPath = join(dir, "media-gate-fail.journal.json");
    const jobs = createFileJobStore(journalPath, { clock });
    const corpus = createCorpusStore({ clock });
    const platform = createExternalPlatform({
      registry,
      corpus,
      jobs,
      clock,
      qualityGate: failingQualityGate("injected-failure"),
    });
    const connection = platform.connect({ platformId: "p", tenantId: "t" });
    const submitted = await platform.services.submitMedia(connection, {
      bytes: fixtureBytes("gate-fail"),
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
      organizationId: "org-alpha",
    });
    const worker = createWorkerRuntime({
      store: jobs,
      workerId: "w1",
      leaseTtlMs: 5_000,
      executors: platform.executors,
    });
    const done = await worker.runAttempt(submitted.result.jobId as string);
    expect(done.state).toBe("failed");
    expect(done.failure?.message).toContain("quality gate");
    await expect(
      platform.services.getOutput(connection, { jobId: submitted.result.jobId as string }),
    ).rejects.toMatchObject({ code: "platform.job-state" });
  });
});

describe("idempotency keys", () => {
  test("the same key + the same request returns the SAME envelope (no re-run)", async () => {
    const { stack, connection, jobs } = await liveStack("idempotent");
    const request = {
      labRun: { domain: "football" },
      idempotencyKey: "lab-once",
    };
    const first = await stack.platform.services.launchLabRun(connection, request);
    const second = await stack.platform.services.launchLabRun(connection, request);
    expect(second).toBe(first); // the identical envelope object
    expect((await jobs.list()).length).toBe(1); // exactly one job was created
  });

  test("the same key + a DIFFERENT request is a typed conflict", async () => {
    const { stack, connection } = await liveStack("idem-conflict");
    await stack.platform.services.launchLabRun(connection, {
      labRun: { domain: "football" },
      idempotencyKey: "lab-key",
    });
    await expect(
      stack.platform.services.launchLabRun(connection, {
        labRun: { domain: "basketball" },
        idempotencyKey: "lab-key",
      }),
    ).rejects.toMatchObject({ code: "platform.conflict" });
  });

  test("idempotency is scoped per tenant", async () => {
    const { stack, connection } = await liveStack("idem-tenant");
    const other = stack.platform.connect({
      platformId: "platform:video-platform",
      tenantId: "tenant-2",
    });
    const a = await stack.platform.services.launchLabRun(connection, {
      labRun: { domain: "football" },
      idempotencyKey: "shared-key",
    });
    const b = await stack.platform.services.launchLabRun(other, {
      labRun: { domain: "football" },
      idempotencyKey: "shared-key",
    });
    expect(b.result.jobId).not.toBe(a.result.jobId); // separate tenants, separate jobs
  });
});

describe("tenant/platform isolation", () => {
  test("a foreign tenant's job is a typed not-found — never a leak", async () => {
    const { stack, connection } = await liveStack("isolation");
    const mine = await stack.platform.services.launchLabRun(connection, {
      labRun: { domain: "football" },
    });
    const other = stack.platform.connect({
      platformId: "platform:video-platform",
      tenantId: "tenant-2",
    });
    await expect(
      stack.platform.services.getJob(other, { jobId: mine.result.jobId }),
    ).rejects.toMatchObject({ code: "platform.not-found" });
    await expect(
      stack.platform.services.cancelJob(other, { jobId: mine.result.jobId }),
    ).rejects.toMatchObject({ code: "platform.not-found" });
    await expect(
      stack.platform.services.getOutput(other, { jobId: mine.result.jobId }),
    ).rejects.toMatchObject({ code: "platform.not-found" });
    // A DIFFERENT PLATFORM sees nothing either.
    const stranger = stack.platform.connect({
      platformId: "platform:other-platform",
      tenantId: "tenant-1",
    });
    await expect(
      stack.platform.services.getJob(stranger, { jobId: mine.result.jobId }),
    ).rejects.toMatchObject({ code: "platform.not-found" });
    // The owner still sees the job.
    const status = await stack.platform.services.getJob(connection, {
      jobId: mine.result.jobId,
    });
    expect(status.result.job.state).toBe("queued");
  });

  test("a job with no platform scope (foreign kind) is not visible through the surface", async () => {
    const { stack, connection, jobs } = await liveStack("foreign-kind");
    const foreign = await jobs.enqueue({ kind: "internal-maintenance", input: null });
    await expect(
      stack.platform.services.getJob(connection, { jobId: foreign.jobId }),
    ).rejects.toMatchObject({ code: "platform.not-found" });
  });
});

describe("fail-closed typed errors", () => {
  test("malformed requests refuse typed validation", async () => {
    const { stack, connection } = await liveStack("validation");
    await expect(
      stack.platform.services.launchLabRun(connection, { labRun: {} }),
    ).rejects.toMatchObject({ code: "platform.validation" });
    await expect(
      stack.platform.services.submitMedia(connection, { bytes: fixtureBytes("x") }),
    ).rejects.toMatchObject({ code: "platform.validation" }); // bytes without metadata
    await expect(stack.platform.services.getJob(connection, { jobId: "" })).rejects.toMatchObject({
      code: "platform.validation",
    });
  });

  test("selecting a non-selectable organization is a typed policy refusal", async () => {
    const { stack, connection } = await liveStack("policy-refusal");
    await expect(
      stack.platform.services.submitMedia(connection, {
        bytes: fixtureBytes("policy"),
        declaredBasis: platformUploadBasis(),
        metadata: uploadMetadata(),
        organizationId: stack.draftOrganizationId,
      }),
    ).rejects.toMatchObject({
      code: "platform.organization-not-selectable",
      failureClass: "policy",
    });
  });

  test("cancelling a completed job refuses typed (terminal)", async () => {
    const { stack, connection, worker } = await liveStack("cancel-terminal");
    const submitted = await stack.platform.services.submitMedia(connection, {
      bytes: fixtureBytes("cancel"),
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
      organizationId: stack.productionOrganizationId,
    });
    const jobId = submitted.result.jobId as string;
    await worker.runAttempt(jobId);
    await expect(stack.platform.services.cancelJob(connection, { jobId })).rejects.toMatchObject({
      code: "jobs.illegal-transition",
    });
  });

  test("connect validates the scope shape", async () => {
    const { stack } = await liveStack("connect-validation");
    expect(() => stack.platform.connect({ platformId: "", tenantId: "t" })).toThrow();
    expect(() => stack.platform.connect({ platformId: "p" })).toThrow();
    const connection = stack.platform.connect({ platformId: "p", tenantId: "t" });
    expect(connection.connectionId).toMatch(/^conn-/);
  });
});

describe("promotion + the integration-scope import", () => {
  test("a draft without evidence: the registry refuses (typed record), nothing is imported", async () => {
    const { stack, connection } = await liveStack("promote-refused");
    const envelope = await stack.platform.services.promoteOrganization(connection, {
      organizationId: stack.draftOrganizationId,
      policy: examplePolicy(),
    });
    expect(envelope.result.outcome.outcome).toBe("refused");
    expect(envelope.result.imported).toBe(false);
    expect(envelope.result.integrationScope).toBeNull();
  });

  test("a fully-evidenced organization promotes and imports into the platform's scope", async () => {
    const { stack, connection } = await liveStack("promote-granted");
    // org-alpha is already production: requestPromotion refuses (no forward
    // step) BUT the organization is selectable — the import happens.
    const envelope = await stack.platform.services.promoteOrganization(connection, {
      organizationId: stack.productionOrganizationId,
      policy: examplePolicy(),
    });
    expect(envelope.result.outcome.outcome).toBe("refused"); // no forward step from production
    expect(envelope.result.imported).toBe(true);
    expect(envelope.result.integrationScope).toMatchObject({
      platformId: "platform:video-platform",
      tenantId: "tenant-1",
      organizationId: stack.productionOrganizationId,
      status: "production",
    });
    // Idempotent re-import: the same scope record.
    const again = await stack.platform.services.promoteOrganization(connection, {
      organizationId: stack.productionOrganizationId,
      policy: examplePolicy(),
    });
    expect(again.result.integrationScope).toBe(envelope.result.integrationScope);
  });

  test("a draft organization walked by staged promotion calls imports when selectable", async () => {
    const { stack, connection } = await liveStack("promote-walk");
    // Draft -> benchmarked: granted WITH the benchmark-stage evidence, but
    // `benchmarked` is not selectable yet — no import.
    const first = await stack.platform.services.promoteOrganization(connection, {
      organizationId: stack.draftOrganizationId,
      policy: examplePolicy(),
      additionalEvidence: benchmarkStageEvidence(),
      idempotencyKey: "promote-1",
    });
    expect(first.result.outcome.outcome).toBe("granted");
    expect(first.result.imported).toBe(false);
    // Benchmarked -> validated: granted WITH the validation-stage evidence;
    // `validated` IS selectable — the import happens on THIS call.
    const second = await stack.platform.services.promoteOrganization(connection, {
      organizationId: stack.draftOrganizationId,
      policy: examplePolicy(),
      additionalEvidence: validationStageEvidence(),
      idempotencyKey: "promote-2",
    });
    expect(second.result.outcome.outcome).toBe("granted");
    expect(second.result.imported).toBe(true);
    expect(second.result.integrationScope).toMatchObject({
      organizationId: stack.draftOrganizationId,
      status: "validated",
    });
  });
});
