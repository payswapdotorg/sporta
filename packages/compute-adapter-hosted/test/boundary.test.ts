/**
 * The hosted package's constitution boundary scan (W914 Wave 2), mirroring
 * `@sporta/compute-adapter`'s boundary test: the DOMAIN modules
 * (executor/worker/adapter/envelope/budgets/http) must contain no wall-clock
 * reads, no randomness, and no process/env access — everything is injected.
 * `env.ts` is the documented COMPOSITION-ROOT exception (it reads
 * `process.env` and injects the real clock BY DESIGN) and is therefore
 * scanned for the randomness ban only.
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "../src");

/** All non-test source files under src/. */
function sourceFiles(): string[] {
  return readdirSync(SRC)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(SRC, name));
}

describe("boundary — the package constitution (teeth)", () => {
  it("the DOMAIN modules read no clock, no randomness, no env", () => {
    const domain = sourceFiles().filter((file) => !file.endsWith("env.ts"));
    expect(domain.length).toBeGreaterThanOrEqual(6);
    for (const file of domain) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} must not read the wall clock`).not.toMatch(
        /\b(?:Date\.now|performance\.now|new Date)\s*\(/,
      );
      expect(source, `${file} must not use randomness`).not.toMatch(
        /\b(?:Math\.random|crypto\.randomUUID)\s*\(/,
      );
      expect(source, `${file} must not touch process.env`).not.toMatch(/\bprocess\.env\b/);
    }
  });

  it("the composition root (env.ts) injects rather than leaks randomness", () => {
    const source = readFileSync(join(SRC, "env.ts"), "utf8");
    expect(source).not.toMatch(/\bMath\.random\s*\(/);
    // The env read is the documented, deliberate composition decision.
    expect(source).toContain("process.env");
  });

  it("the domain modules import zod/contracts only through package seams (no bun:sqlite, no node builtins)", () => {
    const domain = sourceFiles().filter((file) => !file.endsWith("env.ts"));
    for (const file of domain) {
      const source = readFileSync(file, "utf8");
      const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
      for (const specifier of imports) {
        expect(
          specifier.startsWith("@sporta/") || specifier.startsWith("./") || specifier === "zod",
          `${file} imports an unexpected dependency '${specifier}'`,
        ).toBe(true);
      }
    }
  });
});
