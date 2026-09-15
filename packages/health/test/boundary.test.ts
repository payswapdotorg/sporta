/**
 * Source-scan pins (the W602 renderer-3d / W703 / W706 / W604 precedent):
 * the two standing invariants only a source scan can prove, as permanent
 * regression pins —
 *
 * 1. **Isolation boundary** (architecture-lock §5): every import specifier
 *    in `src/*.ts` is one of the declared runtime dependencies
 *    (`@sporta/observability`, `zod`) or a local relative module. Test-only
 *    packages live in `test/` only.
 * 2. **Constitution** (sporta-wide): zero `Math.random(…)`, `Date.now(…)`,
 *    `performance.now(…)`, and `new Date(…)` CALLS in `src` — the posture
 *    machinery is a pure function of its inputs (W805's determinism claim:
 *    byte-stable artifacts, reproducible verdicts), enforced at the source
 *    level. Comment mentions without call syntax are fine.
 *
 * Both scans walk `src` dynamically (a NEW src module is scanned
 * automatically) and both have teeth tests proving they are not vacuous.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Package root: `import.meta.dir` is `<pkg>/test`, so one dirname up. */
const PACKAGE_ROOT = dirname(import.meta.dir);

const ALLOWED_SPECIFIERS: readonly string[] = ["@sporta/observability", "zod"];

function importSpecifiersOf(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(/from\s+"([^"]+)"/g)) specifiers.push(match[1]!);
  for (const match of source.matchAll(/import\(\s*"([^"]+)"\s*\)/g)) specifiers.push(match[1]!);
  return specifiers;
}

function srcModules(): string[] {
  return readdirSync(join(PACKAGE_ROOT, "src"))
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .map((name) => join("src", name));
}

describe("isolation boundary — src imports only the declared runtime deps", () => {
  test("every import specifier in src is allowed (runtime deps or local relative modules)", () => {
    expect(srcModules().length).toBeGreaterThanOrEqual(7); // the known module count
    for (const modulePath of srcModules()) {
      const source = readFileSync(join(PACKAGE_ROOT, modulePath), "utf8");
      for (const specifier of importSpecifiersOf(source)) {
        const allowed = ALLOWED_SPECIFIERS.includes(specifier) || specifier.startsWith("./");
        expect(
          allowed,
          `${modulePath} imports "${specifier}" — src may import only ${ALLOWED_SPECIFIERS.join(", ")} or local relative modules (dev deps are test-only; architecture-lock §5)`,
        ).toBe(true);
      }
    }
  });

  test("the declared dependencies are all actually imported (the allowlist is real)", () => {
    const all = new Set<string>();
    for (const modulePath of srcModules()) {
      const source = readFileSync(join(PACKAGE_ROOT, modulePath), "utf8");
      for (const specifier of importSpecifiersOf(source)) all.add(specifier);
    }
    for (const allowed of ALLOWED_SPECIFIERS) {
      expect(all.has(allowed), `src never imports ${allowed} — stale allowlist?`).toBe(true);
    }
  });

  test("the scan has teeth: a foreign import in src would fail it", () => {
    const breach = `import { buildRenderRequest } from "@sporta/testing";`;
    expect(importSpecifiersOf(breach)).toEqual(["@sporta/testing"]);
    expect(ALLOWED_SPECIFIERS.includes("@sporta/testing")).toBe(false);
  });
});

describe("constitution — zero wall-clock / RNG calls in src", () => {
  test("no Math.random(…), Date.now(…), performance.now(…), or new Date(…) call appears in any src module", () => {
    const FORBIDDEN = [/Math\.random\(/, /Date\.now\(/, /performance\.now\(/, /new Date\(/];
    for (const modulePath of srcModules()) {
      const source = readFileSync(join(PACKAGE_ROOT, modulePath), "utf8");
      for (const pattern of FORBIDDEN) {
        expect(
          pattern.test(source),
          `${modulePath} matches ${String(pattern)} — the posture machinery must be a pure function of its inputs (byte-stable artifacts, reproducible verdicts); time is the caller's explicit domain`,
        ).toBe(false);
      }
    }
  });

  test("the scan has teeth: each forbidden call form is detectable", () => {
    expect(/Math\.random\(/.test("const r = Math.random();")).toBe(true);
    expect(/Date\.now\(/.test("const t = Date.now();")).toBe(true);
    expect(/performance\.now\(/.test("const p = performance.now();")).toBe(true);
    expect(/new Date\(/.test("const d = new Date(TEST_EPOCH_MS);")).toBe(true);
    expect(/Math\.random\(/.test(" * no Math.random; deterministic artifacts")).toBe(false);
    expect(/Date\.now\(/.test(" * Deterministic artifacts (no Date.now,")).toBe(false);
  });
});
