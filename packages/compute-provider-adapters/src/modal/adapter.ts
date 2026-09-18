/**
 * `ModalComputeAdapter` (R402) — the `provider.modal` compute adapter: the
 * W914 `ComputeAdapterPort` (via the shared provider ledger, ../common/
 * ledger.ts) over the REAL Modal REST client (./api.ts — plain fetch
 * against `https://api.modal.co`, functions/tokens endpoint families).
 *
 * ## Descriptor honesty (id `provider.modal`, DATA never vocabulary)
 *
 * `managed-actor` — Modal's serverless functions are the architecture
 * lock's "bounded managed executor" in the abstract `ComputeProviderKind`
 * vocabulary (no vendor name in any contract member; the id and this
 * class's name are DATA). Offline latency only (serverless cold starts
 * honestly do not serve near-live/live), the sporta renderer set
 * (version truth: the deployed worker's registry), the adapter's OWN
 * concurrency (4 in-flight handoffs) and deadline bounds (30 s floor —
 * the dispatch-timeout budget; 600 s ceiling), one honest metering unit
 * (`compute-ms`, measured). Operators override via `descriptorOverrides`
 * (their declaration, validated not verified).
 *
 * ## The SandboxFallback free-tier development path (documented mode)
 *
 * With `MODAL_TOKEN_ID` + `MODAL_TOKEN_SECRET` absent, `credentialStatus()`
 * answers `missing` with a `devModeHint`, and every `dispatch` throws the
 * typed `provider-unavailable` refusal BEFORE any network call — the
 * adapter NEVER fakes success. Free-tier local development uses the REAL
 * in-process compute worker (`COMPUTE_PROVIDER=in-process`,
 * `@sporta/compute-adapter-hosted`) instead.
 *
 * ## The credential path (scoped, never a master key)
 *
 * A Modal-Token-Id + Modal-Token-Secret pair (function-scoped tokens are
 * the Modal posture this adapter accepts; nothing broader exists in this
 * code). `credentialStatus()` reports the honest closed states —
 * `missing | present-unverified | verified | invalid` (the packet's three
 * plus the observed-rejection state, documented in ../common/credentials.ts
 * — after a real 401 the adapter refuses subsequent dispatches pre-network).
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
import { ModalRestClient } from "./api";
import type { FetchLike } from "../common/http";

/** The adapter identity (DATA — the provider id, never a vocabulary member). */
export const MODAL_ADAPTER_ID = "provider.modal";

/** The adapter contract version (MAJOR.MINOR). */
export const MODAL_ADAPTER_VERSION = "1.0";

/** The env names the composition root reads (never a credential value). */
export const MODAL_CREDENTIAL_ENV_NAMES = ["MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET"] as const;

/** The honest default descriptor (documented bound-by-bound in class docs). */
export const MODAL_DEFAULT_DESCRIPTOR: ComputeAdapterDescriptor = resolveDescriptor(
  { adapterId: MODAL_ADAPTER_ID, adapterVersion: MODAL_ADAPTER_VERSION },
  {
    providerKind: "managed-actor",
    supportedRenderers: [...DEFAULT_REMOTE_RENDERERS],
    supportedLatencyClasses: ["offline"],
    maxConcurrentJobs: 4,
    dispatchTimeoutMs: 30_000,
    maxJobDeadlineMs: 600_000,
    minJobDeadlineMs: 30_000,
    costUnits: [MEASURED_COMPUTE_MS_UNIT],
  },
);

/** Options for {@link ModalComputeAdapter}. */
export interface ModalComputeAdapterOptions extends Omit<
  ProviderLedgerAdapterOptions,
  "descriptor" | "client" | "credentials"
> {
  /** The scoped Modal-Token-Id (omit in SandboxFallback mode). */
  tokenId?: string;
  /** The scoped Modal-Token-Secret (omit in SandboxFallback mode). */
  tokenSecret?: string;
  /** Operator descriptor overrides (their declaration, validated not verified). */
  descriptorOverrides?: DescriptorOverrides;
  /** The REST base (default `https://api.modal.co`; tests may point elsewhere). */
  apiBase?: string;
  /** The deployed worker function reference (default the sporta worker). */
  workerFunction?: string;
  /** The injected fetch (default: the real fetch — the conditional tier). */
  fetchFn?: FetchLike;
  /** The explicit per-call REST timeout (default 20 s; tests shorten it). */
  callTimeoutMs?: number;
}

/**
 * The `provider.modal` adapter (R402): thin composition of the shared
 * provider ledger + the REAL Modal REST client + the honest credential
 * monitor. See the class-level docs of ../common/ledger.ts for the ledger
 * semantics (fail-loud credential gate, no retry storms, failures as
 * values, honest metering) and ./api.ts for the REST mapping.
 */
export class ModalComputeAdapter extends ProviderLedgerAdapter {
  constructor(options: ModalComputeAdapterOptions) {
    const tokenId = options.tokenId ?? "";
    const tokenSecret = options.tokenSecret ?? "";
    const credentialsPresent = tokenId.length > 0 && tokenSecret.length > 0;
    const credentials = new ProviderCredentialMonitor({
      credentialsPresent,
      missingDetail: `${MODAL_CREDENTIAL_ENV_NAMES.join(" + ")} are not configured`,
      devModeHint: sandboxFallbackHint(
        MODAL_CREDENTIAL_ENV_NAMES,
        "COMPUTE_PROVIDER=in-process (@sporta/compute-adapter-hosted)",
      ),
    });
    const client = new ModalRestClient({
      tokenId,
      tokenSecret,
      ...(options.apiBase !== undefined ? { apiBase: options.apiBase } : {}),
      ...(options.workerFunction !== undefined ? { workerFunction: options.workerFunction } : {}),
      ...(options.fetchFn !== undefined ? { fetchFn: options.fetchFn } : {}),
      ...(options.callTimeoutMs !== undefined ? { timeoutMs: options.callTimeoutMs } : {}),
    });
    super({
      descriptor: resolveDescriptor(
        { adapterId: MODAL_ADAPTER_ID, adapterVersion: MODAL_ADAPTER_VERSION },
        {
          providerKind: MODAL_DEFAULT_DESCRIPTOR.providerKind,
          supportedRenderers: MODAL_DEFAULT_DESCRIPTOR.supportedRenderers,
          supportedLatencyClasses: MODAL_DEFAULT_DESCRIPTOR.supportedLatencyClasses,
          maxConcurrentJobs: MODAL_DEFAULT_DESCRIPTOR.maxConcurrentJobs,
          dispatchTimeoutMs: MODAL_DEFAULT_DESCRIPTOR.dispatchTimeoutMs,
          maxJobDeadlineMs: MODAL_DEFAULT_DESCRIPTOR.maxJobDeadlineMs,
          minJobDeadlineMs: MODAL_DEFAULT_DESCRIPTOR.minJobDeadlineMs,
          costUnits: MODAL_DEFAULT_DESCRIPTOR.costUnits,
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
