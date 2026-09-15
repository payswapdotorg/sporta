# Sporta Roadmap

## Gate G0 — Repository handoff-ready

Outcome: the repository is self-contained and an LLM tech lead can begin without chat context.
Required artifacts: agent contract, architecture lock, architecture, dependency graph, work items, contracts, testing/release guidance.
State: complete.

## Gate G1 — Foundation

M0 complete.

## Gate G2 — Football understanding

M1 complete.

## Gate G3 — Sports World Model

M2 complete.

## Gate G4 — First consumer value

M3 complete.

## Gate G5 — Near/live value

M4 complete in the controlled/in-process domain; real-network delivery remains a productization requirement.

## Gate G6 — Product experience

M5 core viewer package complete; the public product UI remains a productization requirement.

## Gate G7 — Game-style renderer

M6 complete.

## Gate G8 — Production readiness

M7 complete with a READY-WITH-GAPS verdict. The recorded gaps are deployment/auth/production telemetry, real-network transport, real-browser paint E2E and human release sign-off.

## Productization gates G9-G14

The next stage is authoritative in `docs/roadmap/productization-roadmap.md` and `docs/work-items/productization-work-orders.md`.

### G9 — Installable product shell
`apps/web` is a real installable web/PWA surface with authentication, shared navigation, responsive UX and role switching.

### G10 — YouTube-like watch experience
Fresh users can discover content, search, open watch pages, see related renderings, and switch realities without leaving the match.

### G11 — Hosted control plane
Public authenticated API + durable hosted session/job state using the target deployment stack.

### G12 — Hosted media/render path
Authorized upload -> hosted processing -> R2 artifact -> fresh-browser playback through a real compute adapter.

### G13 — Real live
At least one authorized real-network source reaches the public system and browser through measured live transport.

### G14 — Public beta
A fresh user can complete viewer and creator flows, switch roles, encounter real rights/quota/degraded states, and use the product from a public URL.

## Recommended three-worker execution

Wave 1: Worker A W903; Worker B W901-W902; Worker C audit/prepare W914.
Wave 2: A W904-W905; B W910-W913; C W914.
Wave 3: A W906-W908; B W915/W919; C hosted rendering validation.
Wave 4: A W909 + product surfaces; B hosted catalog/rights/operations; C integration hardening.
Wave 5: Tech lead W920 release validation.

The existing M0-M7 dependency graph remains authoritative for the completed core. Productization dependencies are defined separately to minimize drift and protect the stable core contracts.

## Release candidates

RC0 deterministic offline analysis fixture — delivered.
RC1 offline anime renderer demo — delivered.
RC2 controlled live streaming prototype — delivered within the documented controlled-domain boundary.
RC3 public beta — next target; requires G9-G14.
RC4 production release — after public-beta evidence and real human sign-off.

Any target or latency number not backed by benchmark evidence is an aspiration, not an SLO.
