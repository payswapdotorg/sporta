# SPR-W2-A — b4 (crowd) resolution: WIDER SAMPLING + DIRECT VERIFICATION

Session: w2a (lane A — acquisition), 2026-09-24. Source (frozen): the LALIGA
2025/26 MD15 full-match upload `watch?v=93LPZJkCW2w` (~6591 s, itag 230
640×360 HLS + itag 140-5 audio), acquired through the recorded chain
(bgutil PO-token provider :4416, TLS relay 127.0.0.1:8128 → gost
`a996d235.acsnet.co:443`, DE exit 169.150.210.53, credentials per
`docs/status/session-log.md`).

## RESULT: b4 NOT FOUND — honest negative (this is a complete delivery)

After 16 NEW sampling windows (~1520 s of previously unsampled coverage)
and direct per-frame verification of every crowd-flagged candidate, **no
8–12 s crowd-dominant passage exists in the sampled material**. The
broadcast's world feed cuts crowd shots at **2–7 s**; the longest
directly-verified crowd-dominant run is **~6.5 s** (media 4232.9–4238.4).
b4 remains honestly PENDING (corpus.json note updated). Do not fabricate.

## 1. Sampling (wider, disjoint from the 9 recorded windows)

Prior sessions sampled ~774 s (media 300/900/1979/2065/3300/3500/4600/
5000/5800) — none resampled here. The 3500-area audio dead zone was avoided.

16 sampling windows (+1 boundary-extension pull `w4160-wide` used only to
bracket candidate runs; its non-overlapping part adds 39.4 s):

| window | true media range | dur | | window | true media range | dur |
|---|---|---|---|---|---|---|
| w0150 | 147.72–241.64 | 93.9 | | w3900 | 3896.84–3988.84 | 92.0 |
| w0450 | 449.60–538.84 | 89.2 | | w4200 | 4196.32–4286.68 | 90.4 |
| w0600 | 595.68–691.12 | 95.4 | | w4500 | 4495.84–4587.84 | 92.0 |
| w1200 | 1198.64–1290.84 | 92.2 | | w5400 | 5398.84–5490.16 | 91.3 |
| w1500 | 1497.84–1591.92 | 94.1 | | w5500 | 5495.96–5586.84 | 90.9 |
| w2400 | 2397.40–2490.84 | 93.4 | | w5950 | 5948.84–6042.84 | 94.0 |
| w2700 | 2696.84–2792.84 | 96.0 | | w6200 | 6196.84–6287.84 | 91.0 |
| w3000 | 2996.84–3090.84 | 94.0 | | w6350 | 6347.84–6438.84 | 91.0 |

Total NEW coverage ≈ **1520 s** (≥ 900 s required; ≥ 12 windows required).
Grids: **80 timestamped 4×5 JPEG grids** in `grids/` (5 per window, media
timestamps burned into every cell). Window maps (exact segment math):
`verification/windows/`.

## 2. Candidate extraction (grids are hints only — they over-call)

Strict per-cell VLM classification of all 80 grids (~1220 cells; class
histogram: wide-broadcast 721, closeup 281, pitch-action 177, graphics 31,
**crowd 26**, other 1) flagged 26 crowd cells, clustering into **5 candidate
passages**: w2700 (~t2721/2726), w3000 (~t3022), w4200 (~t4196 window start
and ~t4236), w5500 (~t5556). Raw grid classifications:
`verification/grid-vlm/`. Note: two grid responses contained 24 entries for
20-cell images (numbering overflow past cell 20) — the overflow entries
mapped onto the next grid's cells and were resolved against that grid's own
response before candidate selection.

## 3. DIRECT verification (the discipline) — all 5 candidates REJECTED

Every candidate was re-pulled from the actual window footage and verified
**per frame** (1 fps, single-image VLM calls, strict prompt: YES only when
spectators/stands occupy more than half the frame). Canonical verdicts use
**seek-free extraction** (full sequential decode + `select` by frame index)
because TS seeks on the concatenated VBR segment files land seconds off
(see §5). Verdict files: `verification/candidates/`.

| cand | true media (seek-free) | crowd-dominant run | verdict |
|---|---|---|---|
| C1 w2700 | 2716.8–2732.8 | 2 s @ ~2720.8 + 3 s @ ~2725.8 (2 separate cutaways; coach close-up between) | **REJECTED** <8 s, fragmented |
| C2 w3000 | 3017.8–3028.8 | 3 s @ 3021.8–3023.8 (bracketed) | **REJECTED** <8 s |
| C3 w4200-start | 4189.9–4208.9 | 4 s @ 4195.9–4198.9 + 3 s @ 4201.9–4203.9 (coach close-up between) | **REJECTED** <8 s, fragmented |
| C4 w4200-mid | 4221.9–4244.9 | ~6–6.5 s @ 4232.9–4237.9 (NO at 4231.9 and 4238.9 — bracketed both sides) | **REJECTED** <8 s |
| C5 w5500 (post-match) | 5551.0–5562.0 | ~5.5–6 s @ 5552.96–5557.96 (NO at 5551 and 5559 — bracketed) | **REJECTED** <8 s |

Independent arbitration: a neutral (non-verdict) VLM description of the
disputed frame at media 5555.96 confirmed "frame is filled with spectators
… largest share occupied by the people in the crowd" — matching the
canonical YES verdicts.

4 VLM calls failed after retries and are recorded as `ERROR` in the verdict
files (C1 @2723.8/2724.8 — both between NO-bracketed neighbors; C3
@4207.9/4208.9 — after all runs closed). None affects any rejection.

## 4. Conclusion

Combined with the prior 9-window session (~774 s), ~2294 s of this broadcast
has now been sampled with direct verification discipline. **Every verified
crowd-dominant run is 2–7 s.** The world feed never holds a crowd shot for
8 s. Recommendation for the lead: (a) goal-timestamp-targeted sampling
(crowd cutaways cluster right after goals — a longer celebration B-roll
might exist exactly there), or (b) a category decision (accept the longest
verified ~6.5 s passage as a shorter b4, or redefine b4 as a
crowd-containing montage — a corpus-definition call, not an acquisition
call). No clip was assembled; nothing was committed except grids, JSONs and
this record.

## 5. Method incidents (recorded for the audit trail)

1. **TS seek imprecision**: ffmpeg input-seeks on the concatenated VBR
   MPEG-TS windows land seconds away from the requested time (no seek
   index; bitrate interpolation). Detected via contradictory verdicts at
   identical nominal times across two windows whose overlapping content
   was pixel-verified identical (mean absdiff 0.0). Fix: all canonical
   verifications use seek-free extraction (`-i window.ts -vf
   "fps=1,select=between(n,A,B)"`, labels derived from the exact segment
   math in the window maps).
2. **Multi-image VLM batching mis-attribution**: batch-of-4 verification
   calls mis-assigned verdicts on near-identical sequential frames (every
   4th answer unparsed; contradicted by single-image calls on identical
   pixels). Fix: one image per call for all verdicts.
3. **Stale-output-file bug (429 poisoning)**: the verifier read
   `/tmp/vlm-single-out.json` without unlinking it first; a 429-failed
   call returned the PREVIOUS frame's verdict (three runs — `c5pre`,
   `c5dense`, `verify2/w5500` — emitted identical reasons across all
   frames; caught when a poisoned NO contradicted a neutral description of
   the same frame). Fix: unlink-before-every-attempt + reason-variety
   audit. Poisoned runs preserved in `verification/invalidated/`;
   pre-fix genuine-but-seek-shifted runs in `verification/prefix-superseded/`.

## 6. Acquisition chain deviation (recorded honestly)

ffmpeg's own HLS pull through the TLS relay ran at ~90 KB/s in this sandbox
generation (per-segment CONNECT setup), making 13+ window pulls
impractical. Windows were therefore fetched by a parallel segment fetcher
over the SAME relay→gost egress (6 concurrent CONNECT tunnels, per-segment
retry, raw MPEG-TS concatenation — segments have no EXT-X-MAP). Content
provenance is unchanged (same itag-230 HLS, same proxy exit, exact segment
time math in the window maps); only the transport scheduling differs.
PO-token provider + relay + proxy auth verified live (exit IP
169.150.210.53 = the recorded DE exit).

Approximate call budget: ~350 VLM calls total (80 grid classifications +
~270 per-frame verifications including invalidated/superseded runs), 429
rate-limit backoffs dominated verification wall time.
