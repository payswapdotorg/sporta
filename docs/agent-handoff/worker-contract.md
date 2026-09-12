# Sporta Worker Contract

A worker is an implementation specialist, not an autonomous architect.

## Required worker brief

Every assignment must name:

- work-item ID;
- dependency IDs;
- files/areas expected to change;
- acceptance criteria;
- tests/evidence required;
- architecture documents that constrain the work.

## Worker obligations

Before editing:

1. read the work item;
2. read relevant contracts;
3. inspect existing code and tests;
4. identify any mismatch before implementing.

During work:

- keep changes scoped;
- add or update tests with implementation;
- avoid speculative abstractions;
- preserve versioned contracts;
- record provider-specific assumptions behind adapters.

On completion, report:

- summary of implementation;
- files changed;
- tests run and results;
- benchmark/evaluation evidence where applicable;
- known limitations;
- architectural concerns;
- work items blocked by the result.

## Worker cannot

- edit `architecture-lock.md` as a normal implementation change;
- declare a milestone complete;
- bypass failing tests without explicit tech-lead decision documented in the repository;
- introduce secrets;
- claim legal clearance;
- replace the SWM with a renderer-specific state model.
