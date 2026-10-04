/**
 * HF008 — the benchmark-record validator (the TS side of the evidence tree).
 *
 * Follows the HF004/HF007/HF009 pattern (record-benchmark.ts): this entry
 * loads `scripts/evidence/hf-portfolio/hf008/benchmark-record.json` — the
 * HF008 benchmark flight's ledger-shaped record — and checks it against
 * the authorities it claims to stand on. The HF008 twist (two candidates
 * in ONE record, both resource-refused): the record carries BOTH ledger
 * rows echoed VERBATIM, and the validator additionally pins the honesty
 * of the refusal for both — the record may not launder a refusal into
 * numbers, and any measurement-shaped key with no measured run behind it
 * refuses (fail-closed, the negative-test convention).
 *
 * 1. BOTH candidate blocks echo their provenance-ledger rows VERBATIM
 *    (all twelve fields: candidate, taskProfiles, modelUrl, revision,
 *    modelLicense, codeLicense, weightsProvenance, datasetProvenance,
 *    commercialUse, gatingState, sources, recordedAt) — the VibeVoice
 *    row AND the Qwen3-ASR row;
 * 2. no promotion: both candidates' gatingState stays `candidate`
 *    (HF015 is the TL's gate alone);
 * 3. the typed refusal is present AND pinned to the EXECUTED preflight
 *    evidence (type resource-infeasible-host, verdict refused, the
 *    reasons verbatim, both candidates present in the executed probe
 *    map, the weights-never-downloaded pins, GPU honestly N/A);
 * 4. NO fabricated measurements: the quality/latency/memory blocks carry
 *    `not-measured-typed-refusal` statuses and no measurement keys (a
 *    WER/RTF/RSS/latency figure would be a fabrication — the models
 *    never ran); every fixture records the refusal/gap status;
 * 5. every evidence pointer resolves to a committed file that parses;
 *    the partial deliverables must all exist (the executed preflight,
 *    the load analysis, the schema, the audio fixtures, the metric
 *    designs, the metric self-check, the contract mappings, the
 *    ready-to-run script);
 * 6. the honest resource caveats are present (GPU N/A + RSS + wall-clock
 *    + the never-ran statement + the ground-truth unlock + the fixture
 *    gaps + the per-language gap);
 * 7. the load-bearing contract evidence: the emitted compat JSON must
 *    carry the STATIC-REVIEW label, the transcription-vs-generation
 *    distinction verdict (W208 compatible-with-adapter for
 *    transcription-of-observed-audio — the honest reversal of HF007's
 *    generated-text verdict), and the speaker-hints composition verdicts
 *    (VibeVoice maps-with-adapter / Qwen3 does-not-map — the mandatory
 *    HF009 composition); the metric self-check must be labeled as
 *    implementation evidence, NOT a model measurement.
 *
 * Exits 0 when the record stands; exits 1 with the failing check
 * otherwise (fail-closed — a drifted benchmark record refuses, never
 * passes silently).
 *
 * Run: bun scripts/evidence/hf-portfolio/hf008/record-benchmark.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RECORD_PATH = join(HERE, "benchmark-record.json");
const LEDGER_PATH = join(HERE, "..", "provenance-ledger.json");
const REPO_ROOT = join(HERE, "..", "..", "..", "..");

/** The ledger row fields BOTH candidate blocks must echo verbatim. */
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
    candidates: LedgerRow[];
    typedRefusal: { type: string; reasons: string[]; evidence: string; note: string };
    modelRuntime: Record<string, { adapter: string; loadValidation: string }>;
    fixtures: Array<{
      clipId: string;
      status: string;
      evidence: string;
      unscoredReason?: string;
    }>;
    quality: { status: string; evidence: string };
    latency: { status: string; note: string };
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

// --- load the record, the ledger, and the executed refusal evidence ------------

if (!existsSync(RECORD_PATH)) fail(`benchmark record missing: ${RECORD_PATH}`);
if (!existsSync(LEDGER_PATH)) fail(`provenance ledger missing: ${LEDGER_PATH}`);
const record = JSON.parse(readFileSync(RECORD_PATH, "utf8")) as BenchmarkRecord;
const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as LedgerRow[];

const run = record.benchmarkRun;

// --- 1. BOTH candidates echo their ledger rows verbatim ------------------------

if (run.workItem !== "HF008") {
  fail(`workItem must be "HF008" (got "${run.workItem}")`);
}
if (run.candidates.length !== 2) {
  fail(`the record must carry BOTH ledger candidates (got ${run.candidates.length})`);
}
const expectedCandidates = ["VibeVoice-ASR-Streaming", "Qwen3-ASR"];
for (const expected of expectedCandidates) {
  const block = run.candidates.find((c) => c.candidate === expected);
  const ledgerRow = ledger.find((row) => row.candidate === expected);
  if (block === undefined) {
    fail(`the candidate block "${expected}" is missing from the record`);
    continue;
  }
  if (ledgerRow === undefined) {
    fail(`the provenance ledger has no row for "${expected}"`);
    continue;
  }
  for (const field of ECHO_FIELDS) {
    if (JSON.stringify(block[field]) !== JSON.stringify(ledgerRow[field])) {
      fail(
        `provenance echo drift on "${expected}"."${field}": ` +
          `record=${JSON.stringify(block[field])} ledger=${JSON.stringify(ledgerRow[field])}`,
      );
    }
  }
  if (block.revision !== ledgerRow.revision) {
    fail(`the pinned revision for "${expected}" drifted`);
  }
}

// --- 2. no promotion ------------------------------------------------------------

for (const block of run.candidates) {
  if (block.gatingState !== "candidate") {
    fail(
      `gatingState for "${block.candidate}" must stay "candidate" (got "${block.gatingState}") — HF015 is the TL's gate alone`,
    );
  }
}
if (run.promotionGate.gatingState !== "candidate") {
  fail("the benchmarkRun.promotionGate block must record the UNCHANGED candidate state");
}

// --- 3. the typed refusal is real and pinned to the EXECUTED preflight ----------

const refusal = run.typedRefusal;
if (refusal.type !== "resource-infeasible-host") {
  fail(`typedRefusal.type must be "resource-infeasible-host" (got "${refusal.type}")`);
}
if (refusal.reasons.length < 8) {
  fail(
    `the typed refusal must carry its typed reasons (>= 8: both candidates x RAM/disk/CPU arithmetic — got ${refusal.reasons.length})`,
  );
}
const refusalText = refusal.reasons.join(" ");
for (const must of ["VibeVoice-ASR-Streaming-1.5B", "Qwen3-ASR-1.7B"]) {
  if (!refusalText.includes(must)) {
    fail(`the refusal reasons must cover BOTH candidates (missing "${must}")`);
  }
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
    refusalType: string;
    typedRefusal?: { type: string; reasons: string[] };
    candidates?: Array<{ candidate: string; repoId: string }>;
    weightsDownloaded?: boolean;
    boundedProbesOnly?: boolean;
    host?: Record<string, unknown>;
    checks?: Record<string, string>;
  };
  if (refusalEvidence.verdict !== "refused" || refusalEvidence.refusalType !== refusal.type) {
    fail("the executed preflight evidence does not match the record's typed refusal (verdict/type drift)");
  }
  if (refusalEvidence.typedRefusal?.reasons.join(" ") !== refusal.reasons.join(" ")) {
    fail("the record's refusal reasons drift from the executed preflight evidence's own reasons");
  }
  const probed = (refusalEvidence.candidates ?? []).map((c) => c.repoId);
  for (const repoId of ["microsoft/VibeVoice-ASR-Streaming-1.5B", "Qwen/Qwen3-ASR-1.7B"]) {
    if (!probed.includes(repoId)) {
      fail(`the executed preflight must record the pinned probe for ${repoId}`);
    }
  }
  if (refusalEvidence.weightsDownloaded !== false || refusalEvidence.boundedProbesOnly !== true) {
    fail("the executed preflight must pin weightsDownloaded=false + boundedProbesOnly=true (bounded reachability probes ONLY)");
  }
  if (!JSON.stringify(refusalEvidence.host ?? {}).includes("N/A")) {
    fail("the executed preflight evidence must record GPU honestly as N/A");
  }
  const checksText = JSON.stringify(refusalEvidence.checks ?? {});
  for (const clip of ["sprclip-b1-wide-broadcast", "sprclip-b8-inplay-original"]) {
    if (!checksText.includes(clip) || !checksText.includes("PASS")) {
      fail(`the executed preflight must record the sha-verified staged audio fixture ${clip}`);
    }
  }
  if (!checksText.includes("CONFIRMED-NO-AUDIO")) {
    fail("the executed preflight must re-verify the repo's no-audio fixtures (fx-001 + synthetic)");
  }
}

// --- 4. no fabricated measurements ----------------------------------------------

const NOT_MEASURED = "not-measured-typed-refusal";
if (run.quality.status !== NOT_MEASURED) {
  fail(`quality.status must be "${NOT_MEASURED}" (got "${run.quality.status}")`);
}
if (run.latency.status !== NOT_MEASURED) {
  fail(`latency.status must be "${NOT_MEASURED}" (got "${run.latency.status}")`);
}
if (run.memory.status !== NOT_MEASURED) {
  fail(`memory.status must be "${NOT_MEASURED}" (got "${run.memory.status}")`);
}
const qualityText = JSON.stringify(run.quality);
if (/"wer":\s*[0-9]|"pooledWer":\s*[0-9]|"hotwordRecall":\s*[0-9]|"hypothesisChurnRate":\s*[0-9]/i.test(qualityText)) {
  fail("quality block carries a metric number — the models never ran; metric values would be fabrications");
}
const latencyText = JSON.stringify(run.latency);
for (const fabricationKey of ['"firstChunkLatencyMs":', '"steadyStateRtf"', '"p95NearestRank"', '"medianMs"', '"mean"']) {
  if (latencyText.includes(fabricationKey)) {
    fail(`latency block carries a measurement key (${fabricationKey}) — the models never ran`);
  }
}
const memoryText = JSON.stringify(run.memory);
if (/"vmRss|"peakRss|"rssMiB|"ruMaxrss/i.test(memoryText)) {
  fail("memory block carries an RSS measurement key — the models never ran");
}
const validStatuses = new Set([
  "not-run-resource-refusal",
  "audio-unreachable-this-flight",
  "no-audio-track-typed-gap",
]);
for (const fixture of run.fixtures) {
  if (!validStatuses.has(fixture.status)) {
    fail(`fixture ${fixture.clipId} must record a refusal/gap status (got "${fixture.status}")`);
  }
  if (fixture.scored !== undefined && fixture.scored !== false) {
    fail(`fixture ${fixture.clipId} claims to be scored — nothing was scored (the models never ran)`);
  }
}

// --- 5. every evidence pointer resolves and parses -------------------------------

const allPointers: Array<[string, string]> = [
  ...run.fixtures.map((fixture) => [`fixture ${fixture.clipId}`, fixture.evidence] as [string, string]),
  ["quality/contractCompatibility", run.quality.evidence],
  ...Object.entries(run.partialDeliverables).map(
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
  "executedPreflight",
  "loadAnalysis",
  "sourceVerifiedOutputSchema",
  "audioFixtureEvidence",
  "metricDesigns",
  "metricSelfCheck",
  "contractMappings",
  "readyToRunScript",
];
for (const key of requiredPartials) {
  if (run.partialDeliverables[key] === undefined) {
    fail(`the partial deliverable "${key}" is missing from the record (the brief's five partial items + the executed evidence)`);
  }
}
const READY_TO_RUN = "scripts/evidence/hf-portfolio/hf008/benchmark_asr.py";
if (!existsSync(resolveEvidence(READY_TO_RUN))) {
  fail(`the ready-to-run script is missing: ${READY_TO_RUN}`);
}

// --- 6. the honest resource caveats -----------------------------------------------

const caveats = run.resourceCaveats.join(" ");
const caveatsLower = caveats.toLowerCase();
for (const must of ["N/A", "RSS", "never ran", "wall-clock", "ground-truth", "per-language"]) {
  const haystack = must === "wall-clock" || must === "per-language" ? caveatsLower : caveats;
  const needle = must === "wall-clock" || must === "per-language" ? must.toLowerCase() : must;
  if (!haystack.includes(needle)) {
    fail(`the resource caveats are missing the "${must}" statement`);
  }
}
const memoryBlock = run.memory;
if (!memoryBlock.gpuMemory.includes("N/A")) {
  fail("the memory block must record GPU memory as N/A honestly");
}

// --- 7. the load-bearing contract evidence ------------------------------------------

const compatPath = resolveEvidence(run.quality.evidence);
if (existsSync(compatPath)) {
  const compat = JSON.parse(readFileSync(compatPath, "utf8")) as {
    transcriptionOutputMappings: unknown[];
    evidenceChainMappings: Array<{ verdict: string; evidence: string }>;
    speakerHintsComposition: Array<{ candidates: string; verdict: string }>;
    staticPipelineComparison: { label: string; deltaRows: unknown[] };
    profileVerdicts: Array<{ target: string; verdict: string; honestNote: string }>;
  };
  if (compat.transcriptionOutputMappings.length < 6) {
    fail(
      `the contract-compatibility evidence must carry the transcription-output table (>= 6 rows, got ${compat.transcriptionOutputMappings.length})`,
    );
  }
  if (compat.evidenceChainMappings.length < 3) {
    fail(
      `the evidence-chain table must carry >= 3 rows (got ${compat.evidenceChainMappings.length}) — the transcription-vs-generation distinction is load-bearing`,
    );
  }
  const distinctionRow = compat.evidenceChainMappings.find((row) =>
    row.verdict === "maps" && row.evidence.includes("LOAD-BEARING DISTINCTION"),
  );
  if (distinctionRow === undefined) {
    fail("the transcription-vs-generation distinction row is missing from the evidence-chain table");
  }
  if (!compat.staticPipelineComparison.label.includes("STATIC-REVIEW")) {
    fail("the pipeline comparison must be labeled STATIC-REVIEW (never executed evidence)");
  }
  if (compat.staticPipelineComparison.deltaRows.length < 8) {
    fail(
      `the static capability-delta table must carry >= 8 rows (got ${compat.staticPipelineComparison.deltaRows.length})`,
    );
  }
  const w208 = compat.profileVerdicts.find((p) => p.target.includes("W208"));
  if (w208 === undefined || !w208.verdict.startsWith("compatible-with-adapter")) {
    fail(
      "the W208 verdict must be compatible-with-adapter for TRANSCRIPTION-OF-OBSERVED-AUDIO (the honest reversal of HF007's generated-text verdict — argued from the repo's own sources)",
    );
  }
  if (!(w208!.honestNote.includes("REVERSAL") || w208!.verdict.includes("REVERSAL"))) {
    fail("the W208 verdict must name the REVERSAL of the HF007 verdict explicitly (the distinction is load-bearing)");
  }
  const composition = compat.speakerHintsComposition;
  const vvComposition = composition.find((row) => row.candidates === "VibeVoice");
  const q3Composition = composition.find((row) => row.candidates === "Qwen3");
  if (vvComposition === undefined || !vvComposition.verdict.startsWith("maps-with-adapter")) {
    fail("the VibeVoice speaker-hints composition verdict must be maps-with-adapter (fused ASR+diarization, the HF009 gaps carried over)");
  }
  if (q3Composition === undefined || q3Composition.verdict !== "does-not-map") {
    fail("the Qwen3 speaker-hints composition verdict must be does-not-map (no speaker metadata — the HF009 composition is mandatory)");
  }
}

// the metric self-check must be labeled as implementation evidence, NOT a measurement
const selfCheckPath = resolveEvidence(run.partialDeliverables.metricSelfCheck?.path ?? "");
if (existsSync(selfCheckPath)) {
  const selfCheck = JSON.parse(readFileSync(selfCheckPath, "utf8")) as {
    label: string;
    failures: number;
  };
  if (!selfCheck.label.includes("NOT a model measurement")) {
    fail("the metric self-check must be labeled NOT a model measurement (implementation evidence only)");
  }
  if (selfCheck.failures !== 0) {
    fail(`the metric self-check must pass 100% (failures=${selfCheck.failures})`);
  }
}

// the modelRuntime story must carry the REFUSED load validations + the no-auth-wall fact
const runtimeText = JSON.stringify(run.modelRuntime);
if (!runtimeText.includes("REFUSED")) {
  fail("the modelRuntime loadValidation blocks must record the REFUSED verdicts");
}
if (!runtimeText.includes("never committed, never vendored")) {
  fail("the modelRuntime blocks must pin the weights-never-committed discipline");
}

// --- verdict --------------------------------------------------------------------------

if (failures.length > 0) {
  console.error("HF008 benchmark record FAILED validation:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("HF008 benchmark record stands:");
console.log(
  `  candidates: ${run.candidates.map((c) => `${c.candidate} @ ${c.revision.slice(0, 12)}`).join(" + ")} (both gatingState: candidate)`,
);
console.log(`  typed refusal: ${refusal.type} (executed preflight evidence verified; ${refusal.reasons.length} reasons, both candidates)`);
console.log(`  partial: ${Object.keys(run.partialDeliverables).length} deliverable pointers, all resolving`);
console.log("  provenance echo verbatim vs the HF002 ledger (BOTH rows); no promotion; no fabricated numbers; caveats present");
