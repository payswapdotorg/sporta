# Sporta Agent Operating Contract

## Mission

Build Sporta into a production-grade sports reality rendering platform whose **customer-visible MVP is real**: an authorized football MP4 enters Sporta, is reconstructed into the canonical Sports World Model, produces actual Original/Tactical/3D Game/Anime-NPR video outputs, and those realities can be watched and switched for the same match.

The existing W001-W921 foundation remains valuable, but the MVP Reality Engine program is now the primary implementation program. Do not treat fixture-only, in-process, SVG-only, or adapter-only evidence as sufficient for MVP completion.

## Authority hierarchy

1. `docs/architecture/architecture-lock.md` — frozen architectural constraints unless the explicit architecture-change procedure is followed.
2. `docs/architecture/architecture.md` — canonical architecture and boundaries.
3. `docs/architecture/technology-plane.md` — canonical technology-adapter/evaluation architecture.
4. `docs/architecture/compute-broker.md` — canonical provider-neutral compute and BYOC boundary.
5. `docs/contracts/` — machine-facing domain/interface contracts.
6. `docs/adr/` — accepted architecture decisions; ADR-009 is the current MVP Reality Engine decision.
7. `docs/roadmap/` — sequencing and gates.
8. `docs/work-items/` — executable backlog and dependencies.
9. Code/tests — implementation evidence; code never silently overrides frozen architecture/contracts.
10. Research notes — evidence, never authority over accepted architecture.

## Tech-lead operating procedure

At the beginning of every session:

1. Read this file and the architecture lock.
2. Read `docs/agent-handoff/mvp-reality-engine-tech-lead.md`.
3. Read `docs/agent-handoff/mvp-worker-packets.md`.
4. Read `docs/work-items/mvp-reality-engine-work-items.md` and the current status ledger.
5. Inspect the current repository state, recent commits, dirty files, and existing contracts.
6. Identify the smallest dependency-safe wave that advances the MVP golden path.
7. Freeze or verify all shared contracts before dispatching workers.
8. Dispatch at most three workers concurrently, one ownership lane each.
9. Require each worker to report: changed files, tests, acceptance evidence, contract changes, risks, and proposed deviations.
10. Review worker outputs against architecture, ADRs, contracts, work-item acceptance, and real customer-visible evidence.
11. Integrate only conforming work. Resolve contract conflicts before merging downstream work.
12. Update status only after the tech lead verifies executable evidence.
13. End each session with the next safe wave and explicit blockers recorded in the repository.

## Three-worker lanes

### Worker A — Perception / reconstruction

Owns the Technology Registry/evaluation foundation and real football reconstruction adapters: `R001-R005`, `R201-R208`.

May add or replace model implementations behind frozen adapter contracts. Owns no public web shell and must not redefine the SWM.

### Worker B — Media / compute / platform

Owns real browser media ingress and artifact lifecycle plus Compute Broker/provider integrations: `R101-R104`, `R401-R409`.

Owns provider credentials/connections, quotas, usage accounting, worker orchestration, and deployment seams. Must not embed provider-specific behavior in product/domain contracts.

### Worker C — Rendering / product experience

Owns actual visual realities and the browser experience: `R301-R307`, `R501-R507`.

Initial renderer candidate is Godot 4 behind the stable renderer/game-engine adapter. Owns actual MP4 production, HTML5 playback, Reality Switcher, and the end-user render UX.

### Tech Lead integration lane

Owns R6 `R601-R605`: two real-clip end-to-end proofs, same-event integrity, human visual acceptance, and public MVP acceptance.

Workers may be temporarily assigned isolated fixes during R6 only when the tech lead proves there is no shared-contract collision.

## Dependency-safe concurrency

The three lanes are intentionally parallel, but only after shared contracts are frozen.

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

Start with `docs/agent-handoff/mvp-reality-engine-tech-lead.md`, then `docs/agent-handoff/mvp-worker-packets.md`, then `docs/testing/mvp-reality-engine-acceptance.md`, then inspect `docs/status/mvp-reality-engine-status.md` and dispatch only the next dependency-safe wave.