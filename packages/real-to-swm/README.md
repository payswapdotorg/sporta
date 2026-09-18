# @sporta/real-to-swm — R207 real-to-SWM pipeline + R208 reconstruction gate

The ONE deterministic composition that turns a REAL MP4 clip into canonical
Sports World Model snapshots and events — with every degradation recorded,
never silent.

## R207 — `RealToSwmPipeline`

Composition order (each stage appends its record to the degradation ledger):

1. **decode** — the W102 boundary (`DecodingService` over the real
   `FfmpegDecoderAdapter`), bounded and rights-gated. Fail-closed admission:
   empty bytes / unrecognized container / no video track / zero frames →
   typed `PipelineAdmissionError`, never a partial fake pipeline.
2. **detect** — the player-detection family chain (default: model-backed →
   heuristic-color). A candidate that cannot run refuses with its OWN
   documented failure class; the refusal is recorded and the next candidate
   runs.
3. **track** — the player-tracking family (default: greedy-iou, the W204
   baseline) + the minimum-lifetime gate (short tracks excluded from SWM
   projection, counted in the ledger).
4. **ball** — the ball-detection family (model-backed → ball-blob), then the
   ball-tracking family (color-blob → nearest-box). Interpolated occlusion
   points counted (W202 honest gap semantics).
5. **calibrate** — the pitch-calibration family (line-based → homography
   with operator-supplied corners). A refusal (no pitch-green region — e.g.
   beach sand or archival film) is recorded verbatim; the pipeline degrades
   to IMAGE-frame tracks, never a guessed mapping.
6. **team** — the team-identity family (jersey-color, seeded k=2) with
   explicit uncertainty (`unknown` is a first-class honest output).
7. **bridge** — observation packets into a W005 store (track, field-mapping,
   team-assignment payloads — frozen shapes, consumed never re-declared).
   Confidence is preserved verbatim (image frame) or discounted by the
   calibration confidence (pitch frame).
8. **fuse** — the W401 `runWorldFusion` pass into a W006 `WorldModelEngine`
   (football state initialized with documented no-evidence defaults).
9. **emit** — the SWM timeline: canonical `football/v1/possession-change`
   events where pitch-space evidence supports them (W005
   `EventDerivationService`; every evidence id resolves in the store),
   pipeline-level `real-to-swm/v1/ball-impulse` candidates (image-space
   motion statements with non-max-suppression clustering), and snapshots at
   the configured cadence plus the final state.

**Hard rules honored:**

- **Degradation ledger** — a typed, append-only `PipelineStageRecord` per
  stage: frame counts in/out, confidence summaries, every dropped frame,
  every fallback, every candidate-unavailable/refused event. No silent skips.
- **Determinism** — same clip + same config → byte-identical artifact
  content hash. Injected clock (default 0; no `Date.now` in the core), no
  unseeded randomness, sorted iteration everywhere, canonical (key-sorted)
  serialization.
- **Honest confidence** — contract-level confidence preserved end-to-end,
  never collapsed.
- **Fail-closed admission** — typed errors, never partial fake pipelines.

## R208 — `ReconstructionArtifact`

The replayable artifact: emitted SWM timeline + full degradation ledger +
per-entity provenance + the clip's verbatim provenance (source URL, source
sha256, license, attribution) + a content hash (sha-256 over the canonical
serialization). `replayReconstruction` reconstructs the SWM view from the
artifact ALONE (hash re-verified, snapshots/events re-validated against the
frozen contracts) — no re-perception.

The REAL gate clips (TL media drop, carried verbatim in
`fixtures/gate-clips.json`): `fx-001` (FIFA Beach Soccer World Cup 2021
penalty, CC0) and `fx-004` (1944 Dutch cup newsreel, Open Beelden, CC BY-SA
3.0 nl). Both are committed byte-verified (see `fixtures/README.md`).

## Scripts

```bash
bun scripts/run-pipeline.ts <clip.mp4> <out-artifact.json> [clipId] [provenanceJson]
```

Runs the default composition, writes the canonical artifact JSON, prints the
content hash, and prints honest per-stage wall-clock measurements (used for
the cross-subprocess determinism proof and resource evidence).

## Dependency surface (the R207 work-item contract)

Runtime deps only: `@sporta/decoding`, `@sporta/perception-adapters`,
`@sporta/observation`, `@sporta/fusion`, `@sporta/world-model`,
`@sporta/contracts`, `@sporta/observability`, `@sporta/testing`. The W102
decode input's receipt is constructed structurally (true sha-256 checksum +
magic-byte container sniff mirroring the W101 rules) because the ingestion
package is outside this surface; the decode boundary re-asserts the analysis
rights gate fail-closed on every call.
