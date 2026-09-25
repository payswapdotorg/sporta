#!/usr/bin/env python3
"""Build w2a-format 4x5 timestamped grids from a window TS (seek-free).

Replicates the w2a grid evidence format exactly:
- 4 columns x 5 rows of cells, each cell 320x206:
  26px black label strip ("media t= X.Xs (+ Y.Ys)" + cell number
  top-right, white text) above the 320x180 frame
- 1 fps frames extracted seek-free from the raw concatenated TS
- 20 cells per grid image, cells numbered 1-20 left-to-right, top-to-bottom

Usage: grid.py <window.ts> <trueStart> <outprefix> [--max-grids N]
Writes <outprefix>_g1.jpg ... + <outprefix>-grids.json (cell->mediaTime map)
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

COLS, ROWS = 4, 5
CELL_W, CELL_H = 320, 206
FRAME_W, FRAME_H = 320, 180
STRIP_H = 26
GAP = 2
FONT = cv2.FONT_HERSHEY_SIMPLEX


def build_grids(ts: Path, true_start: float, outprefix: Path, max_grids: int | None) -> None:
    tmp = Path(tempfile.mkdtemp(prefix="gridframes-"))
    try:
        # seek-free full sequential decode + fps=1 (the w2a canonical method)
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(ts),
             "-vf", "fps=1", str(tmp / "f_%04d.jpg")],
            check=True,
        )
        frames = sorted(tmp.glob("f_*.jpg"))
        if not frames:
            raise RuntimeError(f"no frames extracted from {ts}")
        grids_meta = []
        gi = 0
        for base in range(0, len(frames), COLS * ROWS):
            gi += 1
            if max_grids is not None and gi > max_grids:
                break
            batch = frames[base:base + COLS * ROWS]
            canvas = np.zeros((ROWS * (CELL_H + GAP) + GAP,
                               COLS * (CELL_W + GAP) + GAP, 3), dtype=np.uint8)
            cells = []
            for k, fr in enumerate(batch):
                r, c = divmod(k, COLS)
                x = GAP + c * (CELL_W + GAP)
                y = GAP + r * (CELL_H + GAP)
                img = cv2.imread(str(fr))
                if img is None:
                    img = np.zeros((FRAME_H, FRAME_W, 3), dtype=np.uint8)
                img = cv2.resize(img, (FRAME_W, FRAME_H))
                # label strip
                strip = np.zeros((STRIP_H, CELL_W, 3), dtype=np.uint8)
                offset = round(k + base * 0)  # k is 0-based within grid
                media_t = true_start + base + k
                label = f"media t= {media_t:.1f}s (+ {base + k:.1f}s)"
                cv2.putText(strip, label, (6, 19), FONT, 0.52,
                            (255, 255, 255), 1, cv2.LINE_AA)
                cellno = f"{k + 1:02d}"
                (tw, _), _ = cv2.getTextSize(cellno, FONT, 0.52, 1)
                cv2.putText(strip, cellno, (CELL_W - tw - 8, 19), FONT, 0.52,
                            (200, 200, 200), 1, cv2.LINE_AA)
                canvas[y:y + STRIP_H, x:x + CELL_W] = strip
                canvas[y + STRIP_H:y + CELL_H, x:x + CELL_W] = img
                cells.append({
                    "cell": k + 1,
                    "mediaTime": round(media_t, 2),
                    "offsetInWindow": round(float(base + k), 2),
                })
            out = outprefix.parent / f"{outprefix.name}_g{gi}.jpg"
            cv2.imwrite(str(out), canvas, [cv2.IMWRITE_JPEG_QUALITY, 88])
            grids_meta.append({"grid": gi, "file": out.name,
                               "trueStart": round(true_start, 2), "cells": cells})
            print(f"[grid] {out} ({len(batch)} cells)")
        meta_path = outprefix.parent / f"{outprefix.name}-grids.json"
        meta_path.write_text(json.dumps(grids_meta, indent=1) + "\n")
        print(f"[grid] meta {meta_path}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("ts")
    ap.add_argument("true_start", type=float)
    ap.add_argument("outprefix")
    ap.add_argument("--max-grids", type=int, default=None)
    args = ap.parse_args()
    build_grids(Path(args.ts), args.true_start, Path(args.outprefix), args.max_grids)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
