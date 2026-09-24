"""Bit-exact ffmpeg encoding for SPE-v1.

Frames are piped as raw BGR24 into ffmpeg and encoded with fixed parameters +
`-threads 1` + `+bitexact` flags so the same frames always produce the same
bytes. The source audio is passed through unchanged.
"""

from __future__ import annotations

import subprocess
from typing import Iterator

import numpy as np


def encode_bitexact(frames: Iterator[np.ndarray], width: int, height: int,
                    fps: int, out_path: str, audio_src: str,
                    crf: int = 20, gop: int = 50) -> int:
    """Pipe frames to ffmpeg; returns the number of frames written."""
    cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo", "-pix_fmt", "bgr24",
        "-s", f"{width}x{height}", "-r", str(fps), "-i", "pipe:0",
        "-i", audio_src,
        "-map", "0:v:0", "-map", "1:a:0?",
        "-c:v", "libx264", "-crf", str(crf), "-preset", "medium", "-threads", "1",
        "-pix_fmt", "yuv420p", "-g", str(gop),
        "-fflags", "+bitexact", "-flags:v", "+bitexact",
        "-map_metadata", "-1", "-movflags", "+faststart",
        "-c:a", "copy", "-shortest",
        out_path,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    count = 0
    try:
        for frame in frames:
            data = np.ascontiguousarray(frame).tobytes()
            proc.stdin.write(data)
            count += 1
    finally:
        try:
            proc.stdin.close()
        except BrokenPipeError:
            pass
        err = proc.stderr.read().decode("utf-8", "replace")
        rc = proc.wait()
        if rc != 0:
            raise RuntimeError(f"ffmpeg failed rc={rc}:\n{err[-2000:]}")
    return count


def extract_frame(video: str, t_sec: float, out_png: str) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-ss", str(t_sec), "-i", video,
         "-frames:v", "1", out_png],
        check=True, capture_output=True,
    )
