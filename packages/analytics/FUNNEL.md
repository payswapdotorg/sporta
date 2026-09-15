# W804 — Product Funnel & Failure Metrics: The Normative Definition

This document is the authority for `@sporta/analytics`: the funnel stages
and their evidence sources, the boundary attribution rules, the complete
metric catalog with formulas, the privacy scope, and the honest limits of
what the W706 vocabulary can evidence. The code authority is
`src/funnel.ts` (the stage/boundary/ownership tables), `src/report.ts`
(`computeProductAnalytics` — the pure computation), `src/schema.ts` (the
versioned zod report schema), and `src/input.ts` (the W706 input gate).
Tests pin every rule in this document against `packages/analytics/test/`.

## §1 Scope: offline analytics over RECORDED streams

W804's accept criterion: *"product funnel and failure metrics are
documented, privacy-scoped, and actionable."* The package computes metrics
OFFLINE as a PURE, DETERMINISTIC function of a recorded W706 viewer
telemetry event stream (`@sporta/viewer-shell`, schema version 1 — the
JSONL the `telemetry-file-sink` writes, or equivalent recorded values).
There is **no collection, no network, no clock, and no randomness in this
package** — analytics only interprets what was already recorded; building
the collection/transport machinery is operations' world (W805), not W804's.

The entry points:

| Function | Purpose |
| --- | --- |
| `parseRecordedEvents(values)` / `parseRecordedJsonl(lines)` | validate a recorded stream through the REAL W706 validator (the privacy gate) |
| `computeProductAnalytics(events)` | the pure computation (re-validates every event first) |
| `analyzeRecordedStream(values)` | parse + compute in one step |
| `parseAnalyticsReport(value)` | validate a report document (fail-loud, versioned) |
| `serializeAnalyticsReport` / `deserializeAnalyticsReport` | canonical (byte-deterministic) report bytes |

## §2 The privacy scope

**Input boundary (the one gate).** Every event enters analytics through
`@sporta/viewer-shell`'s `parseTelemetryEvent` — exact-key allowlists,
closed vocabularies, scalar-only shapes. A wider event (any extra key: a
policy, a payload, a user id, a free-form record) fails with W706's own
rejection reason, naming the field. Analytics never re-implements the
schema, so it can never drift wider than W706. This is pinned by tests
(the sensitive-key battery).

**The report goes further than the input.** The report is AGGREGATE-ONLY:
no session ids, no error messages, no free-form text anywhere in the
report shape — only counts over the closed vocabulary, the verbatim
closed failure classes, the W706 remediation hints, and the W804 owner
notes. Pinned by tests (the serialized report cannot contain `sess-` or
any crafted error message).

**What analytics may see** (the complete W706 vocabulary): state
transitions, the three timed operations, error occurrences (class,
operation, bounded message, remediation hint), rebuffer-stall episodes,
integrity-verified facts, structured user feedback, the opaque
`sess-<n>` correlation id.

**What analytics can never see** (unrepresentable in the input):
authorization policies, media/artifact content, source frames, renderer
payloads, free-form user text, user identifiers, IPs, user agents, any
client fingerprint.

## §3 The funnel's unit — and the connection block outside it

The funnel's unit is the **session cohort**: the set of recorded events
carrying the same opaque control-plane session id (`sess-<n>`). Cohorts
are counted, never users — one user may run many sessions, and the
vocabulary cannot represent users at all (a metric that needed a user
count would be a documented gap, never an invented one; see §10).

A cohort **evidences a stage** when any of its events matches the stage's
evidence rule (a `state-transition` target status — the real viewer state
machine, driven by the real W701 control-plane seams).

The viewer-level **connection block is deliberately OUTSIDE the funnel**:
its unit is the viewer run, not the session (one `connect` can precede
many sessions — a connect→session "conversion" would be a unit mismatch,
and inventing one would be dishonest). The report carries
`connection.attempts/successes/failures/timing` as its own block, and the
schema cross-checks `connection.failures` against the connect-operation
error events in the failure histogram.

## §4 The stages and their evidence

Two paths share the first stage. Every stage's evidence is a
`state-transition` target from the REAL state machine
(`viewer-core.ts`); each is reached exactly when the named real seam
succeeded.

### Batch spine (the render path)

| # | Stage | Evidence (`state-transition` to) | The real seam that emits it |
| --- | --- | --- | --- |
| 1 | `session-engaged` | `session-detail` | W701 `openSession` succeeded (`getSession` + `listRenders` both passed the fail-closed rights gate; the emitter stamps the session id BEFORE this transition, so the event carries the cohort id) |
| 2 | `renderer-selection` | `renderer-selection` | W703 `beginRender` succeeded (`listRenderers` returned capabilities; the selection view derived) |
| 3 | `render-requested` | `render-queued` | the `createRender` dispatch was accepted (the machine sets it synchronously at dispatch begin — the W701 request is in flight) |
| 4 | `output-ready` | `ready` | the render's playable output loaded (W705: the real W504 playback provider; `loading-output` → `ready`) |
| 5 | `batch-playing` | `playing` | the player started (the W502 frame player or the W504 SMIL segment player's presentation is playing) |

### Live branch (the W704 path — joins at the session, bypasses rendering)

| # | Stage | Evidence | The real seam |
| --- | --- | --- | --- |
| 1 | `session-engaged` | (shared, above) | — |
| 2 | `live-requested` | `live-connecting` | the `openLive` dispatch passed the fail-closed `liveDelivery` rights pre-check and the offer dance began |
| 3 | `live-playing` | `live-playing` | the W305 offer validated, the stream attached, the live player at the live edge |

Non-stage statuses (`connecting`, `browsing-sessions`, `loading-output`,
`outputs-pending`, `paused`, `ended`, `live-reconnecting`, `live-ended`,
`error`, `disconnected`) are navigation, processing, and terminal states —
NOT funnel advances; they are classified, and several are attribution
signals (§5).

Enrichment counters (not stages): `batchPlaybackCompleted` counts cohorts
with an `ended` transition (a batch clip played through);
`liveEndedObserved` counts cohorts with a `live-ended` transition (a live
stream completed or stopped honestly).

## §5 The boundaries and the attribution rules

One boundary per funnel advance. Session-scope boundaries count COHORTS
that reached `fromStage` but not `toStage`; viewer-scope boundaries count
failed ATTEMPTS (error events at the boundary's operations).

The attribution priority (fixed, normative): **errors first, then the
named signals in table order, then the honest catch-all.** Exactly one
category per dropped unit (the schema enforces
`Σ attribution.count === dropOffs`).

| Boundary | Scope | Error operations | Named signals (in order) |
| --- | --- | --- | --- |
| `viewer→connected` | viewer (attempts) | `connect` | — |
| `connected→session-engaged` | viewer (attempts) | `createSession`, `openSession` (a failed open/create never set a session id — viewer-scoped by construction) | — |
| `session-engaged→renderer-selection` | session | `beginRender` | `live-path-taken`, `batch-path-taken`, `no-error-observed` |
| `renderer-selection→render-requested` | session | — (the dispatch cannot observably fail before `render-queued`) | `selection-cancelled`, `no-error-observed` |
| `render-requested→output-ready` | session | `createRender`, `selectRender` (the render-then-load flow AND every re-select load — including segment-integrity failures — fail under these) | `outputs-pending`, `load-in-progress`, `no-error-observed` |
| `output-ready→batch-playing` | session | — (`play` is a local player command with no failing seam) | `no-error-observed` |
| `session-engaged→live-requested` | session | `openLive` (the whole offer dance and the W704 rights pre-check: a denial never reaches `live-connecting`, so it fails HERE) | `batch-path-taken`, `no-error-observed` |
| `live-requested→live-playing` | session | `openLive` (the offer dance: request → validate → answer → attach; every reconnect teardown verdict) | `no-error-observed` |

The named signal rules (evaluated in the boundary's table order, first
match wins):

- `live-path-taken` — the cohort evidenced `live-requested` or
  `live-playing` (it took the other path — not a drop-off in intent);
- `batch-path-taken` — the cohort evidenced any batch stage beyond the
  shared first (`render-requested`, `output-ready`, `batch-playing`);
  this covers the `selectRender` entry point on a session with
  pre-existing renders (the batch path entered without the selection
  screen — a skip, not a drop-off);
- `outputs-pending` — the cohort observed the W705 processing state
  (`outputs-pending`: the render exists, its output not stored yet);
- `load-in-progress` — the cohort observed `loading-output` (the load was
  in flight when the window ended);
- `selection-cancelled` — the cohort exited renderer selection back to
  the session view without a following `createRender` dispatch (the
  `cancelRenderSelection` adjacency: `renderer-selection →
  session-detail` not followed by `session-detail → render-queued`);
- `no-error-observed` — no failure observed; the session simply did not
  proceed (the honest catch-all — includes idle sessions and windows
  truncated mid-motion).

For a cohort with an error at the boundary's operations, the LAST such
error's class is attributed (verbatim, never re-mapped); earlier errors
at the same operations remain in the per-class histogram and the
`byOperation` split.

## §6 Session outcomes (the terminal failure metrics)

Every observed cohort lands in EXACTLY one outcome (schema-pinned: the
rows total `accounting.sessionsObserved`):

| Outcome | Rule |
| --- | --- |
| `playback-started` | the cohort evidenced `batch-playing` OR `live-playing` (either path's goal — reached is reached, even if a later error followed the playback) |
| `error-terminal:<class>` | the cohort never played, and its LAST `error-occurred` event has NO subsequent stage-evidencing transition (new OR repeated) — the error was the cohort's last observed funnel-relevant fact. A recovery that RE-REACHES a previously-seen stage (retry succeeded, or the error was dismissed back to the session view) clears the error: observed motion after the error means the session moved past it. |
| `no-terminal-error` | never played, no terminal error — the session simply did not (or not yet) proceed |

## §7 Recording order, sequence, and multi-run files

The input array's order (a JSONL reader supplies line order — the file
sink guarantees line order equals record order) is the AUTHORITATIVE
total order. `sequence` is a PER-EMITTER-RUN counter: a recording file
appended across runs (the dev server's default telemetry path) contains
several 1..n runs concatenated, so sorting by `sequence` globally would
interleave runs wrongly — analytics never reorders. Adjacent
non-increasing `sequence` values are counted in
`accounting.sequenceAnomalies` (visibility for reordered lines and run
boundaries), never silently fixed.

## §8 Partial sessions and skip paths (the honesty rules)

- **Partial sessions**: a cohort with events but NO observed
  establishment transition (`browsing-sessions → session-detail`) had a
  truncated window or began mid-session. It is COUNTED and FLAGGED
  (`accounting.partialSessions`), never dropped — its stages are its
  observed evidence.
- **The selectRender skip path**: a session with pre-existing renders can
  reach `output-ready` via `selectRender` (session-detail →
  loading-output → ready) WITHOUT ever evidencing `renderer-selection` or
  `render-requested`. Stage counts are therefore INDEPENDENT evidence
  counts, not a strict subset chain: a conversion between adjacent stages
  can legitimately exceed 1 when skip-path or partial-window cohorts
  reach the later stage without the earlier one. The report carries the
  counts and the partial-session flag; a reader quoting a conversion
  above 1 should look at `partialSessions` first.
- **Players start `ready`**: both players' initial playback status is
  `ready`, so `batch-playing` is always preceded by `output-ready` within
  a continuous observation.

## §9 The metric catalog (formulas)

Every field of `ProductAnalyticsReport`, in report order:

**`vocabulary`** — the versions the report was computed against
(`telemetrySchemaVersion` from W706, `funnelSpecVersion` from this spec):
drift made visible.

**`funnel.batch` / `funnel.live`** — per stage:
`reached = |{cohorts evidencing the stage}|`;
`conversionFromPrevious = reached(stage) / reached(previous)` (`null` for
the first stage or a zero denominator — absent stays absent);
`evidence` = the stage's evidence rule (constant string).

**`funnel.playbackStartedOverall`** = `|{cohorts with batch-playing OR
live-playing}|`; **`funnel.engagedToPlaybackStarted`** = that /
`reached(session-engaged)` (`null` at zero).

**`funnel.batchPlaybackCompleted`** = cohorts with an `ended` transition;
**`funnel.liveEndedObserved`** = cohorts with a `live-ended` transition.

**`connection.attempts`** = transitions with target `connecting`;
**`successes`** = transitions `connecting → browsing-sessions`;
**`failures`** = `error-occurred` events with operation `connect`
(schema-pinned equal to the histogram's connect column); **`timing`** =
nearest-rank stats over the `connect` `operation-timing` durations
(`null` when none observed).

**`failures.byClass`** — one bucket per closed failure class (all 12,
zeros included, verbatim class names, never re-mapped): `events` (total
`error-occurred` of the class), `byOperation` (the full closed operation
split), `sessionScoped` + `viewerScoped` (events carrying / not carrying a
session id — schema-pinned to sum to `events`), `remediationHint`
(VERBATIM from W706's `REMEDIATION_HINTS` table), `ownerNote` (this
package's `OWNER_NOTES` — the actionable ownership pointer).

**`failures.viewerBoundaries` / `failures.sessionBoundaries`** — the §5
tables: `dropOffs` + the attribution rows summing to it
(schema-pinned).

**`failures.sessionOutcomes`** — the §6 outcomes (one row per outcome
class, zeros included; totals pinned to `sessionsObserved`).

**`playbackHealth.rebufferStalls`** — `events`, `sessions` (distinct
session ids), `frameDeficit.total` / `frameDeficit.max` = Σ / max of
`frameCount − availableFrames` per stall event (frames missing at the
stall — the honest buffering signal; there is no dropped-frame fact).

**`playbackHealth.integrityVerified`** — `events`, `sessions`,
`maxByteLength`, `maxFrameCount` (the real W504 client-side integrity
checks).

**`feedback`** — counts per closed feedback kind (playback-good /
playback-stalled / playback-poor).

**`timings`** — nearest-rank `TimingStats` (count/min/max/mean/p50/p95)
per timed operation (`connect`, `load-output`, `openLive`; `null` when
none observed). The percentile method is nearest-rank (no interpolation —
every percentile is a value that actually occurred; the repo's pinned
precedent, W007/W306).

**`accounting`** — the never-silent ledger: `eventsIn`,
`classified`, `unclassifiable` (observed-only rows: reason + count,
sorted), `sequenceAnomalies` (§7), `sessionsObserved` (distinct cohort
ids), `partialSessions` (§8). The identity
`eventsIn === classified + Σ unclassifiable` is enforced TWICE: thrown
as `AnalyticsAccountingError` by the computation, and re-checked by the
report schema on every parse.

The `unclassifiable` reasons (the defensive, counted-never-dropped
paths): `stage-evidence-without-session-id` (a stage-evidencing
transition carrying no session id — impossible from the real emitter,
which stamps the id before the establishing transition, so it marks a
hand-built or corrupted stream), and the vocabulary-growth guards
(`unknown timed operation '…'`, `unknown failure class '…'`,
`unknown event kind '…'` — unreachable under schema v1, kept so a future
vocabulary bump can never silently drop events).

## §10 Documented gaps (wanted metrics the vocabulary cannot honestly evidence)

These are NOT computed — computing them would require widening the W706
surface, which is exactly what W804 must never do. A vocabulary bump
(W706's process) is the honest route to any of them:

- **Time-in-stage / funnel timing beyond the three timed operations** —
  `atMs` deltas between arbitrary transitions are not declared evidence
  (clock-domain caveats aside); only `connect`, `load-output`, and
  `openLive` durations exist, as timed operations.
- **Unique users / viewers / repeat usage** — no user identifier exists;
  the cohort is the session, and nothing may be invented above it.
- **Dropped-frame rate** — no dropped-frame fact exists (players stall
  honestly; W305's transport accounts skips itself). The rebuffer-stall
  episode is the honest equivalent, reported as such.
- **Renderer health / quality** — no `rendererHealth` fact is collected
  (W706's documented limitation); renderer-side quality is W605/W803's
  world.
- **Error frequency by renderer or render** — error events carry no
  renderer/render reference (privacy scope); only the operation split
  exists.
- **Consent-gated opt-in rates** — no consent workflow exists yet (the
  deployment prerequisite in README §"Boundaries").
- **Session duration / idle time** — `ended` vs establishment deltas are
  not declared evidence, and `atMs` is an injected-clock domain, not
  wall time.

## §11 The dashboard-ready shape (for W805 — documented, not built)

The report is deliberately shaped so W805's production observability can
consume it without re-derivation (W805 owns dashboards/alerts over
server-side health; W804 owns the product interpretation — the seam is
this document):

- `funnel.batch.stages[]` and `funnel.live.stages[]` are ordered tables —
  `stage` label, `reached` value, `conversionFromPrevious` ratio — the
  direct inputs of a two-path funnel chart;
- `failures.viewerBoundaries[]` / `failures.sessionBoundaries[]` are
  per-boundary drop-off bars: `boundary` label, `dropOffs` value, and a
  ready-made attribution breakdown (`kind` + optional `failureClass` +
  `count`) summing exactly to it;
- `failures.byClass[]` is a complete error-class histogram (zeros
  included — no absent-class ambiguity) with the remediation hint and the
  owner note attached to every bucket (actionability travels with the
  number);
- `failures.sessionOutcomes[]` is a complete outcome pie;
- `playbackHealth`, `feedback`, `connection`, `timings` are flat
  KPI blocks (the timings use the nearest-rank method — a dashboard
  quotes p50/p95 directly);
- `accounting` is the trust footer: any dashboard should display
  `partialSessions`/`sequenceAnomalies`/`unclassifiable` when non-zero
  (never-silent accounting surfaced to the operator).

The canonical serialization (`serializeAnalyticsReport`) is
byte-deterministic (recursively key-sorted, compact), so a W805 pipeline
can hash/compare reports across runs. The schema tag
`sporta/analytics/report@1` versions the shape; any change bumps it and
`parseAnalyticsReport` rejects old shapes loudly.

## §12 Versioning

`FUNNEL_SPEC_VERSION` (in `funnel.ts`) versions the funnel definition
(stages, boundaries, attribution rules); `ANALYTICS_REPORT_SCHEMA_VERSION`
/ `ANALYTICS_REPORT_SCHEMA_TAG` (in `schema.ts`) version the report
shape. Both are carried in every report. W706's
`TELEMETRY_SCHEMA_VERSION` is echoed in `vocabulary` — a report computed
against a different telemetry vocabulary says so.
