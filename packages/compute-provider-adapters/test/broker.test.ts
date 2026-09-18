/**
 * The R401 broker ↔ R402-R405 adapter plane: all four REAL provider
 * adapters registered behind the `InMemoryComputeBroker` — provider ids
 * are DATA (the broker never learns a vendor name), quotes are honest
 * nulls where the provider cannot estimate (pay-as-you-go RunPod), typed
 * refusals carry the closed vocabulary, and a REAL trivial workload
 * executes end-to-end through the broker via the local adapter.
 */
import { describe, expect, test } from "bun:test";
import type { ComputeAdapterPort, ComputeJobSnapshot } from "@sporta/compute-adapter";
import {
  ComputeBrokerRefusalError,
  ComputeQuoteRequest,
  InMemoryComputeBroker,
  UnknownComputeProviderError,
} from "@sporta/compute-adapter";
import { ModalComputeAdapter } from "../src/modal/adapter";
import { LightningComputeAdapter } from "../src/lightning/adapter";
import { RunPodComputeAdapter } from "../src/runpod/adapter";
import { LocalComputeAdapter } from "../src/local/adapter";
import { FixtureTransport, buildProviderJob, loadFixture, manualClock, until } from "./helpers";

/** The broker-registration composition (the R406 Connection Center's shape). */
function makeBroker(): {
  broker: InMemoryComputeBroker;
  modalTransport: FixtureTransport;
  local: LocalComputeAdapter;
} {
  const modalTransport = new FixtureTransport([loadFixture("modal", "verify-credentials-ok")]);
  const modal = new ModalComputeAdapter({
    tokenId: "modal-token-id-fixture",
    tokenSecret: "modal-token-secret-fixture",
    nowMs: manualClock(),
    fetchFn: modalTransport.fetch,
    sleep: () => Promise.resolve(),
    pollIntervalMs: 0,
    callTimeoutMs: 250,
  });
  const lightning = new LightningComputeAdapter({
    apiKey: "lightning-api-key-fixture",
    studioId: "studio-fixture-1",
    nowMs: manualClock(),
    fetchFn: (() => undefined) as unknown as typeof fetch,
    sleep: () => Promise.resolve(),
    pollIntervalMs: 0,
  });
  const runpod = new RunPodComputeAdapter({
    apiKey: "runpod-api-key-fixture",
    nowMs: manualClock(),
    fetchFn: (() => undefined) as unknown as typeof fetch,
    sleep: () => Promise.resolve(),
    pollIntervalMs: 0,
  });
  const local = new LocalComputeAdapter({
    commands: { "local.echo": { command: "echo", args: ["sporta-broker-ok"] } },
    nowMs: manualClock(),
    pollIntervalMs: 5,
  });
  const broker = new InMemoryComputeBroker({
    providers: [
      { providerId: "provider.modal", adapter: modal satisfies ComputeAdapterPort },
      { providerId: "provider.lightning", adapter: lightning satisfies ComputeAdapterPort },
      { providerId: "provider.runpod", adapter: runpod satisfies ComputeAdapterPort },
      { providerId: "provider.local", adapter: local satisfies ComputeAdapterPort },
    ],
  });
  return { broker, modalTransport, local };
}

/** A quote request the sporta renderer set serves, offline. */
const BASE_REQUEST = {
  schemaVersion: "1.0" as const,
  rendererId: "anime.prototype",
  latencyClass: "offline" as const,
  deadlineMs: 60_000,
};

describe("the R401 broker over the four R402-R405 adapters", () => {
  test("providers(): the registered descriptors in order, ids as DATA", () => {
    const { broker } = makeBroker();
    const descriptors = broker.providers();
    expect(descriptors.map((d) => d.adapterId)).toEqual([
      "provider.modal",
      "provider.lightning",
      "provider.runpod",
      "provider.local",
    ]);
    // The abstract kinds only — never a vendor name in a contract member.
    const kinds = new Set(descriptors.map((d) => d.providerKind));
    for (const kind of kinds) {
      expect(["in-memory", "cpu-worker", "gpu-worker", "managed-actor"]).toContain(kind);
    }
  });

  test("quote(): descriptor-compatible providers quote; estimates are HONEST NULLS", async () => {
    const { broker } = makeBroker();
    // The sporta renderer set: the three REMOTE adapters declare it (the
    // local adapter's descriptor derives from its own command table).
    const remoteQuotes = await broker.quote(ComputeQuoteRequest.parse(BASE_REQUEST));
    expect(remoteQuotes.map((q) => q.providerId)).toEqual([
      "provider.modal",
      "provider.lightning",
      "provider.runpod",
    ]);
    // The local adapter's own renderer: only it declares `local.echo`.
    const localQuotes = await broker.quote(
      ComputeQuoteRequest.parse({ ...BASE_REQUEST, rendererId: "local.echo" }),
    );
    expect(localQuotes.map((q) => q.providerId)).toEqual(["provider.local"]);
    // No quoting function was registered: every estimate is an honest null
    // (the pay-as-you-go RunPod posture explicitly included — never a
    // fabricated price or queue time).
    for (const quote of [...remoteQuotes, ...localQuotes]) {
      expect(quote.estimatedCostUsd).toBeNull();
      expect(quote.estimatedQueueSeconds).toBeNull();
      expect(quote.validUntilMs).toBeGreaterThanOrEqual(quote.quotedAtMs);
    }
  });

  test("select(): the preferred provider wins; non-eligible providers get typed refusals", async () => {
    const { broker } = makeBroker();
    const selection = await broker.select(
      ComputeQuoteRequest.parse({ ...BASE_REQUEST, rendererId: "local.echo" }),
      { preferredProviderId: "provider.local" },
    );
    expect(selection.providerId).toBe("provider.local");
    // The three remote adapters do not declare `local.echo`: each gets a
    // TYPED descriptor refusal — never a silent skip. Their provider ids
    // ride the refusal records as DATA.
    expect(selection.refusals.map((r) => r.providerId)).toEqual([
      "provider.modal",
      "provider.lightning",
      "provider.runpod",
    ]);
    for (const refusal of selection.refusals) {
      expect(refusal.reason).toBe("provider-unavailable");
      expect(refusal.message).toContain("local.echo");
    }
  });

  test("select() honors the local adapter's CPU-only descriptor (no-compatible-gpu)", async () => {
    const { broker } = makeBroker();
    let thrown: unknown;
    try {
      await broker.select(
        ComputeQuoteRequest.parse({
          ...BASE_REQUEST,
          // A GPU-requiring workload: only gpu-worker descriptors serve it
          // (lightning/runpod), and the CPU-only local adapter refuses typed.
          resourceHints: { requiresGpu: true },
          rendererId: "local.echo", // only the local adapter declares it
        }),
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ComputeBrokerRefusalError);
    const error = thrown as ComputeBrokerRefusalError;
    // The provider ids are DATA on the refusals; the reasons are the closed
    // vocabulary. No provider NAME appears as a vocabulary member.
    const byProvider = new Map(error.refusals.map((r) => [r.providerId, r.reason]));
    expect(byProvider.get("provider.local")).toBe("no-compatible-gpu");
    expect(byProvider.get("provider.modal")).toBe("provider-unavailable");
    expect(error.failureClass).toBe("media-invalid"); // no capacity refusal
  });

  test("the unavailable-set wiring (R406's composition job): a credential-missing provider refuses typed", async () => {
    const modal = new ModalComputeAdapter({
      tokenId: "", // SandboxFallback
      tokenSecret: "",
      nowMs: manualClock(),
      sleep: () => Promise.resolve(),
      pollIntervalMs: 0,
    });
    const local = new LocalComputeAdapter({
      commands: { "local.echo": { command: "echo", args: ["ok"] } },
      nowMs: manualClock(),
      pollIntervalMs: 5,
    });
    const broker = new InMemoryComputeBroker({
      providers: [
        { providerId: "provider.modal", adapter: modal },
        { providerId: "provider.local", adapter: local },
      ],
      // The composition root wires the adapter's honest credential state
      // into the broker's availability set (the R406 Connection Center
      // consumes `credentialStatus()` exactly this way).
      unavailable: new Set(["provider.modal"]),
    });
    const selection = await broker.select(
      ComputeQuoteRequest.parse({ ...BASE_REQUEST, rendererId: "local.echo" }),
      { preferredProviderId: "provider.modal" },
    );
    expect(selection.providerId).toBe("provider.local");
    expect(selection.refusals).toEqual([
      {
        providerId: "provider.modal",
        reason: "provider-unavailable",
        message: "the provider is currently unavailable",
      },
    ]);
  });

  test("dispatch/status/cancel DELEGATE to the chosen provider: a REAL workload through the broker", async () => {
    const { broker } = makeBroker();
    const job = buildProviderJob({
      jobId: "broker-local-1",
      idempotencyKey: "broker-local-1",
      rendererId: "local.echo",
    });
    // The local adapter's descriptor declares local.echo; the broker
    // delegates VERBATIM (the adapter's admission drives acceptance).
    const outcome = await broker.dispatch("provider.local", job);
    expect(outcome.disposition).toBe("admitted");
    const terminal = await until(
      () => broker.status("provider.local", job.jobId),
      (snap): snap is ComputeJobSnapshot => snap !== null && snap.completion !== undefined,
    );
    expect(terminal.state).toBe("succeeded");
    expect(terminal.completion!.outputs[0]!.delivery).toEqual({
      mode: "inline",
      content: "sporta-broker-ok\n",
    });
    // An unknown provider is the typed route error — never a silent null.
    let thrown: unknown;
    try {
      await broker.status("provider.nope", job.jobId);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(UnknownComputeProviderError);
    expect((thrown as UnknownComputeProviderError).providerId).toBe("provider.nope");
  });

  test("the remote adapters' dispatch gates fire THROUGH the broker (fail-loud, never a silent queue)", async () => {
    const modal = new ModalComputeAdapter({
      tokenId: "",
      tokenSecret: "",
      nowMs: manualClock(),
      sleep: () => Promise.resolve(),
      pollIntervalMs: 0,
    });
    const broker = new InMemoryComputeBroker({
      providers: [{ providerId: "provider.modal", adapter: modal }],
    });
    let thrown: unknown;
    try {
      await broker.dispatch("provider.modal", buildProviderJob({ rendererId: "anime.prototype" }));
    } catch (err) {
      thrown = err;
    }
    expect((thrown as Error).name).toBe("ProviderRefusalError");
    expect((thrown as { refusalReason?: string }).refusalReason).toBe("provider-unavailable");
  });
});
