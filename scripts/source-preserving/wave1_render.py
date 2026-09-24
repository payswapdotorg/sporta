#!/usr/bin/env python3
"""Wave-1 render driver: full renders + determinism proof + copies + self-QA.

Renders SPR101/SPR102/SPR108/SPR201 on the b8 in-play substrate (full 47.6s)
plus the b12 review cut; proves byte-determinism by double-render; extracts
comparison frames; copies artifacts to the product-surface playback dir; and
records renders.json with VLM self-QA verdicts.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from spe import provenance as P  # noqa: E402
from spe.renderers import REGISTRY  # noqa: E402

B8 = "/home/z/w6-real-r606-inplay-evidence/bytes/original-artifact-a13396ec.mp4"
B12 = "/home/z/spr-evidence/render/b8-b12.mp4"
OUT = Path("/home/z/spr-evidence/render")
PUBLIC = Path("/home/z/my-project/public/media/spr/render")
FRAMES_AT = [2, 15, 30, 45]

JOBS = [
    # (reality, profile, suffixes to render on b8-full and b12)
    ("cartoon-cel", "default", True),
    ("anime-npr", "default", True),
    ("noir-retro", "noir", True),
    ("noir-retro", "vhs", False),   # b12-only variant
    ("motion-trails", "default", True),
]


def run_reality(reality: str, profile: str, full: bool) -> dict:
    spec = REGISTRY[reality]
    stem = f"{reality}" + (f"-{profile}" if profile != "default" else "")
    res = {"reality": reality, "profile": profile, "rendererId": spec.rendererId,
           "rendererVersion": spec.version, "family": spec.family, "sprId": spec.sprId,
           "engine": spec.engine, "implementation": spec.implementation,
           "description": spec.description, "files": {}, "frames": []}
    # full b8
    if full:
        out = subprocess.run(
            [sys.executable, "render.py", "--clip", B8, "--reality", reality,
             "--profile", profile, "--out-dir", str(OUT), "--suffix", "b8",
             "--frames", ",".join(str(t) for t in FRAMES_AT)],
            capture_output=True, text=True, cwd=str(Path(__file__).resolve().parent),
        )
        if out.returncode != 0:
            raise RuntimeError(out.stderr[-1500:])
        r = json.loads(out.stdout)
        res["files"]["b8"] = {"file": r["file"], "byteSize": r["byteSize"],
                              "sha256": r["sha256"], "frameCount": r["frameCount"],
                              "renderWallMs": r["renderWallMs"],
                              "url": f"/media/spr/render/{r['file']}",
                              "provenance": r["provenance"]}
        res["frames"] = r["frames"]
        # determinism: double-render the b12 cut and compare hashes
        t1 = subprocess.run(
            [sys.executable, "render.py", "--clip", B12, "--reality", reality,
             "--profile", profile, "--out-dir", "/tmp/spr-det1", "--suffix", "b12",
             "--skip-provenance"],
            capture_output=True, text=True, cwd=str(Path(__file__).resolve().parent))
        t2 = subprocess.run(
            [sys.executable, "render.py", "--clip", B12, "--reality", reality,
             "--profile", profile, "--out-dir", "/tmp/spr-det2", "--suffix", "b12",
             "--skip-provenance"],
            capture_output=True, text=True, cwd=str(Path(__file__).resolve().parent))
        if t1.returncode or t2.returncode:
            raise RuntimeError((t1.stderr + t2.stderr)[-1500:])
        j1, j2 = json.loads(t1.stdout), json.loads(t2.stdout)
        det = j1["sha256"] == j2["sha256"]
        res["files"]["b12"] = {"file": j1["file"], "byteSize": j1["byteSize"],
                               "sha256": j1["sha256"], "frameCount": j1["frameCount"],
                               "renderWallMs": j1["renderWallMs"],
                               "url": f"/media/spr/render/{j1['file']}",
                               "determinismDoubleRender": {
                                   "shaA": j1["sha256"], "shaB": j2["sha256"],
                                   "byteIdentical": det}}
        if not det:
            print(f"!! DETERMINISM FAIL {reality}/{profile}")
        # move the b12 artifact into OUT
        shutil.copy2(Path("/tmp/spr-det1") / j1["file"], OUT / j1["file"])
    else:
        out = subprocess.run(
            [sys.executable, "render.py", "--clip", B12, "--reality", reality,
             "--profile", profile, "--out-dir", str(OUT), "--suffix", "b12",
             "--skip-provenance"],
            capture_output=True, text=True, cwd=str(Path(__file__).resolve().parent))
        if out.returncode != 0:
            raise RuntimeError(out.stderr[-1500:])
        r = json.loads(out.stdout)
        res["files"]["b12"] = {"file": r["file"], "byteSize": r["byteSize"],
                               "sha256": r["sha256"], "frameCount": r["frameCount"],
                               "renderWallMs": r["renderWallMs"],
                               "url": f"/media/spr/render/{r['file']}"}
    return res


def vlm_selfqa(reality: str, profile: str) -> dict:
    stem = f"{reality}" + (f"-{profile}" if profile != "default" else "")
    prompt = ("Image 1 is an original football broadcast frame; image 2 is a "
              f"stylized ({stem}) version of the SAME frame. Score 1-5 each and "
              "answer briefly: (a) stylization obvious+appealing? (b) players "
              "visible + structurally intact? (c) same match moment recognizable "
              "(camera, positions, scoreboard)? (d) colors believable for the style?")
    verdicts = {}
    for t in (2, 15, 45):
        orig = OUT / "frames" / f"original-t{t}s.png"
        styl = OUT / "frames" / f"{stem}-b8-t{t}s.png"
        if not orig.exists() or not styl.exists():
            continue
        oj = f"/tmp/spr-selfqa-{stem}-{t}.json"
        subprocess.run(["z-ai", "vision", "-p", prompt, "-i", str(orig),
                        "-i", str(styl), "-o", oj],
                       capture_output=True, text=True, timeout=180)
        try:
            j = json.loads(Path(oj).read_text())
            verdicts[f"t{t}s"] = j["choices"][0]["message"]["content"][:900]
        except Exception as e:  # noqa: BLE001
            verdicts[f"t{t}s"] = f"VLM call failed: {e}"
    return verdicts


def main() -> None:
    import sys as _sys
    job = _sys.argv[1] if len(_sys.argv) > 1 else "all"
    t0 = time.time()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "frames").mkdir(exist_ok=True)
    (OUT / "selfqa").mkdir(exist_ok=True)
    if job in ("all", "original-frames"):
        for t in FRAMES_AT:
            subprocess.run(["ffmpeg", "-y", "-ss", str(t), "-i", B8, "-frames:v", "1",
                            str(OUT / "frames" / f"original-t{t}s.png")],
                           capture_output=True, check=True)

    results = []
    staged = {
        "cartoon": [("cartoon-cel", "default", True)],
        "anime": [("anime-npr", "default", True)],
        "noir": [("noir-retro", "noir", True), ("noir-retro", "vhs", False)],
        "trails": [("motion-trails", "default", True)],
    }
    todo = staged.get(job, JOBS) if job != "all" else JOBS
    if job in ("assemble", "original-frames"):
        todo = []
    for reality, profile, full in todo:
        print(f"=== rendering {reality}/{profile} full={full}", flush=True)
        res = run_reality(reality, profile, full)
        results.append(res)

    if job in ("all", "assemble"):
        # merge with previously rendered jobs from renders.json if present
        prev_path = OUT / "renders.json"
        if job == "assemble" and prev_path.exists():
            prev = json.loads(prev_path.read_text())
            seen = {(r["reality"], r["profile"]) for r in results}
            for r in prev["realities"]:
                if (r["reality"], r["profile"]) not in seen:
                    results.append(r)
        for res in results:
            v = vlm_selfqa(res["reality"], res["profile"])
            (OUT / "selfqa" / f"{res['reality']}-{res['profile']}.json").write_text(
                json.dumps(v, indent=1))
            res["selfQa"] = {"file": f"selfqa/{res['reality']}-{res['profile']}.json",
                             "verdicts": v}
        for res in results:
            for key, f in res["files"].items():
                src = OUT / f["file"]
                if src.exists():
                    shutil.copy2(src, PUBLIC / f["file"])
        PUBLIC.mkdir(parents=True, exist_ok=True)
        (PUBLIC / "frames").mkdir(exist_ok=True)
        for png in (OUT / "frames").glob("*.png"):
            shutil.copy2(png, PUBLIC / "frames" / png.name)
        manifest = {
            "schemaVersion": "1.0",
            "engine": "SPE-v1",
            "generatedAtIso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "inputSubstrate": {
                "clipId": "sprclip-b8-inplay-original",
                "path": B8,
                "sha256": P.sha256_file(B8),
                "durationMs": 47603, "fps": 25, "frameCount": 1190,
                "mediaWindow": "1803.84-1851.44s",
                "source": "https://www.youtube.com/watch?v=93LPZJkCW2w (BETIS 3-5 BARCELONA, LaLiga 25/26 MD15)",
            },
            "realities": results,
            "wallClockSec": round(time.time() - t0, 1),
        }
        (OUT / "renders.json").write_text(json.dumps(manifest, indent=1))
        print(f"DONE in {time.time()-t0:.0f}s -> {OUT/'renders.json'}", flush=True)
    else:
        print(f"job {job} finished in {time.time()-t0:.0f}s (assemble step pending)", flush=True)


if __name__ == "__main__":
    main()
