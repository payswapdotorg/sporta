# SPR-W5-J — exact commands (run from the repo root at `59b515c` + this branch's renderers.py edit)

Same environment/toolchain as w5f/w5h/w5i. Out-dirs `/tmp/w5j/…`;
scorecard root symlink `/home/z/spr-evidence -> /tmp/w5j/spr-evidence`.

## 0. Setup

```bash
git checkout 59b515c && git checkout -b spr/w5j/watercolor-promotion
# substrate shas byte-verified; gaterefs reused (9efa9b99 / d19079ca)
# 3-frame smoke + double smoke: d15ad497... == d15ad497... (determinism)
```

## 1. Additive-diff gate

```bash
git diff 59b515c --numstat -- scripts/source-preserving/spe/renderers.py
#   294  0  (additions only; frozen files byte-identical)
```

## 2. Fast loop (8 variants — v0-noema thesis + 7 config A/Bs)

```bash
python3 /home/z/my-project/scripts/w5j_fastloop.py            # v0..v7
#   v0-noema   T3 0.9871  T4 0.9023%  (VLM WORST — edge noise)
#   v1-recipe  T3 0.9826  T4 0.6653%  ALL GREEN — WINNER
#   v2..v7     T3 0.9781-0.9838  T4 0.6149-0.6974  ALL GREEN
# VLM duel: BEST=B (v1-recipe) WORST=A (v0-noema) -> v1 FROZEN
```

## 3. Full renders (frozen config; each cell double-rendered)

```bash
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality watercolor --out-dir /tmp/w5j/out/b8/pass1 --suffix b8 --frames 2,8,15,30,45
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality watercolor --out-dir /tmp/w5j/out/b8/pass2 --suffix b8
#   -> 1190 frames, 2b0b740441d2ce6a... x2 BYTE-IDENTICAL
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8-b12.mp4 \
    --reality watercolor --out-dir /tmp/w5j/out/b12/pass1 --suffix b12 --max-frames 300 --frames 2,8
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8-b12.mp4 \
    --reality watercolor --out-dir /tmp/w5j/out/b12/pass2 --suffix b12 --max-frames 300
#   -> 300 frames, 1fc49b53fc73bffd... x2 BYTE-IDENTICAL
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4 \
    --reality watercolor --out-dir /tmp/w5j/out/b2/pass1 --suffix b2 --frames 2,8
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4 \
    --reality watercolor --out-dir /tmp/w5j/out/b2/pass2 --suffix b2
#   -> 225 frames, 378b87e73069f584... x2 BYTE-IDENTICAL
```

## 4. Gates (per cell, on pass 1)

```bash
# b8 + b2 vs RAW substrate; b12 vs the pre-adjudicated gateref
python3 scripts/source-preserving/qa_check.py --input <clip> --output /tmp/w5j/out/<cell>/pass1/watercolor-<cell>.mp4 \
    --json scripts/evidence/spr-wave5-watercolor/qa/qa-watercolor-<cell>.json
python3 scripts/source-preserving/cuts_deep.py --input <clip> --output /tmp/w5j/out/<cell>/pass1/watercolor-<cell>.mp4 \
    --json scripts/evidence/spr-wave5-watercolor/qa/cuts-deep-watercolor-<cell>.json
```

Outcomes: README §2 — b8 RAW T2 PASS; b12/b2 extra-classes → frozen T2b
1.0/0; T3 0.9557/0.9343/0.9765; T4 0.4474/0.4602/0.9069. ALL GREEN.

## 5. Scorecard (frozen vlm_scorecard.py)

```bash
# populate /tmp/w5j/spr-evidence/{bytes,render,qa} + renders.json
python3 scripts/source-preserving/vlm_scorecard.py --realities watercolor
#   -> 15/15 ok=True, tierClaim=0, critical=53
```

## 6. Regression (AFTER the registration edit)

```bash
# cartoon-cel / noir / subject-toon / clay-toy / player-focus / rotoscope
# b8 renders on the modified tree — 6/6 BYTE-MATCH
```

## 7. Delivery

```bash
git add scripts/source-preserving/spe/renderers.py scripts/evidence/spr-wave5-watercolor/ docs/
git commit -m "spr: w5j watercolor promotion — SPR103 deterministic renderer (anisotropic Kuwahara from the w2c trial) + frozen-protocol scorecard"
git push origin spr/w5j/watercolor-promotion
git checkout main && git merge --no-ff spr/w5j/watercolor-promotion && git push origin main
```
