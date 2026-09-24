"""Shared infrastructure for the SPR-W2-C trial modules (Lane C write surface).

`TrialSpec` mirrors the attribute surface of the frozen `RendererSpec` that the
contract provenance writer consumes (rendererId / version / implementation /
engine / pipeline / config), so trial renders produce contract-shaped
provenance WITHOUT registering anything in the frozen REGISTRY.

`analyze_window` is a bounded replica of `spe.stages.analyze`: identical logic
(cut diffs on 320x180 gray, palette samples every 25th frame at 160x90 LAB with
the fixed-stride subsample), but reading at most `max_frames` frames so that a
window-bounded trial render (e.g. b8 --max-frames 300) depends ONLY on the
rendered window, not on the remainder of the source clip.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, List, Optional

import cv2
import numpy as np

from .. import stages as S


@dataclass
class TrialSpec:
    """Declaration of one trial candidate (contract-shaped, non-registry)."""

    trialId: str                 # e.g. "sprtrial-kuwahara-paint-t1" (never a frozen id)
    name: str                    # CLI key, e.g. "kuwahara-paint"
    reality: str                 # trial reality key == name
    family: str                  # human family name (trial context)
    sprFamily: str               # SPR family this trial upgrades (yaml family id)
    candidateSource: str         # yaml candidate id(s) justifying the selection
    version: str = "0.1.0-trial"
    engine: str = "SPE-v1"
    implementation: str = "deterministic-classical-trial"
    profiles: List[str] = field(default_factory=lambda: ["default"])
    paletteK: Optional[int] = None
    usesFlow: bool = False
    pipeline: List[str] = field(default_factory=list)
    description: str = ""
    config: dict = field(default_factory=dict)
    factory: Optional[Callable] = None  # factory(spec, palette, cuts, profile) -> processor

    def make_processor(self, palette: Optional[np.ndarray], cuts: List[int],
                       profile: str = "default"):
        assert self.factory is not None
        return self.factory(self, palette, cuts, profile)

    @property
    def rendererId(self) -> str:
        """Contract-provenance alias (spe.provenance.write_provenance reads it);
        carries the `sprtrial-` prefix so it can never collide with a frozen
        registry id."""
        return self.trialId


def analyze_window(path: str, max_frames: Optional[int] = None,
                   sample_every: int = 25, small=(320, 180),
                   palette_px=(160, 90)) -> dict:
    """Bounded `spe.stages.analyze` replica (see module docstring).

    Returns {frameCount, diffs, cuts, paletteSamples} for the first
    `max_frames` frames (or the whole clip when None).
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
        if max_frames is not None and i >= max_frames:
            break
        if i % sample_every == 0:
            small_pal = cv2.resize(frame, (pw, ph), interpolation=cv2.INTER_AREA)
            lab = cv2.cvtColor(small_pal, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)
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
    cuts = S.detect_cuts(diffs)
    return {"frameCount": i, "diffs": diffs, "cuts": cuts, "paletteSamples": samples}


def gray_small(bgr: np.ndarray, size=(320, 180)) -> np.ndarray:
    """Downscaled gray (FrameProcessor-compatible helper)."""
    small = cv2.resize(bgr, size, interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)


def is_cut_start(frame_index: int, cuts: set) -> bool:
    """Cut at diffs index k means frame k+1 starts a new scene (frozen convention)."""
    return (frame_index - 1) in cuts


def merge_profile(cfg: dict, profile: str) -> dict:
    out = dict(cfg)
    if profile in cfg.get("profiles", {}):
        out.update(cfg["profiles"][profile])
    return out
