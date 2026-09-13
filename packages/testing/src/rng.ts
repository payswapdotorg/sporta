/**
 * Seeded deterministic PRNG for the Sporta test harness (W003).
 *
 * Deterministic test data strategy: NO `Math.random` and NO `Date.now` in
 * tests. Every random draw comes from a seeded generator created here, and
 * every time value is an explicit millisecond number (see
 * docs/testing/HARNESS.md). Same seed in, same sequence out — deep-equal
 * across runs, machines, and CI.
 *
 * The implementation is mulberry32 (public domain, no dependencies): small,
 * fast, and good enough for fixture generation. It is NOT a
 * cryptographically secure generator and must never be used for anything
 * security-relevant.
 */

/** The default seed used by builders and sequences when none is given. */
export const DEFAULT_SEED = 1;

/**
 * Creates a mulberry32 generator: a function returning floats in [0, 1),
 * fully determined by `seed`.
 *
 * The 32-bit seed is normalized with `>>> 0`; JavaScript numbers outside the
 * unsigned 32-bit range collapse onto their low 32 bits (documented — pass
 * small non-negative integers or a `seedFromString` hash).
 */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derives a 32-bit seed from a string using the FNV-1a hash (1.32-bit
 * variant). Deterministic and stable across runs: the same string always
 * hashes to the same seed. Useful for naming seeds in tests
 * (`seedFromString("m0-e2e")`).
 *
 * The hash operates on UTF-16 code units (not bytes), which keeps it a pure
 * function of the JavaScript string value regardless of file encoding.
 */
export function seedFromString(s: string): number {
  let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis (2166136261)
  for (let i = 0; i < s.length; i += 1) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV-1a 32-bit prime (16777619)
  }
  return hash >>> 0;
}
