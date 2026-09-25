#!/usr/bin/env python3
"""Graphics cross-check for roar spikes (goal-moment detection step 2).

For each candidate moment: pull [peak-10, peak+20] of itag-230 video through
the recorded chain (fetcher.py), build ONE 4x5 grid of the +-10 s envelope
(20 frames at 1 fps, cells = media t), ONE single-image VLM call classifying
each cell (play/celebration/crowd/graphics/closeup/other), then derive the
goal verdict:
  - graphics cells within [peak-1, peak+9] AND/OR celebration cells ->
      GOAL-LIKELY (world-feed graphics + on-pitch celebration)
  - celebration/crowd without graphics -> CELEBRATION-NONGOAL-LIKELY
  - neither -> NEAR-MISS/OTHER (roar without broadcast celebration)
Moments with strong roar but no graphics get ONE follow-up grid
[peak+10, peak+19] (late scoreboard/scorer graphics trail).

Usage: crosscheck.py <moments.json>  (writes crosscheck/ + goal-moments draft)
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

WORK = Path("/home/z/spr-w3c-work")
CC = WORK / "crosscheck"
sys.path.insert(0, str(WORK))
from grid import build_grids  # noqa: E402

CLASSES = ["play", "celebration", "crowd", "graphics", "closeup", "other"]
PROMPT = (
    "This is a 4-column x 5-row grid of 20 numbered cells from a soccer "
    "broadcast. The cells are consecutive 1-second frames in time order "
    "(cell 1 is earliest, cell 20 latest; the cell labels show media seconds). "
    "For each cell 1-20 output exactly one line: 'N: class | short "
    "description', where class is one of: play (normal live match action), "
    "celebration (soccer players celebrating on the pitch), crowd "
    "(spectators/stands fill more than half the frame), graphics (broadcast "
    "graphic overlay: scoreboard, scoreline, lower-third, replay wipe, "
    "scorer stat), closeup (tight shot of one or two people), other. Be "
    "strict: only say graphics when a graphic overlay is clearly present."
)


def parse_cells(content: str) -> dict[int, tuple[str, str]]:
    out: dict[int, tuple[str, str]] = {}
    for line in content.splitlines():
        m = re.match(r"^\s*(\d+)\s*:\s*([a-zA-Z-]+)\s*\|?\s*(.*)$", line.strip())
        if not m:
            continue
        n, cls, desc = int(m.group(1)), m.group(2).lower().strip(), m.group(3).strip()
        # numbering overflow law (w2a incident): only cells 1-20 exist
        if 1 <= n <= 20:
            out.setdefault(n, (cls, desc))
    return out


def vlm_grid(image: str, tag: str) -> dict[int, tuple[str, str]]:
    outjson = CC / "vlm" / f"{tag}.json"
    outjson.parent.mkdir(parents=True, exist_ok=True)
    import time
    time.sleep(8)  # pacing: keep clear of 429 rate limiting (w2a lesson)
    rc = subprocess.run(
        [sys.executable, str(WORK / "vlm1.py"), image, PROMPT, str(outjson),
         "--tag", tag],
    ).returncode
    if rc != 0:
        return {}
    data = json.loads(outjson.read_text())
    if "error" in data:
        return {}
    return parse_cells(data["choices"][0]["message"]["content"])


def verdict_for(peak: float, cells: dict[int, tuple[str, str]], base: float) -> dict:
    """Derive the moment verdict from classified cells + timestamps."""
    graph, celeb, crowd = [], [], []
    for n, (cls, desc) in sorted(cells.items()):
        t = base + (n - 1)
        if cls == "graphics":
            graph.append(round(t, 1))
        elif cls == "celebration":
            celeb.append(round(t, 1))
        elif cls == "crowd":
            crowd.append(round(t, 1))
    has_graphics = bool(graph)
    has_celebration = bool(celeb)
    if has_graphics and (has_celebration or True):
        v = "GOAL-LIKELY" if has_celebration else "GRAPHICS-NO-CELEBRATION"
    elif has_celebration:
        v = "CELEBRATION-NONGOAL-LIKELY"
    elif crowd:
        v = "CROWD-ONLY"
    else:
        v = "NEAR-MISS/OTHER"
    return {
        "graphicsCells": graph, "celebrationCells": celeb, "crowdCells": crowd,
        "crossCheckVerdict": v,
    }


def main() -> int:
    moments = json.loads((WORK / "moments-to-check.json").read_text())
    results = []
    for m in moments:
        tag = m["tag"]
        peak = m["tPeak"]
        ts = CC / f"{tag}.ts"
        if not ts.exists():
            subprocess.run(
                [sys.executable, str(WORK / "fetcher.py"),
                 "--start", str(peak - 10), "--end", str(peak + 20),
                 "--name", tag, "--out", str(CC)],
                check=True, capture_output=True,
            )
        true_start = json.loads((CC / f"{tag}-window.json").read_text())["trueWindow"][0]
        prefix = CC / tag
        meta_path = CC / f"{tag}-grids.json"
        if not meta_path.exists():
            build_grids(ts, true_start, prefix, max_grids=1)
        meta = json.loads(meta_path.read_text())[0]
        grid_img = CC / meta["file"]
        cells = vlm_grid(str(grid_img), tag)
        n_cells = len(cells)
        res = {
            "tag": tag, "tPeak": peak,
            "excessMean15": m.get("excessMean15"),
            "peakDb": m.get("peakDb"),
            "excessDb": m.get("excessDb"),
            "gridCellsClassified": n_cells,
            **verdict_for(peak, cells, true_start),
        }
        # adaptive follow-up: strong roar, no graphics -> late-graphics grid
        if not res["graphicsCells"] and (m.get("excessMean15") or 0) >= 2.0:
            ftag = f"{tag}-late"
            fts = CC / f"{ftag}.ts"
            if not fts.exists():
                subprocess.run(
                    [sys.executable, str(WORK / "fetcher.py"),
                     "--start", str(peak + 9), "--end", str(peak + 24),
                     "--name", ftag, "--out", str(CC)],
                    check=True, capture_output=True,
                )
            ftrue = json.loads((CC / f"{ftag}-window.json").read_text())["trueWindow"][0]
            fmeta_path = CC / f"{ftag}-grids.json"
            if not fmeta_path.exists():
                build_grids(fts, ftrue, CC / ftag, max_grids=1)
            fmeta = json.loads(fmeta_path.read_text())[0]
            fcells = vlm_grid(str(CC / fmeta["file"]), ftag)
            fverd = verdict_for(peak, fcells, ftrue)
            res["lateGrid"] = {
                "graphicsCells": fverd["graphicsCells"],
                "celebrationCells": fverd["celebrationCells"],
                "crowdCells": fverd["crowdCells"],
                "crossCheckVerdict": fverd["crossCheckVerdict"],
                "gridCellsClassified": len(fcells),
            }
            if fverd["graphicsCells"] and (
                    fverd["celebrationCells"] or res["celebrationCells"]):
                res["crossCheckVerdict"] = "GOAL-LIKELY (late graphics)"
            elif fverd["graphicsCells"]:
                res["crossCheckVerdict"] = "GRAPHICS-NO-CELEBRATION (late)"
        results.append(res)
        print(f"[cc] {tag} t={peak:8.1f} cells={n_cells:2d} "
              f"graphics={res['graphicsCells']} celeb={res['celebrationCells'][:3]} "
              f"crowd={res['crowdCells'][:3]} -> {res['crossCheckVerdict']}",
              file=sys.stderr)
    (WORK / "crosscheck-results.json").write_text(json.dumps(results, indent=1) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
