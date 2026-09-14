# Renderer 3D — Avatar/Field Prototype (W602)

Normative decision record for `@sporta/renderer-3d` — the M6 avatar/field
3D prototype. Work item: "benchmark SWM state becomes coherent
playable-style field scene using original/proprietary-safe assets." Owner:
AI. Dependencies: W601 ✓ (scene projection), W501 ✓ (renderer plugin
contract), W502 ✓ (the deterministic SVG renderer precedent).

This package is a RENDERER: it consumes the W601 `SceneSpecification`
(never raw SWM — see §2), renders it through a deterministic
projective camera into self-contained SVG documents (§1), registers as a
`RendererPlugin` behind the W501 seams (§8), and reports every omission in
a per-frame manifest (§5). It is NOT a 3D engine, an animation system
(W603), or a camera director (W604) — the honest boundaries are §10.

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

`rendererId` is `avatar-field.prototype@0.1.0`; the profile is
1280×720, 1 fps, `codec: "svg"`, `container: "svg"`, offline. Output
segments reference frames through opaque `scene3d://…` URIs (byte
delivery/encoding is the output pipeline's concern, W504 posture).

## 2. Scene consumption (W601) — never raw SWM

Everything the renderer draws is derived from a validated
`SceneSpecification`:

- the contract path (`render3dFromSnapshot`) projects its input snapshot +
  events through W601 `projectScene` FIRST, then renders the spec (all
  canonical camera slots carried; the render slot is selected from it);
- the clip path (`render3dClip`) consumes caller-provided specs directly
  (the W402/W601 seam: `projectScene(stateAt(engine, t).snapshot,
  { events: eventWindow(...) })` per step);
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

## 4. Identity stability + the height/heading producer decision

**Identity stability (architecture-lock §6)**: every color property of an
entity is a pure function of `(styleKey, entityId)` with
`styleKey = "avatar-field.prototype:0.1.0"` (fnv1a32 → 8-entry palette).
There is NO dependence on the entity's SWM `version` (which bumps every
upsert — depending on it would flicker); a renderer version bump is the
only restyle. Officials and the ball use fixed styles (documented, not
hashed). Confidence drives opacity only (`0.35 + 0.65·c`; absent ⇒ no
opacity attribute — a neutral no-claim default).

**Height/heading (W601's open producer slots — the decision)**: W601's
CONTRACT.md records that NO current producer writes the SWM
`height`/`heading` slots. This renderer takes the **carried-absent
honest** posture (one of the two sanctioned options) — it never invents
either:

- **Heading** — a facing wedge is drawn ONLY when the spec carries a
  usable `heading` radians value (dashed when the slot is uncertain). No
  heading slot ⇒ the avatar is a billboard figure making NO facing claim.
  Heading is NOT derived from cross-frame position deltas: a frame is a
  pure function of ONE spec, and temporal derivation is W603's motion
  territory.
- **Ball height** — the ball's elevation is the spec's `position.z`
  (W601 S6). No `z` ⇒ the ball draws AT the pitch plane in a distinct
  height-unknown style (dashed outline, no shadow/drop line) and the
  manifest records `heightCarried: false` — a presentation convention,
  never a faked `z = 0` in data. (The flag is the union of `position.z`
  and a usable `height` slot, so an omitted ball's carried height data is
  never silently dropped from the accounting.)
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
omitted entities); `screenPosition`/`depthMeters` only for drawn
entities; confidences verbatim; style tokens recorded for
identity-styled entities (the no-flicker measurement surface, W503/W605
posture).

## 6. Render paths + marker semantics (R5/R6/R7 analogs)

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
  input event's sequence — even when skipped — else the snapshot's; `watermarkMs`
  = window end, ≥ the snapshot's).
- **Clip path** (`render3dClip`): one frame per step, each from its OWN
  spec — real per-snapshot motion, never interpolated. Each frame renders
  from its own spec's carried slot; the manifest camera block records the
  first step's slot. All step markers are consumed (each in exactly one
  frame's HUD or not-displayed accounting; `skippedMarkers` is always
  empty); degradation only from `simulateDegradation`. Steps must be
  non-empty with finite, strictly increasing `atMs ≥ 0`.

## 7. Style configuration

`styleConfig.config` (unknown keys ignored, forward-compatible):

| Key | Default | Constraints |
|---|---|---|
| `durationMs` | 6000 | finite, [1, 3 600 000] (bounded render work). Clip path ignores it (steps set the timeline). |
| `cameraSlotId` | `"main-touchline"` | must be a CANONICAL slot id; the scene must CARRY it (fail-loud media-invalid otherwise). |
| `simulateDegradation` | `false` | R7 explicit-degradation probe: forces `degraded` with reason `"simulated-degradation"`. |

## 8. Renderer plugin conformance (W501)

Registered through `createAvatarFieldRenderer` (`pluginKind:
"sporta-renderer"`, usable with `RendererRegistry`):

- **R1** capability deep-equal per call; **R2** `requiresSourceFrames:
  false` (pure SWM → scene projection) so the harness's rights probe is
  honestly n/a — BUT the posture goes beyond the baseline, identical to
  W502: a request CARRYING `sourceFrameRefs` without
  `canReferenceSourceFrames` is rejected `rights-denied` in BOTH
  `validateRequest` and `render` (architecture-lock §11: transformation
  never clears rights);
- **R3** identity/profile/snapshot-version gates in both paths;
  **R4** dispose is terminal; **R5–R8** honored by the render paths
  (§6);
- observability seam (optional): one structured info line per render +
  `render_requests_total` / `render_failures_total` counters; absent seam
  ⇒ silent no-ops.

The W501 conformance harness passes 13/13 (test-pinned).

## 9. Determinism + benchmark

Both render paths are pure functions of their inputs — no RNG, no clock
reads, no I/O (constitution: zero `Math.random`/`Date.now`/`new Date()`
in the package, grep-proven). The canonical benchmark fixture
(`test/helpers.ts`) is a 6-step clip (t = 1000..6000) with: a moving
striker whose SWM version BUMPS every step (proving style stability is
version-independent), an uncertain winger (halo), a no-position
participant, an official, an out-of-bounds participant (TRUE-position
render), an in-pitch corner player (off-canvas from main-touchline,
rendered from aerial), a non-renderable kind, a moving ball WITH a
carried height (elevated render) whose height is ABSENT on the last step
(height-unknown posture), football state throughout (possession of the
striker), and a 5-marker stream (one unknown-type ref exercising the
verbatim fallback). The benchmark tests pin: per-frame provenance,
identity stability across frames (style tokens byte-identical), real
per-step motion, disposition accounting totals, byte-identical reruns
(deep-equal output + identical SVG bytes), and W601 `runSceneConformance`
PASS on every step's spec.

## 10. Honest limitations

- **No real 3D engine** — a pinhole camera + painter's algorithm over
  flat-color SVG primitives. No meshes, materials, lighting, or
  rasterization; figures are billboard silhouettes (top-view footprints
  from overhead).
- **No animation or interpolation** (W603) — frames are discrete
  per-spec snapshots; the single-snapshot path holds state between
  watermarks and never invents motion; the clip path shows per-step truth
  only.
- **No camera direction policy** (W604) — the renderer frames from ONE
  carried slot per render (default `main-touchline`, a presentation
  default); it never cuts, never follows the ball, never reacts to
  events.
- 1 fps SVG frames (the profile); encoded delivery/encoding is the
  output-pipeline concern (W504 owns the anime path; a 3D-encoded path is
  future work).
- Painter's-algorithm occlusion is per-figure and ground-level: two
  avatars at nearly the same depth sort by spec order (stable, documented;
  no per-pixel depth testing). Ground annotations (halo/possession rings)
  can interleave under figures without occlusion geometry.
- Billboard figures always face the camera horizontally (a documented
  convention); the facing wedge is the only directional cue, and only
  when the spec carries heading.
- `MIN_MARKER_RADIUS_PX` floors marker radii (readability) — documented
  above; positions/depth in the manifest are never floored.
- The HUD phrase tables are fixed; unknown `eventTypeRef`s render their
  verbatim string (accounted, never an invented phrase); captions carry
  no subject names (the entityId is the label — the W502 verbatim rule).
- Mow stripes (10) and curve discretizations (64/16/8 segments) are
  presentation constants; the spec keeps exact radii.

## 11. Package boundaries

Runtime deps: `@sporta/contracts`, `@sporta/renderer-contract`,
`@sporta/scene-projection` ONLY. Dev deps: `@sporta/temporal`,
`@sporta/world-model`, `@sporta/testing` (integration tests use the
temporal seams; the src boundary stays clean — architecture-lock §5
isolation). Zero external packages (bun.lock carries only the workspace
registration, the W402→W703 precedent). Not in the root package.json.
