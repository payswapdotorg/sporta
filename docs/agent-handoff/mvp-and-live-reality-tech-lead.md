# Sporta MVP + Live Reality — Tech Lead / Orchestrator Handoff

## Mission

You are the implementation Tech Lead/Orchestrator for payswapdotorg/sporta.

The repository is the sole source of truth. Do not rely on prior conversations, unstored assumptions, screenshots, or verbal decisions.

Your mission is to:

1. finish the customer-visible batch MVP through J001-J015 and R606/R607;
2. establish the first real live tactical reality through L001-L017;
3. preserve one canonical Sports World Model across batch, live tracking and broadcast-perception paths;
4. continuously improve the Technology Plane through benchmarkable model candidates without coupling the product to any model vendor;
5. keep technologies/provider choices replaceable and evidence-driven.

## Read first

1. AGENTS.md
2. docs/architecture/architecture-lock.md
3. docs/architecture/architecture.md
4. docs/architecture/technology-plane.md
5. docs/architecture/compute-broker.md
6. docs/adr/ADR-009-mvp-reality-engine-and-technology-neutrality.md
7. docs/adr/ADR-010-live-reality-inputs-and-rendering.md
8. docs/adr/ADR-011-hugging-face-technology-portfolio.md
8. docs/contracts/sports-world-model.md
9. docs/contracts/renderer.md
10. docs/contracts/streaming.md
11. docs/contracts/live-reality.md
12. docs/testing/mvp-user-journey-simulation.md
13. docs/testing/mvp-reality-engine-gate-audit.md
14. docs/research/live-tactical-rendering-research.md
15. docs/roadmap/mvp-and-live-reality-roadmap.md
16. docs/work-items/mvp-and-live-reality-work-items.md
17. docs/status/mvp-and-live-reality-status.md
18. docs/agent-handoff/mvp-and-live-reality-worker-packets.md
19. docs/contracts/technology-task-profiles.md
20. docs/research/hugging-face-sporta-model-portfolio.md
21. docs/work-items/hf-model-portfolio-work-items.md
22. docs/status/hf-model-portfolio-status.md

## Reality-engine baseline

The existing system has real MP4 generation, Watch, Reality Switching, Compute Broker foundations and technology evaluation. Do not discard this.

The prior gate also exposed a real fidelity issue: when heuristic perception produced an empty/default SWM, 3D Game and Anime/NPR could become identical across materially different clips. That remains a blocker for a strong reality-fidelity claim.

The audited Create flow also required extra render API dispatches for four realities. J004 must remove that hidden knowledge.

## Operating model

Use at most three workers concurrently.

### Worker A — Intelligence / live state

Owns:
- J012;
- L003, L004, L007, L008, L010, L011, L012;
- perception/reconstruction technology evaluation;
- no public UX ownership.

### Worker B — Platform / media / live transport

Owns:
- J005, J007, J014;
- L002, L006, L009, L014 platform/recovery pieces;
- provider connections, storage, queues, live transport, telemetry and deployment.

### Worker C — Rendering / experience

Owns:
- J004, J006 UI/render-facing pieces, J013;
- L005, L013, L014 presentation pieces;
- tactical/3D visual quality and browser live experience.

Tech Lead owns shared contracts, cross-worker decisions, final gates and any ADR.

## Hugging Face model-discovery track

The HF portfolio is part of the active implementation program, not background research.

The first P1 candidates are:
- RF-DETR SoccerNet for soccer object detection;
- MapAnything for metric 3D/camera/depth;
- SoccerChat for soccer event/commentary reasoning;
- VibeVoice/Qwen3-ASR for live/multilingual commentary;
- Spivak for temporal event spotting;
- Wan2.2-Fun-Control-Camera, ReCamMaster and Meridian for cinematic re-camera;
- ViewCrafter for novel-view comparison.

Research/watchlist candidates remain isolated from production: SAM3, DA3-GIANT and explicitly non-commercial soccer VLMs.

Model research must run alongside the existing J/L waves where file ownership permits. It must not block the customer-visible golden path unless a benchmark proves that a candidate is required for an acceptance gate.

## Shared contract freeze

Before implementation waves, verify that these boundaries are frozen:

- one canonical SWM for batch and live;
- LiveObservation and LiveWorldState semantics;
- event-time versus ingest-time;
- watermark/lag semantics;
- bounded temporal reorder window;
- interpolation/extrapolation provenance;
- multi-source conflict policy;
- live renderer input;
- render-frame telemetry;
- session identity and live-to-replay continuity;
- multi-reality Create request;
- durable result state.

Workers must request contract changes rather than patching around ambiguity.

## Worker output contract

Every worker reports:

WORK ITEMS / CHANGED FILES / TESTS / ACCEPTANCE EVIDENCE / CONTRACT CHANGES / REAL-vs-FIXTURE / LICENSE-PROVENANCE / LATENCY-TELEMETRY / RISKS / BLOCKERS / DEVIATIONS

No worker self-closes a gate.

## Wave plan

### Wave 0 — Tech Lead only

Read the repository and current code state. Freeze/verify contracts. Inspect dirty files and recent commits. Identify any architecture drift before dispatch.

Produce no speculative broad refactor.

### Wave 1 — parallel

Worker A:
J012 investigation + L003/L004 design + L010 benchmark harness + HF001/HF003-HF009 first P1 benchmarks.

Worker B:
J005 + J007 + L002 + HF002 provenance ledger + HF008 ASR runtime plumbing.

Worker C:
J004 + L005 implementation scaffold + HF010-HF013 renderer benchmark harness.

### Wave 2 — parallel

Worker A:
J012 implementation + L007 + L010 + L011 + continue HF003-HF009 benchmark/integration.

Worker B:
J006 backend + J014 + L006 + L009 when feed access exists.

Worker C:
J006 UI + J013 + L005 + L013 + HF010-HF014 camera/render integration.

### Wave 3 — parallel

Worker A:
J008-J010 + L012.

Worker B:
J011 + L014 persistence/recovery.

Worker C:
renderer fidelity + L013 + L014 presentation.

### Wave HF-C — Technology promotion

Tech Lead owns HF015. A candidate may move to production only after the benchmark, resource, provenance/license, reproducibility and failure-envelope evidence is recorded.

HF work can remain candidate/benchmarked/canary without changing the domain contracts.

### Wave 4 — integration

Run:
- one-submission four-reality browser journey;
- highest-priority HF candidate benchmark reports;
- Technology Registry/profile compatibility checks;
- real durable restart/redeploy recovery;
- synthetic/replay live tactical browser journey;
- meaningful SWM sensitivity;
- dropout/reconnect tests;
- latency telemetry;
- live-to-replay continuity.

Do not allow shared-contract drift.

### Wave 5 — final gates

Tech Lead owns:

1. J015
2. R606
3. R607
4. L015
5. L016
6. L017

All workers are fix-only. No broad refactors.

## Live implementation strategy

Do not begin by solving the hardest problem.

### First

Build:

deterministic tracking stream -> LiveObservation -> live SWM -> tactical renderer -> browser

This proves the architecture.

### Second

Replay a legally permitted open/public tracking dataset through the exact same path.

### Third

Connect one authorized external tracking provider when feed access exists.

### Fourth

Benchmark broadcast reconstruction:

authorized broadcast -> detection/tracking/calibration -> LiveObservation -> same SWM -> same tactical renderer

### Fifth

Fuse tracking + broadcast evidence when both are available.

### Sixth

Make 3D consume the same live SWM.

### Seventh

Persist live observations/world versions so the live session becomes a normal replay.

## Technology selection principles

Candidates found by research include:
- soccer-tactical-vision — MIT, broadcast-to-top-down reference; not yet production-validated on real broadcast video.
- soccertracking — MIT, game-state reconstruction reference.
- TrackLab — MIT, tracking/re-identification framework.
- TVCalib — MIT, football camera calibration reference.
- Football-Tracking-Visualizer — MIT, Unity 3D tracking-data renderer.
- SkillCorner/opendata — public broadcast tracking dataset/replay reference; verify intended data use.
- SoccerNet/sn-gamestate — GPL-3.0 research reference; do not silently vendor into a proprietary runtime.

License of code and license/terms of checkpoints, datasets, weights and assets must remain separately recorded.

## Non-negotiable acceptance

### Batch

A fresh browser must complete:

sign up -> Creator -> Create -> authorized real upload -> rights -> select four realities -> compute -> submit once -> processing -> four real outputs -> Watch -> switch realities -> Library/Jobs -> role switch -> refresh/redeploy -> return

No developer API calls, manual DB edits, hidden fixtures or operator intervention.

### Reality fidelity

Two materially different real clips must produce meaningfully different reconstructed football state. Empty/default SWM cannot satisfy the final derived-reality gate.

### Live tactical

A fresh browser must show a live tactical state driven by continuously changing timestamped world state.

The tactical view must visibly respond to meaningful player/ball changes and preserve identity continuity within the declared acceptance envelope.

Measured:
- source-to-ingest latency;
- ingest-to-SWM latency;
- SWM-to-render latency;
- end-to-end presentation latency;
- update rate;
- dropout/reconnect behavior;
- extrapolation usage;
- identity switches;
- rendered frame drops.

A demo that loops canned avatars without changing canonical SWM state does not pass.

### Live/replay

After the live window closes or the browser reloads, the same match/session must remain addressable as replay with the same world versions/timebase.

## Hugging Face production rule

Hugging Face model cards and downloads are discovery inputs, not production approval.

Every candidate must be evaluated for:
- model/checkpoint license;
- code license;
- dataset/weights/assets provenance;
- commercial-use status;
- actual Sporta quality;
- identity/temporal stability;
- latency/throughput/GPU memory;
- cost;
- failure envelope.

Neural re-camera is primarily a replay/highlight/cinematic path. Live tactical remains real-time/procedural-first until measured otherwise.

## External research boundary

The research note in docs/research/live-tactical-rendering-research.md contains the discovered public evidence and candidate repositories.

Commercial systems may be studied through public documentation and observable product behavior. Do not copy proprietary code/assets/credentials or bypass access controls.

The repository's rights policy continues to govern every input and derived artifact.

## Session completion

At the end of every Tech Lead session:

1. update the relevant status ledger(s), including HF status when model work advances;
2. record actual evidence, not intentions;
3. record blockers and external dependencies;
4. update the next safe wave;
5. leave no important decision only in chat.
