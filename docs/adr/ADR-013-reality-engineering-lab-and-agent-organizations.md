# ADR-013 — Reality Engineering Lab, Agent Organizations and External Platform Integration

Status: ACCEPTED FOR IMPLEMENTATION
Date: 2026-09-29
Supersedes: none
Extends: architecture lock + ADR-001/009/010/012

## Context

Sporta now needs a research-and-production system that can discover how AI capabilities should be organized to render or transform real events. The organization may differ by sport, event type, input quality, latency target, renderer, budget and mode (live/batch).

The design also needs:
- historical corpus acquisition from user-fed media and permitted source references;
- repeatable simulation and RL/search over production organizations;
- interchangeable Agent Bodies inhabited by different model types;
- automated validation, canarying, promotion and rollback of organizations;
- a catalog from which users can choose organizations;
- user-owned labs that can discover new organizations;
- incentives for user-run labs;
- API/MCP access for external platforms;
- long-running orchestration without making an external agent product an architectural authority.

## Decision

1. Introduce a Sporta Reality Engineering Lab as a first-class subsystem.
2. The Lab operates on a generic Lab Domain Pack. Football is the first pack. Other sports and non-sport event domains may be added without changing Lab infrastructure.
3. The canonical production truth remains the domain World Model (SWM for sports). Lab simulation state is not production truth.
4. Introduce Agent Body and Agent Organization contracts. Bodies own role/capability/tool/memory/permission/evaluation structure. A selected model or algorithm inhabits a body through the Model Runtime. Organization definitions are graphs of bodies, capabilities, communication and delegation.
5. Organization search may use evolutionary search, black-box optimization, contextual bandits, offline policy learning, RL, planning or combinations. No optimizer is architecturally mandated.
6. A single-agent baseline and a hand-designed organization baseline are mandatory comparison points.
7. Historical media can enter through user upload, permitted provider/source connectors, authorized feeds, or reference-only URLs. A public URL alone never proves transformation rights.
8. Historical replay, counterfactual simulation and real observations remain explicitly distinct provenance classes.
9. Organization lifecycle is Draft -> Benchmarked -> Validated -> Canary -> Production -> Retired, with automated eligibility checks and rollback.
10. Users may select among eligible organizations. Selection metadata includes evidence, supported domains, latency/cost profile, provenance/rights requirements and version.
11. Users may launch their own Lab. Lab outputs are isolated until they pass promotion gates.
12. User lab incentives are policy/configuration, not hidden ranking rules. The initial supported policy options are a time-bounded private-use window (up to six months), a disclosed discovery/featured benefit, or both, subject to plan/policy.
13. External platforms interact through provider-neutral Application APIs and MCP adapters over the same Sporta application services. MCP/API adapters never become a second persistence, rights, job, or promotion authority.
14. Long-running work uses a durable worker/job contract. CopilotKit/OpenMuse, AG-UI, OpenBot or equivalent products may be attached through a harness adapter when useful for plan display, interaction, reconnect, cancellation or task UX. Their internal state is never the canonical Sporta job state.
15. External platforms may: discover organizations, evaluate/select eligible organizations, submit media or feed jobs, receive validated outputs, subscribe to status, and optionally import/promote a validated organization into their own integration scope.
16. Sporta may expose a processing service to platforms (for example, a video platform asking for anime/cartoon transformations) without requiring that platform to adopt Sporta's own viewer UX.
17. No lab optimizer or external integration may bypass rights, provenance, quality or promotion gates.
18. The existing reconstruction/source-preserving renderer lanes remain intact. The Lab decides how to compose capabilities; it does not replace the renderer contract or SWM.

## Consequences

Positive:
- organization structure becomes learnable rather than hard-coded;
- sport-specific and event-specific organizations can emerge;
- models and specialized algorithms can be swapped without rewriting the role architecture;
- production promotion becomes evidence-driven and reversible;
- Sporta can become an engineering service for other platforms.

Costs/risks:
- simulation quality becomes a major dependency;
- organization search can overfit the simulator;
- reward design must prevent quality/rights/latency gaming;
- user labs add tenant isolation and compute-control complexity;
- external integration increases security and abuse surface.

## Migration / compatibility

Existing SWM, Renderer, Compute Broker, rights, telemetry and live contracts remain compatible. The Lab is additive. Existing customer-visible R606/R607/L gates remain valid and are not weakened by lab milestones.

## Required repository changes

- architecture contracts;
- dependency graph;
- organization/body contracts;
- historical acquisition contract;
- organization registry/promotion contract;
- external API/MCP contract;
- lab work items;
- three-worker handoff;
- acceptance protocol;
- architecture-lock revision record.
