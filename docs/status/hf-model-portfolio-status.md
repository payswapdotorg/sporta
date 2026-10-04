# Sporta Hugging Face Model Portfolio Status

Status: HF001/HF002 COMPLETE; HF003/HF006 BENCHMARKED (executed, no promotion); HF004/HF007/HF008 BENCHMARKED-REFUSED (typed resource, no promotion); HF009 BENCHMARKED-REFUSED (auth-gated, typed, no promotion)
Date: 2026-10-03

## Portfolio

| Item | State | Owner |
|---|---|---|
| HF001 task profiles | NOT_STARTED | TL + A |
| HF002 provenance ledger | NOT_STARTED | B |
| HF003 RF-DETR SoccerNet | ✅ BENCHMARKED (9e08ac9, flight 1: CPU-host evidence, no promotion — the candidate stands; the honest domain-mismatch + latency/memory record) | A |
| HF004 MapAnything | ✅ BENCHMARKED-REFUSED (35f265d, flight 2: resource-infeasible-host typed refusal — 4.91 GB checkpoint vs 1.36 GB disk / 5.58 GiB vs 4.04 GB RAM, preflight executed exit 3; the machine-checked contract-compatibility verdict + the ready-to-run path for a >=16 GB host; no promotion) | A |
| HF005 SAM3 | NOT_STARTED | A |
| HF006 Spivak | ✅ BENCHMARKED (20db83d, flight 3: EXECUTED CPU-host evidence — sha-verified 74 MB checkpoint, the full ResNet-152+dense-UNet chain ran, per-window 94/100 ms p50/p95, honest zero-detections OOD on short fragments, cascade verdict unfavorable on CPU; no promotion) | A |
| HF007 SoccerChat | ✅ BENCHMARKED-REFUSED (a5db099, flight 5: resource-infeasible typed refusal — 18.5 GiB bf16 = 4.7x RAM — PLUS the SoccerNet-NDA-gated eval wall; delivered: the machine-checked contract mappings incl. the W208 not-compatible honest negative, the ready-to-run metric designs, the static pipeline comparison; no promotion) | A |
| HF008 VibeVoice/Qwen3-ASR | ✅ BENCHMARKED-REFUSED (3b76944, flight 6: both candidates resource-infeasible typed refusals — 5.24 GiB fp32 / 4.38 GiB bf16 vs 4 GB RAM; delivered: the W208 transcription-reversal verdict (transcription-of-observed-audio compatible — the honest reversal of HF007's generated-text verdict), the ready-to-run WER/latency/hotword metric designs (self-check 10/10), the speaker composition verdict; no promotion) | A+B |
| HF009 pyannote | ✅ BENCHMARKED-REFUSED (abdf172, flight 4: auth-gated-model typed refusal — community-1 is user-conditions-gated, 401 at the pinned revision, no HF token exists in-sandbox; the executed partial: 2 SPR WAVs sha-pinned + the 6-probe hub map + the W208 contract review; ready-to-run full mode; no promotion) | A |
| HF010 camera-controlled neural renderer | NOT_STARTED | C |
| HF011 ViewCrafter | NOT_STARTED | C |
| HF012 Wan2.2 Animate | NOT_STARTED | C |
| HF013 LTX-2.3 | NOT_STARTED | A+C |
| HF014 Camera Director | NOT_STARTED | TL+C |
| HF015 promotion gate | NOT_STARTED | TL |

## Priority

Immediate P1 candidates:
- RF-DETR SoccerNet
- MapAnything
- SoccerChat
- VibeVoice/Qwen3-ASR
- Spivak
- Wan2.2-Fun-Control-Camera
- ReCamMaster
- Meridian
- ViewCrafter

Research/watchlist:
- SAM3
- DA3-GIANT
- non-commercial soccer VLM candidates

## Important boundary

No model is production-approved by this document. Model cards are evidence inputs, not acceptance evidence.

Production promotion requires Sporta's own benchmark, resource measurement, provenance/license review and failure envelope.
