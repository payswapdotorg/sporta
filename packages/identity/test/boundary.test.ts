/**
 * Source-scan pins (the W602/W603/W703/W706/W604/W306/W802/W805/W901
 * precedent): the two standing invariants only a source scan can prove —
 *
 * 1. **Isolation boundary**: every import specifier in `src/*.ts` is one of
 *    the declared runtime dependencies (`zod`, `@sporta/capability`,
 *    `@sporta/contracts`) or a local relative module. In particular
 *    `@sporta/control-api` is a DEV dependency only — the W701 bridge is a
 *    STRUCTURAL port (test/control-gate.test.ts wires the real app in), so
 *    the identity package can never grow a hidden control-plane runtime
 *    dependency.
 * 2. **Constitution**: zero `Math.random(…)`, `Date.now(…)`, and
 *    `performance.now(…)` calls in `src` — time and randomness are injected
 *    (clock.ts ports). `new Date(<epoch>)` as a PURE CONVERSION (of an
 *    injected instant, in http.ts's `toIsoUtc`) is allowed; a zero-argument
 *    `new Date()` (a wall-clock read) is not.
 *
 * Both scans walk the directory dynamically (a NEW module is scanned
 * automatically), and both have teeth tests proving they are not vacuous.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { IDENTITY_DEFAULT_EPOCH_MS, createIdentityDefaultClock } from "../src/index";

/** Package root: `import.meta.dir` is `<pkg>/test`, so one dirname up. */
const PACKAGE_ROOT = dirname(import.meta.dir);

/**
 * The runtime-dependency allowlist (package.json's dependencies, verbatim):
 * zod, plus the two frozen workspace contracts this package CONSUMES
 * (@sporta/capability for the role vocabulary; @sporta/contracts for the
 * rights-policy shape).
 */
const ALLOWED_SPECIFIERS: readonly string[] = [
  "zod",
  "@sporta/capability",
  "@sporta/contracts",
];

function importSpecifiersOf(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(/from\s+"([^"]+)"/g)) specifiers.push(match[1]!);
  for (const match of source.matchAll(/import\(\s*"([^"]+)"\s*\)/g)) specifiers.push(match[1]!);
  return specifiers;
}

function modulesUnder(relativeDir: "src"): string[] {
  return readdirSync(join(PACKAGE_ROOT, relativeDir))
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .map((name) => join(relativeDir, name));
}

describe("isolation boundary — src imports only the declared dependencies", () => {
  test("every import specifier in src is allowed (runtime deps or local relative modules)", () => {
    const modules = modulesUnder("src");
    expect(modules.length).toBeGreaterThanOrEqual(8); // the known module count
    for (const modulePath of modules) {
      const source = readFileSync(join(PACKAGE_ROOT, modulePath), "utf8");
      for (const specifier of importSpecifiersOf(source)) {
        const allowed = ALLOWED_SPECIFIERS.includes(specifier) || specifier.startsWith("./");
        expect(
          allowed,
          `${modulePath} imports "${specifier}" — src may import only ${ALLOWED_SPECIFIERS.join(", ")} or local relative modules`,
        ).toBe(true);
      }
    }
  });

  test("@sporta/control-api is NEVER imported from src (the W701 bridge is structural)", () => {
    for (const modulePath of modulesUnder("src")) {
      const source = readFileSync(join(PACKAGE_ROOT, modulePath), "utf8");
      expect(source, modulePath).not.toContain('from "@sporta/control-api"');
    }
  });

  test("the declared dependencies are all actually imported (the allowlist is real)", () => {
    const all = new Set<string>();
    for (const modulePath of modulesUnder("src")) {
      const source = readFileSync(join(PACKAGE_ROOT, modulePath), "utf8");
      for (const specifier of importSpecifiersOf(source)) all.add(specifier);
    }
    for (const allowed of ALLOWED_SPECIFIERS) {
      expect(all.has(allowed), `src never imports ${allowed} — stale allowlist?`).toBe(true);
    }
  });

  test("the scan has teeth: an undeclared import in src would fail it", () => {
    const breach = `import { createControlApp } from "@sporta/control-api";`;
    const specifiers = importSpecifiersOf(breach);
    expect(specifiers).toEqual(["@sporta/control-api"]);
    expect(ALLOWED_SPECIFIERS.includes("@sporta/control-api")).toBe(false);
  });
});

describe("constitution — zero wall-clock / RNG calls in src", () => {
  test("no Math.random(…), Date.now(…), or performance.now(…) call appears in any module", () => {
    const modules = modulesUnder("src");
    expect(modules.length).toBeGreaterThanOrEqual(8);
    const FORBIDDEN = [/Math\.random\(/, /Date\.now\(/, /performance\.now\(/, /new Date\(\)/];
    for (const modulePath of modules) {
      const source = readFileSync(join(PACKAGE_ROOT, modulePath), "utf8");
      for (const pattern of FORBIDDEN) {
        expect(
          pattern.test(source),
          `${modulePath} matches ${String(pattern)} — identity reads time and randomness only through the injected clock/entropy ports (clock.ts)`,
        ).toBe(false);
      }
    }
  });

  test("the scan has teeth: each forbidden call form is detectable", () => {
    expect(/Math\.random\(/.test("const r = Math.random();")).toBe(true);
    expect(/Date\.now\(/.test("const t = Date.now();")).toBe(true);
    expect(/performance\.now\(/.test("const t = performance.now();")).toBe(true);
    expect(/new Date\(\)/.test("const t = new Date();")).toBe(true);
  });

  test("the deterministic default clock mirrors @sporta/testing's TEST_EPOCH_MS exactly", () => {
    // Computed from the documented instant (NOT via a Date constructor —
    // the scan target): 2025-01-06T12:00:00.000Z.
    const expected = Date.parse("2025-01-06T12:00:00.000Z");
    expect(IDENTITY_DEFAULT_EPOCH_MS).toBe(expected);
    // Deterministic counter: strictly increasing, epoch-anchored.
    const clock = createIdentityDefaultClock();
    expect(clock()).toBe(expected + 1);
    expect(clock()).toBe(expected + 2);
  });
});

