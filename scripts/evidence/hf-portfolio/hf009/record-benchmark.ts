/**
 * HF009 — the benchmark-record validator (the TS side of the evidence tree).
 *
 * Follows the HF003/HF004/HF006 pattern (the ledger JSON kept
 * machine-checkable): this entry loads
 * `scripts/evidence/hf-portfolio/hf009/benchmark-record.json`
 * — the HF009 benchmark flight's ledger-shaped record — and checks it
 * against the authorities it claims to stand on:
 *
 * 1. the twelve provenance fields echo the pyannote row of the HF002
 *    provenance ledger VERBATIM (candidate, revision, modelUrl, licenses,
 *    weightsProvenance, datasetProvenance, commercialUse, gatingState) —
 *    the record may not launder provenance;
 * 2. the gating state is still `candidate` (no promotion: HF015 is the
 *    Tech Lead's gate alone — a benchmark flight cannot promote anything);
 * 3. every evidence pointer resolves to a committed file that parses;
 * 4. THE TYPED-REFUSAL PINNING (the HF004 convention, applied to the
 *    auth-gated refusal): this flight claims NO executed model run, so
 *    every measurement-shaped block (quality, latency, memory) must carry
 *    "not-measured-typed-refusal" with NO number-shaped values — and the
 *    refusal itself must be pinned to the EXECUTED preflight JSON
 *    (results/preflight-refusal.json, exit code 3, run on this host:
 *    the record's typedRefusal.type/theExactWall must match the executed
 *    refusal's, and the executed probe map must contain the 401
 *    gated-user-conditions verdicts the record cites);
 * 5. the executed PARTIAL is real: the audio-fixture evidence file must
 *    exist, parse, and match the record's fixture story (the two extracted
 *    SPR WAVs' shas/durations pinned; the synthetic fixture typed
 *    audio-less; fx-001 typed 429-blocked) — the partial cannot drift
 *    from the committed evidence;
 * 6. the honest typed gaps are present (DER/JER NOT MEASURED with the
 *    ground-truth reason; GPU N/A + the RSS substitute caveat; CPU
 *    wall-clock labeled; the no-mirror principle stated).
 *
 * Exits 0 when the record stands; exits 1 with the failing check otherwise
 * (fail-closed — a drifted or laundered benchmark record refuses, never
 * passes silently).
 *
 * Run: bun scripts/evidence/hf-portfolio/hf009/record-benchmark.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RECORD_PATH = join(HERE, "benchmark-record.json");
const LEDGER_PATH = join(HERE, "..", "provenance-ledger.json");
const PREFLIGHT_PATH = join(HERE, "results", "preflight-refusal.json");
const FIXTURES_PATH = join(HERE, "results", "audio-fixtures.json");

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

interface PreflightJson {
  evidenceId: string;
  revision: string;
  hubProbes: Array<{
    repoId: string;
    file: string;
    verdict: string;
    httpStatus?: string;
    message?: string;
  }>;
  refusal: { verdict: string; type: string; theExactWall: string };
  groundTruthSearch: { derJerVerdict: string };
  audioFixtures: Record<string, { usableForDiarization: boolean }>;
  host: { gpu: string };
}

interface FixturesJson {
  evidenceId: string;
  fixtures: Record<
    string,
    {
      usableForDiarization?: boolean;
      wavSha256?: string;
      durationSeconds?: number;
      sampleRateHz?: number;
      channels?: number;
      audioTrack?: string;
      committedNormalizedClipAudio?: string;
    }
  >;
}

interface BenchmarkRecord extends LedgerRow {
  sources: string[];
  recordedAt: string;
  benchmarkRun: {
    workItem: string;
    typedRefusal: {
      type: string;
      theExactWall: string;
      evidence: string;
      reasons: string[];
    };
    fixtures: Array<{
      clipId: string;
      scored: boolean;
      status: string;
      evidence: string;
      audioExtracted?: string;
    }>;
    quality: {
      derJer: string;
      status: string;
      speakerSegmentTimelines: string;
      determinism: string;
      contractCompatibilityVerdict: string;
    };
    latency: { status: string; perFileWallClockAndRtf: string };
    memory: { gpuMemory: string; status: string };
    failureModes: { observed: string[]; notObserved: string[] };
    resourceCaveats: string[];
    promotionGate: { gatingState: string; blockersObserved: string[] };
  };
}

const failures: string[] = [];
const fail = (message: string): void => {
  failures.push(message);
};

// --- load the record, the ledger, the executed evidence (fail-closed) --------
if (!existsSync(RECORD_PATH)) fail(`benchmark record missing: ${RECORD_PATH}`);
if (!existsSync(LEDGER_PATH)) fail(`provenance ledger missing: ${LEDGER_PATH}`);
if (!existsSync(PREFLIGHT_PATH)) {
  fail(`the EXECUTED preflight evidence is missing: ${PREFLIGHT_PATH}`);
}
if (!existsSync(FIXTURES_PATH)) {
  fail(`the EXECUTED audio-fixture evidence is missing: ${FIXTURES_PATH}`);
}

const record = JSON.parse(readFileSync(RECORD_PATH, "utf8")) as BenchmarkRecord;
const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as LedgerRow[];
const ledgerRow = ledger.find((row) => row.candidate === record.candidate);
if (ledgerRow === undefined) {
  fail(`benchmark record candidate "${record.candidate}" has no provenance-ledger row`);
}
const preflight: PreflightJson = existsSync(PREFLIGHT_PATH)
  ? JSON.parse(readFileSync(PREFLIGHT_PATH, "utf8"))
  : { evidenceId: "", revision: "", hubProbes: [], refusal: { verdict: "", type: "", theExactWall: "" }, groundTruthSearch: { derJerVerdict: "" }, audioFixtures: {}, host: { gpu: "" } };
const fixturesEvidence: FixturesJson = existsSync(FIXTURES_PATH)
  ? JSON.parse(readFileSync(FIXTURES_PATH, "utf8"))
  : { evidenceId: "", fixtures: {} };

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

// --- 2. no promotion + the work item ----------------------------------------
if (record.gatingState !== "candidate") {
  fail(`gatingState must stay "candidate" (got "${record.gatingState}") — HF015 is the TL's gate alone`);
}
if (record.benchmarkRun.promotionGate.gatingState !== "candidate") {
  fail("the benchmarkRun.promotionGate block must record the UNCHANGED candidate state");
}
if (record.benchmarkRun.workItem !== "HF009") {
  fail(`workItem must be "HF009" (got "${record.benchmarkRun.workItem}")`);
}

// --- 3. evidence pointers resolve + parse ------------------------------------
for (const fixture of record.benchmarkRun.fixtures) {
  const evidencePath = fixture.evidence.startsWith("scripts/")
    ? join(HERE, "..", "..", "..", "..", fixture.evidence)
    : join(HERE, fixture.evidence);
  if (!existsSync(evidencePath)) {
    fail(`fixture evidence pointer does not resolve: ${fixture.evidence}`);
    continue;
  }
  try {
    JSON.parse(readFileSync(evidencePath, "utf8"));
  } catch (error) {
    fail(`fixture evidence does not parse: ${fixture.evidence} (${String(error)})`);
  }
  if (fixture.scored !== false) {
    fail(`fixture ${fixture.clipId} must be labeled scored:false (no speaker ground truth exists)`);
  }
}

// --- 4. the typed-refusal pinning vs the EXECUTED preflight -------------------
const refusal = record.benchmarkRun.typedRefusal;
if (refusal.type !== preflight.refusal.type) {
  fail(
    `typedRefusal.type drift: record=${refusal.type} preflight=${preflight.refusal.type} — the record must be pinned to the EXECUTED refusal`,
  );
}
if (refusal.type !== "auth-gated-model") {
  fail(`this flight's refusal type must be "auth-gated-model" (got "${refusal.type}")`);
}
const preflightGated = preflight.hubProbes.filter(
  (p) => p.verdict === "gated-user-conditions",
);
if (preflightGated.length < 2) {
  fail(
    "the executed probe map must carry the gated verdicts (community-1 + the segmentation fallback) — the preflight evidence is incomplete",
  );
}
const pinnedRepoGated = preflightGated.some(
  (p) => p.repoId === "pyannote/speaker-diarization-community-1",
);
if (!pinnedRepoGated) {
  fail("the executed probe map has no gated verdict for the pinned community-1 repo");
}
const exactWallIncludes401 = refusal.theExactWall.includes("401");
if (!exactWallIncludes401) {
  fail("the typedRefusal.theExactWall must quote the 401 auth wall verbatim");
}
if (preflight.refusal.verdict !== "refused") {
  fail(`the executed preflight verdict must be "refused" (got "${preflight.refusal.verdict}")`);
}
if (preflight.revision !== record.revision) {
  fail(
    `preflight probed revision ${preflight.revision} but the record pins ${record.revision}`,
  );
}

// --- 4b. NO-FABRICATED-NUMBERS: every measurement-shaped block is typed ------
const quality = record.benchmarkRun.quality;
if (!quality.derJer.includes("NOT MEASURED")) {
  fail("the DER/JER typed gap must be stated as NOT MEASURED (no speaker ground truth exists)");
}
if (!quality.speakerSegmentTimelines.includes("NOT MEASURED")) {
  fail("the speaker-segment-timeline block must be NOT MEASURED (the model never ran)");
}
if (!quality.determinism.includes("NOT MEASURED")) {
  fail("the determinism block must be NOT MEASURED (the model never ran)");
}
if (quality.status !== "not-measured-typed-refusal") {
  fail(`quality.status must be "not-measured-typed-refusal" (got "${quality.status}")`);
}
if (record.benchmarkRun.latency.status !== "not-measured-typed-refusal") {
  fail("latency.status must be not-measured-typed-refusal — NO RTF/wall-clock number may exist");
}
if (!record.benchmarkRun.latency.perFileWallClockAndRtf.includes("NOT MEASURED")) {
  fail("the per-file wall-clock + RTF block must be NOT MEASURED");
}
if (record.benchmarkRun.memory.status !== "not-measured-typed-refusal") {
  fail("memory.status must be not-measured-typed-refusal — NO RSS-at-inference number may exist");
}
// Number-shaped values must not appear in the measurement blocks:
const measurementBlocks = [
  quality,
  record.benchmarkRun.latency,
  record.benchmarkRun.memory,
];
for (const block of measurementBlocks) {
  for (const [key, value] of Object.entries(block)) {
    if (typeof value === "number" && !Number.isNaN(value)) {
      fail(
        `measurement-shaped number found in a refused flight: ${key}=${value} (the model never ran — this is exactly the fabrication the fail-closed gate exists to refuse)`,
      );
    }
  }
}

// --- 5. the executed PARTIAL is real and does not drift -----------------------
// 5a. the two SPR WAVs the record cites are pinned in the fixture evidence.
const sprExpectations = [
  { clipId: "sprclip-b8-inplay-original", sha: "ddf9c203", duration: 47.624 },
  { clipId: "sprclip-b1-wide-broadcast", sha: "08c2fcfb", duration: 30.07 },
];
for (const expected of sprExpectations) {
  const fixture = fixturesEvidence.fixtures[expected.clipId];
  if (fixture === undefined) {
    fail(`the audio-fixture evidence must carry the executed extraction: ${expected.clipId}`);
    continue;
  }
  if (fixture.usableForDiarization !== true) {
    fail(`${expected.clipId} must be usableForDiarization (the audio was extracted)`);
  }
  if (fixture.wavSha256 === undefined || !fixture.wavSha256.startsWith(expected.sha)) {
    fail(
      `${expected.clipId} wav sha drift: evidence=${fixture.wavSha256 ?? "<missing>"} expected prefix ${expected.sha}`,
    );
  }
  if (fixture.durationSeconds !== expected.duration) {
    fail(
      `${expected.clipId} duration drift: evidence=${fixture.durationSeconds} expected ${expected.duration}`,
    );
  }
  if (fixture.sampleRateHz !== 16000 || fixture.channels !== 1) {
    fail(`${expected.clipId} must be 16 kHz mono (pyannote's native input)`);
  }
}
// 5b. the unusable fixtures are typed honestly in the same evidence.
if (fixturesEvidence.fixtures["synthetic-diagnostic-01"]?.usableForDiarization !== false) {
  fail("the synthetic fixture must be typed audio-less (usableForDiarization:false)");
}
if (fixturesEvidence.fixtures["fx-001"]?.usableForDiarization !== false) {
  fail("fx-001 must be typed audio-unreachable this flight (usableForDiarization:false)");
}
// 5c. the record's fixture statuses match the executed evidence's usability.
for (const fixture of record.benchmarkRun.fixtures) {
  const evidence = fixturesEvidence.fixtures[fixture.clipId];
  const executed = preflight.audioFixtures[fixture.clipId];
  if (evidence === undefined || executed === undefined) {
    fail(`fixture ${fixture.clipId} is missing from the executed evidence set`);
    continue;
  }
  if (evidence.usableForDiarization !== executed.usableForDiarization) {
    fail(
      `fixture ${fixture.clipId} usability drift between the two executed evidence files`,
    );
  }
}
// 5d. the executed audio extraction is reflected in the record's fixture rows.
const sprRows = record.benchmarkRun.fixtures.filter((f) =>
  f.clipId.startsWith("sprclip-"),
);
if (sprRows.length !== 2) {
  fail(`the record must carry the two EXECUTED SPR audio fixtures (got ${sprRows.length})`);
}
for (const row of sprRows) {
  if (row.status !== "audio-ready-model-refused") {
    fail(`SPR fixture ${row.clipId} must be audio-ready-model-refused (got "${row.status}")`);
  }
  if (row.audioExtracted === undefined || !row.audioExtracted.includes("EXECUTED")) {
    fail(`SPR fixture ${row.clipId} must record the executed ffmpeg extraction`);
  }
}
const fxRow = record.benchmarkRun.fixtures.find((f) => f.clipId === "fx-001");
if (fxRow === undefined || fxRow.status !== "audio-unreachable-this-flight") {
  fail("the fx-001 row must record the 429-blocked audio state honestly");
}
const synthRow = record.benchmarkRun.fixtures.find(
  (f) => f.clipId === "synthetic-diagnostic-01",
);
if (synthRow === undefined || synthRow.status !== "no-audio-track-typed-gap") {
  fail("the synthetic-fixture row must record the no-audio-track typed gap");
}

// --- 6. the honest caveats + the no-mirror principle ---------------------------
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
if (!record.benchmarkRun.memory.gpuMemory.includes("N/A")) {
  fail("the memory block must record GPU memory as N/A honestly");
}
if (!caveats.includes("mirror")) {
  fail("the no-mirror principle (never bypass the user-conditions gate) must be stated");
}
if (!preflight.groundTruthSearch.derJerVerdict.includes("NOT MEASURED")) {
  fail("the executed ground-truth search must state the DER/JER verdict as NOT MEASURED");
}
if (!quality.contractCompatibilityVerdict || quality.contractCompatibilityVerdict.length < 40) {
  fail("the W208 contract-compatibility verdict must be present (the static structural partial)");
}
if (
  record.benchmarkRun.failureModes.notObserved.length === 0 ||
  !record.benchmarkRun.failureModes.notObserved.some((n) => n.includes("NOT OBSERVED"))
) {
  fail("the NOT OBSERVED failure-mode block must be typed honestly (the model never ran)");
}

// --- verdict ----------------------------------------------------------------
if (failures.length > 0) {
  console.error("HF009 benchmark record FAILED validation:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("HF009 benchmark record stands:");
console.log(
  `  candidate ${record.candidate} @ ${record.revision.slice(0, 12)} (gatingState: ${record.gatingState})`,
);
console.log(
  `  typed refusal: ${refusal.type} — pinned to the EXECUTED preflight (${preflight.evidenceId}, verdict "${preflight.refusal.verdict}")`,
);
for (const fixture of record.benchmarkRun.fixtures) {
  console.log(`  evidence: ${fixture.evidence} (${fixture.clipId}: ${fixture.status})`);
}
console.log(
  "  provenance echo verbatim vs the HF002 ledger; refusal pinned to the executed 401 probe map;",
);
console.log(
  "  NO measurement-shaped numbers (DER/JER, timelines, determinism, RTF, RSS all typed);",
);
console.log(
  "  executed partial pinned (2 SPR WAV shas/durations, the probe map, the ground-truth search); no promotion recorded",
);
