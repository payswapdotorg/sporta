import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * THE REGRESSION TEST for the Node-runtime Bun shim's `Bun.which` (the R607
 * hosted acceptance fix).
 *
 * The hosted plane (Vercel) runs the app on the **Node** runtime, where the
 * `Bun` global does not exist; `src/instrumentation-node.ts` installs the
 * compatibility shim at server boot. The R306/R508 encode-toolchain probes
 * and the media/decoding adapters resolve their ffmpeg/ffprobe binaries
 * through `Bun.which` — before the shim covered it, EVERY API route on the
 * hosted deployment crashed at composition boot with
 * `TypeError: Bun.which is not a function` (measured on deployment
 * dpl_6s7jN8Y8AGNAwM7j1qdMYVyBV26X, 2026-09-26 — the R607 finding).
 *
 * The suite proves the NODE SHAPE without mutating the real (read-only under
 * Bun) global: `installBunCompatShim` installs onto a plain holder object
 * exactly as `register()` installs onto `globalThis` on the hosted server,
 * and `which` is exercised over a CONTROLLED PATH with a real executable
 * file:
 *
 * - an executable file on PATH resolves to its absolute path;
 * - a non-executable file, an absent name and absolute misses return `null`
 *   (the honest not-found the adapters' own guards translate into typed
 *   binary-unavailable states);
 * - an absolute executable input resolves to itself;
 * - the shim's other documented members still install (CryptoHasher hashing
 *   is byte-checked so a future edit cannot silently drop it);
 * - a holder that already carries a Bun global is left untouched (the
 *   "real Bun — nothing to shim" rule).
 */
describe("instrumentation-node Bun shim (the hosted Node-runtime shape)", () => {
  const realPath = process.env.PATH;
  let scratch = "";
  let exe = "";
  let notExe = "";
  /** The installed shim under test (a plain holder — never globalThis). */
  let shim: {
    which(command: string): string | null;
    CryptoHasher: new (algorithm: string) => {
      update(data: Uint8Array | string): unknown;
      digest(encoding: string): string;
    };
    env: Record<string, string | undefined>;
    password: { hash(password: string): Promise<string> };
    serve(...args: never[]): never;
  };

  beforeAll(async () => {
    const { installBunCompatShim } = await import("../src/instrumentation-node");
    const holder: { Bun?: unknown } = {};
    const installed = installBunCompatShim(holder);
    expect(installed).toBe(true);
    shim = holder.Bun as typeof shim;

    scratch = mkdtempSync(join(tmpdir(), "sporta-which-shim-"));
    exe = join(scratch, "sporta-which-probe");
    writeFileSync(exe, "#!/bin/sh\nexit 0\n");
    chmodSync(exe, 0o755);
    notExe = join(scratch, "sporta-which-plain-file");
    writeFileSync(notExe, "not executable\n");
    chmodSync(notExe, 0o644);
    // A controlled PATH: the scratch dir FIRST (deterministic), the rest kept.
    process.env.PATH = `${scratch}${delimiter}${realPath ?? ""}`;
  });

  afterAll(() => {
    if (realPath !== undefined) process.env.PATH = realPath;
    if (scratch !== "") rmSync(scratch, { recursive: true, force: true });
  });

  test("installBunCompatShim installs Bun.which on the Node shape (the R607 regression)", () => {
    expect(typeof shim.which).toBe("function");
  });

  test("which resolves an executable file on PATH to its absolute path", () => {
    expect(shim.which("sporta-which-probe")).toBe(exe);
  });

  test("which returns null for the honest not-found cases", () => {
    // A present-but-not-executable file is NOT a command.
    expect(shim.which("sporta-which-plain-file")).toBeNull();
    // An absent name.
    expect(shim.which("no-such-command-anywhere-r607")).toBeNull();
    // An absolute path that exists but is not executable.
    expect(shim.which(notExe)).toBeNull();
    // An absolute path that does not exist.
    expect(shim.which(join(scratch, "no-such-binary"))).toBeNull();
    // The degenerate empty input.
    expect(shim.which("")).toBeNull();
  });

  test("which resolves an absolute executable input to itself", () => {
    expect(shim.which(exe)).toBe(exe);
  });

  test("the shim's other documented members still install (shape pin)", () => {
    // CryptoHasher stays byte-correct (the output pipeline's content ids).
    const hasher = new shim.CryptoHasher("sha256");
    hasher.update("r607");
    expect(hasher.digest("hex")).toBe(
      "5b35de8301251001e28025f9d2f0e94a3af252d8c208026b18930c36022f176a",
    );
    expect(shim.env).toBe(process.env);
    expect(typeof shim.password.hash).toBe("function");
    expect(typeof shim.serve).toBe("function");
    // The loud stubs keep their contract: reaching them throws with the reason.
    expect(() => shim.serve()).toThrow(/requires the Bun runtime/);
  });

  test("a holder that already carries a Bun global is left untouched", async () => {
    const { installBunCompatShim } = await import("../src/instrumentation-node");
    const sentinel = { which: () => "the-real-one" };
    const holder: { Bun?: unknown } = { Bun: sentinel };
    expect(installBunCompatShim(holder)).toBe(false);
    expect(holder.Bun).toBe(sentinel); // never replaced by the shim
  });

  test("register() on the real Bun runtime is a no-op (never replaces the real global)", async () => {
    const { register } = await import("../src/instrumentation-node");
    const before = (globalThis as { Bun?: unknown }).Bun;
    await register();
    expect((globalThis as { Bun?: unknown }).Bun).toBe(before);
  });
});
