# Renderer 3D — Avatar/Field Prototype (W602, extended in place by W603)

Normative decision record for `@sporta/renderer-3d` — the M6 avatar/field
3D prototype and its M6 match-progression extension.

- **W602**: "benchmark SWM state becomes coherent playable-style field
  scene using original/proprietary-safe assets." Owner: AI. Dependencies:
  W601 ✓ (scene projection), W501 ✓ (renderer plugin contract), W502 ✓
  (the deterministic SVG renderer precedent).
- **W603**: "match progression rendered from SWM rather than replaying
  broadcast pixels." Owner: AI. Dependencies: W602 ✓ (this package,
  extended IN PLACE — additive capabilities + the documented 0.2.0
  renderer-version bump; see §1).

This package is a RENDERER: it consumes the W601 `SceneSpecification`
(never raw SWM — see §2), renders it through a deterministic projective
camera into self-contained SVG documents (§1), registers as a
`RendererPlugin` behind the W501 seams (§9), reports every omission in a
per-frame manifest (§5), and since W603 renders a SEQUENCE of snapshots
as one coherent animated output with a documented deterministic motion
model (§6). It is NOT a 3D engine, a physics engine, or a camera
director (W604) — the honest boundaries are §11.

## 1. The presentation-format decision (SVG with honest 3D-look depth cues)

The deliverable is a **deterministic document**, and the chosen format is
**SVG rendered through a real projective camera model** — the W502
precedent (self-contained, dependency-free, byte-deterministic SVG frames)
extended with genuine 3D presentation:

- a **pinhole perspective camera** (`src/camera.ts`): look-at basis,
  perspective divide, near-plane clipping — plain documented math, zero
  3D-engine dependency (architecture-lock §9 vendor neutrality);
- **depth cues that are honest perspective artifacts, never decorations**:
  figure size falls with camera depth; the elevated ball carries a ground
  shadow plus a dashed drop line ONLY when the spec carries its height;
  ground rings (haloes, possession) are perspective-projected polygons;
  entities are painter-sorted far→near by camera depth;
- **3D field furniture**: the pitch plane + the spec's IFAB Law 1 geometry
  (goals as 3D frames with posts and crossbar, areas, spots, arcs
  discretized to polylines);
- **avatar-style player representations** whose every color is a pure
  function of `(styleKey, entityId)` (§4) — the W502 no-flicker rule;
- **top-view mode**: a camera looking down steeply
  (`forward.z ≤ −0.75`) renders avatars as ground footprints — the honest
  view from directly above, where a billboard figure is edge-on.

The alternative (a project-defined 3D-interchange text format) was
rejected for this prototype: SVG frames are directly inspectable,
byte-comparable, and already the W502/W504 delivery shape, while remaining
a lossless projection of the same scene geometry. A future
engine-interchange format can ride a MINOR addition beside this path.

`rendererId` is `avatar-field.prototype@0.2.0` (the W603 bump; W602 was
`0.1.0`). The supported output profiles — all 1280×720, `codec: "svg"`,
`container: "svg"`, offline:

| Profile | Frame rate | Frame interval | Purpose |
|---|---|---|---|
| `AVATAR_FIELD_OUTPUT_PROFILE` | 1 fps | 1000 ms | the W602 snapshot-review profile (historical default, FIRST in the capability list) |
| `AVATAR_FIELD_ANIMATED_OUTPUT_PROFILE` | 5 fps | 200 ms | the W603 animated-review cadence (fractions land on 0.2 steps between 1 s snapshots — hand-inspectable) |
| `AVATAR_FIELD_GAME_OUTPUT_PROFILE` | 25 fps | 40 ms | the W603 game-style playback cadence |

**The 0.2.0 bump semantics (documented decision).** The W603 capability
gained two output profiles — an ADDITIVE change — but a capability is an
immutable document per version (R1), and `admitRequest` must be able to
trust profile admission against the exact list. Rather than mutate
`0.1.0`'s capability, the version bumped following the W602 documented
restyle semantics: `rendererVersion` is immutable, so a semantic change to
the capability IS a new version. Consequences, all intended and
test-pinned: the style key re-keys
(`avatar-field.prototype:0.2.0` — palette assignments shift per entity,
the sanctioned restyle moment), and identity stability remains a
WITHIN-version property across frames (the no-flicker rule, unchanged).
The workspace package version in `package.json` stays `0.1.0`: the
renderer-contract identity is the meaningful version; the workspace
version is cosmetic for a private package and bumping it would force a
`bun.lock` edit outside this package's touch scope.

**Per-render frame budget.** `MAX_RENDER_FRAMES = 3 600` — the W602 worst
case (1 fps × the 3 600 000 ms maximum duration), now the UNIVERSAL bound
across every profile. A render implying more frames (e.g. 25 fps over
> 144 s of timeline) fails LOUD with `media-invalid` (bounded render
work, never a memory runaway). Longer animated timelines are the
W304 watermark-batched orchestration seam's concern — each `render` call
stays inside the budget.

Output segments reference frames through opaque
`scene3d://<sessionId>/<snapshotVersion>/<frameIndex>` URIs (byte
delivery/encoding is the output pipeline's concern, W504 posture).

## 2. Scene consumption (W601) — never raw SWM

Everything the renderer draws is derived from a validated
`SceneSpecification`:

- the contract path (`render3dFromSnapshot`) projects its input snapshot +
  events through W601 `projectScene` FIRST, then renders the spec (all
  canonical camera slots carried; the render slot is selected from it);
- the clip path (`render3dClip`) and the match path (`render3dMatch`)
  consume caller-provided specs directly (the W402/W601 seam:
  `projectScene(stateAt(engine, t).snapshot, { events: eventWindow(...) })`
  per step — the W402 `stateAt`/`eventWindow` snapshot windows are the
  canonical match-timeline construction);
- every input spec is re-validated against the W601 zod schema,
  version-checked (`isSceneVersionCompatible` — fail-closed, never a
  partial parse of a newer scene), and session-checked;
- **disposition semantics are honored**: `omitted-*` and
  `not-projected-kind` entities are NEVER placed (their verbatim slot data
  is still manifest-recorded); `projected-out-of-bounds` entities draw at
  their TRUE position with the out-of-play marker posture (ring + OUT tag,
  never a styled figure) — positions are never clamped, never moved;
- the pitch geometry comes from the spec's `world` block verbatim (the Law
  1 constants live in the spec; this package re-states NO dimension);
- event markers are the spec's timeline-anchored entries — they render as
  HUD chips (fixed phrase or the VERBATIM type ref), never as invented
  scene positions;
- score/clock/possession are the spec's verbatim blocks (presentation
  strings are this package's fixed templates over those numbers).

## 3. Camera model (constants + totality)

| Constant | Value | Meaning |
|---|---|---|
| `FOCAL_PX` | 512 | Focal length on the 1280×720 profile (≈ 70° vertical FOV). Chosen so the nadir `aerial-tactical` slot frames the FULL 105 × 68 pitch below the HUD band (pitch height on screen = 512·68/60 ≈ 580 px < 656 px drawable). Fixed: the renderer never zooms. |
| `NEAR_PLANE_METERS` | 0.5 | Camera-space points closer than this (or behind) are clipped/omitted. |
| `MIN_MARKER_RADIUS_PX` | 2.5 | Readability floor for projected marker radii (ball/head/footprint/dots): honest perspective makes a 0.11 m ball sub-pixel at 60 m. Ground polygons NEVER floor — they stay perspective-true. The manifest records positions/depth, not radii, so the floor never mutates data. |
| `HUD_HEIGHT` | 64 px | The annotation band; the drawable region is below it. |

Basis: `forward = normalize(target − eye)`, `right = normalize(forward ×
worldUp)`, `up = right × forward` (world up is the scene's +z). The
straight-down fallback (the `aerial-tactical` slot) uses the documented
+y up-hint disambiguation → nadir frame has world +x screen-right, world
+y screen-UP.

**Totality for ANY slot geometry a valid spec can carry** (the near-band
rules, test-pinned):

- ground ANNOTATION rings (haloes, ball shadows, possession rings) are
  near-plane-clipped in camera space (Sutherland–Hodgman); empty ⇒ not
  drawn (the possession accounting then records `displayed: false`);
- FIGURES obey the whole-figure guarantee: an entity is drawn only when
  EVERY body point (figure silhouette, head, facing wedge, top-view
  footprint) is in front of the near plane — otherwise it is omitted
  WHOLE as `omitted-behind-camera` (never a half-drawn figure, never a
  crash);
- field lines/segments are parametrically near-clipped; ground polygons
  are polygon-clipped.

**Framing is slot-faithful**: the renderer frames FROM the spec's carried
slot with the requested id (fail-loud if uncarried). The style-config
default `main-touchline` is a documented PRESENTATION default, not a
direction policy — the renderer never CHOOSES between slots based on
scene content or events (W604's territory). Honest slot geometry is kept:
the main-touchline slot shows the far half large and the near corners
outside the frame; the renderer never re-frames to "fix" that.

**Camera stability across interpolation (W603)**: the match path renders
EVERY frame of a segment from the segment's FROM step's carried slot —
the camera never moves mid-segment. A camera change is a W604 direction
cut that lands at a snapshot boundary, never a blend. (The manifest's
camera block records the first step's slot, the clip-path convention;
each frame's HUD shows its actual slot.)

## 4. Identity stability + the height/heading producer decision

**Identity stability (architecture-lock §6)**: every color property of an
entity is a pure function of `(styleKey, entityId)` with
`styleKey = "avatar-field.prototype:0.2.0"` (fnv1a32 → 8-entry palette).
There is NO dependence on the entity's SWM `version` (which bumps every
upsert — depending on it would flicker); a renderer version bump is the
only restyle (the 0.2.0 bump exercised it in production, test-pinned).
Officials and the ball use fixed styles (documented, not hashed).
Confidence drives opacity only (`0.35 + 0.65·c`; absent ⇒ no opacity
attribute — a neutral no-claim default).

**Height/heading (W601's open producer slots — the decision)**: W601's
CONTRACT.md records that NO current producer writes the SWM
`height`/`heading` slots. This renderer takes the **carried-absent
honest** posture (one of the two sanctioned options) — it never invents
either:

- **Heading** — a facing wedge is drawn ONLY when the spec carries a
  usable `heading` radians value (dashed when the slot is uncertain). No
  heading slot ⇒ the avatar is a billboard figure making NO facing claim.
  Heading is NOT derived from cross-frame position deltas, and (W603
  decision, §6) heading is NEVER interpolated: interpolated frames carry
  the FROM spec's heading slot verbatim — presenting the last OBSERVED
  facing is the honest no-claim; positions interpolate, facings do not
  invent rotation.
- **Ball height** — the ball's elevation is the spec's `position.z`
  (W601 S6). No `z` ⇒ the ball draws AT the pitch plane in a distinct
  height-unknown style (dashed outline, no shadow/drop line) and the
  manifest records `heightCarried: false` — a presentation convention,
  never a faked `z = 0` in data. (The flag is the union of `position.z`
  and a usable `height` slot, so an omitted ball's carried height data is
  never silently dropped from the accounting.) W603 interpolation follows
  the same rule BETWEEN snapshots: `z` interpolates only when BOTH
  bracketing specs carry it; when either endpoint lacks it the
  interpolated position carries NO `z` (never a faked 0, never a stale
  height presented as current).
- **Avatar body size** (1.8 m figure, 0.5 m shoulders, 0.14 m head) and
  the ball radius (0.11 m — IFAB Law 2's 68–70 cm circumference at the
  maximum) are PRESENTATION constants of the stylized marker, versioned
  with the renderer — NOT claims about any player's stature.

A future SWM-side producer that populates the slots needs NO change here
(the W601 slots were designed for exactly that; the verbatim rules keep
the render honest when they arrive).

## 5. The render manifest (per-frame accounting)

The W502 manifest posture: every frame records its provenance (the spec's
watermark, `generatedAtMs`, football-state flag, scene schema version),
the marker sequences consumed (displayed or accounted), the HUD state, the
possession accounting (displayed only when a rendered in-play participant
carries it), and EVERY spec entity with BOTH its scene disposition
(verbatim) and the renderer's treatment — the extended vocabulary:

| renderDisposition | Meaning |
|---|---|
| `rendered` | Scene `projected`; on-screen below the HUD band; drawn. |
| `rendered-out-of-play` | Scene `projected-out-of-bounds`; drawn at the TRUE position with the out-of-play ring + OUT tag (never a styled figure). |
| `omitted-off-canvas` | Projects outside the drawable region; TRUE position verbatim in the manifest. |
| `omitted-behind-camera` | Base or ANY body point behind the near plane (whole-figure guarantee); TRUE position verbatim. |
| `omitted-no-position` / `omitted-invalid-position` / `omitted-non-pitch-frame` | The spec's own dispositions, passed through verbatim. |
| `not-rendered-kind` | The spec's `not-projected-kind`. |

`positionMeters` is the spec's position field-for-field (including for
omitted entities); on INTERPOLATED match frames it is the motion model's
INFERRED position (marked by `positionProvenance`, below — never a claim
of observed data). `screenPosition`/`depthMeters` only for drawn
entities; confidences verbatim; style tokens recorded for
identity-styled entities (the no-flicker measurement surface, W503/W605
posture).

**The W603 interpolation-provenance surface** (match path only; every
W602 path frame carries none of these — per-spec verbatim frames ARE
observed):

- `frame.interpolation` — present on EVERY match-path frame:
  `kind` (`"observed"` — the frame sits exactly on a step's `atMs`, its
  scene that spec VERBATIM; `"interpolated"` — strictly between two
  steps; `"held"` — a declared scene cut governs the segment, the
  from-scene rendered verbatim), `fromStepIndex`/`toStepIndex` (the
  snapshot pair), `fromAtMs`/`toAtMs`, `fraction` (the interpolation
  parameter; in (0, 1) ONLY on interpolated frames, 0 otherwise —
  observed and cut-held frames interpolate nothing), and `sceneCut`
  (whether a declared cut governs the frame's segment);
- `entity.positionProvenance` — on interpolated/held frames:
  `"interpolated"` (INFERRED data — the position came from the motion
  model, never an observation) or `"held"` with `heldReason` (§6's
  vocabulary). Observed frames and every W602-path frame carry NO
  position provenance (verbatim = observed, the default posture).

## 6. The motion model (W603 — documented, deterministic, honest)

Work item: "match progression rendered from SWM rather than replaying
broadcast pixels." The match path (`render3dMatch`) renders a TIMELINE of
scene specifications as one coherent animated sequence at the output
profile's frame rate. Everything it derives between two consecutive
snapshots' KNOWN positions follows this model (`src/interpolate.ts`);

### 6.1 The frame plan (deterministic; no clocks anywhere)

Frames are planned PER SEGMENT (each pair of consecutive steps): frames at
`t₀ + j·interval` for `j = 0 … ceil(span/interval) − 1`, each with window
`[frameMs, min(frameMs + interval, t₁))`; the LAST step additionally
renders one observed tail frame covering `[t_last, t_last + interval)`.
Properties, all test-pinned:

- an OBSERVED frame sits exactly on EVERY step's `atMs` — each snapshot's
  true state is shown verbatim, never skipped by grid drift;
- windows tile the timeline exactly without overlaps (R8-shape segments);
- the frame rate is a CAP, never an invention — snapshots DENSER than the
  frame interval yield their own observed cadence with interpolated frames
  filling between;
- total frames = `Σ ceil(span_i / interval) + 1`, bounded by
  `MAX_RENDER_FRAMES` (fail-loud beyond);
- frame times are pure arithmetic over the timeline's own `atMs` values
  and the profile's frame interval. There is NO clock to inject and none
  needed: the render is a pure function of its inputs (the same request
  yields the same frames on every call — byte-identical, test-pinned).
  "Wall-clock" pacing of playback is the viewer's concern (W702), not the
  renderer's.

### 6.2 Constant-velocity segments (the documented motion model)

For an entity placed (`projected` or `projected-out-of-bounds`) in BOTH
bracketing specs with the SAME disposition and usable positions, an
interpolated frame at fraction `f ∈ (0, 1)` of the segment `[t₀, t₁]`
places the entity at `p₀ + f·(p₁ − p₀)` per coordinate — the
straight-line constant-velocity path between the two KNOWN positions.

- **This is INFERRED data** (the W205 posture: interpolated state is
  inference, never observation). The manifest marks every interpolated
  position `positionProvenance: "interpolated"` and every frame with the
  snapshot pair + fraction it came from. Interpolated positions are NEVER
  claimed observed anywhere in the output.
- **Ball height**: `z` interpolates only when BOTH endpoints carry a `z`;
  otherwise the interpolated position carries NO `z` (§4 — never a faked
  0, never a stale height presented as current).
- **Heading is NEVER interpolated** (§4): the from-spec's heading slot
  rides verbatim. Positions interpolate; facings do not invent rotation.
- **Confidence/status/version/lastEventTimeMs are the from-spec's
  VERBATIM values** — interpolation adds no confidence model, never
  invented decay, never invented versions.
- **Scene blocks stay verbatim**: the interpolated scene's world,
  score/clock, camera slots, source provenance, and event markers are the
  FROM spec's verbatim (the last-known state — the single-snapshot
  honesty posture applied between snapshots). The clock NEVER ticks by
  frame time: displayed clock/score state advances at snapshot boundaries,
  exactly as the specs state them. The interpolated frame is the
  last-known state with inferred positions — never a blend of two scenes'
  furniture or display state.

### 6.3 Honest discontinuity handling — nothing is ever blended across a discontinuity

An entity's position is HELD at the from-spec's VERBATIM value (with an
accounted reason — `MatchHeldReason`) whenever:

1. **`"scene-cut"`** — the segment is governed by a DECLARED scene cut
   (`AvatarField3dMatchStep.sceneCutBefore`). The flag is DECLARED by the
   caller (the W204 tracker-frame `sceneCut` posture: upstream knows when
   the broadcast cut or the replay branch broke), never DETECTED here —
   no honest detection signal exists inside a `SceneSpecification`, and
   inventing one would fabricate discontinuity knowledge. Frames strictly
   between the cut pair render the from-scene VERBATIM; the new scene
   takes effect AT its own `atMs` (an observed frame) — the cut lands at
   the boundary, never smeared.
2. **`"disposition-change"`** — the entity's scene disposition differs
   between the bracketing specs (e.g. `projected` → `omitted-no-position`):
   the last OBSERVED treatment is held until the next snapshot boundary
   (never a motion toward "nothing").
3. **`"position-missing"`** — at least one bracketing spec carries no
   usable position for the entity: a position is never invented for an
   unplaced entity.
4. **`"velocity-bound"`** — the straight-line segment between the two
   known positions implies a speed above the documented physical ceiling
   for the entity's kind (a teleport, not motion — animating it would
   fabricate a trajectory): the last OBSERVED position is held.
5. **`"entity-absent-in-to"`** — the entity exists in the from-step but
   not in the to-step: its last observed state is held (it disappears at
   the next snapshot boundary, exactly as the spec says).

Entities present only in the TO spec are NOT interpolated into existence:
they first appear at their own step's `atMs` (an observed frame).

Reason precedence (test-pinned): `disposition-change` >
`position-missing` > `velocity-bound`; every from-spec entity gets
exactly one provenance entry (total accounting).

### 6.4 The physical-plausibility bounds (documented derivations)

The velocity bound re-states the W503 renderer-evaluation derivations
(this package stays isolated from that one — constants re-declared, the
fnv1a32 precedent):

| Constant | Value | Derivation |
|---|---|---|
| `PLAYER_MAX_SPEED_MPS` | 12.5 | Usain Bolt's Berlin 2009 100 m average was 10.44 m/s with a ~12.4 m/s peak (public athletics record data). Participants and officials interpolate only below this. |
| `BALL_MAX_SPEED_MPS` | 40 | A hard-struck football reaches ~130–140 km/h (≈ 36–39 m/s; public football physics data). 40 m/s covers every legal strike. |
| `SPEED_EPSILON_MPS` | 0.01 | 1 cm of positional noise per second — the W503 `POSITION_EPSILON` derivation; a pair implying `ceiling + ε` is rounding, not a teleport. |

The distance includes `z` when both endpoints carry it (the animated
path's true length). The bounds gate INTERPOLATION only — they never
mutate observed data (a teleport is rendered verbatim on observed frames,
held between them).

## 7. Render paths + marker semantics (R5/R6/R7 analogs)

- **Contract path** (`render3dFromSnapshot`): one snapshot + ordered
  events since its watermark (the `RenderInput` shape). Timeline starts
  at the snapshot watermark; frames are `1000/frameRate` apart; the scene
  state is HELD across frames (single-snapshot honesty: positions are
  never invented between watermarks) while the marker HUD evolves per
  frame window. A marker is APPLIED iff its `eventTimeMs` ∈
  [start, start + duration); outside markers are SKIPPED with accounted
  reasons AND set `degraded` with `"markers-outside-render-window"`
  (R7 — never silent staleness). `provenance.lastEventSequence` = highest
  APPLIED sequence (never more, R5); `watermarkAfter` = R6 exactly (last
  input event's sequence — even when skipped — else the snapshot's;
  `watermarkMs` = window end, ≥ the snapshot's).
- **Clip path** (`render3dClip`): one frame per step, each from its OWN
  spec — real per-snapshot motion, never interpolated. Each frame renders
  from its own spec's carried slot; the manifest camera block records the
  first step's slot. All step markers are consumed (each in exactly one
  frame's HUD or not-displayed accounting; `skippedMarkers` is always
  empty); degradation only from `simulateDegradation`. Steps must be
  non-empty with finite, strictly increasing `atMs ≥ 0`.
- **Match path** (`render3dMatch`, W603): the animated timeline — the
  frame plan (§6.1), the motion model (§6.2), and the discontinuity
  handling (§6.3), plus:

  - **Markers**: the UNION of all steps' event markers (deduplicated by
    sequence, first occurrence) — each marker lands in the ONE frame
    whose window contains its `eventTimeMs` (every marker appears at its
    timeline position in exactly one frame's HUD or its not-displayed
    accounting). Markers outside `[start, end)` are skipped with
    accounted reasons AND set `degraded` with
    `"markers-outside-render-window"` (R7 — the single-snapshot-path
    semantics).
  - **`provenance.lastEventSequence`** = the highest APPLIED marker
    sequence (0 when none) — never more (R5; skipped markers are never
    counted).
  - **`watermarkAfter.watermarkMs`** = the render end
    (`t_last + interval`); `watermarkAfter.sequence` = the MAXIMUM of the
    last step's scene watermark sequence and every consumed marker
    sequence (skipped included) — never less than anything the render
    consumed (the clip path's rule, made strict).
  - **Steps validation** (fail-loud, up front — before any frame is
    synthesized): non-empty; finite `atMs ≥ 0` strictly increasing;
    `sceneCutBefore` a boolean when present (never a truthy coercion);
    each scene schema-valid, version-compatible, session-consistent, and
    CARRYING the requested camera slot; the steps'
    `source.watermark.sequence` values NON-DECREASING — the W006 engine's
    snapshots at ascending times have monotone watermark sequences, so a
    regression means the caller mixed replay branches; refusing is safer
    than interpolating across inconsistent provenance.
  - **`styleConfig.durationMs` is IGNORED** (the timeline's extent IS the
    duration: `lastAtMs + interval − firstAtMs`), exactly like the clip
    path.

## 8. Style configuration

`styleConfig.config` (unknown keys ignored, forward-compatible):

| Key | Default | Constraints |
|---|---|---|
| `durationMs` | 6000 | finite, [1, 3 600 000] (bounded render work). Clip and match paths ignore it (steps set the timeline). |
| `cameraSlotId` | `"main-touchline"` | must be a CANONICAL slot id; the scene must CARRY it (fail-loud media-invalid otherwise — every step on the match path). |
| `simulateDegradation` | `false` | R7 explicit-degradation probe: forces `degraded` with reason `"simulated-degradation"` (all paths). |

## 9. Renderer plugin conformance (W501)

Registered through `createAvatarFieldRenderer` (`pluginKind:
"sporta-renderer"`, usable with `RendererRegistry`):

- **R1** capability deep-equal per call; **R2** `requiresSourceFrames:
  false` (pure SWM → scene projection) so the harness's rights probe is
  honestly n/a — BUT the posture goes beyond the baseline, identical to
  W502: a request CARRYING `sourceFrameRefs` without
  `canReferenceSourceFrames` is rejected `rights-denied` in BOTH
  `validateRequest` and `render` (architecture-lock §11: transformation
  never clears rights) — identical posture on the match path;
- **R3** identity/profile/snapshot-version gates in both paths (the
  profile list now includes the two W603 animated profiles — admission of
  each is test-pinned through the real plugin seam);
- **R4** dispose is terminal; **R5–R8** honored by the render paths
  (§7);
- observability seam (optional): one structured info line per render +
  `render_requests_total` / `render_failures_total` counters; absent seam
  ⇒ silent no-ops.

The W501 conformance harness passes 13/13 (test-pinned) at 0.2.0. The
match path is a PACKAGE-level entry point beside the plugin surface
(the same `admitRequest` gates, the same render core) — hosts, benchmarks,
and evaluators call `render3dMatch` directly, exactly like `render3dClip`
since W602.

## 10. Determinism + benchmark

All three render paths are pure functions of their inputs — no RNG, no
clock reads, no I/O (constitution: zero `Math.random`/`Date.now`/`new Date()`
in the package, grep-proven by the source-scan pin). The canonical
benchmark fixture (`test/helpers.ts`) is a 6-step timeline (t = 1000..6000)
with: a moving striker whose SWM version BUMPS every step (proving style
stability is version-independent), an uncertain winger (halo), a
no-position participant, an official, an out-of-bounds participant
(TRUE-position render), an in-pitch corner player (off-canvas from
main-touchline, rendered from aerial), a non-renderable kind, a moving
ball WITH a carried height (elevated render) whose height is ABSENT on
the last step (the honest mid-timeline height gap: its approach segment
interpolates NO z), football state throughout (possession of the
striker), and a 5-marker stream (one unknown-type ref exercising the
verbatim fallback).

- **W602 benchmark** (clip path): per-frame provenance, disposition
  accounting totals, identity stability across frames, real per-step
  motion, byte-identical reruns (deep-equal output + identical SVG
  bytes), and W601 `runSceneConformance` PASS on every step's spec.
- **W603 benchmark** (match path, N snapshots → M interpolated frames):
  6 steps → 26 frames at 5 fps (25 per 1 s segment + the observed tail) —
  interpolation provenance on EVERY frame (pair + fraction; INFERRED
  positions marked), real BETWEEN-snapshot motion (striker 60→64 m in
  0.16 m frames; ball 58→61 m with height 1.2→2.0 m until the honest
  gap), stable projection (the striker's screen track is affine: equal
  1.4 px steps at constant screen y through the fixed camera), identity
  stability across ALL 26 frames (style tokens byte-identical,
  dispositions stable, versions held at from-spec values between
  boundaries), byte-identical rerun, honest discontinuity tests (a
  declared scene cut is never interpolated across; a disposition change
  is accounted, never blended), and the game-style 25 fps profile (126
  frames, 40 ms cadence, 0.032 m frames, style tokens still
  byte-identical).

## 11. Honest limitations

- **No real 3D engine** — a pinhole camera + painter's algorithm over
  flat-color SVG primitives. No meshes, materials, lighting, or
  rasterization; figures are billboard silhouettes (top-view footprints
  from overhead). W603's interpolation is pure arithmetic between
  projected positions — there is no physics integration, no ballistics,
  no collision, no animation rig.
- **The motion model is deliberately minimal** — constant-velocity
  straight-line segments between consecutive snapshots' KNOWN positions.
  Real athletes accelerate and turn; between 1 s snapshots the straight
  line is an INFERENCE (marked as such in every manifest), not a
  trajectory claim. Snapshots sparser than the segment imply coarser
  inference, never invented detail. A richer motion model (splines,
  velocity carry-over, heading interpolation with wrap-around) is future
  work behind the same seams.
- **Scene correctness evaluation is W605** — this package reports what it
  rendered and why (per-frame manifest, interpolation provenance,
  disposition accounting); whether the rendering CORRECTLY matches ground
  truth is W605's benchmark, not asserted here.
- **No camera direction policy** (W604) — the renderer frames from ONE
  carried slot per render (default `main-touchline`, a presentation
  default), stable within each match segment; it never cuts, never
  follows the ball, never reacts to events. Declared cuts
  (`sceneCutBefore`) are the CALLER's flag, honored verbatim.
- **No audio** — the output is SVG frame documents + manifest only.
- SVG frames at the profile cadences (1/5/25 fps); encoded
  delivery/video transcoding is the output-pipeline concern (W504 owns
  the anime path; a 3D-encoded delivery path is future work).
- Painter's-algorithm occlusion is per-figure and ground-level: two
  avatars at nearly the same depth sort by spec order (stable, documented;
  no per-pixel depth testing). Ground annotations (halo/possession rings)
  can interleave under figures without occlusion geometry.
- Billboard figures always face the camera horizontally (a documented
  convention); the facing wedge is the only directional cue, and only
  when the spec carries heading (never interpolated — §4/§6.2).
- `MIN_MARKER_RADIUS_PX` floors marker radii (readability) — documented
  above; positions/depth in the manifest are never floored.
- The HUD phrase tables are fixed; unknown `eventTypeRef`s render their
  verbatim string (accounted, never an invented phrase); captions carry
  no subject names (the entityId is the label — the W502 verbatim rule).
- Mow stripes (10) and curve discretizations (64/16/8 segments) are
  presentation constants; the spec keeps exact radii.
- **G7 proprietary safety unchanged**: every color/phrase/geometry
  constant is a documented in-package original (the 8-entry avatar
  palette, the field palette, the fixed phrase tables; the pitch geometry
  is the spec's IFAB Law 1 constants). No proprietary/commercial game
  asset, branding, or UI is referenced anywhere; "game-style" describes
  the cadence and presentation coherence, never a cloned product
  (architecture-lock §10).
- The velocity bounds gate interpolation only and are physical-plausibility
  heuristics from public data (§6.4) — a legit fast entity at the bound
  boundary interpolates; anything above is held honest.

## 12. Package boundaries

Runtime deps: `@sporta/contracts`, `@sporta/renderer-contract`,
`@sporta/scene-projection` ONLY. Dev deps: `@sporta/temporal`,
`@sporta/world-model`, `@sporta/testing` (integration tests use the
temporal seams; the src boundary stays clean — architecture-lock §5
isolation). Zero external packages (bun.lock carries only the workspace
registration, the W402→W703 precedent; the W603 in-place extension touched
no manifest — the renderer-contract version bump is in `src/identity.ts`,
§1). Not in the root package.json.
