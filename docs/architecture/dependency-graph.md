# Sporta Dependency Graph

Legend: `A -> B` means B depends on A. Work may be parallelized only when the graph permits it.

## Foundation

W001 Repository bootstrap -> W002 domain contracts -> W003 test/CI foundation
W002 -> W004 media session model
W002 -> W005 observation/event model
W002 -> W006 Sports World Model contract
W003 -> W007 observability foundation

## Media

W004 -> W101 source ingestion
W101 -> W102 demux/decode normalization
W102 -> W103 timeline synchronization
W103 -> W104 audio/video segment transport
W104 -> W301 real-time streaming ingress

## Perception

W005 -> W201 player/object detection
W005 -> W202 ball tracking
W005 -> W203 pitch/field mapping
W201 -> W204 player identity tracking
W202 -> W205 ball state estimation
W203 -> W206 spatial state estimation
W204 -> W401 world-model identity reconciliation
W205 -> W401
W206 -> W401

## Commentary

W103 -> W207 speech-to-text adapter
W207 -> W208 commentary segmentation
W208 -> W209 football commentary understanding
W209 -> W401

## World model

W006 -> W401 world-model fusion engine
W005 -> W401
W401 -> W402 temporal snapshots/events
W402 -> W403 world-model replay/evaluation

## First renderer

W006 -> W501 renderer contract
W402 -> W502 anime renderer prototype
W502 -> W503 temporal consistency evaluation
W503 -> W504 anime output pipeline

## Real-time

W102 -> W301
W104 -> W302 bounded processing queues
W007 -> W302
W302 -> W303 GPU worker protocol
W303 -> W304 streaming render orchestration
W304 -> W305 WebRTC output
W305 -> W306 end-to-end latency benchmark

## 3D/game renderer

W401 -> W601 scene projection contract
W601 -> W602 3D avatar/field prototype
W602 -> W603 3D game-style renderer
W603 -> W604 camera-director/event presentation
W604 -> W605 3D output evaluation

## Product

W004 -> W701 session/control API
W501 -> W701
W701 -> W702 viewer shell
W702 -> W703 renderer/style selection
W305 -> W704 live playback integration
W504 -> W705 batch playback integration
W703 -> W706 viewer telemetry

## Release hardening

W403 -> W801 evaluation harness
W306 -> W802 latency SLOs
W503 -> W803 visual-quality gates
W605 -> W803
W706 -> W804 product analytics
W007 -> W805 production observability
W804 -> W806 release readiness
W805 -> W806
W801 -> W806
W802 -> W806
W803 -> W806

## Milestone dependency summary

M0 Foundation: W001-W007
M1 Football perception + commentary: W101-W209
M2 World model: W401-W403
M3 Offline stylized renderer: W501-W504
M4 Real-time pipeline: W301-W306
M5 Product viewer: W701-W706
M6 3D game-style renderer: W601-W605
M7 Production hardening: W801-W806

No later milestone may be declared production-ready while its required predecessor acceptance gates remain red.
