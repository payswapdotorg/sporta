import { describe, expect, test } from "bun:test";
import {
  PERCEPTION_TASK_BINDINGS,
  PerceptionAdapterDescriptor,
  TechnologyCandidate,
  perceptionBindingIssues,
  SCHEMA_VERSION,
} from "@sporta/contracts";
import {
  AdapterBindingError,
  assertDescriptorBinding,
  describeAdapters,
  defaultCandidateBindings,
  perceptionDescriptor,
  BallBlobDetector,
  ColorBlobBallTracker,
  ContrastContextDetector,
  GreedyIouTrackerAdapter,
  HeuristicColorDetector,
  HomographyFieldCalibratorAdapter,
  JerseyColorTeamAssigner,
  LineBasedFieldCalibrator,
  ModelBackedBallDetector,
  ModelBackedDetector,
  NearestBoxBallTrackerAdapter,
  TwoStageHungarianTracker,
} from "../src/index";

const BASE_DESCRIPTOR: PerceptionAdapterDescriptor = {
  schemaVersion: SCHEMA_VERSION,
  adapterKind: "perception",
  technologyId: "test-detector",
  technologyVersion: "0.1.0",
  adapterVersion: "0.1.0",
  task: "perception.player-detection",
  inputContract: "contracts/normalized-video-frame@1",
  outputContract: "contracts/observation.detection@1",
};

describe("fail-closed descriptor binding validation (R201)", () => {
  test("a frozen-conforming descriptor passes with no issues", () => {
    expect(perceptionBindingIssues(BASE_DESCRIPTOR)).toEqual([]);
    expect(assertDescriptorBinding(BASE_DESCRIPTOR)).toEqual(BASE_DESCRIPTOR);
  });

  test("a mismatching inputContract is refused at construction", () => {
    const bad = { ...BASE_DESCRIPTOR, inputContract: "contracts/something-else@1" };
    expect(perceptionBindingIssues(bad).join("; ")).toContain(
      "does not match frozen binding contracts/normalized-video-frame@1",
    );
    expect(() => assertDescriptorBinding(bad)).toThrow(AdapterBindingError);
    expect(() => assertDescriptorBinding(bad)).toThrow(/inputContract/);
  });

  test("a mismatching outputContract is refused at construction", () => {
    const bad = { ...BASE_DESCRIPTOR, outputContract: "contracts/observation.track@1" };
    expect(() => assertDescriptorBinding(bad)).toThrow(/outputContract/);
  });

  test("a non-perception task is refused", () => {
    const bad = {
      ...BASE_DESCRIPTOR,
      task: "intelligence.asr",
    } as unknown as PerceptionAdapterDescriptor;
    expect(() => assertDescriptorBinding(bad)).toThrow(AdapterBindingError);
  });

  test("a family task mismatch is refused even when the binding table matches", () => {
    // The descriptor below is a VALID ball-detection binding, but the
    // player-detection family expects its own task.
    const ballDetectionDescriptor: PerceptionAdapterDescriptor = {
      ...BASE_DESCRIPTOR,
      task: "perception.ball-detection",
    };
    expect(perceptionBindingIssues(ballDetectionDescriptor)).toEqual([]);
    expect(() =>
      assertDescriptorBinding(ballDetectionDescriptor, "perception.player-detection"),
    ).toThrow(/does not match the family task/);
  });

  test("a malformed descriptor (shape violation) is refused", () => {
    const malformed = { ...BASE_DESCRIPTOR, technologyId: "" };
    expect(() => assertDescriptorBinding(malformed)).toThrow(AdapterBindingError);
    const noVersion = { ...BASE_DESCRIPTOR, schemaVersion: "not-a-version" };
    expect(() => assertDescriptorBinding(noVersion)).toThrow(AdapterBindingError);
  });

  test("perceptionDescriptor stamps the current schema version and validates", () => {
    const descriptor = perceptionDescriptor({
      technologyId: "x",
      technologyVersion: "1",
      adapterVersion: "1",
      task: "perception.jersey-ocr",
      inputContract: PERCEPTION_TASK_BINDINGS["perception.jersey-ocr"].inputContract,
      outputContract: PERCEPTION_TASK_BINDINGS["perception.jersey-ocr"].outputContract,
    });
    expect(descriptor.schemaVersion).toBe(SCHEMA_VERSION);
    expect(perceptionBindingIssues(descriptor)).toEqual([]);
  });
});

describe("every shipped candidate conforms fail-closed", () => {
  const candidates = [
    ["contrast-context-detector", () => new ContrastContextDetector()],
    ["heuristic-color-detector", () => new HeuristicColorDetector()],
    ["model-backed-detector", () => new ModelBackedDetector()],
    ["ball-blob-detector", () => new BallBlobDetector()],
    ["model-backed-ball-detector", () => new ModelBackedBallDetector()],
    ["greedy-iou-tracker", () => new GreedyIouTrackerAdapter()],
    ["hungarian-tracker", () => new TwoStageHungarianTracker()],
    ["nearest-box-ball-tracker", () => new NearestBoxBallTrackerAdapter()],
    ["color-blob-ball-tracker", () => new ColorBlobBallTracker()],
    ["homography-field-calibrator", () => new HomographyFieldCalibratorAdapter()],
    ["line-based-field-calibrator", () => new LineBasedFieldCalibrator()],
    ["jersey-color-team-assigner", () => new JerseyColorTeamAssigner()],
  ] as const;

  for (const [name, construct] of candidates) {
    test(`${name}: descriptor parses and carries zero binding issues`, () => {
      const adapter = construct();
      expect(PerceptionAdapterDescriptor.safeParse(adapter.descriptor).success).toBe(true);
      expect(perceptionBindingIssues(adapter.descriptor)).toEqual([]);
      // The family task of every shipped candidate matches its binding.
      expect(PERCEPTION_TASK_BINDINGS[adapter.descriptor.task]).toBeDefined();
    });
  }
});

describe("describeAdapters (R201 inventory)", () => {
  test("every R201-delivered family appears with its frozen binding", () => {
    const families = describeAdapters();
    const tasks = families.map((family) => family.task);
    expect(tasks).toContain("perception.player-detection");
    expect(tasks).toContain("perception.ball-detection");
    expect(tasks).toContain("perception.player-tracking");
    expect(tasks).toContain("perception.ball-tracking");
    expect(tasks).toContain("perception.pitch-calibration");
    expect(tasks).toContain("perception.team-identity");
    for (const family of families) {
      expect(family.binding).toEqual(PERCEPTION_TASK_BINDINGS[family.task]);
    }
  });

  test("every candidate-funded family has at least two materially different candidates; team-identity has its one (R206 spec)", () => {
    const families = new Map(describeAdapters().map((family) => [family.task, family]));
    expect(families.get("perception.player-detection")!.candidates.length).toBeGreaterThanOrEqual(
      2,
    );
    expect(families.get("perception.ball-detection")!.candidates.length).toBeGreaterThanOrEqual(2);
    expect(families.get("perception.player-tracking")!.candidates.length).toBeGreaterThanOrEqual(2);
    expect(families.get("perception.ball-tracking")!.candidates.length).toBeGreaterThanOrEqual(2);
    expect(families.get("perception.pitch-calibration")!.candidates.length).toBeGreaterThanOrEqual(
      2,
    );
    // R206 explicitly funds ONE implementation (JerseyColorTeamAssigner).
    expect(families.get("perception.team-identity")!.candidates.length).toBe(1);
  });

  test("candidate pairs are materially different (distinct technology ids)", () => {
    for (const family of describeAdapters()) {
      const ids = family.candidates.map((candidate) => candidate.technologyId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test("every candidate's code license honestly blocks promotion until the repo declares one", () => {
    for (const family of describeAdapters()) {
      for (const candidate of family.candidates) {
        expect(candidate.licenseStatus.code).toBe("unresolved");
        expect(candidate.licenseBlocksPromotion).toBe(true);
      }
    }
  });
});

describe("registry bindings (TechnologyCandidate-shaped records)", () => {
  test("every shipped candidate maps to a frozen-schema-valid candidate record", () => {
    const bindings = defaultCandidateBindings();
    expect(bindings.length).toBe(13);
    for (const binding of bindings) {
      const parsed = TechnologyCandidate.safeParse(binding.candidate);
      expect(parsed.success).toBe(true);
      expect(binding.candidate.schemaVersion).toBe(SCHEMA_VERSION);
      expect(binding.candidate.registeredAtMs).toBeGreaterThan(0);
      expect(perceptionBindingIssues(binding.descriptor)).toEqual([]);
      expect(binding.failureClasses.length).toBeGreaterThan(0);
      expect(binding.resourceRequirements.gpuRequired).toBe(false);
    }
  });

  test("binding tasks cover the six R201-delivered families", () => {
    const tasks = new Set(defaultCandidateBindings().map((b) => b.candidate.task));
    expect(tasks).toEqual(
      new Set([
        "perception.player-detection",
        "perception.ball-detection",
        "perception.player-tracking",
        "perception.ball-tracking",
        "perception.pitch-calibration",
        "perception.team-identity",
      ]),
    );
  });
});
