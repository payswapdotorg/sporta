# SPR-W4-A — Reproduction Commands (every command, in order)

Run from a fresh clone of this branch (`spr/w4a/gate-amendment`, base
`eb3b404`). Work dir `<work>` below = any directory OUTSIDE the repo tree
(used `/home/z/my-project/spr-w4a-work` in the recorded session; renders
must not enter the repo — allowed paths are the tool, the doc, and this
evidence pack only).

## 1. Setup

```bash
git clone https://github.com/payswapdotorg/sporta.git sporta-w4a
cd sporta-w4a
git checkout eb3b404
git checkout -b spr/w4a/gate-amendment
python3 -m venv .venv
.venv/bin/pip install opencv-python-headless numpy   # no new repo deps
ffmpeg -version | head -1                            # 7.1.5-0+deb13u1
sha256sum scripts/evidence/spr-corpus-bytes/*        # 8/8 match README table
```

## 2. Regression re-renders (frozen engine, byte-exact)

```bash
# 3b — cartoon-cel b8 control (wave-1 record; 1190 frames, ~4.5 min CPU)
.venv/bin/python scripts/source-preserving/render.py \
  --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
  --reality cartoon-cel --out-dir <work>/renders/b8 --suffix b8
# expect sha256 a9e8cd5612f1486fde86b970dd5aab50b9c6d495e18a59d416fef1718e84f26c

# 3c — b7 x motion-trails control (W2B record)
.venv/bin/python scripts/source-preserving/render.py \
  --clip scripts/evidence/spr-corpus-bytes/clip-b7-night.mp4 \
  --reality motion-trails --out-dir <work>/renders/b7 --suffix b7
# expect sha256 998c9b4948e092d89210847786b0a82dbdceec71ffe20c3f83ded1805430bdb9

# 3d — b5 noir-retro/vhs (W2B F4 record)
.venv/bin/python scripts/source-preserving/render.py \
  --clip scripts/evidence/spr-corpus-bytes/clip-b5-camera-move.mp4 \
  --reality noir-retro --profile vhs --out-dir <work>/renders/b5 --suffix b5
# expect sha256 05e4e27768a0683d31e87e12574938953d3bc13342c8625ba3870038ad2516e3

# 3e — b6 noir-retro/vhs (W2B F4 record)
.venv/bin/python scripts/source-preserving/render.py \
  --clip scripts/evidence/spr-corpus-bytes/clip-b6-setpiece.mp4 \
  --reality noir-retro --profile vhs --out-dir <work>/renders/b6 --suffix b6
# expect sha256 61cff549fcfd500599d2a0dcec2aea0dd310dfceba1e1f409e14927ce84c4c89
```

Each command prints its own `sha256` in the result JSON (also recorded in
each `<work>/renders/<clip>/<name>.provenance.json`).

## 3. The amended metric on the EXACT b5/b6 artifacts (3f)

```bash
.venv/bin/python scripts/source-preserving/qa_analog_t3.py \
  --render <work>/renders/b5/noir-retro-vhs-b5.mp4 \
  --source scripts/evidence/spr-corpus-bytes/clip-b5-camera-move.mp4 \
  --out scripts/evidence/spr-wave4-gate-amendment/qa/b5-noir-retro-vhs-analog-t3.json
# expect analogT3.r = 0.9661 (>= 0.95), perFrameT3.r = 0.7303

.venv/bin/python scripts/source-preserving/qa_analog_t3.py \
  --render <work>/renders/b6/noir-retro-vhs-b6.mp4 \
  --source scripts/evidence/spr-corpus-bytes/clip-b6-setpiece.mp4 \
  --out scripts/evidence/spr-wave4-gate-amendment/qa/b6-noir-retro-vhs-analog-t3.json
# expect analogT3.r = 0.9594 (>= 0.95), perFrameT3.r = 0.7978
```

## 4. Digital-reality unchanged proof (3g) + extraction-equivalence control

```bash
# FROZEN harness on the b7 control render (G-T3 must match the wave-2 record 0.9937)
.venv/bin/python scripts/source-preserving/qa_check.py \
  --input scripts/evidence/spr-corpus-bytes/clip-b7-night.mp4 \
  --output <work>/renders/b7/motion-trails-b7.mp4 \
  --json scripts/evidence/spr-wave4-gate-amendment/qa/b7-motion-trails-control-qacheck.json
# expect G-T3 pearsonR 0.9937, G-T4 0.6586, G-T1 pass; exit 1 ONLY because of
# the known F2 vacuous-coverage edge on this zero-cut clip (same as wave-2).

# New tool on the same DIGITAL pair (perFrameT3.r must equal frozen G-T3)
.venv/bin/python scripts/source-preserving/qa_analog_t3.py \
  --render <work>/renders/b7/motion-trails-b7.mp4 \
  --source scripts/evidence/spr-corpus-bytes/clip-b7-night.mp4 \
  --out scripts/evidence/spr-wave4-gate-amendment/qa/b7-motion-trails-control-analog-tool.json
# expect perFrameT3.r = 0.9937 (equivalence proof), analogT3.r = 0.9966 side-by-side
```

## 5. Engine-untouched proof (3a — run after committing this branch)

```bash
git diff eb3b404 --stat -- scripts/source-preserving/
# expect ONLY: scripts/source-preserving/qa_analog_t3.py | <N> + (new file)

git diff eb3b404 -- scripts/source-preserving/qa_check.py \
  scripts/source-preserving/render.py scripts/source-preserving/cuts_deep.py \
  scripts/source-preserving/spe/encode.py scripts/source-preserving/spe/renderers.py \
  scripts/source-preserving/spe/stages.py
# expect: empty (byte-identical)

# blob-identity cross-check (optional, strongest form):
git ls-tree eb3b404 -- scripts/source-preserving/qa_check.py \
  scripts/source-preserving/render.py scripts/source-preserving/cuts_deep.py \
  scripts/source-preserving/spe/encode.py scripts/source-preserving/spe/renderers.py \
  scripts/source-preserving/spe/stages.py
git ls-tree HEAD --   # same list — blob shas must be identical
```

## 6. Append-only proof for the acceptance doc

```bash
git diff eb3b404 -- docs/testing/source-preserving-reality-acceptance.md
# expect: +19 insertions, 0 deletions — the new final section
# "## Amendment A1 (2026-09-25, TL-approved): analog G-T3" only
```

## 7. Delivery

```bash
git add scripts/source-preserving/qa_analog_t3.py \
        docs/testing/source-preserving-reality-acceptance.md \
        scripts/evidence/spr-wave4-gate-amendment
git commit -m "SPR-W4-A: analog G-T3 gate amendment (0.2s smoothed, additive tool + A1 append + regression proof)"
git push <remote> spr/w4a/gate-amendment
```

## Recorded environment

ffmpeg 7.1.5-0+deb13u1 · opencv-python-headless 5.0.0 · numpy 2.5.3 ·
python 3.12.14 (repo-local .venv) · CPU-only, foreground, sequential.
VLM calls: 0 (VLM-free lane by dispatch).
