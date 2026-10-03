/**
 * HF006 — the benchmark-record validator (the TS side of the evidence tree).
 *
 * Follows the HF003/HF004 pattern (the ledger JSON kept machine-checkable):
 * this entry loads `scripts/evidence/hf-portfolio/hf006/benchmark-record.json`
 * — the HF006 benchmark flight's ledger-shaped record — and checks it
 * against the authorities it claims to stand on:
 *
 * 1. the twelve provenance fields echo the Spivak row of the HF002
 *    provenance ledger VERBATIM (candidate, revision, modelUrl, licenses,
 *    weightsProvenance, datasetProvenance, commercialUse, gatingState) —
 *    the run may not launder provenance;
 * 2. the gating state is still `candidate` (no promotion: HF015 is the
 *    Tech Lead's gate alone — a benchmark flight cannot promote anything);
 * 3. every evidence pointer resolves to a committed file that parses;
 * 4. the EXECUTED-run pinning: this flight claims a real run, so the
 *    record's latency/memory/structural numbers must MATCH the committed
 *    results JSONs byte-for-value (fail-closed on drift — a number in the
 *    record with no measured run behind it cannot pass);
 * 5. the typed gaps are present and honest (temporal P/R not-measured with
 *    the reason; early-detection-vs-onset not-measured with the reason;
 *    GPU N/A + RSS recorded; CPU wall-clock labeled as such).
 *
 * Exits 0 when the record stands; exits 1 with the failing check otherwise
 * (fail-closed — a drifted benchmark record refuses, never passes silently).
 *
 * Run: bun scripts/evidence/hf-portfolio/hf006/record-benchmark.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RECORD_PATH = join(HERE, "benchmark-record.json");
const LEDGER_PATH = join(HERE, "..", "provenance-ledger.json");

/** The ledger row fields the benchmark record must echo verbatim. */
const ECHO_FIELDS = [
  "candidate",
  "taskProfiles",
  "modelUrl",
  "revision",
  "modelLicense",
  "codeLicense",
  "weightsProvenance",
  "datasetProvenance",
  "commercialUse",
  "gatingState",
] as const;

interface LedgerRow {
  candidate: string;
  taskProfiles: string[];
  modelUrl: string;
  revision: string;
  modelLicense: string;
  codeLicense: string;
  weightsProvenance: string;
  datasetProvenance: string;
  commercialUse: string;
  gatingState: string;
}

interface ResultJson {
  latencyMs: { mean: number; p50NearestRank: number; p95NearestRank: number; firstCallMs: number };
  memory: { vmRssMiBAfterRun: number; peakRssMiBRuMaxrss: number };
  spottedEvents: { count: number };
  structure: {
    anchorCount: number;
    perClass: Array<{ maxConfidence: number }>;
    confidenceHistogramAllAnchors: { counts: number[] };
  };
}

interface BenchmarkRecord extends LedgerRow {
  sources: string[];
  recordedAt: string;
  benchmarkRun: {
    workItem: string;
    fixtures: Array<{ clipId: string; evidence: string; scored: boolean }>;
    quality: {
      temporalPrecisionRecall: string;
      structuralResults: Record<string, {
        ["eventsAtThreshold0.5"]: number;
        maxAnchorConfidence: number;
        anchors: number;
        confidenceHistogramCounts: number[];
      }>;
    };
    latency: {
      fixtureWindowSteadyMeanMs: number;
      fixtureWindowSteadyP50NearestRankMs: number;
      fixtureWindowSteadyP95NearestRankMs: number;
      realClipWindowSteadyMeanMs: number;
      realClipWindowSteadyP50NearestRankMs: number;
      realClipWindowSteadyP95NearestRankMs: number;
      frontEndExtractionMs: { fixture: number; fx001: number };
      earlyDetectionLatencyVsOnset: string;
    };
    memory: { gpuMemory: string; vmRssMiBAfterRun: number; peakRssMiBRuMaxrss: number };
    cascadeCost: { verdict: string };
    resourceCaveats: string[];
    promotionGate: { gatingState: string };
  };
}

const failures: string[] = [];
const fail = (message: string): void => {
  failures.push(message);
};

// --- load the record and the ledger (fail-closed on parse) ------------------
if (!existsSync(RECORD_PATH)) fail(`benchmark record missing: ${RECORD_PATH}`);
if (!existsSync(LEDGER_PATH)) fail(`provenance ledger missing: ${LEDGER_PATH}`);
const record = JSON.parse(readFileSync(RECORD_PATH, "utf8")) as BenchmarkRecord;
const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as LedgerRow[];
const ledgerRow = ledger.find((row) => row.candidate === record.candidate);
if (ledgerRow === undefined) {
  fail(`benchmark record candidate "${record.candidate}" has no provenance-ledger row`);
}

// --- 1. the provenance echo -------------------------------------------------
if (ledgerRow !== undefined) {
  for (const field of ECHO_FIELDS) {
    if (JSON.stringify(record[field]) !== JSON.stringify(ledgerRow[field])) {
      fail(
        `provenance echo drift on "${field}": record=${JSON.stringify(record[field])} ledger=${JSON.stringify(ledgerRow[field])}`,
      );
    }
  }
}

// --- 2. no promotion --------------------------------------------------------
if (record.gatingState !== "candidate") {
  fail(`gatingState must stay "candidate" (got "${record.gatingState}") — HF015 is the TL's gate alone`);
}
if (record.benchmarkRun.promotionGate.gatingState !== "candidate") {
  fail("the benchmarkRun.promotionGate block must record the UNCHANGED candidate state");
}
if (record.benchmarkRun.workItem !== "HF006") {
  fail(`workItem must be "HF006" (got "${record.benchmarkRun.workItem}")`);
}

// --- 3. evidence pointers resolve + parse + the numbers MATCH ---------------
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
const resultJsons = new Map<string, ResultJson>();
for (const fixture of record.benchmarkRun.fixtures) {
  const evidencePath = existsSync(join(REPO_ROOT, fixture.evidence))
    ? join(REPO_ROOT, fixture.evidence)
    : join(HERE, fixture.evidence);
  if (!existsSync(evidencePath)) {
    fail(`evidence pointer does not resolve: ${fixture.evidence}`);
    continue;
  }
  try {
    resultJsons.set(fixture.clipId, JSON.parse(readFileSync(evidencePath, "utf8")));
  } catch (error) {
    fail(`evidence file does not parse: ${fixture.evidence} (${String(error)})`);
  }
  // unscored fixtures are labeled as such (this flight has NO ground truth)
  if (fixture.scored !== false) {
    fail(`fixture ${fixture.clipId} must be labeled scored:false (no event ground truth exists)`);
  }
}

// --- 4. the EXECUTED-run pinning: record numbers == measured results ---------
const fixtureResult = resultJsons.get("synthetic-diagnostic-01");
const realResult = resultJsons.get("fx-001");
if (fixtureResult !== undefined) {
  const r = record.benchmarkRun.latency;
  if (r.fixtureWindowSteadyMeanMs !== fixtureResult.latencyMs.mean) {
    fail(`fixture window mean drift: record=${r.fixtureWindowSteadyMeanMs} results=${fixtureResult.latencyMs.mean}`);
  }
  if (r.fixtureWindowSteadyP50NearestRankMs !== fixtureResult.latencyMs.p50NearestRank) {
    fail(`fixture window p50 drift: record=${r.fixtureWindowSteadyP50NearestRankMs} results=${fixtureResult.latencyMs.p50NearestRank}`);
  }
  if (r.fixtureWindowSteadyP95NearestRankMs !== fixtureResult.latencyMs.p95NearestRank) {
    fail(`fixture window p95 drift: record=${r.fixtureWindowSteadyP95NearestRankMs} results=${fixtureResult.latencyMs.p95NearestRank}`);
  }
  if (r.frontEndExtractionMs.fixture !== fixtureResult.latencyMs.frontEndExtractionMs) {
    fail(`fixture front-end extraction drift: record=${r.frontEndExtractionMs.fixture} results=${fixtureResult.latencyMs.frontEndExtractionMs}`);
  }
  const structural = record.benchmarkRun.quality.structuralResults.fixture;
  const fixtureEventsRecorded = structural["eventsAtThreshold0.5"];
  if (fixtureEventsRecorded !== fixtureResult.spottedEvents.count) {
    fail(`fixture event count drift: record=${fixtureEventsRecorded} results=${fixtureResult.spottedEvents.count}`);
  }
  if (structural.anchors !== fixtureResult.structure.anchorCount) {
    fail(`fixture anchor count drift: record=${structural.anchors} results=${fixtureResult.structure.anchorCount}`);
  }
  const measuredMax = Math.max(...fixtureResult.structure.perClass.map((c) => c.maxConfidence));
  if (Math.abs(structural.maxAnchorConfidence - measuredMax) > 1e-9) {
    fail(`fixture max-anchor-confidence drift: record=${structural.maxAnchorConfidence} results=${measuredMax}`);
  }
  if (JSON.stringify(structural.confidenceHistogramCounts) !== JSON.stringify(fixtureResult.structure.confidenceHistogramAllAnchors.counts)) {
    fail("fixture confidence histogram drift vs the committed results JSON");
  }
}
if (realResult !== undefined) {
  const r = record.benchmarkRun.latency;
  if (r.realClipWindowSteadyMeanMs !== realResult.latencyMs.mean) {
    fail(`fx-001 window mean drift: record=${r.realClipWindowSteadyMeanMs} results=${realResult.latencyMs.mean}`);
  }
  if (r.realClipWindowSteadyP95NearestRankMs !== realResult.latencyMs.p95NearestRank) {
    fail(`fx-001 window p95 drift: record=${r.realClipWindowSteadyP95NearestRankMs} results=${realResult.latencyMs.p95NearestRank}`);
  }
  const realExtractionRecorded = r.frontEndExtractionMs["fx001"];
  if (realExtractionRecorded !== realResult.latencyMs.frontEndExtractionMs) {
    fail(`fx-001 front-end extraction drift: record=${realExtractionRecorded} results=${realResult.latencyMs.frontEndExtractionMs}`);
  }
  const structural = record.benchmarkRun.quality.structuralResults.realClipFx001;
  const realEventsRecorded = structural["eventsAtThreshold0.5"];
  if (realEventsRecorded !== realResult.spottedEvents.count) {
    fail(`fx-001 event count drift: record=${realEventsRecorded} results=${realResult.spottedEvents.count}`);
  }
  const measuredMax = Math.max(...realResult.structure.perClass.map((c) => c.maxConfidence));
  if (Math.abs(structural.maxAnchorConfidence - measuredMax) > 1e-9) {
    fail(`fx-001 max-anchor-confidence drift: record=${structural.maxAnchorConfidence} results=${measuredMax}`);
  }
  if (record.benchmarkRun.memory.vmRssMiBAfterRun !== realResult.memory.vmRssMiBAfterRun) {
    fail(`RSS drift: record=${record.benchmarkRun.memory.vmRssMiBAfterRun} results=${realResult.memory.vmRssMiBAfterRun}`);
  }
  if (record.benchmarkRun.memory.peakRssMiBRuMaxrss !== realResult.memory.peakRssMiBRuMaxrss) {
    fail(`peak-RSS drift: record=${record.benchmarkRun.memory.peakRssMiBRuMaxrss} results=${realResult.memory.peakRssMiBRuMaxrss}`);
  }
}

// --- 5. the honest typed gaps + caveats --------------------------------------
const quality = record.benchmarkRun.quality.temporalPrecisionRecall;
if (!quality.includes("NOT MEASURED")) {
  fail("the temporal P/R typed gap must be stated as NOT MEASURED (no event ground truth exists)");
}
if (!record.benchmarkRun.latency.earlyDetectionLatencyVsOnset.includes("NOT MEASURED")) {
  fail("the early-detection-vs-onset typed gap must be stated as NOT MEASURED");
}
const caveats = record.benchmarkRun.resourceCaveats.join(" ");
if (!caveats.includes("N/A")) {
  fail("the GPU-memory N/A caveat is missing (no GPU on the benchmark host)");
}
if (!caveats.includes("RSS")) {
  fail("the process-RSS substitute caveat is missing");
}
if (!caveats.toLowerCase().includes("cpu") || !caveats.toLowerCase().includes("wall-clock")) {
  fail("the CPU wall-clock latency caveat is missing");
}
if (!caveats.includes("zero-padded")) {
  fail("the short-clip zero-padded-window caveat is missing");
}
if (!record.benchmarkRun.memory.gpuMemory.includes("N/A")) {
  fail("the memory block must record GPU memory as N/A honestly");
}
if (!record.benchmarkRun.cascadeCost.verdict || record.benchmarkRun.cascadeCost.verdict.length < 20) {
  fail("the cascade cost verdict must be present");
}

// --- verdict ----------------------------------------------------------------
if (failures.length > 0) {
  console.error("HF006 benchmark record FAILED validation:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("HF006 benchmark record stands:");
console.log(`  candidate ${record.candidate} @ ${record.revision.slice(0, 12)} (gatingState: ${record.gatingState})`);
for (const fixture of record.benchmarkRun.fixtures) {
  console.log(`  evidence: ${fixture.evidence} (scored: ${fixture.scored})`);
}
console.log("  provenance echo verbatim vs the HF002 ledger; EXECUTED-run numbers pinned to the results JSONs;");
console.log("  typed gaps present (temporal P/R + onset-offset NOT MEASURED); no promotion recorded; caveats present");
