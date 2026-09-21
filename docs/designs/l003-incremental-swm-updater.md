# L003 — Incremental SWM Updater: Design

Status: DESIGN (Wave 1, Worker A) — for TL review; Wave 2 implementation
Date: 2026-09-21
Related: `docs/contracts/live-reality.md` (FROZEN §1-§4, §7-§8), `docs/contracts/sports-world-model.md` (FROZEN), ADR-010, `docs/status/mvp-and-live-reality-status.md` (Wave 0 mapping decisions), `packages/live-source` (L002, the input contract), `packages/fusion` (`runWorldFusion`, the batch seam this design extends), `docs/agent-handoff/mvp-and-live-reality-worker-packets.md` (L003 acceptance)

## 1. The problem being solved

Live observations (L002 `LiveObservation` batches: `TRACKING` source type, canonical
pitch meters, dual clocks, source watermark, per-entity `detected` honesty) must
update the EXISTING canonical Sports World Model incrementally — one canonical
SWM per session across batch and live (ADR-010), no second live-only world
model, no contract changes (Wave 0 froze the mapping; L003 implements inside
it).

The batch seam today is `runWorldFusion` (W401): a WHOLE-STREAM pass that
re-reads the observation store, re-projects every track entity, re-derives
events, and re-computes possession — idempotent by full replay. A live session
cannot afford whole-stream replay per tick and must not lose the honesty
machinery (versioning, provenance, uncertainty, conflict ledger) that the
batch pass provides.

## 2. Design decisions (each mapped to its authority)

### D1 — One canonical SWM; the live updater is a DRIVER, not a model

The updater drives the SAME `WorldModelEngine` (W006) the batch pipeline uses.
It holds no world state of its own: positions, versions, events, football
state live in the engine exactly as in batch. The engine's `snapshotVersion`
monotonicity IS the frozen `LiveWorldState.worldVersion`.

- Authority: ADR-010 ("Both feed the same canonical Sports World Model");
  work-item L003 acceptance ("without creating a second live-only world
  model").

### D2 — Incremental application with a per-entity replay frontier (no whole-stream re-read)

Per live observation batch, the updater applies ONLY the batch's entity
observations, in a deterministic order:

1. Sort the batch's `entityObservations` by `(observedAtMs, entityRef)` — the
   stable total order (mirrors `runWorldFusion`'s
   `(eventTimeMs, observationId)` rule; `entityRef` is the batch-local
   tiebreak because live batches carry no observation ids).
2. For each entity observation: project to the engine's `WorldEntity` shape
   and `upsertEntity`. The engine owns versioning (each upsert bumps the
   snapshot version — the frozen "monotonically advancing version").
3. Rewind protection (the batch pass's `upsertWouldBeNoOp` rule, applied
   incrementally): the updater keeps a per-entity
   `(lastAppliedEventTimeMs, lastStateFingerprint)` frontier. An observation
   whose `observedAtMs` is EARLIER than the entity's frontier is a LATE
   update: it is NOT applied silently — it is counted in the live report and,
   when it is older than the L004 reorder window (see the L004 design), it is
   dropped with an explicit `late-update-dropped` counter (never a position
   rewind). Within the window it is applied if the reorder engine delivered
   it as in-window (L004 owns the windowing; L003 owns the apply rule).

- Authority: frozen §3 ("Every state has a monotonically advancing version");
  fusion.ts pass 2 (idempotent upserts, no rewinds); no-drift (no silent
  out-of-order application).

### D3 — Provenance/confidence/uncertainty carried verbatim; extrapolation marking at the LIVE layer

Every applied entity observation carries:

- `confidence` verbatim from the source (never floored, never averaged);
- `provenance` = the source's `ProvenanceKind`;
- position status `"uncertain"` with the observation's confidence (the
  existing dual-status convention; the frozen `UncertaintyStatus`
  ["known","unknown","uncertain"] is NOT extended — Wave 0 decision);
- the LIVE-LAYER envelope (outside `packages/contracts`) additionally marks
  extrapolated positions: an entity observation with `detected: false` is
  "carried, not observed" — the updater applies the LAST KNOWN position with
  the batch's reduced confidence and NO velocity, and increments the §9
  `extrapolated-observations` telemetry counter. This is the Wave 0
  extrapolation-marking decision implemented: live-layer counter + envelope
  flag, never a frozen-contract change.

- Authority: frozen §4 ("Extrapolation must be marked"; "Missing data must
  never become fabricated certainty"); Wave 0 mapping decision
  (extrapolation-marking is live-layer, NOT a frozen-contract change);
  architecture-lock §6 (no silent confidence collapse).

### D4 — The batch fusion pass remains the SHARED correctness core

The updater reuses the fusion layer's pure helpers (projection, no-op
detection, possession) rather than reimplementing them:

- `projectTrackEntity`-equivalent projection for live entity observations
  (additive sibling in the fusion package, or the live package imports the
  helper — implementation choice for Wave 2; the DESIGN constraint is: no
  duplicate projection semantics).
- Possession: recomputed INCREMENTALLY per batch when the batch contains a
  BALL observation — the nearest participant within the possession radius
  from the CURRENT engine state (the same radius/confidence formula and the
  same tie rule: a tie within `POSSESSION_AMBIGUITY_EPSILON` is an explicit
  conflict record, never a silent winner). A batch without a ball
  observation leaves the possession slot untouched.
- Events: the L002 stream produces no event candidates (sourceType
  `TRACKING`); the event path stays dormant until L007/L012 feed candidates.
  The updater does not invent events.

- Authority: frozen §7 ("When multiple sources disagree, the SWM records
  provenance and confidence"); work-item L012 (multi-source fusion, Wave 3);
  no-drift (one possession semantics).

### D5 — The live report (the honest per-batch accounting)

Each applied batch produces a `LiveUpdateReport` (live-layer data, JSON-safe,
deterministic — no clock, no RNG):

```text
LiveUpdateReport {
  sessionId, sourceId
  appliedSequence            // the batch's sequence
  watermarkAfter             // min(source watermark, L004 engine watermark)
  entitiesUpserted           // count of applied entity observations
  entitiesSkippedNoOp        // identical-state re-applications (idempotence)
  lateUpdatesInWindow        // applied late updates (within the L004 window)
  extrapolatedObservations   // detected:false applications (the §9 counter)
  possessionUpdates          // possession recomputes (and tie conflicts)
  conflicts                  // ConflictRecord list (the fusion shape)
  snapshotVersionAfter       // engine.snapshotVersion after the batch
}
```

The report is the §9 telemetry source for ingest-to-SWM latency (paired with
the batch's dual clocks) and the operator-visible honesty surface.

- Authority: frozen §9 (minimum operational telemetry); the worker report
  contract (honest evidence).

### D6 — Live-to-replay continuity (the frozen §8 rule)

The updater APPENDS to the same session-scoped observation store the batch
path reads (live observations are bridged into W005 observation envelopes
additively — the same bridging pattern `packages/real-to-swm/src/bridge.ts`
uses, never a second store). After the live window closes, a batch
`runWorldFusion` pass over the same store must be IDEMPOTENT against the
updater's applications: the engine state the updater produced equals the
state a full replay produces (D2's rewind protection + no-op skipping make
re-applications harmless). This is the Wave 2 acceptance test for continuity:
`updater-final-state == runWorldFusion-replay-final-state` for the same
observation set.

- Authority: frozen §8 ("A live session must be able to become a replay
  session without translating into a second canonical model"); L014
  (live/replay continuity, Wave 3 — this design is its enabler).

### D7 — Failure semantics (fail-closed, never fabricated)

- A batch that fails `parseLiveObservation` is REFUSED with the typed
  validation error and counted (`invalidBatches`) — never partially applied.
- A batch whose `sessionId` differs from the updater's session is refused
  (`wrongSession`).
- A batch whose `sequence` regresses below the applied frontier is a
  duplicate/replay: counted (`duplicateSequence`), not applied (idempotence).
- Engine errors propagate typed (the updater never catches-and-guesses).

- Authority: architecture-lock §13 (untrusted input, fail-loud); no-drift.

## 3. Module plan (Wave 2)

New package `packages/live-swm` (name per the wave plan; the L003 owner is
Worker A):

```text
packages/live-swm/src/
  updater.ts        // LiveSwmUpdater: apply(LiveObservation) -> LiveUpdateReport
  projection.ts     // live entity observation -> WorldEntity projection
  possession.ts     // incremental possession over current engine state
  report.ts         // LiveUpdateReport shape + canonical serialization
  index.ts
test/               // determinism, idempotence, rewind protection, honesty
```

Wiring: the SSE live transport (`apps/web/src/server/live/`) re-points its
producer from the dev-seed story timeline to the updater's reports — that
re-pointing is the L005/L006 integration step (Worker C/B lanes + L003's
consumer contract), NOT part of this design's implementation scope.

## 4. Acceptance mapping (L003 work item)

| Acceptance clause | Design element | Wave 2 test |
| --- | --- | --- |
| live observations update the existing canonical SWM | D1, D2 (engine-driven incremental apply) | apply N batches → engine state equals the same entities/events applied in order; snapshotVersion strictly advances on real changes |
| without creating a second live-only world model | D1 (no owned state), D6 (same store, same engine) | grep-level: no world-state fields on the updater; replay-equality test |
| version retained | D2 (engine versioning) | version monotonicity assertions |
| watermark retained | D5 (`watermarkAfter` = the §3 watermark rule; L004 owns the arithmetic) | report carries the frozen `Watermark {watermarkMs, sequence}` shape |
| provenance retained | D3 (verbatim `ProvenanceKind`) | provenance asserted on every applied entity |
| uncertainty retained | D3 (uncertain status + honest confidence + extrapolation marking) | `detected:false` → carried position, no velocity, counter incremented, never fabricated |

## 5. Contract-change requests

NONE. The design stays inside the frozen shapes: `LiveObservation` (L002,
additive `recovery` already TL-accepted), `Watermark`, `WorldSnapshot` /
`WorldEventStreamEntry` (via the engine), `ProvenanceKind`,
`UncertaintyStatus` (NOT extended). The live-layer additions
(`LiveUpdateReport`, the extrapolation envelope flag, the per-entity apply
frontier) are additive live-package data outside `packages/contracts`,
consistent with the Wave 0 mapping decisions and the L002 precedent.
