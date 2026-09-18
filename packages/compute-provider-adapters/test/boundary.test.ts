/**
 * The package's constitution boundary scan (R402-R405), mirroring the
 * `@sporta/compute-adapter` / `@sporta/compute-adapter-hosted` boundary
 * tests: the DOMAIN modules (`src/common`, `src/modal`, `src/lightning`,
 * `src/runpod`, `src/local`) must read no wall clock, use no randomness,
 * and touch no `process.env` — everything (clock, credentials, transport,
 * sleep) is INJECTED. `src/env.ts` is the documented COMPOSITION-ROOT
 * exception (it reads `process.env` BY DESIGN) and is scanned for the
 * randomness ban only.
 *
 * The second constitution pin — the license/provenance rule — scans every
 * domain import: ONLY `@sporta/*` workspace packages, relative modules,
 * and `zod`. NO provider SDK, no vendored client code, no HTTP framework:
 * these adapters are Sporta-authored thin clients over documented public
 * REST APIs (plain `fetch`), and the scan has teeth so that never drifts.
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..", "src");

/** All .ts source files under src/ (recursively — the per-provider dirs). */
function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts")) files.push(path);
    }
  };
  walk(SRC);
  return files;
}

describe("boundary — the package constitution (teeth)", () => {
  it("the DOMAIN modules read no clock, no randomness, no env", () => {
    const domain = sourceFiles().filter((file) => !file.endsWith("env.ts"));
    expect(domain.length).toBeGreaterThanOrEqual(12);
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
    expect(source).not.toMatch(/\b(?:Date\.now|performance\.now|new Date)\s*\(/);
    // The env read is the documented, deliberate composition decision.
    expect(source).toContain("process.env");
  });

  it("NO provider SDK, no vendored client code: imports are @sporta/*, relative, or zod ONLY (plain fetch)", () => {
    const domain = sourceFiles().filter((file) => !file.endsWith("env.ts"));
    for (const file of domain) {
      const source = readFileSync(file, "utf8");
      const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
      for (const specifier of imports) {
        expect(
          specifier.startsWith("@sporta/") ||
            specifier.startsWith("./") ||
            specifier.startsWith("../") ||
            specifier === "zod",
          `${file} imports an unexpected dependency '${specifier}' (no provider SDKs, no vendored clients, no frameworks — plain fetch only)`,
        ).toBe(true);
      }
    }
  });

  it("no credential VALUE is ever embedded in the package source (fixtures use markers)", () => {
    // The fixture transport redacts; the source itself must carry no
    // credential-looking literals beyond the documented env NAMES.
    const domain = sourceFiles();
    for (const file of domain) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} must not embed credential literals`).not.toMatch(
        /(?:sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16,}|ghp_[A-Za-z0-9]{20,})/,
      );
    }
  });
});
