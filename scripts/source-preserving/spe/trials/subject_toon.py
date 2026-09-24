"""Trial candidate B — `subject-toon` (segmentation-guided dual-path toon).

yaml selection (docs/technology/source-preserving-candidates.yaml):

  - id `matting.mog2.cv2`:
      technology: "MOG2 background subtraction (cv2.createBackgroundSubtractorMOG2)"
      license: { code: BSD-3-Clause, weights: none }      -> commercial OK
      runtime: { cpu: true, gpu: false }, latency: real-time-class CPU
      quality: "good static-camera masks; broadcast pans corrupt model"
      integration: "SPE-v1 subject-masking stage + global-motion compensation reuse"
      classification: preferred-implementation-candidate, sandbox_feasibility:
      cpu-local-runnable
  - id `flow.farneback.cv2`:
      runtime: { cpu: true }, temporal_consistency: exact-deterministic,
      "dense flow adequate for trail masks and temporal smoothing at 640x360",
      classification: preferred-implementation-candidate
  - `spr202.det.framediff` rationale ("pan-robust, weaker semantics") informs the
    mask design: the yaml's own failure_modes field for MOG2 ("broadcast pans
    corrupt model") is why the mask fuses MOG2 with the engine's
    camera-compensated Farneback residual (spe.stages.flow_magnitude —
    translation+zoom least-squares fit), exactly the "global-motion
    compensation reuse" the yaml's integration field prescribes.

Tier-2 diagnosis being attacked (docs/status/source-preserving-reality-status.md):
"aggressive styles destroy player structure" — wave-1 cartoon-cel/anime-npr
applied one global stylization strength, so player identity collapsed with the
background.  This trial splits the pipeline into two stylization paths:

  subject path (soft mask ~1): gentle — median(3) + single bilateral pass +
      mild saturation + thin floored XDoG lines.  NO palette quantization:
      kit colors, numbers, limb structure stay essentially source-true.
  background path (soft mask ~0): strong — full cartoon stack (median +
      triple bilateral + fixed-per-clip LAB palette K=10 + region smoothing +
      boundary contour lines + saturation lift), i.e. cartoon-cel-class
      stylization where identity does not matter.

The subject mask = OR(camera-compensated Farneback residual motion, MOG2
foreground), morphology-cleaned, dilated, with temporal persistence (EMA max
decay, cut-reset).  MOG2 is re-initialized at every detected cut so no
background model bleeds across a source cut (contract §3.4: cuts preserved,
no cross-cut blending).

Deterministic: MOG2 GMM updates and Farneback are deterministic functions of
the frame sequence; no RNG anywhere in this module.
"""

from __future__ import annotations

from typing import List, Optional

import cv2
import numpy as np

from .. import stages as S
from .common import TrialSpec, gray_small, is_cut_start, merge_profile


def _new_mog2(cfg: dict):
    return cv2.createBackgroundSubtractorMOG2(
        history=cfg["mogHistory"], varThreshold=cfg["mogVarThreshold"],
        detectShadows=False)


class SubjectToonProcessor:
    """Stateful streaming processor (mask EMA + MOG2, both cut-reset)."""

    def __init__(self, spec: TrialSpec, palette: Optional[np.ndarray],
                 cuts: List[int], profile: str):
        self.spec = spec
        self.profile = profile
        self.cfg = merge_profile(spec.config, profile)
        self.palette = palette
        self.cuts = set(cuts)
        self.frame_index = 0
        self.prev_gray_small: Optional[np.ndarray] = None
        self.mask_ema: Optional[np.ndarray] = None   # (180,320) float32
        self.mog2 = _new_mog2(self.cfg)
        self._k3 = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        self._k5 = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        self._k7 = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))

    # -- subject mask ----------------------------------------------------------

    def _subject_mask(self, bgr: np.ndarray, cut: bool) -> np.ndarray:
        """Soft full-res subject mask in [0,1] (players/ball protected)."""
        c = self.cfg
        gs = gray_small(bgr)
        if self.prev_gray_small is not None and not cut:
            mag = S.flow_magnitude(self.prev_gray_small, gs)   # camera-compensated
            motion = (mag > c["motionKnee"]).astype(np.float32)
        else:
            motion = np.zeros(gs.shape, dtype=np.float32)
        if cut:
            # honest cut preservation: rebuild the background model from the
            # new scene (no cross-cut model bleed)
            self.mog2 = _new_mog2(self.cfg)
            fg255 = self.mog2.apply(bgr, learningRate=1.0)
        else:
            fg255 = self.mog2.apply(bgr, learningRate=c["mogLearningRate"])
        fg = (fg255 > 0).astype(np.float32)
        fg_small = cv2.resize(fg, (gs.shape[1], gs.shape[0]),
                              interpolation=cv2.INTER_AREA)
        raw = np.maximum(motion, fg_small)
        raw = cv2.morphologyEx(raw, cv2.MORPH_OPEN, self._k3)   # kill speckle
        raw = cv2.morphologyEx(raw, cv2.MORPH_CLOSE, self._k5)  # fill bodies
        raw = cv2.dilate(raw, self._k5)                          # pad subjects
        if self.mask_ema is None or cut:
            self.mask_ema = raw
        else:
            self.mask_ema = np.maximum(raw, self.mask_ema * c["maskDecay"])
        h, w = bgr.shape[:2]
        m = cv2.resize(self.mask_ema, (w, h), interpolation=cv2.INTER_LINEAR)
        m = cv2.GaussianBlur(m, (0, 0), c["maskSoften"])         # no cutout seams
        return np.clip(m, 0.0, 1.0)
    # -- dual stylization paths -------------------------------------------------

    def _background_path(self, bgr: np.ndarray) -> np.ndarray:
        """Strong cartoon stack (cartoon-cel-class, identity-free zone)."""
        c = self.cfg
        out = S.median_pool(bgr, c["bgMedianK"])
        out = S.bilateral_flatten(out, c["bgBilatD"], c["bgBilatSigma"],
                                  c["bgBilatSigma"], c["bgBilatIters"])
        out, idx = S.quantize_lab(out, self.palette,
                                  l_weight=c.get("lWeight", 0.45), return_idx=True)
        idx = S.smooth_regions(idx, self.palette.shape[0],
                               window=c["bgRegionWindow"])
        out = S.recolor(idx, self.palette)
        out = S.saturation_lift(out, c["bgSaturation"])
        edges = S.boundary_edge_map(idx, dilate=c["bgLineDilate"])
        out = S.edge_overlay(out, edges, c["bgLineFloor"])
        return out

    def _subject_path(self, bgr: np.ndarray) -> np.ndarray:
        """Gentle identity-preserving pass (no palette quantization)."""
        c = self.cfg
        out = S.median_pool(bgr, c["sjMedianK"])
        out = S.bilateral_flatten(out, c["sjBilatD"], c["sjBilatSigma"],
                                  c["sjBilatSigma"], c["sjBilatIters"])
        edges = S.xdog_edge_map(out, sigma=c["sjXdogSigma"], k=c["sjXdogK"],
                                tau=c["sjXdogTau"], eps=c["sjXdogEps"],
                                phi=c["sjXdogPhi"])
        out = S.edge_overlay(out, edges, c["sjLineFloor"])
        out = S.saturation_lift(out, c["sjSaturation"])
        return out

    # -- pipeline -------------------------------------------------------------

    def __call__(self, bgr: np.ndarray) -> np.ndarray:
        cut = is_cut_start(self.frame_index, self.cuts)
        m = self._subject_mask(bgr, cut)[..., None]              # (H,W,1)
        bg = self._background_path(bgr).astype(np.float32)
        sj = self._subject_path(bgr).astype(np.float32)
        out = bg * (1.0 - m) + sj * m
        self.prev_gray_small = gray_small(bgr)
        self.frame_index += 1
        return np.clip(out, 0, 255).astype(np.uint8)


def _factory(spec: TrialSpec, palette, cuts, profile):
    return SubjectToonProcessor(spec, palette, cuts, profile)


SPEC = TrialSpec(
    trialId="sprtrial-subject-toon-t1",
    name="subject-toon",
    reality="subject-toon",
    family="Segmentation-Guided Toon (SPR101-class wave-2 trial)",
    sprFamily="SPR101 (guided variant)",
    candidateSource="matting.mog2.cv2 + flow.farneback.cv2 (+spr202.det.framediff pan-robustness rationale)",
    paletteK=10,
    usesFlow=True,
    pipeline=[
        "subject_mask(OR[farneback_residual>1.8 @320x180 camera-compensated, "
        "MOG2 fg], open3/close5/dilate5, EMA decay=0.90 cut-reset, soften sigma=2.5)",
        "background_path(median5+bilateral x3+palette K=10 LAB+region-smooth5"
        "+boundary-lines floor 0.30+sat 1.22)",
        "subject_path(median3+bilateral x1+xdog thin lines floor 0.62+sat 1.08, "
        "NO palette quantize)",
        "soft_mask_composite(bg,subj)",
    ],
    description=("Dual-path toon: strong cartoon stylization on the background, "
                 "identity-preserving gentle pass on camera-compensated "
                 "motion/foreground-masked subjects."),
    config={
        # mask
        "motionKnee": 1.8, "mogHistory": 150, "mogVarThreshold": 25.0,
        "mogLearningRate": 0.05, "maskDecay": 0.90, "maskSoften": 4.0,
        # background (strong) path
        "bgMedianK": 5, "bgBilatD": 9, "bgBilatSigma": 75, "bgBilatIters": 3,
        "bgRegionWindow": 5, "bgSaturation": 1.22, "bgLineDilate": 1,
        "bgLineFloor": 0.30, "lWeight": 0.45,
        # subject (gentle) path
        "sjMedianK": 3, "sjBilatD": 7, "sjBilatSigma": 50, "sjBilatIters": 1,
        "sjXdogSigma": 1.0, "sjXdogK": 1.6, "sjXdogTau": 0.98,
        "sjXdogEps": 0.010, "sjXdogPhi": 8.0,
        "sjLineFloor": 0.70, "sjSaturation": 1.10,
    },
    factory=_factory,
)
