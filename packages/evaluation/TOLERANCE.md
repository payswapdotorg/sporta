# W403 Tolerance Contract

**The documented tolerance of the W403 replay/evaluation harness.**
`@sporta/evaluation` · canonical reference: `packages/evaluation/src/compare.ts`
(`W403_ARTIFACT_CLASSIFICATION`, `DEFAULT_EPSILON`).

This document mirrors the executable tolerance: the rule table in §3 is pinned
row-for-row to the code by `test/tolerance-doc.test.ts` — a change to either
side without the other fails the test suite (fail loud, no silent drift).

The accept criterion of work item W403 — *"a fixed fixture produces comparable
world-model outputs across runs with documented tolerance"* — is executed by:

- the **frozen fixture** `fixtures/w403-fixture.json` (checked-in, byte-stable,
  sha256-pinned into every artifact);
- the **canonical artifact serializer** (`src/serialize.ts` — sorted keys, full
  float precision, volatile values rejected);
- the **field-classified deep comparator** (`src/compare.ts` — this document);
- the **cross-run runner** (`src/runner.ts`, `scripts/evaluate.ts`) — separate
  bun subprocesses, pairwise + against the checked-in golden
  `fixtures/golden/w403-golden.json`.

## 1. Policy

1. **Every compared field carries a tolerance class.** A field whose JSON path
   matches no rule in the table is **UNCLASSIFIED** — the comparison FAILS LOUD
   with the full JSON path. Nothing ever silently passes, defaults, or drops.
2. **Same-binary determinism ⇒ EXACT is the default.** The evaluated pipeline
   is a pure function of the frozen fixture (no `Math.random`, no `Date.now` —
   clocks are injected/forced constants). Integers, strings, enums, ids, and
   container structure are therefore compared **EXACT**.
3. **EPSILON only for float-derived arithmetic.** Fields whose values are the
   output of floating-point arithmetic over perception inputs (positions in
   canonical pitch meters, confidence products) are compared within
   **ε = 1e-9** (absolute, inclusive: a deviation of exactly 1e-9 passes;
   above fails). 1e-9 is ~6 orders of magnitude below every value scale in the
   artifact (positions 0–105 m, confidences 0–1, possession distances 0–2 m):
   it detects genuine cross-run drift while tolerating double-rounding noise.
   It is never loosened to make a failing comparison pass.
4. **COUNT for observability counters.** Fusion/replay counters
   (`entitiesUpserted`, `eventsApplied`, supersession/orphan accounting, …) are
   integers compared exactly, but tracked as a separate class so a counter
   mismatch reads as an observability difference, not a value drift.
5. **SET only where element order is genuinely semantically irrelevant** — and
   every SET rule justifies itself in its rationale (see §5). Arrays whose
   order carries meaning (the event log, the conflict ledger, warnings,
   checkpoints, evidence chains, conflict values paired to observation ids)
   are compared EXACT in order.
6. **NaN and undefined never coerce.** `NaN` values, `undefined`-vs-missing
   keys, and non-JSON types are explicit diffs carrying the JSON path (and the
   serializer rejects them outright — they cannot enter a serialized artifact
   at all).
7. **Volatile fields are forced constants, not exclusions.** No artifact field
   is excluded from comparison. Time-of-production fields are forced by
   construction — live-engine snapshots carry the pipeline's injected clock
   (`TEST_EPOCH_MS`), replay snapshots carry `REPLAY_GENERATED_AT_MS` (forced
   inside `@sporta/temporal`) — and the pipeline ASSERTS those constants before
   serialization. A leaked wall-clock read fails the run instead of being
   ignored: stronger than exclusion.
8. **Never looser than needed.** If a comparison fails, the fix is upstream
   determinism, a reviewed classification change (this document + the pin
   test + a golden regeneration), or a documented limitation (§8) — never a
   silently widened epsilon.

## 2. Pattern grammar

The table's `pattern` column matches FULL paths (no prefix matching):
`$` is the artifact root; a literal segment matches itself; `*` matches any
single object-key segment (used only where the key family is pinned by
`assertArtifactShape`: `$.fusion.*` ∈ {first, refusion}, `$.stateAt.*` = the
fixture's pinned timestamps); `[*]` matches any array-index or SET-element
locator. First matching rule wins; a path matching no rule is UNCLASSIFIED.

## 3. The classification table (208 rules — code-pinned, order-preserving)

| pattern | class | setKey | rationale |
|---|---|---|---|
| `$` | EXACT | — | artifact root container |
| `$.artifactSchema` | EXACT | — | schema tag string |
| `$.fixtureId` | EXACT | — | fixture identity string |
| `$.fixtureSha256` | EXACT | — | sha256 hex of the frozen fixture bytes — proves identical input across runs |
| `$.fusion` | EXACT | — | fusion section container |
| `$.fusion.*` | EXACT | — | fusion report container (first or refusion — keys asserted by shape check) |
| `$.fusion.*.entitiesUpserted` | COUNT | — | observability count |
| `$.fusion.*.eventsApplied` | COUNT | — | observability count |
| `$.fusion.*.eventsDeduplicated` | COUNT | — | observability count |
| `$.fusion.*.clockPatches` | COUNT | — | observability count |
| `$.fusion.*.possessionUpdates` | COUNT | — | observability count |
| `$.fusion.*.snapshotVersionAfter` | EXACT | — | integer engine snapshot version (state version, not an observability count) |
| `$.fusion.*.conflicts` | EXACT | — | conflict ledger in deterministic merge order — the ledger sequence cf-1, cf-2… is semantic |
| `$.fusion.*.conflicts[*]` | EXACT | — | conflict record container |
| `$.fusion.*.conflicts[*].conflictId` | EXACT | — | ledger sequence id string |
| `$.fusion.*.conflicts[*].slotKey` | EXACT | — | slot key string |
| `$.fusion.*.conflicts[*].observationIds` | EXACT | — | order-stable canonical (eventTimeMs, observationId) ordering — semantic |
| `$.fusion.*.conflicts[*].observationIds[*]` | EXACT | — | id string |
| `$.fusion.*.conflicts[*].values` | EXACT | — | values in observationIds order — paired ordering is semantic |
| `$.fusion.*.conflicts[*].values[*]` | EXACT | — | conflict value container |
| `$.fusion.*.conflicts[*].values[*].value` | EXACT | — | conflicting slot values — entity-id strings in this fixture (a future numeric value would need a conscious class decision) |
| `$.fusion.*.conflicts[*].values[*].confidence` | EPSILON | — | confidence in [0,1] — float-derived |
| `$.fusion.*.conflicts[*].resolution` | EXACT | — | enum (W401 never auto-resolves) |
| `$.fusion.*.conflicts[*].detectedAtMs` | EXACT | — | integer millisecond timeline position |
| `$.fusion.*.warnings` | EXACT | — | warnings in the fusion pass's documented deterministic emission order — tighter than needed semantically, deliberately (same binary ⇒ deterministic order) |
| `$.fusion.*.warnings[*]` | EXACT | — | warning string |
| `$.stateAt` | EXACT | — | stateAt section container |
| `$.stateAt.*` | EXACT | — | snapshot container — structural recursion |
| `$.stateAt.*.sessionId` | EXACT | — | id string |
| `$.stateAt.*.schemaVersion` | EXACT | — | contract version string |
| `$.stateAt.*.watermark` | EXACT | — | container |
| `$.stateAt.*.watermark.watermarkMs` | EXACT | — | integer millisecond timeline position |
| `$.stateAt.*.watermark.sequence` | EXACT | — | integer event-log sequence |
| `$.stateAt.*.entities` | SET | entityId | a snapshot is a world STATE: consumers resolve entities by id; the engine's array order is Map insertion order (an implementation detail), not semantic. Within one binary the order is deterministic anyway, so SET is not a loosening in practice |
| `$.stateAt.*.entities[*]` | EXACT | — | entity container — structural recursion |
| `$.stateAt.*.entities[*].entityId` | EXACT | — | id string |
| `$.stateAt.*.entities[*].kind` | EXACT | — | enum |
| `$.stateAt.*.entities[*].version` | EXACT | — | integer entity version (monotonic state version, not an observability count) |
| `$.stateAt.*.entities[*].lastEventTimeMs` | EXACT | — | integer millisecond timeline position |
| `$.stateAt.*.entities[*].state` | EXACT | — | state-slot container |
| `$.stateAt.*.entities[*].state.position` | EXACT | — | uncertainty-slot container |
| `$.stateAt.*.entities[*].state.position.status` | EXACT | — | enum |
| `$.stateAt.*.entities[*].state.position.value` | EXACT | — | point container |
| `$.stateAt.*.entities[*].state.position.value.x` | EPSILON | — | pitch meters — float-derived perception value |
| `$.stateAt.*.entities[*].state.position.value.y` | EPSILON | — | pitch meters — float-derived perception value |
| `$.stateAt.*.entities[*].state.position.confidence` | EPSILON | — | confidence in [0,1] — float-derived, passed through verbatim |
| `$.stateAt.*.entities[*].state.spatialFrame` | EXACT | — | uncertainty-slot container |
| `$.stateAt.*.entities[*].state.spatialFrame.status` | EXACT | — | enum |
| `$.stateAt.*.entities[*].state.spatialFrame.value` | EXACT | — | enum ("pitch" or "image") |
| `$.stateAt.*.entities[*].state.lastSeenMs` | EXACT | — | uncertainty-slot container |
| `$.stateAt.*.entities[*].state.lastSeenMs.status` | EXACT | — | enum |
| `$.stateAt.*.entities[*].state.lastSeenMs.value` | EXACT | — | integer millisecond timeline position |
| `$.stateAt.*.football` | EXACT | — | football extension container (optional key) |
| `$.stateAt.*.football.pitch` | EXACT | — | container |
| `$.stateAt.*.football.pitch.lengthAxisMeters` | EXACT | — | canonical constant literal (105) |
| `$.stateAt.*.football.pitch.widthAxisMeters` | EXACT | — | canonical constant literal (68) |
| `$.stateAt.*.football.pitch.origin` | EXACT | — | canonical literal |
| `$.stateAt.*.football.pitch.axes` | EXACT | — | canonical literal |
| `$.stateAt.*.football.clock` | EXACT | — | container |
| `$.stateAt.*.football.clock.period` | EXACT | — | enum |
| `$.stateAt.*.football.clock.clockMs` | EXACT | — | integer millisecond clock value |
| `$.stateAt.*.football.clock.stoppage` | EXACT | — | boolean |
| `$.stateAt.*.football.score` | EXACT | — | container |
| `$.stateAt.*.football.score.home` | EXACT | — | integer goals |
| `$.stateAt.*.football.score.away` | EXACT | — | integer goals |
| `$.stateAt.*.football.score.status` | EXACT | — | uncertainty-slot container |
| `$.stateAt.*.football.score.status.status` | EXACT | — | enum |
| `$.stateAt.*.football.score.status.value` | EXACT | — | enum ("provisional" or "confirmed") |
| `$.stateAt.*.football.score.status.confidence` | EPSILON | — | confidence in [0,1] — float-derived |
| `$.stateAt.*.football.possession` | EXACT | — | uncertainty-slot container |
| `$.stateAt.*.football.possession.status` | EXACT | — | enum |
| `$.stateAt.*.football.possession.value` | EXACT | — | container |
| `$.stateAt.*.football.possession.value.entityId` | EXACT | — | id string |
| `$.stateAt.*.football.possession.confidence` | EPSILON | — | possession confidence = ball × track × distance product — genuine float arithmetic |
| `$.stateAt.*.football.eventTaxonomyVersion` | EXACT | — | version string |
| `$.stateAt.*.generatedAtMs` | EXACT | — | forced-constant by construction (injected clock TEST_EPOCH_MS for live snapshots, REPLAY_GENERATED_AT_MS for replay snapshots) — asserted in the pipeline, compared exact |
| `$.eventWindow` | EXACT | — | eventWindow section container |
| `$.eventWindow.fromMs` | EXACT | — | integer ms window bound |
| `$.eventWindow.toMs` | EXACT | — | integer ms window bound |
| `$.eventWindow.entries` | EXACT | — | engine log order (event time then sequence) — the engine's application order, semantic |
| `$.eventWindow.entries[*]` | EXACT | — | stream-entry container |
| `$.eventWindow.entries[*].sequence` | EXACT | — | integer log sequence |
| `$.eventWindow.entries[*].snapshotVersionAfter` | EXACT | — | integer snapshot version |
| `$.eventWindow.entries[*].event` | EXACT | — | event envelope container |
| `$.eventWindow.entries[*].event.eventId` | EXACT | — | id string |
| `$.eventWindow.entries[*].event.sessionId` | EXACT | — | id string |
| `$.eventWindow.entries[*].event.schemaVersion` | EXACT | — | contract version string |
| `$.eventWindow.entries[*].event.eventTypeRef` | EXACT | — | typed event reference string |
| `$.eventWindow.entries[*].event.interval` | EXACT | — | interval container |
| `$.eventWindow.entries[*].event.interval.startTimeMs` | EXACT | — | integer ms |
| `$.eventWindow.entries[*].event.interval.endTimeMs` | EXACT | — | integer ms |
| `$.eventWindow.entries[*].event.eventTimeMs` | EXACT | — | integer ms timeline position |
| `$.eventWindow.entries[*].event.provenance` | EXACT | — | enum — provenance discipline preserved verbatim |
| `$.eventWindow.entries[*].event.confidence` | EPSILON | — | confidence in [0,1] — float-derived |
| `$.eventWindow.entries[*].event.evidence` | EXACT | — | evidence container |
| `$.eventWindow.entries[*].event.evidence.observationIds` | EXACT | — | evidence chain in builder order (candidate id first) — semantic |
| `$.eventWindow.entries[*].event.evidence.observationIds[*]` | EXACT | — | id string |
| `$.eventWindow.entries[*].event.evidence.reportedBy` | EXACT | — | reporter string (optional key) |
| `$.eventWindow.entries[*].event.correctionOf` | EXACT | — | superseded event id string (optional key) |
| `$.replay` | EXACT | — | replay section container |
| `$.replay.eventsApplied` | COUNT | — | observability count |
| `$.replay.correctionsApplied` | COUNT | — | observability count |
| `$.replay.supersededSkipped` | COUNT | — | observability count (supersession accounting) |
| `$.replay.correctionsOrphaned` | COUNT | — | observability count (orphan accounting) |
| `$.replay.duplicatesSkipped` | COUNT | — | observability count |
| `$.replay.limits` | EXACT | — | limits container |
| `$.replay.limits.maxEvents` | EXACT | — | integer replay limit (input echo, not an observability count) |
| `$.replay.limits.maxSpanMs` | EXACT | — | integer replay limit (input echo) |
| `$.replay.limits.checkpointEveryMs` | EXACT | — | integer replay limit (input echo) |
| `$.replay.checkpoints` | EXACT | — | checkpoints in application order (checkpoint cadence crossing order) — semantic |
| `$.replay.checkpoints[*]` | EXACT | — | snapshot container — structural recursion |
| `$.replay.checkpoints[*].sessionId` | EXACT | — | id string |
| `$.replay.checkpoints[*].schemaVersion` | EXACT | — | contract version string |
| `$.replay.checkpoints[*].watermark` | EXACT | — | container |
| `$.replay.checkpoints[*].watermark.watermarkMs` | EXACT | — | integer millisecond timeline position |
| `$.replay.checkpoints[*].watermark.sequence` | EXACT | — | integer event-log sequence |
| `$.replay.checkpoints[*].entities` | SET | entityId | a snapshot is a world STATE: consumers resolve entities by id; the engine's array order is Map insertion order (an implementation detail), not semantic. Within one binary the order is deterministic anyway, so SET is not a loosening in practice |
| `$.replay.checkpoints[*].entities[*]` | EXACT | — | entity container — structural recursion |
| `$.replay.checkpoints[*].entities[*].entityId` | EXACT | — | id string |
| `$.replay.checkpoints[*].entities[*].kind` | EXACT | — | enum |
| `$.replay.checkpoints[*].entities[*].version` | EXACT | — | integer entity version (monotonic state version, not an observability count) |
| `$.replay.checkpoints[*].entities[*].lastEventTimeMs` | EXACT | — | integer millisecond timeline position |
| `$.replay.checkpoints[*].entities[*].state` | EXACT | — | state-slot container |
| `$.replay.checkpoints[*].entities[*].state.position` | EXACT | — | uncertainty-slot container |
| `$.replay.checkpoints[*].entities[*].state.position.status` | EXACT | — | enum |
| `$.replay.checkpoints[*].entities[*].state.position.value` | EXACT | — | point container |
| `$.replay.checkpoints[*].entities[*].state.position.value.x` | EPSILON | — | pitch meters — float-derived perception value |
| `$.replay.checkpoints[*].entities[*].state.position.value.y` | EPSILON | — | pitch meters — float-derived perception value |
| `$.replay.checkpoints[*].entities[*].state.position.confidence` | EPSILON | — | confidence in [0,1] — float-derived, passed through verbatim |
| `$.replay.checkpoints[*].entities[*].state.spatialFrame` | EXACT | — | uncertainty-slot container |
| `$.replay.checkpoints[*].entities[*].state.spatialFrame.status` | EXACT | — | enum |
| `$.replay.checkpoints[*].entities[*].state.spatialFrame.value` | EXACT | — | enum ("pitch" or "image") |
| `$.replay.checkpoints[*].entities[*].state.lastSeenMs` | EXACT | — | uncertainty-slot container |
| `$.replay.checkpoints[*].entities[*].state.lastSeenMs.status` | EXACT | — | enum |
| `$.replay.checkpoints[*].entities[*].state.lastSeenMs.value` | EXACT | — | integer millisecond timeline position |
| `$.replay.checkpoints[*].football` | EXACT | — | football extension container (optional key) |
| `$.replay.checkpoints[*].football.pitch` | EXACT | — | container |
| `$.replay.checkpoints[*].football.pitch.lengthAxisMeters` | EXACT | — | canonical constant literal (105) |
| `$.replay.checkpoints[*].football.pitch.widthAxisMeters` | EXACT | — | canonical constant literal (68) |
| `$.replay.checkpoints[*].football.pitch.origin` | EXACT | — | canonical literal |
| `$.replay.checkpoints[*].football.pitch.axes` | EXACT | — | canonical literal |
| `$.replay.checkpoints[*].football.clock` | EXACT | — | container |
| `$.replay.checkpoints[*].football.clock.period` | EXACT | — | enum |
| `$.replay.checkpoints[*].football.clock.clockMs` | EXACT | — | integer millisecond clock value |
| `$.replay.checkpoints[*].football.clock.stoppage` | EXACT | — | boolean |
| `$.replay.checkpoints[*].football.score` | EXACT | — | container |
| `$.replay.checkpoints[*].football.score.home` | EXACT | — | integer goals |
| `$.replay.checkpoints[*].football.score.away` | EXACT | — | integer goals |
| `$.replay.checkpoints[*].football.score.status` | EXACT | — | uncertainty-slot container |
| `$.replay.checkpoints[*].football.score.status.status` | EXACT | — | enum |
| `$.replay.checkpoints[*].football.score.status.value` | EXACT | — | enum ("provisional" or "confirmed") |
| `$.replay.checkpoints[*].football.score.status.confidence` | EPSILON | — | confidence in [0,1] — float-derived |
| `$.replay.checkpoints[*].football.possession` | EXACT | — | uncertainty-slot container |
| `$.replay.checkpoints[*].football.possession.status` | EXACT | — | enum |
| `$.replay.checkpoints[*].football.possession.value` | EXACT | — | container |
| `$.replay.checkpoints[*].football.possession.value.entityId` | EXACT | — | id string |
| `$.replay.checkpoints[*].football.possession.confidence` | EPSILON | — | possession confidence = ball × track × distance product — genuine float arithmetic |
| `$.replay.checkpoints[*].football.eventTaxonomyVersion` | EXACT | — | version string |
| `$.replay.checkpoints[*].generatedAtMs` | EXACT | — | forced-constant by construction (injected clock TEST_EPOCH_MS for live snapshots, REPLAY_GENERATED_AT_MS for replay snapshots) — asserted in the pipeline, compared exact |
| `$.replay.final` | EXACT | — | snapshot container — structural recursion |
| `$.replay.final.sessionId` | EXACT | — | id string |
| `$.replay.final.schemaVersion` | EXACT | — | contract version string |
| `$.replay.final.watermark` | EXACT | — | container |
| `$.replay.final.watermark.watermarkMs` | EXACT | — | integer millisecond timeline position |
| `$.replay.final.watermark.sequence` | EXACT | — | integer event-log sequence |
| `$.replay.final.entities` | SET | entityId | a snapshot is a world STATE: consumers resolve entities by id; the engine's array order is Map insertion order (an implementation detail), not semantic. Within one binary the order is deterministic anyway, so SET is not a loosening in practice |
| `$.replay.final.entities[*]` | EXACT | — | entity container — structural recursion |
| `$.replay.final.entities[*].entityId` | EXACT | — | id string |
| `$.replay.final.entities[*].kind` | EXACT | — | enum |
| `$.replay.final.entities[*].version` | EXACT | — | integer entity version (monotonic state version, not an observability count) |
| `$.replay.final.entities[*].lastEventTimeMs` | EXACT | — | integer millisecond timeline position |
| `$.replay.final.entities[*].state` | EXACT | — | state-slot container |
| `$.replay.final.entities[*].state.position` | EXACT | — | uncertainty-slot container |
| `$.replay.final.entities[*].state.position.status` | EXACT | — | enum |
| `$.replay.final.entities[*].state.position.value` | EXACT | — | point container |
| `$.replay.final.entities[*].state.position.value.x` | EPSILON | — | pitch meters — float-derived perception value |
| `$.replay.final.entities[*].state.position.value.y` | EPSILON | — | pitch meters — float-derived perception value |
| `$.replay.final.entities[*].state.position.confidence` | EPSILON | — | confidence in [0,1] — float-derived, passed through verbatim |
| `$.replay.final.entities[*].state.spatialFrame` | EXACT | — | uncertainty-slot container |
| `$.replay.final.entities[*].state.spatialFrame.status` | EXACT | — | enum |
| `$.replay.final.entities[*].state.spatialFrame.value` | EXACT | — | enum ("pitch" or "image") |
| `$.replay.final.entities[*].state.lastSeenMs` | EXACT | — | uncertainty-slot container |
| `$.replay.final.entities[*].state.lastSeenMs.status` | EXACT | — | enum |
| `$.replay.final.entities[*].state.lastSeenMs.value` | EXACT | — | integer millisecond timeline position |
| `$.replay.final.football` | EXACT | — | football extension container (optional key) |
| `$.replay.final.football.pitch` | EXACT | — | container |
| `$.replay.final.football.pitch.lengthAxisMeters` | EXACT | — | canonical constant literal (105) |
| `$.replay.final.football.pitch.widthAxisMeters` | EXACT | — | canonical constant literal (68) |
| `$.replay.final.football.pitch.origin` | EXACT | — | canonical literal |
| `$.replay.final.football.pitch.axes` | EXACT | — | canonical literal |
| `$.replay.final.football.clock` | EXACT | — | container |
| `$.replay.final.football.clock.period` | EXACT | — | enum |
| `$.replay.final.football.clock.clockMs` | EXACT | — | integer millisecond clock value |
| `$.replay.final.football.clock.stoppage` | EXACT | — | boolean |
| `$.replay.final.football.score` | EXACT | — | container |
| `$.replay.final.football.score.home` | EXACT | — | integer goals |
| `$.replay.final.football.score.away` | EXACT | — | integer goals |
| `$.replay.final.football.score.status` | EXACT | — | uncertainty-slot container |
| `$.replay.final.football.score.status.status` | EXACT | — | enum |
| `$.replay.final.football.score.status.value` | EXACT | — | enum ("provisional" or "confirmed") |
| `$.replay.final.football.score.status.confidence` | EPSILON | — | confidence in [0,1] — float-derived |
| `$.replay.final.football.possession` | EXACT | — | uncertainty-slot container |
| `$.replay.final.football.possession.status` | EXACT | — | enum |
| `$.replay.final.football.possession.value` | EXACT | — | container |
| `$.replay.final.football.possession.value.entityId` | EXACT | — | id string |
| `$.replay.final.football.possession.confidence` | EPSILON | — | possession confidence = ball × track × distance product — genuine float arithmetic |
| `$.replay.final.football.eventTaxonomyVersion` | EXACT | — | version string |
| `$.replay.final.generatedAtMs` | EXACT | — | forced-constant by construction (injected clock TEST_EPOCH_MS for live snapshots, REPLAY_GENERATED_AT_MS for replay snapshots) — asserted in the pipeline, compared exact |

## 4. EPSILON fields — the measured evidence

On the checked-in fixture and golden (same binary, separate bun subprocesses):
every EPSILON field compares with **|deviation| = 0** (20 epsilon fields
compared; max deviation 0.0). The tolerance headroom (1e-9) is therefore
entirely unused by current drift — the harness reports `maxAbsDeviation` in
every comparison summary, so any future nonzero-but-within-tolerance drift is
visible evidence, not a silent pass.

## 5. SET rules — the justifications

Exactly one shape is compared as a SET (appearing at the three snapshot roots
`$.stateAt.*.entities`, `$.replay.checkpoints[*].entities`,
`$.replay.final.entities`):

- **snapshot entity arrays** (setKey `entityId`): a snapshot is world *state*;
  consumers resolve entities by id, and the engine's array order is Map
  insertion order — an implementation artifact, not semantics. Duplicate
  `entityId` keys inside one snapshot FAIL LOUD (never silently collapsed).
  Within one binary the order is deterministic anyway, so SET is not a
  loosening in practice; the runner additionally reports byte-identity of the
  canonical serializations (informational, see §6), which would surface any
  order drift as a visible non-identity.

Every other array in the artifact is compared EXACT, in order, because its
order is semantic: the event log (engine application order), the conflict
ledger (deterministic merge order, ledger ids `cf-1, cf-2…`), warnings
(fusion emission order), replay checkpoints (cadence crossing order),
conflict `observationIds`/`values` (canonical (eventTimeMs, observationId)
ordering / paired ordering), and event evidence chains (builder order,
candidate id first).

## 6. How comparisons run

`runCrossRunEvaluation` (`bun run evaluate` from the package) spawns the
pipeline in **N separate bun subprocesses** (default 2), then compares:

1. every run **pair** through the classified comparator;
2. run 1 against the **checked-in golden** through the same comparator;
3. byte-identity of the canonical serializations — **informational**
   (reported as `byteIdentical`, never assumed): tolerance is the gate;
   byte-identity is the stronger same-binary evidence. On the current fixture
   both hold (byte-identical, 0 diffs).

Exit codes: `0` comparable · `1` out-of-tolerance / unclassified field /
golden drift · `2` harness error.

## 7. Regenerating the golden (explicit, tech-lead-reviewed)

The golden baseline `fixtures/golden/w403-golden.json` is the acceptance
baseline of W403. It is NEVER regenerated by tests or by `evaluate`. To
regenerate after a reviewed change:

```bash
cd packages/evaluation
bun run regen-golden --confirm
```

The script (a) refuses to write without `--confirm`; (b) takes the canonical
bytes from one real subprocess run; (c) Prettier-formats the file (lossless;
verified by re-serialization); (d) proves self-consistency with a second
subprocess run AND an in-process run; (e) prints the old → new
`fixtureSha256` so a fixture change cannot hide.

**A regeneration is only valid after tech-lead review** of: the old→new
artifact diff, the fixture sha256 (must be unchanged unless the fixture change
was itself a separate reviewed commit), the classification table (this
document), and the reason the output legitimately changed. The checked-in
fixture itself is never regenerated — it is frozen input; changing it is a
separate, reviewed act that invalidates the golden by `fixtureSha256`.

## 8. Limitations (measured, honest)

- **Replay supersession/orphan/duplicate accounting is compared but currently
  measures 0.** The fixed chain store → fusion → `eventsSince(0)` derives no
  correction events: W401 fusion maps no commentary vocabulary to
  corrections, and engine event ids are unique, so
  `$.replay.correctionsApplied`, `supersededSkipped`, `correctionsOrphaned`,
  and `duplicatesSkipped` are structurally 0 on this fixture (the fields are
  COUNT-compared, so any nonzero drift still fails the evaluation). Those
  code paths are pinned by `@sporta/temporal` unit tests; exercising them
  through THIS harness needs a correction-producing seam in the fusion input
  chain, which does not exist yet — extending it is a conscious fixture +
  classification + golden change (TL-reviewed), not a tolerance change.
- **Possession is exercised through the tie→conflict path only** (the final
  frame's pB/pC equidistance produces the `cf-1` possession conflict;
  `possessionUpdates` measures 0). The winning-path possession confidence
  (EPSILON) is therefore not measured on this fixture.
- **Score fusion stays out of scope** (W401 documented limitation: no honest
  scorer-side resolution exists yet) — score fields compare EXACT at their
  initial unknown/0 values.
- **Byte-identity is same-binary evidence only.** Cross-binary (different bun
  or platform versions) comparability is NOT claimed; the tolerance contract
  exists precisely because byte-level guarantees do not cross that boundary.
