# SPR-W4-B — Corpus-Wide Render Ledger on the FIXED Substrate

Task: 9 clips × 6 render lanes = 54 cells, 108 render runs. Every cell
double-rendered into independent out-dirs (`/tmp/w4b/out` vs `/tmp/w4b/out2`)
through the FROZEN `render.py` adapter; sha256 byte-identity recorded per cell.
Full gate suite per cell on pass1 (`qa_check.py` + `cuts_deep.py`, pre-adjudicated
classes cited); t=2/t=8 PNG evidence per cell. Branch `spr/w4b/corpus-renders`,
base `eb3b404` (wave-4 dispatch base). Engine SPE-v1 FROZEN — no engine, gate,
renderer, or substrate file was modified anywhere in this work.

## 1. Substrate verification (run first)

All 9 clips sha-256-verified against the repo records before any render:

```
3a3c249ef351aaffca5c23fde0aa7efceb920c3d40a0b0a1b317e24fc7c01307  b1
e65ae48740472f57ada031fdfb076cbb40a845239693acad83e8142c0caec062  b2
f88e3bd5f88f047bf1ef1d5515dc7d7ee19a680c2bc2050d51385f7589e00aeb  b3
6849d5fde6db13870c9ff18a732b9bc950d86e3c89af1ff82f35d66b3f36248f (spr-wave3-b4-final/bytes)  b4
349a37eeb7fc1374ed8179804fe7ad4888f66a3d9748246e80fdfba30318593a  b5
9ef4be96be39276673540f9ec2685c16b37ce9ed23247e7101bad8548c77f68a  b6
0700b8d9185b2328714d8afedf2a5e07e78cd377353253b8997b180514223657  b7
969af7c6fdb172091ff00705b25fa37b7073f4332d722416b9754a4a7579917a (b8p3.mp4)  b8
b3cc5f0e2fae840f2aef93d859ce814babca226ee0b5d27e6da4e969b4312462 (b8-b12.mp4, post-w3a-fix)  b12
```

b12 renders read the post-w3a-fix substrate with `--max-frames 300` (wave-1
baseline convention) and gate against the derived 300-frame reference
`b12-first300-gateref.mp4` (sha `d19079ca133cbfe02dde534bd74c579818cb9b92e6272a4f7af9f77e1737115b`,
W2C derived-reference precedent). The gateref was re-derived this session from
git-history bytes (`805a5fc:b8-b12.mp4`, the exact bytes w3b gated against) and
reproduced byte-identically — derivation command in `commands.md`.

## 2. Controls (engine + chain integrity)

| control | result |
|---|---|
| b7 × motion-trails re-render | `998c9b49…` == w3a control == w2b record — **byte-identical** |
| b12-first300 gateref re-derivation | `d19079ca…` == w3b-pinned sha — **byte-identical** |
| b8 × subject-toon | `503ea271…` == w3b promotion render — **byte-identical** |
| b8 × cartoon-cel | `a9e8cd56…` == w3b regression render == wave-1 record — **byte-identical** |

b12 × subject-toon differs in bytes from the w3b record (`3c0fdf81…` vs `edafe79f…`):
w3b read the pre-w3a-fix b12 (audio 12.007 s); this matrix reads the post-fix
substrate (audio 12.06 s apad). Video processing is identical — G-T3 r=0.9976 in
both records; the delta is the passthrough audio stream only. Recorded honestly,
not a determinism break.

## 3. Determinism (the core proof)

**54/54** cells byte-identical across independent
double renders (23496 frames piped in total across the
matrix). Every per-cell pair of sha256s is in `renders-w4b.json` (`outputSha256Pass1` /
`outputSha256Pass2`); both passes' shas also equal the adapter's self-reported sha.

## 4. Gate master table (54 cells)

qa gates vs the raw substrate (vs the derived gateref on b12 — the pre-adjudicated
338-vs-300 metadata class; raw-substrate run crashes F1-class, crash evidence kept
at `qa/b12-cartoon-cel-raw-crash.log`).

### b1

| lane | gates | det | classes |
|---|---|---|---|
| cartoon-cel | T1 PASS 751==751, Δ20 ms; T2 FAIL cov 0.667, extra/30s 0.0; T3 PASS r=0.9762; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | b1-G-T2-0.667-boundary-class |
| anime-npr | T1 PASS 751==751, Δ20 ms; T2 FAIL cov 0.667, extra/30s 0.0; T3 PASS r=0.969; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | b1-G-T2-0.667-boundary-class |
| noir-retro-noir | T1 PASS 751==751, Δ20 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 PASS r=0.999; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | — |
| noir-retro-vhs | T1 PASS 751==751, Δ20 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 PASS r=0.8989; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | vhs-G-T3-raw-as-is |
| motion-trails | T1 PASS 751==751, Δ20 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 PASS r=0.9583; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | — |
| subject-toon | T1 PASS 751==751, Δ20 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 PASS r=0.9913; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | — |

### b2

| lane | gates | det | classes |
|---|---|---|---|
| cartoon-cel | T1 PASS 225==225, Δ20 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 PASS r=0.9919; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | — |
| anime-npr | T1 PASS 225==225, Δ20 ms; T2 FAIL cov 1.0, extra/30s 3.326; T3 PASS r=0.987; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | b2-T2-extra-cut-split |
| noir-retro-noir | T1 PASS 225==225, Δ20 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 PASS r=0.9974; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | — |
| noir-retro-vhs | T1 PASS 225==225, Δ20 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 PASS r=0.9862; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | vhs-G-T3-raw-as-is |
| motion-trails | T1 PASS 225==225, Δ20 ms; T2 FAIL cov 1.0, extra/30s 3.326; T3 PASS r=0.9232; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | b2-T2-extra-cut-split |
| subject-toon | T1 PASS 225==225, Δ20 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 PASS r=0.9963; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | — |

### b3

| lane | gates | det | classes |
|---|---|---|---|
| cartoon-cel | T1 PASS 300==300, Δ20 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 PASS r=0.9794; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | — |
| anime-npr | T1 PASS 300==300, Δ20 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 PASS r=0.9807; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | — |
| noir-retro-noir | T1 PASS 300==300, Δ20 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 PASS r=0.9987; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | — |
| noir-retro-vhs | T1 PASS 300==300, Δ20 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 PASS r=0.9343; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | vhs-G-T3-raw-as-is |
| motion-trails | T1 PASS 300==300, Δ20 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 PASS r=0.9474; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | — |
| subject-toon | T1 PASS 300==300, Δ20 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 PASS r=0.987; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | — |

### b4

| lane | gates | det | classes |
|---|---|---|---|
| cartoon-cel | T1 PASS 300==300, Δ23 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 PASS r=0.9936; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | — |
| anime-npr | T1 PASS 300==300, Δ23 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 PASS r=0.9923; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | — |
| noir-retro-noir | T1 PASS 300==300, Δ23 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 PASS r=0.9988; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | — |
| noir-retro-vhs | T1 PASS 300==300, Δ23 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 FAIL r=0.7185; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | vhs-G-T3-raw-as-is |
| motion-trails | T1 PASS 300==300, Δ23 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 PASS r=0.9704; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | — |
| subject-toon | T1 PASS 300==300, Δ23 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 PASS r=0.9972; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | — |

### b5

| lane | gates | det | classes |
|---|---|---|---|
| cartoon-cel | T1 PASS 300==300, Δ20 ms; T2 FAIL cov 0.0, extra/30s 0.0; T3 PASS r=0.9842; T4 PASS; T2b PASS cov 0.0, invented 0 | ✓ | T2-vacuous-zero-cut-coverage |
| anime-npr | T1 PASS 300==300, Δ20 ms; T2 FAIL cov 0.0, extra/30s 0.0; T3 PASS r=0.9832; T4 PASS; T2b PASS cov 0.0, invented 0 | ✓ | T2-vacuous-zero-cut-coverage |
| noir-retro-noir | T1 PASS 300==300, Δ20 ms; T2 FAIL cov 0.0, extra/30s 0.0; T3 PASS r=0.9985; T4 PASS; T2b PASS cov 0.0, invented 0 | ✓ | T2-vacuous-zero-cut-coverage |
| noir-retro-vhs | T1 PASS 300==300, Δ20 ms; T2 FAIL cov 0.0, extra/30s 0.0; T3 FAIL r=0.7303; T4 PASS; T2b PASS cov 0.0, invented 0 | ✓ | vhs-G-T3-raw-as-is, T2-vacuous-zero-cut-coverage |
| motion-trails | T1 PASS 300==300, Δ20 ms; T2 FAIL cov 0.0, extra/30s 0.0; T3 PASS r=0.9985; T4 PASS; T2b PASS cov 0.0, invented 0 | ✓ | T2-vacuous-zero-cut-coverage |
| subject-toon | T1 PASS 300==300, Δ20 ms; T2 FAIL cov 0.0, extra/30s 0.0; T3 PASS r=0.9709; T4 PASS; T2b PASS cov 0.0, invented 0 | ✓ | T2-vacuous-zero-cut-coverage |

### b6

| lane | gates | det | classes |
|---|---|---|---|
| cartoon-cel | T1 PASS 300==300, Δ20 ms; T2 FAIL cov 0.0, extra/30s 0.0; T3 PASS r=0.9712; T4 PASS; T2b PASS cov 0.0, invented 0 | ✓ | T2-vacuous-zero-cut-coverage |
| anime-npr | T1 PASS 300==300, Δ20 ms; T2 FAIL cov 0.0, extra/30s 0.0; T3 PASS r=0.9716; T4 PASS; T2b PASS cov 0.0, invented 0 | ✓ | T2-vacuous-zero-cut-coverage |
| noir-retro-noir | T1 PASS 300==300, Δ20 ms; T2 FAIL cov 0.0, extra/30s 0.0; T3 PASS r=0.9988; T4 PASS; T2b PASS cov 0.0, invented 0 | ✓ | T2-vacuous-zero-cut-coverage |
| noir-retro-vhs | T1 PASS 300==300, Δ20 ms; T2 FAIL cov 0.0, extra/30s 0.0; T3 FAIL r=0.7978; T4 PASS; T2b PASS cov 0.0, invented 0 | ✓ | vhs-G-T3-raw-as-is, T2-vacuous-zero-cut-coverage |
| motion-trails | T1 PASS 300==300, Δ20 ms; T2 FAIL cov 0.0, extra/30s 0.0; T3 PASS r=0.9985; T4 PASS; T2b PASS cov 0.0, invented 0 | ✓ | T2-vacuous-zero-cut-coverage |
| subject-toon | T1 PASS 300==300, Δ20 ms; T2 FAIL cov 0.0, extra/30s 0.0; T3 PASS r=0.969; T4 PASS; T2b PASS cov 0.0, invented 0 | ✓ | T2-vacuous-zero-cut-coverage |

### b7

| lane | gates | det | classes |
|---|---|---|---|
| cartoon-cel | T1 PASS 250==250, Δ20 ms; T2 FAIL cov 0.0, extra/30s 0.0; T3 PASS r=0.9951; T4 PASS; T2b PASS cov 0.0, invented 0 | ✓ | T2-vacuous-zero-cut-coverage |
| anime-npr | T1 PASS 250==250, Δ20 ms; T2 FAIL cov 0.0, extra/30s 0.0; T3 PASS r=0.994; T4 PASS; T2b PASS cov 0.0, invented 0 | ✓ | T2-vacuous-zero-cut-coverage |
| noir-retro-noir | T1 PASS 250==250, Δ20 ms; T2 FAIL cov 0.0, extra/30s 0.0; T3 PASS r=0.9995; T4 PASS; T2b PASS cov 0.0, invented 0 | ✓ | T2-vacuous-zero-cut-coverage |
| noir-retro-vhs | T1 PASS 250==250, Δ20 ms; T2 FAIL cov 0.0, extra/30s 0.0; T3 PASS r=0.8749; T4 PASS; T2b PASS cov 0.0, invented 0 | ✓ | vhs-G-T3-raw-as-is, T2-vacuous-zero-cut-coverage |
| motion-trails | T1 PASS 250==250, Δ20 ms; T2 FAIL cov 0.0, extra/30s 0.0; T3 PASS r=0.9937; T4 PASS; T2b PASS cov 0.0, invented 0 | ✓ | T2-vacuous-zero-cut-coverage |
| subject-toon | T1 PASS 250==250, Δ20 ms; T2 FAIL cov 0.0, extra/30s 0.0; T3 PASS r=0.9989; T4 PASS; T2b PASS cov 0.0, invented 0 | ✓ | T2-vacuous-zero-cut-coverage |

### b8

| lane | gates | det | classes |
|---|---|---|---|
| cartoon-cel | T1 PASS 1190==1190, Δ20 ms; T2 FAIL cov 0.833, extra/30s 0.63; T3 PASS r=0.9767; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | — |
| anime-npr | T1 PASS 1190==1190, Δ20 ms; T2 PASS cov 1.0, extra/30s 0.63; T3 PASS r=0.9815; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | — |
| noir-retro-noir | T1 PASS 1190==1190, Δ20 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 PASS r=0.9934; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | — |
| noir-retro-vhs | T1 PASS 1190==1190, Δ20 ms; T2 FAIL cov 0.833, extra/30s 0.0; T3 PASS r=0.9553; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | vhs-G-T3-raw-as-is |
| motion-trails | T1 PASS 1190==1190, Δ20 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 PASS r=0.8969; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | — |
| subject-toon | T1 PASS 1190==1190, Δ20 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 PASS r=0.9959; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | — |

### b12

| lane | gates | det | classes |
|---|---|---|---|
| cartoon-cel | T1 PASS 300==300, Δ0 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 PASS r=0.984; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | b12-T1-338-vs-300-metadata-class |
| anime-npr | T1 PASS 300==300, Δ0 ms; T2 FAIL cov 1.0, extra/30s 2.5; T3 PASS r=0.9772; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | b12-T1-338-vs-300-metadata-class |
| noir-retro-noir | T1 PASS 300==300, Δ0 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 PASS r=0.99; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | b12-T1-338-vs-300-metadata-class |
| noir-retro-vhs | T1 PASS 300==300, Δ0 ms; T2 FAIL cov 0.5, extra/30s 0.0; T3 PASS r=0.9825; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | b12-T1-338-vs-300-metadata-class, vhs-G-T3-raw-as-is |
| motion-trails | T1 PASS 300==300, Δ0 ms; T2 FAIL cov 0.5, extra/30s 0.0; T3 PASS r=0.864; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | b12-T1-338-vs-300-metadata-class |
| subject-toon | T1 PASS 300==300, Δ0 ms; T2 PASS cov 1.0, extra/30s 0.0; T3 PASS r=0.9976; T4 PASS; T2b PASS cov 1.0, invented 0 | ✓ | b12-T1-338-vs-300-metadata-class |

## 5. Summary

```json
{
 "cellsTotal": 54,
 "renderRuns": 108,
 "determinismByteIdentical": "54/54",
 "qaAllPass": "26/54",
 "gatePassCounts": {
  "G-T1": 54,
  "G-T2": 27,
  "G-T3": 51,
  "G-T4": 54
 },
 "qaCrashed": 0,
 "cutsDeepPass": "54/54",
 "cutsDeepInventedCutsTotal": 0,
 "framesPipedTotal": 23496
}
```

## 6. Known findings (classes; full text in renders-w4b.json knownFindings)

- **b12-T1-338-vs-300-metadata-class** (pre-adjudicated) — scope: b12 x all 6 lanes
- **b1-G-T2-0.667-boundary-class** (pre-adjudicated) — scope: b1 x cartoon-cel, b1 x anime-npr
- **vhs-G-T3-raw-as-is** (pre-adjudicated) — scope: noir-retro/vhs lane
- **T2-vacuous-zero-cut-coverage** (pre-adjudicated) — scope: b5, b6, b7 x all 6 lanes (18 cells)
- **b2-T2-extra-cut-split** (pre-adjudicated) — scope: b2 x anime-npr, b2 x motion-trails
- **b12-tight-cut-pair-T2-classes** (NEW (honest first-run observation)) — scope: b12 x noir-retro-vhs (cov 0.5), b12 x motion-trails (cov 0.5), b12 x anime-npr (extra 2.5)
- **b8-T2-boundary-classes** (NEW (honest first-run observation)) — scope: b8 x cartoon-cel (cov 0.833, extra 0.63), b8 x noir-retro-vhs (cov 0.833)
- **b12-subject-toon-audio-byte-delta** (NEW (honest first-run observation)) — scope: b12 x subject-toon
- **b4-first-render-classes** (NEW (honest first-run observation)) — scope: b4 (crowd-montage) x all 6 lanes — first-ever renders

Every T2/T3 fail above maps to one of these named classes; `cuts_deep` passes
54/54 with 0 invented cuts anywhere in the matrix.

## 7. Evidence index

- `renders-w4b.json` — the consolidated record (w3a schema), 54 per-render records
- `qa/<clip>-<lane>.json` — qa_check G-T1..G-T4 raw output (54)
- `qa/<clip>-<lane>-cuts-deep.json` — cuts_deep raw output (54)
- `qa/b12-cartoon-cel-raw-crash.log` — b12 raw-substrate crash evidence (F1 class)
- `frames/<clip>-<lane>-t2.png`, `-t8.png` — per-cell frame evidence (108)
- `commands.md` — every command class used, verbatim
- Rendered mp4s live in the session out-dirs only (per prior-wave convention);
  the sha256 pairs in the record are the determinism proof.
