# @sporta/compute-adapter

**Work item W914 (productization Wave 1):** audit + provider-neutral
compute-adapter contract preparation. The hosted adapter implementation is
**Wave 2** — see `docs/work-items/w914-compute-adapter-audit.md` for the
seam-by-seam audit, the gap list, and the Wave-2 plan.

The provider-neutral, transport-free contract layer that lets the hosted
control plane dispatch REAL render jobs to REAL compute (CPU workers,
GPU/on-demand workers, or a bounded managed actor) **without the domain
knowing which provider executed** (architecture-lock §9 vendor neutrality;
deployment-architecture "provider adapters behind stable interfaces").

## What this package IS (the contract layer)

- **Versioned zod schemas** (`src/schemas.ts`, `COMPUTE_SCHEMA_VERSION
  "1.0"`): the transport-safe `ComputeJobDescription` (jobId + idempotency
  key + session/correlation linkage + renderer + recipe + inputs manifest +
  output profile + rights posture + constraints), the honest
  `ComputeAdapterDescriptor` (supported renderers, latency classes,
  concurrency, deadline bounds, cost units), the dispatch handle and
  outcome, the closed lifecycle/event vocabularies, the terminal
  `ComputeJobCompletion` (with never-silent input accounting), the W504-
  aligned `ComputeOutputArtifact` handoff, the `ComputeUsageRecord`
  (metering), the pollable `ComputeJobSnapshot`, and the whole-adapter
  `ComputeAdapterStats`.
- **Ports** (`src/adapter.ts`): `ComputeAdapterPort` — the control-plane
  surface (`describe` / `dispatch` / `getJob` / `subscribe` / `cancel` /
  `usage` / `stats`), HTTP-shaped on purpose (each method maps 1:1 onto a
  hosted route); `ComputeProviderPort` — the narrow seam a Wave-2 hosted
  worker implements; `awaitCompletion` — the never-rejecting result await.
- **The lifecycle state machine** (`src/states.ts`): the closed vocabulary
  and the 14-edge legal-transition table; illegal transitions reject
  loudly (`assertComputeTransition`).
- **Typed boundary errors** (`src/errors.ts`), classified with the
  contracts `TerminalFailureClass` vocabulary.
- **The accounting identities** (`src/accounting.ts`): dispatch identity,
  terminal-bucket identity, input-ledger identity, and metering totality —
  an imbalance rejects settle, never a lying result.

## What this package is NOT (the honest boundary)

- **No real provider is wired.** `InMemoryComputeAdapter`
  (`src/memory-adapter.ts`) is a ***TEST-ONLY*** deterministic reference
  over a simulated provider port — the in-tree proof that the contract is
  implementable, exercised only by tests. The W914 Wave-2 build (a hosted
  worker over the real renderers, an Upstash-backed queue, R2 artifact
  handoff) does not exist yet.
- **No transport, no clock, no randomness**: no network, no timers, no
  wall-clock reads, no RNG anywhere in `src` (pinned by
  `test/boundary.test.ts`). Every timestamp comes from the caller's
  injected source.
- **No @sporta runtime dependencies**: `src` imports only `zod` (pinned by
  `test/boundary.test.ts`). The vocabularies mirrored from W303/W304/W504/
  contracts/observability are cited in `src/schemas.ts` and test-pinned
  against the real packages by `test/vocabulary.test.ts` (dev-dependencies,
  test-only).

## Vocabulary alignment (cited and pinned)

Every closed vocabulary is either VERBATIM from an existing package or a
documented adapter-level addition (`"admitted"`/`"dispatched"` states,
`"dispatched"`/`"progress"` event kinds). See the header of
`src/schemas.ts` for the citation of each; `test/vocabulary.test.ts` pins
the alignment against `@sporta/gpu-worker`, `@sporta/contracts`,
`@sporta/observability`, `@sporta/output-pipeline`, and the renderer-anime
identity so drift fails the suite.

## Testing

```sh
bun test          # 130 tests / 508 assertions (schemas, states, vocabulary,
                  # boundary source-scans, and the in-memory reference)
bun run typecheck # tsc --noEmit, zero errors
```

## Wave 2 (the actual W914 implementation)

See `docs/work-items/w914-compute-adapter-audit.md` §8: a hosted worker
implementing `ComputeProviderPort` over the real renderer plugins, the
additive control-plane async-render path behind `ComputeAdapterPort`,
durable idempotency (W913), the R2 artifact handoff (W912), and the
metering feed for W919's quotas/alarms/fail-closed admission.
