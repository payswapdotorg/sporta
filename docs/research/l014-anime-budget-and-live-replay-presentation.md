# L014 + the anime-budget resolution — Wave 3 Worker C research record

Date: 2026-09-21 (Wave 3, Worker C — renderer fidelity + live/replay presentation continuity)
Branch: `work/l014pres-fidelity-anime` (base `3170a6f`, the post-`ae075b5` main)

---

## 1. The anime-budget resolution (J013 finding (b) — the TL decision, implemented)

### The decision space

The TL disposition (recorded in the session log, 2026-09-21): **the platform budget stays
intact — slim the render renderer-side.** The knob menu the disposition named: the default
duration and/or the frame budget. The codec argv (crf 18 etc.) is frozen + TL-gated and was
NOT touched.

### The measurements (all through the REAL pipeline — the J013 battery's own path)

The J013 honest finding on main (re-measured this session, clean clone @`3170a6f`):

| Render (populated pitch, default dispatch) | sessionA (2 s clip) | sessionB (4 s clip) | Budget verdict |
|---|---|---|---|
| SD 640×360 @ 25 fps × 4 000 ms (the previous default — 100 frames) | 1 038 993 B | 1 082 922 B | OVER (>104 %) |
| **SD 640×360 @ 12 fps × 4 000 ms (the new default — 48 frames)** | **650 036 B** | **671 203 B** | **UNDER (≈65 %)** |
| SD 640×360 @ 25 fps × 3 000 ms (the duration alternative — 75 frames) | 801 797 B | 828 076 B | UNDER (≈80–83 %) |

Method: the real app path (upload → real perception → canonical SWM → real dispatch → the
compute plane's derived-reality renderer → the real ffmpeg/libx264 encode), with the
candidate knob applied by temporarily editing the renderer constants and reading the
resulting job outcomes / catalog descriptors. A fixture-level sweep
(`renderer-3d`'s canonical fixture through the real engine + codec) was ALSO run and
measured 538 KB at the 25 fps default — the fixture UNDER-ESTIMATES by ~2× because its
static-ball/no-event world has far lower frame-to-frame motion entropy than the
pitch-marked perception output; the fixture sweep is therefore useful only for relative
comparisons, and every number quoted above as evidence is the real-path number.

### The knob chosen: the frame budget ("on twos")

`ANIME_MP4_SD_TWOS_PROFILE` — 640×360 @ **12 fps** — is now the anime capability's FIRST
supported profile (the one hosts pick as the default). Rationale:

1. **Real margin, not a shaved pass**: ≈65 % of the budget leaves ~34 % headroom against
   content variance (busier worlds → more per-frame entropy). The duration alternative
   (3 s @ 25 fps) leaves only ~17–20 % — a sharper real-match render could cross the line.
2. **Style honesty**: traditional cel animation is animated *on twos* (12 fps) — the
   trade-off is the authentic cadence of the medium, not merely a degradation. The quality
   trade-off is still documented as a REAL trade-off: half the temporal resolution of the
   historical SD profile.
3. **Renderer-local**: the knob lives entirely in the renderer's own capability document;
   the frozen codec argv is untouched (the profile only feeds the frame-source
   geometry/framerate inputs — the same-profile → byte-identical determinism pins hold,
   pinned by test).

The historical SD @ 25 fps and HD @ 25 fps profiles **remain supported**: an explicit
request for them is honored (pinned by test) and may still exceed the platform budget,
failing closed at the compute plane with the honest typed refusal — the guardrail's own
answer, never a renderer-side silent downgrade.

### The version bump (the contract rule honored)

`ANIME_NPR_RENDERER_VERSION` 0.1.0 → **0.2.0**. The renderer contract freezes versions
("Renderer versions are immutable"); changing the capability's supported-profile list and
default is a deliberate restyle (the identity module's own doctrine). Consequences,
checked: the control plane + hosted executor derive the version from the resolved plugin
(all dispatches follow); `registry.resolve` highest-version semantics keep
unversioned dispatches working; previously recorded 0.1.0 renders reconstruct through the
designed honest-no-outputs path (the dev seed dispatches no anime-npr renders, so no
seed-path regression). One stale provenance string remains OUTSIDE this lane:
`packages/quality-gates/src/visual-correctness.ts` stamps `rendererVersion: "0.1.0"` in
the origin records of artifacts it encodes through the engine seam directly — a cross-lane
one-line freshness fix, NOT taken (quality-gates is not in this lane's allowed paths);
flagged in the worker report.

### The graduation (the J013 anime leg)

`apps/web/test/derived-reality-sensitivity.test.ts`: `anime-npr` now runs in the SAME
`REALITY_MATRIX` full gate as tactical/3D — materially different SWMs → different real MP4
artifacts through the real compute plane (different integrity hashes + the frozen
manifests' SWM provenance difference) — plus a dedicated graduation-record block asserting
the budget fit (catalog byte sizes ≤ 1 000 000) and documenting the honest history
verbatim (the Wave-2 finding, the measured numbers, the resolution). Battery: 14/14.
Renderer-side: `packages/renderer-3d/test/game/anime-budget.test.ts` (5 tests) pins the
profile-first capability, the default-render budget fit (48 frames, real encode), the
same-defaults determinism, the explicit-SD honor, and the sensitivity-at-defaults.
Package battery: 409/409.

### The encode-variant proposal path — NOT needed, and why

The prompt allowed a SEPARATE pinned encode profile (own determinism pins, TL review) if
the renderer-scoped frame budget could not fit honestly. It fit: the frame-source
framerate is not part of the frozen codec argv (which pins preset/tune/profile/level/crf/
pix_fmt/gop/threads/bitexact — the input framerate is a frame-source parameter like width
and height). No codec-argv change, no proposal required. Recorded so the TL sees the
decision explicitly.

---

## 2. L014 — the presentation side of live/replay continuity

### The acceptance slice this lane owns

> After a live window ends, the SAME tactical/3D surfaces replay the recorded session
> state through the same view-model contracts — no renderer-specific world truth, no
> second presentation path, the watermark/version/timecode continuity VISIBLE (or honestly
> accounted where the platform side is Worker B's later lane).

### The architecture (as landed)

1. **The finite live window** (server): a tactical source registered with
   `finiteWindow: true` runs its scripted window ONCE — the producer answers `null` at
   exhaustion and the transport ends the channel with the additive
   `live-window-complete` close reason. The six L005 scenario sessions' labeled cycling
   behavior is preserved verbatim (the finite frames EQUAL the cycling first pass —
   pinned by test).
2. **The replay record** (server): the channel RECORDS every world frame it emits during
   the finite window — VERBATIM (ordinals, world versions, watermarks, event times —
   never re-stamped, never re-numbered). `GET /api/live/[sessionId]/replay` serves the
   record behind the live route's own fail-closed ladder (503/401/404/403/409/200).
3. **The honest terminal**: `GET /api/live/[sessionId]` answers **410 Gone** with the
   replay pointer once the window completed — never a zombie stream, never a silent
   re-run.
4. **The SAME views replay it** (client): the tactical and 3D renderers accept a `replay`
   presentation input — the RECORDED frame at a shared cursor — and render it through the
   SAME projections (`live-tactical-view.ts`) and the SAME renderer-3d live adapter. The
   replay UI is honestly badged (`replay`, never `live`), paced at the recorded transport
   cadence, scrub/step/play controllable, and the continuity is VISIBLE: the recorded
   world version / watermark / event time per frame + the aligned verdict from the pure
   `replayContinuityVerdict` (monotone world versions, ascending ordinals, non-decreasing
   event times + watermarks — each violation class caught with its specific line).
5. **A transport correctness fix the window forced** (documented in the commit):
   `BoundedEventQueue` delivery is now ARRIVAL order. The previous controls-first `take()`
   let the terminal close jump AHEAD of undelivered frames — making the close's own
   `deliveredFrames` accounting a lie and truncating the window on the consumer side
   (EventSource closes on the close event; frames behind it would never render). Hello
   stays first by construction (the queue's first arrival); the controls lane is still
   unbounded (never dropped).

### The honest boundary (recorded, never claimed otherwise)

- The replay record is the transport's own in-memory record of THIS instance's window.
  Durable persistence of live observations/world versions keyed to the session, and
  reload/redeploy recovery of the replayable state, are **the platform side of L014 —
  Worker B's lane**. A restart honestly answers `no-record` until a new window runs.
- The L002 deterministic source is the dev-seed replay content (honestly labeled —
  synthetic tracking, never a real broadcast).
- L014 is PARTIAL BY DESIGN until the platform side lands.

### Evidence

- `apps/web/test/live-replay.test.ts` — 13 pure-derivation tests (the verdict's aligned +
  every violation class; the facts projection; the cursor math) + 5 transport-level
  window-semantics tests (window runs once → close reason → record retained; subscribe
  refused after completion; cycling never records; unregistered null; re-registration
  restarts honestly).
- `apps/web/test/live-replay-routes.test.ts` — 8 route tests, including the full journey:
  live window (hello → 24 world frames over the real SSE route) → `live-window-complete`
  close → the replay record served VERBATIM (`record.frames` EQUALS the wire frames) →
  the aligned verdict → the stream route's 410 + replay pointer. Plus the fail-closed
  ladder (anonymous 401, unknown 404, no-source 404, rights-denied 403, no-record 200,
  cycling no-record, the sources-list flag).
- `apps/web/test/live-tactical.test.ts` — the view-model finite-window pair (null at
  exhaustion, never a fabricated extra frame; the finite pass EQUALS the cycling first
  pass).
- All live batteries: 82/82.

---

## 3. The unmarked-pitch finding (J013 finding (a)) — NOT fixed in this lane

The measured honest gap stands as J012-documented: on the unmarked pitch scene the
calibration refuses (no landmarks) → positions stay image-frame → the derived renderers
omit every entity. No renderer-side honest improvement was identified that would fake
calibration or invent positions — and none was attempted. The presentation-side
empty-state behavior (the honest empty-pitch render) remains the J012 reconciliation
path. The neural-renderer benchmark work (HF010–HF014) was not touched this wave
(benchmark-track-gated).
