/**
 * HF004 — the benchmark-record validator (the TS side of the evidence tree).
 *
 * Follows the HF003 pattern (record-benchmark.ts): this entry loads
 * `scripts/evidence/hf-portfolio/hf004/benchmark-record.json` — the HF004
 * benchmark flight's ledger-shaped record — and checks it against the
 * authorities it claims to stand on. The HF004 twist: the flight ends in a
 * TYPED REFUSAL (the pinned MapAnything checkpoint cannot be held by this
 * host), so the validator additionally pins the honesty of the refusal —
 * the record may not launder a refusal into numbers.
 *
 * 1. the provenance fields echo the MapAnything row of the HF002
 *    provenance ledger VERBATIM (candidate, revision, modelUrl, licenses,
 *    commercialUse, gatingState, sources) — the run may not launder
 *    provenance;
 * 2. the gating state is still `candidate` (no promotion: HF015 is the
 *    Tech Lead's gate alone);
 * 3. the typed refusal is present in the record AND in the executed
 *    preflight evidence, with type `resource-infeasible-host` and the
 *    preflight's exit-3 semantics;
 * 4. NO fabricated measurements: the quality/latency/memory blocks must
 *    carry `not-measured-typed-refusal` statuses and no measurement keys
 *    (mean/p95/RSS figures would be fabrications — the model never ran);
 * 5. every evidence pointer resolves to a committed file that parses;
 * 6. the honest resource caveats are present (GPU N/A + RSS + CPU
 *    wall-clock + the never-ran statement).
 *
 * Exits 0 when the record stands; exits 1 with the failing check otherwise
 * (fail-closed — a drifted benchmark record refuses, never passes silently).
 *
 * Run: bun scripts/evidence/hf-portfolio/hf004/record-benchmark.ts
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
  "sources",
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
  sources: string[];
}

interface BenchmarkRecord extends LedgerRow {
  recordedAt: string;
  benchmarkRun: {
    workItem: string;
    typedRefusal: { type: string; reasons: string[]; evidence: string };
    fixtures: Array<{ clipId: string; status: string; evidence: string }>;
    quality: { status: string };
    latency: { status: string };
    memory: { status: string; gpuMemory: string };
    resourceCaveats: string[];
    partialDeliverables: Record<string, { path: string; description: string }>;
    promotionGate: { gatingState: string };
  };
}

const failures: string[] = [];
const fail = (message: string): void => {
  failures.push(message);
};

// --- load the record, the ledger, and the executed refusal evidence ---------

if (!existsSync(RECORD_PATH)) fail(`benchmark record missing: ${RECORD_PATH}`);
if (!existsSync(LEDGER_PATH)) fail(`provenance ledger missing: ${LEDGER_PATH}`);
const record = JSON.parse(readFileSync(RECORD_PATH, "utf8")) as BenchmarkRecord;
const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as LedgerRow[];
const ledgerRow = ledger.find((row) => row.candidate === record.candidate);
if (ledgerRow === undefined) {
  fail(`benchmark record candidate "${record.candidate}" has no provenance-ledger row`);
}

// --- 1. the provenance echo (fail-closed on any drift) -----------------------

if (ledgerRow !== undefined) {
  for (const field of ECHO_FIELDS) {
    if (JSON.stringify(record[field]) !== JSON.stringify(ledgerRow[field])) {
      fail(
        `provenance echo drift on "${field}": record=${JSON.stringify(record[field])} ledger=${JSON.stringify(ledgerRow[field])}`,
      );
    }
  }
}

// --- 2. no promotion ----------------------------------------------------------

if (record.gatingState !== "candidate") {
  fail(`gatingState must stay "candidate" (got "${record.gatingState}") — HF015 is the TL's gate alone`);
}
if (record.benchmarkRun.promotionGate.gatingState !== "candidate") {
  fail("the benchmarkRun.promotionGate block must record the UNCHANGED candidate state");
}
if (record.benchmarkRun.workItem !== "HF004") {
  fail(`workItem must be "HF004" (got "${record.benchmarkRun.workItem}")`);
}

// --- 3. the typed refusal is real and pinned ----------------------------------

const refusal = record.benchmarkRun.typedRefusal;
if (refusal.type !== "resource-infeasible-host") {
  fail(`typedRefusal.type must be "resource-infeasible-host" (got "${refusal.type}")`);
}
if (refusal.reasons.length < 2) {
  fail("the typed refusal must carry its typed reasons (disk + RAM at minimum)");
}
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
const resolveEvidence = (relPath: string): string => {
  const full = existsSync(join(REPO_ROOT, relPath)) ? join(REPO_ROOT, relPath) : join(HERE, relPath);
  return full;
};
const refusalPath = resolveEvidence(refusal.evidence);
if (!existsSync(refusalPath)) {
  fail(`the typed refusal's evidence pointer does not resolve: ${refusal.evidence}`);
} else {
  const refusalEvidence = JSON.parse(readFileSync(refusalPath, "utf8")) as {
    verdict: string;
    refusalType?: string;
    checks: Record<string, unknown>;
  };
  if (refusalEvidence.verdict !== "refused" || refusalEvidence.refusalType !== refusal.type) {
    fail("the executed preflight evidence does not match the record's typed refusal (verdict/type drift)");
  }
  if (refusalEvidence.checks.gpu === undefined || !String(refusalEvidence.checks.gpu).includes("N/A")) {
    fail("the executed preflight evidence must record GPU honestly as N/A");
  }
}

// --- 4. no fabricated measurements --------------------------------------------

const NOT_MEASURED = "not-measured-typed-refusal";
if (record.benchmarkRun.quality.status !== NOT_MEASURED) {
  fail(`quality.status must be "${NOT_MEASURED}" (got "${record.benchmarkRun.quality.status}")`);
}
if (record.benchmarkRun.latency.status !== NOT_MEASURED) {
  fail(`latency.status must be "${NOT_MEASURED}" (got "${record.benchmarkRun.latency.status}")`);
}
if (record.benchmarkRun.memory.status !== NOT_MEASURED) {
  fail(`memory.status must be "${NOT_MEASURED}" (got "${record.benchmarkRun.memory.status}")`);
}
const latencyText = JSON.stringify(record.benchmarkRun.latency);
for (const fabricationKey of ["\"mean\"", "\"p50", "\"p95", "\"min\"", "\"max\""]) {
  if (latencyText.includes(fabricationKey)) {
    fail(`latency block carries a measurement key (${fabricationKey}) — the model never ran; numbers would be fabrications`);
  }
}
const memoryText = JSON.stringify(record.benchmarkRun.memory);
if (/"vmRss|"peakRss|"rssMiB/i.test(memoryText)) {
  fail("memory block carries an RSS measurement key — the model never ran; numbers would be fabrications");
}
for (const fixture of record.benchmarkRun.fixtures) {
  if (fixture.status !== "not-run-resource-refusal") {
    fail(`fixture ${fixture.clipId} must record status "not-run-resource-refusal" (got "${fixture.status}")`);
  }
}

// --- 5. every evidence pointer resolves and parses -----------------------------

const allPointers: Array<[string, string]> = [
  ...record.benchmarkRun.fixtures.map(
    (fixture) => [`fixture ${fixture.clipId}`, fixture.evidence] as [string, string],
  ),
  ["quality/contractCompatibility", record.benchmarkRun.quality.evidence],
  ...Object.entries(record.benchmarkRun.partialDeliverables).map(
    ([key, value]) => [`partialDeliverables.${key}`, value.path] as [string, string],
  ),
];
for (const [label, relPath] of allPointers) {
  const full = resolveEvidence(relPath);
  if (!existsSync(full)) {
    fail(`evidence pointer does not resolve (${label}): ${relPath}`);
    continue;
  }
  if (relPath.endsWith(".json")) {
    try {
      JSON.parse(readFileSync(full, "utf8"));
    } catch (error) {
      fail(`evidence file does not parse (${label}): ${relPath} (${String(error)})`);
    }
  }
}
// the ready-to-run script and the executed preflight/compat scripts must exist.
const READY_TO_RUN = "scripts/evidence/hf-portfolio/hf004/benchmark_mapanything.py";
if (!existsSync(resolveEvidence(READY_TO_RUN))) {
  fail(`the ready-to-run script is missing: ${READY_TO_RUN}`);
}

// --- 6. the honest resource caveats -------------------------------------------

const caveats = record.benchmarkRun.resourceCaveats.join(" ");
if (!caveats.includes("N/A")) {
  fail("the GPU-memory N/A caveat is missing (no GPU on the benchmark host)");
}
if (!caveats.includes("RSS")) {
  fail("the process-RSS substitute caveat is missing");
}
if (!caveats.toLowerCase().includes("wall-clock")) {
  fail("the CPU wall-clock latency convention caveat is missing");
}
if (!caveats.includes("never ran")) {
  fail('the "the model never ran" caveat is missing — the refusal must not be softened');
}
const memoryBlock = record.benchmarkRun.memory;
if (!memoryBlock.gpuMemory.includes("N/A")) {
  fail("the memory block must record GPU memory as N/A honestly");
}

// --- verdict -------------------------------------------------------------------

if (failures.length > 0) {
  console.error("HF004 benchmark record FAILED validation:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("HF004 benchmark record stands:");
console.log(`  candidate ${record.candidate} @ ${record.revision.slice(0, 12)} (gatingState: ${record.gatingState})`);
console.log(`  typed refusal: ${refusal.type} (executed preflight evidence verified)`);
console.log(`  partial: ${Object.keys(record.benchmarkRun.partialDeliverables).length} deliverable pointers, all resolving`);
console.log("  provenance echo verbatim vs the HF002 ledger; no promotion; no fabricated numbers; caveats present");
