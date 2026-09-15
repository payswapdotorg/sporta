# @sporta/render-orchestration — streaming render orchestration (W304)

The M4 render stage. **Acceptance (docs/work-items/work-items.md W304):**
"incremental SWM updates can drive renderer work without unbounded backlog."

A deterministic, in-process, vendor-neutral orchestrator:

```
store (SwmUpdateStore — W402-style incremental queries)
  └─ consumer pump: cut watermark-aligned bounded batches
       ├─ resume skip (counted duplicates — never re-submitted)
       ├─ degradation: skip-stale at admission (counted, never re-stamped)
       └─ W104 BoundedChannel (block / reject / drop-oldest, verbatim)
            └─ scheduler pump: dequeue → skip-stale re-check → submit
                 └─ W303 GpuJobDispatcher (idempotency keys from batch
                    watermarks, leases, retries, DLQ — verbatim)
                      └─ GpuWorker(s) → RenderBatchExecutor (the REAL W502
                         anime plugin) → job results
                           └─ emitter: bounded reorder → outputs in watermark
                              order + provenance, one serialized drain chain
```

Runtime dependencies are workspace-only (`@sporta/contracts`,
`@sporta/gpu-worker`, `@sporta/observability`, `@sporta/renderer-anime`,
`@sporta/renderer-contract`, `@sporta/transport`); dev-only:
`@sporta/temporal`, `@sporta/testing`, `@sporta/world-model` (the W402
seams the test fixtures drive). No external packages, no GPU, no network,
no real timers — the only clock is the injected W303 `GpuClock`.

## 1. Incremental consumption

The `SwmUpdateStore` seam is sequence-anchored and bounded
(`updatesAfter(afterSequence, toMs, limit)`): a whole-history re-read is
structurally impossible through this surface. The test fixture is a growing
W006 engine observed through the REAL W402 consumer seams (`stateAt` +
`eventWindow`), and it counts materialized entries per query — every query
returns a bounded slice, never the stream. The consumer cuts
watermark-aligned batches (`closedBy`:

- `watermark-boundary` — the batch's last update ends at (or the window ran
  out at) the grid boundary `startMs + k·batchIntervalMs`;
- `size-limit` — `maxUpdatesPerBatch` cut the window short; the window
  continues in the next batch;
- `stream-complete` — the final partial window, honestly closed).

The batch's watermark is its LAST update's watermark, **verbatim** — never
re-stamped to the nominal boundary.

## 2. Render job scheduling (W303 verbatim)

Each consumed batch maps to one W303 job envelope: `idempotencyKey =
render-<session>-wm-<watermarkMs>-seq-<sequence>` (derived from the batch
watermark — the same watermark NEVER double-submits; a re-submission
resolves a **counted duplicate** at the dispatcher, never double-claimed),
`jobId = render-job-<session>-<ordinal>`, `payloadRef = render-batch:<batchId>`
(resolved through the `BatchRegistry`). Lease/heartbeat/staleness/retry/DLQ
semantics are inherited from the dispatcher/worker protocol untouched.
Capacity admission is the dispatcher's own: a full ready queue refuses with
a typed `GpuResourceLimitError` (counted `render-queue-refused`); an
exhausted admitted budget terminates the dispatcher and the run fails LOUD
with its `resource-limit` class.

## 3. Unbounded-backlog prevention (the acceptance core)

Four bounds, all loud (each counted + logged + metered + ledgered):

1. **The W104 `BoundedChannel`** between consumption and render work, with
   the three policies VERBATIM: `block` parks the consumer
   (backpressure — `consumerSendParkAttempts` counted); `reject` throws the
   typed `ResourceLimitError` (`batchesQueueRefused`); `drop-oldest` evicts
   with the channel's OWN `dropped` counter and the orchestrator attributes
   each eviction to the SPECIFIC oldest queued batch (the cross-boundary
   identity `batchesQueueEvicted === channel.dropped` is runtime-asserted
   at settle). A message that alone exceeds the byte budget follows W104
   exactly: dropped-with-accounting under `drop-oldest`, typed refusal under
   `block`/`reject`.
2. **The W303 ready queue** (typed refusals, above).
3. **The bounded reorder buffer** (`maxReorderOutputs`): overflow drops the
   INCOMING output (never a closer-to-head one) with reason
   `reorder-overflow`.
4. **The explicit skip-stale degradation policy** (`DegradationPolicy`):
   `skipStale: "disabled"` (default — nothing is skipped silently) or
   `skipStale: { maxWatermarkLagMs }` — batches whose watermark lags the
   stream head by MORE than the configured lag are SKIPPED at admission
   (before the queue) and re-checked at dequeue (a batch can go stale while
   queued): counted, logged, metered, ledgered, with the ORIGINAL watermark
   preserved (`skip: { originalWatermark, neverRestamped: true }`) and the
   measured lag + head evidence in the log line — never rendered as if
   fresh, never silently dropped.

The burst test proves bounded memory: a large burst with a slow renderer
plateaus `stats.peakBatchesInSystem` at
`maxQueuedBatches + maxQueuedRenderJobs + workerConcurrency +
maxReorderOutputs`, never at stream length.

## 4. Result emission

The provided executor (`createAnimeRenderBatchExecutor`) drives the REAL
W502 anime plugin (`renderAnimeClip`): one batch's updates map one-to-one
onto the W502 clip steps (`atMs = update.watermark.watermarkMs`, snapshot
and events verbatim), and render work consumes `renderDurationMs` of
injected-clock time first (the slow-renderer fixture knob). Outputs are
emitted in **watermark order** (== batch-ordinal order) through ONE
serialized drain chain — the sink is called one record at a time, awaited,
strictly in order, even when jobs complete out of order or an async sink
resolves out of order. Every `RenderOutputRecord` carries provenance:
source batch id/ordinal, the source batch's watermark VERBATIM, the W303
job id, the renderer identity (from the output manifest), and the job's
measured timing envelope. Executor outputs are structurally validated
(`assertAnimeRenderOutputShape`) — a lying executor is an internal fault,
accounted `render-output-invalid`, never silent.

## 5. Recovery

Checkpoints are cut whenever a batch's TERMINAL disposition crosses the
next watermark boundary, **anchored at the crossing batch**: the resume
anchors are the batch's `toSequence`, `ordinal + 1`, and the consumer-grid
state right after its cut (`postCutGrid`). A replay from those anchors
re-cuts the SAME batches (same ordinals, watermarks, idempotency keys), so:

- `resume({ mode: "skip" })` — checkpointed keys are counted duplicates at
  consume and never re-submitted; batches cut-but-unresolved at cut time
  are re-cut with the SAME keys and the W303 dispatcher dedupes them
  (counted duplicates, never double-executed);
- `resume({ mode: "reprocess" })` — every re-cut batch is re-submitted and
  the dispatcher's key registry dedupes (counted duplicates);
- batches that never reached the protocol (skipped, evicted, refused,
  cancelled) are reprocessed at-least-once in BOTH modes.

`processedKeys` registers only render-protocol terminal dispositions
(`rendered` / `render-failed`) — the W302 registry posture.

## 6. Shutdown

`stop({ mode: "drain" })` (default): no new batches are cut; everything
inside completes; the reorder is PROVEN empty at settle. `stop({ mode:
"cancel" })`: the channel closes immediately (a parked send is accounted
`abandoned-at-stop` — the W301 posture), queued batches are accounted
`cancelled` at the dequeue sweep, in-flight jobs are cancelled at the
dispatcher (their eventual reports counted superseded by the protocol), and
completed outputs still emit. `stop()` is idempotent. Every batch, job, and
output lands in EXACTLY ONE terminal bucket — the settle-time assertions
reject `done()` on any imbalance (never a lying result).

## 7. The accounting identities

Runtime-asserted at every settle (an imbalance REJECTS the settle promise):

```
batchesIn === rendered + skippedStale + dropped + cancelled
             + duplicateSkips + inFlight (0 at settle)
batchesIn === duplicateSkips + staleAtAdmission + sentToQueue
             + queueRefused + abandoned
sentToQueue === receivedFromQueue + queueEvicted + queuedNow (0 at settle)
receivedFromQueue === jobsSubmitted + jobDuplicates + staleInQueue
             + renderQueueRefused + cancelledInQueue
jobsSubmitted === rendered + renderFailed + renderCancelled
             + reorderOverflow + outputInvalid + jobsInFlight (0 at settle)
dropped === queueEvicted + queueRefused + abandoned + renderQueueRefused
             + renderFailed + reorderOverflow + outputInvalid
batchesQueueEvicted === channel.dropped (cross-boundary, channel-owned)
```

## 8. Determinism

No wall time anywhere: the orchestrator, dispatcher, workers, and render
executor all share ONE injected `GpuClock`. The whole story (outputs,
stats, ledger, checkpoints, log records, metrics snapshot) is deep-equal
across two fresh runs (test-pinned). A store that announces a non-future
growth time is refused loudly (it would spin the consumer).

## 9. Honest limitations

- **Recovery is in-process**: the W303 dispatcher's in-memory ledger IS the
  idempotency registry. A process crash loses it; a fresh-process replay
  re-renders at-least-once (the documented W303 limitation — wire a durable
  ledger behind the seam before relying on cross-process recovery).
- **Checkpoint `processedKeys` are in-memory and cumulative** (O(keys) per
  checkpoint — the W302-identical posture; externalize behind a storage
  seam for real deployments).
- **A store that neither completes nor announces growth** settles the run
  honestly as `stopped` (never a fabricated `completed`); a later resume
  continues from the last checkpoint.
- **The reorder bound drops the incoming output at overflow** — a bounded
  choice, counted and logged; it means the output for that batch is lost
  this run (recovery reprocesses it at-least-once).
- **A throwing sink rejects `done()`** (fail-loud; the affected batch never
  lands a lying `rendered` disposition — the accounting assertion is the
  backstop).
- **Render work is in-process by design**: no GPU, no process isolation;
  the W303 executor seam is where a real deployment wires its workers.
- **`consumerSendParkAttempts`** counts sends attempted while the channel
  was full (under `block` those sends park; under `drop-oldest` they evict
  instead) — an honest load signal, not a claim that every counted send
  parked.
- **Stream-position stats are per-run**: `resume()` resets the run's
  outputs/ledger/stats; the dispatcher's job ledger and the session's
  terminal keys persist in-process (the recovery posture above).
