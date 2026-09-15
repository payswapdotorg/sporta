/**
 * The ALERT CATALOG (W805) — machine-readable, zod-validated, versioned.
 *
 * Every alert is defined over a REGISTRY SEAM named in the health domain
 * map (consistency-checked fail-closed by `consistency.ts`: an alert that
 * references a non-existent or kind-mismatched metric throws). Thresholds
 * are derived, never invented:
 *
 * - zero-tolerance counters for never-normal conditions (a dead-lettered
 *   segment, a rejected heartbeat — the codebase's own never-silent
 *   accounting makes any nonzero count a visible incident);
 * - W306-derived latency thresholds ONLY where the controlled-fixture
 *   evidence exists (the injected-clock domain caveat is carried in the
 *   derivation text);
 * - the seams stay METRIC-GENERIC (counter/histogram names): W802 — the
 *   sibling SLO formalization — layers its thresholds over the same seams,
 *   and this catalog references no W802 internals.
 *
 * Each alert carries a runbook pointer into
 * docs/observability/PRODUCTION.md (the runbook sections there are
 * doc-pinned against this catalog by test — the W503 THRESHOLDS.md
 * both-directions precedent).
 */
import { z } from "zod";
import { HEALTH_DOMAIN_IDS } from "./domains";

/** The catalog's identity (echoed by evaluation results). */
export const ALERT_CATALOG_VERSION = 1 as const;

/** Alert severities (the rollup maps critical→down, warning→degraded). */
export const ALERT_SEVERITIES = ["critical", "warning"] as const;

/**
 * The threshold expression grammar (pure, closed): what an alert evaluates
 * against a `MetricsSnapshot`. Firing is STRICTLY-above-threshold, so an
 * at-threshold reading is `ok` (boundary pinned by tests).
 *
 * `no-data` semantics (never-silent): a metric absent from the snapshot, a
 * histogram with zero observations, or a ratio with a zero denominator is
 * `no-data` — NEVER `ok`. Absence of evidence is not health.
 */
export const ThresholdExprSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("counter-above"),
    /** Counter metric name (must be a counter seam in the domain map). */
    metric: z.string().regex(/^[a-z0-9_]+$/),
    /** Fires when the summed counter value is strictly greater. */
    threshold: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal("counter-ratio-above"),
    /** Counter metric name of the numerator (summed across label series). */
    numerator: z.string().regex(/^[a-z0-9_]+$/),
    /** Counter metric name of the denominator (summed across label series). */
    denominator: z.string().regex(/^[a-z0-9_]+$/),
    /** Fires when numerator/denominator is strictly greater. */
    threshold: z.number().min(0),
  }),
  z.object({
    kind: z.literal("histogram-p95-above"),
    /** Histogram metric name (must be a histogram seam in the domain map). */
    metric: z.string().regex(/^[a-z0-9_]+$/),
    /** Fires when the histogram's p95 is strictly greater (ms). */
    thresholdMs: z.number().finite().positive(),
  }),
  z.object({
    kind: z.literal("histogram-p50-above"),
    metric: z.string().regex(/^[a-z0-9_]+$/),
    /** Fires when the histogram's p50 is strictly greater (ms). */
    thresholdMs: z.number().finite().positive(),
  }),
]);

export type ThresholdExpr = z.infer<typeof ThresholdExprSchema>;

export const AlertDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  domain: z.enum(HEALTH_DOMAIN_IDS),
  severity: z.enum(ALERT_SEVERITIES),
  title: z.string().min(1),
  /** One-line expression summary (human-facing). */
  summary: z.string().min(1),
  expression: ThresholdExprSchema,
  /**
   * The documented derivation of the threshold — W503 THRESHOLDS.md
   * precedent: every number states where it comes from.
   */
  derivation: z.string().min(1),
  /** Runbook pointer (an anchor inside docs/observability/PRODUCTION.md). */
  runbook: z.string().regex(/^docs\/observability\/PRODUCTION.md#runbook-/),
});

export type AlertDefinition = z.infer<typeof AlertDefinitionSchema>;

export const AlertCatalogSchema = z.object({
  schemaVersion: z.literal(ALERT_CATALOG_VERSION),
  alerts: z
    .array(AlertDefinitionSchema)
    .refine((alerts) => {
      const ids = alerts.map((alert) => alert.id);
      return ids.length === new Set(ids).size;
    }, { message: "alert ids must be unique" }),
});

export type AlertCatalog = z.infer<typeof AlertCatalogSchema>;

// ---------------------------------------------------------------------------
// The catalog (W805 deliverable 2). 24 alerts; the model domain has NONE —
// its registry seams do not exist yet (documented gap, health unknown).
// ---------------------------------------------------------------------------

export const ALERT_CATALOG: AlertCatalog = {
  schemaVersion: ALERT_CATALOG_VERSION,
  alerts: [
    // --- media ----------------------------------------------------------------
    {
      id: "media-ingest-rejections",
      domain: "media",
      severity: "warning",
      title: "Source ingestion rejections",
      summary: "ingest_rejected_total > 0",
      expression: { kind: "counter-above", metric: "ingest_rejected_total", threshold: 0 },
      derivation:
        "Zero-tolerance: W101's intake gate is fail-closed and classifies every rejection " +
        "(rights-denied, malformed, checksum) — the counter is the gate's own visible record. " +
        "A healthy run rejects nothing that was legitimately submitted; any nonzero count is an " +
        "operator-visible intake incident by the codebase's never-silent design.",
      runbook: "docs/observability/PRODUCTION.md#runbook-media-ingest-rejections",
    },
    {
      id: "media-decode-failures",
      domain: "media",
      severity: "warning",
      title: "Decoding failures",
      summary: "decode_failures_total > 0",
      expression: { kind: "counter-above", metric: "decode_failures_total", threshold: 0 },
      derivation:
        "Zero-tolerance: W102 classifies every decode/probe refusal (typed, fail-loud); the " +
        "decoder never silently skips a container it cannot read. Any nonzero count is a " +
        "media-file or probe-policy incident, visible by design.",
      runbook: "docs/observability/PRODUCTION.md#runbook-media-decode-failures",
    },
    {
      id: "media-timeline-sync-failures",
      domain: "media",
      severity: "warning",
      title: "Timeline synchronization failures",
      summary: "timeline_sync_failures_total > 0",
      expression: { kind: "counter-above", metric: "timeline_sync_failures_total", threshold: 0 },
      derivation:
        "Zero-tolerance: W103's align() refuses (classified) rather than guessing when track " +
        "timing summaries cannot be aligned — every refusal is counted. Nonzero means a media " +
        "session's tracks cannot be placed on the canonical timeline.",
      runbook: "docs/observability/PRODUCTION.md#runbook-media-timeline-sync-failures",
    },
    // --- queue ----------------------------------------------------------------
    {
      id: "queue-processing-dlq",
      domain: "queue",
      severity: "warning",
      title: "Processing-queue dead letters",
      summary: "processing_dead_lettered_total > 0",
      expression: { kind: "counter-above", metric: "processing_dead_lettered_total", threshold: 0 },
      derivation:
        "Zero-tolerance: a segment reaches the DLQ only after bounded deterministic retries of " +
        "a non-retryable or retry-exhausted failure (W302, W104 rules) — terminal, accounted, " +
        "never silently retried. Any entry is a lost segment the operator must disposition.",
      runbook: "docs/observability/PRODUCTION.md#runbook-queue-processing-dlq",
    },
    {
      id: "queue-gpu-dlq",
      domain: "queue",
      severity: "warning",
      title: "GPU job dead letters",
      summary: "gpu_jobs_dead_lettered_total > 0",
      expression: { kind: "counter-above", metric: "gpu_jobs_dead_lettered_total", threshold: 0 },
      derivation:
        "Zero-tolerance: W303 dead-letters a job only after its bounded max-attempts (or a " +
        "non-retryable failure class) — every entry is ledgered and logged. Nonzero is a " +
        "terminally failed render job.",
      runbook: "docs/observability/PRODUCTION.md#runbook-queue-gpu-dlq",
    },
    {
      id: "queue-gpu-refused-submissions",
      domain: "queue",
      severity: "warning",
      title: "GPU job submissions refused",
      summary: "gpu_refused_submissions_total > 0",
      expression: { kind: "counter-above", metric: "gpu_refused_submissions_total", threshold: 0 },
      derivation:
        "Zero-tolerance: W303 refuses a submission only for never-normal reasons — malformed " +
        "envelope, over-capacity admission, or a dispatcher already ended. Unlike channel " +
        "backpressure (a W104 policy action), a refusal at the job protocol is a capacity or " +
        "protocol incident.",
      runbook: "docs/observability/PRODUCTION.md#runbook-queue-gpu-refused-submissions",
    },
    {
      id: "queue-gpu-queue-wait-p95",
      domain: "queue",
      severity: "warning",
      title: "GPU ready-queue wait p95 high",
      summary: "gpu_job_queue_wait_ms p95 > 6000",
      expression: { kind: "histogram-p95-above", metric: "gpu_job_queue_wait_ms", thresholdMs: 6000 },
      derivation:
        "W306-derived: on the checked-in controlled fixture (injected-clock domain) the W303 " +
        "ready-queue wait measured p95 4000 ms — the suite's identified congestion point — and " +
        "the W306 SLO candidate table (w303-schedule) set the target at 6000 ms (~1.5x " +
        "headroom) so a deterministic rerun never sits on a knife edge. Headroom keeps a " +
        "slight distribution shift from breaching while a pathological queue still fails loud. " +
        "The seam is metric-generic: W802's formalized SLO thresholds slot onto " +
        "gpu_job_queue_wait_ms directly.",
      runbook: "docs/observability/PRODUCTION.md#runbook-queue-gpu-queue-wait-p95",
    },
    // --- renderer ---------------------------------------------------------------
    {
      id: "renderer-failures",
      domain: "renderer",
      severity: "warning",
      title: "Renderer failures",
      summary: "render_failures_total > 0",
      expression: { kind: "counter-above", metric: "render_failures_total", threshold: 0 },
      derivation:
        "Zero-tolerance: every renderer plugin (W501 contract TestCard, W502 anime, W601/W603 " +
        "3D) bumps this on a typed, never-silent render failure (labeled rendererId, so the " +
        "series sum spans all renderers). A pure deterministic renderer has no innocent " +
        "failure mode — nonzero is a renderer defect or a contract breach.",
      runbook: "docs/observability/PRODUCTION.md#runbook-renderer-failures",
    },
    {
      id: "renderer-batches-dropped",
      domain: "renderer",
      severity: "warning",
      title: "Render batches dropped",
      summary: "render_batches_dropped_total > 0",
      expression: { kind: "counter-above", metric: "render_batches_dropped_total", threshold: 0 },
      derivation:
        "Zero-tolerance: W304's exact accounting gives every dropped batch a labeled reason " +
        "(queue-evicted incl. exceeds-byte-budget, queue-refused, abandoned-at-stop, " +
        "render-queue-refused, render-failed, reorder-overflow, render-output-invalid) — " +
        "including admitted-budget exhaustion. Any drop is an accounted loss of a render batch.",
      runbook: "docs/observability/PRODUCTION.md#runbook-renderer-batches-dropped",
    },
    {
      id: "renderer-skip-stale-degradation",
      domain: "renderer",
      severity: "warning",
      title: "Render skip-stale degradation active",
      summary: "render_batches_skipped_stale_total > 0",
      expression: { kind: "counter-above", metric: "render_batches_skipped_stale_total", threshold: 0 },
      derivation:
        "The codebase's own semantics: the W305 session phase machine enters `degraded` on the " +
        "FIRST skip-stale window — by the platform's own definition, any skip-stale batch is " +
        "degradation (the W304 policy drops stale batches rather than render stale state). " +
        "Zero-tolerance mirrors the state machine's threshold.",
      runbook: "docs/observability/PRODUCTION.md#runbook-renderer-skip-stale-degradation",
    },
    {
      id: "renderer-gpu-job-latency-p95",
      domain: "renderer",
      severity: "warning",
      title: "Render job round-trip p95 high",
      summary: "gpu_job_latency_ms p95 > 7000",
      expression: { kind: "histogram-p95-above", metric: "gpu_job_latency_ms", thresholdMs: 7000 },
      derivation:
        "W306-derived composition: gpu_job_latency_ms is finishedAt−submittedAt = ready-queue " +
        "wait + execution (W303 dispatcher). The W306 SLO candidates bound exactly these two " +
        "components on the controlled fixture (w303-schedule target 6000 ms + render-execution " +
        "target 1000 ms), so 7000 ms is the sum of the two candidate budgets — each already " +
        "carrying its measured headroom (measured p95: 4000 wait + 400 execution). " +
        "Metric-generic: W802's formalized SLOs replace this interim threshold on the same seam.",
      runbook: "docs/observability/PRODUCTION.md#runbook-renderer-gpu-job-latency-p95",
    },
    // --- delivery ------------------------------------------------------------------
    {
      id: "delivery-windows-failed",
      domain: "delivery",
      severity: "critical",
      title: "Live window delivery failures",
      summary: "live_output_windows_failed_total > 0",
      expression: { kind: "counter-above", metric: "live_output_windows_failed_total", threshold: 0 },
      derivation:
        "Zero-tolerance, CRITICAL: a send failure is terminal for the window and ends the " +
        "session failed (W305) — output the pipeline rendered is lost to the viewer. This is " +
        "the only alert in the catalog that marks a domain DOWN: delivery failure is direct " +
        "user-facing loss.",
      runbook: "docs/observability/PRODUCTION.md#runbook-delivery-windows-failed",
    },
    {
      id: "delivery-windows-dropped",
      domain: "delivery",
      severity: "warning",
      title: "Live windows dropped by policy",
      summary: "live_output_windows_dropped_by_policy_total > 0",
      expression: { kind: "counter-above", metric: "live_output_windows_dropped_by_policy_total", threshold: 0 },
      derivation:
        "Zero-tolerance: W305 drops a window by capacity policy only at admission or eviction " +
        "(labeled at) — an accounted loss. Any drop means the link depth exceeded the retained " +
        "window budget under the configured capacity.",
      runbook: "docs/observability/PRODUCTION.md#runbook-delivery-windows-dropped",
    },
    {
      id: "delivery-windows-refused",
      domain: "delivery",
      severity: "warning",
      title: "Live windows refused (no-downgrade protections)",
      summary: "live_output_windows_refused_total > 0",
      expression: { kind: "counter-above", metric: "live_output_windows_refused_total", threshold: 0 },
      derivation:
        "Zero-tolerance: W305 refuses a window only through its typed no-downgrade rejects " +
        "(protocol/codec/latency protections) — a refusal means the transport refused to " +
        "degrade quality silently, an incident worth operator eyes.",
      runbook: "docs/observability/PRODUCTION.md#runbook-delivery-windows-refused",
    },
    {
      id: "delivery-skipped-at-reconnect",
      domain: "delivery",
      severity: "warning",
      title: "Windows lost to reconnect gaps",
      summary: "live_output_windows_skipped_at_reconnect_total > 0",
      expression: { kind: "counter-above", metric: "live_output_windows_skipped_at_reconnect_total", threshold: 0 },
      derivation:
        "Zero-tolerance: W305 counts every window lost across a viewer reconnect gap. " +
        "Reconnect itself is expected recovery (not alerted); the windows it cost are " +
        "user-visible loss (alerted).",
      runbook: "docs/observability/PRODUCTION.md#runbook-delivery-skipped-at-reconnect",
    },
    {
      id: "delivery-skip-stale-degradation",
      domain: "delivery",
      severity: "warning",
      title: "Live output skip-stale degradation active",
      summary: "live_output_windows_skipped_stale_total > 0",
      expression: { kind: "counter-above", metric: "live_output_windows_skipped_stale_total", threshold: 0 },
      derivation:
        "The codebase's own semantics: the W305 phase machine enters `degraded` on the first " +
        "skip-stale window and recovers only on a subsequent in-bound delivery — any nonzero " +
        "count is, by the machine's own definition, a degraded delivery session.",
      runbook: "docs/observability/PRODUCTION.md#runbook-delivery-skip-stale-degradation",
    },
    // --- infrastructure --------------------------------------------------------
    {
      id: "infra-gpu-heartbeat-rejects",
      domain: "infrastructure",
      severity: "warning",
      title: "GPU worker heartbeats rejected",
      summary: "gpu_worker_heartbeats_rejected_total > 0",
      expression: { kind: "counter-above", metric: "gpu_worker_heartbeats_rejected_total", threshold: 0 },
      derivation:
        "Zero-tolerance: W303 rejects a heartbeat only for a fail-closed protocol violation " +
        "(dispatcher-ended, unknown-worker, sequence-not-monotone — labeled reason). Nonzero " +
        "means the liveness protocol itself is being violated.",
      runbook: "docs/observability/PRODUCTION.md#runbook-infra-gpu-heartbeat-rejects",
    },
    {
      id: "infra-gpu-lease-expiries",
      domain: "infrastructure",
      severity: "warning",
      title: "GPU job lease expiries",
      summary: "gpu_lease_expiries_total > 0",
      expression: { kind: "counter-above", metric: "gpu_lease_expiries_total", threshold: 0 },
      derivation:
        "Zero-tolerance: a lease expires only when its worker stopped heartbeating mid-job " +
        "(W303) — a process-liveness event. Jobs are requeued and counted (never silently " +
        "reassigned), so this is degradation, not loss: warning severity.",
      runbook: "docs/observability/PRODUCTION.md#runbook-infra-gpu-lease-expiries",
    },
    {
      id: "infra-gpu-stale-workers",
      domain: "infrastructure",
      severity: "warning",
      title: "GPU workers gone stale",
      summary: "gpu_stale_workers_total > 0",
      expression: { kind: "counter-above", metric: "gpu_stale_workers_total", threshold: 0 },
      derivation:
        "Zero-tolerance: W303's staleness detection fires only when a registered worker goes " +
        "silent past its lease horizon — its in-flight jobs are failed loud with timeout " +
        "classification. A stale worker is a dead-or-hung process in the render fleet.",
      runbook: "docs/observability/PRODUCTION.md#runbook-infra-gpu-stale-workers",
    },
    {
      id: "infra-gpu-late-results",
      domain: "infrastructure",
      severity: "warning",
      title: "GPU late results",
      summary: "gpu_late_results_total > 0",
      expression: { kind: "counter-above", metric: "gpu_late_results_total", threshold: 0 },
      derivation:
        "Zero-tolerance: a result is late when its job was already superseded (requeued past " +
        "max attempts then reported, or reported after cancellation — W303). Nonzero indicates " +
        "clock/lease skew or a worker reporting past its deadline: protocol health noise that " +
        "is never normal.",
      runbook: "docs/observability/PRODUCTION.md#runbook-infra-gpu-late-results",
    },
    {
      id: "infra-gpu-job-timeouts",
      domain: "infrastructure",
      severity: "warning",
      title: "GPU job deadline breaches",
      summary: "gpu_job_timeouts_total > 0",
      expression: { kind: "counter-above", metric: "gpu_job_timeouts_total", threshold: 0 },
      derivation:
        "Zero-tolerance: W303 enforces per-job deadlines on the injected clock and classifies " +
        "every breach (labeled kind). Nonzero means the render fleet is not keeping up with " +
        "the deadline budget the dispatcher was configured with.",
      runbook: "docs/observability/PRODUCTION.md#runbook-infra-gpu-job-timeouts",
    },
    {
      id: "infra-clock-drift-anomalies",
      domain: "infrastructure",
      severity: "warning",
      title: "Track clock drift clamped",
      summary: "timeline_sync_drift_anomalies_total > 0",
      expression: { kind: "counter-above", metric: "timeline_sync_drift_anomalies_total", threshold: 0 },
      derivation:
        "Zero-tolerance: W103 clamps |driftPpm| at DRIFT_CLAMP_PPM = 1000 (0.1%) and counts " +
        "every clamped measurement — a clamped anomaly means a media track's timestamps " +
        "diverge from the canonical timeline beyond the physical bound the synchronizer will " +
        "honor. Clock-domain health on the injected-clock pipeline.",
      runbook: "docs/observability/PRODUCTION.md#runbook-infra-clock-drift-anomalies",
    },
    {
      id: "infra-control-failures",
      domain: "infrastructure",
      severity: "warning",
      title: "Control-plane failures",
      summary: "control_failures_total > 0",
      expression: { kind: "counter-above", metric: "control_failures_total", threshold: 0 },
      derivation:
        "Zero-tolerance: the control plane (W701) counts every failed method call with its " +
        "failure class (route-labeled totals stay separate). Nonzero is a session/render " +
        "control operation failing at the app or HTTP layer.",
      runbook: "docs/observability/PRODUCTION.md#runbook-infra-control-failures",
    },
    {
      id: "infra-transport-failures",
      domain: "infrastructure",
      severity: "warning",
      title: "Stage transport failures",
      summary: "transport_failures_total > 0",
      expression: { kind: "counter-above", metric: "transport_failures_total", threshold: 0 },
      derivation:
        "Zero-tolerance: the stage transport (W104) counts a failure only after a message " +
        "exhausted its declared retry budget (stage + errorClass labeled) — terminal, typed, " +
        "never silently retried beyond the policy.",
      runbook: "docs/observability/PRODUCTION.md#runbook-infra-transport-failures",
    },
  ],
};

/** All alert ids in catalog order (deterministic). */
export function alertIds(catalog: AlertCatalog): string[] {
  return catalog.alerts.map((alert) => alert.id);
}

/** The alert with `id`, or undefined. */
export function findAlert(catalog: AlertCatalog, id: string): AlertDefinition | undefined {
  return catalog.alerts.find((alert) => alert.id === id);
}
