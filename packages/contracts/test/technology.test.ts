/**
 * Wave-0 freeze tests: the MVP Reality Engine contract additions
 * (technology plane, technology evaluation, perception binding,
 * media artifacts, game-engine seam).
 *
 * Scope (per the freeze record): schema invariants + lifecycle + license
 * gates — the fail-closed rules the evaluation/promotion machinery relies
 * on. Fixtures-level parse coverage lives in fixtures.test.ts; the golden
 * snapshot coverage lives in schema-compatibility.test.ts.
 */
import { describe, expect, test } from "bun:test";
import {
  AdapterTaskKind,
  TECHNOLOGY_TRANSITIONS,
  blockingLicenseIssues,
  isLegalTechnologyTransition,
  type TechnologyProfile,
} from "../src/technology";
import { missingPromotionEvidence, type PromotionRecord } from "../src/technology-evaluation";
import {
  PERCEPTION_TASK_BINDINGS,
  isPerceptionTask,
  perceptionBindingIssues,
  type PerceptionAdapterDescriptor,
} from "../src/perception-adapter";
import {
  ContentAddress,
  manifestProvenanceIssues,
  type RenderArtifactManifest,
} from "../src/media-artifact";
import { GameEngineDescriptor, GameEngineRenderOutput } from "../src/game-engine";

const SCHEMA_VERSION = "1.1";

function baseProfile(): TechnologyProfile {
  return {
    schemaVersion: SCHEMA_VERSION,
    technologyId: "yolov11-player-detector",
    technologyVersion: "0.1.0",
    adapterVersion: "0.1.0",
    task: "perception.player-detection",
    displayName: "YOLOv11 Player Detector",
    capabilities: {},
    inputContract: "contracts/normalized-video-frame@1",
    outputContract: "contracts/observation.detection@1",
    resourceRequirements: { gpuRequired: true, minVramGb: 8 },
    executionRequirements: {},
    provenance: {},
    license: {
      code: { status: "permissive", licenseId: "Apache-2.0", commercialUse: true },
    },
    benchmarkProfile: { fixtureSetVersion: "fixture-set-v1", benchmarkRunIds: ["run-001"] },
    failureClasses: [],
    status: "candidate",
  };
}

function basePromotion(overrides: Partial<PromotionRecord> = {}): PromotionRecord {
  return {
    schemaVersion: SCHEMA_VERSION,
    promotionId: "promo-001",
    technologyId: "yolov11-player-detector",
    technologyVersion: "0.1.0",
    adapterVersion: "0.1.0",
    task: "perception.player-detection",
    fromStatus: "candidate",
    toStatus: "benchmarked",
    decidedAtMs: 1_789_000_000_000,
    decidedBy: "tech-lead",
    evidence: {
      evaluationReportId: "rep-001",
      benchmarkRunIds: ["run-001"],
    },
    rationale: "benchmark exists",
    ...overrides,
  };
}

function baseDescriptor(
  overrides: Partial<PerceptionAdapterDescriptor> = {},
): PerceptionAdapterDescriptor {
  return {
    schemaVersion: SCHEMA_VERSION,
    adapterKind: "perception",
    technologyId: "x-detector",
    technologyVersion: "0.1.0",
    adapterVersion: "0.1.0",
    task: "perception.player-detection",
    inputContract: "contracts/normalized-video-frame@1",
    outputContract: "contracts/observation.detection@1",
    ...overrides,
  };
}

function baseManifest(overrides: Partial<RenderArtifactManifest> = {}): RenderArtifactManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    artifactId: "art-001",
    sessionId: "sess-001",
    reality: "tactical",
    contentHash: "a".repeat(64),
    byteSize: 1024,
    container: "mp4",
    videoCodec: "avc1.42E01E",
    audioCodec: null,
    durationMs: 30_000,
    rendererId: "tactical-2d-renderer",
    rendererVersion: "1.0.0",
    generatedAtMs: 1_789_000_000_000,
    swm: { snapshotVersion: 3, lastEventSequence: 812 },
    integrity: { algorithm: "sha256", verified: true },
    ...overrides,
  };
}

describe("adapter task taxonomy (closed vocabulary)", () => {
  test("accepts every documented member", () => {
    for (const task of [
      "perception.player-detection",
      "perception.ball-detection",
      "perception.player-tracking",
      "perception.ball-tracking",
      "perception.reid",
      "perception.pitch-calibration",
      "perception.team-identity",
      "perception.jersey-ocr",
      "intelligence.asr",
      "intelligence.commentary-segmentation",
      "intelligence.commentary-understanding",
      "rendering.original",
      "rendering.tactical",
      "rendering.game-3d",
      "rendering.anime-npr",
      "rendering.encode",
      "rendering.game-engine",
      "compute.execution",
    ]) {
      expect(AdapterTaskKind.safeParse(task).success).toBe(true);
    }
  });

  test("rejects unknown tasks (no silent vocabulary growth)", () => {
    for (const task of ["perception.vibes", "rendering.svg", "compute.vendor-gpu", ""]) {
      expect(AdapterTaskKind.safeParse(task).success).toBe(false);
    }
  });
});

describe("technology lifecycle (evidence-gated transitions)", () => {
  test("the frozen edge table has exactly 13 edges", () => {
    expect(TECHNOLOGY_TRANSITIONS.length).toBe(13);
  });

  test("the promotion path is legal edge by edge", () => {
    expect(isLegalTechnologyTransition("candidate", "benchmarked")).toBe(true);
    expect(isLegalTechnologyTransition("benchmarked", "approved")).toBe(true);
    expect(isLegalTechnologyTransition("approved", "canary")).toBe(true);
    expect(isLegalTechnologyTransition("canary", "production")).toBe(true);
  });

  test("exits are legal from every non-terminal state", () => {
    for (const from of ["candidate", "benchmarked", "approved", "canary", "production"] as const) {
      expect(isLegalTechnologyTransition(from, "deprecated")).toBe(true);
    }
    for (const from of ["candidate", "benchmarked", "approved", "canary"] as const) {
      expect(isLegalTechnologyTransition(from, "rejected")).toBe(true);
    }
  });

  test("evidence gates cannot be skipped", () => {
    // no benchmark -> no approval
    expect(isLegalTechnologyTransition("candidate", "approved")).toBe(false);
    // no license review -> no canary
    expect(isLegalTechnologyTransition("benchmarked", "canary")).toBe(false);
    // canary cannot be skipped on the way to production
    expect(isLegalTechnologyTransition("approved", "production")).toBe(false);
    // production cannot be rejected (only deprecated)
    expect(isLegalTechnologyTransition("production", "rejected")).toBe(false);
  });

  test("terminal states have no outgoing edges", () => {
    for (const terminal of ["deprecated", "rejected"] as const) {
      for (const to of ["candidate", "benchmarked", "approved", "canary", "production"] as const) {
        expect(isLegalTechnologyTransition(terminal, to)).toBe(false);
      }
    }
  });

  test("no transition targets a state it already has", () => {
    for (const [from, to] of TECHNOLOGY_TRANSITIONS) {
      expect(from).not.toBe(to);
    }
  });
});

describe("license gates (R004 fail-closed)", () => {
  test("a fully resolved record has no blocking issues", () => {
    const profile = baseProfile();
    profile.license = {
      code: { status: "permissive", licenseId: "Apache-2.0", commercialUse: true },
      model: { status: "permissive", licenseId: "MIT", commercialUse: true },
    };
    expect(blockingLicenseIssues(profile)).toEqual([]);
  });

  test("unresolved status blocks", () => {
    const profile = baseProfile();
    profile.license = {
      code: { status: "permissive", licenseId: "Apache-2.0", commercialUse: true },
      model: { status: "unresolved" },
    };
    const issues = blockingLicenseIssues(profile);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("license.model: unresolved status");
  });

  test("resolved-but-unreviewed commercial use blocks", () => {
    const profile = baseProfile();
    profile.license = {
      code: { status: "permissive", licenseId: "Apache-2.0", commercialUse: true },
      dataset: { status: "research-only", licenseId: "CC-BY-NC-4.0", commercialUse: false },
    };
    const issues = blockingLicenseIssues(profile);
    expect(issues.some((i) => i.includes("license.dataset: commercial-use not affirmed"))).toBe(
      true,
    );
  });

  test("resolved without a license id blocks (no verdict without an id)", () => {
    const profile = baseProfile();
    profile.license = {
      code: { status: "permissive", commercialUse: true },
    };
    const issues = blockingLicenseIssues(profile);
    expect(issues.some((i) => i.includes("license.code: resolved without a license id"))).toBe(
      true,
    );
  });

  test("absent components do not block (code is always present)", () => {
    const profile = baseProfile();
    const issues = blockingLicenseIssues(profile);
    expect(issues).toEqual([]);
  });

  test("permissive code with a research-only model blocks (separate components)", () => {
    const profile = baseProfile();
    profile.license = {
      code: { status: "permissive", licenseId: "Apache-2.0", commercialUse: true },
      model: { status: "research-only", licenseId: "CC-BY-NC-4.0", commercialUse: false },
    };
    expect(blockingLicenseIssues(profile).length).toBeGreaterThan(0);
  });
});

describe("promotion evidence gates (R005)", () => {
  test("candidate -> benchmarked requires at least one run id", () => {
    const record = basePromotion({
      evidence: { evaluationReportId: "rep-001", benchmarkRunIds: [] },
    });
    const missing = missingPromotionEvidence(record);
    expect(missing).toContain("at least one benchmark run id");
  });

  test("benchmarked -> approved requires a license review reference", () => {
    const record = basePromotion({
      fromStatus: "benchmarked",
      toStatus: "approved",
      evidence: { evaluationReportId: "rep-001", benchmarkRunIds: ["run-001"] },
    });
    const missing = missingPromotionEvidence(record);
    expect(missing).toContain("license review reference");
  });

  test("approved -> canary requires a license review reference", () => {
    const record = basePromotion({
      fromStatus: "approved",
      toStatus: "canary",
      evidence: { evaluationReportId: "rep-001", benchmarkRunIds: ["run-001"] },
    });
    expect(missingPromotionEvidence(record)).toContain("license review reference");
  });

  test("canary -> production requires a license review reference", () => {
    const record = basePromotion({
      fromStatus: "canary",
      toStatus: "production",
      evidence: { evaluationReportId: "rep-001", benchmarkRunIds: ["run-001"] },
    });
    expect(missingPromotionEvidence(record)).toContain("license review reference");
  });

  test("documented exits need only the rationale", () => {
    const reject = basePromotion({
      toStatus: "rejected",
      evidence: { evaluationReportId: "rep-001", benchmarkRunIds: ["run-001"] },
    });
    expect(missingPromotionEvidence(reject)).toEqual([]);
    const deprecate = basePromotion({
      fromStatus: "production",
      toStatus: "deprecated",
      evidence: { evaluationReportId: "rep-001", benchmarkRunIds: ["run-001"] },
    });
    expect(missingPromotionEvidence(deprecate)).toEqual([]);
  });

  test("a fully evidenced approval is complete", () => {
    const record = basePromotion({
      fromStatus: "benchmarked",
      toStatus: "approved",
      evidence: {
        evaluationReportId: "rep-001",
        benchmarkRunIds: ["run-001"],
        licenseReviewRef: "reviews/license-001",
      },
    });
    expect(missingPromotionEvidence(record)).toEqual([]);
  });
});

describe("perception binding table (frozen)", () => {
  test("covers exactly the 8 perception tasks", () => {
    expect(Object.keys(PERCEPTION_TASK_BINDINGS).sort()).toEqual(
      [
        "perception.player-detection",
        "perception.ball-detection",
        "perception.player-tracking",
        "perception.ball-tracking",
        "perception.reid",
        "perception.pitch-calibration",
        "perception.team-identity",
        "perception.jersey-ocr",
      ].sort(),
    );
  });

  test("a coherent descriptor has no issues", () => {
    expect(perceptionBindingIssues(baseDescriptor())).toEqual([]);
  });

  test("a mismatched input contract is refused (fail-closed neutrality)", () => {
    const issues = perceptionBindingIssues(
      baseDescriptor({ inputContract: "contracts/vendor-frame@1" }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("inputContract contracts/vendor-frame@1 does not match");
  });

  test("a mismatched output contract is refused", () => {
    const issues = perceptionBindingIssues(
      baseDescriptor({ outputContract: "contracts/vendor-box@9" }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("outputContract contracts/vendor-box@9 does not match");
  });

  test("every binding cites contracts/, never a vendor name", () => {
    for (const [task, binding] of Object.entries(PERCEPTION_TASK_BINDINGS)) {
      expect(binding.inputContract.startsWith("contracts/")).toBe(true);
      expect(binding.outputContract.startsWith("contracts/")).toBe(true);
      expect(task.length).toBeGreaterThan(0);
    }
  });

  test("isPerceptionTask separates the perception family", () => {
    expect(isPerceptionTask("perception.player-detection")).toBe(true);
    expect(isPerceptionTask("perception.reid")).toBe(true);
    expect(isPerceptionTask("rendering.tactical")).toBe(false);
    expect(isPerceptionTask("compute.execution")).toBe(false);
    expect(isPerceptionTask("intelligence.asr")).toBe(false);
  });
});

describe("content addressing (media artifacts)", () => {
  test("accepts 64 lowercase hex digits", () => {
    expect(ContentAddress.safeParse("a".repeat(64)).success).toBe(true);
    expect(ContentAddress.safeParse("0123456789abcdef".repeat(4)).success).toBe(true);
  });

  test("rejects uppercase, short, long, and non-hex shapes", () => {
    expect(ContentAddress.safeParse("A".repeat(64)).success).toBe(false);
    expect(ContentAddress.safeParse("a".repeat(63)).success).toBe(false);
    expect(ContentAddress.safeParse("a".repeat(65)).success).toBe(false);
    expect(ContentAddress.safeParse("g".repeat(64)).success).toBe(false);
    expect(ContentAddress.safeParse("").success).toBe(false);
  });
});

describe("manifest provenance rules (R605 same-event integrity)", () => {
  test("a derived reality with SWM provenance is coherent", () => {
    for (const reality of ["tactical", "three-d-game", "anime-npr"] as const) {
      expect(manifestProvenanceIssues(baseManifest({ reality }))).toEqual([]);
    }
  });

  test("a derived reality without SWM provenance is refused", () => {
    const manifest = baseManifest({ swm: null });
    const issues = manifestProvenanceIssues(manifest);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("must carry SWM provenance");
  });

  test("the original reality must reference its source asset instead", () => {
    const issues = manifestProvenanceIssues(baseManifest({ reality: "original", swm: null }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("original reality must reference its sourceAssetId");
  });

  test("the original reality cannot carry SWM provenance", () => {
    const manifest = baseManifest({ reality: "original", sourceAssetId: "asset-001" });
    const issues = manifestProvenanceIssues(manifest);
    expect(issues.some((i) => i.includes("carries SWM provenance it cannot have"))).toBe(true);
  });

  test("a well-formed original is coherent", () => {
    const manifest = baseManifest({
      reality: "original",
      swm: null,
      sourceAssetId: "asset-001",
    });
    expect(manifestProvenanceIssues(manifest)).toEqual([]);
  });
});

describe("game-engine seam (provider-neutral)", () => {
  test("the descriptor engine kind is closed at game-engine (no vendor names)", () => {
    const descriptor = {
      schemaVersion: SCHEMA_VERSION,
      engineKind: "game-engine",
      engineId: "engine-001",
      engineVersion: "1.0.0",
      adapterVersion: "1.0.0",
      renderingStyles: ["stylized-3d", "cel-shaded"],
      maxConcurrentEntities: 32,
      outputFormats: ["frames-rgb24"],
    };
    expect(GameEngineDescriptor.safeParse(descriptor).success).toBe(true);
    for (const kind of ["godot", "unity", "unreal", "engine"]) {
      expect(GameEngineDescriptor.safeParse({ ...descriptor, engineKind: kind }).success).toBe(
        false,
      );
    }
  });

  test("the descriptor requires at least one rendering style and output format", () => {
    const descriptor = {
      schemaVersion: SCHEMA_VERSION,
      engineKind: "game-engine",
      engineId: "engine-001",
      engineVersion: "1.0.0",
      adapterVersion: "1.0.0",
      renderingStyles: [],
      maxConcurrentEntities: 32,
      outputFormats: [],
    };
    expect(GameEngineDescriptor.safeParse(descriptor).success).toBe(false);
  });

  test("a render output is EXACTLY ONE kind (frames or encoded)", () => {
    const frames = {
      kind: "frame-output",
      stagingRef: "staging/frames-001",
      frameCount: 900,
      widthPx: 1920,
      heightPx: 1080,
      fps: 30,
      pixelFormat: "rgb24",
    };
    expect(GameEngineRenderOutput.safeParse(frames).success).toBe(true);

    const encoded = {
      kind: "encoded-output",
      segments: [
        {
          segmentId: "seg-001",
          startMs: 0,
          endMs: 30_000,
          artifactRef: "artifacts/seg-001.mp4",
          container: "mp4",
          codec: "avc1.42E01E",
        },
      ],
    };
    expect(GameEngineRenderOutput.safeParse(encoded).success).toBe(true);

    expect(GameEngineRenderOutput.safeParse({ kind: "frame-output", segments: [] }).success).toBe(
      false,
    );
    expect(GameEngineRenderOutput.safeParse({ kind: "both" }).success).toBe(false);
  });
});
