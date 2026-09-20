# Hugging Face Technology Portfolio — Sporta

Status: ACCEPTED RESEARCH INPUT
Date: 2026-09-20
Purpose: make the approved Hugging Face model candidates discoverable to the active Tech Lead without relying on conversation history.

## Operating rule

These are Technology Plane candidates, not architectural dependencies.

Every candidate must be evaluated behind a stable Sporta task profile. Model code, weights, dataset terms, checkpoints, assets and commercial-use rights are recorded separately.

No candidate becomes production merely because its Hugging Face model card is strong.

## Priority portfolio

### P1 — direct Sporta fidelity / intelligence impact

1. julianzu9612/RFDETR-Soccernet
   - Task: football.playerDetection
   - Fit: SoccerNet-trained detection of ball, player, referee and goalkeeper.
   - License: Apache-2.0 on the current model card.
   - Reported model-card metrics: 85.7 mAP@50, 49.8 mAP, 52.0 mAP@75.
   - Evidence boundary: these are model-card results; Sporta must benchmark on its own fixtures and real authorized footage.
   - Source: https://huggingface.co/julianzu9612/RFDETR-Soccernet

2. facebook/map-anything-apache
   - Tasks: scene.metric3DReconstruction, scene.depth, scene.cameraPose, scene.covisibility.
   - Fit: metric 3D reconstruction, depth, camera pose, registration and multi-view geometry useful to broadcast reconstruction and neural re-camera.
   - License: Apache-2.0 variant.
   - Source: https://huggingface.co/facebook/map-anything-apache

3. SimulaMet/SoccerChat-qwen2-vl-7b
   - Tasks: football.eventReasoning, football.commentaryUnderstanding, analyst.assistance.
   - Fit: soccer-specific video/event/commentary multimodal reasoning.
   - License: Apache-2.0 on the current adapter/model card.
   - Source: https://huggingface.co/SimulaMet/SoccerChat-qwen2-vl-7b

4. microsoft/VibeVoice-ASR-Streaming-1.5B
   - Task: football.commentaryASR.streaming
   - Fit: streaming transcription, speaker attribution and hotword handling for live commentary.
   - License: current model-card/license must be checked before promotion; do not infer from another repository's license.
   - Source: https://huggingface.co/microsoft/VibeVoice-ASR-Streaming-1.5B

5. Qwen/Qwen3-ASR-1.7B
   - Task: football.commentaryASR.multilingual
   - Fit: multilingual commentary transcription and fallback/ensemble with streaming ASR.
   - License: Apache-2.0 on the current model card.
   - Source: https://huggingface.co/Qwen/Qwen3-ASR-1.7B

6. pyannote/speaker-diarization-community-1
   - Task: football.commentarySpeakerDiarization
   - Fit: speaker segmentation/attribution for commentary synchronization and multi-speaker feeds.
   - License: current model-card/license must be checked before promotion; current public model is CC-BY-4.0.
   - Source: https://huggingface.co/pyannote/speaker-diarization-community-1

7. yahoo-inc/spivak-action-spotting-soccernet
   - Task: football.eventSpotting
   - Fit: temporally precise soccer action spotting; useful as a cheap first-stage event cascade before expensive multimodal reasoning.
   - License: CC-BY-4.0.
   - Source: https://huggingface.co/yahoo-inc/spivak-action-spotting-soccernet

### P1 — new cinematic / neural reality capability

8. alibaba-pai/Wan2.2-Fun-A14B-Control-Camera
   - Task: renderer.cinematicReCamera
   - Fit: camera/lens control plus video control conditions; strong candidate for Sporta Camera Director.
   - License: Apache-2.0 on the current model card.
   - Source: https://huggingface.co/alibaba-pai/Wan2.2-Fun-A14B-Control-Camera

9. KlingAIResearch/ReCamMaster
   - Task: renderer.cinematicReCamera
   - Fit: camera-controlled video re-rendering / novel camera trajectories.
   - License: current repository is MIT; model/base-model terms must be checked separately.
   - Source: https://github.com/KlingAIResearch/ReCamMaster

10. Viggle/Meridian
    - Task: renderer.cinematicReCamera
    - Fit: geometry-guided novel-view/re-camera rendering.
    - Status: research candidate only until model/checkpoint/geometric dependency licensing is resolved for Sporta's target markets.
    - Source: https://huggingface.co/Viggle/Meridian

11. Drexubery/ViewCrafter_25
    - Task: renderer.cinematicReCamera.experimental
    - Fit: single/sparse-view novel-view generation benchmark.
    - License: Apache-2.0 on the current checkpoint.
    - Status: research/benchmark candidate, not live.
    - Source: https://huggingface.co/Drexubery/ViewCrafter_25

12. Wan-AI/Wan2.2-Animate-14B
    - Task: renderer.characterAnimation
    - Fit: character animation/replacement for stylized or avatar-driven realities.
    - License: current checkpoint is a benchmark candidate; verify current model-card terms before promotion.
    - Source: https://huggingface.co/Wan-AI/Wan2.2-Animate-14B

13. Lightricks/LTX-2.3
    - Tasks: renderer.neuralVideo, renderer.audioVideoGeneration, renderer.upscale.
    - Fit: synchronized audio/video generation and future commentary+reality experiences.
    - License: LTX-2 community license; production promotion requires legal/commercial-use review.
    - Source: https://huggingface.co/Lightricks/LTX-2.3

### Research-only / watchlist

14. facebook/sam3
    - Tasks: football.playerSegmentation, football.playerTracking, humanCorrection.
    - Fit: open-vocabulary video segmentation/tracking, including interactive correction potential.
    - Status: benchmark candidate; gated and governed by Meta's SAM License. Do not assume it is a production-safe dependency.
    - Source: https://huggingface.co/facebook/sam3

15. depth-anything/DA3-GIANT
    - Tasks: scene.depth, scene.cameraPose, scene.multiViewGeometry.
    - Fit: geometry research comparison against MapAnything/VGGT.
    - Status: benchmark/watchlist; current surfaced checkpoint is non-commercial, so not a default production dependency.
    - Source: https://huggingface.co/depth-anything/DA3-GIANT

16. Domain-specific non-commercial soccer VLM candidates may be benchmarked for research, but must remain explicitly non-production until their licenses and intended-use terms permit Sporta's intended deployment.

## Required evaluation dimensions

All candidates must be evaluated against the existing Sporta Technology Plane:

- quality/accuracy;
- temporal stability;
- identity continuity;
- geometry/camera correctness;
- event timing;
- latency;
- throughput;
- GPU memory and cost;
- failure rate;
- determinism/reproducibility;
- real-vs-fixture boundary;
- license/model/data provenance;
- commercial-use status.

## Architecture impact

These candidates strengthen existing task profiles; they do not replace the SWM.

The new neural camera candidates imply a logical renderer class:

renderer.cinematicReCamera

This class should consume:

- authorized source references;
- SWM snapshot/events;
- camera path;
- geometry/depth evidence;
- output profile;
- rights capabilities.

The Camera Director remains Sporta-owned logic. Models are actuators/candidates behind adapters.

## Portfolio promotion rule

candidate -> compatibility -> license/provenance -> benchmark -> comparison -> shadow -> canary -> production

A Hugging Face download is never evidence of production suitability.
