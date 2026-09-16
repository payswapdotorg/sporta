/**
 * SERVER BOOTSTRAP — the Node-runtime Bun-compatibility shim (W911 fix).
 *
 * The engine packages the app composes (`@sporta/identity`,
 * `@sporta/output-pipeline`, …) are Bun-native: `@sporta/identity`'s REAL
 * password hasher calls `Bun.password` (only when that default is selected)
 * and the output pipeline's content addressing uses `Bun.CryptoHasher`. The
 * Bun globals exist when the server runs under Bun (local dev) — but the
 * hosted runtime is Vercel's **Node** server, where the `Bun` global does
 * not exist and those calls would crash the request.
 *
 * Next.js runs `register()` ONCE at server startup, BEFORE any route module
 * is evaluated — the ideal seam to install the smallest honest compatibility
 * layer when (and only when) the real Bun global is absent:
 *
 * - `Bun.CryptoHasher` — backed by `node:crypto` `createHash` (same
 *   update/digest shape) so the output pipeline's sha-256 content addressing
 *   produces byte-identical ids on both runtimes;
 * - `Bun.password` / `Bun.serve` — loud `throw` stubs: the hosted composition
 *   never selects the argon2 default (it injects the Node scrypt hasher via
 *   the W902 `PasswordHasher` port) and never starts a `Bun.serve` server
 *   (Next owns the HTTP surface). If either is ever reached, the request
 *   fails with the reason instead of a silent wrong behavior.
 */
import { createHash, type BinaryToTextEncoding } from "node:crypto";

/** What the shim installs (never a secret — names only). */
interface BunGlobalShape {
  CryptoHasher: new (algorithm: string) => {
    update(data: Uint8Array | string): unknown;
    digest(encoding: string): string;
  };
  password: {
    hash(password: string): Promise<string>;
    verify(password: string, hash: string): Promise<boolean>;
  };
  serve(...args: never[]): never;
  env: Record<string, string | undefined>;
}

export async function register(): Promise<void> {
  const holder = globalThis as { Bun?: unknown };
  if (typeof holder.Bun !== "undefined") return; // real Bun — nothing to shim.

  class CryptoHasher {
    readonly #hash: ReturnType<typeof createHash>;
    constructor(algorithm: string) {
      this.#hash = createHash(algorithm);
    }
    update(data: Uint8Array | string): this {
      this.#hash.update(data);
      return this;
    }
    digest(encoding: BinaryToTextEncoding): string {
      return this.#hash.digest(encoding);
    }
  }

  const bunRuntimeRequired = (what: string): never => {
    throw new Error(`${what} requires the Bun runtime — not available in this Node deployment`);
  };

  const shim: BunGlobalShape = {
    CryptoHasher,
    password: {
      async hash(): Promise<string> {
        return bunRuntimeRequired("Bun.password.hash (the argon2id default)");
      },
      async verify(): Promise<boolean> {
        return bunRuntimeRequired("Bun.password.verify (the argon2id default)");
      },
    },
    serve: () => bunRuntimeRequired("Bun.serve"),
    env: process.env,
  };
  holder.Bun = shim;
}
