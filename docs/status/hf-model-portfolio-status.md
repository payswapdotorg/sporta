# Sporta Hugging Face Model Portfolio Status

Status: HF001/HF002 COMPLETE; HF003 BENCHMARKED (no promotion); HF004 BENCHMARKED-REFUSED (typed, no promotion)
Date: 2026-10-03

## Portfolio

| Item | State | Owner |
|---|---|---|
| HF001 task profiles | NOT_STARTED | TL + A |
| HF002 provenance ledger | NOT_STARTED | B |
| HF003 RF-DETR SoccerNet | ✅ BENCHMARKED (9e08ac9, flight 1: CPU-host evidence, no promotion — the candidate stands; the honest domain-mismatch + latency/memory record) | A |
| HF004 MapAnything | ✅ BENCHMARKED-REFUSED (35f265d, flight 2: resource-infeasible-host typed refusal — 4.91 GB checkpoint vs 1.36 GB disk / 5.58 GiB vs 4.04 GB RAM, preflight executed exit 3; the machine-checked contract-compatibility verdict + the ready-to-run path for a >=16 GB host; no promotion) | A |
| HF005 SAM3 | NOT_STARTED | A |
| HF006 Spivak | NOT_STARTED | A |
| HF007 SoccerChat | NOT_STARTED | A |
| HF008 VibeVoice/Qwen3-ASR | NOT_STARTED | A+B |
| HF009 pyannote | NOT_STARTED | A |
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
