/**
 * HF015 — THE TECHNOLOGY PROMOTION GATE (the Tech Lead's own flight).
 *
 * The acceptance (verbatim, docs/work-items/hf-model-portfolio-work-items.md):
 * "only candidates with benchmark, resource, provenance/license,
 *  reproducibility and failure evidence can move from candidate to
 *  benchmarked/canary/production."
 *
 * The state ladder (docs/contracts/technology-provenance-ledger.md): every
 * ledger row starts `candidate` (or `watchlist` for research-only); NOTHING
 * starts benchmarked/canary/production; only HF015 (Tech Lead) can promote.
 *
 * This script is THE GATE — fail-closed, machine-checkable, negative-tested:
 *
 * - **The five evidence legs** (the acceptance's own list, one typed check
 *   each, evaluated against the RECORDED evidence — the per-flight
 *   benchmark-record.json files + the provenance ledger, never hardcoded
 *   claims):
 *   1. `benchmark` — the candidate's flight record exists AND carries an
 *      EXECUTED run: no `typedRefusal` block, and the `quality` block
 *      carries at least one MEASURED number (the inverse of the flights'
 *      fabrication guards — a `not-measured-typed-refusal` status fails).
 *   2. `resource` — no `resource-infeasible-host` refusal recorded, AND the
 *      `latency` block carries at least one measured number (the resource
 *      story was executed, not typed).
 *   3. `provenance-license` — the ledger row is permissive-and-clear:
 *      `commercialUse === "yes"`, `modelLicense` permissive (apache-2.0 /
 *      mit / cc-by-4.0 — the ledger contract's own derivation classes),
 *      `codeLicense !== "unknown"`; AND the flight's recorded license
 *      posture (where one exists) is not research-only / watchlist-pending-
 *      terms; AND the row was recorded within RECENCY_DAYS (the ledger's
 *      own rule: fields must be "current and re-verified" before any
 *      promotion).
 *   4. `reproducibility` — the ledger row pins a 40-hex revision AND the
 *      flight's evidence tree (the benchmark-record.json + its validator)
 *      exists on disk (the re-runnable harness resolves).
 *   5. `failure` — the failure envelope is RECORDED (the flight's
 *      `promotionGate.blockersObserved` block) AND EMPTY: a recorded
 *      unresolved blocker STANDS until re-verified resolved — the honest
 *      doctrine (a flight's own recorded refusal of promotion is evidence
 *      against the promotion, never a formality). A candidate with NO
 *      flight has NO recorded envelope — fail-closed (no record = no
 *      evidence).
 *
 * - **The adjudication**: every ledger row is evaluated; the verdict and the
 *   per-leg blockers are written to results/adjudication.json. A promotion
 *   requires ALL FIVE legs. THIS gate NEVER writes a promotion and NEVER
 *   touches the ledger (FROZEN) — the adjudication record is the output.
 *
 * - **The machinery self-tests** (results/gate-self-tests.json — SYNTHETIC
 *   requests, clearly labeled, never candidates): one fully-evidenced
 *   synthetic request PASSES all five legs (the gate is proven NOT a
 *   blanket refuser — it CAN pass a candidate that arrives with the full
 *   evidence chain), and five single-leg-missing variants are each REFUSED
 *   with exactly that leg's typed blocker. The script exits 0 ONLY IF every
 *   self-test behaves exactly as specified AND every ledger row is
 *   adjudicated AND no promotion is claimed anywhere — else exit 1
 *   (fail-closed).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const PORTFOLIO = dirname(new URL(import.meta.url).pathname);
const RESULTS = join(PORTFOLIO, "results");
const LEDGER = join(PORTFOLIO, "..", "provenance-ledger.json");
/** The flight that benchmarked each ledger candidate (the assignment is a
 * recorded fact; HF005/SAM3 and the watchlist row have NO flight). */
const FLIGHT_OF: Record<string, string | null> = {
  "RF-DETR": "hf003",
  MapAnything: "hf004",
  SAM3: null,
  Spivak: "hf006",
  SoccerChat: "hf007",
  "VibeVoice-ASR-Streaming": "hf008",
  "Qwen3-ASR": "hf008",
  pyannote: "hf009",
  "Wan2.2-Fun-Control-Camera": "hf010",
  ReCamMaster: "hf010",
  Meridian: "hf010",
  ViewCrafter: "hf011",
  "Wan2.2-Animate": "hf012",
  "LTX-2.3": "hf013",
  "DA3-GIANT": null,
};
/** The ledger contract's permissive derivation classes. */
const PERMISSIVE = ["apache-2.0", "mit", "cc-by-4.0"];
/** The ledger's own rule: fields "current and re-verified" — recorded
 * within the last 7 days at adjudication time. */
const RECENCY_DAYS = 7;

type LedgerRow = {
  candidate: string;
  modelLicense: string;
  codeLicense: string;
  commercialUse: string;
  revision: string;
  gatingState: string;
  recordedAt: string;
};
type BenchRecord = {
  benchmarkRun?: {
    typedRefusal?: { type?: string };
    quality?: Record<string, unknown>;
    latency?: Record<string, unknown>;
    promotionGate?: { gatingState?: string; blockersObserved?: string[] };
  };
};
type Leg = "benchmark" | "resource" | "provenance-license" | "reproducibility" | "failure";
const LEGS: readonly Leg[] = [
  "benchmark",
  "resource",
  "provenance-license",
  "reproducibility",
  "failure",
];

function fail(msg: string): never {
  console.error(`HF015 promotion gate FAILED: ${msg}`);
  process.exit(1);
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/** A measured number under a block (a finite number value — top-level OR
 * nested (e.g. hf006's structuralResults sub-dicts) — never a status
 * string / note / typed marker; depth-limited to keep the scan bounded —
 * the fabrication-guard inverse). */
function carriesMeasuredNumber(block: unknown, depth = 3): boolean {
  if (typeof block === "number" && Number.isFinite(block)) return true;
  if (typeof block !== "object" || block === null || depth <= 0) return false;
  for (const v of Object.values(block as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) return true;
    if (typeof v === "object" && v !== null && carriesMeasuredNumber(v, depth - 1)) {
      return true;
    }
  }
  return false;
}

/** The inputs the five legs evaluate — injected so the SYNTHETIC self-tests
 * exercise the SAME machinery with synthetic inputs (never files). */
type GateInputs = {
  row: LedgerRow;
  flight: string | null;
  record: BenchRecord | null;
  recordPath: string | null;
  validatorPath: string | null;
  posture: Record<string, unknown> | null;
};

/** The candidate's license-posture blocker (research-only /
 * watchlist-pending-terms classes) from the flight's recorded posture —
 * scoped EXACTLY to the candidate's own verdict block: multi-candidate
 * posture files (hf010's `candidates` map) are checked per-key so one
 * candidate's blocked class never contaminates another's permissive
 * verdict; single-candidate posture files are checked whole (the file is
 * about that one candidate). */
function postureBlocked(inputs: GateInputs): boolean {
  const posture = inputs.posture;
  if (!posture) return false;
  const blockedClass = (text: string): boolean => {
    const t = text.toLowerCase();
    return t.includes("research-only") || t.includes("watchlist-pending-terms");
  };
  const candidates = (posture as { candidates?: Record<string, unknown> }).candidates;
  if (candidates && typeof candidates === "object") {
    const wanted = inputs.row.candidate.toLowerCase();
    for (const [key, value] of Object.entries(candidates)) {
      if (key.toLowerCase() === wanted) {
        return blockedClass(JSON.stringify(value));
      }
    }
    // The candidate is not in the posture map — no recorded posture verdict
    // for THIS candidate (never block on another candidate's verdict).
    return false;
  }
  // Single-candidate posture file: the whole file is about this candidate.
  return blockedClass(JSON.stringify(posture));
}

type LegVerdict = { leg: Leg; pass: boolean; blockers: string[] };

/** THE GATE: the five evidence legs over the injected inputs. */
function evaluateLegs(inputs: GateInputs): LegVerdict[] {
  const { row, flight, record, recordPath, validatorPath } = inputs;
  const run = record?.benchmarkRun ?? null;
  const refusalType = run?.typedRefusal?.type ?? null;
  const quality = run?.quality ?? null;
  const latency = run?.latency ?? null;
  const blockers = run?.promotionGate?.blockersObserved ?? null;

  const verdicts: LegVerdict[] = [];

  // Leg 1 — benchmark (an EXECUTED run: no refusal + measured quality).
  {
    const legBlockers: string[] = [];
    if (!flight) legBlockers.push(`no benchmark flight exists for ${row.candidate} (the portfolio records none)`);
    else if (!record) legBlockers.push(`the ${flight} benchmark-record.json does not resolve`);
    else if (refusalType) legBlockers.push(`the ${flight} record is a typed refusal (${refusalType}) — zero executed benchmark evidence`);
    else if (!carriesMeasuredNumber(quality)) legBlockers.push(`the ${flight} quality block carries no measured number (status: ${typeof quality?.status === "string" ? quality.status : "absent"})`);
    verdicts.push({ leg: "benchmark", pass: legBlockers.length === 0, blockers: legBlockers });
  }

  // Leg 2 — resource (the resource story executed, not typed).
  {
    const legBlockers: string[] = [];
    if (refusalType === "resource-infeasible-host") legBlockers.push(`the ${flight} record refuses resource-infeasible-host — the host class cannot run the candidate`);
    else if (!flight || !record) legBlockers.push("no flight record — the resource story is unrecorded (fail-closed)");
    else if (!carriesMeasuredNumber(latency)) legBlockers.push(`the ${flight} latency block carries no measured number — the resource story was not executed`);
    verdicts.push({ leg: "resource", pass: legBlockers.length === 0, blockers: legBlockers });
  }

  // Leg 3 — provenance/license (permissive + clear + current + posture-clean).
  {
    const legBlockers: string[] = [];
    if (row.commercialUse !== "yes") legBlockers.push(`commercialUse is "${row.commercialUse}" (not a recorded "yes")`);
    if (!PERMISSIVE.some((l) => row.modelLicense.startsWith(l))) legBlockers.push(`modelLicense is "${row.modelLicense.slice(0, 60)}" (not a permissive class)`);
    if (row.codeLicense === "unknown") legBlockers.push("codeLicense is unknown (the linked-code review is unrecorded)");
    if (postureBlocked(inputs)) legBlockers.push(`the ${flight} license posture records a research-only / watchlist-pending-terms class for this candidate`);
    const ageDays = (Date.now() - Date.parse(row.recordedAt)) / 86_400_000;
    if (!(Number.isFinite(ageDays) && ageDays >= 0 && ageDays <= RECENCY_DAYS)) {
      legBlockers.push(`the ledger row was recorded ${Number.isFinite(ageDays) ? ageDays.toFixed(1) : "?"} days ago — outside the ${RECENCY_DAYS}-day re-verification window (the ledger's own currency rule)`);
    }
    verdicts.push({ leg: "provenance-license", pass: legBlockers.length === 0, blockers: legBlockers });
  }

  // Leg 4 — reproducibility (pinned revision + the harness resolves).
  {
    const legBlockers: string[] = [];
    if (!/^[0-9a-f]{40}$/.test(row.revision ?? "")) legBlockers.push("the ledger row does not pin a 40-hex revision");
    if (!flight || !record) legBlockers.push("no benchmark flight — the re-runnable harness does not resolve");
    else if (!recordPath || !existsSync(recordPath)) legBlockers.push("the flight's benchmark-record.json does not exist on disk");
    else if (!validatorPath || !existsSync(validatorPath)) legBlockers.push(`the ${flight} record-benchmark.ts validator does not exist on disk`);
    verdicts.push({ leg: "reproducibility", pass: legBlockers.length === 0, blockers: legBlockers });
  }

  // Leg 5 — failure (the envelope RECORDED and EMPTY — blockers stand).
  {
    const legBlockers: string[] = [];
    if (!flight || !record) legBlockers.push("no benchmark flight — the failure envelope is unrecorded (fail-closed: no record = no evidence)");
    else if (!Array.isArray(blockers)) legBlockers.push(`the ${flight} record carries no promotionGate.blockersObserved block — the failure envelope is unrecorded`);
    else if (blockers.length > 0) {
      for (const b of blockers) legBlockers.push(`STANDING BLOCKER (recorded by the flight, unresolved): ${b}`);
    }
    verdicts.push({ leg: "failure", pass: legBlockers.length === 0, blockers: legBlockers });
  }

  return verdicts;
}

// ---------------------------------------------------------------------------
// The main: the self-tests + the adjudication + the fail-closed exit.
// ---------------------------------------------------------------------------
mkdirSync(RESULTS, { recursive: true });

// 1. The machinery self-tests (SYNTHETIC — never candidates; the SAME
// evaluateLegs machinery, synthetic inputs injected — the real files are
// never consulted for these).
type SelfTest = { label: string; expected: string; observed: string; ok: boolean };
const selfTests: SelfTest[] = [];

const SYNTHETIC_ROW: LedgerRow = {
  candidate: "SYNTHETIC-SELFTEST",
  modelLicense: "apache-2.0",
  codeLicense: "apache-2.0",
  commercialUse: "yes",
  revision: "a".repeat(40),
  gatingState: "candidate",
  recordedAt: new Date().toISOString(),
};
const SYNTHETIC_FLIGHT = "hf-synthetic-selftest";
const SYNTHETIC_EXECUTED: BenchRecord = {
  benchmarkRun: {
    quality: { exampleMetric: 0.87 },
    latency: { exampleLatencyMs: 412 },
    promotionGate: { gatingState: "candidate", blockersObserved: [] },
  },
};
const syntheticInputs = (overrides: {
  row?: Partial<LedgerRow>;
  record?: BenchRecord | null;
  validatorMissing?: boolean;
}): GateInputs => ({
  row: { ...SYNTHETIC_ROW, ...(overrides.row ?? {}) },
  flight: SYNTHETIC_FLIGHT,
  record: overrides.record !== undefined ? overrides.record : SYNTHETIC_EXECUTED,
  recordPath: join(PORTFOLIO, "promotion-gate.ts"), // a real existing file — the synthetic harness resolves
  validatorPath: overrides.validatorMissing
    ? join(PORTFOLIO, "selftest-missing-validator.ts")
    : join(PORTFOLIO, "promotion-gate.ts"), // a real existing file — the synthetic harness resolves
  posture: null,
});

const full = evaluateLegs(syntheticInputs({}));
const fullPass = full.every((v) => v.pass);
selfTests.push({
  label: "SYNTHETIC fully-evidenced request -> the gate PASSES all five legs (the gate is not a blanket refuser — it can pass a full-evidence chain)",
  expected: "pass",
  observed: fullPass ? "pass" : full.filter((v) => !v.pass).map((v) => `${v.leg}: ${v.blockers[0]}`).join("; "),
  ok: fullPass,
});

const legVariants: Array<{ leg: Leg; inputs: GateInputs }> = [
  {
    leg: "benchmark",
    inputs: syntheticInputs({
      // An auth-gate-class refusal (NOT the resource class — leg 2's own
      // branch) with the OTHER legs intact: measured latency + the empty
      // envelope — isolating EXACTLY the benchmark leg.
      record: {
        benchmarkRun: {
          typedRefusal: { type: "auth-gated-model" },
          quality: { status: "not-measured-typed-refusal" },
          latency: { exampleLatencyMs: 412 },
          promotionGate: { gatingState: "candidate", blockersObserved: [] },
        },
      },
    }),
  },
  {
    leg: "resource",
    inputs: syntheticInputs({
      // No refusal + measured quality, the latency block typed-not-measured
      // + the empty envelope — isolating EXACTLY the resource leg.
      record: {
        benchmarkRun: {
          quality: { exampleMetric: 0.9 },
          latency: { status: "not-measured-typed-refusal" },
          promotionGate: { gatingState: "candidate", blockersObserved: [] },
        },
      },
    }),
  },
  {
    leg: "provenance-license",
    inputs: syntheticInputs({ row: { commercialUse: "unclear" } }),
  },
  {
    leg: "reproducibility",
    inputs: syntheticInputs({ row: { revision: "not-a-40-hex-pin" } }),
  },
  {
    leg: "failure",
    inputs: syntheticInputs({
      record: {
        benchmarkRun: {
          quality: { exampleMetric: 0.9 },
          latency: { exampleLatencyMs: 300 },
          promotionGate: { gatingState: "candidate", blockersObserved: ["a standing unresolved blocker recorded by the flight"] },
        },
      },
    }),
  },
];
for (const variant of legVariants) {
  const verdicts = evaluateLegs(variant.inputs);
  const failedLegs = verdicts.filter((v) => !v.pass).map((v) => v.leg);
  const exactlyThatLeg = failedLegs.length === 1 && failedLegs[0] === variant.leg;
  selfTests.push({
    label: `SYNTHETIC request missing the ${variant.leg} leg -> refused with EXACTLY that leg's typed blocker`,
    expected: `refused-on:${variant.leg}`,
    observed: failedLegs.length === 0 ? "pass-all" : `refused-on:${failedLegs.join(",")}`,
    ok: exactlyThatLeg,
  });
}

writeFileSync(
  join(RESULTS, "gate-self-tests.json"),
  JSON.stringify(
    {
      label: "THE GATE MACHINERY SELF-TESTS — SYNTHETIC requests only (never candidates; never a promotion claim)",
      syntheticOnly: "every request here is synthetic; no real candidate is named; no gatingState changes anywhere",
      tests: selfTests,
      legsEnumerated: LEGS,
      allOk: selfTests.every((t) => t.ok),
    },
    null,
    2,
  ) + "\n",
);

if (!selfTests.every((t) => t.ok)) {
  fail("the machinery self-tests did not behave exactly as specified");
}

// 2. The adjudication over EVERY ledger row (the REAL files).
const ledger = readJson(LEDGER) as { candidates?: LedgerRow[] } | LedgerRow[] | Record<string, LedgerRow> | null;
const rows: LedgerRow[] = Array.isArray(ledger)
  ? ledger
  : ledger?.candidates
    ? (ledger as { candidates: LedgerRow[] }).candidates
    : ledger
      ? Object.values(ledger as Record<string, LedgerRow>)
      : [];
if (!Array.isArray(rows) || rows.length === 0) {
  fail("the provenance ledger did not parse into rows");
}

const adjudication = rows.map((row) => {
  const flight = FLIGHT_OF[row.candidate] ?? null;
  const recordPath = flight ? join(PORTFOLIO, "..", flight, "benchmark-record.json") : null;
  const validatorPath = flight ? join(PORTFOLIO, "..", flight, "record-benchmark.ts") : null;
  const record = recordPath ? (readJson(recordPath) as BenchRecord | null) : null;
  const posture = flight
    ? (readJson(join(PORTFOLIO, "..", flight, "results", "license-posture.json")) as Record<string, unknown> | null)
    : null;
  const verdicts = evaluateLegs({ row, flight, record, recordPath, validatorPath, posture });
  const failedLegs = verdicts.filter((v) => !v.pass);
  const promote = failedLegs.length === 0;
  return {
    candidate: row.candidate,
    ledgerGatingState: row.gatingState,
    flight,
    verdict: promote ? "PROMOTION-ELIGIBLE" : "PROMOTION-REFUSED",
    legs: verdicts,
    standingBlockers: failedLegs.flatMap((v) => v.blockers),
    /** The path to promotion: the recorded blockers ARE the path — each one
     * names the missing evidence leg or the unresolved fact. */
    pathToPromotion: promote
      ? "the full five-leg evidence chain is recorded — the TL may execute the promotion"
      : "resolve EVERY standing blocker with NEW recorded evidence (the adequate-host execution, the license-term resolution, the auth-gate unblock, the ground-truth provisioning — each named in the blockers), then re-run this gate",
  };
});

const eligible = adjudication.filter((a) => a.verdict === "PROMOTION-ELIGIBLE");
if (eligible.length > 0) {
  // Fail-closed: this script records the adjudication, NEVER executes a
  // promotion. An eligible row requires the TL's personal execution flight
  // (a future, explicit, human-reviewed change) — refuse to exit 0 here so
  // the eligible rows cannot slip through unreviewed.
  fail(`the adjudication found ${eligible.length} promotion-ELIGIBLE row(s) (${eligible.map((a) => a.candidate).join(", ")}) — the TL must review and execute any promotion personally in an explicit follow-up; this script never promotes`);
}

writeFileSync(
  join(RESULTS, "adjudication.json"),
  JSON.stringify(
    {
      label: "HF015 — the Technology promotion gate adjudication (the Tech Lead's flight; the acceptance's five evidence legs, machine-checked against the recorded evidence)",
      acceptanceVerbatim:
        "only candidates with benchmark, resource, provenance/license, reproducibility and failure evidence can move from candidate to benchmarked/canary/production",
      stateLadder: "candidate -> benchmarked -> canary -> production (the ledger contract: nothing starts promoted; only HF015 promotes; the ledger is FROZEN — this adjudication records, never mutates)",
      adjudicatedAt: new Date().toISOString(),
      rows: adjudication,
      summary: {
        total: adjudication.length,
        promotionEligible: 0,
        promotionRefused: adjudication.length,
        honestPosture:
          "NO promotion anywhere in the portfolio — every candidate stands at its recorded state with typed, machine-checked blockers; the path to promotion is the recorded blockers themselves (resolve each with new recorded evidence, then re-run the gate)",
      },
    },
    null,
    2,
  ) + "\n",
);

console.log(
  `HF015 promotion gate: the machinery PROVEN (self-tests ${selfTests.length}/${selfTests.length} exact) + the adjudication complete (${adjudication.length} ledger rows, ${adjudication.length} PROMOTION-REFUSED, 0 eligible) — the honest no-promotion posture, machine-checked.`,
);
console.log(`  results: ${join(RESULTS, "adjudication.json")} + ${join(RESULTS, "gate-self-tests.json")}`);
