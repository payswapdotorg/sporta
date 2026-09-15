/**
 * The HEALTH DOMAIN MAP (W805) — the normative inventory of every metric
 * seam this codebase can honestly emit today, per health domain.
 *
 * This is AUDIT DATA, not aspiration: every `registrySeams` entry was
 * verified against the emitting package's source (the metric name is a
 * literal in the referenced module — pinned by `test/domains.test.ts`,
 * which reads the actual sibling package files). A seam that does not exist
 * in code does not appear here; a health fact this codebase cannot emit is
 * listed in the domain's `gaps`, never invented.
 *
 * Domains (architecture-lock §12's session-traceability stages, grouped for
 * operations): media, queue, model, renderer, delivery, infrastructure.
 *
 * The map is versioned (`schemaVersion`): consumers (the alert catalog,
 * the dashboard spec — both cross-checked by `consistency.ts`) reference
 * metric names that must exist HERE, with a kind that matches. Unknown or
 * kind-mismatched references fail loud, never silently pass
 * (the W802 mapping-consistency precedent).
 */
import { z } from "zod";

/** The map's identity (echoed by every artifact that derives from it). */
export const HEALTH_DOMAIN_MAP_VERSION = 1 as const;

/** The six health domains (work item W805's coverage list). */
export const HEALTH_DOMAIN_IDS = [
  "media",
  "queue",
  "model",
  "renderer",
  "delivery",
  "infrastructure",
] as const;

export type HealthDomainId = (typeof HEALTH_DOMAIN_IDS)[number];

/** One package module that declares (and/or emits) a metric name. */
export const SeamSiteSchema = z.object({
  /** The workspace package that owns the module. */
  packageName: z.string().regex(/^@sporta\/[a-z0-9-]+$/),
  /** The module path inside that package (starts with `src/`). */
  module: z.string().regex(/^src\//),
});

export type SeamSite = z.infer<typeof SeamSiteSchema>;

/**
 * A registry series seam: a counter or histogram name that a real package
 * observes on a `MetricsRegistry` (the `@sporta/observability` snapshot
 * shape is what alert evaluation and dashboard queries consume).
 */
export const RegistrySeamSchema = z.object({
  /** The exact metric name string used at the registry call site. */
  metricName: z.string().regex(/^[a-z0-9_]+$/),
  kind: z.enum(["counter", "histogram"]),
  /** Label keys the emitting sites use (empty = unlabeled series). */
  labels: z.array(z.string().regex(/^[a-z_][a-zA-Z0-9_]*$/)),
  /** Every package module that declares/emits the name. */
  sites: z.array(SeamSiteSchema).min(1),
  /** What one increment/observation means (never-silent accounting note). */
  emission: z.string().min(1),
});

export type RegistrySeam = z.infer<typeof RegistrySeamSchema>;

/**
 * A non-registry observability seam: telemetry event models, timing-record
 * surfaces, advisory fields. Honest posture facts — listed so the domain map
 * is complete, but NOT alertable from a `MetricsSnapshot` (the evaluation
 * engine only reads registry seams; using anything else would be inventing
 * data).
 */
export const TelemetrySeamSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["event-sink", "timing-record", "advisory-field", "log-sink"]),
  packageName: z.string().regex(/^@sporta\/[a-z0-9-]+$/),
  module: z.string().regex(/^src\//),
  /** What the seam carries. */
  emission: z.string().min(1),
});

export type TelemetrySeam = z.infer<typeof TelemetrySeamSchema>;

/** A health fact this codebase cannot emit today — listed, never invented. */
export const HealthGapSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  detail: z.string().min(1),
});

export type HealthGap = z.infer<typeof HealthGapSchema>;

export const HealthDomainSchema = z.object({
  id: z.enum(HEALTH_DOMAIN_IDS),
  title: z.string().min(1),
  /** What the domain covers (the packages/stages in scope). */
  scope: z.string().min(1),
  registrySeams: z.array(RegistrySeamSchema),
  telemetrySeams: z.array(TelemetrySeamSchema),
  gaps: z.array(HealthGapSchema),
});

export type HealthDomain = z.infer<typeof HealthDomainSchema>;

export const HealthDomainMapSchema = z.object({
  schemaVersion: z.literal(HEALTH_DOMAIN_MAP_VERSION),
  domains: z
    .array(HealthDomainSchema)
    .length(HEALTH_DOMAIN_IDS.length)
    .refine(
      (domains) => {
        const ids = domains.map((domain) => domain.id);
        return (
          ids.length === new Set(ids).size &&
          HEALTH_DOMAIN_IDS.every((expected) => ids.includes(expected))
        );
      },
      { message: "the map must carry each of the six health domains exactly once" },
    ),
});

export type HealthDomainMap = z.infer<typeof HealthDomainMapSchema>;

// ---------------------------------------------------------------------------
// Authoring helpers (data section below uses them for brevity — each call
// is one audited seam; nothing is derived or guessed).
// ---------------------------------------------------------------------------

function counter(
  metricName: string,
  labels: string[],
  sites: Array<[packageName: string, module: string]>,
  emission: string,
): RegistrySeam {
  return {
    metricName,
    kind: "counter",
    labels,
    sites: sites.map(([packageName, module]) => ({ packageName, module })),
    emission,
  };
}

function histogram(
  metricName: string,
  sites: Array<[packageName: string, module: string]>,
  emission: string,
): RegistrySeam {
  return {
    metricName,
    kind: "histogram",
    labels: [],
    sites: sites.map(([packageName, module]) => ({ packageName, module })),
    emission,
  };
}

const RENDERER_SITES: Array<[string, string]> = [
  ["@sporta/renderer-contract", "src/reference/test-card.ts"],
  ["@sporta/renderer-anime", "src/plugin.ts"],
  ["@sporta/renderer-3d", "src/plugin.ts"],
];

const W302_SITES: Array<[string, string]> = [["@sporta/processing-queues", "src/types.ts"]];
const W303_SITES: Array<[string, string]> = [["@sporta/gpu-worker", "src/types.ts"]];
const W305_SITES: Array<[string, string]> = [["@sporta/webrtc-output", "src/types.ts"]];
// Control-api emits both counters through the shared CONTROL_METRIC_NAMES
// constant, declared (and used inline) in src/app.ts; src/http.ts imports it
// — so the literal site is app.ts (the every-site literal pin would otherwise
// drift). The W302/W303/W305 convention: the literal-declaring module is the
// site; other emitting modules are named in the emission prose.
const W701_SITES: Array<[string, string]> = [["@sporta/control-api", "src/app.ts"]];

// ---------------------------------------------------------------------------
// The audited map (W805 deliverable 1).
// ---------------------------------------------------------------------------

export const HEALTH_DOMAIN_MAP: HealthDomainMap = {
  schemaVersion: HEALTH_DOMAIN_MAP_VERSION,
  domains: [
    {
      id: "media",
      title: "Media intake health",
      scope:
        "source ingestion (W101 fail-closed rights gate), decoding (W102), timeline " +
        "synchronization (W103), live-source ingress (W201-era live channel admission)",
      registrySeams: [
        counter(
          "ingest_accepted",
          [],
          [["@sporta/ingestion", "src/ingest.ts"]],
          "once per accepted source (idempotent duplicates included)",
        ),
        counter(
          "ingest_rejected_total",
          ["failure_class"],
          [["@sporta/ingestion", "src/ingest.ts"]],
          "once per rejected source — the fail-closed W101 gate (rights, malformed, checksum)",
        ),
        counter(
          "decode_frames_total",
          [],
          [["@sporta/decoding", "src/service.ts"]],
          "once per yielded normalized video frame",
        ),
        counter(
          "decode_audio_chunks_total",
          [],
          [["@sporta/decoding", "src/service.ts"]],
          "once per yielded normalized audio chunk",
        ),
        counter(
          "decode_bytes_total",
          [],
          [["@sporta/decoding", "src/service.ts"]],
          "incremented by the byte size of every yielded item",
        ),
        counter(
          "decode_failures_total",
          ["failure_class"],
          [["@sporta/decoding", "src/service.ts"]],
          "once per classified decode/probe refusal (unlabeled total + per-failure-class series)",
        ),
        counter(
          "timeline_sync_alignments_total",
          [],
          [["@sporta/timeline", "src/sync.ts"]],
          "once per successful track-timeline alignment",
        ),
        counter(
          "timeline_sync_failures_total",
          ["failure_class"],
          [["@sporta/timeline", "src/sync.ts"]],
          "once per classified alignment refusal (unlabeled total + per-failure-class series)",
        ),
        counter(
          "streaming_segments_in_total",
          [],
          [["@sporta/streaming-ingress", "src/types.ts"]],
          "once per delivery received from the live source",
        ),
        counter(
          "streaming_segments_out_total",
          [],
          [["@sporta/streaming-ingress", "src/types.ts"]],
          "once per segment admitted to the output channel",
        ),
        counter(
          "streaming_rejected_total",
          ["failure_class"],
          [["@sporta/streaming-ingress", "src/types.ts"]],
          "once per refused delivery, labeled with the failure class (rights-denied included)",
        ),
        counter(
          "streaming_duplicate_segments_total",
          [],
          [["@sporta/streaming-ingress", "src/types.ts"]],
          "once per idempotent duplicate re-delivery",
        ),
        counter(
          "streaming_abandoned_segments_total",
          ["reason"],
          [["@sporta/streaming-ingress", "src/types.ts"]],
          "once per segment abandoned at shutdown",
        ),
        counter(
          "streaming_backpressure_events_total",
          [],
          [["@sporta/streaming-ingress", "src/types.ts"]],
          "once per explicit backpressure refusal event (a W104 policy action, not a failure)",
        ),
        histogram(
          "streaming_arrival_lag_ms",
          [["@sporta/streaming-ingress", "src/types.ts"]],
          "measured arrival lag per accepted live-source segment",
        ),
        histogram(
          "streaming_send_wait_ms",
          [["@sporta/streaming-ingress", "src/types.ts"]],
          "output-send wait per accepted segment",
        ),
      ],
      telemetrySeams: [],
      gaps: [
        {
          id: "media-asr-no-metrics",
          title: "ASR emits no observability seams",
          detail:
            "packages/asr (W207) has no @sporta/observability dependency and no counters or " +
            "histograms — transcription failures/latency are uncounted at runtime. Model-quality " +
            "evidence exists only in the offline eval-harness (W801) detection cases.",
        },
        {
          id: "media-fusion-no-metrics",
          title: "Event fusion emits no observability seams",
          detail:
            "packages/fusion (W204) emits nothing to a registry; fusion outcomes (promotions, " +
            "conflicts, confidence rejections) are uncounted at runtime.",
        },
      ],
    },
    {
      id: "queue",
      title: "Queue and job-pipeline health",
      scope:
        "processing-queues (W302) segment accounting + DLQ; gpu-worker (W303) job admission, " +
        "duplicate dedupe, retry/DLQ accounting, and ready-queue congestion",
      registrySeams: [
        counter(
          "processing_segments_in_total",
          [],
          W302_SITES,
          "once per accounted submit attempt (pipeline.ts)",
        ),
        counter(
          "processing_segments_out_total",
          [],
          W302_SITES,
          "once per segment admitted to the output queue (pipeline.ts)",
        ),
        counter(
          "processing_rejected_total",
          ["failure_class"],
          W302_SITES,
          "once per refused attempt (pipeline.ts) — includes W104 backpressure policy actions",
        ),
        counter(
          "processing_duplicate_segments_total",
          [],
          W302_SITES,
          "once per idempotent duplicate submission (pipeline.ts)",
        ),
        counter(
          "processing_dead_lettered_total",
          [],
          W302_SITES,
          "once per terminally failed segment (dlq.ts)",
        ),
        counter(
          "processing_abandoned_segments_total",
          ["reason"],
          W302_SITES,
          "once per segment abandoned at shutdown (pipeline.ts)",
        ),
        counter(
          "processing_dlq_entries_total",
          ["terminal"],
          W302_SITES,
          "once per retained + overflowed DLQ entry (dlq.ts)",
        ),
        counter(
          "processing_retries_total",
          ["stage"],
          W302_SITES,
          "once per retry attempt consumed (pipeline.ts)",
        ),
        counter(
          "processing_checkpoints_total",
          [],
          W302_SITES,
          "once per checkpoint cut (pipeline.ts)",
        ),
        histogram(
          "processing_stage_latency_ms",
          W302_SITES,
          "per-stage summed handler latency per segment (pipeline.ts)",
        ),
        counter(
          "gpu_jobs_submitted_total",
          [],
          W303_SITES,
          "once per accounted job submission (dispatcher.ts)",
        ),
        counter(
          "gpu_jobs_admitted_total",
          [],
          W303_SITES,
          "once per admission past resource checks (dispatcher.ts)",
        ),
        counter(
          "gpu_duplicate_jobs_total",
          [],
          W303_SITES,
          "once per idempotency-key duplicate — counted, never double-run (dispatcher.ts)",
        ),
        counter(
          "gpu_jobs_succeeded_total",
          [],
          W303_SITES,
          "once per succeeded job (dispatcher.ts)",
        ),
        counter(
          "gpu_jobs_failed_total",
          [],
          W303_SITES,
          "once per terminally failed job (dispatcher.ts)",
        ),
        counter(
          "gpu_jobs_cancelled_total",
          [],
          W303_SITES,
          "once per accounted cancellation (dispatcher.ts)",
        ),
        counter(
          "gpu_jobs_dead_lettered_total",
          [],
          W303_SITES,
          "once per job dead-lettered after bounded attempts (dlq.ts)",
        ),
        counter(
          "gpu_dlq_entries_total",
          ["terminal"],
          W303_SITES,
          "once per DLQ entry, labeled terminal (dlq.ts)",
        ),
        counter(
          "gpu_malformed_submissions_total",
          [],
          W303_SITES,
          "once per structurally invalid submission envelope (dispatcher.ts)",
        ),
        counter(
          "gpu_refused_submissions_total",
          [],
          W303_SITES,
          "once per refused submission — malformed, over-capacity, or dispatcher-ended (dispatcher.ts)",
        ),
        counter(
          "gpu_job_claims_total",
          [],
          W303_SITES,
          "once per job claim by a worker (dispatcher.ts)",
        ),
        counter(
          "gpu_job_requeues_total",
          [],
          W303_SITES,
          "once per lease-expired requeue (dispatcher.ts)",
        ),
        counter(
          "gpu_job_attempts_total",
          ["disposition"],
          W303_SITES,
          "sums report.attempts for every report that reaches a known job record, labeled disposition recorded|superseded (malformed and unknown-job reports never reach it) (dispatcher.ts)",
        ),
        histogram(
          "gpu_job_queue_wait_ms",
          W303_SITES,
          "startedAtMs − submittedAtMs per finished job — the W303 ready-queue wait (dispatcher.ts)",
        ),
      ],
      telemetrySeams: [],
      gaps: [
        {
          id: "queue-depth-not-on-registry",
          title: "Queue depth has no registry series",
          detail:
            "architecture-lock §12 lists queue depth, but no package observes a queue_depth " +
            "series on a MetricsRegistry: W302 exposes depths via PipelineStats.queueDepths " +
            "(a result snapshot, not a registry series) and W305 via the live_output_link_depth " +
            "histogram. The registry has no gauge kind — an in-flight depth is not alertable " +
            "from a snapshot today.",
        },
        {
          id: "queue-rejections-not-alertable",
          title: "Rejection counters include normal policy actions",
          detail:
            "processing_rejected_total and streaming_backpressure_events_total count W104 " +
            "backpressure refusals, which are normal policy behavior under burst (block, reject, " +
            "drop-oldest) — a zero-tolerance alert would fire on healthy runs, so no alert is " +
            "defined on them (documented derivation decision, see PRODUCTION.md §4).",
        },
      ],
    },
    {
      id: "model",
      title: "Perception and world-model health",
      scope:
        "perception (detection/tracking), ball state, field mapping, spatial state, event " +
        "fusion, world-model corrections, commentary understanding — runtime model behavior",
      registrySeams: [],
      telemetrySeams: [],
      gaps: [
        {
          id: "model-no-runtime-seams",
          title: "No model-domain package emits any observability seam",
          detail:
            "packages world-model, observation, perception-detection, perception-tracking, " +
            "ball-tracking, ball-state, field-mapping, spatial-state, fusion, and " +
            "commentary-segmentation/understanding carry no @sporta/observability dependency " +
            "and emit zero counters/histograms/logs to a registry — world-model corrections, " +
            "perception coverage, and event-quality facts cannot be observed at runtime. Until " +
            "seams exist, this domain's health is UNKNOWN by construction (never silently " +
            "healthy — the rollup propagates unknown).",
        },
        {
          id: "model-quality-offline-only",
          title: "Model quality is offline-evidence only",
          detail:
            "score/clock correctness, identity continuity, and scene correctness are measured " +
            "by the eval-harness suite (W801: detection-proof, W601 scene, W306 latency) and " +
            "the W605 3D-output evaluation — verdicts at benchmark time, not runtime registry " +
            "series. Runtime model-quality alerting would require new seams (ops backlog).",
        },
      ],
    },
    {
      id: "renderer",
      title: "Renderer and render-pipeline health",
      scope:
        "renderer plugin failures (W501 contract, W502 anime, W601/W603 3D), " +
        "render-orchestration batch accounting + skip-stale + budget policies (W304), " +
        "render-job round-trip latency (W303)",
      registrySeams: [
        counter(
          "render_requests_total",
          ["rendererId"],
          RENDERER_SITES,
          "once per render call, labeled rendererId (inline literal at each plugin)",
        ),
        counter(
          "render_failures_total",
          ["rendererId"],
          RENDERER_SITES,
          "once per failed render call — typed, never silent (inline literal at each plugin)",
        ),
        counter(
          "render_batches_in_total",
          [],
          [["@sporta/render-orchestration", "src/types.ts"]],
          "once per batch admitted to rendering (orchestrator.ts)",
        ),
        counter(
          "render_batches_skipped_stale_total",
          ["phase"],
          [["@sporta/render-orchestration", "src/types.ts"]],
          "once per batch skipped by the stale policy, labeled admission|dequeue (orchestrator.ts)",
        ),
        counter(
          "render_batches_dropped_total",
          ["reason"],
          [["@sporta/render-orchestration", "src/types.ts"]],
          "once per dropped batch, labeled BatchDropReason — queue-evicted (incl. exceeds-byte-budget), queue-refused, abandoned-at-stop, render-queue-refused, render-failed, reorder-overflow, render-output-invalid (orchestrator.ts)",
        ),
        counter(
          "render_batches_cancelled_total",
          [],
          [["@sporta/render-orchestration", "src/types.ts"]],
          "once per cancelled batch (orchestrator.ts)",
        ),
        counter(
          "render_batches_duplicate_total",
          [],
          [["@sporta/render-orchestration", "src/types.ts"]],
          "once per same-watermark duplicate batch — counted, never double-executed (orchestrator.ts)",
        ),
        counter(
          "render_outputs_emitted_total",
          [],
          [["@sporta/render-orchestration", "src/types.ts"]],
          "once per ordered output emission (orchestrator.ts)",
        ),
        counter(
          "render_checkpoints_cut_total",
          [],
          [["@sporta/render-orchestration", "src/types.ts"]],
          "once per watermark-boundary checkpoint (orchestrator.ts)",
        ),
        counter(
          "render_consumer_park_attempts_total",
          [],
          [["@sporta/render-orchestration", "src/types.ts"]],
          "once per consumer park attempt at settle (orchestrator.ts)",
        ),
        histogram(
          "render_watermark_lag_at_emission_ms",
          [["@sporta/render-orchestration", "src/types.ts"]],
          "watermark lag observed at output emission (orchestrator.ts)",
        ),
        histogram(
          "gpu_job_latency_ms",
          W303_SITES,
          "finishedAtMs − submittedAtMs per finished render job = ready-queue wait + execution (dispatcher.ts)",
        ),
      ],
      telemetrySeams: [],
      gaps: [
        {
          id: "renderer-rendered-total-unemitted",
          title: "render_batches_rendered_total is declared but never observed",
          detail:
            "render_batches_rendered_total exists in the W304 vocabulary (RENDER_METRIC_NAMES.batchesRendered) " +
            "but the orchestrator only counts rendered batches in its ledger — no registry series is " +
            "observed. Dashboards/alerts must not read it; rendered-throughput is derivable " +
            "as outputs emitted minus non-rendered dispositions only at the ledger layer.",
        },
      ],
    },
    {
      id: "delivery",
      title: "Live delivery and playback health",
      scope:
        "live output accounting + session phase machine (W305), viewer session consumption " +
        "(W704 playback), viewer telemetry (W706)",
      registrySeams: [
        counter(
          "live_output_windows_in_total",
          ["outcome"],
          W305_SITES,
          "once per window admitted or rejected-invalid (transport.ts)",
        ),
        counter(
          "live_output_windows_delivered_total",
          [],
          W305_SITES,
          "once per verified window hand-over (transport.ts)",
        ),
        counter(
          "live_output_windows_skipped_stale_total",
          ["at"],
          W305_SITES,
          "once per skip-stale window, labeled admission|dequeue (transport.ts)",
        ),
        counter(
          "live_output_windows_dropped_by_policy_total",
          ["at"],
          W305_SITES,
          "once per policy drop (incoming admission or eviction), labeled at (transport.ts)",
        ),
        counter(
          "live_output_windows_refused_total",
          [],
          W305_SITES,
          "once per typed no-downgrade refusal — protocol/codec/latency protection (transport.ts)",
        ),
        counter(
          "live_output_windows_abandoned_total",
          ["reason"],
          W305_SITES,
          "once per window abandoned at close/cancel (transport.ts)",
        ),
        counter(
          "live_output_windows_failed_total",
          [],
          W305_SITES,
          "once per send failure — terminal for the window; session ends failed (transport.ts)",
        ),
        counter(
          "live_output_windows_redelivered_total",
          [],
          W305_SITES,
          "once per retention replay delivery (transport.ts)",
        ),
        counter(
          "live_output_windows_skipped_at_reconnect_total",
          [],
          W305_SITES,
          "once per window lost to a reconnect gap (transport.ts)",
        ),
        counter(
          "live_output_viewer_reconnects_total",
          ["event"],
          W305_SITES,
          "once per viewer disconnect/reconnect event (transport.ts)",
        ),
        counter(
          "live_output_state_transitions_total",
          ["from", "to"],
          W305_SITES,
          "once per legal session phase transition: negotiating→established→(degraded↔established)→closed (state.ts)",
        ),
        counter(
          "live_output_session_ends_total",
          ["outcome"],
          W305_SITES,
          "once per session end, labeled outcome incl. failed (transport.ts)",
        ),
        counter(
          "live_output_viewer_windows_applied_total",
          [],
          W305_SITES,
          "once per window applied by the viewer session (viewer.ts)",
        ),
        counter(
          "live_output_viewer_windows_duplicate_total",
          [],
          W305_SITES,
          "once per duplicate window seen by the viewer (viewer.ts)",
        ),
        counter(
          "live_output_viewer_windows_skipped_total",
          [],
          W305_SITES,
          "once per window skipped by viewer catch-up (viewer.ts)",
        ),
        histogram(
          "live_output_transit_lag_ms",
          W305_SITES,
          "deliveredAtMs − admittedAtMs per delivered window (transport.ts)",
        ),
        histogram(
          "live_output_delivery_lag_ms",
          W305_SITES,
          "deliveredAtMs − emittedAtMs per delivered window (transport.ts)",
        ),
        histogram(
          "live_output_watermark_lag_at_delivery_ms",
          W305_SITES,
          "media-time lag at delivery: newest observed watermark − window watermark (transport.ts)",
        ),
        histogram(
          "live_output_link_depth",
          W305_SITES,
          "queued windows at emission time (transport.ts)",
        ),
      ],
      telemetrySeams: [
        {
          name: "live window timing records",
          kind: "timing-record",
          packageName: "@sporta/webrtc-output",
          module: "src/telemetry.ts",
          emission:
            "per-window typed timing records (LiveWindowTimingRecord / LiveViewerArrivalRecord) " +
            "on the injected clock domain — the measurement seam the W306 benchmark consumes; " +
            "carried in the settle result, not a registry series.",
        },
        {
          name: "viewer telemetry events (schema v1)",
          kind: "event-sink",
          packageName: "@sporta/viewer-shell",
          module: "src/telemetry-events.ts",
          emission:
            "six closed event kinds (state-transition, operation-timing, error-occurred, " +
            "rebuffer-stall, integrity-verified, user-feedback) with exact-key allowlists " +
            "(privacy by construction); sinks: in-memory, node JSONL file, dev HTTP bridge " +
            "(telemetry-file-sink.ts / telemetry-http-sink.ts).",
        },
      ],
      gaps: [
        {
          id: "delivery-no-real-network",
          title: "Lag histograms measure the in-process transport seam",
          detail:
            "W305 has no real RTCPeerConnection/network ICE/STUN path (documented boundary): " +
            "transit/delivery lag characterize the in-process binding seam, not real-network " +
            "latency — the same boundary W306 states for its own measurements.",
        },
        {
          id: "delivery-no-latency-threshold-evidence",
          title: "No honest threshold exists for delivery-lag alerts",
          detail:
            "W306's controlled-fixture evidence covers pipeline stages (end-to-end p95 8849 ms " +
            "in the injected-clock domain), not the W305 transport lag histograms; defining a " +
            "delivery-lag alert threshold today would be inventing evidence. W802 (latency SLO " +
            "formalization) owns threshold setting on these seams.",
        },
        {
          id: "delivery-viewer-paint-open",
          title: "Real-browser paint E2E remains open",
          detail:
            "W706 delivered the telemetry model, not a real-browser paint E2E (documented as " +
            "open); viewer telemetry carries no rendererHealth fact — playback health is " +
            "inferred from session counters and telemetry events only.",
        },
      ],
    },
    {
      id: "infrastructure",
      title: "Infrastructure health",
      scope:
        "gpu-worker process liveness (W303 heartbeats/leases/timeouts), clock health (W103 " +
        "drift clamp), control plane (W701), stage transport (W104)",
      registrySeams: [
        counter(
          "gpu_worker_heartbeats_total",
          [],
          W303_SITES,
          "once per worker heartbeat accepted (dispatcher.ts)",
        ),
        counter(
          "gpu_worker_heartbeats_rejected_total",
          ["reason"],
          W303_SITES,
          "once per rejected heartbeat — dispatcher-ended, unknown-worker, sequence-not-monotone (dispatcher.ts)",
        ),
        counter(
          "gpu_stale_workers_total",
          [],
          W303_SITES,
          "once per staleness detection — a worker went silent (dispatcher.ts)",
        ),
        counter(
          "gpu_lease_expiries_total",
          [],
          W303_SITES,
          "once per lease expiry — worker stopped heartbeating mid-job; jobs requeued, never silently reassigned (dispatcher.ts)",
        ),
        counter(
          "gpu_late_results_total",
          [],
          W303_SITES,
          "once per result arriving after its job was superseded (dispatcher.ts)",
        ),
        counter(
          "gpu_job_timeouts_total",
          ["kind"],
          W303_SITES,
          "once per per-job deadline breach on the injected clock, labeled timeout kind (dispatcher.ts)",
        ),
        counter(
          "timeline_sync_drift_anomalies_total",
          [],
          [["@sporta/timeline", "src/sync.ts"]],
          "once per clamped drift anomaly — |driftPpm| exceeded DRIFT_CLAMP_PPM (1000), the clock-health signal",
        ),
        histogram(
          "timeline_sync_abs_drift_ppm",
          [["@sporta/timeline", "src/sync.ts"]],
          "clamped |driftPpm| observed once per measured alignment",
        ),
        counter(
          "control_requests_total",
          ["route"],
          W701_SITES,
          "once per control-plane method call, labeled route (app.ts + http.ts)",
        ),
        counter(
          "control_failures_total",
          ["failure_class"],
          W701_SITES,
          "once per failed control-plane call, labeled failure class (app.ts + http.ts)",
        ),
        counter(
          "transport_messages_total",
          ["stage", "status"],
          [["@sporta/transport", "src/runner.ts"]],
          "once per stage-message processed, labeled stage + status",
        ),
        counter(
          "transport_retries_total",
          ["stage"],
          [["@sporta/transport", "src/runner.ts"]],
          "summed retries consumed per stage-message (runner.ts)",
        ),
        counter(
          "transport_failures_total",
          ["stage", "errorClass"],
          [["@sporta/transport", "src/runner.ts"]],
          "once per retry-exhausted stage-message failure (runner.ts)",
        ),
      ],
      telemetrySeams: [
        {
          name: "gpu worker heartbeat advisory load",
          kind: "advisory-field",
          packageName: "@sporta/gpu-worker",
          module: "src/types.ts",
          emission:
            "GpuHeartbeat.inFlight + advisoryMemoryInUseMb — advisory load telemetry derived " +
            "from in-flight job requirements, never measured; travels in heartbeat records, " +
            "not on the registry (not alertable from a MetricsSnapshot).",
        },
      ],
      gaps: [
        {
          id: "infra-no-memory-series",
          title: "No measured memory-pressure metric exists",
          detail:
            "Audited: no package observes a memory/RSS/heap registry series. The only memory " +
            "signal is the advisory GpuHeartbeat.advisoryMemoryInUseMb (derived from job " +
            "requirements, never measured). Real memory-pressure telemetry is an ops backlog " +
            "item — no alert is defined (an honest threshold needs a real measurement first).",
        },
        {
          id: "infra-registry-in-memory",
          title: "The metrics registry is per-process and in-memory",
          detail:
            "@sporta/observability's MetricsRegistry (W007) keeps every series in one process " +
            "with no cross-process aggregation, persistence, or exposition endpoint — " +
            "collection, transport, and backend storage are deployment concerns (ops' world), " +
            "documented as this package's boundary, not implemented here.",
        },
        {
          id: "infra-liveness-gpu-only",
          title: "Process liveness exists only for gpu workers",
          detail:
            "The heartbeat/lease machinery (W303) is the codebase's only liveness seam, and it " +
            "covers gpu workers only — the control-api host, viewer host, and pipeline stages " +
            "have no liveness heartbeat; their 'down' state is unobservable from within.",
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Lookup helpers (pure; consistency checks build on them).
// ---------------------------------------------------------------------------

/** Every registry seam of the map, in domain order. */
export function allRegistrySeams(map: HealthDomainMap): RegistrySeam[] {
  return map.domains.flatMap((domain) => domain.registrySeams);
}

/** The registry seam with exactly `metricName`, or undefined. */
export function findRegistrySeam(
  map: HealthDomainMap,
  metricName: string,
): RegistrySeam | undefined {
  return allRegistrySeams(map).find((seam) => seam.metricName === metricName);
}

/** The domain that owns `metricName` (registry seams are globally unique). */
export function domainOfMetric(map: HealthDomainMap, metricName: string): HealthDomain | undefined {
  return map.domains.find((domain) =>
    domain.registrySeams.some((seam) => seam.metricName === metricName),
  );
}

/** The gap with `gapId`, or undefined (gap ids are globally unique). */
export function findGap(map: HealthDomainMap, gapId: string): HealthGap | undefined {
  for (const domain of map.domains) {
    const gap = domain.gaps.find((candidate) => candidate.id === gapId);
    if (gap !== undefined) return gap;
  }
  return undefined;
}
