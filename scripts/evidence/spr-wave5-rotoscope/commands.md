# SPR-W5-I — exact commands (run from the repo root at `0eb220d` + this branch's renderers.py edit)

Same environment/toolchain as w5f/w5h. Out-dirs `/tmp/w5i/…`; scorecard
root symlink `/home/z/spr-evidence -> /tmp/w5i/spr-evidence`.

## 0. Setup

```bash
git checkout 0eb220d && git checkout -b spr/w5i/rotoscope-trial
# substrate shas byte-verified (969af7c6 / b3cc5f0e / e65ae487); gaterefs
# reused (9efa9b99 / d19079ca — byte-identical rebuilds)
# 3-frame smoke + double smoke: df04b02c... == df04b02c... (determinism)
```

## 1. Additive-diff gate

```bash
git diff 0eb220d --numstat -- scripts/source-preserving/spe/renderers.py
#   227  0  (additions only; frozen files byte-identical)
```

## 2. Fast loop (8 variants — v0-noflow thesis + 7 config A/Bs)

```bash
python3 /home/z/my-project/scripts/w5i_fastloop.py            # v0..v7
#   v0-noflow      T3 0.9727  T4 0.6333%  (VLM WORST)
#   v1-recipe      T3 0.9750  T4 0.6193%  ALL GREEN — WINNER
#   v2..v7         T3 0.9724-0.9761  T4 0.6056-0.6398  ALL GREEN
# VLM duel: BEST=B (v1-recipe) WORST=A (v0-noflow) -> v1 FROZEN
```

## 3. Full renders (frozen config; each cell double-rendered)

```bash
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality rotoscope --out-dir /tmp/w5i/out/b8/pass1 --suffix b8 --frames 2,8,15,30,45
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality rotoscope --out-dir /tmp/w5i/out/b8/pass2 --suffix b8
#   -> 1190 frames, 32c8666c382adaeb... x2 BYTE-IDENTICAL
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8-b12.mp4 \
    --reality rotoscope --out-dir /tmp/w5i/out/b12/pass1 --suffix b12 --max-frames 300 --frames 2,8
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8-b12.mp4 \
    --reality rotoscope --out-dir /tmp/w5i/out/b12/pass2 --suffix b12 --max-frames 300
#   -> 300 frames, 24cf2ddedd08d0a5... x2 BYTE-IDENTICAL
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4 \
    --reality rotoscope --out-dir /tmp/w5i/out/b2/pass1 --suffix b2 --frames 2,8
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4 \
    --reality rotoscope --out-dir /tmp/w5i/out/b2/pass2 --suffix b2
#   -> 225 frames, e121df44a3b6ee2b... x2 BYTE-IDENTICAL
```

## 4. Gates (per cell, on pass 1)

```bash
# b8 + b2 vs RAW substrate; b12 vs the pre-adjudicated gateref
python3 scripts/source-preserving/qa_check.py --input <clip> --output /tmp/w5i/out/<cell>/pass1/rotoscope-<cell>.mp4 \
    --json scripts/evidence/spr-wave5-rotoscope/qa/qa-rotoscope-<cell>.json
python3 scripts/source-preserving/cuts_deep.py --input <clip> --output /tmp/w5i/out/<cell>/pass1/rotoscope-<cell>.mp4 \
    --json scripts/evidence/spr-wave5-rotoscope/qa/cuts-deep-rotoscope-<cell>.json
```

Outcomes: README §2 — b8 + b12 RAW T2 PASS; b2 extra-class → frozen T2b
1.0/0 (honest difference from the original's b2-raw/b12-T2b split);
T3 0.9774/0.9885/0.9699; T4 0.5487/0.6752/1.0635. ALL GREEN.

## 5. Scorecard (frozen vlm_scorecard.py)

```bash
cp /tmp/w5i/out/b8/pass1/rotoscope-b8.mp4 /tmp/w5i/spr-evidence/render/
cp /tmp/w5i/out/b8/{qa.json -> metrics-rotoscope.json, cuts-deep.json}
# + renders.json (rotoscope entry, determinismDoubleRender.byteIdentical=true)
python3 scripts/source-preserving/vlm_scorecard.py --realities rotoscope
#   -> 15/15 ok=True, tierClaim=0, critical=62 (== the recorded original's 62)
```

## 6. Regression (AFTER the registration edit)

```bash
# cartoon-cel / noir / subject-toon / clay-toy / player-focus b8 renders on
# the modified tree — 5/5 BYTE-MATCH (a9e8cd56 / 3eedb423 / aaac76b7 /
# 69d9ae77 / 3f0be6d2)
```

## 7. Delivery

```bash
git add scripts/source-preserving/spe/renderers.py scripts/evidence/spr-wave5-rotoscope/ docs/
git commit -m "spr: w5i rotoscope trial (TL rebuild) — SPR109 deterministic renderer + frozen-protocol scorecard"
git push origin spr/w5i/rotoscope-trial
git checkout main && git merge --no-ff spr/w5i/rotoscope-trial && git push origin main
```
