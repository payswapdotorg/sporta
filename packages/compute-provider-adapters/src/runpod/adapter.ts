/**
 * `RunPodComputeAdapter` (R404) — the `provider.runpod` compute adapter:
 * the W914 `ComputeAdapterPort` (via the shared provider ledger,
 * ../common/ledger.ts) over the REAL RunPod REST client (./api.ts — plain
 * fetch against `https://api.runpod.ai`, the pods REST surface).
 *
 * ## Descriptor honesty (id `provider.runpod`, DATA never vocabulary)
 *
 * `gpu-worker` — RunPod pods are GPU cloud machines in the abstract
 * `ComputeProviderKind` vocabulary. Offline latency only, the sporta
 * renderer set (version truth: the deployment), the adapter's OWN bounds:
 * concurrency 2 (one pod per job — a heavy execution unit honestly gets a
 * small bound), deadline 30 s floor / 3_600 s ceiling (long renders), one
 * honest metering unit (`compute-ms`, measured).
 *
 * ## Pay-as-you-go honest quoting
 *
 * RunPod bills per-second at market prices this adapter CANNOT know: it
 * meters only what it measures (`compute-ms`), fabricates no price, and
 * the broker registers `provider.runpod` with NO quoting function — its
 * `ComputeQuote.estimatedCostUsd`/`estimatedQueueSeconds` are honest
 * `null`s (test/broker.test.ts pins this end-to-end).
 *
 * ## The credential path
 *
 * `RUNPOD_API_KEY`. `credentialStatus()` reports the honest closed states
 * (`missing | present-unverified | verified | invalid`); missing
 * credentials → the typed `provider-unavailable` refusal with the
 * SandboxFallback `devModeHint` BEFORE any network call; after a real 401
 * → pre-network `credential-invalid` refusals.
 */
import type { ComputeAdapterDescriptor } from "@sporta/compute-adapter";
import { ProviderLedgerAdapter } from "../common/ledger";
import type { ProviderLedgerAdapterOptions } from "../common/ledger";
import { ProviderCredentialMonitor } from "../common/credentials";
import { sandboxFallbackHint } from "../common/credentials";
import {
  DEFAULT_REMOTE_RENDERERS,
  MEASURED_COMPUTE_MS_UNIT,
  resolveDescriptor,
} from "../common/descriptors";
import type { DescriptorOverrides } from "../common/descriptors";
import { RunPodRestClient } from "./api";
import type { FetchLike } from "../common/http";

/** The adapter identity (DATA — the provider id, never a vocabulary member). */
export const RUNPOD_ADAPTER_ID = "provider.runpod";

/** The adapter contract version (MAJOR.MINOR). */
export const RUNPOD_ADAPTER_VERSION = "1.0";

/** The env names the composition root reads (never a credential value). */
export const RUNPOD_CREDENTIAL_ENV_NAMES = ["RUNPOD_API_KEY"] as const;

/** The honest default descriptor (documented bound-by-bound in class docs). */
export const RUNPOD_DEFAULT_DESCRIPTOR: ComputeAdapterDescriptor = resolveDescriptor(
  { adapterId: RUNPOD_ADAPTER_ID, adapterVersion: RUNPOD_ADAPTER_VERSION },
  {
    providerKind: "gpu-worker",
    supportedRenderers: [...DEFAULT_REMOTE_RENDERERS],
    supportedLatencyClasses: ["offline"],
    maxConcurrentJobs: 2,
    dispatchTimeoutMs: 30_000,
    maxJobDeadlineMs: 3_600_000,
    minJobDeadlineMs: 30_000,
    costUnits: [MEASURED_COMPUTE_MS_UNIT],
  },
);

/** Options for {@link RunPodComputeAdapter}. */
export interface RunPodComputeAdapterOptions extends Omit<
  ProviderLedgerAdapterOptions,
  "descriptor" | "client" | "credentials"
> {
  /** The account API key (omit in SandboxFallback mode). */
  apiKey?: string;
  /** The worker image created pods run (default the sporta worker image). */
  workerImage?: string;
  /** Operator descriptor overrides (their declaration, validated not verified). */
  descriptorOverrides?: DescriptorOverrides;
  /** The REST base (default `https://api.runpod.ai`). */
  apiBase?: string;
  /** The injected fetch (default: the real fetch — the conditional tier). */
  fetchFn?: FetchLike;
  /** The explicit per-call REST timeout (default 20 s; tests shorten it). */
  callTimeoutMs?: number;
}

/**
 * The `provider.runpod` adapter (R404): thin composition of the shared
 * provider ledger + the REAL RunPod REST client + the honest credential
 * monitor. See ../common/ledger.ts (ledger semantics) and ./api.ts (the
 * REST mapping + the pod-not-found posture).
 */
export class RunPodComputeAdapter extends ProviderLedgerAdapter {
  constructor(options: RunPodComputeAdapterOptions) {
    const apiKey = options.apiKey ?? "";
    const credentials = new ProviderCredentialMonitor({
      credentialsPresent: apiKey.length > 0,
      missingDetail: `${RUNPOD_CREDENTIAL_ENV_NAMES.join(" + ")} not configured`,
      devModeHint: sandboxFallbackHint(
        RUNPOD_CREDENTIAL_ENV_NAMES,
        "COMPUTE_PROVIDER=in-process (@sporta/compute-adapter-hosted)",
      ),
    });
    const client = new RunPodRestClient({
      apiKey,
      ...(options.workerImage !== undefined ? { workerImage: options.workerImage } : {}),
      ...(options.apiBase !== undefined ? { apiBase: options.apiBase } : {}),
      ...(options.fetchFn !== undefined ? { fetchFn: options.fetchFn } : {}),
      ...(options.callTimeoutMs !== undefined ? { timeoutMs: options.callTimeoutMs } : {}),
    });
    super({
      descriptor: resolveDescriptor(
        { adapterId: RUNPOD_ADAPTER_ID, adapterVersion: RUNPOD_ADAPTER_VERSION },
        {
          providerKind: RUNPOD_DEFAULT_DESCRIPTOR.providerKind,
          supportedRenderers: RUNPOD_DEFAULT_DESCRIPTOR.supportedRenderers,
          supportedLatencyClasses: RUNPOD_DEFAULT_DESCRIPTOR.supportedLatencyClasses,
          maxConcurrentJobs: RUNPOD_DEFAULT_DESCRIPTOR.maxConcurrentJobs,
          dispatchTimeoutMs: RUNPOD_DEFAULT_DESCRIPTOR.dispatchTimeoutMs,
          maxJobDeadlineMs: RUNPOD_DEFAULT_DESCRIPTOR.maxJobDeadlineMs,
          minJobDeadlineMs: RUNPOD_DEFAULT_DESCRIPTOR.minJobDeadlineMs,
          costUnits: RUNPOD_DEFAULT_DESCRIPTOR.costUnits,
        },
        options.descriptorOverrides,
      ),
      client,
      credentials,
      nowMs: options.nowMs,
      ...(options.sleep !== undefined ? { sleep: options.sleep } : {}),
      ...(options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {}),
      ...(options.maxAdmittedJobs !== undefined
        ? { maxAdmittedJobs: options.maxAdmittedJobs }
        : {}),
    });
  }
}
