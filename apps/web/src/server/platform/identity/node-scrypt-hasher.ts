/**
 * The Node-runtime password hasher for the hosted deployment (W910/W911).
 *
 * `@sporta/identity`'s REAL default hasher is `Bun.password` (argon2id) — the
 * Bun runtime's standard. Vercel runs the Next.js server on **Node**, where
 * the `Bun` global does not exist. The W902 port (`PasswordHasher`) exists
 * exactly for this swap: the hosted composition root injects THIS
 * node:crypto scrypt implementation instead, without touching the auth
 * semantics (verify is prefix-dispatched, so hashes from either runtime can
 * be verified by either runtime).
 *
 * Construction: scrypt (N=16384, r=8, p=1, 32-byte salt, 32-byte key) —
 * Node's standard memory-hard KDF. Stored format (versioned, self-describing):
 *   `scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>`
 * A hash with an unknown prefix FAILS CLOSED (verify returns false) — it is
 * never treated as valid.
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { PasswordHasher } from "@sporta/identity";

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const FORMAT_PREFIX = "scrypt";

/** The single-line stored-hash format (also asserted by integration tests). */
export function isNodeScryptHash(hash: string): boolean {
  return hash.startsWith(`${FORMAT_PREFIX}$`);
}

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, key) => {
      if (err !== null) reject(err);
      else resolve(key);
    });
  });
}

/** The Node-compatible hosted hasher (scrypt via node:crypto). */
export const nodeScryptPasswordHasher: PasswordHasher = {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(32);
    const key = await scryptAsync(password, salt);
    return [
      FORMAT_PREFIX,
      SCRYPT_N.toString(),
      SCRYPT_R.toString(),
      SCRYPT_P.toString(),
      salt.toString("base64"),
      key.toString("base64"),
    ].join("$");
  },

  async verify(password: string, hash: string): Promise<boolean> {
    const parts = hash.split("$");
    if (parts.length !== 6 || parts[0] !== FORMAT_PREFIX) return false;
    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (
      !Number.isInteger(n) ||
      n <= 0 ||
      !Number.isInteger(r) ||
      r <= 0 ||
      !Number.isInteger(p) ||
      p <= 0
    ) {
      return false;
    }
    let salt: Buffer;
    let expected: Buffer;
    try {
      salt = Buffer.from(parts[4]!, "base64");
      expected = Buffer.from(parts[5]!, "base64");
    } catch {
      return false;
    }
    if (salt.length === 0 || expected.length === 0) return false;
    const actual = await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, expected.length, { N: n, r, p }, (err, key) => {
        if (err !== null) reject(err);
        else resolve(key);
      });
    }).catch(() => null);
    if (actual === null) return false;
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  },
};
