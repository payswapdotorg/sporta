/**
 * The health domain map pins: schema validity, the six-domain coverage, the
 * audited inventory counts, seam-name uniqueness — and the two REALITY pins:
 *
 * 1. **Source scan** — every registry seam's metric name is a literal in the
 *    referenced sibling package module (the map is audit data, not
 *    aspiration; a renamed metric in a dependency fails this test loudly).
 * 2. **Doc pin** — PRODUCTION.md's per-domain seam/telemetry/gap tables
 *    match the map row-for-row (the W503 THRESHOLDS.md both-directions
 *    precedent: the doc and the code cannot drift apart silently).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  HEALTH_DOMAIN_IDS,
  HEALTH_DOMAIN_MAP,
  HealthDomainMapSchema,
  allRegistrySeams,
} from "../src/domains";
import type { RegistrySeam } from "../src/domains";

const REPO_ROOT = join(dirname(import.meta.dir), "..", "..");
const DOC_PATH = join(REPO_ROOT, "docs", "observability", "PRODUCTION.md");

/** Extracts one markdown table's rows (as cell arrays) following a heading. */
function tableRowsAfterHeading(doc: string, heading: string): string[][] {
  const headingIndex = doc.indexOf(heading);
  if (headingIndex < 0) {
    throw new Error(`PRODUCTION.md is missing the heading "${heading}"`);
  }
  const afterHeading = doc.slice(headingIndex);
  const nextSection = afterHeading.search(/\n#{3,4} /);
  const section = nextSection < 0 ? afterHeading : afterHeading.slice(0, nextSection);
  const rows: string[][] = [];
  for (const line of section.split("\n")) {
    if (line.startsWith("| ") && !line.startsWith("| metric") && !line.startsWith("| seam") && !line.startsWith("| gap") && !/^\|[-\s|]+\|$/.test(line)) {
      rows.push(
        line
          .slice(1, -1)
          .split("|")
          .map((cell) => cell.trim()),
      );
    }
  }
  return rows;
}

/** The reality check: a seam's metric name is a literal in its site module. */
function seamRealityViolations(seam: RegistrySeam): string[] {
  const violations: string[] = [];
  for (const site of seam.sites) {
    const packageDir = site.packageName.replace("@sporta/", "");
    const modulePath = join(REPO_ROOT, "packages", packageDir, site.module);
    let source: string;
    try {
      source = readFileSync(modulePath, "utf8");
    } catch (error) {
      violations.push(
        `${seam.metricName}: cannot read ${site.packageName} ${site.module} (${String(error)})`,
      );
      continue;
    }
    if (!source.includes(`"${seam.metricName}"`)) {
      violations.push(
        `${seam.metricName}: the literal does not appear in ${site.packageName} ${site.module} — the map drifted from reality`,
      );
    }
  }
  return violations;
}

describe("health domain map — schema and structure", () => {
  test("the shipped map parses against its zod schema", () => {
    expect(() => HealthDomainMapSchema.parse(HEALTH_DOMAIN_MAP)).not.toThrow();
  });

  test("all six health domains appear exactly once, in order", () => {
    expect(HEALTH_DOMAIN_MAP.domains.map((domain) => domain.id)).toEqual([...HEALTH_DOMAIN_IDS]);
  });

  test("registry metric names are globally unique (resolution is by name)", () => {
    const names = allRegistrySeams(HEALTH_DOMAIN_MAP).map((seam) => seam.metricName);
    expect(names.length).toBe(new Set(names).size);
  });

  test("the audited inventory counts (per domain and total) are pinned", () => {
    // Pinned counts — extend DELIBERATELY when a package adds real seams.
    const perDomain: Record<string, number> = {};
    for (const domain of HEALTH_DOMAIN_MAP.domains) {
      perDomain[domain.id] = domain.registrySeams.length;
    }
    expect(perDomain).toEqual({
      media: 16,
      queue: 23,
      model: 0, // no model-domain package emits observability seams (the gap)
      renderer: 12,
      delivery: 19,
      infrastructure: 13,
    });
    expect(allRegistrySeams(HEALTH_DOMAIN_MAP).length).toBe(83);
  });

  test("the model domain honestly carries zero seams and its gaps", () => {
    const model = HEALTH_DOMAIN_MAP.domains.find((domain) => domain.id === "model");
    expect(model).toBeDefined();
    expect(model!.registrySeams).toEqual([]);
    expect(model!.telemetrySeams).toEqual([]);
    expect(model!.gaps.map((gap) => gap.id)).toEqual([
      "model-no-runtime-seams",
      "model-quality-offline-only",
    ]);
  });

  test("gap ids are globally unique", () => {
    const ids = HEALTH_DOMAIN_MAP.domains.flatMap((domain) =>
      domain.gaps.map((gap) => gap.id),
    );
    expect(ids.length).toBe(new Set(ids).size);
  });
});

describe("health domain map — reality pins (the map is audit data)", () => {
  test("every registry seam's metric name is a literal in its referenced module", () => {
    const violations = allRegistrySeams(HEALTH_DOMAIN_MAP).flatMap((seam) =>
      seamRealityViolations(seam),
    );
    expect(violations).toEqual([]);
  });

  test("the reality check has teeth: a fabricated seam is caught", () => {
    const fabricated: RegistrySeam = {
      metricName: "definitely_not_a_real_metric",
      kind: "counter",
      labels: [],
      sites: [{ packageName: "@sporta/gpu-worker", module: "src/types.ts" }],
      emission: "fabricated for the teeth test",
    };
    expect(seamRealityViolations(fabricated)).toHaveLength(1);
  });
});

describe("health domain map — doc pins (PRODUCTION.md matches the map)", () => {
  const doc = readFileSync(DOC_PATH, "utf8");

  test("every domain's registry-seam table lists exactly the map's seams", () => {
    for (const domain of HEALTH_DOMAIN_MAP.domains) {
      const rows = tableRowsAfterHeading(doc, `### Domain: ${domain.id}`);
      const docNames = rows.map((row) => row[0]);
      const mapNames = domain.registrySeams.map((seam) => seam.metricName);
      expect(docNames, `domain ${domain.id}: doc rows must equal map seams`).toEqual(mapNames);
      // kind column agrees too
      const mapKinds = domain.registrySeams.map((seam) => seam.kind);
      const docKinds = rows.map((row) => row[1]);
      expect(docKinds).toEqual(mapKinds);
    }
  });

  test("every domain's telemetry-seam and gap tables list exactly the map's entries", () => {
    for (const domain of HEALTH_DOMAIN_MAP.domains) {
      const telemetryRows = tableRowsAfterHeading(doc, `#### Telemetry seams — ${domain.id}`);
      expect(
        telemetryRows.map((row) => row[0]),
        `domain ${domain.id}: doc telemetry rows`,
      ).toEqual(domain.telemetrySeams.map((seam) => seam.name));

      const gapRows = tableRowsAfterHeading(doc, `#### Known gaps — ${domain.id}`);
      expect(gapRows.map((row) => row[0])).toEqual(domain.gaps.map((gap) => gap.id));
    }
  });
});
