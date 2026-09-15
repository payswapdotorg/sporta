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
  findGap,
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
    if (
      line.startsWith("| ") &&
      !line.startsWith("| metric") &&
      !line.startsWith("| seam") &&
      !line.startsWith("| gap") &&
      !/^\|[-\s|]+\|$/.test(line)
    ) {
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
      queue: 24, // 23 emitted + gpu_job_attempts_total (the report-attempts seam)
      model: 0, // no model-domain package emits observability seams (the gap)
      renderer: 12,
      delivery: 19,
      infrastructure: 13,
    });
    expect(allRegistrySeams(HEALTH_DOMAIN_MAP).length).toBe(84);
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
    const ids = HEALTH_DOMAIN_MAP.domains.flatMap((domain) => domain.gaps.map((gap) => gap.id));
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

// ---------------------------------------------------------------------------
// VOCABULARY COMPLETENESS (both directions, the W503 precedent applied to the
// map↔source relationship): every metric name a sibling package DECLARES in
// its *_METRIC_NAMES vocabulary (plus the renderer plugins' inline bump
// literals) must be a seam of the map — or be a documented
// declared-but-never-observed exception, tied to a real map gap. Without
// this pin the map can silently miss a real seam (it did: gpu_job_attempts_
// total was declared+emitted by W303 and absent from the map until the
// flight-2 audit added it).
// ---------------------------------------------------------------------------

/** Every vocabulary block that declares registry metric names. */
const METRIC_VOCABULARIES: ReadonlyArray<{
  packageName: string;
  module: string;
  constantName: string;
}> = [
  { packageName: "@sporta/gpu-worker", module: "src/types.ts", constantName: "GPU_METRIC_NAMES" },
  {
    packageName: "@sporta/processing-queues",
    module: "src/types.ts",
    constantName: "PROCESSING_METRIC_NAMES",
  },
  {
    packageName: "@sporta/webrtc-output",
    module: "src/types.ts",
    constantName: "LIVE_OUTPUT_METRIC_NAMES",
  },
  {
    packageName: "@sporta/render-orchestration",
    module: "src/types.ts",
    constantName: "RENDER_METRIC_NAMES",
  },
  {
    packageName: "@sporta/streaming-ingress",
    module: "src/types.ts",
    constantName: "STREAMING_METRIC_NAMES",
  },
  {
    packageName: "@sporta/decoding",
    module: "src/service.ts",
    constantName: "DECODE_METRIC_NAMES",
  },
  {
    packageName: "@sporta/ingestion",
    module: "src/ingest.ts",
    constantName: "INGESTION_METRIC_NAMES",
  },
  { packageName: "@sporta/timeline", module: "src/sync.ts", constantName: "TIMELINE_METRIC_NAMES" },
  {
    packageName: "@sporta/control-api",
    module: "src/app.ts",
    constantName: "CONTROL_METRIC_NAMES",
  },
  {
    packageName: "@sporta/transport",
    module: "src/runner.ts",
    constantName: "TRANSPORT_METRIC_NAMES",
  },
];

/** Names the renderer plugins emit as inline bump() literals (no vocabulary). */
const RENDERER_PLUGIN_INLINE_NAMES = ["render_requests_total", "render_failures_total"] as const;

/**
 * Declared in a vocabulary but deliberately NOT a map seam, each tied to the
 * map gap that documents why (a seam that never observes is not alertable).
 */
const DECLARED_BUT_UNOBSERVED: ReadonlyArray<{ metricName: string; gapId: string }> = [
  { metricName: "render_batches_rendered_total", gapId: "renderer-rendered-total-unemitted" },
];

/** Extracts the `key: "metric_name"` values of one vocabulary block. */
function vocabularyNames(vocab: {
  packageName: string;
  module: string;
  constantName: string;
}): string[] {
  const modulePath = join(
    REPO_ROOT,
    "packages",
    vocab.packageName.replace("@sporta/", ""),
    vocab.module,
  );
  const source = readFileSync(modulePath, "utf8");
  const start = source.indexOf(`const ${vocab.constantName} = {`);
  if (start < 0) {
    throw new Error(
      `cannot find "const ${vocab.constantName}" in ${vocab.packageName} ${vocab.module}`,
    );
  }
  const end = source.indexOf("} as const;", start);
  if (end < 0) {
    throw new Error(`cannot find the closing "} as const;" of ${vocab.constantName}`);
  }
  const block = source.slice(start, end);
  const names: string[] = [];
  for (const match of block.matchAll(/^\s+[a-zA-Z0-9]+:\s+"([a-z0-9_]+)",?$/gm)) {
    names.push(match[1]!);
  }
  if (names.length === 0) {
    throw new Error(`extracted zero names from ${vocab.constantName} — extractor drift`);
  }
  return names;
}

describe("health domain map — vocabulary completeness (every declared name is accounted for)", () => {
  const mapNames = new Set(allRegistrySeams(HEALTH_DOMAIN_MAP).map((seam) => seam.metricName));

  test("every vocabulary-declared name (and renderer inline literal) is a map seam or a documented unobserved exception", () => {
    const declared = new Set<string>();
    for (const vocab of METRIC_VOCABULARIES) {
      for (const name of vocabularyNames(vocab)) declared.add(name);
    }
    for (const name of RENDERER_PLUGIN_INLINE_NAMES) declared.add(name);
    const exceptions = new Set(DECLARED_BUT_UNOBSERVED.map((entry) => entry.metricName));
    const missing: string[] = [];
    for (const name of declared) {
      if (!mapNames.has(name) && !exceptions.has(name)) missing.push(name);
    }
    expect(missing, "declared metric names missing from the health domain map").toEqual([]);
  });

  test("every unobserved exception is tied to a REAL map gap (never an unexplained hole)", () => {
    for (const entry of DECLARED_BUT_UNOBSERVED) {
      expect(
        findGap(HEALTH_DOMAIN_MAP, entry.gapId),
        `gap ${entry.gapId} for ${entry.metricName}`,
      ).toBeDefined();
      // and the gap's detail names the metric it exempts
      const gap = findGap(HEALTH_DOMAIN_MAP, entry.gapId)!;
      expect(gap.detail).toContain(entry.metricName);
    }
  });

  test("the completeness pin has teeth: a fake vocabulary entry is caught", () => {
    expect(
      vocabularyNames({
        packageName: "@sporta/gpu-worker",
        module: "src/types.ts",
        constantName: "GPU_METRIC_NAMES",
      }).includes("gpu_job_attempts_total"),
    ).toBe(true);
    // and the extraction really reads the sibling source (not a cached list)
    expect(() =>
      vocabularyNames({
        packageName: "@sporta/gpu-worker",
        module: "src/types.ts",
        constantName: "NOT_A_CONSTANT",
      }),
    ).toThrow(/cannot find/);
  });

  test("total accounting balances: map seams = declared names + renderer literals − unobserved exceptions", () => {
    const declared = new Set<string>();
    for (const vocab of METRIC_VOCABULARIES) {
      for (const name of vocabularyNames(vocab)) declared.add(name);
    }
    for (const name of RENDERER_PLUGIN_INLINE_NAMES) declared.add(name);
    const accounted = new Set<string>([
      ...declared,
      ...DECLARED_BUT_UNOBSERVED.map((entry) => entry.metricName),
    ]);
    // no seam in the map is unexplained (no name the codebase never declared)
    for (const name of mapNames) {
      expect(
        accounted.has(name),
        `map seam "${name}" is not declared by any audited vocabulary`,
      ).toBe(true);
    }
    expect(mapNames.size).toBe(accounted.size - DECLARED_BUT_UNOBSERVED.length);
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
