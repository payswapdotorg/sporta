/**
 * Source-scan pins (the W703 selection-plan / W706 telemetry-operations
 * precedent): the two standing invariants only a source scan can prove,
 * turned into permanent regression pins —
 *
 * 1. **Isolation boundary** (architecture-lock §5, RENDERER.md §11): every
 *    import specifier in `src/*.ts` is either one of the three declared
 *    runtime dependencies (`@sporta/contracts`, `@sporta/renderer-contract`,
 *    `@sporta/scene-projection`) or a local relative module. The dev-only
 *    packages (`@sporta/temporal`, `@sporta/world-model`, `@sporta/testing`)
 *    live in `test/` ONLY — a src import of any of them would be an
 *    isolation breach this test catches at CI time.
 * 2. **Constitution** (RENDERER.md §9): zero `Math.random(…)`, `Date.now(…)`,
 *    and `new Date(…)` CALLS in `src` — the only time anywhere is the
 *    caller's explicit milliseconds. (Comment mentions without call syntax
 *    are fine; the regexes match the call forms.)
 *
 * Both scans walk `src` dynamically (a NEW src module is scanned
 * automatically), and both have teeth tests proving they are not vacuous.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Package root: `import.meta.dir` is `<pkg>/test`, so one dirname up. */
const PACKAGE_ROOT = dirname(import.meta.dir);

/** The runtime-dependency allowlist (RENDERER.md §11, verbatim). */
const ALLOWED_SPECIFIERS: readonly string[] = [
  "@sporta/contracts",
  "@sporta/renderer-contract",
  "@sporta/scene-projection",
];

/** Every import specifier (static or dynamic) in one module's source. */
function importSpecifiersOf(source: string): string[] {
  const specifiers: string[] = [];
  const staticImports = source.matchAll(/from\s+"([^"]+)"/g);
  for (const match of staticImports) specifiers.push(match[1]!);
  const dynamicImports = source.matchAll(/import\(\s*"([^"]+)"\s*\)/g);
  for (const match of dynamicImports) specifiers.push(match[1]!);
  return specifiers;
}

/** Every `src/*.ts` module path, sorted (deterministic scan order). */
function srcModules(): string[] {
  return readdirSync(join(PACKAGE_ROOT, "src"))
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .map((name) => join("src", name));
}

describe("isolation boundary — src imports only the three declared @sporta deps", () => {
  test("every import specifier in src is allowed (runtime deps or local relative modules)", () => {
    expect(srcModules().length).toBeGreaterThanOrEqual(12); // the known module count
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

  test("the three declared dependencies are all actually imported (the allowlist is real)", () => {
    const all = new Set<string>();
    for (const modulePath of srcModules()) {
      const source = readFileSync(join(PACKAGE_ROOT, modulePath), "utf8");
      for (const specifier of importSpecifiersOf(source)) all.add(specifier);
    }
    for (const allowed of ALLOWED_SPECIFIERS) {
      expect(all.has(allowed), `src never imports ${allowed} — stale allowlist?`).toBe(true);
    }
  });

  test("the scan has teeth: a dev-only import in src would fail it", () => {
    // Self-proof: the validator over a synthetic breach line must trip.
    const breach = `import { stateAt } from "@sporta/temporal";`;
    const specifiers = importSpecifiersOf(breach);
    expect(specifiers).toEqual(["@sporta/temporal"]);
    expect(ALLOWED_SPECIFIERS.includes("@sporta/temporal")).toBe(false);
  });
});

describe("constitution — zero wall-clock / RNG calls in src", () => {
  test("no Math.random(…), Date.now(…), or new Date(…) call appears in any src module", () => {
    const FORBIDDEN = [/Math\.random\(/, /Date\.now\(/, /new Date\(/];
    for (const modulePath of srcModules()) {
      const source = readFileSync(join(PACKAGE_ROOT, modulePath), "utf8");
      for (const pattern of FORBIDDEN) {
        expect(
          pattern.test(source),
          `${modulePath} matches ${String(pattern)} — the renderer must be a pure function of its inputs (RENDERER.md §9); time is the caller's explicit milliseconds`,
        ).toBe(false);
      }
    }
  });

  test("the scan has teeth: each forbidden call form is detectable", () => {
    expect(/Math\.random\(/.test("const r = Math.random();")).toBe(true);
    expect(/Date\.now\(/.test("const t = Date.now();")).toBe(true);
    expect(/new Date\(/.test("const d = new Date(TEST_EPOCH_MS);")).toBe(true);
    // Comment mentions WITHOUT call syntax never trip the scan (the
    // docblocks honestly DESCRIBE the rule).
    expect(/Math\.random\(/.test(" * no Math.random; all times are explicit")).toBe(false);
    expect(/Date\.now\(/.test(" * Deterministic fixtures (no Date.now,")).toBe(false);
  });
});
