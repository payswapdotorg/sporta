#!/usr/bin/env python3
"""SPR303 — the EXECUTED AnimeGANv2 trial on the b8 substrate (worker 65-i).

The SPR lane's first executed neural run. Per the SPR302 matrix's wave-2 pick:
AnimeGANv2 (ONE style: Hayao, from the vumichien/AnimeGANv2_Hayao ONNX mirror
the matrix recorded @ f84714b4) per-frame stylization over the b8 sample
frames, A/B against the committed deterministic-stylizer baseline scorecards
(anime-npr / cartoon-cel — the collapse axes: minAxisMean 1.80 / 1.53).

The frozen sample design is vlm_scorecard.py's (scripts/source-preserving/
vlm_scorecard.py — the frozen 7-axis acceptance protocol): t = 2/8/15/30/45 s
plus cut-adjacent pre/post for every frozen b8 input cut, each stylized
sample paired with a within-shot partner at ±0.2 s. Subcommands:

  extract     — original@t for the 15 samples (the VLM Image 1s) -> frames/
  stylize     — stylized@t + stylized@partner (30 PNGs) -> renders/, recording
                per-frame CPU wall-clock latency (decode/inference/encode) +
                a sha256 map + the 30-frame latency-probe block (300..329,
                mid-shot, /tmp — measurement only, not VLM evidence)
  stylize-raw — the same 30 stylizations into an arbitrary dir, NO records
                (the determinism phase re-invokes this in a FRESH interpreter)
  determinism — double-run byte-identity: re-extract the originals, re-stylize
                the 30 trial frames fresh, sha-compare with run 1 (the
                committed renders/) -> results/determinism.json

Every number this script writes comes from a run EXECUTED on this host
(onnxruntime CPUExecutionProvider — this host has NO GPU; honestly labeled).
The substrate + weights sha are verified before any run (fail-closed). On any
failure the script exits non-zero.
"""
from __future__ import annotations

import hashlib
import json
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent.parent  # scripts/evidence/spr303-animeganv2-trial -> repo root
SUBSTRATE = REPO / "scripts/evidence/spr-corpus-bytes/b8p3.mp4"
SUBSTRATE_SHA256 = (
    "969af7c6fdb172091ff00705b25fa37b7073f4332d722416b9754a4a7579917a"
)
WEIGHTS = Path("/home/z/hf-bench-13/weights/AnimeGANv2_Hayao.onnx")
WEIGHTS_SHA256 = (
    "5a84ca468f3c4fd891fe8c883a3a507ed3e463f4f059985735f6449dae7590b5"
)

# the frozen sample design (vlm_scorecard.py constants, verbatim)
INPUT_CUTS = [189, 475, 550, 862, 979, 982]
FIXED_T = [2, 8, 15, 30, 45]
CUT_OFFSET = 3
CLUSTER_GAP = 5
TEMPORAL_DELTA_S = 0.2
FPS = 25

LATENCY_BLOCK = (300, 329)  # mid-shot [192,472): no frozen cut inside


def samples() -> list[dict]:
    events: list[list[int]] = []
    for f in INPUT_CUTS:
        if events and f - events[-1][1] <= CLUSTER_GAP:
            events[-1][1] = f
        else:
            events.append([f, f])
    out = []
    for t in FIXED_T:
        out.append({"id": f"t{t}s", "kind": "fixed", "t": float(t)})
    for start, end in events:
        out.append({"id": f"c{start}pre", "kind": "cut-adjacent",
                    "t": (start - CUT_OFFSET) / FPS})
        out.append({"id": f"c{end}post", "kind": "cut-adjacent",
                    "t": (end + CUT_OFFSET) / FPS})
    return out


def partner_t(s: dict) -> float:
    # within-shot temporal partner: pre-cut samples pair BACKWARDS so the pair
    # never crosses a source cut (the cut is source content, preserved)
    if s["kind"] == "cut-adjacent" and s["id"].endswith("pre"):
        return s["t"] - TEMPORAL_DELTA_S
    return s["t"] + TEMPORAL_DELTA_S


def sample_frame_ids() -> list[str]:
    ids = []
    for s in samples():
        ids.append(s["id"])
        ids.append(f"{s['id']}p2")
    return ids


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def extract_frame(src: Path, t: float, dst: Path) -> bool:
    if dst.exists():
        return True
    dst.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t:.3f}",
         "-i", str(src), "-frames:v", "1", str(dst)],
        capture_output=True, text=True, timeout=120,
    )
    return proc.returncode == 0 and dst.exists()


def check_pins() -> None:
    if not SUBSTRATE.exists():
        sys.exit(f"FATAL: substrate missing: {SUBSTRATE}")
    actual = sha256_file(SUBSTRATE)
    if actual != SUBSTRATE_SHA256:
        sys.exit(f"FATAL: substrate sha drift: {actual} != {SUBSTRATE_SHA256}")
    if not WEIGHTS.exists():
        sys.exit(f"FATAL: weights missing: {WEIGHTS}")
    actual = sha256_file(WEIGHTS)
    if actual != WEIGHTS_SHA256:
        sys.exit(f"FATAL: weights sha drift: {actual} != {WEIGHTS_SHA256}")


def stylize_one(sess, in_name: str, out_name: str, src: Path, dst: Path) -> dict:
    """Decode -> ONNX infer -> encode, with per-phase wall-clock (ms)."""
    import numpy as np
    from PIL import Image

    t0 = time.perf_counter()
    img = Image.open(src).convert("RGB")
    x = (np.asarray(img).astype(np.float32) / 127.5 - 1.0)[np.newaxis, ...]
    t1 = time.perf_counter()
    y = sess.run([out_name], {in_name: x})[0]
    t2 = time.perf_counter()
    arr = np.clip((y[0] + 1.0) * 127.5, 0, 255).astype(np.uint8)
    dst.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr).save(dst, format="PNG")
    t3 = time.perf_counter()
    return {
        "decodeMs": round((t1 - t0) * 1000, 1),
        "inferenceMs": round((t2 - t1) * 1000, 1),
        "encodeMs": round((t3 - t2) * 1000, 1),
        "totalMs": round((t3 - t0) * 1000, 1),
    }


def cmd_extract() -> int:
    check_pins()
    out_dir = HERE / "frames"
    for s in samples():
        dst = out_dir / f"original-{s['id']}.png"
        ok = extract_frame(SUBSTRATE, s["t"], dst)
        print(f"original-{s['id']}.png ok={ok}", flush=True)
        if not ok:
            return 1
    return 0


def stylize_trial_frames(out_dir: Path, measure: bool) -> tuple[list[dict], dict[str, str]]:
    """Stylize the 30 trial frames (15 samples + 15 partners) -> out_dir.

    The partner source frames are extracted fresh into out_dir/src (they are
    inputs to the run, not committed evidence). Returns (latencies, sha map).
    """
    import onnxruntime as ort

    sess = ort.InferenceSession(str(WEIGHTS), providers=["CPUExecutionProvider"])
    in_name = sess.get_inputs()[0].name
    out_name = sess.get_outputs()[0].name
    per_frame: list[dict] = []
    sha_map: dict[str, str] = {}
    src_dir = out_dir / "src"
    for s in samples():
        for label, t in (("s", s["t"]), ("p", partner_t(s))):
            fid = s["id"] if label == "s" else f"{s['id']}p2"
            src = src_dir / f"{fid}.png"
            if not extract_frame(SUBSTRATE, t, src):
                sys.exit(f"FATAL: partner extraction failed for {fid}")
            dst = out_dir / f"animeganv2-hayao-{fid}.png"
            lat = stylize_one(sess, in_name, out_name, src, dst)
            if measure:
                lat.update({"id": fid, "sourceT": t,
                            "output": str(dst.relative_to(REPO))})
                per_frame.append(lat)
            sha_map[fid] = sha256_file(dst)
            print(f"{fid}: {lat['totalMs']}ms (infer {lat['inferenceMs']}ms)",
                  flush=True)
    return per_frame, sha_map


def cmd_stylize() -> int:
    check_pins()
    import onnxruntime as ort

    out_dir = HERE / "renders"
    per_frame, sha_map = stylize_trial_frames(out_dir, measure=True)

    # the latency-probe block: 30 consecutive mid-shot frames, one-pass
    # extraction (300..329 — no frozen cut inside [192,472)); rendered into
    # /tmp — a latency measurement set, NOT VLM evidence (typed)
    block_dir = Path("/tmp/spr303-latency-block")
    if block_dir.exists():
        shutil.rmtree(block_dir)
    block_dir.mkdir(parents=True)
    proc = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(SUBSTRATE),
         "-vf", f"select='between(n,{LATENCY_BLOCK[0]},{LATENCY_BLOCK[1]})'",
         "-vsync", "0", str(block_dir / "src-%04d.png")],
        capture_output=True, text=True, timeout=300,
    )
    if proc.returncode != 0:
        print(proc.stderr[-500:], file=sys.stderr)
        return 1
    srcs = sorted(block_dir.glob("src-*.png"))
    if len(srcs) != 30:
        return 1
    sess = ort.InferenceSession(str(WEIGHTS), providers=["CPUExecutionProvider"])
    in_name = sess.get_inputs()[0].name
    out_name = sess.get_outputs()[0].name
    for i, src in enumerate(srcs):
        fid = f"block{LATENCY_BLOCK[0] + i}"
        dst = block_dir / f"animeganv2-hayao-{fid}.png"
        lat = stylize_one(sess, in_name, out_name, src, dst)
        lat.update({"id": fid, "sourceFrame": LATENCY_BLOCK[0] + i,
                    "output": str(dst),
                    "evidenceClass": "latency-probe-only (not VLM evidence)"})
        per_frame.append(lat)
        print(f"{fid}: {lat['totalMs']}ms (infer {lat['inferenceMs']}ms)",
              flush=True)

    def pct(vals: list[float], p: float) -> float:
        s = sorted(vals)
        k = min(len(s) - 1, max(0, int(round((p / 100.0) * (len(s) - 1)))))
        return round(s[k], 1)

    totals = [f["totalMs"] for f in per_frame]
    infers = [f["inferenceMs"] for f in per_frame]
    record = {
        "schemaVersion": "1.0",
        "flight": "SPR303 — the executed AnimeGANv2 trial (worker 65-i)",
        "measurement": "per-frame stylization wall-clock, EXECUTED on this host",
        "host": {
            "label": "CPU-only host (onnxruntime CPUExecutionProvider)",
            "machine": platform.machine(),
            "python": platform.python_version(),
            "onnxruntime": ort.__version__,
            "vcpu": 2,
            "gpu": "NONE — no GPU execution provider on this host (honest)",
            "provider": "CPUExecutionProvider",
        },
        "frameCount": len(per_frame),
        "frameSet": ("the frozen 15 scorecard samples + their 15 within-shot "
                     "±0.2 s partners (30 trial frames) + 30 consecutive "
                     "mid-shot latency-probe frames (300..329, no cut in "
                     "[192,472)) — 60 stylizations executed"),
        "perFrame": per_frame,
        "p50TotalMs": pct(totals, 50),
        "p95TotalMs": pct(totals, 95),
        "p50InferenceMs": pct(infers, 50),
        "p95InferenceMs": pct(infers, 95),
        "meanTotalMs": round(sum(totals) / len(totals), 1),
        "fullClipArithmetic": (
            "arithmetic FROM the executed p50 (labeled arithmetic, NOT a "
            "measured full render): 1190 b8 frames x "
            f"{pct(totals, 50)} ms = "
            f"{round(1190 * pct(totals, 50) / 1000 / 60, 1)} min/clip CPU — "
            "the full-render latency is a typed gap on this trial "
            "(trial-is-sampled-frames-not-full-render)"
        ),
        "rendersSha256": sha_map,
    }
    rec = HERE / "results" / "latency.json"
    rec.parent.mkdir(parents=True, exist_ok=True)
    rec.write_text(json.dumps(record, indent=1))
    print(f"latency record -> {rec}", flush=True)
    print(f"p50={record['p50TotalMs']}ms p95={record['p95TotalMs']}ms over "
          f"{len(per_frame)} frames", flush=True)
    return 0


def cmd_stylize_raw(out_dir: Path) -> int:
    """The determinism run: same 30 stylizations, fresh process, no records."""
    check_pins()
    stylize_trial_frames(out_dir, measure=False)
    return 0


def cmd_determinism() -> int:
    check_pins()
    run2 = Path("/tmp/spr303-det-run2")
    if run2.exists():
        shutil.rmtree(run2)
    run2.mkdir(parents=True)
    # run 2: a FRESH interpreter (fresh onnxruntime session) — this is the
    # double-run leg; exit code checked (a crashed run fails the phase)
    proc = subprocess.run(
        [sys.executable, str(HERE / "trial_animegan.py"), "stylize-raw", str(run2)],
        capture_output=True, text=True, timeout=1200,
    )
    print(proc.stdout[-1500:], flush=True)
    if proc.returncode != 0:
        print(proc.stderr[-1500:], file=sys.stderr)
        return 1

    run1_dir = HERE / "renders"
    frames: dict[str, dict] = {}
    all_same = True
    for fid in sample_frame_ids():
        f1 = run1_dir / f"animeganv2-hayao-{fid}.png"
        f2 = run2 / f"animeganv2-hayao-{fid}.png"
        if not (f1.exists() and f2.exists()):
            print(f"FATAL: missing run artifact for {fid}", file=sys.stderr)
            return 1
        s1, s2 = sha256_file(f1), sha256_file(f2)
        same = s1 == s2
        all_same = all_same and same
        frames[fid] = {"run1": s1, "run2": s2, "byteIdentical": same}

    # extraction determinism: the 15 originals re-extracted twice + compared
    # with the committed frames/
    ext_dir = Path("/tmp/spr303-det-extract")
    if ext_dir.exists():
        shutil.rmtree(ext_dir)
    ext_all_same = True
    ext_frames: dict[str, dict] = {}
    for s in samples():
        a = ext_dir / f"a-{s['id']}.png"
        b = ext_dir / f"b-{s['id']}.png"
        if not (extract_frame(SUBSTRATE, s["t"], a)
                and extract_frame(SUBSTRATE, s["t"], b)):
            return 1
        sa, sb = sha256_file(a), sha256_file(b)
        committed = sha256_file(HERE / "frames" / f"original-{s['id']}.png")
        same = sa == sb == committed
        ext_all_same = ext_all_same and same
        ext_frames[s["id"]] = {"extractA": sa, "extractB": sb,
                               "committed": committed,
                               "byteIdentical": same}

    record = {
        "schemaVersion": "1.0",
        "flight": "SPR303 — the executed AnimeGANv2 trial (worker 65-i)",
        "measurement": "double-run byte-identity of the stylized outputs "
                       "(the anime-npr G-T5 determinism convention, "
                       "sampled-frame class)",
        "method": ("the 30 stylized frames re-stylized in a FRESH interpreter "
                   "(fresh onnxruntime session) into /tmp/spr303-det-run2; "
                   "sha256 per frame compared with run 1 (the committed "
                   "renders/ artifacts); the 15 originals re-extracted twice "
                   "and compared with the committed frames/"),
        "stylizedFrames": frames,
        "byteIdentical": all_same,
        "originalExtraction": ext_frames,
        "extractionByteIdentical": ext_all_same,
        "verdict": (
            "deterministic — proven by double-run byte-identity "
            "(CPUExecutionProvider: fixed weights sha " + WEIGHTS_SHA256[:12]
            + "…, fixed input bytes, fixed session settings)"
            if all_same and ext_all_same else
            "NON-DETERMINISTIC — honestly recorded; the per-frame sha pairs "
            "above are the evidence"
        ),
    }
    out = HERE / "results" / "determinism.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(record, indent=1))
    print(f"determinism record -> {out} (byteIdentical={all_same}, "
          f"extraction={ext_all_same})", flush=True)
    return 0


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: trial_animegan.py extract|stylize|stylize-raw|determinism",
              file=sys.stderr)
        return 2
    cmd = sys.argv[1]
    if cmd == "extract":
        return cmd_extract()
    if cmd == "stylize":
        return cmd_stylize()
    if cmd == "stylize-raw":
        if len(sys.argv) < 3:
            print("stylize-raw needs an out dir", file=sys.stderr)
            return 2
        return cmd_stylize_raw(Path(sys.argv[2]))
    if cmd == "determinism":
        return cmd_determinism()
    print(f"unknown command {cmd}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
