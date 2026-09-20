/**
 * THE CAMERA-CONTROLLED NEURAL RENDERER BENCHMARK STRUCTURE (HF010–HF013) —
 * the prepared harness data: the metric vocabulary, the candidate
 * registry, the stage list, and the honest status record.
 *
 * This module is the DESIGN-AS-CODE companion to CAMERA-BENCH.md (the
 * harness design note): the values are pinned by
 * `test/camera-bench.test.ts` against the note and against
 * `docs/technology/hugging-face-candidates.yaml` (the registry's source of
 * truth — license/provenance states carried VERBATIM, never re-summarized).
 *
 * NOTHING HERE RAN: no model was downloaded, no checkpoint was committed,
 * no GPU inference executed (the candidates are GPU-gated; this sandbox
 * delivered the structure only — see {@link CAMERA_BENCH_STATUS}).
 *
 * PURITY: data only — no clock, no env, no I/O, no model names in domain
 * semantics (ADR-009/011: a candidate id is a Technology Plane entry, never
 * canonical truth).
 */

/** One benchmark metric of the frozen `renderer.cinematicReCamera` profile. */
export interface CameraBenchMetric {
  /** The metric's stable id (the report's row key). */
  id: string;
  /** The frozen task-profile metric this implements (verbatim name). */
  profileMetric: string;
  /** What is measured (one honest sentence). */
  definition: string;
  /** How it is measured (the repo seam that implements it). */
  measuredThrough: string;
}

/**
 * The metric vocabulary — every metric of the frozen
 * `docs/contracts/technology-task-profiles.md` renderer.cinematicReCamera
 * profile, with the measurement approach per CAMERA-BENCH.md §3.
 */
export const CAMERA_BENCH_METRICS: readonly CameraBenchMetric[] = Object.freeze([
  {
    id: "camera-path-adherence",
    profileMetric: "camera-path adherence",
    definition:
      "the rendered video's recovered camera trajectory vs the Camera-Director-issued path (per-keyframe pose error, endpoint drift, realized-path smoothness)",
    measuredThrough:
      "calibration/TvCalib-lineage pose recovery over the output frames vs the Director's deterministic fixture paths",
  },
  {
    id: "player-ball-identity",
    profileMetric: "player/ball identity",
    definition:
      "entity identity stability in the OUTPUT video: identity switches, disappearance-without-event, appearance consistency vs the SWM's known roster",
    measuredThrough:
      "re-detection + tracking over the output frames (@sporta/perception-detection + @sporta/perception-tracking), compared to the canonical SWM roster",
  },
  {
    id: "temporal-consistency",
    profileMetric: "temporal consistency",
    definition:
      "identity flicker, geometry drift, and temporal artifacts over the output frames — the SAME metrics the procedural renderers are held to",
    measuredThrough: "this package's own temporal harness (evaluateRenderOutput) over the output",
  },
  {
    id: "geometry-consistency",
    profileMetric: "geometry consistency",
    definition:
      "the rendered scene's recovered geometry vs the canonical pitch frame (105 x 68 m): landmark reprojection error and player ground positions",
    measuredThrough: "pitch-landmark reprojection against the canonical SWM pitch frame",
  },
  {
    id: "hallucinated-region-rate",
    profileMetric: "hallucinated/unseen-region rate",
    definition:
      "the fraction of output content with NO basis in the source or SWM (contradicting known geometry/entities); legitimate novel-view synthesis of unseen regions is measured separately and labeled honestly",
    measuredThrough:
      "consistency between the output and re-projected source regions + SWM-known geometry",
  },
  {
    id: "event-preservation",
    profileMetric: "event preservation",
    definition:
      "the canonical events inside the rendered window remain observable in the output (goal/no-goal states, possession continuity)",
    measuredThrough: "the SWM event stream vs observable output state at the event timestamps",
  },
  {
    id: "generation-latency",
    profileMetric: "generation latency",
    definition: "wall-clock per output second (and per clip), cold and warm",
    measuredThrough: "the compute plane's own timing (the W914 seam's execution measurements)",
  },
  {
    id: "generation-cost",
    profileMetric: "generation cost",
    definition: "the metered cost units + peak VRAM of the run",
    measuredThrough: "the compute plane's usage.costUnits surface + the adapter's declared VRAM",
  },
]);

/** One benchmark candidate's DISCOVERY record (not production approval). */
export interface CameraBenchCandidate {
  /** The registry's candidate id (the Technology Plane entry key). */
  candidateId: string;
  /** The discovery source (the model card / repository URL, verbatim). */
  source: string;
  /** The declared task-profile ids (verbatim). */
  tasks: readonly string[];
  /** The license state, VERBATIM from the candidates yaml. */
  license: string;
  /** The promotion gate, VERBATIM from the candidates yaml. */
  promotion: string;
  /** The Worker C HF work item that owns this candidate's benchmark. */
  hfItem: "HF010" | "HF011" | "HF012" | "HF013";
  /**
   * The license gate's meaning (the registry's own closed vocabulary — a
   * GATE, never a silent pass).
   */
  licenseNote: string;
}

/**
 * The candidate registry — license/provenance states VERBATIM from
 * `docs/technology/hugging-face-candidates.yaml` (the source of truth).
 * ADR-011: model cards and downloads are DISCOVERY inputs, not production
 * approval; every promotion gate below must clear (benchmark + license +
 * provenance review) before any production use.
 */
export const CAMERA_BENCH_CANDIDATES: readonly CameraBenchCandidate[] = Object.freeze([
  {
    candidateId: "hf.wan22.fun.control-camera",
    source: "https://huggingface.co/alibaba-pai/Wan2.2-Fun-A14B-Control-Camera",
    tasks: ["renderer.cinematicReCamera"],
    license: "apache-2.0",
    promotion: "benchmark-required",
    hfItem: "HF010",
    licenseNote:
      "permissive; still benchmark-required before any production promotion (ADR-011 acceptance)",
  },
  {
    candidateId: "hf.recammaster",
    source: "https://github.com/KlingAIResearch/ReCamMaster",
    tasks: ["renderer.cinematicReCamera"],
    license: "mit-code-check-model-terms",
    promotion: "license-and-benchmark-required",
    hfItem: "HF010",
    licenseNote:
      "the CODE is MIT; the MODEL/CHECKPOINT terms must be checked before any download (the HF002 provenance ledger is the recording seam)",
  },
  {
    candidateId: "hf.meridian",
    source: "https://huggingface.co/Viggle/Meridian",
    tasks: ["renderer.cinematicReCamera"],
    license: "research-only-until-cleared",
    promotion: "benchmark-and-legal-review",
    hfItem: "HF010",
    licenseNote:
      "research use only until legal review clears commercial use; CANNOT become a production dependency",
  },
  {
    candidateId: "hf.viewcrafter25",
    source: "https://huggingface.co/Drexubery/ViewCrafter_25",
    tasks: ["renderer.cinematicReCamera.experimental"],
    license: "apache-2.0-current-card",
    promotion: "benchmark-only",
    hfItem: "HF011",
    licenseNote:
      "permissive as of the current card; re-verify on every version bump (the card is the license source, not the repo name)",
  },
  {
    candidateId: "hf.wan22.animate",
    source: "https://huggingface.co/Wan-AI/Wan2.2-Animate-14B",
    tasks: ["renderer.characterAnimation"],
    license: "verify-current-card",
    promotion: "license-and-benchmark-required",
    hfItem: "HF012",
    licenseNote:
      "the model card must be re-read at registration time; no assumption of permissiveness",
  },
  {
    candidateId: "hf.ltx23",
    source: "https://huggingface.co/Lightricks/LTX-2.3",
    tasks: ["renderer.neuralVideo", "renderer.audioVideoGeneration", "renderer.upscale"],
    license: "ltx-2-community",
    promotion: "license-and-benchmark-required",
    hfItem: "HF013",
    licenseNote:
      "the LTX-2 community license carries revenue-tiered commercial conditions; commercial-use review required",
  },
]);

/** One harness stage of the benchmark (the structure the GPU waves run). */
export interface CameraBenchStage {
  id: string;
  /** What the stage does (one honest sentence). */
  purpose: string;
  /** The stage's fail-loud rule (what refuses rather than degrading). */
  honestyRule: string;
}

/** The harness stages (CAMERA-BENCH.md §4). */
export const CAMERA_BENCH_STAGES: readonly CameraBenchStage[] = Object.freeze([
  {
    id: "fixture-resolution",
    purpose:
      "resolve the licensed gate clips (R601/R602, CC BY-SA 4.0, operator-local — never committed binaries), the Director-issued deterministic camera paths, and the canonical SWM snapshots",
    honestyRule:
      "REFUSES to run when the licensed clips are absent (typed, loud) — the detection-benchmark precedent; no synthetic stand-in for the source media",
  },
  {
    id: "adapter-registration",
    purpose:
      "register each candidate as a TechnologyProfile (capability, version, provenance, resource/execution requirements, license, failure semantics, benchmark identity)",
    honestyRule:
      "the license/promotion gate must clear per candidate BEFORE any checkpoint download; nothing is silently vendored (the HF002 provenance ledger records every download decision)",
  },
  {
    id: "run",
    purpose:
      "dispatch one render job per candidate x clip x camera-path through the compute plane (the W914 seam — BYOC or Sporta-managed GPU)",
    honestyRule:
      "latency and cost are measured on the REAL execution path; refusals/OOMs/timeouts are recorded as first-class results, never retried away",
  },
  {
    id: "measurement",
    purpose: `apply every metric of CAMERA_BENCH_METRICS over the run's frozen outputs`,
    honestyRule:
      "exact measured values + threshold verdicts; no metric silently degrades (the W503 discipline)",
  },
  {
    id: "report",
    purpose:
      "emit the reproducible BenchmarkRun/EvaluationReport (seeded fixtures, versioned adapters, the full metric table, the failure envelope)",
    honestyRule:
      "the report states which candidate, which adapter version, which fixtures (by hash), and which compute plane ran — or it did not happen",
  },
]);

/** The honest status of this harness's runs (the §7 record, as data). */
export interface CameraBenchStatus {
  /** Whether any benchmark run executed in this delivery. */
  ran: boolean;
  /** The honest reason (verbatim from the delivery record). */
  reason: string;
  /** What is prepared (the structure the GPU-backed waves implement). */
  prepared: readonly string[];
}

/**
 * The honest status: NOTHING RAN (the candidates are GPU-gated; this
 * sandbox delivered the design/structure + registry only). Never a faked
 * benchmark row.
 */
export const CAMERA_BENCH_STATUS: CameraBenchStatus = Object.freeze({
  ran: false,
  reason:
    "the camera-controlled neural renderer candidates are GPU-gated; no model was downloaded, no checkpoint was committed, and no GPU inference was executed in this sandbox — the wave's deliverable is the harness design/structure + the candidate registry",
  prepared: [
    "the metric vocabulary (CAMERA_BENCH_METRICS — every frozen renderer.cinematicReCamera metric, with measurement approaches)",
    "the candidate registry (CAMERA_BENCH_CANDIDATES — license/provenance states verbatim from docs/technology/hugging-face-candidates.yaml)",
    "the harness stages (CAMERA_BENCH_STAGES — fixture-resolution through report)",
    "the fixture-set contract (the licensed gate clips + Director-issued camera paths + the canonical SWM snapshots — CAMERA-BENCH.md §2)",
  ],
});
