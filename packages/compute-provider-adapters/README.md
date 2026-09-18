# @sporta/compute-provider-adapters

**Work items R402-R405 (MVP Reality Engine, Worker B — media/compute/platform
lane):** the four REAL provider compute adapters behind the frozen
provider-neutral compute seams — the W914 `ComputeAdapterPort` and the R401
compute broker (`@sporta/compute-adapter`).

Every adapter carries an honest `ComputeAdapterDescriptor`, a real
connectivity/credential path, and honest unavailability semantics. **Provider
names are DATA** (adapter ids, descriptor fields, error details) — never
product/domain contract members (`test/vocabulary.test.ts` pins this
fail-closed). This is the plane the Compute Connection Center (R406) drives.

## What this package delivers

- **R402 `provider.modal`** (`ModalComputeAdapter`, `src/modal/`): the REAL
  Modal REST client — plain `fetch` against `https://api.modal.co`
  (functions/tokens endpoint families). Credentials: a **scoped
  Modal-Token-Id + Modal-Token-Secret pair** (`MODAL_TOKEN_ID` /
  `MODAL_TOKEN_SECRET`) — Modal supports function-scoped tokens and this
  adapter accepts nothing broader; there is no master-key or
  workspace-admin credential anywhere in this code. Descriptor:
  `managed-actor`, offline, the sporta renderer set, measured `compute-ms`.
- **R403 `provider.lightning`** (`LightningComputeAdapter`, `src/lightning/`):
  the REAL Lightning AI REST client — `https://api.lightning.ai`
  (machines/studios families). Credentials: an **account API key**
  (`LIGHTNING_API_KEY`, never console credentials) + the studio job target
  (`LIGHTNING_STUDIO_ID`; job calls answer an honest not-configured refusal
  without it). Descriptor: `gpu-worker`, offline.
- **R404 `provider.runpod`** (`RunPodComputeAdapter`, `src/runpod/`): the REAL
  RunPod REST client — `https://api.runpod.ai`, the **pods REST surface**
  (not GraphQL). Credentials: an account API key (`RUNPOD_API_KEY`).
  **Pay-as-you-go honesty:** pods bill per-second at prices the adapter
  cannot know — it meters only what it measures (`compute-ms`) and the
  broker registers it with NO quoting function, so its quotes are honest
  `null`s, never fabricated prices. The **pod-not-found posture**: a 404
  status poll dead-letters the job `internal` with the real cause.
- **R405 `provider.local`** (`LocalComputeAdapter`, `src/local/`): the
  self-hosted execution option — one dispatched workload = one **local
  subprocess** (`Bun.spawn`, bounded stdio per the `@sporta/decoding`
  ffmpeg precedent: piped stdout/stderr, a bounded stderr tail, an explicit
  output-size budget; the job JSON rides STDIN). **GPU honesty:** the
  descriptor's `providerKind` derives from the real `nvidia-smi` probe
  (`detectLocalGpu()`); absent → `cpu-worker` + typed
  `no-compatible-gpu` refusals for GPU-requiring workloads. Credentials:
  none — `credentialStatus()` answers `not-applicable`. **Accounting:**
  wall-clock + exit codes measured from the real subprocess — no invented
  numbers.
- **The shared provider plane** (`src/common/`): the typed refusal layer
  (the R401 closed vocabulary as DATA, mapped onto the W914 failure
  classes), the provider HTTP transport (explicit timeouts, abort mapping,
  at-most-one retry per idempotent GET and NONE for dispatch), the honest
  credential state machine, the shared REST→refusal mapping, and the ONE
  provider ledger implementing the full W914 `ComputeAdapterPort`
  (admission, idempotency, the lifecycle state machine, event trails,
  cancel-with-superseded-reports, never-silent input accounting, metering
  totality, settle-time accounting identities).
- **The composition root** (`src/env.ts`): the ONLY env reader — resolves
  all four adapters from configuration (`resolveProviderAdaptersFromEnv`).

## The credential / failure mapping matrix (pinned end-to-end)

| Condition | refusalReason (R401, data) | W914 class | Surface |
|---|---|---|---|
| Credentials missing (SandboxFallback) | `provider-unavailable` | `resource-limit` | `dispatch` throws the typed `ProviderRefusalError` with a `devModeHint` BEFORE any network call; `credentialStatus()` = `missing` |
| Credentials rejected by the provider (401/403) | `credential-invalid` | `internal` | the job fails `credential-invalid` at submit/status; the monitor flips `invalid` and every later dispatch refuses pre-network |
| Quota (HTTP 429) | `quota-exhausted` | `resource-limit` | the job fails `quota-exhausted` |
| Network error / DNS / refused | `provider-unavailable` | `resource-limit` | the job fails with transport evidence; ONE transport retry for idempotent GETs only |
| Timeout / abort | `provider-unavailable` | `resource-limit` | every call is bounded by an explicit `AbortController` timeout |
| 404 status poll (the job is gone) | `provider-unavailable` (permanent) | `internal` | dead-letter with the real cause (the R404 `pod-not-found` posture) |
| Lying terminal envelope | — | `internal` | dead-letter `invalid-provider-report` (never trusted) |
| GPU-requiring workload, CPU-only local probe | `no-compatible-gpu` | `resource-limit` | typed refusal at dispatch (and `no-compatible-gpu` from the broker's descriptor check at quote time) |
| Whole-job deadline missed | — | `timeout` | poll/outcome-driven disposal (`deadline-timeout`), best-effort provider cancel |

The `credentialStatus()` vocabulary is the packet's `missing |
present-unverified | verified` **plus `invalid`** (observed rejection —
reporting `present-unverified` after a real 401 would be a lie by omission)
**plus `not-applicable`** (local). The extension is documented in
`src/common/credentials.ts`.

## The two test tiers

`bun test` — 110 tests / 0 fail / 4 skipped:

1. **The recorded-fixture tier** (`test/{modal,lightning,runpod}.test.ts`):
   the shared credential/failure matrix (`test/remote-suite.ts`) replayed
   against each provider's pinned fixtures under `fixtures/` — every
   request shape AND every mapping pinned deterministically. Fixture
   provenance: the response shapes are **transcribed from the providers'
   documented public REST API families** (the endpoint surfaces the R40x
   packet prescribes), recorded 2025-06-10; each fixture carries its
   provenance block. Re-record them live when credentials exist.
2. **The conditional integration tier** (`test/*.integration.test.ts`):
   REAL REST calls to the real API hosts, skipped unless the provider's
   credential env var is set (`MODAL_TOKEN_ID` / `LIGHTNING_API_KEY` /
   `RUNPOD_API_KEY`). Read-only by design (credential verification).
3. **The local LIVE tier** (`test/local.test.ts`): local execution is
   always available — REAL subprocesses end-to-end (trivial workloads,
   stdin job handoff, exit-code failures, spawn faults, output budgets,
   cancellation kills, deadline disposal, the real nvidia-smi probe) with
   the REAL wall clock injected so the measured metering is the evidence.

Plus the cross-cutting pins: `test/broker.test.ts` (the R401 broker over all
four adapters — ids as data, honest null quotes, typed refusals, a REAL
workload dispatched through the broker), `test/vocabulary.test.ts`
(fail-closed: no provider name in any closed vocabulary), and
`test/boundary.test.ts` (the constitution: no clock/randomness/env in the
domain modules; no provider SDKs — see below).

## LICENSE / PROVENANCE (no SDKs, no vendored code)

These adapters are **Sporta-authored thin clients over documented public
REST APIs**: plain `fetch` only — **no provider SDK dependency, no vendored
SDK code, no HTTP framework** (`test/boundary.test.ts` pins the import
surface so this never drifts). The providers' REST APIs are their own
products; transcribing request/response SHAPES for pinned fixtures is fair
use and carries no license obligation. The only runtime dependencies are
the workspace packages (`@sporta/compute-adapter`, `@sporta/contracts`,
`@sporta/observability`) and `zod`.

## Honest boundaries (this wave)

- **Exact-path liveness is unverified here:** the endpoint paths are the
  documented defaults the packet prescribes (functions/tokens at
  `api.modal.co`, machines/studios at `api.lightning.ai`, the pods REST
  surface at `api.runpod.ai`); they are explicit, configurable DATA. The
  mapping LOGIC (timeouts, refusals, ledger semantics) is fully pinned by
  the fixture tier; exact-path verification against live accounts is the
  conditional tier's job (this sandbox has neither credentials nor
  egress).
- **No submit retries, ever** (no duplicate executions on the provider);
  transient status-poll failures are retried only at the poll interval,
  and the whole-job deadline is the backstop. A cancelled job may leak at
  the provider when the provider-side cancel refuses (recorded in the
  event trail — never a silent drop).
- The remote adapters meter `compute-ms` (measured wall clock;
  provider-reported when available). Provider-native billing currencies
  (credits, per-second pod prices) are NOT metered — an unknown price is
  never fabricated.
- The local adapter's command table is the operator's declaration: a
  renderer without a mapped command is never declared in the descriptor.
