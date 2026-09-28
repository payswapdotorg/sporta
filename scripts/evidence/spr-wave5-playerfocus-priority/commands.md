# SPR-W5-H3 — exact commands (run from the repo root at `182bdd4` + this branch's renderers.py edit)

Same environment/toolchain as w5h/w5h2 (py 3.12.14 / cv2 4.13.0 / np 2.1.3 /
ffmpeg 7.1.5; foreground-only staged commands — the batching-discipline
lesson re-verified: one 4-anchor batch exceeded the 600 s command budget and
was split per-anchor, artifacts unaffected).

## 0. Setup (fresh sandbox recovery)

```bash
git clone https://x-access-token:$GITHUB_TOKEN@github.com/payswapdotorg/sporta.git /home/z/sporta
git -C /home/z/sporta checkout -b spr/w5h3/player-priority     # from 182bdd4
sha256sum scripts/evidence/spr-corpus-bytes/{b8p3,b8-b12}.mp4 scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4
# 969af7c6... / b3cc5f0e... / e65ae487... (== corpus README — in-repo bytes survived the reset)
mkdir -p /tmp/w5h3/{gates,out,out2,ab,tlreview,duel} /tmp/w5h3/spr-evidence/{bytes,render,qa/vlm}
ln -sfn /tmp/w5h3/spr-evidence /home/z/spr-evidence
cp scripts/evidence/spr-corpus-bytes/b8p3.mp4 /tmp/w5h3/spr-evidence/bytes/
# PAT lives ONLY in env/credential store — never in packets or chat payloads
```

## 1. Diagnosis (the fresh tracker probe)

```bash
python3 /tmp/w5h3/diag/repro_tracker.py
#   v0.1.0 sprung window: w=365>320 canvas @t=8 (BALLOON) — mean area frac 1.2834
# grass-hue vertical profile: the t=8 board band = top ~45 rows (outside pitch)
```

## 2. Additive-diff + config-gating smoke

```bash
git diff 182bdd4 --numstat -- scripts/source-preserving/spe/renderers.py
#   additions + modifications confined to _PlayerFocusState + the PLAYER_FOCUS
#   spec (config-key gated: no "playerPriority" key = v0.1.0 semantics)
git diff 182bdd4 --stat -- scripts/source-preserving/spe/encode.py scripts/source-preserving/spe/stages.py scripts/source-preserving/spe/provenance.py scripts/source-preserving/registry.py
#   EMPTY (frozen engine files untouched)
# 3-frame smoke x2: 966e3934... == 966e3934... (determinism; == the w5h smoke sha)
```

## 3. Fast loop (6 variants + trajectory probe + VLM duel)

```bash
ffmpeg -y -loglevel error -i scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    -frames:v 300 -t 12 -c:v libx264 -crf 20 -preset medium -threads 1 \
    -pix_fmt yuv420p -g 50 -fflags +bitexact -flags:v +bitexact \
    -map_metadata -1 -c:a copy /tmp/w5h3/gates/b8-first300-gateref.mp4
#   9efa9b99... (== w4b record)
git show 805a5fc:scripts/evidence/spr-corpus-bytes/b8-b12.mp4 > /tmp/w5h3/gates/b12-old-substrate.mp4
ffmpeg -nostdin -y -loglevel error -i /tmp/w5h3/gates/b12-old-substrate.mp4 \
    -frames:v 300 -t 12 -c:v libx264 -crf 20 -preset medium -threads 1 \
    -pix_fmt yuv420p -g 50 -fflags +bitexact -flags:v +bitexact \
    -map_metadata -1 -c:a copy /tmp/w5h3/gates/b12-first300-gateref-from-old.mp4
#   d19079ca... (== w3b pin)
python3 /home/z/my-project/scripts/w5h3_fastloop.py     # v0..v5 + trajectory.json
#   v0 BYTE-MATCH 3fa814cf (the w5h v1-recipe anchor) — config gating proven
z-ai vision -p "<duel prompt — fastloop/vlm-duel.json>" -i /tmp/w5h3/duel/duel-strip.png
#   BEST=D (v4 wide-clamp) WORST=B (v0.1.0 balloon) -> v4 clamp FROZEN 0.75x0.65
```

## 4. Mini-A/B (the c189post critical class)

```bash
python3 /home/z/my-project/scripts/w5h3_ab.py    # frozen per-sample prompt, 4 samples x {v6,v7}
#   v6-protect: c189post FIXED (0) but t2s crit=1 (motion-light flicker) — REJECTED
#   v7-feather28: all 4 samples crit=0 — WINNER -> maskFeather 28 frozen
```

## 5. Full renders (frozen config; each cell double-rendered)

```bash
for p in 1 2; do python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality player-focus --out-dir /tmp/w5h3/out2/b8/pass$p --suffix b8 \
    $([ $p = 1 ] && echo '--frames 2,8,15,30,45'); done
#   0ecfe14e... x2 BYTE-IDENTICAL (1190f)
for p in 1 2; do python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8-b12.mp4 \
    --reality player-focus --out-dir /tmp/w5h3/out2/b12/pass$p --suffix b12 --max-frames 300; done
#   01ce4d92... x2 (300f)
for p in 1 2; do python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4 \
    --reality player-focus --out-dir /tmp/w5h3/out2/b2/pass$p --suffix b2; done
#   b9e4dc1c... x2 (225f)
```

## 6. Gates (per cell, on pass 1)

```bash
# b8 + b2 vs RAW substrate; b12 vs the pre-adjudicated gateref
python3 scripts/source-preserving/qa_check.py --input <clip> --output /tmp/w5h3/out2/<cell>/pass1/player-focus-<cell>.mp4 \
    --json scripts/evidence/spr-wave5-playerfocus-priority/qa/qa-player-focus-<cell>.json
python3 scripts/source-preserving/cuts_deep.py --input <clip> --output /tmp/w5h3/out2/<cell>/pass1/player-focus-<cell>.mp4 \
    --json scripts/evidence/spr-wave5-playerfocus-priority/qa/cuts-deep-player-focus-<cell>.json
```

Outcomes: README §5 — b8 raw-T2 0.67 softened class (T2b 1.0/0 binding, all
6 matched, 0 invented); b12 + b2 RAW PASS; T3 0.9431/0.9455/0.9524;
T4 0.3490/0.4677/0.8559.

## 7. Scorecard (frozen vlm_scorecard.py, 15/15)

```bash
cp /tmp/w5h3/out2/b8/pass1/player-focus-b8.mp4 /home/z/spr-evidence/render/
cp scripts/evidence/spr-wave5-playerfocus-priority/qa/qa-player-focus-b8.json /home/z/spr-evidence/qa/metrics-player-focus.json
cp scripts/evidence/spr-wave5-playerfocus-priority/qa/cuts-deep-player-focus-b8.json /home/z/spr-evidence/qa/cuts-deep-player-focus.json
# + renders.json (player-focus entry v0.2.0, files.b8.determinismDoubleRender.byteIdentical=true)
python3 scripts/source-preserving/vlm_scorecard.py --realities player-focus
#   -> 15/15, minAxis 3.73, critical 2 -> honest tierClaim=0 (near-miss)
```

## 8. TL visual gate (binding)

```bash
z-ai vision -p "<TL gate prompt — tlreview/tl-review.json>" -i /tmp/w5h3/tlreview/tl-grid.png
#   TL_VERDICT=PASS — both w5h2 defects fixed and verified
```

## 9. Regression (7/7, per-anchor commands)

```bash
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality <cartoon-cel|subject-toon|clay-toy|rotoscope|watercolor> \
    --out-dir /tmp/w5h3/regress/<r> --skip-provenance
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality noir-retro --profile noir --out-dir /tmp/w5h3/regress/noir --skip-provenance
# v0.1.0 key-set render via the config-override harness (feather 21, no playerPriority)
#   -> 3f0be6d2... BYTE-MATCH
# ALL 7/7 BYTE-MATCH (a9e8cd56 / aaac76b7 / 69d9ae77 / 32c8666c / 2b0b7404 / 3eedb423 / 3f0be6d2)
```

## 10. Delivery

```bash
git add scripts/source-preserving/spe/renderers.py scripts/evidence/spr-wave5-playerfocus-priority/ docs/
git commit -m "spr: w5h3 player-priority — SPR205 v0.2.0 (the w5h2 named increment; TL gate PASS)"
git push origin spr/w5h3/player-priority
git checkout main && git merge --no-ff spr/w5h3/player-priority && git push origin main
```

## 11. Sandbox incidents (recorded honestly)

- One command-boundary timeout on a 4-anchor regression batch (420 s budget)
  — split per-anchor (the w5h/w5f batching-discipline class, artifacts
  unaffected; the completed cartoon-cel/subject-toon renders from the killed
  batch were re-rendered fresh for the record).
- One symlink-nesting incident (`mkdir` before `ln -sfn` put the link inside
  the real dir) — caught by the scorecard's file-not-found, fixed before any
  measurement.
- One shell-quoting failure of the multi-line frozen prompt (heredoc-in-
  command) — moved to the python driver `w5h3_ab.py`; no VLM call was made
  with a malformed prompt.
