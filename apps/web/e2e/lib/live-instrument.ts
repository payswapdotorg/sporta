/**
 * THE LIVE-GATE MEASUREMENT INSTRUMENT (L015/L016/L017) — the PURE math the
 * three live-gate flows compute their measured verdicts with.
 *
 * WHAT THIS MODULE IS (the honest scope):
 *
 * - The PERCENTILE FORMULA is a byte-for-byte REPLICA of
 *   `packages/latency-benchmark/src/percentiles.ts` (W306 nearest-rank,
 *   NIST §1.3.5 — `rank(p) = ceil(p/100·n)` clamped to [1, n], NO
 *   interpolation: every reported percentile is a value that ACTUALLY
 *   occurred). Replicated (not imported) because apps/web does not depend
 *   on `@sporta/latency-benchmark`; the replica is pinned against the
 *   original's own documented examples in `test/e2e-harness.test.ts`
 *   (same examples, same answers — the "say which formula" clause of the
 *   L015 brief: NEAREST-RANK, replicated exactly).
 * - The latency the live gates measure is the product's own honest chain:
 *   `receivedAtMs − generatedAtMs` per world frame (the server's real
 *   generation clock → this browser's real receipt clock — the same
 *   measurement `lib/live-latency.ts` documents as "unsynchronized clocks,
 *   a real measurement, never a promise"; both ends read real clocks on
 *   the SAME host in this harness, so the skew term is ~0).
 * - The identity-continuity audit, the cadence audit, the position-delta
 *   audit and the cross-run determinism fingerprint are pure functions of
 *   the probe's captured frames (see `lib/live-gates.ts` for the probe).
 *
 * NO browser, NO Node, NO env imports here: everything is directly unit-
 * tested from the root `bun test` battery.
 */

// ---------------------------------------------------------------------------
// The percentile math (the exact W306 replica — see the module doc)
// ---------------------------------------------------------------------------

/**
 * Computes the nearest-rank p-th percentile of a NON-EMPTY array of finite
 * numbers (the W306 formula replicated exactly — see the module doc).
 * Throws on an empty array or a malformed sample (fail loud, never 0).
 */
export function nearestRankPercentile(samples: readonly number[], p: number): number {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error(
      `nearestRankPercentile requires a non-empty samples array (got length ${String(samples?.length)})`,
    );
  }
  if (typeof p !== "number" || !Number.isFinite(p) || p <= 0 || p > 100) {
    throw new Error(`nearestRankPercentile requires 0 < p <= 100 (got ${String(p)})`);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  for (const sample of sorted) {
    if (typeof sample !== "number" || !Number.isFinite(sample) || sample < 0) {
      throw new Error(
        `nearestRankPercentile samples must be finite numbers >= 0 (got ${String(sample)})`,
      );
    }
  }
  const n = sorted.length;
  const rank = Math.min(Math.max(Math.ceil((p / 100) * n), 1), n);
  return sorted[rank - 1] as number;
}

/** One measured latency summary (the W306 `LatencyStats` shape, replicated). */
export interface MeasuredLatencyStats {
  count: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
}

/**
 * Summarizes measured latency samples (nearest-rank p50/p95; fail loud).
 * Samples are `receivedAtMs − generatedAtMs` — both REAL clocks on the
 * same host in this harness, so the values are ≥ 0 in practice; a negative
 * value (cross-host skew) fails LOUD here rather than being floored (the
 * same fail-loud posture as the W306 original).
 */
export function measuredLatencyStats(samples: readonly number[]): MeasuredLatencyStats {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error(`measuredLatencyStats requires a non-empty samples array`);
  }
  for (const sample of samples) {
    if (typeof sample !== "number" || !Number.isFinite(sample) || sample < 0) {
      throw new Error(
        `measuredLatencyStats samples must be finite numbers >= 0 (got ${String(sample)})`,
      );
    }
  }
  return {
    count: samples.length,
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples),
    p50Ms: nearestRankPercentile(samples, 50),
    p95Ms: nearestRankPercentile(samples, 95),
  };
}

// ---------------------------------------------------------------------------
// The captured world-frame shape (what the page-side probe records)
// ---------------------------------------------------------------------------

/** One captured entity row (the identity-continuity audit's input). */
export interface CapturedEntity {
  entityRef: string;
  kind: "PLAYER" | "BALL" | "REFEREE" | "OTHER";
  xMeters: number;
  yMeters: number;
  detected: boolean;
}

/** One captured world frame (the subset the audits need, verbatim fields). */
export interface CapturedWorldFrame {
  /** The live session the frame belongs to (per-source segmentation). */
  sessionId: string;
  ordinal: number;
  worldVersion: number;
  eventTimeMs: number;
  generatedAtMs: number;
  sourceSequence: number;
  quality: "nominal" | "degraded";
  entities: CapturedEntity[];
  /** The frame's own honest accounting events (recovery, quality, appear…). */
  frameEvents: readonly CapturedFrameEvent[];
  /** The browser's real receipt clock (ms). */
  receivedAtMs: number;
}

/** One captured `eventsSincePreviousFrame` entry (recovery/quality/appear). */
export interface CapturedFrameEvent {
  type: string;
  atMs: number;
  detail?: { missedUpdates?: number; gapDurationMs?: number; entityRef?: string };
}

// ---------------------------------------------------------------------------
// The cadence audit (L015: "state updates arrive continuously")
// ---------------------------------------------------------------------------

/**
 * The inter-arrival intervals between consecutive receipt timestamps (ms).
 * Pure; empty input → empty output (fewer than 2 frames ⇒ no intervals).
 */
export function interArrivalIntervals(receiptTimesMs: readonly number[]): number[] {
  const intervals: number[] = [];
  for (let index = 1; index < receiptTimesMs.length; index += 1) {
    intervals.push(receiptTimesMs[index]! - receiptTimesMs[index - 1]!);
  }
  return intervals;
}

/** The cadence verdict over measured receipt intervals. */
export interface CadenceVerdict {
  samples: number;
  medianIntervalMs: number | null;
  minIntervalMs: number | null;
  maxIntervalMs: number | null;
}

/**
 * Summarizes the observed cadence (nearest-rank median + extremes over the
 * measured receipt intervals — the DECLARED cadence is NOT an input here:
 * the caller asserts the verdict against the declaration separately, so
 * the tolerance decision stays visible in the flow's evidence line).
 */
export function cadenceVerdict(intervalsMs: readonly number[]): CadenceVerdict {
  if (intervalsMs.length === 0) {
    return { samples: 0, medianIntervalMs: null, minIntervalMs: null, maxIntervalMs: null };
  }
  return {
    samples: intervalsMs.length,
    medianIntervalMs: nearestRankPercentile(intervalsMs, 50),
    minIntervalMs: Math.min(...intervalsMs),
    maxIntervalMs: Math.max(...intervalsMs),
  };
}

/**
 * Whether an observed median interval matches a declared cadence within
 * `toleranceFraction` (the honest poll-free receipt measurement still
 * carries scheduler jitter on a loaded host — the tolerance is stated in
 * the flow's evidence line, never hidden here).
 */
export function medianWithinTolerance(
  medianIntervalMs: number | null,
  declaredCadenceMs: number,
  toleranceFraction: number,
): boolean {
  if (medianIntervalMs === null) return false;
  if (declaredCadenceMs <= 0) return false;
  const lower = declaredCadenceMs * (1 - toleranceFraction);
  const upper = declaredCadenceMs * (1 + toleranceFraction);
  return medianIntervalMs >= lower && medianIntervalMs <= upper;
}

// ---------------------------------------------------------------------------
// The identity-continuity audit (L015: "identity continuity is bounded")
// ---------------------------------------------------------------------------

/** One identity discontinuity (an entity that changed kind, or re-appeared). */
export interface IdentitySwitch {
  frameIndex: number;
  entityRef: string;
  problem: string;
}

/** The identity-continuity audit's verdict over captured frames. */
export interface IdentityAudit {
  framesAudited: number;
  entitiesTracked: number;
  /** The refs that first appeared AFTER frame 0 (each needs an event). */
  lateAppearances: { frameIndex: number; entityRef: string }[];
  /** Unexplained discontinuities (kind changes / disappear-reappear). */
  switches: IdentitySwitch[];
}

/**
 * Audits entity identity continuity: the entityRef SET must be stable
 * after the first frame (entities appear once, then persist — a tracking
 * miss is `detected:false`, never a removal), and an entity's KIND must
 * never change (a re-identification). `lateAppearances` are reconciled
 * against the frames' own `entity-appeared` events by the caller — a late
 * appearance WITH an honest event is explained; without one it is an
 * unexplained switch (recorded here as a switch too).
 */
export function auditIdentityContinuity(frames: readonly CapturedWorldFrame[]): IdentityAudit {
  const kindByRef = new Map<string, CapturedEntity["kind"]>();
  const present = new Set<string>();
  const lateAppearances: { frameIndex: number; entityRef: string }[] = [];
  const switches: IdentitySwitch[] = [];
  let firstFrame = true;
  frames.forEach((frame, frameIndex) => {
    const seen = new Set<string>();
    for (const entity of frame.entities) {
      seen.add(entity.entityRef);
      const previousKind = kindByRef.get(entity.entityRef);
      if (previousKind === undefined) {
        kindByRef.set(entity.entityRef, entity.kind);
        if (!firstFrame && !present.has(entity.entityRef)) {
          lateAppearances.push({ frameIndex, entityRef: entity.entityRef });
        }
      } else if (previousKind !== entity.kind) {
        switches.push({
          frameIndex,
          entityRef: entity.entityRef,
          problem: `kind changed ${previousKind} → ${entity.kind}`,
        });
      }
      present.add(entity.entityRef);
    }
    // A disappearance is only honest with an explicit event; without one it
    // is an unexplained removal (the projection contract says carried, not
    // removed — so any absence here is a switch-class problem).
    for (const ref of present) {
      if (!seen.has(ref) && !frame.frameEvents.some((e) => e.type === "entity-disappeared")) {
        switches.push({
          frameIndex,
          entityRef: ref,
          problem: "absent from the frame without an accounting event",
        });
        present.delete(ref);
      }
    }
    firstFrame = false;
  });
  return {
    framesAudited: frames.length,
    entitiesTracked: kindByRef.size,
    lateAppearances,
    switches,
  };
}

// ---------------------------------------------------------------------------
// The position-delta audit (L015: "tactical view visibly follows state")
// ---------------------------------------------------------------------------

/** The position-delta verdict for one entity across consecutive frames. */
export interface PositionDeltaStats {
  entityRef: string;
  samples: number;
  maxDeltaMeters: number;
  meanDeltaMeters: number;
}

/**
 * Consecutive-frame position deltas for one entity (meters, canonical
 * pitch space). Entities carried as last-known (undetected) contribute 0 —
 * honest carry, never a fabricated jump — and are counted in `samples`.
 */
export function positionDeltaStats(
  frames: readonly CapturedWorldFrame[],
  entityRef: string,
): PositionDeltaStats | null {
  const rows: { x: number; y: number }[] = [];
  for (const frame of frames) {
    const entity = frame.entities.find((row) => row.entityRef === entityRef);
    if (entity !== undefined) rows.push({ x: entity.xMeters, y: entity.yMeters });
  }
  if (rows.length < 2) return null;
  const deltas: number[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    deltas.push(
      Math.hypot(rows[index]!.x - rows[index - 1]!.x, rows[index]!.y - rows[index - 1]!.y),
    );
  }
  return {
    entityRef,
    samples: deltas.length,
    maxDeltaMeters: Math.max(...deltas),
    meanDeltaMeters: deltas.reduce((sum, value) => sum + value, 0) / deltas.length,
  };
}

// ---------------------------------------------------------------------------
// The dropout/reconnect audit (L015: gap accounting, never smoothed)
// ---------------------------------------------------------------------------

/** The reconnect gap accounting captured from a stream's own events. */
export interface RecoveryAccounting {
  frameIndex: number;
  missedUpdates: number;
  gapDurationMs: number;
}

/**
 * Finds the reconnect scenario's recovery event (the first frame carrying
 * `source-recovery` with its explicit gap accounting). Pure; `null` when
 * the captured window contains no recovery event.
 */
export function findRecoveryAccounting(
  frames: readonly CapturedWorldFrame[],
): RecoveryAccounting | null {
  for (let index = 0; index < frames.length; index += 1) {
    const event = frames[index]!.frameEvents.find((row) => row.type === "source-recovery");
    if (event !== undefined) {
      return {
        frameIndex: index,
        missedUpdates: event.detail?.missedUpdates ?? -1,
        gapDurationMs: event.detail?.gapDurationMs ?? -1,
      };
    }
  }
  return null;
}

/**
 * The source-sequence gaps of a captured window (the DROP scenario's
 * visible per-tick drops: consecutive frames' `sourceSequence` deltas
 * beyond 1 — counted, never smoothed over).
 */
export function sourceSequenceGaps(
  frames: readonly CapturedWorldFrame[],
): { afterFrameIndex: number; gap: number }[] {
  const gaps: { afterFrameIndex: number; gap: number }[] = [];
  for (let index = 1; index < frames.length; index += 1) {
    const delta = frames[index]!.sourceSequence - frames[index - 1]!.sourceSequence;
    if (delta > 1) gaps.push({ afterFrameIndex: index - 1, gap: delta - 1 });
  }
  return gaps;
}

// ---------------------------------------------------------------------------
// The cross-run determinism fingerprint (§5 of the worker brief)
// ---------------------------------------------------------------------------

/**
 * A compact, human-comparable fingerprint of a captured window's
 * observation/version sequence — `v<worldVersion>@<eventTimeMs>#<seq>`
 * per frame. Two harness runs over the same seeded source must produce
 * IDENTICAL fingerprints (the L002 determinism contract); the flows record
 * the fingerprint in their evidence notes and the REPORT compares runs.
 */
export function determinismFingerprint(frames: readonly CapturedWorldFrame[]): string {
  return frames.map((f) => `v${f.worldVersion}@${f.eventTimeMs}#seq${f.sourceSequence}`).join(" ");
}

// ---------------------------------------------------------------------------
// The live-source finders (the product's own listing, pure projections)
// ---------------------------------------------------------------------------

/** One live source as the product's own /api/live listing serves it. */
export interface LiveSourceRow {
  sessionId: string;
  label: string;
  storyKey: string;
  sourceKind: "story" | "tactical";
  sourceNote?: string;
  finiteWindow?: boolean;
}

/**
 * The label fragment the product's own dev seed gives each L002 scenario
 * session (apps/web/src/server/dev-seed.ts — the exact strings the /api/live
 * listing serves; a mismatch here fails the gates LOUD, never silently).
 */
const SCENARIO_LABEL_FRAGMENTS: Record<LiveScenarioKindOf, string> = {
  normal: "— normal delivery",
  jitter: "— jitter",
  delay: "— delay window",
  drop: "— scattered drops",
  "out-of-order": "— out-of-order",
  reconnect: "— reconnect",
};

/** The scenario vocabulary the finders accept (the L002 kinds). */
export type LiveScenarioKindOf =
  "normal" | "jitter" | "delay" | "drop" | "out-of-order" | "reconnect";

/**
 * Finds the L002 delivery-scenario session the gates exercise (matched by
 * the label fragment the dev seed actually serves — e.g. the drop scenario
 * is listed as "Synthetic live tracking — scattered drops").
 * Pure; `null` when the listing has no such source.
 */
export function scenarioSourceOf(
  sources: readonly LiveSourceRow[],
  scenario: LiveScenarioKindOf,
): LiveSourceRow | null {
  const fragment = SCENARIO_LABEL_FRAGMENTS[scenario];
  return (
    sources.find(
      (source) =>
        source.sourceKind === "tactical" &&
        source.label.includes(fragment) &&
        source.finiteWindow !== true,
    ) ?? null
  );
}

/** Finds the finite live-window session (the L014/L016/L017 continuity source). */
export function finiteSourceOf(sources: readonly LiveSourceRow[]): LiveSourceRow | null {
  return (
    sources.find((source) => source.sourceKind === "tactical" && source.finiteWindow === true) ??
    null
  );
}
