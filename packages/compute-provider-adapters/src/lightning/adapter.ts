/**
 * `LightningComputeAdapter` (R403) — the `provider.lightning` compute
 * adapter: the W914 `ComputeAdapterPort` (via the shared provider ledger,
 * ../common/ledger.ts) over the REAL Lightning AI REST client (./api.ts —
 * plain fetch against `https://api.lightning.ai`, machines/studios
 * endpoint families).
 *
 * ## Descriptor honesty (id `provider.lightning`, DATA never vocabulary)
 *
 * `gpu-worker` — Lightning studios/machines are dedicated (GPU-class)
 * machines in the abstract `ComputeProviderKind` vocabulary (no vendor
 * name in any contract member; the id and this class's name are DATA).
 * Offline latency only, the sporta renderer set (version truth: the
 * deployment), the adapter's OWN bounds: concurrency 2 (dedicated-machine
 * posture — fewer simultaneous jobs than the managed-actor default),
 * deadline 30 s floor / 3_600 s ceiling (a dedicated machine honestly
 * serves long renders), one honest metering unit (`compute-ms`, measured).
 *
 * ## The credential path (account API key, never console credentials)
 *
 * `LIGHTNING_API_KEY` (an account API key). `credentialStatus()` reports
 * the honest closed states (`missing | present-unverified | verified |
 * invalid`); a dispatch with missing credentials throws the typed
 * `provider-unavailable` refusal with the SandboxFallback `devModeHint`
 * BEFORE any network call; after a real 401 the adapter refuses
 * subsequent dispatches pre-network (`credential-invalid`).
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
import { LightningRestClient } from "./api";
import type { FetchLike } from "../common/http";

/** The adapter identity (DATA — the provider id, never a vocabulary member). */
export const LIGHTNING_ADAPTER_ID = "provider.lightning";

/** The adapter contract version (MAJOR.MINOR). */
export const LIGHTNING_ADAPTER_VERSION = "1.0";

/** The env names the composition root reads (never a credential value). */
export const LIGHTNING_CREDENTIAL_ENV_NAMES = ["LIGHTNING_API_KEY"] as const;

/** The honest default descriptor (documented bound-by-bound in class docs). */
export const LIGHTNING_DEFAULT_DESCRIPTOR: ComputeAdapterDescriptor = resolveDescriptor(
  { adapterId: LIGHTNING_ADAPTER_ID, adapterVersion: LIGHTNING_ADAPTER_VERSION },
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

/** Options for {@link LightningComputeAdapter}. */
export interface LightningComputeAdapterOptions extends Omit<
  ProviderLedgerAdapterOptions,
  "descriptor" | "client" | "credentials"
> {
  /** The account API key (omit in SandboxFallback mode). */
  apiKey?: string;
  /** The studio target for job calls (empty = honest not-configured refusals). */
  studioId?: string;
  /** Operator descriptor overrides (their declaration, validated not verified). */
  descriptorOverrides?: DescriptorOverrides;
  /** The REST base (default `https://api.lightning.ai`). */
  apiBase?: string;
  /** The injected fetch (default: the real fetch — the conditional tier). */
  fetchFn?: FetchLike;
  /** The explicit per-call REST timeout (default 20 s; tests shorten it). */
  callTimeoutMs?: number;
}

/**
 * The `provider.lightning` adapter (R403): thin composition of the shared
 * provider ledger + the REAL Lightning AI REST client + the honest
 * credential monitor. See ../common/ledger.ts (ledger semantics) and
 * ./api.ts (the REST mapping).
 */
export class LightningComputeAdapter extends ProviderLedgerAdapter {
  constructor(options: LightningComputeAdapterOptions) {
    const apiKey = options.apiKey ?? "";
    const credentials = new ProviderCredentialMonitor({
      credentialsPresent: apiKey.length > 0,
      missingDetail: `${LIGHTNING_CREDENTIAL_ENV_NAMES.join(" + ")} not configured`,
      devModeHint: sandboxFallbackHint(
        LIGHTNING_CREDENTIAL_ENV_NAMES,
        "COMPUTE_PROVIDER=in-process (@sporta/compute-adapter-hosted)",
      ),
    });
    const client = new LightningRestClient({
      apiKey,
      ...(options.studioId !== undefined ? { studioId: options.studioId } : {}),
      ...(options.apiBase !== undefined ? { apiBase: options.apiBase } : {}),
      ...(options.fetchFn !== undefined ? { fetchFn: options.fetchFn } : {}),
      ...(options.callTimeoutMs !== undefined ? { timeoutMs: options.callTimeoutMs } : {}),
    });
    super({
      descriptor: resolveDescriptor(
        { adapterId: LIGHTNING_ADAPTER_ID, adapterVersion: LIGHTNING_ADAPTER_VERSION },
        {
          providerKind: LIGHTNING_DEFAULT_DESCRIPTOR.providerKind,
          supportedRenderers: LIGHTNING_DEFAULT_DESCRIPTOR.supportedRenderers,
          supportedLatencyClasses: LIGHTNING_DEFAULT_DESCRIPTOR.supportedLatencyClasses,
          maxConcurrentJobs: LIGHTNING_DEFAULT_DESCRIPTOR.maxConcurrentJobs,
          dispatchTimeoutMs: LIGHTNING_DEFAULT_DESCRIPTOR.dispatchTimeoutMs,
          maxJobDeadlineMs: LIGHTNING_DEFAULT_DESCRIPTOR.maxJobDeadlineMs,
          minJobDeadlineMs: LIGHTNING_DEFAULT_DESCRIPTOR.minJobDeadlineMs,
          costUnits: LIGHTNING_DEFAULT_DESCRIPTOR.costUnits,
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
