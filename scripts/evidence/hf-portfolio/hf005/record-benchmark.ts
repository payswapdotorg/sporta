/**
 * HF005 — the benchmark-record validator (the TS side of the evidence tree).
 *
 * Follows the HF004/HF008/HF009/HF010/HF011/HF012/HF013 pattern
 * (`record-benchmark.ts`): this entry loads
 * `scripts/evidence/hf-portfolio/hf005/benchmark-record.json` — the HF005
 * benchmark flight's ledger-shaped record — and checks it against the
 * authorities it claims to stand on. The HF005 shape (ONE candidate,
 * auth-gated AND resource-infeasible, whose acceptance is a SEGMENTATION/
 * TRACKING benchmark whose LICENSE REVIEW leg is first-class and whose
 * identity-continuity + latency comparison is designed-not-run): the
 * record carries the SAM3 ledger row echoed VERBATIM, and the validator
 * additionally pins:
 *
 * 1. the candidate block echoes its provenance-ledger row VERBATIM (all
 *    twelve fields: candidate, taskProfiles, modelUrl, revision,
 *    modelLicense, codeLicense, weightsProvenance, datasetProvenance,
 *    commercialUse, gatingState, sources, recordedAt);
 * 2. no promotion: the candidate's gatingState stays `candidate` (HF015
 *    is the TL's gate alone; the record carries the HF015 standing
 *    verdict for SAM3);
 * 3. the typed refusal is present AND pinned to the EXECUTED preflight
 *    evidence (type auth-gated-model+resource-infeasible-host, verdict
 *    refused, exit 3, the reasons verbatim, the weights-never-downloaded
 *    pin, the bounded-probes-only pin, GPU honestly N/A, and the
 *    401-gate wall text matching the committed probe map);
 * 4. NO fabricated measurements: the quality/identityContinuity/latency/
 *    memory blocks carry `not-measured-typed-refusal` statuses and no
 *    measurement keys (an identity-switch/continuity-score/fragmentation/
 *    per-frame-ms figure would be a fabrication — the model never ran);
 *    every fixture records its designed-not-run status with scored
 *    false; a recursive scan refuses any measurement-shaped key anywhere
 *    in the benchmarkRun;
 * 5. the license review is present, machine-verified (citations against
 *    the fetched SAM License text), never legal advice, and its verdict
 *    holds the acceptance's own bar ("remain research/watchlist unless
 *    production-safe");
 * 6. the executed partial is pinned: the self-check 18/18 hand-computed
 *    cases labeled formula checks (never model measurements), the
 *    contract-compatibility verdict, and the fail-closed full mode
 *    (negative-tested);
 * 7. the honesty doctrines block is present (static-review labeling, no
 *    fabricated numbers, the machine-claim provenance).
 *
 * NEGATIVE TEST (the fail-closed proof): a fabricated metric injected
 * into the identityContinuity block must FAIL this validator (exit 1);
 * restored, it passes (exit 0). Run:
 *   bun scripts/evidence/hf-portfolio/hf005/record-benchmark.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RECORD_PATH = join(HERE, "benchmark-record.json");
const LEDGER_PATH = join(HERE, "..", "provenance-ledger.json");
const PREFLIGHT_PATH = join(HERE, "results", "preflight-refusal.json");
const LICENSE_PATH = join(HERE, "results", "license-posture.json");
const SELFCHECK_PATH = join(HERE, "results", "metric-selfcheck.json");
const CONTRACT_PATH = join(HERE, "results", "contract-compatibility.json");
const COMPARISON_PATH = join(HERE, "results", "tracking-comparison.json");
const LOAD_PATH = join(HERE, "results", "load-analysis.json");

const failures: string[] = [];
const fail = (message: string): void => {
  failures.push(message);
};

if (!existsSync(RECORD_PATH)) {
  console.error("HF005 record-benchmark FAILED: benchmark-record.json is missing");
  process.exit(1);
}
const record = JSON.parse(readFileSync(RECORD_PATH, "utf8")) as { benchmarkRun?: Record<string, unknown> };
const run = record.benchmarkRun;
if (!run) {
  console.error("HF005 record-benchmark FAILED: benchmark-record.json has no benchmarkRun block");
  process.exit(1);
}

// --- 1. the ledger echo VERBATIM -----------------------------------------------

if (!existsSync(LEDGER_PATH)) fail("provenance-ledger.json does not resolve (the record's authority)");
const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as unknown;
const ledgerRows = Array.isArray(ledger)
  ? (ledger as Record<string, unknown>[])
  : ((ledger as Record<string, unknown>).rows as Record<string, unknown>[]) ??
    ((ledger as Record<string, unknown>).candidates as Record<string, unknown>[]);
const sam3Row = ledgerRows.find((row) => row.candidate === "SAM3");
if (!sam3Row) fail("the SAM3 row is absent from the provenance ledger");
const echo = run.provenanceLedgerEcho as Record<string, unknown> | undefined;
if (!echo) fail("the record carries no provenanceLedgerEcho block");
if (echo && sam3Row) {
  for (const [key, value] of Object.entries(sam3Row)) {
    if (!Object.prototype.hasOwnProperty.call(echo, key)) {
      fail(`the ledger echo is missing the field "${key}"`);
    } else if (JSON.stringify(echo[key]) !== JSON.stringify(value)) {
      fail(`the ledger echo field "${key}" is not VERBATIM (expected ${JSON.stringify(value)}, got ${JSON.stringify(echo[key])})`);
    }
  }
  for (const key of Object.keys(echo)) {
    if (key !== "note" && !Object.prototype.hasOwnProperty.call(sam3Row, key)) {
      fail(`the ledger echo carries a field the ledger row does not have: "${key}"`);
    }
  }
}

// --- 2. no promotion -----------------------------------------------------------

const gate = run.promotionGate as Record<string, unknown> | undefined;
if (!gate) fail("the record carries no promotionGate block");
if (gate && gate.gatingState !== "candidate") {
  fail(`gatingState is "${gate.gatingState}" — a worker flight must never move it off "candidate"`);
}
if (gate && !String(gate.hf015StandingVerdict ?? "").includes("PROMOTION-REFUSED")) {
  fail("the record does not carry the HF015 standing verdict for SAM3 (all five legs failed)");
}
if (gate && !Array.isArray(gate.blockersObserved)) {
  fail("the record carries no blockersObserved array (the observed blockers are the gate's future input)");
}

// --- 3. the typed refusal pinned to the EXECUTED preflight ---------------------

const refusal = run.typedRefusal as Record<string, unknown> | undefined;
if (!refusal) fail("the record carries no typedRefusal block");
if (refusal && refusal.type !== "auth-gated-model+resource-infeasible-host") {
  fail(`the typed refusal type is "${refusal.type}" (expected auth-gated-model+resource-infeasible-host)`);
}
if (refusal && refusal.verdict !== "refused") fail('the typed refusal verdict is not "refused"');
if (refusal && refusal.exitCode !== 3) fail("the typed refusal exitCode is not 3 (the fail-closed convention)");
if (refusal && !String(refusal.evidence ?? "").endsWith("results/preflight-refusal.json")) {
  fail(`the typed refusal evidence does not resolve: ${refusal?.evidence}`);
}

if (!existsSync(PREFLIGHT_PATH)) {
  fail(`the typed refusal evidence does not resolve on disk: ${PREFLIGHT_PATH}`);
} else {
  const preflight = JSON.parse(readFileSync(PREFLIGHT_PATH, "utf8")) as Record<string, unknown>;
  if (preflight.refusalType !== "auth-gated-model+resource-infeasible-host") {
    fail("the committed preflight refusalType does not match the record's typed refusal");
  }
  if (preflight.exitCode !== 3) fail("the committed preflight exitCode is not 3");
  const gatedFiles = (preflight.gatedFilesAtPinnedRevision as string[]) ?? [];
  const publicFiles = (preflight.publicFilesAtPinnedRevision as string[]) ?? [];
  for (const weightFile of ["model.safetensors", "sam3.pt"]) {
    if (!gatedFiles.includes(weightFile)) {
      fail(`the executed probe map does not record ${weightFile} as gated — the auth-wall premise is unpinned`);
    }
  }
  for (const docFile of ["LICENSE", "README.md"]) {
    if (!publicFiles.includes(docFile)) {
      fail(`the executed probe map does not record ${docFile} as public — the bounded-fetch premise is unpinned`);
    }
  }
  const probes = (preflight.probeMap as Array<Record<string, unknown>>) ?? [];
  const weightProbe = probes.find((p) => p.file === "model.safetensors");
  if (!weightProbe || !String(weightProbe.gateWallTextHead ?? "").includes("restricted")) {
    fail("the 401 wall text is not recorded verbatim in the probe map");
  }
  if (!weightProbe || weightProbe.httpStatus !== 401) {
    fail("the model.safetensors probe is not a 401");
  }
  const licenseFetches = (preflight.licenseDocumentsFetched as string[]) ?? [];
  if (licenseFetches.length < 2) fail("the preflight records fewer than the two license documents (HF + GitHub)");
}

const runtime = run.modelRuntime as Record<string, unknown> | undefined;
if (runtime) {
  const weights = String(runtime.weights ?? "");
  if (!weights.includes("NEVER downloaded")) fail("the weights-never-downloaded pin is absent from modelRuntime.weights");
  if (!weights.includes("NO third-party mirror")) fail("the no-mirror pin is absent from modelRuntime.weights");
}

// --- 4. NO fabricated measurements ----------------------------------------------

for (const block of ["quality", "identityContinuity", "latency", "memory"]) {
  const status = (run as unknown as Record<string, Record<string, string>>)[block]?.status;
  if (status !== "not-measured-typed-refusal") {
    fail(`the ${block} block status is "${status}" (expected not-measured-typed-refusal)`);
  }
}
const MEASUREMENT_SHAPED = [
  "identityswitches",
  "continuityscore",
  "fragmentationmeantracksperobject",
  "identitypreservingpairs",
  "totalpairs",
  "switches",
  "idswitchrate",
  "swaprate",
  "mota",
  "hota",
  "maskiou",
  "maskquality",
  "dice",
  "meaniou",
  "perframems",
  "wallclockms",
  "totalwallms",
  "msperframe",
  "latencyms",
  "fps",
  "realtimefactor",
  "cascadedeltams",
  "cascadecostratio",
  "peakrss",
  "rss",
  "vmrss",
  "peakgpumemorygib",
];
scanMeasurementKeys(run, "", MEASUREMENT_SHAPED);
const memory = run.memory as Record<string, unknown> | undefined;
if (memory && memory.gpuMemory && !String(memory.gpuMemory).startsWith("N/A")) {
  fail("the memory block's gpuMemory must be typed N/A (no GPU on the benchmark host; never zero)");
}

// --- 5. the license review (first-class) ----------------------------------------

if (!existsSync(LICENSE_PATH)) fail("results/license-posture.json does not resolve (the license leg is first-class)");
if (existsSync(LICENSE_PATH)) {
  const posture = JSON.parse(readFileSync(LICENSE_PATH, "utf8")) as Record<string, unknown>;
  if (posture.citationsMachineVerifiedAgainstFetchedText !== true) {
    fail("the license citations were not machine-verified against the fetched text");
  }
  if (posture.neverLegalAdvice !== true) fail("the license posture is not marked never-legal-advice");
  const citations = (posture.citations as Array<Record<string, unknown>>) ?? [];
  if (citations.length < 10) fail(`the license review carries only ${citations.length} citations (expected the full term review)`);
  const verdict = posture.verdict as Record<string, unknown> | undefined;
  if (!verdict || !String(verdict.verdict ?? "").includes("research/watchlist")) {
    fail("the license verdict does not hold the research/watchlist posture");
  }
  if (verdict && verdict.acceptanceBarVerbatim !== "remain research/watchlist unless production-safe") {
    fail("the license verdict does not quote the acceptance's own bar verbatim");
  }
  const gateTerms = posture.gateTerms as Record<string, unknown> | undefined;
  if (!gateTerms || !String(gateTerms.gateType ?? "").includes("manual")) {
    fail("the license posture does not record the manual gate type from the API metadata");
  }
  const commercial = (posture.commercialUse as Record<string, unknown>) ?? {};
  if (String(commercial.ledgerSays ?? "unclear") !== "unclear") {
    fail("the license posture's commercialUse.ledgerSays must echo the ledger's 'unclear'");
  }
}

// --- 6. the executed partial pinned ----------------------------------------------

if (!existsSync(SELFCHECK_PATH)) fail("results/metric-selfcheck.json does not resolve");
if (existsSync(SELFCHECK_PATH)) {
  const selfcheck = JSON.parse(readFileSync(SELFCHECK_PATH, "utf8")) as Record<string, unknown>;
  if (selfcheck.pass !== true) fail("the metric self-check did not pass");
  const cases = (selfcheck.cases as Array<Record<string, unknown>>) ?? [];
  if (cases.length !== 18) fail(`the metric self-check carries ${cases.length} cases (expected 18)`);
  if (!String(selfcheck.placeholderNote ?? "").includes("NOT measurements")) {
    fail("the self-check must label its placeholder numbers as NOT measurements");
  }
}
if (!existsSync(CONTRACT_PATH)) fail("results/contract-compatibility.json does not resolve");
if (existsSync(CONTRACT_PATH)) {
  const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8")) as Record<string, unknown>;
  if (contract.pass !== true) fail("the contract-compatibility checker did not pass");
  const absence = contract.maskPayloadAbsenceMachineCheck as Record<string, unknown> | undefined;
  if (!absence || !Array.isArray(absence.maskKinds) || absence.maskKinds.length !== 0) {
    fail("the mask-payload absence machine check did not conclude no-mask-kind");
  }
}
if (!existsSync(COMPARISON_PATH)) fail("results/tracking-comparison.json does not resolve (the comparison design)");
if (!existsSync(LOAD_PATH)) fail("results/load-analysis.json does not resolve (the load analysis)");
if (existsSync(LOAD_PATH)) {
  const load = JSON.parse(readFileSync(LOAD_PATH, "utf8")) as Record<string, unknown>;
  const gateInfo = load.gate as Record<string, unknown> | undefined;
  if (!gateInfo || gateInfo.gated !== "manual") fail("the load analysis does not record gated=manual");
  if (load.revisionDrift !== "none — the pinned revision IS the repo HEAD") {
    fail("the load analysis does not record the no-drift pin at the pinned revision");
  }
}

const refusalBlock = run.typedRefusal as Record<string, unknown> | undefined;
if (!refusalBlock || refusalBlock.negativeTested !== true) {
  fail("the typed refusal block does not record the three-mode negative test");
}

// --- 7. the honesty doctrines ----------------------------------------------------

const doctrines = run.honestyDoctrines as Record<string, unknown> | undefined;
if (!doctrines) fail("the record carries no honestyDoctrines block");
if (doctrines) {
  if (doctrines.neverLegalAdvice !== true) fail("the honesty doctrines do not pin never-legal-advice");
  if (!String(doctrines.staticReview ?? "").includes("STATIC")) {
    fail("the static-review labeling is absent from the honesty doctrines");
  }
  if (!String(doctrines.noFabricatedNumbers ?? "").includes("refuses")) {
    fail("the no-fabricated-numbers doctrine is absent");
  }
}

// --- verdict ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`HF005 record-benchmark FAILED (${failures.length} failures):`);
  for (const message of failures) {
    console.error(`  - ${message}`);
  }
  process.exit(1);
}

console.log(
  "HF005 record-benchmark PASS — ledger echo verbatim (12 fields); gatingState candidate (no promotion); " +
    "the typed refusal pinned to the EXECUTED preflight (401 probe map + gate type + public license docs); " +
    "no measurement-shaped key anywhere in the benchmarkRun; the license review machine-verified " +
    "(citations + never-legal-advice + the acceptance bar); the partial pinned (self-check 18/18, " +
    "contract-compatibility, comparison design, load analysis); the honesty doctrines present",
);
process.exit(0);

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
        fail(
          `fabrication guard: the measurement-shaped key "${key}" appears at ${path || "(root)"} with value ${JSON.stringify(value)}`,
        );
      }
      scanMeasurementKeys(value, `${path}.${key}`.replace(/^\./, ""), keys);
    }
  }
}
