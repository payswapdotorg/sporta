#!/usr/bin/env python3
"""Rebuild renders.json from on-disk artifacts + provenance (no VLM here —
the formal QA harness runs separately)."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from spe import provenance as P  # noqa: E402
from spe.renderers import REGISTRY  # noqa: E402

OUT = Path("/home/z/spr-evidence/render")
PUBLIC = Path("/home/z/my-project/public/media/spr/render")
B8 = "/home/z/w6-real-r606-inplay-evidence/bytes/original-artifact-a13396ec.mp4"
DET1 = Path("/tmp/spr-det1")
DET2 = Path("/tmp/spr-det2")

ITEMS = [
    ("cartoon-cel", "default", True),
    ("anime-npr", "default", True),
    ("noir-retro", "noir", True),
    ("noir-retro", "vhs", False),
    ("motion-trails", "default", True),
]


def probe_frames(path: str) -> int:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames",
         "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", path],
        capture_output=True, text=True, check=True).stdout.strip()
    return int(out)


def main() -> None:
    results = []
    for reality, profile, full in ITEMS:
        spec = REGISTRY[reality]
        stem = f"{reality}" + (f"-{profile}" if profile != "default" else "")
        res = {"reality": reality, "profile": profile,
               "rendererId": spec.rendererId, "rendererVersion": spec.version,
               "family": spec.family, "sprId": spec.sprId, "engine": spec.engine,
               "implementation": spec.implementation, "description": spec.description,
               "files": {}, "frames": []}
        if full:
            prov_path = OUT / f"{stem}-b8.provenance.json"
            prov = json.loads(prov_path.read_text())
            b8f = OUT / f"{stem}-b8.mp4"
            sha = P.sha256_file(str(b8f))
            assert sha == prov["output"]["sha256"], f"provenance hash mismatch {stem}"
            res["files"]["b8"] = {
                "file": f"{stem}-b8.mp4", "byteSize": b8f.stat().st_size,
                "sha256": sha, "frameCount": prov["output"]["frameCount"],
                "url": f"/media/spr/render/{stem}-b8.mp4",
                "provenance": prov_path.name,
            }
            # b12 determinism triple: OUT + two independent /tmp renders
            f_det = [OUT, DET1, DET2]
            shas = [P.sha256_file(str(d / f"{stem}-b12.mp4")) for d in f_det
                    if (d / f"{stem}-b12.mp4").exists()]
            b12p = OUT / f"{stem}-b12.mp4"
            res["files"]["b12"] = {
                "file": b12p.name, "byteSize": b12p.stat().st_size,
                "sha256": shas[0] if shas else None,
                "frameCount": probe_frames(str(b12p)) if shas else None,
                "url": f"/media/spr/render/{b12p.name}",
                "determinismDoubleRender": {
                    "shaA": shas[0] if shas else None,
                    "shaB": shas[1] if len(shas) > 1 else None,
                    "shaC": shas[2] if len(shas) > 2 else None,
                    "byteIdentical": len(shas) == 3 and len(set(shas)) == 1,
                },
            }
            for t in (2, 15, 30, 45):
                fp = f"frames/{stem}-b8-t{t}s.png"
                if (OUT / fp).exists():
                    res["frames"].append(fp)
        else:
            b12p = OUT / f"{stem}-b12.mp4"
            res["files"]["b12"] = {
                "file": b12p.name, "byteSize": b12p.stat().st_size,
                "sha256": P.sha256_file(str(b12p)),
                "frameCount": probe_frames(str(b12p)),
                "url": f"/media/spr/render/{b12p.name}",
            }
        res["selfQa"] = None
        results.append(res)

    # original frames + copies
    for t in (2, 15, 30, 45):
        subprocess.run(["ffmpeg", "-y", "-ss", str(t), "-i", B8, "-frames:v", "1",
                        str(OUT / "frames" / f"original-t{t}s.png")],
                       capture_output=True, check=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    (PUBLIC / "frames").mkdir(exist_ok=True)
    for res in results:
        for k, f in res["files"].items():
            src = OUT / f["file"]
            if src.exists():
                shutil.copy2(src, PUBLIC / f["file"])
    for png in (OUT / "frames").glob("*.png"):
        shutil.copy2(png, PUBLIC / "frames" / png.name)

    manifest = {
        "schemaVersion": "1.0",
        "engine": "SPE-v1",
        "generatedAtIso": subprocess.run(
            ["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"], capture_output=True, text=True
        ).stdout.strip(),
        "inputSubstrate": {
            "clipId": "sprclip-b8-inplay-original",
            "path": B8,
            "sha256": P.sha256_file(B8),
            "durationMs": 47603, "fps": 25, "frameCount": 1190,
            "mediaWindow": "1803.84-1851.44s",
            "source": "https://www.youtube.com/watch?v=93LPZJkCW2w (BETIS 3-5 BARCELONA, LaLiga 25/26 MD15)",
        },
        "realities": results,
        "selfQaNote": "renderer self-QA deferred to the formal QA harness (qa/metrics + qa/vlm scorecards)",
    }
    (OUT / "renders.json").write_text(json.dumps(manifest, indent=1))
    print("renders.json rebuilt:", len(results), "realities")
    for r in results:
        det = r["files"].get("b12", {}).get("determinismDoubleRender")
        print(f"  {r['reality']}/{r['profile']}: b8={r['files'].get('b8',{}).get('byteSize')} "
              f"det={'OK' if det and det['byteIdentical'] else det}")


if __name__ == "__main__":
    main()
