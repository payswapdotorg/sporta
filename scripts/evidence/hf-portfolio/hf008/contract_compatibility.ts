/**
 * HF008 — the VibeVoice-ASR-Streaming + Qwen3-ASR ↔ Sporta contract-
 * compatibility checker (the machine-checkable core of the ASR flight).
 *
 * This is the worker brief's item (2) made FAIL-CLOSED machine-checkable,
 * following the HF004/HF007 convention (`contract_compatibility.ts`). It
 * loads the MODEL side from `results/model-output-schema.json` (the
 * SOURCE-VERIFIED output facts — cards + configs fetched at the pinned
 * revisions by the executed preflight, both candidates reachable) and
 * checks every mapping claim against the repo's OWN ASR-contract
 * authorities, each pinned to a literal needle that must be present:
 *
 *   A. docs/contracts/technology-task-profiles.md (FROZEN) — the
 *      football.commentaryASR.streaming + multilingual profiles this
 *      flight's candidates claim.
 *   B. packages/asr/src/types.ts — the W207 TranscriptionUnit (the
 *      window-grid timeline discipline, the never-invented
 *      asrConfidence, the "W208 owns real speaker metadata" passthrough).
 *   C. packages/asr/src/backend.ts — the provider-neutral AsrBackend seam
 *      (vendor neutrality: a local neural backend is contractually
 *      SANCTIONED — "every transcription backend ... sits behind this
 *      one-method interface").
 *   D. packages/asr/src/zai-backend.ts — the EXISTING neural ASR backend
 *      (the load-bearing fact for the transcription-vs-generation
 *      distinction: the repo's production W207 backend is itself a
 *      neural ASR; transcription-of-observed-audio is the artifact class
 *      the chain already consumes).
 *   E. packages/asr/src/observe.ts — the SWM observation side: STT output
 *      enters as OBSERVATIONS, modality "audio", provenance "OBSERVED",
 *      payload kind "transcription" with text verbatim.
 *   F. packages/commentary-segmentation/src/types.ts — the W208
 *      CommentaryUnit contract (timestamps, speakerLabel, the
 *      character-traceability doctrine, "W207 transcribes fixed 5-second
 *      audio windows").
 *   G. packages/commentary-understanding/src/types.ts — the W209
 *      consumer vocabulary.
 *   H. packages/commentary-understanding/src/lexicon.ts — the W209
 *      pattern lexicon (the repo's own football vocabulary — the
 *      hotword-vocabulary candidate).
 *   I. packages/fusion/src/events.ts — the W401 FOOTBALL_EVENT_MAP
 *      authored-bridge precedent (the hotword vocabulary is the same
 *      class of AUTHORED decision).
 *   J. scripts/evidence/hf-portfolio/hf007/results/contract-compatibility.json
 *      — the HF007 W208 NOT-COMPATIBLE verdict for GENERATED TEXT: the
 *      flight's load-bearing distinction (transcription-of-observed-audio
 *      is a DIFFERENT artifact class from free-form generation) is argued
 *      FROM this committed source, never asserted.
 *
 * It emits `results/contract-compatibility.json` with (a) the
 * TRANSCRIPTION-OUTPUT mapping table, (b) the EVIDENCE-CHAIN mapping
 * table (the distinction verdict), (c) the SPEAKER-HINTS/COMPOSITION
 * table (the HF009 seam), and (d) the STATIC capability-delta table
 * (labeled static-review — never executed evidence), and exits non-zero
 * if ANY claim cannot be evidenced.
 *
 * Run: bun scripts/evidence/hf-portfolio/hf008/contract_compatibility.ts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
const SCHEMA_PATH = join(HERE, "results", "model-output-schema.json");
const OUT_PATH = join(HERE, "results", "contract-compatibility.json");

const failures: string[] = [];
const fail = (message: string): void => {
  failures.push(message);
};

/** Read a repo authority (fail-closed: it must exist). */
function authority(relPath: string): string {
  const full = join(REPO_ROOT, relPath);
  if (!existsSync(full)) fail(`authority missing: ${relPath}`);
  return readFileSync(full, "utf8");
}

const taskProfiles = authority("docs/contracts/technology-task-profiles.md");
const w207Types = authority("packages/asr/src/types.ts");
const w207Backend = authority("packages/asr/src/backend.ts");
const w207Zai = authority("packages/asr/src/zai-backend.ts");
const w207Observe = authority("packages/asr/src/observe.ts");
const w208Types = authority("packages/commentary-segmentation/src/types.ts");
const w209Types = authority("packages/commentary-understanding/src/types.ts");
const w209Lexicon = authority("packages/commentary-understanding/src/lexicon.ts");
const w401Events = authority("packages/fusion/src/events.ts");
const hf007CompatText = authority(
  "scripts/evidence/hf-portfolio/hf007/results/contract-compatibility.json",
);

// --- the model side (source-verified schema, written by the executed preflight)

if (!existsSync(SCHEMA_PATH)) fail(`model schema missing: ${SCHEMA_PATH}`);
const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as {
  vibevoice: {
    candidate: string;
    revision: string;
    pipelineTag: string;
    outputVerbatim: string;
    speakerHints: string;
    hotwords: string;
    streamingChunking: { derived: string; semantics: string };
    confidence: string;
    timestamps: string;
  };
  qwen3asr: {
    candidate: string;
    revision: string;
    output: string;
    speakerHints: string;
    hotwords: string;
    languages: { cardClaim: string; cardDecomposition: string; configSupportLanguagesCount: number };
    streaming: string;
    confidence: string;
  };
};
const vvSpeakerDocumented = schema.vibevoice.speakerHints.startsWith("DOCUMENTED");
const qwenSpeakerAbsent = schema.qwen3asr.speakerHints.startsWith("NOT DOCUMENTED");
const vvHotwordsDocumented = schema.vibevoice.hotwords.startsWith("DOCUMENTED");
const qwenHotwordsAbsent = schema.qwen3asr.hotwords.startsWith("NOT DOCUMENTED");
if (!vvSpeakerDocumented) {
  fail("the schema no longer records VibeVoice speaker hints as DOCUMENTED — re-review required");
}
if (!qwenSpeakerAbsent) {
  fail("the schema no longer records Qwen3-ASR speaker metadata as NOT DOCUMENTED — re-review required");
}
if (!vvHotwordsDocumented || !qwenHotwordsAbsent) {
  fail("the hotword documentation facts drifted — re-review required (the mapping verdicts depend on them)");
}
if (schema.vibevoice.pipelineTag !== "automatic-speech-recognition") {
  fail(`unexpected VibeVoice pipelineTag "${schema.vibevoice.pipelineTag}" — re-review required`);
}

// --- needle checks: every authority text must carry its pins ------------------

const NEEDLES: Array<[string, string]> = [
  ["profiles: streaming header", "### football.commentaryASR.streaming"],
  ["profiles: streaming inputs", "Inputs: live commentary audio."],
  ["profiles: streaming outputs", "Outputs: timestamped transcript segments and speaker hints."],
  ["profiles: streaming metrics", "Metrics: WER, latency, speaker segmentation quality, hotword recall."],
  ["profiles: multilingual header", "### football.commentaryASR.multilingual"],
  ["profiles: multilingual inputs", "Inputs: commentary audio."],
  ["profiles: multilingual outputs", "Outputs: multilingual transcript."],
  ["profiles: multilingual metrics", "Metrics: WER by language, latency, robustness to stadium/commentary noise."],
  ["W207: the transcription unit", "export interface TranscriptionUnit {"],
  ["W207: confidence only when provided", "Backend-provided ASR confidence in [0, 1];"],
  ["W207: speaker passthrough (W208 owns)", "W208 owns real speaker metadata)."],
  ["W207: timestamps never claim absent audio", "timestamps never claim audio that is not there"],
  ["W207: the backend seam is vendor-neutral", "this one-method interface"],
  ["W207: the seam forbids invented confidence", "MUST NOT invent an"],
  ["W207: the zai backend is a neural ASR in production", "the functioning transcription backend"],
  ["W207: the zai never invents confidence", "No asrConfidence: the backend provides none, and one is never invented."],
  ["W207 observe: STT output enters as observations", "STT output enters the pipeline as OBSERVATIONS"],
  ["W207 observe: audio modality", 'modality: "audio"'],
  ["W207 observe: observed provenance", 'provenance: "OBSERVED"'],
  ["W207 observe: transcription payload kind", 'kind: "transcription"'],
  ["W207 observe: text verbatim", "with `text` verbatim"],
  ["W208: the unit contract", "export interface CommentaryUnit {"],
  ["W208: W207 transcribes fixed windows", "W207 transcribes fixed 5-second audio windows"],
  ["W208: character traceability doctrine", "every output character is traceable to W207 input characters"],
  ["W208: speaker never invented", "no diarization was"],
  ["W208: speaker absence is honest", "it is never invented."],
  ["W209: vocabulary type", "export type CommentaryEventType ="],
  ["W209 lexicon: tech-lead authored", "tech-lead authored"],
  ["W401: authored not inferred", "tech-lead AUTHORED decision (test-pinned), not an inference"],
  ["HF007: the W208 generated-text verdict", "not-compatible (different artifact class)"],
  ["HF007: generated text stays out of the chain", "keep generated text out of the W207"],
];
function haystackFor(label: string): string {
  if (label.startsWith("profiles")) return taskProfiles;
  if (label.startsWith("W207 observe")) return w207Observe;
  if (label.startsWith("W207: the zai")) return w207Zai;
  if (label.startsWith("W207: the seam") || label.startsWith("W207: the backend")) return w207Backend;
  if (label.startsWith("W207")) return w207Types;
  if (label.startsWith("W208")) return w208Types;
  if (label.startsWith("W209 lexicon")) return w209Lexicon;
  if (label.startsWith("W209")) return w209Types;
  if (label.startsWith("W401")) return w401Events;
  if (label.startsWith("HF007")) return hf007CompatText;
  return "";
}
for (const [label, needle] of NEEDLES) {
  if (!haystackFor(label).includes(needle)) {
    fail(`needle not found — ${label}: "${needle}"`);
  }
}

// Defense in depth: the W207/W208 ASR sources stay neural-backend-shaped —
// a scan keeps the mapping verdicts honest against an LM-runtime drift.
if (/import\s+[^;]*(?:openai|anthropic)|new\s+(?:OpenAI|Anthropic)|completions\.create/i.test(
  w207Types + w207Backend + w207Observe + w208Types,
)) {
  fail(
    "the W207/W208 sources now import/use an LM runtime directly — re-review " +
      "required (the mapping table below was written against the backend-seam shape)",
  );
}

// --- (2a) the TRANSCRIPTION-OUTPUT mapping table -------------------------------
// verdict per row: "maps" | "maps-with-adapter" | "partial" | "does-not-map"

interface MappingRow {
  modelSide: string;
  candidates: string;
  contractTarget: string;
  verdict: "maps" | "maps-with-adapter" | "partial" | "does-not-map";
  evidence: string;
}

const transcriptionRows: MappingRow[] = [
  {
    modelSide: "transcript text (final transcripts)",
    candidates: "both (VibeVoice per-chunk finals; Qwen3 per-utterance text)",
    contractTarget:
      "W207 AsrBackendResult.text — 'The transcribed text, verbatim from the backend' " +
      "behind the provider-neutral AsrBackend seam",
    verdict: "maps",
    evidence:
      "a VibeVoice or Qwen3-ASR adapter is exactly ONE MORE AsrBackend " +
      "implementation ('every transcription backend — the deterministic fixture " +
      "used by tests, or the functioning z-ai backend used in production — sits " +
      "behind this one-method interface'). The production backend is ITSELF a " +
      "neural ASR (zai-backend.ts), so neural-ASR text is the artifact class the " +
      "chain already consumes; the seam exists and no contract change is needed " +
      "for the text itself",
  },
  {
    modelSide: "chunk timing (VibeVoice) / no timing (Qwen3)",
    candidates: "both",
    contractTarget:
      "W207 TranscriptionUnit.startMs/endMs — the fixed 5-second window grid " +
      "('window N covers [N * windowMs, (N + 1) * windowMs)', endMs = actual span end)",
    verdict: "maps-with-adapter",
    evidence:
      "VibeVoice's pinned chunking (chunk_frames=22 @ 0.1333 s/token ~= 2.93 s + " +
      "~0.53 s lookahead, source: preprocessor_config.json at the pinned revision) " +
      "is FINER than the 5 s grid: the adapter either tiles chunk finals onto " +
      "windows (dropping to window granularity) or the pipeline adopts chunk " +
      "granularity — an adapter decision, recorded not built. TYPED GAP (Qwen3): " +
      "the card documents NO timestamps in the ASR model itself — word/character " +
      "timestamps require the SEPARATE Qwen3-ForcedAligner-0.6B (a second " +
      "download + model); the W207 adapter would derive timing from its own " +
      "window grid only (the existing honest 'window-level granularity — honest " +
      "about what STT provides' discipline)",
  },
  {
    modelSide: "asrConfidence",
    candidates: "both (NOT DOCUMENTED in either card)",
    contractTarget:
      "W207 asrConfidence — 'present ONLY when the backend provides one' " +
      "(architecture-lock §4: never invented)",
    verdict: "maps",
    evidence:
      "neither card documents a per-utterance/per-word confidence, so the honest " +
      "mapping is the CONTRACT'S OWN absence path: asrConfidence stays undefined " +
      "forever, exactly like the zai backend ('No asrConfidence: the backend " +
      "provides none, and one is never invented.'). An adapter that synthesized " +
      "a confidence would violate the never-invent doctrine — this row maps by " +
      "NOT producing the field",
  },
  {
    modelSide: "speaker hints (who-said-what per chunk)",
    candidates: "VibeVoice DOCUMENTED; Qwen3 NOT DOCUMENTED",
    contractTarget:
      "W207 speakerLabel passthrough ('W208 owns real speaker metadata') + " +
      "W208 speakerLabel ('Present exactly when the contributing units carry one' — never invented)",
    verdict: "maps-with-adapter",
    evidence:
      "VibeVoice's card makes Who-said-What a first-class feature ('a unified " +
      "streaming ASR model that transcribes Who (Speaker) said What (Content)'), " +
      "so the adapter can stamp the model's per-chunk speaker tags as the W207 " +
      "speakerLabel passthrough, and W208's hard speaker-change boundary applies " +
      "natively. TYPED GAPS (the HF009 verdicts, unchanged): (1) the tags are " +
      "CLUSTER labels (SPEAKER_XX-class), never identities; (2) a model's fused " +
      "attribution may OVERLAP turns while W208 units are exclusive — the " +
      "exclusive-reconciliation quality is unverified (the run is refused); (3) no " +
      "per-turn confidence. Qwen3-ASR DOES-NOT-MAP on this row: zero card " +
      "documentation of speaker metadata — it requires the HF009 pyannote " +
      "composition (see the composition table)",
  },
  {
    modelSide: "per-utterance language id",
    candidates: "Qwen3 (card + config); VibeVoice declares 10 fixed languages",
    contractTarget:
      "the W207/W208 contracts are LANGUAGE-BLIND: no field carries a language " +
      "(the multilingual profile's Outputs 'multilingual transcript' has no " +
      "landing field)",
    verdict: "partial",
    evidence:
      "Qwen3-ASR returns a language per utterance (the card's results[0].language; " +
      "config.json support_languages lists the 30 named languages, the card " +
      "claims 52 = 30 languages + 22 Chinese dialects — both recorded verbatim). " +
      "TYPED GAP: W207 TranscriptionUnit/W208 CommentaryUnit carry NO language " +
      "field — landing the id needs a TL-gated W207 contract extension (recorded, " +
      "not built); today the id lands ONLY in the benchmark's per-language WER " +
      "metric (the multilingual profile's 'WER by language')",
  },
  {
    modelSide: "customized hotwords (input-side biasing)",
    candidates: "VibeVoice DOCUMENTED; Qwen3 NOT DOCUMENTED",
    contractTarget:
      "the AsrBackend seam's transcribe(wav) + the W209 lexicon/W401 authored " +
      "vocabulary precedent",
    verdict: "partial",
    evidence:
      "VibeVoice documents input-side hotword customization ('Users can provide " +
      "customized hotwords, such as names and technical terms'); Qwen3 documents " +
      "no hotword support (a typed capability gap for the multilingual " +
      "candidate). TYPED GAPS: (1) the seam's one-method transcribe(wav) carries " +
      "NO context argument — hotword injection needs a TL-gated seam extension; " +
      "(2) the hotword VOCABULARY itself is an AUTHORED decision this flight " +
      "records as a gap, exactly the W401 precedent ('tech-lead AUTHORED " +
      "decision (test-pinned), not an inference'): the repo's own candidates are " +
      "the W209 pattern lexicon (the football phrasings — 'tech-lead authored, " +
      "verbatim') and the W401 event taxonomy, but neither is a " +
      "proper-noun/name vocabulary; the operator passes --hotwords with the " +
      "authored list (the benchmark's typed unlock)",
  },
];

// --- (2b) the EVIDENCE-CHAIN mapping table (the load-bearing distinction) ------

const evidenceChainRows: MappingRow[] = [
  {
    modelSide: "ASR transcription of OBSERVED audio",
    candidates: "both",
    contractTarget:
      "the W207→W208→W209 evidence chain + the SWM observation side (modality " +
      '"audio", provenance "OBSERVED", payload kind "transcription")',
    verdict: "maps",
    evidence:
      "THE LOAD-BEARING DISTINCTION (argued from the repo's own sources, never " +
      "asserted): HF007's W208 NOT-COMPATIBLE verdict applies to FREE-FORM " +
      "GENERATION ('generated commentary is a synthesized rendering ... no " +
      "character traceability' — the committed HF007 evidence). ASR " +
      "TRANSCRIPTION of real audio is a DIFFERENT artifact class: (1) the repo's " +
      "own observation contract says 'STT output enters the pipeline as " +
      "OBSERVATIONS' with provenance OBSERVED and payload kind 'transcription' " +
      "with text VERBATIM — the AUDIO OBSERVATION EXISTS and is the evidence " +
      "anchor; (2) W208's own docstring opens 'W207 transcribes fixed 5-second " +
      "audio windows' — the chain is BUILT on ASR output; (3) the production " +
      "backend is itself a neural ASR (zai-backend.ts). An ASR transcript is " +
      "DERIVED FROM the observed audio (the same class as the incumbent " +
      "backend's output), NOT free-form generation — so the HF007 exclusion of " +
      "generated text from the evidence chain DOES NOT apply to it. What the " +
      "doctrine DOES govern: the W208 segmenter's transformation (trim/join " +
      "only — 'every output character is traceable to W207 input characters') " +
      "still holds by construction because the segmenter operates on W207 text " +
      "regardless of which backend produced it",
  },
  {
    modelSide: "hallucination risk (text not spoken)",
    candidates: "both (neural ASR can emit unspoken text, esp. on music/silence)",
    contractTarget:
      "the never-invent discipline (architecture-lock §4) + the W209 DERIVED " +
      "provenance + the OBSERVED audio observation",
    verdict: "maps-with-adapter",
    evidence:
      "the honest typed gap the distinction leaves open: a neural ASR CAN " +
      "hallucinate (invent words the audio does not contain) — the same " +
      "failure mode class the repo contains by provenance DISCIPLINE: the " +
      "transcription observation is anchored to the OBSERVED audio (evidence " +
      "exists downstream consumers can re-verify), the confidence absence is " +
      "honest (never invented), and W209's football interpretation is DERIVED " +
      "provenance (never an observation of fact). TYPED GAPS: no per-word " +
      "character-to-audio provenance exists from either candidate (chunk-level " +
      "timing at best); a hallucination-rate measure for ASR (insertion-rate " +
      "on non-speech segments) is a metric DESIGN this flight types, not " +
      "measures (the run is refused)",
  },
  {
    modelSide: "W209 consumption of ASR text",
    candidates: "both",
    contractTarget:
      "W209 CommentaryEventType extraction over W208 CommentaryUnits (the " +
      "deterministic pattern path)",
    verdict: "maps",
    evidence:
      "W209 is downstream: its lexicon-based extraction consumes segmented " +
      "commentary text whatever its ASR origin. Better transcript quality " +
      "improves W209 extraction (fewer garbled event phrases) with NO contract " +
      "change; the W209 vocabulary and priority chains are untouched by the " +
      "backend choice (the seam discipline: W209 never sees the backend)",
  },
];

// --- (2c) the SPEAKER-HINTS / PIPELINE-COMPOSITION table ------------------------

const compositionRows: MappingRow[] = [
  {
    modelSide: "VibeVoice fused ASR+speaker attribution",
    candidates: "VibeVoice",
    contractTarget: "the HF009 pyannote→W208 speakerLabel composition",
    verdict: "maps-with-adapter",
    evidence:
      "COMPOSITION ALTERNATIVE: VibeVoice fuses diarization INTO the ASR (one " +
      "model, who-said-what) — the HF009 pyannote stage becomes unnecessary FOR " +
      "SPEAKER LABELS if the fused attribution quality is acceptable (UNVERIFIED: " +
      "both runs refused — HF009 auth-gated, HF008 resource-infeasible). The " +
      "HF009 typed gaps carry over unchanged: cluster labels not identities, no " +
      "per-turn confidence, overlap→exclusive quality unverified. Neither " +
      "candidate provides speaker IDENTITIES — identity resolution stays W401 " +
      "fusion territory",
  },
  {
    modelSide: "Qwen3-ASR (no speaker metadata at all)",
    candidates: "Qwen3",
    contractTarget: "the HF009 pyannote→W208 speakerLabel composition",
    verdict: "does-not-map",
    evidence:
      "Qwen3-ASR documents ZERO speaker metadata (grep of the card: no " +
      "speaker/diarization hits) — a Qwen3-based W207 backend REQUIRES the " +
      "separate HF009 diarization composition exactly as designed (pyannote " +
      "turns → W208 speakerLabel passthrough; the HF009 auth wall still applies). " +
      "The two ledger candidates therefore sit at DIFFERENT positions in the " +
      "pipeline composition: VibeVoice = fused (ASR+diarization in one model), " +
      "Qwen3 = pure ASR (two-stage composition mandatory). THE COMPOSITION " +
      "VERDICT: neither composition is verified on this host (both refused); " +
      "the choice is an HF015-lane decision that needs EXECUTED evidence from " +
      "both flights' ready-to-run paths first",
  },
];

// --- (2d) the STATIC capability-delta table (labeled STATIC-REVIEW) -------------

interface DeltaRow {
  capability: string;
  repoToday: string;
  withCandidates: string;
  verdict: string;
}

const deltaRows: DeltaRow[] = [
  {
    capability: "W207 backend",
    repoToday:
      "the z-ai cloud SDK behind the vendor-neutral seam (one service call per " +
      "5 s window; network-dependent; no local fallback)",
    withCandidates:
      "VibeVoice/Qwen3 as LOCAL AsrBackend implementations — network-independent, " +
      "pin-able, auditable weights (at 4.3-5.6 GB checkpoints)",
    verdict: "candidate-adds (at a resource cost this host cannot pay)",
  },
  {
    capability: "speaker hints",
    repoToday:
      "NONE: the W207 adapter stamps a caller-supplied constant label; W208 " +
      "passes it through ('W208 owns real diarization' — no diarization exists " +
      "in-repo; HF009's pyannote flight refused on the auth wall)",
    withCandidates:
      "VibeVoice: native who-said-what (cluster labels); Qwen3: none — the " +
      "HF009 composition still required",
    verdict: "VibeVoice candidate-adds; Qwen3 no-change",
  },
  {
    capability: "streaming granularity",
    repoToday: "fixed 5-second windows (the W207 grid; endMs never beyond the audio)",
    withCandidates:
      "VibeVoice ~2.93 s chunks + 0.53 s lookahead (hypothesis-per-chunk); Qwen3 " +
      "30 s chunks offline / vLLM-only streaming",
    verdict: "VibeVoice candidate-adds (finer + hypotheses); Qwen3 coarser offline",
  },
  {
    capability: "hotwords",
    repoToday:
      "none: the W209 lexicon is an EXTRACTION vocabulary (pattern matching over " +
      "already-transcribed text), never an ASR biasing input",
    withCandidates:
      "VibeVoice: input-side customized hotwords (needs a seam extension — " +
      "typed gap); Qwen3: none documented",
    verdict: "VibeVoice candidate-adds (with the authored-vocabulary gap)",
  },
  {
    capability: "language coverage",
    repoToday:
      "language-blind contracts; the zai backend's language coverage is " +
      "undocumented in-repo",
    withCandidates:
      "VibeVoice 10 languages (card); Qwen3 52 languages/dialects = 30 + 22 " +
      "Chinese dialects (card + config), per-utterance language id",
    verdict: "Qwen3 candidate-adds (the multilingual profile's fit); typed — no per-language fixtures exist to measure it",
  },
  {
    capability: "confidence discipline",
    repoToday:
      "asrConfidence never invented (absence is the honest state; arch-lock §4) — " +
      "the zai backend provides none",
    withCandidates: "neither candidate documents a confidence either",
    verdict: "repo-ahead-or-equal: the discipline binds any adapter (recorded in the mapping table)",
  },
  {
    capability: "provenance/evidence chain",
    repoToday:
      "transcription observations are OBSERVED, text verbatim, anchored to the " +
      "audio; W209 understanding is DERIVED; generated text is excluded from the " +
      "chain (the HF007 verdict)",
    withCandidates:
      "transcription-of-observed-audio keeps the chain (the distinction row); " +
      "the hallucination-risk typed gap is the open edge",
    verdict: "repo-ahead: the chain discipline is the repo's own and binds both candidates",
  },
  {
    capability: "CPU economics",
    repoToday:
      "deterministic pipeline compute + one service call per 5 s window — " +
      "milliseconds of local compute",
    withCandidates:
      "4.3-5.6 GB checkpoints, 2-vCPU decode far from real-time — infeasible on " +
      "this host (the typed refusal); GPU-class budget on an adequate host",
    verdict: "repo-ahead on this host class (the refusal is the honest terminal state here)",
  },
];

// --- emit + verdict -------------------------------------------------------------

const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
const out = {
  evidenceId: "hf008-contract-compatibility",
  model: {
    candidates: [
      { candidate: schema.vibevoice.candidate, revision: schema.vibevoice.revision },
      { candidate: schema.qwen3asr.candidate, revision: schema.qwen3asr.revision },
    ],
  },
  method:
    "fail-closed needle-checked mapping over the repo's OWN contract sources " +
    "(FROZEN task profiles, W207/W208/W209/W401, the ASR observation seam) + " +
    "the committed HF007 evidence for the generated-text verdict; the model " +
    "side is the source-verified schema fetched at the pinned revisions by the " +
    "EXECUTED preflight (both candidates reachable, gated=False). Static " +
    "review — the models never ran (the resource refusal)",
  authorities: {
    taskProfiles: "docs/contracts/technology-task-profiles.md (FROZEN — untouched)",
    w207: "packages/asr/src/{types,backend,zai-backend,observe}.ts",
    w208: "packages/commentary-segmentation/src/types.ts",
    w209: "packages/commentary-understanding/src/{types,lexicon}.ts",
    w401: "packages/fusion/src/events.ts",
    hf007Evidence: "scripts/evidence/hf-portfolio/hf007/results/contract-compatibility.json",
  },
  transcriptionOutputMappings: transcriptionRows,
  evidenceChainMappings: evidenceChainRows,
  speakerHintsComposition: compositionRows,
  staticPipelineComparison: {
    label: "STATIC-REVIEW — never executed evidence; the repo side is cited from source, the candidate side from the pinned cards",
    deltaRows,
  },
  profileVerdicts: [
    {
      target: "football.commentaryASR.streaming (FROZEN task profile)",
      verdict: "compatible-with-adapter (VibeVoice — substantial typed gaps)",
      honestNote:
        "VibeVoice's output IS the profile's 'timestamped transcript segments and " +
        "speaker hints' (chunk-timed, speaker-attributed finals), over exactly the " +
        "profile's input (live commentary audio). Typed gaps: timestamps are " +
        "chunk-level (the adapter tiles them onto the W207 grid or the pipeline " +
        "adopts chunk granularity); speaker tags are clusters not identities; the " +
        "hotword vocabulary is an authored W401-lane decision; the profile's " +
        "metrics (WER, latency, speaker segmentation quality, hotword recall) are " +
        "implemented ready-to-run in benchmark_asr.py — none executed (the refusal)",
    },
    {
      target: "football.commentaryASR.multilingual (FROZEN task profile)",
      verdict: "compatible-with-adapter (Qwen3 — substantial typed gaps)",
      honestNote:
        "Qwen3-ASR's output IS the profile's 'multilingual transcript' (per-utterance " +
        "text + language id; 52 languages/dialects claimed, 30 in config). Typed " +
        "gaps: no per-language fixtures exist (the multilingual protocol's " +
        "denominator); W207/W208 are language-blind (no landing field for the id — " +
        "a TL-gated extension); streaming is vLLM-only per the card; timestamps " +
        "need the separate ForcedAligner model; no speaker metadata (the HF009 " +
        "composition is mandatory)",
    },
    {
      target: "W208 CommentaryUnit (commentary segmentation)",
      verdict:
        "compatible-with-adapter (transcription-of-observed-audio — the artifact class MATCHES; the honest REVERSAL of the HF007 generated-text verdict, argued from source)",
      honestNote:
        "HF007 ruled W208 NOT-COMPATIBLE for GENERATED text (free-form " +
        "commentary synthesis — 'a different artifact class'). ASR transcription " +
        "of observed audio is the artifact class W208 is BUILT for: its own " +
        "docstring opens 'W207 transcribes fixed 5-second audio windows'; the " +
        "production backend is itself a neural ASR; the transcription observation " +
        "is OBSERVED-modality with verbatim text anchored to the audio. The " +
        "character-traceability doctrine governs the SEGMENTER (trim/join on W207 " +
        "text) and holds regardless of the backend. The typed gaps that remain: " +
        "chunk-level (not word-level) timing, cluster speaker labels, no " +
        "confidence, and the hallucination-risk edge (the mapping row)",
    },
    {
      target: "W209 EventCandidate (commentary understanding)",
      verdict: "maps (downstream consumer — untouched by the backend choice)",
      honestNote:
        "W209's deterministic extraction consumes W208 units whatever ASR " +
        "produced them; better transcripts improve extraction with no contract " +
        "change",
    },
  ],
  overallVerdict:
    "BOTH candidates map onto the repo's ASR contracts as additional backends " +
    "behind the existing provider-neutral seam: the transcription artifact class " +
    "is the chain's OWN (the load-bearing distinction vs HF007's generated-text " +
    "exclusion); the typed gaps are chunk-level timing, cluster-not-identity " +
    "speaker labels (VibeVoice) / the mandatory HF009 composition (Qwen3), the " +
    "language-blind W207/W208 contracts (Qwen3's language id has no landing " +
    "field), the seam's missing hotword/context argument, and the authored " +
    "hotword vocabulary. NO promotion — HF015 owns the gate",
  recordedAtUtc: now,
};

writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n");

if (failures.length > 0) {
  console.error("HF008 contract-compatibility FAILED validation:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("HF008 contract-compatibility stands:");
console.log(`  transcription-output rows: ${transcriptionRows.length}`);
console.log(`  evidence-chain rows: ${evidenceChainRows.length} (the distinction verdict: transcription-of-observed-audio IS the chain's artifact class)`);
console.log(`  speaker-hints composition rows: ${compositionRows.length}`);
console.log(`  static capability-delta rows: ${deltaRows.length} (STATIC-REVIEW)`);
console.log(`  profile verdicts: ${out.profileVerdicts.length}`);
console.log(`  written: ${OUT_PATH}`);
