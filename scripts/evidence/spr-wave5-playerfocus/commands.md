# SPR-W5-H — exact commands (run from the repo root at `e2adeeb` + this branch's renderers.py edit)

Same environment/toolchain as w5f (py 3.12.14 / cv2 4.13.0 / np 2.1.3 /
ffmpeg 7.1.5; foreground-only — the sandbox background reaper re-verified
this session). Out-dirs `/tmp/w5h/…`; scorecard root symlink
`/home/z/spr-evidence -> /tmp/w5h/spr-evidence`.

## 0. Setup

```bash
git checkout e2adeebd8e5219481146244ead0e5f9a268b1202   # origin/main (w5f merged)
git checkout -b spr/w5h/playerfocus-trial
sha256sum scripts/evidence/spr-corpus-bytes/{b8p3,b8-b12}.mp4 scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4
# 969af7c6... / b3cc5f0e... / e65ae487... (== corpus README)
# gaterefs reused (byte-identical rebuild): b8-first300 9efa9b99...; b12-first300-from-old d19079ca...
mkdir -p /tmp/w5h/spr-evidence/{bytes,render,qa/vlm}
ln -sfn /tmp/w5h/spr-evidence /home/z/spr-evidence
cp scripts/evidence/spr-corpus-bytes/b8p3.mp4 /tmp/w5h/spr-evidence/bytes/b8p3.mp4
```

## 1. Additive-diff gate

```bash
git diff e2adeeb --numstat -- scripts/source-preserving/spe/renderers.py
#   352  0  (additions only)
git diff e2adeeb --stat -- <frozen files>   # EMPTY
# 3-frame smoke + double smoke: 966e3934... == 966e3934... (determinism)
# smoke-caught correction: cv2.CamShift returns RotatedRect — unpack via cv2.boxPoints
```

## 2. Fast loop (8 variants — v0 anti-precedent + 7 phase-2)

```bash
python3 /home/z/my-project/scripts/w5h_fastloop.py            # v0..v7
#   v0-crop-follow  T3 0.7989 FAIL  T4 1.6391% FAIL   ANTI-PRECEDENT REJECTED
#   v1-recipe       T3 0.9751       T4 0.7407%        ALL GREEN — WINNER
#   v2..v7          T3 0.9645-0.9964  T4 0.6104-0.8235 ALL GREEN
# VLM duel (ffmpeg grabs + cv2 hstack/vstack -> duel-strip.png):
z-ai vision -p "<duel prompt — see fastloop-visual/vlm-duel.json>" \
    -i /tmp/w5h/duel/duel-strip.png -o /tmp/w5h/duel/vlm-duel.json
#   BEST=A (v1-recipe)  WORST=E (zoom 1.5)  -> v1 FROZEN
```

## 3. Full renders (frozen config; each cell double-rendered)

```bash
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality player-focus --out-dir /tmp/w5h/out/b8/pass1 --suffix b8 --frames 2,8,15,30,45
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality player-focus --out-dir /tmp/w5h/out/b8/pass2 --suffix b8
#   -> 1190 frames, 3f0be6d2050cf317... x2 BYTE-IDENTICAL
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8-b12.mp4 \
    --reality player-focus --out-dir /tmp/w5h/out/b12/pass1 --suffix b12 --max-frames 300 --frames 2,8
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8-b12.mp4 \
    --reality player-focus --out-dir /tmp/w5h/out/b12/pass2 --suffix b12 --max-frames 300
#   -> 300 frames, 48059e48c4874b43... x2 BYTE-IDENTICAL
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4 \
    --reality player-focus --out-dir /tmp/w5h/out/b2/pass1 --suffix b2 --frames 2,8
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4 \
    --reality player-focus --out-dir /tmp/w5h/out/b2/pass2 --suffix b2
#   -> 225 frames, fabb4141932d0380... x2 BYTE-IDENTICAL
```

## 4. Gates (per cell, on pass 1)

```bash
# b8 + b2 vs RAW substrate; b12 vs the pre-adjudicated gateref
python3 scripts/source-preserving/qa_check.py --input <clip> --output /tmp/w5h/out/<cell>/pass1/player-focus-<cell>.mp4 \
    --json scripts/evidence/spr-wave5-playerfocus/qa/qa-player-focus-<cell>.json
python3 scripts/source-preserving/cuts_deep.py --input <clip> --output /tmp/w5h/out/<cell>/pass1/player-focus-<cell>.mp4 \
    --json scripts/evidence/spr-wave5-playerfocus/qa/cuts-deep-player-focus-<cell>.json
```

Outcomes: README §2 — b8 raw-T2 5/6 softened class → frozen T2b 1.0/0
(honest difference from the original's b8 raw-pass); b12 + b2 RAW PASS;
T3 0.9386/0.9285/0.9528; T4 0.6309/0.7020/1.3626. ALL GREEN.

## 5. Scorecard (frozen vlm_scorecard.py)

```bash
cp /tmp/w5h/out/b8/pass1/player-focus-b8.mp4 /tmp/w5h/spr-evidence/render/
cp /tmp/w5h/out/b8/{qa.json -> metrics-player-focus.json, cuts-deep.json -> cuts-deep-player-focus.json}
# + renders.json (player-focus entry, determinismDoubleRender.byteIdentical=true)
python3 scripts/source-preserving/vlm_scorecard.py --realities player-focus
#   -> 15/15 ok=True, tierClaim=0, critical=1 (NEAR-MISS Tier 1)
```

## 6. Regression (AFTER the registration edit)

```bash
# cartoon-cel / noir-retro(noir) / subject-toon / clay-toon b8 renders on the
# modified tree — 4/4 BYTE-MATCH the frozen/rebuild anchors
# (a9e8cd56 / 3eedb423 / aaac76b7 / 69d9ae77)
```

## 7. Delivery

```bash
git add scripts/source-preserving/spe/renderers.py scripts/evidence/spr-wave5-playerfocus/ docs/
git commit -m "spr: w5h playerfocus trial (TL rebuild) — SPR205 deterministic renderer + frozen-protocol scorecard"
git push origin spr/w5h/playerfocus-trial
git checkout main && git merge --no-ff spr/w5h/playerfocus-trial && git push origin main
```

## 8. Sandbox incidents (recorded honestly)

- One command-boundary timeout on a 4-anchor regression batch (13.5 min
  work > 600 s budget) — split into per-anchor calls, artifacts unaffected
  (the recorded w5f-era 590s-truncation class, avoided by batching
  discipline).
- One smoke-caught API-shape bug (CamShift RotatedRect) — fixed pre-fastloop.
