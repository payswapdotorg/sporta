===== 64-e REPORT BEGIN =====

# Worker 64-e delivery — HF007: the SoccerChat event-reasoning benchmark evidence

## Manifest

- Branch: `work/hf007-soccerchat-benchmark` (from main @ 72c7708; never pushed)
- Commit: `rel(64-e): HF007 — the SoccerChat event-reasoning benchmark evidence (CPU-host, contracts + typed refusal/partial)`
- Work item: HF007 (docs/work-items/hf-model-portfolio-work-items.md)
- Task profile: `football.eventReasoning`
  (docs/contracts/technology-task-profiles.md, FROZEN — untouched)
- Evidence tree (all committed in-repo):
  - `scripts/evidence/hf-portfolio/hf007/benchmark_soccerchat.py` — the benchmark script (preflight EXECUTED on this host: the typed refusal, exit 3; FULL mode ready-to-run on a >= 32 GB host with the hallucination-rate + provenance-traceability metric implementations)
  - `scripts/evidence/hf-portfolio/hf007/contract_compatibility.ts` — the machine-checked event-extraction + commentary-alignment mapping + the STATIC pipeline-delta table (EXECUTED, exit 0, every claim needle-verified)
  - `scripts/evidence/hf-portfolio/hf007/record-benchmark.ts` — the fail-closed validator (EXECUTED, exit 0; negative-tested: fabricated hallucinationRate + medianMs numbers refused with exit 1)
  - `scripts/evidence/hf-portfolio/hf007/benchmark-record.json` — the ledger-shaped HF007 record (the twelve provenance fields echoed VERBATIM + the typed refusal + the partial)
  - `scripts/evidence/hf-portfolio/hf007/summary.md` — the markdown summary
  - `scripts/evidence/hf-portfolio/hf007/results/preflight-refusal.json` — the EXECUTED preflight: the resource arithmetic, the bounded probes (adapter sha LOCALLY VERIFIED), the NDA-gate probe, the fixture pins
  - `scripts/evidence/hf-portfolio/hf007/results/load-analysis.json` — the adapter + base composition (sizes, shas, LoRA geometry, architecture, loading recipes, host-gap arithmetic)
  - `scripts/evidence/hf-portfolio/hf007/results/model-output-schema.json` — the source-verified SoccerChat output/annotation schema (fetched at the pinned revision)
  - `scripts/evidence/hf-portfolio/hf007/results/contract-compatibility.json` — the emitted mapping tables + capability delta
- Not committed (by design): the model weights (the adapter blob was downloaded + sha-verified INSIDE the bounded preflight probe at /home/z/hf-bench-5/probe — never committed, never vendored; the base was never downloaded), the python venv (/home/z/hf-bench-5 — a NEW venv; no earlier flight's reused).
- FROZEN contracts untouched; provenance-ledger.json untouched; architecture-lock untouched.
- Guard batteries green: packages/testing hf-ledger.test.ts 8/8;
  packages/perception-benchmark harness.test.ts (the L010 battery) 8/8.

=== HF007 BENCHMARK REPORT ===

## THE HONEST HEADLINE — resource-infeasible: a typed refusal + a substantial partial

The pinned candidate `SimulaMet/SoccerChat-qwen2-vl-7b` @ the
ledger-pinned revision `29871536004c0ac788af09cbb87969ab9f6e1410` (task
profile `football.eventReasoning`, FROZEN) is a LoRA (PEFT) adapter over
`Qwen/Qwen2-VL-7B-Instruct`. The preflight arithmetic ran FIRST (per the
brief) and the run is arithmetically impossible on this host — and the
model's own eval corpus is walled behind the SoccerNet NDA independently
of hardware:

| Constraint | Needed | Host | Verdict |
|---|---|---|---|
| RAM (bf16 base working set) | ~18.5 GiB | 4,041.6 MiB TOTAL | infeasible — 4.7x over total |
| RAM (the card's own 4-bit nf4 recipe, CUDA-only) | ~6.1 GiB | 4,041.6 MiB TOTAL; no GPU (N/A) | infeasible |
| Disk (base + adapter) | 16,623,253,408 B | ~420 MB free | infeasible — ~40x over |
| Eval corpus (SoccerChat validation split) | an operator SoccerNet-NDA acceptance (401 anonymous, probed) | none | auth-infeasible — hardware-independent |

`benchmark_soccerchat.py --mode preflight` was EXECUTED (exit code 3, the
typed refusal `resource-infeasible-host`,
`results/preflight-refusal.json`). Per the worker brief, the honest
delivery is the refusal + the partial. **No quality, latency, or memory
number exists in this flight — none is fabricated to stand in.** The
fail-closed validator is negative-tested (a fabricated
`hallucinationRate: 0.18` + `medianMs: 41250.0` refused, exit 1, both
failure messages; restored, exit 0).

## The model + revision + load analysis

- **Adapter** (the pinned SoccerChat repo): `adapter_model.safetensors`,
  40,422,208 B, sha256
  `4c3b45687dd15e744f84874ef06e365e96d1d4e308f89f001cf5173a75946e47` —
  **LOCALLY VERIFIED** (downloaded inside the bounded preflight probe and
  hashed against the hub LFS oid — the adapter is small enough to hold,
  unlike HF004's checkpoint). LoRA r=8, alpha=32, dropout=0.05, CAUSAL_LM,
  target_modules `^(model)(?!.*(lm_head|output|emb|wte|shared)).*`.
- **Base**: `Qwen/Qwen2-VL-7B-Instruct` — 16,582,831,200 B bf16
  safetensors across 5 shards (hub-reported LFS oids recorded per shard);
  28 decoder layers, hidden 3584, GQA 28/4, vocab 152,064, depth-32
  vision tower (patch 14), mrope. **The adapter does NOT pin a base
  revision** (adapter_config `revision: null`; sft_args
  `model_revision: "master"`) — this flight records the probed main sha
  `eed13092ef92e448dd6875b2a00151bd3f7db0ac` and the unpinned-base
  reproducibility caveat (a recorded HF015-gate observation).
- **Loading recipe** (implemented in the FULL mode): fail-closed pinned
  downloads (local sha verification), `Qwen2VLForConditionalGeneration`
  bf16/sdpa, `PeftModel.from_pretrained(adapter)`, the card's own
  inference regime (24 sampled frames, VIDEO_MAX_PIXELS 100352), the
  pinned generation_config (temperature 0.01, top_k 1 — near-greedy, the
  determinism anchor). The card's own usage recipe quantizes to 4-bit nf4
  for a free Colab T4 — evidence even the authors need GPU-class
  resources.

## The event-extraction contract mapping (machine-checked, EXECUTED exit 0)

`contract_compatibility.ts` maps SoccerChat's source-verified schema onto
the repo's OWN event contracts — 8 field-level rows, every claim
needle-verified on both sides (`results/contract-compatibility.json`).
The load-bearing source fact: **SoccerChat's model output is free-form
natural language** (pipeline_tag `video-text-to-text`; the card documents
NO structured event JSON; structured events exist only as dataset-side
annotations — `events`: a list of SoccerNet event types). Therefore:

- `response` → the FROZEN profile's "semantic event candidates with
  provenance/confidence": **maps-with-adapter** — the output-adapter
  parse is implemented (`benchmark_soccerchat.py`); typed gaps: no
  per-event confidence, no evidence links, no vocabulary guarantee.
- `events` (SoccerNet vocabulary) → the frozen 16-type
  `FOOTBALL_EVENT_TYPES` / the 14-type W209 vocabulary: **partial** — no
  canonical SoccerNet→FootballEventType map exists; the W401 precedent
  governs (an AUTHORED, test-pinned bridge — future work, recorded).
- `response` → R207 `EventCandidateRecord` / the `EventEnvelope`:
  **maps-with-adapter with the evidence-chain laundering risk recorded**
  — the R207 honesty contract (confidence propagated only from supporting
  evidence, never invented beyond perception) is precisely what a VLM
  output cannot self-certify; the adapter must synthesize frame-window
  evidence ids and label derived confidence honestly (provenance DERIVED,
  the W401 rule for derived understanding).

## The commentary-alignment mapping (machine-checked)

3 rows. **The honest negative result**: generated commentary is
**NOT-compatible** with W208 `CommentaryUnit` — the W208 doctrine ("every
output character is traceable to W207 input characters") cannot hold for
machine-generated text (no source windows, no speaker/channel, no ASR
confidence, no timestamps): generated text is a different artifact class
and must never re-enter the W207→W208→W209 evidence chain. `response` →
W209 extraction fields (eventPhrase/subjects/emphasis) maps-with-adapter
(the repo's own deterministic extractors apply; the unitId/eventTimeMs
provenance has no generated-text counterpart — a new provenance class is
TL territory). The profile's "commentary/context" input matches
SoccerChat's training triple exactly (maps-with-adapter, unexecuted).

## The hallucination-rate + provenance metric designs (implemented, typed not-measured)

Implemented in `benchmark_soccerchat.py` with the definitions stated
exactly:

- **Hallucination rate** (event-existence verification):
  `hallucinationRate = |{e ∈ E_pred : unmatched(e)}| / |E_pred|` over the
  parsed structured events vs a ground-truth timeline, with the
  HF006-stated matching rule (same normalized type AND |t_pred − t_gt| ≤
  tol; greedy one-to-one, confidence-descending; tol swept 1/2/5 s);
  recall reported alongside. Zero GT rows ⇒ not-measured, never zero.
  NOT MEASURED this flight: no run (the refusal) AND no ground truth (the
  repo owns none for benchmarkable media — the HF006 verdict; the
  SoccerChat split is NDA-gated).
- **Provenance traceability**: per emitted event, traceable = timestamp
  present AND parseable AND within media duration AND evidence window
  non-empty; the evidence-chain gap (the model emits no observation ids;
  the repo contract requires ≥ 1 resolvable id) is surfaced, never
  laundered.
- Plus determinism (repeated near-greedy runs, serialized-timeline
  exact-match), per-inference CPU wall-clock (median + nearest-rank p95),
  RSS (GPU honestly N/A).

## The static intelligence-pipeline comparison (labeled STATIC-REVIEW)

The 8-row capability-delta table
(`results/contract-compatibility.json`). Headline — the repo's
event-reasoning path today (cited to file/line):

- **W209** (commentary understanding): deterministic pattern matching
  over text — its own source: "NO language model (that arrives with the
  later GPU/agent-protocol items)".
- **R207** (vision candidates): pure-function image-space ball-impulse
  candidates; "candidates remain candidates until a fusion rule maps
  them" (the W209 pattern); claims nothing about who or what caused the
  impulse.
- **W401** (fusion): the AUTHORED FOOTBALL_EVENT_MAP (a tech-lead
  decision, test-pinned, never an inference); DERIVED provenance for
  commentary-derived candidates.
- **There is no semantic event-reasoning production path today** — HF007
  is the plan, not a present cost (the HF006 recorded absence).

SoccerChat would add semantic multimodal event reasoning over exactly the
profile's input set (video + candidates + commentary) with
natural-language explanation — closing the reasoning gap W209 defers. The
repo stays ahead (recorded honestly) on vocabulary governance, confidence
+ provenance discipline, hallucination containment (structural
never-invent vs the card's own "May generate hallucinated commentary"
warning), and CPU economics (milliseconds of deterministic compute vs a
16.6 GiB GPU-class budget — infeasible here).

## The ready-to-run path + the limitations

FULL mode (`benchmark_soccerchat.py --mode full`) requires ≥ 32 GB RAM +
≥ 24 GB free disk: pinned sha-verified downloads, the transformers+peft
load, inference over the repo's authorized sha-pinned media
(synthetic-diagnostic-01, fx-001 CC0, the two SPR clips under the R606
analysis scope) at the card's 24-frame regime, the parse + all metric
implementations. `--ground-truth` unlocks hallucination-rate scoring
(operator-supplied timeline JSON). Limitations, honestly: CPU wall-clock
labeled as such (no GPU, N/A); the 10–20 s authorized clips are far
outside the model's full-broadcast training regime (a domain-shift
caveat inherited from every CPU-host flight); the SoccerNet-vocabulary
bridge does not exist; the model's own held-out eval split is NDA-gated
so the paper's protocol cannot run anywhere without a human action.

## The promotion-gate referral

`gatingState` stands `candidate` — NO promotion; HF015 is the TL's gate
alone. Blockers for that gate (recorded in benchmark-record.json): zero
executed evidence (resource-infeasible host); the NDA-gated eval corpus
(an operator action precedes any paper-protocol run); no event ground
truth for hallucination-rate/event-accuracy scoring on the repo's own
media without an operator-supplied timeline; and the SoccerNet-NDA
dataset lineage (the ledger row's datasetProvenance: videos not
redistributable/commercially usable — to be weighed against the
commercialUse yes flag in the HF015 license review). The unpinned
base-model revision is a recorded reproducibility observation for the
same gate.

=== END REPORT ===

===== 64-e REPORT END =====
