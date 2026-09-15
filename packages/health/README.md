# @sporta/health — the production observability posture (W805)

The M7 production-observability package. **Acceptance
(docs/work-items/work-items.md W805):** "dashboards/alerts cover media, queue,
model, renderer, delivery, and infrastructure health."

Delivered at the **no-deployed-infrastructure posture**: this monorepo has no
Prometheus, no Grafana, no collectors, no metric exfiltration — every metric
lives in a per-process in-memory `MetricsRegistry` (W007). The honest W805
deliverable is therefore the **definitions and the pure evaluation machinery**:

- the **health domain map** (`src/domains.ts`) — the audited, zod-validated,
  versioned inventory of every registry seam (metric name + package + module +
  labels + emission meaning) the codebase can honestly emit today, per domain
  (media, queue, model, renderer, delivery, infrastructure), plus the audited
  **gaps** (health facts that cannot be emitted — listed, never invented);
- the **alert catalog** (`src/alerts.ts`) — 24 machine-readable, zod-validated
  alert definitions (domain + metric seam + threshold expression + severity +
  documented derivation + runbook pointer), thresholds derived from code
  semantics (zero-tolerance on never-silent counters) or from W306's
  controlled-fixture evidence (the two percentile alerts), never invented;
- the **evaluation engine** (`src/evaluate.ts`) — pure:
  (alert, `MetricsSnapshot`) → `firing | ok | no-data`; absence of evidence is
  `no-data`, never health;
- the **health rollup** (`src/rollup.ts`) — pure: per-domain health from
  verdicts, then the overall posture over the worst-first lattice
  `down > degraded > unknown > healthy` (a seam-less domain — model today — is
  `unknown`, never silently healthy);
- the **dashboard spec + renderer** (`src/dashboard.ts`) — a versioned,
  zod-validated panel description (panels = title/domain/queries/layout) and
  a deterministic **byte-stable** definition-artifact renderer (canonical JSON
  + Markdown, seam provenance embedded, fail-closed query resolution);
- the **consistency checks** (`src/consistency.ts`) — fail-closed:
  no alert or panel may reference a metric seam that does not exist or has
  the wrong kind; dashboards must cover all six domains.

The normative document is
[`docs/observability/PRODUCTION.md`](../../docs/observability/PRODUCTION.md)
(code-pinned row-for-row against `src/domains.ts` and `src/alerts.ts` by
test — the W503 THRESHOLDS.md both-directions precedent).

```
MetricsRegistry.snapshot()  (@sporta/observability, W007)   ← the only input
  └─ evaluateCatalog(ALERT_CATALOG, snapshot)
       └─ 24 verdicts: firing | ok | no-data   (absent metric ⇒ no-data)
            └─ domainHealthFromVerdicts, per domain
                 └─ critical firing ⇒ down; warning ⇒ degraded;
                    any no-data ⇒ unknown; none ⇒ healthy
                      └─ rollupHealth: worst domain wins
                           └─ postureFromSnapshot = the one-call pipeline

HEALTH_DOMAIN_MAP (84 audited seams + gaps)  ← the truth source
  └─ checkAlertCatalog / checkDashboard / checkPostureConsistency
       (fail-closed: alerts and panels may only read real seams)

PRODUCTION_DASHBOARD (spec v1: 5 metric panels + 6 health panels)
  └─ renderDashboardDefinitionJson / Markdown (byte-stable, fail-closed)
```

Runtime dependencies are workspace-only (`@sporta/observability`) plus the
sanctioned `zod` (the `@sporta/contracts` precedent). No web UI, no SVG, no
clocks, no randomness — the dashboard artifact is data.

## 1. The honest boundary (what this is NOT)

- **Not a running observability backend.** No collector, no exposition
  endpoint, no cross-process aggregation, no persistence, no alert
  notification path. Those are ops' world; this package ships the
  definitions and the pure machinery they would evaluate
  (PRODUCTION.md §9). An ops-side OpenTelemetry adapter would consume the
  same `snapshot()` seam this package consumes — nothing here blocks it and
  nothing here pretends it exists.
- **No invented metrics.** Every seam in the map is a literal in the emitting
  package's source, pinned by test in BOTH directions: map → source (the
  literal exists) and source → map (every `*_METRIC_NAMES` vocabulary entry
  is a map seam, or a documented declared-but-never-observed exception tied
  to a map gap — `render_batches_rendered_total`).
- **The model domain is unobservable at runtime.** No model-domain package
  emits a registry seam today (map gap `model-no-runtime-seams`); the domain
  has zero alerts and rolls up `unknown` — never silently healthy.
- **Latency thresholds are algorithmic, not wall-clock.** The two percentile
  alerts carry W306-derived candidate thresholds in the injected-clock
  domain, on metric-generic seams; W802 (latency SLOs) owns the formal SLO
  layer and its thresholds slot onto the same seams.
- **Memory pressure has no alert.** No package observes a measured
  memory series (map gap `infra-no-memory-series`) — an honest threshold
  needs a real measurement first.

## 2. Package map

| module | contents |
| --- | --- |
| `src/domains.ts` | `HEALTH_DOMAIN_MAP` (84 seams, 6 domains, gaps), schemas, lookup helpers |
| `src/alerts.ts` | `ALERT_CATALOG` (24 alerts, 2 severities, threshold-expression grammar), schemas |
| `src/evaluate.ts` | `evaluateAlert` / `evaluateCatalog` — pure verdicts + never-silent counts |
| `src/rollup.ts` | `domainHealthFromVerdicts` / `rollupHealth` / `postureFromSnapshot` |
| `src/dashboard.ts` | `PRODUCTION_DASHBOARD`, spec schemas, deterministic JSON/Markdown renderers, fail-closed `resolveQuery` |
| `src/consistency.ts` | `checkDomainMap` / `checkAlertCatalog` / `checkDashboard` / `checkPostureConsistency` — `HealthConsistencyError` carries ALL violations |
| `src/internal.ts` | `canonicalJson` (sorted-key serializer behind the byte-stable artifacts) + fail-loud guards |

## 3. Using it

```ts
import {
  postureFromSnapshot,
  ALERT_CATALOG,
  renderDashboardDefinitionJson,
  PRODUCTION_DASHBOARD,
  HEALTH_DOMAIN_MAP,
  checkPostureConsistency,
} from "@sporta/health";

// The honest posture of one registry snapshot:
const posture = postureFromSnapshot(ALERT_CATALOG, registry.snapshot());
// posture.rollup.status: "healthy" | "degraded" | "down" | "unknown"
// posture.rollup.domains: one DomainHealth per domain, with reasons

// The dashboard definition artifact (byte-stable):
const artifactJson = renderDashboardDefinitionJson(PRODUCTION_DASHBOARD, HEALTH_DOMAIN_MAP);

// Fail-closed: throws HealthConsistencyError listing every violation.
checkPostureConsistency({
  map: HEALTH_DOMAIN_MAP,
  catalog: ALERT_CATALOG,
  dashboards: [PRODUCTION_DASHBOARD],
});
```

## 4. Testing

`bun test packages/health` — 91 tests: alert fire/no-fire boundary cases per
expression kind, the rollup truth table (all-healthy, each-domain-degraded,
each-domain-down, unknown propagation, precedence, fail-closed inputs),
dashboard determinism (byte-identical across calls and key orders), schema
validation, mapping consistency (with teeth tests per violation class),
the source reality pins, the vocabulary-completeness pins, the doc pins
against PRODUCTION.md, and the boundary/constitution source scans
(zero `Math.random`/`Date.now`/`performance.now`/`new Date` in `src`).
