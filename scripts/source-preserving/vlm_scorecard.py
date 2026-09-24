#!/usr/bin/env python3
"""VLM scorecard harness (Tier-2 input) — original vs stylized, per reality.

For every reality with a b8 render, extracts comparison frames (t=2, 15, 45)
and asks the vision model to score 1-5 on the acceptance axes:
  (a) stylization obvious + appealing
  (b) players visible + structurally intact
  (c) same match moment recognizable (camera, positions, scoreboard)
  (d) colors believable for the style

Verdicts are stored per (reality, frame); the scorecard JSON is the Tier-2
VLM evidence. Quota failures are retried with backoff and, when they persist,
recorded honestly (verdict = "quota-exhausted") — never silently skipped.

Usage:
  python3 vlm_scorecard.py [--frames 2,15,45] [--realities cartoon-cel,...]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

RENDER = Path("/home/z/spr-evidence/render")
QA = Path("/home/z/spr-evidence/qa")

PROMPT = (
    "Image 1 is an original football broadcast frame; image 2 is a stylized "
    "({stem}) version of the SAME frame. Score each axis 1-5 (5 best) and "
    "answer briefly:\n"
    "(a) stylization obvious + appealing?\n"
    "(b) players visible + structurally intact (no deformed limbs, no missing "
    "players)?\n"
    "(c) same match moment recognizable (camera, positions, scoreboard)?\n"
    "(d) colors believable for the style?\n"
    "End with a single line: SCORES a=<n> b=<n> c=<n> d=<n>"
)

DEFAULT_REALITIES = [
    "cartoon-cel",
    "anime-npr",
    "noir-retro-noir",
    "motion-trails",
]


def vlm_call(orig: Path, styl: Path, stem: str, out_json: Path,
             retries: int = 3, backoff_s: float = 90.0) -> dict:
    for attempt in range(1, retries + 1):
        proc = subprocess.run(
            ["z-ai", "vision", "-p", PROMPT.format(stem=stem),
             "-i", str(orig), "-i", str(styl), "-o", str(out_json)],
            capture_output=True, text=True, timeout=240,
        )
        if out_json.exists():
            try:
                j = json.loads(out_json.read_text())
                content = j["choices"][0]["message"]["content"]
                return {"ok": True, "content": content, "attempt": attempt}
            except Exception:  # noqa: BLE001
                pass
        if "429" in (proc.stderr or "") and attempt < retries:
            print(f"  429 quota; backoff {backoff_s}s "
                  f"(attempt {attempt}/{retries})", flush=True)
            time.sleep(backoff_s)
    return {"ok": False, "content": "quota-exhausted", "attempt": retries}


def parse_scores(content: str) -> dict | None:
    import re
    m = re.search(
        r"a\s*=\s*([1-5])\s+b\s*=\s*([1-5])\s+c\s*=\s*([1-5])\s+d\s*=\s*([1-5])",
        content,
    )
    if not m:
        return None
    a, b, c, d = (int(g) for g in m.groups())
    return {"a": a, "b": b, "c": c, "d": d, "mean": round((a + b + c + d) / 4, 2)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", default="2,15,45")
    ap.add_argument("--realities", default=",".join(DEFAULT_REALITIES))
    a = ap.parse_args()
    frames = [int(t) for t in a.frames.split(",") if t.strip()]
    realities = [r for r in a.realities.split(",") if r.strip()]

    QA.mkdir(parents=True, exist_ok=True)
    scorecard: dict = {"schemaVersion": "1.0", "perReality": {}}
    for stem in realities:
        entries = []
        for t in frames:
            orig = RENDER / "frames" / f"original-t{t}s.png"
            styl = RENDER / "frames" / f"{stem}-b8-t{t}s.png"
            if not orig.exists() or not styl.exists():
                entries.append({"t": t, "error": "frame pair missing"})
                continue
            verdict = vlm_call(orig, styl, stem,
                               QA / f"vlm-{stem}-t{t}.json")
            entry = {"t": t, "ok": verdict["ok"], "verdict": verdict["content"]}
            if verdict["ok"]:
                entry["scores"] = parse_scores(verdict["content"])
            entries.append(entry)
            print(f"{stem} t={t}s ok={verdict['ok']}", flush=True)
        scored = [e["scores"] for e in entries if e.get("scores")]
        scorecard["perReality"][stem] = {
            "entries": entries,
            "scoredFrames": len(scored),
            "meanOfMeans": round(sum(s["mean"] for s in scored) / max(len(scored), 1), 2)
            if scored else None,
            "tier2Threshold": ">= 4.0 mean AND all axes >= 3 on every frame",
        }
    (QA / "vlm-scorecard.json").write_text(json.dumps(scorecard, indent=1))
    print(f"scorecard -> {QA / 'vlm-scorecard.json'}")
    ok = all(
        r.get("scoredFrames", 0) == len(frames)
        for r in scorecard["perReality"].values()
    )
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
