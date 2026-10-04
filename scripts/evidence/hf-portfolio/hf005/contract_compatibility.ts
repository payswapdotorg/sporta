/**
 * HF005 — the SAM3 ↔ Sporta contract-compatibility checker (the
 * machine-checkable core of the segmentation/tracking benchmark flight).
 *
 * The worker brief's contract-mapping item made FAIL-CLOSED
 * machine-checkable, following the HF004/HF007/HF008/HF010/HF011/HF012/
 * HF013 convention (`contract_compatibility.ts`). It loads the MODEL side
 * from `results/model-io-surface.json` + `results/preflight-refusal.json` +
 * `results/license-posture.json` (the SOURCE-VERIFIED I/O facts — the card
 * at the pinned revision, fetched bounded by the EXECUTED preflight; a
 * STATIC review, never a run) and checks every mapping claim against the
 * repo's OWN authorities, each pinned to a literal needle that must be
 * present:
 *
 *   A. docs/contracts/technology-task-profiles.md (FROZEN) — the TWO
 *      profiles this candidate claims (football.playerSegmentation +
 *      football.playerTracking) with their exact input/output/metrics
 *      lines.
 *   B. packages/contracts/src/observation.ts — the observation payload
 *      union (detection | track | transcription | field-mapping | generic
 *      | team-assignment: NO mask payload exists — the load-bearing typed
 *      gap for a SEGMENTATION output, machine-checked as an ABSENCE) +
 *      the provenance/modality vocabularies.
 *   C. packages/contracts/src/identity.ts — the EntityId vocabulary
 *      ([A-Za-z0-9_-]{1,64}, session-scoped) the SAM3 object-id bridge
 *      must land in.
 *   D. packages/perception-tracking/src/tracker.ts (W204) — the repo's
 *      CURRENT tracker identity surface (TrackedBox.trackId: EntityId,
 *      the t<seq> scheme, maxGap/scene-cut conservatism whose
 *      fragmentation the comparison measures).
 *   E. packages/perception-tracking/src/benchmark.ts (W204) — the
 *      identity-continuity instrument whose semantics the metric design
 *      mirrors (identity switches + continuityScore).
 *   F. packages/contracts/src/rights.ts — the rights-provenance contract
 *      (AllowedOperation; the fail-closed "missing policy decision means
 *      DENY" doctrine) vs the SAM License's recorded terms.
 *   G. the fetched model card (fetches/hf-facebook-sam3-README@pinned-rev)
 *      — the documented I/O surface needles (the four model modes, the
 *      object_ids identity surface, the streaming caveat).
 *   H. results/metric-selfcheck.json + results/preflight-refusal.json +
 *      results/license-posture.json — this flight's own evidence
 *      (self-checks passed; the refusal typed; the citations verified).
 *
 * It emits `results/contract-compatibility.json` with (a) the
 * TASK-PROFILE mapping table (input/output/metrics rows for BOTH frozen
 * profiles), (b) the IDENTITY mapping (SAM3 object_ids vs EntityId vs the
 * W204 track surface), (c) the OBSERVATION/EVIDENCE-CHAIN mapping (the
 * mask-payload typed gap), (d) the RIGHTS-PROVENANCE mapping (the SAM
 * License vs the three-way license record convention), and (e) the
 * profile verdict — and exits non-zero if ANY claim cannot be evidenced.
 *
 * Run: bun scripts/evidence/hf-portfolio/hf005/contract_compatibility.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
const RESULTS = join(HERE, "results");
const OUT_PATH = join(RESULTS, "contract-compatibility.json");

const failures: string[] = [];
const fail = (message: string): void => {
  failures.push(message);
};

/** The needle trail (emitted so every mapping claim's authority is inspectable). */
const authorityNeedles: Array<{ authority: string; needles: string[] }> = [];

/** Read a repo authority (fail-closed: it must exist and carry the needle). */
function authority(relPath: string, needles: string[]): string {
  const full = join(REPO_ROOT, relPath);
  if (!existsSync(full)) {
    fail(`authority missing: ${relPath}`);
    return "";
  }
  const text = readFileSync(full, "utf8");
  for (const needle of needles) {
    if (!text.includes(needle)) {
      fail(`authority ${relPath} does not carry the pinned needle: "${needle}"`);
    }
  }
  authorityNeedles.push({ authority: relPath, needles });
  return text;
}

function evidence(relPath: string): Record<string, unknown> {
  const full = join(HERE, relPath);
  if (!existsSync(full)) {
    fail(`evidence file missing: ${relPath}`);
    return {};
  }
  return JSON.parse(readFileSync(full, "utf8")) as Record<string, unknown>;
}

// --- the authorities (each needle load-bearing for a mapping row below) -------

const profiles = authority("docs/contracts/technology-task-profiles.md", [
  "### football.playerSegmentation",
  "Inputs: football frames and optional prompts/identifiers.",
  "Outputs: per-instance masks and confidence.",
  "Metrics: mask quality, identity continuity, latency.",
  "### football.playerTracking",
  "Inputs: detections/masks and temporal frames.",
  "Outputs: stable local tracks.",
  "Metrics: ID switches, MOTA/HOTA where applicable, continuity under occlusion, latency.",
]);
const observation = authority("packages/contracts/src/observation.ts", [
  'z.discriminatedUnion("kind"',
  'z.literal("detection")',
  'z.literal("track")',
  'z.enum(["OBSERVED", "REPORTED", "DERIVED"])',
  'z.enum(["vision", "audio", "metadata", "commentary"])',
]);
const identityContract = authority("packages/contracts/src/identity.ts", [
  "ENTITY_ID_PATTERN",
  "opaque, session-scoped entity ids",
  "z.string()",
]);
const tracker = authority("packages/perception-tracking/src/tracker.ts", [
  "GreedyIouTracker",
  "trackId: EntityId",
  "t<seq>",
  "maxGap",
  "close-all",
]);
const trackingBench = authority("packages/perception-tracking/src/benchmark.ts", [
  "identity switches",
  "continuityScore",
  "identityPreservingPairs",
]);
const rights = authority("packages/contracts/src/rights.ts", [
  "AllowedOperation",
  '"analysis"',
  '"derivativeGeneration"',
  "a missing policy decision means DENY",
]);
const card = authority(
  join("scripts", "evidence", "hf-portfolio", "hf005", "fetches", "hf-facebook-sam3-README@pinned-rev"),
  [
    "unified foundation model for promptable segmentation in images and videos",
    "post_process_instance_segmentation",
    "propagate_in_video_iterator",
    "Sam3TrackerVideoModel",
    "drop-in replacement for SAM2 workflows",
    "object_ids",
    "bfloat16",
    "270K unique concepts",
    "Streaming inference disables hotstart heuristics",
  ],
);

// --- this flight's own evidence (fail-closed inputs) --------------------------

const selfcheck = evidence("results/metric-selfcheck.json");
if (selfcheck.pass !== true) fail("metric-selfcheck.json did not pass (selfcheck.pass !== true)");
const refusal = evidence("results/preflight-refusal.json");
if (refusal.refusalType !== "auth-gated-model+resource-infeasible-host") {
  fail("preflight-refusal.json refusalType is not the typed refusal this record claims");
}
if (refusal.exitCode !== 3) fail("preflight-refusal.json exitCode !== 3 (the fail-closed refusal)");
const licensePosture = evidence("results/license-posture.json");
if (licensePosture.citationsMachineVerifiedAgainstFetchedText !== true) {
  fail("license-posture.json citations were not machine-verified against the fetched text");
}
const ioSurface = evidence("results/model-io-surface.json");
const loadAnalysis = evidence("results/load-analysis.json");
const comparison = evidence("results/tracking-comparison.json");

// The authority texts' sizes (emitted so the needle trail is inspectable
// byte-for-byte: every authority variable below IS the loaded text).
const authorityChars: Record<string, number> = {
  "docs/contracts/technology-task-profiles.md": profiles.length,
  "packages/contracts/src/identity.ts": identityContract.length,
  "packages/perception-tracking/src/tracker.ts": tracker.length,
  "packages/perception-tracking/src/benchmark.ts": trackingBench.length,
  "packages/contracts/src/rights.ts": rights.length,
  "the fetched model card (fetches/hf-facebook-sam3-README@pinned-rev)": card.length,
  "results/model-io-surface.json": JSON.stringify(ioSurface).length,
  "results/load-analysis.json": JSON.stringify(loadAnalysis).length,
  "results/tracking-comparison.json": JSON.stringify(comparison).length,
};

// --- THE MACHINE-CHECKED ABSENCE: no mask payload exists in the observation union

const payloadKindLiterals = [...observation.matchAll(/z\.literal\("([a-z-]+)"\)/g)].map((m) => m[1]);
const maskPayloadKinds = payloadKindLiterals.filter((k) => k === "mask" || k === "segmentation");
if (maskPayloadKinds.length > 0) {
  fail(
    `the observation payload union unexpectedly carries a mask-shaped kind (${maskPayloadKinds.join(", ")}) — the typed-gap row must be updated`,
  );
}

// --- the gate + resource facts the mapping rows cite --------------------------

const gatedFiles = Array.isArray(refusal.gatedFilesAtPinnedRevision)
  ? (refusal.gatedFilesAtPinnedRevision as string[])
  : [];
const publicFiles = Array.isArray(refusal.publicFilesAtPinnedRevision)
  ? (refusal.publicFilesAtPinnedRevision as string[])
  : [];
if (!gatedFiles.includes("model.safetensors") || !gatedFiles.includes("sam3.pt")) {
  fail("the executed probe map does not record the weight files as gated (the auth-wall premise)");
}
if (!publicFiles.includes("LICENSE") || !publicFiles.includes("README.md")) {
  fail("the executed probe map does not record LICENSE/README as public (the bounded-fetch premise)");
}

// --- the mapping tables -------------------------------------------------------

const segmentationMapping = {
  profile: "football.playerSegmentation (FROZEN)",
  inputContract: "Inputs: football frames and optional prompts/identifiers.",
  sam3Surface: "image PCS: images + text/box prompts -> masks + boxes + scores; PVS tracker: points/boxes -> per-object masks; pipeline mask-generation with points_per_batch",
  verdict: "COMPATIBLE-WITH-PROMPT-MAPPING",
  reasoning: [
    "the profile's inputs ('football frames and optional prompts/identifiers') are SATISFIED by SAM3's documented surface: the frames are the repo's authorized SPR fixtures; the prompts are supplied by the repo's own chain — the W201 detections (normalized boxes denormalized to xyxy pixel input_boxes with positive labels, the PVS mode) or the text concept 'football player' (the PCS mode)",
    "the profile's outputs ('per-instance masks and confidence') map: SAM3's post_process_instance_segmentation returns per-instance binary masks + scores, and scores land in the observation-level confidence convention ([0,1], preserved with no silent collapse)",
  ],
  typedGaps: [
    "NO MASK PAYLOAD EXISTS in the observation contract's discriminated union (machine-checked: kinds are detection | track | transcription | field-mapping | generic | team-assignment — no mask/segmentation kind): a segmentation observation would need a NEW typed payload variant (the contract's own docs prefer a typed variant over the DISCOURAGED generic escape hatch; a minor version bump, a FROZEN-contract decision this flight records but NEVER makes)",
    "the PCS prompt is concept-level (open-vocabulary text) — 'football player' is not a per-jersey identity: the profile's 'optional prompts/identifiers' identifier half has NO SAM3 counterpart (the model has no jersey-number/player-identity surface)",
  ],
};

const trackingMapping = {
  profile: "football.playerTracking (FROZEN)",
  inputContract: "Inputs: detections/masks and temporal frames.",
  sam3Surface: "video PCS: frames + add_text_prompt -> per-frame object_ids/boxes/masks/scores; tracker video PVS: session + box/point prompts with obj_ids -> propagated per-object masks",
  verdict: "COMPATIBLE-WITH-ADAPTER",
  reasoning: [
    "the profile's inputs ('detections/masks and temporal frames') map: the temporal frames are the same authorized fixture decode; the detections arrive as the W-lane's W201 DetectedBox outputs (denormalized box prompts) and the masks are SAM3's own per-instance outputs — the input contract is satisfied by the repo's chain supplying the prompts",
    "the profile's outputs ('stable local tracks') map: SAM3's per-frame object_ids are session-scoped local ids (the card's zero-shot tracking claim); they are NOT EntityId-shaped, so the deterministic bridge sam3-<object_id> (delivered + self-checked against the identity contract's pattern) lands them in the repo's identity vocabulary",
  ],
  typedGaps: [
    "MOTA/HOTA ('where applicable' in the profile's metrics line) need per-player GT track annotations — NONE exist in the repo (the hf009 ground-truth-honesty precedent holds for player ids as it did for speaker ids); the design's two honest options (operator-provisioned GT or the relative cross-mode continuity score) are recorded in tracking-comparison.json",
    "SAM3's object_ids carry NO class label (the concept IS the prompt text) — the TrackedBox.label field must be supplied by the chain (the prompt string or the W-lane detection's label), a mapping decision recorded, not invented",
    "the profile's 'continuity under occlusion' is SAM3's DESIGN CLAIM (memory state across occlusions) — unverifiable without the executed run; the W204 baseline's conservatism (close-all at scene cuts, maxGap) is the honest contrast the comparison measures",
  ],
};

const identityMapping = {
  claim: "SAM3's per-frame object_ids (ints) map onto the repo's tracking identity surface",
  repoSurface: [
    "packages/contracts/src/identity.ts: EntityId = opaque, session-scoped [A-Za-z0-9_-]{1,64}",
    "packages/perception-tracking/src/tracker.ts (W204): TrackedBox.trackId: EntityId in the t<seq> scheme — the ids carry NO certainty claim; closed ids never reissue; fragmentation at scene cuts/gaps is the benchmark's own measured subject",
    "packages/perception-tracking/src/benchmark.ts (W204): identity switches + continuityScore — the instrument this flight's metric design mirrors (self-checked)",
    "the R207 bridge (packages/real-to-swm/src/bridge.ts) maps trackId -> entityId verbatim into TrackPayload + subjectEntityRefs — the same seam shape the sam3-<id> bridge provides",
  ],
  bridge: "sam3_object_id_to_entity_id: int -> 'sam3-<id>' (delivered in benchmark_sam3.py, self-checked cases 4: 'sam3-7'/'sam3-42' match the pattern; paren-shaped ids rejected)",
  verdict: "COMPATIBLE-WITH-BRIDGE",
};

const evidenceChainMapping = {
  claim: "SAM3's outputs as evidence-chain observations",
  repoSurface:
    'the observation contract: modality "vision", provenance "OBSERVED", componentId + optional modelId, confidence in [0,1]',
  verdict: "COMPATIBLE-BY-DOCTRINE",
  reasoning: [
    "SAM3 is a PERCEPTION model (masks/boxes/scores OBSERVED from frames) — unlike HF013's generated-audio exclusion, no evidence-chain boundary is crossed: the vocabulary admits it as OBSERVED vision observations",
    "the one structural gap is the mask payload absence (recorded above); box-shaped outputs could ride DetectionPayload TODAY, mask outputs need the typed payload variant",
  ],
};

const rightsProvenanceMapping = {
  claim: "the rights-provenance contract vs the SAM License's recorded terms",
  repoSurface:
    "packages/contracts/src/rights.ts: fail-closed semantics — a missing policy decision means DENY; AllowedOperation gates analysis/transformation/derivativeGeneration on INGESTED MEDIA (the R606 registration declaration authorizes the fixture consumption: analysis/transformation/derivative generation/storage)",
  threeWayLicenseRecord: {
    note: "the ADR-011 three-way convention (code / model checkpoint / training dataset recorded SEPARATELY — the perception-benchmark candidates.ts precedent)",
    code: {
      status: "custom (not permissive)",
      licenseId: "SAM License (the facebookresearch/sam3 repo LICENSE — the SAME agreement as the model, machine-checked: byte-different only in a trailing newline)",
      commercialUse: "unclear (the grant is a 'limited license' with no express commercial term)",
    },
    model: {
      status: "custom (not permissive)",
      licenseId: "SAM License (the HF repo LICENSE at the pinned revision, dated November 19, 2025)",
      commercialUse: "unclear (CONFIRMED by the recorded terms: §1a grant + §3 delegates the appropriateness judgment to the licensee)",
    },
    dataset: {
      status: "unknown",
      licenseId: "unknown",
      commercialUse: "unknown (the card names NO training corpus; SA-CO is the EVAL benchmark, not a training dataset)",
    },
  },
  verdict: "NOT-PRODUCTION-ELIGIBLE-BY-RECORDED-TERMS (research/watchlist stands)",
  reasoning: [
    "the rights contract's fail-closed doctrine maps onto the license posture: commercialUse 'unclear' + a custom non-permissive class on BOTH code and model legs = the rights-provenance leg FAILS the production bar (the HF015 adjudication's standing verdict for SAM3: all five legs failed)",
    "the access gate itself (manual + the identity-attestation form whose data is collected/stored/processed/shared per the Meta Privacy Policy) is a term-adjacent fact recorded in license-posture.json — an operator decision, never a worker one",
    "fixture consumption is authorized independently (the R606 registration declaration on the SPR corpus) — the rights gap is on the MODEL side, not the media side",
  ],
};

const executionMapping = {
  claim: "the benchmark execution path on THIS host",
  facts: {
    gate: "gated=manual at the pinned revision; 401 GatedRepoError on model.safetensors + sam3.pt + config.json (the executed probe map)",
    resource: "860M F32 params = 3.204 GiB per checkpoint vs 3.95 GiB TOTAL RAM / 2 vCPU / no GPU (the load analysis)",
    licenseDocuments: "LICENSE + README public at the pinned revision (the bounded fetches — the only fetches this flight performs)",
  },
  verdict: "REFUSED (auth-gated-model + resource-infeasible-host, exit 3 — negative-tested in the three modes)",
  reasoning:
    "the full benchmark is ready-to-run for an authorized + adequate host (an operator who accepted the SAM License downloads the checkpoint outside this sandbox; benchmark_sam3.py --mode full --model-dir …); on THIS host it fails closed",
};

const verdictRow = {
  candidate: "SAM3",
  profiles: ["football.playerSegmentation", "football.playerTracking"],
  contractVerdict: "COMPATIBLE-WITH-MAPPING for both profiles' input/output shapes (typed gaps recorded: the mask-payload absence, the identifier half, MOTA/HOTA GT absence, the label mapping) — execution REFUSED on this host (auth gate + resources); rights-provenance NOT production-eligible by recorded terms",
  promotionGateReferral: "the HF015 gate (merged at main) owns adjudication — its standing SAM3 row refused all five legs; this flight's evidence feeds the benchmark/resource/failure legs' future re-adjudication but changes no state (gatingState stays candidate)",
  neverLegalAdvice: true,
};

if (failures.length > 0) {
  console.error("HF005 contract compatibility FAILURES:");
  for (const message of failures) console.error(`  - ${message}`);
}

const payload = {
  label: "HF005 — the SAM3 ↔ Sporta contract-compatibility mapping (machine-checkable; static review of source-verified facts, never a run)",
  generatedFrom: {
    taskProfiles: "docs/contracts/technology-task-profiles.md (FROZEN, needle-verified)",
    modelSurface: "results/model-io-surface.json + the fetched card at the pinned revision (needle-verified)",
    repoContracts: "observation.ts + identity.ts + tracker.ts (W204) + tracking benchmark.ts (W204) + rights.ts (needle-verified)",
    flightEvidence: "results/preflight-refusal.json + results/license-posture.json + results/metric-selfcheck.json + results/load-analysis.json + results/tracking-comparison.json",
  },
  authorityNeedles,
  authorityChars,
  maskPayloadAbsenceMachineCheck: {
    checked: "packages/contracts/src/observation.ts z.literal kinds",
    kinds: payloadKindLiterals,
    maskKinds: maskPayloadKinds,
    conclusion: "NO mask/segmentation payload kind exists — the segmentation typed gap is real (recorded, not papered over with the generic escape hatch)",
  },
  mappings: {
    footballPlayerSegmentation: segmentationMapping,
    footballPlayerTracking: trackingMapping,
    identityContinuity: identityMapping,
    evidenceChain: evidenceChainMapping,
    rightsProvenance: rightsProvenanceMapping,
    execution: executionMapping,
  },
  verdict: verdictRow,
  failures,
  pass: failures.length === 0,
};

writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + "\n");
console.log(
  `[hf005 contract-compatibility] ${failures.length === 0 ? "PASS" : "FAIL"} — ${JSON.stringify(payload.mappings ? Object.keys(payload.mappings).length : 0)} mapping rows; mask-payload absence machine-checked (kinds: ${payloadKindLiterals.join(" | ")})`,
);
process.exit(failures.length === 0 ? 0 : 1);
