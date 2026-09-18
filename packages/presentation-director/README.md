# @sporta/presentation-director — the R305 event/camera presentation director

**Work item R305:** "Deliver deterministic camera/presentation behavior
driven by event importance and commentary semantics."

This package WRAPS the W604 camera director (`@sporta/camera-director`)
— it never replaces it. The W604 `direct` runs inside every
`present` call; its `CameraPlan` rides in every `PresentationPlan`
VERBATIM (every window, slot, decision record, suppressed cut, and
candidate accounting entry preserved). The additive layer this package
owns:

1. **The importance trace** — per directed window, the complete
   explanation of the window's emphasis: the event-importance
   contribution (which event, which policy table row, what weight), the
   commentary-semantic contribution (which W209 candidate matched, its
   matched text span VERBATIM), and the combined score in `[0, 1]` that
   justified the emphasis. **Every window's trace is complete** — a
   possession-following window traces to the policy-declared baseline,
   never an unexplained selection.
2. **Presentation kinds** — the `live-follow` / `replay` / `wide` /
   `tight` classification of every window, classified from the wrapped
   plan's OWN fields (never re-derived), with the rule + inputs recorded
   per decision.
3. **Candidate scoring** — every input W209 candidate scored (its
   importance row, its verbatim semantic inputs, its combined score)
   with its wrapped-plan outcome VERBATIM and the windows it drove.

## The scoring model (one place, all data)

For an event-driven window (the wrapped plan's `event-focus` /
`replay-emphasis` decision citing candidate `c` of event type `t`):

```text
importance = eventImportance[t].weight                      (the policy table row)
semantic   = emphasisWeight · c.emphasis + confidenceWeight · c.confidence
combined   = importanceWeight · importance + semantic        (a number in [0, 1])
```

For a possession-following window (no event, no candidate):

```text
importance = baselineImportance                              (the policy floor)
semantic   = (emphasisWeight + confidenceWeight) · baselineSemanticScore
combined   = importanceWeight · importance + semantic
```

Every number in every trace traces to a **policy row** or a **verbatim
candidate field** — never to a hidden constant in the director code.
The three blend weights each `>= 0` and sum to exactly 1 (validated).

## The classification rules (fixed algorithm, data-driven framing)

| wrapped window | classification rule | presentation kind |
|---|---|---|
| `kind: "review"` | `review-window` | `replay` |
| `kind: "live"`, decision `possession-follow` | `possession-default` | `live-follow` |
| `kind: "live"`, decision `event-focus`, slot framing `wide` | `event-framing` | `wide` |
| `kind: "live"`, decision `event-focus`, slot framing `tight` | `event-framing` | `tight` |

The framing class of each canonical W601 slot is policy DATA
(`framing`). A plan whose slot has no framing row is REFUSED
(`framing-gap`) — never defaulted. The default policy classifies the
two behind-goal slots `tight` and the touchline/aerial slots `wide`.

## Honest boundaries

- A rule-table presenter, not cinematography AI. The camera direction
  itself is 100% the W604 seam's (wrapped, verbatim).
- Commentary influence is W209's deterministic candidates only (quoted
  verbatim, never re-scored) — no live STT.
- The combined score is a documented linear blend — a presentation
  *emphasis* model, not a claim about broadcast quality.
- Determinism: `present` is a pure function of (policy, steps,
  candidates) — no clock, no RNG, no I/O. Same inputs → JSON-byte-
  identical plan (pinned).
- Fail-closed admission: the presentation policy validates
  (`validatePresentationPolicy` — the camera layer delegated to the W604
  `validatePolicy`); malformed steps/candidates surface the W604
  `DirectorError` verbatim; presentation-layer gaps (framing-gap,
  importance-gap) throw `PresentationError`.
- The self-check harness `checkPresentationPlan(plan, steps, policy?)`
  enforces: **camera-plan-wrapped** (the embedded plan passes the W604
  `checkCameraPlan` + 1:1 window alignment), **one-selection-per-window**,
  **every-window-traced** (completeness + verbatim consistency with the
  window's own camera decision), **accounting-reconciled** (the candidate
  scoring mirrors the wrapped accounting; counts recompute), and — when
  the policy is supplied — **policy-consistency** (every traced
  weight/score/kind recomputes from the policy's own tables).

## The canonical policy

`DEFAULT_PRESENTATION_POLICY` (`broadcast-classic-presentation`): the
W604 `broadcast-classic` camera grammar verbatim, the FULL W209
vocabulary importance table (goal 1.0 → other 0.05, ordered by W209's
own `EVENT_TYPE_PRIORITY`), the 0.5 / 0.3 / 0.2 blend, the 0.1 / 0.2
baseline floor, and the five-slot framing table. Pinned by
`test/policy.test.ts` and the golden
`fixtures/golden/default-presentation-policy.json`.

## Package boundary

Runtime dependencies: `@sporta/camera-director` (the wrapped seam),
`@sporta/commentary-understanding` (the W209 event-type vocabulary +
`EventCandidate`). Pinned by `test/boundary.test.ts` (src imports only
the declared deps; zero wall-clock/randomness in src).
