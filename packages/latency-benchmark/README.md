# @sporta/latency-benchmark — the W306 end-to-end latency benchmark

**Work item W306 (M4):** "p50/p95 stage and end-to-end latency measured on a
controlled fixture/stream; target SLOs are documented from evidence."

ONE run drives the **REAL W304 streaming pipeline** — `RenderOrchestrator` over
the W303 gpu-worker job protocol, through the REAL W502 anime executor
(`createAnimeRenderBatchExecutor`) — on a controlled, checked-in, deterministic
live-stream fixture, instruments every stage boundary in the **injected clock
domain**, and emits a versioned, zod-validated, machine-readable report plus a
deterministic human summary.

## The honest boundary (read before quoting any number)

**Every timing in every report is a reading of the ONE injected
`VirtualGpuClock` shared by the whole pipeline — never wall time.** The
measurements characterize the pipeline's **algorithmic latency structure** on
the controlled fixture: watermark-grid waits, bounded-queue sojourns under the
authored burst, the W303 dispatch wait, the authored render-duration model, and
the reorder hold. They are **NOT wall-clock or real-network SLOs**:

- there is no real GPU, no real network, no real ICE/STUN path (the same
  boundary W305 documented for its in-process transport seams);
- the render duration is an **authored model** (`renderDurationMs`, echoed
  into every report) — the real anime render executes, but its *duration* on
  the clock is the model, not a measured wall time;
- on a virtual clock there is no true parallelism: concurrent work interleaves
  only at await points, and the benchmark's driver grants a fixed number of
  microtask quanta after each authored arrival
  (`benchmark.driver.settleQuantaPerArrival`, echoed into every report) — a
  different interleaving policy would shift the queueing numbers; the
  fixture + pipeline + driver tuple is exactly what the reports record;
- elapsed-time semantics: a per-window elapsed reading (e.g. W303
  `executionMs`) measures virtual time between two reads of a clock ANY party
  may advance — the trace carries the instrumented executor's own entry/exit
  reads alongside, and assembly asserts CONTAINMENT (never equality).

W802 owns formalizing SLOs and alerting; W306's mandate is the measured
evidence, scoped exactly as above. The percentile method (nearest-rank, no
interpolation — every percentile is a value that actually occurred) is
documented here, in SLOs.md, and pinned by tests.

## Usage

```sh
cd packages/latency-benchmark
bun run benchmark        # one run: canonical report bytes → stdout, human summary → stderr
bun test                 # the full suite (unit + integration, ~2s)
```

Programmatically:

```ts
import { runLatencyBenchmark, parseLatencyReport, serializeLatencyReport } from "@sporta/latency-benchmark";

const run = await runLatencyBenchmark();          // the checked-in fixture + pipeline
const report = parseLatencyReport(JSON.parse(run.serialized)); // re-validate anywhere
```

## What is measured (the stage vocabulary)

Per **batch** (the W304 work unit) — all injected-clock milliseconds:

| stage            | definition                                                                  |
| ---------------- | --------------------------------------------------------------------------- |
| `swm-to-batch`   | batch cut − its last input's visibility (the watermark-grid wait)           |
| `batch-queue`    | W303 submit − cut (the bounded batch channel sojourn + scheduler admission) |
| `w303-schedule`  | the W303 `jobTiming.queueWaitMs`, VERBATIM (submit → executor start)        |
| `render-execution` | the W303 `jobTiming.executionMs`, VERBATIM (the worker-measured render)   |
| `finish-to-emit` | emission − render finish (the reorder hold + in-order emission wait)        |
| `end-to-end`     | emission − the batch's first input's visibility (all inputs → output)      |

Per **frame** (fixture update): `swm-store-sojourn` (visibility → first
consumer query) and `end-to-end` (visibility → its batch's emission). The
fixture's authored source model (observation times, world-model derive costs)
is carried SEPARATELY, labeled `authoredNotMeasured: true` — never presented
as pipeline measurements.

The **fixture** (`w306-live-fixture` v1, seed-pinned): 90 s of event time,
240 incremental SWM updates — a REAL W006 `WorldModelEngine` story observed
through the REAL W402 `stateAt`/`eventWindow` seams — with one 10-second
dense-action burst window (event time 30 s–40 s, 16 updates/s at a compressed
arrival cadence) that exceeds the modeled render capacity and gives p95 its
honest tail. See `src/fixture.ts` for the full authored-vs-measured split.

## Never-silent accounting

`frames in === frames emitted + frames skipped-stale + frames dropped +
frames cancelled + frames duplicate` — runtime-asserted (typed
`LatencyAccountingError` with the full breakdown), **on top of** the W304
orchestrator's own batch identities, which are re-asserted over the settled
result. The emitted-frames cross-check
(`framesEmitted === Σ emitted outputs' manifest frame counts`) and the
batch-cut replay cross-check (the pure replay of the W304 cut arithmetic must
reproduce the orchestrator's ledger EXACTLY — batch ids, ordinals, watermarks,
executor sequences) make a lying or lossy trace structurally impossible. The
parse-time validation extends the same checks to consumers reading a report
from disk. The loss paths themselves (queue refusal/eviction, reorder
overflow, skip-stale, render failure) are exercised under tighter bounds by
`test/pipeline.test.ts`, always with the accounting still balancing.

## The report

- `sporta/latency-benchmark/report@1` — a versioned schema tag; any shape
  change bumps it (old reports fail loud, never partially parse);
- zod-validated (`src/schema.ts`), **strict** (unknown keys are rejected at
  every level), with cross-consistency checks beyond the static shape;
- canonical bytes: recursively sorted keys, 2-space indent, trailing newline,
  NaN/undefined rejected — byte-identical on every rerun of the same fixture +
  clock + pipeline (pinned in-process and across subprocesses);
- carries: the fixture + pipeline + driver configuration verbatim, the full
  per-frame/per-batch trace (every boundary, authored AND measured, labeled),
  the stage percentile table, the accounting blocks, and the stage
  definitions.

## SLO candidates

`SLOs.md` documents the measured evidence (the checked-in run's actual p50/p95
per stage) and derives candidate targets with explicit headroom for W802 to
formalize; `src/slo.ts` carries the same table as code
(`checkSloCandidates`), and `test/pipeline.test.ts` pins the evidence numbers
so the documentation can never drift from the code silently.

## Integration: the eval-harness live-stream case

W801's suite (known limitation: "checked-in fixtures only — no live-stream
case, W306's") gains this benchmark as its fourth case kind
(`w306-latency-benchmark`): the case spawns the package's
`scripts/run-once.ts` subprocess, validates its stdout through this package's
versioned parser, and checks the measured stages against the SLO candidate
table. The per-frame/per-batch trace rows are dropped from the case's
`measured` projection (the 200+ KB evidence stays in the benchmark's own
byte-reproducible report; the harness case carries the stage table, the
accounting summary, and the verdicts — the W403 projection precedent).

## Package boundary

Runtime dependencies: `@sporta/*` workspace packages plus zod (the
@sporta/contracts precedent). Zero wall-clock reads, zero `Math.random` (the
fixture's PRNG is the seeded `@sporta/testing` mulberry32), zero real timers —
pinned by `test/boundary.test.ts` (isolation + constitution source scans).
