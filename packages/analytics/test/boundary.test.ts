/**
 * Source-scan pins (the W602/W603/W604/W706 teeth-test precedent, applied
 * to the analytics package): the standing invariants only a source scan can
 * prove, made permanent regression pins —
 *
 * 1. **Isolation boundary** (architecture-lock §5): every import specifier
 *    in `src/*.ts` is one of the two declared runtime dependencies
 *    (`@sporta/viewer-shell` — the W706 event model this package consumes —
 *    and `zod` — the repo's allowed validation dependency) or a local
 *    relative module. NO node builtins anywhere in src (this package is pure
 *    computation — it has no node-only surface at all), no dev-only
 *    package, no other workspace package.
 * 2. **Constitution** (docs/constitution, the W804 brief): ZERO
 *    `Math.random(…)`, `Date.now(…)`, `performance.now(…)`, `new Date(…)`
 *    CALLS in `src` — analytics is a pure function of recorded streams;
 *    there is not even an injected clock here (nothing is timed BY this
 *    package; it only aggregates the W706-injected timestamps).
 *
 * All scans walk `src` dynamically (a NEW src module is scanned
 * automatically), and each has a teeth test proving it is not vacuous.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Package root: `import.meta.dir` is `<pkg>/test`, so one dirname up. */
const PACKAGE_ROOT = dirname(import.meta.dir);

/** The declared runtime dependencies (package.json, verbatim). */
const ALLOWED_SPECIFIERS: readonly string[] = ["@sporta/viewer-shell", "zod"];

/** Every import specifier (static or dynamic) in one module's source. */
function importSpecifiersOf(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(/from\s+"([^"]+)"/g)) specifiers.push(match[1]!);
  for (const match of source.matchAll(/import\(\s*"([^"]+)"\s*\)/g)) specifiers.push(match[1]!);
  return specifiers;
}

/** Every `src/*.ts` module name, sorted (deterministic scan order). */
function srcModuleNames(): string[] {
  return readdirSync(join(PACKAGE_ROOT, "src"))
    .filter((name) => name.endsWith(".ts"))
    .sort();
}

function sourceOf(moduleName: string): string {
  return readFileSync(join(PACKAGE_ROOT, "src", moduleName), "utf8");
}

describe("isolation boundary — src imports only the declared runtime deps", () => {
  test("every import specifier in src is allowed (the two runtime deps or a relative module)", () => {
    expect(srcModuleNames().length).toBeGreaterThanOrEqual(8); // the known module count
    for (const moduleName of srcModuleNames()) {
      for (const specifier of importSpecifiersOf(sourceOf(moduleName))) {
        const allowed = ALLOWED_SPECIFIERS.includes(specifier) || specifier.startsWith("./");
        expect(
          allowed,
          `src/${moduleName} imports "${specifier}" — src may import only ${ALLOWED_SPECIFIERS.join(", ")} or local relative modules`,
        ).toBe(true);
      }
    }
  });

  test("the declared runtime dependencies are all actually imported (the allowlist is real)", () => {
    const all = new Set<string>();
    for (const moduleName of srcModuleNames()) {
      for (const specifier of importSpecifiersOf(sourceOf(moduleName))) all.add(specifier);
    }
    for (const allowed of ALLOWED_SPECIFIERS) {
      expect(all.has(allowed), `src never imports ${allowed} — stale allowlist?`).toBe(true);
    }
  });

  test("no node builtin anywhere in src (the package is pure — no file, network, or process surface)", () => {
    for (const moduleName of srcModuleNames()) {
      for (const specifier of importSpecifiersOf(sourceOf(moduleName))) {
        expect(
          specifier.startsWith("node:"),
          `src/${moduleName} imports "${specifier}" — analytics has no node-only surface`,
        ).toBe(false);
      }
    }
  });

  test("the scan has teeth: any other specifier would fail it", () => {
    const breach = `import { createRng } from "@sporta/testing";`;
    const specifiers = importSpecifiersOf(breach);
    expect(specifiers).toEqual(["@sporta/testing"]);
    expect(ALLOWED_SPECIFIERS.includes("@sporta/testing")).toBe(false);
    expect("@sporta/testing".startsWith("./")).toBe(false);
    expect("@sporta/testing".startsWith("node:")).toBe(false);
  });
});

describe("constitution — zero wall-clock / RNG calls in src (pure computation only)", () => {
  test("no Math.random(…), Date.now(…), performance.now(…), or new Date(…) call appears in any src module", () => {
    const FORBIDDEN = [/Math\.random\(/, /Date\.now\(/, /performance\.now\(/, /new Date\(/];
    for (const moduleName of srcModuleNames()) {
      const source = sourceOf(moduleName);
      for (const pattern of FORBIDDEN) {
        expect(
          pattern.test(source),
          `src/${moduleName} matches ${String(pattern)} — analytics is a pure function of recorded streams (no clocks, no randomness, ever)`,
        ).toBe(false);
      }
    }
  });

  test("the scan has teeth: each forbidden call form is detectable", () => {
    expect(/Math\.random\(/.test("const r = Math.random();")).toBe(true);
    expect(/Date\.now\(/.test("const t = Date.now();")).toBe(true);
    expect(/performance\.now\(/.test("const t = performance.now();")).toBe(true);
    expect(/new Date\(/.test("const d = new Date(TEST_EPOCH_MS);")).toBe(true);
    // Comment mentions WITHOUT call syntax never trip the scan.
    expect(/performance\.now\(/.test(" * the browser performance.now clock at the DOM edge")).toBe(
      false,
    );
  });
});
