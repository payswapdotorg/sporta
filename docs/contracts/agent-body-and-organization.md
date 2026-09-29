# Agent Body and Organization Contract

Status: FROZEN under ADR-013

## Agent Body

An Agent Body is a stable executable role contract that can be inhabited by a model, algorithm, or tool-aware hybrid.

Required fields:
- bodyId;
- version;
- role;
- domain compatibility;
- input schema;
- output schema;
- tools/capabilities;
- permissions;
- memory interfaces;
- communication interface;
- action interface;
- budget;
- latency limits;
- evaluator hooks;
- safety/policy constraints.

## Agent Instance

```
Agent Body + model/algorithm binding + runtime policy = Agent Instance
```

The binding is execution metadata, never domain truth.

## Organization

An Agent Organization is a versioned directed graph:
- nodes = Agent Bodies/instances;
- edges = communication/delegation;
- shared/private memory policy;
- capability bindings;
- execution stages;
- budget allocations;
- termination conditions.

## Required baselines

Every benchmark scenario compares:
1. one generalist body;
2. one hand-designed organization;
3. candidate searched organizations.

## Organization status

```
draft
  -> benchmarked
  -> validated
  -> canary
  -> production
  -> retired
```

Only validated/canary/production organizations may be selected for customer production work.

## Domain independence

Body contracts are generic. Football-specific semantics belong in the football domain pack.

## Model independence

A body must work through the provider-neutral model/runtime seam. No body may import a provider SDK as domain code.

## Observability

Each body invocation records:
- organization version;
- body version;
- model/runtime binding;
- input/output artifact IDs;
- latency;
- cost/usage;
- evaluator result;
- failure/degradation code.

Sensitive prompts/secrets are not persisted into ordinary domain records.
