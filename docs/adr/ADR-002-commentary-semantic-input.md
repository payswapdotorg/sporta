# ADR-002: Commentary is a first-class semantic input

Status: Accepted / Frozen

## Context

Commentary is time-aligned information about events, importance, named participants, emotion, context, and narrative emphasis. Treating it as playback-only wastes useful signal.

## Decision

Speech-to-text and football-language interpretation are first-class pipeline components. Commentary produces observations/events with provenance and confidence. Fusion may use commentary to corroborate or prioritize visual interpretation, but commentary cannot silently override stronger evidence.

## Consequences

The system can use commentary for event disambiguation, highlight selection, camera direction, visual effects, and future generated narration.
