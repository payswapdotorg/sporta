# W306 SLO candidates — measured evidence, honestly scoped

**Status: CANDIDATES for W802 (Latency SLOs, alert thresholds, degradation
policies). W306's mandate is measured evidence; W802 formalizes it.**

## The scope of every number below (read before quoting any of them)

- **Clock domain: injected-virtual.** All timings are readings of the ONE
  injected `VirtualGpuClock` the whole pipeline shares (the W303/W304
  constitution). They characterize the pipeline's **algorithmic latency
  structure** — watermark-grid waits, bounded-queue sojourns, the W303
  dispatch wait, the authored render-duration model, the reorder hold — on a
  controlled fixture. They are **NOT wall-clock or real-network SLOs**. Real
  ICE/STUN/network latency is out of scope exactly as W305 documented the
  same boundary for its in-process transport seams.
- **The fixture:** `w306-live-fixture` v1 (seed `w306-live-fixture-v1`) —
  90 s of event time, 240 incremental SWM updates (a real W006 story through
  the W402 `stateAt`/`eventWindow` seams), one 10-second dense-action burst
  window (event time 30 s–40 s, 16 updates/s at a compressed arrival
  cadence), seeded jitter and world-model derivation costs.
- **The pipeline:** the W304 `RenderOrchestrator` over the W303 gpu-worker
  protocol through the REAL W502 anime executor; render duration model
  400 ms/batch, 1000 ms batch grid, ≤3 updates/batch, channel bound 8, one
  worker (2 concurrent leases), `block` backpressure, degradation
  `skip-stale: disabled` (the honest baseline: nothing is dropped, latency
  grows instead — see §Interpretation).
- **The interleaving model:** on a virtual clock there is no true
  parallelism — concurrent work interleaves only at await points. The
  benchmark's source driver advances the clock to each authored arrival and
  then grants the pipeline 32 microtask quanta
  (`benchmark.driver.settleQuantaPerArrival` in every report) — the
  stand-in for source and renderer executing concurrently. A different
  interleaving policy would shift the queueing numbers; the fixture +
  pipeline + driver tuple is exactly what the reports record.
- **Percentile method: nearest-rank** (no interpolation; every percentile
  is a value that actually occurred in the trace), pinned by unit tests.

## Evidence (the checked-in fixture run, byte-reproducible)

Batch stages (n = 140 batches; all rendered, 0 dropped/skipped — the balance
is asserted in the report and re-validated on parse):

| stage            | p50 (ms) | p95 (ms) | max (ms) | what it measures                                              |
| ---------------- | --------: | --------: | -------: | ------------------------------------------------------------- |
| swm-to-batch     |       102 |      4478 |     5027 | batch cut − last input visible (the watermark-grid wait)      |
| batch-queue      |         0 |       400 |      400 | channel sojourn + scheduler admission before the W303 submit   |
| w303-schedule    |         0 |      4000 |     4400 | W303 `queueWaitMs` (submit → first executor invocation)        |
| render-execution |       400 |       400 |      400 | W303 `executionMs` (the authored render-duration model)       |
| finish-to-emit   |         0 |       400 |      400 | reorder hold + in-order emission wait after render completion |
| end-to-end       |      2029 |      8849 |     9762 | first input visible → output emitted                          |

Frame stages (n = 240 updates):

| stage             | p50 (ms) | p95 (ms) | max (ms) | what it measures                          |
| ----------------- | --------: | --------: | -------: | ----------------------------------------- |
| swm-store-sojourn |      2121 |      4680 |     5027 | visible in store → first consumer query    |
| end-to-end        |      3968 |      9080 |     9762 | visible in store → its batch's emission   |

Authored (NOT measured — the fixture's source model, echoed for context):
world-model update derivation p50 = 82 ms, p95 = 117 ms.

Whole-run shape: 240 frames in = 240 emitted + 0 skipped-stale + 0 dropped +
0 cancelled + 0 duplicate; 50 size-limit batch splits; peak 13 batches in
system (bounded well below stream length — the W304 acceptance holding under
this load); the run drains to completion ~14 s after the story ends.

## Interpretation (what the numbers mean)

- **The normal-phase floor** (no queueing): swm-to-batch ≈ 0–100 ms (an
  update becomes visible just after its grid boundary), the channel and W303
  queue ≈ 0, render = the authored 400 ms, emission ≈ 0 — so a batch's
  end-to-end floor is ≈ the render duration plus the sub-boundary arrival
  offset. The `render-execution` p50 = p95 = 400 ms exactly because nothing
  else advances the clock inside a solo render's window.
- **The burst tail**: the dense window (16 updates/s ⇒ 6 batches/s on the
  1000 ms grid) exceeds the 1-render-per-400 ms virtual-clock throughput, so
  work queues — visibly in `swm-to-batch`, `w303-schedule`, and both
  end-to-end rows. The congestion point under these bounds is the **W303
  ready queue**, not the 8-slot batch channel (`peakQueuedNow` stayed 0; the
  consumer never parked). That is an honest finding about THIS
  configuration, not a general law.
- **Elapsed-time semantics on a shared virtual clock**: a per-window
  elapsed reading (e.g. W303 `executionMs`) can exceed the authored
  per-job duration when concurrent parties advance the clock inside the
  window — both readings are honest; the trace records the wrapper's own
  entry/exit reads alongside the W303 timing, and assembly asserts the
  wrapper window is CONTAINED in the job lifetime (never equal-or-crossing
  claims).
- **Nothing is lost under this load**: degradation is disabled and
  backpressure is `block`, so overload surfaces as latency, never as silent
  drops. Loss paths (queue refusal, eviction, reorder overflow,
  skip-stale) are exercised under TIGHTER bounds by the package's tests
  (`test/pipeline.test.ts`), with the accounting balance still asserted.

## Candidate targets (for W802)

| stage            | p50 target (ms) | p95 target (ms) | headroom over measured |
| ---------------- | --------------: | --------------: | --------------------- |
| swm-to-batch     |             250 |            6000 | ~2.5× / ~1.35×        |
| batch-queue      |              50 |            1000 | — / 2.5×              |
| w303-schedule    |              50 |            6000 | — / 1.5×              |
| render-execution |             750 |            1000 | ~1.9× / 2.5×          |
| finish-to-emit   |              50 |            1000 | — / 2.5×              |
| end-to-end       |            3000 |           12000 | ~1.5× / ~1.35×        |

### Reasoning

- p50 targets sit above the measured medians with enough slack that a
  fixture/pipeline tuning which shifts the normal phase slightly does not
  breach (the floor stages — batch-queue, w303-schedule, finish-to-emit —
  measured p50 = 0; any positive target is pure slack chosen to make a
  REGRESSION to sustained queueing visible).
- p95 targets sit ~1.35–2.5× above the measured burst tail: the burst tail
  is the honest stress the fixture authors, and the targets allow a
  somewhat deeper burst without breaching, while an order-of-magnitude
  regression (a stage going pathological) fails loud through
  `checkSloCandidates`.
- These are **per-stage injected-clock budget candidates**, not alert
  thresholds: W802 owns thresholds, burn-rate/alerting policy, and the
  degradation decision points (when `skip-stale` should trade frames for
  latency — W304's own knob, deliberately disabled in this baseline).

## How to reproduce

```sh
cd packages/latency-benchmark && bun run benchmark
```

Emits the canonical report bytes to stdout and the human summary to stderr.
The same fixture + clock + pipeline produces byte-identical report bytes
(pinned by `test/determinism.test.ts`, in-process and across subprocesses).
