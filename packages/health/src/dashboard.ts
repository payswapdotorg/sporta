/**
 * The DASHBOARD SPEC (W805) — a versioned, zod-validated description of
 * operational dashboards, plus a deterministic renderer that turns a spec
 * into a byte-stable definition artifact.
 *
 * This is the "dashboard-ready shape" other consumers (the W804 analytics
 * report's dashboard references; a future Grafana adapter) build on: the
 * ARTIFACT is a canonical-JSON document whose every query resolves against
 * the health domain map's real registry seams (fail-closed — a query for a
 * metric that does not exist, or a stat asked of the wrong kind, throws at
 * render time, never renders an empty panel).
 *
 * No web UI, no SVG: the spec is data, the renderer is a pure function,
 * and determinism is the contract — the same spec ALWAYS renders to
 * byte-identical artifact bytes (canonical key order, test-pinned).
 */
import { z } from "zod";
import type { HealthDomainId, HealthDomainMap, RegistrySeam } from "./domains";
import { HEALTH_DOMAIN_IDS, findRegistrySeam } from "./domains";
import { canonicalJson } from "./internal";

/** The spec's identity. */
export const DASHBOARD_SPEC_VERSION = 1 as const;

/** The artifact's identity (echoed in rendered output). */
export const DASHBOARD_ARTIFACT_VERSION = 1 as const;

/** What a metric query can read off a registry series. */
export const METRIC_QUERY_STATS = ["value", "count", "min", "max", "mean", "p50", "p95"] as const;

export type MetricQueryStat = (typeof METRIC_QUERY_STATS)[number];

/** The stat kinds that only make sense on a counter. */
const COUNTER_STATS: readonly MetricQueryStat[] = ["value"];

/** One metric series read: a registry seam + the stat to display. */
export const MetricQuerySchema = z.object({
  /** Registry metric name (must exist in the health domain map). */
  metric: z.string().regex(/^[a-z0-9_]+$/),
  stat: z.enum(METRIC_QUERY_STATS),
});

export type MetricQuery = z.infer<typeof MetricQuerySchema>;

/** A panel that reads registry metrics. */
export const MetricPanelSchema = z.object({
  kind: z.literal("metric"),
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  domain: z.enum(HEALTH_DOMAIN_IDS),
  /** `stat` = one big number; `table` = one row per query. */
  display: z.enum(["stat", "table"]),
  queries: z.array(MetricQuerySchema).min(1),
});

export type MetricPanel = z.infer<typeof MetricPanelSchema>;

/**
 * A panel that renders a domain's ROLLUP status (healthy/degraded/down/
 * unknown + reasons) — the honest panel for domains whose health is not a
 * metric (the model domain: no seams; its panel says UNKNOWN, never a
 * fabricated number).
 */
export const HealthPanelSchema = z.object({
  kind: z.literal("health"),
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  domain: z.enum(HEALTH_DOMAIN_IDS),
  /** Shown under the status (typically a pointer to the domain map's gaps). */
  detail: z.string().min(1),
});

export type HealthPanel = z.infer<typeof HealthPanelSchema>;

export const PanelSchema = z.discriminatedUnion("kind", [MetricPanelSchema, HealthPanelSchema]);

export type Panel = MetricPanel | HealthPanel;

export const DashboardSpecSchema = z.object({
  schemaVersion: z.literal(DASHBOARD_SPEC_VERSION),
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  description: z.string().min(1),
  /** Grid column count (the layout hint; the artifact carries panel order). */
  columns: z.number().int().min(1).max(4),
  panels: z.array(PanelSchema).min(1),
});

export type DashboardSpec = z.infer<typeof DashboardSpecSchema>;

// ---------------------------------------------------------------------------
// The shipped production dashboard (W805 deliverable 3): one panel-set per
// health domain, derived from the domain map — five metric panels, one
// health panel for the seam-less model domain, and one per-domain health
// strip (all six domains appear; coverage is consistency-checked).
// ---------------------------------------------------------------------------

export const PRODUCTION_DASHBOARD: DashboardSpec = {
  schemaVersion: DASHBOARD_SPEC_VERSION,
  id: "sporta-production-overview",
  title: "Sporta production overview",
  description:
    "The W805 production posture dashboard: per-domain registry metrics plus the health " +
    "rollup strip. All queries resolve against the health domain map's audited seams.",
  columns: 2,
  panels: [
    {
      kind: "metric",
      id: "media-intake",
      title: "Media intake",
      domain: "media",
      display: "table",
      queries: [
        { metric: "ingest_accepted", stat: "value" },
        { metric: "ingest_rejected_total", stat: "value" },
        { metric: "decode_frames_total", stat: "value" },
        { metric: "decode_failures_total", stat: "value" },
        { metric: "timeline_sync_alignments_total", stat: "value" },
        { metric: "timeline_sync_failures_total", stat: "value" },
        { metric: "streaming_segments_in_total", stat: "value" },
        { metric: "streaming_backpressure_events_total", stat: "value" },
      ],
    },
    {
      kind: "metric",
      id: "queue-jobs",
      title: "Queues and jobs",
      domain: "queue",
      display: "table",
      queries: [
        { metric: "processing_segments_in_total", stat: "value" },
        { metric: "processing_segments_out_total", stat: "value" },
        { metric: "processing_dead_lettered_total", stat: "value" },
        { metric: "gpu_jobs_submitted_total", stat: "value" },
        { metric: "gpu_jobs_succeeded_total", stat: "value" },
        { metric: "gpu_jobs_dead_lettered_total", stat: "value" },
        { metric: "gpu_refused_submissions_total", stat: "value" },
        { metric: "gpu_job_queue_wait_ms", stat: "p95" },
      ],
    },
    {
      kind: "metric",
      id: "renderer-pipeline",
      title: "Renderer pipeline",
      domain: "renderer",
      display: "table",
      queries: [
        { metric: "render_requests_total", stat: "value" },
        { metric: "render_failures_total", stat: "value" },
        { metric: "render_batches_in_total", stat: "value" },
        { metric: "render_batches_dropped_total", stat: "value" },
        { metric: "render_batches_skipped_stale_total", stat: "value" },
        { metric: "render_outputs_emitted_total", stat: "value" },
        { metric: "gpu_job_latency_ms", stat: "p95" },
      ],
    },
    {
      kind: "metric",
      id: "delivery-sessions",
      title: "Delivery sessions",
      domain: "delivery",
      display: "table",
      queries: [
        { metric: "live_output_windows_in_total", stat: "value" },
        { metric: "live_output_windows_delivered_total", stat: "value" },
        { metric: "live_output_windows_failed_total", stat: "value" },
        { metric: "live_output_windows_dropped_by_policy_total", stat: "value" },
        { metric: "live_output_windows_refused_total", stat: "value" },
        { metric: "live_output_viewer_reconnects_total", stat: "value" },
        { metric: "live_output_link_depth", stat: "p95" },
        { metric: "live_output_delivery_lag_ms", stat: "p95" },
      ],
    },
    {
      kind: "metric",
      id: "infrastructure-platform",
      title: "Infrastructure",
      domain: "infrastructure",
      display: "table",
      queries: [
        { metric: "gpu_worker_heartbeats_total", stat: "value" },
        { metric: "gpu_worker_heartbeats_rejected_total", stat: "value" },
        { metric: "gpu_lease_expiries_total", stat: "value" },
        { metric: "gpu_stale_workers_total", stat: "value" },
        { metric: "gpu_job_timeouts_total", stat: "value" },
        { metric: "timeline_sync_drift_anomalies_total", stat: "value" },
        { metric: "control_requests_total", stat: "value" },
        { metric: "control_failures_total", stat: "value" },
        { metric: "transport_failures_total", stat: "value" },
      ],
    },
    {
      kind: "health",
      id: "model-status",
      title: "Model health (unknown until seams exist)",
      domain: "model",
      detail:
        "No perception/world-model registry seams exist (domain-map gap model-no-runtime-seams): " +
        "this domain reports UNKNOWN — never a fabricated number.",
    },
    {
      kind: "health",
      id: "media-health",
      title: "Media health",
      domain: "media",
      detail: "Rollup status of the media domain's alerts (see the alert catalog).",
    },
    {
      kind: "health",
      id: "queue-health",
      title: "Queue health",
      domain: "queue",
      detail: "Rollup status of the queue domain's alerts (see the alert catalog).",
    },
    {
      kind: "health",
      id: "renderer-health",
      title: "Renderer health",
      domain: "renderer",
      detail: "Rollup status of the renderer domain's alerts (see the alert catalog).",
    },
    {
      kind: "health",
      id: "delivery-health",
      title: "Delivery health",
      domain: "delivery",
      detail: "Rollup status of the delivery domain's alerts (see the alert catalog).",
    },
    {
      kind: "health",
      id: "infrastructure-health",
      title: "Infrastructure health",
      domain: "infrastructure",
      detail: "Rollup status of the infrastructure domain's alerts (see the alert catalog).",
    },
  ],
};

// ---------------------------------------------------------------------------
// The deterministic renderer.
// ---------------------------------------------------------------------------

/** One resolved query in the artifact (seam provenance included). */
export interface ResolvedQuery {
  metric: string;
  stat: MetricQueryStat;
  seam: {
    kind: RegistrySeam["kind"];
    labels: string[];
    sites: Array<{ packageName: string; module: string }>;
  };
}

/** One panel of the rendered artifact. */
export interface DashboardPanelArtifact {
  kind: "metric" | "health";
  id: string;
  title: string;
  domain: HealthDomainId;
  /** Metric panels: `stat`/`table`; health panels: `status`. */
  display: string;
  /** Present iff kind = "metric". */
  queries?: ResolvedQuery[];
  /** Present iff kind = "health". */
  detail?: string;
}

/** The dashboard definition artifact (self-contained, JSON-safe, ordered). */
export interface DashboardDefinitionArtifact {
  artifactVersion: typeof DASHBOARD_ARTIFACT_VERSION;
  dashboardId: string;
  title: string;
  description: string;
  columns: number;
  panels: DashboardPanelArtifact[];
}

/**
 * Resolves one query against the domain map — fail-closed: an unknown
 * metric, or a stat asked of the wrong series kind, throws (never renders
 * an invented or empty panel).
 */
export function resolveQuery(
  map: HealthDomainMap,
  query: MetricQuery,
  context: string,
): ResolvedQuery {
  const seam = findRegistrySeam(map, query.metric);
  if (seam === undefined) {
    throw new RangeError(
      `${context}: query for metric "${query.metric}" — no such registry seam in the health ` +
        "domain map (a panel must not read a metric the codebase cannot emit)",
    );
  }
  const statIsCounterStat = (COUNTER_STATS as readonly string[]).includes(query.stat);
  if (seam.kind === "counter" && !statIsCounterStat) {
    throw new RangeError(
      `${context}: stat "${query.stat}" asked of counter "${query.metric}" — counters expose ` +
        'only the "value" stat',
    );
  }
  if (seam.kind === "histogram" && statIsCounterStat) {
    throw new RangeError(
      `${context}: stat "value" asked of histogram "${query.metric}" — histograms expose ` +
        `${METRIC_QUERY_STATS.filter((stat) => !COUNTER_STATS.includes(stat)).join(", ")}`,
    );
  }
  return {
    metric: query.metric,
    stat: query.stat,
    seam: {
      kind: seam.kind,
      labels: [...seam.labels],
      sites: seam.sites.map((site) => ({ ...site })),
    },
  };
}

/**
 * Renders a spec into its definition artifact. Deterministic: panel order
 * as authored, fixed key sets, no clock, no randomness — the same spec
 * always yields a deep-equal artifact.
 */
export function renderDashboardDefinition(
  spec: DashboardSpec,
  map: HealthDomainMap,
): DashboardDefinitionArtifact {
  const panels: DashboardPanelArtifact[] = spec.panels.map((panel, index) => {
    const context = `dashboard "${spec.id}" panel #${index} (${panel.id})`;
    if (panel.kind === "metric") {
      return {
        kind: "metric",
        id: panel.id,
        title: panel.title,
        domain: panel.domain,
        display: panel.display,
        queries: panel.queries.map((query) => resolveQuery(map, query, context)),
      };
    }
    return {
      kind: "health",
      id: panel.id,
      title: panel.title,
      domain: panel.domain,
      display: "status",
      detail: panel.detail,
    };
  });
  return {
    artifactVersion: DASHBOARD_ARTIFACT_VERSION,
    dashboardId: spec.id,
    title: spec.title,
    description: spec.description,
    columns: spec.columns,
    panels,
  };
}

/**
 * Renders the spec to canonical JSON bytes — the byte-stable artifact
 * (object keys sorted recursively; structurally-equal specs render
 * byte-identically, test-pinned).
 */
export function renderDashboardDefinitionJson(spec: DashboardSpec, map: HealthDomainMap): string {
  return canonicalJson(renderDashboardDefinition(spec, map));
}

/**
 * Renders the spec to deterministic Markdown (the human-readable artifact):
 * one section per panel, in authored order, with seam provenance.
 */
export function renderDashboardMarkdown(spec: DashboardSpec, map: HealthDomainMap): string {
  const lines: string[] = [
    `# ${spec.title}`,
    "",
    spec.description,
    "",
    `Columns: ${spec.columns} · Panels: ${spec.panels.length}`,
    "",
  ];
  for (const panel of spec.panels) {
    lines.push(`## ${panel.title}`, "");
    lines.push(`- Panel: \`${panel.id}\` · Domain: \`${panel.domain}\``);
    if (panel.kind === "metric") {
      lines.push(`- Display: ${panel.display}`);
      lines.push("- Queries:");
      for (const query of panel.queries) {
        const resolved = resolveQuery(map, query, `dashboard "${spec.id}" panel (${panel.id})`);
        const sites = resolved.seam.sites
          .map((site) => `${site.packageName} ${site.module}`)
          .join("; ");
        const labelNote =
          resolved.seam.labels.length === 0 ? "" : ` (labels: ${resolved.seam.labels.join(", ")})`;
        lines.push(
          `  - \`${resolved.metric}\` → ${resolved.stat} — ${resolved.seam.kind}${labelNote} — ${sites}`,
        );
      }
    } else {
      lines.push(`- Display: status (health rollup)`);
      lines.push(`- ${panel.detail}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
