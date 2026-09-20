/**
 * THE LIVE SCENARIOS (L002) — the CONFIGURABLE delivery distortions the
 * deterministic source can replay: normal, jitter, delay, drop,
 * out-of-order and reconnect — each a DATA configuration (never code
 * branches hidden in the source), each replayable byte-identically from
 * the same (seed, scenario, tickCount).
 *
 * THE DELIVERY PLAN MODEL: every scenario compiles to an ordered list of
 * {@link PlannedEmission}s — the ARRIVAL order the consumer sees, each
 * with its own per-tick ingest offset (`ingestTimeMs = eventTimeMs(tick) +
 * offset`). This keeps the scenarios ISOLATED by construction:
 *
 * - `normal` — every tick, constant base latency, perfectly regular;
 * - `jitter` — irregular inter-arrival (a bounded sender-schedule jitter,
 *   validated `jitterMaxMs < rateMs`, so arrival ORDER is preserved —
 *   jitter exercises irregular pacing, not reordering);
 * - `delay` — a contiguous delay WINDOW whose updates all arrive late
 *   (`+delayMs`), in order, followed by the natural catch-up burst —
 *   delayed updates exercise latency and watermark lag, not reordering;
 * - `drop` — scattered per-tick drops (seeded draw, rate-bounded): VISIBLE
 *   sequence gaps, counted, never smoothed over;
 * - `out-of-order` — explicit adjacent swaps (bounded reorder depth of ONE
 *   tick — the reorder-window stress): the overtaking update arrives at
 *   its normal time, the overtaken one `+reorderPenaltyMs` later, so
 *   arrival order matches ingest-stamp order;
 * - `reconnect` — ONE contiguous dropout window (source drop → reconnect →
 *   resume): the missed window is NEVER emitted, and the FIRST update
 *   after the reconnect carries explicit gap accounting (the additive
 *   `recovery` member) plus a short degraded-quality recovery window.
 *
 * DROPPED/MISSING TICKS ARE ACCOUNTED, NEVER SMOOTHED: the plan marks
 * every tick as delivered, dropped (scattered) or gap (reconnect window),
 * so the source's watermark can advance past accounted misses (it
 * guarantees no further observation will arrive for them) while NEVER
 * advancing past an undelivered tick of an out-of-order swap.
 *
 * PURITY: no clock, no env, no I/O, no unseeded randomness.
 */
import { substreamSeed } from "./prng";

/** The closed scenario vocabulary (each member is a deliverable behavior). */
export const LIVE_SCENARIO_KINDS = [
  "normal",
  "jitter",
  "delay",
  "drop",
  "out-of-order",
  "reconnect",
] as const;
export type LiveScenarioKind = (typeof LIVE_SCENARIO_KINDS)[number];

/** One scenario configuration (DATA — validated by {@link validateScenario}). */
export interface LiveScenarioConfig {
  kind: LiveScenarioKind;
  /** Jitter: the max sender-schedule jitter (ms); MUST be < rateMs. */
  jitterMaxMs?: number;
  /** Delay: the first tick of the delay window (0-based). */
  delayAtTick?: number;
  /** Delay: the window's length in ticks. */
  delayWindowTicks?: number;
  /** Delay: the extra latency every window update arrives with (ms). */
  delayMs?: number;
  /** Drop: the per-tick drop probability in [0, 0.5] (bounded honesty). */
  dropRate?: number;
  /** Out-of-order: the probability an adjacent pair is swapped. */
  swapRate?: number;
  /** Out-of-order: the overtaken update's extra delay (ms). */
  reorderPenaltyMs?: number;
  /** Reconnect: the first tick of the dropout window (0-based). */
  reconnectAtTick?: number;
  /** Reconnect: the dropout window's length in ticks (missed updates). */
  reconnectGapTicks?: number;
  /** Reconnect: post-reconnect degraded-quality window (ticks). */
  recoveryWindowTicks?: number;
}

/** The defaults (every knob documented + bounded). */
export const LIVE_SCENARIO_DEFAULTS = {
  jitterMaxMs: 60,
  delayAtTick: 30,
  delayWindowTicks: 5,
  delayMs: 1500,
  dropRate: 0.15,
  swapRate: 0.25,
  reorderPenaltyMs: 200,
  reconnectAtTick: 40,
  reconnectGapTicks: 8,
  recoveryWindowTicks: 3,
} as const;

/** A malformed scenario configuration (fail-loud, never silent defaults). */
export class LiveScenarioValidationError extends Error {
  constructor(issues: readonly string[]) {
    super(`live scenario configuration failed validation: ${issues.join("; ")}`);
    this.name = "LiveScenarioValidationError";
  }
}

/** Validates one scenario config against its kind's bounds. */
export function validateScenario(
  config: LiveScenarioConfig,
  rateMs: number,
  tickCount: number,
): void {
  const issues: string[] = [];
  switch (config.kind) {
    case "normal":
      break;
    case "jitter": {
      const jitterMaxMs = config.jitterMaxMs ?? LIVE_SCENARIO_DEFAULTS.jitterMaxMs;
      if (!(jitterMaxMs > 0) || jitterMaxMs >= rateMs) {
        issues.push(
          `jitterMaxMs (${jitterMaxMs}) must be > 0 and < rateMs (${rateMs}) — jitter exercises irregular inter-arrival WITHOUT reordering (use out-of-order for reordering)`,
        );
      }
      break;
    }
    case "delay": {
      const at = config.delayAtTick ?? LIVE_SCENARIO_DEFAULTS.delayAtTick;
      const window = config.delayWindowTicks ?? LIVE_SCENARIO_DEFAULTS.delayWindowTicks;
      const delayMs = config.delayMs ?? LIVE_SCENARIO_DEFAULTS.delayMs;
      if (!Number.isInteger(at) || at < 0 || at >= tickCount) {
        issues.push(`delayAtTick (${at}) must be an integer in [0, ${tickCount - 1}]`);
      }
      if (!Number.isInteger(window) || window < 1) {
        issues.push(`delayWindowTicks (${window}) must be an integer >= 1`);
      }
      if (!(delayMs > 0)) issues.push(`delayMs (${delayMs}) must be > 0`);
      break;
    }
    case "drop": {
      const dropRate = config.dropRate ?? LIVE_SCENARIO_DEFAULTS.dropRate;
      if (!(dropRate > 0) || dropRate > 0.5) {
        issues.push(
          `dropRate (${dropRate}) must be in (0, 0.5] — drops are bounded honesty, never a flood`,
        );
      }
      break;
    }
    case "out-of-order": {
      const swapRate = config.swapRate ?? LIVE_SCENARIO_DEFAULTS.swapRate;
      const penalty = config.reorderPenaltyMs ?? LIVE_SCENARIO_DEFAULTS.reorderPenaltyMs;
      if (!(swapRate > 0) || swapRate > 0.5) {
        issues.push(
          `swapRate (${swapRate}) must be in (0, 0.5] — bounded reorder-window stress, never a shuffle`,
        );
      }
      if (!(penalty > 0)) issues.push(`reorderPenaltyMs (${penalty}) must be > 0`);
      break;
    }
    case "reconnect": {
      const at = config.reconnectAtTick ?? LIVE_SCENARIO_DEFAULTS.reconnectAtTick;
      const gap = config.reconnectGapTicks ?? LIVE_SCENARIO_DEFAULTS.reconnectGapTicks;
      const recovery = config.recoveryWindowTicks ?? LIVE_SCENARIO_DEFAULTS.recoveryWindowTicks;
      if (!Number.isInteger(at) || at < 0 || at >= tickCount) {
        issues.push(`reconnectAtTick (${at}) must be an integer in [0, ${tickCount - 1}]`);
      }
      if (!Number.isInteger(gap) || gap < 1) {
        issues.push(`reconnectGapTicks (${gap}) must be an integer >= 1`);
      }
      if (!Number.isInteger(recovery) || recovery < 0) {
        issues.push(`recoveryWindowTicks (${recovery}) must be an integer >= 0`);
      }
      break;
    }
  }
  if (issues.length > 0) throw new LiveScenarioValidationError(issues);
}

/** How one tick's delivery was classified (the accounted-miss model). */
export type TickDisposition = "delivered" | "dropped" | "gap";

/** One planned arrival in the delivery plan (arrival order = array order). */
export interface PlannedEmission {
  /** The 0-based tick this arrival delivers. */
  tick: number;
  /** The per-tick ingest offset: `ingestTimeMs = eventTimeMs(tick) + offset`. */
  ingestOffsetMs: number;
  /**
   * Present ONLY on the first arrival after a reconnect window: the
   * inclusive missed tick window (0-based) the recovery accounts.
   */
  recovery?: { fromTick: number; toTick: number };
}

/** The compiled delivery plan (pure data — the source walks it). */
export interface DeliveryPlan {
  /** The arrivals, in ARRIVAL order. */
  emissions: readonly PlannedEmission[];
  /** Per-tick disposition (indexed by tick). */
  dispositions: readonly TickDisposition[];
  /** The reconnect window, when the scenario has one (inclusive, 0-based). */
  reconnectWindow: { fromTick: number; toTick: number } | null;
  /** The post-reconnect degraded-quality window (inclusive, 0-based) or null. */
  degradedWindow: { fromTick: number; toTick: number } | null;
}

/** A deterministic uniform draw for one (seed, salt, tick) — stable per tick. */
function drawFor(seed: number, salt: number, tick: number): number {
  // A fresh stream per (seed, salt, tick): the draw is independent of call
  // order and of every other tick — pure per-tick determinism.
  let state = substreamSeed(substreamSeed(seed, salt), tick + 1);
  state = (state + 0x9e3779b9) >>> 0;
  let mixed = state;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97) >>> 0;
  mixed = (mixed ^ (mixed >>> 15)) >>> 0;
  return mixed / 0x1_0000_0000;
}

/**
 * Compiles one scenario into its delivery plan — a PURE function of
 * (seed, scenario, rateMs, tickCount). Same inputs → byte-identical plan.
 */
export function buildDeliveryPlan(input: {
  seed: number;
  scenario: LiveScenarioConfig;
  rateMs: number;
  tickCount: number;
  baseLatencyMs: number;
}): DeliveryPlan {
  const { seed, scenario, rateMs, tickCount, baseLatencyMs } = input;
  validateScenario(scenario, rateMs, tickCount);
  const dispositions: TickDisposition[] = Array.from({ length: tickCount }, () => "delivered");
  const emissions: PlannedEmission[] = [];

  switch (scenario.kind) {
    case "normal": {
      for (let tick = 0; tick < tickCount; tick += 1) {
        emissions.push({ tick, ingestOffsetMs: baseLatencyMs });
      }
      break;
    }
    case "jitter": {
      const jitterMaxMs = scenario.jitterMaxMs ?? LIVE_SCENARIO_DEFAULTS.jitterMaxMs;
      for (let tick = 0; tick < tickCount; tick += 1) {
        const jitter = drawFor(seed, 71_000, tick) * jitterMaxMs;
        // Floor: the offset stays in [base, base + jitterMax) after rounding.
        emissions.push({ tick, ingestOffsetMs: baseLatencyMs + Math.floor(jitter) });
      }
      break;
    }
    case "delay": {
      const at = scenario.delayAtTick ?? LIVE_SCENARIO_DEFAULTS.delayAtTick;
      const window = scenario.delayWindowTicks ?? LIVE_SCENARIO_DEFAULTS.delayWindowTicks;
      const delayMs = scenario.delayMs ?? LIVE_SCENARIO_DEFAULTS.delayMs;
      for (let tick = 0; tick < tickCount; tick += 1) {
        const delayed = tick >= at && tick < at + window;
        emissions.push({
          tick,
          ingestOffsetMs: baseLatencyMs + (delayed ? delayMs : 0),
        });
      }
      break;
    }
    case "drop": {
      const dropRate = scenario.dropRate ?? LIVE_SCENARIO_DEFAULTS.dropRate;
      for (let tick = 0; tick < tickCount; tick += 1) {
        if (drawFor(seed, 72_000, tick) < dropRate) {
          dispositions[tick] = "dropped";
          continue; // never emitted — the sequence gap IS the signal
        }
        emissions.push({ tick, ingestOffsetMs: baseLatencyMs });
      }
      break;
    }
    case "out-of-order": {
      const swapRate = scenario.swapRate ?? LIVE_SCENARIO_DEFAULTS.swapRate;
      const penalty = scenario.reorderPenaltyMs ?? LIVE_SCENARIO_DEFAULTS.reorderPenaltyMs;
      let tick = 0;
      while (tick < tickCount) {
        const next = tick + 1;
        const swap = next < tickCount && drawFor(seed, 73_000, tick) < swapRate;
        if (swap) {
          // The overtaking update arrives FIRST at its normal offset; the
          // overtaken one arrives `penalty` later (arrival order matches
          // the ingest stamps — a real reorder, bounded to depth ONE).
          emissions.push({ tick: next, ingestOffsetMs: baseLatencyMs });
          emissions.push({ tick, ingestOffsetMs: baseLatencyMs + penalty });
          tick = next + 1;
          continue;
        }
        emissions.push({ tick, ingestOffsetMs: baseLatencyMs });
        tick += 1;
      }
      break;
    }
    case "reconnect": {
      const at = scenario.reconnectAtTick ?? LIVE_SCENARIO_DEFAULTS.reconnectAtTick;
      const gap = scenario.reconnectGapTicks ?? LIVE_SCENARIO_DEFAULTS.reconnectGapTicks;
      const recoveryTicks =
        scenario.recoveryWindowTicks ?? LIVE_SCENARIO_DEFAULTS.recoveryWindowTicks;
      const fromTick = at;
      const toTick = Math.min(at + gap - 1, tickCount - 1);
      for (let tick = 0; tick < tickCount; tick += 1) {
        if (tick >= fromTick && tick <= toTick) {
          dispositions[tick] = "gap"; // missed to the reconnect window
          continue;
        }
        const firstAfter = tick === toTick + 1;
        emissions.push({
          tick,
          ingestOffsetMs: baseLatencyMs,
          ...(firstAfter ? { recovery: { fromTick, toTick } } : {}),
        });
      }
      const degradedFrom = toTick + 1;
      const degradedTo = Math.min(toTick + recoveryTicks, tickCount - 1);
      return {
        emissions,
        dispositions,
        reconnectWindow: { fromTick, toTick },
        degradedWindow:
          recoveryTicks <= 0 || degradedFrom > degradedTo
            ? null
            : { fromTick: degradedFrom, toTick: degradedTo },
      };
    }
  }

  return {
    emissions,
    dispositions,
    reconnectWindow: null,
    degradedWindow: null,
  };
}
