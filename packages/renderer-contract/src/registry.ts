/**
 * The versioned, immutable renderer registry (W501).
 *
 * Renderer IDs are stable logical identifiers; renderer versions are
 * immutable (docs/contracts/renderer.md, Versioning). Registering a different
 * plugin under an already-registered `rendererId` + `rendererVersion` pair is
 * a contract violation; a different version of the same rendererId is normal
 * plugin evolution and is allowed.
 *
 * Version ordering for `resolve` without an explicit version is a tiny
 * semver-ish comparator, {@link compareRendererVersions}: split on `"."`,
 * compare parts NUMERICALLY (so `0.10.0 > 0.2.0` — the classic
 * lexicographic trap), fall back to a lexicographic compare of a part when
 * either side is not a plain non-negative integer, treat missing trailing
 * parts as `0`, and break numeric ties (e.g. `"0.1"` vs `"0.1.0"`) by the raw
 * string so the order is total and deterministic.
 */
import { RendererCapability } from "@sporta/contracts";
import { RendererContractError } from "./errors";
import { cloneJson, errMessage } from "./internal";
import type { RendererPlugin } from "./plugin";

/**
 * Compares two renderer version strings. Returns a negative number when `a`
 * orders before `b`, a positive number when after, and `0` only for exact
 * string equality (numeric ties are broken lexicographically, so versions
 * that are numerically equal but textually different still have a total
 * order). See the module docs for the full rules.
 */
export function compareRendererVersions(a: string, b: string): number {
  if (a === b) return 0;
  const partsA = a.split(".");
  const partsB = b.split(".");
  const length = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < length; i += 1) {
    const sa = partsA[i] ?? "0";
    const sb = partsB[i] ?? "0";
    const na = /^\d+$/.test(sa) ? Number.parseInt(sa, 10) : undefined;
    const nb = /^\d+$/.test(sb) ? Number.parseInt(sb, 10) : undefined;
    let compared: number;
    if (na !== undefined && nb !== undefined) {
      compared = na < nb ? -1 : na > nb ? 1 : 0;
    } else {
      compared = sa < sb ? -1 : sa > sb ? 1 : 0;
    }
    if (compared !== 0) return compared;
  }
  // Numerically equal (e.g. "0.1" vs "0.1.0"): deterministic raw-string order.
  return a < b ? -1 : a > b ? 1 : 0;
}

interface Registration {
  plugin: RendererPlugin;
  capability: RendererCapability;
}

/**
 * The registry of available renderer plugins. One instance per process (or
 * per host scope); `clear()` exists for test convenience only.
 */
export class RendererRegistry {
  /** rendererId -> rendererVersion -> registration */
  private readonly byId = new Map<string, Map<string, Registration>>();

  /**
   * Registers a plugin. Throws {@link RendererContractError} (failureClass
   * `"internal"`) when `plugin.capability()` throws or does not parse as a
   * `RendererCapability`, or when the exact `rendererId` + `rendererVersion`
   * pair is already registered (versions are immutable). A different version
   * of an already-registered rendererId is allowed.
   */
  register(plugin: RendererPlugin): void {
    let raw: unknown;
    try {
      raw = plugin.capability();
    } catch (cause) {
      throw new RendererContractError(
        "cannot register a renderer whose capability() throws",
        "internal",
        { cause: errMessage(cause) },
      );
    }
    const parsed = RendererCapability.safeParse(raw);
    if (!parsed.success) {
      throw new RendererContractError(
        "cannot register a renderer with an invalid capability document",
        "internal",
        { issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) },
      );
    }
    const capability = parsed.data;
    const versions = this.byId.get(capability.rendererId);
    if (versions !== undefined && versions.has(capability.rendererVersion)) {
      throw new RendererContractError(
        `renderer "${capability.rendererId}" version "${capability.rendererVersion}" is already registered (renderer versions are immutable)`,
        "internal",
        { rendererId: capability.rendererId, rendererVersion: capability.rendererVersion },
      );
    }
    const registration: Registration = { plugin, capability: cloneJson(capability) };
    const target = versions ?? new Map<string, Registration>();
    target.set(capability.rendererVersion, registration);
    this.byId.set(capability.rendererId, target);
  }

  /**
   * Resolves a plugin by id. With `rendererVersion` given, the exact version
   * (an immutable identity) is required. Without it, the HIGHEST registered
   * version wins per {@link compareRendererVersions}. Unknown ids/versions
   * throw {@link RendererContractError} (failureClass `"internal"`).
   */
  resolve(rendererId: string, rendererVersion?: string): RendererPlugin {
    const versions = this.byId.get(rendererId);
    if (versions === undefined || versions.size === 0) {
      throw new RendererContractError(
        `no renderer registered for rendererId "${rendererId}"`,
        "internal",
        { rendererId },
      );
    }
    if (rendererVersion === undefined) {
      let best: string | undefined;
      for (const version of versions.keys()) {
        if (best === undefined || compareRendererVersions(version, best) > 0) best = version;
      }
      // best is defined: versions is non-empty and best is assigned on the
      // first iteration.
      return versions.get(best ?? "")!.plugin;
    }
    const registration = versions.get(rendererVersion);
    if (registration === undefined) {
      throw new RendererContractError(
        `renderer "${rendererId}" has no version "${rendererVersion}" (registered: ${[
          ...versions.keys(),
        ]
          .sort(compareRendererVersions)
          .join(", ")})`,
        "internal",
        { rendererId, rendererVersion, registeredVersions: [...versions.keys()] },
      );
    }
    return registration.plugin;
  }

  /**
   * The capability documents of every registered plugin, sorted ascending by
   * `rendererId`, then by version per {@link compareRendererVersions}.
   * Returns fresh clones: mutating a returned document cannot corrupt the
   * registry.
   */
  list(): RendererCapability[] {
    const out: RendererCapability[] = [];
    const ids = [...this.byId.keys()].sort();
    for (const id of ids) {
      const versions = this.byId.get(id);
      if (versions === undefined) continue; // defensive: ids came from the map
      const sorted = [...versions.entries()].sort(([a], [b]) => compareRendererVersions(a, b));
      for (const [, registration] of sorted) out.push(cloneJson(registration.capability));
    }
    return out;
  }

  /** Removes every registration (test convenience; not a production path). */
  clear(): void {
    this.byId.clear();
  }
}
