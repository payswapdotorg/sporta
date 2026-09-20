# Sporta MVP + Live Reality Status

Status: WAVE 0 COMPLETE — J/L/HF CONTRACTS VERIFIED/FROZEN; WAVE 1 DISPATCHED
Date: 2026-09-20 (Wave 0 session)

## Completed foundation

- W001-W921: COMPLETE
- R001-R510: COMPLETE
- R601-R605: VERIFIED (gate-audit doc @fb0a708; live R602 four-reality evidence)

## Remaining batch MVP

J001-J015: NOT_STARTED (Wave 1 dispatching: J004/J005/J012 lanes first)

R606: BLOCKED pending human visual acceptance and final fidelity conditions
(J012/J013 fidelity + J014 durability + J015 journey must pass first).
R607: BLOCKED until J001-J015 and final proof conditions pass.

## Live Reality

| Item | State |
|---|---|
| L001 contract freeze | VERIFIED — docs/contracts/live-reality.md is FROZEN FOR IMPLEMENTATION; Wave 0 verified logical-to-implemented contract compatibility (mapping recorded in the Wave 0 log below) |
| L002 synthetic/replay live source | NOT_STARTED (Wave 1, Worker B) |
| L003 incremental SWM updater | NOT_STARTED (Wave 1, Worker A design) |
| L004 temporal buffer/watermark | NOT_STARTED (Wave 1, Worker A design) |
| L005 live tactical renderer | NOT_STARTED (Wave 1, Worker C scaffold) |
| L006 live telemetry | NOT_STARTED (Wave 2, Worker B+C) |
| L007 SkillCorner/open-data replay adapter | NOT_STARTED (Wave 2, Worker A+B) |
| L008 live provider TechnologyProfile | NOT_STARTED (Wave 2, Worker A) |
| L009 authorized live provider adapter | BLOCKED UNTIL FEED ACCESS EXISTS |
| L010 broadcast-to-live perception benchmark | NOT_STARTED (Wave 1 harness, Worker A) |
| L011 broadcast perception runtime seam | NOT_STARTED (Wave 2, Worker A+TL) |
| L012 multi-source evidence fusion | NOT_STARTED (Wave 3, Worker A) |
| L013 live 3D renderer | NOT_STARTED (Wave 2, Worker C) |
| L014 live/replay continuity | NOT_STARTED (Wave 3, Worker B+C) |
| L015 live tactical gate | NOT_STARTED (Wave 5, TL) |
| L016 live tracking -> SWM -> tactical journey | NOT_STARTED (Wave 5, TL) |
| L017 live-to-replay recovery gate | NOT_STARTED (Wave 5, TL) |

## Wave 0 record (2026-09-20, Tech Lead)

Repository state:

- Local was 28 commits behind origin/main (docs-only: the operator authored
  the full J/L phase doc set). Fast-forwarded to 9feb623. Clean tree except
  deliberately untracked `gate-clips/` (licensed evidence media, provenance
  recorded in the gate-audit doc; no committed binaries).
- Battery evidence: full suite 6184 pass / 1 fail (documented perception
  benchmark variance) / 33 skip recorded at 5703a0b (pre-docs commits);
  contracts + observation suites re-run green post-fast-forward. Lint/typecheck
  clean per the prior session's record.
- No architecture drift found: composition, renderer contracts, SWM
  invariants and technology-plane adapter conventions match the frozen docs.

Contract compatibility verdict (live-reality.md → implemented contracts):

- `LiveObservation` maps onto the existing Observation envelope patterns
  (dual clocks `eventTimeMs`/`ingestTimeMs`, provenance, confidence) plus an
  ADDITIVE live entity-observation payload (xMeters/yMeters/zMeters,
  detected, sourceLocalTrackId). No frozen shape changes.
- `LiveWorldState` maps onto `WorldSnapshot` + `WorldEventStreamEntry`;
  `worldVersion` → snapshotVersionAfter/sequence; clock/score live in the
  football extension; confidenceSummary/sourceSummary are a live VIEW-layer
  projection, NOT WorldSnapshot mutations.
- Event-time vs ingest-time: exactly the two documented clocks (timestamps.ts).
- Watermark: `Watermark {watermarkMs, sequence}` unchanged.
- Bounded reorder window: contract-allowed today; implementation is L004.
- TL DECISION (extrapolation marking): the frozen `UncertaintyStatus`
  ["known","unknown","uncertain"] is NOT extended. Extrapolation is marked at
  the LIVE layer (live-envelope provenance + the §9 telemetry
  extrapolated-observations counter); live-view slots carry "uncertain" +
  confidence + provenance. Workers raise a contract-change request if this
  proves insufficient.
- Live render input/output maps onto `RenderRequest`
  (snapshotVersion/eventsSinceSequence/outputProfile/rightsCapabilities) and
  `RenderResult` (watermarkAfter + RendererHealth lag/degraded) —
  renderClock/outputMode are live-layer additions.
- Multi-reality Create request: FROZEN in
  `docs/contracts/multi-reality-create.md` (additive `realities` field on the
  upload route; one compute directive; per-reality honest independent
  failures; existing job/render surfaces carry the plan state).
- Session identity / live-to-replay: the session id remains the constant;
  live observations + world versions persist keyed to the same session.

Implementation-state notes for the lanes:

- J004 seam verified: Create Studio UI + renders route are single-renderer
  today (`draft.rendererId` radio; one render per POST). The frozen contract
  above is the J004 implementation target.
- J005 base exists: `packages/connection-center` (connect/verify/disconnect/
  status + master-password refusal) and 4 compute provider adapters (modal,
  lightning, runpod, local).
- J007 seams exist (Neon/R2/Upstash behind env gates — W910-W914/W921) but
  NO hosted credentials exist in this sandbox (external dependency below).
  The local durable path (bun:sqlite `SqliteMediaPlatformStore`) runs only
  under the real Bun runtime; the Node deployment honestly falls back
  in-memory (W911).
- J012 seam verified: `packages/real-to-swm` runs detect→track→ball→
  calibrate→team→bridge→fuse→emit with an honest degradation ledger. The
  gate clips' empty-event SWM came from model-backed weights being
  not-downloaded → heuristic fallback → weak detections. Weights candidates
  (yolov8n.pt / yolov5nu.onnx) are AGPL-licensed assets — the J012
  investigation must evaluate licensing vs alternatives before download.
- L-series base exists: the W915 SSE live transport lane
  (`apps/web/src/server/live/` + `/api/live/*` routes) is a REAL network
  transport (bounded buffers, counted drops) whose producer currently cycles
  the dev-seed story timeline. The L-program re-points generation at the
  canonical live SWM — do not discard the transport.
- `packages/fusion` (`runWorldFusion`) is the batch SWM seam L003 extends to
  incremental updates.

## Hugging Face Technology Portfolio

HF001-HF015: NOT_STARTED

The portfolio is now part of the active program.

P1 discovery/benchmark candidates:
- RF-DETR SoccerNet
- MapAnything
- SoccerChat
- VibeVoice/Qwen3-ASR
- Spivak
- Wan2.2-Fun-Control-Camera
- ReCamMaster
- Meridian
- ViewCrafter

Research/watchlist:
- SAM3
- DA3-GIANT
- non-commercial soccer VLM candidates

No candidate is production-approved. The model cards establish discovery/provenance inputs only; Sporta benchmark and license/commercial-use evidence are required.

## Current architectural insight

Live tactical rendering is not a separate product stack. It is a live input + temporal SWM + renderer path using the same canonical domains as batch rendering.

The first live milestone can use synthetic/replay/open-data tracking. A real commercial provider is an optional dependency, not a prerequisite for proving the architecture.

## External dependencies

1. Authorized live tracking provider/feed credentials if L009 is attempted.
2. Legally permitted benchmark data for any public-data benchmark.
3. Authorized broadcast media for L010 when real broadcast inference is benchmarked.
4. Neon/R2 (or equivalent hosted Postgres/object-storage) credentials for
   J007's cross-instance/redeploy durability gate — NOT present in this
   sandbox. J007 implementation and seam tests can proceed; the final
   durability gate is blocked until the operator supplies credentials.
5. Operator's section-I human visual acceptance (R606) on the live app.

## Doc-consistency finding (minor, non-blocking)

The HF portfolio is documented in docs/research/hugging-face-sporta-model-portfolio.md and its work items in docs/work-items/hf-model-portfolio-work-items.md. The J001-J015 definitions live in
`docs/work-items/mvp-user-journey-hardening-work-items.md`, whose own header
marks it "historical/superseded" while the active work-items doc incorporates
J001-J015 by reference. The ownership assignments are consistent across both
files; recommend a later docs-only commit folding the J definitions into the
active work-items doc. Not blocking Wave 1.

## Next safe wave

Wave 1 (per the handoff): Worker A (J012 investigation + L003/L004 design +
L010 benchmark harness), Worker B (J005 + J007 + L002), Worker C (J004 + L005
scaffold). Shared contracts frozen: live-reality.md (verified), 
multi-reality-create.md (new). Workers raise contract-change requests, never
patch around ambiguity.

## No-conversation-dependency rule

This status, the ADR, contracts, research note, work items and handoff are the implementation context. Agents must not assume any undocumented decision from prior chat history.
