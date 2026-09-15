/**
 * The password hasher port (W902).
 *
 * The REAL implementation is `Bun.password` — argon2id by default (the Bun
 * runtime's standard). Hashing is deliberately SLOW (memory-hard KDF); the
 * port exists so (a) tests can inject a fast deterministic hasher for the
 * high-volume HTTP round-trips, and (b) a hosted deployment (W910/W911)
 * can swap the construction without touching the auth semantics. Dedicated
 * tests pin the REAL argon2 path (hash → verify → wrong password denies).
 *
 * The port is async because every real password KDF is.
 */
/** Hashes plaintext passwords and verifies candidates against hashes. */
export interface PasswordHasher {
  /** Hashes a plaintext password (argon2id by default). */
  hash(password: string): Promise<string>;
  /** Verifies a candidate plaintext against a stored hash. */
  verify(password: string, hash: string): Promise<boolean>;
}

/**
 * The REAL hasher: `Bun.password.hash` (argon2id, the runtime default) and
 * `Bun.password.verify`. This is the production path; every account password
 * in the store is an argon2id string produced here.
 */
export const argon2PasswordHasher: PasswordHasher = {
  async hash(password: string): Promise<string> {
    return Bun.password.hash(password);
  },
  async verify(password: string, hash: string): Promise<boolean> {
    return Bun.password.verify(password, hash);
  },
};

/**
 * A deterministic, FAST test hasher (TEST-ONLY — never a deployment choice).
 *
 * `hash` = `"test$<fnv1a-64>"` — a non-cryptographic digest of the password:
 * the store still never contains the PLAINTEXT password (a pinned invariant),
 * verification is deterministic, and the whole HTTP round-trip suite runs
 * without paying argon2's ~tens-of-milliseconds cost per call. It is
 * obviously reversible by brute force — which is fine, because it only ever
 * runs inside `bun test`.
 */
export function createDeterministicTestHasher(): PasswordHasher {
  /** FNV-1a 64-bit over UTF-8 bytes (deterministic, no dependencies). */
  function fnv1a64(input: string): string {
    let hash = 0xcbf29ce484222325n;
    for (const byte of new TextEncoder().encode(input)) {
      hash ^= BigInt(byte);
      hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    return hash.toString(16).padStart(16, "0");
  }
  return {
    async hash(password: string): Promise<string> {
      return `test$${fnv1a64(password)}`;
    },
    async verify(password: string, hash: string): Promise<boolean> {
      return hash === `test$${fnv1a64(password)}`;
    },
  };
}
