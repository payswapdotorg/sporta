# Sporta Reality Engineering Lab

Status: FROZEN FOR IMPLEMENTATION under ADR-013

## 1. Purpose

The Reality Engineering Lab discovers, evaluates and evolves the best executable organization of capabilities for rendering or transforming an event.

It is not a second production pipeline. It is the engineering environment that searches for production organizations.

## 2. Layered architecture

```
SOURCE / LIVE FEED / USER MEDIA
            |
      Media + Provenance
            |
     Domain World Model
            |
    +---------------------+
    | Production Runtime  |
    |                     |
    | Sports Director     |
    |        |            |
    | Agent Organization |
    |        |            |
    | Bodies + Capabilities
    |        |
    | Renderers / Delivery
    +---------------------+

                  ^
                  |
          Reality Engineering Lab
          ------------------------
          Domain Pack
          Scenario Generator
          World Simulator
          Fault Injection
          Agent Org Search
          Evaluator / Reward
          Ensemble / Robustness
          Calibration
          Promotion
          Organization Registry
```

## 3. Lab Domain Pack

A domain pack defines:
- entity types and identity semantics;
- world-state schema or adapter;
- observation/event taxonomy;
- action space;
- capabilities;
- render targets;
- quality evaluators;
- hard invalidity rules;
- reward dimensions;
- scenario/fault generators;
- replay and calibration adapters.

Football is the first domain pack. Basketball, tennis, other sports, and non-sport event domains must plug into this seam.

## 4. Sports World Simulator

The simulator can model:
- match clock;
- players/entities;
- ball/object state;
- spatial geometry;
- camera state;
- event progression;
- commentary;
- confidence and missingness;
- source timing;
- processing latency;
- dropped frames;
- occlusion;
- source disagreement;
- compute/provider failures.

Runs support deterministic replay from seed/configuration and stochastic ensembles.

## 5. Organization search

Search dimensions:
- number of bodies;
- body roles;
- topology;
- delegation;
- communication;
- memory;
- capabilities;
- model/algorithm assignments;
- compute budget;
- latency budget;
- execution order;
- stopping conditions.

A generalist single-agent organization is always a baseline.

## 6. Director hierarchy

```
Mission
  -> Sports/Domain Director
      -> Organization Planner
          -> Organization Candidates
              -> Search / Simulation
                  -> Evaluator
                      -> Promote or Reject
```

The Director can choose an organization and production parameters, but cannot mutate authoritative world facts.

## 7. Learning ladder

Start with:
1. deterministic replay;
2. supervised response/evaluation models;
3. contextual bandits/off-policy comparison;
4. offline policy learning;
5. sequential RL/search against simulation;
6. bounded shadow/canary execution;
7. prediction-vs-observation calibration;
8. repeated organization search.

Pure online RL is not required for the first proof.

## 8. Reward and hard gates

Reward may combine:
- event/source fidelity;
- identity continuity;
- temporal consistency;
- motion fidelity;
- camera/scene correctness;
- stylization quality;
- latency;
- cost;
- reliability;
- compute/resource usage.

Hard invalidity gates include:
- fabricated canonical event;
- fabricated identity presented as fact;
- violation of declared rights/policy;
- impossible/unsupported output claim;
- bypassed provenance;
- invalid artifact lineage.

## 9. Robustness

Every promoted organization records:
- expected score;
- uncertainty;
- seed robustness;
- simulator-model agreement;
- out-of-distribution score;
- cost/latency distribution;
- known failure envelope;
- benchmark corpus coverage.

## 10. Lab-to-production boundary

A Lab Run may produce a Strategy Candidate, Agent Organization Candidate or Capability Candidate. It cannot directly become production state.

Promotion must create a versioned Organization record and pass production eligibility gates.

## 11. Lab outputs

Immutable artifacts include:
- scenario;
- world-model fixture/version;
- organization definition;
- body definitions;
- capability versions;
- model/runtime bindings;
- seeds;
- evaluator versions;
- reward version;
- run metrics;
- calibration records;
- provenance.

## 12. Long-running execution

Long tasks run through durable Sporta jobs/workers. An optional external harness adapter may provide an interactive plan/thread UI.

The canonical state remains:
Database -> Job/Run state -> queue/worker leases -> artifacts/evidence.

An external harness is a presentation/interaction and orchestration integration, not a persistence authority.
