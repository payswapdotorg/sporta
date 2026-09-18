/**
 * Source-scan pins (the W602/W703/W604/W605 precedent): the two standing
 * invariants only a source scan can prove —
 *
 * 1. **Isolation boundary** (architecture-lock §5): every import
 *    specifier in `src/*.ts` is one of the declared runtime dependencies
 *    (exactly the `package.json` `dependencies` list), a local relative
 *    module, or a `node:` builtin (the subprocess/fs substrate — the
 *    decoding / renderer-tactical src convention).
 * 2. **Constitution** (the sporta-wide rule): zero `Math.random(…)`,
 *    `Date.now(…)`, `performance.now(…)`, `new Date(…)` CALLS in `src` —
 *    the encoding plane is deterministic (wall-clock evidence lives in
 *    the OBSERVABILITY seam + test measurements, never in artifacts).
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Package root. */
const PACKAGE_ROOT = dirname(import.meta.dir);

/** The runtime-dependency allowlist (package.json dependencies, verbatim). */
const ALLOWED_SPECIFIERS: readonly string[] = [
  "@sporta/contracts",
  "@sporta/observability",
  "@sporta/output-pipeline",
  "@sporta/renderer-contract",
  "@sporta/testing",
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

describe("isolation boundary — src imports only the declared deps + node builtins", () => {
  test("every src import specifier is allowed, relative, or a node: builtin", () => {
    for (const module of srcModules()) {
      for (const specifier of importSpecifiersOf(module.source)) {
        expect(
          specifier.startsWith(".") ||
            specifier.startsWith("node:") ||
            ALLOWED_SPECIFIERS.includes(specifier),
          `${module.name} imports "${specifier}" — src may import only ${ALLOWED_SPECIFIERS.join(", ")}, node: builtins, or local relative modules (architecture-lock §5)`,
        ).toBe(true);
      }
    }
  });

  test("the allowlist matches package.json dependencies verbatim", () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
    expect(Object.keys(pkg.dependencies).sort()).toEqual([...ALLOWED_SPECIFIERS].sort());
  });

  test("the runtime deps exclude the renderer packages (bridges are STRUCTURAL)", () => {
    // The three renderer bridges consume the renderers' outputs
    // structurally — the renderers are devDependencies only (tests prove
    // the real plugins satisfy the structural seams).
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
    expect(pkg.dependencies["@sporta/renderer-tactical"]).toBeUndefined();
    expect(pkg.dependencies["@sporta/renderer-3d"]).toBeUndefined();
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
          `${module.name} matches ${pattern} — the encoding plane must be deterministic (wall-clock evidence lives in the observability seam, never in artifacts)`,
        ).toBe(false);
      }
    }
  });

  test("teeth: the scan catches a real Date.now call (not vacuous)", () => {
    expect(/Date\.now\s*\(/.test("const t = Date.now();")).toBe(true);
  });
});
