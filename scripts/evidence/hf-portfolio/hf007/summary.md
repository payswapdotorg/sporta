# HF007 — the SoccerChat event-reasoning benchmark evidence (Worker A, flight 5 / worker 64-e)

Work item HF007: "evaluate event extraction, commentary alignment,
hallucination rate and provenance; compare against current intelligence
pipeline."

Branch: `work/hf007-soccerchat-benchmark` (from main @ 72c7708; never
pushed). Nothing here promotes anything — the output is EVIDENCE for the
TL's HF015 gate. `gatingState` stays `candidate` (verified by
`record-benchmark.ts`).

## THE HONEST HEADLINE: a resource-infeasible typed refusal + a substantial partial

The pinned candidate — `SimulaMet/SoccerChat-qwen2-vl-7b` @ the
ledger-pinned revision `29871536004c0ac788af09cbb87969ab9f6e1410` — is a
LoRA (PEFT) adapter over `Qwen/Qwen2-VL-7B-Instruct`. The preflight
arithmetic ran FIRST (per the brief) and the verdict is arithmetically
impossible, three times over:

| Constraint | Needed | Host | Verdict |
|---|---|---|---|
| RAM (bf16 base working set) | ~18.5 GiB (16,582,831,200 B weights + activations/KV/vision headroom) | 4,041.6 MiB TOTAL | infeasible — 4.7x over total |
| RAM (the card's own 4-bit nf4 recipe, CUDA-only) | ~6.1 GiB | 4,041.6 MiB TOTAL | infeasible — and no GPU exists (N/A) |
| Disk (base + adapter download) | 16,623,253,408 B | ~420 MB free | infeasible — ~40x over |
| Eval corpus (the SoccerChat validation split) | an operator SoccerNet-NDA acceptance | no NDA on file (401 anonymous, probed) | auth-infeasible — hardware-independent |

`benchmark_soccerchat.py --mode preflight` was EXECUTED on this host and
emitted the typed refusal `resource-infeasible-host` (exit code 3;
`results/preflight-refusal.json`). Per the worker brief, the honest
delivery is the refusal + the partial. **No quality, latency, or memory
number exists in this flight — none is fabricated to stand in.** The
fail-closed validator was negative-tested: a fabricated
`hallucinationRate: 0.18` + `medianMs: 41250.0` injected into the record
refused with exit 1 (both failure messages), then the record was restored
and re-passed (exit 0).

## The load analysis (partial 1 — `results/load-analysis.json`)

- **Adapter** (the ledger candidate repo, pinned revision):
  `adapter_model.safetensors`, 40,422,208 B, sha256
  `4c3b45687dd15e744f84874ef06e365e96d1d4e308f89f001cf5173a75946e47` —
  **LOCALLY VERIFIED** (downloaded inside the bounded preflight probe and
  hashed against the hub LFS oid; stronger than HF004's hub-reported-only
  etag — the adapter is small enough to hold). LoRA geometry: r=8,
  alpha=32, dropout=0.05, target_modules
  `^(model)(?!.*(lm_head|output|emb|wte|shared)).*`, CAUSAL_LM. The repo
  also carries DeepSpeed ZeRO checkpoint shards (`global_step7270/`) +
  optim states — inference needs only the adapter + its config.
- **Base** (`adapter_config.json` base_model_name_or_path):
  `Qwen/Qwen2-VL-7B-Instruct`, 16,582,831,200 B bf16 safetensors across 5
  shards (hub-reported LFS oids recorded per shard). Architecture: 28
  decoder layers, hidden 3584, GQA 28/4 heads, vocab 152,064, a depth-32
  1280-dim vision tower (patch 14, temporal patch 2), mrope. **The adapter
  does NOT pin a base revision** (adapter_config `revision: null`,
  sft_args `model_revision: "master"`) — this flight records the probed
  main sha `eed13092ef92e448dd6875b2a00151bd3f7db0ac` and flags the
  unpinned-base reproducibility caveat for the HF015 gate.
- **Loading recipes** (both recorded in `results/load-analysis.json`):
  transformers+peft (bf16, sdpa — the FULL-mode implementation) and the
  card's own ms-swift PtEngine recipe (4-bit nf4, 24 frames,
  VIDEO_MAX_PIXELS 100352 — the card quantizes for a free Colab T4:
  evidence even the authors need GPU-class resources). The pinned
  generation_config (temperature 0.01, top_k 1, top_p 0.001 — near-greedy)
  is the determinism anchor of the FULL mode.

## The event-extraction contract mapping (partial 2 — machine-checked)

`contract_compatibility.ts` (EXECUTED, exit 0) maps SoccerChat's
source-verified schema onto the repo's OWN event contracts — 8
field-level rows, every claim needle-verified on both sides
(`results/contract-compatibility.json`):

- **The load-bearing source fact**: SoccerChat's model output is
  **free-form natural language** (pipeline_tag `video-text-to-text`; the
  card documents NO structured event JSON) — structured events exist only
  as DATASET-side annotations (`events`: a list of SoccerNet event types).
  Every structured repo guarantee (typed vocabulary, per-event confidence,
  evidence observation ids, interval) must be **adapter-synthesized**.
- `response` → `football.eventReasoning` outputs ("semantic event
  candidates with provenance/confidence"): **maps-with-adapter** (the
  output-adapter parse is implemented in benchmark_soccerchat.py; typed
  gaps: no per-event confidence, no evidence links, no vocabulary
  guarantee).
- `events` (SoccerNet vocabulary) → the frozen 16-type
  `FOOTBALL_EVENT_TYPES` taxonomy: **partial** — no canonical
  SoccerNet→FootballEventType map exists; the W401 precedent governs (the
  bridge is a tech-lead AUTHORED decision, test-pinned, never an
  inference). Same verdict vs the W209 14-type vocabulary (with `other`
  as the documented reserved escape hatch).
- `response` → R207 `EventCandidateRecord` and the `EventEnvelope`:
  **maps-with-adapter with the evidence-chain laundering risk recorded** —
  the R207 honesty contract (confidence propagated only from supporting
  evidence; never invented beyond perception) is precisely what a VLM
  output cannot self-certify; the adapter must synthesize frame-window
  evidence ids and label its derived confidence honestly.
- The profile's metric set vs the card's protocol: **partial** (BLEU/
  ROUGE/METEOR have no profile counterpart; hallucination rate +
  provenance quality have no card protocol — this flight implements
  both).

## The commentary-alignment mapping (partial 3 — machine-checked)

3 field-level rows (`results/contract-compatibility.json`):

- **The honest negative result**: generated commentary is **NOT
  compatible** with W208 `CommentaryUnit` — the W208 doctrine ("every
  output character is traceable to W207 input characters") cannot hold
  for machine-generated text by construction (no source windows, no
  speaker/channel, no ASR confidence, no timestamps). Generated text is a
  different artifact class and must never be fed back into the
  W207→W208→W209 evidence chain (the never-invent doctrine).
- `response` → W209 extraction fields (eventPhrase, subjects, emphasis):
  **maps-with-adapter** (the repo's own deterministic extractors apply to
  generated text; typed gap: no W208 unit exists — a new provenance class
  for model-generated candidates is TL territory).
- The profile's "commentary/context" input ↔ SoccerChat's training
  triple (video + event annotations + commentary): **maps-with-adapter**
  (the input sets match exactly; the alignment behavior is unexecuted).

## The hallucination-rate + provenance metric designs (partial 4 — implemented, typed not-measured)

Implemented in `benchmark_soccerchat.py` (FULL mode), with the
definitions stated exactly:

- **Hallucination rate** (event-existence verification): over parsed
  structured events E_pred and a ground-truth timeline GT:
  `hallucinationRate = |{e ∈ E_pred : unmatched(e)}| / |E_pred|` with the
  HF006-stated matching rule (same normalized event type AND
  |t_pred − t_gt| ≤ tol; greedy one-to-one, confidence-descending; tol
  swept 1/2/5 s); recall reported alongside. Zero GT rows ⇒ not-measured,
  never zero. NOT MEASURED this flight (no run + no GT — the repo owns no
  event ground truth; the SoccerChat split is NDA-gated).
- **Provenance traceability**: per emitted event, traceable = timestamp
  present AND parseable AND within media duration AND evidence window
  non-empty; `provenanceTraceability = traceable / |E_pred|`. The
  evidence-chain gap (the model emits no observation ids; the repo
  contract requires ≥ 1 resolvable id) is surfaced, never laundered.
- Plus determinism (repeated near-greedy runs, serialized timeline
  exact-match), per-inference CPU wall-clock (median + nearest-rank p95),
  and RSS (GPU honestly N/A).

## The static intelligence-pipeline comparison (partial 5 — labeled STATIC-REVIEW)

The 8-row capability-delta table (`results/contract-compatibility.json`,
`staticPipelineComparison`, labeled STATIC-REVIEW — never executed
evidence), headline:

- **What the repo does today** (cited): W209 is deterministic pattern
  matching over text — its own source says "NO language model (that
  arrives with the later GPU/agent-protocol items)"; R207 emits
  pure-function image-space ball-impulse candidates (claims nothing about
  who or what caused them; candidates remain candidates — the W209
  pattern); W401 fuses via the AUTHORED FOOTBALL_EVENT_MAP with DERIVED
  provenance. **There is no semantic event-reasoning production path
  today** — HF007 is the plan, not a present cost (the HF006 recorded
  absence).
- **What SoccerChat would add**: semantic multimodal event reasoning over
  exactly the profile's input set (video + candidates + commentary) with
  natural-language explanation — closing the reasoning gap W209 defers.
- **Where the repo stays ahead** (recorded honestly): vocabulary
  governance (the frozen taxonomy + authored-map discipline vs an
  uncontrolled free-text vocabulary), confidence/provenance discipline
  (evidence-propagated, resolvable ids vs none), hallucination
  containment (structural never-invent vs the card's own "May generate
  hallucinated commentary" warning), and CPU economics (milliseconds of
  deterministic compute vs a 16.6 GiB GPU-class budget — infeasible on
  this host).

## The fixtures and the ready-to-run path

The FULL-mode media is the repo's authorized set (all sha-pinned and
verified in the executed preflight): `synthetic-diagnostic-01`, `fx-001`
(CC0), and the two SPR corpus clips (R606 analysis scope). The
SoccerChat validation split is NOT the benchmark media — the NDA gate.
Full mode requires ≥ 32 GB RAM + ≥ 24 GB free disk; hallucination-rate
scoring unlocks only with an operator-supplied ground-truth timeline.

## Guard batteries + integrity

- `bun scripts/evidence/hf-portfolio/hf007/record-benchmark.ts` — EXECUTED
  exit 0; NEGATIVE-TESTED (fabricated metrics refused, exit 1, both
  messages asserted; restored and re-passed).
- `bun scripts/evidence/hf-portfolio/hf007/contract_compatibility.ts` —
  EXECUTED exit 0 (all needles verified, taxonomy/vocabulary counts
  pinned, the LM-free scan clean).
- packages/testing `hf-ledger.test.ts` 8/8 (280 expects); the L010
  `harness.test.ts` 8/8 (403 expects) — both green.
- FROZEN contracts, provenance-ledger.json, architecture-lock:
  git-diff-verified untouched (only `hf007/` + REPORT.md changed).
- No tokens/secrets anywhere; weights never committed, never vendored
  (pins + digests only).
