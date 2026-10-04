/**
 * HF010 — the benchmark-record validator (the TS side of the evidence tree).
 *
 * Follows the HF004/HF008 pattern (record-benchmark.ts): this entry loads
 * `scripts/evidence/hf-portfolio/hf010/benchmark-record.json` — the HF010
 * benchmark flight's ledger-shaped record — and checks it against the
 * authorities it claims to stand on. The HF010 twist (THREE candidates in
 * ONE record, all resource-refused, with the license posture as a
 * first-class acceptance criterion and the authored camera-path fixtures
 * as a delivered artifact): the record carries ALL THREE ledger rows
 * echoed VERBATIM, and the validator additionally pins:
 *
 * 1. ALL THREE candidate blocks echo their provenance-ledger rows VERBATIM
 *    (all twelve fields: candidate, taskProfiles, modelUrl, revision,
 *    modelLicense, codeLicense, weightsProvenance, datasetProvenance,
 *    commercialUse, gatingState, sources, recordedAt) — the
 *    Wan2.2-Fun-Control-Camera row, the ReCamMaster row, AND the Meridian
 *    row;
 * 2. no promotion: all three candidates' gatingState stays `candidate`
 *    (HF015 is the TL's gate alone);
 * 3. the typed refusal is present AND pinned to the EXECUTED preflight
 *    evidence (type resource-infeasible-host, verdict refused, the
 *    reasons verbatim, all three candidates present in the executed probe
 *    map, the weights-never-downloaded pins, GPU honestly N/A, and the
 *    VGGT-Omega auth-gate record with the 401 anonymous-access fact);
 * 4. NO fabricated measurements: the quality/latency/memory blocks carry
 *    `not-measured-typed-refusal` statuses and no measurement keys (a
 *    camera-adherence/identity/SSIM/hallucination/wall-clock figure would
 *    be a fabrication — the models never ran); every fixture records the
 *    authored-not-run status with scored false;
 * 5. every evidence pointer resolves to a committed file that parses; the
 *    partial deliverables must all be present (the executed preflight, the
 *    load analysis, the license posture, the authored camera-path
 *    fixtures + their report, the metric designs, the metric self-check,
 *    the contract mappings, the ready-to-run script);
 * 6. the fixture set is PINNED: the sha256 recorded by the self-check must
 *    match the committed fixture file's actual sha256 (determinism pinned,
 *    never drifted);
 * 7. the license-posture block is present, cites recorded terms, carries
 *    the never-legal-advice posture, and the Meridian research-only
 *    verdict (two recorded blockers — the minimax-h3 community license +
 *    the noncommercial gated VGGT-Omega dependency);
 * 8. the honest resource caveats are present (GPU N/A + RSS + never ran +
 *    the auth wall + the fail-closed full-mode host requirement + the
 *    lean-venv discipline);
 * 9. the load-bearing contract evidence: the emitted compat JSON must
 *    carry the STATIC-REVIEW label, all 24 task-profile mapping rows, the
 *    camera-path-conditioning table (the HF014 design surface), and the
 *    PARTIAL profile verdict; the metric self-check must be labeled as
 *    implementation evidence, NOT a model measurement, with zero failures.
 *
 * Exits 0 when the record stands; exits 1 with the failing check
 * otherwise (fail-closed — a drifted benchmark record refuses, never
 * passes silently).
 *
 * Run: bun scripts/evidence/hf-portfolio/hf010/record-benchmark.ts
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RECORD_PATH = join(HERE, "benchmark-record.json");
const LEDGER_PATH = join(HERE, "..", "provenance-ledger.json");
const FIXTURE_PATH = join(HERE, "fixtures", "hf010-camera-paths.json");
const REPO_ROOT = join(HERE, "..", "..", "..", "..");

/** The ledger row fields ALL THREE candidate blocks must echo verbatim. */
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
      fixtureId: string;
      status: string;
      evidence: string;
      scored?: boolean;
      unscoredReason?: string;
    }>;
    licensePosture: {
      status: string;
      wan22FunControlCamera: string;
      recammaster: string;
      meridian: string;
      evidence: string;
    };
    quality: { status: string; evidence: string };
    latency: { status: string; note: string };
    memory: { status: string; gpuMemory: string };
    resourceCaveats: string[];
    partialDeliverables: Record<string, { path: string; description: string }>;
    promotionGate: { gatingState: string; blockersObserved: string[] };
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

// --- 1. ALL THREE candidates echo their ledger rows verbatim ------------------

if (run.workItem !== "HF010") {
  fail(`workItem must be "HF010" (got "${run.workItem}")`);
}
if (run.candidates.length !== 3) {
  fail(`the record must carry ALL THREE ledger candidates (got ${run.candidates.length})`);
}
const expectedCandidates = ["Wan2.2-Fun-Control-Camera", "ReCamMaster", "Meridian"];
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
if (run.promotionGate.blockersObserved.length < 4) {
  fail(
    `the promotion gate must carry its observed blockers (>= 4: never-ran, unconsumed-fixture/auth, license blockers, the telemetry trust rule — got ${run.promotionGate.blockersObserved.length})`,
  );
}

// --- 3. the typed refusal is real and pinned to the EXECUTED preflight ----------

const refusal = run.typedRefusal;
if (refusal.type !== "resource-infeasible-host") {
  fail(`typedRefusal.type must be "resource-infeasible-host" (got "${refusal.type}")`);
}
if (refusal.reasons.length < 10) {
  fail(
    `the typed refusal must carry its typed reasons (>= 10: the three candidates x disk/RAM/CPU + the Meridian CUDA requirement + the VGGT-Omega auth gate — got ${refusal.reasons.length})`,
  );
}
const refusalText = refusal.reasons.join(" ");
for (const must of ["Wan2.2-Fun-Control-Camera", "ReCamMaster", "Meridian"]) {
  if (!refusalText.includes(must)) {
    fail(`the refusal reasons must cover ALL THREE candidates (missing "${must}")`);
  }
}
const resolveEvidence = (relPath: string): string => {
  const full = existsSync(join(REPO_ROOT, relPath))
    ? join(REPO_ROOT, relPath)
    : join(HERE, relPath);
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
    authGate?: { repoId: string; gated: string; weightsAccessHeadStatus?: { status: number } };
  };
  if (refusalEvidence.verdict !== "refused" || refusalEvidence.refusalType !== refusal.type) {
    fail(
      "the executed preflight evidence does not match the record's typed refusal (verdict/type drift)",
    );
  }
  if (refusalEvidence.typedRefusal?.reasons.join(" ") !== refusal.reasons.join(" ")) {
    fail("the record's refusal reasons drift from the executed preflight evidence's own reasons");
  }
  const probed = (refusalEvidence.candidates ?? []).map((c) => c.repoId);
  for (const repoId of [
    "alibaba-pai/Wan2.2-Fun-A14B-Control-Camera",
    "KlingTeam/ReCamMaster-Wan2.1",
    "Viggle/Meridian",
  ]) {
    if (!probed.includes(repoId)) {
      fail(`the executed preflight must record the pinned probe for ${repoId}`);
    }
  }
  if (refusalEvidence.weightsDownloaded !== false || refusalEvidence.boundedProbesOnly !== true) {
    fail(
      "the executed preflight must pin weightsDownloaded=false + boundedProbesOnly=true (bounded reachability probes ONLY)",
    );
  }
  if (!JSON.stringify(refusalEvidence.host ?? {}).includes("N/A")) {
    fail("the executed preflight evidence must record GPU honestly as N/A");
  }
  const gate = refusalEvidence.authGate;
  if (gate === undefined || gate.repoId !== "facebook/VGGT-Omega" || gate.gated !== "manual") {
    fail(
      "the executed preflight must record the VGGT-Omega auth gate (facebook/VGGT-Omega, gate type manual — the HF009 convention)",
    );
  }
  if (gate?.weightsAccessHeadStatus?.status !== 401) {
    fail(
      "the executed preflight must record the anonymous weight-access refusal (bounded HEAD probe, status 401)",
    );
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
if (
  /"cameraEndpointTranslationErrorM":\s*[0-9]|"cameraEndpointAngularErrorDeg":\s*[0-9]|"meanCameraAngularErrorDeg":\s*[0-9]|"cameraTrackingErrorPx":\s*[0-9]|"playerIdentityStability":\s*[0-9]|"ballPresenceRecall":\s*[0-9]|"hallucinatedRegionRate":\s*[0-9]|"meanConsecutiveSsim":\s*[0-9]/i.test(
    qualityText,
  )
) {
  fail(
    "quality block carries a metric number — the models never ran; metric values would be fabrications",
  );
}
const latencyText = JSON.stringify(run.latency);
for (const fabricationKey of [
  '"generationWallClockMs":',
  '"wallClockMsPerOutputSecond":',
  '"peakGpuMemoryGiB":',
  '"coldStartDownloadBytes":',
]) {
  if (latencyText.includes(fabricationKey)) {
    fail(`latency block carries a measurement key (${fabricationKey}) — the models never ran`);
  }
}
const memoryText = JSON.stringify(run.memory);
if (/"vmRss|"peakRss|"rssMiB|"ruMaxrss/i.test(memoryText)) {
  fail("memory block carries an RSS measurement key — the models never ran");
}
for (const fixture of run.fixtures) {
  if (fixture.status !== "authored-not-run-resource-refusal") {
    fail(
      `fixture ${fixture.fixtureId} must record the authored-not-run status (got "${fixture.status}") — the fixtures exist but no model ever consumed them`,
    );
  }
  if (fixture.scored !== false) {
    fail(
      `fixture ${fixture.fixtureId} claims to be scored — nothing was scored (the models never ran)`,
    );
  }
}
if (run.fixtures.length !== 6) {
  fail(`the record must carry all SIX authored camera-path fixtures (got ${run.fixtures.length})`);
}

// --- 5. every evidence pointer resolves and parses -------------------------------

const allPointers: Array<[string, string]> = [
  ...run.fixtures.map(
    (fixture) => [`fixture ${fixture.fixtureId}`, fixture.evidence] as [string, string],
  ),
  ["quality/contractCompatibility", run.quality.evidence],
  ["licensePosture", run.licensePosture.evidence],
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
  "licensePosture",
  "authoredCameraFixtures",
  "fixtureReport",
  "metricDesigns",
  "metricSelfCheck",
  "contractMappings",
  "readyToRunScript",
];
for (const key of requiredPartials) {
  if (run.partialDeliverables[key] === undefined) {
    fail(
      `the partial deliverable "${key}" is missing from the record (the brief's partial items + the executed evidence)`,
    );
  }
}
const READY_TO_RUN = "scripts/evidence/hf-portfolio/hf010/benchmark_renderer.py";
if (!existsSync(resolveEvidence(READY_TO_RUN))) {
  fail(`the ready-to-run script is missing: ${READY_TO_RUN}`);
}

// --- 6. the fixture set is sha-pinned and deterministic ---------------------------

const selfCheckPath = resolveEvidence(run.partialDeliverables.metricSelfCheck?.path ?? "");
if (existsSync(selfCheckPath)) {
  const selfCheck = JSON.parse(readFileSync(selfCheckPath, "utf8")) as {
    label: string;
    failures: number;
    total: number;
    allPass: boolean;
    fixtureSet: {
      sha256: string;
      fixtureSetVersion: string;
      windows: number;
      posesPerWindow: number;
    };
  };
  if (!selfCheck.label.includes("NOT a model measurement")) {
    fail(
      "the metric self-check must be labeled NOT a model measurement (implementation evidence only)",
    );
  }
  if (selfCheck.failures !== 0 || !selfCheck.allPass) {
    fail(`the metric self-check must pass 100% (failures=${selfCheck.failures})`);
  }
  if (selfCheck.total < 14) {
    fail(
      `the metric self-check must carry the hand-computed cases + the fixture checks (>= 14: 12 metric cases + 2 fixture checks — got ${selfCheck.total})`,
    );
  }
  if (!existsSync(FIXTURE_PATH)) {
    fail(`the authored fixture set is missing: ${FIXTURE_PATH}`);
  } else {
    const actualSha = createHash("sha256").update(readFileSync(FIXTURE_PATH)).digest("hex");
    if (actualSha !== selfCheck.fixtureSet.sha256) {
      fail(
        `the fixture set sha256 drifted: the self-check pinned ${selfCheck.fixtureSet.sha256} but the committed file hashes ${actualSha}`,
      );
    }
    if (selfCheck.fixtureSet.fixtureSetVersion !== "hf010.camera-paths@1") {
      fail("the fixture set must carry its version (hf010.camera-paths@1)");
    }
    if (selfCheck.fixtureSet.windows !== 6 || selfCheck.fixtureSet.posesPerWindow !== 81) {
      fail("the fixture set must be 6 windows x 81 poses (the authored family)");
    }
  }
}

// --- 7. the license posture is first-class and honest ------------------------------

const license = run.licensePosture;
if (!license.status.includes("never legal advice")) {
  fail("the license-posture block must carry the never-legal-advice posture verbatim");
}
const licenseText = JSON.stringify(license);
for (const must of [
  "apache-2.0",
  "minimax-h3-community-license",
  "FAIR Noncommercial Research License",
]) {
  if (!licenseText.includes(must)) {
    fail(`the license-posture block must cite the recorded terms (missing "${must}")`);
  }
}
if (!license.meridian.includes("research-only")) {
  fail(
    "the Meridian license-posture verdict must be research-only (two recorded blockers: the community license + the noncommercial gated geometry dependency)",
  );
}
if (!license.wan22FunControlCamera.startsWith("production-eligible-by-recorded-terms")) {
  fail(
    "the Wan2.2-Fun license-posture verdict must be production-eligible-by-recorded-terms (apache-2.0, commercialUse yes)",
  );
}
if (!license.recammaster.startsWith("production-eligible-by-recorded-terms")) {
  fail(
    "the ReCamMaster license-posture verdict must be production-eligible-by-recorded-terms (apache-2.0 model / mit code)",
  );
}

// --- 8. the honest resource caveats -------------------------------------------------

const caveats = run.resourceCaveats.join(" ");
const caveatsLower = caveats.toLowerCase();
for (const must of ["N/A", "RSS", "never ran", "auth", "fail-closed", "lean"]) {
  // "never ran"/"auth"/"fail-closed"/"lean" are case-insensitive needles; "N/A"/"RSS" are case-sensitive
  const haystack = ["never ran", "auth", "fail-closed", "lean"].includes(must)
    ? caveatsLower
    : caveats;
  if (!haystack.includes(must)) {
    fail(`the resource caveats are missing the "${must}" statement`);
  }
}
const memoryBlock = run.memory;
if (!memoryBlock.gpuMemory.includes("N/A")) {
  fail("the memory block must record GPU memory as N/A honestly");
}

// --- 9. the load-bearing contract evidence -------------------------------------------

const compatPath = resolveEvidence(run.quality.evidence);
if (existsSync(compatPath)) {
  const compat = JSON.parse(readFileSync(compatPath, "utf8")) as {
    label: string;
    taskProfileInputMappings: unknown[];
    taskProfileOutputMappings: unknown[];
    cameraPathConditioning: Array<{ candidate: string; verdict: string; gap: string }>;
    rightsProvenanceMappings: unknown[];
    profileVerdicts: Array<{ verdict: string }>;
    fixtureSetVocabulary: { fixtureSetVersion: string; canonicalSlots: string[] };
  };
  if (!compat.label.includes("STATIC-REVIEW")) {
    fail(
      "the contract-compatibility evidence must be labeled STATIC-REVIEW (never executed evidence)",
    );
  }
  if (compat.taskProfileInputMappings.length !== 15) {
    fail(
      `the task-profile INPUT table must carry 15 rows (5 frozen inputs x 3 candidates — got ${compat.taskProfileInputMappings.length})`,
    );
  }
  if (compat.taskProfileOutputMappings.length !== 9) {
    fail(
      `the task-profile OUTPUT table must carry 9 rows (3 frozen outputs x 3 candidates — got ${compat.taskProfileOutputMappings.length})`,
    );
  }
  if (compat.cameraPathConditioning.length !== 3) {
    fail(
      `the camera-path-conditioning table must carry all 3 candidates (the HF014 design surface — got ${compat.cameraPathConditioning.length})`,
    );
  }
  const meridianRow = compat.cameraPathConditioning.find((row) => row.candidate === "Meridian");
  const wanRow = compat.cameraPathConditioning.find(
    (row) => row.candidate === "Wan2.2-Fun-Control-Camera",
  );
  const reRow = compat.cameraPathConditioning.find((row) => row.candidate === "ReCamMaster");
  if (meridianRow?.verdict !== "maps") {
    fail(
      "the Meridian camera-path-conditioning verdict must be maps (the keyframe path IS the camera path)",
    );
  }
  if (wanRow?.verdict !== "maps-with-adapter") {
    fail(
      "the Wan2.2-Fun camera-path-conditioning verdict must be maps-with-adapter (the CameraCtrl lens seam)",
    );
  }
  if (reRow?.verdict !== "partial") {
    fail(
      "the ReCamMaster camera-path-conditioning verdict must be partial (preset-indexed, not authored paths)",
    );
  }
  if (compat.rightsProvenanceMappings.length !== 3) {
    fail(
      `the rights-provenance table must carry all 3 candidates (got ${compat.rightsProvenanceMappings.length})`,
    );
  }
  if (!compat.profileVerdicts[0]?.verdict.startsWith("PARTIAL")) {
    fail("the profile verdict must be PARTIAL (no candidate maps the full frozen profile)");
  }
  if (compat.fixtureSetVocabulary.fixtureSetVersion !== "hf010.camera-paths@1") {
    fail("the compat evidence must pin the fixture-set version it speaks for");
  }
  if (compat.fixtureSetVocabulary.canonicalSlots.length !== 5) {
    fail("the compat evidence must pin the five canonical W601 slots");
  }
}

// the modelRuntime story must carry the REFUSED load validations + the never-committed discipline
const runtimeText = JSON.stringify(run.modelRuntime);
if (!runtimeText.includes("REFUSED")) {
  fail("the modelRuntime loadValidation blocks must record the REFUSED verdicts");
}
if (!runtimeText.includes("never committed, never vendored")) {
  fail("the modelRuntime blocks must pin the weights-never-committed discipline");
}

// --- verdict --------------------------------------------------------------------------

if (failures.length > 0) {
  console.error("HF010 benchmark record FAILED validation:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("HF010 benchmark record stands:");
console.log(
  `  candidates: ${run.candidates.map((c) => `${c.candidate} @ ${c.revision.slice(0, 12)}`).join(" + ")} (all gatingState: candidate)`,
);
console.log(
  `  typed refusal: ${refusal.type} (executed preflight evidence verified; ${refusal.reasons.length} reasons, all three candidates + the VGGT-Omega auth gate)`,
);
console.log(
  `  license posture: 2 production-side-by-recorded-terms + 1 research-only (Meridian) — never legal advice, never a promotion`,
);
console.log(
  `  fixtures: 6 authored camera-path windows (sha256-pinned, deterministic) — never consumed by any model`,
);
console.log(
  `  partial: ${Object.keys(run.partialDeliverables).length} deliverable pointers, all resolving`,
);
console.log(
  "  provenance echo verbatim vs the HF002 ledger (ALL THREE rows); no promotion; no fabricated numbers; caveats present",
);
