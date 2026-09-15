# @sporta/camera-director — POLICY.md

The normative decision record for W604 "Camera director/event
presentation". Acceptance: *"event importance and commentary can influence
camera/replay emphasis deterministically enough to evaluate."*

The package owns the DIRECTION side of the M6 chain. W601 projected the
scene and named the canonical camera slots; W602/W603 render from ONE
carried slot and leave the choosing to "W604" (RENDERER.md §3: the
`styleConfig.config.cameraSlotId` seam — "W604 directs"). This document is
the record of how that choosing works.

Companion documents: `../renderer-3d/RENDERER.md` (the renderer this
package composes with), `../scene-projection/CONTRACT.md` (the slots and
the scene specification), `README.md` (the package overview + honest
boundaries).

---

## 1. The model in one paragraph

Direction is a **pure function of three inputs**: a direction POLICY
(versioned, validated data — §2), a MATCH TIMELINE (the W603
`AvatarField3dMatchStep[]` a `render3dMatch` call would consume), and a
CANDIDATE STREAM (W209 `EventCandidate[]` — commentary-derived evidence,
verbatim). The output is a **`CameraPlan`**: a rundown of directed windows,
each carrying a match-timeline source range (closed
`[startMs, endMs]`), exactly one canonical camera slot, a presentation
kind (live / review), and a DECISION RECORD (which rule fired, which
candidate drove it with confidence/emphasis verbatim, the
possession-follow inputs in force). No clocks, no RNG, no I/O: the same
inputs yield a JSON-byte-identical plan (test-pinned). The plan is then
COMPOSED (§6) with renderer-3d's match path, one `render3dMatch` call per
window.

The director is an **offline, hindsight director**: it directs with full
knowledge of the timeline and the candidate stream (batch direction for
deterministic evaluation — the W605 posture), never a live zero-latency
one.

## 2. The direction policy (data, not code)

`src/policy.ts`. Everything the director does is parameterized by a
`DirectorPolicy` document — there are no hidden constants in the director
code. Documents are versioned (`DIRECTOR_POLICY_VERSION`), structurally
validated (`src/validate.ts`, fail-closed, unknown keys ignored), and the
canonical policy is byte-pinned against
`fixtures/golden/default-policy.json` (regenerating the golden is an
intentional, reviewed act).

Three blocks:

1. **`possessionFollow`** — the default direction (nothing happening):
   - `zones`: pitch-x ranges → canonical slots, in DECLARED priority order
     (first closed `[xMin, xMax]` containing the follow reference wins;
     overlaps legal, holes NOT — validation requires total coverage of
     `[0, 105]`, because a hole is a policy bug, not an honest "unknown");
   - `fallbackSlotId`: no football state / no usable follow reference /
     follow disabled — the documented default that guarantees plan
     totality;
   - `hysteresisMs`: minimum default shot duration — a desired default cut
     at a snapshot boundary takes effect only after this long since the
     previous default cut; suppressed cuts are ACCOUNTED, never silent.
2. **`eventRules`** — the event-importance table (§3), ordered by priority.
   One rule per W209 event type; types without a rule stay with the
   default (a documented decision, not an oversight).
3. Per-rule **`replay`** (optional) — the replay-emphasis decision: the
   review's slot selector, `leadMs` (review starts at the last snapshot
   boundary at-or-before `eventTime − lead`), `trailMs` (review ends at
   the first boundary at-or-after `eventTime + trail`).

The **follow reference** of a step (verbatim from the scene spec): the
possessing entity's placed pitch x — its TRUE x whether `projected` or
`projected-out-of-bounds`, never clamped — else the ball's placed x, else
none (→ fallback). An off-pitch reference (x outside every zone, e.g. a
ball at x=200) also degrades to the fallback and is recorded verbatim.

The canonical policy **`broadcast-classic`**: three zones (final thirds →
the behind-goal slots, the middle → main-touchline), 3 s hysteresis,
`main-touchline` fallback, and the §3 table.

## 3. The event-importance priority table

The `eventRules` array's INDEX is the priority (lower = more important).
The canonical table inherits W209's own `EVENT_TYPE_PRIORITY` ranking for
every ruled type (the commentary vocabulary's own specificity order —
importance is never re-invented here; test-pinned alignment):

| # | type | gate | focus slot | hold | replay |
|---|------|------|------------|------|--------|
| 0 | `goal` | conf ≥ 0.5 | nearest-goal | 4 000 ms | ±2 000 ms, nearest-goal |
| 1 | `save` | conf ≥ 0.6 | nearest-goal | 2 500 ms | ±1 500 ms, nearest-goal |
| 2 | `shot` | conf ≥ 0.65 | nearest-goal | 2 000 ms | — |
| 3 | `free-kick` | conf ≥ 0.6 | nearest-goal | 3 000 ms | — |
| 4 | `card` | conf ≥ 0.6 | main-touchline | 3 000 ms | — |
| 5 | `corner` | conf ≥ 0.6 | nearest-goal | 2 500 ms | — |
| 6 | `kickoff` | conf ≥ 0.6 | main-touchline | 3 000 ms | — |
| 7 | `fulltime` | conf ≥ 0.6 | aerial-tactical | 5 000 ms | — |

Routine types (`pass`, `foul`, `offside`, `throw-in`, `substitution`,
`other`) carry NO rule in this grammar: routine events do not move the
camera (documented; a custom policy may rule them).

**Slot selectors** are closed vocabulary: the three static canonical
slots, plus `nearest-goal` — the behind-goal slot on the side of the
follow reference at the event's snap step, split at the pitch halfway x
(105/2 = 52.5 m, the W601 geometry; ties go to `behind-goal-x0`). With no
usable reference, a dynamic selector degrades honestly to the fallback
slot. **Slots are selected, never invented** — every directed slot id is a
W601 canonical slot (the selfcheck enforces it).

## 4. The direction algorithm (`direct`)

0. **Fail-closed admission.** The policy re-validates; the timeline must
   be non-empty with finite, `>= 0`, strictly increasing `atMs` and
   record-shaped scenes; every candidate must carry well-formed W209
   fields (confidence/emphasis finite in `[0, 1]`). Anything else throws
   `DirectorError` — never a silently partial plan.
1. **Possession-following default.** Per step, the follow reference maps
   through the zone table to a desired slot; a hysteresis walk produces
   the held default slot sequence (the initial slot at the first step is
   free; every later change needs `hysteresisMs` since the previous
   default cut). Suppressed cuts are recorded in
   `summary.suppressedCuts` with `atMs`, the desired slot, the held slot,
   and the elapsed milliseconds.
2. **Event-importance windows.** Every candidate whose type has a rule,
   whose confidence meets the gate (strictly: `confidence < gate` is
   refused), and whose event time lies inside `[timeline.startMs,
   timeline.endMs]` opens a focus window
   `[snapBefore(eventTimeMs), firstBoundaryAtOrAfter(start + holdMs)]` —
   both SNAPSHOT boundaries (camera changes land at snapshots, never
   mid-segment — the renderer-3d match-path camera-stability posture).
   The pinned hold is a MINIMUM: the realized end extends to the next
   honest cut point and is clipped to the timeline end. A candidate
   exactly at the last snapshot opens a zero-length focus window there.
3. **The overlay.** The live tiling is built from the union of boundary
   points (timeline ends, default cuts, focus starts/ends). Each
   elementary span is governed by the active focus window that wins the
   documented order: **(rule priority ASC, start DESC, eventTimeMs DESC,
   candidateId DESC in codepoint order)** — importance first, then
   recency, then id (`localeCompare` is banned: collation is
   ICU-dependent). Adjacent spans under the same slot+rule+candidate
   MERGE into one window. Losing candidates are accounted `superseded`
   (with the winner's id). Ungoverned spans take the held default slot,
   with the follow inputs recorded verbatim (when the zone rule desires a
   different slot than the window's, the hysteresis hold is stated in the
   record and the reason).
4. **Replay emphasis.** Every governing event window whose rule carries a
   replay config is followed — in rundown order — by a REVIEW window
   re-presenting `[snapBefore(t_e − lead), firstBoundaryAtOrAfter(t_e +
   trail)]` (clipped into the timeline). Superseded candidates earn no
   review. Reviews never invent time: the source range lies inside the
   match timeline.
5. **Accounting.** Every input candidate appears exactly once in
   `summary.eventAccounting` with its verbatim fields and one of five
   outcomes: `governed` / `superseded` / `below-confidence` / `no-rule` /
   `outside-timeline`.

## 5. The plan invariants (the selfcheck contract)

`src/selfcheck.ts` `checkCameraPlan(plan, steps)` — the evaluation
readiness harness. Fail-soft (violations with stable ids, never a throw),
pure, and run BOTH by the tests and by the composition's fail-closed
admission. Violation ids:

- `plan-shape` — windows are records, gap-free rundown indices, sane
  source ranges;
- `one-selection-per-window` — exactly one canonical slot id + one
  presentation kind per window (an invented angle is a violation);
- `boundaries-respected` — EVERY window boundary is a snapshot boundary
  (a step `atMs`);
- `live-tiling-total` — live windows tile the match timeline exactly:
  first starts at the timeline start, last ends at the timeline end,
  consecutive windows share boundaries, no non-last live window is
  degenerate, at least one live window exists;
- `review-within-timeline` — review ranges re-present existing match
  time;
- `decision-records` — closed rule vocabulary; event-driven decisions
  carry the verbatim candidate fields; possession decisions carry the
  follow inputs;
- `timeline-consistency` — the plan's declared timeline equals the steps'
  `atMs` span (and the steps are a non-empty, finite-atMs timeline);
- `summary-consistency` — the window counts recompute exactly.

Every id has a negative fixture in `test/selfcheck.test.ts`.

## 6. The composition contract (`render3dDirectedMatch`)

The plan DRIVES renderer-3d's match path — this package never
re-implements rendering, never moves a camera, never invents a slot: it
calls the REAL `render3dMatch` per directed window.

1. **Admission.** The plan is self-checked against the steps (§5) — a
   violation refuses the whole composition (`plan-invalid`) — and the
   TOTAL composed frame budget (`MAX_RENDER_FRAMES` = 3600, the W603
   universal bound) is enforced cumulatively across windows
   (`budget-exceeded`).
2. **One run per window.** The window's step RUN is the steps whose
   `atMs` lie in the window's closed source range (boundary-INCLUSIVE:
   the run renders the segment crossing INTO the next window so the
   crossing's interpolated frames come from THIS window's slot). The
   run's request carries the window's slot through the renderer's own
   `styleConfig.config.cameraSlotId` seam (the caller's own slot value is
   always overridden — direction wins) and the profile: live windows the
   caller's output profile, review windows the W603 review profile
   (`AVATAR_FIELD_ANIMATED_OUTPUT_PROFILE`, 5 fps — the animated-review
   cadence of RENDERER.md §1).
3. **Boundary-tail drop.** Every live run ends with an observed TAIL
   frame at its last step. For every live window except the last, that
   tail frame (at the shared boundary) is DROPPED: the boundary snapshot
   renders from the window that STARTS there — the cut takes effect AT
   the boundary, and the boundary frame appears EXACTLY ONCE. The last
   live window keeps its tail (the match's final observed frame); reviews
   keep their tails (self-contained re-presentations of their closed
   ranges).
4. **The rundown timeline.** Frames renumber globally; each frame's
   output position = its window's rundown start + (source position −
   window source start). Consequences: a no-review plan is 1:1 with the
   match timeline in frame count and output positions; a single-window
   no-review plan at the same slot as an undirected render's config is
   byte-identical to that `render3dMatch` call (test-pinned); each review
   window inserts its realized duration, shifting later windows. Per
   window runs keep their OWN SVG `<title>` frame index and manifest
   `entry.frameIndex` (the renderer's per-run document); the composed
   `frameIndex`/`outputTimestampMs` are the rundown coordinates — both
   recorded per frame, never conflated.
5. **Provenance.** Per frame: the underlying renderer manifest entry
   VERBATIM (interpolation provenance, marker accounting, entity
   accounting — source-timeline timestamps) plus the director's fields
   (window index, directed slot, presentation kind). Per window: the
   realized camera block (the W601 slot geometry the run framed from),
   the plan's decision record verbatim, the output profile, the frame
   count. Manifest-level: the plan's summary verbatim (window counts,
   cut count, suppressed cuts, the FULL candidate accounting).
6. **Aggregation.** Watermarks and `lastEventSequence` are the MAX
   across runs (never less than anything any run consumed); degradation
   reasons are the union; skipped markers carry their window index; the
   contract `RenderResult` mirrors the aggregates.

## 7. Honest boundaries

- **A rule-table policy, not cinematography AI.** Every decision traces
  to a named policy rule + the input events verbatim (G7: no invented
  data). There is no learned model, no aesthetic scoring, no "AI
  director".
- **Slot cuts only — no camera motion.** The five canonical W601 slots
  are fixed named geometry; the director SELECTS among them at snapshot
  boundaries. No smooth camera movement, no interpolation of camera
  positions, no zoom (the renderer's focal length is a fixed presentation
  constant).
- **Commentary influence is W209's deterministic candidates only** —
  typed, confidence-gated event candidates from the commentary
  understanding pipeline. No live STT, no audio analysis, no
  emphasis-driven camera moves in the default grammar (the W209
  `emphasis` field is carried VERBATIM on decision records as the
  evaluation signal; keying decisions on it is policy data a future
  policy version may declare, not code).
- **Replay emphasis SELECTS, authors nothing.** A review re-renders
  EXISTING scene steps at the W603 review profile — no new frames, no
  re-timing, no slow motion, no alternate angles beyond the canonical
  slots.
- **Offline/hindsight only.** The director sees the whole timeline and
  candidate stream before deciding — built for deterministic evaluation
  (W605), not live broadcast latency (which belongs to the W304/W702
  streaming seams).
- **The plan does not claim scene correctness.** It directs presentation
  only; evaluating the CONTENT (score, clock, identity, ordering) is
  W605's work item.
