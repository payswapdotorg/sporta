# Source-Preserving Renderer Contract

Status: FROZEN v1 (2026-09-24) · Owner: Sporta Tech Lead
Engine: **SPE-v1** (source-preserving engine) · Implements ADR-012.
This contract is Sporta-owned. External technologies implement it, never define it.

## 1. Inputs (what a stylized renderer receives)

```ts
SourcePreservingRenderRequest {
  clip: SourceClipRef          // path + identity + provenance (see §2)
  rendererId: string           // registered id, e.g. "spr-cartoon-cel-dc1"
  styleConfig: StyleConfig     // versioned params; defaults are part of the renderer
  temporal: TemporalConditioning | null   // cut list, flow refs, EMA state (engine-provided)
  swm: SwmGuidance | null      // OPTIONAL snapshot/events; renderers must work with null
  masks: SubjectMaskRefs | null // optional player/ball masks
  outputProfile: {
    container: "mp4"
    video: { codec: "h264", width: number, height: number, fps: number, crf: number }
    audio: "passthrough-aac" | "none"
    bitexact: true             // mandatory for deterministic implementations
  }
  rights: RightsCapabilities   // fail-closed; transformation allowed only if granted
}
```

Rule: `swm === null` MUST produce a complete, non-degraded visual reality (guidance
absence may only remove optional emphasis/effects, and must be listed in
`degradations`).

## 2. SourceClip (substrate identity)

```json
{
  "clipId": "sprclip-b8-inplay-original",
  "path": "/home/z/spr-evidence/benchmarks/clip-b8-inplay-original.mp4",
  "byteSize": 4159888,
  "sha256": "a13396ecb00b00b782d928b857cbbe6620008a8f49d2720552e0ac0af1abc8d3",
  "container": "mp4/h264+aac",
  "width": 640, "height": 360, "fps": 25, "frameCount": 1190, "durationMs": 47603,
  "sourceProvenance": {
    "url": "https://www.youtube.com/watch?v=93LPZJkCW2w",
    "title": "FULL MATCH | BETIS 3 vs 5 FC BARCELONA | LALIGA 2025/26 MD15",
    "acquisitionMethod": "vpn-egress-ytdlp-hls (unratified third path — standing caveat, same as R606)",
    "mediaTimeStartSec": 1803.84, "mediaTimeEndSec": 1851.44,
    "acquiredSha256": "0d0e315ad58fea4f2469f421d5e76130c87e7d50b80e7148315fab258ee89bf8"
  }
}
```

## 3. Outputs (what a renderer must return)

```json
{
  "artifact": {
    "file": "cartoon-cel-b8.mp4",
    "byteSize": 0, "sha256": "…",
    "container": "mp4/h264+aac", "width": 640, "height": 360,
    "fps": 25, "frameCount": 1190, "durationMs": 47603
  },
  "provenance": {
    "rendererId": "spr-cartoon-cel-dc1",
    "rendererVersion": "0.1.0",
    "implementation": "deterministic-classical",
    "engine": "SPE-v1",
    "inputClip": { "clipId": "…", "sha256": "…" },
    "styleConfig": { "…": "…", "hash": "sha256-of-canonical-json" },
    "pipeline": [ { "stage": "bilateral-flatten", "params": {…} }, { "stage": "quantize", "…": "…" } ],
    "tools": { "ffmpeg": "7.1.5", "opencv": "4.13.0", "numpy": "2.1.3" },
    "reproducibility": { "deterministic": true, "verifiedByDoubleRender": true, "command": "python3 …/render.py --clip … --reality cartoon-cel" },
    "generatedAtIso": "…", "runId": "sprrun-…"
  },
  "quality": { "selfTierClaim": 0, "notes": "filled by QA harness, not by the renderer" },
  "degradations": [ { "stage": "swm-guidance", "reason": "no SWM snapshot supplied", "effect": "event-reactive emphasis inactive" } ],
  "telemetry": { "renderWallMs": 0, "framesPerSecond": 0, "retries": 0 }
}
```

### Hard output invariants (gate R1-class)

1. **Timeline equality**: output frameCount == input frameCount; fps equal; duration
   delta ≤ 40 ms; audio passthrough (broadcast sound preserved).
2. **Bit-exact reproducibility** (deterministic implementations): double render →
   identical sha256. Encode with `-fflags +bitexact -flags:v +bitexact
   -map_metadata -1` and fixed GOP.
3. **Provenance faithfulness**: every field above present; config hash covers the
   effective params actually used (post default-merge).
4. **Cuts preserved**: no cross-cut blending (trails/EMA must reset on detected cuts).
5. **Fail-closed rights**: no render when rights capabilities deny transformation.

## 4. Renderer registry (initial state)

| rendererId | family | impl kind | version | notes |
|---|---|---|---|---|
| spr-cartoon-cel-dc1 | SPR101 | deterministic-classical | 0.1.0 | bilateral flatten + fixed-palette LAB quantize + XDoG lines |
| spr-anime-npr-dc1 | SPR102 | deterministic-classical | 0.1.0 | stronger flatten + limited palette + clean XDoG line art + sat lift |
| spr-noir-retro-dc1 | SPR108 | deterministic-classical | 0.1.0 | tone curves + grain + vignette (+ VHS variant profile) |
| spr-motion-trails-dc1 | SPR201 | deterministic-classical | 0.1.0 | flow-weighted decay trails, cut-reset |

Additional families (SPR103/104/105/106/107/109, SPR202-205) enter as new registry
rows with the same invariants. Neural candidates enter as `*-nn*` ids + a
TechnologyProfile (never replacing the deterministic id).

## 5. StyleConfig

```json
{ "reality": "cartoon-cel", "profile": "default", "overrides": { } }
```
Canonical JSON (sorted keys) is hashed into provenance. Profiles are part of the
renderer version; changing a default bumps the renderer version.

## 6. Reality Compiler stages (Sporta-owned capabilities)

`cut-detect` · `flow (Farneback)` · `bilateral-flatten` · `median-pool` ·
`palette-quantize (fixed per clip, LAB)` · `xdog-edges` · `edge-overlay` ·
`tone-lut` · `saturation-lift` · `bloom (screen-blur)` · `grain` · `vignette` ·
`trail-accumulate (cut-reset)` · `motion-mask` · `overlay-composite` ·
`swm-guidance-gate` · `encode-bitexact`. Stages are pure/deterministic; composition
is data-driven from the renderer's pipeline declaration.

## 7. Product-surface manifest (TL-owned, `/home/z/spr-evidence/manifest.json`)

```json
{
  "schemaVersion": "1.0", "engine": "SPE-v1", "generatedAtIso": "…",
  "clips": [ SourceClip… ],
  "realities": [ {
    "sprId": "SPR101", "family": "cartoon-cel", "name": "Cartoon / Cel-Shaded Broadcast",
    "rendererId": "spr-cartoon-cel-dc1", "rendererVersion": "0.1.0", "tier": 1,
    "tierEvidence": "qa/scorecard-cartoon-cel.json",
    "artifacts": [ { "clipId": "sprclip-b8-inplay-original", "url": "/media/spr/render/cartoon-cel-b8.mp4", "sha256": "…", "byteSize": 0, "durationMs": 47603 } ],
    "degradations": [ … ], "compareFrames": [ { "tSec": 2, "original": "…", "reality": "…" } ]
  } ],
  "qa": { "scorecards": [ … ] }
}
```
The manifest never fabricates: absent QA → tier 0 and `tierEvidence: null`.

## 8. SWM integration rule (verbatim from ADR-012)

Source-preserving renderers run with `swm: null`. When guidance exists it may add
emphasis/events — never structural facts. If a renderer cannot honestly provide a
semantic overlay element, it emits a degradation entry, not a placeholder guess.
