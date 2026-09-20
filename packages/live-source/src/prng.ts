/**
 * THE SEEDED PRNG (L002) — deterministic randomness for the match script and
 * the scenario delivery plans.
 *
 * splitmix32: a small, well-known integer mixer (public-domain algorithm;
 * this implementation is Sporta-authored). Chosen because:
 *
 * - it is a PURE function of state (same seed → same stream — the
 *   byte-identical replay requirement);
 * - it is tiny and dependency-free (the zero-dep rule);
 * - its output passes basic uniformity for simulation scripting (this is
 *   NOT a cryptographic primitive — the source never uses randomness for
 *   security, only for deterministic scenario scripting).
 *
 * PURITY: no clock, no env, no I/O. The caller seeds it; the same seed +
 * the same call sequence always yields the same stream.
 */

/** One deterministic PRNG stream (frozen once seeded). */
export interface SeededRandom {
  /** The next uniform uint32. */
  nextUint32(): number;
  /** The next uniform float in [0, 1). */
  nextFloat(): number;
  /** The next uniform float in [min, max). */
  nextFloatBetween(min: number, max: number): number;
  /** The next integer in [min, max] inclusive. */
  nextIntBetween(min: number, max: number): number;
}

/** The splitmix32 mixer step (32-bit). */
function mix(state: number): { state: number; value: number } {
  const next = (state + 0x9e3779b9) >>> 0;
  let mixed = next;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97) >>> 0;
  mixed = (mixed ^ (mixed >>> 15)) >>> 0;
  return { state: next, value: mixed };
}

/**
 * Creates one deterministic PRNG stream from a 32-bit seed. The seed is
 * normalized (`>>> 0`), so any integer seed is valid; `0` is a legitimate
 * seed (it does not degenerate — splitmix32's additive step breaks the
 * zero state on the first call).
 */
export function createSeededRandom(seed: number): SeededRandom {
  let state = seed >>> 0;
  return {
    nextUint32(): number {
      const step = mix(state);
      state = step.state;
      return step.value;
    },
    nextFloat(): number {
      return this.nextUint32() / 0x1_0000_0000;
    },
    nextFloatBetween(min: number, max: number): number {
      if (!(max > min)) {
        throw new Error(`seeded random: max (${max}) must be greater than min (${min})`);
      }
      return min + this.nextFloat() * (max - min);
    },
    nextIntBetween(min: number, max: number): number {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        throw new Error(`seeded random: [${min}, ${max}] is not a valid integer range`);
      }
      // Debiased modulo selection (the classic Java approach): reject the
      // tail that would skew the distribution, fall back to inclusive
      // mapping for tiny ranges.
      const range = max - min + 1;
      if (range > 0x1_0000_0000) {
        throw new Error(`seeded random: range ${range} exceeds uint32`);
      }
      const limit = Math.floor(0x1_0000_0000 / range) * range;
      let draw = this.nextUint32();
      while (draw >= limit) draw = this.nextUint32();
      return min + (draw % range);
    },
  };
}

/**
 * Derives a stable INDEPENDENT seed for a sub-stream (one per entity), so
 * per-entity scripting does not depend on stream call order beyond the
 * fixed derivation (still fully deterministic: same inputs → same seeds).
 */
export function substreamSeed(seed: number, index: number): number {
  const step = mix(seed >>> 0);
  return (step.value ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0;
}
