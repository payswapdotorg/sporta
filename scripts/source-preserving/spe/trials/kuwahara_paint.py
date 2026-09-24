"""Trial candidate A — `kuwahara-paint` (anisotropic Kuwahara, SPR103 upgrade).

yaml selection (docs/technology/source-preserving-candidates.yaml):

  - id `spr103.det.kuwahara-aniso`:
      technology: "anisotropic Kuwahara filter (Kyprianidis 2009, published for
                   images AND video) implemented in numpy over flow-aligned windows"
      license: "algorithm-public (paper) … own numpy implementation; TD port GPL-3
                (do not copy)"                      -> own implementation, clean
      runtime: { cpu: true, gpu: false }             -> CPU-only
      quality: "painterly abstraction with edge preservation; anisotropic variant
                avoids classic-Kuwahara clustering artifacts"
      temporal_consistency: "good (deterministic; edge-flow crawl mitigated by
                temporal pre-smoothing)"             -> tensor EMA below
      failure_modes: ["over-abstraction of ball (small fast object)", "CPU cost"]
      classification: "preferred-implementation-candidate (wave-2 trial)"
      sandbox_feasibility: cpu-local-runnable
  - wave2 `w2.kuwahara-aniso-numpy` (rank 2): "biggest painterly-quality jump with
      zero new dependencies … trial: budget-test on b12 first (heaviest
      deterministic stage)"                          -> this module IS that trial.

Implementation (own numpy/OpenCV, nothing copied from GPL ports):

  1. Structure tensor (Sobel + Gaussian, temporally EMA-smoothed with cut-reset —
     the yaml's "temporal pre-smoothing" mitigation of edge-flow crawl).
  2. Per-pixel isophote orientation quantized to N=8 angles (doubled-angle
     argmax — no atan2 branch instability).
  3. For each quantized orientation: rotate the frame (deterministic
     getRotationMatrix2D + BORDER_REPLICATE), run a 4-quadrant anisotropic
     Kuwahara (quadrant mean selection by luma variance, boxFilter-vectorized),
     rotate the result back.  Rotation semantics: getRotationMatrix2D(center,
     +deg) maps content at algebraic angle deg onto the x-axis, so the quantized
     isophote direction lands along x and the quadrant windows elongate ALONG
     the isophote (across-gradient width qShort, along-edge length qLong).
  4. Gather per-pixel the result of the orientation matching the local
     structure; finish with soft XDoG edge darkening, saturation lift, tiny
     deterministic paper grain.

Simplification vs. the full Kyprianidis filter (recorded honestly): fixed
eccentricity windows (no per-pixel coherence-adaptive ellipse sizes) — the
orientation adaptivity is what removes the classic-Kuwahara clustering
artifacts; per-pixel eccentricity modulation is a wave-3 refinement.

Deterministic: no RNG except the frozen `stages.grain` pattern (seeded by frame
index). Temporal state (tensor EMA) resets on detected cuts (contract §3.4).
"""

from __future__ import annotations

from typing import List, Optional

import cv2
import numpy as np

from .. import stages as S
from .common import TrialSpec, is_cut_start, merge_profile

_LUMA_W = np.array([0.114, 0.587, 0.299], dtype=np.float32)  # BGR -> BT.601 luma


class KuwaharaPaintProcessor:
    """Stateful streaming processor (tensor EMA + cut reset)."""

    def __init__(self, spec: TrialSpec, palette: Optional[np.ndarray],
                 cuts: List[int], profile: str):
        self.spec = spec
        self.profile = profile
        self.cfg = merge_profile(spec.config, profile)
        self.palette = palette
        self.cuts = set(cuts)
        self.frame_index = 0
        self.tensor_ema: Optional[np.ndarray] = None  # (H,W,3) Jxx,Jxy,Jyy
        self._rot_cache: dict = {}
    # -- structure tensor ----------------------------------------------------

    def _tensor(self, gray_f32: np.ndarray) -> np.ndarray:
        gx = cv2.Sobel(gray_f32, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(gray_f32, cv2.CV_32F, 0, 1, ksize=3)
        s = self.cfg["tensorSigma"]
        jxx = cv2.GaussianBlur(gx * gx, (0, 0), s)
        jxy = cv2.GaussianBlur(gx * gy, (0, 0), s)
        jyy = cv2.GaussianBlur(gy * gy, (0, 0), s)
        return np.stack([jxx, jxy, jyy], axis=-1)

    def _orientation_weights(self) -> np.ndarray:
        """Coherence-gated soft orientation weights (N,H,W), summing to 1.

        Isophote = gradient rotated 90 deg; its doubled-angle vector is
        (Jyy - Jxx, -2*Jxy).  Coherence coh = |v| / (Jxx+Jyy) in [0,1]
        (0 isotropic, 1 perfectly oriented).  Weights per quantized angle o:
            w_o = eps + clip(score_o, 0, 1)**gamma * coh**2
        In isotropic texture (grass/noise) the normalized direction vector is
        pure noise — WITHOUT the coherence gate the ^gamma weights degenerate
        into a random hard orientation pick per pixel, which rendered as the
        "disconnected blobs" in the v4 smoke test; with it, low-coherence
        regions fall back to a uniform (effectively isotropic) mix.  High-
        coherence regions get a soft argmax over the quantized isophote angle
        (mod-pi safe, branch-free).
        """
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
        n = self.cfg["orientations"]
        gamma = self.cfg["blendGamma"]
        wsm = self.cfg["weightSigma"]
        w = np.zeros((n, vx.shape[0], vx.shape[1]), dtype=np.float32)
        for o in range(n):
            a = 2.0 * np.pi * o / n
            score = (vx * np.float32(np.cos(a)) + vy * np.float32(np.sin(a))).astype(np.float32)
            w[o] = 1e-3 + np.clip(score, 0.0, 1.0) ** gamma * gate
        # spatially smooth the weight maps: per-pixel orientation switching
        # (even soft) leaves ghost boundaries where adjacent orientations mix
        # (v7 smoke: "double-exposure" on player limbs) — a smooth orientation
        # field is also what the tensor EMA provides temporally
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

    def _kuwahara_orientation(self, bgr_f32: np.ndarray, deg: float) -> np.ndarray:
        """4-quadrant anisotropic Kuwahara for one orientation (rotated back)."""
        c = self.cfg
        h, w = bgr_f32.shape[:2]
        if abs(deg) < 1e-9:
            r = bgr_f32
        else:
            m, _ = self._rot_pair(deg, bgr_f32.shape)
            r = cv2.warpAffine(bgr_f32, m, (w, h), flags=cv2.INTER_LINEAR,
                               borderMode=cv2.BORDER_REFLECT_101)
        ql, qs = c["qLong"], c["qShort"]
        ksize = (ql + 1, qs + 1)                 # (width=along isophote, height=across)
        anchors = [(0, 0), (ql, 0), (0, qs), (ql, qs)]  # (x,y): (+x,+y) (-x,+y) (+x,-y) (-x,-y)
        y_sq = (r @ _LUMA_W) ** 2
        means = []
        variances = []
        for (ax, ay) in anchors:
            mu = cv2.boxFilter(r, cv2.CV_32F, ksize, anchor=(ax, ay),
                               borderType=cv2.BORDER_REFLECT_101)     # (H,W,3)
            mu_y = mu @ _LUMA_W                                        # linear commutes
            mu_y2 = cv2.boxFilter(y_sq, cv2.CV_32F, ksize, anchor=(ax, ay),
                                  borderType=cv2.BORDER_REFLECT_101)
            means.append(mu)
            variances.append(np.maximum(mu_y2 - mu_y * mu_y, 0.0))
        # variance-field smoothing (small-quadrant variance estimates are
        # noise-dominated on broadcast texture)
        vs = c["varSigma"]
        v = np.stack([cv2.GaussianBlur(x, (0, 0), vs) for x in variances], axis=-1)
        # smooth quadrant combination (NOT argmin): a hard min-variance pick
        # switches between quadrant means and its switching boundaries render
        # as the persistent grass/net blotching (v6 smoke finding).  Soft
        # inverse-variance weights  w_q ~ exp(-p * var_q / (meanVar + eps))
        # give: flat/texture regions -> uniform (plain box average, smooth);
        # edges -> the clean-side quadrant dominates (edge preserved).
        p_soft = c["varSoftness"]
        vbar = v.mean(axis=-1, keepdims=True)                          # (H,W,1)
        wq = np.exp(-p_soft * v / (vbar + 1e-3))                       # (H,W,4)
        wq /= wq.sum(axis=-1, keepdims=True)
        mu = np.stack(means, axis=-1)                                  # (H,W,3,4)
        out = (mu * wq[..., None, :]).sum(axis=-1)                     # (H,W,3)
        out = np.ascontiguousarray(out)
        if abs(deg) < 1e-9:
            return out
        _, mi = self._rot_pair(deg, bgr_f32.shape)
        return cv2.warpAffine(out, mi, (w, h), flags=cv2.INTER_LINEAR,
                              borderMode=cv2.BORDER_REFLECT_101)

    # -- pipeline -------------------------------------------------------------

    def __call__(self, bgr: np.ndarray) -> np.ndarray:
        c = self.cfg
        cut = is_cut_start(self.frame_index, self.cuts)
        # half-resolution abstraction core (watercolor practice: abstract low,
        # finish high).  The quadrant-variance selector is noise-dominated at
        # full res on broadcast texture (v3 smoke: blotching); at half res the
        # same window covers 4x the source area, and the bilinear upsample
        # turns selection discontinuities into soft brush-stroke transitions.
        h, w = bgr.shape[:2]
        hw, hh = w // 2, h // 2
        base = cv2.resize(bgr, (hw, hh), interpolation=cv2.INTER_AREA)
        base = S.median_pool(base, c["preMedianK"])
        # pre-consolidation (v8 smoke: the 8 rotated cores alias the goal net
        # differently and their blend reads as ghosting/moire — flatten the
        # high-frequency texture BEFORE the orientation machinery so all
        # rotations see the same smooth fields)
        base = S.bilateral_flatten(base, c["preBilatD"], c["preBilatSigma"],
                                  c["preBilatSigma"], c["preBilatIters"])
        gray_f32 = cv2.cvtColor(base, cv2.COLOR_BGR2GRAY).astype(np.float32)
        t_now = self._tensor(gray_f32)
        if self.tensor_ema is None or cut:
            self.tensor_ema = t_now
        else:
            a = c["tensorAlpha"]
            self.tensor_ema = a * t_now + (1.0 - a) * self.tensor_ema

        wts = self._orientation_weights()                 # (N,h,w)
        n = c["orientations"]
        bgr_f32 = base.astype(np.float32)
        results = np.stack(
            [self._kuwahara_orientation(bgr_f32, float(o) * 180.0 / n)
             for o in range(n)], axis=0)                   # (N,h,w,3)
        out = np.einsum("nhwc,nhw->hwc", results, wts)    # soft orientation blend
        out_u8 = np.clip(out, 0, 255).astype(np.uint8)
        out_u8 = cv2.resize(out_u8, (w, h), interpolation=cv2.INTER_LINEAR)

        # painterly field consolidation at full res: gentle bilateral flattens
        # residual quadrant-selection discontinuities into brush-stroke fields
        # (v5 smoke: palette re-quantization on top of the Kuwahara re-introduced
        # net/grass blotching — dropped; the Kuwahara + bilateral carry the look)
        out_u8 = S.bilateral_flatten(out_u8, c["postBilatD"], c["postBilatSigma"],
                                    c["postBilatSigma"], c["postBilatIters"])
        # NOTE: no XDoG edge overlay and no palette pass in the frozen trial:
        # stage-isolation diagnostics (debug-montage.png) showed the XDoG
        # soft-threshold re-amplifies the residual 8-orientation blend residue
        # on the goal net into dark speckle "ghosting"; the clean painterly
        # rendition is the pre-consolidated Kuwahara + bilateral alone.
        out_u8 = S.saturation_lift(out_u8, c["saturation"])
        out_u8 = S.grain(out_u8, self.frame_index, c["grain"])

        self.frame_index += 1
        return out_u8


def _factory(spec: TrialSpec, palette, cuts, profile):
    return KuwaharaPaintProcessor(spec, palette, cuts, profile)


SPEC = TrialSpec(
    trialId="sprtrial-kuwahara-paint-t1",
    name="kuwahara-paint",
    reality="kuwahara-paint",
    family="Watercolor / Painterly (SPR103 wave-2 trial)",
    sprFamily="SPR103",
    candidateSource="spr103.det.kuwahara-aniso + w2.kuwahara-aniso-numpy (wave2 rank 2)",
    paletteK=None,
    usesFlow=False,
    pipeline=[
        "half-res(320x180) abstraction core: median_pool(3) + bilateral x1 "
        "(d=7 s=50) pre-consolidation + structure_tensor "
        "(sobel+gaussian sigma=2.5, temporal EMA alpha=0.45, cut-reset)",
        "isophote_orientation_quantized(N=8, doubled-angle soft-blend gamma=10, "
        "coherence-gated + weight-map gaussian sigma=2: smooth orientation fields)",
        "anisotropic_kuwahara(4-quadrant SOFT inverse-variance blend p=3, "
        "qLong=3 x qShort=2 at half res = 7x5 at source scale, variance fields "
        "gaussian-smoothed sigma=2.0, per-orientation rotate/rotate-back, "
        "BORDER_REFLECT_101)",
        "bilinear upsample to 640x360 (brush-stroke transitions)",
        "bilateral_flatten(2x d=9 s=75) field consolidation (no palette pass, no "
        "XDoG: stage-isolation diagnostics showed both re-amplify blend residue)",
        "saturation_lift(1.14)",
        "grain(1.5, frame-index-seeded)",
    ],
    description=("Painterly watercolor abstraction via orientation-adaptive "
                 "anisotropic Kuwahara (own numpy implementation of the public "
                 "Kyprianidis-class filter) with coherence-gated soft "
                 "orientation blending and bilateral field consolidation."),
    config={
        "orientations": 8,
        "blendGamma": 10.0,
        "preMedianK": 3,
        "qLong": 3, "qShort": 2,
        "varSigma": 2.0, "varSoftness": 3.0, "weightSigma": 2.0,
        "tensorSigma": 2.5, "tensorAlpha": 0.45,
        "preBilatD": 7, "preBilatSigma": 50, "preBilatIters": 1,
        "postBilatD": 9, "postBilatSigma": 75, "postBilatIters": 2,
        "lWeight": 0.45,
        "xdogSigma": 1.0, "xdogK": 1.6, "xdogTau": 0.98,
        "xdogEps": 0.010, "xdogPhi": 8.0,
        "lineFloor": 0.58,
        "saturation": 1.14,
        "grain": 1.5,
    },
    factory=_factory,
)
