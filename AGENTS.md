# Sporta Agent Operating Contract

## Mission

Build Sporta into a production-grade sports reality rendering platform whose **customer-visible MVP is real**: an authorized football MP4 enters Sporta, is reconstructed into the canonical Sports World Model, produces actual Original/Tactical/3D Game/Anime-NPR video outputs, and those realities can be watched and switched for the same match.

The existing W001-W921 foundation remains valuable, but the MVP Reality Engine program is now the primary implementation program. Do not treat fixture-only, in-process, SVG-only, or adapter-only evidence as sufficient for MVP completion.

## Authority hierarchy

1. `docs/architecture/architecture-lock.md` — frozen architectural constraints unless the explicit architecture-change procedure is followed.
2. `docs/architecture/architecture.md` — canonical architecture and boundaries.
3. `docs/architecture/technology-plane.md` — canonical technology-adapter/evaluation architecture.
4. `docs/architecture/compute-broker.md` — canonical provider-neutral compute and BYOC boundary.
5. `docs/contracts/` — machine-facing domain/interface contracts, including `docs/contracts/live-reality.md`.
6. `docs/adr/` — accepted architecture decisions; ADR-009 covers the MVP Reality Engine, ADR-010 covers live reality inputs/rendering, and ADR-011 covers the approved Hugging Face technology portfolio.
7. `docs/roadmap/` — sequencing and gates.
8. `docs/work-items/` — executable backlog and dependencies.
9. Code/tests — implementation evidence; code never silently overrides frozen architecture/contracts.
10. Research notes — evidence, never authority over accepted architecture.

## Tech-lead operating procedure

At the beginning of every session:

1. Read this file and the architecture lock.
2. Read `docs/agent-handoff/mvp-and-live-reality-tech-lead.md`.
3. Read `docs/work-items/mvp-and-live-reality-work-items.md` and `docs/status/mvp-and-live-reality-status.md`.
4. Read `docs/contracts/live-reality.md`, `docs/contracts/technology-task-profiles.md`, ADR-010, ADR-011, the live-reality research note, and the Hugging Face model portfolio research.
5. Inspect the current repository state, recent commits, dirty files, and existing contracts.
6. Identify the smallest dependency-safe wave in the active handoff.
7. Freeze or verify all shared contracts before dispatching workers.
8. Dispatch at most three workers concurrently, one ownership lane each.
9. Require each worker to report: changed files, tests, acceptance evidence, contract changes, rights/license provenance, latency evidence where applicable, risks, blockers, and deviations.
10. Review worker outputs against architecture, ADRs, contracts, work-item acceptance, and real customer-visible evidence.
11. Integrate only conforming work. Resolve contract conflicts before merging downstream work.
12. Update the active status ledger only after the tech lead verifies executable evidence.
13. End each session with the next safe wave and explicit blockers recorded in the repository.

Historical Reality Engine/journey handoffs remain useful evidence but are not competing active instructions.

## Three-worker lanes

The active J/L/HF program uses these ownership lanes:

### Worker A — Intelligence / live state

Owns J012 and L003/L004/L007/L008/L010/L011/L012 plus HF001, HF003-HF009. Owns perception/reconstruction and intelligence technology evaluation and the canonical observation-to-SWM seam. Does not own public web UX.

### Worker B — Platform / media / live transport

Owns J005/J007/J014 and L002/L006/L009 plus the platform/recovery side of L014 and HF002/HF008 runtime/provenance plumbing. Owns provider connections, storage, queues, live transport, telemetry, deployment and model provenance packaging.

### Worker C — Rendering / experience

Owns J004/J006/J013 and L005/L013 plus the presentation side of L014 and HF010-HF014. Owns tactical/3D visual quality, neural re-camera experiments, Camera Director integration and browser live experience.

### Tech Lead integration lane

Owns shared contracts, cross-lane decisions, J015, R606/R607 and L015-L017.

### Historical foundation ownership

The original R-series ownership remains useful when touching those areas: A for perception/technology, B for media/compute/platform, C for rendering/product. The active J/L handoff is authoritative for current sequencing.

### Tech Lead integration lane

Owns R6 `R601-R605`: two real-clip end-to-end proofs, same-event integrity, human visual acceptance, and public MVP acceptance.

Workers may be temporarily assigned isolated fixes during R6 only when the tech lead proves there is no shared-contract collision.

## Dependency-safe concurrency

The three lanes are intentionally parallel, but only after shared contracts are frozen. For the current program, the wave plan in `docs/agent-handoff/mvp-and-live-reality-tech-lead.md` supersedes the legacy R-series wave ordering below.

### Wave 0 — contract freeze / no parallel implementation

Tech Lead verifies or creates the stable contracts for:

- TechnologyCandidate / TechnologyProfile;
- BenchmarkRun / EvaluationReport / PromotionRecord;
- PerceptionAdapter;
- ComputeRequest / ComputeQuote / ComputeJob / ComputeProvider;
- SourceAsset / MediaManifest / RenderArtifactManifest;
- GameEngineAdapter / RendererAdapter;
- upload/session/job transitions.

No worker starts implementation against an unfrozen shared shape.

### Wave 1 — parallel foundations

Worker A: `R001-R005`

Worker B: `R101-R104` plus Compute Broker contract `R401`

Worker C: `R301` tactical renderer + `R302` game-engine adapter contract

### Wave 2 — parallel implementations

Worker A: `R201-R206`

Worker B: `R402-R405`

Worker C: `R303-R304`

### Wave 3 — cross-lane integration

Worker A: `R207-R208`

Worker B: `R406-R409`

Worker C: `R305-R307` and begin `R501-R503` only after R306 manifest/output contracts are frozen

### Wave 4 — product integration

Worker A: evidence/benchmark remediation only; no new domain contract changes unless TL-approved

Worker B: `R501` backend portions, persistence/delivery support, real compute hardening

Worker C: `R501-R507`

### Wave 5 — MVP proof

Tech Lead: `R601-R605`

All workers become fix-only lanes. No architectural refactoring is allowed during final proof unless an ADR is required and the gate is explicitly reset.

## Shared-file ownership rules

Never allow concurrent workers to edit the same canonical contract/document or the same foundational app seam.

Default ownership:

| Area | A | B | C |
|---|---|---|---|
| Technology registry | write | read | read |
| Perception adapters | write | read | read |
| SWM contracts | no write without TL | read | read |
| Media/upload API | read | write | consume |
| Compute contracts | consume | write | consume |
| Provider adapters | no | write | consume |
| Renderer contracts | consume | read | write |
| Renderer implementations | no | no | write |
| `apps/web` | no | API-only support | write |
| E2E acceptance | contribute evidence | contribute evidence | write browser tests |
| ADRs | propose | propose | propose |

If a worker needs a shared-file change owned by another lane, it raises a dependency request instead of editing around it.

## No-drift rules

- Preserve the canonical SWM; never introduce renderer-specific canonical truth.
- No core product/domain contract may depend directly on a model, tracker, renderer, game engine, GPU type, GPU provider, or cloud vendor.
- Every replaceable technology enters through a versioned adapter with capability/resource/version/provenance/license metadata.
- Candidate technology must be benchmarkable before production promotion.
- Support replacement, ensemble, cascade, and fallback strategies.
- Do not make SVG artifacts the MVP video output.
- Do not make fixture libraries stand in for user-uploaded media at final acceptance.
- Do not claim progress unless backed by an actual job state.
- Do not claim a renderer unless it has generated a playable artifact.
- Do not expose a provider master password; provider connections use supported authorization or narrow credentials.
- Do not let provider free tiers become hard dependencies.
- Do not display loopback/in-process transport as public live network delivery.
- Do not expose private source media or artifacts without authorization.
- Preserve rights/authorization as a first-class ingestion/publication boundary.
- No proprietary sports-game code/assets/branding may become a dependency.

## Product UX freedom

Workers may innovate on layout, storytelling, visual identity, motion, renderer controls, and setup UX. They may not redefine domain truth, rights semantics, authority, capability states, job states, or delivery guarantees.

## Definition of done

A work item is complete only when implementation exists, relevant automated tests exist, acceptance criteria pass, observability/evidence exists, contracts remain compatible, documentation is updated, and the tech lead records evidence in the status ledger.

For R1-R6 customer-visible claims, fixture-only or mocked evidence is insufficient. Evidence must cross the actual claimed boundary.

## Architecture changes

If implementation reveals an infeasible frozen decision, stop the affected work. Create an ADR documenting the problem, alternatives, impact, migration/compatibility plan and acceptance delta. Only the tech lead may revise the architecture lock after the ADR is accepted.

## First execution command

Start with `docs/agent-handoff/mvp-and-live-reality-tech-lead.md`. Then read `docs/work-items/mvp-and-live-reality-work-items.md` and `docs/status/mvp-and-live-reality-status.md`. Use older handoffs, roadmaps and status ledgers only as historical evidence.

## Current program precedence

The active implementation program is `docs/agent-handoff/mvp-and-live-reality-tech-lead.md`. It combines J001-J015 batch MVP hardening, L001-L017 live reality, and HF001-HF015 technology discovery/benchmark/promotion. Do not close R606/R607 while batch fidelity/durability/journey gates remain unresolved, do not close L015-L017 without real live state, latency, continuity and recovery evidence, and do not promote HF candidates without benchmark/provenance/license evidence.

## No-conversation-dependency rule

The repository is the sole source of truth. Any decision required for implementation must be captured in an ADR, contract, roadmap, work item, status ledger, benchmark, test, or handoff. Chat history is not an implementation dependency.
