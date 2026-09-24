"""SPE-v1 stage library — deterministic source-preserving transforms.

Every stage is pure/deterministic: same input bytes + same params -> same output
bytes. Randomness is only ever seeded by the frame index (grain) or by a fixed
seed (palette init). See docs/contracts/source-preserving-renderer.md.
"""

from __future__ import annotations

import subprocess
from typing import Callable, Iterable, Iterator, List, Sequence, Tuple

import cv2
import numpy as np

# ---------------------------------------------------------------------------
# analysis pass (downscaled)
# ---------------------------------------------------------------------------


def probe(path: str) -> dict:
    """ffprobe a media file -> {width,height,fps,frameCount,durationMs,hasAudio}."""
    out = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-count_frames", "-show_entries",
            "stream=width,height,r_frame_rate,nb_read_frames:format=duration",
            "-of", "json", path,
        ],
        capture_output=True, text=True, check=True,
    ).stdout
    import json

    j = json.loads(out)
    st = j["streams"][0]
    num, den = st["r_frame_rate"].split("/")
    fps = float(num) / float(den)
    aud = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
         "stream=codec_name", "-of", "csv=p=0", path],
        capture_output=True, text=True,
    ).stdout.strip()
    return {
        "width": int(st["width"]),
        "height": int(st["height"]),
        "fps": fps,
        "frameCount": int(st["nb_read_frames"]),
        "durationMs": round(float(j["format"]["duration"]) * 1000, 3),
        "hasAudio": bool(aud),
    }


def analyze(path: str, sample_every: int = 25, small: Tuple[int, int] = (320, 180),
            palette_px: Tuple[int, int] = (160, 90)) -> dict:
    """One downscaled decode pass: cut candidates + palette samples + frame count.

    Returns {frameCount, diffs, cuts, paletteSamples(list of LAB pixel blocks)}.
    """
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise RuntimeError(f"cannot open {path}")
    diffs: List[float] = []
    samples: List[np.ndarray] = []
    prev_gray = None
    i = 0
    sw, sh = small
    pw, ph = palette_px
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if i % sample_every == 0:
            small_pal = cv2.resize(frame, (pw, ph), interpolation=cv2.INTER_AREA)
            lab = cv2.cvtColor(small_pal, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)
            # subsample 2000 px per sampled frame, fixed stride (deterministic)
            samples.append(lab[:: max(1, len(lab) // 2000)])
        gray = cv2.cvtColor(
            cv2.resize(frame, (sw, sh), interpolation=cv2.INTER_AREA),
            cv2.COLOR_BGR2GRAY,
        )
        if prev_gray is not None:
            diffs.append(float(np.mean(cv2.absdiff(gray, prev_gray))))
        prev_gray = gray
        i += 1
    cap.release()
    cuts = detect_cuts(diffs)
    return {"frameCount": i, "diffs": diffs, "cuts": cuts, "paletteSamples": samples}


def detect_cuts(diffs: Sequence[float]) -> List[int]:
    """Cut frame indices (the NEW scene starts at index k+1 given diffs[k]).

    Broadcast cuts produce huge absdiff spikes vs ordinary motion. Threshold:
    robust floor 15 + a median-scaled term.
    """
    if not diffs:
        return []
    arr = np.array(diffs, dtype=np.float64)
    med = float(np.median(arr))
    thr = max(15.0, med * 4.0, float(np.percentile(arr, 90)) * 1.6)
    idx = list(np.where(arr > thr)[0])
    # suppress double-triggers within 6 frames of each other
    out: List[int] = []
    for k in idx:
        if out and k - out[-1] < 6:
            continue
        out.append(int(k))
    return out


# ---------------------------------------------------------------------------
# palette (fixed per clip -> temporal stability)
# ---------------------------------------------------------------------------


def learn_palette(samples: Sequence[np.ndarray], k: int, iters: int = 10,
                  seed: int = 1337, max_points: int = 100000,
                  l_weight: float = 0.45) -> np.ndarray:
    """Lloyd k-means in weighted LAB (chroma-weighted distance) with a fully
    deterministic init. Returns (k,3) centers in plain LAB."""
    pts = np.concatenate(list(samples), axis=0) if samples else np.zeros((k, 3), np.float32)
    if len(pts) > max_points:
        rng = np.random.default_rng(seed)
        pts = pts[rng.choice(len(pts), max_points, replace=False)]
    pts = np.ascontiguousarray(pts, dtype=np.float32)
    rng = np.random.default_rng(seed)
    centers = pts[rng.choice(len(pts), k, replace=False)].copy()
    w = np.array([l_weight, 1.0, 1.0], dtype=np.float32)
    for _ in range(iters):
        assign = np.empty(len(pts), dtype=np.int64)
        for s in range(0, len(pts), 20000):
            blk = (pts[s:s + 20000][:, None, :] - centers[None, :, :]) * w
            d = (blk ** 2).sum(-1)
            assign[s:s + 20000] = np.argmin(d, axis=1)
        for c in range(k):
            m = pts[assign == c]
            if len(m):
                centers[c] = m.mean(axis=0)
    return centers


def quantize_lab(bgr: np.ndarray, centers: np.ndarray, l_weight: float = 0.45,
                 return_idx: bool = False):
    """Nearest fixed-palette assignment in chroma-weighted LAB for one BGR frame.

    The chroma weighting (l<1) preserves kit/ball hues: luminance is allowed to
    drift toward the cluster, but a/b (hue) dominate the distance.
    """
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    fl = lab.reshape(-1, 3).astype(np.float32)
    idx = np.empty(len(fl), dtype=np.int64)
    w = np.array([l_weight, 1.0, 1.0], dtype=np.float32)
    for s in range(0, len(fl), 40000):
        blk = (fl[s:s + 40000][:, None, :] - centers[None, :, :]) * w
        d = (blk ** 2).sum(-1)
        idx[s:s + 40000] = np.argmin(d, axis=1)
    out = centers[idx].reshape(lab.shape).astype(np.uint8)
    bgr_out = cv2.cvtColor(out, cv2.COLOR_LAB2BGR)
    if return_idx:
        return bgr_out, idx.reshape(lab.shape[:2])
    return bgr_out


def smooth_regions(idx: np.ndarray, k: int, window: int = 5) -> np.ndarray:
    """Mode-filter the palette index map: absorbs sub-window regions (crowd
    speckle) so contour lines only trace substantial color regions."""
    h, w = idx.shape
    onehot = np.zeros((h, w, k), dtype=np.float32)
    for c in range(k):
        onehot[..., c] = (idx == c).astype(np.float32)
    for c in range(k):
        onehot[..., c] = cv2.boxFilter(onehot[..., c], -1, (window, window),
                                       normalize=True)
    return np.argmax(onehot, axis=2)


def recolor(idx: np.ndarray, centers: np.ndarray) -> np.ndarray:
    """Recolor from a consolidated region-index map -> truly flat BGR frame."""
    lab = centers[idx].astype(np.uint8)
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)


def boundary_edge_map(idx: np.ndarray, dilate: int = 1,
                      aa_sigma: float = 0.8) -> np.ndarray:
    """Cel contour lines: E in [0,1], E->0 along palette-region boundaries.

    Lines sit exactly where flat color regions meet — the classical ink contour
    of a cel drawing — and are temporally stable (fixed palette).
    """
    h, w = idx.shape
    edge = np.zeros((h, w), dtype=np.uint8)
    edge[:-1, :] |= (idx[:-1, :] != idx[1:, :]).astype(np.uint8)
    edge[:, :-1] |= (idx[:, :-1] != idx[:, 1:]).astype(np.uint8)
    if dilate:
        edge = cv2.dilate(edge, np.ones((dilate, dilate), np.uint8))
    e = (1.0 - edge.astype(np.float32))
    if aa_sigma:
        e = cv2.GaussianBlur(e, (0, 0), aa_sigma)
    return np.clip(e, 0.0, 1.0)


# ---------------------------------------------------------------------------
# per-frame stylization primitives
# ---------------------------------------------------------------------------


def bilateral_flatten(bgr: np.ndarray, d: int = 9, sigma_color: float = 75,
                      sigma_space: float = 75, iterations: int = 2) -> np.ndarray:
    out = bgr
    for _ in range(iterations):
        out = cv2.bilateralFilter(out, d, sigma_color, sigma_space)
    return out


def median_pool(bgr: np.ndarray, k: int = 5) -> np.ndarray:
    return cv2.medianBlur(bgr, k)


def xdog_edge_map(bgr: np.ndarray, sigma: float = 1.0, k: float = 1.6,
                  tau: float = 0.98, eps: float = 0.007, phi: float = 8.0) -> np.ndarray:
    """XDoG soft-threshold edge map E in [0,1]; E->0 on edges, 1 on flat areas."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    g1 = cv2.GaussianBlur(gray, (0, 0), sigma)
    g2 = cv2.GaussianBlur(gray, (0, 0), sigma * k)
    v = g1 - tau * g2
    e = np.where(v >= eps, 1.0, 1.0 + np.tanh(phi * (v / eps - 1.0)))
    return np.clip(e, 0.0, 1.0).astype(np.float32)


def edge_overlay(bgr: np.ndarray, edge_map: np.ndarray, line_floor: float = 0.18) -> np.ndarray:
    """Burn dark lines into the frame: multiply by a floored edge map."""
    e = line_floor + (1.0 - line_floor) * edge_map
    return np.clip(bgr.astype(np.float32) * e[..., None], 0, 255).astype(np.uint8)


def saturation_lift(bgr: np.ndarray, factor: float) -> np.ndarray:
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)
    s = np.clip(s.astype(np.float32) * factor, 0, 255).astype(np.uint8)
    return cv2.cvtColor(cv2.merge([h, s, v]), cv2.COLOR_HSV2BGR)


def desaturate(bgr: np.ndarray, keep: float) -> np.ndarray:
    if keep >= 1.0:
        return bgr
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    return np.clip(bgr.astype(np.float32) * keep + gray[..., None] * (1.0 - keep),
                   0, 255).astype(np.uint8)


def bloom(bgr: np.ndarray, threshold: float = 200, strength: float = 0.35,
          blur: int = 25) -> np.ndarray:
    v = bgr.max(axis=2)
    mask = (v > threshold).astype(np.float32)
    mask = cv2.GaussianBlur(mask, (blur, blur), 0)
    glow = cv2.GaussianBlur(bgr, (blur, blur), 0).astype(np.float32)
    base = bgr.astype(np.float32)
    # screen blend: 1-(1-a)(1-b)
    out = 255.0 - (255.0 - base) * (255.0 - glow * strength * mask[..., None]) / 255.0
    return np.clip(out, 0, 255).astype(np.uint8)


def grain(bgr: np.ndarray, frame_index: int, scale: float = 6.0) -> np.ndarray:
    rng = np.random.default_rng(1000 + frame_index)
    noise = rng.normal(0.0, scale, size=bgr.shape[:2]).astype(np.float32)
    out = bgr.astype(np.float32) + noise[..., None]
    return np.clip(out, 0, 255).astype(np.uint8)


def vignette_mask(w: int, h: int, strength: float = 0.35) -> np.ndarray:
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = w / 2.0, h / 2.0
    r = np.sqrt(((x - cx) / cx) ** 2 + ((y - cy) / cy) ** 2) / np.sqrt(2)
    return (1.0 - strength * (r ** 1.8)).astype(np.float32)


def apply_vignette(bgr: np.ndarray, mask: np.ndarray) -> np.ndarray:
    return np.clip(bgr.astype(np.float32) * mask[..., None], 0, 255).astype(np.uint8)


def tone_lut(curve: Callable[[np.ndarray], np.ndarray]) -> Callable[[np.ndarray], np.ndarray]:
    lut = np.clip(curve(np.arange(256, dtype=np.float32)), 0, 255).astype(np.uint8)
    return lambda bgr: cv2.LUT(bgr, lut)


NOIR_CURVE = lambda x: 255.0 * (0.5 + 0.5 * np.tanh(2.1 * (x / 255.0 - 0.52)))


def vhs_artifacts(bgr: np.ndarray, frame_index: int,
                  chroma_shift: Tuple[int, int] = (2, 1),
                  scanline_dark: float = 0.12,
                  jitter_max: int = 2) -> np.ndarray:
    ycc = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb)
    y, cr, cb = cv2.split(ycc)
    # chroma shift
    cr = np.roll(cr, chroma_shift, axis=(0, 1))
    cb = np.roll(cb, chroma_shift, axis=(0, 1))
    ycc = cv2.merge([y, cr, cb])
    out = cv2.cvtColor(ycc, cv2.COLOR_YCrCb2BGR)
    # scanlines
    out[1::2] = np.clip(out[1::2].astype(np.float32) * (1.0 - scanline_dark),
                        0, 255).astype(np.uint8)
    # deterministic horizontal jitter
    rng = np.random.default_rng(2000 + frame_index)
    dx = int(rng.integers(-jitter_max, jitter_max + 1))
    out = np.roll(out, dx, axis=1)
    # occasional noise band
    if frame_index % 97 == 0:
        row = int(rng.integers(4, out.shape[0] - 8))
        band = rng.normal(0, 18, size=(6, out.shape[1], 1)).astype(np.float32)
        seg = out[row:row + 6].astype(np.float32) + band
        out[row:row + 6] = np.clip(seg, 0, 255).astype(np.uint8)
    return out


# ---------------------------------------------------------------------------
# flow + trails
# ---------------------------------------------------------------------------


def flow_magnitude(gray_prev_small: np.ndarray, gray_small: np.ndarray) -> np.ndarray:
    """Camera-compensated (translation + zoom) relative motion magnitude.

    Global camera motion is fitted as u = tx + s*(x-cx), v = ty + s*(y-cy) via
    least squares over the flow field (deterministic); the residual is the
    subject motion (players/ball) that trails should visualize.
    """
    h, w = gray_small.shape
    flow = cv2.calcOpticalFlowFarneback(
        gray_prev_small, gray_small, None, 0.5, 3, 15, 3, 5, 1.2, 0,
    )
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    xs = (xs - w / 2.0) / (w / 2.0)
    ys = (ys - h / 2.0) / (h / 2.0)
    step = 4  # subsample for the LSQ fit (deterministic stride)
    us = flow[..., 0][::step, ::step].ravel()
    vs = flow[..., 1][::step, ::step].ravel()
    xs_ = xs[::step, ::step].ravel()
    ys_ = ys[::step, ::step].ravel()
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
    tx, ty, sx, sy = sol
    u_comp = flow[..., 0] - (tx + sx * xs)
    v_comp = flow[..., 1] - (ty + sy * ys)
    mag = np.sqrt(u_comp ** 2 + v_comp ** 2).astype(np.float32)
    return cv2.medianBlur(mag, 3)  # kill isolated texture noise


TRAIL_COLORMAP = cv2.COLORMAP_TURBO


def trail_blend(base_bgr: np.ndarray, energy_small: np.ndarray,
                decay: float = 0.88, t0: float = 1.2, t1: float = 6.0,
                strength: float = 0.55) -> np.ndarray:
    """energy_small: accumulated motion energy at the small resolution.

    t0/t1 form a soft knee: below t0 (texture-noise floor) no trail; t1+ saturates.
    """
    e = cv2.resize(energy_small, (base_bgr.shape[1], base_bgr.shape[0]),
                   interpolation=cv2.INTER_LINEAR)
    vis = np.clip((e - t0) / max(t1 - t0, 1e-3), 0.0, 1.0) ** 0.65
    vis[vis < 0.28] = 0.0  # hard floor: static areas stay EXACTLY the base
    vis8 = ((0.35 + 0.65 * vis) * 255).astype(np.uint8)
    colored = cv2.applyColorMap(vis8, TRAIL_COLORMAP).astype(np.float32)
    a = (strength * vis)[..., None]
    b = base_bgr.astype(np.float32)
    out = b * (1.0 - a) + colored * a
    return np.clip(out, 0, 255).astype(np.uint8)
