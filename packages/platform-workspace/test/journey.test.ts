/**
 * REL-024 / Gate REL-A10 — THE platform processing journey, end to end, as
 * ONE tested scenario:
 *
 * ```
 * upload video (fixture bytes, real digests)
 *   -> auto-select organization (the documented ordering, never hidden)
 *   -> process (the durable job surface, imported)
 *   -> quality gate (the organization's declared quality policy)
 *   -> retrieve the transformed video + its full evidence chain
 * ```
 *
 * The simulated external video platform connects, uploads, auto-selects,
 * processes, and retrieves — and every leg of the chain is verified
 * against the authority that owns it (the corpus's digests, the choice
 * model's ordering statement, the registry's record version, the durable
 * job's canonical state, the platform's evidence bundle). The journey is
 * deterministic: the same scenario on an identically-seeded stack produces
 * byte-identical outputs.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fixtureBytes, platformUploadBasis, sha256HexBytes, uploadMetadata } from "./fixtures";
import { buildWorkspaceStack, cleanupScratch, SIMULATED_PLATFORM } from "./fixtures";
import { DEFAULT_AUTO_ORDERING } from "../src";
import { DECLARED_QUALITY_GATE_ID } from "../src";

beforeAll(() => {
  // scratch dir is created lazily by buildWorkspaceStack
});
afterAll(() => {
  cleanupScratch();
});

describe("the REL-A10 platform processing journey (one scenario)", () => {
  test("upload -> auto-select -> process -> quality gate -> retrieve, with the full evidence chain", async () => {
    const stack = await buildWorkspaceStack("journey");
    const session = stack.workspace.connect({ ...SIMULATED_PLATFORM });

    // -- stage 1: upload --------------------------------------------------
    const bytes = fixtureBytes("match-clip-42", 96);
    const upload = await session.uploadVideo({
      bytes,
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
    });
    expect(upload.sourceState).toBe("acquired");
    // REAL DIGESTS: the corpus computed them; the test re-derives them.
    expect(upload.acquiredChecksum).toBe(await sha256HexBytes(bytes));
    expect(upload.acquiredChecksum).toHaveLength(64);
    expect(upload.rightsBasis).toEqual({
      basisType: "user-declared-ownership",
      grantRef: "declaration:platform-upload-42",
      declaredBy: "platform:video-platform",
    });

    // -- stage 2: auto-select under the documented ordering ----------------
    const selection = await session.autoSelectOrganization({
      query: { domain: "football", task: "match" },
    });
    // The DECLARED default ordering: quality-descending on "fidelity" — the
    // beta org declares 8.9, the strong org 8.4: beta must win, VISIBLE.
    expect(selection.organizationId).toBe(stack.secondStrongOrganizationId);
    expect(selection.mode).toBe("auto");
    // The ordering statement is the choice model's own words, recorded —
    // never a hidden ranking.
    expect(selection.orderedBy).toContain("quality descending");
    expect(selection.orderedBy).toContain("fidelity");
    // Every eligible organization was considered (visible count).
    expect(selection.candidatesConsidered).toBe(3);
    // The selected candidate carries the registry's visible evidence.
    expect(selection.organization.version).toBeGreaterThan(0);
    expect(
      selection.organization.evidence.benchmark?.metrics.find((m) => m.axis === "fidelity"),
    ).toMatchObject({ value: 8.9 });

    // -- stage 3: process through the durable job surface ------------------
    const processing = await session.processVideo({
      sourceId: upload.sourceId,
      organizationId: selection.organizationId,
    });
    expect(processing.jobId).toMatch(/^job-/);
    expect(processing.kind).toBe("external.media-processing");
    expect(processing.state).toBe("queued");
    expect(processing.selection).toEqual({
      mode: "auto",
      orderedBy: selection.orderedBy,
    });

    // -- stage 3b: drive the imported runtime's one attempt ----------------
    const driven = await session.runJob({ jobId: processing.jobId });
    expect(driven.job.state).toBe("completed");
    expect(driven.job.attempts).toBe(1);
    expect(driven.job.completedAt).not.toBeNull();

    // -- stage 4: retrieve the transformed video ----------------------------
    const output = await session.output({ jobId: processing.jobId });
    expect(output.artifact.kind).toBe("transformed-media");
    expect(output.artifact.organizationId).toBe(stack.secondStrongOrganizationId);
    // The honest v0 transform prepends the deterministic header naming the
    // organization + source; the normalized bytes ride behind it.
    const header = new TextEncoder().encode(
      `SPORTA-TRANSFORM/${stack.secondStrongOrganizationId}/${upload.sourceId}\n`,
    );
    expect(output.bytes.byteLength).toBe(header.byteLength + bytes.byteLength);
    expect(output.bytes.slice(0, header.byteLength)).toEqual(header);
    expect(output.bytes.slice(header.byteLength)).toEqual(bytes);
    // REAL DIGESTS: the artifact checksum re-derives from the bytes.
    expect(output.artifact.checksum).toBe(await sha256HexBytes(output.bytes));
    expect(output.artifact.artifactRef).toBe(`artifact://${output.artifact.checksum}`);
    expect(output.artifact.items).toHaveLength(1);
    expect(output.artifact.items[0]?.sourceId).toBe(upload.sourceId);
    expect(output.artifact.items[0]?.checksum).toBe(await sha256HexBytes(output.bytes));

    // -- stage 4b: the full evidence chain ----------------------------------
    const chain = await session.evidenceChain({ jobId: processing.jobId });
    // The job leg: the durable canonical state.
    expect(chain.job.state).toBe("completed");
    expect(chain.job.kind).toBe("external.media-processing");
    expect(chain.job.outputArtifactRefs).toEqual([`artifact://${output.artifact.checksum}`]);
    expect(chain.scope).toEqual({
      platformId: SIMULATED_PLATFORM.platformId,
      tenantId: SIMULATED_PLATFORM.tenantId,
    });
    // The upload leg: the corpus provenance + digests.
    expect(chain.upload.sourceId).toBe(upload.sourceId);
    expect(chain.upload.acquiredChecksum).toBe(upload.acquiredChecksum);
    expect(chain.upload.normalizedChecksum).toBe(upload.acquiredChecksum); // identity normalizer
    expect(chain.upload.metadataDigest).toBe(upload.metadataDigest);
    expect(chain.upload.rightsBasis?.grantRef).toBe("declaration:platform-upload-42");
    expect(chain.upload.provider).toBe("user-upload");
    // The selection leg: the documented ordering, recorded verbatim.
    expect(chain.selection).toEqual({
      organizationId: stack.secondStrongOrganizationId,
      mode: "auto",
      orderedBy: selection.orderedBy,
    });
    // The organization leg: the record VERSION + the declared quality policy.
    expect(chain.organization.organizationId).toBe(stack.secondStrongOrganizationId);
    expect(chain.organization.status).toBe("validated");
    expect(chain.organization.declaredQuality).toEqual([
      { axis: "fidelity", value: 8.9, ciLow: 8.5, ciHigh: 9.2 },
      { axis: "stylization", value: 7.8, ciLow: 7.4, ciHigh: 8.1 },
      { axis: "temporal", value: 7.6, ciLow: 7.1, ciHigh: 8.0 },
    ]);
    // The output leg: the digests again, one record.
    expect(chain.output.checksum).toBe(output.artifact.checksum);
    expect(chain.output.byteLength).toBe(output.artifact.byteLength);
    // The evidence bundle: source lineage + the declared-quality verdict.
    expect(chain.evidence.sourceLineage).toHaveLength(1);
    expect(chain.evidence.sourceLineage[0]).toMatchObject({
      sourceId: upload.sourceId,
      outcome: "transformed",
      acquiredChecksum: upload.acquiredChecksum,
      normalizedChecksum: upload.acquiredChecksum,
    });
    expect(chain.evidence.qualityGate.gateId).toBe(DECLARED_QUALITY_GATE_ID);
    expect(chain.evidence.qualityGate.passed).toBe(true);
    const checkNames = chain.evidence.qualityGate.checks.map((check) => check.name);
    expect(checkNames).toContain("output-non-empty");
    expect(checkNames).toContain("lineage-complete");
    expect(checkNames).toContain("no-data-loss");
    expect(checkNames).toContain("declared-quality-present");
    expect(checkNames).toContain("declared-quality-consistent");
    expect(checkNames).toContain("declared-quality-floor");

    // -- determinism: the same journey on an identically-seeded stack ------
    const stack2 = await buildWorkspaceStack("journey-determinism");
    const session2 = stack2.workspace.connect({ ...SIMULATED_PLATFORM });
    const upload2 = await session2.uploadVideo({
      bytes,
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
    });
    const selection2 = await session2.autoSelectOrganization({
      query: { domain: "football", task: "match" },
    });
    const processing2 = await session2.processVideo({
      sourceId: upload2.sourceId,
      organizationId: selection2.organizationId,
    });
    await session2.runJob({ jobId: processing2.jobId });
    const output2 = await session2.output({ jobId: processing2.jobId });
    expect(output2.bytes).toEqual(output.bytes);
    expect(output2.artifact.checksum).toBe(output.artifact.checksum);
    expect(upload2.sourceId).toBe(upload.sourceId); // deterministic corpus ids
    expect(selection2.orderedBy).toBe(selection.orderedBy);
  });

  test("the workspace's declared default auto ordering is quality-descending on fidelity (documented, exported)", () => {
    expect(DEFAULT_AUTO_ORDERING).toEqual({ kind: "quality-descending", axis: "fidelity" });
  });

  test("explicit selection rides the same choice evidence (chooseOrganization)", async () => {
    const stack = await buildWorkspaceStack("journey-explicit");
    const session = stack.workspace.connect({ ...SIMULATED_PLATFORM });
    const upload = await session.uploadVideo({
      bytes: fixtureBytes("explicit-clip", 48),
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
    });
    const selection = await session.chooseOrganization({
      organizationId: stack.strongOrganizationId,
    });
    expect(selection.mode).toBe("explicit");
    expect(selection.orderedBy).toBeNull();
    expect(selection.organization.status).toBe("production");
    const processing = await session.processVideo({
      sourceId: upload.sourceId,
      organizationId: selection.organizationId,
    });
    expect(processing.selection).toEqual({ mode: "explicit", orderedBy: null });
    await session.runJob({ jobId: processing.jobId });
    const chain = await session.evidenceChain({ jobId: processing.jobId });
    expect(chain.organization.organizationId).toBe(stack.strongOrganizationId);
    expect(chain.organization.status).toBe("production");
    // The production org's version reflects the canary walk (evidence bumps).
    expect(chain.organization.version).toBeGreaterThanOrEqual(7);
    expect(chain.evidence.qualityGate.passed).toBe(true);
    const output = await session.output({ jobId: processing.jobId });
    expect(output.bytes.byteLength).toBeGreaterThan(0);
  });

  test("the catalog lists every eligible organization with visible evidence", async () => {
    const stack = await buildWorkspaceStack("journey-catalog");
    const session = stack.workspace.connect({ ...SIMULATED_PLATFORM });
    const catalog = await session.listOrganizations({
      query: { domain: "football" },
      ordering: { kind: "cost-ascending" },
    });
    expect(catalog.candidates).toHaveLength(3);
    expect(catalog.orderedBy).toContain("cost ascending");
    // cost-ascending: beta (1.1), strong (1.2), lying (1.3) — no ties here.
    expect(catalog.candidates[0]?.organizationId).toBe(stack.secondStrongOrganizationId);
    expect(catalog.candidates[1]?.organizationId).toBe(stack.strongOrganizationId);
    expect(catalog.candidates[2]?.organizationId).toBe(stack.lyingOrganizationId);
    for (const candidate of catalog.candidates) {
      expect(candidate.evidence.benchmark).not.toBeNull();
      expect(candidate.evidence.benchmark?.metrics.length).toBeGreaterThan(0);
    }
  });
});
