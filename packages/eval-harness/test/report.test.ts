/**
 * W801 report-shape tests: the structural self-check
 * (`assertSuiteReportShape`) over the real suite report and its checked-in
 * golden — plus every NEGATIVE class of shape/consistency violation, and the
 * environment-honesty proofs (versions are MEASURED from the workspace's
 * package.json files, not asserted).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DEFAULT_GOLDEN_REPORT_PATH,
  ENVIRONMENT_PACKAGE_KEYS,
  REPORT_SCHEMA_TAG,
  assertSuiteReportShape,
  measurePackageVersions,
  serializeSuiteReport,
} from "../src/index";
import type { SuiteReport, W403CaseResult, W503CaseResult, W601CaseResult } from "../src/index";
import { cloneReport, defaultSuiteReport } from "./helpers";
import type { Mutable } from "./helpers";

describe("report shape: the real report and the golden pass the self-check", () => {
  test("the default suite's report passes", () => {
    expect(() => assertSuiteReportShape(defaultSuiteReport())).not.toThrow();
  });

  test("the checked-in golden report parses and passes the self-check", () => {
    const golden = JSON.parse(readFileSync(DEFAULT_GOLDEN_REPORT_PATH, "utf8"));
    expect(() => assertSuiteReportShape(golden)).not.toThrow();
    expect((golden as SuiteReport).reportSchema).toBe(REPORT_SCHEMA_TAG);
  });

  test("the report's serialization is idempotent (canonical bytes)", () => {
    const canonical = serializeSuiteReport(defaultSuiteReport());
    expect(serializeSuiteReport(JSON.parse(canonical) as SuiteReport)).toBe(canonical);
  });
});

describe("report shape: every violation class fails loud", () => {
  const mutate = (mutator: (report: Mutable<SuiteReport>) => void): unknown => {
    const clone = cloneReport(defaultSuiteReport()) as Mutable<SuiteReport>;
    mutator(clone);
    return clone;
  };

  test("an unknown top-level key fails", () => {
    const value = mutate((report) => {
      (report as unknown as Record<string, unknown>).hostname = "ci-runner-7";
    });
    expect(() => assertSuiteReportShape(value)).toThrow(/unknown key "hostname"/);
  });

  test("a wrong reportSchema tag fails", () => {
    const value = mutate((report) => {
      report.reportSchema = "sporta/eval-harness/suite-report@0";
    });
    expect(() => assertSuiteReportShape(value)).toThrow(/reportSchema/);
  });

  test("a non-hex suiteConfigSha256 fails", () => {
    const value = mutate((report) => {
      report.suite.suiteConfigSha256 = "not-a-hash";
    });
    expect(() => assertSuiteReportShape(value)).toThrow(/suiteConfigSha256/);
  });

  test("a suiteId that disagrees with the embedded config fails", () => {
    const value = mutate((report) => {
      report.suite.suiteId = "some-other-suite";
    });
    expect(() => assertSuiteReportShape(value)).toThrow(/do not match the embedded config/);
  });

  test("an environment block missing a package fails (measured, not asserted)", () => {
    const value = mutate((report) => {
      delete report.environment.packageVersions["@sporta/testing"];
    });
    expect(() => assertSuiteReportShape(value)).toThrow(/packageVersions/);
  });

  test("an extra environment package fails (exactly the runtime dep set)", () => {
    const value = mutate((report) => {
      report.environment.packageVersions["@sporta/renderer-anime"] = "0.1.0";
    });
    expect(() => assertSuiteReportShape(value)).toThrow(/packageVersions/);
  });

  test("a case that does not echo the config's fixture fails", () => {
    const value = mutate((report) => {
      (report.cases[0] as Mutable<W403CaseResult>).fixture.fixturePath =
        "../../somewhere-else.json";
    });
    expect(() => assertSuiteReportShape(value)).toThrow(/does not echo the suite config/);
  });

  test("a case clock outside the suite clock window fails (monotonic clock)", () => {
    const value = mutate((report) => {
      report.cases[1]!.clock = { startMs: 1, endMs: 2 };
    });
    expect(() => assertSuiteReportShape(value)).toThrow(/outside the suite clock window/);
  });

  test("an aggregate verdict that is not the conjunction fails", () => {
    const value = mutate((report) => {
      report.cases[0]!.verdict = "FAIL";
      report.cases[0]!.failureReasons = ["injected failure"];
      // Keep every OTHER consistency invariant intact: counts + attributed
      // reasons agree with the mutated cases — ONLY the verdict is wrong.
      report.aggregate.verdict = "PASS";
      report.aggregate.passCount = 2;
      report.aggregate.failCount = 1;
      report.aggregate.failureReasons = ["w403-replay-comparability: injected failure"];
    });
    expect(() => assertSuiteReportShape(value)).toThrow(/STRICT CONJUNCTION/);
  });

  test("counts that do not add up fail", () => {
    const value = mutate((report) => {
      report.aggregate.passCount = 2;
    });
    expect(() => assertSuiteReportShape(value)).toThrow(/do not match/);
  });

  test("a FAILING case with no failure reasons fails (never silent)", () => {
    const value = mutate((report) => {
      report.cases[0]!.verdict = "FAIL";
    });
    expect(() => assertSuiteReportShape(value)).toThrow(/must explain itself/);
  });

  test("a PASSING case with failure reasons fails", () => {
    const value = mutate((report) => {
      report.cases[0]!.failureReasons = ["spurious reason"];
    });
    expect(() => assertSuiteReportShape(value)).toThrow(/PASS but failureReasons/);
  });

  test("an aggregate reason without a failing-case prefix fails (attribution)", () => {
    const value = mutate((report) => {
      report.cases[0]!.verdict = "FAIL";
      report.cases[0]!.failureReasons = ["injected failure"];
      report.aggregate.verdict = "FAIL";
      report.aggregate.failCount = 1;
      report.aggregate.passCount = 2;
      report.aggregate.failureReasons = ["unattributed failure"];
    });
    expect(() => assertSuiteReportShape(value)).toThrow(/not prefixed/);
  });

  test("a case carrying BOTH an error and measured values fails (crash consistency)", () => {
    const value = mutate((report) => {
      (report.cases[0] as unknown as { error?: unknown }).error = {
        errorClass: "Error",
        message: "injected",
      };
    });
    expect(() => assertSuiteReportShape(value)).toThrow(/inconsistent/);
  });

  test("an unknown case-result key fails", () => {
    const value = mutate((report) => {
      (report.cases[0] as unknown as Record<string, unknown>).weight = 0.5;
    });
    expect(() => assertSuiteReportShape(value)).toThrow(/unknown key "weight"/);
  });

  test("W403 thresholds drifting from DEFAULT_EPSILON fails", () => {
    const value = mutate((report) => {
      (report.cases[0] as Mutable<W403CaseResult>).thresholds!.defaultEpsilon = 0.5;
    });
    expect(() => assertSuiteReportShape(value)).toThrow(/DEFAULT_EPSILON/);
  });

  test("W503 thresholds drifting from the evaluator's THRESHOLDS fails", () => {
    const value = mutate((report) => {
      // The threshold literal (0) is viewed as a plain number to inject the
      // drift — the mutation's whole point (the W403 value-cast precedent).
      (
        (report.cases[1] as Mutable<W503CaseResult>).thresholds as {
          MAX_IDENTITY_FLICKER_COUNT: number;
        }
      ).MAX_IDENTITY_FLICKER_COUNT = 3;
    });
    expect(() => assertSuiteReportShape(value)).toThrow(/THRESHOLDS/);
  });

  test("W601 checkIds that do not match the measured checks fail", () => {
    const value = mutate((report) => {
      (report.cases[2] as Mutable<W601CaseResult>).thresholds!.checkIds = ["made-up-check"];
    });
    expect(() => assertSuiteReportShape(value)).toThrow(/checkIds/);
  });

  test("W403 measured carrying an unknown key fails", () => {
    const value = mutate((report) => {
      // An unknown key is INJECTED through a Record view — that is the point
      // of this mutation (the W403 shape-test precedent).
      (
        (report.cases[0] as Mutable<W403CaseResult>).measured as unknown as Record<string, unknown>
      ).scoreAverage = 0.87;
    });
    expect(() => assertSuiteReportShape(value)).toThrow(/unknown key "scoreAverage"/);
  });

  test("an inter-case injected-clock regression fails (monotonic across the run)", () => {
    const value = mutate((report) => {
      // Case 3's window moves BACK before case 2's, while staying inside the
      // suite window and internally monotone — ONLY the run-order invariant
      // breaks (this pinned the self-check gap: the containment check alone
      // let such a report through).
      const early = report.cases[0]!.clock;
      report.cases[2]!.clock = { startMs: early.startMs, endMs: early.endMs };
    });
    expect(() => assertSuiteReportShape(value)).toThrow(/monotonic/);
  });
});

describe("environment honesty: versions are measured from the workspace", () => {
  test("measurePackageVersions reads the real package.json files", () => {
    const versions = measurePackageVersions();
    for (const key of ENVIRONMENT_PACKAGE_KEYS) {
      expect(versions[key]).toBeDefined();
    }
    // Spot-prove the measurement: read two of the files directly.
    expect(versions["@sporta/evaluation"]).toBe(
      (
        JSON.parse(readFileSync(`${import.meta.dir}/../../evaluation/package.json`, "utf8")) as {
          version: string;
        }
      ).version,
    );
    expect(versions["@sporta/eval-harness"]).toBe(
      (
        JSON.parse(readFileSync(`${import.meta.dir}/../../eval-harness/package.json`, "utf8")) as {
          version: string;
        }
      ).version,
    );
  });

  test("measurePackageVersions is deterministic (deep-equal on repeat)", () => {
    expect(measurePackageVersions()).toEqual(measurePackageVersions());
  });

  test("the report's environment matches a fresh measurement", () => {
    expect(defaultSuiteReport().environment.packageVersions).toEqual(measurePackageVersions());
  });

  test("the report contains no wall-clock, hostname, or random-id fields", () => {
    const json = serializeSuiteReport(defaultSuiteReport());
    for (const banned of [
      '"hostname"',
      '"timestamp"',
      '"wallClock',
      '"randomId"',
      '"runId"',
      '"bunVersion"',
      '"platform"',
      '"os"',
    ]) {
      expect(json).not.toContain(banned);
    }
  });
});

test("report schema tag is versioned", () => {
  expect(REPORT_SCHEMA_TAG).toBe("sporta/eval-harness/suite-report@1");
});
