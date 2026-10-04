===== 64-f REPORT BEGIN =====

# Worker 64-f delivery — HF008: the streaming commentary ASR portfolio benchmark evidence

## Manifest

- Branch: `work/hf008-asr-portfolio-benchmark` (from main @ aca8280; never pushed)
- Commit: `rel(64-f): HF008 — the ASR portfolio benchmark evidence (CPU-host, fixtures + metric designs + typed refusal)`
- Work item: HF008 (docs/work-items/hf-model-portfolio-work-items.md)
- Task profiles: `football.commentaryASR.streaming` + `football.commentaryASR.multilingual`
  (docs/contracts/technology-task-profiles.md, FROZEN — untouched)
- Evidence tree (all committed in-repo):
  - `scripts/evidence/hf-portfolio/hf008/benchmark_asr.py` — the benchmark script (preflight EXECUTED on this host: the typed refusal, exit 3; selfcheck EXECUTED, 10/10; FULL mode ready-to-run on an adequate host with the WER/latency/hotword/multilingual metric implementations)
  - `scripts/evidence/hf-portfolio/hf008/contract_compatibility.ts` — the machine-checked transcription-output + evidence-chain + speaker-composition mappings + the STATIC pipeline-delta table (EXECUTED, exit 0, 31 needles verified)
  - `scripts/evidence/hf-portfolio/hf008/record-benchmark.ts` — the fail-closed validator (EXECUTED, exit 0; negative-tested: fabricated wer + firstChunkLatencyMs refused with exit 1)
  - `scripts/evidence/hf-portfolio/hf008/benchmark-record.json` — the ledger-shaped HF008 record (BOTH candidate rows echoed VERBATIM + the typed refusal + the partial)
  - `scripts/evidence/hf-portfolio/hf008/summary.md` — the markdown summary
  - `scripts/evidence/hf-portfolio/hf008/results/preflight-refusal.json` — the EXECUTED preflight: the resource arithmetic, both bounded hub probes, the fixture sha verification, the ground-truth search, the typed refusal (8 reasons)
  - `scripts/evidence/hf-portfolio/hf008/results/load-analysis.json` — both candidates' file trees at the pinned revisions (sizes + LFS sha256s per shard), the bounded small-file fetch map, the resource arithmetic
  - `scripts/evidence/hf-portfolio/hf008/results/model-output-schema.json` — the source-verified output facts (cards + configs fetched at the pinned revisions)
  - `scripts/evidence/hf-portfolio/hf008/results/audio-fixtures.json` — the staged audio story (the HF009 record, re-verified this flight)
  - `scripts/evidence/hf-portfolio/hf008/results/metric-selfcheck.json` — the EXECUTED metric implementation self-verification (10/10; labeled implementation evidence, NOT a model measurement)
  - `scripts/evidence/hf-portfolio/hf008/results/contract-compatibility.json` — the emitted mapping tables + capability delta
- Not committed (by design): the model weights (never downloaded — the resource refusal; the probes were bounded to file trees + small config/card fetches), the python venv (/home/z/hf-bench-6 — a NEW lean venv; no earlier flight's reused).
- FROZEN contracts untouched; provenance-ledger.json untouched; architecture-lock untouched.
- Guard batteries green: packages/testing hf-ledger.test.ts 8/8;
  packages/perception-benchmark harness.test.ts (the L010 battery) 8/8.

=== HF008 BENCHMARK REPORT ===

## THE HONEST HEADLINE — both candidates resource-refused: a typed refusal + a substantial partial

This flight covers BOTH HF008 ledger candidates (the work item names
both; each ledger row echoed VERBATIM into the record):

1. `microsoft/VibeVoice-ASR-Streaming-1.5B` @ revision
   `4262d23d8a539a6530cf64fbd0b1751ef9a30853` (MIT/MIT,
   weightsProvenance unknown, datasetProvenance unknown, commercialUse
   yes, gatingState candidate — task profile `football.commentaryASR.streaming`)
2. `Qwen/Qwen3-ASR-1.7B` @ revision
   `7278e1e70fe206f11671096ffdd38061171dd6e5` (apache-2.0/apache-2.0,
   "large-scale speech training data on the Qwen3-Omni foundation model,
   per card (1.7B and 0.6B family; 52 languages/dialects)",
   datasetProvenance unknown, commercialUse yes, gatingState candidate —
   task profile `football.commentaryASR.multilingual`)

The preflight arithmetic ran FIRST (per the brief). BOTH candidates are
reachable anonymously at their pinned revisions (gated=False — no
HF009-style auth wall this flight); the wall is pure resources:

| Constraint | VibeVoice-ASR-Streaming-1.5B | Qwen3-ASR-1.7B | Host | Verdict |
|---|---|---|---|---|
| Checkpoint (pinned shards) | 5,628,388,290 B fp32 (3 shards) | 4,698,521,512 B bf16 (2 shards) | — | — |
| Working set (stored dtype) | 5.24 GiB fp32 | 4.38 GiB bf16 | 3.95 GiB TOTAL RAM | infeasible — 1.33x / 1.11x over TOTAL |
| Working set (cast) | 2.62 GiB bf16 | 8.75 GiB fp32 | ~1.85 GiB AVAILABLE | infeasible — both over AVAILABLE before any activation |
| Download vs free disk | 5.24 GiB | 4.38 GiB | ~1.08 GiB free | infeasible — 4.85x / 4.05x over |
| GPU | needed for the streaming regime | recommended | none (N/A) | CPU-only, 2 vCPU — decode far from real time |

`benchmark_asr.py --mode preflight` was EXECUTED (exit code 3, the typed
refusal `resource-infeasible-host` with 8 reasons covering both
candidates, `results/preflight-refusal.json`; the weights were never
downloaded — bounded probes only). Per the worker brief, the honest
delivery is the refusal + the partial. **No quality, latency, or memory
number exists in this flight — none is fabricated to stand in.** The
fail-closed validator is negative-tested (a fabricated `wer: 0.087` +
`firstChunkLatencyMs: 412.5` refused, exit 1, both failure messages;
restored, exit 0).

## The candidates (source-verified at the pinned revisions)

- **VibeVoice-ASR-Streaming-1.5B** — the card's own headline: "a unified
  streaming ASR model that transcribes **Who (Speaker)** said **What
  (Content)**, with support for **Customized Hotwords** and **10
  languages**" (zh/en/es/pt/de/ja/ko/fr/ru/it). Architecture:
  VibeVoiceForASRStreamingTraining — a qwen2-family 28-layer decoder
  (hidden 1536, vocab 151936, tied embeddings) + acoustic/semantic
  tokenizers + a diffusion head; fp32 storage; 24 kHz input. The pinned
  `preprocessor_config.json` fixes the STREAMING-CHUNKING constants:
  chunk_frames 22, lookahead_frames 4, speech_tok_compress_ratio 3200 —
  3200 samples/token at 24 kHz = 0.1333 s/token, so one hypothesis chunk
  covers ~22 tokens (~2.93 s) with a ~4-token (~0.53 s) lookahead. No
  generation_config.json exists at this revision (404 — recorded); no
  confidence is documented anywhere in the card.
- **Qwen3-ASR-1.7B** — 30 languages named in `config.json`
  support_languages (the card claims 52 languages AND dialects = 30
  languages + 22 Chinese dialects — both recorded verbatim);
  per-utterance language id (`results[0].language`); "streaming / offline
  unified inference" with streaming ONLY via the vLLM backend (and
  streaming mode supports neither batch inference nor timestamps); word/
  character timestamps require the SEPARATE `Qwen3-ForcedAligner-0.6B`
  (11 languages, a second model + download); 30 s chunks at 16 kHz
  (128-mel Whisper-style features — the staged SPR WAVs are already 16
  kHz mono); near-greedy generation_config (do_sample false,
  temperature 1e-6 — the determinism anchor). The card documents ZERO
  speaker metadata and ZERO hotword support (grep: no hits). The card
  names the 0.6B sibling ("the 0.6B version achieves accuracy-efficient
  trade-off") — recorded as an observation for the HF015 lane; NOT
  substituted for the pinned 1.7B candidate.

## The audio fixtures (the HF009 story, staged and re-verified)

The 64-d extraction at `/home/z/hf-bench-4/audio/` is the authorized
fixture set, sha-verified by this flight's executed preflight (both
PASS): `spr-b1-audio.wav` (30.070 s, 16 kHz mono PCM16, sha
`08c2fcfb…`, from clip-b1-wide-broadcast.mp4) and `spr-src-audio.wav`
(47.624 s, sha `ddf9c203…`, from b8p3.mp4) — SPR corpus clips authorized
by the repo's own R606 registration declaration (analysis scope, repo
private). The two structural gaps are recorded exactly as HF009 recorded
them: **fx-001's audio gap** (the committed clip is video-only by the
manifest's own `-an` transform — ffprobe re-verified this flight: a
single h264 stream; the audio lives only in the original webm at the
canonical URL, whose fetch was HTTP-429-rate-limited on all 6 attempts
in the 64-d flight — an infrastructure wall, not licensing) and the
**synthetic fixture's no-audio structural gap** (ffprobe re-verified: a
single video-only h264 stream — NO audio track exists at all; the repo
fixture set cannot exercise ANY audio task profile). A third typed gap:
the SPR WAVs' spoken language is not annotated anywhere in the repo —
per-language fixtures for the multilingual protocol do not exist.

## The metric designs (implemented, ready-to-run, typed not-measured)

All definitions are stated exactly in `benchmark_asr.py`'s module
docstring and implemented as dependency-free functions; the
implementations were verified by the EXECUTED self-check (10/10
hand-computed cases — labeled implementation evidence, NOT a model
measurement, never entering the quality blocks as numbers):

- **WER** = (S + D + I) / N over the word-sequence Levenshtein
  alignment, with the normalization stated exactly (case-fold,
  Unicode-punctuation strip by category, whitespace collapse); reported
  per utterance and pooled as the micro-average over reference words
  (never the mean of per-utterance rates). An empty reference with a
  non-empty hypothesis is insertion-only: WER undefined, NEVER reported
  as 0. The **reference-transcript requirement**: the repo owns NO
  commentary transcripts of real audio (the ground-truth search record:
  the W208 test transcripts are synthetic inline text; the ASR fixture
  backend returns canned strings; the production z-ai backend has no
  stored reference) — `--ground-truth` is the OPERATOR UNLOCK.
- **Streaming-chunking semantics** (VibeVoice): hypothesis-per-chunk vs
  FINAL (the settled transcript once the chunk leaves the lookahead
  window); WER is computed on the concatenated finals; the per-chunk
  hypothesis churn is a separate streaming-consistency measure
  (hypothesisChurnRate = 1 − mean word-F1 of each hypothesis vs its own
  final) — never a WER.
- **Streaming latency**: firstChunkLatencyMs (wall-clock from the first
  audio sample fed to the first emitted hypothesis), steady-state RTF
  (processing time / audio duration, per chunk after the first, pooled),
  per-utterance wall-clock (median + nearest-rank p95,
  rank = ceil(p/100·n) — the repo convention). TYPED: Qwen3's
  first-chunk latency is vLLM-only per the card; the transformers
  backend measures offline metrics only.
- **Hotword recall** = |{hotwords in the reference ∧ recognized in the
  hypothesis}| / |{hotwords in the reference}| (the denominator counts
  only present hotwords — verified by self-check). The hotword
  VOCABULARY is an authored decision recorded as the gap (the W401
  precedent: "tech-lead AUTHORED decision (test-pinned), not an
  inference"): the repo's own candidates are the W209 pattern lexicon
  and the W401 event taxonomy — extraction vocabularies, not ASR-biasing
  name lists; the operator passes `--hotwords`. VibeVoice documents
  input-side customized hotwords natively; Qwen3 documents none (a typed
  capability gap for the multilingual candidate).
- **Multilingual WER**: per-language WER pooled per DETECTED language
  (Qwen3's per-utterance language id). Requires per-language licensed
  fixtures — NONE exist (typed).

## The ASR contract mappings (machine-checked, the flight's core value)

`contract_compatibility.ts` EXECUTED exit 0 — 31 needle-checked claims
over the FROZEN task profiles, the W207/W208/W209/W401 sources, the ASR
observation seam, and the committed HF007 evidence; 6 transcription-
output rows + 3 evidence-chain rows + 2 speaker-composition rows + the
8-row STATIC capability delta.

**The load-bearing verdict — transcription-of-observed-audio vs
free-form generation.** HF007 ruled the W208 CommentaryUnit
NOT-COMPATIBLE for GENERATED text ("a different artifact class" — free-
form commentary synthesis has no character traceability). ASR
transcription of observed audio is a DIFFERENT artifact class, and the
distinction is argued from the repo's OWN sources, never asserted: (1)
the W207 observation contract says STT output enters the pipeline as
OBSERVATIONS with `modality: "audio"`, `provenance: "OBSERVED"`, payload
`kind: "transcription"` with text VERBATIM — the audio observation
EXISTS and is the evidence anchor; (2) W208's own docstring opens "W207
transcribes fixed 5-second audio windows" — the chain is BUILT on ASR
output; (3) the production backend (zai-backend.ts) is itself a neural
ASR behind the vendor-neutral one-method seam. An ASR transcript is
derived from the observed audio — the same class as the incumbent
backend's output — so the HF007 exclusion of generated text does NOT
apply to it, and the W208 verdict is **compatible-with-adapter for
transcription** (the honest reversal of the HF007 verdict, recorded as
such). What the doctrine still governs: the W208 segmenter's own
transformation (trim/join only — traceable to W207 characters) holds
regardless of the backend. The typed gaps that remain: chunk-level (not
word-level) timing; the hallucination risk (a neural ASR can emit
unspoken text — contained by the OBSERVED-audio evidence anchor, the
honest confidence absence, and W209's DERIVED provenance downstream;
the insertion-rate-on-non-speech measure is a typed metric design, not
measured); no confidence from either candidate (asrConfidence stays
undefined forever — architecture-lock §4, exactly the zai-backend
discipline).

The other key mappings: the transcript text **maps** onto W207
AsrBackendResult.text behind the existing seam (both candidates are
just additional backends — vendor neutrality sanctions them);
timestamps **maps-with-adapter** (VibeVoice's ~2.93 s chunks are finer
than the 5 s W207 grid — an adapter tiling decision; Qwen3 has no
timestamps without the separate ForcedAligner); speaker hints
**maps-with-adapter** for VibeVoice (cluster labels → W207 speakerLabel
passthrough → W208's hard speaker-change boundary — with the HF009
typed gaps carried over: cluster-not-identity, overlap→exclusive
unverified, no per-turn confidence) and **does-not-map** for Qwen3; the
per-utterance language id is **partial** (W207/W208 are language-blind —
no landing field; a TL-gated extension, recorded not built); hotwords
are **partial** (the seam's transcribe(wav) carries no context
argument — a TL-gated seam extension — plus the authored vocabulary
gap).

## The speaker-hints / diarization composition verdict

The two candidates sit at DIFFERENT positions in the pipeline
composition. **VibeVoice = fused ASR+diarization** (who-said-what in
one model): the HF009 pyannote stage becomes unnecessary FOR SPEAKER
LABELS if the fused attribution quality is acceptable — UNVERIFIED (the
HF009 run was auth-refused, this flight resource-refused) — and the
HF009 typed gaps carry over unchanged (cluster labels not identities;
no per-turn confidence; overlap→exclusive quality unverified).
**Qwen3 = pure ASR** (zero speaker metadata documented): it REQUIRES
the HF009 pyannote→W208 composition exactly as designed (whose auth
wall still applies). Neither composition is verified on this host; the
composition choice is an HF015-lane decision that needs EXECUTED
evidence from both ready-to-run paths first. Neither candidate provides
speaker IDENTITIES — identity resolution stays W401 fusion territory.

## The ready-to-run path (on an adequate host)

`benchmark_asr.py --mode full` (fail-closed, refuses on this host with
the same arithmetic): >= 16 GB RAM, >= 24 GB free disk; pinned
sha-verified downloads of every shard (the hub LFS sha256s are recorded
in results/load-analysis.json); the VibeVoice path (the vibevoice
package + torch + transformers>=4.51, 24 kHz resample, the model's
streaming generator, hypothesis-per-chunk vs finals collected); the
Qwen3 path (the qwen-asr package, the transformers backend offline per
fixture — the SPR WAVs are already 16 kHz mono — per-utterance language
id + text; the vLLM backend is the streaming-only path, typed); the
`--ground-truth` and `--hotwords` operator unlocks; every metric above
assembled from the run's own numbers only.

## The limitations (honest)

The models never ran — every metric-shaped value here is a design, a
typed refusal, or an implementation self-check (labeled as such). CPU
wall-clock would be labeled CPU (no GPU, N/A); the 30-48 s authorized
clips are far outside both models' full-broadcast training regimes (a
domain-shift caveat); no reference transcripts exist (the WER
denominator is an operator action away on ANY hardware); no per-language
fixtures exist; the hotword vocabulary does not exist; the speaker
quality is unverifiable without a run; Qwen3's 52-language claim is
card-stated, not measured (30 languages in config).

## The promotion-gate referral

`gatingState` stands `candidate` for BOTH — NO promotion; HF015 is the
TL's gate alone. Blockers for that gate (recorded in
benchmark-record.json): zero executed evidence (resource-infeasible
host, both candidates); the ground-truth unlock (no reference
transcripts exist — an operator action precedes any scored run
anywhere); the three fixture gaps (fx-001's 429-blocked audio, the
synthetic fixture's missing audio track, no per-language fixtures); the
authored hotword vocabulary (a W401-lane decision that does not exist);
and the speaker-hints quality unverifiable without a run (VibeVoice's
fused cluster-label attribution + no diarization ground truth — the
HF009 verdict). The 0.6B sibling is a recorded HF015-lane observation
(smaller checkpoint — possibly feasible on a mid-tier host), not a
substitution.

=== END REPORT ===

===== 64-f REPORT END =====
