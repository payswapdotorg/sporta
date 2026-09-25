# SPR-W2-B — Corpus-Wide Renders (Lane B evidence)

Task: every reality family x every new corpus clip. 5 realities
(`cartoon-cel`, `anime-npr`, `noir-retro` profile `noir`, `noir-retro`
profile `vhs`, `motion-trails`) x 6 clips (b1 wide, b2 close-up, b3
fast-action, b5 camera-move, b6 set-piece, b7 night) = **30 renders**,
each with a self-QA gate run, a double-render determinism proof, and (b1)
a deep cut-correspondence gate. Base `805a5fc`, branch
`spr/w2b/corpus-renders`. MP4s are NOT committed (TL re-renders locally and
byte-compares the shas in `renders-w2b.json` — that reproduction IS the
verification).

## Substrate verification (run before any render)

`sha256sum` of all 8 members of `scripts/evidence/spr-corpus-bytes/` vs the
full shas in `scripts/evidence/spr-wave2-corpus/corpus.json` (and the
16-hex prefixes in its README.md): **8/8 MATCH** — recorded per-clip in
`renders-w2b.json` `substrate`. All inputs are the frozen real corpus bytes;
no fixtures.

## How the renders were produced

Per pair (run from the repo root, outputs OUTSIDE the repo tree):

```
python3 scripts/source-preserving/render.py \
  --clip scripts/evidence/spr-corpus-bytes/<clip>.mp4 \
  --reality <key> [--profile noir|vhs] \
  --out-dir /tmp/out/<clipid> --suffix <clipid>
```

Determinism: the SAME command with `--out-dir /tmp/out2/<clipid>`
(pass 2, independent out-dir); both MP4s sha256-compared.
Gates: `python3 scripts/source-preserving/qa_check.py --input <clip>
--output <render> --json qa/<clipid>-<reality>[-<profile>].json`.
Cut gate (b1 carries b8's recorded cuts at frames 189/475/550):
`python3 scripts/source-preserving/cuts_deep.py ...` per b1 render.
t=8 s sanity frame: `ffmpeg -ss 8 -i <render> -frames:v 1 frames/...-t8.png`.

Tools: ffmpeg 7.1.5, opencv-python-headless 5.0.0, numpy 2.5.3, python 3.12
(venv; recorded in `renders-w2b.json` `tools`). No new repo dependencies.

## Results — 30 rows

det = double-render byte-identical. CRASH = qa_check.py could not produce
the gate (see finding F1). cov = G-T2 cut coverage; extra/30s = extra-cut
rate; r = G-T3 motion-energy Pearson; flick = G-T4 static-region mean |dL|
as % of range.

| # | clip | reality | det | G-T1 | G-T2 | G-T3 | G-T4 | key numbers | notes |
|---|------|---------|-----|------|------|------|------|-------------|-------|
| 1 | b1 | cartoon-cel | yes | FAIL | CRASH | CRASH | CRASH | — | qa_check crashed; T1 by ffprobe: 751 vs 750; cuts_deep cov 1.0, invented 0 |
| 2 | b1 | anime-npr | yes | FAIL | CRASH | CRASH | CRASH | — | qa_check crashed; T1 by ffprobe: 751 vs 750; cuts_deep cov 1.0, invented 0 |
| 3 | b1 | noir-retro (noir) | yes | FAIL | CRASH | CRASH | CRASH | — | qa_check crashed; T1 by ffprobe: 751 vs 750; cuts_deep cov 1.0, invented 0 |
| 4 | b1 | noir-retro (vhs) | yes | FAIL | CRASH | CRASH | CRASH | — | qa_check crashed; T1 by ffprobe: 751 vs 750; cuts_deep cov 1.0, invented 0 |
| 5 | b1 | motion-trails | yes | FAIL | CRASH | CRASH | CRASH | — | qa_check crashed; T1 by ffprobe: 751 vs 750; cuts_deep cov 1.0, invented 0 |
| 6 | b2 | cartoon-cel | yes | PASS | PASS | PASS | PASS | cov 1.0, extra/30s 0.0; r 0.9919; flick 0.8001% | |
| 7 | b2 | anime-npr | yes | PASS | FAIL | PASS | PASS | cov 1.0, extra/30s 3.326; r 0.987; flick 0.8172% | F3: source cut split into two adjacent spikes |
| 8 | b2 | noir-retro (noir) | yes | PASS | PASS | PASS | PASS | cov 1.0, extra/30s 0.0; r 0.9974; flick 0.8446% | |
| 9 | b2 | noir-retro (vhs) | yes | PASS | PASS | PASS | PASS | cov 1.0, extra/30s 0.0; r 0.9862; flick 1.3041% | |
| 10 | b2 | motion-trails | yes | PASS | FAIL | PASS | PASS | cov 1.0, extra/30s 3.326; r 0.9232; flick 1.1524% | F3: source cut split into two adjacent spikes |
| 11 | b3 | cartoon-cel | yes | PASS | PASS | PASS | PASS | cov 1.0, extra/30s 0.0; r 0.9794; flick 0.5222% | |
| 12 | b3 | anime-npr | yes | PASS | PASS | PASS | PASS | cov 1.0, extra/30s 0.0; r 0.9807; flick 0.518% | |
| 13 | b3 | noir-retro (noir) | yes | PASS | PASS | PASS | PASS | cov 1.0, extra/30s 0.0; r 0.9987; flick 0.4667% | |
| 14 | b3 | noir-retro (vhs) | yes | PASS | PASS | PASS | PASS | cov 1.0, extra/30s 0.0; r 0.9343; flick 0.824% | |
| 15 | b3 | motion-trails | yes | PASS | PASS | PASS | PASS | cov 1.0, extra/30s 0.0; r 0.9474; flick 0.5402% | |
| 16 | b5 | cartoon-cel | yes | PASS | FAIL | PASS | PASS | cov 0.0, extra/30s 0.0; r 0.9842; flick 0.4454% | F2: zero-cut clip, vacuous coverage |
| 17 | b5 | anime-npr | yes | PASS | FAIL | PASS | PASS | cov 0.0, extra/30s 0.0; r 0.9832; flick 0.3765% | F2 |
| 18 | b5 | noir-retro (noir) | yes | PASS | FAIL | PASS | PASS | cov 0.0, extra/30s 0.0; r 0.9985; flick 0.4181% | F2 |
| 19 | b5 | noir-retro (vhs) | yes | PASS | FAIL | FAIL | PASS | cov 0.0, extra/30s 0.0; r 0.7303; flick 0.686% | F2 + F4: real G-T3 miss |
| 20 | b5 | motion-trails | yes | PASS | FAIL | PASS | PASS | cov 0.0, extra/30s 0.0; r 0.9985; flick 0.3692% | F2 |
| 21 | b6 | cartoon-cel | yes | PASS | FAIL | PASS | PASS | cov 0.0, extra/30s 0.0; r 0.9712; flick 0.4766% | F2 |
| 22 | b6 | anime-npr | yes | PASS | FAIL | PASS | PASS | cov 0.0, extra/30s 0.0; r 0.9716; flick 0.4691% | F2 |
| 23 | b6 | noir-retro (noir) | yes | PASS | FAIL | PASS | PASS | cov 0.0, extra/30s 0.0; r 0.9988; flick 0.4879% | F2 |
| 24 | b6 | noir-retro (vhs) | yes | PASS | FAIL | FAIL | PASS | cov 0.0, extra/30s 0.0; r 0.7978; flick 0.9477% | F2 + F4: marginal G-T3 miss (0.7978 vs 0.80) |
| 25 | b6 | motion-trails | yes | PASS | FAIL | PASS | PASS | cov 0.0, extra/30s 0.0; r 0.9985; flick 0.4512% | F2 |
| 26 | b7 | cartoon-cel | yes | PASS | FAIL | PASS | PASS | cov 0.0, extra/30s 0.0; r 0.9951; flick 0.5476% | F2 |
| 27 | b7 | anime-npr | yes | PASS | FAIL | PASS | PASS | cov 0.0, extra/30s 0.0; r 0.994; flick 0.5693% | F2 |
| 28 | b7 | noir-retro (noir) | yes | PASS | FAIL | PASS | PASS | cov 0.0, extra/30s 0.0; r 0.9995; flick 0.5776% | F2 |
| 29 | b7 | noir-retro (vhs) | yes | PASS | FAIL | PASS | PASS | cov 0.0, extra/30s 0.0; r 0.8749; flick 1.2104% | F2 |
| 30 | b7 | motion-trails | yes | PASS | FAIL | PASS | PASS | cov 0.0, extra/30s 0.0; r 0.9937; flick 0.6586% | F2 |

Totals: **30/30 renders, 30/30 byte-identical determinism**; gate pass
counts among the 25 pairs where qa_check completed: T1 25/25, T2 8/25,
T3 23/25, T4 25/25; 5 b1 pairs have qa_check crashes (F1) with T1 recorded
as FAIL from ffprobe facts. 8/30 pairs allPass (b2 x3, b3 x5).

## Gate failures — recorded honestly, with diagnosis

### F1 — b1 substrate audio shorter than video (5 pairs, G-T1 FAIL + tool crash)

`clip-b1-wide-broadcast.mp4` (sha-pinned substrate, cut from b8 with
`-ss 0 -t 30 -c copy`) has video 751 frames / 30.04 s but audio ending at
30.00 s. The frozen engine's contract encode is audio-passthrough with
`-shortest`, so every b1 render trims to **750 frames** — output 750 !=
input 751 -> G-T1 fails by the numbers (delta duration 40 ms, audio
passthrough itself OK). qa_check.py then dies in G-T3
(`np.corrcoef` ValueError: motion-energy series 751 vs 750) BEFORE writing
its JSON, so T2/T3/T4 were not produced for b1 — recorded as CRASH, not as
pass or fail. Per-pair crash records with ffprobe facts:
`qa/b1-*-qacrash.json`.

This is the same defect class wave-1 hit on the b8 raw merge (1191 frames
> audio; G-T1 fail) and resolved by apad-normalizing the SUBSTRATE —
"the engine was NOT modified (contract frozen) — the substrate adapts to
the engine" (status doc, w6-spr-2). The b1 bytes are sha-pinned in
corpus.json and outside lane B's write surface, so this is recorded, not
worked around. Suggested fix for the lead: re-cut b1 from b8p3 with the
apad normalize (audio padded >= 30.04 s), re-pin the sha, re-run this lane.

Notwithstanding F1, the b1 artifacts themselves are well-formed,
deterministic (30/30 includes b1), and cut-preserving: **cuts_deep PASS on
all 5 b1 renders — coverage 1.0, invented 0** against b8's recorded cuts
carried at frames 189/475/550 (spike-detected on the b1 input exactly at
[189, 475, 550]). Per-cut amplitude correspondence in
`qa/b1-*-cuts-deep.json`.

### F2 — vacuous G-T2 coverage on zero-cut clips (15 pairs, b5/b6/b7)

b5 (camera-move pan), b6 (set-piece), b7 (night) are single continuous
shots: the spike detector finds ZERO input cuts. qa_check computes
coverage = preserved / max(len(inputCuts), 1) = 0/1 = 0.0 < 0.95 ->
G-T2 `pass: false`, although nothing was missed (coverage numerator 0
because denominator 0) and nothing was invented (`extraPer30s: 0.0`,
output cuts also 0). The raw JSONs show `inputCutCount: 0,
outputCutCount: 0` — the failure is a metric edge (division by
max(n,1) on an empty cut list), not a preservation violation. Spot-check
with the deep gate: `qa/b5-noir-retro-vhs-cuts-deep.json` — inputCuts [],
outputCuts [], inventedCuts [], pass true (vacuous). Recorded as FAIL per
the frozen metric; no threshold was lowered and no result hidden.

### F3 — b2 single source cut splits into two adjacent spikes (2 pairs: anime-npr, motion-trails)

b2 has exactly one input cut (frame 97, amplitude 44.8). In the anime-npr
and motion-trails outputs the spike detector fires at BOTH 96 and 99 —
the same source discontinuity cluster rendered as two adjacent spikes.
G-T2 coverage is 1.0 (the source cut IS preserved) but the second
adjacent detection counts as 1 extra cut -> extraPer30s 3.326 > 1.0 ->
FAIL. Deep-gate resolution (diagnostic; the raw G-T2 FAIL stays): input
97 -> output 99 amplitude ratio 0.975 (anime) / -> 96 ratio 1.241
(trails); coverage 1.0, invented 0 on both — no invented cut exists, the
input itself carries flat-threshold amplitude at frames 93–99
(see `flatThresholdDiagnostic` in the raw JSONs). Evidence:
`qa/b2-anime-npr-cuts-deep.json`, `qa/b2-motion-trails-cuts-deep.json`.

### F4 — noir-retro/vhs G-T3 motion-correlation miss (2 pairs: b5, b6 — REAL failures)

`noir-retro` profile `vhs` fails G-T3 on the two continuous-motion clips:
b5 r = 0.7303, b6 r = 0.7978 (threshold 0.80; b7 0.8749 passes; noir
profile passes everywhere: 0.9985/0.9988/0.9995). Diagnosis: the vhs
profile's grain + scanline noise raises the output's per-frame motion
noise floor; on uniform pans the input's motion-energy time series is
nearly flat, so added noise decorrelates it. This is a genuine
stylization-vs-preservation tradeoff of the vhs profile, recorded as
FAIL. No fix attempted in this lane (engine frozen); candidate leads for
the neural wave: vhs grain amplitude gating by input motion energy.

## Evidence manifest

- `renders-w2b.json` — 30 entries: clipId, reality key, profile, exact
  render command, output sha256 (pass 1 AND pass 2), byte-identical flag,
  qa_check gate results, frame counts, duration ms, wall times, renderer
  ids/versions, style-config hashes, cuts_deep results (b1), plus the
  substrate verification record and the known-findings list above.
- `qa/` — 25 raw qa_check outputs (`<clipid>-<reality>[-<profile>].json`);
  5 b1 crash records (`...-qacrash.json`, labeled as driver-produced crash
  records, NOT qa_check output); 5 mandated cuts_deep runs
  (`b1-*-cuts-deep.json`); 3 diagnostic cuts_deep runs (b2 anime, b2
  trails, b5 vhs — resolver evidence for F3/F2).
- `frames/` — 30 PNGs, one t=8 s frame per render
  (`<clipid>-<reality>[-<profile>]-t8.png`), extracted from the pass-1
  artifacts.

## Reproduction (TL)

From the repo root at `805a5fc` (or this branch — the engine is untouched):
re-run the `command` string of any entry in `renders-w2b.json` and
sha256-compare against `outputSha256Pass1`. Every render is byte-exact:
same clip bytes + same config + same tool chain -> identical sha.

## Resource notes

CPU-only. Approx wall time per pair (double render + gates + frame):
cartoon-cel/anime-npr ~2–6 min (b1 heaviest: ~6 min), noir/vhs/trails
~20–70 s; total lane ~48 min CPU-time for 60 render passes plus gates.
Zero retries; render FPS ~4.3 (cartoon/anime) to ~20 (noir/vhs/trails).
