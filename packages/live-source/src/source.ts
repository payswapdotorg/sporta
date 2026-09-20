/**
 * THE DETERMINISTIC LIVE SOURCE (L002) — a timestamped TRACKING source that
 * emits player/ball entity observations incrementally at a configurable
 * rate, through the frozen LiveObservation semantics, over a deterministic
 * delivery plan the scenarios compile.
 *
 * THE REPLAY GUARANTEE (the accept criterion): the same (seed, scenario,
 * tickCount, rateMs, roster) yields a BYTE-IDENTICAL observation sequence —
 * the source reads NO wall clock (the ingest schedule is DATA in the
 * delivery plan: `ingestTimeMs = eventTimeMs + planned offset`), NO env,
 * and NO unseeded randomness (every draw is a pure function of the seed).
 * The wave-2 transport bridge paces itself against
 * {@link DeterministicLiveSource.plannedIngestTimeMs} when it wants
 * real-time playback; the core itself is schedule-driven, pull-based and
 * pure.
 *
 * THE PORT SEAM (contract-clean for Worker A's L003): consumers see only
 * {@link LiveSourcePort} — `next()` (the next observation in arrival order,
 * `null` when the script is exhausted), `stats()` (the counted-drop / gap /
 * reconnect / rate accounting), `metadata` (the frozen §6 source-adapter
 * profile) and `close()`. No provider shapes, no transport, no SWM writes:
 * this source NEVER creates world truth — it only observes its scripted
 * match model and hands the observations over.
 *
 * THE WATERMARK SEMANTICS (frozen temporal rules): each observation's
 * watermark is the CONSERVATIVE CONTIGUOUS FRONTIER — the largest event
 * time for which the source guarantees no further observation will arrive.
 * Accounted misses (dropped ticks, reconnect-window gaps) advance the
 * frontier honestly (nothing more will arrive for them — the accounting is
 * the guarantee); an undelivered tick inside a bounded out-of-order swap
 * HOLDS the frontier (the overtaken update is still coming).
 */
import type { LiveObservation } from "./observation";
import {
  LIVE_OBSERVATION_QUALITIES,
  type LiveObservationQuality,
  parseLiveObservation,
} from "./observation";
import {
  batchConfidenceOf,
  buildScriptedRoster,
  observeRosterAtTick,
  type ScriptedEntity,
} from "./match-script";
import {
  LIVE_SCENARIO_KINDS,
  buildDeliveryPlan,
  validateScenario,
  type DeliveryPlan,
  type LiveScenarioConfig,
  type LiveScenarioKind,
} from "./scenarios";

// ---------------------------------------------------------------------------
// The source configuration
// ---------------------------------------------------------------------------

/** Configuration for {@link createDeterministicLiveSource} (all DATA). */
export interface DeterministicLiveSourceConfig {
  /** The session this source observes (rides every observation). */
  sessionId: string;
  /** The source identity (default `synthetic-tracking-1` — honest naming). */
  sourceId?: string;
  /** The deterministic replay key: same seed + scenario → same sequence. */
  seed: number;
  /** The scenario (a kind shorthand or the full config). */
  scenario: LiveScenarioKind | LiveScenarioConfig;
  /** How many ticks the scripted window spans (default 600). */
  tickCount?: number;
  /** The nominal inter-tick event-time distance in ms (default 100 = 10 Hz). */
  rateMs?: number;
  /** The first tick's event time in ms (default 0). */
  startEventTimeMs?: number;
  /** Players per team (default 11). */
  playersPerTeam?: number;
  /** Referees (default 1). */
  referees?: number;
  /** The base delivery latency (ms) every observation carries (default 120). */
  baseLatencyMs?: number;
}

/** A malformed source configuration (fail-loud). */
export class LiveSourceValidationError extends Error {
  constructor(issues: readonly string[]) {
    super(`deterministic live source configuration failed validation: ${issues.join("; ")}`);
    this.name = "LiveSourceValidationError";
  }
}

const DEFAULT_TICK_COUNT = 600;
const DEFAULT_RATE_MS = 100;

function resolveScenario(scenario: LiveScenarioKind | LiveScenarioConfig): LiveScenarioConfig {
  if (typeof scenario === "string") {
    if (!(LIVE_SCENARIO_KINDS as readonly string[]).includes(scenario)) {
      throw new LiveSourceValidationError([
        `scenario '${scenario}' is not one of ${LIVE_SCENARIO_KINDS.join(" | ")}`,
      ]);
    }
    return { kind: scenario };
  }
  return scenario;
}

// ---------------------------------------------------------------------------
// The source metadata (frozen §6 — the source-adapter profile, DATA)
// ---------------------------------------------------------------------------

/** The frozen §6 source-adapter profile (all DATA, no provider shapes). */
export interface LiveSourceMetadata {
  /** The source identity (matches `sourceId`). */
  sourceId: string;
  /** The adapter implementation identity + version. */
  adapterId: string;
  adapterVersion: string;
  /** What this source is (honest labeling — synthetic, deterministic). */
  sourceKind: "synthetic-deterministic";
  /** The nominal emission rate (Hz). */
  supportedRateHz: number;
  /** The coordinate system (the Sporta canonical pitch frame). */
  coordinateSystem: string;
  /** What the source can emit (the scenario vocabulary, honest). */
  capabilities: readonly string[];
  /** Honest provenance (scripted match model — never real-match data). */
  provenance: string;
  /** License/data-use status (synthetic — no third-party data). */
  licenseDataUse: string;
  /** How the source authenticates (nothing — it is in-process). */
  authenticationMode: "none";
  /** The nominal latency distribution (base + the scenario's distortions). */
  latencyProfile: { baseLatencyMs: number; note: string };
  /** The dropout/error classes the scenarios exercise. */
  dropoutClasses: readonly string[];
  /** The reconnect behavior (explicit accounting, never smoothing). */
  reconnectBehavior: string;
}

// ---------------------------------------------------------------------------
// The honest accounting surface
// ---------------------------------------------------------------------------

/** The source's counted accounting (never a silent anything). */
export interface LiveSourceStats {
  /** Ticks the scripted window spans. */
  plannedTicks: number;
  /** Observations delivered so far (arrival order walks the plan). */
  emitted: number;
  /** Ticks dropped by the drop scenario (scattered, counted, visible gaps). */
  droppedTicks: number;
  /** Ticks lost to reconnect windows (counted, explicitly accounted). */
  reconnectGapTicks: number;
  /** Reconnect windows crossed (the recovery observations emitted). */
  reconnects: number;
  /** The longest run of consecutive undelivered ticks (drops + gaps). */
  maxConsecutiveMisses: number;
  /** First/last ingest stamps of delivered observations (null before any). */
  firstIngestTimeMs: number | null;
  lastIngestTimeMs: number | null;
  /** Emitted observations per second of ingest span (null before two). */
  effectiveEmissionRateHz: number | null;
  /** The CURRENT watermark lag: last emitted eventTime − watermarkMs. */
  watermarkLagMs: number;
  /** Emissions whose quality was honestly degraded (post-reconnect). */
  degradedObservations: number;
  /** Entity rows honestly reported undetected (never fabricated certainty). */
  undetectedEntityObservations: number;
  /** Whether the script is exhausted (next() would return null). */
  exhausted: boolean;
}

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

/**
 * THE live source port (the L002/L003 seam): pull-based, deterministic,
 * contract-clean. The wave-2 SSE bridge schedules pulls; L003 consumes the
 * observations through the frozen LiveObservation shape only.
 */
export interface LiveSourcePort {
  /** The source profile (frozen §6 — DATA). */
  readonly metadata: LiveSourceMetadata;
  /**
   * The next observation in ARRIVAL order (scenario-ordered), or `null`
   * when the scripted window is exhausted. Every returned document parses
   * against the LiveObservation contract.
   */
  next(): LiveObservation | null;
  /**
   * The next planned arrival's ingest time (ms), or `null` when exhausted
   * — the real-time bridge's pacing primitive (the core reads no clock).
   */
  plannedIngestTimeMs(): number | null;
  /** The counted accounting (live — reflects every emission so far). */
  stats(): LiveSourceStats;
  /** Ends the source (idempotent; stats stay readable). */
  close(): void;
}

// ---------------------------------------------------------------------------
// The deterministic source
// ---------------------------------------------------------------------------

/** The source's honest label constants (DATA). */
export const LIVE_SOURCE_ADAPTER_ID = "live-source.synthetic-tracking";
export const LIVE_SOURCE_ADAPTER_VERSION = "1.0.0";

/**
 * The deterministic synthetic/replay live source (L002). Created through
 * {@link createDeterministicLiveSource}; the class is exported for typed
 * consumers (the port is the seam).
 */
export class DeterministicLiveSource implements LiveSourcePort {
  readonly metadata: LiveSourceMetadata;

  private readonly config: Required<
    Pick<
      DeterministicLiveSourceConfig,
      | "sessionId"
      | "sourceId"
      | "seed"
      | "tickCount"
      | "rateMs"
      | "startEventTimeMs"
      | "playersPerTeam"
      | "referees"
      | "baseLatencyMs"
    >
  > & { scenario: LiveScenarioConfig };
  private readonly roster: readonly ScriptedEntity[];
  private readonly plan: DeliveryPlan;
  private readonly lastKnown = new Map<string, LiveObservation["entityObservations"][number]>();
  private nextEmissionIndex = 0;
  private closed = false;
  private readonly delivered = new Set<number>();
  /** The contiguous frontier (0-based tick; -1 = nothing contiguous yet). */
  private frontier = -1;
  private readonly statsState: {
    emitted: number;
    degraded: number;
    undetected: number;
    reconnects: number;
    lastEventTimeMs: number | null;
    lastWatermarkMs: number;
    firstPulledIngestMs: number | null;
    lastPulledIngestMs: number | null;
  } = {
    emitted: 0,
    degraded: 0,
    undetected: 0,
    reconnects: 0,
    lastEventTimeMs: null,
    lastWatermarkMs: 0,
    firstPulledIngestMs: null,
    lastPulledIngestMs: null,
  };

  constructor(config: DeterministicLiveSourceConfig) {
    const issues: string[] = [];
    if (config.sessionId.length === 0 || config.sessionId.length > 128) {
      issues.push("sessionId must be 1..128 characters");
    }
    if (
      config.sourceId !== undefined &&
      (config.sourceId.length === 0 || config.sourceId.length > 128)
    ) {
      issues.push("sourceId must be 1..128 characters");
    }
    if (!Number.isSafeInteger(config.seed)) {
      issues.push("seed must be a safe integer");
    }
    const scenario = resolveScenario(config.scenario);
    const tickCount = config.tickCount ?? DEFAULT_TICK_COUNT;
    const rateMs = config.rateMs ?? DEFAULT_RATE_MS;
    if (!Number.isInteger(tickCount) || tickCount < 1 || tickCount > 1_000_000) {
      issues.push(`tickCount (${tickCount}) must be an integer in [1, 1_000_000]`);
    }
    if (!Number.isInteger(rateMs) || rateMs < 10 || rateMs > 10_000) {
      issues.push(`rateMs (${rateMs}) must be an integer in [10, 10_000]`);
    }
    const playersPerTeam = config.playersPerTeam ?? 11;
    if (!Number.isInteger(playersPerTeam) || playersPerTeam < 1 || playersPerTeam > 11) {
      issues.push(`playersPerTeam (${playersPerTeam}) must be an integer in [1, 11]`);
    }
    const referees = config.referees ?? 1;
    if (!Number.isInteger(referees) || referees < 0 || referees > 4) {
      issues.push(`referees (${referees}) must be an integer in [0, 4]`);
    }
    const baseLatencyMs = config.baseLatencyMs ?? 120;
    if (!Number.isInteger(baseLatencyMs) || baseLatencyMs < 0 || baseLatencyMs > 60_000) {
      issues.push(`baseLatencyMs (${baseLatencyMs}) must be an integer in [0, 60_000]`);
    }
    if (issues.length > 0) throw new LiveSourceValidationError(issues);
    validateScenario(scenario, rateMs, tickCount);

    this.config = {
      sessionId: config.sessionId,
      sourceId: config.sourceId ?? "synthetic-tracking-1",
      seed: config.seed,
      tickCount,
      rateMs,
      startEventTimeMs: config.startEventTimeMs ?? 0,
      playersPerTeam,
      referees,
      baseLatencyMs,
      scenario,
    };
    this.roster = buildScriptedRoster({
      seed: this.config.seed,
      playersPerTeam,
      referees,
    });
    this.plan = buildDeliveryPlan({
      seed: this.config.seed,
      scenario,
      rateMs,
      tickCount,
      baseLatencyMs,
    });
    this.metadata = {
      sourceId: this.config.sourceId,
      adapterId: LIVE_SOURCE_ADAPTER_ID,
      adapterVersion: LIVE_SOURCE_ADAPTER_VERSION,
      sourceKind: "synthetic-deterministic",
      supportedRateHz: Math.round((1000 / rateMs) * 1000) / 1000,
      coordinateSystem:
        "sporta-canonical-pitch-meters (105 x 68, corner origin, x=touchline, y=goal-line)",
      capabilities: [...LIVE_SCENARIO_KINDS],
      provenance:
        "deterministic synthetic tracking over a scripted match model (seeded; no real-match data)",
      licenseDataUse: "synthetic — Sporta-authored script, no third-party data rights involved",
      authenticationMode: "none",
      latencyProfile: {
        baseLatencyMs,
        note: `scenario '${scenario.kind}' distorts delivery per its configuration`,
      },
      dropoutClasses:
        scenario.kind === "drop"
          ? ["scattered-drop"]
          : scenario.kind === "reconnect"
            ? ["reconnect-window"]
            : [],
      reconnectBehavior:
        "explicit gap accounting on the first post-reconnect observation (recovery member) + a degraded-quality recovery window; never smoothed",
    };
  }

  /** The tick's event time (ms on the session timeline). */
  private eventTimeOf(tick: number): number {
    return this.config.startEventTimeMs + tick * this.config.rateMs;
  }

  /** Whether a tick sits inside the post-reconnect degraded window. */
  private isDegraded(tick: number): boolean {
    const window = this.plan.degradedWindow;
    return window !== null && tick >= window.fromTick && tick <= window.toTick;
  }

  /** Advances the contiguous frontier over delivered + accounted ticks. */
  private advanceFrontier(): void {
    while (
      this.frontier + 1 < this.config.tickCount &&
      (this.delivered.has(this.frontier + 1) ||
        this.plan.dispositions[this.frontier + 1] !== "delivered")
    ) {
      this.frontier += 1;
    }
  }

  next(): LiveObservation | null {
    if (this.closed) return null;
    if (this.nextEmissionIndex >= this.plan.emissions.length) return null;
    const planned = this.plan.emissions[this.nextEmissionIndex]!;
    this.nextEmissionIndex += 1;

    const tick = planned.tick;
    const eventTimeMs = this.eventTimeOf(tick);
    const degraded = this.isDegraded(tick);
    const entityObservations = observeRosterAtTick({
      roster: this.roster,
      tick,
      eventTimeMs,
      degraded,
      lastKnown: this.lastKnown,
    });
    // Update the last-known-DETECTED map (the honest carry source).
    for (const observation of entityObservations) {
      if (observation.detected) {
        this.lastKnown.set(observation.entityRef, observation);
      }
    }
    this.delivered.add(tick);
    this.advanceFrontier();

    const quality: LiveObservationQuality = degraded ? "degraded" : "nominal";
    const watermarkMs = this.frontier >= 0 ? this.eventTimeOf(this.frontier) : 0;
    const observation: LiveObservation = {
      schemaVersion: "sporta.live-observation/1",
      sessionId: this.config.sessionId,
      sourceId: this.config.sourceId,
      sourceType: "TRACKING",
      sequence: tick + 1,
      eventTimeMs,
      ingestTimeMs: eventTimeMs + planned.ingestOffsetMs,
      watermark: { watermarkMs, sequence: this.frontier + 1 },
      entityObservations,
      confidence: batchConfidenceOf(entityObservations),
      provenance: "DERIVED",
      quality,
      ...(planned.recovery !== undefined
        ? {
            recovery: {
              reason: "reconnect" as const,
              fromSequence: planned.recovery.fromTick + 1,
              toSequence: planned.recovery.toTick + 1,
              missedUpdates: planned.recovery.toTick - planned.recovery.fromTick + 1,
              gapDurationMs:
                this.eventTimeOf(planned.recovery.toTick) -
                this.eventTimeOf(planned.recovery.fromTick) +
                this.config.rateMs,
            },
          }
        : {}),
    };
    // The self-check: every emission parses against the frozen-shaped
    // contract (a bug in the script is a loud failure, never drift).
    const validated = parseLiveObservation(observation);

    this.statsState.emitted += 1;
    if (degraded) this.statsState.degraded += 1;
    if (planned.recovery !== undefined) this.statsState.reconnects += 1;
    this.statsState.undetected += entityObservations.filter((row) => !row.detected).length;
    this.statsState.lastEventTimeMs = eventTimeMs;
    this.statsState.lastWatermarkMs = watermarkMs;
    const pulledIngestMs = eventTimeMs + planned.ingestOffsetMs;
    if (this.statsState.firstPulledIngestMs === null) {
      this.statsState.firstPulledIngestMs = pulledIngestMs;
    }
    this.statsState.lastPulledIngestMs = pulledIngestMs;
    return validated;
  }

  plannedIngestTimeMs(): number | null {
    if (this.closed || this.nextEmissionIndex >= this.plan.emissions.length) return null;
    const planned = this.plan.emissions[this.nextEmissionIndex]!;
    return this.eventTimeOf(planned.tick) + planned.ingestOffsetMs;
  }

  stats(): LiveSourceStats {
    const dispositions = this.plan.dispositions;
    let droppedTicks = 0;
    let reconnectGapTicks = 0;
    let maxConsecutiveMisses = 0;
    let currentRun = 0;
    for (const disposition of dispositions) {
      if (disposition === "dropped") droppedTicks += 1;
      if (disposition === "gap") reconnectGapTicks += 1;
      if (disposition === "delivered") {
        currentRun = 0;
      } else {
        currentRun += 1;
        if (currentRun > maxConsecutiveMisses) maxConsecutiveMisses = currentRun;
      }
    }
    // Ingest stamps of DELIVERED observations only (null before any).
    const firstIngestTimeMs = this.statsState.firstPulledIngestMs;
    const lastIngestTimeMs = this.statsState.lastPulledIngestMs;
    const spanMs =
      firstIngestTimeMs !== null &&
      lastIngestTimeMs !== null &&
      lastIngestTimeMs > firstIngestTimeMs
        ? lastIngestTimeMs - firstIngestTimeMs
        : null;
    return {
      plannedTicks: this.config.tickCount,
      emitted: this.statsState.emitted,
      droppedTicks,
      reconnectGapTicks,
      reconnects: this.statsState.reconnects,
      maxConsecutiveMisses,
      firstIngestTimeMs,
      lastIngestTimeMs,
      effectiveEmissionRateHz:
        spanMs !== null && this.statsState.emitted > 1
          ? // The mean inter-arrival rate: (n-1) updates across the span
            // between the first and last delivery — honest for bursty and
            // gapped plans alike.
            Math.round(((this.statsState.emitted - 1) / (spanMs / 1000)) * 1000) / 1000
          : null,
      watermarkLagMs:
        this.statsState.lastEventTimeMs !== null
          ? this.statsState.lastEventTimeMs - this.statsState.lastWatermarkMs
          : 0,
      degradedObservations: this.statsState.degraded,
      undetectedEntityObservations: this.statsState.undetected,
      exhausted: this.closed || this.nextEmissionIndex >= this.plan.emissions.length,
    };
  }

  close(): void {
    this.closed = true;
  }
}

/** Creates the deterministic synthetic/replay live source (L002). */
export function createDeterministicLiveSource(
  config: DeterministicLiveSourceConfig,
): DeterministicLiveSource {
  return new DeterministicLiveSource(config);
}

/** Convenience: drains up to `max` observations (tests + wave-2 bridges). */
export function drainSource(
  source: LiveSourcePort,
  max = Number.POSITIVE_INFINITY,
): LiveObservation[] {
  const out: LiveObservation[] = [];
  for (let i = 0; i < max; i += 1) {
    const observation = source.next();
    if (observation === null) break;
    out.push(observation);
  }
  return out;
}

export { LIVE_OBSERVATION_QUALITIES };
