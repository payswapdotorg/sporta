# Technology Provenance Ledger

Status: ACTIVE — first complete recording (HF002), live-verified 2026-10-03
Related: ADR-011, technology-task-profiles.md, hf-model-portfolio-work-items.md, scripts/evidence/hf-portfolio/provenance-ledger.json

This ledger records the provenance of every Hugging Face portfolio candidate named in the
work-items doc (HF003–HF013) plus the research-only watchlist. It is the machine-checkable
foundation of the portfolio: no candidate may be promoted (HF015) without the fields recorded
here being current and re-verified.

## Recording rules

- Every field was read from a live source at `recordedAt`; raw fetch snapshots and the
  re-runnable harness live in `scripts/evidence/hf-portfolio/` (`fetch-provenance.sh`).
- A field that could not be verified from a live source is recorded as the literal string
  `unknown` — a typed honest gap, never a guess.
- `modelLicense` is the license stated on the model card (or the license file the card points
  at); `codeLicense` is the license of the linked code repository, recorded separately
  (ADR-011 constraint 2).
- `commercialUse` is derived only from the recorded licenses: permissive licenses (apache-2.0,
  mit, cc-by-4.0) ⇒ `yes`; explicitly non-commercial licenses (e.g. cc-by-nc-4.0) ⇒ `no`;
  conditional, conflicting, custom or absent terms ⇒ `unclear`. It is a derivation, not legal
  advice — production promotion still requires the license/provenance review of HF015.
- `gatingState` is `candidate` for work-item candidates and `watchlist` for research-only
  entries. Nothing starts benchmarked/canary/production; only HF015 (Tech Lead) can promote.
- `taskProfiles` reference only the FROZEN logical profile IDs of
  `docs/contracts/technology-task-profiles.md`.

## HF003 — RF-DETR SoccerNet benchmark

Community fine-tune of RF-DETR-Large on SoccerNet-Tracking, named by the portfolio research
input as the RF-DETR SoccerNet candidate.

#### RF-DETR

- candidate: RF-DETR
- taskProfiles: football.playerDetection
- modelUrl: https://huggingface.co/julianzu9612/RFDETR-Soccernet
- revision: 1e388b922a64f2be39cbf1925e5fd5fc4f7dd771
- modelLicense: apache-2.0
- codeLicense: unknown
- weightsProvenance: RF-DETR-Large (COCO-pretrained) fine-tuned on SoccerNet-Tracking 2023
  (42,750 annotated images, 4 classes: ball/player/referee/goalkeeper) per the model card.
- datasetProvenance: SoccerNet-Tracking 2023 (train and reported test metrics, per card).
- commercialUse: yes
- gatingState: candidate
- sources:
  - https://huggingface.co/julianzu9612/RFDETR-Soccernet
  - https://huggingface.co/api/models/julianzu9612/RFDETR-Soccernet
  - https://huggingface.co/julianzu9612/RFDETR-Soccernet/raw/main/README.md
- recordedAt: 2026-10-03T01:39:57Z

## HF004 — MapAnything geometry benchmark

Apache-2.0-licensed variant of Meta's MapAnything metric-3D model, selected by the portfolio
research input over the default checkpoint (whose license differs — see research notes).

#### MapAnything

- candidate: MapAnything
- taskProfiles: scene.metric3DReconstruction, scene.depth, scene.cameraPose, scene.covisibility
- modelUrl: https://huggingface.co/facebook/map-anything-apache
- revision: 00f9c245bbcb60522d1ed7f9e9d88462c6e3f38a
- modelLicense: apache-2.0
- codeLicense: apache-2.0
- weightsProvenance: official Meta MapAnything feed-forward transformer ("Apache 2.0 variant
  of the model", per card); the card states no training corpus.
- datasetProvenance: unknown
- commercialUse: yes
- gatingState: candidate
- sources:
  - https://huggingface.co/facebook/map-anything-apache
  - https://huggingface.co/api/models/facebook/map-anything-apache
  - https://huggingface.co/facebook/map-anything-apache/raw/main/README.md
  - https://github.com/facebookresearch/map-anything
  - https://raw.githubusercontent.com/facebookresearch/map-anything/main/LICENSE
  - https://raw.githubusercontent.com/facebookresearch/map-anything/main/README.md
- recordedAt: 2026-10-03T01:39:58Z

## HF005 — SAM3 segmentation/tracking benchmark

Meta's SAM 3 promptable segmentation foundation model. Gated repository: access requires
accepting the license and sharing personal details (manual approval). The work item itself
mandates an explicit license review before any use beyond research.

#### SAM3

- candidate: SAM3
- taskProfiles: football.playerSegmentation, football.playerTracking
- modelUrl: https://huggingface.co/facebook/sam3
- revision: 3c879f39826c281e95690f02c7821c4de09afae7
- modelLicense: other (SAM License — custom Meta agreement, repo LICENSE file dated 2025-11-19)
- codeLicense: other (SAM License — facebookresearch/sam3 repo LICENSE)
- weightsProvenance: Meta's SAM 3 unified foundation model for promptable segmentation
  (successor of SAM 2, per card); the card states no training corpus.
- datasetProvenance: SA-CO benchmark (270K unique concepts — eval benchmark introduced with
  the model, per card; no training datasets named).
- commercialUse: unclear
- gatingState: candidate
- sources:
  - https://huggingface.co/facebook/sam3
  - https://huggingface.co/api/models/facebook/sam3
  - https://huggingface.co/facebook/sam3/resolve/main/README.md
  - https://huggingface.co/facebook/sam3/resolve/main/LICENSE
  - https://github.com/facebookresearch/sam3
  - https://raw.githubusercontent.com/facebookresearch/sam3/main/LICENSE
- recordedAt: 2026-10-03T01:39:59Z

## HF006 — Spivak event-spotting benchmark

Yahoo's dense-detection-anchor action spotting models for SoccerNet.

#### Spivak

- candidate: Spivak
- taskProfiles: football.eventSpotting
- modelUrl: https://huggingface.co/yahoo-inc/spivak-action-spotting-soccernet
- revision: 1dced1b7a921f95ab741cad59325ee2e4dc08496
- modelLicense: cc-by-4.0
- codeLicense: apache-2.0
- weightsProvenance: Yahoo-trained action-spotting models (dense detection anchors), first
  place in the SoccerNet Challenge 2022, per card.
- datasetProvenance: SoccerNet (action spotting on the SoccerNet dataset, per card and its
  two cited papers).
- commercialUse: yes
- gatingState: candidate
- sources:
  - https://huggingface.co/yahoo-inc/spivak-action-spotting-soccernet
  - https://huggingface.co/api/models/yahoo-inc/spivak-action-spotting-soccernet
  - https://huggingface.co/yahoo-inc/spivak-action-spotting-soccernet/raw/main/README.md
  - https://github.com/yahoo/spivak
  - https://raw.githubusercontent.com/yahoo/spivak/master/LICENSE
- recordedAt: 2026-10-03T01:40:00Z

## HF007 — SoccerChat event/commentary reasoning benchmark

SimulaMet's LoRA fine-tune of Qwen2-VL for soccer video understanding. Measured Apache-2.0 on
the live card, so it is NOT one of the "explicitly non-commercial soccer VLMs" of the
watchlist rule — see the watchlist section below and research notes for the training-data
terms that are recorded separately.

#### SoccerChat

- candidate: SoccerChat
- taskProfiles: football.eventReasoning
- modelUrl: https://huggingface.co/SimulaMet/SoccerChat-qwen2-vl-7b
- revision: 29871536004c0ac788af09cbb87969ab9f6e1410
- modelLicense: apache-2.0
- codeLicense: apache-2.0
- weightsProvenance: LoRA (PEFT) fine-tune of Qwen/Qwen2-VL-7B-Instruct by SimulaMet, per
  card.
- datasetProvenance: SimulaMet/SoccerChat dataset (train plus held-out eval splits, per
  card); the dataset card states its video clips derive from SoccerNet broadcast footage
  under the SoccerNet NDA, with video redistribution/commercial use not permitted.
- commercialUse: yes
- gatingState: candidate
- sources:
  - https://huggingface.co/SimulaMet/SoccerChat-qwen2-vl-7b
  - https://huggingface.co/api/models/SimulaMet/SoccerChat-qwen2-vl-7b
  - https://huggingface.co/SimulaMet/SoccerChat-qwen2-vl-7b/raw/main/README.md
  - https://github.com/simula/SoccerChat
  - https://raw.githubusercontent.com/simula/SoccerChat/main/README.md
  - https://huggingface.co/datasets/SimulaMet/SoccerChat/resolve/main/README.md
- recordedAt: 2026-10-03T01:40:01Z

## HF008 — Streaming commentary ASR portfolio

Two candidates named by the work item: VibeVoice-ASR-Streaming (streaming, speaker-attributed)
and Qwen3-ASR (multilingual).

#### VibeVoice-ASR-Streaming

- candidate: VibeVoice-ASR-Streaming
- taskProfiles: football.commentaryASR.streaming
- modelUrl: https://huggingface.co/microsoft/VibeVoice-ASR-Streaming-1.5B
- revision: 4262d23d8a539a6530cf64fbd0b1751ef9a30853
- modelLicense: mit
- codeLicense: mit
- weightsProvenance: unknown
- datasetProvenance: unknown
- commercialUse: yes
- gatingState: candidate
- sources:
  - https://huggingface.co/microsoft/VibeVoice-ASR-Streaming-1.5B
  - https://huggingface.co/api/models/microsoft/VibeVoice-ASR-Streaming-1.5B
  - https://huggingface.co/microsoft/VibeVoice-ASR-Streaming-1.5B/raw/main/README.md
  - https://github.com/microsoft/VibeVoice
  - https://raw.githubusercontent.com/microsoft/VibeVoice/main/LICENSE
- recordedAt: 2026-10-03T01:40:02Z

#### Qwen3-ASR

- candidate: Qwen3-ASR
- taskProfiles: football.commentaryASR.multilingual
- modelUrl: https://huggingface.co/Qwen/Qwen3-ASR-1.7B
- revision: 7278e1e70fe206f11671096ffdd38061171dd6e5
- modelLicense: apache-2.0
- codeLicense: apache-2.0
- weightsProvenance: large-scale speech training data on the Qwen3-Omni foundation model,
  per card (1.7B and 0.6B family; 52 languages/dialects).
- datasetProvenance: unknown
- commercialUse: yes
- gatingState: candidate
- sources:
  - https://huggingface.co/Qwen/Qwen3-ASR-1.7B
  - https://huggingface.co/api/models/Qwen/Qwen3-ASR-1.7B
  - https://huggingface.co/Qwen/Qwen3-ASR-1.7B/raw/main/README.md
  - https://github.com/QwenLM/Qwen3-ASR
  - https://raw.githubusercontent.com/QwenLM/Qwen3-ASR/main/LICENSE
- recordedAt: 2026-10-03T01:40:03Z

## HF009 — Speaker diarization benchmark

The work-items doc names no specific candidate for HF009. The portfolio status doc
(docs/status/hf-model-portfolio-status.md) names pyannote, and the portfolio research input
pins the repository to pyannote/speaker-diarization-community-1, so that candidate is
recorded here. Gated repository: access requires sharing contact details (auto approval).

#### pyannote

- candidate: pyannote
- taskProfiles: football.commentarySpeakerDiarization
- modelUrl: https://huggingface.co/pyannote/speaker-diarization-community-1
- revision: 3533c8cf8e369892e6b79ff1bf80f7b0286a54ee
- modelLicense: cc-by-4.0
- codeLicense: mit
- weightsProvenance: pyannote `community-1` pretrained diarization pipeline; training and
  tuning ran on the GENCI Jean Zay supercomputer, per card; training corpora not named.
- datasetProvenance: eval benchmarks named on card — AISHELL-4, AliMeeting, AMI (IHM/SDM),
  AVA-AVD, CALLHOME, DIHARD 3, Ego4D, MSDWild, RAMC, REPERE, VoxConverse.
- commercialUse: yes
- gatingState: candidate
- sources:
  - https://huggingface.co/pyannote/speaker-diarization-community-1
  - https://huggingface.co/api/models/pyannote/speaker-diarization-community-1
  - https://huggingface.co/pyannote/speaker-diarization-community-1/resolve/main/README.md
  - https://github.com/pyannote/pyannote-audio
  - https://raw.githubusercontent.com/pyannote/pyannote-audio/main/LICENSE
- recordedAt: 2026-10-03T01:40:04Z

## HF010 — Camera-controlled neural renderer benchmark

Three candidates named by the work item: Wan2.2-Fun-Control-Camera, ReCamMaster, Meridian.

#### Wan2.2-Fun-Control-Camera

- candidate: Wan2.2-Fun-Control-Camera
- taskProfiles: renderer.cinematicReCamera
- modelUrl: https://huggingface.co/alibaba-pai/Wan2.2-Fun-A14B-Control-Camera
- revision: da1f119dcf5626b2fa41219ce42ac175752f3892
- modelLicense: apache-2.0
- codeLicense: apache-2.0
- weightsProvenance: Wan2.2-Fun camera-lens-control weights on base model
  Wan-AI/Wan2.2-I2V-A14B (per card frontmatter; 81-frame/16fps multi-resolution training
  described on card).
- datasetProvenance: unknown
- commercialUse: yes
- gatingState: candidate
- sources:
  - https://huggingface.co/alibaba-pai/Wan2.2-Fun-A14B-Control-Camera
  - https://huggingface.co/api/models/alibaba-pai/Wan2.2-Fun-A14B-Control-Camera
  - https://huggingface.co/alibaba-pai/Wan2.2-Fun-A14B-Control-Camera/raw/main/README.md
  - https://github.com/aigc-apps/VideoX-Fun
  - https://raw.githubusercontent.com/aigc-apps/VideoX-Fun/main/LICENSE
- recordedAt: 2026-10-03T01:40:05Z

#### ReCamMaster

- candidate: ReCamMaster
- taskProfiles: renderer.cinematicReCamera
- modelUrl: https://huggingface.co/KlingTeam/ReCamMaster-Wan2.1
- revision: 4f3f7391743dfd25067ab27e0f1eb8928d11b91d
- modelLicense: apache-2.0
- codeLicense: mit
- weightsProvenance: open checkpoint (step20000.ckpt) of ReCamMaster migrated by its authors
  onto Wan2.1; the paper's internal T2V model is not open-sourced (company policy), per the
  repo README.
- datasetProvenance: MultiCamVideo-Dataset (KwaiVGI, multi-camera synchronized videos rendered
  with Unreal Engine 5 — released with the method, per repo README).
- commercialUse: yes
- gatingState: candidate
- sources:
  - https://huggingface.co/KlingTeam/ReCamMaster-Wan2.1
  - https://huggingface.co/api/models/KlingTeam/ReCamMaster-Wan2.1
  - https://huggingface.co/KlingTeam/ReCamMaster-Wan2.1/raw/main/README.md
  - https://github.com/KwaiVGI/ReCamMaster
  - https://raw.githubusercontent.com/KwaiVGI/ReCamMaster/main/LICENSE
  - https://raw.githubusercontent.com/KwaiVGI/ReCamMaster/main/README.md
- recordedAt: 2026-10-03T01:40:06Z

#### Meridian

- candidate: Meridian
- taskProfiles: renderer.cinematicReCamera
- modelUrl: https://huggingface.co/Viggle/Meridian
- revision: 9c57d46fbb3924cdac553a1005a8597b574b7225
- modelLicense: other (minimax-h3-community-license — MiniMax H3 Community License Agreement
  covering the adapter weights and their outputs)
- codeLicense: apache-2.0
- weightsProvenance: two LoRA adapters (teacher plus a turbo distilled to 3 forwards) on the
  unmodified MiniMaxAI/MiniMax-H3 transformer, shipped by Viggle; geometry stage requires
  VGGT-Omega (gated, FAIR Noncommercial Research License v1, obtained separately), per card.
- datasetProvenance: unknown
- commercialUse: unclear
- gatingState: candidate
- sources:
  - https://huggingface.co/Viggle/Meridian
  - https://huggingface.co/api/models/Viggle/Meridian
  - https://huggingface.co/Viggle/Meridian/raw/main/README.md
  - https://huggingface.co/Viggle/Meridian/resolve/main/LICENSE
  - https://huggingface.co/Viggle/Meridian/resolve/main/LICENSE-CODE
  - https://raw.githubusercontent.com/facebookresearch/vggt-omega/main/LICENSE
- recordedAt: 2026-10-03T01:40:07Z

## HF011 — Novel-view baseline benchmark

#### ViewCrafter

- candidate: ViewCrafter
- taskProfiles: renderer.cinematicReCamera
- modelUrl: https://huggingface.co/Drexubery/ViewCrafter_25
- revision: 35af104d9781e9ed5cdaddfcfbbdca5835e1c36f
- modelLicense: apache-2.0
- codeLicense: apache-2.0
- weightsProvenance: video diffusion model generating consistent novel views (25 frames) from
  single/sparse-image conditioning, per card; no further weight origin stated on the card.
- datasetProvenance: unknown
- commercialUse: yes
- gatingState: candidate
- sources:
  - https://huggingface.co/Drexubery/ViewCrafter_25
  - https://huggingface.co/api/models/Drexubery/ViewCrafter_25
  - https://huggingface.co/Drexubery/ViewCrafter_25/raw/main/README.md
  - https://github.com/Drexubery/ViewCrafter
  - https://raw.githubusercontent.com/Drexubery/ViewCrafter/main/LICENSE
  - https://raw.githubusercontent.com/Drexubery/ViewCrafter/main/README.md
- recordedAt: 2026-10-03T01:40:08Z

## HF012 — Character animation benchmark

#### Wan2.2-Animate

- candidate: Wan2.2-Animate
- taskProfiles: renderer.characterAnimation
- modelUrl: https://huggingface.co/Wan-AI/Wan2.2-Animate-14B
- revision: cb93a225fbaf1ca100f54e79da8f994995b689b3
- modelLicense: apache-2.0
- codeLicense: apache-2.0
- weightsProvenance: Wan2.2-Animate-14B, a unified character animation and replacement model
  built on base model Wan-AI/Wan2.2-I2V-A14B (per card frontmatter and release notes).
- datasetProvenance: unknown
- commercialUse: yes
- gatingState: candidate
- sources:
  - https://huggingface.co/Wan-AI/Wan2.2-Animate-14B
  - https://huggingface.co/api/models/Wan-AI/Wan2.2-Animate-14B
  - https://huggingface.co/Wan-AI/Wan2.2-Animate-14B/raw/main/README.md
  - https://github.com/Wan-Video/Wan2.2
  - https://raw.githubusercontent.com/Wan-Video/Wan2.2/main/LICENSE.txt
- recordedAt: 2026-10-03T01:40:09Z

## HF013 — Joint audio-video benchmark

#### LTX-2.3

- candidate: LTX-2.3
- taskProfiles: renderer.neuralVideo, renderer.audioVideoGeneration, renderer.upscale
- modelUrl: https://huggingface.co/Lightricks/LTX-2.3
- revision: 3c6a4e66e5d0a684231950b9c74dd4ded7b6fadc
- modelLicense: other (ltx-2-community-license-agreement — per card license_link to
  Lightricks/LTX-2 LICENSE-2)
- codeLicense: unknown
- weightsProvenance: LTX-2.3, Lightricks' update to LTX-2 with improved audio/visual quality
  and prompt adherence; DiT-based audio-video foundation model; checkpoint family ltx-2.3-22b
  (dev, distilled, distilled-LoRA) plus spatial/temporal upscalers, per card.
- datasetProvenance: unknown
- commercialUse: unclear
- gatingState: candidate
- sources:
  - https://huggingface.co/Lightricks/LTX-2.3
  - https://huggingface.co/api/models/Lightricks/LTX-2.3
  - https://huggingface.co/Lightricks/LTX-2.3/raw/main/README.md
  - https://github.com/Lightricks/LTX-2
  - https://raw.githubusercontent.com/Lightricks/LTX-2/main/LICENSE
  - https://raw.githubusercontent.com/Lightricks/LTX-2/main/LICENSE-2
  - https://raw.githubusercontent.com/Lightricks/LTX-2/main/LICENSE-2_x
- recordedAt: 2026-10-03T01:40:10Z

## Research-only watchlist

ADR-011 constraint 9: non-commercial research checkpoints remain benchmark/watchlist entries
and cannot silently become production dependencies. The watchlist currently holds DA3-GIANT.
The work-items doc also names "explicitly non-commercial soccer VLMs": the only soccer VLM
named by the portfolio (SoccerChat, HF007) measured Apache-2.0 on its live card and is
therefore NOT watchlisted by its license; no other soccer VLM is currently named, so none has
a row here. A future non-commercial soccer VLM enters this section with gatingState
`watchlist`.

#### DA3-GIANT

- candidate: DA3-GIANT
- taskProfiles: scene.depth, scene.cameraPose
- modelUrl: https://huggingface.co/depth-anything/DA3-GIANT
- revision: 7cd62ae9315b9dff094d2d300e4ad012640607dd
- modelLicense: cc-by-nc-4.0
- codeLicense: apache-2.0
- weightsProvenance: ByteDance Seed Team's Depth Anything 3 flagship (1.15B plain transformer,
  e.g. vanilla DINO encoder, unified depth-ray representation); training data: public academic
  datasets only, per card.
- datasetProvenance: public academic datasets only (specific datasets not named, per card).
- commercialUse: no
- gatingState: watchlist
- sources:
  - https://huggingface.co/depth-anything/DA3-GIANT
  - https://huggingface.co/api/models/depth-anything/DA3-GIANT
  - https://huggingface.co/depth-anything/DA3-GIANT/raw/main/README.md
  - https://github.com/ByteDance-Seed/depth-anything-3
  - https://raw.githubusercontent.com/ByteDance-Seed/depth-anything-3/main/LICENSE
- recordedAt: 2026-10-03T01:40:11Z

## Maintenance

Re-verification: run `scripts/evidence/hf-portfolio/fetch-provenance.sh` (no authentication;
gated repos fall back to `/resolve/`), compare the fetched `sha`/license values against this
ledger and the JSON twin, and update rows whose upstream moved — recording the new revision
and timestamp. Drift between this document and
`scripts/evidence/hf-portfolio/provenance-ledger.json` fails
`packages/testing/test/hf-ledger.test.ts` by design.
