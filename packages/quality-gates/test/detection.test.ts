/**
 * The detection proofs (the W503/W605 convention): every gate verdict the
 * suite claims to produce is PROVEN by injection — a real defect through
 * the source package's own injector seam, a missing/malformed/incomplete
 * human record, a gate made not-runnable — and the overall verdict must
 * move exactly as the policy documents. A gate that cannot detect its
 * failure mode is rejected.
 */
import { describe, expect, test } from "bun:test";
import { buildCleanMatchFixture } from "@sporta/scene-evaluation";
import {
  evaluateReleaseReadiness,
  parseDemoRecord,
  runTemporalGate,
  runSceneGate,
  runHumanGate,
  buildTemporalDefectFixture,
  DEMO_RECORD,
} from "../src/index";

/** The demo record as a mutable clone. */
function demoRecord(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(DEMO_RECORD)) as Record<string, unknown>;
}

describe("detection — the temporal gate bites", () => {
  test("a real injected style instability FAILs the gate and the release", () => {
    const result = runTemporalGate(buildTemporalDefectFixture);
    expect(result.status).toBe("FAIL");
    expect(result.summary.failingCheckCount).toBeGreaterThan(0);

    const report = evaluateReleaseReadiness({
      humanRecord: parseDemoRecord(),
      temporalGate: () => result,
    });
    expect(report.verdict.outcome).toBe("FAIL");
    expect(report.verdict.reason).toContain("temporal-stability");
  });
});

describe("detection — the scene gate bites", () => {
  test("a corrupted match fixture FAILs the gate and the release", () => {
    const result = runSceneGate({
      matchFixture: () => {
        // Build the clean fixture then corrupt one HUD claim through a
        // structural clone (the scene-evaluation detection idiom).
        const clone = JSON.parse(JSON.stringify(buildCleanMatchFixture())) as ReturnType<
          typeof buildCleanMatchFixture
        >;
        const frames = (
          clone.output as {
            manifest: { frames: { hud: { statusLine: string } }[] };
          }
        ).manifest.frames;
        const last = frames[frames.length - 1]!;
        last.hud.statusLine = last.hud.statusLine.replace(/-0/, "-9");
        return clone;
      },
    });
    expect(result.status).toBe("FAIL");
    expect(result.summary.matchVerdict).toBe(false);

    const report = evaluateReleaseReadiness({
      humanRecord: parseDemoRecord(),
      sceneGate: () => result,
    });
    expect(report.verdict.outcome).toBe("FAIL");
    expect(report.verdict.reason).toContain("scene-correctness");
  });
});

describe("detection — the human gate is fail-closed", () => {
  test("a MISSING record (machine gates green) → PENDING-HUMAN-REVIEW, never PASS", () => {
    const report = evaluateReleaseReadiness({});
    expect(report.verdict.outcome).toBe("PENDING-HUMAN-REVIEW");
    expect(report.humanReview.status).toBe("absent");
    expect(report.accounting.pendingHumanReviewCount).toBe(1);
  });

  test("a MALFORMED record → PENDING-HUMAN-REVIEW with the reason", () => {
    const report = evaluateReleaseReadiness({ humanRecord: { nonsense: true } });
    expect(report.verdict.outcome).toBe("PENDING-HUMAN-REVIEW");
    expect(report.humanReview.status).toBe("failed");
    expect(report.humanReview.reason).toContain("malformed");
  });

  test("an INCOMPLETE record (a not-checked item) → PENDING-HUMAN-REVIEW naming it", () => {
    const record = demoRecord();
    (record.checklist as Record<string, string>)["gate-report-read-in-full"] = "not-checked";
    const report = evaluateReleaseReadiness({ humanRecord: record });
    expect(report.verdict.outcome).toBe("PENDING-HUMAN-REVIEW");
    expect(report.humanReview.reason).toContain("gate-report-read-in-full");
  });

  test("a COMPLETE record with a failed item → FAIL (a real review that found a problem)", () => {
    const record = demoRecord();
    (record.checklist as Record<string, string>)["one-rendered-clip-per-renderer-path-inspected"] =
      "fail";
    const report = evaluateReleaseReadiness({ humanRecord: record });
    expect(report.verdict.outcome).toBe("FAIL");
    expect(report.verdict.reason).toContain("human-review");
  });

  test("the human gate runner reports the pending status directly", () => {
    expect(runHumanGate(undefined).status).toBe("PENDING-HUMAN-REVIEW");
    expect(runHumanGate(42).status).toBe("PENDING-HUMAN-REVIEW");
    expect(runHumanGate(demoRecord()).status).toBe("PASS");
  });
});

describe("detection — not-runnable gates count as FAIL, never skipped", () => {
  test("a throwing machine gate lands NOT-RUNNABLE and fails the release", () => {
    const report = evaluateReleaseReadiness({
      humanRecord: parseDemoRecord(),
      temporalGate: () => {
        throw new Error("simulated package failure");
      },
    });
    expect(report.verdict.outcome).toBe("FAIL");
    expect(report.accounting.notRunnableCount).toBe(1);
    expect(report.verdict.reason).toContain("simulated package failure");
  });

  test("a gate runner that CATCHES its package error reports NOT-RUNNABLE", () => {
    const result = runTemporalGate(() => {
      throw new Error("simulated package failure");
    });
    expect(result.status).toBe("NOT-RUNNABLE");
    expect(result.reason).toContain("simulated package failure");
  });
});

describe("the clean baseline (the demo record's suite)", () => {
  test("all four gates PASS with the checked-in demo record", () => {
    const report = evaluateReleaseReadiness({ humanRecord: parseDemoRecord() });
    expect(report.verdict.outcome).toBe("PASS");
    expect(report.gates.map((g) => g.status)).toEqual(["PASS", "PASS", "PASS", "PASS"]);
    expect(report.accounting.reconciles).toBe(true);
  }, 120_000);
});
