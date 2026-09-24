# Source-Preserving Reality Engine — Architecture

Status: FROZEN v1 (2026-09-24) · Owner: Sporta Tech Lead
Contract: `docs/contracts/source-preserving-renderer.md` · ADR: ADR-012
Status tracker: `docs/status/source-preserving-reality-status.md`

## 1. Positioning

Two reality families coexist in Sporta:

| Lane | Substrate | Requires SWM | Status |
|---|---|---|---|
| Reconstruction lane (Tactical, 3D-Game, Anime-NPR via SWM) | world model | yes | R606 OPEN (calibration stage) |
| **Source-Preserving lane (this engine)** | original media | **optional guidance only** | this program (SPR*) |

The source-preserving lane renders alternate realities directly over the real
broadcast pixels. Same match, timeline, action, camera, motion — different visual
world. It must never inherit the R606 bottleneck: no pitch calibration precondition.

## 2. Pipeline

```
                 ORIGINAL MEDIA (normalized, provenance-chained)
                       │
             Media normalization (existing seam)
                       │
            Source-Preserving Layer (SPL)
        ┌──────────────┼───────────────┬───────────────┐
        │              │               │               │
   video structure  temporal      subject        optional SWM
   (cuts, edges,   signals       masking         snapshot/events
    flow, color)   (flow, diffs) (players/ball)  (guidance only)
        └──────────────┴───────┬───────┴───────────────┘
                              │
                    Reality Compiler (SPE-v1)
                              │
              ┌───────────────┼────────────────┐
        appearance        spatial           semantic
       transformation  transformation    transformation
              │               │                │
              ▼               ▼                ▼
          SPR101-109      SPR201-203        SPR203-205
                              │
                  encode (h264+aac, bit-exact)
                              │
                  artifact + provenance + QA evidence
```

## 3. Engine layout (this machine)

```
/home/z/sporta-wc/scripts/source-preserving/   ← engine code (repo = source of truth)
  render.py          CLI entry (clip × reality → artifact + provenance)
  spe/               the library (stages, renderers, registry, provenance)
/home/z/spr-evidence/
  render/            rendered artifacts + per-artifact provenance + renders.json  (Worker B)
  benchmarks/        benchmark corpus + corpus.json                              (Worker C)
  qa/                metrics, scorecards, VLM verdicts                            (Worker C)
  manifest.json      product-surface manifest                                    (Tech Lead)
/home/z/my-project/public/media/spr/  playback copies served by the product surface
```

Runtime tools: `/usr/bin/ffmpeg` 7.1.5, `python3` (venv) with `cv2` 4.13 + `numpy` 2.1.
Node/VLM (z-ai-web-dev-sdk, backend only) for QA harness scripts under
`/home/z/my-project/scripts/`.

## 4. Renderer contract (summary — full text in contracts doc)

A stylized renderer receives: source frame access (media path, timeline), style
config (versioned, hashed), optional SWM snapshot/events, optional subject-mask
references, temporal conditioning, output profile, rights capabilities. It returns:
transformed A/V artifact, provenance, renderer/model version, quality metadata,
telemetry, degradation notes. Renderers register in the SPE registry with id,
family, capabilities and implementation kind.

## 5. Deterministic baselines (mandatory) and neural promotion

Every neural category starts with a classical baseline (e.g. Cartoon =
bilateral-flatten + fixed-palette quantization + XDoG lines; Noir = tone curves +
grain + vignette). Neural candidates enter only as TechnologyProfile → benchmark →
promotion evidence (ADR-011 discipline). The current sandbox envelope is CPU-only
with no provider credentials: deterministic pipelines are the honest first
implementation; neural comparisons are recorded as PENDING candidates with the
research trail — never faked.

## 6. Provider neutrality & replaceability

`Model A → Model B`, `Provider A → B`, `cloud → self-hosted` must be config/adapter
swaps. Technology-specific state lives in the Technology Plane (registry profiles);
domain objects, renderer contracts, provenance and the media-session model are
provider-agnostic. No provider SDK in domain code; free tiers are never an
architectural assumption.

## 7. Quality gates & tiers

Acceptance dimensions (10): source fidelity, temporal consistency, identity
consistency, motion fidelity, camera fidelity, scene fidelity, stylization
strength, artifact rate, runtime/cost, operational reliability. Automated metrics
(cut alignment, motion-energy correlation, static-region instability, timeline
equality) + VLM scorecards + human/TL review. Tiers 0-3; only Tier 2+ presented as
product realities. Full protocol: `docs/testing/source-preserving-reality-acceptance.md`.

## 8. Honest degradation

Source-enhancing overlays that would need a world-model fact (offside line,
formations, possession) must show a visible "SWM fact unavailable — overlay
degraded" state when SWM evidence is absent. Never fabricate tactical facts.

## 9. Benchmarks

Fixed corpus of real windows from the frozen source
(`docs/testing/source-preserving-reality-benchmark.md`), including Clip 8 = the
R606 in-play Original (provenance-chained). Reproducible by sha256 + window + method.

## 10. Artifact lineage

```
frozen source URL + window → acquired bytes (sha256) → normalized Original (sha256)
  → benchmark clip (sha256) → renderer id+version+config-hash → output artifact
    (sha256) + provenance JSON + QA evidence + product-surface manifest entry
```

Every hop is content-addressed; the manifest never references an artifact whose
hash cannot be re-verified.
