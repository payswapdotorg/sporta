# Historical handoff — superseded as active instruction

The active artifact is `docs/agent-handoff/mvp-and-live-reality-tech-lead.md`. This file remains as historical implementation context and must not be treated as a competing execution plan.

---

# Sporta MVP Reality Engine — Final Tech Lead Handoff

You are the implementation Tech Lead/Orchestrator for `payswapdotorg/sporta`.

The repository is the **sole source of truth**. Do not rely on chat history or undocumented assumptions.

## 0. Mission

Turn Sporta from its verified engineering/productization foundation into the real, customer-visible MVP:

> **Real authorized football MP4 -> real perception -> canonical Sports World Model -> actual Original + Tactical + 3D Game + Anime/NPR videos -> durable artifacts -> HTML5 playback -> Reality Switcher for the same match/session.**

The previous W001-W921 program remains valuable infrastructure. It is **not** the MVP proof. The current web application still contains fixture/in-process/SVG boundaries; the purpose of this program is to replace those boundaries with real media, real reconstruction, real rendering and real user-owned/hosted compute.

## 1. Required reading order

Read these before assigning implementation work:

1. `AGENTS.md`
2. `docs/architecture/architecture-lock.md`
3. `docs/architecture/architecture.md`
4. `docs/architecture/technology-plane.md`
5. `docs/architecture/compute-broker.md`
6. `docs/architecture/ux-architecture.md`
7. `docs/architecture/deployment-architecture.md`
8. `docs/adr/ADR-009-mvp-reality-engine-and-technology-neutrality.md`
9. `docs/roadmap/mvp-reality-engine-roadmap.md`
10. `docs/work-items/mvp-reality-engine-work-items.md`
11. `docs/agent-handoff/mvp-worker-packets.md`
12. `docs/testing/mvp-reality-engine-acceptance.md`
13. `docs/status/mvp-reality-engine-status.md`
14. existing SWM, renderer, control-api, artifact, storage and compute contracts relevant to the selected slice

Then inspect:

- `git status` / current branch;
- recent commits;
- existing package boundaries;
- all contracts touched by the selected wave;
- relevant tests and fixtures.

## 2. Frozen strategic decisions

### A. SWM remains canonical

The Sports World Model is the canonical event representation. Renderers, trackers and external technologies do not become sources of canonical truth.

### B. Technology neutrality is mandatory

No product/domain contract may directly depend on:

- a specific detector;
- a specific tracker;
- a specific ML model;
- a specific renderer implementation;
- a specific game engine;
- a specific GPU type;
- a specific GPU provider.

Everything replaceable enters through a versioned adapter/profile.

### C. Continuous technology evaluation

Sporta must be able to evaluate, compare, replace, ensemble, cascade and fall back between candidate technologies using common benchmarks.

Each candidate must carry:

- version/provenance;
- capabilities;
- resource requirements;
- license/commercial-use status;
- benchmark identity/results;
- cost/throughput evidence;
- failure semantics.

A candidate is promoted through:

```text
candidate
  -> compatibility
  -> benchmark
  -> license/security review
  -> shadow
  -> canary
  -> approved
```

### D. Real video is the MVP artifact

Animated SVG remains a useful diagnostic artifact but is **not** the primary MVP output.

MVP outputs must be normal playable video files.

### E. Real game-engine rendering

The initial game-engine candidate is **Godot 4**, behind a provider-neutral game-engine adapter. Godot itself remains replaceable.

### F. Anime strategy

For MVP, use deterministic/non-photorealistic/cel-shaded 3D rendering using the same canonical SWM scene. Neural video-to-video is a future upgrade, not an MVP dependency.

### G. Compute Broker

All GPU execution goes through the Compute Broker.

Initial adapters:

- Modal;
- Lightning AI;
- RunPod;
- local/self-hosted GPU.

Hugging Face/ZeroGPU is allowed only for bounded experimental workloads.

### H. User-owned compute

Sporta must offer a Compute Connection Center where users can choose/connect infrastructure while staying inside the Sporta UX.

Supported interaction pattern:

```text
Create
 -> Choose compute
 -> Sporta Managed / Connect provider / Local worker
 -> provider-specific guided authorization/setup
 -> verify connection
 -> render
```

Never ask for provider master passwords. Use supported OAuth/authorization where available and otherwise narrow credentials with explicit scope and disconnect/revocation controls.

### I. Future Sporta compute subscription

Do not create a second execution architecture for future subscription compute.

Managed compute is an allowance/concurrency policy over the same Compute Broker contracts used by BYOC/provider adapters.

## 3. Worker lanes

### Worker A — Perception / reconstruction

Owns:

`R001-R005, R201-R208`

Primary result:

```text
real football MP4
 -> player detection
 -> ball detection
 -> tracking / ReID
 -> pitch calibration
 -> team / identity
 -> canonical SWM
```

Candidate research may use TrackLab, SoccerNet Game State Reconstruction, SoccerTrack v2 and other open-source tools, but every adopted code/model/checkpoint/dataset must pass license/provenance review before production promotion.

Worker A must not mutate the SWM contract to accommodate a particular candidate.

### Worker B — Media / compute / platform

Owns:

`R101-R104, R401-R409`

Primary result:

```text
real browser upload
 -> R2 source artifact
 -> normalization
 -> job queue/lifecycle
 -> Compute Broker
 -> actual worker execution
 -> durable output artifact
```

Worker B owns provider credentials, connection state, usage, quotas and infrastructure adapters.

Worker B must not leak provider-specific types into product/domain contracts.

### Worker C — Rendering / product experience

Owns:

`R301-R307, R501-R507`

Primary result:

```text
SWM
 -> Tactical MP4
 -> Godot 3D MP4
 -> Godot Anime/NPR MP4
 -> artifact catalog
 -> HTML5 video
 -> Reality Switcher
```

Worker C owns the user-visible render/watch experience and actual playable outputs.

## 4. Parallel execution protocol

At most **three workers** run concurrently.

The tech lead must not simply dispatch all backlog items at once. Use the following waves.

### Wave 0 — shared-contract freeze — Tech Lead only

Before any worker implementation begins, verify or establish stable versions of:

- TechnologyProfile / TechnologyCandidate;
- BenchmarkRun / EvaluationReport / PromotionRecord;
- PerceptionAdapter;
- ComputeRequest / ComputeQuote / ComputeJob / ComputeProvider;
- SourceAsset / MediaManifest;
- RenderArtifactManifest;
- GameEngineAdapter / RendererAdapter;
- upload/session/job state transitions.

No worker may begin a task that depends on an unfrozen shared contract.

### Wave 1 — parallel foundations

**Worker A:** `R001-R005`

**Worker B:** `R101-R104` + `R401`

**Worker C:** `R301` + `R302`

Integration gate: Tech Lead reviews all contracts and adapter seams before Wave 2.

### Wave 2 — parallel implementations

**Worker A:** `R201-R206`

**Worker B:** `R402-R405`

**Worker C:** `R303-R304`

Integration gate: candidate licensing, capability manifests, output manifests and compute job contracts reviewed.

### Wave 3 — cross-lane integration

**Worker A:** `R207-R208`

**Worker B:** `R406-R409`

**Worker C:** `R305-R307`

Do not let C finalize the product artifact contract until the R306 output manifest is frozen.

### Wave 4 — product integration

**Worker B:** backend portions of `R501-R503`, media persistence, compute hardening.

**Worker C:** `R501-R507` browser/product flow.

**Worker A:** benchmark/evidence remediation only; no shared-contract changes without Tech Lead approval.

Integration gate: clean-browser flow must execute using real user media, not a pre-seeded session.

### Wave 5 — final proof

Tech Lead owns:

`R601-R607`

All workers become **fix-only** lanes. No broad refactor or contract redesign is permitted during the final proof.

## 5. Shared ownership rules

Default ownership:

| Area | Worker A | Worker B | Worker C |
|---|---|---|---|
| Technology Registry | write | read | read |
| Perception adapters | write | read | read |
| SWM contracts | no write without TL | read | read |
| Media/upload API | read | write | consume |
| Compute contracts | consume | write | consume |
| Provider adapters | no | write | consume |
| Renderer contracts | consume | read | write |
| Renderer implementations | no | no | write |
| `apps/web` | no | API-only support | write |
| Browser E2E | evidence | evidence | write |
| ADRs | propose | propose | propose |

If a worker needs a change outside its lane, it raises a dependency request to the Tech Lead instead of editing another lane's canonical files.

Never have two workers independently edit the same contract/document/foundation seam.

## 6. Worker report contract

Every worker must return:

```text
WORKER:
WORK ITEMS:
START COMMIT:
END COMMIT:
CHANGED FILES:
CONTRACT CHANGES:
TESTS:
ACCEPTANCE EVIDENCE:
REAL vs FIXTURE BOUNDARY:
LICENSE / MODEL / CHECKPOINT PROVENANCE:
RESOURCE / COST EVIDENCE:
RISKS:
BLOCKERS:
ARCHITECTURE-DEVIATION PROPOSAL:
```

An architecture deviation proposal is not self-approval. The Tech Lead decides whether an ADR is necessary and whether downstream work must stop.

## 7. Non-negotiable no-drift rules

- Never replace canonical SWM truth with renderer-specific state.
- Never hard-code a technology provider into a product/domain contract.
- Never promote a model because it looks good on one clip.
- Never omit license/model/checkpoint provenance.
- Never make a free GPU tier a hard runtime dependency.
- Never present SVG/PNG/debug artifacts as MVP video.
- Never use fixture-only evidence for the final MVP gate.
- Never generate fake job progress.
- Never claim a renderer exists until it has produced a playable artifact.
- Never silently invent missing tracking facts.
- Never let reality switching change the match/session.
- Never bypass rights enforcement.
- Never request provider master passwords.
- Never copy proprietary football-game assets/code/branding.

## 8. Definition of done

A work item is complete only when:

1. implementation exists;
2. automated tests are appropriate and green;
3. acceptance criteria pass;
4. observable evidence exists;
5. contracts are compatible;
6. documentation is updated;
7. no frozen architecture rule is violated;
8. the Tech Lead records the evidence in the status ledger.

For customer-visible R1-R6 claims, local mocks or isolated fixture tests are not enough.

## 9. Final MVP acceptance — R601-R607

### R601 — Clip A

A clean browser uploads a known-good 30-second authorized football MP4 and reaches completed artifacts.

### R602 — Clip B

A materially different real football clip completes the same path.

### R603 — Real-upload independence

The public golden path does not require a pre-seeded fixture session, developer-only fixture selection, manual DB edits or developer intervention.

### R604 — Four-output gate

The session contains actual playable:

- Original MP4;
- Tactical MP4;
- 3D Game MP4;
- Anime/NPR MP4.

### R605 — Same-event integrity

All four realities derive from the same canonical SWM/session and preserve event ordering/key facts inside the declared MVP envelope.

### R606 — Human visual acceptance

A human confirms that the outputs are real video, visually distinct, recognizably the same match/event, and understandable as a product result.

### R607 — Public MVP acceptance

A fresh public browser completes:

```text
Create
 -> upload real authorized MP4
 -> rights declaration
 -> choose/connect compute
 -> real processing
 -> four real video outputs
 -> Watch
 -> Original
 -> Tactical
 -> 3D
 -> Anime/NPR
 -> switch realities without changing match/session
```

No mocks, fixture-only substitutions, manual database edits or developer-only steps.

The complete acceptance contract is `docs/testing/mvp-reality-engine-acceptance.md`.

## 10. Status discipline

Do not change the old W001-W921 completion ledger merely because this new MVP program is incomplete.

Instead maintain the distinction:

```text
W001-W921 = engineering/productization foundation
R001-R607 = customer-visible MVP proof
```

Only after R601-R607 pass may the repository claim MVP complete.

## 11. First action

Do not start implementation by editing application code.

First:

1. verify the repository is clean and consistent;
2. inspect the current architecture, contracts and new MVP docs;
3. freeze Wave-0 shared contracts;
4. dispatch Wave 1 to Workers A/B/C;
5. require the worker report contract on return;
6. integrate and re-run the acceptance/dependency gates;
7. advance one wave at a time.

Optimize for the shortest path to the first undeniable Sporta demo, while preserving the technology-neutral architecture so today's open-source choices can be replaced or fused with better technology later.

## Handoff continuation

After the R601-R605 technical gate, use `docs/agent-handoff/mvp-user-journey-hardening-tech-lead.md` as the current next-stage handoff. The final product gate is R606/R607 after J001-J015 and human visual/reality-fidelity acceptance.
