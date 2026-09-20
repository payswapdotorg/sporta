# Sporta MVP User Journey Hardening — Final Tech Lead Handoff

You are the implementation Tech Lead/Orchestrator for payswapdotorg/sporta.

The Reality Engine now produces real MP4 outputs through a clean browser. The next mission is to make the MVP understandable, durable and faithful to the Sporta promise.

## Read first

1. AGENTS.md
2. docs/agent-handoff/mvp-reality-engine-tech-lead.md
3. docs/agent-handoff/mvp-worker-packets.md
4. docs/testing/mvp-user-journey-simulation.md
5. docs/roadmap/mvp-user-journey-hardening-roadmap.md
6. docs/work-items/mvp-user-journey-hardening-work-items.md
7. docs/status/mvp-user-journey-hardening-status.md
8. docs/testing/mvp-reality-engine-acceptance.md
9. docs/testing/mvp-reality-engine-gate-audit.md
10. current UX, role, Technology Plane and Compute Broker contracts

## Mission

Close J001-J015. The target customer journey is:

fresh browser -> Creator -> real upload -> rights -> select realities -> choose/connect compute -> submit once -> real processing -> four outputs -> Watch -> switch realities -> Library/Jobs -> role switch -> refresh/redeploy -> return to result.

## Critical findings

### Home is stale
Remove statements that Tactical/3D are unregistered and creation is deferred.

### Four realities require too much hidden knowledge
The gate audit needed additional API dispatches after the Create submission. One Create submission must request all desired realities.

### Public durability
The audited environment used the in-memory fallback because DATABASE_URL was absent. The public MVP must demonstrate Neon-backed control state and R2 artifacts across instances and redeploys.

### Role navigation
Keep global product navigation available across role workspaces. Role selection is presentation context, never authority.

### Promised role capabilities
Analyst Clips/Notes and Rights Holder editing/audit are not complete. Implement the minimum useful loop or remove the surfaces until backed.

### Reality fidelity
R601 and R602 are materially different clips, but their 3D Game and Anime/NPR artifacts are identical because both sessions materialized the same empty-event SWM state. This is a direct product-result problem.

Do not close the final MVP gate until the supported perception path produces meaningful input-sensitive state and derived realities respond to it.

## Worker allocation

### Worker A — Product / UX / role journeys
Own J001, J002, J003, J006 UI, J008 UI, J009 UI, J010, J011 and J015 browser acceptance support.

### Worker B — Platform / durability / compute
Own J005, J007, J008 backend, J009 backend, J014 and deployment/provider verification.

### Worker C — Reality fidelity / rendering
Own J004, J006 render-facing pieces, J012, J013 and renderer quality fixes required by those gates.

## Execution

### Wave 0 — Tech Lead
Freeze or verify:
- global vs workspace navigation;
- multi-reality render-plan request;
- compute connection state;
- durable session/result state;
- reality-fidelity acceptance metrics.

### Wave 1 — parallel
Worker A: J001 + J002 + J003
Worker B: J005 + J007
Worker C: J004 + J012 investigation

### Wave 2 — parallel
Worker A: J008 + J009 + J010 + J011
Worker B: J006 backend + J014
Worker C: J012 implementation + J013

### Wave 3 — integration
All workers perform dependency-safe integration and browser testing. No worker changes another lane's canonical contracts without Tech Lead approval.

### Wave 4 — final gate
Tech Lead owns J015, then R606 and R607. All workers become fix-only lanes. No broad refactoring during final proof.

## Non-negotiable acceptance

A clean browser must complete the one-submission four-reality journey and recover its session/results after restart or redeploy.

A second materially different clip must produce meaningfully different reconstructed football state and derived realities within the declared MVP envelope.

The benchmark candidate supplied by the user is recorded at docs/testing/benchmarks/youtube-93LPZJkCW2w.md. It may enter the R0/R2 benchmark suite once its source authorization is verified and the exact bytes are pinned.

## Worker report

Every worker reports:
WORK ITEMS / CHANGED FILES / TESTS / JOURNEY EVIDENCE / CONTRACT CHANGES / REAL-vs-FIXTURE / LICENSE-PROVENANCE / RISKS / BLOCKERS / DEVIATIONS

No worker self-closes a journey item. The Tech Lead closes it after evidence review.