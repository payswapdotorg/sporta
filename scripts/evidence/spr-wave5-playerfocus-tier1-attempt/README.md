# SPR-W5-H2 — player-focus v0.2.0 Tier-1 attempt — machine metrics MET, TL visual gate FAILED, claim withheld

**The record (read this first):** the v0.2.0 softening (dim 0.45→0.40,
feather 21→35) was dispatched to clear the single critical blocking
player-focus's near-miss Tier 1 (the c979pre sample). The attempt
SUCCEEDED on every machine metric — and the TL visual gate then FAILED
it. Per the binding doctrine (the frozen gates arbitrate, the TL visual
gate is final for product quality), **the Tier 1 claim is NOT granted**
and the shipped config reverts to the duel-winning v0.1.0 treatment.
This pack records the full exploration, honestly.

## 1. Root cause of the v0.1.0 critical (diagnosed BEFORE the attempt)

The single critical (c979pre, "players=1") sits in a temporal pair
(frames 971→976) whose ORIGINAL frames differ by **60.07 mean absdiff —
larger than a full broadcast cut** (the 979 cut itself is 34.7). The
970-982 window is a sustained high-chaos transition region (diffs 8-49
over 13 consecutive frames). The frozen cut-adjacent sampling assumed
the pair was within-shot (both frames pre-979); the source content
itself transitions drastically across it. The VLM's "different shot"
judgment at that sample measures the SOURCE's transition — a frozen-
protocol boundary class, substantially misattributed to the renderer.
(Diagnosis evidence: `tlreview/styl-f97{1,6}.png` + the diff-series
measurement in the record.)

## 2. The v0.2.0 attempt (dim 0.40, feather 35)

| metric | v0.1.0 | v0.2.0 |
|---|---|---|
| b8 raw T2 | 5/6 softened class | **RAW PASS (cov 1.0, extra 0.0)** |
| b12 raw T2 | RAW PASS | RAW PASS |
| b2 raw T2 | RAW PASS | RAW PASS |
| T3 (b8/b12/b2) | 0.9386/0.9285/0.9528 | 0.9439/0.9314/0.9533 |
| T4 | 0.6309/0.7020/1.3626 | 0.6048/0.6721/1.3318 |
| VLM minAxis | 3.80 | 3.60 |
| VLM critical | 1 | **0** |
| tierClaim | 0 (near-miss) | **1 (machine)** |

Determinism: 3/3 double-render byte-identical (b8 aa1d025b / b12
704c3ff8 / b2 a40ae5a6). All 15/15 VLM calls landed; axes
sf 5.0 / tc 4.0 / ic 4.67 / mf 4.40 / scf 4.40 / ss 3.60.

## 3. The TL visual gate (binding) — FAIL

`tlreview/tl-grid.png` + `tl-review.json` (top row = originals at
t=2/8/15/30/45; bottom row = v0.2.0 stylized):

> **TL_VERDICT=FAIL** — "The stylized output fails to apply the required
> 'player focus' treatment (zoom + dim spotlight), instead showing a
> nearly identical wide shot to the original, and in one instance (t=8)
> exhibits a catastrophic zoom failure by focusing on a background
> advertisement logo rather than the players."

Two defects:
1. **Over-softening**: dim 0.40 + feather 35 reads as treatment-absent
   at wide samples — the v0.1.0 treatment (duel-ranked BEST: "effectively
   highlight the player while maintaining full context") was the better
   product; the softening traded product presence for the critical count.
2. **The ad-board lock at t=8** — the motion gate (MOG2+residual flow)
   tracks the biggest motion blob, which at t=8 is an animated
   advertisement board, not a player. **This defect is shared by v0.1.0**
   (same tracker) — the TL gate caught what the sample protocol could
   not. This is the REAL next increment: player-priority tracking
   (kit-color / size / center priors in the motion gate so the spring
   follows players, not boards).

## 4. Verdict

- **Shipped config: v0.1.0 REVERTED** (the duel-winning treatment; all
  gates green; honest Tier 0 near-miss Tier 1 with the c979pre
  source-class root cause recorded above).
- **The machine Tier-1 metrics of v0.2.0 are recorded** (critical 0,
  all axes ≥ 3.60, all raw gates green) — the claim is WITHHELD by the
  TL gate; nothing is laundered.
- **The measured next increment (for a future lane):** player-priority
  tracking — then re-run the full protocol; a treatment that focuses on
  actual players (not boards) with the v0.1.0 presence could plausibly
  clear both the critical bar and the TL gate together.

Evidence: `qa/` (v0.2.0 gate JSONs), `scorecards/` (the critical-0
scorecard + 15 raw calls), `tlreview/` (the TL FAIL evidence + the
c979pre pair), `frames/`, `record.json`.
