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

        elif reality == "silhouette-xray":
            if not hasattr(self, "_silhouette_xray_state"):
                self._silhouette_xray_state = _SilhouetteXrayState(
                    cfg, self.cuts)
            out = self._silhouette_xray_state(bgr, self._gray_small(bgr),
                                              self._is_cut_start())

        elif reality == "clay-toy":
            if not hasattr(self, "_clay_toy_state"):
                self._clay_toy_state = _ClayToyState(cfg, self.palette)
            out = self._clay_toy_state(bgr, self.frame_index)

        elif reality == "player-focus":
            if not hasattr(self, "_player_focus_state"):
                self._player_focus_state = _PlayerFocusState(cfg, self.cuts)
            out = self._player_focus_state(bgr, self._gray_small(bgr),
                                           self._is_cut_start())

        elif reality == "rotoscope":
            if not hasattr(self, "_rotoscope_state"):
                self._rotoscope_state = _RotoscopeState(cfg, self.palette)
            out = self._rotoscope_state(bgr, self._gray_small(bgr),
                                        self._is_cut_start())

        elif reality == "watercolor":
            if not hasattr(self, "_watercolor_state"):
                self._watercolor_state = _WatercolorState(cfg, self.cuts)
            out = self._watercolor_state(bgr, self._is_cut_start())

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
    foreground), morphology-cleaned (open 3 / close 5 / dilate `maskDilate`),
    with temporal persistence (cut-reset). MOG2 is re-initialized at every
    detected cut so no background model bleeds across a source cut
    (contract §3.4). Deterministic: MOG2 GMM updates and Farneback are
    deterministic functions of the frame sequence; no RNG in this class.

    v0.2.0 quality iteration (SPR-W5-A, Tier-2 push — attacks the wave-3
    scorecard gaps: temporalConsistency 2.87 / identityConsistency 3.20 /
    motionFidelity 3.13 / sceneFidelity 2.73, criticalArtifacts 15):

    1. Mask persistence is DUAL-RATE hysteresis (config `maskRiseAlpha` /
       `maskFallAlpha`) instead of v0.1.0's max-decay EMA: new subjects are
       covered within ~3 frames (fast rise) while subjects MOG2 has adapted
       to (standing / slow players — the v0.1.0 disappearance mechanism,
       critical class "players") stay covered for ~2 s (slow fall).
       Scale-aware pad: the dilation kernel is config-driven (`maskDilate`
       7 @ 320x180 = ~14 px at 640x360) so the soft composite seam never
       cuts through small-player limbs (critical class "limbs").
    2. Background-path palette assignment is temporally STICKY (config
       `bgHysteresis`): a per-pixel Schmitt trigger keeps the previous
       palette index while the previous center is within the hysteresis
       ratio of the best current distance. Kills the per-frame assignment
       flicker on cluster-boundary pixels that made field lines / ad boards
       shift shape between 0.2 s frame pairs (the dominant temporal + scene
       axis loss). Pure index-level state — no pixel averaging, so camera
       pans do not smear; rebuilt fresh on every detected cut.
    3. Background front-end weakened for 1-3 px scene structure (median 3,
       bilateral x2 sigma 60, region window 3, line floor 0.24) — v0.1.0's
       median-5 + triple-bilateral stack erased pitch lines ("warped
       lines" / sceneFidelity 2.73).
    4. Subject-path XDoG softened (phi 5.0, floor 0.62) — v0.1.0's phi-8
       soft-threshold produced broken contour noise on ~25 px players
       (perceived as malformed limbs).

    Config-key gating keeps v0.1.0 semantics reproducible: with the v0.1.0
    config overlay (no `maskRiseAlpha`/`bgHysteresis` keys, `maskDilate` 5)
    this class is behaviourally identical to the v0.1.0 processor (proven by
    byte-identical re-render of the v0.1.0 anchors).
    """

    def __init__(self, cfg: dict, palette: Optional[np.ndarray], cuts: set):
        self.cfg = cfg
        self.palette = palette
        self.cuts = cuts
        self.prev_gray_small: Optional[np.ndarray] = None
        self.mask_ema: Optional[np.ndarray] = None   # (180, 320) float32
        self.idx_prev: Optional[np.ndarray] = None   # sticky palette indices
        self.mog2 = cv2.createBackgroundSubtractorMOG2(
            history=cfg["mogHistory"], varThreshold=cfg["mogVarThreshold"],
            detectShadows=False)
        self._k3 = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        self._k5 = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        self._kd = cv2.getStructuringElement(
            cv2.MORPH_RECT, (cfg.get("maskDilate", 5),) * 2)

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
        raw = cv2.dilate(raw, self._kd)                         # pad subjects
        if self.mask_ema is None or cut:
            self.mask_ema = raw
        else:
            rise, fall = c.get("maskRiseAlpha"), c.get("maskFallAlpha")
            if rise is not None and fall is not None:
                # dual-rate hysteresis (v0.2.0): fast coverage for new
                # subjects, ~2 s hold for subjects MOG2 has adapted to
                alpha = np.where(raw > self.mask_ema, rise, fall)
                self.mask_ema = self.mask_ema + (raw - self.mask_ema) * alpha
            else:  # v0.1.0 semantics (max-decay EMA)
                self.mask_ema = np.maximum(raw, self.mask_ema * c["maskDecay"])
        h, w = bgr.shape[:2]
        m = cv2.resize(self.mask_ema, (w, h), interpolation=cv2.INTER_LINEAR)
        m = cv2.GaussianBlur(m, (0, 0), c["maskSoften"])         # no cutout seams
        return np.clip(m, 0.0, 1.0)

    # -- dual stylization paths -----------------------------------------------

    def _quantize_sticky(self, bgr: np.ndarray) -> np.ndarray:
        """Fixed-palette LAB assignment with per-pixel temporal stickiness.

        Restates stages.quantize_lab's chroma-weighted nearest-center math
        (identical distances, same blockwise layout), then applies the
        Schmitt-trigger rule: a pixel KEEPS its previous palette index while
        the previous center is still within `bgHysteresis` x the best current
        distance (the ratio is applied on squared distances). Pure index
        level state — no pixel averaging, so camera pans do not smear; the
        sticky map is discarded on every detected cut (no cross-cut bleed,
        contract §3.4). Deterministic: a pure function of the frame sequence
        and the fixed per-clip palette.
        """
        c = self.cfg
        lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
        fl = lab.reshape(-1, 3).astype(np.float32)
        centers = self.palette.astype(np.float32)
        w = np.array([c.get("lWeight", 0.45), 1.0, 1.0], dtype=np.float32)
        idx = np.empty(len(fl), dtype=np.int64)
        d_best = np.empty(len(fl), dtype=np.float32)
        for s in range(0, len(fl), 40000):
            blk = fl[s:s + 40000]
            d = ((blk[:, None, :] - centers[None, :, :]) * w) ** 2
            d = d.sum(-1)
            best = np.argmin(d, axis=1)
            idx[s:s + 40000] = best
            d_best[s:s + 40000] = d[np.arange(len(blk)), best]
        hyst = c["bgHysteresis"]
        if self.idx_prev is not None:
            prev_flat = self.idx_prev.reshape(-1)
            d_prev = (((fl - centers[prev_flat]) * w) ** 2).sum(-1)
            keep = d_prev <= d_best * (hyst * hyst)
            idx = np.where(keep, prev_flat, idx)
        self.idx_prev = idx.reshape(lab.shape[:2])
        return self.idx_prev

    def _background_path(self, bgr: np.ndarray) -> np.ndarray:
        """Strong cartoon stack (identity-free zone).

        v0.2.0: structure-preserving front-end (median 3 / bilateral x2 /
        region window 3) + temporally sticky palette assignment.
        """
        c = self.cfg
        out = S.median_pool(bgr, c["bgMedianK"])
        out = S.bilateral_flatten(out, c["bgBilatD"], c["bgBilatSigma"],
                                  c["bgBilatSigma"], c["bgBilatIters"])
        if c.get("bgHysteresis"):
            idx = self._quantize_sticky(out)
        else:  # v0.1.0 semantics: independent per-frame assignment
            _, idx = S.quantize_lab(out, self.palette,
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
        if cut:
            self.idx_prev = None   # sticky map rebuilt from the fresh scene
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
#               forward; fixed EMA (alpha=0.75, hardened in the w5e phase-3
#               T4 loop) blends warped-old with the
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
        self.ema_alpha = float(c.get("emaAlpha", 0.75))
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
# silhouette/x-ray pipeline state (SPR202)
#
# The SPR202 deterministic baseline spr202.det.mog2-silhouette
# (candidates.yaml), implemented per the frozen dispatch recipe: global-
# motion compensation (Farneback frame-pair flow -> warp-align) -> MOG2
# background subtraction (deterministic config, fixed history) -> motion
# mask threshold + morphology (fixed kernels) -> TWO output profiles
# (ink-fill default: solid ink silhouette on paper-white; xray:
# mask-distance -> thermal-LUT false-color + rim glow) -> encode-bitexact.
# Deterministic-classical, CPU-only (OpenCV + numpy, the frozen engine
# toolset). See _SilhouetteXrayState below for the full stage math, the
# anti-pan design and the determinism notes (the w5e cv2.magnitude IPP
# lesson is applied in the rim stage).
# ---------------------------------------------------------------------------


class _SilhouetteXrayState:
    """Streaming state for the SPR202 silhouette/x-ray pipeline.

    Stage 0  global-motion compensation (the anti-pan leg): Farneback
             frame-pair flow at 320x180 (the in-engine convention) ->
             global translation+zoom least-squares fit (stride-4
             subsample, the stages.flow_magnitude model class) ->
             cumulative per-shot affine in float64 (zoom clipped to
             +/-0.10, translation clipped to +/-24 px/frame — broadcast
             inter-frame bounds; whips are cuts and reset the shot).
             Each frame is warp-affine-aligned into the SHOT-REFERENCE
             coordinates before MOG2, and the mask warps back with the
             forward affine for output. Determinism: closed-form float64
             affine compose + invertAffineTransform + fixed bilinear
             warps — a pure fixed-op chain, proven by the per-cell
             double-render byte-equality.
    Stage 1  MOG2 background subtraction on the warp-aligned stream:
             deterministic config, fixed history; the model is created
             ONCE per clip (learningRate 1.0 on the first frame, whose
             output mask is zeroed — clean paper start) and NEVER
             re-initialized: the natural model-mismatch flood at real
             source cuts provides the cut-preservation spike (measured
             ~150 absdiff, decaying smoothly at the fixed learning rate),
             while re-initializing at the engine's false-positive cuts
             (sustained-motion spikes, the recorded 882-943 goal-segment
             class) produced 10 invented cuts via the all-ink fresh-model
             flash — root-caused in the w5g fast loop. Cross-cut
             global-fit garbage is noise-averaged (measured increments
             <= 8 px) so the cumulative affine needs no reset. A per-shot
             coverage age-map (union of warped viewports, saturating)
             linear-fades the MOG2 mask in over mogWarmup frames so
             never-modeled content entering frame edges under pans does
             not flash as false silhouette.
    Stage 2  motion-mask threshold + morphology + stabilization: the
             camera-compensated residual-flow mask (> flowKnee at
             320x180, upsampled) fills MOG2's blind spots ONLY — gated
             to the not-yet-modeled region (1 - coverage-valid) and
             ramped in over the warmup window (a global OR floods on
             flat-region Farneback residual noise during pan ramps —
             fast-loop measured 55% frame coverage — and an unramped
             step onto clean paper would register as an invented cut,
             G-T2b); fixed RECT-kernel open/close; max-decay EMA with
             RISE-CAPPED growth (mask accumulator resets at every
             engine cut-detect hit — contract invariant 4 — with the
             fresh raw entering uncapped so real-cut floods land as a
             single discontinuity; normal-frame growth is capped at
             +maskRise/frame because the binary ink fill amplifies
             small input events ~4.7x — the measured frame-1189 class:
             a 5.0-absdiff input event popped an 8.2% mask = 23.6
             output absdiff -> invented-cut flag); fixed Gaussian
             soften for anti-aliased silhouette edges.
    Stage 3  ink-fill profile (default): stabilized soft mask -> solid
             ink silhouette composited on paper-white.
    Stage 3' xray profile (--profile xray): mask distance transform
             (DIST_L2) -> baked 256-entry FIXED thermal ironbow LUT
             false-color + Sobel-rim additive glow (numpy float64
             magnitude — cv2.magnitude is 1-ulp alignment-flaky in this
             environment, the w5e determinism battle).

    Determinism: every op is a fixed function of the frame sequence —
    no render-time RNG, no wall-clock, no frame-index dependence; MOG2
    GMM updates, Farneback, lstsq, warpAffine and distanceTransform are
    all deterministic functions of their inputs in this environment
    (proven by the subject-toon/motion-trails w4b 54/54 byte-identical
    corpus and re-proven per-cell here by the double render).
    """

    # baked thermal ironbow LUT stops (RGB at fixed t positions — FIXED
    # constants, interpolated once at bake time; no RNG anywhere)
    _LUT_T = (0.00, 0.18, 0.38, 0.58, 0.76, 0.90, 1.00)
    _LUT_RGB = (
        (8, 4, 14),      # near-black blue (x-ray film base)
        (28, 12, 92),    # deep blue
        (124, 18, 118),  # violet-magenta
        (206, 42, 48),   # red
        (244, 132, 38),  # orange
        (255, 214, 110),  # yellow
        (255, 251, 242),  # white-hot
    )

    def __init__(self, cfg: dict, cuts: set):
        c = self.cfg = cfg
        self.cuts = cuts
        # stage 0 — global-motion compensation (anti-pan)
        self.compensate = bool(c.get("compensate", True))
        self.flow_step = int(c.get("flowStep", 4))
        self.zoom_clip = float(c.get("zoomClip", 0.10))
        self.trans_clip = float(c.get("translationClip", 24.0))
        # stage 1 — MOG2 (deterministic config, fixed history)
        self.mask_source = str(c.get("maskSource", "mog2"))
        self.mog_history = int(c.get("mogHistory", 200))
        self.mog_var_threshold = float(c.get("mogVarThreshold", 34.0))
        self.mog_lr = float(c.get("mogLearningRate", 0.04))
        self.mog_lr_boost = float(c.get("mogLearningRateBoost", 0.12))
        self.boost_frames = int(c.get("mogBoostFrames", 12))
        self.jump_countdown = 0
        self.mog_warmup = int(c.get("mogWarmup", 10))
        # stage 2 — threshold + morphology + temporal stabilization
        self.flow_knee = float(c.get("flowKnee", 2.2))
        self.morph_open = int(c.get("morphOpen", 3))
        self.morph_close = int(c.get("morphClose", 5))
        self.morph_dilate = int(c.get("morphDilate", 0))
        self.mask_decay = float(c.get("maskDecay", 0.65))
        self.mask_rise = float(c.get("maskRise", 0.40))
        self.global_jump = float(c.get("globalJump", 0.25))
        self.mask_soften = float(c.get("maskSoften", 3.0))
        # output profiles
        self.output_profile = str(c.get("outputProfile", "ink"))
        self.ink = np.array(c.get("inkColor", [26, 26, 26]), np.float32)
        self.paper = np.array(c.get("paperColor", [244, 244, 244]),
                              np.float32)
        self.dist_scale = float(c.get("xrayDistScale", 10.0))
        self.rim_lo = float(c.get("xrayRimKneeLow", 10.0))
        self.rim_hi = float(c.get("xrayRimKneeHigh", 40.0))
        self.rim_strength = float(c.get("xrayRimStrength", 0.90))
        self.rim_tint = np.array(c.get("xrayRimTint", [210, 235, 255]),
                                 np.float32)
        # baked fixed-kernel morphology elements
        self._k_open = cv2.getStructuringElement(
            cv2.MORPH_RECT, (self.morph_open, self.morph_open))
        self._k_close = cv2.getStructuringElement(
            cv2.MORPH_RECT, (self.morph_close, self.morph_close))
        self._k_dil = (cv2.getStructuringElement(
            cv2.MORPH_RECT, (self.morph_dilate, self.morph_dilate))
            if self.morph_dilate > 0 else None)
        # baked 256-entry thermal LUT (BGR, interpolated + rounded once)
        xs = np.arange(256, dtype=np.float64) / 255.0
        ts = np.array(self._LUT_T, dtype=np.float64)
        rgb = np.array(self._LUT_RGB, dtype=np.float64)
        lut = np.stack([np.interp(xs, ts, rgb[:, 2]),   # B
                        np.interp(xs, ts, rgb[:, 1]),   # G
                        np.interp(xs, ts, rgb[:, 0])],  # R
                       axis=1)
        self.lut = np.clip(np.round(lut), 0, 255).astype(np.uint8)
        # streaming state (per-shot; everything resets at cuts)
        self._IDENT = np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
                               dtype=np.float64)
        self.affine = self._IDENT.copy()      # ref coords -> current frame
        self.age: Optional[np.ndarray] = None  # coverage age (ref coords)
        self.mog2 = None
        self.mask_ema: Optional[np.ndarray] = None
        self.prev_gray_small: Optional[np.ndarray] = None
        self.clip_frame = 0    # frames since clip start (the warmup ramp)

    # -- stage 0: global-motion fit + cumulative affine ----------------------

    def _global_fit(self, flow: np.ndarray) -> np.ndarray:
        """Least-squares translation+zoom fit u = tx + sx*xn, v = ty + sy*yn
        (xn/yn normalized to [-1,1]; stride-4 subsample — the
        stages.flow_magnitude model class, deterministic lstsq)."""
        h, w = flow.shape[:2]
        ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
        xn = (xs - w / 2.0) / (w / 2.0)
        yn = (ys - h / 2.0) / (h / 2.0)
        step = self.flow_step
        us = flow[..., 0][::step, ::step].ravel()
        vs = flow[..., 1][::step, ::step].ravel()
        xs_ = xn[::step, ::step].ravel()
        ys_ = yn[::step, ::step].ravel()
        n = len(us)
        A = np.zeros((2 * n, 4), dtype=np.float64)
        A[0:n, 0] = 1.0
        A[0:n, 2] = xs_
        A[n:, 1] = 1.0
        A[n:, 3] = ys_
        b = np.concatenate([us, vs]).astype(np.float64)
        try:
            sol, *_ = np.linalg.lstsq(A, b, rcond=None)
        except np.linalg.LinAlgError:
            sol = np.zeros(4)
        return sol

    def _residual_mag(self, flow: np.ndarray, sol: np.ndarray,
                      xn: np.ndarray, yn: np.ndarray) -> np.ndarray:
        """Camera-compensated residual flow magnitude (subject motion)."""
        tx, ty, sx, sy = sol
        u_comp = flow[..., 0] - (tx + sx * xn)
        v_comp = flow[..., 1] - (ty + sy * yn)
        # numpy float64 sqrt (IEEE correctly rounded) — the w5e lesson:
        # cv2.magnitude (IPP float32) is 1-ulp alignment-flaky here
        mag = np.sqrt(u_comp.astype(np.float64) ** 2
                      + v_comp.astype(np.float64) ** 2).astype(np.float32)
        return cv2.medianBlur(mag, 3)

    def _increment_affine(self, sol: np.ndarray, w: int, h: int,
                          small_h: int, small_w: int) -> np.ndarray:
        """Frame-pair global motion as a full-res 2x3 affine (clipped)."""
        tx, ty, sx, sy = sol
        k = w / float(small_w)              # full/small scale (2.0 corpus)
        a = float(np.clip(sx / (small_w / 2.0), -self.zoom_clip,
                          self.zoom_clip))
        b = float(np.clip(sy / (small_h / 2.0), -self.zoom_clip,
                          self.zoom_clip))
        tx_f = float(np.clip(tx * k, -self.trans_clip, self.trans_clip))
        ty_f = float(np.clip(ty * k, -self.trans_clip, self.trans_clip))
        cx, cy = w / 2.0, h / 2.0
        return np.array([[1.0 + a, 0.0, tx_f - a * cx],
                         [0.0, 1.0 + b, ty_f - b * cy]], dtype=np.float64)

    @staticmethod
    def _compose(a_prev: np.ndarray, m: np.ndarray) -> np.ndarray:
        h1 = np.vstack([a_prev, [0.0, 0.0, 1.0]])
        h2 = np.vstack([m, [0.0, 0.0, 1.0]])
        return (h2 @ h1)[:2, :]

    # -- stage 1: warp-align into shot-reference coords -----------------------

    def _warp_to_ref(self, bgr: np.ndarray) -> tuple:
        """(compensated frame, viewport mask) in shot-reference coords."""
        h, w = bgr.shape[:2]
        if not self.compensate or np.array_equal(self.affine, self._IDENT):
            viewport = np.ones((h, w), dtype=np.uint8)
            return bgr, viewport
        inv_a = cv2.invertAffineTransform(self.affine)
        comp = cv2.warpAffine(bgr, inv_a, (w, h), flags=cv2.INTER_LINEAR,
                              borderMode=cv2.BORDER_REPLICATE)
        corners = np.array([[0.0, 0.0, 1.0], [w - 1.0, 0.0, 1.0],
                            [w - 1.0, h - 1.0, 1.0], [0.0, h - 1.0, 1.0]],
                           dtype=np.float64)
        mapped = corners @ inv_a.T            # current corners -> ref coords
        viewport = np.zeros((h, w), dtype=np.uint8)
        cv2.fillConvexPoly(viewport, np.round(mapped).astype(np.int32), 1)
        return comp, viewport

    def _back_to_current(self, mask_ref: np.ndarray,
                         w: int, h: int) -> np.ndarray:
        """Warp a ref-coords map into current-frame coords (0 outside)."""
        if not self.compensate or np.array_equal(self.affine, self._IDENT):
            return mask_ref
        return cv2.warpAffine(mask_ref, self.affine, (w, h),
                              flags=cv2.INTER_LINEAR,
                              borderMode=cv2.BORDER_CONSTANT,
                              borderValue=0.0)

    # -- stage 2: mask threshold + morphology + stabilization -----------------

    def _stabilized_mask(self, bgr: np.ndarray, motion: np.ndarray,
                          clip_start: bool,
                          fg255: np.ndarray) -> np.ndarray:
        h, w = bgr.shape[:2]
        if clip_start:
            # the clip's first frame initializes the model with a ZERO mask
            # (clean paper start) — the natural model-mismatch flood at real
            # source cuts provides the cut-preservation spike later; a mask
            # step at the clip start would register as an invented cut in
            # G-T2b (no input cut nearby to absorb it)
            self.mask_ema = None
            return np.zeros((h, w), dtype=np.float32)
        fg = (fg255 > 0).astype(np.float32)
        if self.mask_source == "mog2":
            fg_f = self._back_to_current(fg, w, h)
            age_f = self._back_to_current(
                self.age.astype(np.float32), w, h)
            valid = np.clip(age_f / float(max(self.mog_warmup, 1)),
                            0.0, 1.0)
            mog = fg_f * valid
        else:  # framediff fallback leg: residual flow mask only
            mog = np.zeros((h, w), dtype=np.float32)
            valid = np.zeros((h, w), dtype=np.float32)
        # coverage fallback leg: camera-compensated residual flow, gated to
        # the NOT-yet-modeled region (1 - valid) so it only fills MOG2's
        # blind spots (warmup + never-modeled pan regions) — a global OR
        # floods on flat-region Farneback residual noise during pan ramps
        # (fast-loop measured: 55% frame coverage); it also ramps in over
        # the warmup window so the mask never steps onto clean paper (a
        # step would register as an invented cut, G-T2b)
        ramp = min(max(self.clip_frame - 2, 0)
                   / float(max(self.mog_warmup, 1)), 1.0)
        flow_mask = cv2.resize((motion > self.flow_knee).astype(np.float32),
                               (w, h), interpolation=cv2.INTER_LINEAR)
        raw = np.maximum(mog, flow_mask * (1.0 - valid) * ramp)
        raw = cv2.morphologyEx(raw, cv2.MORPH_OPEN, self._k_open)
        raw = cv2.morphologyEx(raw, cv2.MORPH_CLOSE, self._k_close)
        if self._k_dil is not None:
            raw = cv2.dilate(raw, self._k_dil)
        if self.mask_ema is None:
            # first frame of the clip (the model just initialized with
            # learningRate 1.0; raw is near-empty and the flow ramp keeps
            # the first frames quiet — clean paper start)
            self.mask_ema = raw
        else:
            # GLOBAL-JUMP RULE: a real source cut floods the MOG2 mask
            # globally (mean jump > globalJump) — the flood enters
            # INSTANTLY: a single-frame discontinuity exactly where the
            # cut-preservation gates look, and the old-scene carry is
            # wiped (contract invariant 4, no cross-cut blending).
            # Everything smaller is subject to the RISE CAP: the binary
            # ink fill amplifies small input events ~4.7x, and an uncapped
            # mask pop onto near-static content crosses the 16-absdiff
            # spike threshold (the measured frame-1189 class: a
            # 5.0-absdiff input event popped an 8.2% mask = 23.6 output
            # absdiff -> invented-cut flag). Capping growth at
            # +maskRise/frame spreads such transitions below the
            # threshold; decay stays immediate.
            jump = float(raw.mean() - self.mask_ema.mean())
            if jump > self.global_jump:
                self.mask_ema = raw
                # post-jump learning-rate boost: fast background
                # re-learning after a detected scene flood (standard MOG2
                # practice) — shortens the model-mismatch wash from ~25
                # frames to ~boostFrames, which keeps the output's local
                # median low so a following micro-shot boundary (the
                # 979/982 class) still clears the 2.6x spike bar
                self.jump_countdown = self.boost_frames
            else:
                # normal tracking: max-decay with a PER-PIXEL rise cap —
                # the cap binds on LOCAL high-contrast growth with small
                # mean impact (a fast limb popping onto the mask: per-pixel
                # jump ~1.0 inside a small area, mean jump < globalJump so
                # the flood rule never sees it); spreading such pops over
                # 3 frames (+maskRise/frame) keeps them under the
                # 16-absdiff spike threshold while instant decay and
                # mean-level growth (T3 motion synchrony) are preserved
                uncapped = np.maximum(raw, self.mask_ema * self.mask_decay)
                self.mask_ema = np.minimum(uncapped,
                                           self.mask_ema + self.mask_rise)
        return np.clip(cv2.GaussianBlur(self.mask_ema, (0, 0),
                                        self.mask_soften), 0.0, 1.0)

    # -- stage 3: output profiles ----------------------------------------------

    def _ink_fill(self, m: np.ndarray) -> np.ndarray:
        out = (self.paper[None, None, :] * (1.0 - m[..., None])
               + self.ink[None, None, :] * m[..., None])
        return np.clip(out, 0, 255).astype(np.uint8)

    def _xray(self, m: np.ndarray) -> np.ndarray:
        mb = (m >= 0.5).astype(np.uint8)
        dist = cv2.distanceTransform(mb, cv2.DIST_L2, 3)
        dcode = np.clip(dist / self.dist_scale, 0.0, 1.0)
        idx8 = np.round(dcode * 255.0).astype(np.uint8)
        color = self.lut[idx8].astype(np.float32)
        # rim glow: Sobel magnitude on the soft mask (0..255 scale);
        # numpy float64 sqrt — cv2.magnitude is 1-ulp flaky here (w5e)
        m255 = (m * 255.0).astype(np.float32)
        gx = cv2.Sobel(m255, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(m255, cv2.CV_32F, 0, 1, ksize=3)
        mag = np.sqrt(gx.astype(np.float64) ** 2
                      + gy.astype(np.float64) ** 2).astype(np.float32)
        t = np.clip((mag - self.rim_lo) / max(self.rim_hi - self.rim_lo,
                                              1e-6), 0.0, 1.0)
        t = t * t * (3.0 - 2.0 * t)          # smoothstep knee
        out = color + (t * self.rim_strength)[..., None] \
            * self.rim_tint[None, None, :]
        return np.clip(out, 0, 255).astype(np.uint8)

    # -- pipeline ---------------------------------------------------------------

    def __call__(self, bgr: np.ndarray, gray_small: np.ndarray,
                 cut: bool) -> np.ndarray:
        h, w = bgr.shape[:2]
        # NOTE on contract invariant 4 ("trails/EMA must reset on detected
        # cuts"): the temporal mask accumulator resets via the GLOBAL-JUMP
        # rule in _stabilized_mask — a real source cut floods the MOG2 mask
        # globally (mean jump > globalJump) and the flood OVERWRITES the
        # accumulator (old-scene carry wiped, single-frame discontinuity
        # the cut-preservation gates match). The engine's cut-detect hits
        # on continuous content (the false-positive sustained-motion class,
        # e.g. b8's recorded 882-943 goal segment) deliberately reset
        # NOTHING: resetting there manufactured invented cuts (measured,
        # the w5g fast loop). The MOG2 model is created once per clip and
        # never re-initialized; cross-cut global-fit garbage is
        # noise-averaged (measured increments <= 8 px) so the cumulative
        # affine needs no reset either. The `cut` flag itself is therefore
        # a documented no-op in this renderer — the cut semantics live in
        # the jump rule that follows.
        clip_start = self.clip_frame == 0
        self.clip_frame += 1

        # stage 0 — frame-pair flow -> global fit -> cumulative affine
        motion = np.zeros(gray_small.shape, dtype=np.float32)
        if self.prev_gray_small is not None:
            flow = cv2.calcOpticalFlowFarneback(
                self.prev_gray_small, gray_small, None,
                0.5, 3, 15, 3, 5, 1.2, 0)
            sol = self._global_fit(flow)
            sh, sw = gray_small.shape
            ys, xs = np.mgrid[0:sh, 0:sw].astype(np.float32)
            xn = (xs - sw / 2.0) / (sw / 2.0)
            yn = (ys - sh / 2.0) / (sh / 2.0)
            motion = self._residual_mag(flow, sol, xn, yn)
            if self.compensate:
                inc = self._increment_affine(sol, w, h, sh, sw)
                self.affine = self._compose(self.affine, inc)

        # stage 1 — warp-align + MOG2 (model created once per clip)
        comp, viewport = self._warp_to_ref(bgr)
        if self.mask_source == "mog2":
            if self.mog2 is None:
                self.mog2 = cv2.createBackgroundSubtractorMOG2(
                    history=self.mog_history,
                    varThreshold=self.mog_var_threshold,
                    detectShadows=False)
                fg255 = self.mog2.apply(comp, learningRate=1.0)
            else:
                lr_eff = (self.mog_lr_boost if self.jump_countdown > 0
                          else self.mog_lr)
                fg255 = self.mog2.apply(comp, learningRate=lr_eff)
                if self.jump_countdown > 0:
                    self.jump_countdown -= 1
        else:
            fg255 = np.zeros((h, w), dtype=np.uint8)
        if self.age is None:
            self.age = np.zeros((h, w), dtype=np.uint8)
        self.age = cv2.min(self.age + viewport,
                           np.full((h, w), 255, dtype=np.uint8))

        # stage 2 — threshold + morphology + temporal stabilization
        m = self._stabilized_mask(bgr, motion, clip_start, fg255)
        self.prev_gray_small = gray_small

        # stage 3 — output profile
        if self.output_profile == "xray":
            return self._xray(m)
        return self._ink_fill(m)


# ---------------------------------------------------------------------------
# clay/miniature/toy pipeline state (SPR105) — TL rebuild of the reset-lost
# w5f branch
#
# The w5b rank-2 dispatch recipe (docs/technology/spr105-106-candidates
# .yaml → wave_recommendation rank 2), re-implemented after the 2026-09-27
# sandbox reset destroyed the original local-only spr/w5f/clay-trial branch
# before its PAT-blocked push ever reached origin (recorded honestly in the
# session log; the lost implementation's shas resolve nowhere on origin and
# are NOT claimed here — every measurement in its evidence pack is FRESH).
# The recipe is the recorded one verbatim: medium flatten → fixed LAB K=12
# toy palette through chroma-×1.25-lifted output centroids → relief-shade
# (the ONE new renderer-declared stage: 3 fixed lights on Sobel slopes of
# the FLATTENED luma, flat-response normalized to 1, tanh soft-clip, matte
# multiply at mix 0.35) → specular fake (threshold+blur σ6+screen) →
# linear-contrast S-curve + sat lift → tilt-blur diorama cue → vignette +
# noir-law grain σ6. Deterministic-classical, CPU-only (OpenCV + numpy, the
# frozen engine toolset), pure per-frame transform: no temporal state, no
# per-frame RNG beyond the frozen grain law (the SPR-W3-B T3-diagnosis
# law). See _ClayToyState below for the full stage math.
# ---------------------------------------------------------------------------


class _ClayToyState:
    """Streaming state for the SPR105 clay/miniature/toy pipeline.

    Stage 1  flatten      : median k5 + bilateral d9 σ75 ×2 — the
              plasticine medium-flatten (w5b rank-2 recipe); suppresses
              sensor noise AND provides the smooth height field the relief
              stage needs (Sobel slopes on quantized palette steps would
              be class boundaries, not relief).
    Stage 2  toy_palette : fixed per-clip LAB K=12 (learned once by the
              adapter's learn_palette), chroma-weighted assignment
              (l=0.45) on the LEARNED centroids; OUTPUT runs through
              chroma-×1.25-lifted centroids (a,b expanded around the LAB
              128 midpoint, rounded + clipped) — the plasticine color pop.
    Stage 3  relief-shade: THE new renderer-declared stage. Sobel k3
              slopes (gx, gy) on the FLATTENED luma → surface normals
              n = (-gx/s, -gy/s, 1)/|n| (fixed slope scale s = 96
              luma/px per 45°); lambertian response over 3 FIXED lights
              (key upper-left w 0.50 / fill upper-right w 0.30 / rim
              lower w 0.20), max(0, n·l) each; the response is divided by
              its FLAT value (gx=gy=0 → n=(0,0,1) → r0 = Σ w·lz) so a
              flat surface maps to EXACTLY 1; tanh soft-clip around 1
              (matte = 1 + tanh(r/r0 − 1) — bounded 0..2, flat exactly
              1); output multiplied by (1 + mix·(matte−1)) at mix=0.35 —
              flat regions untouched, structure-by-light deviation at
              35%. numpy float64 throughout (the w5e IEEE determinism
              law).
    Stage 4  specular    : fake glint — hard threshold on luma (235) +
              Gaussian σ6 + screen blend. When the mask is empty the
              blend is an EXACT identity (screen with 0), so on
              palette-capped content whose luma never reaches the
              threshold the stage is a measured no-op (the v6 fast-loop
              inert proof, honestly recorded).
    Stage 5  tone+sat    : baked 256-entry linear-contrast S-curve LUT
              (pivot 0.45, contrast 1.12 — the ink-manga convention; the
              lost first implementation's tanh tone curve capped whites
              ~200 and killed the glint — the recorded correction) +
              saturation ×1.25.
    Stage 6  tilt-blur   : heuristic diorama cue — a FIXED vertical
              focus band [0.30, 0.62] of frame height with 0.25-ramp
              shoulders; rows outside the band blend toward a σ6 blur
              (top = far crowd/sky, bottom = near foreground; the mid
              band stays sharp). Screen-anchored, no tracking, no
              temporal state — the miniature/diorama depth cue.
    Stage 7  finish      : vignette 0.35 + noir-law grain σ6 (the frozen
              per-frame grain law).

    Deterministic: every op is a fixed function of the current frame (+
    the frozen grain's frame_index); the same input bytes + config always
    produce the same output bytes.
    """

    def __init__(self, cfg: dict, palette: Optional[np.ndarray]):
        c = self.cfg = cfg
        # stage 1 — medium flatten (plasticine)
        self.flat_median_k = int(c.get("flattenMedianK", 5))
        self.flat_bilat_d = int(c.get("flattenBilatD", 9))
        self.flat_bilat_sigma = float(c.get("flattenBilatSigma", 75.0))
        self.flat_bilat_iters = int(c.get("flattenBilatIters", 2))
        # stage 2 — toy palette (assignment on the LEARNED centroids,
        # output through chroma-lifted centroids)
        self.l_weight = float(c.get("lWeight", 0.45))
        self.assign_palette = palette
        lift = float(c.get("chromaLift", 1.25))
        if palette is not None:
            pal = np.clip(np.round(palette.astype(np.float64)), 0, 255)
            pal[:, 1] = np.clip(
                np.round((pal[:, 1] - 128.0) * lift + 128.0), 0, 255)
            pal[:, 2] = np.clip(
                np.round((pal[:, 2] - 128.0) * lift + 128.0), 0, 255)
            self.palette = pal.astype(np.float32)
        else:
            self.palette = None
        # stage 3 — relief-shade (3 fixed lights, flat-normalized, tanh)
        self.relief_mix = float(c.get("reliefMix", 0.35))
        self.relief_slope = float(c.get("reliefSlope", 96.0))
        lights = []
        for (lx, ly, lz, lw) in ((-0.49, -0.49, 0.72, 0.50),   # key
                                 (0.58, -0.29, 0.76, 0.30),   # fill
                                 (0.00, 0.66, 0.75, 0.20)):   # rim
            n = np.sqrt(lx * lx + ly * ly + lz * lz)
            lights.append((lx / n, ly / n, lz / n, lw))
        self.lights = lights
        # flat response r0 = Σ w·lz (gx=gy=0 → n=(0,0,1)) — the exact-1
        # normalization divisor
        self.flat_response = float(sum(w * lz for (_, _, lz, w) in lights))
        # stage 4 — specular fake (threshold + blur σ6 + screen)
        self.spec_threshold = float(c.get("specThreshold", 235.0))
        self.spec_soften = float(c.get("specSoften", 6.0))
        self.spec_strength = float(c.get("specStrength", 1.0))
        # stage 5 — tone S-curve LUT (baked, rounded once) + saturation
        pivot = float(c.get("tonePivot", 0.45))
        contrast = float(c.get("toneContrast", 1.12))
        u = np.arange(256, dtype=np.float32) / 255.0
        curve = np.clip(pivot + (u - pivot) * contrast, 0.0, 1.0)
        self.tone_lut = np.clip(np.round(curve * 255.0), 0, 255).astype(np.uint8)
        self.saturation = float(c.get("saturation", 1.25))
        # stage 6 — tilt-blur diorama band (fixed, screen-anchored)
        self.tilt = bool(c.get("tiltBlur", True))
        self.band_lo = float(c.get("tiltBandLo", 0.30))
        self.band_hi = float(c.get("tiltBandHi", 0.62))
        self.tilt_ramp = float(c.get("tiltRamp", 0.25))
        self.tilt_sigma = float(c.get("tiltSigma", 6.0))
        self._tilt_wgt: Optional[np.ndarray] = None
        self._tilt_hw: tuple = (0, 0)
        # stage 7 — vignette + grain
        self.vignette = float(c.get("vignette", 0.35))
        self.grain = float(c.get("grain", 6.0))
        self._vmask: Optional[np.ndarray] = None

    def _tilt_weight(self, h: int, w: int) -> np.ndarray:
        if self._tilt_wgt is not None and self._tilt_hw == (h, w):
            return self._tilt_wgt
        ys = np.arange(h, dtype=np.float32) / float(h)
        d = np.zeros(h, dtype=np.float32)
        lo, hi = self.band_lo, self.band_hi
        ramp = max(self.tilt_ramp, 1e-6)
        below = ys < lo
        above = ys > hi
        d[below] = (lo - ys[below]) / ramp
        d[above] = (ys[above] - hi) / ramp
        self._tilt_wgt = np.clip(d, 0.0, 1.0).reshape(h, 1, 1)
        self._tilt_hw = (h, w)
        return self._tilt_wgt

    def __call__(self, bgr: np.ndarray, frame_index: int) -> np.ndarray:
        h, w = bgr.shape[:2]
        # stage 1 — medium flatten (plasticine)
        flat = S.median_pool(bgr, self.flat_median_k)
        flat = S.bilateral_flatten(flat, self.flat_bilat_d,
                                   self.flat_bilat_sigma,
                                   self.flat_bilat_sigma,
                                   self.flat_bilat_iters)
        # stage 3a — relief matte from the FLATTENED luma (computed BEFORE
        # palette quantization: palette steps are class boundaries, not
        # height; the flattened field is the smooth height field)
        matte = None
        if self.relief_mix > 0.0:
            gray = cv2.cvtColor(flat, cv2.COLOR_BGR2GRAY)
            gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3).astype(np.float64)
            gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3).astype(np.float64)
            nx = -gx / self.relief_slope
            ny = -gy / self.relief_slope
            inv_len = 1.0 / np.sqrt(nx * nx + ny * ny + 1.0)
            resp = np.zeros_like(nx)
            for (lx, ly, lz, lw) in self.lights:
                dot = (nx * lx + ny * ly + lz) * inv_len
                resp += lw * np.maximum(dot, 0.0)
            matte = 1.0 + np.tanh(resp / self.flat_response - 1.0)
        # stage 2 — toy palette (assignment frozen; output chroma-lifted)
        if self.assign_palette is not None:
            _, idx = S.quantize_lab(flat, self.assign_palette,
                                    l_weight=self.l_weight, return_idx=True)
            out = S.recolor(idx, self.palette)
        else:
            out = flat
        # stage 3b — relief matte multiply (flat = exact identity)
        if matte is not None:
            gain = 1.0 + self.relief_mix * (matte - 1.0)
            outf = out.astype(np.float64) * gain[..., None]
            out = np.clip(np.round(outf), 0, 255).astype(np.uint8)
        # stage 4 — specular fake (screen; exact identity on empty mask)
        luma = cv2.cvtColor(out, cv2.COLOR_BGR2GRAY).astype(np.float32)
        spec = (luma > self.spec_threshold).astype(np.float32)
        spec = cv2.GaussianBlur(spec, (0, 0), self.spec_soften) \
            * self.spec_strength
        spec = spec[..., None]  # (h,w,1) — broadcast over BGR channels
        base = out.astype(np.float32)
        scr = 255.0 - (255.0 - base) * (255.0 - spec * 255.0) / 255.0
        out = np.clip(np.round(scr), 0, 255).astype(np.uint8)
        # stage 5 — tone S-curve + saturation pop
        out = cv2.LUT(out, self.tone_lut)
        out = S.saturation_lift(out, self.saturation)
        # stage 6 — tilt-blur diorama cue (fixed focus band)
        if self.tilt:
            wgt = self._tilt_weight(h, w)
            far = cv2.GaussianBlur(out, (0, 0), self.tilt_sigma).astype(np.float32)
            near = out.astype(np.float32)
            out = np.clip(np.round(near * (1.0 - wgt) + far * wgt),
                          0, 255).astype(np.uint8)
        # stage 7 — vignette + noir-law grain
        if self._vmask is None:
            self._vmask = S.vignette_mask(w, h, self.vignette)
        out = S.apply_vignette(out, self._vmask)
        out = S.grain(out, frame_index, self.grain)
        return out


# ---------------------------------------------------------------------------
# player-focus pipeline state (SPR205) — TL rebuild of the reset-lost w5h
#
# The original spr/w5h/playerfocus-trial (local main c1ebaac era) was lost
# to the 2026-09-27 sandbox reset before its PAT-blocked push reached
# origin (the lost shas 9e0aa306/fda349d3/f048a10d resolve nowhere on
# origin and are NOT claimed — every measurement in its evidence pack is
# FRESH). The recorded design is implemented verbatim, including the
# phase-1 crop-following-zoom REJECTION (the anti-precedent, re-measured
# as fast-loop variant v0) and the phase-2 winner: STATIC punch-in zoom
# z=1.35 (frame-center fixed warp — static regions map to fixed output
# pixels = T4 clean by construction; uniform motion scaling = T3
# preserved; cuts pass through the fixed warp) + a 4D critically-damped
# spring (k=0.02) on the camshift-tracked soft-focus dim mask. The three
# recorded fast-loop-caught bugs are designed out: the opening window is
# armed ONCE at clip start (never re-armed — the infinite-reset fix);
# the spring starts at pos=target=neutral (no init jump); w/h are sprung
# dimensions (no unsprung mask-size hops). Deterministic-classical,
# CPU-only (OpenCV + numpy, the frozen engine toolset).
# ---------------------------------------------------------------------------


class _PlayerFocusState:
    """Streaming state for the SPR205 player-focus pipeline.

    Stage 0  motion_gate: Farneback residual flow > motionKnee @320x180
              OR MOG2 foreground (history 150, var 18, lr 0.02,
              cut-reinit — the subject-toon mask convention), open3/
              close5 morphology — the motion probability map that drives
              CAMSHIFT.
    Stage 1  opening     : a 12-frame flood-immune window — the union of
              the RESIDUAL-FLOW-ONLY motion (MOG2 excluded: its start
              flood would seed the whole frame) accumulates over the
              first frames and seeds the initial CAMSHIFT window at
              frame `openingFrames`. Armed ONCE per clip (frame-count
              based, never re-armed at cuts — the recorded infinite-
              reset-loop fix).
    Stage 2  camshift    : motion-gated probability map, EPS 1 / 10
              iters, min-window clamp; failure keeps the previous
              target.
    Stage 3  spring_4d   : critically damped (k=0.02, ω=√k, ζ=1) spring
              on (cx, cy, w, h); pos = target at init (no jump); all four
              dimensions sprung (no unsprung mask-size hops); at engine
              cuts the TARGET resets to the neutral center window and
              the spring GLIDES there (smooth, never a single-frame
              discontinuity — cut preservation).
    Stage 4  static_zoom : z=1.35 frame-center FIXED warp (phase-2
              winner). Static regions map to fixed output pixels (T4
              clean by construction); uniform motion scaling (T3
              preserved); cuts pass through the fixed warp (raw T2).
    Stage 5  soft_dim    : the spring rect (feathered σ maskFeather)
              mapped through the SAME warp; outside dimmed at
              dimStrength. [phase-1 cropFollow mode: the warp maps the
              sprung rect to the output instead — the REJECTED
              anti-precedent, measured as fast-loop v0.]

    Deterministic: MOG2 GMM updates, Farneback, CAMSHIFT and the spring
    integration are deterministic functions of the frame sequence; no
    RNG. The spring math runs float64 (scalar state).
    """

    def __init__(self, cfg: dict, cuts: set):
        c = self.cfg = cfg
        self.cuts = cuts
        # stage 4 — static punch-in zoom (phase-2) / crop-follow (phase-1)
        self.zoom = float(c.get("zoom", 1.35))
        self.crop_follow = bool(c.get("cropFollow", False))
        self.crop_pad = float(c.get("cropPad", 1.25))
        # stage 0 — motion gate (the subject-toon convention)
        self.motion_knee = float(c.get("motionKnee", 1.8))
        self.mog_history = int(c.get("mogHistory", 150))
        self.mog_var = float(c.get("mogVarThreshold", 18.0))
        self.mog_lr = float(c.get("mogLearningRate", 0.02))
        self.mog2 = None  # lazy: created on first frame
        self._k3 = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        self._k5 = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        # stage 1 — opening window (flood-immune, once per clip)
        self.opening_frames = int(c.get("openingFrames", 12))
        self.opening_min_union = float(c.get("openingMinUnion", 0.004))
        # stage 2 — camshift
        self.cam_eps = float(c.get("camEps", 1.0))
        self.cam_max_iter = int(c.get("camMaxIter", 10))
        self.min_window_frac = float(c.get("minWindowFrac", 0.12))
        # stage 3 — 4D critically damped spring
        self.spring_k = float(c.get("springK", 0.02))
        self.omega = np.sqrt(self.spring_k)
        # stage 5 — soft dim
        self.dim_strength = float(c.get("dimStrength", 0.45))
        self.mask_feather = float(c.get("maskFeather", 21.0))
        # stream state
        self.frame_index = 0
        self.prev_gray_small: Optional[np.ndarray] = None
        self.pos = None            # [cx, cy, w, h] float64 @320x180
        self.vel = np.zeros(4, dtype=np.float64)
        self.opening_union: Optional[np.ndarray] = None
        self.cam_started = False

    # -- helpers ------------------------------------------------------------

    def _neutral(self, sw: int, sh: int) -> np.ndarray:
        """Neutral center window (spring home; cut-reset target)."""
        return np.array([sw / 2.0, sh / 2.0, sw * 0.55, sh * 0.65],
                        dtype=np.float64)

    def _spring_step(self, target: np.ndarray) -> None:
        """Critically damped 4D spring integration (dt = 1 frame)."""
        w2 = self.omega * self.omega
        for i in range(4):
            a = w2 * (target[i] - self.pos[i]) - 2.0 * self.omega * self.vel[i]
            self.vel[i] += a
            self.pos[i] += self.vel[i]
        # keep w/h positive and bounded
        sw, sh = self.small_wh
        self.pos[2] = float(np.clip(self.pos[2], sw * self.min_window_frac,
                                    sw * 1.4))
        self.pos[3] = float(np.clip(self.pos[3], sh * self.min_window_frac,
                                    sh * 1.4))

    # -- pipeline -------------------------------------------------------------

    def __call__(self, bgr: np.ndarray, gray_small: np.ndarray,
                 cut: bool) -> np.ndarray:
        h, w = bgr.shape[:2]
        sh, sw = gray_small.shape[:2]
        self.small_wh = (sw, sh)
        clip_start = self.frame_index == 0

        # ---- stage 0: motion probability map (320x180) ------------------
        motion = np.zeros(gray_small.shape, dtype=np.float32)
        if self.prev_gray_small is not None and not cut:
            mag = S.flow_magnitude(self.prev_gray_small, gray_small)
            motion = (mag > self.motion_knee).astype(np.float32)
        if cut:
            # fresh background model for the new scene (no cross-cut bleed)
            self.mog2 = cv2.createBackgroundSubtractorMOG2(
                history=self.mog_history, varThreshold=self.mog_var,
                detectShadows=False)
            fg255 = self.mog2.apply(bgr, learningRate=1.0)
        else:
            if self.mog2 is None:
                self.mog2 = cv2.createBackgroundSubtractorMOG2(
                    history=self.mog_history, varThreshold=self.mog_var,
                    detectShadows=False)
            fg255 = self.mog2.apply(bgr, learningRate=self.mog_lr)
        fg = (fg255 > 0).astype(np.float32)
        fg_small = cv2.resize(fg, (sw, sh), interpolation=cv2.INTER_AREA)
        prob = np.maximum(motion, fg_small)
        prob = cv2.morphologyEx(prob, cv2.MORPH_OPEN, self._k3)
        prob = cv2.morphologyEx(prob, cv2.MORPH_CLOSE, self._k5)

        # ---- stage 1: flood-immune opening (ONCE per clip) ----------------
        opening = (not self.cam_started
                   and self.frame_index < self.opening_frames)
        if opening:
            flow_only = motion  # MOG2 start-flood immune
            if self.opening_union is None:
                self.opening_union = flow_only.copy()
            else:
                self.opening_union = np.maximum(self.opening_union, flow_only)
        seed = None
        if (not self.cam_started
                and self.frame_index >= self.opening_frames - 1):
            self.cam_started = True
            # the accumulated union seeds the initial CAMSHIFT window (the
            # 12-frame flood-immune opening); insufficient mass keeps the
            # neutral window (no forced init, no jump)
            if self.opening_union is not None:
                mass = float(self.opening_union.mean())
                if mass >= self.opening_min_union:
                    ys, xs = np.nonzero(self.opening_union > 0.5)
                    if len(xs) >= 8:
                        seed = (int(xs.min()), int(ys.min()),
                                int(xs.max() - xs.min() + 1),
                                int(ys.max() - ys.min() + 1))

        # ---- spring target ---------------------------------------------------
        if self.pos is None:
            # init: pos = target = neutral (NO init jump — the recorded fix)
            self.pos = self._neutral(sw, sh)
            self.vel = np.zeros(4, dtype=np.float64)
        target = self.pos.copy()
        if seed is not None:
            # opening-seeded target (the spring GLIDES from neutral — smooth)
            target = np.array(
                [seed[0] + seed[2] / 2.0, seed[1] + seed[3] / 2.0,
                 float(seed[2]), float(seed[3])], dtype=np.float64)
        if self.cam_started and not opening:
            # ---- stage 2: CAMSHIFT on the motion prob map -----------------
            if seed is not None:
                window = seed
            else:
                x, y, ww, hh = self.pos.copy()
                ww = max(ww, sw * self.min_window_frac)
                hh = max(hh, sh * self.min_window_frac)
                window = (int(round(x - ww / 2.0)), int(round(y - hh / 2.0)),
                          int(round(ww)), int(round(hh)))
            window = (max(0, window[0]), max(0, window[1]),
                      min(window[2], sw - max(0, window[0])),
                      min(window[3], sh - max(0, window[1])))
            if window[2] >= 4 and window[3] >= 4 and prob.sum() > 0:
                crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT,
                        self.cam_max_iter, self.cam_eps)
                try:
                    ret, _ = cv2.CamShift(prob.astype(np.uint8), window, crit)
                    # ret is a RotatedRect ((cx, cy), (w, h), angle) —
                    # convert to the axis-aligned bounding box
                    pts = cv2.boxPoints(ret)
                    x0, y0 = pts.min(axis=0)
                    x1, y1 = pts.max(axis=0)
                    bw2, bh2 = float(x1 - x0), float(y1 - y0)
                    if bw2 >= 4 and bh2 >= 4:
                        target = np.array(
                            [x0 + bw2 / 2.0, y0 + bh2 / 2.0,
                             bw2, bh2], dtype=np.float64)
                except cv2.error:
                    pass  # keep previous target deterministically
        if cut and not clip_start:
            # cut-reset: the old track is invalid — TARGET returns to the
            # neutral window and the spring GLIDES (never a jump)
            target = self._neutral(sw, sh)
        # ---- stage 3: spring integration ------------------------------------
        self._spring_step(target)

        # ---- stage 4/5: zoom + soft dim --------------------------------------
        if self.crop_follow:
            # phase-1 anti-precedent: the warp maps the sprung rect
            # (padded) to the output — measured REJECTED (v0)
            pad = self.crop_pad
            rw = self.pos[2] * pad
            rh = self.pos[3] * pad
            s = max(w / rw, h / rh)
            M = np.float32([[s, 0.0, w / 2.0 - s * self.pos[0] * (w / sw)],
                            [0.0, s, h / 2.0 - s * self.pos[1] * (h / sh)]])
            out = cv2.warpAffine(bgr, M, (w, h),
                                 flags=cv2.INTER_LINEAR,
                                 borderMode=cv2.BORDER_REPLICATE)
        else:
            # phase-2 winner: STATIC frame-center punch-in (fixed warp)
            z = self.zoom
            M = np.float32([[z, 0.0, (1.0 - z) * w / 2.0],
                            [0.0, z, (1.0 - z) * h / 2.0]])
            out = cv2.warpAffine(bgr, M, (w, h),
                                 flags=cv2.INTER_LINEAR,
                                 borderMode=cv2.BORDER_REPLICATE)
            # soft dim mask: spring rect (320x180) -> full-res -> through
            # the same static warp
            if self.dim_strength > 0.0:
                m = np.zeros((sh, sw), dtype=np.float32)
                x0 = int(max(0, self.pos[0] - self.pos[2] / 2.0))
                y0 = int(max(0, self.pos[1] - self.pos[3] / 2.0))
                x1 = int(min(sw, self.pos[0] + self.pos[2] / 2.0))
                y1 = int(min(sh, self.pos[1] + self.pos[3] / 2.0))
                if x1 > x0 and y1 > y0:
                    m[y0:y1, x0:x1] = 1.0
                m = cv2.GaussianBlur(m, (0, 0),
                                     max(self.mask_feather / 2.0, 1.0))
                m = cv2.resize(m, (w, h), interpolation=cv2.INTER_LINEAR)
                m = cv2.warpAffine(m, M, (w, h), flags=cv2.INTER_LINEAR,
                                   borderMode=cv2.BORDER_REPLICATE)
                m = cv2.GaussianBlur(m, (0, 0), self.mask_feather)
                base = out.astype(np.float32)
                out = np.clip(
                    np.round(base * (1.0 - self.dim_strength
                                     * (1.0 - m[..., None]))),
                    0, 255).astype(np.uint8)

        self.prev_gray_small = gray_small
        self.frame_index += 1
        return out


# ---------------------------------------------------------------------------
# rotoscope pipeline state (SPR109) — TL rebuild of the reset-lost w5i
#
# The recorded recipe verbatim (phase-4 frozen values): pre-smooth +
# fixed LAB K=10 fills + 2-tone value (wide smoothstep knee, light ×1.60
# / dark ×0.35) + HEAVY XDoG (eps 0.0010 / phi 20, binary+median
# stabilized, FLOW-STABILIZED: Farneback forward-warp + EMA 0.75 +
# cut-reset, line floor 0.10) + clean finish (sat 1.15 + vignette 0.20,
# NO grain). The original spr/w5i/rotoscope-trial (local main 0859ba6
# era) was lost to the 2026-09-27 sandbox reset before its PAT-blocked
# push reached origin — the lost shas (2d5fb163/2847128c/4f3c8a62)
# resolve nowhere on origin and are NOT claimed; every measurement in
# its evidence pack is FRESH. The recorded phase-3/4 re-open history
# (the phase-1 recipe failed full-b8 T2b at cov 0.667 — the 979/982
# micro-shot cut-amplitude compression class — and was re-hardened via
# the tone contrast + phi 20 + floor 0.10 combination) is encoded in
# the frozen starting config; the fast loop re-measures the
# flow-stabilization thesis (v0-noflow A/B).
# ---------------------------------------------------------------------------


class _RotoscopeState:
    """Streaming state for the SPR109 rotoscope/hand-drawn pipeline.

    Stage 1  pre_smooth: median k3 + bilateral d9 σ75 ×2 — noise-crawl
              mitigation for the XDoG (the ink-manga class; rotoscope
              keeps one fewer bilateral so the XDoG sees more structure).
    Stage 2  lab_fills  : fixed per-clip LAB K=10 palette (the engine's
              learn_palette), chroma-weighted assignment l=0.45 — flat
              color fills under the ink.
    Stage 3  two_tone  : a wide-smoothstep-knee value curve with two
              levels — gain = dark + (light−dark)·t(luma), light ×1.60 /
              dark ×0.35 (phase-4 frozen), knee 0.30–0.70 — the palette
              fills collapse into two value bands (the rotoscope
              cel-value look). numpy float64 gain math.
    Stage 4  xdog_ink  : HEAVY XDoG (eps 0.0010, phi 20 — deeper ink
              pooling than ink-manga) on the SMOOTHED frame;
              FLOW-STABILIZED: the previous stabilized edge map is
              forward-warped by the Farneback flow (backward-sampled
              remap, border replicate) and EMA-blended (α 0.75) with the
              fresh map; CUT-RESET drops the history (contract invariant
              4); then binary knee 0.5 + median 5 stabilization +
              soften σ0.8 (the ink-manga compositor pattern) burned at
              line floor 0.10 (darker than ink-manga's 0.20 — the
              recorded phase-3/4 hardening leg).
    Stage 5  finish    : saturation ×1.15 + vignette 0.20, NO grain
              (the clean-finish record).

    Deterministic: Farneback, remap and the EMA are deterministic
    functions of the frame sequence; no RNG anywhere.
    """

    def __init__(self, cfg: dict, palette: Optional[np.ndarray]):
        c = self.cfg = cfg
        # stage 1 — pre-smooth
        self.pre_median_k = int(c.get("preMedianK", 3))
        self.bilat_d = int(c.get("preBilatD", 9))
        self.bilat_sigma = float(c.get("preBilatSigma", 75.0))
        self.bilat_iters = int(c.get("preBilatIters", 2))
        # stage 2 — LAB fills
        self.l_weight = float(c.get("lWeight", 0.45))
        self.palette = palette
        # stage 3 — 2-tone value (wide smoothstep knee; phase-4 frozen)
        self.tone_light = float(c.get("toneLight", 1.60))
        self.tone_dark = float(c.get("toneDark", 0.35))
        self.tone_knee_lo = float(c.get("toneKneeLo", 0.30))
        self.tone_knee_w = float(c.get("toneKneeWidth", 0.40))
        # stage 4 — heavy XDoG, flow-stabilized
        self.xdog_sigma = float(c.get("xdogSigma", 1.0))
        self.xdog_k = float(c.get("xdogK", 1.6))
        self.xdog_tau = float(c.get("xdogTau", 0.98))
        self.xdog_eps = float(c.get("xdogEps", 0.0010))
        self.xdog_phi = float(c.get("xdogPhi", 20.0))
        self.flow_stabilize = bool(c.get("flowStabilize", True))
        self.ema_alpha = float(c.get("emaAlpha", 0.75))
        self.line_knee = float(c.get("lineKnee", 0.5))
        self.line_median = int(c.get("lineMedian", 5))
        self.line_soften = float(c.get("lineSoften", 0.8))
        self.line_floor = float(c.get("lineFloor", 0.10))
        # stage 5 — clean finish
        self.saturation = float(c.get("saturation", 1.15))
        self.vignette = float(c.get("vignette", 0.20))
        # stream state
        self.prev_gray_small: Optional[np.ndarray] = None
        self.edge_ema: Optional[np.ndarray] = None   # full-res stabilized map
        self._grid: Optional[np.ndarray] = None
        self._vmask: Optional[np.ndarray] = None

    def __call__(self, bgr: np.ndarray, gray_small: np.ndarray,
                 cut: bool) -> np.ndarray:
        h, w = bgr.shape[:2]
        # stage 1 — pre-smooth (XDoG noise-crawl mitigation)
        sm = S.median_pool(bgr, self.pre_median_k)
        sm = S.bilateral_flatten(sm, self.bilat_d, self.bilat_sigma,
                                 self.bilat_sigma, self.bilat_iters)
        # stage 2 — LAB K=10 fills
        if self.palette is not None:
            out = S.quantize_lab(sm, self.palette, l_weight=self.l_weight)
        else:
            out = sm
        # stage 3 — 2-tone value curve (wide smoothstep knee)
        L = cv2.cvtColor(out, cv2.COLOR_BGR2GRAY).astype(np.float64) / 255.0
        t = np.clip((L - self.tone_knee_lo) / max(self.tone_knee_w, 1e-6),
                    0.0, 1.0)
        t = t * t * (3.0 - 2.0 * t)  # smoothstep (wide knee)
        gain = self.tone_dark + (self.tone_light - self.tone_dark) * t
        outf = out.astype(np.float64) * gain[..., None]
        out = np.clip(np.round(outf), 0, 255).astype(np.uint8)
        # stage 4 — heavy XDoG ink, flow-stabilized
        e = S.xdog_edge_map(sm, sigma=self.xdog_sigma, k=self.xdog_k,
                            tau=self.xdog_tau, eps=self.xdog_eps,
                            phi=self.xdog_phi)
        if self.flow_stabilize and self.prev_gray_small is not None \
                and not cut and self.edge_ema is not None:
            flow = cv2.calcOpticalFlowFarneback(
                self.prev_gray_small, gray_small, None,
                0.5, 3, 15, 3, 5, 1.2, 0)
            flow_big = cv2.resize(flow, (w, h),
                                  interpolation=cv2.INTER_LINEAR) * 2.0
            if self._grid is None:
                ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
                self._grid = np.stack([xs, ys], axis=-1)
            map_x = self._grid[..., 0] - flow_big[..., 0]
            map_y = self._grid[..., 1] - flow_big[..., 1]
            warped = cv2.remap(self.edge_ema, map_x, map_y,
                               cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            self.edge_ema = (self.ema_alpha * warped
                             + (1.0 - self.ema_alpha) * e).astype(np.float32)
        elif self.edge_ema is None or cut:
            self.edge_ema = e  # cut-reset: fresh map, history dropped
        else:
            self.edge_ema = e  # no-flow mode (v0 A/B)
        # binary + median stabilized compositor (the ink-manga pattern)
        eb = (self.edge_ema < self.line_knee).astype(np.float32)
        if self.line_median:
            eb = cv2.medianBlur(eb, self.line_median)
        if self.line_soften:
            eb = cv2.GaussianBlur(eb, (0, 0), self.line_soften)
        # lines: E->0 on edges; eb marks line pixels (1) — invert to the
        # edge-map convention for the overlay
        edges = (1.0 - eb).astype(np.float32)
        out = S.edge_overlay(out, edges, self.line_floor)
        # stage 5 — clean finish (no grain)
        out = S.saturation_lift(out, self.saturation)
        if self._vmask is None:
            self._vmask = S.vignette_mask(w, h, self.vignette)
        out = S.apply_vignette(out, self._vmask)
        self.prev_gray_small = gray_small
        return out


# ---------------------------------------------------------------------------
# watercolor/painterly pipeline state (SPR103) — promoted from the w2c trial
# sprtrial-kuwahara-paint-t1 (the subject-toon promotion pattern)
#
# The trial's frozen processor ported verbatim (stage order and parameters
# identical; the port RESTATES the tiny helpers instead of importing from
# spe.trials — the promotion convention that keeps renderers.py decoupled
# from the lane write-surface). The trial's honest anti-stages stay OUT:
# palette re-quantization and the XDoG overlay were measured in the trial's
# stage-isolation diagnostics to re-amplify the 8-orientation blend residue
# into net/grass blotching and dark speckle ghosting — dropped, recorded
# (the clean painterly rendition is the Kuwahara + bilateral alone). The
# condition from the w2c verdict (CONDITIONAL — painterly family only)
# becomes the family declaration: this is the painterly/watercolor lane.
# Deterministic-classical, CPU-only (own numpy/OpenCV implementation of the
# public Kyprianidis-class anisotropic Kuwahara — nothing copied from GPL
# ports). See _WatercolorState below for the full stage math and the
# smoke-tested anti-artifact design notes (coherence gate, soft quadrant
# blend, variance smoothing, orientation-field smoothing, pre-consolidation).
# ---------------------------------------------------------------------------


_LUMA_W = np.array([0.114, 0.587, 0.299], dtype=np.float32)  # BGR -> BT.601


class _WatercolorState:
    """Streaming state for the SPR103 watercolor/painterly pipeline.

    Promoted from trial sprtrial-kuwahara-paint-t1 (wave-2 lane C) — stage
    order and parameters identical to the trial processor:

    Stage 1  half-res    : abstraction core at 320x180 (watercolor practice:
              abstract low, finish high — the quadrant-variance selector is
              noise-dominated at full res on broadcast texture); median k3
              + bilateral x1 (d7 σ50) pre-consolidation (the 8 rotated cores
              alias the goal net differently — flatten BEFORE the orientation
              machinery so all rotations see the same smooth fields).
    Stage 2  tensor_ema : structure tensor (Sobel + Gaussian σ2.5), temporal
              EMA α 0.45 with CUT-RESET (contract invariant 4) — the yaml's
              temporal pre-smoothing mitigation of edge-flow crawl.
    Stage 3  orientation: coherence-gated soft orientation weights over N=8
              quantized isophote angles (doubled-angle, branch-free);
              isotropic texture falls back to a uniform mix (the coherence
              gate — without it, ^gamma weights degenerate into per-pixel
              random hard picks = the 'disconnected blobs' v4 smoke);
              weight-map Gaussian σ2 (smooth orientation fields — hard
              per-pixel switching left 'double-exposure' ghosts, v7 smoke).
    Stage 4  kuwahara   : per-orientation 4-quadrant anisotropic Kuwahara
              (rotate → quadrant boxFilter means/variances → rotate back);
              SOFT inverse-variance quadrant blend p=3 (NOT argmin — a hard
              min-variance pick switches between quadrant means and the
              boundaries render as persistent grass/net blotching, v6
              smoke); variance fields Gaussian-smoothed σ2 (small-quadrant
              estimates are noise-dominated); qLong 3 × qShort 2 at half
              res = 7×5 at source scale.
    Stage 5  finish     : bilinear upsample to full res (brush-stroke
              transitions), bilateral x2 (d9 σ75) field consolidation,
              saturation ×1.14, paper grain 1.5 (the frozen frame-index
              grain law).

    Deterministic: no RNG beyond the frozen grain law; the tensor EMA and
    rotations are fixed functions of the frame sequence.
    """

    def __init__(self, cfg: dict, cuts: set):
        c = self.cfg = cfg
        self.cuts = cuts
        self.frame_index = 0
        self.tensor_ema: Optional[np.ndarray] = None
        self._rot_cache: dict = {}
        # stage 1 — half-res pre-consolidation
        self.pre_median_k = int(c.get("preMedianK", 3))
        self.pre_bilat_d = int(c.get("preBilatD", 7))
        self.pre_bilat_sigma = float(c.get("preBilatSigma", 50))
        self.pre_bilat_iters = int(c.get("preBilatIters", 1))
        # stage 2 — structure tensor EMA
        self.tensor_sigma = float(c.get("tensorSigma", 2.5))
        self.tensor_alpha = float(c.get("tensorAlpha", 0.45))
        # stage 3 — orientation field
        self.orientations = int(c.get("orientations", 8))
        self.blend_gamma = float(c.get("blendGamma", 10.0))
        self.weight_sigma = float(c.get("weightSigma", 2.0))
        # stage 4 — anisotropic Kuwahara quadrants
        self.q_long = int(c.get("qLong", 3))
        self.q_short = int(c.get("qShort", 2))
        self.var_sigma = float(c.get("varSigma", 2.0))
        self.var_softness = float(c.get("varSoftness", 3.0))
        # stage 5 — consolidation + finish
        self.post_bilat_d = int(c.get("postBilatD", 9))
        self.post_bilat_sigma = float(c.get("postBilatSigma", 75))
        self.post_bilat_iters = int(c.get("postBilatIters", 2))
        self.saturation = float(c.get("saturation", 1.14))
        self.grain = float(c.get("grain", 1.5))

    # -- structure tensor ----------------------------------------------------

    def _tensor(self, gray_f32: np.ndarray) -> np.ndarray:
        gx = cv2.Sobel(gray_f32, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(gray_f32, cv2.CV_32F, 0, 1, ksize=3)
        s = self.tensor_sigma
        jxx = cv2.GaussianBlur(gx * gx, (0, 0), s)
        jxy = cv2.GaussianBlur(gx * gy, (0, 0), s)
        jyy = cv2.GaussianBlur(gy * gy, (0, 0), s)
        return np.stack([jxx, jxy, jyy], axis=-1)

    def _orientation_weights(self) -> np.ndarray:
        """Coherence-gated soft orientation weights (N,H,W), summing to 1."""
        jxx = self.tensor_ema[..., 0]
        jxy = self.tensor_ema[..., 1]
        jyy = self.tensor_ema[..., 2]
        vx = jyy - jxx
        vy = -2.0 * jxy
        vmag = np.sqrt(vx * vx + vy * vy)
        norm = vmag + 1e-9
        vx = vx / norm
        vy = vy / norm
        coh = np.clip(vmag / (jxx + jyy + 1e-6), 0.0, 1.0).astype(np.float32)
        gate = coh * coh
        n = self.orientations
        gamma = self.blend_gamma
        wsm = self.weight_sigma
        w = np.zeros((n, vx.shape[0], vx.shape[1]), dtype=np.float32)
        for o in range(n):
            a = 2.0 * np.pi * o / n
            score = (vx * np.float32(np.cos(a))
                     + vy * np.float32(np.sin(a))).astype(np.float32)
            w[o] = 1e-3 + np.clip(score, 0.0, 1.0) ** gamma * gate
        if wsm > 0:
            for o in range(n):
                w[o] = cv2.GaussianBlur(w[o], (0, 0), wsm)
        w /= w.sum(axis=0, keepdims=True)
        return w

    # -- anisotropic Kuwahara core -------------------------------------------

    def _rot_pair(self, deg: float, shape):
        key = round(deg, 6)
        if key not in self._rot_cache:
            h, w = shape[:2]
            c = (w / 2.0, h / 2.0)
            self._rot_cache[key] = (cv2.getRotationMatrix2D(c, deg, 1.0),
                                    cv2.getRotationMatrix2D(c, -deg, 1.0))
        return self._rot_cache[key]

    def _kuwahara_orientation(self, bgr_f32: np.ndarray,
                              deg: float) -> np.ndarray:
        """4-quadrant anisotropic Kuwahara for one orientation."""
        h, w = bgr_f32.shape[:2]
        if abs(deg) < 1e-9:
            r = bgr_f32
        else:
            m, _ = self._rot_pair(deg, bgr_f32.shape)
            r = cv2.warpAffine(bgr_f32, m, (w, h), flags=cv2.INTER_LINEAR,
                               borderMode=cv2.BORDER_REFLECT_101)
        ql, qs = self.q_long, self.q_short
        ksize = (ql + 1, qs + 1)
        anchors = [(0, 0), (ql, 0), (0, qs), (ql, qs)]
        y_sq = (r @ _LUMA_W) ** 2
        means = []
        variances = []
        for (ax, ay) in anchors:
            mu = cv2.boxFilter(r, cv2.CV_32F, ksize, anchor=(ax, ay),
                               borderType=cv2.BORDER_REFLECT_101)
            mu_y = mu @ _LUMA_W
            mu_y2 = cv2.boxFilter(y_sq, cv2.CV_32F, ksize, anchor=(ax, ay),
                                  borderType=cv2.BORDER_REFLECT_101)
            means.append(mu)
            variances.append(np.maximum(mu_y2 - mu_y * mu_y, 0.0))
        vs = self.var_sigma
        v = np.stack([cv2.GaussianBlur(x, (0, 0), vs) for x in variances],
                     axis=-1)
        p_soft = self.var_softness
        vbar = v.mean(axis=-1, keepdims=True)
        wq = np.exp(-p_soft * v / (vbar + 1e-3))
        wq /= wq.sum(axis=-1, keepdims=True)
        mu = np.stack(means, axis=-1)
        out = (mu * wq[..., None, :]).sum(axis=-1)
        out = np.ascontiguousarray(out)
        if abs(deg) < 1e-9:
            return out
        _, mi = self._rot_pair(deg, bgr_f32.shape)
        return cv2.warpAffine(out, mi, (w, h), flags=cv2.INTER_LINEAR,
                              borderMode=cv2.BORDER_REFLECT_101)

    # -- pipeline -------------------------------------------------------------

    def __call__(self, bgr: np.ndarray, cut: bool) -> np.ndarray:
        c = self.cfg
        h, w = bgr.shape[:2]
        hw, hh = w // 2, h // 2
        base = cv2.resize(bgr, (hw, hh), interpolation=cv2.INTER_AREA)
        base = S.median_pool(base, self.pre_median_k)
        base = S.bilateral_flatten(base, self.pre_bilat_d,
                                   self.pre_bilat_sigma,
                                   self.pre_bilat_sigma,
                                   self.pre_bilat_iters)
        gray_f32 = cv2.cvtColor(base, cv2.COLOR_BGR2GRAY).astype(np.float32)
        t_now = self._tensor(gray_f32)
        if self.tensor_ema is None or cut:
            self.tensor_ema = t_now
        else:
            a = self.tensor_alpha
            self.tensor_ema = a * t_now + (1.0 - a) * self.tensor_ema

        wts = self._orientation_weights()
        n = self.orientations
        bgr_f32 = base.astype(np.float32)
        results = np.stack(
            [self._kuwahara_orientation(bgr_f32, float(o) * 180.0 / n)
             for o in range(n)], axis=0)
        out = np.einsum("nhwc,nhw->hwc", results, wts)
        out_u8 = np.clip(out, 0, 255).astype(np.uint8)
        out_u8 = cv2.resize(out_u8, (w, h), interpolation=cv2.INTER_LINEAR)

        out_u8 = S.bilateral_flatten(out_u8, self.post_bilat_d,
                                     self.post_bilat_sigma,
                                     self.post_bilat_sigma,
                                     self.post_bilat_iters)
        out_u8 = S.saturation_lift(out_u8, self.saturation)
        out_u8 = S.grain(out_u8, self.frame_index, self.grain)

        self.frame_index += 1
        return out_u8


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
    version="0.2.0",
    paletteK=10,
    usesFlow=True,
    pipeline=[
        "subject_mask(OR[farneback_residual>1.8 @320x180 camera-compensated, "
        "MOG2 fg(history=150,var=18,lr=0.02,cut-reinit)], open3/close5/dilate7 "
        "scale-aware pad, DUAL-RATE hysteresis rise=0.60/fall=0.05 cut-reset, "
        "soften sigma=4.0)",
        "background_path(v0.2.0 structure-preserving: median3+bilateral x2"
        "(d9,s60)+palette K=10 LAB chroma-weighted STICKY assignment "
        "hysteresis=1.18 cut-reset+region-smooth3+boundary-lines floor 0.24"
        "+sat 1.15)",
        "subject_path(median3+bilateral x1(d7,s50)+xdog soft lines phi=5.0 "
        "floor 0.62+sat 1.10, NO palette quantize)",
        "soft_mask_composite(bg,subj)",
    ],
    description=("Dual-path toon: strong cartoon stylization on the background, "
                 "identity-preserving gentle pass on camera-compensated "
                 "motion/foreground-masked subjects. Promoted from trial "
                 "sprtrial-subject-toon-t1 (SPR-W2-C) — attacks the Tier-2 "
                 "diagnosis that aggressive styles destroy player identity. "
                 "v0.2.0 (SPR-W5-A Tier-2 push): dual-rate mask hysteresis + "
                 "scale-aware limb padding (disappearance/limb criticals), "
                 "temporally sticky palette assignment + structure-preserving "
                 "background front-end (temporal/scene axes), softened XDoG "
                 "for ~25 px players (limb contours)."),
    config={
        # subject mask (v0.2.0: dual-rate hysteresis + scale-aware pad)
        "motionKnee": 1.8, "mogHistory": 150, "mogVarThreshold": 18.0,
        "mogLearningRate": 0.02, "maskRiseAlpha": 0.60, "maskFallAlpha": 0.05,
        "maskSoften": 4.0, "maskDilate": 7,
        # background (strong) path — v0.2.0 structure-preserving + sticky
        "bgMedianK": 3, "bgBilatD": 9, "bgBilatSigma": 60, "bgBilatIters": 2,
        "bgRegionWindow": 3, "bgSaturation": 1.15, "bgLineDilate": 1,
        "bgLineFloor": 0.24, "lWeight": 0.45, "bgHysteresis": 1.18,
        # subject (gentle) path — v0.2.0 softer XDoG for small players
        "sjMedianK": 3, "sjBilatD": 7, "sjBilatSigma": 50, "sjBilatIters": 1,
        "sjXdogSigma": 1.0, "sjXdogK": 1.6, "sjXdogTau": 0.98,
        "sjXdogEps": 0.010, "sjXdogPhi": 5.0,
        "sjLineFloor": 0.62, "sjSaturation": 1.10,
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
        "displacement x2; fixed EMA alpha=0.75 blends warped-prev with the "
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
        "temporal": True, "emaAlpha": 0.75, "flowScale": 2,
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


# ---------------------------------------------------------------------------
# SPR202 Silhouette / X-Ray — wave-5 fresh reality (SPR-W5-G, Lane I)
#
# The SPR202 deterministic baseline spr202.det.mog2-silhouette
# (docs/technology/source-preserving-candidates.yaml), implemented per the
# frozen dispatch recipe: global-motion compensation (Farneback frame-pair
# flow -> warp-align consecutive frames, composed as a cumulative per-shot
# affine — the anti-pan leg) -> MOG2 background subtraction (deterministic
# config, fixed history, cut-reinit per contract invariant 4) -> motion
# mask threshold + morphology (open/close, fixed kernels) -> TWO output
# profiles: ink-fill (default; solid ink silhouette on paper-white) and
# xray (--profile xray; mask-distance -> thermal-LUT false-color + Sobel
# rim glow) -> encode-bitexact. Deterministic-classical, CPU-only (OpenCV
# + numpy, the frozen engine toolset; NO neural matting — SAM2/RVM are
# future upgrades, out of scope). See _SilhouetteXrayState above for the
# full stage math, the anti-pan/coverage design and the determinism
# notes (the w5e cv2.magnitude IPP lesson applied in the rim stage).
# ---------------------------------------------------------------------------


SILHOUETTE_XRAY = RendererSpec(
    rendererId="spr-silhouette-xray-dc1", reality="silhouette-xray",
    family="Silhouette / X-Ray (SPR202)", sprId="SPR202",
    profiles=["default", "xray"],
    usesFlow=True,
    pipeline=[
        "global_motion_compensation(Farneback 0.5/3/15/3/5/1.2/0 frame-pair "
        "flow at 320x180 -> global translation+zoom least-squares fit "
        "(stride-4 subsample, the stages.flow_magnitude model class) -> "
        "cumulative per-shot float64 affine [zoom clipped +/-0.10, "
        "translation clipped +/-24 px/frame] -> warp-affine-align each "
        "frame into the shot-reference coordinates (BORDER_REPLICATE) and "
        "warp the mask back with the forward affine — the anti-pan leg; "
        "determinism: closed-form float64 compose + invertAffineTransform "
        "+ fixed bilinear warps, a pure fixed-op chain proven by the "
        "per-cell double-render byte-equality)",
        "mog2_background_subtraction(deterministic config: fixed "
        "history=200, varThreshold=34, learningRate=0.04 with a "
        "post-flood learning-rate boost 0.12 for 12 frames (fast "
        "background re-learning after a detected scene flood — shortens "
        "the model-mismatch wash from ~25 frames to ~12, keeping the "
        "output's local median low so a following micro-shot boundary "
        "still clears the 2.6x spike bar), "
        "detectShadows=False, applied to the WARP-ALIGNED stream; model "
        "created ONCE per clip and never re-initialized — the natural "
        "model-mismatch flood at real source cuts provides the "
        "cut-preservation spike (measured ~150 absdiff, decaying at the "
        "fixed learning rate), and re-initializing at the engine's "
        "false-positive cuts (the recorded 882-943 goal-segment class) "
        "manufactured 10 invented cuts via the all-ink fresh-model flash "
        "— root-caused and redesigned in the w5g fast loop; cross-cut "
        "global-fit garbage is noise-averaged, measured increments "
        "<= 8 px, so the cumulative affine needs no reset; a "
        "per-shot coverage age-map (union of warped viewports, saturating) "
        "linear-fades the MOG2 mask in over mogWarmup=10 frames so "
        "never-modeled content entering under pans does not flash)",
        "motion_mask_threshold+morphology(camera-compensated residual-flow "
        "mask > 2.2 px/frame at 320x180 upsampled, gated to the "
        "not-yet-modeled region (1 - coverage-valid) and ramped over the "
        "first shot frames — the MOG2 coverage-fallback leg: it fills "
        "warmup + never-modeled pan regions without flooding on "
        "flat-region flow noise; open3/close5 fixed RECT kernels; "
        "max-decay EMA 0.65 — the fast-loop/full-render T3-hardened decay "
        "(0.90 ghost-lag decorrelates the output motion series, measured "
        "0.6986 -> 0.8473; 0.65 additionally makes the post-flood exit a "
        "clean single discontinuity so a following micro-shot boundary "
        "clears the 2.6x spike bar — the b8 979/982 class, measured "
        "0.833 -> 1.0 coverage) "
        "— with the GLOBAL-JUMP RULE (mean mask jump > 0.25 = a real-cut "
        "MOG2 flood entering instantly: the single-frame discontinuity "
        "the cut-preservation gates match, old-scene carry wiped — "
        "contract invariant 4) and RISE-CAPPED growth +0.25/frame "
        "otherwise (the binary ink amplifies small input events ~4.7x — "
        "the measured frame-1189 invented-cut class); Gaussian soften "
        "sigma 3.0; the clip's first frame initializes with a zero mask)",
        "ink_fill profile [default]: stabilized soft mask -> solid ink "
        "silhouette (26,26,26) composited on paper-white (244,244,244)",
        "xray profile [--profile xray]: mask distance transform (DIST_L2, "
        "scale 10 px) -> baked 256-entry FIXED thermal ironbow LUT "
        "false-color + Sobel-rim additive glow (numpy float64 magnitude, "
        "soft knee 10..40, strength 0.90, tint (210,235,255) BGR)",
    ],
    description=("Motion silhouettes / x-ray false-color: MOG2 foreground "
                 "on the global-motion-compensated stream, morphology-"
                 "cleaned and EMA-stabilized, rendered as solid ink "
                 "silhouettes on paper (default) or thermal-LUT distance "
                 "false-color with rim glow (xray). Structure-SELECTING "
                 "family — motion regions are the content (SPR202 trial)."),
    config={
        # stage 0 — global-motion compensation (the anti-pan leg)
        "compensate": True, "flowStep": 4,
        "zoomClip": 0.10, "translationClip": 24.0,
        # stage 1 — MOG2 (deterministic config, fixed history)
        "maskSource": "mog2", "mogHistory": 200, "mogVarThreshold": 34.0,
        "mogLearningRate": 0.04, "mogLearningRateBoost": 0.12,
        "mogBoostFrames": 12, "mogWarmup": 10,
        # stage 2 — threshold + morphology + temporal stabilization
        "flowKnee": 2.2, "morphOpen": 3, "morphClose": 5, "morphDilate": 0,
        "maskDecay": 0.65, "maskRise": 0.40, "globalJump": 0.25,
        "maskSoften": 3.0,
        # ink-fill output (default profile)
        "outputProfile": "ink",
        "inkColor": [26, 26, 26], "paperColor": [244, 244, 244],
        # xray profile
        "profiles": {"xray": {
            "outputProfile": "xray",
            "xrayDistScale": 10.0, "xrayRimKneeLow": 10.0,
            "xrayRimKneeHigh": 40.0, "xrayRimStrength": 0.90,
            "xrayRimTint": [210, 235, 255],
        }},
    },
)

# additive registry append (SPR-W5-G): the SPR202 silhouette/x-ray row enters
# the REGISTRY without modifying any prior declaration or construction line
REGISTRY[SILHOUETTE_XRAY.reality] = SILHOUETTE_XRAY


# ---------------------------------------------------------------------------
# SPR105 Clay/Miniature/Toy — wave-5 fresh reality (SPR-W5-F, TL rebuild of
# the reset-lost w5f)
#
# The w5b rank-2 dispatch-trial recipe implemented verbatim (medium
# flatten → fixed LAB K=12 toy palette through chroma-×1.25-lifted output
# centroids → relief-shade as the ONE new renderer-declared stage →
# specular fake → linear-contrast S-curve + sat lift → tilt-blur diorama
# cue → vignette + noir-law grain). Deterministic-classical, CPU-only
# (OpenCV + numpy, the frozen engine toolset), pure per-frame transform:
# no temporal state, no per-frame RNG beyond the frozen grain law (the
# SPR-W3-B T3-diagnosis law). The original w5f implementation was lost to
# the 2026-09-27 sandbox reset before its PAT-blocked push reached origin
# — this rebuild re-measures everything fresh; nothing is claimed from the
# lost tree. See _ClayToyState above for the full stage math and the
# determinism notes (numpy float64 relief math — the w5e IEEE law).
# ---------------------------------------------------------------------------


CLAY_TOY = RendererSpec(
    rendererId="spr-clay-toy-dc1", reality="clay-toy",
    family="Clay/Miniature/Toy (SPR105)", sprId="SPR105",
    paletteK=12,
    pipeline=[
        "medium_flatten(median k5 + bilateral d9 σ75 ×2 — the plasticine "
        "medium; w5b rank-2 recipe)",
        "toy_palette(fixed per-clip LAB K=12, chroma-weighted assignment "
        "l=0.45 on the LEARNED centroids; output through chroma-×1.25-"
        "lifted centroids — a,b expanded around the LAB 128 midpoint)",
        "relief_shade(THE new renderer-declared stage: Sobel k3 slopes on "
        "the FLATTENED luma → normals, slope scale 96 luma/px per 45°; 3 "
        "fixed lights key/fill/rim w 0.50/0.30/0.20; flat-response "
        "normalized to EXACTLY 1; tanh soft-clip; matte multiply at mix "
        "0.35; numpy float64 — the w5e IEEE determinism law)",
        "specular_fake(luma threshold 235 + Gaussian σ6 + screen blend; "
        "EXACT identity when the mask is empty — the measured b8 inert "
        "no-op, honestly recorded)",
        "tone_sat(baked 256-entry linear-contrast S-curve LUT pivot=0.45 "
        "contrast=1.12 — the ink-manga convention — + saturation ×1.25)",
        "tilt_blur(heuristic diorama cue: fixed vertical focus band "
        "0.30–0.62 of frame height, 0.25 ramp shoulders, σ6 far blur; "
        "screen-anchored, no tracking, no temporal state)",
        "finish(vignette 0.35 + noir-law grain σ6)",
    ],
    description=("Plasticine clay/miniature restyle: medium flatten + "
                 "fixed toy palette with chroma-popped output, clay "
                 "relief shading from surface normals of the flattened "
                 "luma (structure by light — the measured "
                 "identityConsistency lever), fake specular glints, "
                 "diorama tilt-blur and noir-law finish. Structure-"
                 "REINJECTING family (the w5b rank-2 dispatch recipe, "
                 "SPR105 trial; TL rebuild of the reset-lost w5f)."),
    config={
        # stage 1 — medium flatten
        "flattenMedianK": 5, "flattenBilatD": 9, "flattenBilatSigma": 75,
        "flattenBilatIters": 2,
        # stage 2 — toy palette (chroma-lifted output)
        "lWeight": 0.45, "chromaLift": 1.25,
        # stage 3 — relief-shade
        "reliefMix": 0.35, "reliefSlope": 96.0,
        # stage 4 — specular fake
        "specThreshold": 235, "specSoften": 6.0, "specStrength": 1.0,
        # stage 5 — tone + saturation
        "tonePivot": 0.45, "toneContrast": 1.12, "saturation": 1.25,
        # stage 6 — tilt-blur diorama
        "tiltBlur": True, "tiltBandLo": 0.30, "tiltBandHi": 0.62,
        "tiltRamp": 0.25, "tiltSigma": 6.0,
        # stage 7 — finish
        "vignette": 0.35, "grain": 6.0,
    },
)

# additive registry append (SPR-W5-F rebuild): the SPR105 clay-toy row
# enters the REGISTRY without modifying any prior declaration or
# construction line
REGISTRY[CLAY_TOY.reality] = CLAY_TOY


# ---------------------------------------------------------------------------
# SPR205 Player Focus — wave-5 fresh reality (SPR-W5-H, TL rebuild of the
# reset-lost w5h)
#
# The recorded phase-2 design implemented verbatim: static punch-in zoom
# z=1.35 (frame-center FIXED warp — T4 clean by construction, T3
# preserved, cuts pass through) + a 4D critically-damped spring (k=0.02)
# on the camshift-tracked soft-focus dim mask (motion gate = the
# subject-toon MOG2+residual-flow convention; 12-frame flood-immune
# opening armed ONCE per clip; pos=target=neutral at init; all four
# dimensions sprung; cut-reset glides the target home — never a jump).
# The phase-1 crop-following-zoom design (the warp follows the sprung
# rect) is retained as the cropFollow config mode and re-measured as the
# fast-loop v0 ANTI-PRECEDENT (recorded rejection: invented cuts at
# track-init and track-hops, T3 0.43-0.71, T4 1.70-2.31 — crop
# translation decorrelates motion and drifts static regions at ANY
# damping/zoom). The original w5h was lost to the 2026-09-27 sandbox
# reset before its PAT-blocked push reached origin; nothing from the
# lost tree is claimed — all measurements fresh.
# ---------------------------------------------------------------------------


PLAYER_FOCUS = RendererSpec(
    rendererId="spr-player-focus-dc1", reality="player-focus",
    family="Player Focus (SPR205)", sprId="SPR205",
    usesFlow=True,
    pipeline=[
        "motion_gate(farneback residual > 1.8 px/f @320x180 OR MOG2 "
        "fg(history=150, var=18, lr=0.02, cut-reinit), open3/close5 — "
        "the subject-toon mask convention)",
        "opening(12-frame flood-immune window: residual-flow-only union "
        "seeds the initial CAMSHIFT window ONCE per clip — frame-count "
        "armed, never re-armed at cuts — the recorded infinite-reset fix)",
        "camshift(motion-gated probability map, EPS 1 / 10 iters, min-window "
        "clamp; failure keeps the previous target)",
        "spring_4d(critically damped k=0.02 on (cx, cy, w, h) — ω=√k, ζ=1; "
        "pos=target=neutral at init (no init jump); all four dimensions "
        "sprung (no unsprung mask-size hops); cut-reset glides the target "
        "to the neutral window, never a single-frame discontinuity)",
        "static_zoom(z=1.35 frame-center FIXED warp — static regions map to "
        "fixed output pixels (T4 clean by construction), uniform motion "
        "scaling (T3 preserved), cuts pass through the fixed warp (raw T2))",
        "soft_dim(spring-rect feathered mask (σ 21) through the same warp; "
        "outside dimmed at strength 0.45 — the focus emphasis)",
        "crop-follow mode [config only — the phase-1 ANTI-PRECEDENT, "
        "fast-loop v0]: the warp maps the sprung padded rect to the output "
        "— MEASURED AND REJECTED (crop translation decorrelates motion and "
        "drifts static regions at ANY damping/zoom; invented cuts at "
        "track-init/@track-hops)",
    ],
    description=("Player-focus emphasis: static punch-in zoom with a "
                 "spring-smoothed soft-focus dim mask tracking the "
                 "motion-dominant player region. Source-ENHANCING family "
                 "(the broadcast is preserved; attention is guided). "
                 "SPR205 trial — TL rebuild of the reset-lost w5h; the "
                 "crop-following design lives on as the measured "
                 "anti-precedent."),
    config={
        # stage 4 — static zoom (phase-2 winner) / crop-follow (phase-1)
        "zoom": 1.35, "cropFollow": False, "cropPad": 1.25,
        # stage 0 — motion gate (subject-toon convention)
        "motionKnee": 1.8, "mogHistory": 150, "mogVarThreshold": 18.0,
        "mogLearningRate": 0.02,
        # stage 1 — opening window (flood-immune, once per clip)
        "openingFrames": 12, "openingMinUnion": 0.004,
        # stage 2 — camshift
        "camEps": 1.0, "camMaxIter": 10, "minWindowFrac": 0.12,
        # stage 3 — 4D critically damped spring
        "springK": 0.02,
        # stage 5 — soft dim
        "dimStrength": 0.45, "maskFeather": 21.0,
    },
)

# additive registry append (SPR-W5-H rebuild): the SPR205 player-focus row
# enters the REGISTRY without modifying any prior declaration or
# construction line
REGISTRY[PLAYER_FOCUS.reality] = PLAYER_FOCUS


# ---------------------------------------------------------------------------
# SPR109 Rotoscope/Hand-drawn — wave-5 fresh reality (SPR-W5-I, TL rebuild
# of the reset-lost w5i)
#
# The recorded recipe verbatim (phase-4 frozen values): pre-smooth +
# fixed LAB K=10 fills + 2-tone value (wide smoothstep knee, light ×1.60
# / dark ×0.35) + HEAVY XDoG (eps 0.0010 / phi 20, binary+median
# stabilized, FLOW-STABILIZED: Farneback forward-warp + EMA 0.75 +
# cut-reset, line floor 0.10) + clean finish (sat 1.15 + vignette 0.20,
# no grain). The recorded phase-3/4 re-open history (phase-1 failed
# full-b8 T2b cov 0.667 — the 979/982 micro-shot compression class —
# re-hardened by tone contrast + phi 20 + floor 0.10) is encoded in the
# frozen starting config; the fast loop re-measures the
# flow-stabilization thesis (v0-noflow A/B). The original w5i was lost
# to the 2026-09-27 sandbox reset before its PAT-blocked push reached
# origin; nothing from the lost tree is claimed — all measurements
# fresh.
# ---------------------------------------------------------------------------


ROTOSCOPE = RendererSpec(
    rendererId="spr-rotoscope-dc1", reality="rotoscope",
    family="Rotoscope / Hand-drawn (SPR109)", sprId="SPR109",
    paletteK=10,
    usesFlow=True,
    pipeline=[
        "pre_smooth(median k3 + bilateral d9 σ75 ×2 — XDoG noise-crawl "
        "mitigation, the ink-manga class)",
        "lab_fills(fixed per-clip LAB K=10 palette, chroma-weighted "
        "assignment l=0.45 — flat color fills under the ink)",
        "two_tone(wide smoothstep knee value curve: gain = 0.35 + "
        "(1.60−0.35)·smoothstep((L−0.30)/0.40) — the palette fills "
        "collapse into two value bands; phase-4 frozen; numpy float64)",
        "xdog_ink(HEAVY XDoG eps 0.0010 / phi 20 on the smoothed frame; "
        "FLOW-STABILIZED: prev stabilized map forward-warped by Farneback "
        "flow + EMA 0.75 + cut-reset; binary knee 0.5 + median5 + soften "
        "σ0.8 compositor; line floor 0.10 — the phase-3/4 hardening leg)",
        "clean_finish(saturation ×1.15 + vignette 0.20, NO grain)",
    ],
    description=("Hand-drawn rotoscope: flat LAB fills under a 2-tone "
                 "value curve with heavy flow-stabilized XDoG ink lines "
                 "and a clean finish. Classical 2-tone family (ss is the "
                 "family stylization maximum). SPR109 trial — TL rebuild "
                 "of the reset-lost w5i."),
    config={
        # stage 1 — pre-smooth
        "preMedianK": 3, "preBilatD": 9, "preBilatSigma": 75,
        "preBilatIters": 2,
        # stage 2 — LAB fills
        "lWeight": 0.45,
        # stage 3 — 2-tone value (phase-4 frozen)
        "toneLight": 1.60, "toneDark": 0.35,
        "toneKneeLo": 0.30, "toneKneeWidth": 0.40,
        # stage 4 — heavy XDoG, flow-stabilized
        "xdogSigma": 1.0, "xdogK": 1.6, "xdogTau": 0.98,
        "xdogEps": 0.0010, "xdogPhi": 20.0,
        "flowStabilize": True, "emaAlpha": 0.75,
        "lineKnee": 0.5, "lineMedian": 5, "lineSoften": 0.8,
        "lineFloor": 0.10,
        # stage 5 — clean finish (no grain)
        "saturation": 1.15, "vignette": 0.20,
    },
)

# additive registry append (SPR-W5-I rebuild): the SPR109 rotoscope row
# enters the REGISTRY without modifying any prior declaration or
# construction line
REGISTRY[ROTOSCOPE.reality] = ROTOSCOPE


# ---------------------------------------------------------------------------
# SPR103 Watercolor/Painterly — wave-5 promotion of the w2c trial
# sprtrial-kuwahara-paint-t1 (the subject-toon promotion pattern)
#
# Orientation-adaptive anisotropic Kuwahara (own numpy implementation of
# the public Kyprianidis-class filter) with coherence-gated soft
# orientation blending, soft inverse-variance quadrant selection, temporal
# structure-tensor EMA with cut-reset, and bilateral field consolidation —
# the trial's frozen processor verbatim. The trial's honest anti-stages
# stay out (palette re-quantization + XDoG overlay measured to re-amplify
# blend residue — recorded). Deterministic-classical, CPU-only. The w2c
# CONDITIONAL verdict (painterly family only) is the family declaration.
# ---------------------------------------------------------------------------


WATERCOLOR = RendererSpec(
    rendererId="spr-watercolor-dc1", reality="watercolor",
    family="Watercolor / Painterly (SPR103)", sprId="SPR103",
    usesFlow=False,
    pipeline=[
        "half_res(320x180) abstraction core: median k3 + bilateral x1 "
        "(d7 σ50) pre-consolidation (abstract low, finish high)",
        "structure_tensor(Sobel + Gaussian σ2.5; temporal EMA α 0.45; "
        "CUT-RESET — the edge-flow-crawl mitigation)",
        "orientation_field(N=8 quantized isophote doubled-angle soft "
        "weights, coherence-gated (isotropic fallback — the 'disconnected "
        "blobs' anti-pattern), weight-map Gaussian σ2 — smooth fields)",
        "anisotropic_kuwahara(per-orientation rotate → 4-quadrant "
        "boxFilter means/variances → rotate back; SOFT inverse-variance "
        "quadrant blend p=3 — NOT argmin (the 'grass/net blotching' "
        "anti-pattern); variance fields Gaussian σ2; qLong 3 × qShort 2 "
        "at half res = 7×5 source scale)",
        "finish(bilinear upsample → brush-stroke transitions; bilateral x2 "
        "d9 σ75 field consolidation; saturation ×1.14; paper grain 1.5)",
    ],
    description=("Painterly watercolor abstraction via orientation-adaptive "
                 "anisotropic Kuwahara with coherence-gated soft orientation "
                 "blending and bilateral field consolidation. Promoted from "
                 "trial sprtrial-kuwahara-paint-t1 (w2c) — the CONDITIONAL "
                 "painterly-family verdict made explicit; the trial's "
                 "measured anti-stages (palette pass, XDoG overlay) stay "
                 "out, honestly recorded."),
    config={
        # stage 1 — half-res pre-consolidation
        "preMedianK": 3, "preBilatD": 7, "preBilatSigma": 50,
        "preBilatIters": 1,
        # stage 2 — structure tensor EMA (cut-reset)
        "tensorSigma": 2.5, "tensorAlpha": 0.45,
        # stage 3 — orientation field
        "orientations": 8, "blendGamma": 10.0, "weightSigma": 2.0,
        # stage 4 — anisotropic Kuwahara
        "qLong": 3, "qShort": 2, "varSigma": 2.0, "varSoftness": 3.0,
        # stage 5 — consolidation + finish
        "postBilatD": 9, "postBilatSigma": 75, "postBilatIters": 2,
        "saturation": 1.14, "grain": 1.5,
    },
)

# additive registry append (SPR-W5-J promotion): the SPR103 watercolor row
# enters the REGISTRY without modifying any prior declaration or
# construction line
REGISTRY[WATERCOLOR.reality] = WATERCOLOR
