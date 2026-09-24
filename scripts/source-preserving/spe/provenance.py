"""Provenance writer for SPE-v1 render artifacts (contract §3)."""

from __future__ import annotations

import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def canonical_hash(obj: dict) -> str:
    blob = json.dumps(obj, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode()).hexdigest()


def tool_versions() -> dict:
    try:
        ff = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True
                            ).stdout.split("\n")[0].split()[2]
    except Exception:
        ff = "unknown"
    try:
        import cv2
        import numpy
        cv, np_ = cv2.__version__, numpy.__version__
    except Exception:
        cv, np_ = "unknown", "unknown"
    return {"ffmpeg": ff, "opencv": cv, "numpy": np_}


def write_provenance(out_dir: Path, artifact_file: str, spec, profile: str,
                     clip_path: str, clip_sha: str, clip_probe: dict,
                     frame_count: int, render_wall_ms: float,
                     style_config: dict, pipeline: list,
                     reproducibility: dict) -> str:
    cfg_hash = canonical_hash(style_config)
    input_id = f"clip-sha:{clip_sha[:12]}"
    run_id = "sprrun-" + hashlib.sha256(
        (clip_sha + spec.rendererId + cfg_hash).encode()
    ).hexdigest()[:16]
    prov = {
        "rendererId": spec.rendererId,
        "rendererVersion": spec.version,
        "implementation": spec.implementation,
        "engine": spec.engine,
        "profile": profile,
        "inputClip": {"path": clip_path, "sha256": clip_sha, "identity": input_id},
        "styleConfig": {"config": style_config, "hash": cfg_hash},
        "pipeline": [{"stage": s} for s in pipeline],
        "tools": tool_versions(),
        "output": {
            "file": artifact_file,
            "sha256": sha256_file(str(out_dir / artifact_file)),
            "byteSize": (out_dir / artifact_file).stat().st_size,
            "container": "mp4/h264+aac(passthrough)",
            "width": clip_probe["width"], "height": clip_probe["height"],
            "fps": clip_probe["fps"], "frameCount": frame_count,
        },
        "reproducibility": reproducibility,
        "telemetry": {"renderWallMs": round(render_wall_ms, 1), "retries": 0},
        "degradations": [{
            "stage": "swm-guidance",
            "reason": "no SWM snapshot supplied (source-preserving lane)",
            "effect": "optional semantic emphasis inactive; visual reality complete",
        }],
        "generatedAtIso": datetime.now(timezone.utc).isoformat(),
        "runId": run_id,
    }
    name = artifact_file.rsplit(".mp4", 1)[0] + ".provenance.json"
    (out_dir / name).write_text(json.dumps(prov, indent=1))
    return name
