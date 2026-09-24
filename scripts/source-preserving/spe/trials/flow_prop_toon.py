"""Trial candidate C — `flow-prop-toon` (flow-propagated stylization).

yaml selection (docs/technology/source-preserving-candidates.yaml):

  - id `styl.ebsynth` — the wave-2 rank-1 concept:
      technology: "example-based stylization propagation (paint keyframe, propagate)"
      quality: "hand-painted quality with temporal consistency by construction"
      temporal_consistency: "strong (propagated)"
      runtime: { cpu: true, gpu: false, notes: "no GPU required" }
      integration: "CLI automation + keyframe pipeline; OUR deterministic frames
                    as examples"
      license_red_flag: ebsynth-terms (proprietary-free binary, terms flagged,
      verification deferred) + external binary download from ebsynth.com
  - Implemented instead on the license-clean enabler `flow.farneback.cv2`
    (BSD-3, cpu-local-runnable, temporal_consistency: exact-deterministic,
    "dense flow adequate for trail masks and temporal smoothing at 640x360"):
    the SAME keyframe+propagation architecture (stylized keyframe canvas,
    warped forward between keyframes) with the engine's own dense flow —
    zero external binaries, zero flagged licenses.  Full EbSynth remains the
    wave-3 A/B if the TL accepts its terms.

Mechanism (attacks the Tier-2 flicker/limb-morphology diagnosis):

  every keyInterval-th frame (and at every detected cut — contract §3.4):
      canvas = strong cartoon-cel-class keyframe stylization (fixed per-clip
      LAB palette => colors identical across all keyframes)
  in between:
      backward-warp the previous stylized canvas by the Farneback flow of the
      ORIGINAL frames (remap with BORDER_REPLICATE) and re-anchor:
          canvas = (1-reanchorRate)*warped_canvas + reanchorRate*full_stylized
      (the re-anchor fraction kills accumulated warp drift/ghosting while the
      propagated component keeps the appearance temporally stable; explicit
      keyframes bound any residual drift).  Display blend per pixel:
          trust = clip(flow_mag / flowKnee, 0, 1)
          out   = (1 - trustWeight*trust)*canvas + trustWeight*trust*light
      Fast player motion is carried by the near-source light pass (identity +
      limbs); static regions show the stable propagated stylization.

Static regions keep a stable propagated appearance (the stylization does not
re-roll per frame — the wave-1 flicker source), and cuts hard-reset the canvas
so source cuts pass through at stylized amplitude.

Deterministic: Farneback + remap + fixed params; no RNG anywhere.
"""

from __future__ import annotations

from typing import List, Optional

import cv2
import numpy as np

from .. import stages as S
from .common import TrialSpec, is_cut_start, merge_profile


class FlowPropToonProcessor:
    """Stateful streaming processor (stylized canvas + flow propagation)."""

    def __init__(self, spec: TrialSpec, palette: Optional[np.ndarray],
                 cuts: List[int], profile: str):
        self.spec = spec
        self.profile = profile
        self.cfg = merge_profile(spec.config, profile)
        self.palette = palette
        self.cuts = set(cuts)
        self.frame_index = 0
        self.prev_gray: Optional[np.ndarray] = None   # full-res gray (uint8)
        self.canvas: Optional[np.ndarray] = None      # propagated stylized frame
        self.since_key = 0

    # -- stylizers -------------------------------------------------------------

    def _styl_full(self, bgr: np.ndarray) -> np.ndarray:
        """Strong keyframe stylizer (cartoon-cel-class, fixed palette)."""
        c = self.cfg
        out = S.median_pool(bgr, c["keyMedianK"])
        out = S.bilateral_flatten(out, c["keyBilatD"], c["keyBilatSigma"],
                                  c["keyBilatSigma"], c["keyBilatIters"])
        out, idx = S.quantize_lab(out, self.palette,
                                  l_weight=c.get("lWeight", 0.45), return_idx=True)
        idx = S.smooth_regions(idx, self.palette.shape[0],
                               window=c["keyRegionWindow"])
        out = S.recolor(idx, self.palette)
        out = S.saturation_lift(out, c["keySaturation"])
        edges = S.boundary_edge_map(idx, dilate=c["keyLineDilate"])
        out = S.edge_overlay(out, edges, c["keyLineFloor"])
        return out

    def _styl_light(self, bgr: np.ndarray) -> np.ndarray:
        """Gentle per-frame pass (identity carrier between keyframes)."""
        c = self.cfg
        out = S.median_pool(bgr, c["lightMedianK"])
        out = S.bilateral_flatten(out, c["lightBilatD"], c["lightBilatSigma"],
                                  c["lightBilatSigma"], c["lightBilatIters"])
        out = S.saturation_lift(out, c["lightSaturation"])
        return out

    # -- pipeline -------------------------------------------------------------

    def __call__(self, bgr: np.ndarray) -> np.ndarray:
        c = self.cfg
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        cut = is_cut_start(self.frame_index, self.cuts)
        if self.canvas is None or cut or self.since_key >= c["keyInterval"]:
            # keyframe (and every cut): fresh fully-stylized canvas
            self.canvas = self._styl_full(bgr)
            self.since_key = 0
            out = self.canvas
        else:
            flow = cv2.calcOpticalFlowFarneback(
                self.prev_gray, gray, None, 0.5, 3, 15, 3, 5, 1.2, 0)
            h, w = gray.shape
            ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
            # backward map: dst(q) = canvas(q - flow(q)) (first-order preimage)
            map_x = xs - flow[..., 0]
            map_y = ys - flow[..., 1]
            warped = cv2.remap(self.canvas, map_x, map_y,
                               interpolation=cv2.INTER_LINEAR,
                               borderMode=cv2.BORDER_REPLICATE)
            # re-anchored propagation: the canvas is mostly the warped previous
            # canvas (temporal stability by construction) plus a fixed fraction
            # of the CURRENT full stylization, which kills accumulated warp
            # drift/ghosting while keeping the propagated appearance.  Explicit
            # keyframes bound any residual drift.
            full = self._styl_full(bgr).astype(np.float32)
            r = c["reanchorRate"]
            self.canvas = np.clip(
                (1.0 - r) * warped.astype(np.float32) + r * full, 0, 255
            ).astype(np.uint8)
            # display blend: motion-trust carries fast player motion through the
            # gentle identity pass; static regions show the propagated canvas
            light = self._styl_light(bgr).astype(np.float32)
            mag = np.sqrt(flow[..., 0] ** 2 + flow[..., 1] ** 2).astype(np.float32)
            trust = np.clip(mag / c["flowKnee"], 0.0, 1.0)
            wgt = (c["trustWeight"] * trust)[..., None]
            out_f = self.canvas.astype(np.float32) * (1.0 - wgt) + light * wgt
            out = np.clip(out_f, 0, 255).astype(np.uint8)
            self.since_key += 1
        self.prev_gray = gray
        self.frame_index += 1
        return out


def _factory(spec: TrialSpec, palette, cuts, profile):
    return FlowPropToonProcessor(spec, palette, cuts, profile)


SPEC = TrialSpec(
    trialId="sprtrial-flow-prop-toon-t1",
    name="flow-prop-toon",
    reality="flow-prop-toon",
    family="Flow-Propagated Toon (SPR101/109-class wave-2 trial)",
    sprFamily="SPR101 (propagated variant)",
    candidateSource=("styl.ebsynth concept (keyframe+propagate) implemented on "
                     "flow.farneback.cv2 (license-clean enabler)"),
    paletteK=12,
    usesFlow=True,
    pipeline=[
        "keyframe stylizer every 10th frame + every cut (median5+bilateral x3+"
        "palette K=12 LAB+region-smooth5+boundary-lines floor 0.30+sat 1.18)",
        "farneback flow on original gray (full res, frozen engine params)",
        "canvas = 0.85*warp(prev canvas, backward flow) + 0.15*current full "
        "stylization (re-anchored propagation; remap BORDER_REPLICATE)",
        "display blend: canvas*(1-0.85*clip(mag/3.0)) + light pass "
        "(median3+bilateral x1+sat 1.14)*0.85*clip(mag/3.0)",
        "keyframe/cut reset bounds warp drift",
    ],
    description=("Keyframe+propagate toon: strong stylized keyframes warped "
                 "forward by dense optical flow and blended with a gentle "
                 "identity pass; static appearance stable by construction, "
                 "fast motion carried near-source."),
    config={
        "keyInterval": 10,
        "flowKnee": 3.5, "trustWeight": 0.85, "reanchorRate": 0.12,
        # keyframe (strong) stylizer
        "keyMedianK": 5, "keyBilatD": 9, "keyBilatSigma": 75, "keyBilatIters": 3,
        "keyRegionWindow": 5, "keySaturation": 1.22, "keyLineDilate": 1,
        "keyLineFloor": 0.30, "lWeight": 0.45,
        # light per-frame pass
        "lightMedianK": 3, "lightBilatD": 9, "lightBilatSigma": 65,
        "lightBilatIters": 1, "lightSaturation": 1.14,
    },
    factory=_factory,
)
