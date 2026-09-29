# Sporta Reality Engineering Lab — Tech Lead Handoff

## Mission

Implement the complete Reality Engineering Lab extension in the repository while preserving the existing SWM, renderer, rights, compute and live contracts.

The repository is the sole source of truth.

## Existing delivery priority

R606, R607 and remaining L-series customer-visible gates remain real blockers. The new program must not weaken or hide them.

Use parallel work only where file/contract ownership is isolated. Finish current blockers before large cross-cutting refactors.

## Canonical documents

Read in order:
1. AGENTS.md
2. docs/architecture/architecture-lock.md
3. docs/architecture/architecture.md
4. docs/adr/ADR-013-reality-engineering-lab-and-agent-organizations.md
5. docs/architecture/reality-engineering-lab.md
6. docs/contracts/agent-body-and-organization.md
7. docs/contracts/historical-media-and-corpus.md
8. docs/contracts/organization-registry-and-promotion.md
9. docs/contracts/external-platform-and-mcp.md
10. docs/architecture/compute-broker.md
11. docs/contracts/sports-world-model.md
12. docs/contracts/renderer.md
13. docs/contracts/live-reality.md
14. docs/work-items/reality-engineering-lab-work-items.md
15. docs/agent-handoff/reality-engineering-lab-worker-packets.md
16. docs/testing/reality-engineering-lab-acceptance.md
17. docs/roadmap/reality-engineering-lab-roadmap.md

## Non-negotiable invariants

- SWM remains the authoritative sports world state.
- Lab world models/simulators never become production truth.
- Agent organizations cannot invent facts or bypass provenance/rights.
- Agent Body is distinct from model/provider.
- Organization discovery is evidence-driven and reproducible.
- One application service authority serves UI, HTTP API and MCP.
- Long-running state is canonical in Sporta; OpenMuse/CopilotKit/AG-UI are optional harnesses.
- Production organization promotion is versioned, audited and reversible.
- User labs are tenant-isolated.
- Historical URLs are references unless acquisition/use is authorized.
- No source provider restrictions are bypassed.
- No organization may ship based solely on simulator reward.

## Worker allocation

### Worker A — Lab Intelligence / Simulation / Organization Search

Own:
REL-001..REL-008, REL-025, REL-032

Focus:
- Domain Pack;
- simulator;
- fault injection;
- Agent Body/Organization runtime;
- evaluator/reward;
- search/RL seams;
- calibration;
- non-football domain proof.

Must not own:
- external API/MCP;
- primary UX;
- production promotion UI.

### Worker B — Media / Durable Jobs / External Platform

Own:
REL-009..REL-016, REL-026, REL-029..REL-031

Focus:
- historical source/corpus;
- permitted YouTube/reference discovery;
- user-fed uploads;
- durable Lab worker;
- optional OpenMuse/CopilotKit harness;
- HTTP API;
- MCP;
- external feed processing.

Must not:
- create a second job authority;
- embed provider SDKs in domain contracts;
- bypass rights policy.

### Worker C — Registry / Promotion / Product / User Labs

Own:
REL-017..REL-024, REL-027, REL-028, REL-033..REL-035

Focus:
- organization catalog;
- promotion/canary/rollback;
- organization selection;
- user lab UX;
- incentive policy;
- publishing/importing organizations;
- external platform workspace.

Must not:
- redefine Agent Body/Organization contracts without ADR;
- silently rank one organization as globally best.

## Tech Lead responsibilities

- keep shared contract ownership;
- sequence work to avoid conflicting edits;
- review every architecture-affecting PR;
- enforce real-vs-fixture evidence;
- own promotion gates;
- maintain status and roadmap;
- run integration and drift audits;
- keep R606/R607/L-series visible.

## Suggested waves

Wave 0:
- verify current code and contract seams;
- implement ADR/contracts only.

Wave 1:
- A: REL-001..004
- B: REL-009..012
- C: REL-017..019

Wave 2:
- A: REL-005..007
- B: REL-010..016
- C: REL-020..022

Wave 3:
- A: REL-008 + REL-025 + REL-032
- B: REL-026 + REL-029..031
- C: REL-023..024 + REL-027..028

Wave 4:
- integration;
- production promotion;
- user lab;
- external platform;
- fresh-browser acceptance.

## Long-running harness policy

Prefer the simplest durable backend that satisfies Sporta's job contract. Add OpenMuse/CopilotKit/AG-UI as an adapter when it materially improves plan visibility, reconnect, cancellation or task UX. Do not fork their domain semantics into Sporta.

## Worker completion format

Each worker must report:
WORK ITEMS / CHANGED FILES / TESTS / REAL EVIDENCE / FIXTURE EVIDENCE / CONTRACT CHANGES / RIGHTS-PROVENANCE / LATENCY-COST / SECURITY / RISKS / BLOCKERS / DEVIATIONS

Workers never self-close milestones.
