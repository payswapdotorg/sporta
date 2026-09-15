/**
 * Source-scan pins (the W802 @sporta/slo boundary convention): the two
 * standing invariants only a source scan can prove, as permanent
 * regression pins —
 *
 * 1. **Isolation boundary**: every import specifier in `src/*.ts` is one
 *    of the declared runtime dependencies (exactly
 *    `@sporta/renderer-evaluation` and `@sporta/scene-evaluation` — the
 *    two completed evaluation packages this suite composes) or a local
 *    relative module. No undeclared package can enter the runtime
 *    dependency set silently.
 * 2. **Constitution**: zero `Math.random(…)`, `Date.now(…)`,
 *    `performance.now(…)`, and `new Date(…)` CALLS in `src` AND
 *    `scripts` (both are shipped package surface) — the release
 *    evaluation is a pure function of its input document; wall time is
 *    never read, randomness never used (the gate CLI's reported dates and
 *    hashes come from the input documents and the deterministic report
 *    bytes, never from a clock).
 *
 * Both scans walk the directories dynamically (a NEW module is scanned
 * automatically), and both have teeth tests proving they are not vacuous.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

/** Package root: `import.meta.dir` is `<pkg>/test`, so one dirname up. */
const PACKAGE_ROOT = dirname(import.meta.dir);

/**
 * The runtime-dependency allowlist (package.json's dependencies, verbatim):
 * exactly the two completed evaluation packages this suite composes.
 */
const ALLOWED_SPECIFIERS: readonly string[] = [
  "@sporta/renderer-evaluation",
  "@sporta/scene-evaluation",
];

/** Every import specifier (static or dynamic) in one module's source. */
function importSpecifiersOf(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(/from\s+"([^"]+)"/g)) specifiers.push(match[1]!);
  for (const match of source.matchAll(/import\(\s*"([^"]+)"\s*\)/g)) specifiers.push(match[1]!);
  return specifiers;
}

/** Every `*.ts` module path under one directory, sorted (deterministic scan order). */
function modulesUnder(relativeDir: "src" | "scripts"): string[] {
  return readdirSync(join(PACKAGE_ROOT, relativeDir))
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .map((name) => join(relativeDir, name));
}

describe("isolation boundary — src imports only the declared dependencies", () => {
  test("every import specifier in src is allowed (runtime deps or local relative modules)", () => {
    expect(modulesUnder("src").length).toBeGreaterThanOrEqual(8); // the known module count
    for (const modulePath of modulesUnder("src")) {
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

  test("package.json's dependencies are exactly the allowlist (no undeclared runtime deps)", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies).sort()).toEqual([...ALLOWED_SPECIFIERS].sort());
  });

  test("the scan has teeth: an undeclared import in src would fail it", () => {
    const breach = `import { createHash } from "node:crypto";`;
    const specifiers = importSpecifiersOf(breach);
    expect(specifiers).toEqual(["node:crypto"]);
    expect(ALLOWED_SPECIFIERS.includes("node:crypto")).toBe(false);
  });
});

describe("constitution — zero wall-clock / RNG calls in src AND scripts", () => {
  test("no Math.random(…), Date.now(…), performance.now(…), or new Date(…) call appears in any shipped module", () => {
    const shipped = [...modulesUnder("src"), ...modulesUnder("scripts")];
    expect(shipped.length).toBeGreaterThanOrEqual(9); // 8 src + the CLI
    const FORBIDDEN = [/Math\.random\(/, /Date\.now\(/, /performance\.now\(/, /new Date\(/];
    for (const modulePath of shipped) {
      const source = readFileSync(join(PACKAGE_ROOT, modulePath), "utf8");
      for (const pattern of FORBIDDEN) {
        expect(
          pattern.test(source),
          `${modulePath} matches ${String(pattern)} — release evaluation is a pure function of its input document (the constitution); wall time and randomness are never read`,
        ).toBe(false);
      }
    }
  });

  test("the scan has teeth: each forbidden call form is detectable", () => {
    expect(/Math\.random\(/.test("const r = Math.random();")).toBe(true);
    expect(/Date\.now\(/.test("const t = Date.now();")).toBe(true);
    expect(/performance\.now\(/.test("const t = performance.now();")).toBe(true);
    expect(/new Date\(/.test("const d = new Date(TEST_EPOCH_MS);")).toBe(true);
    // Comment mentions WITHOUT call syntax never trip the scan (the
    // docblocks honestly DESCRIBE the rule).
    expect(/Math\.random\(/.test(" * zero Math.random; the evaluation is deterministic")).toBe(
      false,
    );
    expect(/Date\.now\(/.test(" * no Date.now anywhere — authored dates only")).toBe(false);
  });
});
