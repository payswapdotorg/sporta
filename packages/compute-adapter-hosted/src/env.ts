/**
 * Environment-driven provider selection (W914 Wave 2) — the COMPOSITION
 * helper (not domain code): resolves which compute adapter a composition
 * root wires into the control plane, from configuration only:
 *
 * - `COMPUTE_PROVIDER=in-process` (default): a `ComputeWorker` executing
 *   REAL render jobs in-process (the dev/reference provider — no transport);
 * - `COMPUTE_PROVIDER=http`: a `HostedComputeAdapter` whose execution
 *   function POSTs to `COMPUTE_WORKER_URL` (the hosted provider);
 * - `COMPUTE_PROVIDER=none`: no adapter (`null` — the control plane's async
 *   surface answers its typed unavailability error).
 *
 * This module reads `process.env` BY DESIGN (composition-root concern; the
 * package's domain modules — executor/worker/adapter/envelope/budgets —
 * read NO globals: clocks are injected, there is no randomness, and the
 * only I/O is the caller-supplied store/fetch seams). The default clock is
 * the real wall clock — again a composition-root decision.
 */
import { createAnimePrototypeRenderer } from "@sporta/renderer-anime";
import { createTestCardRenderer, RendererRegistry } from "@sporta/renderer-contract";
import { InMemoryRenderSegmentStore } from "@sporta/output-pipeline";
import type { RenderSegmentStore } from "@sporta/output-pipeline";
import type { ComputeAdapterPort } from "@sporta/compute-adapter";
import { ComputeWorker } from "./worker";
import { HostedComputeAdapter } from "./adapter";
import { createHttpExecuteFunction } from "./http";

/** The provider-selection vocabulary (closed). */
export type ComputeProviderSelection = "in-process" | "http" | "none";

/** What the resolver answers. */
export interface ResolvedComputeAdapter {
  /** The selected provider mode. */
  provider: ComputeProviderSelection;
  /** The adapter the control plane wires in (absent for "none"). */
  adapter: ComputeAdapterPort | null;
  /** The in-process worker, when `provider === "in-process"`. */
  worker: ComputeWorker | null;
}

/** Options for {@link resolveComputeAdapterFromEnv}. */
export interface ResolveComputeAdapterOptions {
  /** The environment to read (default `process.env`; tests inject). */
  env?: Record<string, string | undefined>;
  /** The injected wall clock (default `Date.now` — the composition root). */
  nowMs?: () => number;
  /** Override the in-process renderer registry (default: anime + testcard). */
  rendererRegistry?: RendererRegistry;
  /** Override the in-process W504 store (default: in-memory). */
  outputSegmentStore?: RenderSegmentStore;
  /** Override fetch (tests inject). */
  fetchFn?: typeof fetch;
}

/** The default worker registry: the REAL anime renderer + the test card. */
export function createDefaultWorkerRegistry(): RendererRegistry {
  const registry = new RendererRegistry();
  registry.register(createAnimePrototypeRenderer());
  registry.register(createTestCardRenderer());
  return registry;
}

/** Reads + validates the provider selection from the environment. */
export function computeProviderSelectionOf(
  env: Record<string, string | undefined> = process.env,
): ComputeProviderSelection {
  const raw = env["COMPUTE_PROVIDER"];
  if (raw === undefined || raw === "") return "in-process";
  if (raw === "in-process" || raw === "http" || raw === "none") return raw;
  throw new Error(
    `COMPUTE_PROVIDER must be one of "in-process" | "http" | "none" (got '${raw}')`,
  );
}

/**
 * Resolves the compute adapter from the environment (see module docs).
 * Throws loudly on an incomplete "http" configuration.
 */
export async function resolveComputeAdapterFromEnv(
  options: ResolveComputeAdapterOptions = {},
): Promise<ResolvedComputeAdapter> {
  const env = options.env ?? process.env;
  const nowMs = options.nowMs ?? (() => Date.now());
  const provider = computeProviderSelectionOf(env);
  if (provider === "none") {
    return { provider, adapter: null, worker: null };
  }
  if (provider === "http") {
    const workerUrl = env["COMPUTE_WORKER_URL"];
    if (workerUrl === undefined || workerUrl === "") {
      throw new Error('COMPUTE_PROVIDER=http requires COMPUTE_WORKER_URL');
    }
    const doFetch = options.fetchFn ?? fetch;
    // Descriptor honesty: the hosted adapter's descriptor IS the worker's
    // (fetched live — never a locally invented capability document).
    const descriptorResponse = await doFetch(`${workerUrl.replace(/\/+$/, "")}/v1/adapter`, {
      method: "GET",
    });
    if (!descriptorResponse.ok) {
      throw new Error(`compute worker descriptor fetch failed: HTTP ${descriptorResponse.status}`);
    }
    const descriptor = (await descriptorResponse.json()) as ConstructorParameters<
      typeof HostedComputeAdapter
    >[0]["descriptor"];
    const adapter = new HostedComputeAdapter({
      descriptor,
      execute: createHttpExecuteFunction(workerUrl, { fetchFn: doFetch }),
      nowMs,
      providerId: `http-worker@${new URL(workerUrl).host}`,
    });
    return { provider, adapter, worker: null };
  }
  const worker = new ComputeWorker({
    rendererRegistry: options.rendererRegistry ?? createDefaultWorkerRegistry(),
    outputSegmentStore: options.outputSegmentStore ?? new InMemoryRenderSegmentStore(),
    nowMs,
  });
  const adapter = new HostedComputeAdapter({
    descriptor: worker.describe(),
    execute: async (job, materialized) => {
      if (materialized === undefined) {
        throw new Error("in-process execution requires materialized inputs");
      }
      return mapExecution(await worker.execute({ job, inputs: materialized }));
    },
    nowMs,
    providerId: worker.providerId,
  });
  return { provider, adapter, worker };
}

/** Maps a worker execution into the envelope the adapter consumes. */
function mapExecution(
  execution: Awaited<ReturnType<ComputeWorker["execute"]>>,
): import("./envelope").HostedJobExecution {
  if (execution.kind === "refused") {
    throw new Error(`${execution.reason.errorClass}: ${execution.reason.message}`);
  }
  return execution.result;
}
