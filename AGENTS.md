# Sporta Agent Operating Contract

## Mission

Build Sporta into a production-grade, streaming-first sports reality rendering platform while preserving the frozen architecture in `docs/architecture/architecture-lock.md`.

## Authority hierarchy

1. `docs/architecture/architecture-lock.md` — immutable architectural constraints unless an explicit architecture-change procedure is followed.
2. `docs/architecture/architecture.md` — canonical architecture and boundaries.
3. `docs/contracts/` — machine-facing domain and interface contracts.
4. `docs/roadmap/` — sequencing and milestone gates.
5. `docs/work-items/work-items.md` — executable backlog and dependency graph.
6. Code/tests — implementation evidence; code never silently overrides the documents above.
7. Research notes — supporting evidence, never authority over frozen decisions.

## Tech-lead operating procedure

At the beginning of every session:

1. Read this file and the architecture lock.
2. Inspect the current repository state and recent changes.
3. Identify the current milestone and all incomplete predecessor work.
4. Select at most three executable work streams for up to three workers.
5. Do not assign a work item whose dependencies or acceptance gates are incomplete.
6. Workers must report changed files, tests, evidence, risks, and any proposed architectural deviation.
7. Review worker output against architecture, contracts, work-item acceptance criteria, and tests.
8. Integrate only conforming work.
9. Update status documents when a work item actually passes its gates.
10. End each session with a precise next-action state recorded in the repository.

## Three-worker model

### Worker A — AI / perception / rendering
Owns perception, tracking, commentary intelligence, world-model inference, temporal consistency, renderer implementation, model adapters, and ML evaluation.

### Worker B — platform / data / streaming
Owns ingestion, media normalization, queues, state/event transport, persistence, GPU-worker orchestration, streaming delivery, observability, and infrastructure.

### Worker C — product / client
Owns viewer UX, style selection, playback, session APIs, creator-facing renderer configuration, accessibility, and product telemetry.

The tech lead may reassign tasks when dependencies require it, but ownership boundaries should remain stable unless documented.

## Parallelism rules

Parallelize only when work streams do not mutate the same contract or architectural boundary in incompatible ways. Contract/schema changes must land before dependent implementation branches. Prefer vertical slices when practical.

## No-drift rules

- Do not couple the product to any single model vendor.
- Do not make raw video frames the canonical domain state.
- Do not make FIFA, PES, or another commercial game a runtime dependency or implementation target that requires copying proprietary assets/code.
- Do not build the first renderer as a dead-end one-off filter.
- Do not treat commentary as decorative audio; it is a first-class semantic input.
- Do not sacrifice temporal consistency for per-frame visual quality.
- Do not introduce real-time latency claims without measured end-to-end evidence.
- Do not claim legal clearance; keep rights/authorization explicit at ingestion boundaries.

## Definition of done

A work item is done only when:

- implementation exists;
- automated tests exist at the appropriate level;
- acceptance criteria pass;
- observable behavior is instrumented;
- contracts remain compatible;
- relevant documentation is updated;
- no architecture-lock rule is violated;
- the tech lead records the evidence in the work-item status.

## Architecture changes

If implementation reveals that a frozen decision is infeasible, stop the affected downstream work. Add an ADR documenting the problem, alternatives, impact, migration plan, and compatibility implications. No worker may silently edit the architecture lock.

## First execution command

Do not start building product features immediately. Perform a repository/bootstrap audit, validate the milestone order and contracts, then begin the earliest unblocked work items in `docs/work-items/work-items.md`.
