# @sporta/compute-adapter-hosted

**Work item W914 (productization Wave 2):** the hosted compute worker and
the production `ComputeAdapterPort` implementation over it. The contract
layer (`@sporta/compute-adapter`, Wave 1) is the consumed seam; see
`docs/work-items/w914-compute-adapter-audit.md` for the audit and plan.

The hosted plane that lets the control plane (`@sporta/control-api`'s
additive `createRenderAsync` surface) dispatch **REAL render jobs** to
**REAL compute** — provider selection is configuration-driven, every job is
metered, and every failure is a classified value, never silence.

## What this package delivers

- **REAL job execution** (`src/executor.ts`): one materialized dispatch
  request becomes a render through the REAL renderer plugin
  (registry-resolved, W501 plugin interface — `renderDetailed` for the W502
  frame sequence), the REAL W504 encoder (`encodeAnimeClip`), and the REAL
  W504 render-segment store — a content-addressed (sha-256) inline artifact
  handoff. Never throws: every outcome — including malformed input and
  internal faults — resolves as a classified `HostedJobExecution` envelope.
- **Fail-closed budgets** (`src/budgets.ts`): duration/size bounds derived
  from the documented Vercel Hobby limits (execution 10 s, artifact 1 MB,
  whole-job deadline 60 s). An over-budget job NEVER hands its outputs back.
- **The worker application** (`src/worker.ts`): the honest descriptor
  (derived from the real registry — nothing advertised that cannot resolve),
  jobId-idempotent execution (a re-POST returns the SAME envelope and counts
  a duplicate), bounded-fail-closed concurrency, per-job records, and
  whole-worker metering counters.
- **The production adapter** (`src/adapter.ts`): the full job ledger —
  admission (descriptor honesty), idempotency-key-first dedupe, the
  lifecycle state machine, cancellation with superseded reports,
  never-silent input accounting, deadline disposal (poll/outcome-driven —
  no timers), dead-lettering on provider faults, and the settle-time
  accounting identities (`assertComputeAccounting`) — over an INJECTED
  execution function.
- **The HTTP surface** (`src/http.ts`): `POST /v1/jobs/execute` → result
  envelope, `GET /v1/adapter`, `GET /health`, `GET /v1/jobs/:jobId` — one
  transport-free handler both `Bun.serve` (`createComputeWorkerServer`) and
  the serverless route mount. The HTTP client (`createHttpExecuteFunction`)
  fail-loudly validates every envelope a worker answers.
- **Env-driven provider selection** (`src/env.ts`): `COMPUTE_PROVIDER` =
  `in-process` (dev/reference — the REAL worker, no transport) | `http`
  (hosted — `COMPUTE_WORKER_URL`; the descriptor is FETCHED live, never
  invented) | `none` (the control plane answers its typed 503). Composition
  root only: the domain modules read no clock, no randomness, no env
  (test-pinned by `test/boundary.test.ts`).

## The two compositions

```ts
// Dev / reference (COMPUTE_PROVIDER=in-process — the default):
const resolved = await resolveComputeAdapterFromEnv();
createControlServer({ computeAdapter: resolved.adapter!, /* … */ });

// Hosted (COMPUTE_PROVIDER=http + COMPUTE_WORKER_URL):
const resolved = await resolveComputeAdapterFromEnv(); // descriptor fetched live
```

The deployed worker route is `apps/web/src/app/api/compute/route.ts`
(POST = execute → result envelope; GET = health + descriptor) — the frozen
Worker-C namespace, deferred-import composed per process.

## Tests

`bun test` — 71 tests / 310 assertions across 7 files: REAL executor paths
and every determinate failure class, the worker's descriptor/idempotence/
capacity/metering, the adapter's full ledger semantics (including
cancel-wins races and deadline disposal), the HTTP surface over a real
`Bun.serve` socket, env-driven selection, envelope/budget teeth, and the
constitution boundary scan.

## Honest boundaries (this wave)

- No automatic retries: a transport fault dead-letters (`internal`); the
  W913 queue wave owns recovery.
- The ledger and the worker's store are process-local (durable idempotency
  is G7/W913; the R2-backed store is W912 behind the same W504 port).
- Wire auth on the worker boundary is audit gap G8 — the W902/W910
  credentials wave wraps it.
- Deployed-Vercel validation is a LATER wave (Worker B's): local
  real-HTTP is this flight's evidence boundary
  (`packages/control-api/evidence/w914-hosted-evidence.ts`).
