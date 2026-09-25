"""SPE-v1 wave-2 LANE C trials — stylizer upgrade feasibility candidates.

This package is the write surface of task SPR-W2-C (Lane C). It NEVER touches
the frozen engine: `spe.renderers.REGISTRY`, `spe.stages`, `spe.encode`,
`spe.provenance` are imported read-only and reused, exactly like any external
technology would integrate behind the contract (docs/contracts/
source-preserving-renderer.md §4: "Neural candidates enter as `*-nn*` ids …
never replacing the deterministic id" — our trial ids carry the `sprtrial-`
prefix and are NOT registry rows).

Trial candidates (selected from docs/technology/source-preserving-candidates.yaml):

  kuwahara-paint   <- yaml `spr103.det.kuwahara-aniso` + wave2 `w2.kuwahara-aniso-numpy`
                      ("biggest painterly-quality jump with zero new dependencies",
                       cpu-local-runnable, own numpy implementation of a public
                       algorithm — Kyprianidis 2009 class anisotropic Kuwahara)
  subject-toon     <- yaml `matting.mog2.cv2` (subject-masking enabler,
                      "SPE-v1 subject-masking stage + global-motion compensation
                      reuse") + `flow.farneback.cv2` (exact-deterministic);
                      attacks the Tier-2 diagnosis "aggressive styles destroy
                      player identity" with a dual-path (protected-subject /
                      stylized-background) pipeline
  flow-prop-toon   <- yaml `styl.ebsynth` concept (keyframe + propagate,
                      "temporal_consistency: strong (propagated)") implemented on
                      the license-clean `flow.farneback.cv2` enabler; the EbSynth
                      binary itself is deferred (yaml license_red_flag
                      `ebsynth-terms`, external proprietary binary download)

All trials are deterministic-classical, CPU-only, zero new runtime dependencies
(OpenCV BSD-3 + numpy BSD-3 already in the frozen engine's toolset).
"""

from __future__ import annotations

from .common import TrialSpec, analyze_window
from . import kuwahara_paint, subject_toon, flow_prop_toon

TRIALS = {
    kuwahara_paint.SPEC.name: kuwahara_paint.SPEC,
    subject_toon.SPEC.name: subject_toon.SPEC,
    flow_prop_toon.SPEC.name: flow_prop_toon.SPEC,
}

__all__ = ["TRIALS", "TrialSpec", "analyze_window"]
