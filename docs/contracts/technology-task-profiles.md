# Sporta Technology Task Profiles

Status: FROZEN FOR IMPLEMENTATION
Related: ADR-011, Technology Plane

These logical profiles define the tasks for which multiple technologies may compete.

## Perception

### football.playerDetection
Inputs: normalized football frames.
Outputs: player/goalkeeper/referee/ball candidate observations.
Metrics: precision/recall/mAP, ball recall, identity handoff compatibility, latency.

### football.playerSegmentation
Inputs: football frames and optional prompts/identifiers.
Outputs: per-instance masks and confidence.
Metrics: mask quality, identity continuity, latency.

### football.playerTracking
Inputs: detections/masks and temporal frames.
Outputs: stable local tracks.
Metrics: ID switches, MOTA/HOTA where applicable, continuity under occlusion, latency.

### football.eventSpotting
Inputs: frame/features over time.
Outputs: timestamped candidate event windows.
Metrics: temporal precision/recall, early detection latency, false positives.

### football.eventReasoning
Inputs: video/frame evidence, event candidates, commentary/context.
Outputs: semantic event candidates with provenance/confidence.
Metrics: event accuracy, temporal alignment, hallucination rate, explanation/provenance quality.

### football.commentaryASR.streaming
Inputs: live commentary audio.
Outputs: timestamped transcript segments and speaker hints.
Metrics: WER, latency, speaker segmentation quality, hotword recall.

### football.commentaryASR.multilingual
Inputs: commentary audio.
Outputs: multilingual transcript.
Metrics: WER by language, latency, robustness to stadium/commentary noise.

### football.commentarySpeakerDiarization
Inputs: commentary audio.
Outputs: speaker turns/identifiers.
Metrics: DER/JER or equivalent, latency, segment stability.

## Geometry

### scene.metric3DReconstruction
Inputs: one or more frames/images.
Outputs: metric scene geometry and camera relationships.
Metrics: depth error, pose error, registration error, throughput, GPU memory.

### scene.depth
Inputs: frame sequence.
Outputs: depth maps with confidence.
Metrics: depth consistency, temporal stability, latency.

### scene.cameraPose
Inputs: frame sequence.
Outputs: camera pose trajectory with timestamps and confidence.
Metrics: reprojection/trajectory error, temporal stability, latency.

### scene.covisibility
Inputs: frame set and camera/geometry estimates.
Outputs: visibility/covisibility relationships.
Metrics: consistency under camera movement and occlusion.

## Rendering

### renderer.cinematicReCamera
Inputs: source references permitted by rights, SWM snapshot/events, camera path, geometry/depth guidance, output profile.
Outputs: alternate-view video, renderer telemetry, geometry/SWM consistency metadata.
Metrics: camera-path adherence, player/ball identity, temporal consistency, geometry consistency, hallucinated/unseen-region rate, event preservation, generation latency and cost.

### renderer.characterAnimation
Inputs: canonical entity motion/state plus authorized style/avatar reference.
Outputs: temporally coherent character animation.
Metrics: identity, motion fidelity, temporal consistency, style adherence.

### renderer.neuralVideo
Generic neural video-generation interface for future reality candidates.

### renderer.audioVideoGeneration
Joint audio/video generation profile for future commentary/reality synthesis.

### renderer.upscale
Resolution/spatial/temporal enhancement profile.

## Production promotion

Each profile maps to one or more TechnologyProfiles and supports:

- preferred;
- fallback;
- ensemble;
- cascade;
- minimum acceptance thresholds.

No model name appears in the core product domain.
