# SPR-W4-B — Commands (every class, verbatim)

Session: 2026-09-25, branch `spr/w4b/corpus-renders`, base `eb3b404`
(full sha `eb3b404d810c73e7b4d0e8a3e1243740508499cd`; the dispatch packet's
40-char suffix `…6b92a` does not resolve — prefix `eb3b404` resolves
unambiguously to the wave-4 dispatch base "Merge spr/w3c/b4-final").

## 1. Bootstrap (dispatch rail)

```
git clone https://github.com/payswapdotorg/sporta.git sporta-w4b
cd sporta-w4b
git checkout eb3b404            # prefix-resolved; see note above
git checkout -b spr/w4b/corpus-renders
python3 -m venv .venv && . .venv/bin/activate
.venv/bin/pip install opencv-python-headless numpy
ffmpeg -version | head -1       # ffmpeg version 7.1.5-0+deb13u1
sha256sum scripts/evidence/spr-corpus-bytes/*   # all match the README table
sha256sum scripts/evidence/spr-wave3-b4-final/bytes/clip-b4-crowd-montage.mp4
                                # 6849d5fd... == corpus-b4-addendum.json
```

## 2. b12 derived gate reference (W2C derived-reference recipe)

The w3b record pins sha `d19079ca133cbfe02dde534bd74c579818cb9b92e6272a4f7af9f77e1737115b`
for `b12-first300-gateref.mp4` but records no verbatim recipe; w3b's substrate
verification shows it gated against the pre-w3a-fix b12 bytes. Those bytes were
recovered exactly from git history and the W2C recipe (the b8-first300 class,
byte-reproduced this session: `9efa9b99…` ✓) applied:

```
git show 805a5fc:scripts/evidence/spr-corpus-bytes/b8-b12.mp4 > /tmp/w4b/gates/b12-old-substrate.mp4
    # sha256 7cb3d728cc349720043c74e32258de55f0ea87b9314515d8e5d4020853143421 (== w3b README)
ffmpeg -y -loglevel error -i /tmp/w4b/gates/b12-old-substrate.mp4 \
    -frames:v 300 -t 12 -c:v libx264 -crf 20 -preset medium -threads 1 \
    -pix_fmt yuv420p -g 50 -fflags +bitexact -flags:v +bitexact \
    -map_metadata -1 -c:a copy /tmp/w4b/gates/b12-first300-gateref-from-old.mp4
    # sha256 d19079ca133cbfe02dde534bd74c579818cb9b92e6272a4f7af9f77e1737115b  (== w3b pin, BYTE-MATCH)
```

Video packets of old and current b12 are identical (w3a substrate-fix proof:
raw h264 dump sha `32a54c63…` on both); only the audio stream differs (apad fix).

## 3. Engine control (before the matrix)

```
.venv/bin/python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/clip-b7-night.mp4 \
    --reality motion-trails --out-dir /tmp/w4b/control/b7 --suffix b7
    # sha256 998c9b4948e092d89210847786b0a82dbdceec71ffe20c3f83ded1805430bdb9
    # == w3a control == w2b record  (BYTE-MATCH)
```

## 4. Matrix renders (54 cells × 2 passes, foreground chunks)

Per-cell command class (the exact form for every one of the 108 runs; only the
clip path, reality, profile, out-dir and optional --max-frames vary):

```
.venv/bin/python3 scripts/source-preserving/render.py \
    --clip <clip-path> --reality <reality> \
    [--profile noir|vhs] \
    --out-dir /tmp/w4b/out/<clip>/<lane> --suffix <clip>          # pass 1
    # pass 2 identical with --out-dir /tmp/w4b/out2/<clip>/<lane>
    # b12 only: --max-frames 300
```

Concrete examples (one per lane shape):

```
.venv/bin/python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/clip-b1-wide-broadcast.mp4 --reality cartoon-cel --out-dir /tmp/w4b/out/b1/cartoon-cel --suffix b1
.venv/bin/python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/clip-b1-wide-broadcast.mp4 --reality noir-retro --profile noir --out-dir /tmp/w4b/out/b1/noir-retro-noir --suffix b1
.venv/bin/python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/clip-b1-wide-broadcast.mp4 --reality noir-retro --profile vhs --out-dir /tmp/w4b/out/b1/noir-retro-vhs --suffix b1
.venv/bin/python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8-b12.mp4 --reality subject-toon --out-dir /tmp/w4b/out/b12/subject-toon --suffix b12 --max-frames 300
```

Driver: the runs were executed by a resumable manifest-driven driver
(`w4b_matrix_driver.py`, foreground subprocess per render, per-cell atomic
ledger appends; chunked per clip/lane groups). Every render above is a
foreground subprocess of that driver — no background/nohup renders anywhere.
The driver re-computes both passes' sha256 from disk independently and
cross-checks them against the adapter's self-reported sha.

## 5. Gates (per cell, on pass1)

```
.venv/bin/python3 scripts/source-preserving/qa_check.py \
    --input <gate-input> --output /tmp/w4b/out/<clip>/<lane>/<reality>[-<profile>]-<clip>.mp4 \
    --json scripts/evidence/spr-w4b-corpus-renders/qa/<clip>-<lane>.json

.venv/bin/python3 scripts/source-preserving/cuts_deep.py \
    --input <gate-input> --output /tmp/w4b/out/<clip>/<lane>/<reality>[-<profile>]-<clip>.mp4 \
    --json scripts/evidence/spr-w4b-corpus-renders/qa/<clip>-<lane>-cuts-deep.json
```

`<gate-input>` = the raw substrate clip for 48 cells; for the 6 b12 cells it is
`/tmp/w4b/gates/b12-first300-gateref-from-old.mp4` (the pre-adjudicated
338-vs-300 metadata class).

b12 raw-substrate crash evidence (the F1 class, reproduced once, kept):

```
.venv/bin/python3 scripts/source-preserving/qa_check.py \
    --input scripts/evidence/spr-corpus-bytes/b8-b12.mp4 \
    --output /tmp/w4b/out/b12/cartoon-cel/cartoon-cel-b12.mp4 \
    --json scripts/evidence/spr-w4b-corpus-renders/qa/b12-cartoon-cel-raw-crash.json
    # exit 1: ValueError (np.corrcoef 301 vs 300) before JSON write
    # log: qa/b12-cartoon-cel-raw-crash.log
```

## 6. Frame evidence (t=2 / t=8, per cell, from pass1)

```
ffmpeg -y -loglevel error -ss 2 -i /tmp/w4b/out/<clip>/<lane>/<render>.mp4 -frames:v 1 \
    scripts/evidence/spr-w4b-corpus-renders/frames/<clip>-<lane>-t2.png
ffmpeg -y -loglevel error -ss 8 -i /tmp/w4b/out/<clip>/<lane>/<render>.mp4 -frames:v 1 \
    scripts/evidence/spr-w4b-corpus-renders/frames/<clip>-<lane>-t8.png
```

## 7. Record assembly

`renders-w4b.json` assembled from the per-cell ledger in the w3a record schema
(`schemaVersion 1.0`; top block: taskId/task/generatedAtIso/engine/base/branch/
tools/control/substrate/realities/clips/summary/knownFindings + 54 renders[]),
then the README tables generated from the record. Both assembly scripts ran
read-only over the ledger; no gate values were transcribed by hand anywhere.
