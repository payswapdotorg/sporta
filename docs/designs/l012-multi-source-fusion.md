# L012 — Multi-Source Evidence Fusion: Design

Status: DESIGN (Wave 3, Worker A) — implemented on this branch
Date: 2026-09-21
Related: `docs/contracts/live-reality.md` (FROZEN §1-§4, §7, §9), ADR-010, `docs/designs/l003-incremental-swm-updater.md`, `docs/designs/l004-temporal-buffer-watermark-engine.md`, `packages/live-source` (L002), `packages/live-temporal` (L004), `packages/live-swm` (L003), `packages/live-perception` (L011), `packages/live-open-data` (L007/L008), `packages/fusion` (the batch conflict ledger), `docs/work-items/mvp-and-live-reality-work-items.md` (L012 acceptance)

## 1. The problem being solved

Wave 2 landed three REAL LiveObservation producers: the L002 deterministic
tracking source, the L011 broadcast-perception seam (real MP4 → detect →
track → calibrate → observation) and the L007 SkillCorner open-data replay.
Each drives the SAME composition — `LiveObservation → TemporalBufferEngine
(L004) → LiveSwmUpdater (L003) → WorldModelEngine` — but each ALONE. When
two or more sources observe the SAME session concurrently:

- co-observed entities get upserted in arrival order, and a same-time
  disagreement is resolved by the STABLE SORT's insertion order — a SILENT
  winner by accident of batching, exactly what L012 forbids;
- nothing records that two sources disagreed, or that one stream was lost
  while the other kept the world alive;
- no deterministic fallback policy governs which evidence the canonical SWM
  follows when the preferred source disappears.

L012 is the fusion seam that makes multi-source operation EXPLICIT:
conflicts become `ConflictRecord`s (the batch ledger shape), the
arbitration/fallback policy becomes DATA + tests, and source loss becomes
accounted events — while the ONE canonical engine keeps being the only world
truth.

## 2. The seam decision (survey record)

The work item suggests "packages/live-fusion OR an extension of live-swm".
Survey findings that drove the choice:

- `packages/live-temporal`'s engine doc states verbatim: "multi-source
  (per-source watermarks, buffers and accounting — multiple sources NEVER
  contaminate each other's temporal state; the fusion of their evidence is
  the L012 updater lane's concern, not the engine's)". L004 already carries
  per-source state and a cross-source event-time-ordered `DrainResult`.
- `packages/live-swm`'s updater already accepts batches from ANY sourceId
  (per-source sequence frontiers, D7) and owns per-batch application
  semantics (D2 no-op guard, per-entity replay frontier, D3 verbatim
  confidence/provenance, D6 bridge). None of those rules may change for
  single-source operation — extending the updater itself with cross-source
  arbitration would entangle two concerns the designs keep separate.
- The batch program's own split is the precedent: `packages/fusion` owns
  conflict detection (`detectSlotConflicts`, the W401 ledger) as a PURE
  module beside the application pass.

DECISION: a NEW `packages/live-fusion` — a DRIVER composing the existing
seams (an injected `TemporalBufferEngine` + an injected `LiveSwmUpdater`),
owning ONLY the cross-source concern: co-observation grouping, conflict
detection, deterministic arbitration, fallback/source-loss accounting, and
the multi-source §9 report. Like L003 it holds NO world state of its own.

```text
source A (TRACKING, L002) ─┐
source B (BROADCAST_      ─┤→ LiveFusionEngine.admit()/tick()
  PERCEPTION, L011)        ─┤     ├─ delegates admissions → TemporalBufferEngine (L004)
source C (TRACKING,        ─┘     ├─ fuses each DrainResult (groups, conflicts,
  L007 SkillCorner replay)          arbitration, withholding)
                                    └─ applies fused batches → LiveSwmUpdater (L003)
                                          → WorldModelEngine (the ONE canonical SWM)
```

## 3. Design decisions

### D1 — Coexistence through the existing composition (no new path)

Multiple sources flow through the ONE temporal engine (per-source state,
never contaminated) and the ONE updater (per-source frontiers) into the ONE
canonical engine. A fusion run with sources that never co-observe (or always
agree) passes every batch VERBATIM — provenance, confidence, dual clocks and
watermarks untouched — so single-source behavior is bit-identical to Wave 2
(pinned by replay of the L011/L007 composition shapes in tests).

Authority: frozen §7 ("replacement; ensemble; cascade; fallback" all remain
possible); ADR-010 (one canonical SWM); L012 acceptance ("feeding the SAME
canonical engine through L004→L003").

### D2 — Per-source provenance is carried VERBATIM

The updater's D3 rule already projects each row's confidence verbatim and
bridges each row with its BATCH's provenance. The fusion layer NEVER rewrites
provenance, confidence, quality, sequence or clocks: a withheld or passed
row keeps its source's `provenance` kind into the W005 store (the D6
bridge), so the SWM's evidence chain is per-source by construction. The
`sourceSummary` of the fusion report makes the per-source mix visible
(per-source counters + watermark + state).

Authority: L012 acceptance ("per-source provenance carried verbatim into the
SWM"); frozen §7 ("the SWM records provenance and confidence").

### D3 — Co-observation groups + movement-plausibility tolerance

Per drain, rows for the SAME `entityRef` delivered by ≥2 DISTINCT sources
are grouped by the connected-component relation "consecutive event-time gaps
≤ conflictWindowMs" (the batch `detectSlotConflicts` comparability rule,
mirrored). A group CONFLICTS when ANY pair of its rows disagrees beyond the
movement-plausibility tolerance:

```text
distanceM(row_i, row_j) > toleranceM + maxSpeedMps × |t_i − t_j| / 1000
```

(defaults: `toleranceM = 1.0`, `maxSpeedMps = 10` — above the fastest
sustained football sprint; a faster-than-plausible displacement between
window-comparable rows is DISAGREEMENT, never silently smoothed). Rows whose
disagreement is within the tolerance are CORROBORATION — counted, no record
(agreeing evidence is corroboration, the batch rule).

Authority: `packages/fusion/src/conflicts.ts` ("records farther apart are
sequential updates, not conflicting evidence"); L012 acceptance ("conflicts …
beyond tolerance", "never a silent average").

### D4 — The conflict ledger reuses the batch `ConflictRecord` verbatim

Every conflicting group mints a `ConflictRecord` (the `@sporta/fusion`
shape the `LiveUpdateReport.conflicts` member already carries):

- `observationIds` = the live bridge id scheme `lo-<sourceId>-<zero-padded
  sequence>-<entityRef>` — the SAME ids the D6 bridge stores, so the ledger
  and the SWM evidence chain address the same rows;
- `values` = each row's pitch position `{xMeters, yMeters}` (+ `zMeters`
  when present) with its confidence — every conflicting value listed, none
  dropped;
- `resolution: "none"` — the conflict STANDS in the ledger (the W401 rule:
  never auto-resolve, never average);
- `detectedAtMs` = the group's max event time.

The arbiter's decision is carried SEPARATELY and explicitly (D5) — the
conflict is never "resolved" silently by a winner; the winner is the
documented policy's DETERMINISTIC choice, recorded in the fusion report.

Authority: frozen §7 ("the SWM records provenance and confidence");
architecture-lock §4 (conflicting evidence never silently collapsed).

### D5 — The deterministic arbitration + tie/fallback policy (DATA)

THE POLICY (documented, configured, tested — never hidden renderer logic):

1. EVENT-TIME AUTHORITY (the frozen temporal rule): co-observed rows at
   DIFFERENT event times are SEQUENTIAL updates — both apply; the later row
   is newer evidence (the engine's own no-op guard makes a rewind
   impossible). No arbitration, no withholding.
2. SAME-TIME TIES within a CONFLICTING group: the SURVIVOR is the tie's max
   row by the CANONICAL REPLAY ORDER — `(sourceId, sequence)` — the exact
   row the W005 store's batch `runWorldFusion` pass applies LAST (the
   zero-padded bridge id scheme `lo-<sourceId>-<padded sequence>-<entityRef>`
   makes the lexicographic observation-id order equal the
   `(sourceId, sequence)` order). Every other row of the tie is WITHHELD —
   counted (`conflictRowsWithheld`), fully recorded in the conflict ledger,
   never bridged into the SWM store (D8 equality). The survivor's row
   applies VERBATIM (never averaged).
   - WHY canonical, not precedence: the frozen §8 requires the live
     session's final state to equal the replay's final state for the same
     evidence. A precedence-decided survivor diverges from the replay
     whenever the precedence winner is not the canonical-last row and the
     tie spans drains (the loser was already applied/bridged before the
     winner arrived). The canonical survivor makes the equality hold BY
     CONSTRUCTION for EVERY arrival order: a late-arriving canonical-max
     applies on top; a late-arriving non-max is withheld; the engine
     converges to the canonical-max of the arrived tied rows —
     arrival-order-free. This was discovered WHILE implementing the
     arbitration (the first design draft used precedence as the survivor
     rule; the replay-equality test proved the divergence) — recorded here
     as the honest reason for the rule.
   - THE OPERATOR'S PRECEDENCE PREFERENCE (`sourcePrecedence` in the policy)
     is REPORTED on every arbitration decision (the preferred source +
     `precedenceMatchesSurvivor`) and governs fallback reporting — it can
     NEVER override the canonical survivor. A precedence override is a
     CONTRACT-CHANGE REQUEST (the frozen §7 precedence rule is honored as
     configuration for the preference; the §8 equality is the harder
     constraint). Same-source ties: the newer sequence is the canonical-max
     (a source's newest same-time emission survives).
3. CANONICAL APPLICATION ORDER: within a drain, the fused batches apply
   sorted by `(eventTimeMs, sourceId, sequence)` — the batch-level
   projection of the same canonical replay order — so agreeing tied rows
   (both applied — corroboration) also end on the canonical-last row,
   exactly like the replay.
4. FALLBACK ON SOURCE LOSS: when a source stops delivering (D6), the
   surviving sources continue feeding the engine — event-time authority
   continues uninterrupted; the loss itself is an EXPLICIT accounted event
   (never a gap in the world silently papered over). When a lost source
   recovers, its rows rejoin the same arbitration by rule 2 — no
   special-casing (a recovered source's late-arriving canonical-max rows
   apply on top; its non-max rows are withheld like any other).

NEVER a silent average: the arbitration never merges/averages positions;
the survivor's row applies VERBATIM. NEVER a silent winner: the conflict
record + the withheld counter + the explicit decision (survivor, withheld
sources, the operator preference, the deciding rule) make every choice
observable.

Authority: L012 acceptance ("deterministic tie/fallback policy documented +
tested", "never a silent winner, never a silent average"); frozen §7
(precedence as configuration — honored for the REPORTED preference); frozen
§8 ("A live session must be able to become a replay session without
translating into a second canonical model" — the constraint that pins the
survivor rule).

### D6 — Honest source-loss accounting

Source loss is the L004 engine's OWN detection, consumed VERBATIM: the
per-source honest state machine (BOOT/NOMINAL/REORDERING/DEGRADED/STALLED)
rides every `DrainResult` per source. The fusion layer observes the
transitions and records the fusion-level events:

- a previously-`hasObserved` source entering `STALLED` (no in-window
  progress for L004's `stallBudgetMs` of render clock — the engine's own
  budget, never a second detector) mints a `SourceLoss` event
  (`sourceId`, `atRenderClockMs`, the source's watermark at loss) and the
  `sourcesLost` counter; the report's `sourceSummary` state flips to
  `"lost"`;
- leaving `STALLED` (an in-window arrival cleared the latch — the
  post-reconnect recovery path) mints `SourceRecovered` +
  `sourceRecoveries` (the reconnect itself is already accounted by L004's
  `reconnects`/`recovery` member — never double-counted);
- while any previously-seen source is lost, the report carries
  `fallbackActive: true` — the surviving sources carry the world, VISIBLE,
  not silent (the fallback itself is D5.3).

The per-source summary also carries the L004 counters VERBATIM
(`lateDropped`, `droppedObservations`, `extrapolatedObservations`,
`reconnects`, `watermarkLagMs`, the state) plus the fusion-layer per-source
counters (rows applied / withheld / corroborating, conflicts involving the
source).

Authority: L012 acceptance ("honest source-loss accounting when one stream
drops"); frozen §4 ("exposes lag/degraded state rather than pretending").

### D7 — The multi-source §9 accounting surface

The `FusionReport` (JSON-safe, deterministic — no clock, no RNG; the render
clock is INJECTED) carries per drain:

- per-batch application: the L003 `LiveUpdateReport`s VERBATIM (entities
  upserted, late/extrapolated/possession counters, snapshot version);
- the conflict ledger for the drain (`ConflictRecord`s + withheld row
  count + corroboration count);
- per-source summaries (applied batches/rows, withheld rows, watermark,
  L004 per-source counters VERBATIM: dropped/late/duplicate/extrapolated/
  reconnects, state: `"active" | "lost" | "never-seen"`);
- source-loss/recovery events;
- the §9 aggregate: `droppedObservations`, `extrapolatedObservations`,
  `reconnects` (summed per-source, never double-counted — the fusion layer
  adds only its OWN counters on top), plus the fusion-only counters.

Identity switches and renderer frame drops stay owned by the layers that
measure them (L005 render seam) — the fusion surface notes the boundary
honestly rather than fabricating them.

### D8 — D6 replay equality is preserved (arbitrated stream = stored stream)

Withheld rows NEVER reach the updater — therefore never the W005 bridge —
therefore the batch `runWorldFusion` pass over the same store replays
EXACTLY the arbitrated stream and reproduces the live engine's final state
(the multi-source replay-equality test pins it). The withheld evidence
lives in the conflict ledger (values + confidences verbatim), never in the
canonical store — documented, tested.

### D9 — No frozen-contract changes

Everything is live-layer additive (the L002/L003/L011 additive precedent).
The frozen LiveObservation/EntityObservation/Watermark shapes are consumed
VERBATIM; the fused batch reuses the SAME schema (identity fields verbatim,
`entityObservations` filtered by the arbiter). A fused batch that would
become empty (all rows withheld) is SUPPRESSED — counted
(`emptyBatchesSuppressed`), never an invalid document; the L004 sequence
accounting already resolved that batch, so the stream's hole accounting
stays honest upstream.

## 4. Package layout

```text
packages/live-fusion/
  src/policy.ts      — LiveFusionPolicy (precedence, tolerance, window,
                        loss budget) + validation (fail-loud)
  src/groups.ts      — co-observation grouping + tolerance checks (pure)
  src/conflicts.ts   — ConflictRecord minting (the batch shape, live ids)
  src/report.ts      — FusionReport + stats + canonical serialization
  src/engine.ts      — LiveFusionEngine (the composing driver)
  src/index.ts       — exports
  test/policy.test.ts, groups.test.ts, conflicts.test.ts,
  test/engine.test.ts (arbitration/tie/fallback/withholding/source loss),
  test/integration.test.ts (2–3 REAL sources → one canonical engine;
       replay equality; provenance verbatim; §9 multi-source accounting)
```

## 5. What L012 does NOT own

- No transport (the W915 SSE lane and Worker B's L006 telemetry plumbing
  own delivery/aggregation of the §9 surface).
- No renderer input changes (L005/L013 keep consuming the live view).
- No new canonical truth: the engine remains the single world model.
- No event-candidate fusion (the updater's dormant event path stays
  dormant — EVENT_FEED/COMMENTARY sources are admitted but carry no entity
  rows today; their fusion is a later increment, honestly out of scope).
