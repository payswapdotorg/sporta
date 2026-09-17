# ADR-009 — MVP Reality Engine and Technology Neutrality

**Status:** Accepted
**Date:** 2026-09-17

## Context

The completed W001-W921 program established strong contracts, a Sports World Model, renderer seams, a web product shell, hosted control/data services, and a beta deployment. The public product experience exposed a critical gap: the delivered visual path is still largely a fixture/in-process review system, with animated-SVG artifacts standing in for the promised sports-video realities. The MVP therefore requires a new implementation program focused on observable product results rather than completion of additional architectural seams.

At the same time, perception, tracking, rendering, game-engine, model, and GPU technology will evolve quickly. Sporta must be able to adopt better technology without changing the product contract, SWM, web product, or control plane.

## Decision

Sporta will add an explicit **Technology Plane** and **Technology Evaluation Plane** while preserving the existing frozen SWM-centered architecture.

### Technology Plane

Every replaceable technology enters Sporta through a versioned adapter. This includes:

- player/object detectors;
- ball detectors;
- trackers and re-identification systems;
- pitch/camera calibration systems;
- commentary/ASR systems;
- renderers;
- game engines;
- codec/encoding implementations;
- GPU execution providers.

Product and domain contracts must never depend directly on a concrete model, framework, renderer, engine, or GPU provider.

Adapters must declare capability, version, provenance, resource requirements, execution requirements, license/commercial constraints, failure semantics, and benchmark identity.

### Technology Evaluation Plane

Sporta will maintain reproducible benchmark suites that evaluate candidate technologies on the same frozen fixtures and required metrics. Evaluation dimensions include, where applicable:

- task quality/accuracy;
- temporal stability;
- identity continuity;
- geometric correctness;
- visual quality;
- latency/throughput;
- VRAM/CPU/storage requirements;
- cost;
- failure rate;
- determinism/reproducibility;
- security/isolation characteristics;
- license/commercial-use constraints;
- maintenance/health metadata.

Candidates may be used as replacement, ensemble, cascade, fallback, or specialist components. Promotion into an approved production profile requires benchmark and compatibility evidence.

### MVP Reality Engine

The MVP will prioritize a real end-to-end result:

`authorized football video -> real perception -> SWM -> real renderers -> actual video artifacts -> R2 -> HTML5 playback -> Reality Switcher`

The first MVP must produce real outputs for:

1. Original;
2. Tactical;
3. 3D game-style;
4. Anime/stylized.

The first 3D and Anime implementations may use deterministic/procedural game-engine rendering and non-photorealistic shading. Neural video synthesis is an upgrade path, not an MVP dependency.

### Compute abstraction

GPU execution is a user-owned or Sporta-managed resource selected through a Compute Broker. Initial candidate adapters include Modal, Lightning AI, RunPod, Hugging Face/ZeroGPU for bounded experiments, and future providers.

A compute request describes workload requirements rather than a provider name. The broker selects an eligible provider/resource according to configured constraints such as capability, VRAM, region, budget, expected queue time, privacy, and availability.

### User-owned compute UX

Sporta will provide a Compute Connection Center inside the product. Users can connect a provider account through OAuth, an embedded/provider authorization surface, or a narrowly scoped API credential flow where required. Sporta must never require or store the user's provider master password.

The product will eventually support both:

- bring-your-own-compute (BYOC), where users pay/consume their provider allowance;
- Sporta-managed compute subscriptions with usage tiers and limits.

These options use the same Compute Contract and Compute Broker, so the product experience does not depend on a specific provider.

## Consequences

Positive:

- the MVP optimizes for a visible customer result;
- existing SWM/control/web architecture remains reusable;
- better open-source technology can be adopted without rewriting product contracts;
- multiple GPU providers can compete on cost, speed, quality, and availability;
- user-owned GPU compute becomes a first-class product capability;
- Sporta can eventually sell managed compute without changing the rendering workflow.

Tradeoffs:

- adapter and evaluation infrastructure becomes a first-class engineering surface;
- reproducible benchmark fixtures must be maintained;
- licensing review becomes part of technology promotion;
- the MVP requires a real GPU execution path rather than relying on serverless web infrastructure alone.

## Architecture-lock compatibility

This ADR does not weaken the architecture lock. It makes the already-frozen vendor-neutrality and renderer-plugin decisions operationally enforceable and adds the explicit MVP delivery and technology-evaluation planes needed to fulfill the product thesis.
