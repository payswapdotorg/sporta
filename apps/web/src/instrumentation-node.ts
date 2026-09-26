/**
 * SERVER BOOTSTRAP — the Node-runtime Bun-compatibility shim (W911 fix,
 * extended by the R607 hosted acceptance: `Bun.which`).
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
 *   fails with the reason instead of a silent wrong behavior;
 * - `Bun.which` — backed by `node:fs` + the process PATH (the R306/R508
 *   encode-toolchain probes and the media/decoding adapters resolve their
 *   ffmpeg/ffprobe binaries through `Bun.which`; without the shim the
 *   composition CRASHED at boot on the Node runtime with
 *   "Bun.which is not a function" — the R607 hosted defect). Same lookup
 *   semantics as the real API for the subset the composed packages use:
 *   an executable regular file on PATH → its absolute path, else null;
 *   an absolute input is checked directly. (POSIX PATH scan — the hosted
 *   plane is Linux; local dev runs the real Bun global.)
 */
import { createHash, type BinaryToTextEncoding } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { accessSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

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
  /** Bun.which's PATH resolution (see the module doc — the R607 addition). */
  which(command: string): string | null;
}

/** Whether `path` is an executable regular file (the `X_OK` check). */
function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The Node-backed `Bun.which`: first executable regular file named
 * `command` on PATH (its absolute path), or `null`; an absolute `command`
 * is resolved directly. `null` is the honest "not found" — the callers'
 * own guards then surface the typed binary-unavailable states.
 */
function which(command: string): string | null {
  if (command.length === 0) return null;
  if (isAbsolute(command)) return isExecutableFile(command) ? command : null;
  const pathValue = process.env.PATH;
  if (pathValue === undefined || pathValue.length === 0) return null;
  for (const dir of pathValue.split(delimiter)) {
    if (dir.length === 0) continue;
    const candidate = join(dir, command);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

export async function register(): Promise<void> {
  installBunCompatShim(globalThis as { Bun?: unknown });
}

/**
 * Installs the shim onto `holder` when (and only when) no real Bun global
 * is present there. Returns whether it installed. Exported for the
 * regression test (`test/instrumentation-node-shim.test.ts`) so the NODE
 * shape is provable without mutating the (read-only, when real) global.
 */
export function installBunCompatShim(holder: { Bun?: unknown }): boolean {
  if (typeof holder.Bun !== "undefined") return false; // real Bun — nothing to shim.

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
    which,
  };
  holder.Bun = shim;
  return true;
}
