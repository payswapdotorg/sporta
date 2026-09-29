# Sporta MVP + Live Reality Status

Status: J/L implementation substantially complete; final gates + HF benchmarking remain
Audit tip: fe2710ec8b09abb761ceb9f1e0667e003901f907
Date: 2026-09-22

## Completed foundation

- W001-W921: COMPLETE
- R001-R510: COMPLETE
- R601-R605: VERIFIED
- J001-J015: COMPLETE/ACCEPTED on main through wave 5; J015 F1 Library stored-output inconsistency fixed at 4d150125 / fcfd0e0
- L001-L008: COMPLETE
- L010-L014: COMPLETE
- HF001: COMPLETE (logical task profiles registered/mapped)
- HF010-HF013: benchmark harness design only; no model inference executed

## Remaining batch MVP gates

| Item | State | Current evidence |
|---|---|---|
| R606 | REOPENED — IN-PLAY REVALIDATION RUN INGESTED (pre-match pack superseded; calibration = the identified stage to fix) | 2026-09-23 (operator, session web-ffe07d67): the prior pack's derived realities were PRE-MATCH defaults (0-0 PRE / 00:00, lastEventSequence 0 — the 57.84–105.28s window was pre-kickoff) → the gate was REOPENED with the directive: regenerate the whole chain from a contiguous in-play section beginning at/after source media time 30:00. 2026-09-24: **the in-play run is INGESTED** — new bytes (2,707,829 B, sha 0d0e315a…) from media 1803.84–1851.44s (the first whole segment boundary at/after 30:00; 9 whole itag-230 segments + the itag-140 audio at the same window; VLM-verified in-play: BET 1-2 BAR ~24', 12–18 players), new registration urlreg-128b8b8a…, new session sess-u-edaddae6… (nothing inherited; a 55s first attempt OOM-killed the 4GB sandbox at 1.75GB RSS — 47.6s/1190 frames is the practical envelope). The stage ladder (manifests/diagnostic-ledger.json in the new pack): acquisition PASS · normalization PASS (Original a13396ec…) · player/ball perception PASS (18.86 det/frame, 448 tracks, ball 494 pts, 345 team-labeled) · **CALIBRATION FAIL — the earliest incorrect stage** (line-based: 0 line evidence, its documented near-axis-aligned envelope excludes real broadcast perspective; honest refusal) · event reconstruction BLOCKED (possession needs pitch meters) · SWM PARTIAL (real in-play entities in image frame) · renderer consumption PASS mechanically. Per the operator's failure-handling directive the fix is at the calibration stage (the W203→W303-class real line detector); measured design notes + the calibration-ideal window (media 1979–2065s, ~86s stable single-camera open play) are recorded in the pack. The pre-match pack is labeled SUPERSEDED (kept intact). Packs: `/home/z/w6-real-r606-inplay-evidence/` (current) · `/home/z/w6-real-r606-evidence/` (superseded). The operator's earlier verdict-STATE stands (technical execution PASS; the VPN-egress ratification ask is unchanged). R606 remains OPEN until the in-play pack passes the human visual gate (which requires the W303 calibration fix first). 2026-09-24 (fix lane): **the W303-class calibrator LANDED in the product chain** (sporta-wc @7321e9f, 166 tests green): `broadcast-line-calibrator` v0.1.0 — local-contrast line detection (real broadcast lines run 130-180 brightness on 90-120 grass; the bright-white predicate fires on stands instead), green-union restriction, motion-compensated temporal aggregation (static lines vs moving players), quota-balanced Hough, a generalized (2+2)-family rectangle-grid hypothesis search with anti-collapse guards + refinement, typed honest refusals, confidence-carried fit quality; wired DEFAULT-first in the real-to-swm calibration chain (line-based + homography remain fallbacks). Machine-measured on the frozen source (640x360): three static in-play windows (2074.84-2079.84 rock-static, 2462.84-2476.84 behind-goal, 3067.84-3078.84 kickoff); the candidate refuses two honestly at validation (lineFit 0.21-0.54) and calibrates the behind-goal one at confidence 0.78 with a visually imperfect overlay (recorded). Remaining gap precisely known: the minority-orientation family on these views is ARC SEGMENTS, not straight lines — the next increment is the ellipse/circle-constrained solve (the center circle IS strongly detected) or higher-resolution acquisition with resolution-scaled constants. 2026-09-27 (lane A closure merge @9000a97, TL-audited): **the ellipse/circle-constrained solve v0.2.0 LANDED** (branch r606/ellipse-constrained-solve, worker d2e696e): additive path in broadcast-line.ts (1765→4245L, adapter seam unchanged, option ellipseConstrained default-on engages ONLY after a line-path refusal; two new typed refusal classes), synthetic arc-window proof — the exact R606 arc-window class v0.1.0 refuses and v0.2.0 calibrates at worst-probe 1.378 m < 2.5, conf 0.911, all gates at the unchanged bar; non-degradation proven (byte-identical results on line-path windows, test + real-corpus); package battery 137/0 + tsc clean + real-to-swm 38/0 (calibration seam safe). Honest real-corpus measurement on the sha-verified committed bytes, 12 windows × both paths: **no real window newly calibrated** — 5 quota refusals (ellipse-evidence-insufficient) + 3 validation near-misses (lineFit 0.606–0.662 passing while backward chamfer 17.6–21.6 px > 10, ellipse residual 6.3–13.9 px > 4); the measured next gap: the arc evidence catches only ONE flank of the real circle (the Hough-chord explain eats the rest — single-flank underdetermines the conic), so the next increment is arc-evidence flank recovery or higher-resolution acquisition. The TL re-ran the full battery + driver in a clean worktree: all measurement values byte-identical (only wall-clock durationMs differs). Evidence: scripts/evidence/r606-ellipse-constrained/ (README, measurement.json, 12 overlay PNGs, re-runnable driver + render_overlays.py). 2026-09-28 (lane A continuation, branch r606/straightness-explain): **the straightness-aware explain v0.3.0 LANDED** — the flank-recovery increment: a Hough line explains arc-band pixels only along genuinely-straight along-line stretches (≥ ELLIPSE_LINE_STRAIGHT_SUPPORT_PX = 140; the arc-chord "fake" chords through the near-straight circle flank max out ~110 px, real touchlines 200-600 px — the measured one-flank defect fixed at the EVIDENCE level). Real-corpus 12-window measurement (driver re-run, deterministic): the arc evidence recovers dramatically (b8p3-b 871→3738 px, coverage 10/36→34/36; b5-a 8/36→19/36; b8p3-f's conic residual 6.3→1.42 px — the fitted conic is now tightly supported); 0 windows newly calibrated (the same 2/12; non-degradation exact; three windows' refusals move from the quota stage to the LATER validation stage — penalty-arc evidence now passes the quota and the solve refuses honestly rather than guessing); battery 137/137 + tsc clean + the 9/9 ellipse suite (the two occluded/partial tests updated to the v0.3.0 refusal stage, v0.2.0 surface asserted reproducible via the option-off path). VLM overlay check: b8p3-f's fitted conic still does not coincide with the visible white circle arc. THE NEXT MEASURED GAP (precise): the evidence problem is substantially solved — the remaining blocker is CONIC SELECTION + ANCHOR CONVERSION (the RANSAC winner is not always the center circle: b8p3-b's projected model circle lands 19.6 px from the fitted conic; b5-b backward 0 with ellipse residual 46.7 = a degenerate-ish anchor set). Next increment: circle-vs-other-conic discrimination in the RANSAC winner, then the anchor machinery (the mixed DLT / pole-polar conversion). 2026-09-28 (lane A continuation #2, branch r606/conic-selection): **the CONIC-SELECTION CHAIN v0.4.0 LANDED** — the fallback chain: the v0.3.0 RANSAC-winner primary is tried first (its solve/refusal is the v0.3.0 surface exactly); on its typed refusal the DISTINCT quota-passing alternatives run (the per-component fits of the sub-dominance arc components FIRST — a dominance-DROPPED structure is recoverable only there, its pixels never reaching the global RANSAC; the component fits skip the EM band refinement, which measured-drifts near neighboring structures: semi 64 vs the true 100 — then the global ranked re-fit runners-up), each through the FULL hypothesis → refinement → validation flow with the bar never lowered, capped at 4, geometry-deduplicated, deterministic; total failure rethrows the first quota-passer's typed refusal with the additive per-candidate conicChain record; new option ellipseMultiConicSelection; the diagnostics record conicCandidates + arcComponents; the driver measures 4 paths (v0.1.0 / the v0.4.0 default / the explicit v0.3.0 control / the opt-in chain) with the non-degradation counter. MEASURED (12-window real corpus, 4-path): the DEFAULT stays v0.3.0-exact (2/12 calibrated byte-identical b8p3-c 0.832 / b8p3-d 0.988, v040NonDegradationViolations 0, the quota-refusal classes identical, the product seam real-to-swm 38/38 unchanged); the OPT-IN chain machine-recovers b3-a (a behind-goal view: conf 0.831, lineFit 0.731, backward ≤ 10, ellipse residual ≤ 4) **BUT THE VLM VISUAL GATE FAILS THE CLAIM** — the projected grid misaligns on all three sharp checks (goal line, penalty box, center-circle placement) and the winning conic (574.3, 79.0) anchors to the GOAL/NET STRUCTURE (the frame's center circle is out of view; the machine bar's line-on-line blind spot on behind-goal views: the static net satisfies the backward chamfer, a displaced parallel line family satisfies lineFit). THE CLAIM WITHHELD; **THE CHAIN SHIPS OPT-IN (default false)** until the validation-gate hardening lands (the w5h2 doctrine: machine metrics met, visual gate failed, nothing laundered). The refusing windows carry the per-candidate conicChain records (b8p3-b: 4 candidates; b8p3-f: one at lineFit 0.73; b5-b: the degenerate primary + 3 alternatives) — the measured design surface for the next increments. Battery 139/139 + real-to-swm 38/38 + tsc clean (package-level). THE NEXT MEASURED GAP: (1) the b3-a-class validation-gate hardening (pitch-line-vs-structure discrimination — the goal structure stands in front of far grass, so greenTop alone does not discriminate; candidates: green-union-interior support, goal-line/corner consistency on the solved grid, a penalty-arc-conic prior for behind-goal views); (2) the b8p3-b/f anchor-conversion increments with the per-candidate records. Evidence: scripts/evidence/r606-ellipse-constrained/ (README v0.4.0 addendum + the 4-path measurement.json + the chain overlays — b3-a's red grid = the withheld claim's visual record). 2026-09-29 (lane A continuation #3, TL merge 8fdc78c, resident-loop dispatch — worker session 57-a, TL-re-verified on own gates): **the VALIDATION-GATE HARDENING v0.4.1 LANDED** (branch r606/validation-gate-hardening, CHAIN-ONLY): two additive discrimination gates fire exclusively on the ellipseMultiConicSelection path — (leg 1, pre-solve) the conic grass-support gate `broadcast-line.ellipse-conic-off-pitch` (the median over frames of the interior green fraction over a 41x41 parametric grid >= 0.2; measured class separation: the b3-a goal/net conics 0.000-0.073 vs the solve-reaching windows' grass-backed primaries 0.27-0.79; the ANY-frame green union is NOT discriminating — inside the b3-a winner it lifts to 0.164 with the LAST frame above threshold, so a single-frame gate would PASS the structure while the median refuses it: static structure is never green, moving occluders clear it) and (leg 2, post-validation) the projected-grid geometry gate `broadcast-line.ellipse-degenerate-grid` (the containment invariant: quad area >= 0.5x conic area, corners >= 4px apart — the v0.4.0 b3-a solve was a POINT-COLLAPSE, quad/conic 0.0004, all four corners at (575, 98)). MEASURED (12-window corpus, 4-path, TL re-run deep-equal): **b3-a now REFUSES at the machine bar with the typed class** — the v0.4.0 machine-recovery (conf 0.831, VLM-refuted, claim withheld) is now an honest typed refusal AT THE MACHINE BAR, nothing laundered; the chain's calibrated set 3/12 -> 2/12 (exactly the visually-refuted b3-a lost; VLM verification of the refusal run: the cyan conic sits on the goal/net structure, its interior non-green, no painted circle visible — the machine refusal MATCHES the visual truth); non-degradation EXACT (TL deep-equal vs the v0.4.0 record: every default-path window record + per-frame diagnostic identical; the only aggregate deltas are the two chain counters). Battery 143/143 (139 + 4 new: the netStructure fixture — a static white disk ON grass = the real window's out-of-view fact, refused pre-solve; the frozen-b3a degenerate-grid regression lock) + tsc clean + real-to-swm 38/38. THE NEXT MEASURED GAP (recorded by the worker, adopted): b3-a's ENTIRE candidate set is structure-anchored (green medians 0.000-0.073 — no grass-backed conic evidenced in the window at all; center circle out of view; the visible penalty arc yields no quota-passing candidate) — the next increment must EVIDENCE a grass-backed conic on behind-goal views (the penalty-arc-conic prior, the fixed-geometry family) or land the b8p3-b/f anchor-conversion increments (whose per-candidate records the chain now carries).
| R607 | HOSTED ACCEPTANCE EVIDENCE LANDED (2026-09-26, lane B closure merge — control-plane half PROVEN, media half MEASURED-BLOCKED) | Worker B executed the hosted-acceptance shape for real on the Vercel Hobby plane (branch r607/hosted-acceptance-evidence, TL-audited merge): deploy of raw main 0cc47ae (dpl_6s7jN8Y8) honestly recorded BROKEN (every API route 500 — Bun.which gap in the W911 Node-runtime shim), one flagged minimal product fix (8893926: Node-backed which() in the existing shim seam + 7/7 regression tests), healthy deploy dpl_4h5AQfUq + fresh-browser golden path (sign-up PASS, upload REFUSED at admission with the typed ffprobe-absent class — the hosted Node serverless runtime ships no ffmpeg/ffprobe; rights/compute/Reality-Switcher/Library PASS with honest states; the four-output MP4 leg BLOCKED UPSTREAM, never invented), redeploy dpl_9xhz2W7H (same revision), and the byte-level recovery proof: identity/session/library/watch/artifacts RECOVERED byte-identical across the redeploy (sha-verified R2 artifact, cross-deployment cookie survival, zero developer intervention). TL audit: all three deployment ids re-checked via the Vercel API, the public alias re-hit live (marker r607-fix-2, neon identity + neon control plane + r2 artifacts ok), batteries re-run in a clean worktree (shim 7/7, api-routes 15/15, golden-path 14/14, tsc clean). The hosted control plane (Neon identity + W921 durable control plane + W912 R2 artifacts) is deployment-recovery-PROVEN; the hosted four-reality media pipeline is blocked at the runtime-toolchain-absent boundary (classification recorded; closing it requires the W914 http compute adapter against a real toolchain worker or an ffmpeg-shipping host — a work item beyond the Hobby beta-personal boundary). R607 remains OPEN pending the media-toolchain unblocking; the durability/recovery half of its gate is now evidence-backed. Evidence: scripts/evidence/r607-hosted-acceptance/ |

## Journey items

| Item | State |
|---|---|
| J001 | ✅ COMPLETE |
| J002 | ✅ COMPLETE |
| J003 | ✅ COMPLETE |
| J004 | ✅ COMPLETE |
| J005 | ✅ COMPLETE |
| J006 | ✅ COMPLETE |
| J007 | ✅ COMPLETE locally; hosted Neon/R2 cross-instance gate remains under R607 |
| J008 | ✅ COMPLETE |
| J009 | ✅ COMPLETE |
| J010 | ✅ COMPLETE |
| J011 | ✅ COMPLETE |
| J012 | ✅ COMPLETE |
| J013 | ✅ COMPLETE |
| J014 | ✅ COMPLETE for local real-process restart; hosted redeploy still under R607 |
| J015 | ✅ COMPLETE; F1 Library/catalog truth fixed and browser journey re-verified |

## Live Reality

| Item | State |
|---|---|
| L001 | ✅ COMPLETE / contracts frozen and mapped |
| L002 | ✅ COMPLETE |
| L003 | ✅ COMPLETE |
| L004 | ✅ COMPLETE |
| L005 | ✅ COMPLETE |
| L006 | ✅ COMPLETE |
| L007 | ✅ COMPLETE |
| L008 | ✅ COMPLETE |
| L009 | 🔒 BLOCKED — authorized provider feed access required |
| L010 | ✅ COMPLETE — benchmark harness delivered; production promotion remains evidence-driven |
| L011 | ✅ COMPLETE |
| L012 | ✅ COMPLETE |
| L013 | ✅ COMPLETE |
| L014 | ✅ COMPLETE |
| L015 | ⬜ NOT_STARTED — final live tactical latency/continuity gate |
| L016 | ⬜ NOT_STARTED — final live tracking→SWM→tactical journey gate |
| L017 | ⬜ NOT_STARTED — final live-to-replay recovery gate |

## Hugging Face Technology Portfolio

| Item | State |
|---|---|
| HF001 | ✅ COMPLETE |
| HF002 | ⬜ NOT_STARTED |
| HF003 | ⬜ NOT_STARTED |
| HF004 | ⬜ NOT_STARTED |
| HF005 | ⬜ NOT_STARTED / gated research |
| HF006 | ⬜ NOT_STARTED |
| HF007 | ⬜ NOT_STARTED |
| HF008 | ⬜ NOT_STARTED |
| HF009 | ⬜ NOT_STARTED |
| HF010 | ⬜ BENCHMARK HARNESS DESIGNED; NO INFERENCE RUN |
| HF011 | ⬜ NOT_STARTED |
| HF012 | ⬜ NOT_STARTED |
| HF013 | ⬜ BENCHMARK HARNESS DESIGNED; NO INFERENCE RUN |
| HF014 | ⬜ NOT_STARTED |
| HF015 | ⬜ NOT_STARTED |

## Current final blockers

1. R606 in-play revalidation (REOPENED 2026-09-23 by the operator — the
   pre-match pack superseded; see the R606 row): (a) the W303-class
   calibration fix at the identified stage (the line-based calibrator's
   documented envelope excludes real broadcast perspective; the measured
   design notes + the calibration-ideal 1979–2065s window are in the in-play
   pack). STATUS 2026-09-24: the W303-class broadcast line calibrator is
   LANDED and product-wired (see the R606 row) — synthetic-proven, honest
   refusals on real 640x360 partial views; the remaining increment is the
   ellipse/circle-constrained solve for arc-segment-only windows (or
   higher-resolution acquisition);
   (b) the operator ratifies the VPN-egress third-path acquisition
   (recorded honestly; contract frozen in
   docs/contracts/real-source-provenance.md) or supplies cookies.txt for a
   frozen-path re-run; (c) the human four-realities confirmation per
   provenance contract §7 once the in-play pack carries placed realities
   (the pre-match WATCH publication stands as lineage: console :3000 R606
   WATCH section, hash-verified artifact delivery, evidence-pack download; no
   worker-machine access, no dev APIs, no manual DB. The console R606 gate
   (teal panel) presents both asks; the frozen-path re-run channel and the
   dormant re-seed runbook (replay2 scripts/reseed_3101.py) are ready.
2. R607 public hosted durability / deployment acceptance — behind R606.
   Deployment freshness recon (2026-09-23 21:52Z, TL): the live production
   alias https://sporta-flame.vercel.app serves marker `w920-beta-1`
   (W920-era, 2026-09-16 code @edd0953) — a full week behind current main
   @aa856c0; Neon identity + controlPlane and R2 artifacts verified
   configured/ok on the live deployment; api.vercel.com + the public URL are
   reachable from this sandbox. **The VERCEL_TOKEN is NOT present on the
   current sandbox instance** (the Sep-20 secrets file holds only
   GITHUB/COMPOSIO keys; the Sep-16 W920 deploys ran from an earlier
   environment). R607-A therefore needs the operator to supply the token
   (operator_inbox.jsonl or an env drop) in the same window as the R606
   ACCEPT.
3. L009 authorized live provider feed access if a real external live feed is required.
4. L015-L017 final live gates.
5. Real uploaded-session commentary is not yet a general production path.
6. Highlights remain intentionally unavailable.
7. HF candidates remain benchmark/provenance work, not production dependencies.

## No-conversation-dependency rule

This status, the active handoff, contracts, ADRs, roadmaps, work items, research, acceptance evidence and journey simulation are the implementation context. Chat history is not required to continue the work.
