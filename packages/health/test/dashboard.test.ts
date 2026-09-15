/**
 * The dashboard pins: spec validity, byte-stable deterministic rendering
 * (same spec → byte-identical artifact, including key-order independence),
 * fail-closed query resolution, domain coverage (the W805 accept
 * criterion), and the Markdown artifact.
 */
import { describe, expect, test } from "bun:test";
import {
  DashboardSpecSchema,
  PRODUCTION_DASHBOARD,
  renderDashboardDefinition,
  renderDashboardDefinitionJson,
  renderDashboardMarkdown,
  resolveQuery,
  type DashboardSpec,
} from "../src/dashboard";
import { HEALTH_DOMAIN_MAP, HEALTH_DOMAIN_IDS } from "../src/domains";
import { canonicalJson } from "../src/internal";

describe("the shipped production dashboard — spec validity and coverage", () => {
  test("the spec parses against its zod schema", () => {
    expect(() => DashboardSpecSchema.parse(PRODUCTION_DASHBOARD)).not.toThrow();
  });

  test("every health domain is covered by at least one panel (the accept criterion)", () => {
    const covered = new Set(PRODUCTION_DASHBOARD.panels.map((panel) => panel.domain));
    for (const domain of HEALTH_DOMAIN_IDS) {
      expect(covered.has(domain), `domain ${domain} has no panel`).toBe(true);
    }
    expect(PRODUCTION_DASHBOARD.panels.map((panel) => panel.id)).toEqual(
      PRODUCTION_DASHBOARD.panels.map((panel) => panel.id),
    );
    // and no duplicate panel ids:
    const ids = PRODUCTION_DASHBOARD.panels.map((panel) => panel.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  test("the model domain is covered by an honest health panel, not a fabricated metric panel", () => {
    const modelPanel = PRODUCTION_DASHBOARD.panels.find((panel) => panel.domain === "model");
    expect(modelPanel).toBeDefined();
    expect(modelPanel?.kind).toBe("health");
    if (modelPanel?.kind !== "health") throw new Error("fixture broken: model panel is not a health panel");
    expect(modelPanel.detail).toContain("UNKNOWN");
  });

  test("panel count and composition are pinned", () => {
    expect(PRODUCTION_DASHBOARD.panels).toHaveLength(11);
    expect(PRODUCTION_DASHBOARD.panels.filter((panel) => panel.kind === "metric")).toHaveLength(5);
    expect(PRODUCTION_DASHBOARD.panels.filter((panel) => panel.kind === "health")).toHaveLength(6);
  });
});

describe("deterministic rendering — byte-stability", () => {
  test("the same spec renders to byte-identical JSON, twice (same call site)", () => {
    const first = renderDashboardDefinitionJson(PRODUCTION_DASHBOARD, HEALTH_DOMAIN_MAP);
    const second = renderDashboardDefinitionJson(PRODUCTION_DASHBOARD, HEALTH_DOMAIN_MAP);
    expect(first).toBe(second);
  });

  test("a structurally-equal spec built with different key order renders identical bytes", () => {
    const original = renderDashboardDefinitionJson(PRODUCTION_DASHBOARD, HEALTH_DOMAIN_MAP);
    // canonicalize → parse: every object's keys are now in sorted order,
    // a different insertion order than the authored spec
    const reordered = JSON.parse(canonicalJson(PRODUCTION_DASHBOARD)) as unknown as DashboardSpec;
    expect(() => DashboardSpecSchema.parse(reordered)).not.toThrow();
    const reorderedRender = renderDashboardDefinitionJson(reordered, HEALTH_DOMAIN_MAP);
    expect(reorderedRender).toBe(original);
  });

  test("the artifact is valid JSON that round-trips to a deep-equal artifact", () => {
    const artifact = renderDashboardDefinition(PRODUCTION_DASHBOARD, HEALTH_DOMAIN_MAP);
    const json = renderDashboardDefinitionJson(PRODUCTION_DASHBOARD, HEALTH_DOMAIN_MAP);
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(artifact)));
    expect(artifact.artifactVersion).toBe(1);
    expect(artifact.dashboardId).toBe(PRODUCTION_DASHBOARD.id);
  });

  test("the artifact embeds seam provenance (package + module) for every query", () => {
    const artifact = renderDashboardDefinition(PRODUCTION_DASHBOARD, HEALTH_DOMAIN_MAP);
    const queries = artifact.panels.flatMap((panel) => panel.queries ?? []);
    expect(queries.length).toBeGreaterThan(30);
    for (const query of queries) {
      expect(query.seam.sites.length).toBeGreaterThanOrEqual(1);
      for (const site of query.seam.sites) {
        expect(site.packageName).toMatch(/^@sporta\//);
        expect(site.module).toMatch(/^src\//);
      }
    }
    const queueWait = queries.find((query) => query.metric === "gpu_job_queue_wait_ms");
    expect(queueWait?.stat).toBe("p95");
    expect(queueWait?.seam.sites[0]?.packageName).toBe("@sporta/gpu-worker");
  });

  test("the markdown renderer is deterministic and carries panel titles and provenance", () => {
    const first = renderDashboardMarkdown(PRODUCTION_DASHBOARD, HEALTH_DOMAIN_MAP);
    const second = renderDashboardMarkdown(PRODUCTION_DASHBOARD, HEALTH_DOMAIN_MAP);
    expect(first).toBe(second);
    expect(first).toContain("# Sporta production overview");
    expect(first).toContain("## Media intake");
    expect(first).toContain("@sporta/gpu-worker src/types.ts");
    expect(first).toContain("Domain: `model`");
    expect(first.endsWith("\n")).toBe(true);
  });
});

describe("query resolution — fail-closed", () => {
  test("a query for a metric that does not exist throws (never renders an empty panel)", () => {
    expect(() =>
      resolveQuery(
        HEALTH_DOMAIN_MAP,
        { metric: "definitely_not_a_real_metric", stat: "value" },
        "test",
      ),
    ).toThrow(RangeError);
  });

  test("a histogram stat asked of a counter throws", () => {
    expect(() =>
      resolveQuery(HEALTH_DOMAIN_MAP, { metric: "ingest_rejected_total", stat: "p95" }, "test"),
    ).toThrow(RangeError);
  });

  test("the value stat asked of a histogram throws", () => {
    expect(() =>
      resolveQuery(HEALTH_DOMAIN_MAP, { metric: "gpu_job_queue_wait_ms", stat: "value" }, "test"),
    ).toThrow(RangeError);
  });

  test("every legal (metric, stat) pair of the shipped dashboard resolves", () => {
    for (const panel of PRODUCTION_DASHBOARD.panels) {
      if (panel.kind !== "metric") continue;
      for (const query of panel.queries) {
        expect(() =>
          resolveQuery(HEALTH_DOMAIN_MAP, query, `panel ${panel.id}`),
        ).not.toThrow();
      }
    }
  });
});
