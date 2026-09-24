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
| R606 | REOPENED — IN-PLAY REVALIDATION RUN INGESTED (pre-match pack superseded; calibration = the identified stage to fix) | 2026-09-23 (operator, session web-ffe07d67): the prior pack's derived realities were PRE-MATCH defaults (0-0 PRE / 00:00, lastEventSequence 0 — the 57.84–105.28s window was pre-kickoff) → the gate was REOPENED with the directive: regenerate the whole chain from a contiguous in-play section beginning at/after source media time 30:00. 2026-09-24: **the in-play run is INGESTED** — new bytes (2,707,829 B, sha 0d0e315a…) from media 1803.84–1851.44s (the first whole segment boundary at/after 30:00; 9 whole itag-230 segments + the itag-140 audio at the same window; VLM-verified in-play: BET 1-2 BAR ~24', 12–18 players), new registration urlreg-128b8b8a…, new session sess-u-edaddae6… (nothing inherited; a 55s first attempt OOM-killed the 4GB sandbox at 1.75GB RSS — 47.6s/1190 frames is the practical envelope). The stage ladder (manifests/diagnostic-ledger.json in the new pack): acquisition PASS · normalization PASS (Original a13396ec…) · player/ball perception PASS (18.86 det/frame, 448 tracks, ball 494 pts, 345 team-labeled) · **CALIBRATION FAIL — the earliest incorrect stage** (line-based: 0 line evidence, its documented near-axis-aligned envelope excludes real broadcast perspective; honest refusal) · event reconstruction BLOCKED (possession needs pitch meters) · SWM PARTIAL (real in-play entities in image frame) · renderer consumption PASS mechanically. Per the operator's failure-handling directive the fix is at the calibration stage (the W203→W303-class real line detector); measured design notes + the calibration-ideal window (media 1979–2065s, ~86s stable single-camera open play) are recorded in the pack. The pre-match pack is labeled SUPERSEDED (kept intact). Packs: `/home/z/w6-real-r606-inplay-evidence/` (current) · `/home/z/w6-real-r606-evidence/` (superseded). The operator's earlier verdict-STATE stands (technical execution PASS; the VPN-egress ratification ask is unchanged). R606 remains OPEN until the in-play pack passes the human visual gate (which requires the W303 calibration fix first)
| R607 | BLOCKED | public hosted durability/cross-instance deployment and final MVP gate remain; gated behind real-source R606 |

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
   pack) before the human visual gate can pass on in-play evidence;
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
