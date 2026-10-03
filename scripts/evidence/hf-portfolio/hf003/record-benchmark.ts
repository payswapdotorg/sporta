/**
 * HF003 — the benchmark-record validator (the TS side of the evidence tree).
 *
 * Follows the HF002 pattern (`fetch-provenance.sh` + the ledger JSON kept
 * machine-checkable): this entry loads
 * `scripts/evidence/hf-portfolio/hf003/benchmark-record.json` — the HF003
 * benchmark flight's ledger-shaped record — and checks it against the
 * authorities it claims to stand on:
 *
 * 1. the twelve provenance fields echo the RF-DETR row of the HF002
 *    provenance ledger VERBATIM (candidate, revision, modelUrl, licenses,
 *    commercialUse, gatingState) — the run may not launder provenance;
 * 2. the gating state is still `candidate` (no promotion: HF015 is the
 *    Tech Lead's gate alone — a benchmark flight cannot promote anything);
 * 3. every evidence pointer resolves to a committed file that parses;
 * 4. the honest resource caveats are present (GPU N/A + RSS recorded;
 *    CPU wall-clock latency labeled as such).
 *
 * Exits 0 when the record stands; exits 1 with the failing check otherwise
 * (fail-closed — a drifted benchmark record refuses, never passes silently).
 *
 * Run: bun scripts/evidence/hf-portfolio/hf003/record-benchmark.ts
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

interface BenchmarkRecord extends LedgerRow {
  sources: string[];
  recordedAt: string;
  benchmarkRun: {
    workItem: string;
    fixtures: Array<{ clipId: string; evidence: string }>;
    resourceCaveats: string[];
    promotionGate: { gatingState: string };
    latency: Record<string, unknown>;
    memory: Record<string, unknown>;
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
if (record.benchmarkRun.workItem !== "HF003") {
  fail(`workItem must be "HF003" (got "${record.benchmarkRun.workItem}")`);
}

// --- 3. every evidence pointer resolves and parses --------------------------
// Evidence pointers are recorded REPO-RELATIVE (the evidence tree's own
// convention); resolve against the repo root, falling back to the record's
// own directory.
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
for (const fixture of record.benchmarkRun.fixtures) {
  const evidencePath = existsSync(join(REPO_ROOT, fixture.evidence))
    ? join(REPO_ROOT, fixture.evidence)
    : join(HERE, fixture.evidence);
  if (!existsSync(evidencePath)) {
    fail(`evidence pointer does not resolve: ${fixture.evidence}`);
    continue;
  }
  try {
    JSON.parse(readFileSync(evidencePath, "utf8"));
  } catch (error) {
    fail(`evidence file does not parse: ${fixture.evidence} (${String(error)})`);
  }
}

// --- 4. the honest resource caveats -----------------------------------------
const caveats = record.benchmarkRun.resourceCaveats.join(" ");
if (!caveats.includes("N/A")) {
  fail("the GPU-memory N/A caveat is missing (no GPU on the benchmark host)");
}
if (!caveats.includes("RSS")) {
  fail("the process-RSS substitute caveat is missing");
}
if (!caveats.includes("CPU") || !caveats.toLowerCase().includes("wall-clock")) {
  fail("the CPU wall-clock latency caveat is missing");
}
const memoryBlock = JSON.stringify(record.benchmarkRun.memory);
if (!memoryBlock.includes("N/A")) {
  fail("the memory block must record GPU memory as N/A honestly");
}

// --- verdict ----------------------------------------------------------------
if (failures.length > 0) {
  console.error("HF003 benchmark record FAILED validation:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("HF003 benchmark record stands:");
console.log(`  candidate ${record.candidate} @ ${record.revision.slice(0, 12)} (gatingState: ${record.gatingState})`);
for (const fixture of record.benchmarkRun.fixtures) {
  console.log(`  evidence: ${fixture.evidence}`);
}
console.log("  provenance echo verbatim vs the HF002 ledger; no promotion recorded; caveats present");
