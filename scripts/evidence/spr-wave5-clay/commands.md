# SPR-W5-F — exact commands (run from the repo root at `3c31b7c` + this branch's renderers.py edit)

All renders/gates ran foreground, sequential (the sandbox kills background
processes — re-verified this session; one transient SIGKILL of a pipelined
command hit mid-session and is the recorded w4b/w5g sandbox-starvation
class, artifacts unaffected). Python = system `python3` (3.12.14, opencv
4.13.0, numpy 2.1.3 — identical to the frozen engine toolset record);
ffmpeg 7.1.5-0+deb13u1 system binary. Out-dirs live OUTSIDE the repo tree
(`/tmp/w5f/…`); pass 2 always uses an independent out-dir (G-T5
double-render discipline). The machine-local scorecard root is a symlink
`/home/z/spr-evidence -> /tmp/w5f/spr-evidence` (the frozen harness's
hardcoded expected path). Iteration drivers live outside the repo at
`/home/z/my-project/scripts/w5f_*.py` (fastloop / fullrender — the w5g
convention; the fullrender driver was superseded by direct foreground CLI
calls after the background reaper was re-confirmed). Committed copies in
this dir are byte-identical (sha-compared).

## 0. Setup + substrate verification

```bash
git clone https://github.com/payswapdotorg/sporta.git sporta   # (or reuse the working clone)
cd sporta
git checkout 3c31b7c1c12f8d8bda79d824930e3e6ab7dbdabc   # origin/main
git checkout -b spr/w5f/clay-trial
python3 --version && python3 -c "import cv2, numpy; print(cv2.__version__, numpy.__version__)"
ffmpeg -version | head -1
sha256sum scripts/evidence/spr-corpus-bytes/{b8p3,b8-b12}.mp4 scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4
# 969af7c6... / b3cc5f0e... / e65ae487...  (== corpus README, byte-exact)
python3 -c "import sys; sys.path.insert(0,'scripts/source-preserving'); from spe import stages as S; print(S.analyze('scripts/evidence/spr-corpus-bytes/b8p3.mp4')['cuts'])"
# [188, 474, 549, 861, 881, ..., 977]  (== the recorded w5g engine behavior)
mkdir -p /tmp/w5f/spr-evidence/{bytes,render,qa/vlm}
ln -sfn /tmp/w5f/spr-evidence /home/z/spr-evidence
cp scripts/evidence/spr-corpus-bytes/b8p3.mp4 /tmp/w5f/spr-evidence/bytes/b8p3.mp4
```

## 1. Pristine-tree environment anchors (BEFORE the edit — sanity gate)

```bash
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality cartoon-cel --out-dir /tmp/w5f/regress/cartoon-cel --suffix b8 --skip-provenance
#   a9e8cd5612f1486f... == w4b anchor BYTE-MATCH
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality noir-retro --profile noir --out-dir /tmp/w5f/regress/noir-retro --suffix b8 --skip-provenance
#   3eedb4238f56900f... == w4b anchor BYTE-MATCH
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality subject-toon --out-dir /tmp/w5f/regress/subject-toon --suffix b8 --skip-provenance
#   aaac76b75a24f43e... == w5a v0.2.0 anchor BYTE-MATCH
```

## 2. Additive-diff gate (after the row edit)

```bash
git diff 3c31b7c --numstat -- scripts/source-preserving/spe/renderers.py
#   additions only (dispatch elif + _ClayToyState + CLAY_TOY spec/registration)
git diff 3c31b7c --stat -- scripts/source-preserving/render.py \
    scripts/source-preserving/spe/{stages,encode,provenance,registry,__init__}.py \
    scripts/source-preserving/{qa_check,cuts_deep,vlm_scorecard}.py \
    scripts/source-preserving/spe/trials/     # EMPTY — frozen files byte-identical
python3 scripts/source-preserving/render.py --help \
  > scripts/evidence/spr-wave5-clay/registry-listing.txt
# --reality {...,clay-toy,...}
# 3-frame smoke + double smoke (determinism): d9a824d9... == d9a824d9...
```

## 3. Fast-loop gate references

```bash
mkdir -p /tmp/w5f/gates
ffmpeg -y -loglevel error -i scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    -frames:v 300 -t 12 -c:v libx264 -crf 20 -preset medium -threads 1 \
    -pix_fmt yuv420p -g 50 -fflags +bitexact -flags:v +bitexact \
    -map_metadata -1 -c:a copy /tmp/w5f/gates/b8-first300-gateref.mp4
sha256sum /tmp/w5f/gates/b8-first300-gateref.mp4
# 9efa9b99aa74c0e3...  (== w4b record)
git show 805a5fc:scripts/evidence/spr-corpus-bytes/b8-b12.mp4 > /tmp/w5f/gates/b12-old-substrate.mp4
sha256sum /tmp/w5f/gates/b12-old-substrate.mp4
# 7cb3d728cc3497200...  (== w4b record)
ffmpeg -nostdin -y -loglevel error -i /tmp/w5f/gates/b12-old-substrate.mp4 \
    -frames:v 300 -t 12 -c:v libx264 -crf 20 -preset medium -threads 1 \
    -pix_fmt yuv420p -g 50 -fflags +bitexact -flags:v +bitexact \
    -map_metadata -1 -c:a copy /tmp/w5f/gates/b12-first300-gateref-from-old.mp4
sha256sum /tmp/w5f/gates/b12-first300-gateref-from-old.mp4
# d19079ca133cbfe0...  (== w3b pin)
```

## 4. Fast loop (7 variants; the w5e/w5g convention — patch config in
place, frozen adapter render(), frozen gate CLIs vs the gateref)

```bash
python3 /home/z/my-project/scripts/w5f_fastloop.py            # v1..v7
#   v1 recipe        T3 0.9647  T4 0.4813%  T2b 1.0/0  ALL GREEN
#   v2 relief-off    T3 0.9687  T4 0.4928%  T2b 1.0/0  ALL GREEN (VLM WORST)
#   v3 relief-55     T3 0.9625  T4 0.4784%  T2b 1.0/0  ALL GREEN
#   v4 relief-20     T3 0.9664  T4 0.4862%  T2b 1.0/0  ALL GREEN
#   v5 tilt-off      T3 0.9636  T4 0.5405%  T2b 1.0/0  ALL GREEN
#   v6 spec-075      sha IDENTICAL to v1 (fe39b48e...) — specular INERT on b8
#   v7 vign-50       T3 0.9654  T4 0.4615%  T2b 1.0/0  ALL GREEN
# VLM duel (full-res strip, original + 6 variants at t=2/t=8):
#   ffmpeg frame grabs + cv2 hstack/vstack -> fastloop-visual/duel-strip.png
z-ai vision -p "<duel prompt — see fastloop-visual/vlm-duel.json>" \
    -i /tmp/w5f/duel/duel-strip.png -o /tmp/w5f/duel/vlm-duel.json
#   BEST=A (v1-recipe)  WORST=B (v2-relief-off)  -> v1 FROZEN
```

## 5. Full renders (final frozen config; each cell double-rendered)

```bash
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality clay-toy --out-dir /tmp/w5f/out/b8/pass1 --suffix b8 --frames 2,8,15,30,45
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality clay-toy --out-dir /tmp/w5f/out/b8/pass2 --suffix b8
#   -> 1190 frames, sha256 69d9ae777cb894771155c9f0a9517698153e716a18dc20b6329334b23e23b951 x2 BYTE-IDENTICAL
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8-b12.mp4 \
    --reality clay-toy --out-dir /tmp/w5f/out/b12/pass1 --suffix b12 --max-frames 300 --frames 2,8
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8-b12.mp4 \
    --reality clay-toy --out-dir /tmp/w5f/out/b12/pass2 --suffix b12 --max-frames 300
#   -> 300 frames, 465da5a1462b8023... x2 BYTE-IDENTICAL
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4 \
    --reality clay-toy --out-dir /tmp/w5f/out/b2/pass1 --suffix b2 --frames 2,8
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4 \
    --reality clay-toy --out-dir /tmp/w5f/out/b2/pass2 --suffix b2
#   -> 225 frames, a34c7edfacb42031... x2 BYTE-IDENTICAL
```

## 6. Gates (per cell, on pass 1)

```bash
# b8 + b2 vs the RAW substrate; b12 vs the pre-adjudicated gateref
python3 scripts/source-preserving/qa_check.py \
    --input scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --output /tmp/w5f/out/b8/pass1/clay-toy-b8.mp4 \
    --json scripts/evidence/spr-wave5-clay/qa/qa-clay-toy-b8.json
python3 scripts/source-preserving/cuts_deep.py \
    --input scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --output /tmp/w5f/out/b8/pass1/clay-toy-b8.mp4 \
    --json scripts/evidence/spr-wave5-clay/qa/cuts-deep-clay-toy-b8.json
#   (same pairs for b2 with clip-b2-closeup.mp4;
#    b12 with --input /tmp/w5f/gates/b12-first300-gateref-from-old.mp4)
```

Gate outcomes: see README §4 / record.json — b8 raw-T2 miss
(stylization-softened 5/6) + b12 extra@72 (sustained-motion amplification)
honestly recorded and resolved by the frozen T2b rule (cov 1.0, 0 invented
both cells); b2 RAW T2 PASS. T3 0.9766/0.9691/0.9929; T4
0.4424/0.4490/0.7843. ALL HARD GATES GREEN 3/3.

## 7. Frame evidence (the frozen adapter's --frames; PNGs committed)

```bash
# extracted by the --frames flags in section 5 into each out-dir frames/;
# committed copies: frames/clay-toy-{b8,b12,b2}-t*s.png
```

## 8. Scorecard (frozen vlm_scorecard.py, machine-local evidence root)

```bash
cp /tmp/w5f/out/b8/pass1/clay-toy-b8.mp4 /tmp/w5f/spr-evidence/render/clay-toy-b8.mp4
cp /tmp/w5f/out/b8/qa.json /tmp/w5f/spr-evidence/qa/metrics-clay-toy.json
cp /tmp/w5f/out/b8/cuts-deep.json /tmp/w5f/spr-evidence/qa/cuts-deep-clay-toy.json
#   + /tmp/w5f/spr-evidence/render/renders.json (the lane record:
#     clay-toy entry with files.b8.determinismDoubleRender.byteIdentical=true)
python3 scripts/source-preserving/vlm_scorecard.py --realities clay-toy
#   -> 15/15 calls ok=True, tierClaim=0, critical=48
#   outputs: /home/z/spr-evidence/qa/scorecard-clay-toy.json
#            /home/z/spr-evidence/qa/vlm/clay-toy-*.json (15 raw calls)
#            /home/z/spr-evidence/qa/vlm-scorecard.json (aggregate)
# committed copies in scorecards/ verified byte-identical (sha compared)
```

## 9. Regression (frozen render.py, AFTER the full registration edit)

```bash
python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 --reality cartoon-cel \
    --out-dir /tmp/w5f/regress-mod/cartoon-cel --suffix b8 --skip-provenance
#   -> a9e8cd5612f1486f...  == w4b anchor (BYTE-MATCH on the modified tree)
python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 --reality noir-retro \
    --profile noir --out-dir /tmp/w5f/regress-mod/noir-retro --suffix b8 --skip-provenance
#   -> 3eedb4238f56900f...  == w4b anchor
python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 --reality subject-toon \
    --out-dir /tmp/w5f/regress-mod/subject-toon --suffix b8 --skip-provenance
#   -> aaac76b75a24f43e...  == w5a v0.2.0 anchor
```

## 10. Delivery

```bash
git add scripts/source-preserving/spe/renderers.py scripts/evidence/spr-wave5-clay/ docs/
git commit -m "spr: w5f clay-toy trial (TL rebuild) — SPR105 deterministic renderer + frozen-protocol scorecard"
git push origin spr/w5f/clay-trial          # PAT now live — PUSHED
git checkout main && git merge --no-ff spr/w5f/clay-trial
git push origin main                        # PUSHED (the queue is unblocked)
```

## 11. Sandbox incidents (recorded honestly)

- Background-process reaper re-verified: detached processes do NOT reliably
  survive command boundaries (one orphaned probe survived, a cleanly
  launched one did not — killed mid-render); all protocol work ran
  foreground (b8 full render ≈ 4 min at 225 ms/frame — fits the tool
  budget).
- One transient SIGKILL of a pipelined command (the recorded w4b/w5g
  evening-peak sandbox-starvation class) — all artifacts completed before
  the kill; outputs sha-verified afterward.
- One smoke-caught broadcasting bug (specular mask shape) — fixed BEFORE
  the fast loop, recorded in record.json `fastLoop.preFreezeCorrections`.
