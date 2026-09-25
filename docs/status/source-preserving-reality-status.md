# Source-Preserving Reality — Status

Program start: 2026-09-24 (session w6-spr-1). This file is the durable status
record. Evidence pointers are absolute machine paths or repo-relative.

## Current state: WAVE-2 DELIVERED AND MERGED (B+C in main, byte-verified; b4 honestly negative; push PAT-blocked) — WAVE-3 AUTHORED, DISPATCH PENDING PAT

### Session w6-spr-5 (2026-09-25, wave-2 worker deliveries + TL audit + merge)

Three wave-2 workers ran server-side through TWO sandbox resets (the git
branch delivery held both times — workers push branches, never local state):

- **spr/w2b/corpus-renders @7d8b277** (session 942a166c…): 30/30 renders
  (5 realities × 6 clips), 30/30 byte-identical double-render determinism,
  substrate 8/8 sha-verified before rendering. Honest gate findings: F1 —
  all 5 b1 renders fail T1 (substrate audio 30.00 s < video 30.04 s; the
  frozen `-shortest` encoder drops frame 751→750) and qa_check CRASHES on
  the 751-vs-750 mismatch (b1 T2/T3/T4 not produced; crashes recorded);
  F2 — G-T2 vacuous coverage=0/max(0,1) failures on zero-cut clips (b5/b6/b7)
  are a gate-design artifact, not renderer defects; F3 — b2 anime+trails
  G-T2 fail is one source cut splitting into two adjacent spikes (coverage
  1.0, 0 invented); F4 — real G-T3 misses: b5 noir-vhs r=0.7303, b6 vhs
  r=0.7978 (critical) — VHS grain/scanline noise decorrelates motion energy
  on uniform pans.
- **spr/w2c/stylizer-trials @e55ae86** (session 23533afe…): 3 license-clean
  CPU candidates (AnimeGANv2 + EbSynth REJECTED for license red flags).
  All preservation gates green (one adjudicated T2 flag: input-correspondent
  spike, cuts_deep 0 invented); triple-render determinism; VLM mini-protocol
  deltas vs same-protocol cartoon-cel baseline: subject-toon b8 identity
  +1.0 AND motion +1.0 (attacks the Tier-2 diagnosis exactly). Verdicts:
  subject-toon KEEP, flow-prop-toon KEEP, kuwahara-paint CONDITIONAL
  (painterly family only). Surfaced 2 pre-existing substrate defects:
  b12 nb_frames metadata 338 vs 301 decoded; `-shortest` trailing-frame
  drop (frozen baseline exhibits it too).
- **spr/w2a/b4-crowd @de687ce** (session f6dd7459…): HONEST NEGATIVE — 16
  new windows (~1520 s), 80 grids, ~1220 cells classified, 26 crowd-flagged
  → 5 candidates → all 5 rejected by per-frame direct verification: every
  crowd-dominant run in this broadcast is 2–7 s (longest verified ~6.5 s @
  media 4232.9). An 8–12 s crowd passage does not exist in this source.

**TL audit (this session):** b7×motion-trails re-rendered on the MERGED tree
— sha256 `998c9b49…` BYTE-IDENTICAL to the worker's recorded pair
(anti-fabrication; b1×cartoon-cel + b7×motion-trails were verified in the
pre-merge audit). B+C merged into main locally (`2b35368`), diff-verified
lane-only (insertions only, both lanes), engine untouched. **PUSH PENDING:**
the reset wiped the PAT and z.ai server-redacts tokens in transcripts
(`[REDACTED:github_token]` — API-level, not UI), so origin/main still sits
at `805a5fc` until the operator supplies a fresh PAT.

**TL decisions (wave-3 shape, recorded):**
1. b1 re-cut with apad + b12 metadata/apad normalization (substrate adapts,
   engine frozen — w6-spr-2 precedent) with corpus SHA re-lock.
2. b5/b6 noir-vhs G-T3 misses → root-cause diagnosis work order (gate metric
   vs stylizer trade-off, recorded not patched).
3. b4 path: goal-timestamp-targeted final sweep (crowd cutaways cluster
   after goals) with a hard gate — if ~15 goal-adjacent windows still find
   no ≥8 s crowd-dominant run, b4 is reclassified as a crowd-montage
   (assembled from the verified 2–7 s runs, cut marks + provenance).
4. subject-toon promoted toward first-class reality + formal frozen-protocol
   Tier-2 scorecards (mini-protocol deltas are not tier claims); kuwahara
   stays CONDITIONAL painterly-family; EbSynth terms REJECTED — flow-prop-toon
   is the in-engine temporal-stability architecture.

Wave-3 work orders authored (dispatch PAT-blocked): substrate-fix
(b1/b12), stylizer-promotion + scorecards, b4 final sweep.

### Session w6-spr-3 (2026-09-25, Tier-2 gate execution)

VLM quota returned; the Tier-2 gate executed for real — and the execution
itself surfaced and fixed two spec/evidence defects:

1. **Harness spec-drift fixed**: the v1 scorecard script (authored during the
   quota outage, never validated against a live model) implemented a 4-axis
   prompt that drifted from the frozen acceptance §2 7-axis protocol.
   Rewritten to conform exactly: sourceFidelity / temporalConsistency /
   identityConsistency / motionFidelity / sceneFidelity / stylizationStrength
   (1–5 + justification) + the 7-type artifact checklist with critical =
   limb-malformation/player-disappearance; sample set t=2/8/15/30/45 +
   cut-adjacent pre/post (cut-adjacent pairs stay WITHIN the source shot — a
   pair crossing a broadcast cut would misattribute the preserved source cut
   as renderer temporal inconsistency; the 979/982 double-cut bounds a
   3-frame micro-shot that cannot support a 0.2 s pair, so those two samples
   cluster into one event). 60 conformance calls, all landed; v1 pilot
   preserved as vlm-scorecard-4axis-pilot.json.
2. **G-T5 hardened to the full artifact**: the determinism proof lived only
   on the b12 cut (sha-triple); the b8 renders were single-rendered with an
   implementation claim — while the status ledger said "byte-identical ×3"
   for the full realities. Every b8 reality was re-rendered independently
   this session: **all four byte-identical** (sha pair embedded in
   renders.json files.b8.determinismDoubleRender). The claim is now measured
   on the shipped artifact itself.
3. **Silent gate-consumer bug fixed**: both the product manifest route and
   the harness read `files.b8.determinismDoubleRender` — absent — instead of
   the b12 record, so the live lab had been showing hardGatesGreen=false /
   "Gates pending" for every reality since the recovery. Same class as the
   playbackUrl bug: an honest-evidence surface that silently degrades.
   Both consumers now read b8-first/b12-fallback with the source labeled.

**Tier outcome (frozen protocol applied — the bar is never lowered):**

| Reality | Hard gates | VLM axis means (min) | Critical artifacts | Tier |
|---|---|---|---|---|
| noir-retro-noir | ALL PASS (incl. b8 double-render) | 5.0 / 4.35 / 4.29 / 3.82 / 4.0 / 3.59 (min 3.59) | **1** (one background-figure "slight morphing" VLM-categorized as limbs) | **Tier 0 — critical blocks Tier 1** |
| motion-trails | ALL PASS | 4.88 / 4.12 / 4.0 / 3.88 / 3.53 / 3.47 (min 3.47) | **2** (trail streaks on limbs counted as malformation — style-effect conflation, recorded) | **Tier 0** |
| anime-npr | ALL PASS | min 1.80 (stylization 5.0, identity/motion collapse) | 136 | Tier 0 |
| cartoon-cel | ALL PASS | min 1.53 (stylization 5.0, identity/motion collapse) | 99 | Tier 0 |

Diagnosis feeding wave-2 (SPR202 neural upgrade): preservation is solved
(sourceFidelity 4.88–5.0 — the engine's contract holds); the failure mode is
visual quality of the heuristic stylizers — aggressive styles destroy player
structure, subtle styles draw borderline limb-morphology counts. Tier 2
(≥4.0 means + 0 critical + TL approval) is untouched for the neural wave.

**TL visual gate (this session, agent-browser on the live lab)**: playback
+ position-preserving switches verified again under real gestures (noir,
trails); hold-to-compare round-trips mid-clip with position AND play state
held (t=22.88→24.77 across the swap); frame strip 12 imgs; mobile 390×844 no
horizontal overflow, footer naturally pushed on long content; zero console
errors; honest tier badges + VLM scorecard panel render in the evidence
panel; VLM UI review of the surface 4/5/4/5. Screenshots:
qa/tl-visual-*.png (machine-local). TL verdict: mechanics green; visual
quality honestly matches the Tier-0 outcome above — Tier-2 approval is NOT
granted (nothing met the criteria; that is the correct result, not a failure
of the process).

Evidence: `scripts/evidence/spr-tier2-scorecards/` (aggregate + 4 family
scorecards + 60 per-call VLM JSONs + renders-with-b8-determinism.json);
harness `scripts/source-preserving/vlm_scorecard.py` (v2, --resume).

### Session w6-spr-4 (2026-09-25, wave-2 corpus discovery — same session as w6-spr-3)

Executed immediately after the Tier-2 gate: the wave-2 corpus acquisition
through the recorded recipe (bgutil + TLS relay alive; the acquisition chain
survived).

1. **b5 window re-pulled** (86s, media 1979–2065): video itag230 via ffmpeg
   through the relay, audio 140-5 native. The audio pull carries a truncated
   final AAC packet at ~79.7s (decode error-spam kills unbounded ffmpeg
   runs) — bounded decode `-t 79.6` + apad to 86.10s = the b5-86s substrate
   (2155 frames). Audio is real to 79.6s, padded silence after (recorded).
2. **Discovery**: 9 windows sampled (~774s total: media 300/900/1979/2065/
   3300/3500/4600/5000/5800), 1 fps thumbnails, timestamped 4×5 grids,
   VLM-classified per category (~45 grid calls).
3. **Clips assembled** (exact-content re-encode — `-c copy` keyframe-snaps
   up to ~2s on HLS section pulls and desyncs against the exact-window
   audio; fixed deterministic x264 params; apad normalize; reproducibility
   re-run BYTE-IDENTICAL on b2):
   - b2 close-up 3515–3524 (9s, 225f) — VLM YES
   - b3 fast-action 2046–2058 (12s, 300f) — VLM YES (shot + GK dive)
   - b5 camera-move 1987–1999 (12s, 300f) — VLM YES (pan following play)
   - b6 set-piece 5826–5838 (12s, 300f) — VLM YES (corner kick, night)
   - b7 night 5840–5850 (10s, 250f) — VLM YES + direct day/night frame check
   - b4 crowd — **PENDING, honestly**: every crowd-flagged grid candidate
     failed direct per-clip verification (the grids over-called crowd for
     wide shots with stands visible; direct checks all NO). No 8-12s
     crowd-dominant passage exists in the 774s sampled. Needs goal
     timestamps or wider sampling.
   - night finding: the match runs day→night (daylight at ~30',
     floodlights at ~97') — b7 is genuinely present, verified.
   - the 3500-area audio pulls failed (empty stream / ffmpeg exit 8);
     b6 moved to the 5800 window instead (recorded).
4. **Corpus updated**: 8 entries (b8/b1/b12/b2/b3/b5/b6/b7) with full
   provenance, commands, shas, VLM verdicts + the honest b4 note. Mirrored
   to `scripts/evidence/spr-wave2-corpus/`.

### Session w6-spr-2 (2026-09-24, environment-reset recovery)

The sandbox was reset between sessions: the sporta repo (GitHub main @40dcf60)
survived intact — all SPR docs, the SPE-v1 engine, the QA scripts — but every
machine-local artifact was lost (b8 substrate bytes, renders, QA JSONs, the
Realities Lab surface, the whole replay stack, the 86s pull). Recovery executed
end-to-end:

1. **Substrate re-acquired** through the recorded recipe (gost proxy
   credentials from session-log; proxy alive, 407 without auth). The HLS
   acquisition path needed rebuilding: bgutil PO-token provider reinstalled
   (server :4416 + yt-dlp plugin), `--js-runtimes node bun` (the comma form is
   silently wrong — each runtime is a separate flag), and a **local
   TLS-terminating relay** (`/home/z/spr-evidence/scripts/tls_proxy_relay.py`)
   because ffmpeg cannot speak to an HTTPS-only proxy but honors plain
   `http_proxy` for HLS inputs. New substrate b8r3 sha-256
   `969af7c6…` (HLS pulls are not byte-reproducible — content equivalence
   verified instead: same window, same 6 broadcast cuts [189, 475, 550, 862,
   979, 982], same envelope; the recorded a13396ec was itself the
   media-platform-normalized artifact).
2. **Substrate normalization re-derived** (three honest render cycles,
   quarantined under render/_recovery-*): raw HLS merge = 1191 frames > audio
   → renderer `-shortest` trimmed (G-T1 fail); the fix mirrors the original
   normalize: video copy `-frames:v 1190` + audio `apad` to 47.62s so the
   frozen bit-exact encoder passes all 1190 frames with Δdur 20ms. The engine
   was NOT modified (contract frozen) — the substrate adapts to the engine.
3. **All five wave-1 renders re-run** on the recovery substrate (staged
   foreground jobs; background processes DO survive in this sandbox — the
   wave-1 reaper lesson no longer applies): b8 triple-render determinism
   byte-identical for all four full realities.
4. **Hard gates re-measured** (real numbers, recovery substrate):

   | Reality | G-T1 | G-T2-det | G-T2b deep | G-T3 | G-T4 | Determinism |
   |---|---|---|---|---|---|---|
   | cartoon-cel | PASS 1190=1190 Δ20ms | FAIL-det 0.833 (known) | **PASS 1.0, 0 invented** | 0.9767 | 0.40% (base 0.46%) | byte-identical ×3 |
   | anime-npr | PASS | PASS | PASS | 0.9815 | 0.39% | byte-identical ×3 |
   | noir-retro (noir) | PASS | PASS | PASS | 0.9934 | 0.48% | byte-identical ×3 |
   | motion-trails | PASS | PASS | PASS | 0.8969 | 0.53% | byte-identical ×3 |

   The cartoon T2-det finding reproduces EXACTLY (cut at frame 550: input
   20.09 → output 15.85 = 79% amplitude; frame 934's "invented" flag resolved
   by input-amplitude correspondence — input spikes 51.5 there, cartoon
   carries 49.2). The prior session's diagnosis is now codified as the durable
   repo gate `scripts/source-preserving/cuts_deep.py` (the old one lived only
   in my-project/scripts and died with the sandbox).
5. **Product surface rebuilt and browser-verified** (`/home/z/my-project`,
   route `/`): Realities Lab — player with position-preserving reality
   switching (t carried exactly across switches; play state preserved under
   real gestures), hold-to-compare (mousedown=original / mouseup=back),
   per-reality gate chips, frame-comparison strip, provenance panel; manifest
   via `/api/spr/manifest` (enriches renders.json + QA gates); media from
   `/media/spr/**`. Agent-browser E2E green: manifest 200, all 6 cards, all
   artifacts 200/206, zero console errors, zero failed resources, no mobile
   overflow, footer sticky/push correct. One real bug found and fixed in
   verification (the API route never mapped `playbackUrl` — the page silently
   fell back to the original for every reality; exactly the class of defect
   browser verification exists to catch).
6. **VLM still 429-quota-exhausted** (persistent across the session). The
   scorecard harness is now a durable repo script
   (`scripts/source-preserving/vlm_scorecard.py`, retry/backoff, honest
   quota-exhausted verdicts) — run it when quota returns; Tier-2 assignment
   remains blocked on it + TL visual approval.
7. **Corpus rebuilt** (`/home/z/spr-evidence/benchmarks/corpus.json`): b8
   (recovery), b1 (re-cut prefix), b12 determinism cut (cut-rich window
   1838.32–1850.32s containing source cuts 862/979/982). b5 + b2-b7 remain
   wave-2 acquisitions.
8. **Push NOT possible from this sandbox** (no PAT in env; `git push` →
   could-not-read-username). Commits are local; the operator must re-inject
   the PAT (or push manually) for the next GitHub sync. Recorded honestly.

### Wave-1 ledger (session w6-spr-1, superseded machine paths)

| Area | State | Evidence |
|---|---|---|
| SPR001 contract freeze | DONE | ADR-012, architecture, contract, work-items, benchmark, acceptance docs |
| SPR002 research | DONE (worker spr-w1-a) | docs/research/source-preserving-technology-landscape.md (877 lines), docs/technology/source-preserving-candidates.yaml (963 lines, 63 searches) |
| SPR003 corpus | PARTIAL | /home/z/spr-evidence/benchmarks/corpus.json — b1/b5/b8 on disk; b2-b7 PENDING (dispatch OOM) |
| SPR004 engine SPE-v1 | DONE (TL emergency implementation) | scripts/source-preserving/ (render.py + spe/ + wave1_render.py + rebuild_renders.py) |
| SPR101/102/108/201 renders | DONE — real artifacts | /home/z/spr-evidence/render/renders.json (5 realities, b8 full + b12 + triple-render determinism proofs) |
| SPR005 QA harness | DONE + RUN | scripts/spr-qa-metrics.py (adopted worker-B qa_check), spr-qa-cuts-deep.py, spr-qa-vlm.mjs, spr-qa-scorecard.mjs; metrics JSONs in qa/ |
| Product surface | DONE + browser-verified | /home/z/my-project (page.tsx Realities Lab, /api/spr/manifest, /media/spr/**) |
| VLM scorecards | PARTIAL — quota exhausted | 1/15+ calls landed (cartoon t2); harness has retry/backoff; re-run pending quota reset |
| Tier gates | Tier 1 badges shown; Tier 2 PENDING VLM scorecards + TL approval | manifest tierLabel "Usable (QA pending)" |

## Hard-gate results (b8, real measurements)

| Reality | G-T1 timeline | G-T2 cuts | G-T3 motion r | G-T4 flicker | G-T2b deep cuts | Determinism |
|---|---|---|---|---|---|---|
| cartoon-cel | PASS (1190=1190, Δ3ms) | FAIL-det (0.833 coverage — boundary artifact) | 0.9832 | 0.40% (baseline 0.46%) | **PASS 1.0 coverage, 0 invented** | b12 triple-render byte-identical |
| anime-npr | PASS | PASS | 0.9869 | 0.41% | PASS | byte-identical |
| noir-retro (noir) | PASS | PASS | — | — | pending | byte-identical |
| motion-trails | PASS | PASS | — | — | pending | byte-identical |

G-T2 cartoon finding (recorded, not hidden): the detector's flat threshold (16.0)
missed the stylized cut spike at frame 550 (15.9 vs original 20.1 — the cut IS
preserved at 79% amplitude) and flagged frame 934 whose identical spike exists in
the input (51.4). The deep correspondence gate (scripts/spr-qa-cuts-deep.py)
proves all 6 input cuts preserved, 0 invented — with per-cut numbers in
qa/cuts-deep-cartoon-cel.json. The raw G-T2 JSON is preserved untouched.

## Substrate (real, provenance-chained)

- b8 in-play Original (w6-spr-1, LOST to the reset): a13396ec… — superseded
  by the recovery substrate below; the wave-1 render artifacts of that
  substrate are likewise superseded (their shas in the wave-1 ledger no
  longer resolve on disk).
- b8r3 in-play Original (w6-spr-2, CURRENT):
  `/home/z/spr-evidence/bytes/b8p3.mp4` (47.62 s, 640×360, 25 fps, 1190
  frames, sha256 969af7c6…, window 1803.84–1851.44 s, same 6 cuts — corpus
  entry `sprclip-b8-inplay-original`).
- b5's 86 s window pull (1979–2213 s): LOST — re-acquire in wave 2.

## Wave-1 incidents (recorded honestly)

1. **Agent dispatch OOM**: subagent runtimes (bun, ~2 GB RSS) are OOM-killed by
   the 4 GB sandbox while Chrome + dev servers + replay stack run — all Worker
   B/C dispatches failed with "context deadline exceeded". Worker A completed
   BEFORE the ceiling bit; one Worker B retry ran partially (06:40–08:15, its
   artifacts quarantined at render/_worker-b-quarantine/, its gates-checker
   qa_check.py ADOPTED as spr-qa-metrics.py, its render_all.sh determinism
   design acknowledged). TL emergency-implemented Worker B's packet and the
   harness portions of Worker C's.
2. **Background-process reaper**: this sandbox kills processes spawned by the
   tool shell at command boundaries (even setsid+nohup) — all renders were run
   foreground in staged jobs (wave1_render.py cartoon|anime|noir|trails).
3. **:3000 swap**: the R606 replay console held :3000 (with a watchdog ring
   guarding it). The SPR mandate + this session's surface rules required
   my-project on :3000; the watchdog ring was repointed (launch_dev.py →
   my-project; supervisor identity marker → "Source-Preserving Realities Lab";
   squatter-keep condition → my-project). The replay infrastructure
   (replayd :3100, Chrome CDP :9222, supervisor/watcher) remains intact.
4. **VLM quota exhaustion** (TL debugging + runaway worker's calls): scorecard
   VLM calls 429-rate-limited at wave end; re-run pending.

## Relationship to other lanes

- R606 (reconstruction): OPEN, unchanged — calibration stage (W303 lane).
- R607: not advanced (unchanged rule).

## Next executable work

0. **PAT re-injection** (operator): local main = wave-2 closure (`2b35368`:
   B+C merged, byte-verified). Push to GitHub when credentials return;
   wave-3 worker dispatch unblocks with it (the transient push token is
   embedded in work orders at dispatch time).
1. **Wave-3 dispatch (PAT-gated)** — work orders authored, ready to dispatch
   from the replay: (a) substrate fix: b1 apad re-cut + b12 metadata/apad
   normalization + corpus SHA re-lock + affected re-renders (resolves the 5
   b1 T1 fails/qa crashes — F1 — and retires w2c's derived gate references);
   (b) subject-toon promotion to first-class reality + formal frozen-protocol
   Tier-2 scorecards for the three trial candidates (+ b5/b6 noir-vhs T3
   root-cause diagnosis — F4); (c) b4 final sweep: goal-timestamp-targeted
   windows with the hard reclassify-to-montage gate (decision 3 above).
2. SPR103/104/107/109/202/205 per the work-items doc.
3. Video-based temporal audit (Tier-3 groundwork): the frame-pair temporal
   axes are recorded as a limitation; full-video review would replace the
   0.2 s pair judgment.
