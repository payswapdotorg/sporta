import { describe, expect, test } from "bun:test";
import {
  CAMERA_BENCH_CANDIDATES,
  CAMERA_BENCH_METRICS,
  CAMERA_BENCH_STAGES,
  CAMERA_BENCH_STATUS,
} from "../src/camera-bench";

/**
 * THE CAMERA-BENCH STRUCTURE TESTS (HF010–HF013) — pin the harness data to
 * the frozen task profile and the candidates yaml, and pin the honest
 * nothing-ran status. The registry's license/provenance states are checked
 * VERBATIM against `docs/technology/hugging-face-candidates.yaml` (the
 * source of truth, read from the repo at test time — no drift possible).
 */

const CANDIDATES_YAML_PATH = "../../../docs/technology/hugging-face-candidates.yaml";

/** Extracts one candidate block's field values from the yaml (line-based). */
async function yamlCandidateBlocks(): Promise<Map<string, Record<string, string>>> {
  const file = Bun.file(new URL(CANDIDATES_YAML_PATH, import.meta.url));
  const text = await file.text();
  const blocks = new Map<string, Record<string, string>>();
  let current: { id: string; fields: Record<string, string> } | null = null;
  for (const line of text.split("\n")) {
    const idMatch = /^ {2}- id: (\S+)$/.exec(line);
    if (idMatch !== null) {
      current = { id: idMatch[1]!, fields: {} };
      blocks.set(current.id, current.fields);
      continue;
    }
    const fieldMatch = /^ {4}(source|license|promotion): (.+)$/.exec(line);
    if (fieldMatch !== null && current !== null) {
      current.fields[fieldMatch[1]!] = fieldMatch[2]!;
    }
    const tasksMatch = /^ {4}tasks: \[(.+)\]$/.exec(line);
    if (tasksMatch !== null && current !== null) {
      current.fields.tasks = tasksMatch[1]!;
    }
  }
  return blocks;
}

describe("the camera-bench metric vocabulary (the frozen task profile)", () => {
  test("every renderer.cinematicReCamera profile metric is covered exactly once", () => {
    const profileMetrics = [
      "camera-path adherence",
      "player/ball identity",
      "temporal consistency",
      "geometry consistency",
      "hallucinated/unseen-region rate",
      "event preservation",
      "generation latency and cost",
    ];
    // The profile names "generation latency and cost" as ONE metric line;
    // the harness splits it into the two measurable rows (latency, cost).
    const covered = CAMERA_BENCH_METRICS.map((metric) => metric.profileMetric);
    expect(covered).toEqual([
      "camera-path adherence",
      "player/ball identity",
      "temporal consistency",
      "geometry consistency",
      "hallucinated/unseen-region rate",
      "event preservation",
      "generation latency",
      "generation cost",
    ]);
    // Every profile metric is implemented (latency+cost jointly).
    for (const profileMetric of profileMetrics) {
      if (profileMetric === "generation latency and cost") {
        expect(covered).toContain("generation latency");
        expect(covered).toContain("generation cost");
        continue;
      }
      expect(covered).toContain(profileMetric);
    }
  });

  test("every metric carries a definition and a real measurement seam", () => {
    for (const metric of CAMERA_BENCH_METRICS) {
      expect(metric.definition.length).toBeGreaterThan(20);
      expect(metric.measuredThrough.length).toBeGreaterThan(10);
    }
  });
});

describe("the candidate registry (license/provenance VERBATIM from the yaml)", () => {
  test("every candidate's license + promotion states match the yaml exactly", async () => {
    const blocks = await yamlCandidateBlocks();
    expect(blocks.size).toBeGreaterThanOrEqual(6);
    const normalize = (value: string): string => value.replace(/\s+/g, "");
    for (const candidate of CAMERA_BENCH_CANDIDATES) {
      const block = blocks.get(candidate.candidateId);
      expect(block, `${candidate.candidateId} must exist in the candidates yaml`).toBeDefined();
      expect(candidate.license).toBe(block!.license!);
      expect(candidate.promotion).toBe(block!.promotion!);
      expect(candidate.source).toBe(block!.source!);
      expect(normalize(candidate.tasks.join(","))).toBe(normalize(block!.tasks ?? ""));
    }
  });

  test("the HF work items' candidates are all registered", () => {
    const ids = CAMERA_BENCH_CANDIDATES.map((candidate) => candidate.candidateId);
    expect(ids).toContain("hf.wan22.fun.control-camera"); // HF010
    expect(ids).toContain("hf.recammaster"); // HF010
    expect(ids).toContain("hf.meridian"); // HF010
    expect(ids).toContain("hf.viewcrafter25"); // HF011
    expect(ids).toContain("hf.wan22.animate"); // HF012
    expect(ids).toContain("hf.ltx23"); // HF013
    for (const item of ["HF010", "HF011", "HF012", "HF013"] as const) {
      expect(
        CAMERA_BENCH_CANDIDATES.some((candidate) => candidate.hfItem === item),
        `${item} must own at least one candidate`,
      ).toBe(true);
    }
  });

  test("every candidate carries a license GATE note (never a silent pass)", () => {
    for (const candidate of CAMERA_BENCH_CANDIDATES) {
      expect(candidate.licenseNote.length).toBeGreaterThan(20);
      // The gated candidates carry their gate in the note.
      if (candidate.license === "research-only-until-cleared") {
        expect(candidate.licenseNote).toContain("research use only");
        expect(candidate.licenseNote).toContain("CANNOT become a production dependency");
      }
    }
  });
});

describe("the harness stages + the honest status", () => {
  test("the five stages run fixture-resolution through report, each fail-loud", () => {
    expect(CAMERA_BENCH_STAGES.map((stage) => stage.id)).toEqual([
      "fixture-resolution",
      "adapter-registration",
      "run",
      "measurement",
      "report",
    ]);
    for (const stage of CAMERA_BENCH_STAGES) {
      expect(stage.purpose.length).toBeGreaterThan(20);
      expect(stage.honestyRule.length).toBeGreaterThan(20);
    }
  });

  test("the status record is the honest NOTHING-RAN posture", () => {
    expect(CAMERA_BENCH_STATUS.ran).toBe(false);
    expect(CAMERA_BENCH_STATUS.reason).toContain("GPU-gated");
    expect(CAMERA_BENCH_STATUS.reason).toContain("no model was downloaded");
    expect(CAMERA_BENCH_STATUS.prepared.length).toBeGreaterThanOrEqual(4);
  });
});
