# @sporta/camera-director

Camera direction / event presentation (work item **W604**, milestone M6):
deterministically turns match state + commentary-derived event importance
into a camera plan (which canonical camera slot frames which match-time
window, and which moments earn replay emphasis), and composes that plan
with the W603 3D renderer. Owner: AI (Worker A). Dependencies: W603
(`@sporta/renderer-3d`) ✓, W209 (`@sporta/commentary-understanding`) ✓,
W601 (`@sporta/scene-projection`) ✓.

**Acceptance**: "event importance and commentary can influence
camera/replay emphasis deterministically enough to evaluate" — the
influence is a versioned policy DATA document (possession-following
default with zones + hysteresis, a pinned event-importance table, replay
configs); the director is a pure function; every window carries a decision
record (which rule fired, which W209 candidate drove it, confidence and
emphasis verbatim); a self-check harness proves the invariants; the
composition drives renderer-3d's match path through its own
`cameraSlotId` seam.

The normative decision record — the policy model, the priority table, the
direction algorithm, the composition contract, the honest boundaries — is
**POLICY.md** in this directory.

## Module map

- `src/policy.ts` — the direction policy DATA + the canonical
  `broadcast-classic` policy (byte-pinned against
  `fixtures/golden/default-policy.json`)
- `src/validate.ts` — `validatePolicy`: fail-closed structural validation
  of policy documents (config, not code)
- `src/types.ts` — the `CameraPlan`: the window rundown + decision records
  + total candidate accounting
- `src/direct.ts` — `direct(policy, matchTimeline, events) → CameraPlan`:
  the pure deterministic director
- `src/selfcheck.ts` — `checkCameraPlan(plan, steps)`: the invariant
  harness (stable violation ids; run by the tests AND the composition)
- `src/evaluate.ts` — `planDecisionRecords(plan)`: the per-window
  evaluation surface for W605
- `src/compose.ts` — `render3dDirectedMatch(req, steps, plan)`: one
  `render3dMatch` call per directed window, stitched into one rundown
  (reviews at the W603 review profile, 5 fps)
- `src/errors.ts` — `DirectorError`: the fail-loud admission error

## The pipeline in one example

```ts
import { DEFAULT_DIRECTOR_POLICY, direct, render3dDirectedMatch } from "@sporta/camera-director";

// 1. Direct: W209 candidates + the W603 match timeline → the camera plan.
const plan = direct(DEFAULT_DIRECTOR_POLICY, matchSteps, commentaryCandidates);

// 2. Compose: the plan drives renderer-3d's match path window by window.
const { result, frames, manifest } = render3dDirectedMatch(renderRequest, matchSteps, plan);
// manifest.windows[i].cameraSlotId — the directed slot, verbatim from the plan
// manifest.frames[j].decision — via manifest.windows — rule + verbatim candidate
```

## Honest boundaries (POLICY.md §7 is the normative text)

- **Rule tables, not cinematography AI** — every decision traces to a
  named policy rule + input events verbatim; nothing is invented.
- **Slot cuts only** — the five canonical W601 slots are fixed geometry;
  the camera changes only at snapshot boundaries. No camera motion, no
  zoom, no blends.
- **Commentary influence = W209 candidates only** — typed, deterministic,
  confidence-gated. No live STT. The W209 `emphasis` field is carried
  verbatim on decision records (the evaluation signal); the default
  grammar keys direction on event type + confidence.
- **Replay emphasis selects, authors nothing** — a review re-renders
  EXISTING scene steps at the W603 review profile (5 fps); no new frames,
  no re-timing, no slow motion.
- **Offline/hindsight** — the director sees the whole timeline before
  deciding (batch direction for W605 evaluation), never a live one.

## Testing

`bun test` (from the package root) — policy pins + golden, validation
negatives, the director algorithm (all five accounting outcomes,
hysteresis suppression, tie-breaks, determinism), selfcheck negative
fixtures per violation id, the composition end to end (boundary-tail
drop, review profile, parity with the undirected renderer, budget,
byte-identical reruns). All fixtures are deterministic — no `Date.now`,
no `Math.random`, explicit milliseconds only.
