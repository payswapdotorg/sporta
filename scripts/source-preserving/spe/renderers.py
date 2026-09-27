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

        elif reality == "neon-cyberpunk":
            if not hasattr(self, "_neon_cyberpunk_state"):
                self._neon_cyberpunk_state = _NeonCyberpunkState(cfg)
            out = self._neon_cyberpunk_state(bgr)

        elif reality == "ink-manga":
            if not hasattr(self, "_ink_manga_state"):
                self._ink_manga_state = _InkMangaState(cfg)
            out = self._ink_manga_state(bgr)

        elif reality == "lowpoly-game":
            if not hasattr(self, "_lowpoly_game_state"):
                self._lowpoly_game_state = _LowpolyGameState(
                    cfg, self.palette, self.cuts)
            out = self._lowpoly_game_state(bgr, self._is_cut_start())

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
# neon-cyberpunk pipeline state (SPR107)
#
# Fresh wave-4 reality (SPR-W4-C): fixed teal/magenta LUT color grade +
# Gaussian-pyramid bloom + Sobel edge glow, per the SPR107 work-item brief
# ("LUT + bloom + edge glow"). The state object holds ONLY frozen per-render
# constants (baked 256-entry curve LUT, channel-mix matrix, tint vectors,
# knee/weight parameters) so nothing is recomputed per frame; the transform
# itself is a PURE per-frame function:
#   - zero temporal accumulators (no EMA, no prev-frame reference)
#   - zero RNG (no grain, no jitter)
#   - zero frame-index dependence
# This is the SPR-W3-B noir-vhs T3-diagnosis law by construction: i.i.d.
# per-frame noise / coherent per-frame jitter decorrelates the motion-energy
# series (grain alone r=0.9986, jitter alone r=0.7304); this pipeline has
# neither, so G-T3 measures only the deterministic LUT's pass-through of the
# source motion. All coefficients below are FROZEN CONSTANTS declared in the
# NEON_CYBERPUNK registry row (config) — the styleConfigHash is stable and
# identical for every clip (no per-clip adaptation).
# ---------------------------------------------------------------------------


class _NeonCyberpunkState:
    """SPR107 neon/cyberpunk pipeline (LUT + bloom + edge glow).

    Stage 1  _neon_lut_grade : fixed 3x3 BGR channel mix (row-normalized,
              cools the base toward teal) -> baked 256-entry pivot-contrast
              S-curve (identical table for all channels) -> soft split-tone
              (teal shadows / magenta highlights, BT.601-luma weighted knee).
    Stage 2  _bloom_pyramid  : max-channel soft threshold on the graded frame
              -> 3-octave pyrDown Gaussian pyramid -> per-octave pyrUp
              upsample chain (dstsize-exact, fixed 5x5 kernels) -> weighted
              sum -> ADDITIVE composite onto the graded frame.
    Stage 3  _edge_glow      : Sobel(k=3) magnitude on the graded luma
              (pre-bloom: bloom would soften the edge structure) -> soft
              knee -> Gaussian soften -> neon-cyan tint soft (alpha)
              composite over the bloomed frame.

    Deterministic: every op is a fixed function of the current frame; the
    same input bytes + config always produce the same output bytes.
    """

    def __init__(self, cfg: dict):
        c = self.cfg = cfg
        # stage 1 — LUT color grade ------------------------------------
        # baked 256-entry S-curve: y = clip(pivot + (x/255 - pivot)
        # * contrast) * 255, rounded once at bake time (identical table for
        # B/G/R, so the curve is a true per-channel LUT after the mix)
        pivot, contrast = float(c.get("curvePivot", 0.44)), \
            float(c.get("curveContrast", 1.28))
        u = np.arange(256, dtype=np.float32) / 255.0
        curve = np.clip(pivot + (u - pivot) * contrast, 0.0, 1.0) * 255.0
        self.curve_lut = np.clip(np.round(curve), 0, 255).astype(np.uint8)
        # fixed 3x3 BGR channel-mix matrix, rows sum to 1.0 (level-preserving)
        self.mix = np.array(c.get(
            "mixMatrix", [[0.86, 0.10, 0.04],
                          [0.07, 0.84, 0.09],
                          [0.12, 0.16, 0.72]]), dtype=np.float32)
        # BT.601 luma weights (B, G, R)
        self.luma_w = np.array(c.get("lumaWeights", [0.114, 0.587, 0.299]),
                               dtype=np.float32)
        self.split_lo = float(c.get("splitKneeLow", 0.38))
        self.split_hi = float(c.get("splitKneeHigh", 0.72))
        self.teal = np.array(c.get("shadowTeal", [34, 22, -26]),
                             dtype=np.float32)      # B, G, R additive tint
        self.magenta = np.array(c.get("highlightMagenta", [18, -22, 34]),
                                dtype=np.float32)  # B, G, R additive tint
        # stage 2 — bloom (threshold + pyramid upsample + additive) --------
        self.bloom_lo = float(c.get("bloomThrLow", 196.0))
        self.bloom_hi = float(c.get("bloomThrHigh", 244.0))
        self.bloom_levels = int(c.get("bloomLevels", 3))
        self.bloom_weights = [float(w) for w in c.get(
            "bloomWeights", [0.42, 0.33, 0.25])]
        self.bloom_strength = float(c.get("bloomStrength", 0.75))
        # stage 3 — edge glow (Sobel magnitude + tint + soft composite) ----
        self.edge_lo = float(c.get("edgeKneeLow", 120.0))
        self.edge_hi = float(c.get("edgeKneeHigh", 480.0))
        self.edge_soften = float(c.get("edgeSoften", 1.2))
        self.edge_alpha = float(c.get("edgeAlpha", 0.62))
        self.edge_tint = np.array(c.get("edgeTint", [200, 250, 90]),
                                  dtype=np.float32)  # neon cyan (B, G, R)

    # -- helpers ------------------------------------------------------------

    @staticmethod
    def _smooth01(x: np.ndarray) -> np.ndarray:
        """Soft 0->1 knee (hermite smoothstep) on a float array."""
        t = np.clip(x, 0.0, 1.0)
        return t * t * (3.0 - 2.0 * t)

    # -- stage 1: fixed teal/magenta LUT grade -------------------------------

    def _neon_lut_grade(self, bgr: np.ndarray) -> np.ndarray:
        f = bgr.astype(np.float32) @ self.mix.T       # fixed channel mix
        mixed = np.clip(np.round(f), 0, 255).astype(np.uint8)
        mixed = cv2.LUT(mixed, self.curve_lut)        # baked pivot-contrast
        g = mixed.astype(np.float32)
        luma = g @ self.luma_w / 255.0                # BT.601, in [0,1]
        w = self._smooth01((luma - self.split_lo) /
                           max(self.split_hi - self.split_lo, 1e-6))
        tint = (self.teal[None, None, :] * (1.0 - w[..., None])
                + self.magenta[None, None, :] * w[..., None])
        return np.clip(g + tint, 0, 255).astype(np.uint8)

    # -- stage 2: threshold + Gaussian pyramid bloom -------------------------

    def _bloom_pyramid(self, bgr: np.ndarray) -> np.ndarray:
        f = bgr.astype(np.float32)
        v = f.max(axis=2)                             # highlight value
        mask = self._smooth01((v - self.bloom_lo) /
                              max(self.bloom_hi - self.bloom_lo, 1e-6))
        bright = f * mask[..., None]
        # octaves[0] = full-res thresholded brights (not composited raw);
        # octaves[i] = brights downsampled i times (fixed 5x5 Gaussian)
        octaves = [bright]
        for _ in range(self.bloom_levels):
            octaves.append(cv2.pyrDown(octaves[-1]))
        sizes = [(o.shape[1], o.shape[0]) for o in octaves]
        glow = np.zeros_like(f)
        for i in range(1, self.bloom_levels + 1):
            up = octaves[i]
            for j in range(i, 0, -1):                 # dstsize-exact chain up
                up = cv2.pyrUp(up, dstsize=sizes[j - 1])
            glow += self.bloom_weights[i - 1] * up
        return np.clip(f + self.bloom_strength * glow, 0, 255).astype(np.uint8)

    # -- stage 3: Sobel edge glow ---------------------------------------------

    def _edge_glow(self, graded: np.ndarray, current: np.ndarray) -> np.ndarray:
        f = current.astype(np.float32)
        g = graded.astype(np.float32)
        luma = g @ self.luma_w                        # graded (pre-bloom) luma
        gx = cv2.Sobel(luma, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(luma, cv2.CV_32F, 0, 1, ksize=3)
        mag = np.sqrt(gx * gx + gy * gy)
        e = self._smooth01((mag - self.edge_lo) /
                           max(self.edge_hi - self.edge_lo, 1e-6))
        e = cv2.GaussianBlur(e, (0, 0), self.edge_soften)
        a = (self.edge_alpha * e)[..., None]
        return np.clip(f * (1.0 - a) + self.edge_tint[None, None, :] * a,
                       0, 255).astype(np.uint8)

    # -- pipeline ---------------------------------------------------------------

    def __call__(self, bgr: np.ndarray) -> np.ndarray:
        graded = self._neon_lut_grade(bgr)
        bloomed = self._bloom_pyramid(graded)
        return self._edge_glow(graded, bloomed)


# ---------------------------------------------------------------------------
# ink-manga pipeline state (SPR104)
#
# Fresh wave-5 reality (SPR-W5-C, SPR104 deterministic baseline
# spr104.det.xdog-halftone from docs/technology/source-preserving-
# candidates.yaml): grayscale + XDoG soft-threshold line art (sketch
# mode) + 2-3 ink value classes + screen-space fixed-lattice Bayer
# screentone + fixed paper grain. The state object holds ONLY frozen
# per-render constants (baked 256-entry tone LUT, tiled Bayer threshold
# lattice, fixed paper-grain texture) so the transform is a PURE per-frame
# function of the frame bytes:
#   - zero temporal accumulators (no EMA, no prev-frame reference)
#   - zero per-frame RNG (the grain texture is generated ONCE from a fixed
#     seed and composited identically every frame — zero temporal delta;
#     strictly more stable than the noir grain, which re-rolls per frame
#     and still measured G-T3 r=0.9986 / G-T4 0.48%)
#   - zero frame-index dependence
# Anti-crawl rules (from the SPR104 candidate record, binding): the
# screentone lattice is SCREEN-ANCHORED (indexed by pixel coordinates
# only — never re-fit to content), the tone-class thresholds are FIXED
# constants (no per-frame adaptation), so static scene areas produce
# byte-identical dot patterns by construction — the family's documented
# temporal-strength ("fixed dot lattice = no dot crawl").
# ---------------------------------------------------------------------------


class _InkMangaState:
    """SPR104 ink/manga pipeline (XDoG + fixed-lattice screentone).

    Stage 1  pre_smooth  : median + bilateral (fixed params) — suppresses
              sensor noise so the XDoG lines and the screentone thresholds
              do not crawl on static regions (the record's "XDoG noise
              crawl" failure mode; the same mitigation class as
              cartoon-cel's pre-quantize flatten).
    Stage 2  XDoG        : Winnemöller soft-threshold difference-of-
              Gaussians (sketch mode) on the smoothed frame, via the
              frozen stage library — thin stable ink lines; parameters
              are FIXED per frame (no temporal adaptation, per the
              record). With tau=0.98, flat regions carry a
              (1-tau)*L pedestal in v = g1 - tau*g2, so eps fixes the
              sketch's ink-pooling floor: flats with L > eps/(1-tau)
              (~0.075 at eps=0.0015) stay paper, darker flats pool
              into ink, and true contours land as lines on their dark
              side. The line layer is then binarized at a fixed knee
              and median-stabilized (3x3) + re-softened (sigma 0.8) —
              the cartoon-cel boundary-line pattern — so the soft
              band's high gain never reaches the compositor; lineMode
              "soft" (pre-binary continuous burn) is retained as a
              config option for A/B only.
    Stage 3  tone        : BT.601 luma -> baked 256-entry pivot-contrast
              S-curve (ink pooling) with the XDoG edge map burned in
              (edge pixels drop toward the line floor -> ink).
    Stage 4  screentone  : screen-anchored clustered-dot halftone
              screen: ink dot iff screen threshold < ink density.
              The density runs over the full [0,1] range with FIXED
              soft knees saturating to solid ink below the ink knee and
              to clean paper above the paper knee (smoothstep blends,
              fixed widths) — no hard class boundaries exist, so the
              response to sub-flow-gate content drift (measured 2-16
              gray levels/frame on the b2 close-up static selection) is
              continuous dot growth/shrink instead of 255-level class
              flips. The dither preserves the local mean and the G-T3
              motion-energy series survives binarization (area-averaged
              dot fields reconstruct the tone). Optional ink-level
              pooling quantizes the density to a fixed ladder (0 = off).
    Stage 5  paper_grain : a FIXED zero-mean procedural texture (seeded
              RNG, generated once per render, same seed for every clip)
              added subtly — identical every frame, so it contributes
              zero flicker by construction.

    Deterministic: every op is a fixed function of the current frame;
    the same input bytes + config always produce the same output bytes.
    """

    def __init__(self, cfg: dict):
        c = self.cfg = cfg
        # stage 1 — pre-smooth (noise-crawl mitigation) ----------------------
        self.pre_median_k = int(c.get("preMedianK", 3))
        self.bilat_d = int(c.get("preBilatD", 9))
        self.bilat_sigma = float(c.get("preBilatSigma", 60.0))
        self.bilat_iters = int(c.get("preBilatIters", 2))
        # stage 2 — XDoG line art (frozen stage library, fixed params) -------
        self.xdog_sigma = float(c.get("xdogSigma", 1.0))
        self.xdog_k = float(c.get("xdogK", 1.6))
        self.xdog_tau = float(c.get("xdogTau", 0.98))
        self.xdog_eps = float(c.get("xdogEps", 0.0015))
        self.xdog_phi = float(c.get("xdogPhi", 10.0))
        self.line_floor = float(c.get("lineFloor", 0.20))
        # line compositor: binary median-stabilized strokes (the
        # cartoon-cel boundary-line pattern) or the continuous soft burn
        self.line_mode = str(c.get("lineMode", "binary"))
        self.line_knee = float(c.get("lineKnee", 0.5))
        self.line_median = int(c.get("lineMedian", 3))
        self.line_soften = float(c.get("lineSoften", 0.8))
        # stage 3 — tone S-curve (baked 256-entry LUT, rounded once) ---------
        pivot, contrast = float(c.get("tonePivot", 0.55)), \
            float(c.get("toneContrast", 1.15))
        u = np.arange(256, dtype=np.float32) / 255.0
        curve = np.clip(pivot + (u - pivot) * contrast, 0.0, 1.0)
        self.tone_lut = np.clip(np.round(curve * 255.0), 0, 255).astype(np.uint8)
        # stage 4 — tone classes + screen-anchored clustered-dot lattice ----
        self.paper_knee = float(c.get("paperKnee", 0.84))
        self.ink_knee = float(c.get("inkKnee", 0.16))
        self.ink_w = float(c.get("inkKneeWidth", 0.07))
        self.paper_w = float(c.get("paperKneeWidth", 0.04))
        n = self.screen_n = int(c.get("screenN", 8))
        # clustered-dot halftone screen (deterministic, screen-anchored):
        # threshold by rank of (dist-to-nearest-dot-center minus
        # dist-to-nearest-hole-corner) over the periodic n x n tile, so ink
        # always forms ONE connected blob growing from the tile center and
        # paper holes shrink at corners — compact dots (not Bayer scatter)
        # that read as screentone and survive the frozen crf-20 encoder.
        ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
        half = n / 2.0
        # periodic euclidean distance to the nearest lattice point
        dy = np.minimum(np.abs(ys - half), n - np.abs(ys - half))
        dx = np.minimum(np.abs(xs - half), n - np.abs(xs - half))
        d_center = np.sqrt(dy * dy + dx * dx)          # dot centers: tile middle
        dy0 = np.minimum(ys, n - ys)
        dx0 = np.minimum(xs, n - xs)
        d_corner = np.sqrt(dy0 * dy0 + dx0 * dx0)      # hole centers: tile corners
        grow = d_center - d_corner                      # small = inks early
        order = np.argsort(grow.ravel(), kind="stable")
        rank = np.empty(n * n, dtype=np.float32)
        rank[order] = np.arange(n * n, dtype=np.float32)
        # thresholds in (0,1), mid-rank convention: ink dot iff
        # threshold < density (full 0..1 density range representable)
        self.screen = ((rank.reshape(n, n) + 0.5) / (n * n)).astype(np.float32)
        self.ink_levels = int(c.get("inkLevels", 0))
        # soft ordered dither: dot values ramp across the threshold in a
        # fixed window (flip amplitude ~w instead of 1.0); exact saturation
        # clamps keep solid-ink / clean-paper regions truly solid/clean
        self.dot_soft = float(c.get("dotSoft", 0.0))
        # stage 5 — fixed paper grain (built lazily per frame shape) ---------
        self.grain_seed = int(c.get("grainSeed", 42))
        self.grain_scale = float(c.get("grainScale", 5.0))
        self.grain: Optional[np.ndarray] = None
        self.screen_t: Optional[np.ndarray] = None

    # -- helpers ------------------------------------------------------------

    @staticmethod
    def _smooth01(x: np.ndarray) -> np.ndarray:
        """Soft 0->1 knee (hermite smoothstep) on a float array."""
        t = np.clip(x, 0.0, 1.0)
        return t * t * (3.0 - 2.0 * t)

    # -- fixed textures (same clip -> same shape -> same textures) ----------

    def _fixed_textures(self, shape) -> None:
        if self.screen_t is None or self.screen_t.shape != shape:
            h, w = shape
            self.screen_t = np.tile(self.screen, (h // self.screen_n + 1,
                                                  w // self.screen_n + 1))[:h, :w]
        if self.grain is None or self.grain.shape != shape:
            rng = np.random.default_rng(self.grain_seed)
            self.grain = rng.normal(0.0, self.grain_scale,
                                    size=shape).astype(np.float32)

    # -- pipeline -------------------------------------------------------------

    def __call__(self, bgr: np.ndarray) -> np.ndarray:
        # stage 1 — pre-smooth (fixed params; kills sensor noise so the
        # threshold stages below do not crawl on static regions)
        sm = S.median_pool(bgr, self.pre_median_k)
        sm = S.bilateral_flatten(sm, self.bilat_d, self.bilat_sigma,
                                 self.bilat_sigma, self.bilat_iters)
        # stage 2 — XDoG soft-threshold line art (E: 1 flat, ->0 on edges)
        edges = S.xdog_edge_map(sm, sigma=self.xdog_sigma, k=self.xdog_k,
                                tau=self.xdog_tau, eps=self.xdog_eps,
                                phi=self.xdog_phi)
        if self.line_mode == "binary":
            # binarize at a fixed knee, median-stabilize (kills isolated
            # speckle), re-soften with a fixed sigma — the cartoon-cel
            # boundary-line pattern; the XDoG soft band's high gain
            # (phi/eps amplification of tiny v differences) never reaches
            # the compositor this way
            line = (edges < self.line_knee).astype(np.uint8)
            if self.line_median > 1:
                line = cv2.medianBlur(line, self.line_median)
            e_eff = 1.0 - cv2.GaussianBlur(line.astype(np.float32),
                                           (0, 0), self.line_soften)
        else:  # "soft" — continuous burn (fast-loop A/B option)
            e_eff = edges
        # stage 3 — tone: curved luma with the line art burned in
        gray = cv2.cvtColor(sm, cv2.COLOR_BGR2GRAY)
        tone = cv2.LUT(gray, self.tone_lut).astype(np.float32) / 255.0
        tone = tone * (self.line_floor + (1.0 - self.line_floor) * e_eff)
        # stage 4 — screen-anchored clustered-dot dither over the full
        # density range with FIXED soft knees (no hard class boundaries:
        # sub-flow-gate content drift grows/shrinks dots continuously
        # instead of flipping whole pixels between classes)
        self._fixed_textures(tone.shape)
        density = 1.0 - tone              # ink fraction the tone asks for
        if self.ink_levels > 1:           # fixed ink-pooling ladder (if any)
            density = np.round(density * (self.ink_levels - 1)) \
                / float(self.ink_levels - 1)
        if self.ink_w > 0.0:              # soft saturation to solid ink
            b = self._smooth01((tone - (self.ink_knee - self.ink_w))
                                / (2.0 * self.ink_w))
            density = density * b + (1.0 - b)
        if self.paper_w > 0.0:            # soft saturation to clean paper
            b = self._smooth01((tone - (self.paper_knee - self.paper_w))
                                / (2.0 * self.paper_w))
            density = density * (1.0 - b)
        if self.dot_soft > 0.0:
            # soft dots: value ramps across the threshold (fixed window);
            # near-saturated densities clamp to true ink / true paper so
            # solid pools stay solid and paper stays clean
            w = self.dot_soft
            u = (density - self.screen_t) / w + 0.5
            val = 255.0 * (1.0 - self._smooth01(u))
            val = np.where(density >= 1.0 - 0.5 * w, 0.0, val)
            val = np.where(density <= 0.5 * w, 255.0, val)
        else:
            ink = self.screen_t < density       # hard ordered dither
            val = np.where(ink, 0.0, 255.0)
        out = val + self.grain
        mono = np.clip(out, 0.0, 255.0).astype(np.uint8)
        return cv2.cvtColor(mono, cv2.COLOR_GRAY2BGR)


# ---------------------------------------------------------------------------
# low-poly/game pipeline state (SPR106) — w5b rank-1 dispatch recipe
#
# Fresh wave-5 reality (SPR-W5-E, Lane G): the SPR106 deterministic baseline
# spr106.det.delaunay-flatfill (docs/technology/spr105-106-candidates.yaml →
# wave_recommendation rank 1). The family is structure-ADDITIVE — the
# triangulation REINJECTS structure (facet boundaries track real edges via
# saliency anchors), the w5b thesis under trial. Stage math:
#
#   stage 1  saliency   : Sobel magnitude on luma (numpy float64 sqrt —
#               cv2.magnitude is 1-ulp alignment-flaky here, root-caused
#               in the w5e determinism battle), Gaussian sigma-2 smoothed,
#               5-frame trailing box average (deterministic window,
#               cut-reset) — the anti-flicker saliency of the recipe.
#   stage 2  anchors    : FIXED jittered grid (fixed-PRNG offsets generated
#               once per render; screen-anchored 20 px lattice — never
#               moves) + border ring (frame-edge triangulation coverage)
#               + saliency top-up to N=1500 drawn by FIXED-QUANTILE
#               inverse-CDF sampling (same fixed uniforms every frame, so
#               the top-up slots track the saliency-mass quantiles —
#               per-frame resampling is smooth, not noisy).
#   stage 3  temporal   : Farneback flow (320x180, the in-engine flow
#               convention) warps the previous frame's top-up anchors
#               forward; fixed EMA (alpha=0.65) blends warped-old with the
#               fresh quantile sample; cut-reset drops ALL state (saliency
#               window, anchor slots, flow history) at every engine-detected
#               cut (contract invariant 4 — no cross-cut blending). The
#               grid slots are screen-fixed and never move (structure floor,
#               the block-voxel "fixed grid = no crawl" law).
#   stage 4  rasterize  : cv2.Subdiv2D Delaunay over the deduped anchor set
#               (1-px grid-snap dedupe — Subdiv2D degenerates on
#               duplicates); per-triangle cv2.fillPoly into an int32 label
#               map (the w5b MEASURED label-map path; the naive per-triangle
#               mask fill is the recorded 2425.7 ms/f anti-pattern and is
#               NOT used); np.bincount per-channel means + LUT
#               back-projection give the flat-shaded facets. Optional
#               palette snap: per-triangle means snapped to the fixed
#               per-clip K=16 LAB palette (chroma-weighted nearest, the
#               quantize_lab convention).
#   stage 5  facet lines: label-edge darken x0.45 via the frozen
#               boundary_edge_map + edge_overlay stages (dilate 1,
#               soften 0.8) — the identity-anchor facet edges.
#   game-cel profile (optional): soft-knee quantized-V toon ramp (4 steps,
#               knee width 14 luma levels — no hard class boundaries, the
#               ink-manga drift lesson) + Sobel outline (soft knee 90..360,
#               dilate 2, floor 0.30).
#
# Deterministic: fixed PRNG seeds (grid jitter, quantile uniforms), no
# cross-frame RNG state, pure functions of the frame sequence; double-render
# byte-identity is the G-T5 proof. CV2 Subdiv2D / Farneback / fillPoly /
# bincount are all single-valued deterministic ops in this environment
# (proven by the existing flow-using rows' byte-identity records).
# ---------------------------------------------------------------------------


class _LowpolyGameState:
    """Streaming state for the SPR106 low-poly/game pipeline."""

    def __init__(self, cfg: dict, palette: Optional[np.ndarray], cuts: set):
        c = self.cfg = cfg
        self.palette = palette
        self.cuts = cuts
        # stage 1 — saliency
        self.sal_sigma = float(c.get("saliencySigma", 2.0))
        self.sal_win = int(c.get("saliencyWindow", 5))
        # stage 2 — anchors
        self.grid_px = int(c.get("gridSpacing", 20))
        self.jitter = float(c.get("gridJitter", 6.0))
        self.grid_seed = int(c.get("gridSeed", 20260927))
        self.anchor_n = int(c.get("anchorN", 1500))
        self.topup_seed = int(c.get("topupSeed", 1066))
        # stage 3 — temporal stabilization
        self.temporal = bool(c.get("temporal", True))
        self.ema_alpha = float(c.get("emaAlpha", 0.65))
        self.flow_scale = int(c.get("flowScale", 2))
        # stage 4 — flat fill (+ optional fixed LAB palette snap)
        self.palette_snap = bool(c.get("paletteSnap", False))
        self.l_weight = float(c.get("lWeight", 0.45))
        # stage 5 — facet edge lines
        self.edge_darken = float(c.get("edgeDarken", 0.45))
        self.edge_dilate = int(c.get("edgeDilate", 1))
        self.edge_soften = float(c.get("edgeSoften", 0.8))
        # game-cel profile (optional)
        self.ramp_steps = int(c.get("toonRampSteps", 0))
        self.ramp_width = float(c.get("toonRampWidth", 14.0))
        self.outline = bool(c.get("outline", False))
        self.out_lo = float(c.get("outlineKneeLow", 90.0))
        self.out_hi = float(c.get("outlineKneeHigh", 360.0))
        self.out_dilate = int(c.get("outlineDilate", 2))
        self.out_floor = float(c.get("outlineFloor", 0.30))
        # streaming state
        self.sal_buf: List[np.ndarray] = []
        self.slots: Optional[np.ndarray] = None      # persistent top-up slots
        self.gray_small_prev: Optional[np.ndarray] = None
        self.gray_small: Optional[np.ndarray] = None
        self._grid: Optional[np.ndarray] = None      # cached fixed grid+ring
        self._grid_hw: tuple = (0, 0)
        self._u: Optional[np.ndarray] = None         # fixed quantile uniforms

    # -- stage 1: saliency ---------------------------------------------------

    def _saliency(self, gray: np.ndarray) -> np.ndarray:
        gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
        # magnitude via numpy float64 sqrt — cv2.magnitude (IPP, float32)
        # is alignment-dispatched and 1-ulp NONDETERMINISTIC in this
        # environment (root-caused in the w5e determinism battle: b12
        # pass1/pass2 sha mismatch, 36/60 frames differing); IEEE float64
        # sqrt is correctly rounded on every compliant path -> bit-stable
        mag = np.sqrt(gx.astype(np.float64) ** 2
                      + gy.astype(np.float64) ** 2).astype(np.float32)
        return cv2.GaussianBlur(mag, (0, 0), self.sal_sigma)

    # -- stage 2: anchors ----------------------------------------------------

    def _fixed_grid(self, w: int, h: int) -> np.ndarray:
        """Screen-anchored jittered lattice + border ring (deterministic)."""
        if self._grid is not None and self._grid_hw == (h, w):
            return self._grid
        step = self.grid_px
        rng = np.random.default_rng(self.grid_seed)
        xs = np.arange(step // 2, w, step, dtype=np.float32)
        ys = np.arange(step // 2, h, step, dtype=np.float32)
        gx, gy = np.meshgrid(xs, ys)
        jx = rng.uniform(-self.jitter, self.jitter,
                         size=gx.shape).astype(np.float32)
        jy = rng.uniform(-self.jitter, self.jitter,
                         size=gy.shape).astype(np.float32)
        px = np.clip(gx + jx, 1.0, w - 2.0)
        py = np.clip(gy + jy, 1.0, h - 2.0)
        pts = np.stack([px.ravel(), py.ravel()], axis=1)
        # border ring: corners + every step px along the edges (inset 1 px;
        # guarantees the Delaunay hull covers the full frame)
        ring = [(1.0, 1.0), (w - 2.0, 1.0), (1.0, h - 2.0), (w - 2.0, h - 2.0)]
        for x in range(step, w - step, step):
            ring += [(float(x), 1.0), (float(x), h - 2.0)]
        for y in range(step, h - step, step):
            ring += [(1.0, float(y)), (w - 2.0, float(y))]
        grid = np.vstack([np.array(ring, dtype=np.float32), pts])
        self._grid = np.ascontiguousarray(grid, dtype=np.float32)
        self._grid_hw = (h, w)
        return self._grid

    def _topup_fresh(self, sal_avg: np.ndarray, m: int) -> np.ndarray:
        """Saliency inverse-CDF samples at FIXED quantiles (stateless)."""
        if m <= 0:
            return np.zeros((0, 2), np.float32)
        if self._u is None or len(self._u) != m:
            rng = np.random.default_rng(self.topup_seed)
            self._u = rng.random(m)
        p = sal_avg.ravel().astype(np.float64)
        h, w = sal_avg.shape
        s = float(p.sum())
        if s <= 1e-12:
            # degenerate flat frame: deterministic uniform lattice fallback
            lin = np.arange(m, dtype=np.int64) * (p.size - 1) // max(m - 1, 1)
            ys, xs = np.divmod(lin, w)
            return np.stack([xs, ys], 1).astype(np.float32)
        cdf = np.cumsum(p / s)
        idx = np.clip(np.searchsorted(cdf, self._u, side="right"),
                      0, p.size - 1)
        ys, xs = np.divmod(idx, w)
        return np.stack([xs, ys], 1).astype(np.float32)

    # -- stage 4: triangulate + rasterize + flat fill -------------------------

    def _rasterize(self, pts: np.ndarray, w: int, h: int):
        """Delaunay label map (int32, 0 = unassigned) + triangle count."""
        subdiv = cv2.Subdiv2D((0, 0, w, h))
        vidx = {}
        for i in range(len(pts)):
            x = float(pts[i, 0])
            y = float(pts[i, 1])
            k = (round(x, 2), round(y, 2))
            if k in vidx:
                continue
            try:
                subdiv.insert((x, y))
                vidx[k] = i
            except cv2.error:
                continue  # degenerate insert: skip deterministically
        tl = subdiv.getTriangleList()
        label = np.zeros((h, w), dtype=np.int32)
        nt = 0
        for row in tl:
            a = vidx.get((round(float(row[0]), 2), round(float(row[1]), 2)))
            b = vidx.get((round(float(row[2]), 2), round(float(row[3]), 2)))
            c = vidx.get((round(float(row[4]), 2), round(float(row[5]), 2)))
            if a is None or b is None or c is None:
                continue  # outer super-triangle vertices
            nt += 1
            poly = np.round(row.reshape(3, 2)).astype(np.int32)
            cv2.fillPoly(label, [poly], nt)
        # seam safety: neighbor fill for any unclaimed pixels (Delaunay
        # tiles exactly inside the 1-px border ring inset, so this only
        # back-fills the outermost frame row/column from its inner
        # neighbor — shift order prefers the correct-side neighbor)
        if (label == 0).any():
            for axis, sh in ((1, -1), (1, 1), (0, -1), (0, 1)):
                nb = np.roll(label, sh, axis=axis)
                m = (label == 0) & (nb != 0)
                label[m] = nb[m]
        return label, nt

    def _snap_means(self, means: np.ndarray) -> np.ndarray:
        """Snap per-triangle BGR means to the fixed per-clip LAB palette."""
        tri8 = np.clip(np.round(means), 0, 255).astype(np.uint8)
        tri8 = np.ascontiguousarray(tri8.reshape(-1, 1, 3))
        lab = cv2.cvtColor(tri8, cv2.COLOR_BGR2LAB).reshape(-1, 3)
        lab = lab.astype(np.float32)
        pal = self.palette.astype(np.float32)
        wl = np.array([self.l_weight, 1.0, 1.0], dtype=np.float32)
        d = ((lab[:, None, :] - pal[None, :, :]) * wl) ** 2
        idx = np.argmin(d.sum(-1), axis=1)
        snapped = np.ascontiguousarray(
            self.palette[idx].astype(np.uint8).reshape(-1, 1, 3))
        bgr = cv2.cvtColor(snapped, cv2.COLOR_LAB2BGR).reshape(-1, 3)
        return bgr.astype(np.float64)

    def _flat_fill(self, label: np.ndarray, nt: int,
                   bgr: np.ndarray) -> np.ndarray:
        """Per-triangle channel means via bincount -> flat-shaded facets."""
        h, w = label.shape
        lab = label.ravel()
        counts = np.bincount(lab, minlength=nt + 1)
        f = bgr.astype(np.float32)
        means = np.zeros((nt + 1, 3), np.float64)
        for c in range(3):
            sums = np.bincount(lab, weights=f[..., c].ravel(),
                               minlength=nt + 1)
            means[:, c] = sums / np.maximum(counts, 1)
        if self.palette_snap and self.palette is not None:
            means = self._snap_means(means)
        means8 = np.clip(np.round(means), 0, 255).astype(np.uint8)
        out = means8[lab].reshape(h, w, 3)
        return np.ascontiguousarray(out)

    # -- game-cel profile stages (optional) ------------------------------------

    def _toon_ramp(self, out: np.ndarray) -> np.ndarray:
        """Soft-knee quantized-V toon ramp (fixed thresholds, no hard flips)."""
        steps, width = self.ramp_steps, self.ramp_width
        hsv = cv2.cvtColor(out, cv2.COLOR_BGR2HSV)
        v = hsv[..., 2].astype(np.float32)
        x = v * (steps / 255.0)
        k = np.floor(x)
        frac = x - k
        wd = width * (steps / 255.0)     # knee width in band units
        t = np.clip((frac - (1.0 - wd)) / max(wd, 1e-6), 0.0, 1.0)
        t = t * t * (3.0 - 2.0 * t)      # smoothstep knee
        kk = np.clip(k + t, 0.0, steps - 1.0)
        vq = (kk + 0.5) * (255.0 / steps)
        hsv[..., 2] = np.clip(np.round(vq), 0, 255).astype(np.uint8)
        return cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)

    def _outline(self, out: np.ndarray) -> np.ndarray:
        """Sobel-magnitude soft-knee thick outline (dark overlay)."""
        gray = cv2.cvtColor(out, cv2.COLOR_BGR2GRAY)
        gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
        # same numpy-float64 magnitude (cv2.magnitude is 1-ulp
        # nondeterministic here — see _saliency note)
        mag = np.sqrt(gx.astype(np.float64) ** 2
                      + gy.astype(np.float64) ** 2).astype(np.float32)
        t = np.clip((mag - self.out_lo) / max(self.out_hi - self.out_lo, 1e-6),
                    0.0, 1.0)
        t = t * t * (3.0 - 2.0 * t)
        if self.out_dilate > 0:
            t = cv2.dilate(t, np.ones((self.out_dilate, self.out_dilate),
                                      np.uint8))
        edges = (1.0 - t).astype(np.float32)
        return S.edge_overlay(out, edges, self.out_floor)

    # -- pipeline ---------------------------------------------------------------

    def __call__(self, bgr: np.ndarray, cut: bool) -> np.ndarray:
        h, w = bgr.shape[:2]
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

        if cut:  # contract invariant 4: reset ALL temporal state at cuts
            self.sal_buf = []
            self.slots = None
            self.gray_small_prev = None

        # stage 1 — 5-frame box-averaged gradient saliency
        sal = self._saliency(gray)
        self.sal_buf.append(sal)
        if len(self.sal_buf) > self.sal_win:
            self.sal_buf.pop(0)
        sal_avg = np.mean(np.stack(self.sal_buf, 0), axis=0).astype(np.float32)

        # stage 2 — fresh anchors: fixed grid + saliency quantile top-up
        grid = self._fixed_grid(w, h)
        m = self.anchor_n - len(grid)
        fresh = self._topup_fresh(sal_avg, m)

        # stage 3 — temporal stabilization (flow warp + fixed EMA)
        if self.temporal:
            s = self.flow_scale
            if s > 1:
                self.gray_small = cv2.resize(
                    gray, (w // s, h // s), interpolation=cv2.INTER_AREA)
            else:
                self.gray_small = gray
        if (self.temporal and self.slots is not None
                and self.gray_small_prev is not None):
            s = self.flow_scale
            flow = cv2.calcOpticalFlowFarneback(
                self.gray_small_prev, self.gray_small, None,
                0.5, 3, 15, 3, 5, 1.2, 0)
            n = len(self.slots)
            map_x = (self.slots[:, 0] / s).astype(np.float32).reshape(1, n)
            map_y = (self.slots[:, 1] / s).astype(np.float32).reshape(1, n)
            u = cv2.remap(flow[..., 0], map_x, map_y, cv2.INTER_LINEAR,
                          borderMode=cv2.BORDER_REPLICATE)
            v = cv2.remap(flow[..., 1], map_x, map_y, cv2.INTER_LINEAR,
                          borderMode=cv2.BORDER_REPLICATE)
            warped = self.slots.copy()
            warped[:, 0] += u.ravel() * s
            warped[:, 1] += v.ravel() * s
            a = self.ema_alpha
            slots = a * warped + (1.0 - a) * fresh
            # hard respawn for slots pushed out of frame (big pans)
            oob = ((slots[:, 0] < 1.0) | (slots[:, 0] > w - 2.0) |
                   (slots[:, 1] < 1.0) | (slots[:, 1] > h - 2.0))
            if oob.any():
                slots[oob] = fresh[oob]
            self.slots = slots.astype(np.float32)
        else:
            slots = fresh
            self.slots = fresh.copy() if self.temporal else None
        self.gray_small_prev = self.gray_small if self.temporal else None

        # anchor set: fixed grid + (EMA-stabilized) top-up slots; 1-px
        # grid-snap dedupe (Subdiv2D degenerates on duplicates)
        pts = np.vstack([grid, slots]) if len(slots) else grid
        key = np.round(pts).astype(np.int32)
        _, keep = np.unique(key, axis=0, return_index=True)
        pts = np.ascontiguousarray(pts[np.sort(keep)], dtype=np.float32)

        # stage 4 — Delaunay label rasterize + bincount flat fill
        label, nt = self._rasterize(pts, w, h)
        out = self._flat_fill(label, nt, bgr)

        # stage 5 — facet boundary lines (darken x edgeDarken)
        edges = S.boundary_edge_map(label, dilate=self.edge_dilate,
                                    aa_sigma=self.edge_soften)
        out = S.edge_overlay(out, edges, self.edge_darken)

        # game-cel profile (optional): toon ramp + Sobel outline
        if self.ramp_steps > 1:
            out = self._toon_ramp(out)
        if self.outline:
            out = self._outline(out)

        return out


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


# ---------------------------------------------------------------------------
# SPR107 Neon/Cyberpunk — wave-4 fresh reality (SPR-W4-C)
#
# LUT (fixed teal/magenta grade) + bloom (threshold + Gaussian-pyramid
# upsample + additive composite) + edge glow (Sobel magnitude + neon tint +
# soft composite). Deterministic-classical, CPU-only (OpenCV + numpy, the
# frozen engine toolset), pure per-frame transform: no RNG, no temporal
# state, no frame-index dependence (the SPR-W3-B T3-diagnosis law) — see
# _NeonCyberpunkState above for the full stage math and coefficient docs.
# ---------------------------------------------------------------------------


NEON_CYBERPUNK = RendererSpec(
    rendererId="spr-neon-cyberpunk-dc1", reality="neon-cyberpunk",
    family="Neon/Cyberpunk (SPR107)", sprId="SPR107",
    pipeline=[
        "neon_lut_grade(3x3 BGR mix rows [0.86,0.10,0.04|0.07,0.84,0.09|"
        "0.12,0.16,0.72], baked 256-entry pivot-contrast curve pivot=0.44 "
        "contrast=1.28, split-tone teal shadows (+34,+22,-26) / magenta "
        "highlights (+18,-22,+34), BT.601 luma knee 0.38..0.72)",
        "bloom_pyramid(max-channel soft-threshold 196..244, 3-octave "
        "pyrDown/pyrUp chain, octave weights 0.42/0.33/0.25, additive "
        "strength 0.75)",
        "edge_glow(Sobel k=3 magnitude soft-knee 120..480, soften sigma 1.2, "
        "neon-cyan tint (200,250,90), alpha 0.62 soft composite)",
    ],
    description=("Teal/magenta neon grade with soft highlight bloom and "
                 "cyan edge glow. Pure per-frame pipeline: baked LUT + "
                 "fixed-kernel Gaussian pyramid + Sobel tint — no RNG, no "
                 "temporal state (T3-diagnosis law)."),
    config={
        # stage 1 — LUT color grade (teal shadows / magenta highlights)
        "mixMatrix": [[0.86, 0.10, 0.04],
                      [0.07, 0.84, 0.09],
                      [0.12, 0.16, 0.72]],
        "curvePivot": 0.44, "curveContrast": 1.28,
        "lumaWeights": [0.114, 0.587, 0.299],
        "splitKneeLow": 0.38, "splitKneeHigh": 0.72,
        "shadowTeal": [34, 22, -26],
        "highlightMagenta": [18, -22, 34],
        # stage 2 — bloom (threshold + pyramid upsample + additive)
        "bloomThrLow": 196, "bloomThrHigh": 244,
        "bloomLevels": 3, "bloomWeights": [0.42, 0.33, 0.25],
        "bloomStrength": 0.75,
        # stage 3 — edge glow (Sobel magnitude + tint + soft composite)
        "edgeKneeLow": 120, "edgeKneeHigh": 480,
        "edgeSoften": 1.2, "edgeAlpha": 0.62,
        "edgeTint": [200, 250, 90],
    },
)

# additive registry append (SPR-W4-C): the SPR107 neon-cyberpunk row enters
# the REGISTRY without modifying any prior declaration or construction line
REGISTRY[NEON_CYBERPUNK.reality] = NEON_CYBERPUNK


# ---------------------------------------------------------------------------
# SPR104 Ink/Manga/Comic — wave-5 fresh reality (SPR-W5-C)
#
# The SPR104 deterministic baseline spr104.det.xdog-halftone (candidates
# .yaml): grayscale + XDoG soft-threshold (sketch mode) line art + 2-3
# ink value classes + screen-space fixed-lattice Bayer screentone + paper
# grain. Deterministic-classical, CPU-only (OpenCV + numpy, the frozen
# engine toolset), pure per-frame transform: no temporal state, no
# per-frame RNG, no frame-index dependence (the SPR-W3-B T3-diagnosis
# law) — see _InkMangaState above for the full stage math and the
# anti-crawl rules (screen-anchored lattice, fixed thresholds, fixed
# grain texture per render).
# ---------------------------------------------------------------------------


INK_MANGA = RendererSpec(
    rendererId="spr-ink-manga-dc1", reality="ink-manga",
    family="Ink/Manga/Comic (SPR104)", sprId="SPR104",
    pipeline=[
        "pre_smooth(median3 + bilateral x3(d9,s75) — XDoG noise-crawl "
        "mitigation, the cartoon-cel pre-quantize class)",
        "xdog_line_art(sigma=1.0,k=1.6,tau=0.98,eps=0.0015,phi=10, soft "
        "threshold, sketch mode; params FIXED per frame; binarized at "
        "knee 0.5 + median5-stabilized + soften sigma 0.8 — the "
        "cartoon-cel boundary-line pattern)",
        "value_quantize(BT.601 luma -> baked pivot-contrast S-curve "
        "pivot=0.55 contrast=1.15; line strokes burned at line floor 0.20)",
        "screentone(screen-anchored 8x8 clustered-dot halftone over the "
        "full density range, ink dot iff threshold < 1-tone (local-mean-"
        "preserving); FIXED soft knees to solid ink (0.16 w0.12) and clean "
        "paper (0.84 w0.08) — no hard class boundaries; soft-dot ramp "
        "window 0.25 with exact saturation clamps)",
        "paper_grain(FIXED zero-mean texture seed=42 scale=5.0 — identical "
        "every frame, zero temporal delta)",
    ],
    description=("Monochrome manga/comic ink: XDoG sketch lines over 2-3 "
                 "fixed ink tone classes with a screen-anchored clustered-"
                 "dot halftone screentone (no dot crawl by construction) "
                 "and fixed paper grain. Pure per-frame pipeline — no "
                 "render-time RNG, no temporal state (T3-diagnosis law)."),
    config={
        # stage 1 — pre-smooth (noise-crawl mitigation; cartoon-cel class)
        "preMedianK": 3, "preBilatD": 9, "preBilatSigma": 75,
        "preBilatIters": 3,
        # stage 2 — XDoG line art (Winnemöller soft-threshold, sketch mode;
        # binary median-stabilized stroke compositor)
        "xdogSigma": 1.0, "xdogK": 1.6, "xdogTau": 0.98,
        "xdogEps": 0.0015, "xdogPhi": 10.0, "lineFloor": 0.20,
        "lineMode": "binary", "lineKnee": 0.5, "lineMedian": 5,
        "lineSoften": 0.8,
        # stage 3 — value quantize / ink pooling (fixed thresholds)
        "tonePivot": 0.55, "toneContrast": 1.15,
        # stage 4 — screen-anchored screentone lattice + soft knees + soft dots
        "paperKnee": 0.84, "inkKnee": 0.16, "screenN": 8,
        "inkKneeWidth": 0.12, "paperKneeWidth": 0.08, "inkLevels": 0,
        "dotSoft": 0.25,
        # stage 5 — paper grain (fixed per-render texture)
        "grainSeed": 42, "grainScale": 5.0,
    },
)

# additive registry append (SPR-W5-C): the SPR104 ink-manga row enters the
# REGISTRY without modifying any prior declaration or construction line
REGISTRY[INK_MANGA.reality] = INK_MANGA


# ---------------------------------------------------------------------------
# SPR106 Low-Poly/Game — wave-5 fresh reality (SPR-W5-E, Lane G)
#
# The w5b rank-1 dispatch-trial recipe (docs/technology/spr105-106-
# candidates.yaml → wave_recommendation rank 1), implemented verbatim:
# luma → 5-frame box-averaged gradient saliency → anchors = jittered grid
# (fixed PRNG, 24px) + saliency top-up N≈1200 → [temporal: Farneback warp
# prev anchors + fixed EMA + cut-reset] → Subdiv2D → fillPoly label
# rasterize + bincount flat fill → optional palette snap K=16 fixed LAB →
# label-edge darken ×0.45 → [game-cel profile: ramp LUT + Sobel outline
# dilate] → encode-bitexact. Deterministic-classical, CPU-only (OpenCV +
# numpy, the frozen engine toolset; cv2.Subdiv2D is the w5b measured-table
# in-envelope primitive). See _LowpolyGameState above for the full stage
# math and the anti-flicker / cut-reset design notes.
# ---------------------------------------------------------------------------


LOWPOLY_GAME = RendererSpec(
    rendererId="spr-lowpoly-game-dc1", reality="lowpoly-game",
    family="Low-Poly / Game (SPR106)", sprId="SPR106",
    profiles=["default", "game-cel"],
    paletteK=16,
    usesFlow=True,
    pipeline=[
        "gradient_saliency(Sobel k=3 magnitude on luma via numpy float64 "
        "sqrt (cv2.magnitude is 1-ulp alignment-flaky in this environment "
        "— root-caused in the w5e determinism battle), Gaussian sigma=2.0, "
        "5-frame trailing box average, cut-reset — the anti-flicker saliency)",
        "anchors(fixed jittered grid: 20px lattice, PRNG seed 20260927, "
        "jitter +/-6px, generated once per render, screen-anchored and never "
        "moves; border ring inset 1px; saliency top-up to N=1500 by "
        "fixed-quantile inverse-CDF sampling, seed 1066 — same fixed "
        "uniforms every frame, slots track the saliency-mass quantiles)",
        "temporal(Farneback 0.5/3/15/3/5/1.2/0 at 320x180 — the in-engine "
        "flow convention — bilinear-sampled at anchor positions, "
        "displacement x2; fixed EMA alpha=0.65 blends warped-prev with the "
        "fresh quantile sample; out-of-frame slots hard-respawn; CUT-RESET "
        "drops saliency window + slots + flow history at every engine "
        "cut-detect hit — contract invariant 4)",
        "delaunay(cv2.Subdiv2D over the 1-px grid-snap deduped anchor set; "
        "per-triangle cv2.fillPoly into an int32 label map — the w5b "
        "MEASURED label-map path, NOT the 2425.7 ms/f naive per-triangle "
        "mask-fill anti-pattern)",
        "flat_fill(np.bincount per-channel triangle means + LUT "
        "back-projection; optional snap of the per-triangle means to the "
        "fixed per-clip K=16 LAB palette, chroma-weighted l=0.45 nearest)",
        "label_edge_darken(boundary_edge_map on the label map, dilate 1, "
        "soften sigma 0.8, edge_overlay floor x0.45 — the facet identity "
        "anchors)",
        "game-cel profile [optional]: toon_ramp(soft-knee quantized V, 4 "
        "steps, knee width 14 luma levels — no hard class boundaries) + "
        "Sobel outline(soft knee 90..360, dilate 2, floor 0.30)",
    ],
    description=("Low-poly game restyle: Delaunay flat-shaded facets over a "
                 "fixed jittered grid + saliency top-up anchors, "
                 "flow-stabilized with a fixed EMA and cut-reset, dark "
                 "facet-edge lines. Structure-ADDITIVE family — facet "
                 "boundaries reinject structure (the w5b rank-1 dispatch "
                 "recipe, SPR106 trial)."),
    config={
        # stage 1 — saliency (5-frame box-averaged gradient)
        "saliencySigma": 2.0, "saliencyWindow": 5,
        # stage 2 — anchors (fixed jittered grid + quantile top-up)
        "gridSpacing": 20, "gridJitter": 6.0, "gridSeed": 20260927,
        "anchorN": 1500, "topupSeed": 1066,
        # stage 3 — temporal stabilization (flow warp + EMA + cut-reset)
        "temporal": True, "emaAlpha": 0.65, "flowScale": 2,
        # stage 4 — flat fill (+ optional fixed LAB palette snap)
        "paletteSnap": False, "lWeight": 0.45,
        # stage 5 — facet edge lines
        "edgeDarken": 0.45, "edgeDilate": 1, "edgeSoften": 0.8,
        # game-cel profile (optional): ramp LUT + Sobel outline
        "profiles": {"game-cel": {
            "toonRampSteps": 4, "toonRampWidth": 14.0,
            "outline": True, "outlineKneeLow": 90.0,
            "outlineKneeHigh": 360.0, "outlineDilate": 2,
            "outlineFloor": 0.30,
        }},
    },
)

# additive registry append (SPR-W5-E): the SPR106 low-poly/game row enters
# the REGISTRY without modifying any prior declaration or construction line
REGISTRY[LOWPOLY_GAME.reality] = LOWPOLY_GAME
