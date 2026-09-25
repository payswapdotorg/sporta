#!/usr/bin/env python3
"""Goal-moment detection: full-match audio loudness envelope -> roar spikes.

Method (SPR-W3-C task packet item 1):
1. Decode the full itag-140-5 audio to mono PCM 16 kHz (ffmpeg).
2. RMS loudness envelope in 0.5 s windows (numpy).
3. Roar magnitude = peak RMS (dBFS) minus rolling local baseline (median over
   +-60 s) -> "excess loudness" — crowd roars stand above commentary baseline.
4. Top spikes with a minimum separation of 45 s -> candidate moments.
Output: roar-spikes.json (all candidates, honest even if empty).
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np

WORK = Path("/home/z/spr-w3c-work")
AUDIO = WORK / "audio-140-5.m4a"
SR = 16000
WIN = 0.5  # seconds per envelope sample
MIN_SEP = 45.0  # min separation between candidate moments


def envelope() -> np.ndarray:
    proc = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(AUDIO),
         "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
        capture_output=True, check=True, stdin=subprocess.DEVNULL,
    )
    pcm = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float64) / 32768.0
    n = int(SR * WIN)
    usable = (len(pcm) // n) * n
    frames = pcm[:usable].reshape(-1, n)
    rms = np.sqrt((frames ** 2).mean(axis=1) + 1e-12)
    db = 20.0 * np.log10(rms + 1e-12)
    return db


def rolling_median(x: np.ndarray, radius: int) -> np.ndarray:
    """Median over a centered window of half-width `radius` samples."""
    from numpy.lib.stride_tricks import sliding_window_view
    pad = np.pad(x, radius, mode="edge")
    return np.median(sliding_window_view(pad, 2 * radius + 1), axis=1)


def main() -> int:
    if not AUDIO.exists():
        print("audio file missing — pull did not complete", file=sys.stderr)
        return 1
    db = envelope()
    total = len(db) * WIN
    print(f"[goal] envelope: {len(db)} x {WIN}s = {total:.1f}s", file=sys.stderr)

    radius = int(60.0 / WIN)  # +-60 s baseline
    base = rolling_median(db, radius)
    excess = db - base

    # top candidate spikes: greedy max with min separation
    order = np.argsort(excess)[::-1]
    picked: list[dict] = []
    for idx in order:
        t = idx * WIN
        if t < 20 or t > total - 20:
            continue  # skip heads/tails (intro music, outro)
        if any(abs(t - p["tPeak"]) < MIN_SEP for p in picked):
            continue
        # roar magnitude: mean excess over the +-1.5 s around the peak
        lo = max(0, idx - 3)
        hi = min(len(excess), idx + 4)
        picked.append({
            "tPeak": round(t, 2),
            "peakDb": round(float(db[idx]), 2),
            "baselineDb": round(float(base[idx]), 2),
            "excessDb": round(float(excess[idx]), 2),
            "excessMean15": round(float(excess[lo:hi].mean()), 2),
        })
        if len(picked) >= 40:
            break

    picked.sort(key=lambda p: -p["excessMean15"])
    out = {
        "method": {
            "audio": "itag 140-5 full-match m4a (recorded recipe), mono 16 kHz PCM",
            "envelope": "RMS in 0.5 s windows (dBFS)",
            "baseline": "rolling median over +-60 s",
            "spikeMetric": "excess dB = envelope - baseline at peak; excessMean15 = mean excess over +-1.5 s",
            "selection": f"top by excessMean15, min separation {MIN_SEP}s, edges 20s excluded",
        },
        "audioDurationSec": round(total, 2),
        "candidates": picked,
    }
    (WORK / "roar-spikes.json").write_text(json.dumps(out, indent=1) + "\n")
    for p in picked[:25]:
        print(f"[goal] t={p['tPeak']:8.2f}  peak={p['peakDb']:7.2f} dB  "
              f"excess={p['excessDb']:6.2f}  mean15={p['excessMean15']:6.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
