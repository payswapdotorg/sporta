# Reality Engineering Lab Acceptance

## Gate REL-A0 — Architecture integrity

Pass only when:
- ADR-013 is reflected in architecture-lock;
- dependency graph matches work items;
- contracts match implementation;
- no production authority exists outside the repository contracts;
- R606/R607/L-series status remains truthful.

## Gate REL-A1 — Historical corpus

Fresh browser or API client can:
1. upload a permitted historical match/clip;
2. record rights basis;
3. reference a source URL;
4. acquire bytes only when permitted;
5. normalize media;
6. register benchmark windows/features.

Denied acquisition must fail closed with a useful state.

## Gate REL-A2 — Lab reproduction

A Lab Run must:
- record configuration/version/seed;
- resume after worker restart;
- reproduce deterministic trajectories;
- expose stochastic uncertainty;
- preserve artifact lineage.

## Gate REL-A3 — Organization discovery

At minimum compare:
- single-agent baseline;
- hand-designed organization;
- searched organization.

Candidate metrics must include quality, hard-gate validity, cost and latency.

## Gate REL-A4 — Production promotion

A candidate cannot become Production unless:
- reproducibility passes;
- benchmark quality passes;
- robustness passes;
- rights/security/policy pass;
- cost/latency envelope passes;
- canary pass;
- complete lineage exists.

Rollback must be automatic for configured hard SLO/policy failures.

## Gate REL-A5 — User organization choice

A fresh browser must see at least two eligible organizations where available and select one without hidden API knowledge.

The UI must display version/evidence/limits and allow the user to change selection.

## Gate REL-A6 — User Lab

A user can:
- create a lab;
- choose a domain/task;
- select source data;
- set a budget;
- run simulation/search;
- inspect candidates;
- keep private or publish;
- see incentive policy;
- request promotion.

Tenant isolation must be tested.

## Gate REL-A7 — External platform

A test external client can:
- discover organizations;
- submit a media/feed job;
- reconnect;
- receive status;
- cancel;
- retrieve validated output and evidence.

HTTP and MCP must resolve to the same application semantics.

## Gate REL-A8 — Long-running harness

A multi-hour lab run must remain durable across:
- browser disconnect;
- harness reconnect;
- worker restart;
- retry;
- cancellation.

No duplicate authoritative completion or artifact lineage is allowed.

## Gate REL-A9 — Domain expansion

A second domain pack, preferably non-football, completes the lab lifecycle without changing generic Lab/Organization contracts.

## Gate REL-A10 — Platform transformation

A simulated external video platform can:
upload video -> choose/auto-select organization -> process -> quality gate -> retrieve transformed video.

The design must permit future YouTube-like integrations without coupling Sporta to a single external platform.
