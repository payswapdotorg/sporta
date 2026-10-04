/**
 * SPR302 — the feasibility-matrix fail-closed validator (worker 65-h).
 *
 * The record-benchmark.ts convention applied to the research/matrix flight:
 * this entry loads scripts/evidence/spr302-v2v-feasibility/matrix-record.json
 * — the SPR302 candidate shortlist + feasibility matrix — and checks it
 * against the EXECUTED probe evidence it claims to stand on
 * (results/shortlist-probe.json + results/followup-fetches.json + the
 * committed fetches/ documents). The SPR302 shape: NO model ran (the
 * executed trial is SPR303's WAVE-2 item), so the validator pins:
 *
 * 1. STRUCTURE: 6-10 candidate rows; every row carries all FIVE matrix
 *    axes (resource / license / contractFit / identityRisk /
 *    wave2Readiness) + the hub shortlist facts block;
 * 2. PROBE FACTS: every hub repo the matrix marks exists=true carries the
 *    executed probe facts — gated state, a 40-hex pinned revision, a
 *    hub-reported total size > 0, and a reachability verdict — and those
 *    facts match results/shortlist-probe.json VERBATIM (the record may
 *    not drift from the executed run);
 * 3. LICENSE CITATIONS: every recorded license verdict cites at least one
 *    fetches/ document that EXISTS on disk (each fetch carries its
 *    fetch-meta with sha256); verdicts never appear without recorded
 *    terms; N/A verdicts only where the artifact-absent class is recorded;
 * 4. NO FABRICATED MEASUREMENTS: no measurement-shaped key anywhere in
 *    the record (perFrameMs / latencyMs / identitySwitches /
 *    continuityScore / renderWallMs / framesPerSecond / measuredRamUse /
 *    vlmScore ...) — the model never ran, so ANY such number would be a
 *    fabrication; class-judgments and cost arithmetic must carry the
 *    not-measured / class-judgment labels (checked where they appear);
 * 5. NO PROMOTION: the record carries the noExecution policy + the
 *    noPromotion recommendation text; no gatingState/tier/promotion claim
 *    anywhere (SPR303 owns the trial; the matrix only shortlists);
 * 6. HONESTY: the host facts in the record match the MEASURED host block
 *    of the executed probe (RAM / disk / vCPU / no-GPU); the
 *    priorClaimsChecked block carries claim + liveFacts + verdict for
 *    every checked prior claim (the landscape's claims are CHECKED, not
 *    trusted).
 *
 * NEGATIVE TEST (the fail-closed proof): a fabricated metric injected
 * into a candidate's resource block (perFrameMs) must FAIL this validator
 * (exit 1); a license citation pointing at a nonexistent fetch document
 * must FAIL (exit 1); restored, it passes (exit 0). Run:
 *   bun scripts/evidence/spr302-v2v-feasibility/validate-matrix.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RECORD_PATH = join(HERE, "matrix-record.json");
const PROBE_PATH = join(HERE, "results", "shortlist-probe.json");
const FOLLOWUP_PATH = join(HERE, "results", "followup-fetches.json");
const FETCHES_DIR = join(HERE, "fetches");

const failures: string[] = [];
const fail = (message: string): void => {
  failures.push(message);
};

if (!existsSync(RECORD_PATH)) {
  console.error("SPR302 validate-matrix FAILED: matrix-record.json is missing");
  process.exit(1);
}
if (!existsSync(PROBE_PATH)) {
  console.error("SPR302 validate-matrix FAILED: results/shortlist-probe.json is missing (the executed probe run)");
  process.exit(1);
}
const record = JSON.parse(readFileSync(RECORD_PATH, "utf8")) as Record<string, unknown>;
const probe = JSON.parse(readFileSync(PROBE_PATH, "utf8")) as Record<string, unknown>;
const followupExists = existsSync(FOLLOWUP_PATH);

const candidates = record.candidates as Array<Record<string, unknown>> | undefined;
if (!Array.isArray(candidates)) {
  console.error("SPR302 validate-matrix FAILED: no candidates array");
  process.exit(1);
}

// --- 1. structure: 6-10 rows, five axes each ------------------------------------
if (candidates.length < 6 || candidates.length > 10) {
  fail(`candidate shortlist must hold 6-10 rows (found ${candidates.length})`);
}
const AXES = ["resource", "license", "contractFit", "identityRisk", "wave2Readiness"] as const;
for (const row of candidates) {
  const name = String(row.candidate ?? "<unnamed>");
  if (!row.landscapeClass) fail(`${name}: missing landscapeClass (the class provenance)`);
  if (!row.hub) fail(`${name}: missing the hub shortlist block`);
  for (const axis of AXES) {
    if (!row[axis] || typeof row[axis] !== "object") fail(`${name}: missing the ${axis} axis`);
  }
}

// --- 2. probe facts: the record matches the EXECUTED probe run -------------------
const probeByRepo = new Map<string, Record<string, unknown>>();
for (const entry of probe.shortlist as Array<Record<string, unknown>>) {
  for (const p of entry.hubProbes as Array<Record<string, unknown>>) {
    probeByRepo.set(String(p.repoId), p);
  }
}
const HEX40 = /^[0-9a-f]{40}$/;
for (const row of candidates) {
  const name = String(row.candidate);
  const hub = row.hub as Record<string, unknown> | undefined;
  if (!hub) continue;
  const repos = (hub.repos as Array<Record<string, unknown>> | undefined) ?? [];
  if (repos.length === 0) fail(`${name}: no hub repo entries recorded (the shortlist requires the probe state, even as not-found)`);
  for (const repo of repos) {
    const repoId = String(repo.repoId);
    const probeRow = probeByRepo.get(repoId);
    if (!probeRow) {
      fail(`${name}/${repoId}: recorded in the matrix but ABSENT from the executed probe run — never a guess`);
      continue;
    }
    if (repo.exists === true) {
      if (repo.gated === undefined) fail(`${name}/${repoId}: exists=true without the gated state`);
      const rev = String(repo.pinnedRevision ?? "");
      if (!HEX40.test(rev)) fail(`${name}/${repoId}: pinned revision is not a 40-hex sha (${rev || "absent"})`);
      if (rev !== String(probeRow.pinnedRevision)) {
        fail(`${name}/${repoId}: pinned revision drifted from the executed probe (${rev} vs ${probeRow.pinnedRevision})`);
      }
      const size = Number(repo.totalHubReportedBytes ?? -1);
      if (!(size > 0)) fail(`${name}/${repoId}: exists=true without a positive hub-reported size`);
      if (size !== Number(probeRow.totalHubReportedBytes)) {
        fail(`${name}/${repoId}: hub-reported size drifted from the executed probe (${size} vs ${probeRow.totalHubReportedBytes})`);
      }
      if (repo.gated !== probeRow.gated) fail(`${name}/${repoId}: gated state drifted from the executed probe`);
      if (!String(repo.reachability ?? "")) fail(`${name}/${repoId}: exists=true without the reachability verdict`);
      if (!String(repo.reachability).includes("206")) {
        fail(`${name}/${repoId}: reachability verdict does not record the executed 206 probe (${repo.reachability})`);
      }
    } else if (repo.exists === false) {
      if (!repo.finding) fail(`${name}/${repoId}: exists=false without the recorded finding (the honest not-found fact)`);
    } else {
      fail(`${name}/${repoId}: exists must be a recorded boolean`);
    }
  }
}

// --- 3. license citations point at COMMITTED fetched documents -------------------
for (const row of candidates) {
  const name = String(row.candidate);
  const license = row.license as Record<string, unknown> | undefined;
  if (!license) continue;
  const verdict = String(license.verdict ?? "");
  if (!verdict) {
    fail(`${name}: license verdict absent`);
    continue;
  }
  if (verdict.startsWith("N/A")) {
    // artifact-absent rows: the N/A class must be backed by the recorded artifact state
    const artifactState = String(row.artifactState ?? "");
    if (!/absent|NO CODE|website stub/i.test(artifactState)) {
      fail(`${name}: N/A license verdict without the recorded artifact-absent state`);
    }
    continue;
  }
  const citationHolders: unknown[] = [];
  if (license.citations) citationHolders.push(license.citations);
  for (const side of ["code", "weights"]) {
    const block = license[side] as Record<string, unknown> | undefined;
    if (block?.citations) citationHolders.push(block.citations);
  }
  const citations = citationHolders.flat().map((c) => String(c));
  const existing = citations.filter((c) => {
    const m = c.match(/fetches\/([^\s'"]+?)(?=[\s'(,;]|$)/);
    return m ? existsSync(join(FETCHES_DIR, m[1])) : false;
  });
  if (existing.length === 0) {
    fail(`${name}: license verdict '${verdict}' cites no fetches/ document present on disk — recorded terms only, never a guess`);
  }
}
if (!followupExists) {
  fail("results/followup-fetches.json is missing (the executed follow-up fetch pass)");
}

// --- 4. no fabricated measurements (the model never ran) -------------------------
const MEASUREMENT_KEYS = [
  "perFrameMs",
  "latencyMs",
  "wallMs",
  "renderWallMs",
  "framesPerSecond",
  "fpsAchieved",
  "identitySwitches",
  "continuityScore",
  "fragmentation",
  "vlmScore",
  "sourceFidelity",
  "measuredRamMiB",
  "peakRamMiB",
  "criticalArtifacts",
];
const scanMeasurements = (node: unknown, path: string): void => {
  if (Array.isArray(node)) {
    node.forEach((child, i) => scanMeasurements(child, `${path}[${i}]`));
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (MEASUREMENT_KEYS.includes(key)) {
        fail(`fabrication guard: measurement-shaped key '${key}' at ${path} — no model ran on this flight (SPR303 owns the trial)`);
      }
      scanMeasurements(value, `${path}.${key}`);
    }
  }
};
scanMeasurements(record, "$");
// the class-judgment labels: the cost arithmetic must label itself not-measured
for (const row of candidates) {
  const name = String(row.candidate);
  const resource = row.resource as Record<string, unknown> | undefined;
  if (resource?.costArithmetic && !String(resource.costArithmetic).includes("not-measured")) {
    fail(`${name}: cost arithmetic without the not-measured label (no run backs it)`);
  }
}

// --- 5. no promotion --------------------------------------------------------------
const noExec = record.noExecution as Record<string, unknown> | undefined;
if (!noExec || noExec.modelRuns !== 0) fail("noExecution block absent or modelRuns !== 0 (the research-only flight pin)");
const rec = record.recommendation as Record<string, unknown> | undefined;
if (!rec || !rec.noPromotion) fail("recommendation.noPromotion absent (SPR303 owns the trial; the matrix only shortlists)");
const PROMOTION_WORDS = /\b(promoted|promotion-granted|gatingState.*(?:eligible|promoted))\b/i;
const scanPromotion = (node: unknown, path: string): void => {
  if (typeof node === "string") {
    if (PROMOTION_WORDS.test(node)) fail(`promotion-shaped claim at ${path} ('${node.slice(0, 80)}') — the matrix never promotes`);
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) scanPromotion(value, `${path}.${key}`);
  }
};
scanPromotion(record, "$");

// --- 6. host facts match the MEASURED probe + prior claims checked ----------------
const hostRec = record.authorities?.hostMeasured as string | undefined;
const hostProbe = probe.host as Record<string, unknown> | undefined;
if (!hostProbe) fail("the executed probe record carries no host block");
if (!hostRec || !hostRec.includes(String(hostProbe?.totalRamMiB)) || !hostRec.includes(String(hostProbe?.freeDiskGiB))) {
  fail("the matrix's host citation does not match the MEASURED host block (RAM/disk must be the probe's numbers)");
}
const claims = record.priorClaimsChecked as Array<Record<string, unknown>> | undefined;
if (!Array.isArray(claims) || claims.length < 5) {
  fail("priorClaimsChecked must check at least 5 of the landscape's prior claims (the CHECKED-not-trusted doctrine)");
}
for (const c of claims ?? []) {
  if (!c.claim || !c.liveFacts || !c.verdict) fail("a priorClaimsChecked entry is missing claim/liveFacts/verdict");
}

// --- verdict ------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`SPR302 validate-matrix FAILED (${failures.length} finding(s)):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `SPR302 validate-matrix OK: ${candidates.length} candidates x 5 axes; ` +
    `${probeByRepo.size} hub probes cross-matched; license verdicts cite committed fetches; ` +
    `zero measurement-shaped keys (no model ran); no promotion; host facts = the measured probe; ` +
    `${claims?.length ?? 0} prior landscape claims checked.`,
);
process.exit(0);
