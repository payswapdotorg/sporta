# Sporta MVP Reality Engine Roadmap

## Mission

Deliver the first genuinely demonstrable Sporta product:

> Take a real, authorized football video; reconstruct the sporting event; produce actual Original, Tactical, 3D Game, and Anime/Stylized video outputs; let the user watch them and switch realities for the same match.

The existing W001-W921 program remains valuable infrastructure, but this roadmap is the product-result gate. Engineering-seam completion is not MVP completion.

## MVP architecture

```text
Authorized MP4
  -> real upload + normalization
  -> football perception adapters
  -> tracking / calibration / team identity
  -> Sporta SWM
  -> renderer adapters
      -> Original MP4
      -> Tactical MP4
      -> Godot 3D Game MP4
      -> Godot Anime/NPR MP4
  -> R2
  -> HTML5 video
  -> Reality Switcher
```

## Phase R0 — Technology and benchmark foundation

### R001 Technology Registry
Versioned adapter metadata for all replaceable perception, tracking, intelligence, renderer and compute technologies.

### R002 Benchmark fixture set
Create a small but representative authorized football video suite covering open play, pass, shot/goal, set piece, occlusion, camera movement and cut boundaries.

### R003 Evaluation runner
Run candidate technologies against the same fixtures and produce machine-readable comparison reports.

### R004 License/commercial-use registry
Record code, model/checkpoint, dataset and asset licenses separately. Block production promotion when commercial-use status is unresolved.

### R005 Technology promotion pipeline
Candidate -> compatibility -> benchmark -> license/security -> shadow -> canary -> approved/production.

## Phase R1 — Real media loop

### R101 Real authorized upload
Replace fixture-only Create Studio source selection with actual browser upload for constrained MVP media.

### R102 Normalization
FFmpeg-based validation, demux, canonical encoding, duration/resolution limits and R2 persistence.

### R103 Real render job lifecycle
Queue, progress, failure, cancellation, retries and output manifest for real media.

### R104 Original reality
Preserve the authorized source as the Original playable output.

## Phase R2 — Real football reconstruction

### R201 Perception adapter interface
Stable adapter contracts for player, ball and pitch/camera perception.

### R202 Player detection
Integrate a permissively licensed detector candidate behind R201.

### R203 Player tracking / ReID
Integrate an adapterized tracking stack, with TrackLab/SoccerTrack/SoccerNet research as candidate references subject to license review.

### R204 Ball tracking
Real ball detection/tracking with benchmarked occlusion behavior.

### R205 Pitch calibration
Estimate camera-to-field mapping for supported footage envelopes.

### R206 Team / identity assignment
Team color/appearance, jersey numbers where reliable, identity continuity and uncertainty.

### R207 SWM production adapter
Convert real perception streams into the existing canonical SWM with provenance/confidence preserved.

### R208 Reconstruction acceptance
A real uploaded fixture must produce a coherent SWM and machine-readable reconstruction report.

## Phase R3 — Real visual realities

### R301 Tactical renderer
Produce actual tactical MP4 with field, players, ball, movement and event overlays driven by SWM.

### R302 3D scene runtime
Introduce a real game-engine adapter. Initial target: Godot 4, with the engine hidden behind the renderer contract.

### R303 3D game-style renderer
Stylized 3D football scene driven entirely by SWM rather than broadcast pixels.

### R304 Anime/NPR renderer
Use the same 3D scene with non-photorealistic/cel-shaded materials and presentation style.

### R305 Camera/event director
Use SWM events and commentary signals to control deterministic camera/presentation choices.

### R306 Real MP4 encoding
Render actual video artifacts suitable for normal HTML5 playback.

### R307 Visual acceptance suite
Verify score/clock/event order/player continuity/ball continuity and temporal stability on real outputs.

## Phase R4 — Compute Broker and user-owned compute

### R401 Compute Broker contract
Logical workload requests independent of provider.

### R402 Modal adapter
Initial free/low-cost hosted compute candidate.

### R403 Lightning AI adapter
Alternate hosted/free-development compute candidate.

### R404 RunPod adapter
User-owned/pay-as-you-go adapter and future managed compute candidate.

### R405 Local worker adapter
Local/self-hosted GPU execution for advanced users and development.

### R406 Compute Connection Center
In-product connection and setup wizard with provider-neutral UX.

### R407 Compute selection engine
Select provider/resource by capability, VRAM, cost, speed, quota, privacy and availability.

### R408 BYOC accounting
Track jobs, usage and responsibility boundaries for connected user-owned providers.

### R409 Sporta managed compute abstraction
Prepare product-plan allowance/concurrency controls without coupling to a specific infrastructure provider.

## Phase R5 — Product result

### R501 Real Create Studio upload
Source -> rights -> reality -> compute -> render.

### R502 Real processing states
Show actual queued/provisioning/running/collecting/succeeded/failed/cancelled/provider-unavailable states.

### R503 Artifact catalog
Each match/session exposes actual Original/Tactical/3D/Anime artifacts and their manifests.

### R504 Real video Watch player
Replace SVG-only primary playback with HTML5 video for production MVP artifacts.

### R505 Reality Switcher
Switch realities without changing the match/session.

### R506 Cost/compute UX
Show expected compute source, estimated allowance/cost where available, and let the user choose or connect compute.

### R507 Real MVP browser E2E
Fresh browser executes upload -> processing -> four outputs -> Watch -> reality switching.

## Phase R6 — MVP gate

### R601 Clip A
Known-good 30-second authorized football fixture passes end-to-end.

### R602 Clip B
Second materially different football fixture passes end-to-end.

### R603 Real upload
No checked-in fixture is required for the golden path.

### R604 Four-output gate
Original + Tactical + 3D + Anime all produce actual video.

### R605 Same-event gate
All alternate realities derive from the same reconstructed event/session and preserve event ordering and key facts.

### R606 Human visual gate
A human can watch the outputs and identify the same match/event and see meaningful stylistic differences.

### R607 Public MVP gate
A clean browser can complete the full flow from the public URL without developer tools, mocks or manual database edits.

## Definition of MVP success

Sporta is MVP-complete only when R601-R607 pass. Existing W001-W921 completion does not substitute for these product-result gates.
