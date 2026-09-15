/**
 * The W605 report pins: byte-determinism (two evaluations of the same input
 * serialize identically — asserted on BYTES), the zod schema round-trip (a
 * serialized report re-parses into the same document), input immutability,
 * the findings accounting (every finding counted; truncation accounted;
 * every failing check has its finding evidence), the plan-supplied
 * semantics, and the CLI's byte-deterministic stdout.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  buildCleanMatchFixture,
  buildCorrectionsMatchFixture,
  buildDirectedReviewFixture,
  evaluateSceneOutput,
  MAX_FINDINGS,
  REPORT_SCHEMA_TAG,
  SceneEvaluationReportSchema,
} from "../src/index";
import type { SceneEvaluationInput } from "../src/index";

const clean = buildCleanMatchFixture();
const corrections = buildCorrectionsMatchFixture();
const directed = buildDirectedReviewFixture();

describe("determinism (asserted on bytes)", () => {
  test("two evaluations of the same fixture serialize byte-identically", () => {
    for (const input of [clean, corrections, directed.input] as SceneEvaluationInput[]) {
      const first = JSON.stringify(evaluateSceneOutput(input));
      const second = JSON.stringify(evaluateSceneOutput(input));
      expect(second).toBe(first);
    }
  });

  test("two evaluations of FRESH builds serialize byte-identically", () => {
    expect(JSON.stringify(evaluateSceneOutput(buildCorrectionsMatchFixture()))).toBe(
      JSON.stringify(evaluateSceneOutput(corrections)),
    );
    expect(JSON.stringify(evaluateSceneOutput(buildDirectedReviewFixture().input))).toBe(
      JSON.stringify(evaluateSceneOutput(directed.input)),
    );
  });

  test("evaluation never mutates its input", () => {
    for (const input of [clean, corrections, directed.input] as SceneEvaluationInput[]) {
      const before = JSON.stringify(input);
      evaluateSceneOutput(input);
      expect(JSON.stringify(input)).toBe(before);
    }
  });
});

describe("the machine-readable contract", () => {
  test("the report carries the schema tag and validates against its own zod schema", () => {
    for (const input of [clean, corrections, directed.input] as SceneEvaluationInput[]) {
      const report = evaluateSceneOutput(input);
      expect(report.schemaTag).toBe(REPORT_SCHEMA_TAG);
      const parsed = SceneEvaluationReportSchema.safeParse(JSON.parse(JSON.stringify(report)));
      expect(parsed.success).toBe(true);
      expect(JSON.stringify(parsed.success ? parsed.data : null)).toBe(JSON.stringify(report));
    }
  });

  test("the verdict is the strict conjunction of all 44 checks", () => {
    const report = evaluateSceneOutput(corrections);
    expect(report.verdict.checks).toHaveLength(44);
    expect(report.verdict.pass).toBe(report.verdict.checks.every((check) => check.pass));
    const dimensionTotal = Object.values(report.dimensions).reduce(
      (sum, verdict) => sum + verdict.checks.length,
      0,
    );
    expect(dimensionTotal).toBe(44);
  });

  test("every check is max-semantics with threshold 0", () => {
    const report = evaluateSceneOutput(corrections);
    for (const check of report.verdict.checks) {
      expect(check.operator).toBe("max");
      expect(check.threshold).toBe(0);
      expect(check.pass).toBe(check.measured <= 0);
    }
  });
});

describe("the findings accounting (never silent)", () => {
  /** Perturbs every positioned entity's x on every frame (a uniform drift). */
  function uniformPositionDrift(input: SceneEvaluationInput): SceneEvaluationInput {
    const output = structuredClone(input.output);
    const manifest = (output as { manifest: { frames: unknown[] } }).manifest as {
      frames: Array<Record<string, unknown>>;
    };
    for (const frame of manifest.frames) {
      const entry = (frame.entry ?? frame) as {
        entities: Array<{
          entityId: string;
          positionMeters?: { x: number; y: number; z?: number };
        }>;
      };
      for (const entity of entry.entities) {
        if (entity.positionMeters !== undefined) {
          entity.positionMeters = { ...entity.positionMeters, x: entity.positionMeters.x + 1 };
        }
      }
    }
    return { ...input, output };
  }

  test("findings are bounded at the cap with accounted truncation", () => {
    const report = evaluateSceneOutput(uniformPositionDrift(corrections));
    // Count the positioned entity-frame pairs from the manifest itself.
    const manifest = (corrections.output as { manifest: { frames: unknown[] } }).manifest as {
      frames: Array<Record<string, unknown>>;
    };
    let positionedPairs = 0;
    for (const frame of manifest.frames) {
      const entry = (frame.entry ?? frame) as {
        entities: Array<{ positionMeters?: unknown }>;
      };
      positionedPairs += entry.entities.filter(
        (entity) => entity.positionMeters !== undefined,
      ).length;
    }
    expect(positionedPairs).toBeGreaterThan(MAX_FINDINGS);
    expect(report.verdict.pass).toBe(false);
    expect(report.findings.entries).toHaveLength(MAX_FINDINGS);
    expect(report.findings.truncated).toBe(true);
    expect(report.findings.dropped).toBe(positionedPairs - MAX_FINDINGS);
    expect(report.findings.cap).toBe(MAX_FINDINGS);
    // Every dropped finding is accounted: recorded + dropped = the defect
    // count (one finding per drifted entity-frame pair).
    expect(report.findings.entries.length + report.findings.dropped).toBe(positionedPairs);
    // The verdict still fails through the measured counts (never muted by
    // truncation).
    expect(report.sceneState.frameEntityStateMismatchCount).toBe(positionedPairs);
    expect(report.sceneState.positionMismatchCount).toBe(positionedPairs);
  });

  test("the truncation accounting is deterministic", () => {
    const first = evaluateSceneOutput(uniformPositionDrift(corrections));
    const second = evaluateSceneOutput(uniformPositionDrift(corrections));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test("a small defect count records every finding with no truncation", () => {
    const report = evaluateSceneOutput(corrections);
    expect(report.findings.entries).toHaveLength(0);
    expect(report.findings.truncated).toBe(false);
    expect(report.findings.dropped).toBe(0);
    expect(report.findings.cap).toBe(MAX_FINDINGS);
  });
});

describe("plan semantics", () => {
  test("a plan supplied with a MATCH output is a typed input error", () => {
    expect(() => evaluateSceneOutput({ ...clean, plan: directed.plan })).toThrow();
    try {
      evaluateSceneOutput({ ...clean, plan: directed.plan });
    } catch (error) {
      expect((error as { code?: string }).code).toBe("input-malformed");
      expect((error as { path?: string }).path).toBe("$.plan");
    }
  });
});

describe("the CLI (scripts/evaluate.ts)", () => {
  test("regenerates byte-identical stdout and exits 0, twice", () => {
    const cwd = join(import.meta.dir, "..");
    const first = Bun.spawnSync(["bun", "run", "scripts/evaluate.ts"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(first.exitCode).toBe(0);
    const second = Bun.spawnSync(["bun", "run", "scripts/evaluate.ts"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(second.exitCode).toBe(0);
    const firstOut = new TextDecoder().decode(first.stdout);
    const secondOut = new TextDecoder().decode(second.stdout);
    expect(secondOut).toBe(firstOut);
    // The VERDICT lines and the detection proof are all present and green.
    expect(firstOut).toContain("VERDICT clean-match: PASS");
    expect(firstOut).toContain("VERDICT corrections-match: PASS");
    expect(firstOut).toContain("VERDICT directed-review: PASS");
    expect(firstOut).not.toContain("MISSED");
    expect(firstOut).toContain("[DETECTED]");
  });
});
