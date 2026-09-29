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


## M8 — Reality Engineering Lab

W006 + W402/W403 -> REL-001 domain pack
REL-001 -> REL-002 Lab Run
REL-001 + W403 -> REL-003 world simulator
REL-001 + model-runtime seam -> REL-004 Agent Body runtime
REL-004 -> REL-005 Agent Organization
REL-002 + REL-003 + REL-004 + REL-005 -> REL-006 organization search
REL-003 + W801/W803 -> REL-007 evaluator/reward
REL-006 + REL-007 -> REL-008 simulator calibration
REL-006 + REL-007 -> REL-025 robustness benchmark
REL-001..REL-008 -> REL-032 second domain proof

## M9 — Historical corpus + long-running execution + external platform

W101-W103 -> REL-009 historical source contract
REL-009 -> REL-010 provider source adapters
REL-010 + W403 -> REL-011 corpus/feature pipeline
W302-W303 -> REL-012 durable Lab workers
REL-012 -> REL-013 long-running harness adapter
REL-012 -> REL-014 external HTTP API
REL-014 -> REL-015 MCP adapter
REL-009 + REL-012 + REL-014 -> REL-016 external feed processing
REL-010 + REL-011 -> REL-026 historical acquisition acceptance
REL-012 + REL-013 -> REL-029 long-run recovery
REL-014 + REL-015 -> REL-030 API/MCP parity
REL-016 + REL-024 -> REL-031 external feed end-to-end

## M10 — Organization productization

REL-005..REL-007 -> REL-017 Organization Registry
REL-017 + W806 -> REL-018 automated promotion/rollback
REL-017 + W703 -> REL-019 organization choice
REL-002 + REL-017 + W701 -> REL-020 User Lab UX
REL-020 + REL-017 -> REL-021 Lab incentive policy
REL-018 + REL-021 -> REL-022 organization publishing
REL-018 + REL-022 + REL-015 -> REL-023 external organization exchange
REL-016 + REL-023 -> REL-024 platform processing workspace
REL-018 + REL-019 -> REL-033 production organization choice proof
REL-021 + REL-022 -> REL-034 user-lab incentive proof
REL-023 + REL-024 + REL-030 -> REL-035 external platform proof
REL-020 -> REL-027 user-lab isolation
REL-018 -> REL-028 promotion/rollback acceptance

## M11 — Final integration

REL-026..REL-035 -> REL-036 program integration / drift audit

M8 Lab substrate: REL-001..REL-008
M9 Historical + external runtime: REL-009..REL-016
M10 Registry/productization: REL-017..REL-024
M11 Validation/integration: REL-025..REL-036

R606/R607/L015-L017 remain upstream production gates for claims about current customer-visible readiness. REL completion cannot mark those gates complete.
