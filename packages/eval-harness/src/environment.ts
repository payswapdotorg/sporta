/**
 * HONEST deterministic environment facts for the W801 suite report.
 *
 * The report's environment block is MEASURED, not asserted: at run time the
 * harness reads each runtime dependency's `package.json` from the workspace
 * and records its `name` and `version` (with an integrity check that the
 * read file really declares the expected `@sporta/*` name — a moved or
 * mis-linked package fails loud).
 *
 * Deliberately EXCLUDED (and why — README §"Environment honesty"):
 *
 * - **no wall clock** — `Date.now()`/`new Date()`/`performance.now()` are
 *   banned by the repo constitution; timestamps in the report come from the
 *   injected clock domain only;
 * - **no hostname / user / OS** — machine identity says nothing about the
 *   evaluation and would make report bytes machine-dependent;
 * - **no bun/runtime version** — it varies by binary across environments
 *   (local vs CI) and would make the checked-in golden report fragile.
 *   Same-binary identity is PROVEN byte-wise by the rerun tests, never
 *   asserted by a version string;
 * - **no random run id** — there is no RNG anywhere in the harness.
 *
 * What remains (package versions measured from the workspace) is
 * deterministic per commit: the same worktree produces the same environment
 * block on every run and in every subprocess.
 */
import { readFileSync } from "node:fs";

/** This package's directory (the workspace-sibling anchor). */
const PACKAGE_ROOT = `${import.meta.dir}/..`;

/**
 * The runtime dependencies whose versions the report measures (the harness's
 * entire runtime-dep set, plus the harness itself).
 */
const PACKAGE_DIRS: ReadonlyArray<{ readonly name: string; readonly path: string }> = [
  { name: "@sporta/contracts", path: "../contracts/package.json" },
  { name: "@sporta/evaluation", path: "../evaluation/package.json" },
  { name: "@sporta/eval-harness", path: "package.json" },
  { name: "@sporta/latency-benchmark", path: "../latency-benchmark/package.json" },
  { name: "@sporta/renderer-evaluation", path: "../renderer-evaluation/package.json" },
  { name: "@sporta/scene-projection", path: "../scene-projection/package.json" },
  { name: "@sporta/testing", path: "../testing/package.json" },
  { name: "@sporta/world-model", path: "../world-model/package.json" },
];

/** The exact key set the environment block must carry (shape-checked). */
export const ENVIRONMENT_PACKAGE_KEYS: readonly string[] = PACKAGE_DIRS.map((pkg) => pkg.name);

/** Per-process memo (the same values on every call — deterministic anyway). */
let memo: Record<string, string> | undefined;

/**
 * Measures the runtime package versions from the workspace (fail loud on a
 * missing or mis-declared package.json). Deterministic: same worktree, same
 * values, every call, every subprocess.
 */
export function measurePackageVersions(): Record<string, string> {
  if (memo !== undefined) {
    return { ...memo };
  }
  const versions: Record<string, string> = {};
  for (const pkg of PACKAGE_DIRS) {
    const packageJsonPath = `${PACKAGE_ROOT}/${pkg.path}`;
    let parsed: { name?: unknown; version?: unknown };
    try {
      parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
        name?: unknown;
        version?: unknown;
      };
    } catch (cause) {
      throw new RangeError(
        `measurePackageVersions: cannot read "${packageJsonPath}" for ${pkg.name} ` +
          `(${(cause as Error).message}) — the environment facts are measured, not asserted; ` +
          "a missing package.json is a harness-structure error",
      );
    }
    if (parsed.name !== pkg.name) {
      throw new RangeError(
        `measurePackageVersions: "${packageJsonPath}" declares name ${JSON.stringify(parsed.name)}, ` +
          `expected "${pkg.name}" — the workspace layout drifted from the harness's map`,
      );
    }
    if (typeof parsed.version !== "string" || parsed.version.length < 1) {
      throw new RangeError(
        `measurePackageVersions: "${packageJsonPath}" has no usable "version" string`,
      );
    }
    versions[pkg.name] = parsed.version;
  }
  memo = versions;
  return { ...memo };
}
