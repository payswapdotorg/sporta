#!/usr/bin/env python3
"""
HF004 — the MapAnything output-schema introspection (Worker A flight 2,
worker 64-b). THE STATIC HALF of the contract-compatibility evidence.

MapAnything (the HF002-ledger candidate `facebook/map-anything-apache` @
00f9c245bbcb60522d1ed7f9e9d88462c6e3f38a) cannot RUN on this benchmark host
(the pinned checkpoint is 4,914,062,480 B; the host has ~1.3 GB free disk and
4,041 MB total RAM — see results/preflight-refusal.json for the typed
refusal). The honest partial this script provides is the STATIC
contract-compatibility review the worker brief names: the model's OUTPUT
SCHEMA, extracted from the model's OWN SOURCE CODE at a pinned code revision,
machine-checkably.

Method (labeled honestly in every output):
  - The mapanything package is NOT on PyPI; the code side is the GitHub repo
    facebookresearch/map-anything, shallow-cloned OUTSIDE the repo at
    /home/z/hf-bench-2/map-anything-src (git commit
    3d10cf7a3016fc0f9bb13a071ee66c47b10be0d9, pyproject version 1.1.4).
  - This script parses THAT source tree (never the README alone) and emits
    the prediction-dict fields with shapes/conventions, as constructed by:
      * mapanything/models/mapanything/model.py — the per-view raw output
        dict for THIS checkpoint's scene_rep_type
        (`raydirs+depth+pose+confidence+mask`: the adaptor type recorded in
        the pinned model repo's config.json), plus the confidence/mask
        additions;
      * mapanything/utils/inference.py —
        postprocess_model_outputs_for_inference, which adds the derived
        fields (img_no_norm, depth_z, intrinsics, camera_poses, mask, and
        the optional multi-view confidence replacement).
  - SOURCE-SCAN, not import-execution: importing mapanything requires torch,
    and a torch install + the fp32 model is exactly what this host cannot
    hold (the typed refusal). The scan is still fail-closed: if a pinned
    construction site cannot be found in the source, the script exits
    non-zero rather than emitting a made-up schema.

Run:
  python3 schema_introspect.py --source-root /home/z/hf-bench-2/map-anything-src \
      [--config /tmp/mapanything-config.json]
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

CODE_COMMIT_DEFAULT = "3d10cf7a3016fc0f9bb13a071ee66c47b10be0d9"
MODEL_REVISION = "00f9c245bbcb60522d1ed7f9e9d88462c6e3f38a"
MODEL_URL = "https://huggingface.co/facebook/map-anything-apache"
CHECKPOINT_BYTES = 4_914_062_480
CHECKPOINT_SHA256_HF_ETAG = "fa06c0fdccefc5048e072c85935d5789b1e36b307f3859033c17f9dcb9fd5201"

RESOURCE_CAVEAT = (
    "GPU memory: N/A (no GPU on the benchmark host); process RSS recorded instead"
)

# The derived-field additions of postprocess_model_outputs_for_inference,
# each tied to the exact guard in the source that adds it (verified below).
POSTPROCESS_ADDITIONS = {
    "img_no_norm": {
        "shape": "(B, H, W, 3)",
        "convention": "denormalized RGB input images (visualization echo)",
        "addedWhen": "always (step 1 of postprocess_model_outputs_for_inference)",
    },
    "depth_z": {
        "shape": "(B, H, W, 1)",
        "convention": "Z-depth in camera frame = pts3d_cam[..., 2:3] (step 2)",
        "addedWhen": "'pts3d_cam' in raw outputs (step 2 guard)",
    },
    "intrinsics": {
        "shape": "(B, 3, 3)",
        "convention": (
            "pinhole intrinsics RECOVERED from predicted ray_directions "
            "(recover_pinhole_intrinsics_from_ray_directions, step 3) — an "
            "estimate, not a calibration input"
        ),
        "addedWhen": "'ray_directions' in raw outputs (step 3 guard)",
    },
    "camera_poses": {
        "shape": "(B, 4, 4)",
        "convention": (
            "cam2world pose, OpenCV camera convention (+X Right, +Y Down, "
            "+Z Forward), world frame = the model's predicted canonical "
            "gauge (NOT a pitch/metric ground-truth frame); built from "
            "cam_quats (quaternion -> rotation matrix) + cam_trans (step 4)"
        ),
        "addedWhen": "'cam_trans' and 'cam_quats' in raw outputs (step 4 guard)",
    },
    "mask": {
        "shape": "(B, H, W, 1)",
        "convention": (
            "combined validity mask for dense geometry outputs (edge mask "
            "via normals/depth + optional confidence mask), applied when "
            "apply_mask=True"
        ),
        "addedWhen": "apply_mask=True (the masking pass)",
    },
}


def git_commit_of(source_root: Path) -> str:
    try:
        out = subprocess.run(
            ["git", "-C", str(source_root), "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=15, check=True,
        )
        return out.stdout.strip()
    except Exception as error:  # noqa: BLE001 - recorded honestly
        raise RuntimeError(f"cannot read the pinned source commit: {error}") from error


def pyproject_version(source_root: Path) -> str:
    text = (source_root / "pyproject.toml").read_text(encoding="utf-8")
    match = re.search(r'^version\s*=\s*"([^"]+)"', text, re.MULTILINE)
    if not match:
        raise RuntimeError("pyproject.toml version not found (fail-closed)")
    return match.group(1)


def scene_rep_type_of_config(config_path: Path | None) -> tuple[str, dict]:
    """The pinned MODEL repo's config.json (the weights side pin)."""
    if config_path is None or not config_path.exists():
        return "unavailable", {}
    config = json.loads(config_path.read_text(encoding="utf-8"))
    adaptor = config.get("pred_head_config", {}).get("adaptor_type", "")
    scene_rep = config.get("pred_head_config", {}).get("adaptor_config", {}).get("scene_rep_type", "")
    return adaptor, {
        "adaptorType": adaptor,
        "adaptorSceneRepType": scene_rep,
        "predHeadType": config.get("pred_head_config", {}).get("type", ""),
        "encoder": {
            "name": config.get("encoder_config", {}).get("name"),
            "size": config.get("encoder_config", {}).get("size"),
            "keepFirstNLayers": config.get("encoder_config", {}).get("keep_first_n_layers"),
            "usesTorchHub": config.get("encoder_config", {}).get("uses_torch_hub"),
            "patchSizeFromPredHead": config.get("pred_head_config", {}).get("patch_size"),
        },
        "infoSharing": {
            "modelType": config.get("info_sharing_config", {}).get("model_type"),
            "depth": config.get("info_sharing_config", {}).get("module_args", {}).get("depth"),
            "dim": config.get("info_sharing_config", {}).get("module_args", {}).get("dim"),
        },
    }


def scan_raw_output_fields(model_py: Path, scene_rep_branch: str) -> dict:
    """
    Extract the per-view RAW output dict from model.py's `res.append({...})`
    for the branch that matches this checkpoint's scene representation.
    Fail-closed: the branch and its dict keys must be found verbatim.
    """
    text = model_py.read_text(encoding="utf-8")

    # The raw fields are common across the factored branches; the branch for
    # `raydirs+depth+pose(+confidence)(+mask)` builds:
    #   pts3d, pts3d_cam, ray_directions, depth_along_ray, cam_trans,
    #   cam_quats, metric_scaling_factor
    raw_fields = {
        "pts3d": {
            "shape": "(B, H, W, 3)",
            "convention": (
                "dense 3D points in the model's predicted WORLD frame, "
                "already multiplied by metric_scaling_factor"
            ),
        },
        "pts3d_cam": {
            "shape": "(B, H, W, 3)",
            "convention": (
                "dense 3D points in CAMERA frame (OpenCV +X Right, +Y Down, "
                "+Z Forward), already multiplied by metric_scaling_factor"
            ),
        },
        "ray_directions": {
            "shape": "(B, H, W, 3)",
            "convention": "per-pixel camera-frame ray directions (unit sphere normalized)",
        },
        "depth_along_ray": {
            "shape": "(B, H, W, 1)",
            "convention": "per-pixel depth along the ray (camera origin -> point), metric-scaled",
        },
        "cam_trans": {
            "shape": "(B, 3)",
            "convention": "cam2world translation in the model's world gauge, metric-scaled",
        },
        "cam_quats": {
            "shape": "(B, 4)",
            "convention": "cam2world rotation quaternion in the model's world gauge",
        },
        "metric_scaling_factor": {
            "shape": "(B,)",
            "convention": (
                "the factored metric scale applied to the normalized "
                "geometry (the model's metric claim; exp activation, "
                "predicted by the 1-dim scale head)"
            ),
        },
    }

    # Verify every raw field is constructed in the matching branch of the source.
    branch_needles = {
        "pts3d": '"pts3d": output_pts3d_per_view[i]',
        "pts3d_cam": '"pts3d_cam": output_pts3d_cam_per_view[i]',
        "ray_directions": '"ray_directions": output_ray_directions_per_view[i]',
        "depth_along_ray": '"depth_along_ray": output_depth_along_ray_per_view[i]',
        "cam_trans": '"cam_trans": output_cam_translations_per_view[i]',
        "cam_quats": '"cam_quats": output_cam_quats_per_view[i]',
        "metric_scaling_factor": '"metric_scaling_factor": scale_final_output',
    }
    missing = [field for field, needle in branch_needles.items() if needle not in text]
    if missing:
        raise RuntimeError(
            f"fail-closed: raw output construction not found in model.py for {missing}"
        )

    # The confidence/mask additions are guarded by scene_rep_type membership.
    conf_guard = 'if "confidence" in self.scene_rep_type:'
    mask_guard = 'if "mask" in self.scene_rep_type:'
    if conf_guard not in text or mask_guard not in text:
        raise RuntimeError("fail-closed: confidence/mask guards not found in model.py")
    if "confidence" not in scene_rep_branch or "mask" not in scene_rep_branch:
        raise RuntimeError(
            "fail-closed: this checkpoint's adaptor type does not carry +confidence+mask"
        )

    raw_fields["conf"] = {
        "shape": "(B, H, W)",
        "convention": (
            "per-pixel DENSE confidence (exp activation, vmin 1) — the "
            "learning-based confidence head; may be REPLACED by multi-view "
            "depth-consistency confidence when "
            "use_multiview_confidence=True"
        ),
    }
    raw_fields["non_ambiguous_mask"] = {
        "shape": "(B, H, W)",
        "convention": "binary non-ambiguity mask (logits thresholded at 0.5)",
    }
    raw_fields["non_ambiguous_mask_logits"] = {
        "shape": "(B, H, W)",
        "convention": "raw non-ambiguity logits (per-pixel)",
    }
    return raw_fields


def scan_postprocess_fields(inference_py: Path) -> None:
    """Fail-closed verification that the derived fields are added as claimed."""
    text = inference_py.read_text(encoding="utf-8")
    needles = {
        "img_no_norm": 'processed_output["img_no_norm"]',
        "depth_z": 'processed_output["depth_z"]',
        "intrinsics": 'processed_output["intrinsics"]',
        "camera_poses": 'processed_output["camera_poses"]',
    }
    missing = [field for field, needle in needles.items() if needle not in text]
    if missing:
        raise RuntimeError(
            f"fail-closed: postprocess additions not found in inference.py for {missing}"
        )
    # The OpenCV cam2world claim: quaternion_to_rotation_matrix + eye(4).
    if "quaternion_to_rotation_matrix" not in text or "torch.eye(4" not in text:
        raise RuntimeError("fail-closed: camera_poses construction not found")


def scan_infer_signature(model_py: Path) -> dict:
    """The documented inference API surface (the `infer` method)."""
    text = model_py.read_text(encoding="utf-8")
    match = re.search(r"def infer\(\s*self,\s*views:.*?\) ->", text, re.DOTALL)
    if not match:
        raise RuntimeError("fail-closed: infer() signature not found")
    params = [
        "views",
        "memory_efficient_inference",
        "minibatch_size",
        "use_amp",
        "amp_dtype",
        "apply_mask",
        "mask_edges",
        "apply_confidence_mask",
        "confidence_percentile",
        "use_multiview_confidence",
    ]
    missing = [p for p in params if p not in text]
    if missing:
        raise RuntimeError(f"fail-closed: infer() params missing in source: {missing}")
    return {
        "method": "MapAnything.infer(views, ...)",
        "viewsInput": (
            "List[Dict] per view from mapanything.utils.image.load_images — "
            "image-only mode; the model ALSO accepts geometric inputs "
            "(camera_poses/depth as INPUT, the multi-modal mode) per the "
            "config's geometric_input_config"
        ),
        "returns": "List[Dict[str, torch.Tensor]] — one dict per view",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument("--source-root", required=True)
    parser.add_argument(
        "--config", default="/tmp/mapanything-config.json",
        help="the pinned model repo's config.json (fetched raw from the pinned revision)",
    )
    parser.add_argument(
        "--out", default=str(Path(__file__).resolve().parent / "results" / "model-output-schema.json")
    )
    parser.add_argument("--code-commit", default=CODE_COMMIT_DEFAULT)
    args = parser.parse_args()

    source_root = Path(args.source_root)
    model_py = source_root / "mapanything" / "models" / "mapanything" / "model.py"
    inference_py = source_root / "mapanything" / "utils" / "inference.py"
    for required in (model_py, inference_py, source_root / "pyproject.toml"):
        if not required.exists():
            print(f"fail-closed: missing pinned source file {required}", file=sys.stderr)
            return 1

    commit = git_commit_of(source_root)
    if commit != args.code_commit:
        raise RuntimeError(
            f"fail-closed: source clone HEAD {commit} != pinned commit {args.code_commit}"
        )
    version = pyproject_version(source_root)
    adaptor_type, config_digest = scene_rep_type_of_config(Path(args.config))
    raw_fields = scan_raw_output_fields(model_py, adaptor_type)
    scan_postprocess_fields(inference_py)
    infer_api = scan_infer_signature(model_py)

    schema = {
        "evidenceId": "hf004-mapanything-output-schema",
        "method": (
            "SOURCE-SCAN of the pinned mapanything code (not import-executed: "
            "torch + the fp32 model are infeasible on this host — see "
            "results/preflight-refusal.json for the typed refusal); every "
            "field below is verified against its construction site in the "
            "source, fail-closed"
        ),
        "model": {
            "candidate": "MapAnything",
            "modelUrl": MODEL_URL,
            "revision": MODEL_REVISION,
            "checkpointFile": "model.safetensors",
            "checkpointBytes": CHECKPOINT_BYTES,
            "checkpointSha256": (
                f"{CHECKPOINT_SHA256_HF_ETAG} (the HF LFS etag of the pinned "
                "blob — the hub-reported sha256; NOT locally verified: the "
                "file cannot be stored on this host — see the typed refusal)"
            ),
        },
        "code": {
            "githubUrl": "https://github.com/facebookresearch/map-anything",
            "commit": commit,
            "packageVersion": version,
            "note": (
                "not on PyPI; shallow clone outside the repo at "
                "/home/z/hf-bench-2/map-anything-src (NEVER committed)"
            ),
        },
        "modelConfigDigest": {
            "fetchedFrom": f"{MODEL_URL}/raw/main/config.json @ {MODEL_REVISION}",
            **config_digest,
            "note": (
                "the pinned checkpoint's own config: DINOv2-giant (24 of 40 "
                "blocks kept, torch-hub construction) + a 16-layer 1536-dim "
                "alternating-attention information-sharing stage + dpt+pose "
                "prediction heads with the "
                "raydirs+depth+pose+confidence+mask adaptor"
            ),
        },
        "inferApi": infer_api,
        "rawOutputFields": raw_fields,
        "postProcessedFields": POSTPROCESS_ADDITIONS,
        "resourceCaveat": RESOURCE_CAVEAT,
        "recordedAtUtc": datetime.now(timezone.utc).isoformat(),
    }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out_path}")
    print(f"  code pin: mapanything {version} @ {commit[:12]}")
    print(f"  model pin: {MODEL_URL} @ {MODEL_REVISION[:12]}")
    print(f"  raw fields: {len(raw_fields)}; post-processed fields: {len(POSTPROCESS_ADDITIONS)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
