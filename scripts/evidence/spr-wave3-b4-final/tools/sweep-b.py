#!/usr/bin/env python3
"""Sweep phase B: strict per-cell VLM classification of all sweep grids.

One SINGLE-IMAGE VLM call per grid (the w2a law: grids are single images;
never batch multiple images). Class taxonomy matches w2a exactly:
wide-broadcast / closeup / pitch-action / graphics / crowd / other.
Paced (8s) + unlink-before-every-attempt + retry/backoff via vlm1.py.

Outputs: sweep-vlm/<window>_g<N>.json (raw), sweep-cells.json (parsed per
cell: window, grid, cell, mediaTime, class, description), and a candidate
list: consecutive crowd-cell runs (>=2s) flagged for direct verification.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from pathlib import Path

WORK = Path("/home/z/spr-w3c-work")
SWEEP = WORK / "sweep"
OUT = WORK / "sweep-vlm"

PROMPT = (
    "This is a 4-column x 5-row grid of 20 numbered cells from a soccer "
    "broadcast (cell numbers 01-20 are in the top-right of each cell, "
    "top-left to bottom-right; labels show media seconds; cells are "
    "consecutive 1-second frames). For each cell 1-20 output exactly one "
    "line: 'N: class | short description', where class is one of: "
    "wide-broadcast (wide shot showing the pitch), closeup (tight shot of "
    "one or two people), pitch-action (medium/close live match action), "
    "graphics (broadcast graphic overlay: scoreboard, lower-third, replay "
    "wipe, stats), crowd (spectators or stands fill more than half of the "
    "frame area), other. Use the crowd class ONLY when spectators/stands "
    "occupy more than half of that cell's frame."
)


def parse_cells(content: str, expect: int = 20) -> dict[int, tuple[str, str]]:
    out: dict[int, tuple[str, str]] = {}
    for line in content.splitlines():
        m = re.match(r"^\s*(\d+)\s*:\s*([a-zA-Z-]+)\s*\|?\s*(.*)$", line.strip())
        if not m:
            continue
        n, cls, desc = int(m.group(1)), m.group(2).lower().strip(), m.group(3).strip()
        if 1 <= n <= expect:
            out.setdefault(n, (cls, desc))
    return out


def main() -> int:
    OUT.mkdir(exist_ok=True)
    plan = [w for w in json.loads((WORK / "window-plan-final.json").read_text())
            if "error" not in w]
    all_cells = []
    candidates = []
    for w in plan:
        name = w["name"]
        meta_path = SWEEP / f"{name}-grids.json"
        if not meta_path.exists():
            continue
        meta = json.loads(meta_path.read_text())
        for g in meta:
            img = SWEEP / g["file"]
            tag = f"{name}_g{g['grid']}"
            outjson = OUT / f"{tag}.json"
            if not (outjson.exists() and "error" not in json.loads(outjson.read_text())):
                time.sleep(8)  # pacing (429 law)
                rc = subprocess.run(
                    [sys.executable, str(WORK / "vlm1.py"), str(img), PROMPT,
                     str(outjson), "--tag", tag],
                ).returncode
                if rc != 0:
                    print(f"[sweep-b] {tag} VLM FAILED (recorded)", file=sys.stderr)
            data = json.loads(outjson.read_text())
            if "error" in data:
                print(f"[sweep-b] {tag} ERROR recorded honestly", file=sys.stderr)
                continue
            cells = parse_cells(data["choices"][0]["message"]["content"])
            gcells = []
            for c in g["cells"]:
                cls, desc = cells.get(c["cell"], ("unparsed", ""))
                rec = {"window": name, "grid": g["grid"], "cell": c["cell"],
                       "mediaTime": c["mediaTime"], "class": cls,
                       "description": desc}
                gcells.append(rec)
                all_cells.append(rec)
            n_ok = sum(1 for r in gcells if r["class"] not in ("unparsed",))
            print(f"[sweep-b] {tag}: {n_ok}/{len(gcells)} cells parsed")
        time.sleep(1)

    # crowd runs per window (consecutive crowd cells in media time)
    by_window: dict[str, list[dict]] = {}
    for r in all_cells:
        if r["class"] == "crowd":
            by_window.setdefault(r["window"], []).append(r)
    for name, rows in by_window.items():
        rows.sort(key=lambda r: r["mediaTime"])
        run = [rows[0]]
        for r in rows[1:]:
            if abs(r["mediaTime"] - run[-1]["mediaTime"] - 1.0) < 0.01:
                run.append(r)
            else:
                candidates.append({"window": name, "runStart": run[0]["mediaTime"],
                                   "runEnd": run[-1]["mediaTime"],
                                   "cells": [x["cell"] for x in run],
                                   "gridHints": sorted({x["grid"] for x in run})})
                run = [r]
        candidates.append({"window": name, "runStart": run[0]["mediaTime"],
                           "runEnd": run[-1]["mediaTime"],
                           "cells": [x["cell"] for x in run],
                           "gridHints": sorted({x["grid"] for x in run})})

    (WORK / "sweep-cells.json").write_text(json.dumps(all_cells, indent=1) + "\n")
    (WORK / "sweep-crowd-candidates.json").write_text(
        json.dumps(candidates, indent=1) + "\n")
    from collections import Counter
    hist = Counter(r["class"] for r in all_cells)
    print(f"[sweep-b] cells: {dict(hist)}")
    print(f"[sweep-b] crowd runs: {len(candidates)}")
    for c in candidates:
        print(f"  {c['window']} {c['runStart']}->{c['runEnd']} "
              f"({c['runEnd'] - c['runStart'] + 1:.0f}s) cells={c['cells']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
