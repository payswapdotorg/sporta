/**
 * HF007 — the benchmark-record validator (the TS side of the evidence tree).
 *
 * Follows the HF004/HF009 pattern (record-benchmark.ts): this entry loads
 * `scripts/evidence/hf-portfolio/hf007/benchmark-record.json` — the HF007
 * benchmark flight's ledger-shaped record — and checks it against the
 * authorities it claims to stand on. The HF007 twist (the HF004 precedent,
 * resource-refused): the flight ends in a TYPED REFUSAL (the 7B VLM + LoRA
 * is resource-infeasible on this 4 GB host), so the validator additionally
 * pins the honesty of the refusal — the record may not launder a refusal
 * into numbers, and any measurement-shaped key with no measured run behind
 * it refuses (fail-closed, the negative-test convention).
 *
 * 1. the provenance fields echo the SoccerChat row of the HF002
 *    provenance ledger VERBATIM (candidate, revision, modelUrl, licenses,
 *    commercialUse, gatingState, sources — all twelve fields);
 * 2. the gating state is still `candidate` (no promotion: HF015 is the
 *    Tech Lead's gate alone);
 * 3. the typed refusal is present in the record AND pinned to the EXECUTED
 *    preflight evidence, with type `resource-infeasible-host`, the
 *    preflight's exit-3 semantics, the locally-verified adapter sha, and
 *    the three refusal reasons (RAM + disk + the eval-corpus NDA wall);
 * 4. NO fabricated measurements: the quality/latency/memory blocks must
 *    carry `not-measured-typed-refusal` statuses and no measurement keys
 *    (mean/p95/RSS/RTF figures would be fabrications — the model never
 *    ran), and every fixture must record the refusal status;
 * 5. every evidence pointer resolves to a committed file that parses;
 *    the partial deliverables must all exist (the load analysis, the
 *    source-verified schema, the contract compatibility with BOTH mapping
 *    tables + the static pipeline delta, the ready-to-run script);
 * 6. the honest resource caveats are present (GPU N/A + RSS + CPU
 *    wall-clock + the never-ran statement + the separate NDA-wall caveat);
 * 7. the contract-compatibility evidence itself is load-bearing: the
 *    emitted JSON must carry the static-review label and the NOT-compatible
 *    W208 verdict (the honest different-artifact-class finding), and the
 *    preflight's adapter-sha verification must be recorded true.
 *
 * Exits 0 when the record stands; exits 1 with the failing check otherwise
 * (fail-closed — a drifted benchmark record refuses, never passes silently).
 *
 * Run: bun scripts/evidence/hf-portfolio/hf007/record-benchmark.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RECORD_PATH = join(HERE, "benchmark-record.json");
const LEDGER_PATH = join(HERE, "..", "provenance-ledger.json");
const REPO_ROOT = join(HERE, "..", "..", "..", "..");

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
    modelRuntime: {
      adapter: string;
      base: string;
      loadValidation: string;
    };
    fixtures: Array<{ clipId: string; status: string; evidence: string }>;
    quality: { status: string; evidence: string };
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
if (record.benchmarkRun.workItem !== "HF007") {
  fail(`workItem must be "HF007" (got "${record.benchmarkRun.workItem}")`);
}

// --- 3. the typed refusal is real and pinned to the EXECUTED preflight -------

const refusal = record.benchmarkRun.typedRefusal;
if (refusal.type !== "resource-infeasible-host") {
  fail(`typedRefusal.type must be "resource-infeasible-host" (got "${refusal.type}")`);
}
if (refusal.reasons.length < 3) {
  fail("the typed refusal must carry its typed reasons (RAM + disk + the NDA eval-corpus wall at minimum)");
}
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
    adapterShaLocallyVerified?: boolean;
    typedRefusal?: { type: string; reasons: string[] };
    checks?: Record<string, unknown>;
  };
  if (refusalEvidence.verdict !== "refused" || refusalEvidence.refusalType !== refusal.type) {
    fail("the executed preflight evidence does not match the record's typed refusal (verdict/type drift)");
  }
  if (refusalEvidence.adapterShaLocallyVerified !== true) {
    fail("the executed preflight evidence must record the adapter sha as LOCALLY VERIFIED (the bounded probe's core fact)");
  }
  if (refusalEvidence.typedRefusal?.reasons.join(" ") !== refusal.reasons.join(" ")) {
    fail("the record's refusal reasons drift from the executed preflight evidence's own reasons");
  }
  // the host-resources story must be present (GPU N/A honestly)
  if (!JSON.stringify(refusalEvidence.host ?? {}).includes("N/A")) {
    fail("the executed preflight evidence must record GPU honestly as N/A");
  }
  // the eval-corpus NDA wall must be in the executed evidence too
  const evidenceText = JSON.stringify(refusalEvidence);
  if (!evidenceText.includes("NDA")) {
    fail("the executed preflight evidence must record the SoccerNet-NDA eval-corpus wall");
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
for (const fabricationKey of ["\"mean\"", "\"p50", "\"p95", "\"min\"", "\"max\"", "\"medianMs\""]) {
  if (latencyText.includes(fabricationKey)) {
    fail(`latency block carries a measurement key (${fabricationKey}) — the model never ran; numbers would be fabrications`);
  }
}
const memoryText = JSON.stringify(record.benchmarkRun.memory);
if (/"vmRss|"peakRss|"rssMiB|"ruMaxrss/i.test(memoryText)) {
  fail("memory block carries an RSS measurement key — the model never ran; numbers would be fabrications");
}
const qualityText = JSON.stringify(record.benchmarkRun.quality);
if (/"hallucinationRate":\s*[0-9]|"recall":\s*[0-9]|"provenanceTraceability":\s*[0-9]/.test(qualityText)) {
  fail("quality block carries a metric number — the model never ran; metric values would be fabrications");
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
// the required partial deliverables must all be present (the substantial partial)
const requiredPartials = [
  "loadAnalysis",
  "sourceVerifiedOutputSchema",
  "eventExtractionContractMapping",
  "commentaryAlignmentContractMapping",
  "metricDesigns",
  "staticPipelineComparison",
  "readyToRunScript",
];
for (const key of requiredPartials) {
  if (record.benchmarkRun.partialDeliverables[key] === undefined) {
    fail(`the partial deliverable "${key}" is missing from the record (the brief's five partial items + the ready-to-run script)`);
  }
}
// the ready-to-run script and the executed preflight must exist.
const READY_TO_RUN = "scripts/evidence/hf-portfolio/hf007/benchmark_soccerchat.py";
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
if (!caveats.includes("NDA")) {
  fail("the separate eval-corpus NDA-wall caveat is missing (the second, hardware-independent wall)");
}
const memoryBlock = record.benchmarkRun.memory;
if (!memoryBlock.gpuMemory.includes("N/A")) {
  fail("the memory block must record GPU memory as N/A honestly");
}

// --- 7. the load-bearing contract evidence ------------------------------------

const compatPath = resolveEvidence(record.benchmarkRun.quality.evidence);
if (existsSync(compatPath)) {
  const compat = JSON.parse(readFileSync(compatPath, "utf8")) as {
    eventExtractionMappings: unknown[];
    commentaryAlignmentMappings: unknown[];
    staticPipelineComparison: { label: string; deltaRows: unknown[] };
    profileVerdicts: Array<{ target: string; verdict: string }>;
  };
  if (compat.eventExtractionMappings.length < 8) {
    fail(`the contract-compatibility evidence must carry the event-extraction table (>= 8 rows, got ${compat.eventExtractionMappings.length})`);
  }
  if (compat.commentaryAlignmentMappings.length < 3) {
    fail(`the contract-compatibility evidence must carry the commentary-alignment table (>= 3 rows, got ${compat.commentaryAlignmentMappings.length})`);
  }
  if (!compat.staticPipelineComparison.label.includes("STATIC-REVIEW")) {
    fail("the pipeline comparison must be labeled STATIC-REVIEW (never executed evidence)");
  }
  if (compat.staticPipelineComparison.deltaRows.length < 8) {
    fail(`the static pipeline-delta table must carry >= 8 capability rows (got ${compat.staticPipelineComparison.deltaRows.length})`);
  }
  const w208 = compat.profileVerdicts.find((p) => p.target.includes("W208"));
  if (w208 === undefined || !w208.verdict.startsWith("not-compatible")) {
    fail("the W208 CommentaryUnit verdict must be not-compatible (the different-artifact-class finding — the honest negative result)");
  }
}

// the modelRuntime story must carry the locally-verified adapter sha + the load refusal
const runtimeText = JSON.stringify(record.benchmarkRun.modelRuntime);
if (!runtimeText.includes("LOCALLY VERIFIED")) {
  fail("the modelRuntime block must record the adapter sha as LOCALLY VERIFIED (this flight's bounded probe)");
}
if (!runtimeText.includes("REFUSED")) {
  fail("the modelRuntime loadValidation must record the REFUSED verdict");
}

// --- verdict -------------------------------------------------------------------

if (failures.length > 0) {
  console.error("HF007 benchmark record FAILED validation:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("HF007 benchmark record stands:");
console.log(`  candidate ${record.candidate} @ ${record.revision.slice(0, 12)} (gatingState: ${record.gatingState})`);
console.log(`  typed refusal: ${refusal.type} (executed preflight evidence verified; adapter sha locally verified)`);
console.log(`  partial: ${Object.keys(record.benchmarkRun.partialDeliverables).length} deliverable pointers, all resolving`);
console.log("  provenance echo verbatim vs the HF002 ledger; no promotion; no fabricated numbers; caveats present");
