# Sporta Hugging Face Model Portfolio — Work Items

## Purpose

These items extend the active J/L program with benchmarkable model candidates. They do not replace existing J/L work.

## Shared registry

### HF001 — Register logical task profiles
Owner: Tech Lead + Worker A.
Acceptance: technology task profiles exist in docs/contracts/technology-task-profiles.md; no model name enters domain contracts.

### HF002 — Technology provenance ledger
Owner: Worker B.
Acceptance: candidate registry records model URL, commit/version, model license, code license, weights provenance, dataset provenance, commercial-use status and gating state.

## Perception / intelligence

### HF003 — RF-DETR SoccerNet benchmark
Owner: Worker A.
Acceptance: run against Sporta benchmark fixtures and at least one authorized real clip; compare against current detector; record latency/GPU memory/quality; no promotion without evidence.

### HF004 — MapAnything geometry benchmark
Owner: Worker A.
Acceptance: benchmark camera/depth/reconstruction quality on Sporta camera-motion fixtures and authorized real footage; output compatible with SWM/Camera Director contracts.

### HF005 — SAM3 segmentation/tracking benchmark
Owner: Worker A.
Acceptance: controlled gated benchmark; explicit license review; compare identity continuity and latency; remain research/watchlist unless production-safe.

### HF006 — Spivak event-spotting benchmark
Owner: Worker A.
Acceptance: measure temporal precision/recall and early-detection latency; evaluate as a cheap cascade before expensive event reasoning.

### HF007 — SoccerChat event/commentary reasoning benchmark
Owner: Worker A.
Acceptance: evaluate event extraction, commentary alignment, hallucination rate and provenance; compare against current intelligence pipeline.

### HF008 — Streaming commentary ASR portfolio
Owner: Worker A + Worker B.
Candidates: VibeVoice-ASR-Streaming and Qwen3-ASR.
Acceptance: benchmark WER, latency, speaker hints, hotword recall and multilingual coverage on licensed commentary fixtures.

### HF009 — Speaker diarization benchmark
Owner: Worker A.
Acceptance: compare speaker segmentation against transcript/event timelines; record DER/JER-equivalent metrics and failure modes.

## Neural geometry / rendering

### HF010 — Camera-controlled neural renderer benchmark
Owner: Worker C.
Candidates: Wan2.2-Fun-Control-Camera, ReCamMaster, Meridian.
Acceptance: common benchmark with authored camera paths; measure camera adherence, player/ball identity, temporal consistency, hallucinated-region rate, generation cost/latency and license posture.

### HF011 — Novel-view baseline benchmark
Owner: Worker C.
Candidate: ViewCrafter.
Acceptance: compare single/sparse-view novel-view fidelity against HF010 under the same camera-path/geometry fixtures.

### HF012 — Character animation benchmark
Owner: Worker C.
Candidate: Wan2.2-Animate.
Acceptance: evaluate player/avatar motion fidelity and temporal identity stability against Sporta's Anime/NPR direction; no canonical player truth may be generated solely by the renderer.

### HF013 — Joint audio-video benchmark
Owner: Worker C + Worker A.
Candidate: LTX-2.3.
Acceptance: evaluate future combined commentary/reality generation and upscaling; document community-license/commercial-use constraints.

### HF014 — Camera Director integration
Owner: Worker C + Tech Lead.
Acceptance: Camera Director emits a provider-neutral camera intent/path consumed by neural or procedural renderers; model selection remains Technology Plane configuration.

### HF015 — Technology promotion gate
Owner: Tech Lead.
Acceptance: only candidates with benchmark, resource, provenance/license, reproducibility and failure evidence can move from candidate to benchmarked/canary/production.

## Research-only watchlist

DA3-GIANT and explicitly non-commercial soccer VLMs remain benchmark/watchlist candidates only unless their terms change.

## Parallelization

### Wave HF-A

Worker A: HF001, HF003-HF009.
Worker B: HF002 plus ASR execution plumbing in HF008.
Worker C: HF010-HF013 research harness design.

### Wave HF-B

Worker A: benchmark and integrate HF003-HF009.
Worker B: provenance/runtime packaging and Compute Broker profiles.
Worker C: HF010-HF014 renderer benchmarks and Camera Director.

### Wave HF-C

All workers contribute evidence; Tech Lead owns HF015.

These waves can run alongside non-conflicting J/L work.
