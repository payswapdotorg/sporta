/**
 * THE L012 CONFLICT DETECTION BATTERY (D3/D4) — co-observation grouping
 * (the connected-component window rule), the movement-plausibility
 * tolerance, same-time ties, and the ConflictRecord minting (the batch
 * shape + the bridge id scheme — one conflict vocabulary across batch and
 * live, never a forked ledger).
 */
import { describe, expect, test } from "bun:test";
import type { LiveObservation } from "@sporta/live-source";
import { batchConfidenceOf } from "@sporta/live-source";
import {
  agreeWithinTolerance,
  coObservationGroupsOf,
  conflictRecordOf,
  defaultFusionPolicy,
  distanceM,
  drainRowsOf,
  liveObservationIdOf,
  parseFusionPolicy,
  sameTimeTiesOf,
} from "../src/index";
import type { DrainRow } from "../src/index";

const SESSION_ID = "s-fusion-units";

/** One hand-built entity row (the minimal honest shape). */
function row(input: {
  entityRef: string;
  x: number;
  y: number;
  observedAtMs: number;
  confidence?: number;
  kind?: "PLAYER" | "BALL";
  detected?: boolean;
}) {
  return {
    entityRef: input.entityRef,
    kind: input.kind ?? "PLAYER",
    position: { xMeters: input.x, yMeters: input.y },
    detected: input.detected ?? true,
    confidence: input.confidence ?? 0.9,
    observedAtMs: input.observedAtMs,
  };
}

/** One hand-built LiveObservation batch (the frozen shape, minimal). */
function batch(input: {
  sourceId: string;
  sequence: number;
  eventTimeMs: number;
  watermarkMs?: number;
  rows: ReturnType<typeof row>[];
}): LiveObservation {
  return {
    schemaVersion: "sporta.live-observation/1",
    sessionId: SESSION_ID,
    sourceId: input.sourceId,
    sourceType: "TRACKING",
    sequence: input.sequence,
    eventTimeMs: input.eventTimeMs,
    ingestTimeMs: input.eventTimeMs + 40,
    watermark: { watermarkMs: input.watermarkMs ?? input.eventTimeMs, sequence: input.sequence },
    entityObservations: input.rows,
    confidence: batchConfidenceOf(input.rows),
    provenance: "DERIVED",
    quality: "nominal",
  };
}

/** A drain row for the pure helpers. */
function drainRow(sourceId: string, sequence: number, r: ReturnType<typeof row>): DrainRow {
  return { sourceId, sequence, row: r };
}

describe("co-observation grouping (D3)", () => {
  test("rows from ONE source never form a co-observation group (a source's own sequential updates)", () => {
    const rows = [
      drainRow("a", 1, row({ entityRef: "p-1", x: 10, y: 10, observedAtMs: 1000 })),
      drainRow("a", 2, row({ entityRef: "p-1", x: 12, y: 10, observedAtMs: 1200 })),
      drainRow("a", 3, row({ entityRef: "p-1", x: 14, y: 10, observedAtMs: 1400 })),
    ];
    expect(coObservationGroupsOf("p-1", rows, defaultFusionPolicy())).toEqual([]);
  });

  test("window-comparable rows from two sources form ONE group; beyond the window they split (single-source runs are NOT co-observations)", () => {
    const policy = defaultFusionPolicy(); // window 250ms
    const rows = [
      drainRow("a", 1, row({ entityRef: "p-1", x: 10, y: 10, observedAtMs: 1000 })),
      drainRow("b", 1, row({ entityRef: "p-1", x: 11, y: 10, observedAtMs: 1200 })), // gap 200 ≤ 250: same group
      drainRow("b", 2, row({ entityRef: "p-1", x: 13, y: 10, observedAtMs: 1600 })), // gap 400 > 250: split off
    ];
    const groups = coObservationGroupsOf("p-1", rows, policy);
    // Only ONE co-observation group: the split-off run {b(1600)} is a
    // single-source run — one source's own sequential update, never a
    // co-observation (filtered at construction).
    expect(groups.length).toBe(1);
    expect(groups[0]!.sources).toEqual(["a", "b"]);
    expect(groups[0]!.rows.length).toBe(2);
  });

  test("the grouping is order-independent (deterministic regardless of arrival order)", () => {
    const policy = defaultFusionPolicy();
    const rows = [
      drainRow("b", 2, row({ entityRef: "p-1", x: 13, y: 10, observedAtMs: 1600 })),
      drainRow("a", 1, row({ entityRef: "p-1", x: 10, y: 10, observedAtMs: 1000 })),
      drainRow("b", 1, row({ entityRef: "p-1", x: 11, y: 10, observedAtMs: 1200 })),
    ];
    const groups = coObservationGroupsOf("p-1", rows, policy);
    expect(groups.length).toBe(1); // the {1600} split-off is single-source — filtered
    expect(groups[0]!.rows[0]!.row.observedAtMs).toBe(1000); // time-sorted
  });
});

describe("the movement-plausibility tolerance (D3)", () => {
  const policy = defaultFusionPolicy(); // tolerance 1.0m, max speed 10 m/s

  test("same-time rows within the bare tolerance AGREE", () => {
    expect(
      agreeWithinTolerance(
        row({ entityRef: "p-1", x: 10, y: 10, observedAtMs: 1000 }),
        row({ entityRef: "p-1", x: 10.9, y: 10, observedAtMs: 1000 }),
        policy,
      ),
    ).toBe(true);
  });

  test("same-time rows beyond the bare tolerance DISAGREE", () => {
    expect(
      agreeWithinTolerance(
        row({ entityRef: "p-1", x: 10, y: 10, observedAtMs: 1000 }),
        row({ entityRef: "p-1", x: 12.1, y: 10, observedAtMs: 1000 }),
        policy,
      ),
    ).toBe(false);
  });

  test("plausible motion over the time gap is NOT disagreement (a sprint is not a conflict)", () => {
    // 2.0m apart over 200ms: plausible 10m/s × 0.2s = 2.0m + tolerance 1.0 → agrees.
    expect(
      agreeWithinTolerance(
        row({ entityRef: "p-1", x: 10, y: 10, observedAtMs: 1000 }),
        row({ entityRef: "p-1", x: 12.0, y: 10, observedAtMs: 1200 }),
        policy,
      ),
    ).toBe(true);
  });

  test("faster-than-plausible displacement between comparable rows IS disagreement", () => {
    // 4.0m apart over 200ms: plausible 2.0m + tolerance 1.0 = 3.0 < 4.0 → conflict.
    expect(
      agreeWithinTolerance(
        row({ entityRef: "p-1", x: 10, y: 10, observedAtMs: 1000 }),
        row({ entityRef: "p-1", x: 14.0, y: 10, observedAtMs: 1200 }),
        policy,
      ),
    ).toBe(false);
  });

  test("distanceM is the pitch-plane Euclidean distance", () => {
    expect(distanceM(row({ entityRef: "p", x: 0, y: 0, observedAtMs: 0 }), row({ entityRef: "p", x: 3, y: 4, observedAtMs: 0 }))).toBe(5);
  });
});

describe("same-time ties (D5 rule 2 scope)", () => {
  test("only rows at the IDENTICAL observedAtMs form tie sets", () => {
    const rows = [
      drainRow("a", 1, row({ entityRef: "p-1", x: 10, y: 10, observedAtMs: 1000 })),
      drainRow("b", 1, row({ entityRef: "p-1", x: 11, y: 10, observedAtMs: 1000 })),
      drainRow("b", 2, row({ entityRef: "p-1", x: 12, y: 10, observedAtMs: 1150 })),
      drainRow("a", 2, row({ entityRef: "p-1", x: 13, y: 10, observedAtMs: 1150 })),
    ];
    const groups = coObservationGroupsOf("p-1", rows, defaultFusionPolicy());
    expect(groups.length).toBe(1); // one connected component (gaps ≤ 250)
    const ties = sameTimeTiesOf(groups[0]!);
    expect(ties.length).toBe(2);
    expect(ties[0]!.map((entry) => entry.sourceId).sort()).toEqual(["a", "b"]);
    expect(ties[1]!.map((entry) => entry.sourceId).sort()).toEqual(["a", "b"]);
  });
});

describe("the conflict record minting (D4)", () => {
  test("the record lists EVERY conflicting value with its confidence, resolution none, bridge-scheme ids", () => {
    const rows = [
      drainRow("tracking-a", 7, row({ entityRef: "p-home-01", x: 40, y: 20, observedAtMs: 5200, confidence: 0.9 })),
      drainRow("broadcast-1", 12, row({ entityRef: "p-home-01", x: 46, y: 22, observedAtMs: 5200, confidence: 0.55 })),
    ];
    const group = coObservationGroupsOf("p-home-01", rows, defaultFusionPolicy())[0]!;
    const record = conflictRecordOf(group, 3);
    expect(record.conflictId).toBe("cf-3");
    expect(record.slotKey).toBe("live-position:p-home-01");
    expect(record.resolution).toBe("none");
    expect(record.detectedAtMs).toBe(5200);
    // The bridge id scheme: the same ids the D6 store would carry.
    expect(record.observationIds).toEqual([
      "lo-broadcast-1-000000000012-p-home-01", // ids sorted by (time, observationId) — the canonical order
      "lo-tracking-a-000000000007-p-home-01",
    ]);
    expect(record.values).toEqual([
      { value: { xMeters: 46, yMeters: 22 }, confidence: 0.55 }, // broadcast-1 (the first id in canonical order)
      { value: { xMeters: 40, yMeters: 20 }, confidence: 0.9 },
    ]);
  });

  test("liveObservationIdOf zero-pads the sequence (the lexicographic id order = the sequence order)", () => {
    expect(liveObservationIdOf(drainRow("s", 9, row({ entityRef: "e", x: 0, y: 0, observedAtMs: 0 })))).toBe("lo-s-000000000009-e");
    expect(liveObservationIdOf(drainRow("s", 1000000, row({ entityRef: "e", x: 0, y: 0, observedAtMs: 0 })))).toBe("lo-s-000001000000-e");
  });

  test("z-position is carried in the conflict value when present (verbatim evidence)", () => {
    const withZ = { ...row({ entityRef: "ball-1", kind: "BALL" as const, x: 5, y: 5, observedAtMs: 1 }), position: { xMeters: 5, yMeters: 5, zMeters: 1.5 } };
    const rows = [
      drainRow("a", 1, withZ),
      drainRow("b", 1, row({ entityRef: "ball-1", kind: "BALL", x: 9, y: 5, observedAtMs: 1 })),
    ];
    const group = coObservationGroupsOf("ball-1", rows, defaultFusionPolicy())[0]!;
    const record = conflictRecordOf(group, 1);
    expect(record.values[0]!.value).toEqual({ xMeters: 5, yMeters: 5, zMeters: 1.5 });
  });
});

describe("drainRowsOf", () => {
  test("lifts every applied batch's rows with source identity, in drain order", () => {
    const entries = [
      { sourceId: "a", batch: batch({ sourceId: "a", sequence: 1, eventTimeMs: 1000, rows: [row({ entityRef: "p-1", x: 1, y: 1, observedAtMs: 1000 })] }) },
      { sourceId: "b", batch: batch({ sourceId: "b", sequence: 1, eventTimeMs: 1100, rows: [row({ entityRef: "p-2", x: 2, y: 2, observedAtMs: 1100 })] }) },
    ];
    const rows = drainRowsOf(entries);
    expect(rows.length).toBe(2);
    expect(rows[0]!.sourceId).toBe("a");
    expect(rows[0]!.sequence).toBe(1);
    expect(rows[1]!.row.entityRef).toBe("p-2");
  });
});

describe("parseFusionPolicy integration in pure helpers", () => {
  test("a tighter tolerance turns plausible disagreement into conflict", () => {
    const tight = parseFusionPolicy({ conflictToleranceM: 0.2 });
    expect(
      agreeWithinTolerance(
        row({ entityRef: "p-1", x: 10, y: 10, observedAtMs: 1000 }),
        row({ entityRef: "p-1", x: 10.9, y: 10, observedAtMs: 1000 }),
        tight,
      ),
    ).toBe(false);
  });
});
