# Scene Projection Contract (W601)

Normative contract for `@sporta/scene-projection` — the M6 chain head
(W601 → W602 → W603 → W604 → W605). Work item: "SWM can be projected into a
deterministic 3D scene specification." Owner: AI. Dependencies: W401 ✓.

This package defines the **scene specification** (a typed, versioned,
zod-validated document) and the **pure projection** from Sports World Model
snapshots into it. It is a CONTRACT + PROJECTION package in the W501
posture: it defines what a 3D scene consumer may assume and checks it — it
does NOT implement a renderer (W602/W603), animation (W602+), camera
direction policy (W604), or any 3D-engine integration.

## Module map

| Module | Exports |
|---|---|
| `src/schema.ts` | `SceneSpecification` (+ entity, pitch, furniture, camera-slot, marker, score/clock schemas), `SCENE_SCHEMA_VERSION`, `isSceneVersionCompatible`, `SCENE_ENTITY_DISPOSITIONS` |
| `src/slots.ts` | The documented SWM slot keys (`pitchPosition`, `position`, `spatialFrame`, `height`, `heading`), `resolvePositionSlot`, `readNumericSlot`, `PROJECTABLE_KINDS`, `PLANE_KINDS` |
| `src/constants.ts` | IFAB Law 1 furniture constants, `CANONICAL_CAMERA_SLOTS` (5 named slots), `CAMERA_SLOT_IDS`, `CANONICAL_PITCH_FRAME`, constant-set version ids |
| `src/project.ts` | `projectScene(snapshot, options?)`, `buildPitchFurniture()`, `resolveSceneEntity`, `resolveScoreClock` |
| `src/serialize.ts` | `serializeScene` (canonical JSON, sorted keys), `parseSceneSpecification` (fail-closed) |
| `src/validate.ts` | `runSceneConformance(scene, options?)` — 12 stable checks over the rules S1–S8 |
| `src/errors.ts` | `SceneProjectionError` (fail-loud input validation) |
| `scripts/export-scene-schema.ts` | `bun run export-schemas [--update-golden]` — the JSON-Schema export + committed golden (`fixtures/schemas-golden/scene-specification.json`, the W002 precedent) |

## The scene specification document

Top-level blocks:

- `sceneSchemaVersion` — this schema's version (`"1.0"`; MAJOR.MINOR policy
  below).
- `sessionId` / `source` — the snapshot's session id, `schemaVersion`,
  `watermark`, `generatedAtMs`, football-state presence flag, and
  `entityCount`, all **verbatim** (the accounting total for rule S3).
- `world.coordinateSystem` / `world.pitch` — the coordinate system (rule S4),
  the canonical pitch frame (verbatim from the snapshot's football state
  when present, otherwise the identical `@sporta/contracts` constant, with
  `frameSource` recording which), the inclusive play bounds `[0, 105] × [0,
  68]`, the plane at `z = 0`, and the pitch furniture (IFAB Law 1
  constants, `constantsVersion: "ifab-law1-standard@1"`).
- `entities` — **one entry per snapshot entity, in snapshot order**, with
  identity verbatim (S1) and a total disposition (S3).
- `scoreClock` — the snapshot's football extension (score, clock,
  possession, taxonomy version), **verbatim** — the *state to display*, not
  presentation strings (those are W602/W604).
- `eventMarkers` — the caller's ordered event tail, **verbatim** stream
  entries plus `anchoring: "timeline"`.
- `cameraSlots` — the selected named camera slots (default: all five), in
  canonical order.

## Coordinate system (rule S4)

- **Units**: meters. **Handedness**: right-handed (`x × y = +z`).
- **Origin**: the pitch corner the SWM `PitchFrame` declares — `(0, 0, 0)`
  (the frame's `origin: "corner"`).
- **Axes**: `x` runs along the touchline (`0..105`), `y` along the goal line
  (`0..68`), `z` points up; the pitch plane is `z = 0`.
- **Bounds are inclusive**: `0 ≤ x ≤ 105` and `0 ≤ y ≤ 68` is in play
  (W203/W206 semantics). Out-of-bounds positions are **kept true and
  flagged** (`projected-out-of-bounds`) — never clamped, never dropped.
- **Heights**: non-ball entities sit ON the pitch plane — their `z` is `0`,
  a **documented frame constant** (the plane's own definition), not data.
  The ball's `z` is its **carried height**; when the SWM carries no usable
  height the ball's position simply has **no `z`** — never a faked 0 (rule
  S6: "never faked z").

The scene is **engine-agnostic**: plain meters, points, and constants — no
3D-engine-specific concepts (architecture-lock §9; a renderer adapts it to
whatever engine it uses behind its own boundary).

## The SWM state slots the projection reads (documented per entity kind)

`WorldEntity.state` keys are kind-specific and documented by downstream
consumers (the frozen world-model contract). This package documents the
slots it reads — nothing else is projected (unprojected slots stay in the
SWM; the scene is a projection, not a copy):

| Slot key | Read for | Semantics |
|---|---|---|
| `pitchPosition` | projectable kinds | Pitch point `{x, y}` in canonical meters — the KEY names the frame (the `@sporta/testing` builder + renderer-anime convention). |
| `position` | projectable kinds | W401 fusion track position. Frame-less `{x, y}`: projects ONLY when the `spatialFrame` slot is `known "pitch"`. |
| `spatialFrame` | the `position` guard | W401 fusion's caller-declared frame (`"image" \| "pitch"`). |
| `height` | `ball` only | Meters above the pitch plane. For other kinds a `height` slot is not elevation semantics and is never re-interpreted. |
| `heading` | projectable kinds | Radians in the pitch plane, measured from `+x` toward `+y`. |

**Position slot precedence and reconciliation** (this closes the seam the
G4 exit demo measured: fusion writes `position` + `spatialFrame`, while the
builders/renderer-anime use `pitchPosition`):

1. If the `pitchPosition` KEY exists, it is the consulted slot (the key
   names the pitch frame) — no fallback to `position` (ambiguity never
   blends data sources).
2. Otherwise, if the `position` KEY exists, it is the consulted slot —
   projectable only with an established `known "pitch"` `spatialFrame`
   (an `image` frame, a missing declaration, or a mere `uncertain "pitch"`
   candidate is `omitted-non-pitch-frame`, never a guessed mapping).
3. Otherwise the entity has no consulted position slot.

Then, for the consulted slot: value usability first (`unknown`/valueless →
`omitted-no-position`; a non-finite-`{x, y}` value →
`omitted-invalid-position`), the frame guard second.

**Optional numeric slots** (`height`, `heading`) are carried VERBATIM
whenever the slot key exists on the reading kind — the uncertainty status
(and confidence, when present) always; the numeric value only when the slot
carried a finite number; a present-but-unusable value is accounted in the
entity's `invalidSlotKeys` (never coerced). Carrying them is independent of
the position disposition (an omitted entity's verbatim slot data is still
truth; consumers must not place omitted entities).

## Entity dispositions (rule S3 — total, closed vocabulary)

Every snapshot entity gets exactly ONE disposition (the W502
accounted-dispositions posture — never a silent drop):

| Disposition | Meaning |
|---|---|
| `projected` | Projectable kind with a usable pitch position, inside the inclusive bounds. |
| `projected-out-of-bounds` | Usable pitch position outside the bounds: TRUE coordinates kept and flagged — never clamped. |
| `omitted-no-position` | No consulted position slot, or the slot is `unknown`/valueless. |
| `omitted-invalid-position` | The slot's value is not a finite `{x, y}` number pair. |
| `omitted-non-pitch-frame` | A usable `position` value whose frame is not established `"pitch"` (e.g. an image-framed track). |
| `not-projected-kind` | Kind is not projectable onto the pitch plane: `match`, `competition`, `team`, `venue`, `camera`. |

Projectable kinds: `participant`, `official`, `ball` (things physically
located on the pitch plane). Plane kinds (z = 0): `participant`, `official`.

Accounting closure (checked by the harness): `position` is present **iff**
the disposition is `projected`/`projected-out-of-bounds`;
`source.entityCount === entities.length`; a ball's `z` is present iff its
carried height has a finite value and then equals it; plane kinds carry
`z === 0`; `not-projected-kind` entries carry accounting fields only.

## Event markers (rule S7)

Markers are the caller's ordered `WorldEventStreamEntry` tail, **verbatim**
(sequence, `snapshotVersionAfter`, the full event envelope incl. evidence
and `correctionOf`), plus `anchoring: "timeline"`. Markers are
**timeline-anchored and carry NO scene position**: the `EventEnvelope`
contract has no spatial data, and inventing a marker position would violate
rule S2. Correction chains remain visible verbatim (`correctionOf` is
copied through; supersession analysis is the consumer's — W604/W605).
Events must belong to the snapshot's session (cross-session markers are
rejected fail-loud at projection time).

## Camera slots (the slots, not the direction policy)

Five named slots, canonical order, each with its derivation recorded in the
spec (constant set `camera-slots@1`):

| slotId | position | target | derivation |
|---|---|---|---|
| `main-touchline` | (52.5, -25, 20) | (52.5, 34, 0) | halfway line; 25 m beyond the y=0 touchline; 20 m up; aimed at the pitch center |
| `opposite-touchline` | (52.5, 93, 20) | (52.5, 34, 0) | mirror beyond the y=68 touchline |
| `behind-goal-x0` | (-20, 34, 8) | (0, 34, 1.22) | 20 m behind the x=0 goal line; aimed at the goal center (z = 2.44/2) |
| `behind-goal-x105` | (125, 34, 8) | (105, 34, 1.22) | mirror behind the x=105 goal line |
| `aerial-tactical` | (52.5, 34, 60) | (52.5, 34, 0) | 60 m above the pitch center, looking straight down |

A camera slot is NAMED GEOMETRY ONLY. The direction policy — which slot is
active when, cuts, replay emphasis, commentary-driven presentation — is
W604's concern and is deliberately absent. `options.cameraSlotIds` selects
a subset (emitted in canonical order; unknown/duplicate ids throw).

## Pitch furniture constants (rule S2 — explicit, versioned, documented)

All from IFAB **Law 1 (The Field of Play)** on the canonical 105 × 68 m
frame, pinned by schema literals, derived in
`buildPitchFurniture()` (constant set `ifab-law1-standard@1`):

- **Goals** (2, on the goal lines at x=0/x=105, centered y=34): width
  7.32 m, crossbar height 2.44 m. (Law 1 gives the goal mouth only — no
  net depth is invented.)
- **Goal areas** (2): depth 5.5 m, width 7.32 + 2×5.5 = 18.32 m (y from
  24.84 to 43.16).
- **Penalty areas** (2): depth 16.5 m, width 7.32 + 2×16.5 = 40.32 m (y
  from 13.84 to 54.16).
- **Penalty spots** (2): 11 m from each goal line, on its midpoint
  (11, 34) and (94, 34).
- **Center circle**: radius 9.15 m around (52.5, 34); **center mark** at
  (52.5, 34).
- **Corner arcs** (4, canonical corner order): radius 1 m.

## The rules S1–S8 (what a scene consumer may assume)

- **S1 identity stability** — `entityId`, `kind`, `version`,
  `lastEventTimeMs` are copied verbatim; entities keep SNAPSHOT order;
  every snapshot entity appears exactly once; ids are never re-mapped. The
  scene never invents or merges identities (architecture-lock §4).
- **S2 no invented data** — every value in the scene is either a VERBATIM
  copy of an SWM slot value (positions, heights, headings, statuses,
  confidences, score, clock, possession — never rounded, averaged, or
  defaulted) or an EXPLICIT documented constant (pitch furniture, camera
  slots, coordinate frame) whose constant-set version is recorded in the
  spec. Nothing is interpolated; nothing is clamped.
- **S3 disposition accounting** — the disposition vocabulary is closed and
  total; the position/disposition and height/z implications of the closure
  table above hold; `source.entityCount === entities.length`.
- **S4 coordinate system** — right-handed meters, origin at the declared
  pitch-corner, x=touchline, y=goal-line, z=up, plane z=0, inclusive
  bounds; out-of-bounds positions stay TRUE and flagged.
- **S5 determinism** — `projectScene` is pure; the same snapshot + options
  always produce a deep-equal scene whose canonical serialization
  (`serializeScene`) is byte-identical. `serializeScene` →
  `parseSceneSpecification` reproduces the scene (the canonical form is
  total: sorted keys, full number precision, no unknown keys, no explicit
  `undefined` values, no non-finite numbers).
- **S6 uncertainty verbatim** — uncertainty statuses and confidences are
  copied through, never re-derived, averaged, or invented; `unknown` stays
  `unknown`; the ball's height is carried only when the SWM carries it
  (never a faked z).
- **S7 event markers verbatim + unpositioned** — markers are the ordered
  event tail, verbatim, timeline-anchored, with no invented scene
  positions; corrections stay visible (`correctionOf`).
- **S8 versioning** — `sceneSchemaVersion` is MAJOR.MINOR. MINOR bumps are
  additive (a previously valid scene stays valid — old goldens must keep
  parsing; the golden-fixture tests enforce this). MAJOR bumps are
  breaking. `parseSceneSpecification` and the harness reject incompatible
  versions fail-closed (same posture as docs/contracts/COMPATIBILITY.md).

## The conformance harness (`runSceneConformance`)

Fail-soft (never throws on a broken scene), stable check ids, `n/a` detail
for checks the available options make inapplicable, `passed` true only when
every check passes:

| checkId | Rule(s) | Needs |
|---|---|---|
| `scene-schema-valid` | S2/S8 | — |
| `scene-version-compatible` | S8 | — |
| `source-provenance-complete` | S1 | snapshot (else n/a) |
| `identity-stable-and-total` | S1 | snapshot (else n/a) |
| `disposition-accounting-closed` | S3/S4 | — |
| `pitch-geometry-canonical` | S2/S4 | — (frameSource cross-check needs snapshot) |
| `camera-slots-canonical` | S2 | `cameraSlotIds` for exact-set verification; without it the check verifies canonical SUBSET consistency (below) |
| `score-clock-verbatim` | S6 | snapshot (else n/a) |
| `entity-slots-verbatim` | S2/S6 | snapshot (else n/a) |
| `event-markers-verbatim` | S7 | events (else n/a) |
| `determinism-byte-identical` | S5 | snapshot (+ events/selection to reproduce markers) |
| `serialization-roundtrip` | S5 | — |

The snapshot/events-dependent checks re-derive every verbatim block through
the SAME slot-reading rules and re-run the projection for the
byte-identity proof — a consumer supplying the claimed inputs gets a full
S1–S8 verification; a consumer holding only the scene (the W605 posture)
still gets schema, version, closure, constants, and serialization checks.

**Evidence semantics** (checked by tests):

- `n/a` is reserved for ABSENT evidence — `options.snapshot` / `options.events`
  not provided. A PROVIDED-but-malformed snapshot or events array FAILS the
evidence-gated checks (a caller claiming evidence that does not parse is a
caller defect, never a pass).
- `camera-slots-canonical` without `options.cameraSlotIds` verifies canonical
  SUBSET consistency: every present slot deep-equal to its canonical constant,
  the list a canonical-order subsequence of the constant set (reorderings and
  duplicates fail). A partial selection is a legitimate projection output, so
  the exact SET cannot be verified without the selection option — a dropped
  slot from a full set is indistinguishable from a selection in that mode
  (the honest limitation the check's detail names; the determinism check
  reports `n/a` for the same situation).

## Goldens and regeneration procedure

Two committed goldens pin the contract (both enforced by
`test/fixture.test.ts`):

- `fixtures/golden/scene-golden.json` — the canonical serialization of the
  golden fixture's projection (the golden fixture: a real W006 engine with an
   injected clock, 12 entities covering every disposition, football state,
  4 events including a correction — `test/helpers.ts`). The FILE is
  Prettier-formatted (lossless for JSON); the test pins CANONICAL FORM to
  CANONICAL FORM (`serializeScene(parse(golden))` ===
  `serializeScene(projectScene(fixture))`), never the file's cosmetic
  formatting — the W403 posture.
- `fixtures/schemas-golden/scene-specification.json` — the `z.toJSONSchema`
  export of `SceneSpecification` (draft 2020-12). Any schema drift —
  intentional or accidental, including zod-emission drift — fails the test.
  The export is STRUCTURAL-only: the zod runtime refinements (`SceneBounds`
  `xMax >= xMin`; the inherited `UncertainValue` known-requires-value rules)
  are invisible in it (the same documented limit as
  docs/contracts/COMPATIBILITY.md).

Regenerating either golden is an intentional act:

1. make the schema/projection change;
2. `cd packages/scene-projection && bun run export-schemas --update-golden`
   (schema golden) and regenerate the scene golden from the fixture
   (byte-stable by construction);
3. bump `SCENE_SCHEMA_MINOR` (additive) or `SCENE_SCHEMA_MAJOR` (breaking);
4. review the golden diff — it must never land unexplained — and have the
   tech lead review it.

## Versioning and compatibility policy

- `sceneSchemaVersion` `"MAJOR.MINOR"`; current `"1.0"`.
- **Additive (MINOR)**: adding an optional field, a disposition value, a
  camera slot, or a furniture field — previously valid scenes stay valid,
  and every checked-in golden under `fixtures/golden/` must keep parsing
  against the new schema (the fixture tests enforce this — the W002
  golden-compatibility precedent applied to serialization goldens).
- **Breaking (MAJOR)**: removing/renaming fields, changing semantics,
  moving a camera slot, changing a furniture dimension.
- The scene schema REUSES the frozen `@sporta/contracts` schemas for every
  verbatim block, so it can never drift from the SWM documents it projects;
  it lives in THIS package (adding it to `@sporta/contracts` would be a
  contracts change requiring TL approval and golden regeneration there).

## Honest boundaries (non-goals)

- **No animation or interpolation** between snapshots: the scene is a
  projection of ONE snapshot + its event tail. Interpolation, motion
  blending, and temporal continuity are W602+ (architecture-lock §6 is the
  renderer's concern; W503 measures it).
- **No camera direction policy**: named slots only; W604 directs them.
- **No rendering**: no meshes, materials, shaders, or engine scene graphs —
  plain geometric data (meters, points, constants). W602 (avatar/field
  prototype) and W603 (game-style renderer) build on this spec behind their
  own boundaries.
- **No proprietary assets** (G7 / architecture-lock §10): the spec is
  geometric data and opaque SWM entity ids — no asset references, no
  branding, no game-specific implementation. Pitch furniture is the public
  Laws-of-the-Game standard.
- **Height and heading are carried only when the SWM carries them**: no
  current producer writes `height`/`heading` slots (checked: fusion writes
  `position`/`spatialFrame`/`lastSeenMs`; the testing builder writes
  `pitchPosition`/`teamRole`), so real scenes today carry no heights or
  headings — the slots exist so W602+ producers can add them WITHOUT a
  schema change, and the verbatim rule keeps them honest when they do.
- **Event markers are unpositioned** (see rule S7): spatializing an event
  would invent data; a future producer that links events to positions
  would be an additive SWM-side change.
- **The ball z-vs-height rule is checkable, not physics**: a carried height
  of -0.5 projects to z = -0.5 (verbatim claim — the projection does not
  judge physics, it reports the SWM's claim); only non-finite values are
  unusable.
- **Camera slot selection without evidence is subset-verified, not exact**:
  the harness cannot re-project a partial selection it was not told about —
  without `options.cameraSlotIds` a dropped slot is indistinguishable from a
  legitimate selection (exact-set verification needs the option); the
  determinism check reports `n/a` for the same reason.
