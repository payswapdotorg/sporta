# SPR-W4-A — Analog G-T3 Gate Amendment (Lane G evidence)

Task: implement the TL-approved gate amendment — a 0.2 s moving-average
Pearson-correlation T3 for analog-simulation profiles (`noir-retro` profile
`vhs`), as an ADDITIVE gate that never replaces the per-frame G-T3 for
digital realities. Base `eb3b404`, branch `spr/w4a/gate-amendment`.
Engine: SPE-v1, **frozen — untouched** (proof below).

## What was delivered

1. **New additive tool** `scripts/source-preserving/qa_analog_t3.py` (the
   ONLY engine-tree change; purely additive). CLI:
   `--render <mp4> --source <mp4> --out <json>`. It reimplements the frozen
   `qa_check.py` series extraction 1:1 (read from the frozen file, never
   imported-and-altered): `frames_at((64,36), INTER_AREA)` →
   `Farneback(0.5, 3, 15, 3, 5, 1.2, 0)` magnitudes → per-frame mean motion
   energy. Metric: centered moving average `w = round(0.2 × fps)` frames
   (5 at 25 fps) via `np.convolve(x, ones(w)/w, mode='same')` on BOTH
   series, then Pearson r. Output JSON: `analogT3 {r, windowSec, method}`
   plus the raw per-frame r for side-by-side honesty. Threshold 0.80
   (acceptance §1 G-T3 row) — unchanged by the amendment.
2. **Amendment record** — append-only section
   `## Amendment A1 (2026-09-25, TL-approved): analog G-T3` at the end of
   `docs/testing/source-preserving-reality-acceptance.md` (+19 lines,
   0 deletions — `git diff` proves pure append). Records the rule, the
   diagnosis reference, the b12 metadata adjudication (TL: accept +
   document — decode-true frame counts stand; the 338 stsz sample count is
   structural), effective-from wave-4.
3. **Regression proof** (below) + this evidence pack:
   `amendment.json` (rule + decisions + all shas), `qa/` (new-tool JSONs
   for b5/b6 + control gate outputs), `commands.md` (every command,
   reproducible).

## Substrate verification (run before any render)

`sha256sum scripts/evidence/spr-corpus-bytes/*` — all 8 files match the
README.md table (16-hex prefixes) and `spr-wave2-corpus/corpus.json` full
shas: **8/8 MATCH**. Per-clip values in `amendment.json`.

## Regression proof — the acceptance spine

| # | check | expected | measured | verdict |
|---|-------|----------|----------|---------|
| 3a | `git diff eb3b404 -- scripts/source-preserving/` | only the new file (additions); qa_check.py / render.py / encode.py / renderers.py / cuts_deep.py byte-identical | only `qa_analog_t3.py` added; frozen-file git blob shas identical to base (see `amendment.json`) | **PASS** |
| 3b | cartoon-cel b8 control re-render (b8p3, 1190 f) | wave-1 `a9e8cd5612f1486fde86b970dd5aab50b9c6d495e18a59d416fef1718e84f26c` | same | **PASS** |
| 3c | b7×motion-trails control re-render (250 f) | `998c9b4948e092d89210847786b0a82dbdceec71ffe20c3f83ded1805430bdb9` | same | **PASS** |
| 3d | b5 vhs re-render (300 f) | W2B F4 `05e4e27768a0683d31e87e12574938953d3bc13342c8625ba3870038ad2516e3` | same | **PASS** |
| 3e | b6 vhs re-render (300 f) | W2B F4 `61cff549fcfd500599d2a0dcec2aea0dd310dfceba1e1f409e14927ce84c4c89` | same | **PASS** |
| 3f | new metric on those EXACT b5/b6 artifacts | smoothed r ≥ 0.95 (diagnosis 0.9661 / 0.9594) | **0.9661 / 0.9594** (per-frame 0.7303 / 0.7978, equal to the frozen G-T3 records) | **PASS** |
| 3g | FROZEN qa_check.py on the b7 control render | T3/G-T3 match wave-2 record (motion-trails r 0.9937) | G-T3 **0.9937** = record; G-T4 0.6586 = record; G-T1 pass (Δ20 ms) | **PASS** |

The four re-renders are byte-identical to their immutable records
(wave-1 `renders.json`, W2B `renders-w2b.json`), so the exact artifacts the
diagnosis measured are the artifacts the new tool scored in 3f — no
substitution.

### 3g honesty note (G-T2 on b7)

The frozen `qa_check.py` run on the b7 control exits 1: G-T2 reports
`coverage 0.0` because b7 is a zero-cut clip (input cuts `[]`, output cuts
`[]`) — the wave-2 known finding **F2** (vacuous coverage on zero-cut
clips), identical to the recorded wave-2 behavior, not a new failure and
not touched by this amendment. T1/T3/T4 all match the wave-2 record
exactly. Raw output: `qa/b7-motion-trails-control-qacheck.json`.

### Extraction equivalence (reimplementation honesty)

`qa_analog_t3.py` does not import from the frozen harness; its per-frame
math is a line-faithful reimplementation. Equivalence is proven by
measurement on three pairs — the tool's `perFrameT3.r` equals the frozen
`qa_check.py` G-T3 `pearsonR` on every one:

| pair | tool perFrame r | frozen G-T3 r |
|---|---|---|
| b5 × noir-retro/vhs | 0.7303 | 0.7303 (W2B record) |
| b6 × noir-retro/vhs | 0.7978 | 0.7978 (W2B record) |
| b7 × motion-trails (control) | 0.9937 | 0.9937 (frozen run this session + W2B record) |

Control run of the new tool on the DIGITAL b7 pair:
`qa/b7-motion-trails-control-analog-tool.json` (smoothed 0.9966 reported
side-by-side; per-frame 0.9937 equal to the frozen gate).

## Deviations (full disclosure)

- **Smoothing edge handling**: the W3B diagnosis says "5-frame (0.2 s)
  centered moving average" without specifying edge behavior. Three variants
  were measured in a scratch harness (outside the repo) on the exact b5/b6
  artifacts: `np.convolve mode='same'` (zero-padded edges) → **0.9661 /
  0.9594**, `mode='valid'` → 0.9660 / 0.9590, shrinking-window → 0.9658 /
  0.9592. The `mode='same'` variant reproduces the diagnosis values
  exactly at the recorded precision and was adopted; the others differ by
  ≤ 0.0006 and are recorded here so nothing is hidden. No threshold was
  moved anywhere (0.80 stands for both analog and digital gates).
- No other deviations. No VLM calls (quota-preserved lane, by design).

## Reproduction

See `commands.md` for every command in order, from a fresh clone of this
branch. All renders are byte-exact: same clip bytes + same config + same
toolchain (ffmpeg 7.1.5, opencv 5.0.0, numpy 2.5.3, python 3.12 venv) →
identical sha256. MP4s are NOT committed (same policy as W2B: the TL
re-renders locally and byte-compares the shas — that reproduction IS the
verification).
