# W802 Latency SLOs — the normative document

**Work item W802 (M7):** "SLOs, alert thresholds, and failure/degradation
policies exist." · Owner: Platform · Dependency: W306 (measured evidence).

Canonical executable references: `src/slos.ts` (`SLO_DEFINITIONS`),
`src/alerts.ts` (`ALERT_CATALOG`), `src/policies.ts`
(`DEGRADATION_POLICIES`). The tables in §2, §4 and §5 are pinned row-for-row
to the code by `test/slos.test.ts`, `test/alerts.test.ts` and
`test/policies.test.ts` — a change to either side without the other fails the
suite (the W503 THRESHOLDS.md convention, both directions: code and docs
never drift apart silently).

## 1. Scope — what domain every number below lives in

- **Clock domain: injected-virtual.** Every latency is a reading of the ONE
  injected clock the benchmark pipeline shares. The objectives characterize
  the pipeline's **algorithmic latency structure** (watermark-grid waits,
  bounded-queue sojourns, the W303 dispatch wait, the authored
  render-duration model, the reorder hold) on the controlled fixture —
  **NOT wall-clock or real-network SLOs** (the W306 boundary, verbatim; the
  same boundary W305 documented for its in-process transport seams).
- **Evidence base:** `w306-live-fixture` v1 (seed `w306-live-fixture-v1`),
  one checked-in run of the real W304 `RenderOrchestrator` over the W303
  gpu-worker protocol through the real W502 anime executor; report tag
  `sporta/latency-benchmark/report@1`; nearest-rank percentiles; n = 140
  batches / n = 240 frames. `test/benchmark-integration.test.ts` pins the
  LIVE benchmark's stage table to every baseline below — drift fails loud.
- **The compliance window is ONE benchmark run.** There is no rolling
  multi-window compliance (no 28-day burn-rate): this repository has no
  production telemetry pipeline yet. That is the documented **operational
  gap**: real-deployment SLOs need field measurement (W805's dashboards,
  W804's analytics); until then these objectives gate the benchmark domain —
  regressions in the pipeline's algorithmic latency structure fail loud
  (see §6, the integration).
- **Percentile semantics (the error budget, exactly).** One SLO = "the
  nearest-rank `metric` of `stage`, over the window, must be `<= targetMs`".
  The error budget is the percentile stated exactly: a p95 target holds iff
  **at most 5% of the window's samples exceed the target** (p50: at most
  50%). With nearest-rank, `p95 <= X` ⟺ the value at rank `ceil(0.95·n)` is
  `<= X` — the check and the budget are the same statement, never two.

## 2. The SLO table (16 objectives)

Batch rows (12) are the W306 SLO candidate table, **adopted verbatim**
(`@sporta/latency-benchmark` `SLO_CANDIDATES` — pinned equal by
`test/slos.test.ts`); their derivation is W306's own (that package's
SLOs.md §Candidate targets + §Reasoning). Frame rows (4) are W802-derived
from W306's measured frame-stage evidence by the documented rule:
`target =` smallest multiple of 500 ms that is `>= baseline × 1.25` (p50) or
`baseline × 1.35` (p95).

| sloId | stage | metric | baseline (ms) | target (ms) | budget | derivation |
|---|---|---|---|---|---|---|
| batch.swm-to-batch.p50 | swm-to-batch | p50 | 102 | 250 | 50% | W306 candidate: ~2.5× headroom over the normal-phase floor (0–100 ms, the watermark-grid wait) |
| batch.swm-to-batch.p95 | swm-to-batch | p95 | 4478 | 6000 | 5% | W306 candidate: ~1.35× headroom over the authored burst tail |
| batch.batch-queue.p50 | batch-queue | p50 | 0 | 50 | 50% | W306 candidate: pure slack over the floor stage — regression visibility |
| batch.batch-queue.p95 | batch-queue | p95 | 400 | 1000 | 5% | W306 candidate: 2.5× headroom; the channel was NOT the congestion point (peakQueuedNow 0) |
| batch.w303-schedule.p50 | w303-schedule | p50 | 0 | 50 | 50% | W306 candidate: pure slack over the floor stage — regression visibility |
| batch.w303-schedule.p95 | w303-schedule | p95 | 4000 | 6000 | 5% | W306 candidate: 1.5× headroom over the measured congestion point (the W303 ready queue) |
| batch.render-execution.p50 | render-execution | p50 | 400 | 750 | 50% | W306 candidate: ~1.9× headroom over the authored render-duration model |
| batch.render-execution.p95 | render-execution | p95 | 400 | 1000 | 5% | W306 candidate: 2.5× headroom (elapsed-window semantics documented by W306) |
| batch.finish-to-emit.p50 | finish-to-emit | p50 | 0 | 50 | 50% | W306 candidate: pure slack over the floor stage — regression visibility |
| batch.finish-to-emit.p95 | finish-to-emit | p95 | 400 | 1000 | 5% | W306 candidate: 2.5× headroom over the reorder hold under the burst |
| batch.end-to-end.p50 | end-to-end | p50 | 2029 | 3000 | 50% | W306 candidate: ~1.5× headroom over the normal-phase composition floor |
| batch.end-to-end.p95 | end-to-end | p95 | 8849 | 12000 | 5% | W306 candidate: ~1.35× headroom over the burst tail (architecture-lock §8: latency is a measurable SLO) |
| frame.swm-store-sojourn.p50 | swm-store-sojourn | p50 | 2121 | 3000 | 50% | W802 rule: 2121 × 1.25 = 2651.25 → 3000 (next 500 ms multiple) |
| frame.swm-store-sojourn.p95 | swm-store-sojourn | p95 | 4680 | 6500 | 5% | W802 rule: 4680 × 1.35 = 6318 → 6500 (next 500 ms multiple) |
| frame.end-to-end.p50 | end-to-end | p50 | 3968 | 5000 | 50% | W802 rule: 3968 × 1.25 = 4960 → 5000 (next 500 ms multiple) |
| frame.end-to-end.p95 | end-to-end | p95 | 9080 | 12500 | 5% | W802 rule: 9080 × 1.35 = 12258 → 12500 (next 500 ms multiple) |

## 3. Why these levels (headroom, honestly)

- The measured baseline is evidence, not a target: a knife-edge target on a
  deterministic benchmark would breach on any tuning shift, while a target
  with headroom lets a somewhat deeper burst pass and still **fails loud on
  a structural regression** (an order-of-magnitude growth, a stage going
  pathological). The W306 candidates chose the headroom; W802 adopts it and
  states it as a formula for the frame rows.
- The `render-execution` rows pin the **authored model** (400 ms/batch,
  echoed in every report): in the benchmark domain growth means the model
  changed; in a real deployment it means the actual renderer slowed. Either
  way the objective is the gate — the number is the same, the meaning is
  documented.
- The floor stages (`batch-queue`, `w303-schedule`, `finish-to-emit` at
  p50 = 0) exist as regression detectors: their p50 targets are pure slack
  so that a **regression to sustained queueing** becomes visible while it
  is still small.

## 4. The alert catalog (33 definitions)

Per SLO, **only the highest applicable severity fires** (critical subsumes
warning — one row per indicator, never noise). Warning = "headroom
half-consumed": `ceil(baseline + (target − baseline) / 2)`, fires while the
objective still holds (an operator signal, never a release gate). Critical =
objective breached: the indicator's error budget for the window is
exhausted. The loss alert is the never-silent accounting made operational.

| alertId | severity | threshold (ms) | derivation |
|---|---|---|---|
| latency.batch.swm-to-batch.p50.warning | warning | 176 | ceil(102 + (250 − 102)/2) — half the headroom consumed, objective still met |
| latency.batch.swm-to-batch.p50.critical | critical | 250 | objective breach: p50 > 250 (50% budget exhausted) |
| latency.batch.swm-to-batch.p95.warning | warning | 5239 | ceil(4478 + (6000 − 4478)/2) — half the headroom consumed |
| latency.batch.swm-to-batch.p95.critical | critical | 6000 | objective breach: p95 > 6000 (5% budget exhausted) |
| latency.batch.batch-queue.p50.warning | warning | 25 | ceil(0 + (50 − 0)/2) |
| latency.batch.batch-queue.p50.critical | critical | 50 | objective breach: p50 > 50 |
| latency.batch.batch-queue.p95.warning | warning | 700 | ceil(400 + (1000 − 400)/2) |
| latency.batch.batch-queue.p95.critical | critical | 1000 | objective breach: p95 > 1000 |
| latency.batch.w303-schedule.p50.warning | warning | 25 | ceil(0 + (50 − 0)/2) |
| latency.batch.w303-schedule.p50.critical | critical | 50 | objective breach: p50 > 50 |
| latency.batch.w303-schedule.p95.warning | warning | 5000 | ceil(4000 + (6000 − 4000)/2) |
| latency.batch.w303-schedule.p95.critical | critical | 6000 | objective breach: p95 > 6000 |
| latency.batch.render-execution.p50.warning | warning | 575 | ceil(400 + (750 − 400)/2) |
| latency.batch.render-execution.p50.critical | critical | 750 | objective breach: p50 > 750 |
| latency.batch.render-execution.p95.warning | warning | 700 | ceil(400 + (1000 − 400)/2) |
| latency.batch.render-execution.p95.critical | critical | 1000 | objective breach: p95 > 1000 |
| latency.batch.finish-to-emit.p50.warning | warning | 25 | ceil(0 + (50 − 0)/2) |
| latency.batch.finish-to-emit.p50.critical | critical | 50 | objective breach: p50 > 50 |
| latency.batch.finish-to-emit.p95.warning | warning | 700 | ceil(400 + (1000 − 400)/2) |
| latency.batch.finish-to-emit.p95.critical | critical | 1000 | objective breach: p95 > 1000 |
| latency.batch.end-to-end.p50.warning | warning | 2515 | ceil(2029 + (3000 − 2029)/2) |
| latency.batch.end-to-end.p50.critical | critical | 3000 | objective breach: p50 > 3000 |
| latency.batch.end-to-end.p95.warning | warning | 10425 | ceil(8849 + (12000 − 8849)/2) |
| latency.batch.end-to-end.p95.critical | critical | 12000 | objective breach: p95 > 12000 |
| latency.frame.swm-store-sojourn.p50.warning | warning | 2561 | ceil(2121 + (3000 − 2121)/2) |
| latency.frame.swm-store-sojourn.p50.critical | critical | 3000 | objective breach: p50 > 3000 |
| latency.frame.swm-store-sojourn.p95.warning | warning | 5590 | ceil(4680 + (6500 − 4680)/2) |
| latency.frame.swm-store-sojourn.p95.critical | critical | 6500 | objective breach: p95 > 6500 |
| latency.frame.end-to-end.p50.warning | warning | 4484 | ceil(3968 + (5000 − 3968)/2) |
| latency.frame.end-to-end.p50.critical | critical | 5000 | objective breach: p50 > 5000 |
| latency.frame.end-to-end.p95.warning | warning | 10790 | ceil(9080 + (12500 − 9080)/2) |
| latency.frame.end-to-end.p95.critical | critical | 12500 | objective breach: p95 > 12500 |
| loss.unexpected-frames | critical | structural (see derivation) | dropped + cancelled + skipped-stale(while degradation disabled) > 0 — calibrated to the W306 baseline run (all zero under block backpressure, skip-stale disabled). Duplicates are NOT loss (idempotency dedupe — the first instance was emitted); skipped-stale under an ENABLED skip-stale policy is the deliberate, accounted trade (W304), not loss |

## 5. The degradation playbook (alert → policy → machinery)

Four policies; every critical alert is answered by at least one
(`test/policies.test.ts` asserts it), and every machinery seam below is a
real, importable export of the named package — the test imports the real
packages and fails if any seam stops existing (**no dangling references,
fail-closed**). `automation` is the honesty field: nothing in this
repository watches latency and reconfigures the pipeline — the always-on
protections are automatic by construction; everything else is an operator
decision. No automation is invented.

| policyId | triggers | automation | machinery (package:export) |
|---|---|---|---|
| queueing-latency-containment | latency.batch.swm-to-batch.warning, latency.batch.swm-to-batch.critical, latency.batch.batch-queue.warning, latency.batch.batch-queue.critical, latency.batch.w303-schedule.warning, latency.batch.w303-schedule.critical | operator-decision | @sporta/render-orchestration:evaluateStaleSkip, @sporta/render-orchestration:RenderOrchestrator, @sporta/gpu-worker:GpuJobDispatcher, @sporta/gpu-worker:DEFAULT_GPU_LIMITS |
| render-throughput-containment | latency.batch.render-execution.warning, latency.batch.render-execution.critical | operator-decision | @sporta/gpu-worker:DEFAULT_WORKER_RETRY, @sporta/gpu-worker:assertGpuLedgerConsistency, @sporta/contracts:OutputProfile, @sporta/contracts:OutputLatencyClass, @sporta/viewer-shell:deriveRendererOptions |
| emission-and-delivery-containment | latency.batch.finish-to-emit.warning, latency.batch.finish-to-emit.critical, latency.batch.end-to-end.warning, latency.batch.end-to-end.critical, latency.frame.swm-store-sojourn.warning, latency.frame.swm-store-sojourn.critical, latency.frame.end-to-end.warning, latency.frame.end-to-end.critical | operator-decision | @sporta/render-orchestration:DEFAULT_RENDER_LIMITS, @sporta/webrtc-output:answerLiveOutputOffer, @sporta/webrtc-output:LiveOutputRejectionReason, @sporta/viewer-shell:TELEMETRY_EVENT_KINDS |
| frame-loss-triage | loss.unexpected-frames | operator-decision | @sporta/processing-queues:ProcessingPipeline, @sporta/processing-queues:DeadLetterQueue, @sporta/gpu-worker:assertGpuLedgerConsistency, @sporta/render-orchestration:RenderOrchestrator |

The full situation/action text is the code's (`src/policies.ts`, mirrored
into this document by the pin test's id/trigger/machinery columns). In
brief:

1. **queueing-latency-containment** — the queueing stages grow; localize by
   the per-stage verdicts; raise W303 capacity or enable the W304 skip-stale
   degradation (explicit config change; expect the skip counters to move and
   the loss alert to become the trade's honest signal).
2. **render-throughput-containment** — W303 already bounds the damage
   automatically (bounded retry attempts — the shipped default is the frozen
   no-retries posture; non-retryable never blind-retried; retry-exhausted →
   DLQ); if the renderer is simply slow, shed demand via an output profile
   or scale workers. There is NO latency-driven automatic profile downgrade
   — selection is capability/rights-driven (W703).
3. **emission-and-delivery-containment** — triage by the per-stage table;
   delivery is fail-closed: an endpoint that cannot sustain the latency class
   rejects typed (`unsupported-latency-class`), never silently downgrades
   (W305); the viewer-side symptom is W706 `rebuffer-stall` telemetry.
4. **frame-loss-triage** — read the orchestrator's never-silent counters to
   localize the loss path; queue-policy choice is an operator decision; DLQ
   entries triaged by their classification.

## 6. Integration (how this is consumed)

- **The eval-harness case is the objective gate, by pinned equivalence.**
  The W801 suite's `w306-latency-benchmark` case already FAILS on any
  breached SLO candidate (W306 built that gate). The 12 batch objectives
  here are pinned equal to that candidate table (`test/slos.test.ts`), so
  the case verdict **is** an SLO-objective breach gate by construction —
  the objectives cannot drift from the gate without failing suites.
  Deliberately NOT done: re-embedding the SLO table into the harness's
  `measured` — it would duplicate pinned-equal numbers and force a
  `suite-report` schema bump for zero verdict delta (the decision record;
  revisit if W806 wants the compliance report inside the suite report).
- **The package CLI**: `bun run evaluate -- <report.json>` in this package
  evaluates any W306 report file (exit 0 compliant / 1 at-risk / 2
  breached / 3 usage) — the operator surface.
- **W805** (production observability) consumes `ALERT_CATALOG` /
  `DEGRADATION_POLICIES` for dashboards — zero runtime deps beyond zod, so
  no benchmark-graph drag; **W806** reads this document + the package's
  compliance evidence (the real-run test) as the SLO posture.

## 7. Known limitations (honest)

- **The whole document lives in the injected-clock benchmark domain** (§1).
  Real-network/wall-clock thresholds need field measurement — the
  operational gap; nothing here is a production latency claim.
- **One-shot windows only.** No rolling compliance, no burn-rate alerting, no
  paging — those need the W805 telemetry pipeline that does not exist yet.
- **The loss alert is calibrated to the baseline configuration** (block
  backpressure, skip-stale disabled). Under a configured drop-oldest queue,
  `framesDropped > 0` is expected shedding — the alert firing is then the
  shedding's honest signal, not a false positive; under an enabled skip-stale
  policy, skipped-stale frames do not fire it (the deliberate trade).
- **Cancellation is counted as loss** even though a mid-run session stop
  legitimately cancels in-flight work — in the benchmark domain the driver
  never stops mid-run, so any cancellation is structural; a production
  refinement would separate lifecycle cancellation (expected) from
  failure-cancellation (W805 scope).
- **The warning tier is a half-headroom heuristic**, not a measured
  operator-noise calibration — there is no operator-noise data in this
  repository (absent evidence stays absent).
- **The frame-stage objectives were derived by W802's stated rule, not by
  W306's judgment** — same philosophy, but the four frame targets are the
  newest numbers in the chain; they are recomputed-and-pinned by tests, and
  any change must come through a documented threshold change (this file +
  `src/slos.ts` together, the pin test enforcing it).
