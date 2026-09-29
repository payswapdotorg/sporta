# SPR-W5-H4 — exact commands (run from the repo root at `adf265b` + this
# branch's additive files; environment: py 3.12.14 / cv2 4.13.0 / np 2.1.3 /
# ffmpeg 7.1.5, z-ai CLI with glm-5v-turbo)

## 0. Setup (fresh sandbox recovery — the w5h3 out-dirs were wiped)

```bash
git -C /home/z/sporta checkout spr/w5h4/tier1-protocol      # off main adf265b
sha256sum scripts/evidence/spr-corpus-bytes/b8p3.mp4
#   969af7c6fdb172091ff00705b25fa37b7073f4332d722416b9754a4a7579917a (== corpus record)
mkdir -p /tmp/w5h4/spr-evidence/{bytes,render,qa/vlm}
ln -sfn /tmp/w5h4/spr-evidence /home/z/spr-evidence
cp scripts/evidence/spr-corpus-bytes/b8p3.mp4 /tmp/w5h4/spr-evidence/bytes/
```

## 1. The source-side characterization (the design evidence — substrate only)

```bash
python3 /home/z/w5h4-work/probe_source_diffs.py
#   -> /tmp/w5h4/source-diff-probe.json (committed in this pack)
#   cut amplitudes == the frozen cuts-deep record EXACTLY
#   (189: 32.05 / 475: 24.03 / 550: 20.09 / 862: 33.89 / 979: 34.73 / 982: 49.34);
#   c979pre source pair absdiff 60.07 == the w5h2 root-cause measurement;
#   c189pre pre-cut window: consec diffs 5.7-7.6 sustained over 13 frames (~2.1x median 3.14)
```

## 2. The adjudication logic (pure) + its test

```bash
python3 scripts/source-preserving/cut_boundary.py \
    --json /tmp/w5h4/boundary-classification.json
#   boundary samples = [c189pre, c475pre, c550pre, c862pre, c979pre];
#   rule constants = the frozen scorecard's own (CUT_OFFSET 3 + TEMPORAL_DELTA 5 = W_PRE 8, CLUSTER_GAP 5)
python3 scripts/source-preserving/test_cut_boundary.py
#   ALL 32 CHECKS PASS, exit 0 (the record: test-cut-boundary.txt)
```

## 3. The committed output re-materialization (sha-verified BEFORE sampling)

```bash
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality player-focus --out-dir /tmp/w5h4/out/b8/pass1 --suffix b8 --frames 2,8,15,30,45
sha256sum /tmp/w5h4/out/b8/pass1/player-focus-b8.mp4
#   0ecfe14ec5bbcf13b7989c9395daa3aa9855306a303355b3fe7d616a9ea3e636
#   == the w5h3 committed record (pass1 == pass2 == TL audit) — BYTE-IDENTICAL
git diff adf265b -- scripts/source-preserving/spe/   # EMPTY (pipeline untouched)
```

## 4. The spr-evidence tree (the frozen tool's layout — same as w5h3 commands.md §7)

```bash
cp /tmp/w5h4/out/b8/pass1/player-focus-b8.mp4 /home/z/spr-evidence/render/
cp scripts/evidence/spr-wave5-playerfocus-priority/qa/qa-player-focus-b8.json \
   /home/z/spr-evidence/qa/metrics-player-focus.json
cp scripts/evidence/spr-wave5-playerfocus-priority/qa/cuts-deep-player-focus-b8.json \
   /home/z/spr-evidence/qa/cuts-deep-player-focus.json
# renders.json: the player-focus v0.2.0 entry, files.b8.determinismDoubleRender.byteIdentical=true
#   (built from the frozen w5h3 measured record — see render-rematerialization.json)
```

## 5. The amended scorecard re-run (15 fresh calls; the frozen protocol + A2)

```bash
python3 scripts/source-preserving/vlm_scorecard.py --realities player-focus --amendment-a2
# NOTE (honest incident): this sandbox's process reaper KILLS detached
# processes within ~45 s (verified: `setsid sleep 300` dies) — background
# launches of this run were killed after 3 and 1 landed calls; the protocol
# completed via the frozen tool's documented continuation path:
python3 scripts/source-preserving/vlm_scorecard.py --realities player-focus \
    --amendment-a2 --resume
#   15/15 ok=True; zero 429s; pre-adjudication line printed BEFORE any call;
#   -> tierClaim=0 critical=0 amendedCritical=0 amendedTierClaim=0
#   (minAxis 3.40 — ss 3.40 < 3.5 — the claim WITHHELD, see README §4)
# per-call verdicts: /home/z/spr-evidence/qa/vlm/player-focus-*.json
# outputs: /home/z/spr-evidence/qa/scorecard-player-focus.json (+amendmentA2 block)
#          /home/z/spr-evidence/qa/vlm-scorecard.json (+amendmentA2 block)
```

## 6. Non-degradation of the default (unamended) surface

```bash
python3 scripts/source-preserving/vlm_scorecard.py --realities player-focus --resume
#   (no flag — reuses the 15 fresh verdicts; zero new VLM calls)
# verified: raw fields byte-equal to the amended run's raw fields;
#           output field-set == the frozen w5h3 committed shape;
#           NO amendmentA2 key anywhere (scorecards/default-surface/)
```

## 7. The retrospective analysis (the frozen w5h3 record under A2)

```bash
# inline driver (recorded verbatim in w5h3-record-adjudication.json):
#   classify_samples(frozen_samples(), [189,475,550,862,979,982])
#   + parse_verdict over scripts/evidence/spr-wave5-playerfocus-priority/
#     scorecards/raw/player-focus-*.json (read-only)
#   -> raw critical 2 (both c189pre) -> boundary-class 2 -> amended 0;
#      means unchanged (minAxis 3.73)
```

## 8. Delivery

```bash
git add scripts/source-preserving/cut_boundary.py \
        scripts/source-preserving/test_cut_boundary.py \
        scripts/source-preserving/vlm_scorecard.py \
        docs/testing/source-preserving-reality-acceptance.md \
        scripts/evidence/spr-w5h4-tier1-protocol/
git commit -m "spr: w5h4 tier1 protocol — Amendment A2 ..."
git push origin spr/w5h4/tier1-protocol    # worker pushes the branch; TL reviews + merges
```
