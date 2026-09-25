#!/usr/bin/env python3
"""Analog G-T3 gate tool (Amendment A1, 2026-09-25, TL-approved) — ADDITIVE.

Implements the amended motion gate for ANALOG-SIMULATION profiles
(noir-retro profile vhs): the per-frame motion-energy series of BOTH the
source and the render are smoothed with a 0.2 s centered moving average
(the acceptance protocol's own temporal-pair granularity, TEMPORAL_DELTA_S
= 0.2 s) before the Pearson correlation. Digital realities keep the
per-frame G-T3 of the FROZEN qa_check.py; this tool never replaces,
patches, or imports-and-modifies that harness — the raw per-frame r is
reported side-by-side for honesty.

Series extraction is a faithful REIMPLEMENTATION of the frozen
qa_check.py math, read line-by-line from that file (not imported and not
altered):

  - frames read via cv2.VideoCapture, resized to (64, 36) with
    interpolation=cv2.INTER_AREA                      [qa_check.frames_at]
  - Farneback optical flow per consecutive gray pair with the exact frozen
    parameters (0.5, 3, 15, 3, 5, 1.2, 0); magnitude sqrt(dx^2 + dy^2)
    as float32                                        [qa_check.flow_mags]
  - motion energy[i] = mean of the magnitude map of frame i
                                                      [qa_check G-T3 block]

Equivalence obligation: perFrameT3.pearsonR below equals the frozen
qa_check.py G-T3 pearsonR on the same (source, render) pair — verified
side-by-side in scripts/evidence/spr-wave4-gate-amendment/ (b5/b6 analog
artifacts and the b7 motion-trails digital control).

Smoothing: window w = max(1, round(0.2 * fps)) frames (exactly 5 at the
corpus 25 fps), applied identically to BOTH series as a centered moving
average  np.convolve(x, np.ones(w) / w, mode="same")  (zero-padded edges).
This reproduces the W3B diagnosis reference values (b5 0.9661, b6 0.9594)
at the recorded 4-decimal precision.

Gate threshold: r >= 0.80 — the acceptance §1 G-T3 row, UNCHANGED by the
amendment (only the series is smoothed for analog-simulation profiles;
no threshold is lowered anywhere).

Usage:
  python3 qa_analog_t3.py --render <render.mp4> --source <source.mp4> \
      --out <out.json>

Exit codes: 0 = amended (smoothed) gate PASS; 1 = gate FAIL;
2 = input/error condition recorded honestly (no fabricated values).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys

import cv2
import numpy as np

FFPROBE = "/usr/bin/ffprobe"

# Acceptance protocol §1, G-T3 row: "Pearson r ... >= 0.80". Amendment A1
# smooths the SERIES for analog-simulation profiles; the threshold stands.
THRESHOLD = 0.80

# Amendment A1 window: 0.2 s — the protocol's own temporal-pair granularity.
WINDOW_SEC = 0.2

# Frozen extraction geometry (qa_check.py G-T3 block: ms = (64, 36)).
MOTION_SIZE = (64, 36)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def probe(path):
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-print_format", "json",
         "-show_format", "-show_streams", path],
        capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def video_info(path):
    """Frame count + fps, mirroring qa_check.py video_info (frozen math)."""
    meta = probe(path)
    v = next(s for s in meta["streams"] if s.get("codec_type") == "video")
    num, den = v["r_frame_rate"].split("/")
    return {
        "frameCount": int(v.get("nb_frames", 0)),
        "fps": float(num) / float(den),
    }


def frames_at(path, size):
    """cv2.VideoCapture read loop + INTER_AREA resize [qa_check.frames_at]."""
    cap = cv2.VideoCapture(path)
    frames = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(cv2.resize(f, size, interpolation=cv2.INTER_AREA))
    cap.release()
    return frames


def flow_mags(frames):
    """Per-frame Farneback magnitude maps [qa_check.flow_mags], verbatim
    parameters (0.5, 3, 15, 3, 5, 1.2, 0); first frame gets a zero map."""
    mags = []
    prev = None
    for f in frames:
        g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
        if prev is None:
            mags.append(np.zeros(g.shape, np.float32))
        else:
            fl = cv2.calcOpticalFlowFarneback(prev, g, None, 0.5, 3, 15, 3, 5, 1.2, 0)
            mags.append(np.sqrt(fl[..., 0] ** 2 + fl[..., 1] ** 2).astype(np.float32))
        prev = g
    return mags


def motion_energy_series(path):
    """Per-frame motion-energy series — the frozen qa_check.py G-T3 series:
    mean of each 64x36 Farneback magnitude map, in decode order."""
    mags = flow_mags(frames_at(path, MOTION_SIZE))
    return np.array([m.mean() for m in mags], dtype=np.float64)


def centered_moving_average(x, w):
    """0.2 s centered moving average (Amendment A1): np.convolve with a
    uniform kernel of w frames, mode='same' (edges zero-padded). Applied
    identically to BOTH series; reproduces the W3B diagnosis values
    (b5 0.9661 / b6 0.9594) at the recorded precision."""
    return np.convolve(x, np.ones(w) / w, mode="same")


def pearson_r(a, b):
    if len(a) != len(b) or len(a) < 2:
        return None
    return float(np.corrcoef(a, b)[0, 1])


def main():
    ap = argparse.ArgumentParser(
        description="Analog G-T3 (Amendment A1): 0.2 s moving-average "
                    "smoothed Pearson motion correlation, additive to the "
                    "frozen per-frame G-T3 (both reported side-by-side).")
    ap.add_argument("--render", required=True, help="rendered/stylized mp4")
    ap.add_argument("--source", required=True, help="source broadcast mp4")
    ap.add_argument("--out", required=True, help="output JSON path")
    args = ap.parse_args()

    vi, vo = video_info(args.source), video_info(args.render)
    fps = vi["fps"]
    window_frames = max(1, int(round(WINDOW_SEC * fps)))

    ei = motion_energy_series(args.source)
    eo = motion_energy_series(args.render)

    result = {
        "tool": "scripts/source-preserving/qa_analog_t3.py",
        "amendment": "A1 (2026-09-25, TL-approved): analog-simulation "
                     "profiles gate T3 on the 0.2 s moving-average smoothed "
                     "motion series; digital realities keep per-frame G-T3 "
                     "(qa_check.py, frozen); both reported side-by-side.",
        "source": args.source,
        "render": args.render,
        "sourceSha256": sha256_file(args.source),
        "renderSha256": sha256_file(args.render),
        "fps": fps,
        "frames": {"source": int(len(ei)), "render": int(len(eo)),
                   "sourceContainer": vi["frameCount"],
                   "renderContainer": vo["frameCount"]},
        "extraction": {
            "reimplementedFrom": "scripts/source-preserving/qa_check.py "
                                 "(frozen; read, never modified)",
            "method": "frames_at((64,36), cv2.INTER_AREA) -> Farneback "
                      "(0.5, 3, 15, 3, 5, 1.2, 0) magnitudes -> per-frame "
                      "mean motion energy",
            "equivalence": "perFrameT3.pearsonR is computed by the identical "
                           "math as the frozen qa_check.py G-T3 on the same "
                           "pair (side-by-side verification recorded in "
                           "scripts/evidence/spr-wave4-gate-amendment/)",
        },
        "analogT3": None,
        "perFrameT3": None,
        "series": {
            "source": [round(float(v), 6) for v in ei],
            "render": [round(float(v), 6) for v in eo],
        },
    }

    exit_code = 2  # honest-negative default until metrics actually compute

    r_raw = pearson_r(ei, eo)
    if r_raw is not None:
        result["perFrameT3"] = {
            "r": round(r_raw, 4),
            "method": "Pearson r of the raw per-frame motion-energy series "
                      "(identical math to frozen qa_check.py G-T3)",
            "threshold": THRESHOLD,
            "pass": bool(r_raw >= THRESHOLD),
        }
        si = centered_moving_average(ei, window_frames)
        so = centered_moving_average(eo, window_frames)
        r_sm = pearson_r(si, so)
        if r_sm is not None:
            result["analogT3"] = {
                "r": round(r_sm, 4),
                "windowSec": WINDOW_SEC,
                "windowFrames": window_frames,
                "method": "0.2 s centered moving average on BOTH series "
                          "(np.convolve(x, ones(w)/w, mode='same', "
                          "zero-padded edges); w = round(0.2*fps) frames, "
                          "5 at 25 fps), then Pearson r",
                "threshold": THRESHOLD,
                "pass": bool(r_sm >= THRESHOLD),
            }
            exit_code = 0 if r_sm >= THRESHOLD else 1
    else:
        result["error"] = ("motion-energy series length mismatch or "
                           "degenerate input: source %d vs render %d frames"
                           % (len(ei), len(eo)))

    txt = json.dumps(result, indent=2)
    with open(args.out, "w") as f:
        f.write(txt + "\n")
    print(txt)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
