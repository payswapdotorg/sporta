# HF012 — the Wan2.2-Animate character animation benchmark evidence (flight 9, Worker C's renderer wave)

**Verdict: Wan2.2-Animate REFUSED `resource-infeasible-host` (the EXECUTED preflight, exit 3) + the SUBSTANTIAL partial delivered — the motion-fidelity + temporal-identity + style-adherence + temporal-consistency metric designs (self-checked 26/26 incl. THE no-canonical-truth invariant both ways), the Anime/NPR direction comparison (the 8-axis static capability-delta table + the adequate-host comparison design), the load analysis, the license posture (incl. the FLUX-route dependency edge), and the machine-checked canonical-entity-motion conditioning contract mapping. No model ran. No promotion.**

## The candidate (the provenance-ledger row echoed VERBATIM in benchmark-record.json)

| Candidate | Repo @ revision | License posture (recorded terms) | The refusal arithmetic (this host: 3.95 GiB RAM, ~1.04 GiB free disk, 2 vCPU, no GPU) |
| --- | --- | --- | --- |
| Wan2.2-Animate | Wan-AI/Wan2.2-Animate-14B @ cb93a225fbaf (the pin sha MATCHES the live hub resolve) | apache-2.0 / apache-2.0 (the card frontmatter + the fetched LICENSE.txt, sha-pinned), commercialUse yes — **production-eligible-by-recorded-terms** (datasetProvenance unknown = the open edge; the RECOMMENDED `--use_flux` preprocessing route's third-party dependency black-forest-labs/FLUX.1-Kontext-dev is gated=auto, license:other — a different licensor's terms; the basic retargeting route avoids it) | the core inference composition (MoE dual-expert diffusion 32.18 GiB + umt5-xxl 10.58 GiB + CLIP 4.44 GiB + Wan2.1 VAE 0.47 GiB) = **47.68 GiB = 45.9x free disk**; + the mandatory preprocessing leg = **53.65 GiB = 51.6x**; the card's own whole-tree command = **67.41 GiB = 64.8x**; the recommended-with-FLUX route = **~107.6 GiB = ~103x**; the bf16 working set **≈ 12.1x TOTAL RAM**; every documented generation recipe is GPU-only (torch>=2.4) |

**NO auth wall on the candidate** (gated=False, anonymously reachable at the pinned revision — the sha pin verified against the live resolve; the only gated surface in this flight is the FLUX *recommended-route* dependency, gated=auto).

## The partial (the real value — the acceptance's core, the HF014 runway)

1. **THE METRIC DESIGNS** (the acceptance's own words made concrete) — `benchmark_wan22animate.py`, typed not-measured, **self-check EXECUTED 26/26** (implementation evidence, NOT a model measurement):
   - **motion fidelity**: `motion_fidelity_joint_error` — meanNormalizedJointError + endpointJointError + velocityDirectionAgreement vs **the CANONICAL SWM entity-state track** (the participant entities' positions, projected through W601), with the conditioning-video view reported SEPARATELY (never conflated with the canonical view);
   - **temporal identity stability**: `identity_drift` — meanPairwiseIdentityDistance + maxDriftFromReference + driftTrendSlopePerFrame, **anchored on the authorized avatar reference embedding** (identity = what the output is supposed to preserve);
   - **style adherence**: `style_adherence_distance` — meanStyleDistance + maxStyleDistance + meanChannelShift vs the authorized reference;
   - **temporal consistency**: the SHARED hf010 estimators (ssim_constant_patches + flow_warp_residual — IMPORTED, never re-implemented) so BOTH comparison lanes are scored by the same code;
   - **THE NO-CANONICAL-TRUTH INVARIANT** (machine-checkable, load-bearing): `no_canonical_truth_invariant()` refuses any benchmark plan whose ground-truth provenance names the renderer under test — canonical truth is ONLY `swm-entity-state` + `authorized-avatar-reference`; the self-check proves the refusal direction for BOTH lanes (the candidate AND the repo's own anime-npr renderer).
2. **THE ANIME/NPR DIRECTION COMPARISON** — `results/anime-npr-comparison.json`: the 8-axis STATIC capability-delta table (labeled static-review: the pure SWM→scene→pixels projection with constructed identity stability vs the learned motion-transfer with measured identity/style) + the **adequate-host comparison design** (same SWM window, the same ground-truth conventions, BOTH lanes scored by the SAME metric implementations, the profile-alignment + fairness rules, the typed SWM-state-to-performance-video adapter for the Wan lane).
3. **THE LOAD ANALYSIS** — `results/load-analysis.json`: the exact composition at the pinned revision (the 47.68 GiB core + the mandatory preprocessing leg + the FLUX-gated recommended route + the optional relighting LoRA), the documented loading recipe (the card's own commands), the host-gap arithmetic, the bounded-probe record + the fetched card/doc sha pins.
4. **THE CONTRACT MAPPING** — `contract_compatibility.ts` → `results/contract-compatibility.json`: 3 task-profile INPUT rows + 3 OUTPUT rows + the **5-axis canonical-entity-motion conditioning table** (the brief's key honest question: the profile's input is STRUCTURED CANONICAL STATE, the candidate's conditioning is VIDEO PIXELS — **MAPS-WITH-ADAPTER**, the typed SWM-state-to-performance-video gap; the adapter output is CONDITIONING, never truth) + the rights table (the authorized-reference constraint enforced adapter-side per R2 + real-source-provenance) + the metric table, machine-checked against 10 needle-checked repo authorities.

**Profile verdict (PARTIAL):** the authorized style/avatar reference input MAPS (rights-gated); the canonical entity motion/state input requires the TYPED adapter; the output video MAPS; renderer telemetry/provenance DO NOT MAP (adapter-synthesized, external measurement only); the no-canonical-truth boundary is PRESERVED BY DESIGN and machine-checked.

## The gates this evidence stands on

- `--mode preflight` EXECUTED (exit 3, the typed refusal; bounded probes only — weights never downloaded, never committed, never vendored)
- `--mode selfcheck` EXECUTED (26/26, incl. the no-canonical-truth invariant's refusal direction for both lanes)
- `--mode full` NEGATIVE-TESTED on THIS host (fail-closed exit 3: RAM/disk/CUDA blockers printed)
- `bun contract_compatibility.ts` exit 0 (10 authorities, all needles present)
- `bun record-benchmark.ts` exit 0 (the ledger row echoed verbatim — generated programmatically from the ledger for byte-identity; no promotion; no fabricated numbers; the invariant checks) + **negative-tested**: fabricated `meanNormalizedJointError` + `maxDriftFromReference` injected into the quality block → exit 1 refused (both keys named) → restored → exit 0

## Promotion gate: UNCHANGED (candidate)

The benchmark recommends NOTHING production. HF015 (the TL's gate) owns every adjudication; the recorded blockers: zero executed evidence (the compute leg resource-refused on this host), the adequate-host requirement AND the missing SWM-state-to-performance-video adapter, datasetProvenance unknown, the FLUX-route dependency posture, the one-character-per-run scale gap (22 participants + ball in the SWM scene), and the entityId↔reference identity-association gap (the W401 territory). See `benchmark-record.json` → `promotionGate`.

**Never legal advice. No promotion. All weights undownloaded.**
