/**
 * Source-scan pins (the W602/W703/W706/W604/W605 precedent): the two
 * standing invariants only a source scan can prove, as permanent
 * regression pins —
 *
 * 1. **Isolation boundary** (architecture-lock §5): every import specifier
 *    in `src/*.ts` is one of the declared runtime dependencies (exactly
 *    the `package.json` `dependencies` list) or a local relative module.
 * 2. **Constitution** (the sporta-wide rule): zero `Math.random(…)`,
 *    `Date.now(…)`, `performance.now(…)`, `new Date(…)` CALLS in `src` —
 *    the suite is a pure function of its inputs.
 *
 * Both scans walk `src` dynamically and both have teeth tests.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Package root. */
const PACKAGE_ROOT = dirname(import.meta.dir);

/** The runtime-dependency allowlist (package.json dependencies, verbatim). */
const ALLOWED_SPECIFIERS: readonly string[] = [
  "@sporta/contracts",
  "@sporta/encoding",
  "@sporta/renderer-3d",
  "@sporta/renderer-contract",
  "@sporta/renderer-evaluation",
  "@sporta/renderer-tactical",
  "@sporta/scene-evaluation",
  "zod",
];

/** Every import specifier (static or dynamic) in one module's source. */
function importSpecifiersOf(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(/from\s+"([^"]+)"/g)) specifiers.push(match[1]!);
  for (const match of source.matchAll(/import\(\s*"([^"]+)"\s*\)/g)) specifiers.push(match[1]!);
  return specifiers;
}

/** Every src module's source. */
function srcModules(): { name: string; source: string }[] {
  return readdirSync(join(PACKAGE_ROOT, "src"))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ name, source: readFileSync(join(PACKAGE_ROOT, "src", name), "utf8") }));
}

describe("isolation boundary — src imports only the declared deps", () => {
  test("every src import specifier is allowed or relative", () => {
    for (const module of srcModules()) {
      for (const specifier of importSpecifiersOf(module.source)) {
        expect(
          specifier.startsWith(".") ||
            specifier.startsWith("node:") ||
            ALLOWED_SPECIFIERS.includes(specifier),
          `${module.name} imports "${specifier}" — src may import only ${ALLOWED_SPECIFIERS.join(", ")}, node: builtins (the R307 visual gate's real-media substrate: staging dirs + staged-frame reads), or local relative modules (architecture-lock §5)`,
        ).toBe(true);
      }
    }
  });

  test("the allowlist matches package.json dependencies verbatim", () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
    expect(Object.keys(pkg.dependencies).sort()).toEqual([...ALLOWED_SPECIFIERS].sort());
  });

  test("teeth: the scan rejects a forbidden specifier (not vacuous)", () => {
    const offenders = importSpecifiersOf(`import { x } from "@sporta/forbidden";`).filter(
      (s) => !s.startsWith(".") && !ALLOWED_SPECIFIERS.includes(s),
    );
    expect(offenders).toEqual(["@sporta/forbidden"]);
  });
});

describe("constitution — no wall clock, no randomness in src", () => {
  test("zero Math.random / Date.now / performance.now / new Date calls", () => {
    const forbidden = [
      /Math\.random\s*\(/,
      /Date\.now\s*\(/,
      /performance\.now\s*\(/,
      /new\s+Date\s*\(/,
    ];
    for (const module of srcModules()) {
      for (const pattern of forbidden) {
        expect(
          pattern.test(module.source),
          `${module.name} matches ${pattern} — the suite must be a pure function of its inputs`,
        ).toBe(false);
      }
    }
  });

  test("teeth: the scan catches a real Date.now call (not vacuous)", () => {
    expect(/Date\.now\s*\(/.test("const t = Date.now();")).toBe(true);
  });
});
