# HF005 — the SAM3 segmentation/tracking benchmark evidence (flight 13, worker 65-g)

**Verdict: TYPED REFUSAL (`auth-gated-model+resource-infeasible-host`) + the substantial partial** — the explicit
license review FIRST-CLASS (the acceptance's own words, 13 verbatim citations machine-verified against the fetched
SAM License text), the executed gated-repo probe map, the load analysis at the pinned revision, the
identity-continuity + latency metric designs implemented and self-checked (18/18 hand-computed cases), the
SAM3-vs-current-path comparison design, and the machine-checkable contract mapping. No promotion (gatingState
stays `candidate`; HF015 — merged — owns adjudication; its standing SAM3 row refused all five legs).

## The candidate (the ledger row echoed VERBATIM in benchmark-record.json)

`SAM3` = facebook/sam3 @ `3c879f39826c281e95690f02c7821c4de09afae7` — modelLicense `other (SAM License — custom
Meta agreement, repo LICENSE file dated 2025-11-19)`; codeLicense `other (the facebookresearch/sam3 repo
LICENSE)`; weightsProvenance `Meta's SAM 3 unified foundation model for promptable segmentation (successor of
SAM 2, per card); the card states no training corpus`; datasetProvenance `SA-CO benchmark (270K unique
concepts — eval benchmark introduced with the model, per card; no training datasets named)`; commercialUse
`unclear`; gatingState `candidate`. Two FROZEN task profiles: `football.playerSegmentation` +
`football.playerTracking`.

## The executed preflight (bounded probes ONLY — weights never downloaded)

- **THE GATE (primary wall)**: the API metadata says `gated: "manual"`; the anonymous `Range: bytes=0-0` probe
  at the PINNED revision returns **401 `x-error-code: GatedRepoError`** ("Access to model facebook/sam3 is
  restricted. You must have access to it and be authenticated to access it. Please log in.") for
  `model.safetensors` (3,439,938,512 B), `sam3.pt` (3,450,062,241 B) **and** `config.json`. The gate is the
  SAM License acceptance WALL — the card's `extra_gated_fields` demand First Name / Last Name / Date of birth /
  Country / Affiliation / Job title / geo `ip_location` plus the accept-the-license checkbox, with the data
  "collected, stored, processed and shared in accordance with the [Meta Privacy Policy]". Accepting is a HUMAN
  action; no HF token exists in this sandbox. Weights never downloaded, never committed, never vendored — and
  NO third-party mirror used (an unofficial re-upload would launder the acceptance wall).
- **The license TEXT is public** (206 on the same probe): the ONLY full fetches this flight performs are the
  text documents — the LICENSE at the pinned revision (7,352 B, sha `bec48f70…`), the code-repo LICENSE from
  GitHub raw (7,353 B, sha `4dea99bf…` — the SAME agreement, trailing-newline-only difference), and the model
  card (26,038 B, sha `1ac8a322…`) — each with a fetch-meta JSON (the hf013 convention).
- **THE RESOURCE GAP (secondary)**: 860M F32 parameters → `model.safetensors` alone is **3.204 GiB** (the
  pinned tree carries TWO serialization formats of the same checkpoint, 6.422 GiB total) vs **3.95 GiB TOTAL
  RAM / 2 vCPU / no GPU** — the weights alone are ~81% of TOTAL RAM before the ~0.6 GiB torch/transformers
  baseline (ESTIMATE, labeled) + per-frame activations + the video session's frame store. Auth-gated AND
  resource-infeasible → exit 3 (EXECUTED).
- The pinned revision is the repo HEAD (no drift; lastModified 2025-11-20).

## THE LICENSE REVIEW (first-class — the acceptance's own words)

The SAM License (Last Updated: November 19, 2025) is ONE agreement covering models, software, weights and
documentation as "SAM Materials" — the code repo's LICENSE is the same text. The recorded terms (13 verbatim
citations in `results/license-posture.json`, each machine-verified against the fetched text):

- **§1a**: a "non-exclusive, worldwide, non-transferable and royalty-free **limited license**" — NO
  field-of-use restriction, NO revenue threshold, and **NO express commercial-use permission either** → the
  ledger's commercialUse `unclear` is CONFIRMED (the license delegates the judgment: "YOU ARE SOLELY
  RESPONSIBLE FOR DETERMINING THE APPROPRIATENESS OF USING OR REDISTRIBUTING THE SAM MATERIALS", §3).
- **§8**: "Meta **may modify this Agreement** from time to time … **All such changes will be effective
  immediately.** Your continued use … constitutes your agreement" — the strongest production-continuity risk.
- **§6**: termination (including via §5b's patent-style clause) forces "**you shall delete and cease use of
  the SAM Materials**".
- **§5b**: the licensee **indemnifies and holds harmless Meta** for third-party claims from use/distribution.
- **§1b**: redistribution ONLY under this Agreement + a copy with it; publication acknowledgment; no reverse
  engineering; trade controls / ITAR / military / warfare / nuclear / espionage / weapons prohibitions (NO
  separate acceptable-use attachment — unlike LTX-2's Attachment A).
- **§5a** (the friendliest clause): the licensee OWNS their own derivatives and modifications (Meta keeps
  Meta's) — still inside the custom agreement.
- **The access gate itself** is an identity-attestation form whose data is "collected, stored, processed and
  shared" per the Meta Privacy Policy — an operator-level acceptance decision, never a worker decision.
- **SA-CO** (270K unique concepts) is the EVAL benchmark introduced with the model; the card names NO training
  corpus — the dataset leg of the three-way license record stays unknown.

**Verdict: research/watchlist — production-safe NOT proven by the recorded terms.** The acceptance's own bar
("remain research/watchlist unless production-safe") binds: the recorded terms affirmatively DELEGATE the
production-appropriateness judgment to the licensee and reserve unilateral modification +
termination-with-deletion. Argued from recorded terms only; never legal advice; never a promotion.

## The partial (what IS delivered)

1. **The gated-repo probe map** (`results/preflight-refusal.json`, EXECUTED): 5 anonymous probes at the pinned
   revision (the two weight formats + config gated; README + LICENSE public) + the code-repo license
   reachability probe (GitHub raw, 200).
2. **The license review** (`results/license-posture.json`): the machine-verified citations, the gate-form
   terms, the SA-CO statement, the commercialUse confirmation, the acceptance-bar reading.
3. **The load analysis** (`results/load-analysis.json`): per-file hub-reported sizes at the pinned revision,
   the two-format composition, the working-set arithmetic, the host-gap arithmetic (MEASURED host facts:
   3.95 GiB RAM / 2 vCPU Xeon / no GPU / disk 6.82 GiB — the earlier flights' ~1.1 GiB note recorded
   alongside the measured value).
4. **The metric designs** (`benchmark_sam3.py` + `results/metric-selfcheck.json`): identity continuity with
   the W204 semantics VERBATIM (identitySwitches = consecutive-pair trackId changes; continuityScore =
   identityPreservingPairs/totalPairs; fragmentation = mean tracks-per-object) + the `sam3-<id>` EntityId
   bridge + the latency arithmetic (perFrameMs / fps / realtimeFactor / the cascade ratio) — implemented as
   PURE functions, self-checked with 18 hand-computed cases (ALL PASS; the placeholder numbers are labeled
   NOT measurements).
5. **The comparison design** (`results/tracking-comparison.json`): SAM3 vs the repo's current path (W201
   contrast-context detector + W204 greedy-IoU tracker) on the SAME authorized fixtures (the sha-pinned SPR
   corpus clips under the R606 registration declaration) — the identity-continuity protocol (the W201
   correspondence rule for both sides; the GT honesty: NO per-player identity annotations exist, so the
   operator-provisioned-GT and the relative cross-mode options are both recorded), the latency protocol
   (per-frame wall-clock, warmup policy, the cascade delta, the card's streaming caveat), and the
   prompt-supply answer: the repo's chain supplies the W201 detections as box prompts (PVS) and/or the text
   concept "football player" (PCS).
6. **The contract mapping** (`contract_compatibility.ts` → `results/contract-compatibility.json`,
   machine-checked, exit 0): COMPATIBLE-WITH-MAPPING for both profiles' input/output shapes, with the TYPED
   GAPS machine-verified: **the observation payload union has NO mask kind** (detection | track |
   transcription | field-mapping | generic | team-assignment — a segmentation output needs a new typed
   payload variant; a FROZEN-contract decision recorded, never made), the identifier half of the
   segmentation input contract has no SAM3 counterpart, MOTA/HOTA need GT (absent), the label mapping (the
   concept IS the prompt), and the rights-provenance leg: BOTH code and model are the SAME custom
   non-permissive agreement → NOT production-eligible by recorded terms (the HF015 standing verdict echoed).
7. **The ready-to-run FULL mode** (`benchmark_sam3.py --mode full --model-dir …`): fail-closed on THIS host
   (exit 3: no authorized model dir + host inadequate — NEGATIVE-TESTED, all three modes executed: preflight
   exit 3 / selfcheck exit 0 / full exit 3).

## What is NOT measured (typed, no numbers exist)

- Identity continuity (ID switches / continuityScore / fragmentation) for the SAM3 candidate — the model
  never ran.
- Per-frame latency / FPS / realtimeFactor / the cascade cost — the model never ran.
- Mask quality — the model never ran.
- Inference RSS — the model never ran (GPU honestly N/A in any case).

## The guard batteries + delivery

- `record-benchmark.ts` — EXECUTED, exit 0: the ledger echo VERBATIM (12 fields); no promotion (gatingState
  candidate + the HF015 standing verdict); the typed refusal pinned to the EXECUTED preflight (the 401 probe
  map + the gate type + the public license docs + the weights-never-downloaded/no-mirror pins); the
  fabrication guard (a recursive scan refuses any measurement-shaped key in the benchmarkRun) —
  NEGATIVE-TESTED: an injected `continuityScore: 0.42` + `perFrameMs: 2500` refused with exit 1 (2
  fabrication-guard failures); restored, exit 0. The license review machine-verified; the partial pinned.
- `contract_compatibility.ts` — EXECUTED, exit 0 (9 repo authorities needle-verified + the 6 mapping rows +
  the mask-payload absence machine check).
- Branch `work/hf005-sam3-benchmark` (never pushed). FROZEN contracts (technology-task-profiles.md,
  provenance-ledger.json), the architecture-lock and the hf003-hf015 trees: untouched (git-diff-verified).
- Weights never downloaded, never committed, never vendored; no tokens/secrets anywhere; the fetches are the
  three text documents with fetch-meta.
- NO promotion: gatingState stays `candidate`; the HF015 gate owns it — this flight's evidence (the
  benchmark-flight record itself, the license terms documented verbatim, the resource story, the re-runnable
  harness, the failure envelope) feeds a FUTURE re-adjudication.

## The unblock path (for the TL)

An operator with an hf.co account accepts the SAM License conditions (the identity-attestation form — a human
action with Meta Privacy Policy data-sharing implications the operator must evaluate), downloads
`facebook/sam3` at `3c879f39…` OUTSIDE this repo to a local directory, on a host with an adequate GPU/RAM
profile (the 3.2 GiB F32 checkpoint wants a GPU-first host per the card's bfloat16 recipes), then re-runs
`benchmark_sam3.py --mode full --model-dir <dir>`. The fixtures (the SPR corpus clips) are already
sha-pinned in-repo, the metric implementations are self-checked, and the validator will pin any executed
number exactly as HF003/HF006 did for their executed flights.
