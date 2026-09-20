# Sporta MVP Reality Engine Work Items

These work items are subordinate to the frozen architecture and ADR-009. They are the executable backlog for delivering actual customer-visible MVP results.

## R0 — Technology evaluation

### R001 Technology Registry
Dependencies: W002. Deliver versioned profiles for perception, tracking, intelligence, rendering and compute adapters. Accept: candidates can be registered without product/domain changes.

### R002 Benchmark fixtures
Dependencies: R101 design only; existing W801 evaluation harness may be reused. Deliver representative authorized football clips plus expected annotations. Accept: fixed fixtures cover open play, ball action, occlusion, camera movement and cuts.

### R003 Evaluation runner
Dependencies: R001, R002. Deliver repeatable candidate benchmarking. Accept: machine-readable result reports and comparison outputs.

### R004 License registry
Dependencies: R001. Deliver code/model/checkpoint/dataset/asset license records. Accept: unresolved commercial-use status blocks production promotion.

### R005 Promotion pipeline
Dependencies: R003, R004. Deliver candidate -> benchmark -> shadow -> canary -> approved lifecycle. Accept: production profile changes are auditable.

## R1 — Real media

### R101 Browser upload
Dependencies: W902, W912. Deliver constrained authorized MP4 upload. Accept: fresh browser uploads a real clip and sees persistent source state.

### R102 Video normalization
Dependencies: R101. Deliver validation, decode, canonical encoding and media manifest. Accept: supported clips normalize reliably; unsupported/oversized clips fail clearly.

### R103 Real render job lifecycle
Dependencies: R102, W914. Deliver queued/running/collecting/succeeded/failed/cancelled state for real jobs. Accept: no fake progress.

### R104 Original MP4 artifact
Dependencies: R102. Deliver persistent original playable artifact. Accept: HTML5 playback works from R2.

## R2 — Football reconstruction

### R201 Perception adapter contracts
Dependencies: R001, W201-W206. Deliver stable detector/tracker/calibration interfaces. Accept: at least two candidate implementations can conform without SWM changes.

### R202 Player detection adapter
Dependencies: R201. Integrate the first production candidate with licensing evidence and benchmarks.

### R203 Player tracking adapter
Dependencies: R201. Integrate candidate tracking stack; candidate research may use SoccerNet/TrackLab/SoccerTrack subject to license/model review.

### R204 Ball tracking adapter
Dependencies: R201. Deliver real ball detection/tracking on supported footage.

### R205 Pitch calibration adapter
Dependencies: R201. Deliver real camera-to-pitch mapping for the supported MVP camera envelope.

### R206 Team/identity adapter
Dependencies: R203, R205. Deliver team assignment and identity continuity with explicit uncertainty.

### R207 Real-to-SWM pipeline
Dependencies: R202-R206, existing W401-W403. Deliver actual real-video perception into the canonical SWM.

### R208 Reconstruction gate
Dependencies: R207. Accept: real uploaded clip produces coherent SWM, confidence/provenance, event candidates and a replayable reconstruction artifact.

## R3 — Actual visual realities

### R301 Tactical video renderer
Dependencies: R208, R001. Deliver actual MP4 tactical visualization.

### R302 Game-engine adapter
Dependencies: R001, R208. Deliver a provider-neutral game-engine renderer seam with initial Godot implementation.

### R303 3D game-style renderer
Dependencies: R302. Deliver stylized 3D football match video driven only by SWM.

### R304 Anime/NPR renderer
Dependencies: R302. Deliver cel/NPR stylized football video using the same SWM scene.

### R305 Event/camera director
Dependencies: R303, W209. Deliver deterministic camera/presentation behavior driven by event importance and commentary semantics.

### R306 Real video encoding
Dependencies: R301, R303, R304. Deliver actual MP4 outputs and manifests.

### R307 Visual correctness gate
Dependencies: R306. Accept: score/clock/event order/player continuity/ball continuity are correct enough for the supported MVP fixture envelope and temporal stability is measured.

## R4 — Compute Broker

### R401 Compute Broker contract
Dependencies: W914, R001. Deliver provider-neutral compute request/job/quote/capability contracts.

### R402 Modal adapter
Dependencies: R401. Deliver real adapter and free-tier development path.

### R403 Lightning AI adapter
Dependencies: R401. Deliver alternate hosted/free-development adapter.

### R404 RunPod adapter
Dependencies: R401. Deliver user-owned/pay-as-you-go adapter.

### R405 Local GPU adapter
Dependencies: R401. Deliver local/self-hosted execution option.

### R406 Compute Connection Center
Dependencies: R402-R405, W902. Deliver in-product provider connection/setup UX. Accept: no provider master passwords; connected account can be verified and disconnected.

### R407 Compute selection
Dependencies: R401-R405. Deliver capability/cost/VRAM/privacy/availability selection. Accept: user may explicitly choose provider or let Sporta choose.

### R408 BYOC usage ledger
Dependencies: R407, W919. Deliver transparent user/provider usage records.

### R409 Managed compute seam
Dependencies: R401, R408. Deliver provider-independent allowance/concurrency abstraction for future Sporta subscriptions.

## R5 — Actual product

### R501 Create Studio real upload flow
Dependencies: R101, W906, R407. Accept: browser upload -> rights -> compute -> render.

### R502 Honest processing UI
Dependencies: R103, R407. Accept: every visible job state corresponds to a real server state.

### R503 Reality artifact catalog
Dependencies: R104, R306, W916. Accept: one session links Original/Tactical/3D/Anime outputs.

### R504 HTML5 video Watch player
Dependencies: R503. Accept: actual MP4 playback; no SVG-only primary player for MVP output. Ratified 2026-09-20 (wave-5 TL audit): the byte route's not-video boundary is CONTENT-TYPE-DRIVEN — an artifact serves as HTML5 video iff its descriptor's content type names the mp4 container (the original reality's ffmpeg-normalized MP4s AND the derived realities' R306-encoded MP4s); every other content type (the W504 animated-SVG review segments) answers the typed 415 and renders only through the diagnostics surface.

### R505 Reality Switcher
Dependencies: R503, R504. Accept: same match/session; switch selected output without changing the match.

### R506 Compute/cost UX
Dependencies: R407-R409. Accept: user understands whether Sporta compute or connected compute is being used, with cost/allowance messaging where available.

### R507 Real browser golden path
Dependencies: R501-R506. Accept: a clean browser can complete the whole MVP without fixtures being required to stand in for user input.

## R6 — MVP proof

### R601 Clip A end-to-end
Dependencies: R507. Accept: a known-good 30-second authorized football clip uploads through the clean browser and produces all required outputs.

### R602 Clip B end-to-end
Dependencies: R507. Accept: a materially different 30-second authorized football clip completes the same path.

### R603 Real-upload independence
Dependencies: R601, R602. Accept: the public golden path requires no pre-seeded fixture session, fixture selection, developer action, or manual database edit.

### R604 Four-output gate
Dependencies: R601, R602. Accept: Original + Tactical + 3D + Anime/NPR are actual playable video artifacts with integrity-verifiable manifests.

### R605 Same-event integrity
Dependencies: R604. Accept: all alternate realities derive from the same canonical SWM/session and preserve event ordering and key facts within the declared MVP envelope.

### R606 Human visual acceptance
Dependencies: R605. Accept: a human reviewer confirms the outputs are actual video, visually distinct, recognizably the same event, and understandable as a product result without developer intervention.

### R607 Public MVP acceptance
Dependencies: R606. Accept: a fresh public browser completes upload -> rights -> compute choice -> processing -> four outputs -> Watch -> Reality Switcher without mocks or developer-only steps.

## Concurrency model

At most three implementation workers run concurrently.

### Worker A — perception/reconstruction
R001-R005, R201-R208.

### Worker B — compute/platform
R101-R104, R401-R409.

### Worker C — rendering/product
R301-R307, R501-R507.

R6 is Tech Lead integration and acceptance, with all workers available only for narrowly isolated fixes.

## Non-negotiable boundary

A work item is not complete because an adapter or fixture works in isolation. Completion requires evidence at the customer-visible boundary claimed by that work item.
