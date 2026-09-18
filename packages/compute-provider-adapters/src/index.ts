/**
 * @sporta/compute-provider-adapters — the four REAL provider compute
 * adapters (R402-R405) behind the frozen provider-neutral compute seams
 * (`@sporta/compute-adapter`: the W914 `ComputeAdapterPort` + the R401
 * compute broker):
 *
 * - **`provider.modal`** (`ModalComputeAdapter`, R402) — the REAL Modal
 *   REST client (plain fetch, `https://api.modal.co`, functions/tokens
 *   families; scoped Modal-Token pair, never a master key);
 * - **`provider.lightning`** (`LightningComputeAdapter`, R403) — the REAL
 *   Lightning AI REST client (`https://api.lightning.ai`, machines/studios
 *   families; account API key);
 * - **`provider.runpod`** (`RunPodComputeAdapter`, R404) — the REAL RunPod
 *   REST client (`https://api.runpod.ai`, the pods REST surface; account
 *   API key; pay-as-you-go quotes stay honest `null`s);
 * - **`provider.local`** (`LocalComputeAdapter`, R405) — the self-hosted
 *   execution option: REAL local subprocesses (`Bun.spawn`, bounded stdio,
 *   the `@sporta/decoding` precedent) + the honest nvidia-smi GPU probe;
 *   no credentials (`not-applicable`).
 *
 * Provider names are DATA (adapter ids, descriptors, error details) —
 * never product/domain contract members (test/vocabulary.test.ts pins
 * this fail-closed). Every adapter shares ONE provider ledger
 * (./common/ledger.ts) over the W914 contract: fail-loud credential gate
 * (dispatch throws the typed refusal BEFORE any network call), no retry
 * storms (one retry per idempotent GET, none for dispatch), failures as
 * values (exactly one terminal completion per admitted job), and honest
 * metering (measured wall clock, never invented numbers).
 *
 * `src/env.ts` is the composition root (the ONLY env reader).
 */
// the shared provider plane (common)
export {
  PROVIDER_REFUSAL_REASONS,
  PROVIDER_REFUSAL_FAILURE_CLASSES,
  ProviderRefusalError,
  failureClassOfRefusal,
  isProviderRefusalError,
  providerRefusal,
} from "./common/refusal";
export type {
  ProviderRefusal,
  ProviderRefusalReason,
  ProviderTransportEvidence,
} from "./common/refusal";
export { providerFetch, refusalReasonOfStatus, safeUrlOf } from "./common/http";
export type {
  ProviderFetchOptions,
  ProviderFetchRequest,
  ProviderFetchOutcome,
  ProviderTransportFailure,
} from "./common/http";
export {
  PROVIDER_CREDENTIAL_STATES,
  ProviderCredentialMonitor,
  credentialGateRefusal,
  sandboxFallbackHint,
} from "./common/credentials";
export type { ProviderCredentialState, ProviderCredentialStatus } from "./common/credentials";
export { restCall, errorMessageOf } from "./common/rest";
export type { RestCallMapping, RestCallOptions } from "./common/rest";
// the shared provider ledger
export { ProviderJobFailure, ProviderJobResult, ProviderLedgerAdapter } from "./common/ledger";
export type {
  ProviderCall,
  ProviderClientStatus,
  ProviderCredentialGate,
  ProviderLedgerAdapterOptions,
  RemoteProviderClient,
} from "./common/ledger";
// the descriptor defaults (DATA — provider ids live here, never in vocabularies)
export {
  DEFAULT_REMOTE_RENDERERS,
  MEASURED_COMPUTE_MS_UNIT,
  MEASURED_CPU_MS_UNIT,
  resolveDescriptor,
} from "./common/descriptors";
export type { DescriptorOverrides } from "./common/descriptors";
// R402 — Modal
export {
  MODAL_ADAPTER_ID,
  MODAL_ADAPTER_VERSION,
  MODAL_CREDENTIAL_ENV_NAMES,
  MODAL_DEFAULT_DESCRIPTOR,
  ModalComputeAdapter,
} from "./modal/adapter";
export type { ModalComputeAdapterOptions } from "./modal/adapter";
export {
  MODAL_API_BASE_DEFAULT,
  MODAL_CALL_TIMEOUT_MS_DEFAULT,
  MODAL_WORKER_FUNCTION_DEFAULT,
  ModalRestClient,
} from "./modal/api";
export type { ModalRestClientOptions } from "./modal/api";
// R403 — Lightning AI
export {
  LIGHTNING_ADAPTER_ID,
  LIGHTNING_ADAPTER_VERSION,
  LIGHTNING_CREDENTIAL_ENV_NAMES,
  LIGHTNING_DEFAULT_DESCRIPTOR,
  LightningComputeAdapter,
} from "./lightning/adapter";
export type { LightningComputeAdapterOptions } from "./lightning/adapter";
export {
  LIGHTNING_API_BASE_DEFAULT,
  LIGHTNING_CALL_TIMEOUT_MS_DEFAULT,
  LightningRestClient,
} from "./lightning/api";
export type { LightningRestClientOptions } from "./lightning/api";
// R404 — RunPod
export {
  RUNPOD_ADAPTER_ID,
  RUNPOD_ADAPTER_VERSION,
  RUNPOD_CREDENTIAL_ENV_NAMES,
  RUNPOD_DEFAULT_DESCRIPTOR,
  RunPodComputeAdapter,
} from "./runpod/adapter";
export type { RunPodComputeAdapterOptions } from "./runpod/adapter";
export {
  RUNPOD_API_BASE_DEFAULT,
  RUNPOD_CALL_TIMEOUT_MS_DEFAULT,
  RUNPOD_WORKER_IMAGE_DEFAULT,
  RunPodRestClient,
} from "./runpod/api";
export type { RunPodRestClientOptions } from "./runpod/api";
// R405 — Local / self-hosted
export {
  LOCAL_ADAPTER_ID,
  LOCAL_ADAPTER_VERSION,
  LocalComputeAdapter,
  createLocalComputeAdapter,
} from "./local/adapter";
export type { LocalComputeAdapterOptions } from "./local/adapter";
export {
  LOCAL_MAX_OUTPUT_BYTES_DEFAULT,
  LOCAL_STDERR_TAIL_LIMIT,
  LocalProcessClient,
} from "./local/api";
export type { LocalCommandSpec, LocalProcessClientOptions } from "./local/api";
export { detectLocalGpu, jobRequiresGpu } from "./local/gpu";
export type { LocalGpuProbe } from "./local/gpu";
// the composition root (the ONE env reader)
export { resolveProviderAdaptersFromEnv } from "./env";
export type { ProviderEnv, ResolvedProviderAdapters, ResolveProviderAdaptersOptions } from "./env";
