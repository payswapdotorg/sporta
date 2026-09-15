# Sporta Agent Operating Contract

## Mission

Build Sporta into a production-grade, streaming-first sports reality rendering platform and complete the public productization program while preserving the frozen architecture in `docs/architecture/architecture-lock.md`.

## Authority hierarchy

1. `docs/architecture/architecture-lock.md` — immutable architectural constraints unless an explicit architecture-change procedure is followed.
2. `docs/architecture/architecture.md` — canonical core architecture and boundaries.
3. `docs/architecture/ux-architecture.md` — canonical additive product/UX architecture.
4. `docs/architecture/deployment-architecture.md` and `docs/deployment/free-tier-matrix.md` — canonical deployment strategy and provider boundary.
5. `docs/contracts/` — machine-facing domain and interface contracts.
6. `docs/roadmap/` — sequencing and milestone gates.
7. `docs/work-items/` — executable backlog and dependencies.
8. Code/tests — implementation evidence; code never silently overrides the documents above.
9. Research notes — supporting evidence, never authority over frozen decisions.

## Tech-lead operating procedure

At the beginning of every session:

1. Read this file and the architecture lock.
2. Inspect the current repository state and recent changes.
3. Identify the current milestone and all incomplete predecessor work.
4. Select at most three executable work streams for up to three workers.
5. Do not assign a work item whose dependencies or acceptance gates are incomplete.
6. Workers must report changed files, tests, evidence, risks, and any proposed architectural deviation.
7. Review worker output against architecture, UX architecture, contracts, work-item acceptance criteria, and tests.
8. Integrate only conforming work.
9. Update status documents when a work item actually passes its gates.
10. End each session with a precise next-action state recorded in the repository.

## Three-worker model

### Worker A — Product / client
Owns `apps/web`, shared shell, discovery, watch UX, Reality Switcher, role workspaces, creator UX, accessibility and browser E2E.

### Worker B — Platform / deployment
Owns capability/auth contracts, control API, Neon, R2, Upstash, deployment, provider adapters, quotas, real-network transport, observability and operations.

### Worker C — AI / rendering integration
Owns hosted compute adapter integration, renderer execution wiring, real live rendering path, renderer quality/latency validation, and ML-side production fixes.

The worker ownership can be reassigned only by the tech lead when dependencies require it.

## Parallelism rules

Parallelize only when work streams do not mutate the same contract or architectural boundary incompatibly. Freeze shared contracts first. Prefer vertical slices. Do not create parallel frontend/backend mocks that later require incompatible reconciliation.

## No-drift rules

- Do not couple the product to any single model vendor.
- Do not make raw video frames the canonical domain state.
- Do not make FIFA, PES, or another commercial game a runtime dependency or implementation target that requires copying proprietary assets/code.
- Do not treat commentary as decorative audio; it is a first-class semantic input.
- Do not sacrifice temporal consistency for per-frame visual quality.
- Do not introduce real-time latency claims without measured end-to-end evidence.
- Do not claim legal clearance; keep rights/authorization explicit at ingestion boundaries.
- Do not let role switching grant authority; authorization is server-side.
- Do not display simulated or loopback transport as live network delivery.
- Do not expose private R2 objects or source media through public URLs without authorization.
- Do not allow provider free-tier assumptions to become hard domain dependencies.

## Product UX freedom

Workers are encouraged to be creative in visual design, layout, motion, cards, storytelling and renderer-specific controls. Creativity cannot redefine domain truth, rights semantics, role authority, capability states, or delivery guarantees.

## Definition of done

A work item is done only when implementation exists; appropriate automated tests exist; acceptance criteria pass; observable behavior is instrumented; contracts remain compatible; relevant documentation is updated; no architecture-lock rule is violated; and the tech lead records evidence in the status ledger.

For productization items, local mocks are not sufficient for hosted/browser claims. The evidence must reach the claimed boundary.

## Architecture changes

If implementation reveals that a frozen decision is infeasible, stop the affected downstream work. Add an ADR documenting the problem, alternatives, impact, migration plan, and compatibility implications. No worker may silently edit the architecture lock.

## First execution command

For productization work, first read `docs/agent-handoff/productization-tech-lead.md`, then run the UX/operations simulation in `docs/testing/ux-operational-simulation.md`, then identify the smallest dependency-safe set from `docs/work-items/productization-work-orders.md`.
