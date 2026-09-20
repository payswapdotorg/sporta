# Live Reality Contracts

Status: FROZEN FOR IMPLEMENTATION
Related: ADR-010

These are logical contracts. Concrete TypeScript/Python schemas may differ in syntax but must preserve the semantics.

## 1. LiveObservation

Each live source emits timestamped observations:

LiveObservation {
  sessionId
  sourceId
  sourceType: TRACKING | BROADCAST_PERCEPTION | EVENT_FEED | COMMENTARY
  sequence
  eventTime
  ingestTime
  watermark
  entityObservations[]
  confidence
  provenance
  quality
}

An observation must never be silently treated as canonical fact.

## 2. Entity observation

Minimum football tracking observation:

EntityObservation {
  entityRef
  kind: PLAYER | BALL | REFEREE | OTHER
  teamRef?
  position: { xMeters, yMeters, zMeters? }
  velocity?
  detected: boolean
  sourceLocalTrackId?
  confidence
  observedAt
}

Pitch coordinates use the Sporta canonical field coordinate contract.

## 3. LiveWorldState

The live fusion layer emits:

LiveWorldState {
  sessionId
  worldVersion
  eventTime
  watermark
  entities[]
  events[]
  clock
  score
  confidenceSummary
  sourceSummary
}

Every state has a monotonically advancing version and match-time watermark.

## 4. Temporal rules

- Event time is authoritative for match chronology.
- Ingest time is retained for latency accounting.
- Out-of-order updates are handled explicitly.
- A bounded reorder window is allowed.
- Extrapolation must be marked.
- Missing data must never become fabricated certainty.
- When a source falls behind the renderer, the system exposes lag/degraded state rather than pretending the feed is current.

## 5. Live render contract

A live renderer consumes:

LiveRenderInput {
  worldState
  worldEventsSincePreviousFrame
  renderClock
  style
  outputMode
}

The renderer emits:

LiveRenderFrame {
  sequence
  worldVersion
  renderedAt
  presentationTimestamp
  telemetry
  frame/segment payload
}

The browser experience must not expose provider-specific schemas.

## 6. Source adapters

Every provider-specific adapter is registered as a TechnologyProfile with:

- provider/source identity;
- adapter version;
- supported rate;
- coordinate system;
- capabilities;
- provenance;
- license/data-use status;
- authentication mode;
- latency distribution;
- dropout/error classes;
- reconnect behavior.

## 7. Fallback / fusion

The live runtime must support:

- replacement;
- ensemble;
- cascade;
- fallback.

When multiple sources disagree, the SWM records provenance and confidence. Provider precedence is policy/configuration, not hidden renderer logic.

## 8. Replay continuity

Captured live observations and SWM events must be replayable through the same SWM/render contracts. A live session must be able to become a replay session without translating into a second canonical model.

## 9. Minimum operational telemetry

At minimum:

- source-to-ingest latency;
- ingest-to-SWM latency;
- SWM-to-render latency;
- end-to-end presentation latency;
- watermark lag;
- dropped observations;
- extrapolated observations;
- identity switches;
- reconnects;
- renderer frame drops;
- effective update rate.
