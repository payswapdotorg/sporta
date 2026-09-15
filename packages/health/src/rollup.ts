/**
 * The HEALTH ROLLUP (W805) — the pure aggregation from per-domain health to
 * the platform posture.
 *
 * The status lattice, WORST-FIRST (the never-silent ordering):
 *
 *   down > degraded > unknown > healthy
 *
 * - any domain `down` (a critical alert firing) ⇒ overall `down`;
 * - any domain `degraded` ⇒ overall `degraded`;
 * - any domain `unknown` ⇒ overall `unknown` — a domain whose health cannot
 *   be observed can never contribute to an overall `healthy` verdict (the
 *   model domain today: no seams exist, its health is unknown by
 *   construction, and the rollup says so instead of assuming health);
 * - `healthy` requires EVERY domain healthy.
 *
 * Inputs are never mutated (pure); reasons are deterministic strings in
 * domain order. All functions fail loud on malformed input (duplicate,
 * missing, or foreign domains) rather than guessing.
 */
import type { HealthDomainId } from "./domains";
import { HEALTH_DOMAIN_IDS } from "./domains";
import type { AlertCatalog } from "./alerts";
import type { MetricsSnapshot } from "@sporta/observability";
import type { AlertVerdict } from "./evaluate";
import { evaluateCatalog } from "./evaluate";

/** The four-valued health status (never-silent: `unknown` is a real value). */
export const HEALTH_STATUSES = ["healthy", "degraded", "down", "unknown"] as const;

export type HealthStatus = (typeof HEALTH_STATUSES)[number];

/** Worst-first severity of a status (higher = worse). */
const STATUS_RANK: Record<HealthStatus, number> = {
  healthy: 0,
  unknown: 1,
  degraded: 2,
  down: 3,
};

/** One domain's health. */
export interface DomainHealth {
  domain: HealthDomainId;
  status: HealthStatus;
  /** Deterministic, human-readable explanations (may be empty when healthy). */
  reasons: string[];
}

/** The overall posture. */
export interface HealthRollup {
  status: HealthStatus;
  /** Every domain, in HEALTH_DOMAIN_IDS order (all six, always). */
  domains: DomainHealth[];
  /** Union of the firing/no-data reasons, in domain order. */
  reasons: string[];
}

/**
 * Derives one domain's health from its alert verdicts. All verdicts must
 * belong to the same domain (fail loud otherwise — a mixed-domain input is
 * a caller bug, not a guessable posture).
 *
 * Truth table (pinned by test):
 *
 * | critical firing | warning firing | no-data | => status |
 * |-----------------|----------------|---------|-----------|
 * | yes             | any            | any     | down      |
 * | no              | yes            | any     | degraded |
 * | no              | no             | any     | unknown   |
 * | no              | no             | no      | healthy  |
 *
 * An EMPTY verdict list is `unknown` — a domain with no evaluated alerts
 * has no evidence of health (the model domain today).
 */
export function domainHealthFromVerdicts(
  domain: HealthDomainId,
  verdicts: readonly AlertVerdict[],
): DomainHealth {
  const reasons: string[] = [];
  for (const entry of verdicts) {
    if (entry.domain !== domain) {
      throw new RangeError(
        `domainHealthFromVerdicts("${domain}") received verdict of domain "${entry.domain}" ` +
          `(alert "${entry.alertId}") — group verdicts by domain before rolling up`,
      );
    }
  }
  let criticalFiring = false;
  let warningFiring = false;
  const firing: string[] = [];
  const noData: string[] = [];
  for (const entry of verdicts) {
    if (entry.status === "firing") {
      firing.push(`${entry.alertId} (${entry.severity}) firing: ${entry.observed}`);
      if (entry.severity === "critical") criticalFiring = true;
      else warningFiring = true;
    } else if (entry.status === "no-data") {
      noData.push(`${entry.alertId}: ${entry.observed}`);
    }
  }
  let status: HealthStatus;
  if (criticalFiring) {
    status = "down";
  } else if (warningFiring) {
    status = "degraded";
  } else if (noData.length > 0) {
    status = "unknown";
  } else if (verdicts.length === 0) {
    status = "unknown";
  } else {
    status = "healthy";
  }
  reasons.push(...firing, ...noData);
  if (verdicts.length === 0) {
    reasons.push(
      `no alert evaluated for domain "${domain}" — no alertable evidence (see the domain map's ` +
        `seams and gaps)`,
    );
  }
  return { domain, status, reasons };
}

/**
 * Rolls per-domain health up into the overall posture. Requires EXACTLY the
 * six health domains, each once — a missing, duplicated, or foreign domain
 * throws (fail-closed: an incomplete rollup must never claim a posture).
 */
export function rollupHealth(domains: readonly DomainHealth[]): HealthRollup {
  const seen = new Set<HealthDomainId>();
  for (const entry of domains) {
    if (seen.has(entry.domain)) {
      throw new RangeError(`rollupHealth received domain "${entry.domain}" more than once`);
    }
    if (!HEALTH_DOMAIN_IDS.includes(entry.domain)) {
      throw new RangeError(
        `rollupHealth received unknown domain "${String(entry.domain)}" ` +
          `(expected one of ${HEALTH_DOMAIN_IDS.join(", ")})`,
      );
    }
    seen.add(entry.domain);
  }
  for (const expected of HEALTH_DOMAIN_IDS) {
    if (!seen.has(expected)) {
      throw new RangeError(`rollupHealth is missing domain "${expected}"`);
    }
  }
  const ordered = HEALTH_DOMAIN_IDS.map(
    (domain) => domains.find((entry) => entry.domain === domain) as DomainHealth, // presence proven above
  );
  let status: HealthStatus = "healthy";
  for (const entry of ordered) {
    if (STATUS_RANK[entry.status] > STATUS_RANK[status]) {
      status = entry.status;
    }
  }
  const reasons: string[] = [];
  for (const entry of ordered) {
    for (const reason of entry.reasons) {
      reasons.push(`[${entry.domain}] ${reason}`);
    }
  }
  return { status, domains: ordered, reasons };
}

/** The full honest pipeline's result (rollup + the verdicts behind it). */
export interface SnapshotPosture {
  /** The overall posture (see {@link rollupHealth}). */
  rollup: HealthRollup;
  /** Every alert verdict, in catalog order (the evidence). */
  verdicts: AlertVerdict[];
}

/**
 * The one-call honest posture: evaluate every alert of `catalog` against
 * `snapshot`, derive each domain's health from its verdicts (a domain with
 * zero alerts is `unknown` — never silently healthy), and roll up.
 */
export function postureFromSnapshot(
  catalog: AlertCatalog,
  snapshot: MetricsSnapshot,
): SnapshotPosture {
  const evaluation = evaluateCatalog(catalog, snapshot);
  const domains = HEALTH_DOMAIN_IDS.map((domain) =>
    domainHealthFromVerdicts(
      domain,
      evaluation.verdicts.filter((entry) => entry.domain === domain),
    ),
  );
  return { rollup: rollupHealth(domains), verdicts: evaluation.verdicts };
}
