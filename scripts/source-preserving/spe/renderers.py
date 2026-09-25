"""SPE-v1 renderer implementations (deterministic-classical, version 0.1.0).

Each renderer = a registered pipeline composition over the stage library.
All renderers stream frames (constant memory) and are bit-reproducible.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, List, Optional

import cv2
import numpy as np

from . import stages as S


@dataclass
class RendererSpec:
    rendererId: str
    reality: str            # reality key (CLI --reality)
    family: str             # human family name
    sprId: str
    version: str = "0.1.0"
    engine: str = "SPE-v1"
    implementation: str = "deterministic-classical"
    profiles: List[str] = field(default_factory=lambda: ["default"])
    paletteK: Optional[int] = None
    usesFlow: bool = False
    pipeline: List[str] = field(default_factory=list)
    description: str = ""
    # config actually consumed at render time (canonical for provenance hashing)
    config: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# per-renderer frame processors
# ---------------------------------------------------------------------------


class FrameProcessor:
    """Stateful streaming processor (prev-frame flow, energy accumulation, cuts)."""

    def __init__(self, spec: RendererSpec, palette: Optional[np.ndarray],
                 cuts: List[int], profile: str):
        self.spec = spec
        self.profile = profile
        self.palette = palette
        self.cuts = set(cuts)
        self.prev_gray_small: Optional[np.ndarray] = None
        self.energy: Optional[np.ndarray] = None
        self.frame_index = 0
        self.noir_lut = S.tone_lut(S.NOIR_CURVE)
        cfg = spec.config
        self.cfg = cfg
        self.vmask: Optional[np.ndarray] = None

    # -- helpers ------------------------------------------------------------

    def _gray_small(self, bgr: np.ndarray) -> np.ndarray:
        small = cv2.resize(bgr, (320, 180), interpolation=cv2.INTER_AREA)
        return cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

    def _is_cut_start(self) -> bool:
        # cut at diffs index k means frame k+1 starts a new scene
        return (self.frame_index - 1) in self.cuts

    # -- the pipeline dispatch ----------------------------------------------

    def __call__(self, bgr: np.ndarray) -> np.ndarray:
        cfg = dict(self.cfg)
        if self.profile in cfg.get("profiles", {}):
            cfg.update(cfg["profiles"][self.profile])
        out = bgr
        reality = self.spec.reality

        if reality == "cartoon-cel":
            out = S.median_pool(out, cfg.get("medianK", 5))
            out = S.bilateral_flatten(out, cfg.get("bilatD", 9),
                                      cfg.get("bilatSigma", 75),
                                      cfg.get("bilatSigma", 75),
                                      cfg.get("bilatIters", 3))
            out, idx = S.quantize_lab(out, self.palette,
                                      l_weight=cfg.get("lWeight", 0.45),
                                      return_idx=True)
            idx = S.smooth_regions(idx, self.palette.shape[0],
                                   window=cfg.get("regionWindow", 5))
            out = S.recolor(idx, self.palette)
            out = S.saturation_lift(out, cfg.get("saturation", 1.18))
            # cel contour lines = consolidated-region boundaries (speckle-free)
            edges = S.boundary_edge_map(idx, dilate=cfg.get("lineDilate", 1))
            out = S.edge_overlay(out, edges, cfg.get("lineFloor", 0.30))

        elif reality == "anime-npr":
            out = S.median_pool(out, cfg.get("medianK", 3))
            out = S.bilateral_flatten(out, cfg.get("bilatD", 9),
                                      cfg.get("bilatSigma", 85),
                                      cfg.get("bilatSigma", 85),
                                      cfg.get("bilatIters", 3))
            out, idx = S.quantize_lab(out, self.palette,
                                      l_weight=cfg.get("lWeight", 0.45),
                                      return_idx=True)
            idx = S.smooth_regions(idx, self.palette.shape[0],
                                   window=cfg.get("regionWindow", 5))
            out = S.saturation_lift(out, cfg.get("saturation", 1.32))
            edges = S.boundary_edge_map(idx, dilate=cfg.get("lineDilate", 1))
            out = S.edge_overlay(out, edges, cfg.get("lineFloor", 0.34))
            if cfg.get("bloom", 0.25) > 0:
                out = S.bloom(out, threshold=cfg.get("bloomThreshold", 205),
                              strength=cfg["bloom"], blur=cfg.get("bloomBlur", 21))

        elif reality == "noir-retro":
            if self.profile == "vhs":
                out = S.saturation_lift(out, 0.95)
                out = S.vhs_artifacts(out, self.frame_index)
                out = S.grain(out, self.frame_index, cfg.get("grain", 7.0))
            else:  # noir
                out = S.desaturate(out, cfg.get("colorKeep", 0.25))
                out = self.noir_lut(out)
                if self.vmask is None:
                    self.vmask = S.vignette_mask(out.shape[1], out.shape[0],
                                                 cfg.get("vignette", 0.35))
                out = S.apply_vignette(out, self.vmask)
                out = S.grain(out, self.frame_index, cfg.get("grain", 6.0))

        elif reality == "motion-trails":
            gray_small = self._gray_small(bgr)
            if self.prev_gray_small is not None:
                mag = S.flow_magnitude(self.prev_gray_small, gray_small)
                if self.energy is None or self._is_cut_start():
                    self.energy = mag.copy()
                else:
                    decay = cfg.get("decay", 0.88)
                    self.energy = np.maximum(mag, self.energy * decay)
                out = S.trail_blend(
                    S.desaturate(bgr, cfg.get("baseDesat", 0.85)), self.energy,
                    decay=cfg.get("decay", 0.88),
                    t0=cfg.get("kneeLow", 2.4), t1=cfg.get("kneeHigh", 9.0),
                    strength=cfg.get("strength", 0.55),
                )
            self.prev_gray_small = gray_small

        elif reality == "subject-toon":
            if not hasattr(self, "_subject_toon_state"):
                self._subject_toon_state = _SubjectToonState(
                    cfg, self.palette, self.cuts)
            out = self._subject_toon_state(
                bgr, self._gray_small(bgr), self._is_cut_start())

        else:
            raise ValueError(f"unknown reality {reality}")

        self.frame_index += 1
        return out


# ---------------------------------------------------------------------------
# subject-toon streaming state (SPR101 guided variant)
#
# Promoted from trial `sprtrial-subject-toon-t1` (SPR-W2-C, Lane C —
# scripts/source-preserving/spe/trials/subject_toon.py, read-only history).
# The port RESTATES the trial's tiny helpers (gray-small / cut-start / profile
# merge already exist on FrameProcessor) instead of importing from
# spe.trials.common: importing the trials package from the frozen engine would
# couple renderers.py to a lane write-surface (and pull in every trial module
# via spe/trials/__init__.py). Stage order and parameters are identical to the
# trial processor; the frozen stages/encode/provenance libraries are reused
# read-only so the renderer inherits the bit-exact encoder and
# contract-shaped provenance.
# ---------------------------------------------------------------------------


class _SubjectToonState:
    """Streaming state for the segmentation-guided dual-path toon pipeline.

    Subject mask = OR(camera-compensated Farneback residual motion, MOG2
    foreground), morphology-cleaned (open 3 / close 5 / dilate 5), with
    temporal persistence (EMA max-decay, cut-reset). MOG2 is re-initialized
    at every detected cut so no background model bleeds across a source cut
    (contract §3.4). Deterministic: MOG2 GMM updates and Farneback are
    deterministic functions of the frame sequence; no RNG in this class.
    """

    def __init__(self, cfg: dict, palette: Optional[np.ndarray], cuts: set):
        self.cfg = cfg
        self.palette = palette
        self.cuts = cuts
        self.prev_gray_small: Optional[np.ndarray] = None
        self.mask_ema: Optional[np.ndarray] = None   # (180, 320) float32
        self.mog2 = cv2.createBackgroundSubtractorMOG2(
            history=cfg["mogHistory"], varThreshold=cfg["mogVarThreshold"],
            detectShadows=False)
        self._k3 = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        self._k5 = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))

    # -- subject mask --------------------------------------------------------

    def _subject_mask(self, bgr: np.ndarray, gray_small: np.ndarray,
                      cut: bool) -> np.ndarray:
        """Soft full-res subject mask in [0,1] (players/ball protected)."""
        c = self.cfg
        if self.prev_gray_small is not None and not cut:
            mag = S.flow_magnitude(self.prev_gray_small, gray_small)
            motion = (mag > c["motionKnee"]).astype(np.float32)
        else:
            motion = np.zeros(gray_small.shape, dtype=np.float32)
        if cut:
            # honest cut preservation: rebuild the background model from the
            # new scene (no cross-cut model bleed)
            self.mog2 = cv2.createBackgroundSubtractorMOG2(
                history=c["mogHistory"], varThreshold=c["mogVarThreshold"],
                detectShadows=False)
            fg255 = self.mog2.apply(bgr, learningRate=1.0)
        else:
            fg255 = self.mog2.apply(bgr, learningRate=c["mogLearningRate"])
        fg = (fg255 > 0).astype(np.float32)
        fg_small = cv2.resize(fg, (gray_small.shape[1], gray_small.shape[0]),
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

    # -- dual stylization paths -----------------------------------------------

    def _background_path(self, bgr: np.ndarray) -> np.ndarray:
        """Strong cartoon stack (cartoon-cel-class, identity-free zone)."""
        c = self.cfg
        out = S.median_pool(bgr, c["bgMedianK"])
        out = S.bilateral_flatten(out, c["bgBilatD"], c["bgBilatSigma"],
                                  c["bgBilatSigma"], c["bgBilatIters"])
        out, idx = S.quantize_lab(out, self.palette,
                                  l_weight=c.get("lWeight", 0.45),
                                  return_idx=True)
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

    def __call__(self, bgr: np.ndarray, gray_small: np.ndarray,
                 cut: bool) -> np.ndarray:
        m = self._subject_mask(bgr, gray_small, cut)[..., None]     # (H,W,1)
        bg = self._background_path(bgr).astype(np.float32)
        sj = self._subject_path(bgr).astype(np.float32)
        out = bg * (1.0 - m) + sj * m
        self.prev_gray_small = gray_small
        return np.clip(out, 0, 255).astype(np.uint8)


# ---------------------------------------------------------------------------
# registry
# ---------------------------------------------------------------------------

CARTOON_CEL = RendererSpec(
    rendererId="spr-cartoon-cel-dc1", reality="cartoon-cel",
    family="Cartoon / Cel-Shaded Broadcast", sprId="SPR101",
    paletteK=12,
    pipeline=["median_pool(5)", "bilateral_flatten(d=9,s=75,iter=3)",
              "palette_quantize(K=12,chroma-weighted,fixed-per-clip LAB)",
              "saturation_lift(1.18)",
              "boundary_lines(palette-region contours)+edge_overlay"],
    description="Flat graphic color regions, clean contours, stable cel look.",
    config={"medianK": 5, "bilatD": 9, "bilatSigma": 75, "bilatIters": 3,
            "saturation": 1.18, "lWeight": 0.45, "lineDilate": 1, "regionWindow": 5,
            "lineFloor": 0.30},
)

ANIME_NPR = RendererSpec(
    rendererId="spr-anime-npr-dc1", reality="anime-npr",
    family="Anime / NPR Broadcast", sprId="SPR102",
    paletteK=11,
    pipeline=["median_pool(3)", "bilateral_flatten(d=9,s=85,iter=3)",
              "palette_quantize(K=9,chroma-weighted,fixed-per-clip LAB)",
              "saturation_lift(1.32)",
              "boundary_lines(thin)+edge_overlay", "bloom(subtle)"],
    description="Anime broadcast look: flat limited palette, clean line art, soft bloom.",
    config={"medianK": 3, "bilatD": 9, "bilatSigma": 85, "bilatIters": 3,
            "saturation": 1.24, "lWeight": 0.45, "lineDilate": 1, "regionWindow": 5,
            "lineFloor": 0.34,
            "bloom": 0.12, "bloomThreshold": 208, "bloomBlur": 21},
)

NOIR_RETRO = RendererSpec(
    rendererId="spr-noir-retro-dc1", reality="noir-retro",
    family="Noir / Monochrome / Retro Broadcast", sprId="SPR108",
    profiles=["noir", "vhs"],
    pipeline=["desaturate+tone_lut+grain+vignette (noir) | "
              "chroma_shift+scanlines+jitter+grain (vhs)"],
    description="Deterministic retro broadcast baselines: film noir and VHS.",
    config={"grain": 6.0, "vignette": 0.35, "colorKeep": 0.25,
            "profiles": {"vhs": {"grain": 7.0}}},
)

MOTION_TRAILS = RendererSpec(
    rendererId="spr-motion-trails-dc1", reality="motion-trails",
    family="Motion Trails (source-enhancing)", sprId="SPR201",
    usesFlow=True,
    pipeline=["farneback_flow(camera-compensated)", "trail_accumulate(decay=0.88,cut-reset,noise-knee)",
              "colormap+screen_blend over desaturated original"],
    description="Flow-energy trails over the real broadcast; motion emphasis only.",
    config={"decay": 0.88, "kneeLow": 2.4, "kneeHigh": 9.0,
            "strength": 0.55, "baseDesat": 0.85},
)

REGISTRY = {r.reality: r for r in (CARTOON_CEL, ANIME_NPR, NOIR_RETRO, MOTION_TRAILS)}

SUBJECT_TOON = RendererSpec(
    rendererId="spr-subject-toon-dc1", reality="subject-toon",
    family="Segmentation-Guided Toon (SPR101 guided variant)", sprId="SPR101",
    paletteK=10,
    usesFlow=True,
    pipeline=[
        "subject_mask(OR[farneback_residual>1.8 @320x180 camera-compensated, "
        "MOG2 fg(history=150,var=25,lr=0.05,cut-reinit)], open3/close5/dilate5, "
        "EMA decay=0.90 cut-reset, soften sigma=4.0)",
        "background_path(median5+bilateral x3(d9,s75)+palette K=10 LAB "
        "chroma-weighted+region-smooth5+boundary-lines floor 0.30+sat 1.22)",
        "subject_path(median3+bilateral x1(d7,s50)+xdog thin lines floor 0.70"
        "+sat 1.10, NO palette quantize)",
        "soft_mask_composite(bg,subj)",
    ],
    description=("Dual-path toon: strong cartoon stylization on the background, "
                 "identity-preserving gentle pass on camera-compensated "
                 "motion/foreground-masked subjects. Promoted from trial "
                 "sprtrial-subject-toon-t1 (SPR-W2-C) — attacks the Tier-2 "
                 "diagnosis that aggressive styles destroy player identity."),
    config={
        # subject mask
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
)

# additive registry append (SPR-W3-B): the promoted subject-toon row enters
# the REGISTRY without modifying the frozen four-row construction above
REGISTRY[SUBJECT_TOON.reality] = SUBJECT_TOON
