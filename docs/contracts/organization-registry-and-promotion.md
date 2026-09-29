# Organization Registry, Selection and Promotion Contract

Status: FROZEN under ADR-013

## Registry

The Organization Registry is the canonical catalog of production-eligible organizations.

Each version records:
- organizationId/version;
- supported domain/event types;
- live/batch support;
- supported renderers;
- benchmark corpus versions;
- evaluator versions;
- expected quality metrics;
- uncertainty;
- latency distribution;
- compute/cost envelope;
- required capabilities/models;
- rights/policy dependencies;
- status;
- owner/publisher;
- provenance lineage.

## Promotion

Promotion pipeline:

```
Lab candidate
  -> reproducibility check
  -> benchmark gate
  -> robustness gate
  -> rights/provenance gate
  -> cost/latency gate
  -> security/policy gate
  -> canary
  -> production
```

Promotion and rollback are automated from versioned eligibility policies.

## User choice

The product can expose eligible organizations with:
- name/version;
- supported use cases;
- quality evidence;
- latency/cost envelope;
- domain support;
- known limitations;
- required connected compute/capabilities.

The UI must never imply that an organization is universally optimal. Selection is tied to the user's declared objective and constraints.

## Canary

Canary traffic is isolated and observable. Automatic rollback is triggered by hard SLO/policy failures.

## User labs

A user lab creates tenant-scoped organization candidates. Candidates remain private until the user publishes/promotes them.

## Incentive policy

The system supports configurable user-lab rewards:
- private-use window up to six months;
- disclosed discovery/featured benefit;
- capability credits or other plan-governed benefits.

A reward policy is versioned and displayed to the user. Discovery boosts must be explicit and auditable; they are not silently mixed into quality evidence.

## Retirement

A production organization can be retired without deleting its lineage. Historical runs retain the exact organization version that produced them.
