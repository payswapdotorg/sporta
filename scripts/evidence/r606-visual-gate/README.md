# R606 visual-gate prep — the flight that makes the HUMAN gate performable

## THE RE-RE-VERDICT (the operator's, 2026-10-06 — the gate REFUSED a third time: TEMPORAL CONSISTENCY)

The operator watched the generative re-prep's four (the same REAL goal clip,
195 per-frame generative genre restyles) and answered in the chat (typed
verbatim in `verdict-reprep2.json`):

- **criterion 1 (the same match/event identifiable): PASS — not contested**;
  the observations are artifact-level: "the anime-npr is good" — the anime's
  STATIC style is now APPROVED (verdict 2's own refusal ground — style
  fidelity — is fixed at the frame level).
- **criterion 2 (the styles as rendered VIDEO): FAIL on TEMPORAL
  CONSISTENCY** — "showing the ball multiple times from the 7th second … the
  pitch keeps flashing/blinking", the tactical "keeps flipping between
  tactical and something else", "the pitch keeps flashing in most videos
  except for the original".

The diagnosis is MEASURED (never asserted): the stable-pitch-region
luminance jump per frame — original **1.41** / anime **9.72** / tactical
**34.03** / 3D **14.00** (the tactical "flipping" is 24× the original's
flicker), and the strict VLM ball-count on the anime tail shows the
duplicated-ball class exactly "from the 7th second" (frame 53: two balls in
the goal-mouth action). The mechanism: **per-frame INDEPENDENT restyling has
no temporal-coherence mechanism** — every frame re-imagined from scratch
flashes (inter-frame variance), flips (prompt-adherence variance), and
hallucinates extra balls (fast goal-mouth motion). Unpassable by
construction — the honest pattern's third repetition (fixture → filter class
→ per-frame independence).

The fix lane (the copy-and-adapt directive, unchanged): the
**reported-to-work flow-guided temporal-coherence class** ("Fast Coherent
Video Style Transfer via Flow Errors Reduction", MDPI; "Coherent Online
Video Style Transfer", IEEE; the Lai et al. blind-temporal-consistency
class) + **keyframe-anchored propagation** (EbSynth — "transform videos by
changing one frame"), adapted locally with OpenCV DIS flow: the SOURCE
clip's own motion transports anchor styled frames, occlusion-aware blending
admits the fresh styled frames only where the warp disagrees, and a per-kind
color harmonization pins the global tone. The full typed record:
`verdict-reprep2.json`.

## THE RE-VERDICT (the operator's, 2026-10-06 — the gate REFUSED again: STYLE FIDELITY)

The operator watched the re-prep's four (the same REAL goal clip through the
three frozen ffmpeg chains) and answered in the chat (typed verbatim in
`verdict-reprep.json`):

- **criterion 1 (the same match/event identifiable across all four): PASS** —
  "I can identify the same match" — the by-construction real-clip event
  carrier WORKED; verdict 1's failure mode is FIXED.
- **criterion 2 (meaningful stylistic differences): FAIL on style fidelity** —
  "the styles applied are not accurate … the anime style for instance is not
  actual anime, same for the tactical and 3d styles".

The diagnosis is the re-prep's own honestly-typed filter class (the research
record, written BEFORE the re-verdict, deferred the generative lane): global
color filters (the green duotone, the palette posterization, the edgedetect
colormix) are **color grading, not genre restyling** — they shift the footage's
tone but cannot turn real footage into ACTUAL anime, an ACTUAL tactical
analysis view, or an ACTUAL 3D-game render. Style fidelity was unpassable by
construction on the filter class, exactly as event identity was unpassable by
construction on the synthetic fixture in verdict 1.

The fix lane (the copy-and-adapt directive, unchanged): **per-frame
GENERATIVE restyling** — the research's own named proven class ("proven
per-frame GAN styling"), adapted through the platform's documented image-edit
capability (z-ai, backend-only) with genre-accurate prompts and a hard
same-event preservation clause. The design gate runs FIRST (one keyframe per
genre through the candidate prompts → the STRICT VLM genre check — actual
anime / actual tactical board / actual 3D-game, not color grades — the
prompts frozen only on PASS), then the full generative re-prep
(`visual-gate-reprep2.ts`), then the operator's eyes again. The full typed
record: `verdict-reprep.json`.

## THE GENERATIVE RE-PREP (the style-fidelity fix — the RE-RE-VERDICT PERFORMABLE)

The fix the re-verdict directed: per-frame **GENERATIVE genre restyling** —
the research's own named proven class, adapted through the platform's
documented image-edit capability (z-ai, backend-only, per-call isolated child
processes — the SDK's orphan-rejection quirk and the CLI's local-file 400
both measured and typed in the lane's own headers). The discipline:

1. **The design gate FIRST**: one keyframe per genre through the candidate
   prompts → the STRICT VLM genre check. Measured verdict: all four questions
   YES (same scene across all four; the tactical frame an actual tactics
   board "completely abandoning photorealism"; the 3D frame an actual
   game-engine render; the anime frame actual hand-drawn) — the prompts
   FROZEN.
2. **The batch**: the SAME real goal clip (the verified Mixkit bytes,
   re-hashed at start), 65 sampled frames × 3 kinds = 195 independent genre
   restyles, paced + cooldown-aware + resume-safe (the lane 429s on bursts;
   the sandbox reaps background processes between tool calls — chunked
   foreground passes), then real-ffmpeg assembly (crop to 16:9, scale
   1280×720, h264). All 195 frames restyled, zero laundered (a frame
   exhausting 12 attempts aborts the run).
3. **The video-level spot check**: three frames per genre across the video
   (early/middle/late) + the original — ten images, one strict VLM call.
   Measured verdict: all five questions YES ("each video maintains a high
   level of stylistic consistency and clearly embodies its assigned genre").
4. **The verifier driver** (`visual-gate-reprep2.ts`): the four MP4s
   re-hashed + the `ftyp` magic + durations re-probed + the ORIGINAL verified
   byte-identical to the researched source + the generation record's own
   claims cross-checked against the bytes on disk; the manifest surfaced for
   the operator's eyes. The record: `visual-gate-reprep2.json`.

The run (2026-10-06): original 3 371 473 B (the source's own bytes) /
tactical 3 023 007 B / three-d-game 3 478 444 B / anime-npr 4 803 051 B —
each 65 frames, 8 fps, 1280×720. The exports + manifest:
`public/r606-reprep2/` (outside the repo, the no-committed-media doctrine).
The operator's move: watch the four and answer the gate — the RE-RE-VERDICT
is the operator's, never a worker's.

## THE VERDICT (the operator's, 2026-10-05T21:20Z — the gate REFUSED)

The operator watched the four and answered in the chat (typed verbatim in
`verdict.json`):

- **criterion 1 (the same match/event identifiable across all four): FAIL** —
  "I can't identify the same match/event in each".
- **criterion 2 (meaningful stylistic differences): PASS** — "I do see
  stylistic differences".

The diagnosis is this prep's own honestly-typed limitation (below, "the
honest scope", written BEFORE the verdict): the fixture class is a 2 s
**synthetic** pitch scene — it proves the pipeline (criterion 2 passed
through exactly this) but **cannot carry event identity**: there is no real
match, no real event, nothing to recognize as the same. Criterion 1 was
unpassable by construction on this fixture class.

The operator's directive for the next flight, typed verbatim: *"instead of
building the complete solution from scratch, try looking for solutions that
have been reported to work and just copy and adapt them"* — the next flights
are (1) the proven-solutions research (real-footage sourcing + per-reality
styling, reported-to-work solutions with citations), (2) the re-prep with a
REAL-footage source clip through the same driver, (3) the operator's eyes
again. The full typed record: `verdict.json`.

## The gate (the operator's, never a worker's)

**R606 — the human visual gate** (`docs/roadmap/mvp-reality-engine-roadmap.md`):
"A human can watch the outputs and identify the same match/event and see
meaningful stylistic differences." MVP success requires R601–R607
(`docs/roadmap/mvp-and-live-reality-roadmap.md` — R606 ⬜ and R607 ⬜ are the
open product gates after the R306 arc's closure).

The gate's VERDICT is the operator's eyes. This flight (the prep) never
judges the visuals — it makes the gate PERFORMABLE: the four realities
rendered through the REAL pipeline, exported OUTSIDE the repo for watching.

## What this flight did (measured, typed)

- **The driver** (`visual-gate-prep.ts`): the golden-path battery's own walk
  shape — the same server composition (in-process, the deterministic
  stepping clock, the seeded selection plane), the same REAL pitch-scene
  clip (320×240, 2 s, audio — `generateTestMp4`, no committed fixture), the
  same four render dispatches (`anime.prototype` + `tactical.prototype` +
  `game-3d.prototype` + `anime-npr.prototype`, the user-explicit compute
  selection), the same polls to terminal, the same watch acquisition, and
  the same four kinds' byte-route reads — **sha-256 re-verified at the
  receiving boundary + the `ftyp` container magic + the byte-length claim**
  — then the bytes EXPORTED (never committed; the no-committed-media
  doctrine stands).
- **The run (2026-10-05T20:36Z, first flight)**: all four walks green —
  the media job terminal `succeeded`, the four render jobs terminal
  `succeeded`, the watch playback `authorized`, the four reads 200 with
  integrity verified. The exports: `original` 38 331 B / `tactical`
  15 297 B / `three-d-game` 288 485 B / `anime-npr` 503 707 B (the full
  shas in the record). The record: `visual-gate-prep.json`.
- **The console surfacing (the TL station's own)**: the outputs + a
  manifest (`manifest.json`) land in the operator-viewing dir (the replay
  console's public surface) — the console page carries the gate's question,
  the four players, and the verdict line "the verdict is the OPERATOR'S".
  The operator answers in the chat; the verdict lands as its own record
  flight.

## The honest scope (what this flight is NOT)

- This is NOT the gate itself — no verdict is recorded here, none is
  implied. The outputs are the golden-path battery's own fixture class
  (the 2 s synthetic pitch scene); a longer or real-footage re-run is one
  command away (`--duration-seconds`, `--scene`) — the gate's substance
  (the same event + the stylists' differences) is carried honestly by the
  REAL pipeline renders.
- The hosted plane's 4/4 closure is a SEPARATE measurement
  (`scripts/evidence/r306-hosted-reflight/`, REPORT.md §11) — this flight
  is local-only by design (the hosted outputs are ephemeral at the
  keep-alive, the ephemerality doctrine).

## Re-run

See `commands.md`. The driver is fail-closed: any step's unexpected HTTP
status, terminal state, sha mismatch, or container magic → exit 1 with the
typed message, nothing exported laundered.

## The validator

`validate-evidence.ts` — re-hashes the exported files against the record
(when present) + verifies the record's own shape (four outputs, integrity
flags, the closed set of kinds); the negative battery refuses a tampered
record (exit 1, the check named).
