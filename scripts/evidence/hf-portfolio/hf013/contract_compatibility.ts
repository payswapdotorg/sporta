/**
 * HF013 — the LTX-2.3 ↔ Sporta contract-compatibility checker (the
 * machine-checkable core of the joint audio-video benchmark flight).
 *
 * This is the worker brief's contract-mapping item made FAIL-CLOSED
 * machine-checkable, following the HF004/HF007/HF008/HF010/HF011/HF012
 * convention (`contract_compatibility.ts`). It loads the MODEL side from
 * `results/model-io-surface.json` + `results/load-analysis.json` (the
 * SOURCE-VERIFIED I/O facts — the card at the pinned revision + the
 * candidate's own codebase docs fetched bounded by the EXECUTED
 * preflight; a STATIC review, never a run) and checks every mapping
 * claim against the repo's OWN authorities, each pinned to a literal
 * needle that must be present:
 *
 *   A. docs/contracts/technology-task-profiles.md (FROZEN) — the THREE
 *      profiles this candidate claims (renderer.neuralVideo: "Generic
 *      neural video-generation interface for future reality
 *      candidates."; renderer.audioVideoGeneration: "Joint audio/video
 *      generation profile for future commentary/reality synthesis.";
 *      renderer.upscale: "Resolution/spatial/temporal enhancement
 *      profile." — one-line generic descriptions, NO input/output field
 *      contracts of their own; the honest mapping note).
 *   B. packages/contracts/src/observation.ts — THE provenance/modality
 *      vocabularies: ProvenanceKind OBSERVED|REPORTED|DERIVED (NO
 *      GENERATED member exists by design — the evidence-chain exclusion
 *      is vocabulary-enforced, not convention) + SourceModality
 *      vision|audio|metadata|commentary.
 *   C. packages/asr/src/observe.ts (W207) — the transcription-of-
 *      observed-audio shape (modality "audio", provenance "OBSERVED",
 *      payload kind "transcription") — the ONLY audio the evidence
 *      chain admits (the HF008 reversal of HF007).
 *   D. packages/commentary-segmentation/src/observe.ts (W208) — the
 *      DERIVED-over-observed-transcriptions shape (modality
 *      "commentary", provenance "DERIVED", payload kind
 *      "transcription").
 *   E. packages/contracts/src/rights.ts — the rights-provenance contract
 *      (AllowedOperation incl. `derivativeGeneration`; the fail-closed
 *      "A missing policy decision means DENY" doctrine).
 *   F. packages/contracts/src/media-artifact.ts — the media-platform
 *      output seam (the CLOSED four-reality vocabulary RealityKind
 *      original|tactical|three-d-game|anime-npr; container "mp4"; the
 *      codecs avc1.42E01E / mp4a.40.2; rendererId + rendererVersion).
 *   G. packages/contracts/src/renderer.ts — the OutputProfile contract
 *      (resolution/frameRate/codec/container/latencyClass +
 *      supportedOutputProfiles — the upscaling comparison's repo side).
 *   H. packages/renderer-evaluation/src/camera-bench.ts — the repo's OWN
 *      evaluation-registry row for this candidate (hf.ltx23: tasks
 *      [neuralVideo, audioVideoGeneration, upscale], license
 *      "ltx-2-community", promotion "license-and-benchmark-required").
 *   I. scripts/evidence/hf-portfolio/hf013/results/metric-selfcheck.json —
 *      the self-check that PROVED the evidence-chain exclusion's refusal
 *      direction (the generated-audio plan REFUSED; the W207 shape
 *      ACCEPTED).
 *
 * It emits `results/contract-compatibility.json` with (a) the
 * TASK-PROFILE INPUT mapping table (3 rows), (b) the TASK-PROFILE OUTPUT
 * mapping table (3 rows), (c) THE EVIDENCE-CHAIN mapping — the brief's
 * load-bearing honest question: LTX-2.3's generated commentary audio can
 * NEVER be evidence-chain audio (the HF007/HF008 transcription-vs-
 * generation boundary; W207/W208 the authorities) — carried as the
 * NOT-COMPATIBLE-BY-DOCTRINE verdict, never weakened, (d) the
 * RIGHTS-PROVENANCE mapping (the derivativeGeneration operation vs the
 * LTX-2 community-license conditional commercial terms), (e) the
 * OUTPUT-SEAM mapping (the latent upscalers vs the repo's own
 * fixed-profile MP4 pipeline), (f) the METRIC mapping (the three
 * profiles vs this flight's implementations, typed not-measured), and
 * (g) the profile verdict — and exits non-zero if ANY claim cannot be
 * evidenced.
 *
 * Run: bun scripts/evidence/hf-portfolio/hf013/contract_compatibility.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
const IO_PATH = join(HERE, "results", "model-io-surface.json");
const LOAD_PATH = join(HERE, "results", "load-analysis.json");
const SELFCHECK_PATH = join(HERE, "results", "metric-selfcheck.json");
const OUT_PATH = join(HERE, "results", "contract-compatibility.json");

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

// --- the authorities (each needle load-bearing for a mapping row below) -------

authority("docs/contracts/technology-task-profiles.md", [
  "renderer.neuralVideo",
  "renderer.audioVideoGeneration",
  "renderer.upscale",
  "Generic neural video-generation interface for future reality candidates.",
  "Joint audio/video generation profile for future commentary/reality synthesis.",
  "Resolution/spatial/temporal enhancement profile.",
]);
const observationContract = authority("packages/contracts/src/observation.ts", [
  'z.enum(["OBSERVED", "REPORTED", "DERIVED"])',
  'z.enum(["vision", "audio", "metadata", "commentary"])',
]);
// the vocabulary-enforced exclusion: no GENERATED provenance member exists
if (observationContract.includes('"GENERATED"')) {
  fail("the ProvenanceKind vocabulary unexpectedly carries a GENERATED member — the evidence-chain exclusion argument would change");
}
authority("packages/asr/src/observe.ts", [
  'modality: "audio"',
  'provenance: "OBSERVED"',
  'kind: "transcription"',
  "with `text` verbatim",
]);
authority("packages/commentary-segmentation/src/observe.ts", [
  'modality: "commentary"',
  'provenance: "DERIVED"',
  "asrConfidence",
  "transcription",
]);
authority("packages/contracts/src/rights.ts", [
  '"derivativeGeneration"',
  "a missing policy decision means DENY",
  "canReferenceSourceFrames",
]);
authority("packages/contracts/src/media-artifact.ts", [
  'z.enum(["original", "tactical", "three-d-game", "anime-npr"])',
  '"mp4"',
  "avc1.42E01E",
  "rendererId",
  "no renderer silently invents",
]);
authority("packages/contracts/src/renderer.ts", [
  "outputProfile",
  "supportedOutputProfiles",
  "latencyClass",
  "rightsCapabilities",
]);
authority("packages/renderer-evaluation/src/camera-bench.ts", [
  "hf.ltx23",
  "ltx-2-community",
  "license-and-benchmark-required",
]);

// --- the model side (the source-verified I/O surface + the load analysis) -----

if (!existsSync(IO_PATH)) {
  fail(`the model I/O surface JSON is missing (run --mode preflight first): ${IO_PATH}`);
}
if (!existsSync(LOAD_PATH)) {
  fail(`the load analysis JSON is missing (run --mode preflight first): ${LOAD_PATH}`);
}
const ioSurface = existsSync(IO_PATH)
  ? (JSON.parse(readFileSync(IO_PATH, "utf8")) as {
      inputModalities?: { conditioning?: string[]; "NOT offered"?: string[] };
      outputModalities?: { video?: string; audio?: string; latentUpscalers?: string[] };
      documentedRecipeSurface?: Record<string, string>;
      cardLimitationsVerbatim?: string[];
    })
  : {};
const loadAnalysis = existsSync(LOAD_PATH)
  ? (JSON.parse(readFileSync(LOAD_PATH, "utf8")) as {
      composition?: { candidateCarriesOnlyTransformersAndUpscalers?: boolean; members?: Array<{ member: string; note: string }> };
      arithmetic?: { verdict?: string };
    })
  : {};

// the model side must carry the joint audio-video generation surface
const conditioning = ioSurface.inputModalities?.conditioning ?? [];
const notOffered = ioSurface.inputModalities?.["NOT offered"] ?? [];
for (const needle of ["text (prompt", "image (i2v", "video (v2v", "audio (a2v"]) {
  if (!conditioning.some((c) => c.includes(needle))) {
    fail(`the model I/O surface does not record the conditioning surface: "${needle}"`);
  }
}
if (!notOffered.some((n) => n.includes("camera path"))) {
  fail("the model I/O surface must record the typed gap: NO camera-path conditioning surface (the HF010 vocabulary has no LTX-2.3 surface)");
}
if (!String(ioSurface.outputModalities?.audio ?? "").includes("synchronized audio")) {
  fail("the model I/O surface does not record the synchronized-audio output (the joint audio-video generation surface this candidate exists for)");
}
if (loadAnalysis.composition?.candidateCarriesOnlyTransformersAndUpscalers !== true) {
  fail("the load analysis does not pin the composition fact: the LTX-2.3 repo carries ONLY transformers + latent upscalers");
}

// --- the self-check's exclusion proof (the machine check ran + passed) --------

if (!existsSync(SELFCHECK_PATH)) {
  fail(`the metric self-check JSON is missing (run --mode selfcheck first): ${SELFCHECK_PATH}`);
}
const selfcheck = existsSync(SELFCHECK_PATH)
  ? (JSON.parse(readFileSync(SELFCHECK_PATH, "utf8")) as {
      failures?: number;
      theEvidenceChainExclusionVerdict?: {
        statement?: string;
        machineCheck?: string;
        refusalDirectionProven?: boolean;
        acceptedShapes?: string[];
        refusedShapes?: string[];
      };
    })
  : {};
if ((selfcheck.failures ?? 1) !== 0) {
  fail("the metric self-check recorded failures — the exclusion proof does not stand");
}
const exclusion = selfcheck.theEvidenceChainExclusionVerdict;
if (!exclusion?.statement?.includes("NEVER be evidence-chain audio")) {
  fail("the self-check's evidence-chain exclusion statement must carry the NEVER-be-evidence-chain-audio verdict");
}
if (exclusion?.refusalDirectionProven !== true) {
  fail("the self-check must prove the exclusion's REFUSAL direction (the generated-audio plan refused)");
}

// --- (a) the TASK-PROFILE INPUT mapping table ----------------------------------

const inputMappings = [
  {
    profile: "renderer.neuralVideo",
    profileContract: "Generic neural video-generation interface for future reality candidates. (a one-line generic description — the profile declares NO input field contract of its own; the honest note)",
    candidateSurface: "text/image/video/audio conditioning (the card's own tag list: text-to-video, image-to-video, video-to-video, image-text-to-video, audio-to-video)",
    verdict: "MAPS-WITH-ADAPTER",
    adapter: "the SWM-snapshot/events → prompt + reference-image adapter (the W601 projection + an authorized source frame where rights allow canReferenceSourceFrames); the adapter is AUTHORED, never assumed",
    typedGaps: [
      "NO camera-path conditioning surface (the HF010 camera-path vocabulary has no LTX-2.3 input — a dolly/pan window cannot be commanded; typed gap, never a silent zero)",
      "the profile is generic by design — no input field contract exists to machine-check against; the mapping is at the capability-class level only",
    ],
  },
  {
    profile: "renderer.audioVideoGeneration",
    profileContract: "Joint audio/video generation profile for future commentary/reality synthesis. (one-line generic description — no input field contract of its own)",
    candidateSurface: "the JOINT audio-video generation surface itself: synchronized video AND audio from a single DiT (the card's own first paragraph + the text-to-audio-video / image-to-audio-video / image-text-to-audio-video tags)",
    verdict: "MAPS-WITH-ADAPTER",
    adapter: "commentary text → the prompt/speech-conditioned generation path (the card documents speech generation with lip-synced video; the conditioning commentary text is an INPUT, never evidence)",
    typedGaps: [
      "the generated commentary AUDIO output can NEVER enter the observation evidence chain (the exclusion verdict below — NOT-COMPATIBLE-BY-DOCTRINE)",
      "the repo has NO observation-world conditioning surface for audio today (W207/W208 are transcription-side, not generation-side) — the generation-conditioning adapter is future work with the evidence-chain boundary pre-declared",
    ],
  },
  {
    profile: "renderer.upscale",
    profileContract: "Resolution/spatial/temporal enhancement profile. (one-line generic description — no input field contract of its own)",
    candidateSurface: "latent upscalers: ltx-2.3-spatial-upscaler-x1.5/x2 (higher resolution) + ltx-2.3-temporal-upscaler-x2 (higher FPS) — 'upscaler for the ltx-2.3 latents, used in multi stage (multiscale) pipelines' (the card's own table)",
    verdict: "MAPS-WITH-ADAPTER",
    adapter: "the TWO-STAGE design: the repo's own authorized output artifact → image/video conditioning into the LTX-2.3 pipeline → the upscaler stages — which is generation-conditioned-on-the-source, NOT pure pixel-domain upscaling",
    typedGaps: [
      "the upscalers are LATENT-domain stages of LTX-2.3's own pipeline — there is NO documented path that upscales a foreign MP4 directly; the pixel-domain reading of renderer.upscale has NO direct candidate surface",
      "the repo's 25 fps profiles are not frame-count-divisible-by-8+1 compatible (the card's own rule) — the pad-and-crop workaround is an adapter obligation, recorded never silently ignored",
      "the no-lying constraint (upscaling must not invent content) is policed by metrics, not by the candidate's contract — the risk is intrinsic to a generative upscaler",
    ],
  },
];

// --- (b) the TASK-PROFILE OUTPUT mapping table ---------------------------------

const outputMappings = [
  {
    profile: "renderer.neuralVideo",
    candidateOutput: "video (mp4 via ltx-pipelines output I/O; width/height divisible by 32, frame count divisible by 8+1)",
    repoOutputContract: "RenderResult/RealityOutput (rendererId + rendererVersion + container/codecs + integrity-verifiable record)",
    verdict: "MAPS-WITH-ADAPTER",
    adapter: "a rendererId/rendererVersion wrapper module must declare the OutputProfile + emit the artifact record; determinism is NOT byte-identical by contract (seeded stochastic generation vs the repo's frozen-argv deterministic encodes — an honest capability difference, recorded in the upscaling comparison)",
  },
  {
    profile: "renderer.audioVideoGeneration",
    candidateOutput: "synchronized video + audio (joint generation; the card's own limitation: 'When generating audio without speech, the audio may be of lower quality')",
    repoOutputContract: "the RealityOutput artifact record supports audio codecs (mp4a.40.2 named in the contract's own example) — BUT the observation evidence chain admits ONLY transcription-of-observed-audio",
    verdict: "PARTIAL — the artifact output maps-with-adapter; the EVIDENCE output does not map",
    typedGaps: [
      "generated commentary audio → the observation chain: NOT-COMPATIBLE-BY-DOCTRINE (the exclusion verdict below — this is the load-bearing boundary this flight carries)",
      "the generated audio as a RENDER PRODUCT (a media artifact behind the rights contract) is a different question from evidence — the artifact lane maps, the evidence lane does not",
    ],
  },
  {
    profile: "renderer.upscale",
    candidateOutput: "higher-resolution / higher-FPS latents decoded to video (the multiscale pipeline's output stage)",
    repoOutputContract: "the repo's OutputProfile list (640x360/1280x720 at 12/12.5/25 fps) + the 1 000 000-byte hosted artifact budget (fail-closed)",
    verdict: "MAPS-WITH-ADAPTER",
    adapter: "the upscaled output must fit a declared OutputProfile and the hosted artifact budget — the ltx-pipelines-documented 4K/UHD defaults exceed the repo budget by orders of magnitude (a typed gap, never silently ignored)",
    typedGaps: [
      "no RealityOutput-shaped metadata from ltx-pipelines (the wrapper must synthesize the artifact record)",
      "the budget constraint makes the repo-side integration an SD/HD-class question only — the upscaler's headline 4K capability is outside the repo's own budget envelope",
    ],
  },
];

// --- (c) THE EVIDENCE-CHAIN mapping (the load-bearing verdict) ------------------

const evidenceChainMapping = {
  question: "can LTX-2.3's joint audio-video GENERATION output enter the observation evidence chain as commentary evidence?",
  verdict: "NOT-COMPATIBLE-BY-DOCTRINE (for the evidence lane)",
  statement:
    "generated commentary audio can NEVER be evidence-chain audio: HF007 ruled free-form GENERATED text not compatible with the observation evidence chain; HF008 reversed that ONLY for transcription-of-observed-audio (W207's own shape: modality 'audio', provenance 'OBSERVED', payload kind 'transcription', text verbatim; W208 derives over it). LTX-2.3's generated audio inherits the boundary exactly.",
  authorities: [
    "packages/contracts/src/observation.ts — ProvenanceKind OBSERVED|REPORTED|DERIVED: NO GENERATED member exists in the vocabulary (the exclusion is vocabulary-enforced, machine-checked above)",
    "packages/asr/src/observe.ts (W207) — the only admitted audio shape: modality 'audio', provenance 'OBSERVED', payload kind 'transcription'",
    "packages/commentary-segmentation/src/observe.ts (W208) — DERIVED over observed transcriptions only",
    "scripts/evidence/hf-portfolio/hf007 + hf008 — the transcription-vs-generation distinction (the precedent)",
  ],
  machineCheck: "generated_audio_evidence_exclusion (benchmark_ltx23.py — self-checked BOTH directions: the generated-audio plan REFUSED with the violation named; the W207 transcription shape ACCEPTED; unknown shapes REFUSED fail-closed)",
  whatGeneratedAudioRemains: [
    "a MEASURAND (the benchmark scores the generated audio's sync/hallucination/adherence quality — never its evidentiary fitness, which is settled)",
    "a RENDER PRODUCT behind the rights contract (derivativeGeneration must be explicitly allowed by a currently-valid AuthorizationPolicy — the fail-closed rights doctrine)",
  ],
};

// --- (d) the RIGHTS-PROVENANCE mapping -------------------------------------------

const rightsMappings = [
  {
    axis: "the operation class",
    repoContract: "AllowedOperation derivativeGeneration (+ transformation for source-referencing upscale conditioning); RightsCapabilities derived fail-closed (canStoreDerivatives needs BOTH derivativeGeneration and storage allowed)",
    candidateSide: "LTX-2.3's joint generation and its Derivatives clause ('Derivatives of LTX-2' covers fine-tuned/adapted weights, derivative architectures, extended Complementary Materials)",
    verdict: "MAPS-WITH-ADAPTER — a valid policy that allows derivativeGeneration is REQUIRED before any candidate run against the repo's authorized artifacts; the license's own Derivatives definition covers the candidate's outputs",
  },
  {
    axis: "commercial-use terms",
    repoContract: "no license assumption anywhere ('the model card must be re-read at registration time; no assumption of permissiveness' — the evaluation registry's own note for hf.ltx23; promotion license-and-benchmark-required)",
    candidateSide: "the LTX-2 community-license terms (recorded verbatim in results/license-posture.json): sub-$10M-revenue entities get the community license 'for any purpose' subject to Attachment A; >= $10M 'Commercial Entities' must obtain a paid Commercial Use Agreement; the governing agreement for THIS pinned snapshot is ambiguous among the card's own sources (LICENSE-2 vs LICENSE-2_x)",
    verdict: "RESEARCH-GRADE / WATCHLIST-PENDING-TERMS — the ledger's commercialUse 'unclear' stands (argued from recorded terms only; never legal advice; HF015 owns adjudication)",
  },
  {
    axis: "provenance of the weights/data",
    repoContract: "the provenance-ledger discipline (modelLicense/codeLicense/weightsProvenance/datasetProvenance per row, echoed verbatim in the benchmark record)",
    candidateSide: "weightsProvenance: Lightricks' own LTX-2.3 update; datasetProvenance: unknown; codeLicense: unknown (probed: GitHub NOASSERTION — the repo root carries only the model community-license documents)",
    verdict: "PARTIAL — weights provenance recorded; dataset + code license remain open edges (typed, never silently resolved)",
  },
];

// --- (e) the OUTPUT-SEAM mapping (the latent upscalers vs the repo pipeline) ------

const outputSeamMapping = {
  question: "what do LTX-2.3's spatial/temporal upscalers add over the repo's own four-output MP4 pipeline?",
  label: "STATIC-REVIEW (the repo surfaces cited from the repo's own sources; no model ran)",
  repoToday: {
    fourOutputPipeline: "RealityKind original|tactical|three-d-game|anime-npr (a CLOSED vocabulary); container mp4; codecs avc1.42E01E/mp4a.40.2; rendererId+rendererVersion per artifact",
    outputProfiles: "tactical 640x360@12.5 + 1280x720@25; game-3d 640x360@25 + 1280x720@25; anime-npr DEFAULT 640x360@12 'on twos' (the J013 budget resolution) with SD@25/HD@25 still supported",
    normalizationChain: "R102 MediaManifest: the canonical encoding (NormalizedVideoStream codec/width/height/fps, sha-256) — the pipeline NORMALIZES to canonical form, it never ENHANCES",
    upscalingToday: "NONE — no super-resolution/interpolation/enhancement stage exists anywhere in the repo (resolutions are chosen at render time from the fixed OutputProfile list, never derived from an existing artifact)",
  },
  ltx23WouldAdd: "latent-space x1.5/x2 spatial + x2 temporal upscaling INSIDE its own multiscale generation pipeline; the repo's artifacts are pixel-domain MP4s, so the mapping is the two-stage re-conditioning design (generation-conditioned-on-the-source), policed by the no-lying metrics",
  fullComparison: "results/upscaling-pipeline-comparison.json (the 8-axis capability-delta table + the adequate-host comparison design with the repo's OWN authorized output artifacts as source inputs — never new content)",
};

// --- (f) the METRIC mapping (typed not-measured) -----------------------------------

const metricMappings = [
  {
    profile: "renderer.audioVideoGeneration",
    metrics: [
      { name: "av_onset_sync_error_ms", definition: "mean |t_visual_event − t_audio_onset| over matched pairs (ms)", implementation: "benchmark_ltx23.py", status: "implemented, typed not-measured (self-check case av-onset-sync-basic)" },
      { name: "av_cross_correlation_peak_lag_ms", definition: "the lag at peak normalized cross-correlation of the audio envelope vs visual motion energy (ms; audio-positive = audio lags)", implementation: "benchmark_ltx23.py", status: "implemented, typed not-measured (case av-xcorr-lag-2-hops)" },
      { name: "commentary_wer", definition: "word error rate of the generated speech (W207-compatible STT) vs the CONDITIONING commentary text — adherence, NEVER evidence", implementation: "benchmark_ltx23.py", status: "implemented, typed not-measured (case commentary-wer-substitution)" },
      { name: "audio_hallucination_rate", definition: "fraction of generated audio events with no authorized event within the tolerance window (the audio counterpart of hf010's video metric)", implementation: "benchmark_ltx23.py", status: "implemented, typed not-measured (case audio-hallucination-1-of-3)" },
      { name: "hallucinated_region_rate (video)", definition: "the SHARED hf010 estimator — imported, never re-implemented", implementation: "IMPORTED from hf010/benchmark_renderer.py", status: "implemented, typed not-measured (case shared-hallucination-hand)" },
    ],
  },
  {
    profile: "renderer.neuralVideo",
    metrics: [
      { name: "reference_frame_fidelity (mse/psnrDb)", definition: "the generated first frame vs the conditioning image (luma RMSE + PSNR closed form)", implementation: "benchmark_ltx23.py", status: "implemented, typed not-measured (case reference-fidelity-psnr)" },
      { name: "meanConsecutiveSsim", definition: "the SHARED hf010 temporal SSIM (the 8x8 mean-filter path; the constant-patch closed form self-checked)", implementation: "IMPORTED from hf010/benchmark_renderer.py", status: "implemented, typed not-measured (case shared-ssim-hand)" },
      { name: "flowWarpResidual", definition: "the SHARED hf010 flow-warp residual (temporal consistency)", implementation: "IMPORTED from hf010/benchmark_renderer.py", status: "implemented, typed not-measured (case shared-flow-residual-zero)" },
      { name: "player_identity_stability", definition: "the SHARED hf010 identity-stability estimator (player/ball identity)", implementation: "IMPORTED from hf010/benchmark_renderer.py", status: "implemented, typed not-measured (case shared-identity-hand)" },
      { name: "wall_clock_ms_per_output_second", definition: "the SHARED hf010 cost estimator", implementation: "IMPORTED from hf010/benchmark_renderer.py", status: "implemented, typed not-measured (case shared-cost-hand)" },
      { name: "camera-path adherence", definition: "NOT APPLICABLE — LTX-2.3 has no camera-path conditioning surface (the typed gap, recorded never zero-filled)", implementation: "N/A (typed)", status: "not-measured-typed-na" },
    ],
  },
  {
    profile: "renderer.upscale",
    metrics: [
      { name: "roundtrip_fidelity (mse/psnrDb/ssimConstantPatches)", definition: "THE NO-LYING CORE: the upscaled output brought back to source geometry (area-average) vs the SOURCE — invented content fails here even if it looks sharp", implementation: "benchmark_ltx23.py", status: "implemented, typed not-measured (cases roundtrip-identity-mse/roundtrip-shift-ssim)" },
      { name: "no_invented_content_rate", definition: "fraction of source-aligned patches whose roundtrip deviation exceeds the resampling tolerance (the tolerance pinned to the bilinear control's worst deviation — never a free parameter)", implementation: "benchmark_ltx23.py", status: "implemented, typed not-measured (case no-invented-content-2-of-4)" },
      { name: "detail_preservation_gain", definition: "the Laplacian-energy ratio (candidate − source)/(baseline − source) — detail gain reported SEPARATELY from fidelity so sharpness can never masquerade as faithfulness", implementation: "benchmark_ltx23.py", status: "implemented, typed not-measured (cases detail-gain-2x/high-freq-energy-edge)" },
      { name: "temporal_upscale_motion_coherence", definition: "the interpolated frames' flow-warp residual (the SHARED hf010 estimator) normalized by source motion magnitude — a static scene is not rewarded for zero motion", implementation: "benchmark_ltx23.py (shared estimator imported)", status: "implemented, typed not-measured (case temporal-coherence-half)" },
      { name: "artifact_block_boundary_rate", definition: "fraction of patch boundaries whose discontinuity exceeds the source's own natural worst case (blocking/ringing)", implementation: "benchmark_ltx23.py", status: "implemented, typed not-measured (case artifact-rate-1-of-3)" },
    ],
  },
];

// --- verdict -----------------------------------------------------------------------

const profileVerdict =
  "PARTIAL: all three profiles MAP-WITH-ADAPTER at the capability-class level (the joint audio-video generation surface exists; the latent upscalers exist; the generic neural-video interface exists), " +
  "but (1) the compute leg is RESOURCE-INFEASIBLE on this host (the typed refusal — zero executed measurements), (2) the generated commentary audio output is NOT-COMPATIBLE-BY-DOCTRINE with the " +
  "observation evidence chain (the W207/W208 boundary, machine-checked, never weakened), (3) the rights/commercial-use posture is research-grade/watchlist-pending-terms (the governing agreement " +
  "ambiguous among the candidate's own sources; codeLicense + datasetProvenance unknown), and (4) the renderer.upscale pixel-domain reading has no direct candidate surface (the latent-domain " +
  "two-stage design is the only honest mapping). HF015 owns adjudication; gatingState stays candidate.";

// --- emit ---------------------------------------------------------------------------

const document = {
  label: "STATIC-REVIEW — LTX-2.3's documented I/O surface vs the THREE frozen profiles + the W207/W208 evidence-chain contracts + the rights-provenance contract + the media-platform output seams (machine-checked against the repo's own authorities; no model ran)",
  authoritiesChecked: 9,
  authorityNeedles,
  inputMappings,
  outputMappings,
  theEvidenceChainExclusion: evidenceChainMapping,
  rightsMappings,
  outputSeamMapping,
  metricMappings,
  profileVerdict,
  failures,
};

writeFileSync(OUT_PATH, JSON.stringify(document, null, 2) + "\n", "utf8");

if (failures.length > 0) {
  console.error(`HF013 contract_compatibility FAILED (${failures.length} failures):`);
  for (const f of failures) {
    console.error(`  - ${f}`);
  }
  process.exit(1);
}

console.log(
  "HF013 contract_compatibility: OK — 9 authorities needle-checked (the 3 FROZEN profiles; the ProvenanceKind vocabulary " +
    "carrying NO GENERATED member; W207's transcription-of-observed-audio shape; W208's DERIVED-over-observed shape; the " +
    "fail-closed rights contract; the CLOSED four-reality output vocabulary + the mp4/avc1.42E01E seam; the OutputProfile " +
    "contract; the repo's own hf.ltx23 evaluation-registry row; the self-check's exclusion proof), 3 input rows + 3 output " +
    "rows + THE evidence-chain exclusion verdict (generated commentary audio NEVER evidence-chain audio — NOT-COMPATIBLE-" +
    "BY-DOCTRINE, machine-checked both directions) + the rights/commmercial-use posture (research-grade/watchlist-pending-" +
    "terms) + the output-seam (latent upscalers vs the repo's fixed-profile MP4 pipeline) + the metric mapping (typed " +
    "not-measured). Profile verdict: PARTIAL. No promotion — HF015 owns adjudication.",
);
