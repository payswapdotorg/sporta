# Sporta MVP + Live Reality — Current Worker Packets

## Purpose

These packets are the current three-worker operating contract for the J001-J015, L001-L017 and HF001-HF015 programs.

The Tech Lead may dispatch exactly these three lanes concurrently. Worker reports and ownership boundaries are mandatory.

## Shared rules

All workers:
- read the active Tech Lead handoff before starting;
- treat the repository as sole source of truth;
- never change another lane's canonical contract silently;
- do not create renderer-specific SWM truth;
- do not introduce provider-specific fields into product/domain contracts;
- record real-vs-fixture evidence;
- record code/model/dataset/asset license provenance separately;
- record latency/throughput evidence for live work;
- record benchmark evidence for model candidates;
- never download or promote a gated/non-commercial checkpoint without an explicit provenance/license decision.
- stop and raise a dependency when a shared contract is ambiguous.

## Worker A — Intelligence / live state

### Owns

Batch:
- J012 reality-fidelity perception investigation and implementation.
- HF001 logical task profiles.
- HF003 RF-DETR SoccerNet.
- HF004 MapAnything.
- HF005 SAM3.
- HF006 Spivak.
- HF007 SoccerChat.
- HF008 ASR portfolio jointly with Worker B.
- HF009 speaker diarization.

Live:
- L003 incremental SWM update;
- L004 temporal buffering/watermarking;
- L007 public/open-data replay adapter;
- L008 live TechnologyProfile;
- L010 broadcast-to-live benchmark;
- L011 broadcast perception runtime seam;
- L012 multi-source fusion.

### Does not own

- public web navigation or presentation;
- renderer implementation;
- provider credential UI;
- canonical contract changes without Tech Lead approval.

### Required outputs

- observation and SWM implementation/tests;
- technology benchmark/evaluation evidence;
- source provenance and license record;
- confidence/uncertainty behavior;
- identity continuity and failure evidence;
- contract-change request when needed.

## Worker B — Platform / media / live transport

### Owns

Batch:
- J005 compute connections;
- J007 durable control plane;
- J014 restart/redeploy persistence;
- backend portions of J006.
- HF002 model provenance/licensing ledger.
- HF008 ASR runtime and provider packaging.

Live:
- L002 deterministic/replay live source;
- L006 live telemetry plumbing;
- L009 authorized provider adapter;
- platform/recovery portions of L014.

### Does not own

- provider-specific behavior in domain contracts;
- canonical SWM truth;
- tactical renderer UI;
- role navigation except API/support seams explicitly assigned by Tech Lead.

### Required outputs

- durable storage evidence;
- reconnect/recovery evidence;
- provider adapter capability/health/credential behavior;
- latency telemetry collection;
- deployment/redeploy evidence;
- security/authorization evidence.

## Worker C — Rendering / experience

### Owns

Batch:
- J004 multi-reality Create;
- J006 compute transparency UI/render-facing pieces;
- J013 derived-reality sensitivity.
- HF010 camera-controlled neural renderer benchmark.
- HF011 ViewCrafter benchmark.
- HF012 Wan2.2 Animate benchmark.
- HF013 LTX-2.3 benchmark.
- HF014 Camera Director integration.
- renderer fixes required by J012/J013.

Live:
- L005 tactical renderer;
- L013 live 3D renderer;
- presentation side of L014.

### Does not own

- canonical SWM schema;
- provider adapters;
- rights semantics;
- perception truth.

### Required outputs

- browser-visible tactical state;
- visual sensitivity evidence;
- renderer telemetry;
- playable/interactive output evidence;
- no developer-only presentation paths.

## Cross-worker integration

Shared dependencies:

A -> C:
- live SWM update/event semantics;
- state versioning;
- confidence/provenance.

B -> A:
- ordered input delivery;
- persistence/replay source;
- source health/dropout events.

B -> C:
- live transport;
- reconnect state;
- telemetry.

C -> A:
- renderer-required read model only; never a new source of world truth.

## Worker report format

WORK ITEMS
CHANGED FILES
TESTS
ACCEPTANCE EVIDENCE
BROWSER EVIDENCE
CONTRACT CHANGES
REAL-vs-FIXTURE
LICENSE-PROVENANCE
LATENCY-TELEMETRY
RISKS
BLOCKERS
DEVIATIONS

## Concurrency rule

Workers may work concurrently only on dependency-safe files.

Shared contracts are Tech Lead-owned. If a worker needs a shared contract changed, it submits a dependency request and waits for the Tech Lead to freeze the new shape before implementation continues.
