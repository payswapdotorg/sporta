# ADR-010 — Live Reality Inputs and Rendering

Status: ACCEPTED
Date: 2026-09-20
Supersedes: none
Related: ADR-001, ADR-009, architecture-lock, technology-plane, renderer and streaming contracts

## Decision

Sporta will explicitly support live reality generation as a first-class operating mode alongside batch/offline rendering.

Live reality generation is split into two replaceable input classes:

1. Live tracking/state input — receives authorized live player/ball/event data from an external or local tracking source.
2. Live broadcast perception input — derives live observations from an authorized broadcast stream using Sporta perception adapters.

Both feed the same canonical Sports World Model.

The live render path is:

authorized live input -> timestamped observations -> temporal fusion -> live SWM -> live renderer -> live delivery

The renderer boundary remains unchanged: renderers consume canonical SWM state/events, never provider-specific input formats.

## Consequences

### Positive

- Live tactical rendering can ship without first solving perfect broadcast computer vision.
- Commercial/provider tracking can be swapped or combined with Sporta CV.
- The same SWM can drive Tactical, 3D Game and future Anime/NPR live modes.
- Replay can reuse captured live SWM data rather than requiring a second reconstruction pipeline.
- Live mode becomes a strong temporal/identity validation surface.

### Required engineering

The live program must add contracts for:

- timestamped tracking observations;
- source confidence/provenance;
- live SWM watermarks;
- temporal interpolation/extrapolation;
- bounded buffering/backpressure;
- lag and dropped-update telemetry;
- renderer frame/state consumption;
- reconnect/resume;
- live-to-replay continuity.

## Non-decisions

This ADR does not:

- select a permanent tracking vendor;
- require a specific GPU or cloud provider;
- require a specific game engine;
- declare any commercial tracking or broadcast feed available to Sporta;
- waive rights/authorization requirements;
- require copying any commercial implementation.

## Acceptance principle

A live implementation is not accepted because a demo moves avatars.

It must demonstrate timestamp integrity, identity continuity, bounded latency, graceful missing-data handling, explicit provenance/confidence, coherent SWM evolution, and a renderer whose visual state actually responds to SWM changes.

## Architecture-lock compatibility

This decision is an extension of the existing real-time architecture and renderer neutrality. No existing frozen boundary is replaced.
