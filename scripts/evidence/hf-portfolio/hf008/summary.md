# HF008 — the streaming commentary ASR portfolio benchmark (flight 6, worker 64-f)

## The verdict in one line

BOTH ledger candidates were probed at their pinned revisions (reachable, NOT gated — no HF009-style auth wall), and BOTH were refused as **resource-infeasible-host** by the executed preflight arithmetic: this host has 4,041.6 MiB total RAM (~1.85 GiB available), ~1.1 GB free disk, 2 vCPU, no GPU, while VibeVoice-ASR-Streaming-1.5B is a 5.24 GiB fp32 checkpoint (3 shards, 5,628,388,290 B) and Qwen3-ASR-1.7B is a 4.38 GiB bf16 checkpoint (2 shards, 4,698,521,512 B). The honest delivery is the typed refusal + the substantial partial — never a fabricated benchmark.

## What ran (executed)

- `benchmark_asr.py --mode preflight` — **EXECUTED, exit 3** (the typed refusal): host resources; both pinned hub probes (file trees + small config/card fetches, sha-pinned; weights NEVER downloaded); the resource arithmetic (8 typed reasons covering both candidates); the fixture sha verification (both SPR WAVs PASS; fx-001 + the synthetic fixture re-confirmed NO-AUDIO by ffprobe); the repo ground-truth search (no reference transcripts exist anywhere).
- `benchmark_asr.py --mode selfcheck` — **EXECUTED, exit 0** (10/10): the metric implementations verified against hand-computed cases (WER accounting incl. the never-zero empty-reference rule, the pooled micro-average, the hotword-recall denominator rule, hypothesis churn, the W207 window grid). Labeled implementation evidence, NOT a model measurement.
- `contract_compatibility.ts` — **EXECUTED, exit 0**: 31 needle-checked claims across the FROZEN task profiles, W207/W208/W209/W401 sources, the ASR observation seam, and the committed HF007 evidence.
- `record-benchmark.ts` — **EXECUTED, exit 0; NEGATIVE-TESTED**: fabricated `wer 0.087` + `firstChunkLatencyMs 412.5` injected → refused exit 1 (both failure messages), restored → exit 0.

## The partial (the real value)

1. **The WER metric design + implementation** (typed not-measured): WER = (S+D+I)/N on the word-sequence Levenshtein with the exact normalization stated (case-fold, Unicode-punctuation strip, whitespace collapse); pooled micro-average; the reference-transcript requirement recorded (the repo owns NONE — `--ground-truth` is the operator unlock); the streaming-chunking semantics per the pinned VibeVoice constants (chunk_frames 22 / lookahead_frames 4 / compress 3200 @ 24 kHz ≈ 2.93 s chunks + 0.53 s lookahead; hypothesis-per-chunk vs finals; churn as a separate streaming-consistency measure, never a WER).
2. **The ASR contract mappings** (machine-checkable, 6 transcription-output rows + 3 evidence-chain rows + 2 composition rows): both candidates map onto the repo's ASR contracts as additional backends behind the existing provider-neutral `AsrBackend` seam. **The load-bearing verdict — the transcription-vs-generation distinction**: HF007's W208 NOT-COMPATIBLE verdict applies to free-form generation; ASR **transcription-of-observed-audio is a different artifact class** — argued from the repo's own sources (the W207 observation contract: STT output enters as OBSERVATIONS, modality "audio", provenance "OBSERVED", payload kind "transcription", text verbatim; W208's own docstring: "W207 transcribes fixed 5-second audio windows"; the production z-ai backend is itself a neural ASR). The W208 verdict is therefore **compatible-with-adapter for transcription** — the honest reversal of the HF007 generated-text verdict — with the hallucination-risk typed gap recorded as the open edge.
3. **The latency metric designs** (typed): streaming first-chunk latency + steady-state RTF (processing/audio, per chunk, pooled) + per-utterance wall-clock (median + nearest-rank p95); Qwen3's first-chunk latency is typed vLLM-only (the card's own constraint).
4. **The hotword-recall + multilingual metric designs** (typed): hotwordRecall with the denominator rule verified by self-check; the hotword VOCABULARY is an authored decision recorded as the gap (the W401 precedent; VibeVoice documents input-side hotword customization, Qwen3 documents none); per-language WER needs per-language fixtures — none exist (the SPR WAVs' language is unannotated).
5. **The speaker-hints story**: VibeVoice documents native Who-said-What (fused ASR+diarization, cluster labels — the HF009 gaps carry over); Qwen3 documents ZERO speaker metadata → **the composition verdict**: the two candidates sit at different positions — VibeVoice = fused (one model; pyannote unnecessary for labels IF quality holds, unverified), Qwen3 = pure ASR (the HF009 pyannote composition is mandatory). Neither composition is verified on this host (both refused); the choice needs executed evidence first.

## The fixtures (the HF009 story, re-verified)

The 2 SPR WAVs (30.070 s + 47.624 s, 16 kHz mono PCM16, shas re-verified PASS, R606 analysis-scope authorized, repo-private) are staged and usable; fx-001's audio is typed 429-blocked (the committed clip is video-only by the manifest's own `-an`); the synthetic fixture has NO audio track at all; per-language fixtures do not exist.

## The gate

gatingState stays **candidate** for both — NO promotion (HF015 is the TL's gate alone). Blockers recorded: zero executed evidence (the refusal); the ground-truth unlock (an operator action); the three fixture gaps; the authored hotword vocabulary; the speaker-hints quality unverifiable without a run.

## Files

- `benchmark_asr.py` — preflight EXECUTED (exit 3) + selfcheck EXECUTED (exit 0) + full mode ready-to-run (fail-closed, refuses on this host)
- `benchmark-record.json` + `record-benchmark.ts` — the ledger-shaped record (BOTH rows echoed verbatim) + the fail-closed validator (exit 0, negative-tested)
- `contract_compatibility.ts` — the machine-checkable mappings (exit 0)
- `results/` — preflight-refusal.json, load-analysis.json, model-output-schema.json, audio-fixtures.json, metric-selfcheck.json, contract-compatibility.json
- Python side OUTSIDE the repo: `/home/z/hf-bench-6` (uv, python 3.12.14, huggingface_hub 2.1.1 only — lean, well inside the ~1.1 GB budget; torch deliberately NOT installed: installing + loading either checkpoint IS the infeasibility)
