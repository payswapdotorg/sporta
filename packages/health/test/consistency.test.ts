/**
 * The consistency-check pins (fail-closed): the shipped posture passes, and
 * every class of violation throws `HealthConsistencyError` naming its source
 * — the W802 mapping-consistency precedent with teeth.
 */
import { describe, expect, test } from "bun:test";
import { ALERT_CATALOG, type AlertCatalog, type AlertDefinition } from "../src/alerts";
import { HEALTH_DOMAIN_MAP, type HealthDomainMap } from "../src/domains";
import { PRODUCTION_DASHBOARD, type DashboardSpec } from "../src/dashboard";
import {
  HealthConsistencyError,
  checkAlertCatalog,
  checkDashboard,
  checkDomainMap,
  checkPostureConsistency,
} from "../src/consistency";

function cloneCatalog(mutate: (alerts: AlertDefinition[]) => void): AlertCatalog {
  const alerts = ALERT_CATALOG.alerts.map((alert) => ({
    ...alert,
    expression: { ...alert.expression },
  }));
  mutate(alerts);
  return { schemaVersion: ALERT_CATALOG.schemaVersion, alerts };
}

describe("the shipped posture is consistent", () => {
  test("map + catalog + dashboard pass the whole-posture check", () => {
    expect(() =>
      checkPostureConsistency({
        map: HEALTH_DOMAIN_MAP,
        catalog: ALERT_CATALOG,
        dashboards: [PRODUCTION_DASHBOARD],
      }),
    ).not.toThrow();
  });
});

describe("checkAlertCatalog — teeth", () => {
  test("an alert referencing a non-existent metric throws, naming the alert and the metric", () => {
    const catalog = cloneCatalog((alerts) => {
      alerts[0]!.expression = { kind: "counter-above", metric: "not_a_real_metric", threshold: 0 };
    });
    expect(() => checkAlertCatalog(catalog, HEALTH_DOMAIN_MAP)).toThrow(HealthConsistencyError);
    try {
      checkAlertCatalog(catalog, HEALTH_DOMAIN_MAP);
      throw new Error("unreachable");
    } catch (error) {
      expect(error).toBeInstanceOf(HealthConsistencyError);
      const violations = (error as HealthConsistencyError).violations;
      expect(violations.length).toBeGreaterThanOrEqual(1);
      expect(violations[0]!.source).toContain(ALERT_CATALOG.alerts[0]!.id);
      expect(violations[0]!.problem).toContain("not_a_real_metric");
    }
  });

  test("a counter expression on a histogram seam throws (kind mismatch)", () => {
    const catalog = cloneCatalog((alerts) => {
      alerts[0]!.expression = {
        kind: "counter-above",
        metric: "gpu_job_queue_wait_ms", // a real seam — but a histogram
        threshold: 0,
      };
    });
    expect(() => checkAlertCatalog(catalog, HEALTH_DOMAIN_MAP)).toThrow(HealthConsistencyError);
  });

  test("a ratio alert with an unknown denominator throws; a duplicate alert id throws", () => {
    const badRatio = cloneCatalog((alerts) => {
      alerts[0]!.expression = {
        kind: "counter-ratio-above",
        numerator: "gpu_jobs_failed_total",
        denominator: "also_not_a_real_metric",
        threshold: 0.5,
      };
    });
    expect(() => checkAlertCatalog(badRatio, HEALTH_DOMAIN_MAP)).toThrow(HealthConsistencyError);

    const duplicated = cloneCatalog((alerts) => {
      alerts[1] = { ...alerts[0]! };
    });
    expect(() => checkAlertCatalog(duplicated, HEALTH_DOMAIN_MAP)).toThrow(HealthConsistencyError);
  });

  test("an alert claiming a domain outside the map fails loud", () => {
    const catalog = cloneCatalog((alerts) => {
      alerts[0] = { ...alerts[0]!, domain: "spiritual" as AlertDefinition["domain"] };
    });
    expect(() => checkAlertCatalog(catalog, HEALTH_DOMAIN_MAP)).toThrow(HealthConsistencyError);
  });

  test("ALL violations are reported at once, not just the first", () => {
    const catalog = cloneCatalog((alerts) => {
      alerts[0]!.expression = { kind: "counter-above", metric: "not_a_real_metric", threshold: 0 };
      alerts[1]!.expression = { kind: "counter-above", metric: "also_not_real", threshold: 0 };
    });
    try {
      checkAlertCatalog(catalog, HEALTH_DOMAIN_MAP);
      throw new Error("unreachable");
    } catch (error) {
      expect(error).toBeInstanceOf(HealthConsistencyError);
      expect((error as HealthConsistencyError).violations.length).toBe(2);
      expect((error as HealthConsistencyError).message).toContain("not_a_real_metric");
      expect((error as HealthConsistencyError).message).toContain("also_not_real");
    }
  });
});

describe("checkDashboard — teeth", () => {
  function cloneSpec(mutate: (spec: DashboardSpec) => void): DashboardSpec {
    const spec: DashboardSpec = JSON.parse(JSON.stringify(PRODUCTION_DASHBOARD));
    mutate(spec);
    return spec;
  }

  test("a panel querying a non-existent metric throws", () => {
    const spec = cloneSpec((draft) => {
      const panel = draft.panels.find((candidate) => candidate.kind === "metric");
      if (panel?.kind !== "metric") throw new Error("fixture broken");
      panel.queries[0] = { metric: "not_a_real_metric", stat: "value" };
    });
    expect(() => checkDashboard(spec, HEALTH_DOMAIN_MAP)).toThrow(HealthConsistencyError);
  });

  test("a dashboard dropping a health domain throws (coverage is the accept criterion)", () => {
    const spec = cloneSpec((draft) => {
      draft.panels = draft.panels.filter((panel) => panel.domain !== "model");
    });
    expect(() => checkDashboard(spec, HEALTH_DOMAIN_MAP)).toThrow(HealthConsistencyError);
    try {
      checkDashboard(spec, HEALTH_DOMAIN_MAP);
      throw new Error("unreachable");
    } catch (error) {
      expect((error as HealthConsistencyError).message).toContain("model");
      expect((error as HealthConsistencyError).message).toContain("no panel");
    }
  });

  test("duplicate panel ids throw", () => {
    const spec = cloneSpec((draft) => {
      const panel = draft.panels[0]!;
      draft.panels[1] = { ...panel };
    });
    expect(() => checkDashboard(spec, HEALTH_DOMAIN_MAP)).toThrow(HealthConsistencyError);
  });
});

describe("checkDomainMap — teeth", () => {
  test("a duplicate registry metric name across domains throws", () => {
    const map: HealthDomainMap = JSON.parse(JSON.stringify(HEALTH_DOMAIN_MAP));
    const media = map.domains.find((domain) => domain.id === "media")!;
    const queue = map.domains.find((domain) => domain.id === "queue")!;
    // duplicate ingest_accepted into the queue domain
    queue.registrySeams.push({ ...media.registrySeams[0]!, emission: "duplicated for teeth" });
    expect(() => checkDomainMap(map)).toThrow(HealthConsistencyError);
  });

  test("the shipped map passes", () => {
    expect(() => checkDomainMap(HEALTH_DOMAIN_MAP)).not.toThrow();
  });
});
