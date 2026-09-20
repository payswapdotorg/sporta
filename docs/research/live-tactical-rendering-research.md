# Live Tactical Rendering Research — Sporta

Status: ACCEPTED RESEARCH INPUT
Date: 2026-09-20
Purpose: make the live-reality opportunity repo-native so implementation agents do not depend on conversation history.

## Executive finding

Live tactical / interactive 3D rendering of an ongoing football match is already a demonstrated production capability.

Public descriptions of Immersiv.io's FIFA World Cup 2026 work state that live skeleton data is ingested multiple times per second, mapped to player avatars, and rendered as an interactive 3D recreation. The same experience exposes broadcast, tactical, third-person and first-person views, and synchronizes broadcast audio with the reconstructed world.
Source: https://www.tvbeurope.com/media-consumption/bringing-the-fifa-world-cup-to-life-in-immersive-3d

Immersiv.io also describes its DAZN/Meta FIFA Club World Cup 2025 experience as a real-time interactive tabletop/tactical 3D recreation with live stats and replay controls.
Source: https://www.immersiv.io/portfolio/dazn-club-world-cup-2025/

This establishes that the renderer side is not speculative.

## Two technically distinct routes

### Route A — live tracking/state input

tracking feed + event/stat feed -> live SWM -> real-time renderer

This is the shortest path to a live Sporta tactical reality.

A commercial tracking provider can supply player/ball positions and related state. Sporta must consume this through a provider-neutral adapter and must not make any one provider part of the domain contract.

### Route B — broadcast-to-live reconstruction

broadcast video -> real-time detection/tracking/calibration -> pitch coordinates -> live SWM -> renderer

SkillCorner's public Open Data repository documents broadcast tracking generated through computer vision and machine learning, with player/ball tracking at 10 FPS, pitch coordinates in metres, team/possession fields, and extrapolation flags.
Source: https://github.com/SkillCorner/opendata

This establishes that broadcast-video-derived tracking is itself a real technical category, while leaving Sporta free to benchmark competing implementations.

## Open-source building blocks investigated

### soccer-tactical-vision

Repository: https://github.com/rafaelsouza-tech/soccer-tactical-vision

License: MIT.

Pipeline:
broadcast -> RF-DETR detection -> team clustering -> pitch keypoints -> homography -> pitch coordinates -> tactical minimap

The repository also contains temporal calibration smoothing, ball tracking, tactical calculations and a renderer. Its README explicitly states that its end-to-end real-broadcast pipeline has not yet been validated; synthetic evidence and real SoccerNet field-registration evaluation are separated honestly. Treat it as a strong reference/candidate adapter, not as production evidence.

### soccertracking

Repository: https://github.com/nlsnln/soccertracking

License: MIT.

Implements soccer game-state reconstruction concepts with detection, tracking, team assignment, jersey number recognition, pitch keypoints and homography. It is useful as a reference implementation for broadcast reconstruction.

### TrackLab

Repository: https://github.com/TrackingLaboratory/tracklab

License: MIT.

Useful as a modular tracking/re-identification implementation reference behind the Sporta perception adapter.

### TVCalib

Repository: https://github.com/MM4SPA/tvcalib

License: MIT.

Useful for football broadcast camera/field calibration. It should be benchmarked behind Sporta's calibration adapter rather than embedded as domain logic.

### Football-Tracking-Visualizer

Repository: https://github.com/TheSiebi/Football-Tracking-Visualizer

License: MIT.

Unity viewer for real football tracking data, supporting real-time/custom-speed playback, camera control and match navigation. It demonstrates the renderer side of the live/broadcast-tracking separation.

### SkillCorner Open Data

Repository: https://github.com/SkillCorner/opendata

Repository license: MIT. Dataset/data usage conditions must still be checked before redistributing or using specific assets in Sporta production evidence.

It provides an unusually useful intermediate representation for Sporta tests: timestamped player/ball positions, identity/team information, possession, and pitch coordinates.

### SoccerNet Game State Reconstruction

Repository: https://github.com/SoccerNet/sn-gamestate

License: GPL-3.0.

Technically important research/reference for broadcast game-state reconstruction, but it is not an automatic candidate for direct inclusion in Sporta's proprietary runtime because of its copyleft license. Reuse ideas and benchmark concepts through independently licensed adapters.

## Architectural conclusion

Do not fork one repository and make it Sporta.

Instead:

LiveTrackingAdapter and BroadcastPerceptionAdapter are alternative evidence producers feeding the same Sports World Model.

live tracking -> observations -> temporal fusion -> SWM -> Tactical/3D/other renderer

broadcast video -> observations -> temporal fusion -> SWM -> Tactical/3D/other renderer

The SWM remains canonical. Renderers never consume provider-specific formats directly.

## Why this matters to the current MVP

The current Reality Engine gate found that R601/R602 were technically real, but 3D Game and Anime/NPR could collapse to identical outputs when perception produced an empty/default SWM. A live tracking-backed path provides a much stronger state-rich validation source because it forces the SWM to evolve continuously.

The tactical renderer therefore becomes more than a feature: it is a validation surface for identity continuity, temporal state, clock synchronization, interpolation, renderer sensitivity and low-latency delivery.

## Rights and provenance boundary

Public descriptions of commercial live systems do not grant Sporta any right to ingest their feeds or broadcast footage. Sporta must obtain a lawful/authorized live tracking feed or use an explicitly authorized/open dataset for each benchmark and production path.

Commercial-system architecture may be studied from public documentation, published research, public SDKs, public datasets and observable product behavior. Sporta must not copy proprietary source code, credentials, protected APIs, confidential implementation details, assets, branding or protected game content.

## Required research disposition

The implementation program must benchmark at least:

1. a deterministic/synthetic live tracking source;
2. SkillCorner public tracking data as an offline/replay benchmark where its data terms permit;
3. at least one live-capable tracking provider adapter when credentials/data access are legally available;
4. at least one broadcast-reconstruction candidate;
5. at least one fallback/recovery path.

The first live tactical milestone must NOT be blocked on perfect broadcast reconstruction.
