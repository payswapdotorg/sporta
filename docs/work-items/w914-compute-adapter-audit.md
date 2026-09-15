# W914 Compute Adapter Audit — Seam-by-Seam (Wave 1)

**Task:** W914 audit + provider-neutral compute-adapter contract preparation.
**Status:** AUDIT + CONTRACT SKELETON DELIVERED (this document + `packages/compute-adapter`). W914 implementation is Wave 2.
**Audited at:** main @ `839b307` (branch `work/w914-compute-adapter`).
**Scope rule:** this audit records findings; it does not modify `packages/gpu-worker`, `packages/render-orchestration`, `packages/output-pipeline`, or any existing package. Items those packages must change (or that need tech-lead/ADR decisions) are tagged `contract-change-required`; everything else is `implementation-only`.

---

## 0. Executive summary

The three audited seams are unusually well prepared for hosted execution: W303 is already a **vendor-neutral job protocol with a deliberate wire seam** (`GpuDispatcherPort`, four methods, JSON-safe messages), W304 already proves **bounded-memory orchestration with never-silent accounting**, and W504 already addresses outputs **content-addressed with fail-closed rights**. What is missing is a single layer that carries a **transport-safe render job description** (identity, renderer+recipe reference, inputs manifest, rights linkage, constraints) from the hosted control plane to a provider and back (progress, completion, artifacts, usage), so the domain never knows which provider executed.

The three top gaps:

1. **No transport-safe job description exists** (`contract-change-required`, resolved additively by this Wave-1 contract): the control plane (`@sporta/control-api`, W701) executes renders **synchronously in-process** (`app.ts`: `result = await plugin.render(request, { snapshot, events })`) with no job identity, deadline, or idempotency key; the W304 path describes jobs only as in-memory `RenderBatch` objects (full SWM snapshots inline, resolved through an in-process `BatchRegistry`).
2. **The compute-adapter contract itself** (`implementation-only`, delivered in this Wave 1 as `@sporta/compute-adapter`): versioned zod schemas + ports + in-memory reference, vocabulary-aligned (test-pinned) to W303/W304/W504/observability.
3. **Per-job usage metering with a provider/cost dimension does not exist anywhere** (`implementation-only` for the record shape — delivered here; W919 consumes): today's metering is stage counters/histograms (`gpu_*`, `render_*`, observability `METRIC_NAMES`); nothing records *which provider* executed, at what cost, per job.

---

## 1. Job description seam — how a render job is described today

### 1.1 Where render jobs are created

There are exactly two live job-creation paths plus one renderer-level recipe:

**(a) Control plane — `@sporta/control-api` (W701), `src/app.ts`.**
`ControlApp.createRender(sessionId, input)` with `CreateRenderInput`:

| Field | Type | Notes |
|---|---|---|
| `rendererId` | string | resolved against the in-process `RendererRegistry` |
| `rendererVersion?` | string | omit = highest registered version |
| `outputProfile?` | `OutputProfile` doc | omit = plugin's first supported profile |
| `styleConfig?` | `{ styleId?, config? }` | omit = `{ styleId: "default", config: {} }` |

The render **executes synchronously inside the request**: the app snapshots the session's in-process world-model engine (`worldModelFor(sessionId)`, `stateAt` + empty event tail), builds a contracts `RenderRequest`, and `await plugin.render(request, { snapshot, events })`. There is **no job identity, no deadline, no idempotency key, no queue, no progress, no cancel** — the HTTP request *is* the job. The render id is the deterministic envelope key `r-<seq>`. This is the primary "assumed in-process" that must become transport-safe.

**(b) Streaming path — `@sporta/render-orchestration` (W304).**
The orchestrator cuts watermark-aligned `RenderBatch`es (`batchId`, `sessionId`, `ordinal`, `fromSequence`/`toSequence`, `windowMs`, `watermark`, `updates[]`, `closedBy`, `byteSize`, `idempotencyKey`) from the `SwmUpdateStore` seam, then maps each batch to a W303 `GpuJobEnvelope`:

- `jobId = render-job-<session>-<ordinal>`,
- `idempotencyKey = render-<session>-wm-<watermarkMs>-seq-<sequence>` (derived from the batch watermark — same watermark never double-submits),
- `payloadRef = render-batch:<batchId>` — an **opaque string** resolved through the in-process `BatchRegistry` map (`registry.ts`: unknown ref throws `RenderOutputInvalidError`),
- `kind`, `priority`, `requirements`, `deadlineMs` (`renderDeadlineMs`, default 60 000), `maxAttempts`.

**(c) Renderer recipe — `@sporta/contracts` `RenderRequest` (W501/W502).**
`{ sessionId, schemaVersion, rendererId, rendererVersion, styleConfig, snapshotVersion, eventsSinceSequence, outputProfile, rightsCapabilities, sourceFrameRefs }` — versioned zod, validated once by W304 at construction and re-shaped per batch (`snapshotVersion` verbatim, `eventsSinceSequence` = batch `fromSequence`).

### 1.2 What is transport-coupled (must become transport-safe)

| Coupling | Evidence | Hosted consequence |
|---|---|---|
| SWM payload inline | `RenderBatch.updates` carries full `WorldSnapshot` + event arrays as object references; W303 `payloadRef` resolves via the in-process `BatchRegistry` | A hosted job description must carry an **inputs manifest** (addressable refs + content identity), not in-memory objects |
| No job identity at the control plane | `CreateRenderInput` has no jobId/idempotency key | Hosted dispatch needs caller-authored job identity + the Recovery-rule idempotency key (W303 posture) |
| Rights are in-process derived | `RenderRequest.rightsCapabilities` is derived from the session policy at request time; W504 gates re-derive from `PlaybackRightsContext` | The rights posture must travel with the job description (architecture-lock §11) and be re-checkable at the provider |
| Correlation not on the envelope | W303 `GpuJobResult` carries `correlationId`/`traceId`, but they come from **dispatcher options**, not the job envelope | A transport-safe description carries the correlation triple |
| No deadline/constraints at the control plane | `CreateRenderInput` has none | Hosted jobs need whole-job deadline + claim budget + priority (W303 fields, verbatim) |

---

## 2. Dispatch/execution seam — the W303 gpu-worker protocol in detail

`packages/gpu-worker` (PROTOCOL.md is the package-local authority; `src/types.ts`, `src/job.ts`, `src/dispatcher.ts`, `src/worker.ts`).

### 2.1 Message shapes (all JSON-safe by convention — no functions/symbols/instances)

| Message | Direction | Shape |
|---|---|---|
| `GpuJobEnvelope` | submitter → dispatcher | `jobId`, `idempotencyKey`, `kind`, `payloadRef` (opaque), `priority` (int, higher first), `requirements?` (`memoryMb`, `modelClass` — abstract), `deadlineMs` (finite > 0), `maxAttempts?` (claim budget, default 3) |
| `GpuWorkerCapabilities` | worker → dispatcher (register) | `workerId`, `maxConcurrentJobs`, `memoryMb`, `modelClasses[]`, `heartbeatIntervalMs` |
| `GpuRegistrationAck` | dispatcher → worker | `leaseMs`, `staleAfterMs` |
| `GpuHeartbeat` | worker → dispatcher | `sequence` (monotone), `dueMs`, `inFlight`, `advisoryMemoryInUseMb` (derived, never measured) |
| `GpuHeartbeatAck` | dispatcher → worker | `accepted`, `reason?`, `dispatcherState` |
| `GpuJobClaim` | dispatcher → worker (claim) | `job` (envelope verbatim), `claimOrdinal`, `leaseId`, `leaseExpiresAtMs`, `deadlineAtMs`, `maxAttempts` |
| `GpuAttemptReport` | worker → dispatcher | `workerId`, `jobId`, `leaseId`, `status` (`succeeded`/`failed`/`timeout`), `output?`, `errorClass?`, `message?`, `retryable?`, `attempts`, `timings` (per-attempt) |
| `GpuReportAck` | dispatcher → worker | `recorded` / `superseded` / `unknown-job` (+ reason) |
| `GpuJobResult` | dispatcher → submitter | `status` (`succeeded`/`failed`/`cancelled`), `output?`, `failure?` (`errorClass`, `message`, `terminal`), `attempts`, `claims`, `retriesUsed`, `timing`, `correlationId`, `traceId` |

`GpuDispatcherPort` (the designed wire seam — four methods): `registerWorker`, `heartbeat`, `claimJob` (parks when nothing eligible; `undefined` = stop claiming), `reportResult`.

### 2.2 Lifecycle

`submit()` → structural validation (fail-loud `MalformedJobError`, `media-invalid`) → idempotency-key check FIRST (known key ⇒ counted duplicate, skipped — even same jobId) → jobId-collision check (new key reusing an admitted id ⇒ typed refusal) → never-fit admission refusal (typed `GpuResourceLimitError`, `resource-limit`, only when ≥ 1 active worker exists) → **queued** → `claimJob` (priority desc, submission sequence asc; job-major matching so an ineligible claimer never head-of-line-blocks) → **in-flight** under a lease → report → terminal in EXACTLY ONE of `succeeded` / `failed` / `cancelled` / `dead-lettered`; the result promise resolves exactly once and **never rejects** (failures are values).

- **failed** (determinate): non-retryable executor failure, `deadline-timeout`, `worker-stale` (fail-loud, terminal `timeout`).
- **dead-lettered** (recovery-budget exhaustion): worker-retry exhaustion, lease-expiry claim exhaustion (both `retry-exhausted`), thrown executor faults (`internal`). Bounded DLQ; overflow counted + logged + metered.

### 2.3 Cancellation, timeouts, idempotency, replay

- **Cancel** is idempotent and never loses a job: queued ⇒ removed + cancelled; in-flight ⇒ cancelled immediately, the executing worker's eventual report counted `superseded`; terminal ⇒ counted no-op returning the existing disposition; unknown ⇒ typed `UnknownJobError` (a cancel that "succeeds" against an unknown job would be a silent lie).
- **Timeouts** (one classification, three sources): whole-job `deadlineMs` enforced absolutely — queued-past-deadline, in-flight-past-deadline (dispatcher sweep; racing report loses, counted `lateResults`/superseded), worker-side deadline checkpoints (backstop for clock skew).
- **Idempotency** (streaming-contract Recovery rule): claims are **exactly-once per key**; execution is **at-least-once** (lease-expiry requeue / shutdown cancel can re-acquire); unreported attempts of crashed workers are **unknowable and never invented** (`retriesUsed` can be negative — honest arithmetic).
- **Replay**: W304 checkpoints are anchored at the crossing batch, so a deterministic replay re-cuts the SAME idempotency keys and the dispatcher resolves them as counted duplicates (never double-executed). This is the model a hosted adapter must preserve.
- **Retries** (worker-side, per claim): W104 arithmetic with three deadline checkpoints; default NO retries; non-retryable failures never blind-retried.

### 2.4 Transport-coupled vs transport-free

**Transport-free (by design):** every message shape; the lease/claim/report semantics; idempotency; cancellation; deadline classification; the accounting identity; the JSON-safe convention. `GpuDispatcherPort` is deliberately narrow "so a wire adapter can implement it exactly" (PROTOCOL.md §9).

**Transport-coupled (must be added for hosted):**

1. **No wire protocol/serialization** — the port is an in-process TS interface; no schemas exist for the messages (hand-written validation; promotion into `@sporta/contracts` is explicitly a *tech-lead-owned change* "for when W304+ needs another package to consume these shapes" — PROTOCOL.md §9. The compute adapter is that consumer ⇒ **decision required**, see §7 gap G1).
2. **One shared injected `GpuClock`** — every timing decision (staleness, lease expiry, deadline) reads it; no wall-clock `GpuClock` implementation exists (limitation 9). A hosted dispatcher and hosted workers have *different real clocks*; the protocol already anticipates this ("the worker's own clock and the dispatcher's clock may legitimately be different instances") but nothing validates skew.
3. **In-memory ledger/key registry/DLQ/ready queue** (limitation 5; W304 limitation 1: "recovery is in-process — a process crash loses it").
4. **No security at the boundary** (limitation 4: "in-process trust only") — hosted workers need authn/authz on the wire.
5. **Detection is entry-driven** (limitation 7): `sweep()` runs at port entries only; a hosted deployment must either keep the heartbeat stream dense or run its own monitor calling the public `sweep()`.
6. **Resource metadata is advisory** (limitation 1): declarations trusted, usage never measured — a hosted adapter keeps this honestly (descriptor declares capacity; actual enforcement is the provider's/deployment's concern).

---

## 3. Orchestration seam — what W304 guarantees and a hosted adapter must preserve

`packages/render-orchestration` (README + `src/types.ts` `assertRenderAccounting`).

**Guarantees today (all runtime-asserted at every settle; an imbalance rejects the settle promise):**

- **Bounded memory, four bounds**: (1) W104 `BoundedChannel` with `block`/`reject`/`drop-oldest` verbatim (drop-oldest evictions attributed to specific oldest batches; cross-boundary identity `batchesQueueEvicted === channel.dropped`), (2) the W303 ready queue (typed refusals), (3) bounded reorder buffer `maxReorderOutputs` (overflow drops the incoming output, reason `reorder-overflow`), (4) explicit `skipStale` degradation (counted, ledgered, original watermark preserved — never re-stamped, never rendered as if fresh). The burst test proves `peakBatchesInSystem` plateaus at the configured bounds, never at stream length.
- **Ordering**: outputs emit in **watermark order** through ONE serialized drain chain (sink awaited one record at a time), even when jobs complete out of order.
- **Provenance on every output**: source batch id/ordinal, watermark verbatim, W303 job id, renderer identity, job timing envelope.
- **Recovery**: checkpoint-anchored replays re-derive identical idempotency keys; the W303 key registry dedupes. `processedKeys` registers only render-protocol terminal dispositions.
- **Accounting**: the 9-identity lattice (`batchesIn === rendered + skippedStale + dropped + cancelled + duplicateSkips + inFlight`, etc.).
- **Determinism**: whole-story deep-equal across two fresh runs; one injected clock; no wall time.

**A hosted compute adapter must preserve:** (a) bounded admission (typed refusal, never unbounded queueing), (b) counted duplicates on idempotent re-submission, (c) the never-silent posture (every skip/drop/refusal counted + ledgered with reason), (d) ordering guarantees where the consuming UX needs them (the adapter exposes per-job ordering; stream reordering stays an orchestration concern), (e) failures as values (terminal envelopes carry classified reasons; the caller's promise never dangles). Note the honest split: W304's watermark-ordered *stream* emission is an in-process orchestrator feature; the compute adapter's unit is a single job, and stream-level reorder/recovery composes on top (W304 as the in-process reference of that composition).

---

## 4. Output/artifact seam — W504 today and the R2 handoff shape

`packages/output-pipeline` (`src/types.ts`, `src/store.ts`, `src/artifacts.ts`, `src/pipeline.ts`).

- **Encoded unit**: `EncodedAnimeSegment` — self-contained animated SVG (SMIL) + deterministic manifest; `segmentId = anime-clip-<fnv1a32-hex8>`; `contentHash` = sha-256 (64 lowercase hex) = **the content-addressed artifact id**; the W502 render manifest rides verbatim inside (`sourceManifest`).
- **Two store ports**: `ArtifactStore` (content-addressed: `put` idempotent by content, counted duplicates, integrity-verified reads) and `RenderSegmentStore` (keyed `(sessionId, renderId, segmentId)`; idempotent stores with counted duplicates; conflict on same-key-different-content; bounded with typed rejects). Implementations: in-memory and `bun:sqlite`.
- **Rights**: retrieval is fail-closed — `PlaybackRightsContext { policy, nowMs }` re-derived at read time; without `canStoreDerivatives` the call throws before revealing existence (W701 posture).
- **Addressing**: W502 `anime://<sessionId>/<snapshotVersion>/<frameIndex>` refs resolve through `locateAnimeRef` to playback coordinates (`GET /v1/sessions/:id/renders/:renderId/outputs/:segmentId`) + the artifact id behind them.
- **R2 boundary**: R2 wiring is Worker B's W912 behind these same ports (the deployment doc's "Media/artifacts: Cloudflare R2"). **What W914 must own is only the artifact handoff shape** — what a compute provider hands the control plane when a job's output exists: the content-addressed identity (`artifactId === contentHash`, sha-256), content type, byte length, the deterministic manifest, and the W504 store-scope metadata (`AnimeArtifactMetadata`: `sessionId`, `renderId`, `segmentId`, `snapshotVersion`, `frameCount`, `totalDurationMs`). The `@sporta/compute-adapter` completion envelope carries exactly this (inline content for small outputs, or a stored receipt once W912's store is behind the port); delivery URLs (authorized, short-lived) are W912/W905 concerns, not the adapter's.

---

## 5. Metering — what exists and what a hosted adapter must meter

**Exists today:**

- `@sporta/observability` (W007): `MetricsRegistry` (counters + nearest-rank histograms), the recommended vocabulary `METRIC_NAMES` (`frames_dropped`, `queue_depth`, `stage_latency_ms`, `model_latency_ms`, `renderer_latency_ms`, `e2e_latency_ms` — aligned to architecture-lock §12), `CorrelationContext` (`sessionId`/`correlationId`/`traceId`), structured `Logger`.
- W303 `GPU_METRIC_NAMES` (20 `gpu_*` series incl. `gpu_job_latency_ms`, `gpu_job_queue_wait_ms`, and every accounting counter has a series); W304 `RENDER_METRIC_NAMES` (`render_*`, incl. `render_watermark_lag_at_emission_ms`). W805's health/telemetry consumes these shapes.
- W806/W802 (release/SLO) review metering posture; W919 (cost/usage guardrails) depends on W911-W914 and needs "provider usage counters, user/job quotas, spend alarms and fail-closed admission" (work orders).

**Missing for W919 (what the hosted adapter must meter per job):** a *usage record* per terminal job carrying the **provider identity**, the job's timing envelope (W303 names: `queueWaitMs`, `executionMs`), attempt/claim counts, and **cost units in the units the adapter's descriptor declared** (abstract unit ids — provider-neutral; e.g. `cpu-seconds`, `requests`, `credit` — never a hard-coded vendor currency). Metering invariants: exactly one usage record per terminally-disposed job (never silent, including cancelled-never-executed), quantities finite ≥ 0, units closed against the descriptor. The contract layer for this is delivered in `@sporta/compute-adapter` (`ComputeUsageRecord` + descriptor `costUnits`); W919 consumes it for quotas/alarms/fail-closed admission.

---

## 6. Reliability — existing semantics and hosted guarantees

| Property | W303/W304 today | Hosted adapter must guarantee |
|---|---|---|
| Terminal disposition | exactly one per job (succeeded/failed/cancelled/dead-lettered); result promise resolves exactly once, never rejects | same — every dispatched job lands in exactly one terminal bucket, settle-assertable |
| Execution | **at-least-once** (lease recovery can re-execute); claims exactly-once per key | same; downstream dedupes on the key (the contract's own rule) — do NOT promise exactly-once execution |
| Unknown work | unreported attempts never invented (`retriesUsed` can be negative) | never fabricate attempts/outputs; a crashed provider's work is unknowable until its lease/timeout machinery accounts it |
| Never-silent accounting | runtime-asserted at every settle (imbalance rejects settle); DLQ overflow counted; superseded reports counted | same at the adapter layer (dispatched === terminal + in-flight; usage totality) |
| Duplicate submits | counted duplicate, skipped, never double-claimed | same (idempotency key, W303/W304 derivation pattern) |
| Cancel | idempotent, never loses a job, eventual reports superseded | same |
| Deadline | whole-job absolute deadline, three enforcement points, one classification | carried in the job constraints; classification aligned to W303 `GpuTerminalClass` |
| Rights | fail-closed at retrieval (W504) and at render admission (W501 R2) | rights posture travels with the job; provider re-checks fail-closed |

The constitution's "never-silent accounting" is the non-negotiable: an adapter that cannot say what happened to a job must refuse to settle, not return a lying result.

---

## 7. Gap list (prioritized)

| # | Gap | Tag | Notes |
|---|---|---|---|
| G1 | **W303 shape promotion decision**: the compute adapter consumes W303 vocabulary across a package boundary — PROTOCOL.md §9 reserves promotion into `@sporta/contracts` as tech-lead-owned. Wave 1 resolves this WITHOUT promotion: `@sporta/compute-adapter` mirrors the vocabulary locally and **test-pins alignment** against `@sporta/gpu-worker` (dev-dep). TL decision for Wave 2: keep mirroring (recommended — zero change to a frozen, fully-tested package) or promote (ADR + migration). | `contract-change-required` (decision; no code change forced) | blocking only if Wave 2 wants a single canonical schema module |
| G2 | **Transport-safe render job description** — today none exists end-to-end (control plane is synchronous in-process; W304's payload is in-memory objects). Delivered additively by `@sporta/compute-adapter` (`ComputeJobDescription`: jobId, idempotency key, session + correlation, renderer + recipe, inputs manifest, rights posture, constraints, output profile). Adopting it in `@sporta/control-api` (additive `createRenderAsync` path) is a Wave-2 change to that package's public surface ⇒ TL sign-off. | `contract-change-required` (adoption) + `implementation-only` (contract itself, delivered) | the W914 acceptance ("hosted control plane can dispatch at least one real compute adapter; provider selection is configuration-driven and metered") needs this |
| G3 | **Progress events** — W303 has nothing between claim and report; W906's "observe actual processing state" needs progress. Delivered in the contract (`progress` event kind, fraction + stage); provider side is Wave 2. | `implementation-only` | |
| G4 | **Per-job usage metering with provider/cost dimension** — record shape delivered (`ComputeUsageRecord`, descriptor `costUnits`); wiring into W919 quotas/alarms is Worker B Wave 3/4. | `implementation-only` | |
| G5 | **Hosted provider port implementation** — an HTTP worker implementing the adapter's provider seam over the real renderers (W501 plugin interface: `renderer-anime`, `renderer-3d`), with W504 encode+store into R2 via Worker B's W912 store port, and the artifact handoff back. | `implementation-only` | the actual W914 Wave-2 build |
| G6 | **Wall-clock `GpuClock` implementation** (W303 limitation 9) if Wave 2 reuses `GpuJobDispatcher` as the hosted queue engine; alternatively the hosted adapter implements dispatch directly on Upstash (W913) and keeps W303 as the in-process reference. | `implementation-only` | |
| G7 | **Durable idempotency/ledger** behind a storage seam (W303 limitation 5, W304 limitation 1) — Upstash/Neon (Worker B's W913/W911). The adapter contract keeps the ledger port abstract. | `implementation-only` (cross-worker coordination) | |
| G8 | **Wire security** (W303 limitation 4: in-process trust only) — authn/authz on the hosted worker boundary (Worker B's W902/W910 credentials). | `implementation-only` | |
| G9 | **Descriptor honesty / capability discovery** — the adapter's capability descriptor (supported renderers, concurrency, timeouts, cost units) must be discoverable by the frontend capability contract (W901, Worker B). Integration point, not a new contract — the descriptor shape is delivered here. | `implementation-only` | |
| G10 | **Renderer registry is per-process** (`RendererRegistry`: "one instance per process") — a hosted worker builds its own registry; the control plane learns capabilities through the adapter descriptor, not the registry. No change to `renderer-contract`. | `implementation-only` | |

No finding requires changing W303/W304/W504 code to proceed: all three are sufficient as in-process references, and every hosted need is either additive (this contract) or a new implementation behind an existing port. The only decisions for the TL are G1 (promotion-or-mirror) and G2 (control-plane adoption surface).

---

## 8. Wave 2 implementation plan (recommended slice)

**Goal:** W914 acceptance — "hosted control plane can dispatch at least one real compute adapter; provider selection is configuration-driven and metered."

1. **Hosted worker (`apps/compute-worker` or `packages/compute-adapter-hosted`)**: a Bun-served HTTP worker that implements the `@sporta/compute-adapter` provider seam. Job execution: resolve the job description's renderer + recipe → build a contracts `RenderRequest` (rights posture re-checked fail-closed) → execute the REAL renderer plugin (`renderer-anime` and/or `renderer-3d`; the W304 executor's `render-refused`/`internal` failure mapping is the precedent) → W504 encode (`encode.ts`) → store via the R2-backed store port (W912) → return the artifact handoff + usage record. Progress events reported at renderer-defined stages.
2. **Control plane**: extend `@sporta/control-api` additively (async render submission backed by `ComputeAdapterPort`; provider selection from environment configuration, never a domain dependency — deployment-architecture "provider adapters are allowed behind stable interfaces"). Queue/bounded admission via Upstash (W913); durable idempotency keys there too (G7).
3. **Test strategy**: (a) this package's contract tests keep pinning schema/state-machine/accounting/metering; (b) new integration tests over the real HTTP wire (typed-error mapping, auth failures, superseded reports after cancel); (c) the deployment-readiness evidence path: a fixture render dispatched from a fresh browser through the hosted control plane completing on the real worker, output playable from R2 (W920 steps 10-12).
4. **Evidence plan**: work-item-status row with the hosted run's accounting snapshot (dispatched === terminal + in-flight, usage records total), latency measurements feeding W915/W919, and the honest limitation list (single provider first; provider selection config-driven; free-tier budget guards from W919).

**Sequencing:** depends on W910 (edge deployed), W912 (R2 store port) for the stored-artifact mode — the contract allows inline-content mode so the worker can land before W912 and switch delivery modes by configuration.
