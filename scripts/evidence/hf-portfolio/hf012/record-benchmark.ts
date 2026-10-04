/**
 * HF012 — the benchmark-record validator (the TS side of the evidence tree).
 *
 * Follows the HF004/HF008/HF010/HF011 pattern (record-benchmark.ts): this
 * entry loads `scripts/evidence/hf-portfolio/hf012/benchmark-record.json` —
 * the HF012 benchmark flight's ledger-shaped record — and checks it against
 * the authorities it claims to stand on. The HF012 shape (ONE candidate,
 * resource-refused, whose acceptance is a motion/identity benchmark AGAINST
 * the Anime/NPR direction under the no-canonical-truth constraint): the
 * record carries the Wan2.2-Animate ledger row echoed VERBATIM, and the
 * validator additionally pins:
 *
 * 1. the candidate block echoes its provenance-ledger row VERBATIM (all
 *    twelve fields: candidate, taskProfiles, modelUrl, revision,
 *    modelLicense, codeLicense, weightsProvenance, datasetProvenance,
 *    commercialUse, gatingState, sources, recordedAt);
 * 2. no promotion: the candidate's gatingState stays `candidate` (HF015
 *    is the TL's gate alone);
 * 3. the typed refusal is present AND pinned to the EXECUTED preflight
 *    evidence (type resource-infeasible-host, verdict refused, the
 *    reasons verbatim, the weights-never-downloaded + bounded-probes-only
 *    pins, GPU honestly N/A, and the no-auth-wall record);
 * 4. NO fabricated measurements: the quality/latency/memory blocks carry
 *    `not-measured-typed-refusal` statuses and no measurement keys (a
 *    joint-error/identity-drift/style-distance/SSIM figure would be a
 *    fabrication — the model never ran); every fixture records its
 *    designed-not-run status with scored false; a recursive scan refuses
 *    any measurement-shaped key anywhere in the benchmarkRun;
 * 5. THE NO-CANONICAL-TRUTH CONSTRAINT (the acceptance's own words —
 *    load-bearing): the record's resource caveats must carry it, the
 *    emitted compat JSON must pin the machine-checkable invariant with
 *    its canonical truth sources (swm-entity-state +
 *    authorized-avatar-reference) and the measurands (NEITHER lane is a
 *    truth source), and the self-check must have proven the refusal
 *    direction (a renderer-truth plan refused);
 * 6. every evidence pointer resolves to a committed file that parses; the
 *    partial deliverables must all be present (the executed preflight,
 *    the load analysis, the license posture, THE Anime/NPR comparison,
 *    the metric implementations, the metric self-check, the contract
 *    mappings, the ready-to-run script);
 * 7. the license-posture block is present, cites recorded terms, carries
 *    the never-legal-advice posture, AND records the FLUX-route
 *    dependency edge;
 * 8. the honest resource caveats are present (GPU N/A + weights never
 *    downloaded + no fabricated numbers + the fail-closed full-mode host
 *    floor + the no-canonical-truth invariant + the shared-estimator
 *    import);
 * 9. the load-bearing contract + design evidence: the emitted compat JSON
 *    must carry the STATIC-REVIEW label, all 3 task-profile input rows,
 *    the 3 output rows, the 5-axis canonical-entity-motion conditioning
 *    table, and the PARTIAL profile verdict; the metric self-check must
 *    be labeled as implementation evidence, NOT a model measurement,
 *    with zero failures; the Anime/NPR comparison must carry the
 *    static-review capability delta + the typed not-measured comparison
 *    design with the same-estimator fairness rule + the
 *    swm-entity-state/authorized-avatar-reference ground-truth
 *    conventions.
 *
 * Exits 0 when the record stands; exits 1 with the failing check
 * otherwise (fail-closed — a drifted benchmark record refuses, never
 * passes silently).
 *
 * Run: bun scripts/evidence/hf-portfolio/hf012/record-benchmark.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RECORD_PATH = join(HERE, "benchmark-record.json");
const LEDGER_PATH = join(HERE, "..", "provenance-ledger.json");
const REPO_ROOT = join(HERE, "..", "..", "..", "..");

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
    licensePosture: { status: string; wan22animate: string; evidence: string };
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
const ledgerRow = ledgerRows.find((r) => r.candidate === "Wan2.2-Animate");
if (!ledgerRow) {
  console.error("the provenance ledger does not carry the Wan2.2-Animate row");
  process.exit(1);
}

// --- 1. the verbatim ledger echo ----------------------------------------------

const echoed = run.provenanceLedgerEcho?.candidates?.find((c) => c.candidate === "Wan2.2-Animate");
if (!echoed) {
  fail("the record does not carry the Wan2.2-Animate candidate block");
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
  const reasons = (fr.reasons as string[] | undefined) ?? [];
  for (const reason of refusal?.reasons ?? []) {
    if (!reasons.includes(reason)) {
      fail(`the record's typed-refusal reason is not verbatim in the executed preflight evidence: "${reason.slice(0, 80)}..."`);
    }
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
  "meannormalizedjointerror",
  "endpointjointerror",
  "velocitydirectionagreement",
  "meanpairwiseidentitydistance",
  "maxdriftfromreference",
  "drifttrendslopeperframe",
  "meanstyledistance",
  "maxstyledistance",
  "meanchannelshift",
  "meanconsecutivessim",
  "flowwarpresidual",
  "wallexpmsperoutputsecond1",
  "psnr",
  "ssim",
  "latencyms",
  "peakgpumemorygib",
];
scanMeasurementKeys(run, "", MEASUREMENT_SHAPED);
if (run.memory?.gpuMemory && !run.memory.gpuMemory.startsWith("N/A")) {
  fail("the memory block's gpuMemory must be typed N/A (no GPU on the benchmark host; never zero)");
}

// every fixture: designed-not-run, unscored
for (const fixture of run.fixtures ?? []) {
  if (fixture.scored !== false) {
    fail(`fixture ${fixture.fixtureId} is scored ${String(fixture.scored)} — no model ran`);
  }
  if (!String(fixture.status ?? "").startsWith("designed-not-run")) {
    fail(`fixture ${fixture.fixtureId} status "${fixture.status}" is not designed-not-run`);
  }
}

// --- 5. THE NO-CANONICAL-TRUTH CONSTRAINT (machine-checked) ---------------------

const caveats = run.resourceCaveats ?? [];
const invariantCaveat = caveats.find((c) => c.includes("NO-CANONICAL-TRUTH"));
if (!invariantCaveat) {
  fail("the resource caveats must record THE no-canonical-truth constraint (the acceptance's own words)");
}

const compat = readEvidence("scripts/evidence/hf-portfolio/hf012/results/contract-compatibility.json") as
  | {
      label?: string;
      inputMappings?: unknown[];
      outputMappings?: unknown[];
      conditioningQuestion?: unknown[];
      rightsMappings?: unknown[];
      metricMappings?: unknown[];
      theNoCanonicalTruthInvariant?: {
        statement?: string;
        machineCheck?: string;
        canonicalTruthSources?: string[];
        measurands?: string[];
      };
      profileVerdict?: string;
      failures?: string[];
    }
  | undefined;
if (!compat) {
  fail("the contract-compatibility JSON does not resolve");
} else {
  const inv = compat.theNoCanonicalTruthInvariant;
  if (!inv?.statement?.includes("no canonical player truth may be generated solely by the renderer")) {
    fail("the compat JSON's invariant statement must carry the acceptance's own words");
  }
  if (!inv?.machineCheck?.includes("no_canonical_truth_invariant")) {
    fail("the compat JSON must name the machine check (no_canonical_truth_invariant)");
  }
  const sources = inv?.canonicalTruthSources ?? [];
  if (!sources.includes("swm-entity-state") || !sources.includes("authorized-avatar-reference")) {
    fail("the compat JSON's canonical truth sources must be exactly the SWM entity state + the authorized avatar reference");
  }
  const measurands = inv?.measurands ?? [];
  if (!measurands.some((m) => m.includes("Wan2.2-Animate")) || !measurands.some((m) => m.includes("anime-npr"))) {
    fail("the compat JSON's measurands must include BOTH comparison lanes (neither is a truth source)");
  }
}

const selfcheck = readEvidence("scripts/evidence/hf-portfolio/hf012/results/metric-selfcheck.json") as
  | { label?: string; total?: number; passed?: number; failures?: number; cases?: Array<{ caseId?: string; passed?: boolean }> }
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
  const invariantRefusalCases = (selfcheck.cases ?? []).filter((c) => c.caseId?.includes("refused"));
  if (invariantRefusalCases.length < 2 || !invariantRefusalCases.every((c) => c.passed)) {
    fail("the self-check must prove the no-canonical-truth invariant's REFUSAL direction (renderer-truth plans refused, both lanes)");
  }
}

// --- 6. every evidence pointer resolves + the partial deliverables ----------------

const DELIVERABLES = [
  "executedPreflight",
  "loadAnalysis",
  "licensePosture",
  "animeNprComparison",
  "metricImplementations",
  "metricSelfCheck",
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
if (!license.status.includes("never legal advice") || !license.wan22animate.includes("datasetProvenance unknown")) {
  fail("the license posture must carry the never-legal-advice posture + the datasetProvenance open edge");
}
if (!license.wan22animate.includes("FLUX")) {
  fail("the license posture must record the FLUX-route dependency edge (the recommended preprocessing route's third-party gated dependency)");
}

// --- 8. the honest resource caveats --------------------------------------------------

if (caveats.length < 5) {
  fail("the resource caveats block is thin (expected >= 5: GPU N/A, weights never downloaded, no fabricated numbers, the fail-closed full mode, the no-canonical-truth invariant, the shared-estimator import)");
}
if (!caveats.some((c) => c.includes("GPU N/A")) || !caveats.some((c) => c.includes("NEVER downloaded"))) {
  fail("the resource caveats must record GPU N/A honestly + weights never downloaded");
}
if (!caveats.some((c) => c.includes("IMPORTED from the merged hf010"))) {
  fail("the resource caveats must record the shared-estimator import claim (both lanes scored by the same code)");
}

// --- 9. the load-bearing contract + design evidence ---------------------------------

if (compat) {
  if (!compat.label?.includes("STATIC-REVIEW")) {
    fail("the compat JSON must carry the STATIC-REVIEW label");
  }
  if ((compat.inputMappings?.length ?? 0) !== 3) {
    fail("the compat JSON must carry all 3 task-profile input rows");
  }
  if ((compat.outputMappings?.length ?? 0) !== 3) {
    fail("the compat JSON must carry all 3 task-profile output rows");
  }
  if ((compat.conditioningQuestion?.length ?? 0) !== 5) {
    fail("the compat JSON must carry the 5-axis canonical-entity-motion conditioning table (the key honest question)");
  }
  if (!compat.profileVerdict?.startsWith("PARTIAL")) {
    fail("the compat JSON's profile verdict must be the honest PARTIAL");
  }
  if ((compat.failures?.length ?? 0) > 0) {
    fail("the compat JSON itself recorded evidence failures");
  }
}

const comparison = readEvidence("scripts/evidence/hf-portfolio/hf012/results/anime-npr-comparison.json") as
  | {
      label?: string;
      capabilityDelta?: unknown[];
      comparisonDesign?: {
        label?: string;
        fixtures?: {
          groundTruthTrack?: { provenance?: string };
          authorizedReference?: { provenance?: string };
        };
        metrics?: { sharedForBothLanes?: string[] };
      };
    }
  | undefined;
if (!comparison) {
  fail("the anime-npr comparison JSON does not resolve");
} else {
  if (!comparison.label?.includes("STATIC-REVIEW")) {
    fail("the comparison JSON must carry the STATIC-REVIEW label on the capability delta");
  }
  if ((comparison.capabilityDelta?.length ?? 0) < 8) {
    fail("the comparison JSON must carry the 8-axis capability-delta table");
  }
  const design = comparison.comparisonDesign;
  if (!design?.label?.includes("typed not-measured")) {
    fail("the comparison design must be labeled typed not-measured");
  }
  if (design?.fixtures?.groundTruthTrack?.provenance !== "swm-entity-state") {
    fail("the comparison design's ground-truth track must be the swm-entity-state provenance (the no-canonical-truth rule)");
  }
  if (design?.fixtures?.authorizedReference?.provenance !== "authorized-avatar-reference") {
    fail("the comparison design's authorized reference must carry the authorized-avatar-reference provenance");
  }
  if ((design?.metrics?.sharedForBothLanes?.length ?? 0) < 5) {
    fail("the comparison design must carry the shared-for-both-lanes metric set (the fairness rule)");
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
      if (keys.some((k) => lower === k)) {
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
  console.error(`HF012 record-benchmark FAILED (${failures.length} failures):`);
  for (const f of failures) {
    console.error(`  - ${f}`);
  }
  process.exit(1);
}

console.log(
  "HF012 record-benchmark: OK — the ledger row echoed verbatim (12 fields), the typed refusal pinned to the EXECUTED " +
    "preflight (reasons verbatim), NO measurement-shaped key anywhere in the benchmarkRun, THE no-canonical-truth " +
    "constraint machine-checked (the invariant block + the refusal-direction self-check + the caveat + the comparison " +
    "design's provenance pins), all 8 partial deliverables resolving, the license posture (incl. the FLUX-route edge) + " +
    "resource caveats honest, the compat/selfcheck/comparison evidence load-bearing. No promotion (gatingState " +
    "candidate; HF015 owns adjudication).",
);
