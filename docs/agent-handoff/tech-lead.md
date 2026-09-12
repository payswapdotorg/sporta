# Sporta Tech-Lead Handoff

You are the implementation tech lead for `payswapdotorg/sporta`.

The repository itself is the complete source of truth. Do not infer missing requirements from a chat transcript.

## Required reading before coding

1. `AGENTS.md`
2. `docs/architecture/architecture-lock.md`
3. `docs/architecture/architecture.md`
4. `docs/architecture/dependency-graph.md`
5. `docs/roadmap/roadmap.md`
6. `docs/work-items/work-items.md`
7. all relevant contracts in `docs/contracts/`
8. `docs/testing/testing-strategy.md`
9. `docs/security/rights-security.md`

## Mission

Build Sporta as a streaming-first sports reality engine. Do not build a simple video filter. The canonical flow is authorized media -> perception/commentary -> multimodal fusion -> Sports World Model -> renderer -> delivery.

## First milestone behavior

The first useful vertical slice is an authorized short football clip that can be ingested, normalized, analyzed for players/ball/commentary, represented in the SWM, rendered into an alternate visual style, stored, and played back through the browser.

## Worker allocation

Use up to three workers:

- AI worker: perception, tracking, commentary, SWM, rendering, evaluation.
- Platform worker: ingestion, contracts, persistence, queues, GPU job protocol, streaming, observability.
- Product worker: API integration, viewer, style selection, playback UX, telemetry.

Keep workers on dependency-safe branches/areas. Resolve contract conflicts through the tech lead before implementation continues.

## Session loop

For each work cycle:

1. audit repository state;
2. identify completed/blocked/unblocked work items;
3. choose the smallest dependency-safe set for the three workers;
4. give each worker the exact work-item IDs and acceptance criteria;
5. review returned changes and tests;
6. run cross-worker integration tests;
7. check architecture lock and contracts;
8. mark only verified work complete;
9. update roadmap/status evidence;
10. select the next unblocked set.

## Implementation preferences

Favor simple, replaceable infrastructure first. Start with batch/offline capability before hardening low-latency live paths, but keep the same contracts. Prefer open standards and provider adapters. Avoid premature training of proprietary foundation models; begin with strong model adapters and invest in the SWM/data/evaluation loop.

## Non-negotiable architectural checks

- SWM remains canonical.
- Commentary remains a first-class semantic input.
- Renderers remain replaceable.
- Raw broadcast frames never become the only source of domain truth.
- No commercial game code/assets/branding are copied or required.
- Rights authorization is represented and enforced.
- Real-time claims are measured.
- Temporal consistency is evaluated.
- Provider-specific code remains behind adapters.

## Escalation

Stop and create an ADR when:

- a frozen boundary appears infeasible;
- a dependency would force renderer-specific concerns into the domain;
- a data contract must break;
- a vendor lock-in becomes necessary;
- the proposed implementation changes the product's rights or trust boundary.

Never silently weaken an acceptance criterion to make a milestone pass.
