/**
 * HF013 — the benchmark-record validator (the TS side of the evidence tree).
 *
 * Follows the HF004/HF008/HF010/HF011/HF012 pattern (record-benchmark.ts):
 * this entry loads `scripts/evidence/hf-portfolio/hf013/benchmark-record.json`
 * — the HF013 benchmark flight's ledger-shaped record — and checks it against
 * the authorities it claims to stand on. The HF013 shape (ONE candidate,
 * resource-refused, whose acceptance is a JOINT audio-video benchmark whose
 * license leg is FIRST-CLASS and whose evidence-chain boundary is
 * load-bearing): the record carries the LTX-2.3 ledger row echoed VERBATIM,
 * and the validator additionally pins:
 *
 * 1. the candidate block echoes its provenance-ledger row VERBATIM (all
 *    twelve fields: candidate, taskProfiles, modelUrl, revision,
 *    modelLicense, codeLicense, weightsProvenance, datasetProvenance,
 *    commercialUse, gatingState, sources, recordedAt);
 * 2. no promotion: the candidate's gatingState stays `candidate` (HF015
 *    is the TL's gate alone);
 * 3. the typed refusal is present AND pinned to the EXECUTED preflight
 *    evidence (type resource-infeasible-host, verdict refused, the
 *    reasons verbatim, the weights-never-downloaded +
 *    bounded-probes-only pins, GPU honestly N/A, and the no-auth-wall
 *    record);
 * 4. NO fabricated measurements: the quality/latency/memory blocks carry
 *    `not-measured-typed-refusal` statuses and no measurement keys (an
 *    onset-sync/WER/audio-hallucination/roundtrip-PSNR/detail-gain figure
 *    would be a fabrication — the model never ran); every fixture records
 *    its designed-not-run status with scored false; a recursive scan
 *    refuses any measurement-shaped key anywhere in the benchmarkRun;
 * 5. THE EVIDENCE-CHAIN EXCLUSION (the load-bearing verdict, never
 *    weakened): the record's dedicated block must carry the
 *    generated-audio-never-evidence statement, the machine check name,
 *    BOTH directions (the refusal + the accepted W207/W208 shapes), and
 *    what generated audio remains (measurand / rights-gated render
 *    product); the self-check must have proven the refusal direction; the
 *    emitted compat JSON must carry the NOT-COMPATIBLE-BY-DOCTRINE
 *    verdict with the W207/W208 authority needles;
 * 6. THE LICENSE POSTURE (first-class — the acceptance's own words): the
 *    record's block must state argued-from-recorded-terms-only +
 *    never legal advice, and the license-posture JSON must carry the
 *    THREE sources distinguished (LICENSE / LICENSE-2 / LICENSE-2_x) +
 *    the HF LICENSE at the pinned revision + the governing-agreement
 *    ambiguity + the research-grade/watchlist-pending-terms verdict + the
 *    codeLicense NOASSERTION probe + datasetProvenance unknown;
 * 7. every evidence pointer resolves to a committed file that parses; the
 *    partial deliverables must all be present (the executed preflight,
 *    the load analysis, the license posture, the model I/O surface, the
 *    metric implementations, the metric self-check, THE upscaling
 *    pipeline comparison, the contract mappings, the ready-to-run
 *    script);
 * 8. the honest resource caveats are present (GPU N/A + weights never
 *    downloaded + no fabricated numbers + the fail-closed full-mode host
 *    floor + the evidence-chain exclusion + the shared-estimator import);
 * 9. the load-bearing contract + design evidence: the emitted compat JSON
 *    must carry the STATIC-REVIEW label, all 3 task-profile input rows,
 *    the 3 output rows, the PARTIAL profile verdict; the self-check must
 *    be labeled implementation evidence NOT a model measurement with zero
 *    failures; the upscaling comparison must carry the static-review
 *    capability delta + the typed not-measured comparison design with
 *    the repo's-own-artifacts source-input rule + the no-lying metric.
 *
 * Exits 0 when the record stands; exits 1 with the failing check
 * otherwise (fail-closed — a drifted benchmark record refuses, never
 * passes silently).
 *
 * Run: bun scripts/evidence/hf-portfolio/hf013/record-benchmark.ts
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
    modelRuntime: Record<string, string>;
    typedRefusal: { type: string; verdict: string; evidence: string; note: string };
    fixtures: Array<{
      fixtureId: string;
      status: string;
      scored?: boolean;
      unscoredReason?: string;
      evidence: string;
    }>;
    licensePosture: { status: string; ltx23: string; evidence: string };
    quality: { status: string; note: string; contractCompatibilityVerdict: string; evidence: string };
    latency: { status: string; note: string };
    memory: { gpuMemory: string; status: string; note: string };
    theEvidenceChainExclusion: {
      statement?: string;
      machineCheck?: string;
      acceptedShapes?: string[];
      refusedShapes?: string[];
      whatGeneratedAudioRemains?: string[];
    };
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
const ledgerRow = ledgerRows.find((r) => r.candidate === "LTX-2.3");
if (!ledgerRow) {
  console.error("the provenance ledger does not carry the LTX-2.3 row");
  process.exit(1);
}

// --- 1. the verbatim ledger echo ----------------------------------------------

const echoed = run.provenanceLedgerEcho?.candidates?.find((c) => c.candidate === "LTX-2.3");
if (!echoed) {
  fail("the record does not carry the LTX-2.3 candidate block");
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
if (refusal?.verdict !== "refused") {
  fail(`the typed refusal verdict is "${refusal?.verdict}" (expected refused)`);
}
const refusalEvidence = readEvidence(refusal?.evidence) as
  | { verdict?: string; refusalType?: string; weightsDownloaded?: boolean; boundedProbesOnly?: boolean; reasons?: string[]; authWall?: string }
  | undefined;
if (refusalEvidence) {
  if (refusalEvidence.verdict !== "refused" || refusalEvidence.refusalType !== "resource-infeasible-host") {
    fail("the refusal evidence JSON does not record the EXECUTED refusal (verdict/refusalType)");
  }
  if (refusalEvidence.weightsDownloaded !== false || refusalEvidence.boundedProbesOnly !== true) {
    fail("the refusal evidence does not pin weights-never-downloaded + bounded-probes-only");
  }
  if (!String(refusalEvidence.authWall ?? "").includes("none")) {
    fail("the refusal evidence must record the no-auth-wall finding (the honest contrast with HF010)");
  }
  const reasons = refusalEvidence.reasons ?? [];
  if (reasons.length < 5) {
    fail("the refusal evidence carries fewer than the 5 recorded refusal reasons (arithmetic + GPU + latency + the latent-stage reason)");
  }
  const recordNote = refusal?.note ?? "";
  for (const marker of ["145.295 GiB", "98.9 GiB", "24.4x", "LATENT-space stage"]) {
    if (!recordNote.includes(marker)) {
      fail(`the refusal note does not carry the recorded arithmetic marker: "${marker}"`);
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
  "avonsetsyncerrorms",
  "avcrosscorrelationpeaklagms",
  "commentarywer",
  "audiohallucinationrate",
  "hallucinatedregionrate",
  "meanconsecutivessim",
  "flowwarpresidual",
  "referenceframefidelity",
  "psnrdb",
  "mse",
  "ssimconstantpatches",
  "noinventedcontentrate",
  "detailpreservationgain",
  "highfreqenergy",
  "temporalupscalemotioncoherence",
  "artifactblockboundaryrate",
  "roundtripfidelity",
  "meandrift",
  "latencyms",
  "wallclockmsperoutputsecond",
  "peakgpumemorygib",
  "psnr",
  "ssim",
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

// --- 5. THE EVIDENCE-CHAIN EXCLUSION (machine-checked) ---------------------------

const exclusion = run.theEvidenceChainExclusion;
if (!exclusion?.statement?.includes("NEVER be evidence-chain audio")) {
  fail("the record's evidence-chain exclusion statement must carry the NEVER-be-evidence-chain-audio verdict");
}
if (!exclusion?.machineCheck?.includes("generated_audio_evidence_exclusion")) {
  fail("the record must name the machine check (generated_audio_evidence_exclusion)");
}
if ((exclusion?.acceptedShapes?.length ?? 0) < 2 || !exclusion.acceptedShapes?.some((s) => s.includes("W207"))) {
  fail("the record's accepted shapes must include the W207 transcription-of-observed-audio shape (the HF008 reversal)");
}
if (!exclusion?.refusedShapes?.some((s) => s.includes("GENERATED"))) {
  fail("the record's refused shapes must include the GENERATED shape");
}
if (
  !exclusion?.whatGeneratedAudioRemains?.some((s) => s.includes("MEASURAND")) ||
  !exclusion?.whatGeneratedAudioRemains?.some((s) => s.includes("RENDER PRODUCT"))
) {
  fail("the record must state what generated audio remains (measurand / rights-gated render product) — the boundary is about evidence, not about existence");
}

const selfcheck = readEvidence("scripts/evidence/hf-portfolio/hf013/results/metric-selfcheck.json") as
  | {
      label?: string;
      total?: number;
      passed?: number;
      failures?: number;
      cases?: Array<{ caseId?: string; passed?: boolean }>;
      theEvidenceChainExclusionVerdict?: {
        statement?: string;
        machineCheck?: string;
        refusalDirectionProven?: boolean;
        acceptedShapes?: string[];
        refusedShapes?: string[];
      };
    }
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
  const exclusionCases = (selfcheck.cases ?? []).filter((c) => c.caseId?.startsWith("evidence-exclusion-"));
  if (exclusionCases.length < 4 || !exclusionCases.every((c) => c.passed)) {
    fail("the self-check must prove the evidence-chain exclusion in all four directions (generated REFUSED; W207 ACCEPTED; W208 ACCEPTED; unknown REFUSED)");
  }
  if (!selfcheck.theEvidenceChainExclusionVerdict?.refusalDirectionProven) {
    fail("the self-check's exclusion verdict must record the refusal direction as proven");
  }
}

const compat = readEvidence("scripts/evidence/hf-portfolio/hf013/results/contract-compatibility.json") as
  | {
      label?: string;
      inputMappings?: unknown[];
      outputMappings?: unknown[];
      theEvidenceChainExclusion?: {
        verdict?: string;
        statement?: string;
        machineCheck?: string;
        authorities?: string[];
      };
      rightsMappings?: unknown[];
      outputSeamMapping?: { label?: string; upscalingToday?: string };
      metricMappings?: unknown[];
      profileVerdict?: string;
      failures?: string[];
    }
  | undefined;
if (!compat) {
  fail("the contract-compatibility JSON does not resolve");
} else {
  const compatExclusion = compat.theEvidenceChainExclusion;
  if (compatExclusion?.verdict !== "NOT-COMPATIBLE-BY-DOCTRINE (for the evidence lane)") {
    fail(`the compat JSON's evidence-chain verdict is "${compatExclusion?.verdict}" (expected NOT-COMPATIBLE-BY-DOCTRINE for the evidence lane)`);
  }
  if (!compatExclusion?.statement?.includes("NEVER be evidence-chain audio")) {
    fail("the compat JSON's exclusion statement must carry the NEVER-be-evidence-chain-audio wording");
  }
  if (!compatExclusion?.machineCheck?.includes("generated_audio_evidence_exclusion")) {
    fail("the compat JSON must name the machine check");
  }
  const authorities = compatExclusion?.authorities ?? [];
  if (!authorities.some((a) => a.includes("observation.ts")) || !authorities.some((a) => a.includes("asr/src/observe.ts"))) {
    fail("the compat JSON's exclusion authorities must pin the ProvenanceKind vocabulary + W207 (the repo's own contracts)");
  }
}

// --- 6. THE LICENSE POSTURE (first-class) ----------------------------------------

const license = run.licensePosture;
if (!license?.status?.includes("argued-from-recorded-terms-only")) {
  fail("the license-posture status must state argued-from-recorded-terms-only");
}
if (!license.status.includes("never legal advice") || !license.status.includes("FIRST-CLASS")) {
  fail("the license-posture status must carry the FIRST-CLASS + never-legal-advice posture (the acceptance's own words make this leg first-class)");
}
if (!license.ltx23.includes("watchlist-pending-terms")) {
  fail("the license posture must carry the research-grade/watchlist-pending-terms verdict");
}
if (!license.ltx23.includes("codeLicense unknown") || !license.ltx23.includes("datasetProvenance unknown")) {
  fail("the license posture must record the codeLicense + datasetProvenance open edges");
}

const licenseEvidence = readEvidence("scripts/evidence/hf-portfolio/hf013/results/license-posture.json") as
  | {
      theThreeSourcesDistinguished?: Array<{
        document?: string;
        sha256?: string;
        matchesCommittedFetch?: boolean;
        grantVerbatim?: string;
        role?: string;
      }>;
      hfRepoLicenseAtPinnedRevision?: { sha256?: string; agreementIdentified?: string; isSameAgreementAsLicense2?: boolean };
      governingAgreementAmbiguity?: { status?: string; evidence?: string[] };
      codeLicenseProbe?: { githubApiLicense?: string; verdict?: string };
      datasetProvenance?: string;
      verdict?: string;
      neverLegalAdvice?: boolean;
    }
  | undefined;
if (!licenseEvidence) {
  fail("the license-posture JSON does not resolve");
} else {
  const sources = licenseEvidence.theThreeSourcesDistinguished ?? [];
  if (sources.length !== 3) {
    fail("the license-posture JSON must distinguish the THREE sources (LICENSE / LICENSE-2 / LICENSE-2_x)");
  }
  if (!sources.every((s) => s.sha256 && s.matchesCommittedFetch)) {
    fail("every fetched license source must be sha-verified against the committed research-phase fetch");
  }
  if (!licenseEvidence.hfRepoLicenseAtPinnedRevision?.sha256) {
    fail("the license posture must record the HF repo's own LICENSE fetched at the PINNED revision (a text document — allowed; weights never)");
  }
  if (licenseEvidence.hfRepoLicenseAtPinnedRevision?.isSameAgreementAsLicense2 !== true) {
    fail("the HF LICENSE must be identified as the LICENSE-2 agreement (the agreement-identity finding)");
  }
  if (!String(licenseEvidence.governingAgreementAmbiguity?.status ?? "").includes("OPEN EDGE")) {
    fail("the governing-agreement ambiguity must be recorded as an OPEN EDGE (the card's own sources point at both agreements)");
  }
  if (!String(licenseEvidence.codeLicenseProbe?.githubApiLicense ?? "").includes("NOASSERTION")) {
    fail("the codeLicense probe must record GitHub's NOASSERTION finding (the 'unknown' edge confirmed, not resolved)");
  }
  if (!String(licenseEvidence.verdict ?? "").includes("never legal advice")) {
    fail("the license verdict must carry never-legal-advice");
  }
}

// --- 7. every evidence pointer resolves + the partial deliverables ----------------

const DELIVERABLES = [
  "executedPreflight",
  "loadAnalysis",
  "licensePosture",
  "modelIoSurface",
  "metricImplementations",
  "metricSelfCheck",
  "upscalingPipelineComparison",
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

// --- 8. the honest resource caveats -------------------------------------------------

const caveats = run.resourceCaveats ?? [];
if (caveats.length < 6) {
  fail("the resource caveats block is thin (expected >= 6: GPU N/A, weights never downloaded, no fabricated numbers, the fail-closed full mode, the evidence-chain exclusion, the shared-estimator import)");
}
if (!caveats.some((c) => c.includes("GPU N/A")) || !caveats.some((c) => c.includes("NEVER downloaded"))) {
  fail("the resource caveats must record GPU N/A honestly + weights never downloaded");
}
if (!caveats.some((c) => c.includes("GENERATED commentary audio can NEVER be evidence-chain audio") || c.includes("generated commentary audio can NEVER"))) {
  fail("the resource caveats must record THE evidence-chain exclusion (the load-bearing doctrine)");
}
if (!caveats.some((c) => c.includes("IMPORTED from the merged hf010"))) {
  fail("the resource caveats must record the shared-estimator import claim (both comparison lanes scored by the same code)");
}

// --- 9. the load-bearing contract + design evidence ---------------------------------

if (compat) {
  if (!compat.label?.includes("STATIC-REVIEW")) {
    fail("the compat JSON must carry the STATIC-REVIEW label");
  }
  if ((compat.inputMappings?.length ?? 0) !== 3) {
    fail("the compat JSON must carry all 3 task-profile input rows (neuralVideo / audioVideoGeneration / upscale)");
  }
  if ((compat.outputMappings?.length ?? 0) !== 3) {
    fail("the compat JSON must carry all 3 task-profile output rows");
  }
  if (!compat.profileVerdict?.startsWith("PARTIAL")) {
    fail("the compat JSON's profile verdict must be the honest PARTIAL");
  }
  if ((compat.rightsMappings?.length ?? 0) !== 3) {
    fail("the compat JSON must carry the 3-axis rights-provenance mapping (operation class / commercial-use terms / provenance)");
  }
  if ((compat.failures?.length ?? 0) > 0) {
    fail("the compat JSON itself recorded evidence failures");
  }
}

const upscaling = readEvidence("scripts/evidence/hf-portfolio/hf013/results/upscaling-pipeline-comparison.json") as
  | {
      label?: string;
      staticReview?: {
        capabilityDelta?: Array<{ axis?: string }>;
        repoToday?: { fourOutputPipeline?: string; upscalingToday?: string; normalizationChain?: string };
      };
      adequateHostComparisonDesign?: {
        label?: string;
        sourceInputsRule?: string;
        metrics?: { noLying?: string; sharedBothLanes?: string };
      };
    }
  | undefined;
if (!upscaling) {
  fail("the upscaling-pipeline-comparison JSON does not resolve");
} else {
  if (!upscaling.label?.includes("STATIC-REVIEW")) {
    fail("the upscaling comparison must carry the STATIC-REVIEW label");
  }
  if ((upscaling.staticReview?.capabilityDelta?.length ?? 0) < 8) {
    fail("the upscaling comparison must carry the 8-axis capability-delta table");
  }
  if (!String(upscaling.staticReview?.repoToday?.fourOutputPipeline ?? "").includes("original")) {
    fail("the comparison's repo-today block must record the four-output MP4 pipeline (the closed RealityKind vocabulary)");
  }
  if (!String(upscaling.staticReview?.repoToday?.upscalingToday ?? "").includes("NONE")) {
    fail("the comparison must record honestly that the repo has NO upscaling stage today");
  }
  const design = upscaling.adequateHostComparisonDesign;
  if (!design?.label?.includes("typed not-measured")) {
    fail("the comparison design must be labeled typed not-measured");
  }
  if (!String(design?.sourceInputsRule ?? "").includes("repo's OWN authorized output artifacts")) {
    fail("the comparison design's source-input rule must pin the repo's OWN authorized output artifacts (never new content)");
  }
  if (!String(design?.metrics?.noLying ?? "").includes("no_invented_content_rate")) {
    fail("the comparison design must carry the no-lying metric (upscaling must not invent content)");
  }
  if ((design?.metrics?.sharedBothLanes?.length ?? 0) < 1 || !design?.metrics?.sharedBothLanes?.includes("IMPORTED")) {
    fail("the comparison design must carry the shared-for-both-lanes metric set (the IMPORTED hf010 estimators — the fairness rule)");
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

// --- verdict ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`HF013 record-benchmark FAILED (${failures.length} failures):`);
  for (const f of failures) {
    console.error(`  - ${f}`);
  }
  process.exit(1);
}

console.log(
  "HF013 record-benchmark: OK — the ledger row echoed verbatim (12 fields), the typed refusal pinned to the EXECUTED " +
    "preflight (the no-auth-wall record + the arithmetic markers), NO measurement-shaped key anywhere in the benchmarkRun, " +
    "THE evidence-chain exclusion machine-checked (the dedicated block + the four-direction self-check + the compat JSON's " +
    "NOT-COMPATIBLE-BY-DOCTRINE verdict + the caveat), THE license posture first-class (the three sources distinguished " +
    "sha-verified + the HF LICENSE at the pinned revision + the governing-agreement OPEN EDGE + the NOASSERTION codeLicense " +
    "probe + watchlist-pending-terms), all 9 partial deliverables resolving, the upscaling comparison carrying the 8-axis " +
    "static capability delta + the no-lying design, the resource caveats honest. No promotion (gatingState candidate; HF015 " +
    "owns adjudication).",
);
