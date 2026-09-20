# ADR-011 — Hugging Face Technology Portfolio and Task Profiles

Status: ACCEPTED
Date: 2026-09-20
Related: ADR-009, ADR-010, Technology Plane, live-reality contracts

## Decision

Sporta adopts a curated, benchmark-first portfolio of Hugging Face model candidates as Technology Plane entries.

The repository records candidates by logical task profile rather than embedding model names into domain contracts.

Initial logical profiles include:

- football.playerDetection
- football.playerSegmentation
- football.playerTracking
- football.eventSpotting
- football.eventReasoning
- football.commentaryASR.streaming
- football.commentaryASR.multilingual
- football.commentarySpeakerDiarization
- scene.metric3DReconstruction
- scene.depth
- scene.cameraPose
- scene.covisibility
- renderer.cinematicReCamera
- renderer.characterAnimation
- renderer.neuralVideo
- renderer.audioVideoGeneration
- renderer.upscale

## Decision constraints

1. A model name is never canonical domain truth.
2. Model/checkpoint/dataset/asset licensing is recorded separately.
3. Commercial-use status must be resolved before production promotion.
4. Candidate implementations must satisfy the existing adapter contracts.
5. Candidates may be combined through replacement, ensemble, cascade or fallback.
6. Existing Sporta SWM and renderer contracts do not change merely because a model changes.
7. Neural re-camera models receive camera intent from a Sporta Camera Director rather than deciding world truth themselves.
8. Live tactical rendering remains procedural/real-time-first; neural re-camera is primarily a replay/highlight/cinematic path until measured otherwise.
9. Non-commercial research checkpoints remain benchmark/watchlist entries and cannot silently become production dependencies.

## Rationale

The current Reality Engine audit exposed an empty/default SWM failure mode. Soccer-specific detectors, action spotters, multimodal soccer reasoning, live ASR and 3D scene reconstruction can improve the evidence entering the SWM.

At the renderer layer, geometry-aware and camera-controlled video models enable a new cinematic reality without changing the canonical world model.

## Acceptance

The Tech Lead may promote a candidate only after:

- benchmark evidence;
- resource measurement;
- reproducibility record;
- license/provenance review;
- failure envelope;
- explicit production status.

No architecture fork is justified by a model-specific implementation.
