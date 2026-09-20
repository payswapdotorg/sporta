/**
 * @sporta/compute-adapter-hosted — the W914 Wave-2 HOSTED COMPUTE WORKER
 * and the production `ComputeAdapterPort` implementation over it.
 *
 * What this package delivers on top of the Wave-1 contract
 * (`@sporta/compute-adapter` — schemas, ports, the TEST-ONLY in-memory
 * reference):
 *
 * - **REAL job execution** (./executor.ts): a materialized dispatch request
 *   becomes a render through the REAL renderer plugin (registry-resolved,
 *   W501 plugin interface), the REAL W504 encoder (`encodeAnimeClip`), and
 *   the REAL W504 render-segment store — content-addressed artifact handoff
 *   (inline delivery mode — the pre-W912 mode the W914 audit blesses);
 * - **fail-closed budgets** (./budgets.ts): duration/size bounds derived
 *   from the documented Vercel Hobby limits — an over-budget job NEVER
 *   hands its outputs back;
 * - **the worker application** (./worker.ts): the honest descriptor (derived
 *   from the real registry), jobId-idempotent execution, and per-job +
 *   whole-worker metering counters;
 * - **the production adapter** (./adapter.ts): the full job ledger —
 *   admission, idempotency, the lifecycle state machine, cancellation with
 *   superseded reports, never-silent input accounting, metering totality,
 *   and the settle-time accounting identities — over an INJECTED execution
 *   function;
 * - **the HTTP surface** (./http.ts): `POST /v1/jobs/execute` → result
 *   envelope, `GET /v1/adapter` (descriptor), `GET /health`, `GET
 *   /v1/jobs/:jobId` (per-job metering) — one transport-free handler a
 *   `Bun.serve` (local) or a serverless route (the Vercel namespace
 *   `apps/web/src/app/api/compute/route.ts`) mounts;
 * - **env-driven provider selection** (./env.ts): `COMPUTE_PROVIDER` =
 *   `in-process` (dev/reference) | `http` (hosted, `COMPUTE_WORKER_URL`) |
 *   `none` — configuration only, never a domain dependency.
 *
 * Honest boundaries (this wave): no automatic retries (a transport fault
 * dead-letters — the W913 queue wave owns recovery); the ledger is
 * process-local (the G7 durable seam is W913); the worker's store is
 * in-memory locally (R2 is W912 behind the same W504 port); deployed-Vercel
 * validation is a later wave — local-real-HTTP is this flight's evidence
 * boundary.
 */
export { DEFAULT_HOSTED_COMPUTE_BUDGETS, resolveHostedComputeBudgets } from "./budgets";
export type { HostedComputeBudgets } from "./budgets";
export { HostedJobExecution, HostedJobFailure, HostedJobMetering } from "./envelope";
export type {
  HostedJobExecution as HostedJobExecutionDoc,
  HostedJobFailure as HostedJobFailureDoc,
  HostedJobMetering as HostedJobMeteringDoc,
} from "./envelope";
export { executeRenderJob } from "./executor";
export type { RenderJobExecutorDeps } from "./executor";
export {
  createDerivedRealityRenderer,
  DERIVED_REALITY_RENDERERS,
} from "./derived";
export type {
  DerivedRealityBridge,
  DerivedRealityRenderOutput,
  DerivedRealityRenderRequest,
  DerivedRealityRendererDeps,
  DerivedRealityRendererPort,
} from "./derived";
export { executeDerivedRealityRender } from "./derived-execution";
export type { DerivedRealityExecutionInput } from "./derived-execution";
export {
  ComputeWorker,
  HOSTED_COMPUTE_ADAPTER_ID,
  HOSTED_COMPUTE_ADAPTER_VERSION,
  HOSTED_COMPUTE_COST_UNITS,
  HOSTED_COMPUTE_PROVIDER_ID,
  createComputeWorker,
} from "./worker";
export type {
  ComputeWorkerExecution,
  ComputeWorkerJobRecord,
  ComputeWorkerOptions,
  ComputeWorkerStats,
} from "./worker";
export { HostedComputeAdapter, createHostedComputeAdapter } from "./adapter";
export type { HostedComputeAdapterOptions, HostedExecuteFn } from "./adapter";
export {
  createComputeWorkerHttpHandler,
  createComputeWorkerServer,
  createHttpExecuteFunction,
} from "./http";
export type { ComputeWorkerServerOptions } from "./http";
export {
  computeProviderSelectionOf,
  createDefaultOutputSegmentStore,
  createDefaultWorkerRegistry,
  resolveComputeAdapterFromEnv,
} from "./env";
export type {
  ComputeProviderSelection,
  ResolvedComputeAdapter,
  ResolveComputeAdapterOptions,
} from "./env";
