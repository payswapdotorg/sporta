#!/usr/bin/env python3
"""SPR-W2-C trial render driver (Lane C) — renders trial candidates.

    python3 driver.py --trial kuwahara-paint --clip <mp4> --out-dir <dir> \
        [--profile default] [--suffix b12|b8] [--max-frames N] \
        [--frames 2,8,11] [--skip-provenance]

Mirrors `scripts/source-preserving/render.py` (the frozen adapter) but selects
the trial from `spe.trials.TRIALS` — NEVER from the frozen REGISTRY, which this
driver does not import for selection (contract §4: trials are not registry
rows; ids carry the `sprtrial-` prefix).  The frozen stage/encode/provenance
libraries are reused read-only, so every trial render inherits the engine's
bit-exact encoder (`-fflags +bitexact`, fixed GOP, `-threads 1`, audio
passthrough) and contract-shaped provenance.

Window determinism: `--max-frames N` bounds BOTH the render and the analysis
pass (common.analyze_window), so a b8 --max-frames 300 render depends only on
the first 300 frames of the substrate (identical output whether the source is
the full clip or a 300-frame prefix).

Same clip + same config -> byte-identical output (proven by double render).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from spe import encode as E   # noqa: E402
from spe import provenance as P   # noqa: E402
from spe import stages as S   # noqa: E402
from spe.trials import TRIALS   # noqa: E402
from spe.trials.common import analyze_window   # noqa: E402


def _audio_duration(path: str) -> float | None:
    """Duration of the first audio stream in seconds (None if absent)."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0",
         "-show_entries", "stream=duration", "-of", "csv=p=0", path],
        capture_output=True, text=True)
    try:
        return float(out.stdout.strip())
    except ValueError:
        return None


def _audio_source(clip: str, video_end_s: float, out_dir: Path) -> tuple[str, str]:
    """Audio source for the frozen bit-exact encoder + an honesty note.

    The frozen `spe.encode.encode_bitexact` muxes with `-shortest -c:a copy`:
    on substrates whose AUDIO ends before the rendered video window, the
    muxer drops the trailing video packets (measured on b12: trial renders
    came out 298-300 of 301 frames; the FROZEN wave-1 renderer shows the same
    defect on this substrate — baseline/cartoon-cel-b12.mp4 decodes to 300 of
    301 frames; b12's audio ends ~34 ms before its last video frame).

    Wave-1 precedent (status w6-spr-2): "the substrate adapts to the engine" —
    audio apad normalization.  This driver therefore prepares, ONLY when the
    source audio falls short, a deterministic apad-padded AAC derivative
    (real broadcast sound unchanged, one AAC generation + trailing silence)
    so the encoder muxes every rendered frame.  Recorded in the result JSON
    and hashed into the provenance config (contract §3.3: the config hash
    covers the effective params actually used).
    """
    aud_dur = _audio_duration(clip)
    if aud_dur is None or aud_dur + 0.03 >= video_end_s:
        return clip, "passthrough (source audio covers the rendered window)"
    apad_path = out_dir / (Path(clip).stem + ".apad-audio.m4a")
    if not apad_path.exists():
        subprocess.run(
            ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
             "-i", clip, "-map", "0:a:0", "-c:a", "aac", "-b:a", "192k",
             "-af", "apad", "-t", f"{video_end_s + 0.5:.3f}", str(apad_path)],
            check=True)
    note = (f"derived apad audio ({apad_path.name}): substrate audio ends "
            f"{(video_end_s - aud_dur) * 1000.0:.0f} ms before the rendered "
            "video window; the frozen encoder's -shortest otherwise drops "
            "trailing video packets (w6-spr-2 substrate-adapts-to-engine "
            "precedent; broadcast sound unchanged, one AAC generation)")
    return str(apad_path), note


def render(trial: str, clip: str, out_dir: Path, profile: str = "default",
           suffix: str = "", max_frames: int | None = None,
           frames_at: list[float] | None = None,
           skip_provenance: bool = False) -> dict:
    if trial not in TRIALS:
        raise SystemExit(f"unknown trial {trial}; available: {sorted(TRIALS)}")
    spec = TRIALS[trial]
    if profile not in spec.profiles:
        raise SystemExit(f"profile {profile} not in {spec.profiles}")
    out_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    probe = S.probe(clip)
    ana = analyze_window(clip, max_frames)

    palette = None
    if spec.paletteK:
        palette = S.learn_palette(ana["paletteSamples"], spec.paletteK,
                                  l_weight=spec.config.get("lWeight", 0.45))

    name = f"{trial}" + (f"-{profile}" if profile != "default" else "") \
        + (f"-{suffix}" if suffix else "") + ".mp4"
    out_path = out_dir / name

    proc = spec.make_processor(palette, ana["cuts"], profile)
    fps = int(round(probe["fps"]))
    window = min(probe["frameCount"], max_frames or probe["frameCount"])
    audio_src, audio_note = _audio_source(clip, window / fps, out_dir)

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
                              str(out_path), audio_src)
    cap.release()
    wall_ms = (time.time() - t0) * 1000.0

    frame_files = []
    if frames_at:
        fdir = out_dir / "frames"
        fdir.mkdir(exist_ok=True)
        for t in frames_at:
            stem = f"{trial}" + (f"-{profile}" if profile != "default" else "") \
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
        cfg["audioSource"] = audio_note
        if max_frames:
            cfg["maxFrames"] = max_frames
        repro = {
            "deterministic": True,
            "verifiedByDoubleRender": None,
            "command": (f"python3 scripts/source-preserving/spe/trials/driver.py "
                        f"--trial {trial} --clip {clip} --profile {profile} "
                        f"--out-dir {out_dir}"
                        + (f" --suffix {suffix}" if suffix else "")
                        + (f" --max-frames {max_frames}" if max_frames else "")),
        }
        prov_file = P.write_provenance(
            out_dir, name, spec, profile, clip, clip_sha, probe, count,
            wall_ms, cfg, spec.pipeline, repro,
        )

    return {
        "trial": trial, "trialId": spec.trialId, "file": name,
        "path": str(out_path), "frameCount": count,
        "byteSize": out_path.stat().st_size, "sha256": P.sha256_file(str(out_path)),
        "renderWallMs": round(wall_ms, 1), "frames": frame_files,
        "audioSource": audio_note,
        "provenance": prov_file,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--trial", required=True, choices=sorted(TRIALS.keys()))
    ap.add_argument("--clip", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--profile", default="default")
    ap.add_argument("--suffix", default="")
    ap.add_argument("--max-frames", type=int, default=None)
    ap.add_argument("--frames", default="")
    ap.add_argument("--skip-provenance", action="store_true")
    a = ap.parse_args()
    frames_at = [float(t) for t in a.frames.split(",") if t.strip()] or None
    res = render(a.trial, a.clip, Path(a.out_dir), a.profile, a.suffix,
                 a.max_frames, frames_at, a.skip_provenance)
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
