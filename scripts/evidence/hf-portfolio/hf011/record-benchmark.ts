/**
 * HF011 — the benchmark-record validator (the TS side of the evidence tree).
 *
 * Follows the HF004/HF008/HF010 pattern (record-benchmark.ts): this entry
 * loads `scripts/evidence/hf-portfolio/hf011/benchmark-record.json` — the
 * HF011 benchmark flight's ledger-shaped record — and checks it against
 * the authorities it claims to stand on. The HF011 shape (ONE candidate,
 * resource-refused, whose acceptance is a COMPARISON against the merged
 * HF010 flight under the SAME fixtures): the record carries the
 * ViewCrafter ledger row echoed VERBATIM, and the validator additionally
 * pins:
 *
 * 1. the candidate block echoes its provenance-ledger row VERBATIM (all
 *    twelve fields: candidate, taskProfiles, modelUrl, revision,
 *    modelLicense, codeLicense, weightsProvenance, datasetProvenance,
 *    commercialUse, gatingState, sources, recordedAt);
 * 2. no promotion: the candidate's gatingState stays `candidate` (HF015
 *    is the TL's gate alone);
 * 3. the typed refusal is present AND pinned to the EXECUTED preflight
 *    evidence (type resource-infeasible-host, verdict refused, the
 *    reasons, the weights-never-downloaded + bounded-probes-only pins,
 *    GPU honestly N/A, and the no-auth-wall record);
 * 4. NO fabricated measurements: the quality/latency/memory blocks carry
 *    `not-measured-typed-refusal` statuses and no measurement keys (a
 *    PSNR/SSIM/camera-error/wall-clock figure would be a fabrication —
 *    the model never ran); every fixture records the
 *    consumed-not-run status with scored false; a recursive scan refuses
 *    any measurement-shaped key anywhere in the benchmarkRun;
 * 5. the SAME-FIXTURE contract (the acceptance's core): the record's
 *    fixture gate must carry the HF010 pin sha256 66ef1b4a… AND the
 *    actual committed fixture file must hash to exactly that pin (the
 *    same fixtures, enforced — never asserted);
 * 6. every evidence pointer resolves to a committed file that parses; the
 *    partial deliverables must all be present (the executed preflight,
 *    the load analysis, the license posture, THE comparison design, the
 *    metric self-check, the fixtures-consumption report, the contract
 *    mappings, the ready-to-run script);
 * 7. the license-posture block is present, cites recorded terms, and
 *    carries the never-legal-advice posture;
 * 8. the honest resource caveats are present (GPU N/A + weights never
 *    downloaded + no fabricated numbers + the fail-closed full-mode host
 *    floor + the double fixture sha verification + the shared-estimator
 *    import claim);
 * 9. the load-bearing contract evidence: the emitted compat JSON must
 *    carry the STATIC-REVIEW label, all 5 task-profile input rows, the 3
 *    output rows, the 6-axis conditioning-class comparison (the
 *    sparse-view class vs HF010's video class), and the PARTIAL profile
 *    verdict; the metric self-check must be labeled as implementation
 *    evidence, NOT a model measurement, with zero failures; the
 *    comparison design must pin the same fixture set + the shared
 *    metric implementations + the 25-shared-target-pose rule.
 *
 * Exits 0 when the record stands; exits 1 with the failing check
 * otherwise (fail-closed — a drifted benchmark record refuses, never
 * passes silently).
 *
 * Run: bun scripts/evidence/hf-portfolio/hf011/record-benchmark.ts
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RECORD_PATH = join(HERE, "benchmark-record.json");
const LEDGER_PATH = join(HERE, "..", "provenance-ledger.json");
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
const HF010_DIR = join(HERE, "..", "hf010");
const FIXTURE_PATH = join(HF010_DIR, "fixtures", "hf010-camera-paths.json");

/** The ledger row fields the candidate block must echo verbatim. */
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
  "recordedAt",
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
  recordedAt: string;
}

interface BenchmarkRecord {
  benchmarkRun: {
    workItem: string;
    provenanceLedgerEcho: { note: string; candidates: LedgerRow[] };
    modelRuntime: Record<string, Record<string, string>>;
    typedRefusal: { type: string; reasons: string[]; evidence: string; note: string };
    fixtures: Array<{
      fixtureId: string;
      status: string;
      scored?: boolean;
      unscoredReason?: string;
      evidence: string;
    }>;
    licensePosture: { status: string; viewcrafter: string; evidence: string };
    quality: { status: string; note: string; contractCompatibilityVerdict: string; evidence: string };
    latency: { status: string; note: string };
    memory: { gpuMemory: string; status: string; note: string };
    resourceCaveats: string[];
    partialDeliverables: Record<string, { path: string; description: string }>;
    promotionGate: { gatingState: string; blockersObserved: string[]; note: string };
  };
}

const failures: string[] = [];
const fail = (message: string): void => {
  failures.push(message);
};

// --- load the record + the ledger ---------------------------------------------

if (!existsSync(RECORD_PATH)) {
  console.error(`benchmark record missing: ${RECORD_PATH}`);
  process.exit(1);
}
const record = JSON.parse(readFileSync(RECORD_PATH, "utf8")) as BenchmarkRecord;
const run = record.benchmarkRun;

if (!existsSync(LEDGER_PATH)) {
  console.error(`provenance ledger missing: ${LEDGER_PATH}`);
  process.exit(1);
}
const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as unknown;
const ledgerRows = Array.isArray(ledger)
  ? (ledger as LedgerRow[])
  : ((ledger as { rows?: LedgerRow[] }).rows ?? (ledger as { candidates?: LedgerRow[] }).candidates ?? []);
const ledgerRow = ledgerRows.find((r) => r.candidate === "ViewCrafter");
if (!ledgerRow) {
  console.error("the provenance ledger does not carry the ViewCrafter row");
  process.exit(1);
}

// --- 1. the verbatim ledger echo ----------------------------------------------

const echoed = run.provenanceLedgerEcho?.candidates?.find((c) => c.candidate === "ViewCrafter");
if (!echoed) {
  fail("the record does not carry the ViewCrafter candidate block");
} else {
  for (const field of ECHO_FIELDS) {
    if (JSON.stringify(echoed[field]) !== JSON.stringify(ledgerRow[field])) {
      fail(`the candidate block's "${field}" does not echo the ledger row verbatim`);
    }
  }
}

// --- 2. no promotion ------------------------------------------------------------

const echoedState = echoed?.gatingState ?? "(missing)";
if (echoedState !== "candidate") {
  fail(`promotion drift: the echoed gatingState is "${echoedState}" (must stay candidate — HF015 owns promotion)`);
}
if (run.promotionGate?.gatingState !== "candidate") {
  fail("the promotionGate block does not keep gatingState candidate");
}

// --- 3. the typed refusal, pinned to the executed preflight ---------------------

const refusal = run.typedRefusal;
if (refusal?.type !== "resource-infeasible-host") {
  fail(`the typed refusal type is "${refusal?.type}" (expected resource-infeasible-host)`);
}
if (!Array.isArray(refusal?.reasons) || refusal.reasons.length < 4) {
  fail("the typed refusal does not carry its reasons");
}
const refusalEvidence = readEvidence(refusal?.evidence);
if (refusalEvidence) {
  const fr = refusalEvidence as Record<string, unknown>;
  if (fr.verdict !== "refused" || fr.refusalType !== "resource-infeasible-host") {
    fail("the refusal evidence JSON does not record the EXECUTED refusal (verdict/refusalType)");
  }
  if (fr.weightsDownloaded !== false || fr.boundedProbesOnly !== true) {
    fail("the refusal evidence does not pin weights-never-downloaded + bounded-probes-only");
  }
  const gate = fr.fixtureGate as Record<string, unknown> | undefined;
  if (!gate || gate.sha256 !== "66ef1b4ad68208f9e04341ed3dfe3384467e0b7990fcc1def4813a71cbcbf3a1" || gate.shaMatches !== true) {
    fail("the refusal evidence's fixture gate does not record the HF010 pin as sha-matched");
  }
} else {
  fail(`the typed refusal evidence does not resolve: ${refusal?.evidence}`);
}

// --- 4. NO fabricated measurements ----------------------------------------------

for (const block of ["quality", "latency", "memory"]) {
  const status = (run as unknown as Record<string, Record<string, string>>)[block]?.status;
  if (status !== "not-measured-typed-refusal") {
    fail(`the ${block} block status is "${status}" (expected not-measured-typed-refusal)`);
  }
}
const MEASUREMENT_SHAPED = [
  "novelViewPsnrDb",
  "psnr",
  "ssim",
  "cameraEndpointAngularErrorDeg",
  "meanConsecutiveSsim",
  "meanAngularErrorDeg",
  "endpointTranslationErrorM",
  "cornerReprojectionPx",
  "hallucinatedRegionRate",
  "wallClockMsPerOutputSecond",
  "peakGpuMemoryGiB",
  "reprojectionResidualPx",
  "sourceContentIdentity",
  "latencyMs",
  "latencySeconds",
];
scanMeasurementKeys(run, "", MEASUREMENT_SHAPED);
if (run.memory?.gpuMemory && !run.memory.gpuMemory.startsWith("N/A")) {
  fail("the memory block's gpuMemory must be typed N/A (no GPU on the benchmark host; never zero)");
}

// every fixture: consumed-not-run, unscored
for (const fixture of run.fixtures ?? []) {
  if (fixture.scored !== false) {
    fail(`fixture ${fixture.fixtureId} is scored ${String(fixture.scored)} — no model ran`);
  }
  if (!String(fixture.status ?? "").startsWith("consumed-not-run")) {
    fail(`fixture ${fixture.fixtureId} status "${fixture.status}" is not consumed-not-run`);
  }
}

// --- 5. the SAME-FIXTURE contract (sha-enforced, never asserted) ----------------

const FIXTURE_PIN = "66ef1b4ad68208f9e04341ed3dfe3384467e0b7990fcc1def4813a71cbcbf3a1";
if (!existsSync(FIXTURE_PATH)) {
  fail(`the consumed fixture file is missing: ${FIXTURE_PATH}`);
} else {
  const digest = createHash("sha256").update(readFileSync(FIXTURE_PATH, "utf8"), "utf8").digest("hex");
  if (digest !== FIXTURE_PIN) {
    fail(`the committed fixture drifted: sha256 ${digest} != the pin ${FIXTURE_PIN}`);
  }
}
const consumption = readEvidence("scripts/evidence/hf-portfolio/hf011/results/fixtures-consumption.json") as
  | { fixtureSet?: { sha256?: string; version?: string }; windows?: Record<string, unknown> }
  | undefined;
if (!consumption?.fixtureSet || consumption.fixtureSet.sha256 !== FIXTURE_PIN || consumption.fixtureSet.version !== "hf010.camera-paths@1") {
  fail("the fixtures-consumption report does not pin the HF010 fixture set + sha");
}
if (!consumption.windows || Object.keys(consumption.windows).length !== 6) {
  fail("the fixtures-consumption report does not carry all 6 HF010 windows");
}

// --- 6. every evidence pointer resolves + the partial deliverables ----------------

const DELIVERABLES = [
  "executedPreflight",
  "loadAnalysis",
  "licensePosture",
  "comparisonDesign",
  "metricImplementations",
  "metricSelfCheck",
  "fixturesConsumption",
  "contractMappings",
  "readyToRunScript",
];
for (const key of DELIVERABLES) {
  const entry = run.partialDeliverables?.[key];
  if (!entry?.path || !entry.description) {
    fail(`the partial deliverable "${key}" is missing its path/description`);
    continue;
  }
  if (!readEvidence(entry.path)) {
    fail(`the partial deliverable "${key}" pointer does not resolve: ${entry.path}`);
  }
}

// --- 7. the license posture --------------------------------------------------------

const license = run.licensePosture;
if (!license?.status?.includes("argued-from-recorded-terms-only")) {
  fail("the license-posture status must state argued-from-recorded-terms-only");
}
if (!license.status.includes("never legal advice") || !license.viewcrafter.includes("datasetProvenance unknown")) {
  fail("the license posture must carry the never-legal-advice posture + the datasetProvenance open edge");
}

// --- 8. the honest resource caveats --------------------------------------------------

const caveats = run.resourceCaveats ?? [];
if (caveats.length < 5) {
  fail("the resource caveats block is thin (expected >= 5: GPU N/A, weights never downloaded, no fabricated numbers, the fail-closed full mode, the fixture sha, the shared-estimator import)");
}
if (!caveats.some((c) => c.includes("GPU N/A")) || !caveats.some((c) => c.includes("NEVER downloaded"))) {
  fail("the resource caveats must record GPU N/A honestly + weights never downloaded");
}

// --- 9. the load-bearing contract + design evidence ---------------------------------

const compat = readEvidence("scripts/evidence/hf-portfolio/hf011/results/contract-compatibility.json") as
  | {
      label?: string;
      inputMappings?: unknown[];
      outputMappings?: unknown[];
      conditioningClassComparison?: unknown[];
      rightsMappings?: unknown[];
      profileVerdict?: string;
      failures?: string[];
    }
  | undefined;
if (!compat) {
  fail("the contract-compatibility JSON does not resolve");
} else {
  if (!compat.label?.includes("STATIC-REVIEW")) {
    fail("the compat JSON must carry the STATIC-REVIEW label");
  }
  if ((compat.inputMappings?.length ?? 0) !== 5) {
    fail("the compat JSON must carry all 5 task-profile input rows");
  }
  if ((compat.outputMappings?.length ?? 0) !== 3) {
    fail("the compat JSON must carry all 3 task-profile output rows");
  }
  if ((compat.conditioningClassComparison?.length ?? 0) !== 6) {
    fail("the compat JSON must carry the 6-axis conditioning-class comparison (the sparse-view vs video class)");
  }
  if (!compat.profileVerdict?.startsWith("PARTIAL")) {
    fail("the compat JSON's profile verdict must be the honest PARTIAL");
  }
  if ((compat.failures?.length ?? 0) > 0) {
    fail("the compat JSON itself recorded evidence failures");
  }
}

const selfcheck = readEvidence("scripts/evidence/hf-portfolio/hf011/results/metric-selfcheck.json") as
  | { label?: string; total?: number; passed?: number; failures?: number }
  | undefined;
if (!selfcheck) {
  fail("the metric self-check JSON does not resolve");
} else {
  if (!selfcheck.label?.includes("NOT a model measurement")) {
    fail("the self-check must be labeled implementation evidence, NOT a model measurement");
  }
  if ((selfcheck.failures ?? 1) !== 0 || selfcheck.passed !== selfcheck.total) {
    fail(`the self-check has failures: ${selfcheck.passed}/${selfcheck.total}`);
  }
}

const design = readEvidence("scripts/evidence/hf-portfolio/hf011/results/comparison-design.json") as
  | {
      label?: string;
      fixtures?: { sha256?: string; fixtureSet?: string };
      frameHorizonRule?: { theRule?: string };
      metricSplit?: { sharedMetrics?: unknown[]; hf011SpecificMetrics?: unknown[] };
    }
  | undefined;
if (!design) {
  fail("the comparison-design JSON does not resolve");
} else {
  if (design.fixtures?.sha256 !== FIXTURE_PIN || design.fixtures.fixtureSet !== "hf010.camera-paths@1") {
    fail("the comparison design must pin the SAME (HF010) fixture set + sha");
  }
  if (!design.frameHorizonRule?.theRule?.includes("round(80*i/24)")) {
    fail("the comparison design must pin the 25-shared-target-pose resampling rule");
  }
  if ((design.metricSplit?.sharedMetrics?.length ?? 0) < 5 || (design.metricSplit?.hf011SpecificMetrics?.length ?? 0) < 3) {
    fail("the comparison design must carry the shared metric set + the HF011-specific metric set");
  }
  if (!design.label?.includes("typed not-measured")) {
    fail("the comparison design must be labeled typed not-measured");
  }
}

// --- helpers --------------------------------------------------------------------------

function readEvidence(relPath: string | undefined): unknown {
  if (!relPath) {
    return undefined;
  }
  const rooted = relPath.startsWith("/") ? relPath : join(REPO_ROOT, relPath);
  if (!existsSync(rooted)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(rooted, "utf8"));
  } catch {
    // non-JSON evidence (the .py script) — existence is what the record claims
    return { exists: true };
  }
}

function scanMeasurementKeys(node: unknown, path: string, keys: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => scanMeasurementKeys(item, `${path}[${i}]`, keys));
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if (keys.some((k) => lower === k.toLowerCase())) {
        // the only legitimate occurrences are inside DESCRIPTION strings, never
        // as object keys — a key hit means a measurement-shaped field exists
        fail(`fabrication guard: the measurement-shaped key "${key}" appears at ${path || "(root)"} with value ${JSON.stringify(value)}`);
      }
      scanMeasurementKeys(value, `${path}.${key}`.replace(/^\./, ""), keys);
    }
  }
}

// --- verdict ----------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`HF011 record-benchmark FAILED (${failures.length} failures):`);
  for (const f of failures) {
    console.error(`  - ${f}`);
  }
  process.exit(1);
}

console.log(
  "HF011 record-benchmark: OK — the ledger row echoed verbatim (12 fields), the typed refusal pinned to the EXECUTED " +
    "preflight, NO measurement-shaped key anywhere in the benchmarkRun, the SAME-FIXTURE pin sha-enforced against the " +
    "committed HF010 fixture, all 9 partial deliverables resolving, the license posture + resource caveats honest, " +
    "the compat/selfcheck/design evidence load-bearing. No promotion (gatingState candidate; HF015 owns adjudication).",
);
