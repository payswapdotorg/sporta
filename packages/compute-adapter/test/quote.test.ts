/**
 * COMPUTE BROKER TESTS (R401): the quote/select layer over the W914
 * in-memory reference adapter — the exact composition the packet prescribes
 * ("an in-memory broker over the existing in-memory adapter").
 *
 * Proves, end to end and deterministically (injected counter clock):
 *
 * 1. QUOTE: one quote per ELIGIBLE provider (descriptor-compatible only),
 *    honest `null` estimates by default, injected estimates carried
 *    verbatim, quote validity derived from the injected clock;
 * 2. SELECT: preferred-provider routing, first-eligible determinism, and a
 *    typed refusal for EVERY non-selected provider (never a silent skip);
 * 3. TYPED REFUSALS: each closed-vocabulary member is reachable and
 *    attributable — `no-compatible-gpu` (a GPU-requiring workload against a
 *    cpu/in-memory kind), `quota-exhausted` (both the provider-side flag
 *    and the policy's queue bound), `credential-invalid`,
 *    `provider-unavailable` (flag + descriptor incompatibility), and
 *    `budget-exceeded` (the policy's cost bound over a real estimate);
 * 4. FAIL-LOUD: a workload nothing can serve throws
 *    `ComputeBrokerRefusalError` carrying EVERY refusal;
 * 5. DISPATCH/COLLECT: quote → select → broker.dispatch → provider-driven
 *    execution → broker.status collects the terminal snapshot THROUGH the
 *    chosen adapter (the W914 accounting untouched — the broker adds no
 *    ledger of its own); cancel delegates verbatim; an unknown provider id
 *    is the typed `UnknownComputeProviderError`.
 */
import { describe, expect, test } from "bun:test";
import { ComputeJobDescription } from "../src/schemas";
import { awaitCompletion } from "../src/adapter";
import { InMemoryComputeAdapter } from "../src/memory-adapter";
import {
  COMPUTE_BROKER_REFUSALS,
  ComputeBrokerRefusalError,
  ComputeQuote,
  ComputeQuoteRequest,
  InMemoryComputeBroker,
  UnknownComputeProviderError,
} from "../src/quote";
import { makeArtifact, makeCounter, makeDescriptor, makeJob } from "./helpers";

/** The logical workload a caller quotes with (NO provider name — data only). */
function requestWith(overrides: Record<string, unknown> = {}): ComputeQuoteRequest {
  return ComputeQuoteRequest.parse({
    schemaVersion: "1.0",
    rendererId: "anime.prototype",
    latencyClass: "offline",
    deadlineMs: 60_000,
    ...overrides,
  });
}

/** A job description addressed to a specific renderer (the dispatch payload). */
function jobWith(overrides: Record<string, unknown> = {}): ComputeJobDescription {
  return ComputeJobDescription.parse(makeJob(overrides));
}

/** A standard in-memory provider adapter (cpu-shaped descriptor). */
function cpuAdapter(id: string): InMemoryComputeAdapter {
  return new InMemoryComputeAdapter({
    descriptor: makeDescriptor({ adapterId: id, providerKind: "in-memory" }),
    nowMs: makeCounter(),
  });
}

/** A GPU-shaped in-memory provider adapter (the same seam, another kind). */
function gpuAdapter(id: string): InMemoryComputeAdapter {
  return new InMemoryComputeAdapter({
    descriptor: makeDescriptor({
      adapterId: id,
      providerKind: "gpu-worker",
      costUnits: [
        { unitId: "gpu-ms", unitKind: "time-ms", description: "injected-clock gpu ms" },
        { unitId: "jobs", unitKind: "count" },
      ],
    }),
    nowMs: makeCounter(),
  });
}

describe("the closed refusal vocabulary", () => {
  test("is exactly the R401 five-member set (provider ids are data, not members)", () => {
    expect([...COMPUTE_BROKER_REFUSALS]).toEqual([
      "no-compatible-gpu",
      "quota-exhausted",
      "credential-invalid",
      "budget-exceeded",
      "provider-unavailable",
    ]);
  });
});

describe("quote", () => {
  test("returns one quote per ELIGIBLE provider, in registration order", async () => {
    const broker = new InMemoryComputeBroker({
      providers: [
        { providerId: "p-cpu", adapter: cpuAdapter("p-cpu") },
        { providerId: "p-gpu", adapter: gpuAdapter("p-gpu") },
      ],
      nowMs: makeCounter(1_000),
    });
    const quotes = await broker.quote(requestWith());
    expect(quotes.map((quote) => quote.providerId)).toEqual(["p-cpu", "p-gpu"]);
    for (const quote of quotes) {
      expect(() => ComputeQuote.parse(quote)).not.toThrow();
      expect(quote.capability.providerKind).toBe(
        quote.providerId === "p-gpu" ? "gpu-worker" : "in-memory",
      );
    }
  });

  test("estimates are HONEST nulls without an injected quoting function", async () => {
    const broker = new InMemoryComputeBroker({
      providers: [{ providerId: "p-cpu", adapter: cpuAdapter("p-cpu") }],
      nowMs: makeCounter(5_000),
      quoteValidityMs: 30_000,
    });
    const [quote] = await broker.quote(requestWith());
    expect(quote!.estimatedCostUsd).toBe(null);
    expect(quote!.estimatedQueueSeconds).toBe(null);
    expect(quote!.quotedAtMs).toBe(5_001);
    expect(quote!.validUntilMs).toBe(5_001 + 30_000);
  });

  test("carries injected estimates verbatim (never fabricated, never dropped)", async () => {
    const broker = new InMemoryComputeBroker({
      providers: [{ providerId: "p-gpu", adapter: gpuAdapter("p-gpu") }],
      quoting: new Map([
        [
          "p-gpu",
          {
            estimate: () => ({ estimatedCostUsd: 0.42, estimatedQueueSeconds: 12.5 }),
          },
        ],
      ]),
      nowMs: makeCounter(0),
    });
    const [quote] = await broker.quote(requestWith());
    expect(quote!.estimatedCostUsd).toBe(0.42);
    expect(quote!.estimatedQueueSeconds).toBe(12.5);
  });

  test("a descriptor-incompatible provider is simply not quoted", async () => {
    const tacticalOnly = new InMemoryComputeAdapter({
      descriptor: makeDescriptor({
        adapterId: "p-tactical",
        supportedRenderers: [{ rendererId: "tactical.prototype" }],
      }),
      nowMs: makeCounter(),
    });
    const broker = new InMemoryComputeBroker({
      providers: [{ providerId: "p-tactical", adapter: tacticalOnly }],
      nowMs: makeCounter(),
    });
    expect(await broker.quote(requestWith())).toEqual([]);
    // The same provider IS quoted for the renderer it declares.
    expect(await broker.quote(requestWith({ rendererId: "tactical.prototype" }))).toHaveLength(1);
  });

  test("providers() exposes every registered descriptor", () => {
    const broker = new InMemoryComputeBroker({
      providers: [
        { providerId: "p-cpu", adapter: cpuAdapter("p-cpu") },
        { providerId: "p-gpu", adapter: gpuAdapter("p-gpu") },
      ],
    });
    expect(broker.providers().map((descriptor) => descriptor.adapterId)).toEqual([
      "p-cpu",
      "p-gpu",
    ]);
  });
});

describe("select", () => {
  test("routes to the preferred provider when quoted and eligible", async () => {
    const broker = new InMemoryComputeBroker({
      providers: [
        { providerId: "p-cpu", adapter: cpuAdapter("p-cpu") },
        { providerId: "p-gpu", adapter: gpuAdapter("p-gpu") },
      ],
      nowMs: makeCounter(),
    });
    const selection = await broker.select(requestWith({ resourceHints: { requiresGpu: true } }), {
      preferredProviderId: "p-gpu",
    });
    expect(selection.providerId).toBe("p-gpu");
    expect(selection.quote.providerId).toBe("p-gpu");
    // The cpu provider's refusal is the TYPED no-compatible-gpu one.
    const cpuRefusal = selection.refusals.find((refusal) => refusal.providerId === "p-cpu")!;
    expect(cpuRefusal.reason).toBe("no-compatible-gpu");
    expect(cpuRefusal.message).toContain("GPU");
  });

  test("falls back to the FIRST eligible provider (deterministic) with typed refusals for the rest", async () => {
    const broker = new InMemoryComputeBroker({
      providers: [
        { providerId: "p-cpu", adapter: cpuAdapter("p-cpu") },
        { providerId: "p-gpu", adapter: gpuAdapter("p-gpu") },
      ],
      nowMs: makeCounter(),
    });
    const selection = await broker.select(requestWith());
    expect(selection.providerId).toBe("p-cpu");
    expect(selection.refusals).toEqual([]);
  });

  test("budget-exceeded: a real estimate over the policy's cost bound refuses with the reason", async () => {
    const broker = new InMemoryComputeBroker({
      providers: [
        { providerId: "p-cheap", adapter: cpuAdapter("p-cheap") },
        { providerId: "p-pricey", adapter: gpuAdapter("p-pricey") },
      ],
      quoting: new Map([
        ["p-cheap", { estimate: () => ({ estimatedCostUsd: 0.1, estimatedQueueSeconds: null }) }],
        ["p-pricey", { estimate: () => ({ estimatedCostUsd: 9.5, estimatedQueueSeconds: null }) }],
      ]),
      nowMs: makeCounter(),
    });
    const selection = await broker.select(requestWith(), { maxEstimatedCostUsd: 1 });
    expect(selection.providerId).toBe("p-cheap");
    const pricey = selection.refusals.find((refusal) => refusal.providerId === "p-pricey")!;
    expect(pricey.reason).toBe("budget-exceeded");
    expect(pricey.message).toContain("$9.5");
  });

  test("null estimates pass policy bounds (an unknown is not a refusal)", async () => {
    const broker = new InMemoryComputeBroker({
      providers: [{ providerId: "p-unknown", adapter: cpuAdapter("p-unknown") }],
      nowMs: makeCounter(),
    });
    const selection = await broker.select(requestWith(), { maxEstimatedCostUsd: 0.01 });
    expect(selection.providerId).toBe("p-unknown");
    expect(selection.refusals).toEqual([]);
  });

  test("quota-exhausted: the provider-side flag refuses with the reason", async () => {
    const broker = new InMemoryComputeBroker({
      providers: [{ providerId: "p-dry", adapter: cpuAdapter("p-dry") }],
      quotaExhausted: new Set(["p-dry"]),
      nowMs: makeCounter(),
    });
    let error: unknown;
    try {
      await broker.select(requestWith());
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ComputeBrokerRefusalError);
    const refusal = error as ComputeBrokerRefusalError;
    expect(refusal.failureClass).toBe("resource-limit");
    expect(refusal.refusals).toHaveLength(1);
    expect(refusal.refusals[0]!.reason).toBe("quota-exhausted");
  });

  test("quota-exhausted: a policy queue bound over a real estimate refuses with the reason", async () => {
    const broker = new InMemoryComputeBroker({
      providers: [{ providerId: "p-slow", adapter: cpuAdapter("p-slow") }],
      quoting: new Map([
        ["p-slow", { estimate: () => ({ estimatedCostUsd: null, estimatedQueueSeconds: 600 }) }],
      ]),
      nowMs: makeCounter(),
    });
    let error: unknown;
    try {
      await broker.select(requestWith(), { maxEstimatedQueueSeconds: 60 });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ComputeBrokerRefusalError);
    const refusal = error as ComputeBrokerRefusalError;
    expect(refusal.refusals[0]!.reason).toBe("quota-exhausted");
    expect(refusal.refusals[0]!.message).toContain("600");
  });

  test("credential-invalid and provider-unavailable refuse with their reasons", async () => {
    const broker = new InMemoryComputeBroker({
      providers: [
        { providerId: "p-bad-auth", adapter: cpuAdapter("p-bad-auth") },
        { providerId: "p-down", adapter: cpuAdapter("p-down") },
      ],
      credentialInvalid: new Set(["p-bad-auth"]),
      unavailable: new Set(["p-down"]),
      nowMs: makeCounter(),
    });
    let error: unknown;
    try {
      await broker.select(requestWith());
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ComputeBrokerRefusalError);
    const refusal = error as ComputeBrokerRefusalError;
    const byId = new Map(refusal.refusals.map((entry) => [entry.providerId, entry.reason]));
    expect(byId.get("p-bad-auth")).toBe("credential-invalid");
    expect(byId.get("p-down")).toBe("provider-unavailable");
  });

  test("provider-unavailable also covers deadline-bound incompatibility", async () => {
    const broker = new InMemoryComputeBroker({
      providers: [{ providerId: "p-tight", adapter: cpuAdapter("p-tight") }],
      nowMs: makeCounter(),
    });
    let error: unknown;
    try {
      await broker.select(requestWith({ deadlineMs: 10_000_000 }));
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ComputeBrokerRefusalError);
    const refusal = error as ComputeBrokerRefusalError;
    expect(refusal.failureClass).toBe("media-invalid");
    expect(refusal.refusals[0]!.reason).toBe("provider-unavailable");
    expect(refusal.refusals[0]!.message).toContain("deadline");
  });

  test("no-compatible-gpu: a GPU-requiring workload against only cpu-shaped providers", async () => {
    const broker = new InMemoryComputeBroker({
      providers: [{ providerId: "p-cpu", adapter: cpuAdapter("p-cpu") }],
      nowMs: makeCounter(),
    });
    let error: unknown;
    try {
      await broker.select(requestWith({ resourceHints: { requiresGpu: true } }));
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ComputeBrokerRefusalError);
    const refusal = error as ComputeBrokerRefusalError;
    expect(refusal.refusals[0]!.reason).toBe("no-compatible-gpu");
  });
});

describe("dispatch / status / cancel — delegation to the chosen adapter", () => {
  test("quote → select → dispatch → collect end to end through the chosen adapter", async () => {
    const chosen = cpuAdapter("p-cpu");
    const broker = new InMemoryComputeBroker({
      providers: [
        { providerId: "p-cpu", adapter: chosen },
        { providerId: "p-gpu", adapter: gpuAdapter("p-gpu") },
      ],
      nowMs: makeCounter(),
    });

    // 1. Quote + select (the GPU-requiring workload picks the GPU provider).
    const selection = await broker.select(requestWith({ resourceHints: { requiresGpu: true } }));
    expect(selection.providerId).toBe("p-gpu");
    expect(broker.providers().find((descriptor) => descriptor.adapterId === "p-gpu")).toBeDefined();

    // 2. Dispatch THROUGH the broker onto the selected provider.
    const job = jobWith();
    const outcome = await broker.dispatch("p-gpu", job);
    expect(outcome.disposition).toBe("admitted");

    // 3. The broker's status poll sees the W914 snapshot (dispatched+queued).
    const queued = await broker.status("p-gpu", job.jobId);
    expect(queued?.state).toBe("queued");

    // 4. Drive the provider to completion and COLLECT through the broker
    //    (the in-memory reference drives execution through its provider
    //    port, exactly like memory-adapter.test.ts).
    const gpu = brokerProvidersOf(broker).find((entry) => entry.providerId === "p-gpu")!
      .adapter as InMemoryComputeAdapter;
    gpu.provider.reportStarted(job.jobId);
    gpu.provider.reportOutcome(job.jobId, {
      status: "succeeded",
      outputs: [makeArtifact() as never],
      consumedInputIds: ["snap-0", "events-0"],
    });

    const completion = await awaitCompletion(brokerAdapterOf(broker, "p-gpu"), job.jobId);
    expect(completion.status).toBe("succeeded");
    expect(completion.outputs).toHaveLength(1);

    const terminal = await broker.status("p-gpu", job.jobId);
    expect(terminal?.state).toBe("succeeded");
    expect(terminal?.completion?.status).toBe("succeeded");

    // 5. The CPU adapter (not selected) never saw the job.
    expect(await chosen.getJob(job.jobId)).toBe(null);
  });

  test("cancel delegates verbatim (idempotent, the W914 semantics)", async () => {
    const adapter = cpuAdapter("p-cpu");
    const broker = new InMemoryComputeBroker({
      providers: [{ providerId: "p-cpu", adapter }],
      nowMs: makeCounter(),
    });
    const job = jobWith();
    await broker.dispatch("p-cpu", job);
    const first = await broker.cancel("p-cpu", job.jobId);
    expect(first.cancelled).toBe(true);
    const second = await broker.cancel("p-cpu", job.jobId);
    expect(second.cancelled).toBe(false);
  });

  test("an unknown provider id is the typed UnknownComputeProviderError", async () => {
    const broker = new InMemoryComputeBroker({
      providers: [{ providerId: "p-cpu", adapter: cpuAdapter("p-cpu") }],
      nowMs: makeCounter(),
    });
    await expect(broker.dispatch("p-ghost", jobWith())).rejects.toBeInstanceOf(
      UnknownComputeProviderError,
    );
    await expect(broker.status("p-ghost", "any")).rejects.toBeInstanceOf(
      UnknownComputeProviderError,
    );
    await expect(broker.cancel("p-ghost", "any")).rejects.toBeInstanceOf(
      UnknownComputeProviderError,
    );
  });

  test("construction rejects an empty or duplicate provider set loudly", () => {
    expect(() => new InMemoryComputeBroker({ providers: [] })).toThrow(/at least one provider/);
    const adapter = cpuAdapter("p-cpu");
    expect(
      () =>
        new InMemoryComputeBroker({
          providers: [
            { providerId: "p-cpu", adapter },
            { providerId: "p-cpu", adapter },
          ],
        }),
    ).toThrow(/duplicate compute provider id 'p-cpu'/);
  });
});

// ---------------------------------------------------------------------------
// Test-only accessors for the broker's registered providers (the reference
// broker is a test/composition substrate; tests drive the in-memory
// adapters' provider ports directly, exactly like memory-adapter.test.ts).
// ---------------------------------------------------------------------------

function brokerProvidersOf(
  broker: InMemoryComputeBroker,
): readonly { providerId: string; adapter: InMemoryComputeAdapter }[] {
  return (
    broker as unknown as {
      registered: readonly { providerId: string; adapter: InMemoryComputeAdapter }[];
    }
  ).registered;
}

function brokerAdapterOf(broker: InMemoryComputeBroker, providerId: string) {
  const found = brokerProvidersOf(broker).find((entry) => entry.providerId === providerId);
  if (found === undefined) {
    throw new Error(`no registered provider '${providerId}'`);
  }
  return found.adapter;
}
