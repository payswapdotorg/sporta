/**
 * Source-scan pins (the viewer-shell boundary-test precedent): the standing
 * invariants only a source scan can prove, made permanent regression pins —
 *
 * 1. **Purity constitution**: ZERO `Math.random(…)`, `Date.now(…)`,
 *    `performance.now(…)`, `new Date(…)`, `setTimeout(…)`, `setInterval(…)`
 *    CALLS in `src` — the contract layer is pure types + schemas + a
 *    deterministic in-memory reference; every timestamp comes from the
 *    caller's injected source (comment mentions without call syntax are
 *    fine; the regexes match the call forms).
 * 2. **Dependency isolation** (the "zod ONLY" rule): every import specifier
 *    in `src/*.ts` is `zod` or a relative module — no @sporta package and no
 *    node builtin leaks into the contract layer; the mirrored vocabularies
 *    are pinned from dev-dependencies in TEST only (test/vocabulary.test.ts).
 * 3. **Test-only marking**: the in-memory reference is loudly marked
 *    TEST-ONLY in its own module header (a Wave-2 hosted implementation
 *    must live elsewhere).
 *
 * All scans walk `src` dynamically (a NEW src module is scanned
 * automatically), and each has a teeth test proving it is not vacuous.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Package root: `import.meta.dir` is `<pkg>/test`, so one dirname up. */
const PACKAGE_ROOT = dirname(import.meta.dir);

/** The only import specifiers allowed in src (the zod-only contract layer). */
const ALLOWED_SPECIFIERS: readonly string[] = ["zod"];

/** Forbidden call forms: the purity constitution (injected everything). */
const FORBIDDEN_CALL_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/Math\.random\(/, "Math.random("],
  [/Date\.now\(/, "Date.now("],
  [/performance\.now\(/, "performance.now("],
  [/new Date\(/, "new Date("],
  [/setTimeout\(/, "setTimeout("],
  [/setInterval\(/, "setInterval("],
];

/** Every `src/*.ts` module name, sorted (deterministic scan order). */
function srcModules(): string[] {
  return readdirSync(join(PACKAGE_ROOT, "src"))
    .filter((name) => name.endsWith(".ts"))
    .sort();
}

/** Every import specifier (static or dynamic) in one module's source. */
function importSpecifiersOf(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(/from\s+"([^"]+)"/g)) specifiers.push(match[1]!);
  for (const match of source.matchAll(/import\(\s*"([^"]+)"\s*\)/g)) specifiers.push(match[1]!);
  return specifiers;
}

describe("purity constitution (no clock, no randomness, no timers in src)", () => {
  for (const module of srcModules()) {
    test(`${module}: zero forbidden call forms`, () => {
      const source = readFileSync(join(PACKAGE_ROOT, "src", module), "utf8");
      for (const [pattern] of FORBIDDEN_CALL_PATTERNS) {
        expect(source).not.toMatch(pattern);
      }
    });
  }

  test("the scan has teeth (a planted violation is caught)", () => {
    const planted = [
      "const jitter = Math.random();",
      "const t = Date.now();",
      "const p = performance.now();",
      "const d = new Date(0);",
      "setTimeout(() => {}, 0);",
      "setInterval(() => {}, 0);",
    ];
    for (const line of planted) {
      for (const [pattern, label] of FORBIDDEN_CALL_PATTERNS) {
        if (line.includes(label)) {
          expect(line).toMatch(pattern);
        }
      }
    }
    // and the innocent do not match any pattern
    for (const line of [
      "// mentions Date.now without calling",
      "const ms = nowMs();",
      'const text = "setTimeout is forbidden (comment only)";',
    ]) {
      for (const [pattern] of FORBIDDEN_CALL_PATTERNS) {
        expect(line).not.toMatch(pattern);
      }
    }
  });
});

describe("dependency isolation (the zod-only contract layer)", () => {
  for (const module of srcModules()) {
    test(`${module}: imports only zod or relative modules`, () => {
      const source = readFileSync(join(PACKAGE_ROOT, "src", module), "utf8");
      for (const specifier of importSpecifiersOf(source)) {
        const allowed = specifier.startsWith(".") || ALLOWED_SPECIFIERS.includes(specifier);
        expect(allowed).toBe(true);
      }
    });
  }

  test("the scan has teeth (a leaking import is caught)", () => {
    const specifiers = importSpecifiersOf(
      'import { x } from "@sporta/gpu-worker";\nimport { z } from "zod";\nimport { y } from "./schemas";\n',
    );
    expect(specifiers).toEqual(["@sporta/gpu-worker", "zod", "./schemas"]);
    const leaks = specifiers.filter((s) => !s.startsWith(".") && !ALLOWED_SPECIFIERS.includes(s));
    expect(leaks).toEqual(["@sporta/gpu-worker"]);
  });
});

describe("test-only marking of the in-memory reference", () => {
  test("memory-adapter.ts declares itself TEST-ONLY in the module header", () => {
    const source = readFileSync(join(PACKAGE_ROOT, "src", "memory-adapter.ts"), "utf8");
    expect(source.startsWith("/**")).toBe(true);
    const header = source.slice(0, 900);
    expect(header).toContain("TEST-ONLY");
    expect(header).toContain("NOT A");
    expect(header).toContain("PRODUCTION PROVIDER");
  });

  test("the scan has teeth (a random file is not mistaken for the reference)", () => {
    const source = readFileSync(join(PACKAGE_ROOT, "src", "schemas.ts"), "utf8");
    const header = source.slice(0, 900);
    // schemas.ts is the contract, not the reference — it must NOT carry the
    // test-only marking (the contract layer is production-facing).
    expect(header).not.toContain("TEST-ONLY");
  });
});
