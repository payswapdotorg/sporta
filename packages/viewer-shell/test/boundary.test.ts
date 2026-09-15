/**
 * Source-scan pins (the W602/W603/W604/W706 teeth-test precedent): the
 * standing invariants only a source scan can prove, made permanent
 * regression pins for the W704 live additions —
 *
 * 1. **Isolation boundary** (architecture-lock §5): every import specifier
 *    in `src/*.ts` is one of the seven declared workspace dependencies, a
 *    local relative module, or a node builtin confined to the two declared
 *    NODE-ONLY modules (`serve.ts`, `telemetry-file-sink.ts` — the dev
 *    server and the node-side JSONL sink). NO external runtime package at
 *    all (not even zod — this package has no schema of its own; W305's
 *    grammar lives in `@sporta/webrtc-output`), and no dev-only package in
 *    src.
 * 2. **Constitution** (docs/constitution, the W704 brief): ZERO
 *    `Math.random(…)`, `Date.now(…)`, `performance.now(…)`, `new Date(…)`
 *    CALLS in `src` — injected clocks only (the default clock is the
 *    deterministic epoch+ticks counter; the browser bootstrap is the DOM
 *    edge that owns the real-clock injection). Comment mentions without
 *    call syntax are fine; the regexes match the call forms.
 * 3. **The browser-module-graph rule at the source level** (W702, extended
 *    by W704): the browser-reachable live modules (`live-ports`,
 *    `live-player`, `live-backoff`, `live-plan`) import
 *    `@sporta/webrtc-output` TYPE-ONLY (erased at transpile — the runtime
 *    import lives in the node-side `live-client.ts`, deliberately outside
 *    the browser graph; `test/serve.test.ts` pins the transpiled output,
 *    this pin catches the breach before it ever reaches the transpiler).
 *
 * All scans walk `src` dynamically (a NEW src module is scanned
 * automatically), and each has a teeth test proving it is not vacuous.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Package root: `import.meta.dir` is `<pkg>/test`, so one dirname up. */
const PACKAGE_ROOT = dirname(import.meta.dir);

/** The declared workspace runtime dependencies (package.json, verbatim). */
const ALLOWED_SPECIFIERS: readonly string[] = [
  "@sporta/control-api",
  "@sporta/contracts",
  "@sporta/output-pipeline",
  "@sporta/renderer-anime",
  "@sporta/renderer-contract",
  "@sporta/testing",
  "@sporta/webrtc-output",
];

/** The modules allowed to import node builtins (the node-only surface). */
const NODE_ONLY_MODULES: readonly string[] = ["serve.ts", "telemetry-file-sink.ts"];

/** The browser-reachable live modules (the serve.ts BROWSER graph members). */
const BROWSER_LIVE_MODULES: readonly string[] = [
  "live-ports.ts",
  "live-player.ts",
  "live-backoff.ts",
  "live-plan.ts",
];

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

describe("isolation boundary — src imports only the declared workspace deps", () => {
  test("every import specifier in src is allowed (workspace deps, relative modules, or a node builtin in the two node-only modules)", () => {
    expect(srcModuleNames().length).toBeGreaterThanOrEqual(28); // the known module count
    for (const moduleName of srcModuleNames()) {
      const source = sourceOf(moduleName);
      for (const specifier of importSpecifiersOf(source)) {
        const allowed =
          ALLOWED_SPECIFIERS.includes(specifier) ||
          specifier.startsWith("./") ||
          (specifier.startsWith("node:") && NODE_ONLY_MODULES.includes(moduleName));
        expect(
          allowed,
          `src/${moduleName} imports "${specifier}" — src may import only ${ALLOWED_SPECIFIERS.join(", ")}, local relative modules, or node builtins (confined to ${NODE_ONLY_MODULES.join(", ")})`,
        ).toBe(true);
      }
    }
  });

  test("the declared dependencies are all actually imported (the allowlist is real)", () => {
    const all = new Set<string>();
    for (const moduleName of srcModuleNames()) {
      for (const specifier of importSpecifiersOf(sourceOf(moduleName))) all.add(specifier);
    }
    for (const allowed of ALLOWED_SPECIFIERS) {
      expect(all.has(allowed), `src never imports ${allowed} — stale allowlist?`).toBe(true);
    }
  });

  test("node builtins never leak outside the node-only modules (the browser graph stays browser-only)", () => {
    for (const moduleName of srcModuleNames()) {
      if (NODE_ONLY_MODULES.includes(moduleName)) continue;
      for (const specifier of importSpecifiersOf(sourceOf(moduleName))) {
        expect(
          specifier.startsWith("node:"),
          `src/${moduleName} imports "${specifier}" — node builtins live only in ${NODE_ONLY_MODULES.join(", ")}`,
        ).toBe(false);
      }
    }
  });

  test("the scan has teeth: an external/dev-only import in src would fail it", () => {
    const breach = `import { z } from "zod";`;
    const specifiers = importSpecifiersOf(breach);
    expect(specifiers).toEqual(["zod"]);
    expect(ALLOWED_SPECIFIERS.includes("zod")).toBe(false);
    expect("zod".startsWith("./")).toBe(false);
    expect("zod".startsWith("node:")).toBe(false);
  });
});

describe("constitution — zero wall-clock / RNG calls in src (injected clocks only)", () => {
  test("no Math.random(…), Date.now(…), performance.now(…), or new Date(…) call appears in any src module", () => {
    const FORBIDDEN = [/Math\.random\(/, /Date\.now\(/, /performance\.now\(/, /new Date\(/];
    for (const moduleName of srcModuleNames()) {
      const source = sourceOf(moduleName);
      for (const pattern of FORBIDDEN) {
        expect(
          pattern.test(source),
          `src/${moduleName} matches ${String(pattern)} — the viewer must run on injected clocks only (the constitution); the browser bootstrap is the DOM edge that owns the real-clock injection`,
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
    expect(/performance\.now\(/.test(" * the browser performance.now clock")).toBe(false);
    expect(/Math\.random\(/.test(" * no Math.random; all times are explicit")).toBe(false);
  });
});

describe("browser-graph live modules import W305 TYPE-ONLY (the W702 rule at the source level)", () => {
  test("every @sporta/webrtc-output import in the browser-reachable live modules is `import type` (erased at transpile)", () => {
    for (const moduleName of BROWSER_LIVE_MODULES) {
      const source = sourceOf(moduleName);
      // Every import/export-from STATEMENT naming the package must be
      // type-only. The regexes match the full statement (multi-line
      // import bodies included — `[^}]*` spans newlines), so docblock
      // mentions are never mistaken for statements.
      const statements = [
        ...source.matchAll(/import\s+(type\s+)?\{[^}]*\}\s*from\s*"@sporta\/webrtc-output"/g),
        ...source.matchAll(/export\s+(type\s+)?\{[^}]*\}\s*from\s*"@sporta\/webrtc-output"/g),
      ];
      expect(statements.length, `src/${moduleName} never imports @sporta/webrtc-output?`).toBeGreaterThan(0);
      for (const statement of statements) {
        expect(
          statement[1] !== undefined,
          `src/${moduleName} statement "${statement[0].replace(/\s+/g, " ")}" — browser-reachable modules may import @sporta/webrtc-output TYPE-ONLY (the runtime import belongs to the node-side live-client.ts; the browser cannot resolve bare @sporta/* specifiers — W702, test-enforced in serve.test.ts)`,
        ).toBe(true);
      }
    }
  });

  test("the node-side adapter exists and DOES import the package at runtime (the composition, not a re-invention)", () => {
    const source = sourceOf("live-client.ts");
    expect(source).toMatch(/import \{ LiveOutputError \} from "@sporta\/webrtc-output";/);
    expect(source).toMatch(/LoopbackLiveOutputTransport/);
  });

  test("the scan has teeth: a value import of the package in a browser module would fail it", () => {
    const breach = `import { LiveOutputError } from "@sporta/webrtc-output";`;
    const lines = breach.split("\n");
    for (const line of lines) {
      expect(/^\s*(import type|export type)\b/.test(line)).toBe(false);
    }
  });
});
