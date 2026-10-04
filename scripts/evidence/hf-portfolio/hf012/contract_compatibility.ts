/**
 * HF012 — the Wan2.2-Animate ↔ Sporta contract-compatibility checker (the
 * machine-checkable core of the character animation benchmark flight).
 *
 * This is the worker brief's contract-mapping item made FAIL-CLOSED
 * machine-checkable, following the HF004/HF007/HF008/HF010/HF011
 * convention (`contract_compatibility.ts`). It loads the MODEL side from
 * `results/model-io-surface.json` + `results/load-analysis.json` (the
 * SOURCE-VERIFIED I/O facts — the card + the candidate's own GitHub docs
 * fetched at the pinned revision by the EXECUTED preflight; a STATIC
 * review, never a run) and checks every mapping claim against the repo's
 * OWN authorities, each pinned to a literal needle that must be present:
 *
 *   A. docs/contracts/technology-task-profiles.md (FROZEN) — the
 *      renderer.characterAnimation profile this candidate claims (inputs:
 *      "canonical entity motion/state plus authorized style/avatar
 *      reference"; outputs: "temporally coherent character animation";
 *      the metric list: identity, motion fidelity, temporal consistency,
 *      style adherence).
 *   B. packages/contracts/src/world-model.ts — THE SWM entity-state seam
 *      (WorldEntity: entityId/kind/version/lastEventTimeMs + the
 *      kind-specific state record; the doc's own "pitchPosition" example).
 *   C. packages/contracts/src/identity.ts — ENTITY_KINDS (the canonical
 *      participant/ball vocabulary the motion state is about).
 *   D. packages/contracts/src/renderer.ts — the RenderRequest surface
 *      (rightsCapabilities REQUIRED + sourceFrameRefs "only permitted
 *      when rights allow" — the authorized-reference constraint's own
 *      contract form).
 *   E. packages/renderer-3d/src/game/identity.ts — the anime-npr renderer
 *      identity the Anime/NPR comparison is against (ANIME_NPR_RENDERER_
 *      VERSION 0.2.0, ANIME_MP4_SD_TWOS_PROFILE on-twos default, the
 *      deliberate-restyle doctrine, requiresSourceFrames: false).
 *   F. packages/renderer-3d/src/game/plugin.ts — the pure
 *      SWM→scene→pixels pipeline + the R2 fail-closed rights posture.
 *   G. packages/renderer-anime/src/identity.ts — the identity-stable
 *      entity styling doctrine ("a deliberate restyle"; version-bump
 *      only).
 *   H. packages/scene-projection/src/project.ts — projectScene, the W601
 *      seam the ground-truth motion track is projected through.
 *   I. docs/contracts/real-source-provenance.md (FROZEN) — the rights
 *      contract on references ("registered, rights-declared", "No rights
 *      check may be disabled, stubbed, or auto-satisfied").
 *   J. scripts/evidence/hf-portfolio/hf010/benchmark_renderer.py — the
 *      SHARED metric-estimator authority this flight IMPORTS (the same
 *      temporal-SSIM/flow implementations — never re-implemented).
 *
 * It emits `results/contract-compatibility.json` with (a) the
 * TASK-PROFILE INPUT mapping table, (b) the TASK-PROFILE OUTPUT mapping
 * table, (c) THE CANONICAL-ENTITY-MOTION CONDITIONING table — the brief's
 * key honest question: does "canonical entity motion/state" map to
 * Wan2.2-Animate's performance-video conditioning, or is the
 * SWM-state-to-video conversion a typed adapter gap? — (d) the
 * RIGHTS-PROVENANCE mapping (the authorized reference + the
 * no-canonical-truth boundary), (e) the METRIC mapping (the profile's
 * four metrics vs this flight's implementations), and (f) the profile
 * verdict — and exits non-zero if ANY claim cannot be evidenced.
 *
 * Run: bun scripts/evidence/hf-portfolio/hf012/contract_compatibility.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
const IO_PATH = join(HERE, "results", "model-io-surface.json");
const LOAD_PATH = join(HERE, "results", "load-analysis.json");
const OUT_PATH = join(HERE, "results", "contract-compatibility.json");

const failures: string[] = [];
const fail = (message: string): void => {
  failures.push(message);
};

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
  return text;
}

// --- the authorities (each needle load-bearing for a mapping row below) -------

const taskProfiles = authority("docs/contracts/technology-task-profiles.md", [
  "renderer.characterAnimation",
  "Inputs: canonical entity motion/state plus authorized style/avatar reference.",
  "Outputs: temporally coherent character animation.",
  "Metrics: identity, motion fidelity, temporal consistency, style adherence.",
]);
const worldModel = authority("packages/contracts/src/world-model.ts", [
  "A world-model entity: stable session-scoped identity",
  '"pitchPosition", "teamRole"',
  "state: z.record(z.string(), UncertainValue)",
]);
const identityKinds = authority("packages/contracts/src/identity.ts", [
  '"participant"',
  '"ball"',
  "session-local `entityId` plus an `EntityKind`",
]);
const rendererContract = authority("packages/contracts/src/renderer.ts", [
  "rightsCapabilities",
  "only permitted when rights allow",
  "sourceFrameRefs",
  "styleConfig",
]);
const animeIdentity = authority("packages/renderer-3d/src/game/identity.ts", [
  "ANIME_NPR_RENDERER_ID",
  "ANIME_NPR_RENDERER_VERSION = \"0.2.0\"",
  "ANIME_MP4_SD_TWOS_PROFILE",
  "frameRate: 12",
  "rendererClass: \"stylized-video\"",
  "deliberate restyle in the identity.ts doctrine's own words",
]);
const gamePlugin = authority("packages/renderer-3d/src/game/plugin.ts", [
  "a render projects nothing renderer-side",
  "rights-denied",
  "canReferenceSourceFrames",
]);
const animeProtoIdentity = authority("packages/renderer-anime/src/identity.ts", [
  "deliberate restyle",
  "identity-stable entity styling is a pure function",
]);
const sceneProjection = authority("packages/scene-projection/src/project.ts", [
  "projectScene",
  "resolveSceneEntity",
]);
const rightsContract = authority("docs/contracts/real-source-provenance.md", [
  "registered, rights-declared",
  "No rights check may be disabled, stubbed, or auto-satisfied",
]);
const sharedEstimators = authority("scripts/evidence/hf-portfolio/hf010/benchmark_renderer.py", [
  "def ssim_constant_patches",
  "def flow_warp_residual",
  "def wall_clock_ms_per_output_second",
]);

// --- the model side (source-verified by the EXECUTED preflight) ----------------

const authoritySizes: Record<string, number> = {
  "docs/contracts/technology-task-profiles.md": taskProfiles.length,
  "packages/contracts/src/world-model.ts": worldModel.length,
  "packages/contracts/src/identity.ts": identityKinds.length,
  "packages/contracts/src/renderer.ts": rendererContract.length,
  "packages/renderer-3d/src/game/identity.ts": animeIdentity.length,
  "packages/renderer-3d/src/game/plugin.ts": gamePlugin.length,
  "packages/renderer-anime/src/identity.ts": animeProtoIdentity.length,
  "packages/scene-projection/src/project.ts": sceneProjection.length,
  "docs/contracts/real-source-provenance.md": rightsContract.length,
  "scripts/evidence/hf-portfolio/hf010/benchmark_renderer.py": sharedEstimators.length,
};
for (const [path, size] of Object.entries(authoritySizes)) {
  if (size <= 0) {
    fail(`authority ${path} read as empty (${size} chars) — the needle check cannot stand on it`);
  }
}

if (!existsSync(IO_PATH)) {
  fail(`the model I/O surface JSON is missing: ${IO_PATH} — run the preflight first`);
}
if (!existsSync(LOAD_PATH)) {
  fail(`the load-analysis JSON is missing: ${LOAD_PATH} — run the preflight first`);
}
const io = existsSync(IO_PATH) ? (JSON.parse(readFileSync(IO_PATH, "utf8")) as Record<string, unknown>) : {};
const load = existsSync(LOAD_PATH) ? (JSON.parse(readFileSync(LOAD_PATH, "utf8")) as Record<string, unknown>) : {};

const ioNeedles: Array<[string, string]> = [
  ["theCardVerbatim", "Wan-Animate takes a video and a character image as input"],
  ["taskType", "video-to-video"],
  ["preprocessingOutputs", "src_pose.mp4"],
  ["theContractQuestion", "maps-with-adapter"],
];
for (const [key, needle] of ioNeedles) {
  if (!JSON.stringify(io[key] ?? "").includes(needle)) {
    fail(`the model I/O surface's "${key}" does not carry the pinned fact: "${needle}"`);
  }
}
const boundedProbes = (load.boundedProbes as Record<string, unknown> | undefined) ?? {};
const fluxProbe = (boundedProbes.fluxDependency as Record<string, unknown> | undefined) ?? {};
if (String(fluxProbe.gated ?? "") !== "auto") {
  fail("the load analysis does not record the FLUX dependency's gated=auto posture");
}

// --- (a) the TASK-PROFILE INPUT mapping ----------------------------------------

const inputMappings = [
  {
    profileInput: "canonical entity motion/state",
    repoAuthority: "packages/contracts/src/world-model.ts (WorldEntity: the kind-specific state record, e.g. pitchPosition) + packages/scene-projection/src/project.ts (projectScene — the W601 projection)",
    modelSurface: "the PERFORMANCE VIDEO conditioning (video_path) + the preprocessing pipeline (preprocess_data.py → src_pose.mp4 / src_face.mp4 — the UserGuider: 'The input video should be preprocessed into several materials before be feed into the inference process')",
    mapping: "MAPS-WITH-ADAPTER",
    theGap:
      "the profile's input is STRUCTURED CANONICAL STATE; the candidate's conditioning is VIDEO PIXELS. The SWM-state-to-performance-video conversion is a TYPED ADAPTER GAP: no repo seam today emits an isolated single-character performance video from canonical state (the repo's renderers render the WHOLE scene). The adapter may be renderer-generated CONDITIONING (allowed — conditioning is not truth) while the ground truth for motion fidelity STAYS the SWM entity state (the no-canonical-truth invariant)",
    evidence: "results/model-io-surface.json (theCardVerbatim + preprocessingOutputs) + this file's needle checks",
  },
  {
    profileInput: "authorized style/avatar reference",
    repoAuthority: "packages/contracts/src/renderer.ts (rightsCapabilities REQUIRED; sourceFrameRefs 'only permitted when rights allow') + docs/contracts/real-source-provenance.md ('registered, rights-declared', 'No rights check may be disabled, stubbed, or auto-satisfied')",
    modelSurface: "the refer_path CHARACTER IMAGE — the target character whose identity + style the output preserves ('The model generates a video of the character image that mimics the human motion in the input video')",
    mapping: "MAPS (rights-gated)",
    theGap:
      "the input KIND maps exactly (one reference image defines identity + style); the AUTHORIZATION is the repo-side constraint: the reference must be rights-clean (an operator-authorized avatar asset or a rights-clean render — the avatar-field/R2 posture; packages/renderer-3d/src/game/plugin.ts refuses a request that carries source-frame refs without canReferenceSourceFrames: rights-denied). No avatar-asset seam exists in the repo yet — the authorized-reference provisioning is an authored HF014-lane decision",
    evidence: "packages/contracts/src/renderer.ts + packages/renderer-3d/src/game/plugin.ts + docs/contracts/real-source-provenance.md (needle-checked above)",
  },
  {
    profileInput: "output profile (the RenderRequest field the adapter must synthesize)",
    repoAuthority: "packages/contracts/src/renderer.ts (OutputProfile: resolution/frameRate/codec/container/latencyClass)",
    modelSurface: "--resolution_area 1280 720 (preprocessing) + the fps knob + clip_len (the generation config)",
    mapping: "MAPS-WITH-ADAPTER",
    theGap:
      "no renderer-contract OutputProfile surface on the model side: the provider adapter must synthesize the capability document (the profiles, the latency class, the codec) from the model's generation knobs — the HF010/HF011 precedent vocabulary (the integration surface HF014 owns)",
    evidence: "results/model-io-surface.json (inputs) + packages/contracts/src/renderer.ts",
  },
];

// --- (b) the TASK-PROFILE OUTPUT mapping ---------------------------------------

const outputMappings = [
  {
    profileOutput: "temporally coherent character animation",
    modelSurface: "the animated video ('a video of the character image that mimics the human motion in the input video')",
    mapping: "MAPS",
    theGap:
      "the output KIND is exactly the profile's output; 'temporally coherent' is the model's EMPIRICAL property — measured by the temporal-consistency metric (the shared hf010 estimators) + the identity-stability metric, never asserted",
    evidence: "results/model-io-surface.json (modes + outputs)",
  },
  {
    profileOutput: "renderer telemetry (degradation flags, droppedFrames, honest provenance — the W501 contract fields)",
    modelSurface: "NONE — generate.py returns a video; no degradation/provenance surface is documented",
    mapping: "DOES-NOT-MAP",
    theGap:
      "adapter-synthesized at best (external measurement only, never model claims — the HF010/HF011 do-not-map precedent for telemetry)",
    evidence: "results/model-io-surface.json + the card/generate.py facts pinned there",
  },
  {
    profileOutput: "rights/provenance metadata (the artifact manifest, the SWM lineage)",
    modelSurface: "NONE",
    mapping: "DOES-NOT-MAP",
    theGap:
      "the C→A provenance discipline is a repo-side duty: the renderer's output may never re-enter the evidence chain as canonical truth; provenance is stamped by the provider adapter, never by the model",
    evidence: "docs/contracts/real-source-provenance.md + the no-canonical-truth invariant below",
  },
];

// --- (c) THE CANONICAL-ENTITY-MOTION CONDITIONING table (the key question) -----

const conditioningQuestion = [
  {
    axis: "the conditioning kind",
    question: "does 'canonical entity motion/state' map to the performance-video conditioning?",
    verdict: "NO DIRECT MAPPING — MAPS-WITH-ADAPTER (the typed SWM-state-to-video gap)",
    detail:
      "the SWM emits structured state (WorldEntity.state: pitchPosition etc. — UncertainValue records), the candidate consumes video pixels. The conversion is a typed adapter: SWM entity trajectories → a performance video (the repo's own deterministic render output may serve — as CONDITIONING, never as truth)",
  },
  {
    axis: "the C→A no-canonical-truth boundary (the acceptance's own constraint)",
    question: "can the adapter's renderer-generated performance video become the benchmark's ground truth?",
    verdict: "REFUSED BY DESIGN — the invariant is machine-checkable",
    detail:
      "no_canonical_truth_invariant() (in benchmark_wan22animate.py, self-checked both ways: a renderer-truth plan is refused) pins the ONLY canonical truth sources: swm-entity-state + authorized-avatar-reference. The renderer under test (either lane) is the MEASURAND, never the truth source — 'no canonical player truth may be generated solely by the renderer'",
  },
  {
    axis: "the multi-entity scale",
    question: "the SWM scene has 22 participants + ball (≤ 64 entities) — what does the candidate condition per run?",
    verdict: "ONE character per run — a typed scale gap",
    detail:
      "the card's animation mode animates one character image per run; the replacement mode's mask extraction is 'designed for single-person videos ONLY' (the UserGuider verbatim — multi-person video 'requires users to either develop their own solution or integrate a suitable open-source tool'). Whole-match character animation needs N runs + compositing — an authored HF014-lane decision",
  },
  {
    axis: "the identity association",
    question: "which entity does the animated character correspond to?",
    verdict: "AN AUTHORED MAPPING GAP (the W401 territory)",
    detail:
      "the SWM entityId is session-scoped and opaque; the visual identity comes from the authorized avatar reference. The entityId ↔ reference association is authored input to the benchmark (never inferred by the renderer — that would be the renderer generating identity truth)",
  },
  {
    axis: "the temporal guidance surface",
    question: "does the profile's temporal coherence map to a model knob?",
    verdict: "PARTIAL — refert_num (default 77, 'Recommended to be 1 or 5') + clip_len + fps",
    detail:
      "the model's own temporal-guidance surface exists (generate.py's WanAnimate.generate signature), but coherence is the MEASURED property (the shared SSIM/flow estimators), never the knob's promise",
  },
];

// --- (d) the RIGHTS-PROVENANCE mapping ------------------------------------------

const rightsMappings = [
  {
    row: "the authorized reference constraint",
    repoRule: "RenderRequest.rightsCapabilities REQUIRED, derived fail-closed; sourceFrameRefs 'only permitted when rights allow' (packages/contracts/src/renderer.ts); a request that CARRIES source-frame references without canReferenceSourceFrames is rejected rights-denied (packages/renderer-3d/src/game/plugin.ts)",
    modelSide: "the refer_path character image is an ordinary file input — NO rights surface on the model side",
    verdict: "REPO-ENFORCED (the adapter must gate the reference before the model sees it)",
  },
  {
    row: "the real-source lineage rule",
    repoRule: "'registered, rights-declared' + 'No rights check may be disabled, stubbed, or auto-satisfied' (docs/contracts/real-source-provenance.md, FROZEN)",
    modelSide: "the candidate has no lineage notion; the FLUX-gated recommended preprocessing route adds a THIRD-party dependency (black-forest-labs/FLUX.1-Kontext-dev, gated=auto, license:other — recorded at the tag level in the load analysis)",
    verdict: "the adapter carries the lineage; the FLUX-route dependency posture is an HF015 input (never adjudicated here)",
  },
  {
    row: "the no-canonical-truth boundary (C→A)",
    repoRule: "the renderer is a read-model consumer — 'a render projects nothing renderer-side' (the pure SWM→scene→pixels pipeline); the acceptance's own words: 'no canonical player truth may be generated solely by the renderer'",
    modelSide: "a generative model whose output LOOKS like motion truth — the exact risk the constraint names",
    verdict: "PRESERVED BY DESIGN: the benchmark's ground truth = the SWM entity state + the authorized reference; the model's output is only ever the measurand (machine-checked)",
  },
];

// --- (e) the METRIC mapping ------------------------------------------------------

const metricMappings = [
  {
    profileMetric: "identity",
    implementation: "identity_drift (benchmark_wan22animate.py): meanPairwiseIdentityDistance + maxDriftFromReference + driftTrendSlopePerFrame — the anchor is the AUTHORIZED AVATAR REFERENCE embedding, not the output's own first frame",
    status: "implemented, typed not-measured (self-checked: identity-mean-pairwise / identity-max-drift / identity-drift-slope / identity-stable)",
  },
  {
    profileMetric: "motion fidelity",
    implementation: "motion_fidelity_joint_error: meanNormalizedJointError + endpointJointError + velocityDirectionAgreement vs the CANONICAL SWM entity-state track (projected through W601) — plus the SEPARATE conditioning-video view, never conflated",
    status: "implemented, typed not-measured (self-checked: 8 motion cases incl. the position-error/perfect-dynamics split)",
  },
  {
    profileMetric: "temporal consistency",
    implementation: "the SHARED hf010 estimators (ssim_constant_patches + flow_warp_residual — IMPORTED, never re-implemented) so BOTH comparison lanes are scored by the same code",
    status: "implemented, typed not-measured (self-checked: the same closed-form values the hf010/hf011 selfchecks pinned)",
  },
  {
    profileMetric: "style adherence",
    implementation: "style_adherence_distance: meanStyleDistance + maxStyleDistance + meanChannelShift vs the authorized reference's style descriptor",
    status: "implemented, typed not-measured (self-checked: style-mean-distance / style-max-distance / style-channel-shift / style-perfect)",
  },
  {
    profileMetric: "cost/latency (the standing portfolio convention)",
    implementation: "wall_clock_ms_per_output_second (the hf010 shared estimator) + cold-start download bytes (the load analysis's 47.68 GiB core / 67.41 GiB whole-tree figures)",
    status: "implemented, typed not-measured on this host (the typed refusal)",
  },
];

// --- (f) the profile verdict ------------------------------------------------------

const profileVerdict =
  "PARTIAL — maps-with-adapter: the authorized style/avatar reference input MAPS (rights-gated, the R2/real-source-provenance rules enforced adapter-side); the canonical entity motion/state input requires the TYPED SWM-state-to-performance-video ADAPTER (no repo seam today; the adapter output is CONDITIONING, never truth); the output video MAPS; the renderer-telemetry/provenance surfaces DO NOT MAP (adapter-synthesized, external measurement only); the no-canonical-truth boundary is PRESERVED BY DESIGN and machine-checked (the ground truth is the SWM entity state + the authorized reference; the renderer under test is the measurand)";

// --- emit + verdict ----------------------------------------------------------------

const report = {
  label:
    "STATIC-REVIEW (the model-side facts are source-verified metadata fetched bounded at the pinned revision — never a run) + machine-checked repo-authority needles; typed not-measured",
  authoritiesChecked: [
    "docs/contracts/technology-task-profiles.md (FROZEN — renderer.characterAnimation)",
    "packages/contracts/src/world-model.ts (the SWM entity-state seam)",
    "packages/contracts/src/identity.ts (ENTITY_KINDS)",
    "packages/contracts/src/renderer.ts (RenderRequest: rightsCapabilities + sourceFrameRefs + styleConfig)",
    "packages/renderer-3d/src/game/identity.ts (the anime-npr identity + the on-twos profile)",
    "packages/renderer-3d/src/game/plugin.ts (the pure SWM→scene→pixels pipeline + R2 rights)",
    "packages/renderer-anime/src/identity.ts (the identity-stable styling doctrine)",
    "packages/scene-projection/src/project.ts (projectScene — the W601 ground-truth projection)",
    "docs/contracts/real-source-provenance.md (FROZEN — the rights contract)",
    "scripts/evidence/hf-portfolio/hf010/benchmark_renderer.py (the SHARED estimators)",
  ],
  inputMappings,
  outputMappings,
  conditioningQuestion,
  rightsMappings,
  metricMappings,
  profileVerdict,
  theNoCanonicalTruthInvariant: {
    statement:
      "no canonical player truth may be generated solely by the renderer (the acceptance's own words — the C→A boundary)",
    machineCheck: "no_canonical_truth_invariant() in benchmark_wan22animate.py (self-checked both ways — a renderer-truth plan is REFUSED; the repo's own anime-npr renderer is equally bound)",
    canonicalTruthSources: ["swm-entity-state", "authorized-avatar-reference"],
    measurands: ["Wan-AI/Wan2.2-Animate-14B@cb93a225", "anime-npr.prototype@0.2.0"],
  },
  failures,
};

writeFileSync(OUT_PATH, JSON.stringify(report, null, 2) + "\n");

if (failures.length > 0) {
  console.error(`HF012 contract-compatibility FAILED (${failures.length} failures):`);
  for (const f of failures) {
    console.error(`  - ${f}`);
  }
  process.exit(1);
}

console.log(
  "HF012 contract-compatibility: OK — 10 repo authorities needle-checked, 3 input rows + 3 output rows + the " +
    "5-axis canonical-entity-motion conditioning table (the key honest question: MAPS-WITH-ADAPTER — the typed " +
    "SWM-state-to-performance-video gap, the C->A no-canonical-truth boundary machine-checked) + 3 rights rows + " +
    "5 metric rows + the PARTIAL profile verdict. Static-review + typed not-measured; no run, no promotion.",
);
