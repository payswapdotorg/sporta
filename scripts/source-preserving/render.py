#!/usr/bin/env python3
"""SPE-v1 render CLI — the source-preserving renderer adapter.

    python3 render.py --clip <mp4> --reality <key> --out-dir <dir> \
        [--profile noir|vhs|default] [--suffix b8|b12|tune] \
        [--max-frames N] [--frames 2,15,30,45] [--skip-provenance]

Produces <reality>[-<profile>]-<suffix>.mp4 + .provenance.json (+ PNG frames).
Deterministic: same clip + same config -> byte-identical output.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parent))
from spe import encode as E  # noqa: E402
from spe import provenance as P  # noqa: E402
from spe import stages as S  # noqa: E402
from spe.renderers import REGISTRY, FrameProcessor  # noqa: E402


def render(clip: str, reality: str, out_dir: Path, profile: str = "default",
           suffix: str = "", max_frames: int | None = None,
           frames_at: list[float] | None = None, skip_provenance: bool = False) -> dict:
    spec = REGISTRY[reality]
    if profile not in spec.profiles:
        raise SystemExit(f"profile {profile} not in {spec.profiles}")
    out_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    probe = S.probe(clip)
    ana = S.analyze(clip)
    if max_frames:
        ana["frameCount"] = min(ana["frameCount"], max_frames)

    palette = None
    if spec.paletteK:
        palette = S.learn_palette(ana["paletteSamples"], spec.paletteK,
                                  l_weight=spec.config.get("lWeight", 0.45))

    name = f"{reality}" + (f"-{profile}" if profile != "default" else "") \
        + (f"-{suffix}" if suffix else "") + ".mp4"
    out_path = out_dir / name

    proc = FrameProcessor(spec, palette, ana["cuts"], profile)
    fps = int(round(probe["fps"]))

    cap = cv2.VideoCapture(clip)
    if not cap.isOpened():
        raise SystemExit(f"cannot open clip {clip}")

    def frames():
        i = 0
        while True:
            ok, frame = cap.read()
            if not ok or (max_frames and i >= max_frames):
                break
            yield proc(frame)
            i += 1

    count = E.encode_bitexact(frames(), probe["width"], probe["height"], fps,
                              str(out_path), clip)
    cap.release()
    wall_ms = (time.time() - t0) * 1000.0

    # comparison frames
    frame_files = []
    if frames_at:
        fdir = out_dir / "frames"
        fdir.mkdir(exist_ok=True)
        for t in frames_at:
            stem = f"{reality}" + (f"-{profile}" if profile != "default" else "") \
                + (f"-{suffix}" if suffix else "") + f"-t{int(t)}s"
            fp = fdir / f"{stem}.png"
            E.extract_frame(str(out_path), t, str(fp))
            frame_files.append(str(fp.relative_to(out_dir)))

    prov_file = None
    if not skip_provenance:
        clip_sha = P.sha256_file(clip)
        cfg = dict(spec.config)
        cfg["profile"] = profile
        cfg["frameCount"] = count
        repro = {
            "deterministic": True,
            "verifiedByDoubleRender": None,
            "command": (f"python3 scripts/source-preserving/render.py --clip {clip} "
                        f"--reality {reality} --profile {profile} --out-dir {out_dir}"
                        + (f" --suffix {suffix}" if suffix else "")),
        }
        prov_file = P.write_provenance(
            out_dir, name, spec, profile, clip, clip_sha, probe, count,
            wall_ms, cfg, spec.pipeline, repro,
        )

    return {
        "file": name, "path": str(out_path), "frameCount": count,
        "byteSize": out_path.stat().st_size, "sha256": P.sha256_file(str(out_path)),
        "renderWallMs": round(wall_ms, 1), "frames": frame_files,
        "provenance": prov_file,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--clip", required=True)
    ap.add_argument("--reality", required=True, choices=sorted(REGISTRY.keys()))
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--profile", default="default")
    ap.add_argument("--suffix", default="")
    ap.add_argument("--max-frames", type=int, default=None)
    ap.add_argument("--frames", default="")
    ap.add_argument("--skip-provenance", action="store_true")
    a = ap.parse_args()
    frames_at = [float(t) for t in a.frames.split(",") if t.strip()] or None
    res = render(a.clip, a.reality, Path(a.out_dir), a.profile, a.suffix,
                 a.max_frames, frames_at, a.skip_provenance)
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
