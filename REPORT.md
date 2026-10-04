# Sporta — Worker Delivery Report (HF005, flight 13 — the last unstarted portfolio item)

Branch: `work/hf005-sam3-benchmark` (from main @ 86f3d4f)
Work item: HF005 — SAM3 segmentation/tracking benchmark (Owner: Worker A; verbatim acceptance: "controlled gated benchmark; explicit license review; compare identity continuity and latency; remain research/watchlist unless production-safe.")
Evidence tree: `scripts/evidence/hf-portfolio/hf005/` (committed in-repo; the fetches are the three bounded text documents with fetch-meta)
Execution record: `results/preflight-refusal.json` (the executed typed refusal, exit 3) + `results/license-posture.json` (13 machine-verified citations) + `results/metric-selfcheck.json` (18/18 hand-computed cases) + `results/contract-compatibility.json` (machine-checked, exit 0)

=== HF005 BENCHMARK REPORT ===

## The verdict

SAM3 (facebook/sam3 @ 3c879f39826c281e95690f02c7821c4de09afae7) is **MANUAL-GATED on the HF Hub AND resource-infeasible on this CPU host** → the honest delivery is the **typed refusal (`auth-gated-model+resource-infeasible-host`, exit 3, EXECUTED)** + the substantial partial: the explicit license review (first-class), the load analysis, the identity-continuity + latency metric designs (implemented, self-checked, typed not-measured), the comparison design vs the repo's current path, and the machine-checkable contract mapping. **NO promotion**: gatingState stays `candidate`; the HF015 gate (merged at main) owns adjudication — its standing SAM3 row refused all five legs.

## The gated probe (EXECUTED — the hf009 convention, bounded)

The anonymous `Range: bytes=0-0` probe map at the PINNED revision (the pinned sha IS the repo HEAD — no drift):

| file | status | verdict |
| --- | --- | --- |
| model.safetensors (3,439,938,512 B) | 401 `x-error-code: GatedRepoError` | GATED — "Access to model facebook/sam3 is restricted. You must have access to it and be authenticated to access it. Please log in." |
| sam3.pt (3,450,062,241 B) | 401 GatedRepoError | GATED |
| config.json | 401 GatedRepoError | GATED |
| README.md | 206 | public-reachable |
| LICENSE | 206 | public-reachable |

The API metadata says `gated: "manual"` — the SAM License acceptance WALL. The card's gate form demands First Name / Last Name / Date of birth / Country / Affiliation / Job title / geo `ip_location` + the accept-the-license checkbox, with the data "collected, stored, processed and shared in accordance with the [Meta Privacy Policy]". Accepting is a HUMAN action; no HF token exists in this sandbox. **Weights never downloaded, never committed, never vendored — and NO third-party mirror used** (an unofficial re-upload would launder the acceptance wall). The code-repo license probe (GitHub raw) is public-reachable (200) — the codeLicense source.

## The explicit license review (FIRST-CLASS — the acceptance's own words)

Fetched bounded (the ONLY full fetches; sha-pinned + fetch-meta): the SAM License at the pinned revision (7,352 B), the code-repo LICENSE (7,353 B — the SAME agreement, trailing-newline-only difference), the model card (26,038 B). **13 verbatim citations, each machine-verified against the fetched text** (the script fails closed if a quote is absent). The recorded terms:

- **§1a** grants a "non-exclusive, worldwide, non-transferable and royalty-free **limited license**" — no field-of-use restriction, no revenue threshold, and **no express commercial-use permission either** → the ledger's commercialUse `unclear` is **CONFIRMED** ("YOU ARE SOLELY RESPONSIBLE FOR DETERMINING THE APPROPRIATENESS OF USING OR REDISTRIBUTING THE SAM MATERIALS", §3).
- **§8**: "Meta may modify this Agreement from time to time … **All such changes will be effective immediately.** Your continued use … constitutes your agreement to such modification." — the strongest production-continuity risk in the recorded terms.
- **§6**: termination forces "you shall delete and cease use of the SAM Materials" (plus §5b's patent-style termination-on-litigation and a licensee **indemnification of Meta** for third-party claims).
- **§1b**: redistribution only under this Agreement + a copy with it; publication acknowledgment; no reverse engineering; trade controls / ITAR / military / warfare / nuclear / espionage / weapons prohibitions. **NO separate acceptable-use attachment** (unlike LTX-2's Attachment A).
- **§5a** (the friendliest clause): the licensee owns their own derivatives/modifications — still inside the custom agreement. California law + exclusive jurisdiction (§7).
- The access gate itself is an identity-attestation arrangement with Meta Privacy Policy data-sharing — an operator decision, never a worker decision.
- SA-CO (270K unique concepts) is the EVAL benchmark introduced with the model; the card names NO training corpus (the dataset leg stays unknown).

**License verdict: research/watchlist — production-safe NOT proven by the recorded terms.** The acceptance's own bar ("remain research/watchlist unless production-safe") binds: the terms affirmatively delegate the production judgment to the licensee and reserve unilateral modification + termination-with-deletion. Argued from recorded terms only; never legal advice; never a promotion.

## The load analysis (bounded metadata — the pinned-revision composition)

860M F32 parameters: `model.safetensors` 3.204 GiB + `sam3.pt` 3.214 GiB (**two serialization formats of the SAME checkpoint**; the pinned tree totals 6.422 GiB) + the tokenizer/config (~1 MiB). The minimal working set (ONE checkpoint + the ~0.6 GiB torch/transformers baseline, an ESTIMATE labeled as such) = **~3.79 GiB vs 3.95 GiB TOTAL RAM / 2 vCPU Xeon / no GPU** — the weights alone are ~81% of TOTAL RAM, before activations and the video session's frame store (the card's recipes are GPU-first, bfloat16). Host facts MEASURED at preflight (RAM/disk/CPU/GPU recorded in `results/load-analysis.json`; the earlier flights' ~1.1 GiB disk note recorded alongside the measured 6.82 GiB — the primary refusal is the auth wall in any case).

## The identity-continuity + latency metric designs (typed not-measured, self-checked)

- **Identity continuity** — the W204 semantics VERBATIM (`packages/perception-tracking/src/benchmark.ts`): `identitySwitches` (consecutive-pair trackId changes summed over GT objects), `continuityScore` (identityPreservingPairs/totalPairs), `fragmentationMeanTracksPerObject` — implemented as pure functions + the `sam3-<id>` EntityId bridge (SAM3's int object_ids → the repo's `[A-Za-z0-9_-]{1,64}` vocabulary, the R207 seam shape). **18 hand-computed cases, ALL PASS** (the id-change case, the two-object swap case, the occlusion-fragmentation-vs-survival pair, the bridge cases, the latency arithmetic, the cascade ratio). The placeholder numbers are labeled **NOT measurements**.
- **Latency** — per-frame wall-clock per stage + FPS + realtimeFactor vs the source 25 fps + the **cascade cost** (SAM3's one model forward per frame MINUS the repo's current W201 detection + W204 association per-frame cost, on the SAME frames). The formulas self-checked (cases 5/6).
- **The comparison design** (`results/tracking-comparison.json`): SAM3 (video PCS text prompts / tracker PVS box prompts) vs the repo's current path (W201 contrast-context detector + W204 greedy-IoU tracker) on the **same authorized fixtures** — the sha-pinned SPR corpus clips (b8p3 in-play, b1 wide, b2 closeup, b3 fast-action) under the R606 registration declaration. The prompt-supply answer: **the repo's chain supplies the W201 detections as box prompts (denormalized xyxy) and/or the text concept "football player"**. The GT honesty: NO per-player identity annotations exist in the repo (the hf009 precedent) — the design records BOTH honest options (operator-provisioned GT; the relative cross-mode continuity score), never a fabricated GT.

## The contract mapping (machine-checkable, exit 0)

`contract_compatibility.ts` (9 repo authorities needle-verified: the FROZEN task profiles, observation.ts, identity.ts, the W204 tracker + benchmark, rights.ts, the fetched card) → 6 mapping rows: **COMPATIBLE-WITH-MAPPING** for both profiles' input/output shapes, with the typed gaps machine-verified:

- **the observation payload union has NO mask kind** (detection | track | transcription | field-mapping | generic | team-assignment — machine-checked absence): a segmentation output needs a NEW typed payload variant (a FROZEN-contract decision this flight records, never makes);
- the segmentation profile's "optional prompts/identifiers" identifier half has NO SAM3 counterpart (no jersey/player-identity surface);
- MOTA/HOTA need GT (absent); SAM3's object_ids carry no class label (the concept IS the prompt — the label comes from the chain);
- **rights-provenance: NOT production-eligible by recorded terms** — the code and model legs are the SAME custom non-permissive agreement; the dataset leg unknown; commercialUse unclear (the three-way license record per ADR-011, the candidates.ts precedent);
- execution REFUSED (the auth gate + the resources); SAM3's outputs are OBSERVED vision observations (no evidence-chain boundary crossed — unlike HF013's generated-audio exclusion).

## The ready-to-run path (fail-closed, negative-tested)

`benchmark_sam3.py --mode full --model-dir <authorized-dir>` refuses exit 3 on THIS host (no authorized model dir; RAM < 2x the working set; 2 vCPU) — **all three modes executed**: preflight exit 3 (the refusal), selfcheck exit 0 (18/18), full exit 3 (the fail-closed negative test). For an authorized + adequate host: the operator accepts the SAM License (a human action — the identity-attestation form), downloads the checkpoint at `3c879f39…` OUTSIDE this repo, then re-runs; the fixtures are sha-pinned in-repo, the metrics self-checked, and the validator pins any executed number exactly as HF003/HF006 did.

## The guard batteries

- `record-benchmark.ts` — EXECUTED exit 0: the ledger echo VERBATIM (12 fields); no promotion (gatingState `candidate` + the HF015 standing verdict); the typed refusal pinned to the EXECUTED preflight; the fabrication guard (recursive scan refuses any measurement-shaped key in the benchmarkRun) — **NEGATIVE-TESTED**: an injected `continuityScore: 0.42` + `perFrameMs: 2500` refused with exit 1; restored, exit 0.
- `contract_compatibility.ts` — EXECUTED exit 0.
- prettier --check . clean; eslint 0 errors on the touched TS; FROZEN contracts + the hf003-hf015 trees untouched (git-diff-verified); no tokens/secrets; weights never fetched.

## The limitations (honest)

- NO SAM3 number exists anywhere in this flight (the typed refusal governs); the latency self-check numbers are hand-computed formula placeholders, labeled NOT measurements.
- The comparison is a DESIGN — the cross-mode continuity scoring without operator GT is a RELATIVE measure, never an absolute one.
- The license review is argued from recorded terms only; the §7 governing-law note is recorded, not adjudicated; never legal advice.
- The disk-free figure is MEASURED at preflight (6.82 GiB) and differs from the earlier flights' recorded ~1.1 GiB — both recorded, never averaged.

## The promotion-gate referral

The HF015 gate (merged @ 86f3d4f) owns adjudication: its standing SAM3 row refused ALL FIVE legs (no benchmark flight; resource unrecorded; commercialUse "unclear" + a non-permissive modelLicense; no re-runnable harness; no failure envelope). This flight feeds the future re-adjudication: the benchmark-flight record itself (a typed-refusal record, NOT a passing benchmark), the license terms documented verbatim, the resource story, the re-runnable harness, and the failure envelope (the typed refusal + the negative tests) — the standing blockers (the auth wall, the adequate host, the commercialUse resolution, the mask-payload contract decision, the GT provisioning) are recorded in `benchmark-record.json → promotionGate.blockersObserved`.

=== END REPORT ===
