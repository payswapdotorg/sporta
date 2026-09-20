# Historical worker packets — superseded as active instructions

The active worker packets are `docs/agent-handoff/mvp-and-live-reality-worker-packets.md`. This file remains as historical context for the completed R-series.

---

# Sporta MVP Reality Engine — Three-Worker Packets

This file is the execution packet used by the Tech Lead when dispatching the three workers concurrently. It is subordinate to `AGENTS.md`, `architecture-lock.md`, ADR-009, the technology/compute architecture docs, and the MVP work-item ledger.

## Packet A — Perception / reconstruction

**Work items:** R001-R005, R201-R208

**Mission:** Make real football video become trustworthy Sporta SWM state without binding the product to one model/vendor.

### Inputs

- frozen SWM contracts;
- existing W201-W206 implementations as baselines only;
- accepted perception adapter contracts;
- benchmark fixtures;
- candidate open-source stacks after license review.

### Allowed technology choices

TrackLab, SoccerNet Game State Reconstruction, SoccerTrack v2 and other candidates may be evaluated/adapted where license/model/checkpoint terms permit. Do not copy source code blindly. Record exact version, license, checkpoint provenance and commercial-use status in the Technology Registry.

### Deliverables

- adapter interfaces and candidate registry;
- deterministic benchmark runner;
- real detector/tracker/ball/calibration/team/identity adapters;
- real-video → SWM pipeline;
- reconstruction report containing quality/confidence/provenance and known failure modes.

### Acceptance evidence

A real authorized clip, not a checked-in fixture, must pass through the adapter boundary and emit a replayable SWM reconstruction. At least two materially different clips must be used before final R208 acceptance.

### Forbidden

- changing SWM semantics to fit one model;
- exposing provider-specific model types to product code;
- promoting a candidate without benchmark/license records;
- silently filling missing facts.

## Packet B — Media / compute / platform

**Work items:** R101-R104, R401-R409

**Mission:** Make a real browser upload become a durable job backed by an actually selected compute provider and persistent playable artifacts.

### Inputs

- W902 identity/auth;
- W912 R2 storage;
- W914 existing compute seam;
- stable Compute Broker contracts;
- provider research in `docs/architecture/compute-broker.md`.

### Initial provider adapters

- Modal — initial free/low-cost development path;
- Lightning AI — alternate free-development path;
- RunPod — user-owned/pay-as-you-go path;
- local/self-hosted GPU — developer path;
- Hugging Face/ZeroGPU — bounded experiment path only.

The provider registry must not make any one provider a domain dependency.

### Deliverables

- browser MP4 upload with constraints and rights;
- media normalization/manifest;
- real job lifecycle;
- original MP4 artifact;
- Compute Broker;
- provider adapters;
- Compute Connection Center;
- user/provider quote and selection flow;
- BYOC usage ledger;
- future Sporta managed-compute seam.

### Acceptance evidence

A clean browser can upload a real authorized MP4, observe a real queued/running/completed lifecycle, and retrieve a durable original artifact. At least one external/user-owned compute adapter must execute a real render job before the compute path is considered MVP-ready.

### Forbidden

- storing master provider passwords;
- pretending provider limits are unlimited;
- embedding Modal/RunPod/etc. names into product/domain contracts;
- fake progress;
- hidden provider spend.

## Packet C — Rendering / product experience

**Work items:** R301-R307, R501-R507

**Mission:** Turn one canonical SWM into four actual playable realities and expose them through the product.

### Initial renderer strategy

- Tactical: deterministic 2D/3D scene renderer producing actual MP4.
- 3D Game: Godot 4 initial game-engine adapter.
- Anime/NPR: same Godot scene graph with non-photorealistic/cel-shaded rendering.
- Original: normalized source MP4 as the canonical original reality.

Godot is a replaceable implementation behind the game-engine/renderer contracts.

### Deliverables

- actual tactical video renderer;
- game-engine adapter;
- actual 3D game-style renderer;
- actual Anime/NPR renderer;
- event/camera director using SWM + commentary semantics;
- actual MP4 encoder/output manifests;
- visual correctness gate;
- real Create Studio upload/render experience;
- processing UI backed by true job state;
- unified artifact catalog;
- HTML5 Watch player;
- Reality Switcher;
- compute/cost UX;
- clean-browser golden path.

### Acceptance evidence

A real uploaded clip must yield four actual playable video files, not SVG review artifacts. The four outputs must be materially different visually while preserving the same event ordering and canonical match/session identity.

### Forbidden

- SVG as the primary MVP player/output;
- renderer-specific event truth;
- fabricated progress;
- fake video placeholders;
- switching to a different match/session when changing realities.

## Common worker report template

Every worker must report exactly:

```text
WORKER:
ITEMS:
STARTING_COMMIT:
ENDING_COMMIT:
CHANGED_FILES:
CONTRACT_CHANGES:
TESTS:
ACCEPTANCE_EVIDENCE:
REAL-VS-FIXTURE BOUNDARY:
LICENSE/MODEL PROVENANCE:
RESOURCE/COST EVIDENCE:
RISKS:
BLOCKERS:
ARCHITECTURE-DEVIATION PROPOSAL:
```

If `ARCHITECTURE-DEVIATION PROPOSAL` is non-empty, the worker must not silently implement the deviation. The Tech Lead decides whether an ADR is required.

## Integration discipline

Workers must keep their commits narrowly scoped to their lane. The Tech Lead reviews and integrates commits; workers do not edit another lane's canonical files to “make integration easier.”

A worker may consume another lane's API only through the frozen contract and must use a temporary local stub only for isolated development. Such a stub cannot be used as acceptance evidence.
