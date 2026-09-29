# Reality Engineering Lab — Worker Packets

## Worker A packet

Mission: build the domain-neutral Lab and organization-search substrate.

Start:
- REL-001
- REL-002
- REL-003
- REL-004

Then:
- REL-005
- REL-006
- REL-007
- REL-008
- REL-025
- REL-032

Parallel-safe boundaries:
- own lab/simulation packages and test fixtures;
- do not edit external API or product promotion code;
- shared type changes require TL review.

Primary evidence:
- deterministic replay;
- stochastic ensemble;
- organization baseline comparison;
- reward hard-gate tests;
- calibration record.

## Worker B packet

Mission: make historical evidence and long-running jobs operational and expose provider-neutral external integration.

Start:
- REL-009
- REL-012

Then:
- REL-010
- REL-011
- REL-013
- REL-014
- REL-015
- REL-016
- REL-026
- REL-029
- REL-030
- REL-031

Provider rule:
- YouTube/source adapters may discover and reference content.
- Download/transformation only when authorization/policy allows.
- Never implement a bypass.

OpenMuse/CopilotKit:
- adapter only;
- do not make their thread/job state authoritative.

Primary evidence:
- user upload;
- reference-only URL;
- authorized acquisition;
- worker restart/reconnect;
- HTTP/MCP parity;
- external feed transformation.

## Worker C packet

Mission: turn validated organizations into a safe product surface and allow user-owned labs and external organization exchange.

Start:
- REL-017
- REL-018
- REL-019

Then:
- REL-020
- REL-021
- REL-022
- REL-023
- REL-024
- REL-027
- REL-028
- REL-033
- REL-034
- REL-035

Primary evidence:
- >=2 organization choices;
- benchmark evidence visible;
- automatic canary/promotion/rollback;
- user lab isolation;
- incentive enforcement;
- organization import/export through governed contract;
- platform processing workspace.
