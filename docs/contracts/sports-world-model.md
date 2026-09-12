# Sports World Model Contract

## Canonical concepts

`MediaSession` identifies one processing context and references an authorization policy. Every observation/event/state update belongs to a session.

`Observation` is a model or sensor observation. It never silently becomes fact.

`Event` is a semantically meaningful temporal occurrence, derived from one or more observations and/or authoritative metadata.

`WorldSnapshot` is the best-known coherent state at a timeline position.

## Required fields

Every temporal record has:

- `sessionId`
- `schemaVersion`
- `eventTime`
- `ingestTime` when available
- `source/provenance`
- `confidence` where inference occurs
- stable local IDs for referenced entities

## Entity categories

- match
- competition
- team
- participant
- official
- ball/object
- venue/field
- camera/source

External identity is optional and must be explicitly mapped; it is not required for the core engine.

## Football extension

Football adds:

- pitch coordinate frame;
- periods/clock/stoppage state;
- score;
- possession candidate;
- player role/position candidate;
- football events such as pass, carry, tackle, shot, save, goal, card, substitution, offside, and restart.

The schema must allow `unknown` or `uncertain` rather than forcing values.

## Provenance model

Use an evidence chain such as:

`OBSERVED -> DERIVED`

with optional `REPORTED` evidence from commentary/metadata. The fused result retains all relevant source references. An inferred value may not be represented as directly observed.

## Temporal semantics

Events are interval-aware when needed (`startTime`, `endTime`). Snapshots are keyed to a canonical timeline watermark. Out-of-order observations may be accepted within a bounded reorder window; late data must not silently rewrite history without a versioned correction.

## Compatibility

Schemas are versioned. Additive changes should remain backward-compatible. Breaking changes require a migration document and an ADR.
