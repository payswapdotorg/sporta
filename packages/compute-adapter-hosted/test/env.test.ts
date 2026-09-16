/**
 * Env-driven provider selection tests (W914 Wave 2): configuration only,
 * never a domain dependency — the composition root's vocabulary.
 */
import { describe, expect, it } from "bun:test";
import {
  computeProviderSelectionOf,
  createDefaultOutputSegmentStore,
  createDefaultWorkerRegistry,
  resolveComputeAdapterFromEnv,
} from "../src/index";
import { InMemoryRenderSegmentStore } from "@sporta/output-pipeline";
import { manualClock } from "./helpers";

describe("computeProviderSelectionOf", () => {
  it("defaults to in-process (undefined or empty)", () => {
    expect(computeProviderSelectionOf({})).toBe("in-process");
    expect(computeProviderSelectionOf({ COMPUTE_PROVIDER: "" })).toBe("in-process");
  });

  it("accepts the closed vocabulary", () => {
    expect(computeProviderSelectionOf({ COMPUTE_PROVIDER: "in-process" })).toBe("in-process");
    expect(computeProviderSelectionOf({ COMPUTE_PROVIDER: "http" })).toBe("http");
    expect(computeProviderSelectionOf({ COMPUTE_PROVIDER: "none" })).toBe("none");
  });

  it("rejects anything else, loudly", () => {
    expect(() => computeProviderSelectionOf({ COMPUTE_PROVIDER: "gpu" })).toThrow(
      /COMPUTE_PROVIDER must be one of/,
    );
  });
});

describe("resolveComputeAdapterFromEnv", () => {
  it("provider=none answers no adapter (the control plane's 503 posture)", async () => {
    const resolved = await resolveComputeAdapterFromEnv({
      env: { COMPUTE_PROVIDER: "none" },
      nowMs: manualClock(),
    });
    expect(resolved.provider).toBe("none");
    expect(resolved.adapter).toBeNull();
    expect(resolved.worker).toBeNull();
  });

  it("provider=in-process composes the REAL worker + adapter (dev reference)", async () => {
    const resolved = await resolveComputeAdapterFromEnv({
      env: {},
      nowMs: manualClock(),
    });
    expect(resolved.provider).toBe("in-process");
    expect(resolved.worker).not.toBeNull();
    expect(resolved.adapter).not.toBeNull();
    const descriptor = resolved.adapter!.describe();
    expect(descriptor.supportedRenderers.map((r) => r.rendererId)).toEqual([
      "anime.prototype",
      "sporta.testcard",
    ]);
  });

  it("provider=http requires COMPUTE_WORKER_URL", async () => {
    await expect(
      resolveComputeAdapterFromEnv({ env: { COMPUTE_PROVIDER: "http" }, nowMs: manualClock() }),
    ).rejects.toThrow(/COMPUTE_PROVIDER=http requires COMPUTE_WORKER_URL/);
  });

  it("provider=http resolves the adapter with the LIVE descriptor (never invented)", async () => {
    // Serve a REAL worker; resolve the hosted adapter against it.
    const { createComputeWorkerServer } = await import("../src/index");
    const { createTestWorker } = await import("./helpers");
    const worker = createTestWorker();
    const server = createComputeWorkerServer({ worker, port: 0 });
    try {
      const resolved = await resolveComputeAdapterFromEnv({
        env: { COMPUTE_PROVIDER: "http", COMPUTE_WORKER_URL: `http://127.0.0.1:${server.port}` },
        nowMs: manualClock(),
      });
      expect(resolved.provider).toBe("http");
      expect(resolved.worker).toBeNull();
      expect(resolved.adapter).not.toBeNull();
      // The descriptor was FETCHED from the worker (adapterId + renderers).
      expect(resolved.adapter!.describe().adapterId).toBe(worker.adapterId);
      expect(resolved.adapter!.describe().supportedRenderers).toEqual(
        worker.describe().supportedRenderers,
      );
    } finally {
      server.stop(true);
    }
  });

  it("provider=http fails loudly when the descriptor fetch fails", async () => {
    // An HTTP error answer (injected fetch): the wrapped, typed failure.
    await expect(
      resolveComputeAdapterFromEnv({
        env: { COMPUTE_PROVIDER: "http", COMPUTE_WORKER_URL: "http://worker.invalid" },
        nowMs: manualClock(),
        fetchFn: (async () => new Response("down", { status: 503 })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/descriptor fetch failed: HTTP 503/);
    // A connection-level fault (unreachable worker) also rejects loudly.
    await expect(
      resolveComputeAdapterFromEnv({
        env: { COMPUTE_PROVIDER: "http", COMPUTE_WORKER_URL: "http://127.0.0.1:9" },
        nowMs: manualClock(),
      }),
    ).rejects.toThrow();
  });
});

describe("the default compositions", () => {
  it("createDefaultWorkerRegistry carries the REAL renderers", () => {
    const registry = createDefaultWorkerRegistry();
    expect(registry.resolve("anime.prototype").capability().rendererId).toBe("anime.prototype");
    expect(registry.resolve("sporta.testcard").capability().rendererId).toBe("sporta.testcard");
  });

  it("createDefaultOutputSegmentStore is a REAL W504 store", () => {
    const store = createDefaultOutputSegmentStore();
    expect(store).toBeInstanceOf(InMemoryRenderSegmentStore);
  });
});
