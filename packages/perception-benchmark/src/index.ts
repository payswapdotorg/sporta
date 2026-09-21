/**
 * @sporta/perception-benchmark — the L010 broadcast-to-live perception
 * benchmark harness.
 *
 * Module map:
 *
 * - `candidates`: the benchmark-track candidate registrations through the
 *   Technology Plane conventions (identity + version + THREE-WAY license
 *   (code / checkpoint / dataset, recorded separately per ADR-011) +
 *   failure classes + resources):
 *   - `contrast-context-detector` (the J012 license-clean production path —
 *     runs, deterministic, CPU-only);
 *   - `heuristic-color-detector` (the weak baseline — runs);
 *   - `hf.rfdetr.soccernet` (the P1 license-clean MODEL candidate —
 *     benchmark-track registration; refuses honestly per frame until the
 *     W303/L011 inference runtime exists; weights never vendored).
 * - `clip`: the committed, sha256-pinned benchmark clips with their HONEST
 *   boundary labels (real-footage vs synthetic-diagnostic) and verbatim
 *   licenses.
 * - `harness`: `runPerceptionBenchmark` — decode (rights-gated, budgeted),
 *   sample, run, and record the L010 acceptance shape: timestamped
 *   player/ball observations, benchmark identity, pitch-mapping quality
 *   (honestly unavailable this wave), measured latency (mean/p50/p95), and
 *   dropout accounting (refusals per failure class; zero-detection frames
 *   counted separately). `toContractBenchmarkRun` projects a run into the
 *   frozen `BenchmarkRun` contract record for the registry machinery.
 *
 * HONESTY BOUNDARY: the harness is PROVEN on the committed inputs — the
 * synthetic-diagnostic fixture (scored against exact ground truth) and the
 * two REAL licensed gate clips (recorded unscored — no annotations exist).
 * Real MODEL inference on authorized media is benchmarked when the runtime
 * seam exists (W303/L011, Wave 2+); until then the runtime-backed
 * candidates refuse per frame and the refusals are counted, never faked.
 */
export {
  PERCEPTION_BENCHMARK_REGISTRATION_EPOCH_MS,
  RFDETR_SOCCERNET_CANDIDATE,
  RFDETR_SOCCERNET_CANDIDATE_ID,
  RFDETR_SOCCERNET_FAILURE_CLASSES,
  RFDETR_SOCCERNET_LICENSE,
  RFDETR_SOCCERNET_RESOURCES,
  RFDETR_SOCCERNET_RUNTIME_REFUSAL,
  contrastContextBenchmarkCandidate,
  heuristicColorBenchmarkCandidate,
  registeredBenchmarkCandidates,
  rfdetrSoccernetBenchmarkCandidate,
} from "./candidates";
export type { PerceptionBenchmarkCandidate } from "./candidates";
export {
  FX_001_SHA256,
  FX_004_SHA256,
  SYNTHETIC_DIAGNOSTIC_SHA256,
  committedBenchmarkClips,
  loadBenchmarkClip,
} from "./clip";
export type { BenchmarkClipIdentity, BenchmarkClipMediaKind, LoadedBenchmarkClip } from "./clip";
export {
  PERCEPTION_BENCHMARK_HARNESS_VERSION,
  runPerceptionBenchmark,
  toContractBenchmarkRun,
} from "./harness";
export type {
  FrameObservationRecord,
  PerceptionBenchmarkOptions,
  PerceptionBenchmarkRun,
  PitchMappingQuality,
} from "./harness";
