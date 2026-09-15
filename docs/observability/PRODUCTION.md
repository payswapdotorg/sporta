# Production observability posture (W805)

Status: implemented by `packages/health` (`@sporta/health`) — the health
domain map, the alert catalog + evaluation engine, the health rollup, and
the dashboard spec + deterministic renderer. Authority: work item W805
("dashboards/alerts cover media, queue, model, renderer, delivery, and
infrastructure health"), built on the W007 observability foundation
([`FOUNDATION.md`](FOUNDATION.md)) and architecture-lock §12.

This document is the normative observability posture. Its tables are
**code-pinned**: `packages/health/test/domains.test.ts` and
`test/alerts.test.ts` parse this document and require it to match
`src/domains.ts` and `src/alerts.ts` row-for-row — a change to either side
without the other fails the suite (the W503 THRESHOLDS.md both-directions
precedent).

## 1. The model — what this honestly is

Sporta today is a deterministic pipeline monorepo with **no deployed
infrastructure**: no Prometheus, no Grafana, no collectors, no metric
exfiltration. Every metric lives in a per-process, in-memory
`MetricsRegistry` (W007). The honest W805 deliverable is therefore the
**definitions and the pure evaluation machinery**, not a running backend:

- the **health domain map** (§2): the audited inventory of every registry
  seam the codebase can emit today, per domain, plus the gaps it cannot;
- the **alert catalog** (§3): 24 machine-readable, zod-validated alert
  definitions over those seams, with documented threshold derivations;
- the **evaluation engine** (§5): pure — (alert, `MetricsSnapshot`) →
  `firing | ok | no-data`;
- the **health rollup** (§6): pure — per-domain health → the overall
  posture, with `unknown` as a first-class status;
- the **dashboard spec + deterministic renderer** (§7): the versioned
  panel description and its byte-stable definition artifact — the
  dashboard-ready shape downstream consumers (the W804 analytics report;
  a future Grafana adapter) build on.

What would be dishonest here is fabricated dashboards or invented
infrastructure; neither exists in this package.

## 2. The health domain map

The map is `HEALTH_DOMAIN_MAP` in `packages/health/src/domains.ts`
(schema version 1; zod-validated). Registry seams are metric names a real
package observes on a `MetricsRegistry`; the metric-name literal is pinned
to the referenced module by test (the map is audit data, never
aspiration). Telemetry seams are non-registry observability surfaces.
Gaps are health facts this codebase cannot emit today — listed, never
invented.

Inventory: **83 registry seams** across the six domains
(media 16, queue 23, model 0, renderer 12, delivery 19, infrastructure 13).

### Domain: media

Source ingestion (W101 fail-closed rights gate), decoding (W102), timeline
synchronization (W103), live-source ingress.

| metric | kind | labels | declared in | emission |
|---|---|---|---|---|
| ingest_accepted | counter | — | @sporta/ingestion src/ingest.ts | once per accepted source (idempotent duplicates included) |
| ingest_rejected_total | counter | failure_class | @sporta/ingestion src/ingest.ts | once per rejected source — the fail-closed W101 gate |
| decode_frames_total | counter | — | @sporta/decoding src/service.ts | once per yielded normalized video frame |
| decode_audio_chunks_total | counter | — | @sporta/decoding src/service.ts | once per yielded normalized audio chunk |
| decode_bytes_total | counter | — | @sporta/decoding src/service.ts | incremented by yielded item byte size |
| decode_failures_total | counter | — | @sporta/decoding src/service.ts | once per classified decode/probe refusal |
| timeline_sync_alignments_total | counter | — | @sporta/timeline src/sync.ts | once per successful track-timeline alignment |
| timeline_sync_failures_total | counter | — | @sporta/timeline src/sync.ts | once per classified alignment refusal |
| streaming_segments_in_total | counter | — | @sporta/streaming-ingress src/types.ts | once per live-source delivery received |
| streaming_segments_out_total | counter | — | @sporta/streaming-ingress src/types.ts | once per segment admitted to the output channel |
| streaming_rejected_total | counter | failure_class | @sporta/streaming-ingress src/types.ts | once per refused delivery (rights-denied included) |
| streaming_duplicate_segments_total | counter | — | @sporta/streaming-ingress src/types.ts | once per idempotent duplicate re-delivery |
| streaming_abandoned_segments_total | counter | reason | @sporta/streaming-ingress src/types.ts | once per segment abandoned at shutdown |
| streaming_backpressure_events_total | counter | — | @sporta/streaming-ingress src/types.ts | once per backpressure refusal event (a W104 policy action) |
| streaming_arrival_lag_ms | histogram | — | @sporta/streaming-ingress src/types.ts | measured arrival lag per accepted segment |
| streaming_send_wait_ms | histogram | — | @sporta/streaming-ingress src/types.ts | output-send wait per accepted segment |

#### Telemetry seams — media

None — every media-domain fact above is a registry series.

#### Known gaps — media

| gap | title | detail |
|---|---|---|
| media-asr-no-metrics | ASR emits no observability seams | packages/asr (W207) has no observability dependency and no counters or histograms — transcription failures/latency are uncounted at runtime; model-quality evidence exists only in the offline eval-harness. |
| media-fusion-no-metrics | Event fusion emits no observability seams | packages/fusion (W204) emits nothing to a registry; fusion outcomes (promotions, conflicts, confidence rejections) are uncounted at runtime. |

### Domain: queue

Processing-queues (W302) segment accounting + DLQ; gpu-worker (W303) job
admission, duplicate dedupe, retry/DLQ accounting, ready-queue congestion.

| metric | kind | labels | declared in | emission |
|---|---|---|---|---|
| processing_segments_in_total | counter | — | @sporta/processing-queues src/types.ts | once per accounted submit attempt (pipeline.ts) |
| processing_segments_out_total | counter | — | @sporta/processing-queues src/types.ts | once per segment admitted to the output queue (pipeline.ts) |
| processing_rejected_total | counter | failure_class | @sporta/processing-queues src/types.ts | once per refused attempt (pipeline.ts) — includes W104 backpressure policy actions |
| processing_duplicate_segments_total | counter | — | @sporta/processing-queues src/types.ts | once per idempotent duplicate submission (pipeline.ts) |
| processing_dead_lettered_total | counter | — | @sporta/processing-queues src/types.ts | once per terminally failed segment (dlq.ts) |
| processing_abandoned_segments_total | counter | reason | @sporta/processing-queues src/types.ts | once per segment abandoned at shutdown (pipeline.ts) |
| processing_dlq_entries_total | counter | terminal | @sporta/processing-queues src/types.ts | once per retained + overflowed DLQ entry (dlq.ts) |
| processing_retries_total | counter | stage | @sporta/processing-queues src/types.ts | once per retry attempt consumed (pipeline.ts) |
| processing_checkpoints_total | counter | — | @sporta/processing-queues src/types.ts | once per checkpoint cut (pipeline.ts) |
| processing_stage_latency_ms | histogram | — | @sporta/processing-queues src/types.ts | per-stage summed handler latency per segment (pipeline.ts) |
| gpu_jobs_submitted_total | counter | — | @sporta/gpu-worker src/types.ts | once per accounted job submission (dispatcher.ts) |
| gpu_jobs_admitted_total | counter | — | @sporta/gpu-worker src/types.ts | once per admission past resource checks (dispatcher.ts) |
| gpu_duplicate_jobs_total | counter | — | @sporta/gpu-worker src/types.ts | once per idempotency-key duplicate — counted, never double-run (dispatcher.ts) |
| gpu_jobs_succeeded_total | counter | — | @sporta/gpu-worker src/types.ts | once per succeeded job (dispatcher.ts) |
| gpu_jobs_failed_total | counter | — | @sporta/gpu-worker src/types.ts | once per terminally failed job (dispatcher.ts) |
| gpu_jobs_cancelled_total | counter | — | @sporta/gpu-worker src/types.ts | once per accounted cancellation (dispatcher.ts) |
| gpu_jobs_dead_lettered_total | counter | — | @sporta/gpu-worker src/types.ts | once per job dead-lettered after bounded attempts (dlq.ts) |
| gpu_dlq_entries_total | counter | terminal | @sporta/gpu-worker src/types.ts | once per DLQ entry, labeled terminal (dlq.ts) |
| gpu_malformed_submissions_total | counter | — | @sporta/gpu-worker src/types.ts | once per structurally invalid submission envelope (dispatcher.ts) |
| gpu_refused_submissions_total | counter | — | @sporta/gpu-worker src/types.ts | once per refused submission — malformed, over-capacity, or dispatcher-ended (dispatcher.ts) |
| gpu_job_claims_total | counter | — | @sporta/gpu-worker src/types.ts | once per job claim by a worker (dispatcher.ts) |
| gpu_job_requeues_total | counter | — | @sporta/gpu-worker src/types.ts | once per lease-expired requeue (dispatcher.ts) |
| gpu_job_queue_wait_ms | histogram | — | @sporta/gpu-worker src/types.ts | startedAtMs − submittedAtMs per finished job — the W303 ready-queue wait (dispatcher.ts) |

#### Telemetry seams — queue

None.

#### Known gaps — queue

| gap | title | detail |
|---|---|---|
| queue-depth-not-on-registry | Queue depth has no registry series | architecture-lock §12 lists queue depth, but no package observes a queue_depth series on a MetricsRegistry: W302 exposes depths via PipelineStats.queueDepths (a result snapshot, not a registry series) and W305 via the live_output_link_depth histogram. The registry has no gauge kind — an in-flight depth is not alertable from a snapshot today. |
| queue-rejections-not-alertable | Rejection counters include normal policy actions | processing_rejected_total and streaming_backpressure_events_total count W104 backpressure refusals, which are normal policy behavior under burst — a zero-tolerance alert would fire on healthy runs, so no alert is defined on them (see §4). |

### Domain: model

Perception (detection/tracking), ball state, field mapping, spatial state,
event fusion, world-model corrections, commentary understanding — runtime
model behavior.

**No registry seams exist.** The model domain is the honest hole in the
runtime posture: until packages emit seams, this domain's health is
`unknown` by construction — never silently healthy (§6).

#### Telemetry seams — model

None.

#### Known gaps — model

| gap | title | detail |
|---|---|---|
| model-no-runtime-seams | No model-domain package emits any observability seam | world-model, observation, perception-detection, perception-tracking, ball-tracking, ball-state, field-mapping, spatial-state, fusion, and commentary-segmentation/understanding carry no observability dependency and emit zero counters/histograms — world-model corrections, perception coverage, and event-quality facts cannot be observed at runtime. |
| model-quality-offline-only | Model quality is offline-evidence only | score/clock correctness, identity continuity, and scene correctness are measured by the eval-harness suite (W801: detection-proof, W601 scene, W306 latency) and the W605 3D-output evaluation — verdicts at benchmark time, not runtime registry series. |

### Domain: renderer

Renderer plugin failures (W501 contract, W502 anime, W601/W603 3D),
render-orchestration batch accounting + skip-stale + budget policies
(W304), render-job round-trip latency (W303).

| metric | kind | labels | declared in | emission |
|---|---|---|---|---|
| render_requests_total | counter | rendererId | @sporta/renderer-contract src/reference/test-card.ts; @sporta/renderer-anime src/plugin.ts; @sporta/renderer-3d src/plugin.ts | once per render call, labeled rendererId (inline literal at each plugin) |
| render_failures_total | counter | rendererId | @sporta/renderer-contract src/reference/test-card.ts; @sporta/renderer-anime src/plugin.ts; @sporta/renderer-3d src/plugin.ts | once per failed render call — typed, never silent |
| render_batches_in_total | counter | — | @sporta/render-orchestration src/types.ts | once per batch admitted to rendering (orchestrator.ts) |
| render_batches_skipped_stale_total | counter | phase | @sporta/render-orchestration src/types.ts | once per batch skipped by the stale policy, labeled admission\|dequeue (orchestrator.ts) |
| render_batches_dropped_total | counter | reason | @sporta/render-orchestration src/types.ts | once per dropped batch, labeled BatchDropReason — includes admitted-budget exhaustion via queue-evicted/exceeds-byte-budget (orchestrator.ts) |
| render_batches_cancelled_total | counter | — | @sporta/render-orchestration src/types.ts | once per cancelled batch (orchestrator.ts) |
| render_batches_duplicate_total | counter | — | @sporta/render-orchestration src/types.ts | once per same-watermark duplicate batch — counted, never double-executed (orchestrator.ts) |
| render_outputs_emitted_total | counter | — | @sporta/render-orchestration src/types.ts | once per ordered output emission (orchestrator.ts) |
| render_checkpoints_cut_total | counter | — | @sporta/render-orchestration src/types.ts | once per watermark-boundary checkpoint (orchestrator.ts) |
| render_consumer_park_attempts_total | counter | — | @sporta/render-orchestration src/types.ts | once per consumer park attempt at settle (orchestrator.ts) |
| render_watermark_lag_at_emission_ms | histogram | — | @sporta/render-orchestration src/types.ts | watermark lag observed at output emission (orchestrator.ts) |
| gpu_job_latency_ms | histogram | — | @sporta/gpu-worker src/types.ts | finishedAtMs − submittedAtMs per finished render job = ready-queue wait + execution (dispatcher.ts) |

#### Telemetry seams — renderer

None.

#### Known gaps — renderer

| gap | title | detail |
|---|---|---|
| renderer-rendered-total-unemitted | render_batches_rendered_total is declared but never observed | RENDER_METRIC_NAMES.batchesRendered exists in the W304 vocabulary but the orchestrator only counts rendered batches in its ledger — no registry series is observed. Dashboards/alerts must not read it. |

### Domain: delivery

Live output accounting + session phase machine (W305), viewer session
consumption (W704 playback), viewer telemetry (W706).

| metric | kind | labels | declared in | emission |
|---|---|---|---|---|
| live_output_windows_in_total | counter | outcome | @sporta/webrtc-output src/types.ts | once per window admitted or rejected-invalid (transport.ts) |
| live_output_windows_delivered_total | counter | — | @sporta/webrtc-output src/types.ts | once per verified window hand-over (transport.ts) |
| live_output_windows_skipped_stale_total | counter | at | @sporta/webrtc-output src/types.ts | once per skip-stale window, labeled admission\|dequeue (transport.ts) |
| live_output_windows_dropped_by_policy_total | counter | at | @sporta/webrtc-output src/types.ts | once per policy drop (incoming admission or eviction) (transport.ts) |
| live_output_windows_refused_total | counter | — | @sporta/webrtc-output src/types.ts | once per typed no-downgrade refusal — protocol/codec/latency protection (transport.ts) |
| live_output_windows_abandoned_total | counter | reason | @sporta/webrtc-output src/types.ts | once per window abandoned at close/cancel (transport.ts) |
| live_output_windows_failed_total | counter | — | @sporta/webrtc-output src/types.ts | once per send failure — terminal; session ends failed (transport.ts) |
| live_output_windows_redelivered_total | counter | — | @sporta/webrtc-output src/types.ts | once per retention replay delivery (transport.ts) |
| live_output_windows_skipped_at_reconnect_total | counter | — | @sporta/webrtc-output src/types.ts | once per window lost to a reconnect gap (transport.ts) |
| live_output_viewer_reconnects_total | counter | event | @sporta/webrtc-output src/types.ts | once per viewer disconnect/reconnect event (transport.ts) |
| live_output_state_transitions_total | counter | from, to | @sporta/webrtc-output src/types.ts | once per legal session phase transition (state.ts) |
| live_output_session_ends_total | counter | outcome | @sporta/webrtc-output src/types.ts | once per session end, labeled outcome incl. failed (transport.ts) |
| live_output_viewer_windows_applied_total | counter | — | @sporta/webrtc-output src/types.ts | once per window applied by the viewer session (viewer.ts) |
| live_output_viewer_windows_duplicate_total | counter | — | @sporta/webrtc-output src/types.ts | once per duplicate window seen by the viewer (viewer.ts) |
| live_output_viewer_windows_skipped_total | counter | — | @sporta/webrtc-output src/types.ts | once per window skipped by viewer catch-up (viewer.ts) |
| live_output_transit_lag_ms | histogram | — | @sporta/webrtc-output src/types.ts | deliveredAtMs − admittedAtMs per delivered window (transport.ts) |
| live_output_delivery_lag_ms | histogram | — | @sporta/webrtc-output src/types.ts | deliveredAtMs − emittedAtMs per delivered window (transport.ts) |
| live_output_watermark_lag_at_delivery_ms | histogram | — | @sporta/webrtc-output src/types.ts | media-time lag at delivery (transport.ts) |
| live_output_link_depth | histogram | — | @sporta/webrtc-output src/types.ts | queued windows at emission time (transport.ts) |

#### Telemetry seams — delivery

| seam | kind | package | module | carries |
|---|---|---|---|---|
| live window timing records | timing-record | @sporta/webrtc-output | src/telemetry.ts | per-window typed timing records (LiveWindowTimingRecord / LiveViewerArrivalRecord) on the injected clock domain — the W306 measurement seam; carried in the settle result, not a registry series |
| viewer telemetry events (schema v1) | event-sink | @sporta/viewer-shell | src/telemetry-events.ts | six closed event kinds (state-transition, operation-timing, error-occurred, rebuffer-stall, integrity-verified, user-feedback) with exact-key privacy allowlists; sinks: in-memory, node JSONL file, dev HTTP bridge |

#### Known gaps — delivery

| gap | title | detail |
|---|---|---|
| delivery-no-real-network | Lag histograms measure the in-process transport seam | W305 has no real RTCPeerConnection/network ICE/STUN path: transit/delivery lag characterize the in-process binding seam, not real-network latency — the same boundary W306 states. |
| delivery-no-latency-threshold-evidence | No honest threshold exists for delivery-lag alerts | W306's controlled-fixture evidence covers pipeline stages, not the W305 transport lag histograms; a delivery-lag threshold today would be invented evidence. W802 owns threshold setting on these seams. |
| delivery-viewer-paint-open | Real-browser paint E2E remains open | W706 delivered the telemetry model, not a real-browser paint E2E (documented open); viewer telemetry carries no rendererHealth fact. |

### Domain: infrastructure

GPU-worker process liveness (W303 heartbeats/leases/timeouts), clock
health (W103 drift clamp), control plane (W701), stage transport (W104).

| metric | kind | labels | declared in | emission |
|---|---|---|---|---|
| gpu_worker_heartbeats_total | counter | — | @sporta/gpu-worker src/types.ts | once per worker heartbeat accepted (dispatcher.ts) |
| gpu_worker_heartbeats_rejected_total | counter | reason | @sporta/gpu-worker src/types.ts | once per rejected heartbeat — dispatcher-ended, unknown-worker, sequence-not-monotone (dispatcher.ts) |
| gpu_stale_workers_total | counter | — | @sporta/gpu-worker src/types.ts | once per staleness detection — a worker went silent (dispatcher.ts) |
| gpu_lease_expiries_total | counter | — | @sporta/gpu-worker src/types.ts | once per lease expiry — worker stopped heartbeating mid-job; jobs requeued, never silently reassigned (dispatcher.ts) |
| gpu_late_results_total | counter | — | @sporta/gpu-worker src/types.ts | once per result arriving after its job was superseded (dispatcher.ts) |
| gpu_job_timeouts_total | counter | kind | @sporta/gpu-worker src/types.ts | once per per-job deadline breach on the injected clock, labeled timeout kind (dispatcher.ts) |
| timeline_sync_drift_anomalies_total | counter | — | @sporta/timeline src/sync.ts | once per clamped drift anomaly — |driftPpm| exceeded DRIFT_CLAMP_PPM (1000), the clock-health signal |
| timeline_sync_abs_drift_ppm | histogram | — | @sporta/timeline src/sync.ts | clamped |driftPpm| observed once per measured alignment |
| control_requests_total | counter | route | @sporta/control-api src/app.ts; @sporta/control-api src/http.ts | once per control-plane method call, labeled route |
| control_failures_total | counter | failure_class | @sporta/control-api src/app.ts; @sporta/control-api src/http.ts | once per failed control-plane call, labeled failure class |
| transport_messages_total | counter | stage, status | @sporta/transport src/runner.ts | once per stage-message processed, labeled stage + status |
| transport_retries_total | counter | stage | @sporta/transport src/runner.ts | summed retries consumed per stage-message |
| transport_failures_total | counter | stage, errorClass | @sporta/transport src/runner.ts | once per retry-exhausted stage-message failure |

#### Telemetry seams — infrastructure

| seam | kind | package | module | carries |
|---|---|---|---|---|
| gpu worker heartbeat advisory load | advisory-field | @sporta/gpu-worker | src/types.ts | GpuHeartbeat.inFlight + advisoryMemoryInUseMb — advisory load telemetry derived from in-flight job requirements, never measured; travels in heartbeat records, not on the registry (not alertable from a MetricsSnapshot) |

#### Known gaps — infrastructure

| gap | title | detail |
|---|---|---|
| infra-no-memory-series | No measured memory-pressure metric exists | Audited: no package observes a memory/RSS/heap registry series. The only memory signal is the advisory GpuHeartbeat.advisoryMemoryInUseMb (derived from job requirements, never measured). Real memory-pressure telemetry is an ops backlog item — no alert is defined (an honest threshold needs a real measurement first). |
| infra-registry-in-memory | The metrics registry is per-process and in-memory | @sporta/observability's MetricsRegistry (W007) keeps every series in one process with no cross-process aggregation, persistence, or exposition endpoint — collection, transport, and backend storage are deployment concerns (ops' world), documented as this package's boundary, not implemented here. |
| infra-liveness-gpu-only | Process liveness exists only for gpu workers | The heartbeat/lease machinery (W303) is the codebase's only liveness seam, and it covers gpu workers only — the control-api host, viewer host, and pipeline stages have no liveness heartbeat; their 'down' state is unobservable from within. |

## 3. The alert catalog

`ALERT_CATALOG` in `packages/health/src/alerts.ts` (schema version 1;
zod-validated). Every alert is cross-checked fail-closed against the
domain map (`checkAlertCatalog`): an alert referencing a non-existent
metric, or a histogram expression on a counter seam, throws — the W802
mapping-consistency precedent. Each alert's runbook is a section in §10.

### The catalog table

| id | domain | severity | expression |
|---|---|---|---|
| media-ingest-rejections | media | warning | ingest_rejected_total > 0 |
| media-decode-failures | media | warning | decode_failures_total > 0 |
| media-timeline-sync-failures | media | warning | timeline_sync_failures_total > 0 |
| queue-processing-dlq | queue | warning | processing_dead_lettered_total > 0 |
| queue-gpu-dlq | queue | warning | gpu_jobs_dead_lettered_total > 0 |
| queue-gpu-refused-submissions | queue | warning | gpu_refused_submissions_total > 0 |
| queue-gpu-queue-wait-p95 | queue | warning | gpu_job_queue_wait_ms p95 > 6000 |
| renderer-failures | renderer | warning | render_failures_total > 0 |
| renderer-batches-dropped | renderer | warning | render_batches_dropped_total > 0 |
| renderer-skip-stale-degradation | renderer | warning | render_batches_skipped_stale_total > 0 |
| renderer-gpu-job-latency-p95 | renderer | warning | gpu_job_latency_ms p95 > 7000 |
| delivery-windows-failed | delivery | critical | live_output_windows_failed_total > 0 |
| delivery-windows-dropped | delivery | warning | live_output_windows_dropped_by_policy_total > 0 |
| delivery-windows-refused | delivery | warning | live_output_windows_refused_total > 0 |
| delivery-skipped-at-reconnect | delivery | warning | live_output_windows_skipped_at_reconnect_total > 0 |
| delivery-skip-stale-degradation | delivery | warning | live_output_windows_skipped_stale_total > 0 |
| infra-gpu-heartbeat-rejects | infrastructure | warning | gpu_worker_heartbeats_rejected_total > 0 |
| infra-gpu-lease-expiries | infrastructure | warning | gpu_lease_expiries_total > 0 |
| infra-gpu-stale-workers | infrastructure | warning | gpu_stale_workers_total > 0 |
| infra-gpu-late-results | infrastructure | warning | gpu_late_results_total > 0 |
| infra-gpu-job-timeouts | infrastructure | warning | gpu_job_timeouts_total > 0 |
| infra-clock-drift-anomalies | infrastructure | warning | timeline_sync_drift_anomalies_total > 0 |
| infra-control-failures | infrastructure | warning | control_failures_total > 0 |
| infra-transport-failures | infrastructure | warning | transport_failures_total > 0 |

The model domain has **zero alerts** — its registry seams do not exist
(§2's model gaps); no alert can honestly be defined, and the domain
reports `unknown`.

## 4. Threshold derivation policy

1. **Zero-tolerance counters for never-normal conditions.** Most alerts
   fire on `> 0` over a counter whose nonzero value is, by the emitting
   code's own never-silent design, a visible incident (a dead-lettered
   job, a rejected heartbeat, a typed render failure). This is a
   derivation from code semantics, not a tuned number — the same posture
   as W503's zero-defect thresholds for deterministic renderers.
2. **Latency thresholds only where W306 measured evidence exists.** The
   two percentile alerts carry thresholds derived from the W306
   controlled-fixture run in the **injected-clock domain** (see the
   derivations in `src/alerts.ts`): `gpu_job_queue_wait_ms` p95 target
   6000 ms (measured p95 4000 ms, the suite's identified congestion point,
   ~1.5× headroom) and `gpu_job_latency_ms` p95 target 7000 ms (the sum
   of the two W306 candidate components: w303-schedule 6000 +
   render-execution 1000, each already headroomed). These characterize
   the pipeline's ALGORITHMIC latency structure, not wall-clock SLOs.
3. **Metric-generic seams for W802.** The latency alerts reference
   metric names only, never the sibling SLO package's internals — W802
   (in flight, a sibling work item) formalizes SLOs and its thresholds
   slot onto the same seams, replacing these interim candidates.
4. **No alert without a real seam.** Rejection counters that include
   normal W104 backpressure policy actions
   (`processing_rejected_total`, `streaming_backpressure_events_total`)
   deliberately carry no zero-tolerance alert: they fire on healthy
   burst runs. Delivery-lag histograms carry no alert: no controlled
   evidence exists for their thresholds (gap
   `delivery-no-latency-threshold-evidence`).
5. **Firing is strictly-above.** An at-threshold reading is `ok` (pinned
   by boundary tests) — a threshold is a ceiling, not a cliff edge.

## 5. Evaluation semantics

`evaluateAlert(alert, snapshot)` / `evaluateCatalog(catalog, snapshot)` in
`packages/health/src/evaluate.ts` — pure, deterministic, no clocks, no
randomness; the snapshot shape is exactly `MetricsRegistry.snapshot()`
from `@sporta/observability`.

- **counter-above** — all label series of the counter are SUMMED (a
  rejection is a rejection whatever its failure_class), then compared
  strictly above the threshold.
- **counter-ratio-above** — numerator and denominator each summed; a zero
  denominator is `no-data` (an undefined ratio is not a healthy zero).
- **histogram-p95-above / p50** — the named histogram's nearest-rank p95
  (or p50); a histogram with zero observations is `no-data`.
- **no-data** — the metric is absent from the snapshot, or one of the
  above. Absence of evidence is not health: `no-data` never becomes `ok`,
  and the rollup (§6) propagates it as `unknown`. This is the
  never-silent posture applied to observability itself.

## 6. The health rollup

`domainHealthFromVerdicts` and `rollupHealth` in
`packages/health/src/rollup.ts` — pure functions; `postureFromSnapshot`
is the one-call pipeline (evaluate → per-domain → overall).

Domain health from its alert verdicts (the truth table, test-pinned):

| critical firing | warning firing | no-data present | domain status |
|---|---|---|---|
| yes | any | any | down |
| no | yes | any | degraded |
| no | no | yes | unknown |
| no | no | no | healthy |

An empty verdict list (no alerts evaluated — the model domain today) is
`unknown` with an honest reason.

The overall posture takes the WORST domain, worst-first lattice:

```
down > degraded > unknown > healthy
```

`unknown` outranks `healthy` deliberately: a domain whose health cannot
be observed can never contribute to an overall `healthy` verdict — five
healthy domains plus the seam-less model domain roll up to `unknown`, not
healthy. `rollupHealth` requires exactly the six domains (missing,
duplicated, or foreign domains throw — fail-closed, never guessed).

## 7. Dashboards

The dashboard spec (`packages/health/src/dashboard.ts`, schema version 1)
is a versioned, zod-validated panel description; the shipped
`PRODUCTION_DASHBOARD` covers all six domains: five metric panels (one
per seam-bearing domain) plus one health panel per domain (the model
panel renders the rollup status and says UNKNOWN — never a fabricated
number).

`renderDashboardDefinition(spec, map)` resolves every panel query against
the domain map (fail-closed: unknown metric, or a stat asked of the wrong
series kind, throws — an empty panel is never rendered) and emits the
definition artifact — self-contained, with seam provenance (package +
module + labels) embedded per query. `renderDashboardDefinitionJson`
serializes it canonically (sorted keys): **byte-stable** — the same spec
always renders to identical bytes, regardless of how the spec object was
constructed (test-pinned). `renderDashboardMarkdown` renders the
human-readable form, deterministically.

This artifact is the dashboard-ready shape downstream consumers reference
(the W804 analytics report's dashboard seam; a future Grafana adapter over
the same spec). There is no web UI and no SVG — deliberately.

## 8. Infrastructure health

What exists, honestly:

- **Process liveness** — the W303 gpu-worker protocol: heartbeats with
  monotone sequences, lease renewal, staleness detection, lease-expiry
  requeue (never silent reassignment). Alerted via
  `infra-gpu-heartbeat-rejects`, `infra-gpu-lease-expiries`,
  `infra-gpu-stale-workers` (plus the DLQ/requeue accounting counters in
  the queue domain). No other process has a liveness seam (gap
  `infra-liveness-gpu-only`).
- **Clock health** — everything runs on injected clocks (the repo-wide
  constitution); the one runtime clock-health fact is the W103 drift
  clamp: `timeline_sync_drift_anomalies_total` counts clamped
  measurements and `timeline_sync_abs_drift_ppm` histograms the clamped
  drift. Alerted via `infra-clock-drift-anomalies`.
- **Memory pressure** — no real counter exists anywhere (gap
  `infra-no-memory-series`); the only signal is the ADVISORY
  `GpuHeartbeat.advisoryMemoryInUseMb` (derived from job requirements,
  never measured). No alert is defined — an honest threshold needs a real
  measurement first.
- **Control plane and transport health** — W701 control-plane
  request/failure counters and W104 stage-message transport counters,
  alerted via `infra-control-failures` / `infra-transport-failures`.

## 9. Honest boundaries

- **No deployed infrastructure.** No Prometheus/Grafana/collector exists
  in this repo; the registry is per-process in-memory (W007's documented
  limitation). Deployment, metric collection, cross-process aggregation,
  exposition, and exfil are ops' world — this package provides the
  definitions and the pure machinery they would evaluate.
- **Latency alerts are algorithmic, not wall-clock.** The two percentile
  thresholds derive from W306's controlled fixture in the injected-clock
  domain — they characterize the pipeline's algorithmic latency
  structure, the same boundary W305/W306 document; real-network SLOs are
  not claimed.
- **SLO formalization is W802's.** The latency alerts here are interim
  W306-derived candidates on metric-generic seams; the sibling W802 work
  item owns the formal SLO/threshold/degradation policy layer.
- **The model domain is unobservable at runtime.** Zero seams exist
  (§2); its health is `unknown` by construction and the rollup says so —
  adding model-domain seams is the single biggest observability
  improvement available.
- **Viewer telemetry is not a registry.** W706's event model is a separate
  sink (JSONL file / dev HTTP bridge) — listed as a telemetry seam, not
  alertable from a `MetricsSnapshot`.

## 10. Runbooks

One runbook per alert, in catalog order. Each is reachable at
`#runbook-<alert-id>`.

### Runbook: media-ingest-rejections

`ingest_rejected_total > 0` (warning). A source was rejected at intake —
check the structured logs for the failure_class: `rights-denied` means
the fail-closed W101 rights gate refused the source (verify the rights
policy and the source's entitlement); malformed/checksum classes mean a
corrupt or mislabelled upload. The counter is per accepted-AND-rejected
submission set — correlate with `sessionId` in the logs. Nothing was
silently dropped: the gate is fail-closed by design.

### Runbook: media-decode-failures

`decode_failures_total > 0` (warning). A decode or probe refusal — W102
classifies every refusal (container sniffing, policy envelope, decode
error). Check logs for the classified reason and the source id; the
decoder never silently skips. If probe policy refusals dominate, review
the policy-in-service envelope configuration.

### Runbook: media-timeline-sync-failures

`timeline_sync_failures_total > 0` (warning). W103's `align()` refused to
place a session's tracks on the canonical timeline. Check the logs for
the classified refusal reason (missing timing summaries, unmeasurable
drift). The session cannot be timeline-synced — treat as a media-input
incident, not a load incident.

### Runbook: queue-processing-dlq

`processing_dead_lettered_total > 0` (warning). A segment terminally
failed after bounded retries (W302/W104 rules). Inspect the DLQ entries
(their errorClass and message travel with the dead-letter record);
reprocess deliberately — the DLQ never blind-retries. Balance identity:
segmentsIn = segmentsOut + rejected + duplicates + deadLettered +
abandoned + dropped (asserted at settle).

### Runbook: queue-gpu-dlq

`gpu_jobs_dead_lettered_total > 0` (warning). A render job terminally
failed in the W303 protocol after bounded attempts. Inspect the job
envelope's failure class in the ledger; non-retryable failures are never
blind-retried. Frequent occurrences point at renderer defects (see
`renderer-failures`) or worker starvation (see
`infra-gpu-lease-expiries`).

### Runbook: queue-gpu-refused-submissions

`gpu_refused_submissions_total > 0` (warning). The dispatcher refused a
submission: malformed envelope, over-capacity admission, or
dispatcher-ended. Malformed submissions indicate a producer bug;
over-capacity indicates the fleet is saturated (compare
`gpu_jobs_admitted_total` against configured capacity) — scale or shed
load.

### Runbook: queue-gpu-queue-wait-p95

`gpu_job_queue_wait_ms` p95 > 6000 (warning). The W303 ready queue — the
W306-measured congestion point — is waiting longer than the W306-derived
candidate target. Check `gpu_job_queue_wait_ms` p50 vs p95 (a high p95
with low p50 = bursty arrival; both high = sustained saturation), and
`gpu_job_requeues_total` (lease churn amplifies queue wait). Threshold
derivation: W306 §Interpretation + the SLO candidate table; W802 owns the
formalized SLO that replaces this interim threshold.

### Runbook: renderer-failures

`render_failures_total > 0` (warning). A renderer plugin failed a render
call — typed, never silent. Identify the renderer by the `rendererId`
label; check the W501 conformance failure class in the logs. A
deterministic renderer has no innocent failure: treat as a renderer
defect or a contract breach (R-rule violation) in the input.

### Runbook: renderer-batches-dropped

`render_batches_dropped_total > 0` (warning). W304 dropped a batch with a
labeled reason. `queue-evicted`/`exceeds-byte-budget` = capacity or
admitted-budget exhaustion (review channel capacity and byte budget);
`reorder-overflow` = the reorder window overflowed (upstream latency
spike); `render-failed`/`render-output-invalid` = renderer defects;
`queue-refused` = downstream backpressure. Every drop is accounted —
reconcile with the ledger.

### Runbook: renderer-skip-stale-degradation

`render_batches_skipped_stale_total > 0` (warning). The skip-stale policy
dropped stale batches (labeled admission or dequeue phase). By the W305
phase machine's own semantics, any skip-stale is degradation. If
admission-phase dominates, the batch watermark is behind before entry
(check upstream `swm-to-batch` latencies in the W306 report); dequeue
phase points at consumer slowness.

### Runbook: renderer-gpu-job-latency-p95

`gpu_job_latency_ms` p95 > 7000 (warning). The render-job round trip
(ready-queue wait + execution) exceeded the sum of the two W306 candidate
budgets. Triage with `queue-gpu-queue-wait-p95`: if queue wait is
healthy, execution time regressed (check renderer changes); if queue wait
is also high, it is fleet congestion. Threshold: W306 candidates
(w303-schedule 6000 + render-execution 1000), injected-clock domain;
W802's formalized SLO supersedes.

### Runbook: delivery-windows-failed

`live_output_windows_failed_total > 0` (**critical**). A window send
failed terminally and the session ended failed — rendered output was lost
to the viewer. This is the only critical alert: direct user-facing loss.
Check the W305 failure class in the logs (transport seam errors), the
session's settle result (its accounting is exact), and the viewer
telemetry for the reconnect story. Treat as an outage-level incident for
the affected session.

### Runbook: delivery-windows-dropped

`live_output_windows_dropped_by_policy_total > 0` (warning). The capacity
policy dropped a window at admission or eviction (labeled `at`). Eviction
dominance means the link depth exceeded the retention budget — the
consumer is not draining; review the retention window and the consumer's
drain rate. Accounting is exact: check the settle result's ledger.

### Runbook: delivery-windows-refused

`live_output_windows_refused_total > 0` (warning). The transport's typed
no-downgrade protections refused a window (protocol/codec/latency). The
transport refused to degrade silently — inspect the refusal's typed
reason in the logs and reconcile the offer grammar parameters between
producer and consumer.

### Runbook: delivery-skipped-at-reconnect

`live_output_windows_skipped_at_reconnect_total > 0` (warning). A viewer
reconnect cost windows (the gap's unshipped windows are skipped). One
occurrence per reconnect episode is expected under instability; sustained
occurrences mean the reconnect path is losing the buffer faster than it
replays — check `live_output_viewer_reconnects_total` and the W704
backoff behavior.

### Runbook: delivery-skip-stale-degradation

`live_output_windows_skipped_stale_total > 0` (warning). The delivery
side of the skip-stale degradation: windows were skipped past the stale
bound (labeled admission/dequeue). The W305 phase machine entered
`degraded`; recovery requires a subsequent in-bound delivery. Check
upstream emission lags (`render_watermark_lag_at_emission_ms`).

### Runbook: infra-gpu-heartbeat-rejects

`gpu_worker_heartbeats_rejected_total > 0` (warning). A worker heartbeat
was rejected for a protocol violation — `dispatcher-ended` (shutdown
race), `unknown-worker` (registration loss), or `sequence-not-monotone`
(a worker emitting non-monotone sequences — a worker-side bug). The
reason label identifies which. Non-shutdown rejects are worker-protocol
defects: capture the worker logs.

### Runbook: infra-gpu-lease-expiries

`gpu_lease_expiries_total > 0` (warning). A worker stopped heartbeating
mid-job and its lease expired. Jobs were requeued and counted (never
silently reassigned). One expiry = one dead/hung worker process — check
process liveness of the fleet, memory pressure (advisory heartbeat
field), and correlate with `infra-gpu-stale-workers`.

### Runbook: infra-gpu-stale-workers

`gpu_stale_workers_total > 0` (warning). Staleness detection fired: a
registered worker went silent past its horizon. Its in-flight jobs were
failed loud with timeout classification. The worker process is dead or
hung — verify fleet process state; if the process lives, it is a
heartbeat-loop bug (correlate with `infra-gpu-heartbeat-rejects`).

### Runbook: infra-gpu-late-results

`gpu_late_results_total > 0` (warning). A result arrived after its job
was superseded (requeued past max attempts, then reported; or reported
after cancellation). Occasional occurrences follow lease churn; sustained
occurrences indicate clock/lease skew or workers reporting past their
deadline — check deadline configuration vs execution time.

### Runbook: infra-gpu-job-timeouts

`gpu_job_timeouts_total > 0` (warning). Per-job deadline breaches on the
injected clock (labeled timeout kind). The fleet is not meeting the
configured deadline budget: either raise the budget (a product decision)
or find the execution regression (correlate with
`renderer-gpu-job-latency-p95` and `queue-gpu-queue-wait-p95`).

### Runbook: infra-clock-drift-anomalies

`timeline_sync_drift_anomalies_total > 0` (warning). A track's timestamp
drift was clamped at 1000 ppm (DRIFT_CLAMP_PPM) — the clocks diverged
beyond the physical bound the synchronizer honors. Check
`timeline_sync_abs_drift_ppm` histogram values: clamped measurements
mean the media timestamps are implausible (upstream capture or remux
issue), not that the pipeline is slow.

### Runbook: infra-control-failures

`control_failures_total > 0` (warning). A control-plane method call
failed (labeled failure class; route-labeled totals stay separate).
Check the control-api logs for the class: session-not-found and
validation classes are caller bugs; internal classes are host defects.

### Runbook: infra-transport-failures

`transport_failures_total > 0` (warning). A stage message exhausted its
declared retry budget (labeled stage + errorClass). Stages declare
retry semantics explicitly — a failure here is terminal for that message
under its stage's policy. Check the errorClass distribution by stage;
systematic single-stage failures point at that stage's handler.
