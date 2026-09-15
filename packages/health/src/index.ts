/**
 * @sporta/health — the W805 production-observability POSTURE package.
 *
 * The honest observability posture of a deterministic pipeline monorepo
 * with NO deployed infrastructure: this package ships the DEFINITIONS and
 * the pure EVALUATION MACHINERY — not a running Grafana, not a collector,
 * not a metric exfil path (those are ops' world; documented as the
 * boundary in docs/observability/PRODUCTION.md §9).
 *
 * Module map:
 *
 * - `domains` — the HEALTH DOMAIN MAP: the normative, zod-validated,
 *   versioned inventory of every registry seam (metric name + package +
 *   module + labels) the codebase can honestly emit today, per domain
 *   (media, queue, model, renderer, delivery, infrastructure), plus the
 *   audited GAPS (health facts that cannot be emitted — listed, never
 *   invented)
 * - `alerts` — the ALERT CATALOG: machine-readable, zod-validated,
 *   versioned alert definitions (domain + metric seam + threshold
 *   expression + severity + documented derivation + runbook pointer)
 * - `evaluate` — the pure evaluation engine: (alert, MetricsSnapshot) →
 *   firing | ok | no-data (absent metrics are `no-data`, never healthy —
 *   the never-silent posture)
 * - `rollup` — the health rollup: per-domain health from verdicts, then
 *   the overall posture (down > degraded > unknown > healthy; a domain
 *   with no evidence is UNKNOWN, never silently healthy)
 * - `dashboard` — the DASHBOARD SPEC schema, the shipped production
 *   dashboard, and the deterministic byte-stable definition-artifact
 *   renderer (canonical JSON + Markdown; the W804 analytics seam)
 * - `consistency` — fail-closed cross-artifact checks: no alert or panel
 *   may reference a metric seam that does not exist or has the wrong kind
 *   (the W802 mapping-consistency precedent)
 *
 * The snapshot shape consumed everywhere is `MetricsSnapshot` from
 * `@sporta/observability` (W007) — the foundation this package builds on.
 */
export {
  HEALTH_DOMAIN_MAP_VERSION,
  HEALTH_DOMAIN_IDS,
  HEALTH_DOMAIN_MAP,
  HealthDomainMapSchema,
  HealthDomainSchema,
  RegistrySeamSchema,
  TelemetrySeamSchema,
  SeamSiteSchema,
  HealthGapSchema,
  allRegistrySeams,
  domainOfMetric,
  findGap,
  findRegistrySeam,
  type HealthDomain,
  type HealthDomainId,
  type HealthDomainMap,
  type HealthGap,
  type RegistrySeam,
  type SeamSite,
  type TelemetrySeam,
} from "./domains";
export {
  ALERT_CATALOG_VERSION,
  ALERT_SEVERITIES,
  ALERT_CATALOG,
  AlertCatalogSchema,
  AlertDefinitionSchema,
  ThresholdExprSchema,
  alertIds,
  findAlert,
  type AlertCatalog,
  type AlertDefinition,
  type ThresholdExpr,
} from "./alerts";
export {
  ALERT_EVAL_STATUSES,
  evaluateAlert,
  evaluateCatalog,
  type AlertEvalStatus,
  type AlertVerdict,
  type CatalogEvaluation,
} from "./evaluate";
export {
  HEALTH_STATUSES,
  domainHealthFromVerdicts,
  postureFromSnapshot,
  rollupHealth,
  type DomainHealth,
  type HealthRollup,
  type HealthStatus,
  type SnapshotPosture,
} from "./rollup";
export {
  DASHBOARD_SPEC_VERSION,
  DASHBOARD_ARTIFACT_VERSION,
  METRIC_QUERY_STATS,
  PRODUCTION_DASHBOARD,
  DashboardSpecSchema,
  MetricQuerySchema,
  MetricPanelSchema,
  HealthPanelSchema,
  PanelSchema,
  renderDashboardDefinition,
  renderDashboardDefinitionJson,
  renderDashboardMarkdown,
  resolveQuery,
  type DashboardDefinitionArtifact,
  type DashboardPanelArtifact,
  type DashboardSpec,
  type HealthPanel,
  type MetricPanel,
  type MetricQuery,
  type MetricQueryStat,
  type Panel,
  type ResolvedQuery,
} from "./dashboard";
export {
  HealthConsistencyError,
  checkAlertCatalog,
  checkDashboard,
  checkDomainMap,
  checkPostureConsistency,
  type ConsistencyViolation,
} from "./consistency";
