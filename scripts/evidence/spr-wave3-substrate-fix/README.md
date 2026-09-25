# SPR-W3-A — Substrate Fix Evidence Pack (Lane S)

Task: fix the two substrate defects blocking clean gating, re-lock the
corpus, re-render the affected lane. Branch `spr/w3a/substrate-fix`,
base `805a5fc` (the wave-2 dispatch base — the only allowed base).
Engine SPE-v1 FROZEN — no file under `scripts/source-preserving/**` was
touched (the substrate adapts to the engine, w6-spr-2 precedent).

## Contents

- `substrate-fix.json` — b1 + b12 records: old/new sha256, exact commands,
  full ffprobe dumps, video-packet identity proofs, determinism proofs,
  the 6-clip byte-match table, the b12 honest negative.
- `renders-w3a.json` — the 5 b1-lane render records (wave-2 schema).
- `qa/b1-<reality>.json` — qa_check gate output per render (5/5 COMPLETE).
- `qa/b1-<reality>-cuts-deep.json` — cuts_deep correspondence gate (5/5).
- `frames/b1-<reality>-t8.png` — t=8 s sanity frame per render.

MP4s are NOT committed (same policy as wave-2: the TL re-renders locally
and byte-compares the shas recorded in `renders-w3a.json` — that
reproduction IS the verification).

## Control (run FIRST, on untouched b7 bytes)

b7 × motion-trails via the frozen `render.py`:
sha256 `998c9b4948e092d89210847786b0a82dbdceec71ffe20c3f83ded1805430bdb9`
== the wave-2 record **exactly** — this clone + venv reproduce the frozen
engine bit-exactly before any substrate change is judged.

## Substrate changes (bytes re-verified below)

- **b1** `clip-b1-wide-broadcast.mp4`:
  `72ac7f69f9edbadf…` → `3a3c249ef351aaff…`
  Two-step apad re-cut from the same b8p3 window (commands in
  substrate-fix.json): video packets byte-identical (raw h264 dump sha
  `af62055d…` on both sides), 751 frames preserved, audio 30.06 s ≥ video
  30.04 s (real broadcast sound to ~30.02 s + silent tail). Re-cut itself
  double-run byte-identical.
  → resolves wave-2 **F1** (the frozen `-shortest` 751→750 truncation and
  the qa_check crash).
- **b12** `b8-b12.mp4`:
  `7cb3d728cc349720…` → `b3cc5f0e2fae840f…`
  Remux with apad'ed audio 12.06 s ≥ video 12.04 s; video packets
  byte-identical (raw h264 dump sha `32a54c63…` both sides), decode-true
  301 unchanged.
  → resolves the w2c **trailing-packet drop** under `-shortest`.
  → **HONEST NEGATIVE on nb_frames**: 338 is the true sample-table count,
  not stale metadata — the track carries 37 edit-list-hidden pre-roll
  packets whose GOP root keyframe (PTS −1.48) the first 63 real frames
  ([0, 2.52 s), next keyframes 2.52/8.52, 4 s GOPs) are predicted from.
  A packet-preserving remux cannot write nb_frames=301; dropping the
  pre-roll corrupts real content; re-encoding alters frozen pixels.
  Open for TL decision (options recorded in substrate-fix.json).
- **The other 6 clips**: bytes and corpus entries untouched (sha table in
  substrate-fix.json; post-edit sha256sum matches the pre-existing values
  for all six).

## b1 lane re-render — 5 realities × double render (G-T5 discipline)

det = double-render byte-identical (independent out-dirs, both shas in
renders-w3a.json). Wave-2 comparison: 5/5 CRASH → now 5/5 COMPLETE.
cov = G-T2 spike coverage; r = G-T3 Pearson; flick = G-T4 static-region
|ΔL| % of range; cd = cuts_deep coverage/invented.

| # | reality | frames | det | G-T1 | G-T2 | G-T3 | G-T4 | allPass | cuts_deep |
|---|---------|--------|-----|------|------|------|------|---------|-----------|
| 1 | cartoon-cel | 751 | yes | PASS (751==751, Δ20ms) | FAIL cov 0.667 | PASS r 0.9762 | PASS 0.3768% | no | PASS cov 1.0, invented 0 |
| 2 | anime-npr | 751 | yes | PASS (751==751, Δ20ms) | FAIL cov 0.667 | PASS r 0.9690 | PASS 0.3890% | no | PASS cov 1.0, invented 0 |
| 3 | noir-retro (noir) | 751 | yes | PASS (751==751, Δ20ms) | PASS cov 1.0 | PASS r 0.9990 | PASS 0.4727% | **yes** | PASS cov 1.0, invented 0 |
| 4 | noir-retro (vhs) | 751 | yes | PASS (751==751, Δ20ms) | PASS cov 1.0 | PASS r 0.8989 | PASS 0.8193% | **yes** | PASS cov 1.0, invented 0 |
| 5 | motion-trails | 751 | yes | PASS (751==751, Δ20ms) | PASS cov 1.0 | PASS r 0.9583 | PASS 0.5211% | **yes** | PASS cov 1.0, invented 0 |

**The point of this lane**: qa_check COMPLETES on all 5 (0 crashes; the
input cuts are exactly b8's recorded 189/475/550) and every render
preserves all 751 frames (wave-2: 750, truncated by `-shortest`).

The two raw-G-T2 misses (rows 1–2) are the frame-550 boundary case: the
flattening styles carry the cut's amplitude at ~0.78 ratio (cartoon:
20.09 → 15.69) below the spike detector's 2.6× local-median ratio, with
zero extra cuts; the dispatched deep gate `cuts_deep` resolves it by
correspondence (coverage 1.0, invented 0) — the exact case its docstring
documents. Recorded honestly, not gate-shopped: both the raw T2 JSONs and
the cuts_deep JSONs sit side-by-side in `qa/`.

## Corpus re-lock

`scripts/evidence/spr-wave2-corpus/corpus.json`: ONLY the b1 + b12
sha256 values updated + one timestamped note appended (superseded shas,
re-cut commands' substance, new byteSizes/durations, the honest negative).
`git diff origin/main -- …corpus.json` shows exactly that (gate 7).
`scripts/evidence/spr-corpus-bytes/README.md`: the two sha-table rows
regenerated to the new 16-hex prefixes.

## Deviations from the packet (recorded for the TL)

1. b12 nb_frames: not correctable by remux — honest negative (see above).
   The packet's "stale metadata" framing was factually wrong; evidence
   recorded rather than a fake pass.
2. b1 re-cut is a TWO-step ffmpeg recipe, not one command: a single
   combined command never lets apad's tail reach the muxer when a
   stream-copied video track is present (measured; commandNotes in
   substrate-fix.json). Both steps + the mux are double-run
   byte-identical.
3. corpus.json entry `byteSize`/`durationMs` fields for b1/b12 were left
   at their wave-2 values per the gate-7 "ONLY the two sha changes"
   minimal-diff rule; the true new values (1771681/30060 ms,
   731394/12060 ms) are recorded in the appended note and in
   substrate-fix.json.
4. Renders ran with `.venv/bin/python3` (the project venv — the recorded
   toolset); the recorded commands note this explicitly.
