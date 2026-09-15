/**
 * The identity default clock + entropy (W902).
 *
 * Constitution (the repo-wide rule, e.g. `@sporta/viewer-shell`'s
 * default-clock.ts and `@sporta/control-api`'s deterministic clock): library
 * code never reads wall time or randomness directly — a CLOCK and an
 * ENTROPY SOURCE are injected. Production callers inject the real thing;
 * the deterministic defaults exist so unseeded runs stay reproducible
 * (docs/testing/HARNESS.md).
 *
 * The epoch constant is LOCAL (the viewer-shell pattern): it mirrors
 * `@sporta/testing`'s `TEST_EPOCH_MS` (`Date.parse("2025-01-06T12:00:00.000Z")`)
 * so the identity package carries no runtime dependency on the test-harness
 * package; `test/http.test.ts` pins the two equal so the mirror can never
 * drift.
 */

/**
 * The default epoch — the same instant as `@sporta/testing`'s TEST_EPOCH_MS.
 * Pinned equal by test.
 */
export const IDENTITY_DEFAULT_EPOCH_MS = 1_736_164_800_000;

/** Deterministic default clock: `IDENTITY_DEFAULT_EPOCH_MS + ticks`. */
export function createIdentityDefaultClock(): () => number {
  let ticks = 0;
  return (): number => IDENTITY_DEFAULT_EPOCH_MS + (ticks += 1);
}

/**
 * The entropy source port: `randomBytes(n)` returns exactly `n` bytes of
 * entropy. The default uses the platform WebCrypto
 * (`globalThis.crypto.getRandomValues` — real entropy in Bun and browsers);
 * tests inject deterministic sequences.
 */
export interface EntropySource {
  randomBytes(length: number): Uint8Array;
}

/** The default (real) entropy source. */
export const defaultEntropySource: EntropySource = {
  randomBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  },
};

/** A deterministic entropy source for tests: sequential bytes, wrapping at 251. */
export function createSequentialEntropySource(): EntropySource {
  let next = 0;
  return {
    randomBytes(length: number): Uint8Array {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) {
        bytes[i] = (next % 251) + 1; // 1..251, never a zero byte
        next += 1;
      }
      return bytes;
    },
  };
}
