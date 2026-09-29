# @sporta/organization-registry — the organization catalog, automated promotion/rollback, and honest user choice (REL-017..019)

**Work items REL-017, REL-018, REL-019 (ADR-013, Worker C lane).** ·
Source of truth: `docs/contracts/organization-registry-and-promotion.md`
(FROZEN) + `docs/contracts/agent-body-and-organization.md` §Organization
status + `docs/architecture/reality-engineering-lab.md` §10.

## What this package is

Five pieces, nothing more:

1. **The record model** (`src/domain.ts`): a versioned `OrganizationRecord` —
   orgId/version, domain compatibility (domains/event types/live+batch/
   renderers), capability bindings (with provider-neutral model-runtime
   bindings), the evidence bundle, provenance (owner, lineage, rights
   requirements, created-from lab-run reference or null for
   hand-engineered), the declared latency/cost profile, and lifecycle
   status. Seven evidence object kinds — reproducibility, benchmark,
   robustness, rights/provenance, security/policy, cost/latency, canary —
   plus `simulatorReward`, which is DATA ONLY and can never satisfy a gate.
2. **The lifecycle state machine** (`src/state-machine.ts`):
   `draft -> benchmarked -> validated -> canary -> production -> retired`
   with a closed legal-edge table. `retired` is terminal; skips and backward
   edges do not exist; illegal attempts get typed, in-words reasons.
3. **The eligibility gates** (`src/gates.ts`): seven explicit,
   evidence-requiring checks (pure evaluators over record + policy
   thresholds). THE HARD RULE is structural: no gate reads the simulator
   reward — a record with only a simulator-reward score is refused with
   `missing` results that say so in words.
4. **The registry store** (`src/registry.ts`): versioned records (every
   mutation = a new version; nothing edits in place) + an append-only,
   hash-chained transition log. Every entry carries actor/system, gate
   results, from -> to, and a timestamp; refused attempts are logged too.
   `verifyTransitionLog()` re-derives the chain. The eligibility query
   (domain/task/mode/renderer/latency/budget/capabilities) returns only
   validated/canary/production organizations.
5. **Automated promotion & rollback** (`src/promotion.ts`) +
   **the choice read model** (`src/choice.ts`): `requestPromotion` advances
   exactly one legal step under a versioned policy (typed refusal records on
   any missing/failed gate, empty lineage, or no forward step; every attempt
   audited); `requestRollback` fires on a recorded trigger (canary/
   production -> retired, or production -> canary for the policy's demotion
   triggers); `choiceForRequest` returns ALL eligible organizations with
   VISIBLE evidence, ordered only by declared criteria.

## The promotion invariant (binding)

A lab breakthrough is not a product feature until it passes the same
promotion/evidence gates as a hand-engineered organization. `createdFrom:
null` (hand-engineered) and `createdFrom: {labRunId}` (lab-discovered) pass
the IDENTICAL gates — the gates never read `createdFrom`.

## Batteries

```bash
cd packages/organization-registry
bun test                 # all tests
bun run typecheck        # tsc --noEmit
bunx eslint src test     # 0 errors
bunx prettier --check .  # clean (repo CI gate)
```

## Known limitations (honest)

- In-memory persistence only (the W911 Neon adapter is the future seam; the
  store is behind the `OrganizationRegistry` port).
- No `apps/web` surface in this slice — the UI integration happens at the
  TL merge (the choice read model is the contract it will consume).
- Canary traffic routing itself (the isolated, observable traffic) is a
  runtime concern of later work items; this package verifies the canary
  EVIDENCE and performs the lifecycle decisions on it.
- No multi-tenant isolation here (user labs are REL-020+); every caller
  supplies its own `ActorRef` and the registry does not authenticate it.
