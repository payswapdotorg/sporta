import { describe, expect, test } from "bun:test";
import type { RendererCapability } from "@sporta/contracts";
import { RendererContractError, RendererRegistry, compareRendererVersions } from "../src/index";
import type { RendererPlugin } from "../src/index";
import { SANE_PROFILE, makeSaneRenderer } from "./helpers";

/** A distinct conformant plugin with a chosen id/version. */
function pluginWith(rendererId: string, rendererVersion: string): RendererPlugin {
  return makeSaneRenderer({
    capability: {
      rendererId,
      rendererVersion,
      rendererClass: "tactical",
      supportedOutputProfiles: [SANE_PROFILE],
      requiresSourceFrames: false,
      minSnapshotVersion: 1,
    },
  });
}

describe("RendererRegistry.register", () => {
  test("registers and resolves the exact plugin", () => {
    const registry = new RendererRegistry();
    const plugin = pluginWith("r.alpha", "1.0.0");
    registry.register(plugin);
    expect(registry.resolve("r.alpha", "1.0.0")).toBe(plugin);
  });

  test("throws on a duplicate rendererId + rendererVersion (versions are immutable)", () => {
    const registry = new RendererRegistry();
    const first = pluginWith("r.alpha", "1.0.0");
    const impostor = pluginWith("r.alpha", "1.0.0");
    registry.register(first);
    expect(() => registry.register(impostor)).toThrow(RendererContractError);
    try {
      registry.register(impostor);
    } catch (error) {
      const contractError = error as RendererContractError;
      expect(contractError.failureClass).toBe("internal");
      expect(contractError.details).toMatchObject({
        rendererId: "r.alpha",
        rendererVersion: "1.0.0",
      });
    }
    // The original registration is untouched.
    expect(registry.resolve("r.alpha", "1.0.0")).toBe(first);
  });

  test("allows a different version of the same rendererId", () => {
    const registry = new RendererRegistry();
    const v1 = pluginWith("r.alpha", "1.0.0");
    const v2 = pluginWith("r.alpha", "1.1.0");
    registry.register(v1);
    registry.register(v2);
    expect(registry.resolve("r.alpha", "1.0.0")).toBe(v1);
    expect(registry.resolve("r.alpha", "1.1.0")).toBe(v2);
  });

  test("throws on a plugin whose capability does not parse", () => {
    const registry = new RendererRegistry();
    const broken = makeSaneRenderer({
      capability: {
        rendererId: "r.broken",
        rendererVersion: "1.0.0",
        rendererClass: "tactical",
        supportedOutputProfiles: [SANE_PROFILE],
        requiresSourceFrames: false,
        minSnapshotVersion: -1, // schema-invalid: int min(0)
      },
    });
    expect(() => registry.register(broken)).toThrow(RendererContractError);
  });
});

describe("RendererRegistry.resolve", () => {
  test("without a version, picks the numerically highest (0.10.0 > 0.9.0 > 0.2.0)", () => {
    const registry = new RendererRegistry();
    // Registered in an order where lexicographic sort would pick "0.2.0".
    registry.register(pluginWith("r.latest", "0.2.0"));
    registry.register(pluginWith("r.latest", "0.10.0"));
    registry.register(pluginWith("r.latest", "0.9.0"));
    const resolved = registry.resolve("r.latest");
    expect(resolved.capability().rendererVersion).toBe("0.10.0");
  });

  test("resolve exact and resolve-latest agree when only one version exists", () => {
    const registry = new RendererRegistry();
    const plugin = pluginWith("r.single", "2.3.4");
    registry.register(plugin);
    expect(registry.resolve("r.single")).toBe(plugin);
    expect(registry.resolve("r.single", "2.3.4")).toBe(plugin);
  });

  test("unknown rendererId throws", () => {
    const registry = new RendererRegistry();
    expect(() => registry.resolve("r.missing")).toThrow(RendererContractError);
    try {
      registry.resolve("r.missing");
    } catch (error) {
      expect((error as RendererContractError).details).toMatchObject({ rendererId: "r.missing" });
    }
  });

  test("known rendererId but unknown version throws with the registered versions as evidence", () => {
    const registry = new RendererRegistry();
    registry.register(pluginWith("r.alpha", "1.0.0"));
    registry.register(pluginWith("r.alpha", "1.1.0"));
    expect(() => registry.resolve("r.alpha", "0.0.7")).toThrow(RendererContractError);
    try {
      registry.resolve("r.alpha", "0.0.7");
    } catch (error) {
      expect((error as RendererContractError).details).toMatchObject({
        rendererId: "r.alpha",
        rendererVersion: "0.0.7",
        registeredVersions: ["1.0.0", "1.1.0"],
      });
    }
  });
});

describe("RendererRegistry.list", () => {
  test("returns capabilities sorted by rendererId then version, as clones", () => {
    const registry = new RendererRegistry();
    registry.register(pluginWith("r.beta", "0.2.0"));
    registry.register(pluginWith("r.alpha", "0.10.0"));
    registry.register(pluginWith("r.alpha", "0.2.0"));
    registry.register(pluginWith("r.gamma", "1.0.0"));

    const capabilities = registry.list();
    expect(capabilities.map((c) => `${c.rendererId}@${c.rendererVersion}`)).toEqual([
      "r.alpha@0.2.0",
      "r.alpha@0.10.0",
      "r.beta@0.2.0",
      "r.gamma@1.0.0",
    ]);

    // Mutating a returned document cannot corrupt the registry.
    const first = capabilities[0] as RendererCapability;
    first.rendererId = "corrupted";
    first.rendererVersion = "99.0";
    expect(registry.list()[0]).toMatchObject({ rendererId: "r.alpha", rendererVersion: "0.2.0" });
  });

  test("clear() removes every registration", () => {
    const registry = new RendererRegistry();
    registry.register(pluginWith("r.alpha", "1.0.0"));
    registry.clear();
    expect(registry.list()).toEqual([]);
    expect(() => registry.resolve("r.alpha")).toThrow(RendererContractError);
  });
});

describe("compareRendererVersions", () => {
  test("compares dotted parts numerically (0.10.0 > 0.2.0, 0.9.0 > 0.2.0)", () => {
    expect(compareRendererVersions("0.10.0", "0.2.0")).toBeGreaterThan(0);
    expect(compareRendererVersions("0.2.0", "0.10.0")).toBeLessThan(0);
    expect(compareRendererVersions("0.9.0", "0.2.0")).toBeGreaterThan(0);
    expect(compareRendererVersions("1.2.3", "1.2.4")).toBeLessThan(0);
    expect(compareRendererVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareRendererVersions("1.0.0", "1.0.0")).toBe(0);
  });

  test("treats missing trailing parts as zero and breaks numeric ties by the raw string", () => {
    expect(compareRendererVersions("0.1", "0.1.0")).toBeLessThan(0);
    expect(compareRendererVersions("1", "1.0.0")).toBeLessThan(0);
    expect(compareRendererVersions("1.0", "1.0.0")).toBeLessThan(0);
  });

  test("falls back to lexicographic order for non-numeric parts", () => {
    expect(compareRendererVersions("0.alpha", "0.beta")).toBeLessThan(0);
    expect(compareRendererVersions("0.beta", "0.alpha")).toBeGreaterThan(0);
    expect(compareRendererVersions("1.x.0", "1.9.0")).toBeGreaterThan(0); // "x" > "9"
  });
});
