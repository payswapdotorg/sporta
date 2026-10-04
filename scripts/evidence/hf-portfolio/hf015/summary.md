# HF015 — the Technology promotion gate (the Tech Lead's flight)

**Verdict: the gate DELIVERED as fail-closed machinery (self-tests 6/6 exact) + the full-portfolio adjudication EXECUTED (15 ledger rows, 15 PROMOTION-REFUSED, 0 eligible) — the honest NO-PROMOTION posture, machine-checked against the recorded evidence. NO model ran; NO state changed; the ledger is FROZEN and untouched.**

## The acceptance (verbatim)

> "only candidates with benchmark, resource, provenance/license, reproducibility and failure evidence can move from candidate to benchmarked/canary/production."

## The state ladder (the ledger contract)

`candidate` (or `watchlist`) → `benchmarked` → `canary` → `production`. Nothing starts promoted; only HF015 (Tech Lead) can promote. The ledger is FROZEN — this gate RECORDS adjudication, never mutates state. A promotion requires ALL FIVE evidence legs; any promotion-ELIGIBLE finding would refuse the gate's exit 0 and force an explicit TL execution flight (none occurred).

## The five evidence legs (machine-checked against the recorded evidence — never hardcoded claims)

1. **benchmark** — the candidate's flight record exists AND carries an EXECUTED run: no `typedRefusal`, the `quality` block carries at least one MEASURED number (top-level or nested — the fabrication-guard inverse).
2. **resource** — no `resource-infeasible-host` refusal recorded AND the `latency` block carries a measured number (the resource story executed, not typed).
3. **provenance-license** — the ledger row: `commercialUse === "yes"`, permissive `modelLicense` (apache-2.0/mit/cc-by-4.0 — the contract's own derivation classes), `codeLicense !== "unknown"`; the flight's recorded license posture (where one exists) not research-only/watchlist-pending-terms — scoped EXACTLY per-candidate (a multi-candidate posture map is checked per-key: one candidate's blocked class never contaminates another's permissive verdict); the row recorded within the 7-day re-verification window (the ledger's own currency rule).
4. **reproducibility** — a 40-hex pinned revision AND the flight's benchmark-record.json + record-benchmark.ts resolve on disk (the re-runnable harness).
5. **failure** — the failure envelope RECORDED (`promotionGate.blockersObserved`) AND EMPTY: a recorded unresolved blocker STANDS until re-verified resolved (a flight's own recorded refusal of promotion is evidence against the promotion, never a formality). No flight = no envelope = fail-closed.

## The adjudication (the honest verdicts — `results/adjudication.json`)

| Candidate | Failed legs | The honest story |
| --- | --- | --- |
| RF-DETR | provenance-license, failure | EXECUTED benchmark (hf003); codeLicense unknown + the 3 standing blockers (no ground-truth-annotated real clip; CPU latency ~3 s/frame = 2 orders above the current detector; SoccerNet lineage unresolved) |
| Spivak | failure | EXECUTED benchmark (hf006); the 4 standing blockers (no event ground truth; zero detections at the card's threshold on the only reachable clips; the UNFAVORABLE CPU cascade ~876 ms/s vs ~740 ms/s; the archived TF/Keras-2-era stack) |
| MapAnything, SoccerChat, VibeVoice, Qwen3-ASR, pyannote, Wan2.2-Fun, ReCamMaster, ViewCrafter, Wan2.2-Animate | benchmark, resource, failure | the typed-refusal class (resource-infeasible / auth-gated / NDA) — zero executed evidence + the standing blockers |
| Meridian | + provenance-license | research-only (minimax-h3-community-license + the gated FAIR-Noncommercial VGGT-Omega) |
| LTX-2.3 | + provenance-license | watchlist-pending-terms (the governing-agreement open edge; codeLicense NOASSERTION) |
| SAM3, DA3-GIANT | all five | no flight at all; unclear/non-commercial licenses; the watchlist posture |

**The path to promotion is the blockers themselves**: resolve EVERY standing blocker with NEW recorded evidence (the adequate-host execution ≥32 GiB/64 GiB/CUDA; the license-term resolutions; the auth-gate unblocks; the ground-truth provisioning), then re-run the gate.

## The machinery self-tests (`results/gate-self-tests.json` — SYNTHETIC only, never candidates)

- The fully-evidenced SYNTHETIC request PASSES all five legs — the gate is proven NOT a blanket refuser: it CAN pass a candidate that arrives with the full evidence chain.
- Five single-leg-missing variants are each REFUSED with EXACTLY that leg's typed blocker (benchmark / resource / provenance-license / reproducibility / failure) — the legs check independently.
- Exit 0 ONLY IF: all self-tests exact AND every ledger row adjudicated AND zero promotion-eligible findings (fail-closed on eligible rows — a promotion requires an explicit TL execution flight, never this script).

## TL gates

`bun scripts/evidence/hf-portfolio/hf015/promotion-gate.ts` → exit 0 (self-tests 6/6; 15 rows; 15 refused; 0 eligible). The adjudication re-verified per-candidate (the posture scoping bug found + fixed during the TL's own review: the first whole-file heuristic wrongly blocked ReCamMaster on Meridian's research-only verdict — the per-key scoping now matches the recorded per-candidate verdicts exactly). Prettier/eslint/typecheck: run at commit.
