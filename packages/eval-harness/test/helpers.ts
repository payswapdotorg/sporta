/**
 * W801 test helpers: the memoized default-suite run (ONE suite execution
 * shared by every test file in this process — bun test runs the files in a
 * single process, so the module-level memo is shared), deterministic scratch
 * paths, and scratch suite-config/fixture writers (docs/testing/HARNESS.md —
 * no `Date.now`, no `Math.random`).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadSuiteConfig, runSuite } from "../src/index";
import type { SuiteReport } from "../src/index";

/**
 * A deep-mutable mirror of a readonly JSON shape. Mutation tests tamper with
 * CLONES of the report; the production types are readonly to protect the
 * runner's construction, and this mirror removes exactly that protection for
 * the tampering side (the W403 `(artifact as unknown as Record<string,
 * unknown>)` mutation precedent, centralized so every mutation site stays
 * readable). Plain JSON data only — the guard keeps function members intact.
 */
export type Mutable<T> = T extends (...args: never[]) => unknown
  ? T
  : { -readonly [K in keyof T]: Mutable<T[K]> };

/** A deterministic absolute scratch path (repo-clean, collision-free). */
export function scratchPath(name: string): string {
  return join(tmpdir(), `sporta-w801-${name}`);
}

/** Writes JSON bytes to a scratch path (creating parent directories). */
export function writeScratchJson(name: string, value: unknown): string {
  const path = scratchPath(name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

/** The memoized default-suite report (one suite run per test process). */
let memo: SuiteReport | undefined;

/** Runs (once per process) the checked-in default suite. */
export function defaultSuiteReport(): SuiteReport {
  memo ??= runSuite(loadSuiteConfig());
  return memo;
}

/** Deep clone via JSON round-trip (reports are plain JSON data). */
export function cloneReport(report: SuiteReport): SuiteReport {
  return JSON.parse(JSON.stringify(report)) as SuiteReport;
}

/** The valid default-suite config as a mutable plain object (for mutations). */
export function defaultConfigObject(): Record<string, unknown> {
  const loaded = loadSuiteConfig();
  return JSON.parse(loaded.canonical) as Record<string, unknown>;
}
