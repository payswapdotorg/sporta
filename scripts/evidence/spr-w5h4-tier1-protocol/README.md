# SPR-W5-H4 — Tier-1 protocol amendment (Amendment A2: cut-adjacent boundary-class adjudication) — delivered + honestly measured; the Tier-1 machine claim WITHHELD on the re-run's own numbers

**The record (read this first):** this lane delivered the named protocol
amendment (the status-doc's #1 executable work item: "the honest path is a
cut-adjacent sample protocol AMENDMENT ... NOT further renderer softening")
and executed the amended 15-call re-run on player-focus v0.2.0. The
amendment mechanism works exactly as designed — the frozen w5h3 record's
2 criticals both sit inside the pre-adjudicated boundary class (retrospective
analysis below) — but **the Tier-1 machine claim is WITHHELD**: the fresh
re-run (same byte-identical render, fresh VLM calls) measured
**stylizationStrength 3.40 < the 3.5 axis bar**, failing the Tier-1 axis
condition on its own numbers. Nothing is laundered; both number sets (w5h3
frozen record and this re-run) stay recorded side by side.

## 1. The amendment (the design)

**Amendment A2** (appended to the frozen acceptance doc,
`docs/testing/source-preserving-reality-acceptance.md`, append-only after
A1): a scorecard sample is classified `cut-boundary-class` BEFORE scorecard
assignment iff the temporal-pair window it evaluates (primary frame + its
frozen 0.2 s partner, per the §2 sample design) intersects the **pre-cut
window of a SOURCE-side cut event**:

- cut events = the frozen per-clip cut records (b8: [189, 475, 550, 862,
  979, 982] — the corpus record, cross-checked == cuts_deep inputCuts),
  clustered with the scorecard's frozen CLUSTER_GAP (5 → the 979/982
  micro-shot is one event);
- pre-cut window of event [start, end] = **[start−8, start−1]** where
  8 = CUT_OFFSET (3) + TEMPORAL_DELTA (5) — exactly the backward reach of
  the frozen pre-sample design (a pre sample at start−3 pairs backward to
  start−8). NO new constants: both numbers are the frozen sample design's
  own;
- no post-cut window: a post sample at end+3 pairs forward into the new
  shot — post-cut frames are new-shot content, not transition content.

**Effect (scoped):** boundary samples are still VLM-scored — their axis
scores still count in the means (the axis bars keep pricing
boundary-sample instability — no score laundering) — but their
**critical-artifact counts (limbs+players) are re-attributed** to the named
`source-pre-cut-transition` boundary class in the AMENDED aggregate. Raw
verdicts, raw aggregates and the raw tierClaim stay in the record verbatim.

**The source-side basis (measured this session, substrate only —
`source-diff-probe.json`):**

| evidence | measurement |
|---|---|
| w5h2 root-cause pair (c979pre, frames 971→976) | source pair absdiff **60.07** — larger than the 979 cut itself (34.73); the 970–982 window is sustained chaos (consec diffs 8–49 over 13 frames) — reproduced EXACTLY by the probe |
| w5h3 critical pair (c189pre, frames 181→186) | source consec diffs sustained at 5.7–7.6 for 13 frames pre-cut (≈2.1× the clip median 3.14) — the pre-cut transition-in-progress region |
| post-cut content at every cut | returns to baseline within 1–3 frames (new-shot content) — the pre/post asymmetry is a property of the SOURCE |
| cut amplitudes (probe == frozen cuts_deep record) | 189: 32.05 / 475: 24.03 / 550: 20.09 / 862: 33.89 / 979: 34.73 / 982: 49.34 |

**The mechanism (why the reclassification is honest):** the VLM's temporal
judgment at a pre sample compares two stylized frames whose SOURCE content
is itself in transition (the frames leading INTO the cut — camera
whip/wipe/dissolve completing at the cut). The renderer must preserve that
source content (G-T2 cut preservation; the w5h3 c189pre verdict scored
sourceFidelity 5). A "disappearing player"/"malformed limb" flagged there
measures the source's own transition-in-progress content, not a renderer
defect. Every critical ever observed in this family across ALL recorded
runs sits in this class (w5h: c979pre 1; w5h3-session: c189post 2 at the
pre-frozen feather-21 config; w5h3 final: c189pre 2).

**Precedents:** the w4b named, scoped, pre-adjudicated boundary classes
(raw fail + adjudicated resolution, both visible); amendment A1 (w4a) for
the additive-tool + both-numbers shape; the w5h2 root-cause methodology;
the w5h3 near-miss diagnosis.

**No-laundering conditions (binding, recorded in the doc):** raw verdicts
verbatim; raw aggregate/tierClaim stay; axis means never re-attributed; an
amended tierClaim cites the amendment + carries raw numbers side by side;
hard gates unchanged; TL visual gate unchanged and still binding for
Tier 2+; classification derives ONLY from the frozen cut records + frozen
sample design (a sample is boundary because the SOURCE cut there, not
because the score was bad); one run stands as measured — no re-rolls.

## 2. The implementation (additive; default surface non-degraded)

- **`scripts/source-preserving/cut_boundary.py`** (NEW, pure): the window
  rule as a pure function of (cut records, sample set) + a CLI
  (`--cuts`, `--samples-json`, `--json`) for re-runnable classification.
- **`scripts/source-preserving/test_cut_boundary.py`** (NEW): 32 checks —
  the frozen b8 classification, the pair-window mirror of the tool's
  extraction rule for all 15 samples, determinism (classify twice
  deep-equal), generality (fixed-t samples landing in a pre window ARE
  boundary; post samples never are; window edges inclusive), clustering.
  `test-cut-boundary.txt` = the run record, exit 0.
- **`vlm_scorecard.py --amendment-a2`** (ADDITIVE flag): pre-adjudicates
  the boundary set BEFORE any VLM call (the classification prints first in
  the run log), annotates boundary-sample entries, and writes an
  `amendmentA2` block (both number sets + per-sample adjudication +
  reference) into the scorecard + aggregate. **Without the flag the
  surface is behavior-identical** — proven by measurement
  (`scorecards/default-surface/`): the no-flag `--resume` re-run over the
  same 15 verdicts produces byte-equal raw fields, the exact frozen w5h3
  output field-set, and NO `amendmentA2` key.
- The render pipeline is untouched: `git diff adf265b -- scripts/
  source-preserving/spe/` is EMPTY (the "NOT further renderer softening"
  law; no renderer change of any kind — softening or otherwise).

## 3. The amended re-run (15/15 calls landed, fresh, no re-rolls)

The committed output was **re-materialized deterministically and
sha-verified BEFORE sampling** (`render-rematerialization.json`): the
sandbox wiped the w5h3 session out-dirs, so the frozen w5h3 pass1 recipe
was re-run at main `adf265b` → sha256
`0ecfe14ec5bbcf13b7989c9395daa3aa9855306a303355b3fe7d616a9ea3e636`
**BYTE-IDENTICAL** to the w5h3 committed record (pass1==pass2==TL audit);
substrate sha re-verified == corpus record. The sampled bytes ARE the
committed bytes.

15 fresh `z-ai vision` calls (glm-5v-turbo), the frozen §2 prompt, the
frozen 15-sample set; pre-adjudicated boundary set =
**{c189pre, c475pre, c550pre, c862pre, c979pre}** (computed before the
first call). Run incidents recorded honestly in `scorecard-run.log`: the
sandbox's process reaper killed two detached runs (after 3 and 1 landed
calls — verified with a `setsid sleep 300` probe, dies <45 s; NOT quota
events — zero 429s across the whole protocol); the run completed via the
frozen tool's `--resume` path. All 15 verdicts are fresh calls from this
session; every sample was scored exactly once successfully — no re-roll of
any recorded verdict.

### The re-run's numbers (RAW and AMENDED — nothing disappears)

| | RAW | AMENDED (A2) |
|---|---|---|
| critical artifacts | **0** (limbs=0, players=0 at all 15 samples) | **0** (boundary criticals 0 — this run landed no criticals anywhere, so the amendment reclassified nothing) |
| axis means | sf 5.0 / tc 3.93 / ic 4.47 / mf 4.20 / scf 3.87 / **ss 3.40** | identical (axes are never re-attributed) |
| minAxis | **3.40** — BELOW the 3.5 Tier-1 axis bar | 3.40 |
| hard gates | green (G-T1..G-T5, the frozen w5h3 measured gates) | green |
| tierClaim | 0 | **0** |
| totalArtifacts | 9 (warped 4, bg 2, tj 1, dupes 1, ball 1) | — |

## 4. The honest verdict — **claim WITHHELD**

The Tier-1 machine claim condition (amended critical = 0 AND minAxis ≥
3.5) is met on the critical side (raw 0 — better than the amendment
needed) and **FAILED on the axis side: stylizationStrength 3.40 < 3.5** on
this run's own numbers. Per the work-order law (variance moves the
measurement → record honestly, claim withheld), the claim is withheld.
No second run was made (one run stands as measured — the no-re-roll law).

**The cross-run picture (the measured context, all recorded):**

| run (frozen 15-call protocol, b8) | render | minAxis | critical | tierClaim |
|---|---|---|---|---|
| w5h3 (the frozen record) | v0.2.0 `0ecfe14e…` | 3.73 (ss 3.93, tc 3.73) | 2 (both c189pre — boundary class) | 0 |
| **w5h4 (this re-run)** | **the same bytes** (`0ecfe14e…`, re-materialized + sha-verified) | **3.40 (ss 3.40)** | **0** | **0** |
| w5h2 (v0.2.0-SOFT, config never shipped) | different render | 3.60 | 0 | 1 machine (TL gate withheld it — different lane) |

Two runs of the SAME byte-identical render under the SAME frozen protocol
measured minAxis 3.73 vs 3.40 and critical 2 vs 0: **the VLM run-variance
band straddles BOTH Tier-1 bars**. No single run of the shipped v0.2.0
config has met both simultaneously — so the honest verdict is withheld,
and the near-miss is now characterized precisely: the binding constraint
moved from the critical bar (w5h3, the boundary class — now adjudicated)
to the stylizationStrength axis (this run: "the transformation is very
subtle" at c189post; the treatment's dim+zoom reads subtle on some frames
to the frame-pair judge, while the binding TL visual gate already recorded
PASS — "product-quality visual hierarchy" — on the same render).

**Retrospective analysis of the frozen w5h3 record under A2**
(`w5h3-record-adjudication.json` — documented analysis, NOT a claim): both
w5h3 criticals (c189pre limbs=1, players=1) sit inside the pre-adjudicated
boundary set → adjudicated critical 2→0, means unchanged (minAxis 3.73).
This demonstrates the amendment reclassifies exactly the recorded critical
class (the design intent); the live verdict, as ordered, comes from the
fresh re-run's own numbers — and those numbers withhold the claim.

## 5. Scope discipline (honored)

- NO renderer changes: `git diff adf265b -- scripts/source-preserving/spe/`
  EMPTY; the render re-materialization used main's frozen pipeline
  unchanged.
- The subject-toon Tier-2 push: out of scope, untouched.
- The raw scorecard path unchanged: the tool's default surface proven
  behavior-identical (§2); existing evidence packs untouched (the w5h3
  pack read-only).

## 6. The measured next gap (one sentence)

The Tier-1 machine claim now hinges on the stylizationStrength axis
(3.40 this run vs 3.93 at w5h3 on identical bytes) — the frozen 15-call
protocol's run-variance straddles both Tier-1 bars, so the next increment
is a protocol-level variance policy (multi-run medians, or the Tier-3
video-based audit that supersedes frame-pair judgment) — a TL decision,
not another renderer pass.

Evidence: `amendment`-relevant = `boundary-classification.json` (the
pre-adjudication), `source-diff-probe.json` (the source-side basis),
`render-rematerialization.json`, `test-cut-boundary.txt`,
`scorecard-run.log` (+ incidents), `w5h3-record-adjudication.json`;
the run = `scorecards/raw/` (15 verbatim), `scorecards/
scorecard-player-focus.json` + `vlm-scorecard.json` (both number sets),
`scorecards/default-surface/` (the non-degradation proof); visual =
`frames/source-pairs/` (the SOURCE's own frames at the 5 boundary pair
windows) + `frames/vlm-boundary-inputs/` (the exact VLM call inputs at
the boundary samples). Commands: `commands.md`.
