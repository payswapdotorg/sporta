# Sporta — Tech Lead Delivery Report (HF015, flight 12 — the TL's own flight)

Branch: `work/hf015-promotion-gate` (from main @ e50a55f)
Work item: HF015 — Technology promotion gate (Owner: Tech Lead)
Evidence tree: `scripts/evidence/hf-portfolio/hf015/` (committed in-repo)
Execution record: `results/adjudication.json` (15 ledger rows, 15 PROMOTION-REFUSED, 0 eligible) + `results/gate-self-tests.json` (6/6 exact, SYNTHETIC requests only)

=== HF015 PROMOTION GATE REPORT ===

## The verdict

The gate DELIVERED as fail-closed machinery + the full-portfolio adjudication EXECUTED: **15 ledger rows, 15 PROMOTION-REFUSED, 0 eligible — the honest NO-PROMOTION posture, machine-checked against the recorded evidence.** NO model ran; NO state changed; the provenance ledger is FROZEN and untouched (the gate records, never mutates). The acceptance (verbatim): "only candidates with benchmark, resource, provenance/license, reproducibility and failure evidence can move from candidate to benchmarked/canary/production."

## The five evidence legs (machine-checked against the per-flight records — never hardcoded claims)

1. **benchmark** — the flight record carries an EXECUTED run (no typedRefusal; measured quality numbers, top-level or nested).
2. **resource** — no resource-infeasible-host refusal; measured latency numbers (the resource story executed, not typed).
3. **provenance/license** — commercialUse "yes" + permissive modelLicense + codeLicense not "unknown" + the recorded license posture not research-only/watchlist-pending-terms (scoped EXACTLY per-candidate) + the 7-day ledger currency window (the contract's own "current and re-verified" rule).
4. **reproducibility** — a 40-hex pinned revision + the flight's benchmark-record.json + record-benchmark.ts resolve on disk.
5. **failure** — the failure envelope RECORDED (promotionGate.blockersObserved) AND EMPTY — a recorded unresolved blocker STANDS until re-verified resolved; no flight = no envelope = fail-closed.

## The adjudication highlights (results/adjudication.json)

- **RF-DETR** (executed hf003): refused on provenance-license (codeLicense unknown) + failure (3 standing blockers: no ground-truth-annotated real clip; CPU latency ~3 s/frame = two orders above the current detector; SoccerNet lineage unresolved).
- **Spivak** (executed hf006): refused on failure ONLY — the 4 standing blockers (no event ground truth; zero detections on the only reachable clips; the UNFAVORABLE CPU cascade ~876 ms/s vs ~740 ms/s; the archived TF/Keras-2 stack).
- **The 9 typed-refusal candidates** (MapAnything, SoccerChat, VibeVoice, Qwen3-ASR, pyannote, Wan2.2-Fun, ReCamMaster, ViewCrafter, Wan2.2-Animate): refused on benchmark + resource + failure (zero executed evidence + the standing blockers).
- **Meridian** + **LTX-2.3**: additionally provenance-license (research-only; watchlist-pending-terms — the governing-agreement open edge).
- **SAM3** + **DA3-GIANT**: all five legs (no flight; unclear/non-commercial licenses; the watchlist posture).
- **The path to promotion is the blockers themselves**: resolve EVERY standing blocker with NEW recorded evidence (the adequate-host execution, the license-term resolutions, the auth-gate unblocks, the ground-truth provisioning), then re-run the gate.

## The machinery self-tests (SYNTHETIC only — never candidates)

- A fully-evidenced SYNTHETIC request PASSES all five legs — the gate is proven NOT a blanket refuser (it can pass a full-evidence chain).
- Five single-leg-missing variants each refused with EXACTLY that leg's typed blocker.
- Exit 0 only if: self-tests exact + every row adjudicated + zero promotion-eligible findings (an eligible finding would refuse exit 0 and force an explicit TL execution flight — none occurred).

## The TL's own review caught one real bug (recorded honestly)

The first posture heuristic (whole-file text scan) wrongly blocked ReCamMaster on Meridian's research-only verdict (both appear in hf010's multi-candidate posture file). Fixed to per-candidate scoping (the `candidates` map checked per-key; single-candidate files whole). The final adjudication matches the recorded per-candidate verdicts exactly — verified row by row.

## Limitations + what promotion would actually take

No promotion anywhere (the machine-checked posture). The adequate-host question (≥32 GiB RAM / ≥64 GiB disk + CUDA) remains an operator action; the license open edges (Meridian's community license + gated VGGT-Omega; LTX-2.3's governing-agreement ambiguity; RF-DETR's SoccerNet lineage; the datasetProvenance-unknown open edges) remain human-review inputs recorded by the flights. The gate re-runs on demand: `bun scripts/evidence/hf-portfolio/hf015/promotion-gate.ts`.

=== END REPORT ===
