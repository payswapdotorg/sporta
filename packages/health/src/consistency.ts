/**
 * Fail-closed CONSISTENCY CHECKS (W805) — the W802 mapping-consistency
 * precedent applied to the whole posture: no artifact may reference a
 * metric seam that does not exist, with the wrong kind, or outside its
 * domain. Every check throws `HealthConsistencyError` carrying ALL
 * violations found (fail loud, fail complete — never a partial report).
 */
import type { AlertCatalog } from "./alerts";
import type { DashboardSpec, MetricQuery } from "./dashboard";
import { resolveQuery } from "./dashboard";
import type { HealthDomainMap, RegistrySeam } from "./domains";
import { allRegistrySeams, findRegistrySeam } from "./domains";

/** One consistency violation (machine-readable). */
export interface ConsistencyViolation {
  /** Where the violation was found (alert id / panel id / map). */
  source: string;
  /** What is wrong (a complete sentence). */
  problem: string;
}

/** Thrown when the posture's artifacts disagree with the domain map. */
export class HealthConsistencyError extends Error {
  readonly violations: readonly ConsistencyViolation[];

  constructor(violations: readonly ConsistencyViolation[]) {
    super(
      violations.length === 0
        ? "HealthConsistencyError (no violations — do not throw empty)"
        : `health posture consistency check failed (${violations.length} violation(s)):\n` +
            violations.map((violation) => `- [${violation.source}] ${violation.problem}`).join("\n"),
    );
    this.name = "HealthConsistencyError";
    this.violations = violations;
  }
}

/** Throws iff the domain map itself is internally inconsistent. */
export function checkDomainMap(map: HealthDomainMap): void {
  const violations: ConsistencyViolation[] = [];
  const seams = allRegistrySeams(map);
  const seen = new Map<string, number>();
  for (const seam of seams) {
    const count = seen.get(seam.metricName) ?? 0;
    seen.set(seam.metricName, count + 1);
  }
  for (const [metricName, count] of seen) {
    if (count > 1) {
      violations.push({
        source: `domain-map:${metricName}`,
        problem: `registry metric name declared by ${count} seams — metric names must be globally unique (alert/dashboard resolution is by name)`,
      });
    }
  }
  const seamIds = map.domains.flatMap((domain) =>
    domain.registrySeams.map((_, index) => `${domain.id}#${index}`),
  );
  if (seams.length !== seamIds.length) {
    // Defensive: flatMap is total; kept fail-loud anyway.
    violations.push({
      source: "domain-map",
      problem: `internal seam enumeration mismatch (${seams.length} vs ${seamIds.length})`,
    });
  }
  if (violations.length > 0) throw new HealthConsistencyError(violations);
}

/** Throws iff any alert references a missing or kind-mismatched metric. */
export function checkAlertCatalog(catalog: AlertCatalog, map: HealthDomainMap): void {
  const violations: ConsistencyViolation[] = [];
  const ids = new Set<string>();
  for (const alert of catalog.alerts) {
    if (ids.has(alert.id)) {
      violations.push({
        source: `alert:${alert.id}`,
        problem: "duplicate alert id",
      });
    }
    ids.add(alert.id);
    const expression = alert.expression;
    const referenced: Array<[string, RegistrySeam["kind"]]> =
      expression.kind === "counter-ratio-above"
        ? [
            [expression.numerator, "counter"],
            [expression.denominator, "counter"],
          ]
        : expression.kind === "counter-above"
          ? [[expression.metric, "counter"]]
          : [[expression.metric, "histogram"]];
    for (const [metricName, expectedKind] of referenced) {
      const seam = findRegistrySeam(map, metricName);
      if (seam === undefined) {
        violations.push({
          source: `alert:${alert.id}`,
          problem: `expression references metric "${metricName}" — no such registry seam in the health domain map (alerts may only evaluate real seams)`,
        });
        continue;
      }
      if (seam.kind !== expectedKind) {
        violations.push({
          source: `alert:${alert.id}`,
          problem: `expression needs a ${expectedKind} seam but "${metricName}" is a ${seam.kind}`,
        });
      }
    }
    const domain = map.domains.find((candidate) => candidate.id === alert.domain);
    if (domain === undefined) {
      violations.push({
        source: `alert:${alert.id}`,
        problem: `references unknown domain "${alert.domain}"`,
      });
    }
  }
  if (violations.length > 0) throw new HealthConsistencyError(violations);
}

/**
 * Throws iff a dashboard spec references missing/kind-mismatched metrics,
 * duplicates panel ids, or drops a health domain from its coverage (the
 * W805 accept criterion: dashboards cover ALL six domains).
 */
export function checkDashboard(spec: DashboardSpec, map: HealthDomainMap): void {
  const violations: ConsistencyViolation[] = [];
  const ids = new Set<string>();
  for (const panel of spec.panels) {
    if (ids.has(panel.id)) {
      violations.push({ source: `dashboard:${spec.id}`, problem: `duplicate panel id "${panel.id}"` });
    }
    ids.add(panel.id);
    if (panel.kind === "metric") {
      panel.queries.forEach((query: MetricQuery) => {
        try {
          resolveQuery(map, query, `dashboard "${spec.id}" panel (${panel.id})`);
        } catch (error) {
          violations.push({
            source: `dashboard:${spec.id}:panel:${panel.id}`,
            problem: error instanceof Error ? error.message : String(error),
          });
        }
      });
    }
  }
  const covered = new Set(spec.panels.map((panel) => panel.domain));
  for (const domain of map.domains) {
    if (!covered.has(domain.id)) {
      violations.push({
        source: `dashboard:${spec.id}`,
        problem: `health domain "${domain.id}" has no panel — dashboards must cover every domain (W805 accept criterion)`,
      });
    }
  }
  if (violations.length > 0) throw new HealthConsistencyError(violations);
}

/**
 * The whole-posture check: domain map + alert catalog + every dashboard
 * spec, mutually consistent. Runs in the package's own test suite over the
 * shipped artifacts; exported for ops to re-verify any future posture edit.
 */
export function checkPostureConsistency(input: {
  map: HealthDomainMap;
  catalog: AlertCatalog;
  dashboards: readonly DashboardSpec[];
}): void {
  checkDomainMap(input.map);
  checkAlertCatalog(input.catalog, input.map);
  for (const spec of input.dashboards) {
    checkDashboard(spec, input.map);
  }
}
