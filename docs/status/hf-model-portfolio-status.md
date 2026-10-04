# Sporta Hugging Face Model Portfolio Status

Status: HF001/HF002 COMPLETE; HF003/HF006 BENCHMARKED (executed, no promotion); HF004/HF007/HF008/HF010/HF011/HF012 BENCHMARKED-REFUSED (typed resource, no promotion); HF009 BENCHMARKED-REFUSED (auth-gated, typed, no promotion)
Date: 2026-10-04

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
| HF010 camera-controlled neural renderer | ✅ BENCHMARKED-REFUSED (b8121a9, flight 7: all three candidates resource-infeasible typed refusals — Wan2.2-Fun 71.06 GB = 63x disk / ReCamMaster smallest 20.56 GB / Meridian ~82 GB + ~88 GiB peak + CUDA-required, PLUS the VGGT-Omega auth gate (HF-gated manual, anonymous 401, TL re-confirmed live); delivered: the authored camera-path fixtures (hf010.camera-paths@1, sha-pinned 66ef1b4a…, 6 deterministic windows x 81 poses in the CameraPlan/W601-slot language, provider-neutral — the HF014 runway), the license-posture verdicts (Wan2.2-Fun + ReCamMaster production-eligible-by-recorded-terms; Meridian research-only: minimax-h3-community-license + FAIR-Noncommercial VGGT-Omega), the 5 frozen-profile metric designs (selfcheck 14/14, typed not-measured), the machine-checked contract mappings (camera-path conditioning: Meridian maps > Wan2.2-Fun maps-with-adapter > ReCamMaster preset-indexed partial); no promotion) | C |
| HF011 ViewCrafter | ✅ BENCHMARKED-REFUSED (7e9f674, flight 8: resource-infeasible typed refusal — the pinned 10.44 GB tree + DUSt3R 2.29 GB + sparse sibling 10.44 GB = single-view 11.4x / sparse 20.7x free disk, 23.5 GB GPU working set ≈ 5.5x RAM, CUDA-only; NO auth wall (the honest contrast with Meridian); license apache-2.0 commercial-yes production-eligible-by-recorded-terms; delivered: the SAME HF010 fixtures consumed sha-verified (never re-authored), the same-fixture comparison design (renderer-3d ground-truth renders as source images, 81→25 pose resampling, SHARED estimators imported from hf010 + the sparse-view geometric-consistency metrics, the head-to-head scoring design with N/A-typed comparators), the spherical adapter per window, the contract mapping (11 authorities, the sparse-view IMAGE class vs the frozen profile — PARTIAL); no promotion) | C |
| HF012 Wan2.2 Animate | ✅ BENCHMARKED-REFUSED (63dba87, flight 9: resource-infeasible typed refusal — 47.68 GiB core (MoE 32.18 + umt5 10.58 + CLIP 4.44 + VAE 0.47) + preprocess = 53.65 GiB = 51.6x disk, whole-tree 64.8x, FLUX-route ~103x (its dependency gated=auto license:other — HF015 input); NO auth wall on the candidate; apache-2.0 commercial-yes production-eligible-by-recorded-terms; delivered: the motion/identity/style metric designs (selfcheck 26/26; estimators imported from hf010), THE no-canonical-truth invariant machine-checked BOTH ways (renderer-truth refused for the candidate AND the repo's own anime-npr lane — the C->A boundary binds both), the Anime/NPR 8-axis comparison + the on-twos adequate-host design, the contract mapping (canonical entity motion/state MAPS-WITH-ADAPTER — the typed SWM-state-to-video gap; authorized reference rights-gated); no promotion) | C |
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
