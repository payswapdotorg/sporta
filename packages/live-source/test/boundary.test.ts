/**
 * THE PACKAGE CONSTITUTION BOUNDARY SCAN (L002) — the repo's pinned
 * purity conventions with teeth: the source package's modules must read NO
 * wall clock, use NO unseeded randomness, and touch NO environment —
 * everything (the ingest schedule, the scenario draws, the match script)
 * is deterministic DATA derived from the injected seed. The license scan
 * pins the zero-dependency posture (only `@sporta/*` workspace packages,
 * relative modules, and `zod`).
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..", "src");

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

describe("boundary — the L002 package constitution (teeth)", () => {
  it("src/ has the expected module set", () => {
    const files = sourceFiles().map((file) => file.slice(SRC.length + 1));
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  it("NO wall clock anywhere in src/ (the ingest schedule is plan DATA)", () => {
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} must not read the wall clock`).not.toMatch(
        /\b(?:Date\.now|performance\.now|new Date)\s*\(/,
      );
      expect(source, `${file} must not use timers`).not.toMatch(
        /\b(?:setTimeout|setInterval|queueMicrotask)\s*\(/,
      );
    }
  });

  it("NO unseeded randomness anywhere in src/", () => {
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} must not use unseeded randomness`).not.toMatch(
        /\b(?:Math\.random|crypto\.randomUUID|crypto\.getRandomValues)\s*\(/,
      );
    }
  });

  it("NO environment reads anywhere in src/ (composition-root rule)", () => {
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} must not touch process.env`).not.toMatch(/\bprocess\.env\b/);
      expect(source, `${file} must not touch Bun.env`).not.toMatch(/\bBun\.env\b/);
    }
  });

  it("NO network or filesystem I/O anywhere in src/ (pull-based, pure core)", () => {
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} must not fetch`).not.toMatch(/\bfetch\s*\(/);
      expect(source, `${file} must not import node:fs`).not.toMatch(/from\s+["']node:fs/);
    }
  });

  it("ONLY workspace/relative/zod imports (the license-provenance pin)", () => {
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]!);
      for (const specifier of imports) {
        const allowed =
          specifier.startsWith("@sporta/") ||
          specifier.startsWith("./") ||
          specifier.startsWith("../") ||
          specifier === "zod";
        expect(allowed, `${file} imports '${specifier}' (only @sporta/*, relative, zod)`).toBe(
          true,
        );
      }
    }
  });
});
