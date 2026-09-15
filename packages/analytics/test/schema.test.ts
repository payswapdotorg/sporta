/**
 * The W804 report-schema tests: `parseAnalyticsReport` is the fail-loud
 * gate for report DOCUMENTS (validated, never trusted — the W306 posture).
 * Every violation class rejects with a deterministic issue list, the
 * cross-total identities (attribution sums, outcome totals, the connect
 * column, the accounting identity) are enforced AT PARSE TIME, and the
 * closed key sets (operations, feedback kinds, timed operations) are
 * drift-pinned against the REAL W706 vocabularies.
 */
import { describe, expect, test } from "bun:test";
import { AnalyticsReportValidationError } from "../src/errors.ts";
import { parseAnalyticsReport } from "../src/schema.ts";
import { computeProductAnalytics } from "../src/report.ts";
import type { ProductAnalyticsReport } from "../src/report.ts";
import {
  TELEMETRY_OPERATIONS,
  TELEMETRY_TIMED_OPERATIONS,
  USER_FEEDBACK_KINDS,
} from "@sporta/viewer-shell";
import { Stream, connectAttempt, establish } from "./helpers.ts";

/** A small valid report exercising every block (the mutation base). */
function validReport(): ProductAnalyticsReport {
  const stream = new Stream();
  connectAttempt(stream, "success");
  stream.timing("connect", 90);
  establish(stream, "sess-1");
  stream.transition("session-detail", "renderer-selection", "sess-1");
  stream.failure("beginRender", "resource-limit", "busy", "sess-1");
  stream.transition("session-detail", "error", "sess-1");
  stream.timing("openLive", 200);
  stream.stall({ frameIndex: 1, frameCount: 4, availableFrames: 2 }, "sess-1");
  stream.integrity({ byteLength: 512, frameCount: 4 }, "sess-1");
  stream.feedback("playback-stalled", "sess-1");
  return computeProductAnalytics(stream.events);
}

/** Parses a structured-clone + mutation of the base; expects rejection. */
function expectRejected(mutate: (draft: ProductAnalyticsReport) => void): readonly string[] {
  const draft = structuredClone(validReport()) as ProductAnalyticsReport;
  mutate(draft);
  try {
    parseAnalyticsReport(draft);
    expect.unreachable("must throw AnalyticsReportValidationError");
  } catch (err) {
    expect(err).toBeInstanceOf(AnalyticsReportValidationError);
    return (err as AnalyticsReportValidationError).issues;
  }
}

describe("parseAnalyticsReport — the valid document", () => {
  test("a computed report parses (the computation self-validates)", () => {
    const report = validReport();
    expect(() => parseAnalyticsReport(structuredClone(report))).not.toThrow();
  });

  test("the schema tag and version are carried verbatim", () => {
    const report = validReport();
    expect(report.schemaVersion).toBe(1);
    expect(report.schemaTag).toBe("sporta/analytics/report@1");
    expect(report.vocabulary).toEqual({ telemetrySchemaVersion: 1, funnelSpecVersion: 1 });
  });

  test("the closed key sets are drift-pinned against the REAL W706 vocabularies", () => {
    const report = validReport();
    // The histogram's operation split is EXACTLY the W706 operation set:
    expect(Object.keys(report.failures.byClass[0]!.byOperation)).toEqual([...TELEMETRY_OPERATIONS]);
    expect(Object.keys(report.feedback)).toEqual([...USER_FEEDBACK_KINDS]);
    expect(Object.keys(report.timings)).toEqual([...TELEMETRY_TIMED_OPERATIONS]);
  });

  test("a future W706 operation would fail the schema LOUDLY (the drift pin has teeth)", () => {
    const draft = structuredClone(validReport()) as ProductAnalyticsReport;
    // Simulate a vocabulary bump: the computation would carry the new
    // operation in byOperation, and the versioned schema must reject the
    // shape until it is consciously bumped.
    (draft.failures.byClass[0]!.byOperation as unknown as Record<string, number>).newOperation = 0;
    const issues = (() => {
      try {
        parseAnalyticsReport(draft);
        return null;
      } catch (err) {
        return (err as AnalyticsReportValidationError).issues;
      }
    })();
    expect(issues).not.toBeNull();
    expect(issues!.some((issue) => issue.includes("newOperation"))).toBe(true);
  });
});

describe("parseAnalyticsReport — the violation battery (unknown keys, wrong values)", () => {
  test("an unknown top-level key is rejected (a report is a closed shape)", () => {
    const issues = expectRejected((draft) => {
      (draft as unknown as Record<string, unknown>).whoComputedThis = "ops";
    });
    expect(issues.join("\n")).toContain("whoComputedThis");
  });

  test("a wrong schema version is rejected, never partially accepted", () => {
    expect(
      expectRejected((draft) => {
        (draft as unknown as { schemaVersion: number }).schemaVersion = 2;
      }).join("\n"),
    ).toContain("schemaVersion");
  });

  test("a wrong schema tag is rejected", () => {
    expect(
      expectRejected((draft) => {
        (draft as unknown as { schemaTag: string }).schemaTag = "sporta/analytics/report@0";
      }).join("\n"),
    ).toContain("schemaTag");
  });

  test("an unknown funnel stage id is rejected (the enum is closed)", () => {
    expect(
      expectRejected((draft) => {
        draft.funnel.batch.stages[1]!.stage = "browsing" as never;
      }).join("\n"),
    ).toContain("stage");
  });

  test("a negative count is rejected", () => {
    expect(
      expectRejected((draft) => {
        draft.funnel.batch.stages[0]!.reached = -1;
      }).join("\n"),
    ).toContain("reached");
  });

  test("an unknown feedback kind is rejected", () => {
    expect(
      expectRejected((draft) => {
        delete (draft.feedback as unknown as Record<string, number>)["playback-good"];
        (draft.feedback as unknown as Record<string, number>)["playback-amazing"] = 1;
      }).join("\n"),
    ).toContain("playback-amazing");
  });

  test("an unknown timed-operation key is rejected", () => {
    expect(
      expectRejected((draft) => {
        (draft.timings as unknown as Record<string, unknown>).refresh = null;
      }).join("\n"),
    ).toContain("refresh");
  });

  test("an unknown attribution kind is rejected (the discriminator names the closed set)", () => {
    const issues = expectRejected((draft) => {
      draft.failures.sessionBoundaries[0]!.attribution.push({
        kind: "bored-user",
        count: 1,
      } as never);
    });
    expect(issues.join("\n")).toContain("Invalid discriminator value");
    expect(issues.join("\n")).toContain("no-error-observed");
  });

  test("an error attribution row without a failure class is rejected", () => {
    const issues = expectRejected((draft) => {
      draft.failures.sessionBoundaries[0]!.attribution.push({ kind: "error", count: 1 } as never);
    });
    expect(issues.join("\n")).toContain("failureClass");
  });

  test("an unknown session outcome kind is rejected (the discriminator names the closed set)", () => {
    const issues = expectRejected((draft) => {
      draft.failures.sessionOutcomes.push({ outcome: "vanished", count: 1 } as never);
    });
    expect(issues.join("\n")).toContain("Invalid discriminator value");
    expect(issues.join("\n")).toContain("no-terminal-error");
  });
});

describe("parseAnalyticsReport — the cross-total identities (parse-time teeth)", () => {
  test("boundary attribution must sum to dropOffs (every drop-off attributed exactly once)", () => {
    expect(
      expectRejected((draft) => {
        draft.failures.sessionBoundaries[0]!.dropOffs = 5; // attribution still sums to 0
      }).join("\n"),
    ).toContain("attribution sums to 0 but dropOffs is 5");
  });

  test("viewer-scope boundaries count attempts, session-scope count sessions (unit honesty)", () => {
    expect(
      expectRejected((draft) => {
        draft.failures.viewerBoundaries[0]!.unit = "sessions";
      }).join("\n"),
    ).toContain("viewer-scope boundaries count attempts");
    expect(
      expectRejected((draft) => {
        draft.failures.sessionBoundaries[0]!.unit = "attempts";
      }).join("\n"),
    ).toContain("session-scope boundaries count sessions");
  });

  test("session outcomes must total exactly the observed sessions", () => {
    expect(
      expectRejected((draft) => {
        draft.failures.sessionOutcomes[0]!.count += 1; // one cohort counted twice
      }).join("\n"),
    ).toContain("session outcomes must total exactly the observed sessions");
  });

  test("connection.failures must equal the histogram's connect column", () => {
    expect(
      expectRejected((draft) => {
        draft.connection.failures += 1;
      }).join("\n"),
    ).toContain("connection.failures must equal the connect-operation error events");
  });

  test("the accounting identity is re-checked at parse time", () => {
    expect(
      expectRejected((draft) => {
        draft.accounting.classified -= 1;
      }).join("\n"),
    ).toContain("accounting identity violated");
  });

  test("a zero-count unclassifiable row is rejected (observed-only rows)", () => {
    expect(
      expectRejected((draft) => {
        draft.accounting.unclassifiable.push({ reason: "ghost", count: 0 });
      }).join("\n"),
    ).toContain("count >= 1");
  });

  test("duplicate unclassifiable reasons are rejected (one row per reason)", () => {
    expect(
      expectRejected((draft) => {
        draft.accounting.unclassifiable.push({
          reason: "stage-evidence-without-session-id",
          count: 1,
        });
        draft.accounting.unclassifiable.push({
          reason: "stage-evidence-without-session-id",
          count: 1,
        });
        draft.accounting.classified -= 2; // keep the identity balanced to isolate the rule
      }).join("\n"),
    ).toContain("unique");
  });

  test("partial sessions cannot exceed observed sessions", () => {
    expect(
      expectRejected((draft) => {
        draft.accounting.partialSessions = draft.accounting.sessionsObserved + 1;
      }).join("\n"),
    ).toContain("partial sessions cannot exceed observed sessions");
  });

  test("a failure bucket's scope split must sum to its events", () => {
    expect(
      expectRejected((draft) => {
        draft.failures.byClass[0]!.viewerScoped += 1;
      }).join("\n"),
    ).toContain("scope split does not sum to events");
  });

  test("the batch path has exactly 5 stages, the live path 3", () => {
    expect(
      expectRejected((draft) => {
        draft.funnel.batch.stages.pop();
      }).join("\n"),
    ).toContain("the batch path has exactly 5 stages");
    expect(
      expectRejected((draft) => {
        draft.funnel.live.stages.push(draft.funnel.live.stages[0]!);
      }).join("\n"),
    ).toContain("the live path has exactly 3 stages");
  });

  test("both paths must open with the SAME session-engaged row", () => {
    expect(
      expectRejected((draft) => {
        draft.funnel.live.stages[0]!.reached += 1;
      }).join("\n"),
    ).toContain("both paths must open with the SAME session-engaged row");
  });
});

describe("parseAnalyticsReport — the error model", () => {
  test("the issues are deterministic strings; the parse error message carries the count + the joined issues", () => {
    let first: readonly string[] | null = null;
    for (let run = 0; run < 2; run += 1) {
      const issues = expectRejected((draft) => {
        (draft as unknown as Record<string, unknown>).stray = 1;
        draft.accounting.classified -= 1;
      });
      if (first === null) first = issues;
      else expect(issues).toEqual(first);
    }
    // Direct construction: the message is the caller's; the issues ride along:
    const error = new AnalyticsReportValidationError("m", first!);
    expect(error.message).toBe("m");
    expect(error.issues).toEqual(first!);
    // The parser's own message carries the count and the issues inline:
    const draft = structuredClone(validReport()) as unknown as Record<string, unknown>;
    draft.stray = 1;
    (draft.accounting as { classified: number }).classified -= 1;
    try {
      parseAnalyticsReport(draft);
      expect.unreachable("must throw");
    } catch (err) {
      const message = (err as AnalyticsReportValidationError).message;
      expect(message).toContain("(2 issues)");
      expect(message).toContain("stray");
      expect(message).toContain("accounting identity violated");
    }
  });

  test("a non-object value is rejected", () => {
    try {
      parseAnalyticsReport(42);
      expect.unreachable("must throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AnalyticsReportValidationError);
    }
  });
});
