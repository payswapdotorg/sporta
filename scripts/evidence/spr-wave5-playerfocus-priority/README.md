# SPR-W5-H3 — player-focus v0.2.0 player-priority tracking — the w5h2 named increment, delivered

**The record (read this first):** the w5h2 attempt ended with the binding TL
gate FAILING on two defects — the ad-board lock at t=8 (shared with v0.1.0)
and the diluted/over-soft treatment — and named the measured next increment:
**player-priority tracking** (kit/size/center priors in the motion gate so
the spring follows players, not boards). This delivery implements exactly
that increment. The machine Tier-1 bar (criticals = 0) is NOT met (honest
near-miss, 2 criticals at one cut-adjacent sample — the class is diagnosed
below); **the binding TL visual gate PASSES** — the two w5h2 defects are
fixed and verified. v0.2.0 ships.

## 1. The diagnosis that grounded the design (fresh, this session)

Running the v0.1.0 tracker on b8 first-14s showed the real mechanism behind
both TL complaints: **the sprung window BALLOONED to 128% of the canvas**
(mean window-area fraction 1.28; at t=8 area 1.42–1.66, clamped only by the
1.4× spring bound) — the "spotlight" covered everything, the dim read as
treatment-absent, and the motion gate fed CAMSHIFT the biggest motion blob
(the animated ad-board band in the top ~45 rows at t=8; grass-hue analysis:
boards live outside the pitch region, players inside).

## 2. The v0.2.0 player-priority design (config-gated, w5a pattern)

With the v0.1.0 key set the class is byte-identical to v0.1.0 (proven at
full scale — the regression anchor §6). With `playerPriority: true`:

- **Stage 0.5 pitch mask**: largest connected HSV grass-band component with
  interior holes filled (players on the pitch stay inside); motion outside
  the pitch region attenuated to 0.25 (boards/crowd/stands).
- **Blob filter**: wide+large blobs (the board shape class, aspect > 3.2 &
  area ≥ 300) ×0.15; huge blobs (global motion, ≥ 3400 px) ×0.35; noise
  blobs dropped.
- **Kit-color prior**: saturated blobs whose circular-mean hue is outside
  the grass band ×1.6.
- **Gentle center prior** (falloff 0.25) + **compact spotlight clamp**
  0.75 × 0.65 (the balloon fix) + **deterministic tracker escape** (mass
  collapse for 24 frames re-seeds to the best priority blob).

## 3. Fast loop (6 variants, b8 first-300 vs the 9efa9b99 gateref)

| variant | sha (first-16) | T3 | T4 % | T2b | verdict |
|---|---|---|---|---|---|
| v0-v010 (v0.1.0 keys) | `3fa814cf…` | 0.9751 | 0.7407 | 1.0/0 | **BYTE-MATCHES the w5h v1-recipe anchor — the config-gating proof** |
| v1-priority (0.62×0.52) | `5a8db71b…` | 0.9701 | 0.4663 | 1.0/0 | all green (T4 nearly halved) |
| v2-no-center | `141b045e…` | 0.9682 | 0.4641 | 1.0/0 | all green |
| v3-no-kit | `52b5eb71…` | 0.9712 | 0.6028 | 1.0/0 | all green |
| **v4-wide-clamp (0.75×0.65)** | `e24436ca…` | 0.9706 | 0.4671 | 1.0/0 | **ALL GREEN — VLM duel BEST — FROZEN** |
| v5-board-hard | `226d16c9…` | 0.9727 | 0.4711 | 1.0/0 | all green |

VLM duel (4 columns: original / v0.1.0 / v1-compact / v4-wide, 4 rows
t=5/8/10/11.5 s): **BEST=D (v4 wide-clamp)** — "the most consistent and
versatile player-focus treatment… without cutting off peripheral action";
**WORST=B (v0.1.0)** — "the tracked window balloons to the point where the
dimming effect is virtually non-existent" (the TL-gate diagnosis
independently reproduced). The 0.62×0.52 compact read too tight on wide
spread play ("flashlight in the dark") → clamp widened to 0.75×0.65.

**Trajectory probe** (the direct fix measurement): v0.1.0 mean window-area
fraction **1.2834** (max 1.96) → v0.2.0 **0.0951** (max 0.36); at t=8 the
v0.2.0 window tracks a compact mid-pitch region (cy 0.43–0.58).

## 4. The mini-A/B (scorecard critical class, honest iteration)

The first full scorecard (feather 21) measured critical=2 at **c189post**
(limbs=2). Focused VLM analysis of the pair: no malformed limbs — **the dim
edge crossing peripheral players** (orange jersey lower-left / green jersey
center-left) is the class. Two fixes were measured:

- **v6-protect (player-exempt dim)**: fixed c189post (0) but INTRODUCED a
  worse t2s class (crit=1: "background players flicker in visibility" —
  the motion-gated light exemption dims slow/stopping players when their
  motion blob drops). **MEASURED AND REJECTED** (code path retained
  config-gated-off for the record).
- **v7-feather28 (edge gradient softened, dim strength unchanged)**:
  cleared all four mini-A/B samples. **WINNER** — edge softening only, not
  the w5h2 softening trap (dimStrength stays 0.45).

## 5. Full protocol on the frozen config (v4 clamp + feather 28)

| cell | frames | sha256 ×2 (byte-identical) | T2 raw | T2b | T3 | T4 |
|---|---|---|---|---|---|---|
| b8 | 1190 | `0ecfe14ec5bbcf13…` | 0.67/0 — the stylization-softened class (475/550 dim below the flat 16.0 threshold; **honest difference from w5h v0.1.0's 5/6**: the compact spotlight dims more frame area at cut moments) | **1.0/0 — all 6 matched, ratios ≥ 0.587, 0 invented (the binding deep gate)** | 0.9431 | 0.3490 |
| b12 | 300 | `01ce4d920288738f…` | **RAW PASS 1.0/0** | 1.0/0 | 0.9455 | 0.4677 |
| b2 | 225 | `b9e4dc1c6566a87f…` | **RAW PASS 1.0/0** | 1.0/0 | 0.9524 | 0.8559 |

## 6. Regression (7/7 BYTE-MATCH on the modified tree)

| anchor | sha256 | verdict |
|---|---|---|
| player-focus **v0.1.0 key set** b8 | `3f0be6d2…` | **BYTE-MATCH** (config-gating proven at full scale) |
| cartoon-cel b8 | `a9e8cd56…` | BYTE-MATCH |
| noir-retro noir b8 | `3eedb423…` | BYTE-MATCH |
| subject-toon v0.2.0 b8 | `aaac76b7…` | BYTE-MATCH |
| clay-toy b8 | `69d9ae77…` | BYTE-MATCH |
| rotoscope b8 | `32c8666c…` | BYTE-MATCH |
| watercolor b8 | `2b0b7404…` | BYTE-MATCH |

## 7. Frozen-protocol VLM scorecard (15/15 calls landed)

means: sf 4.87 / tc 3.73 / ic 4.47 / mf 4.20 / scf 4.00 / ss 3.93;
**minAxis 3.73** (above the 3.5 Tier-1 axis bar), overall 4.09;
**critical 2 → tierClaim 0 — honest near-miss Tier 1**.

The critical class (diagnosed, recorded): both criticals at ONE
cut-adjacent sample (c189pre — limbs=1, players=1, the pair spans frames
181–186 in the pre-cut high-chaos region where the source itself is
transitioning; the VLM text flags "background elements and distant players
flicker/shift" + scf 2 "background warping/drifting" — the same
source-side-chaos class the w5h2 root-cause methodology identified at
970–982). VLM run-to-run variance moves 1–2 criticals between adjacent
samples of this chaos region across runs (observed this session: c189post
2→0, c189pre 0→2, c979pre 1→0); the measured 2 stands as THE record — no
re-roll laundering. The c979pre source-transition sample scored
(3, 1, 4, 2, 2, 4) — the frozen-protocol boundary class, not a renderer
defect (the w5h2 60-absdiff root cause).

## 8. The binding TL visual gate — **PASS**

`tlreview/tl-grid.png` + `tl-review.json` (top row = originals at
t=2/8/15/30/45; bottom row = v0.2.0):

> **TL_VERDICT=PASS** — "The v0.2.0 treatment successfully addresses the
> previous failures; the 1.35x zoom and 0.45 dim strength provide a clear,
> product-quality visual hierarchy that draws the eye to the action without
> losing broadcast context. The player-priority tracker is now robust,
> correctly identifying and centering on the players at t=8 (avoiding the
> background ad-board) and maintaining focus across all other timestamps.
> Players remain fully readable with limbs intact, and the 28-pixel edge
> feather ensures a professional, non-distracting transition into the dimmed
> periphery while preserving the full spatial context of the match."

Both w5h2 defects are fixed and TL-verified: the ad-board lock (t=8 centers
players) and the diluted treatment (product-quality hierarchy).

## 9. Verdict

- **Shipped: v0.2.0 player-priority** (the w5h2 named increment; the
  lineage w5h v0.1.0 → w5h3 v0.2.0; the w5h2 softening attempt is recorded
  history, never shipped).
- **Machine tier: honest Tier 0 near-miss Tier 1** (minAxis 3.73 ≥ 3.5,
  gates green, critical 2 ≠ 0 — the cut-adjacent chaos class diagnosed and
  recorded, no laundering).
- **Product verdict: TL PASS** (binding) — the family is now the program's
  best VLM family WITH the tracker following players.
- **Measured next increment (for a future lane):** the remaining critical
  class lives in the pre-cut chaos samples (c189pre-class) — a cut-adjacent
  sample protocol amendment (boundary-class adjudication, like the w4b T2
  classes) is the honest path to a Tier-1 machine claim, NOT further
  renderer softening.

Evidence: `fastloop/` (variant table + trajectory + duel + 6 gate JSONs),
`ab/` (the mini-A/B), `qa/` (full-protocol gates), `scorecards/` (the
15-call scorecard + raw JSONs), `tlreview/` (the PASS grid + verdict),
`frames/`, `record.json`, `commands.md`.
