/**
 * Deterministic seeded randomness for the whole lab (REL-001..003).
 *
 * THE LAW: the lab NEVER touches `Math.random()`, `Date.now()` or any other
 * non-deterministic source inside a run. Every stochastic decision — player
 * waypoints, pass choices, source jitter, dropped frames, fault draws —
 * flows through a `LabRng` forked from a single master seed, so the same
 * (seed, configuration, inputs) always reproduces byte-identical records.
 *
 * Implementation: mulberry32 (32-bit state, integer arithmetic via
 * `Math.imul`, one division to [0, 1)) seeded through an FNV-1a 32 string
 * hash. Both are pure integer/float arithmetic with no platform-dependent
 * operations, so a stream is reproducible on any machine running the same
 * JS engine. `fork(label)` derives an independent substream per concern
 * (per player, per source, per fault kind) so adding one draw to one
 * concern never shifts another concern's stream.
 */

/** FNV-1a 32-bit string hash, with a final avalanche step. */
export function hashSeedToUint32(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Final avalanche (xorshift-multiply) so nearby seed strings diverge fast.
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The deterministic seed PRNG. Construct twice with the same seed → identical streams. */
export class LabRng {
  /** The seed key this stream was forked from (for re-derivation). */
  readonly seedKey: string;

  private state: number;
  private spareGaussian: number | null = null;

  constructor(seed: string | number) {
    this.seedKey = typeof seed === "number" ? `#int:${seed}` : seed;
    this.state = (typeof seed === "number" ? seed >>> 0 : hashSeedToUint32(seed)) || 0x9e3779b9;
  }

  /** Next raw 32-bit unsigned integer. */
  nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Next uniform float in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Next uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Next integer in [minInclusive, maxExclusive). */
  int(minInclusive: number, maxExclusive: number): number {
    if (maxExclusive <= minInclusive) throw new RangeError("LabRng.int: empty range");
    const span = maxExclusive - minInclusive;
    return minInclusive + Math.floor(this.next() * span);
  }

  /** True with probability `p` (default 1/2). */
  bool(p = 0.5): boolean {
    return this.next() < p;
  }

  /** A uniform pick from a non-empty readonly array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError("LabRng.pick: empty items");
    const index = this.int(0, items.length);
    const chosen = items[index];
    if (chosen === undefined) throw new RangeError("LabRng.pick: index out of range");
    return chosen;
  }

  /** Standard-normal draw (Box–Muller with a cached spare — stateful but deterministic). */
  normal(mu = 0, sigma = 1): number {
    if (this.spareGaussian !== null) {
      const spare = this.spareGaussian;
      this.spareGaussian = null;
      return mu + sigma * spare;
    }
    // u1 in (0, 1] (log-safe), u2 in [0, 1).
    const u1 = 1 - this.next();
    const u2 = this.next();
    const radius = Math.sqrt(-2 * Math.log(u1));
    const angle = 2 * Math.PI * u2;
    this.spareGaussian = radius * Math.sin(angle);
    return mu + sigma * (radius * Math.cos(angle));
  }

  /** An independent substream labeled by `label` (deterministic from this stream's seed key). */
  fork(label: string): LabRng {
    return new LabRng(`${this.seedKey}::${label}`);
  }
}
