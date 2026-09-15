/**
 * The injected clock of the W801 evaluation harness.
 *
 * The repo constitution bans ambient clock reads (`Date.now`, `new Date()`,
 * `performance.now`) in every evaluated path — so the harness measures case
 * "timings" **in the injected clock domain only**:
 *
 * - {@link SuiteClock} is an injectable `now()` seam (the
 *   `SessionLifecycle({ now })` / `WorldModelEngine.create(..., { now })`
 *   precedent);
 * - the default {@link createStepClock} is a deterministic monotonic fake:
 *   it starts at an explicit epoch and advances by an explicit step on every
 *   read. Identical execution sequences therefore read identical values —
 *   deep-equal, byte-identical reports, cross-subprocess;
 * - **what the clock does NOT measure: real elapsed time.** A step-clock read
 *   is a deterministic ordinal of "how far the suite progressed", not a
 *   wall-clock duration — and that is the honest statement the report makes
 *   (see README §"Timings and the injected clock"). Real duration measurement
 *   would require a wall clock, which the constitution forbids; it is
 *   deliberately not attempted and not faked.
 */
import { TEST_EPOCH_MS } from "@sporta/testing";

/** The injectable clock seam (W801): reads are deterministic by contract. */
export interface SuiteClock {
  /** Returns the current injected-clock time in milliseconds. */
  now(): number;
}

/** The default epoch: the repo-wide deterministic test epoch (no invention). */
export const DEFAULT_CLOCK_EPOCH_MS: number = TEST_EPOCH_MS;

/** The default step: one clock read advances the clock by exactly 1 ms. */
export const DEFAULT_CLOCK_STEP_MS = 1;

/** Options for {@link createStepClock}. */
export interface StepClockOptions {
  /** The clock's initial value (the value of the FIRST read). */
  readonly epochMs: number;
  /** How far the clock advances on each read (must be finite and >= 0). */
  readonly stepMs: number;
}

/**
 * Creates the deterministic step clock (the harness default).
 *
 * `now()` returns the current value and then advances by `stepMs`: the first
 * read returns `epochMs` exactly, the second `epochMs + stepMs`, and so on.
 */
export function createStepClock(options: StepClockOptions): SuiteClock {
  const { epochMs, stepMs } = options;
  if (typeof epochMs !== "number" || !Number.isFinite(epochMs)) {
    throw new RangeError(`createStepClock: epochMs must be finite (got ${String(epochMs)})`);
  }
  if (typeof stepMs !== "number" || !Number.isFinite(stepMs) || stepMs < 0) {
    throw new RangeError(`createStepClock: stepMs must be finite and >= 0 (got ${String(stepMs)})`);
  }
  let current = epochMs;
  return {
    now(): number {
      const value = current;
      current += stepMs;
      return value;
    },
  };
}

/** The harness's default clock factory (a fresh deterministic clock per run). */
export function createDefaultClock(): SuiteClock {
  return createStepClock({ epochMs: DEFAULT_CLOCK_EPOCH_MS, stepMs: DEFAULT_CLOCK_STEP_MS });
}
