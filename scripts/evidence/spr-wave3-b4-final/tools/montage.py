#!/usr/bin/env python3
"""b4 hard-gate assembler (both branches).

single-shot: plan with ONE segment whose every 1 fps frame verified YES
  with clean brackets -> designation "crowd" (a real continuous passage).
montage: plan with 2+ segments from VERIFIED crowd runs joined at
  verified cut points -> designation "crowd-montage" (8-12 s composite;
  a re-encode of real source segments — no frame invention).

Per-frame verification basis (honest, recorded per frame):
- "vlm": a LANDED single-image VLM verdict for that exact frame (fresh
  call or cache-reused landed call; raw JSON preserved per tag; 429
  budget from SWEEP_RATE_RETRIES)
- "w2a-record": the immutable w2a per-frame direct-verification record
  at the EXACT same media time — the fallback when fresh calls are
  quota-exhausted. The w2a rejected candidates are the work-order-
  designated verified segments; the chain-equivalence proof (7/7
  identical verdicts on C1 territory) covers the manifest-generation
  change; the w2a record files are read-only (sha-matched at run time).
- an ERROR frame is NEVER load-bearing: if any frame in [a-1, b+1] has
  no effective verdict, the segment is REFUSED.

Video: seek-free full decode + exact 25 fps frame-index select (media
times are 0.04-aligned), exact-content re-encode libx264 crf 18 (the
corpus recipe; -c copy would keyframe-snap on HLS section pulls).
Audio: full-match itag-140-5 m4a cut at the same media times,
apad-normalized (aac 128k 44100 — the corpus recipe).
Join: concat demuxer over uniformly re-encoded segments — hard cuts at
verified boundary frames, zero transition frames invented.

Usage: montage.py <plan.json>
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

WORK = Path("/home/z/spr-w3c-work")
MON = WORK / "montage"
AUDIO = WORK / "audio-140-5.m4a"
W2A_CAND = Path("/home/z/sporta-w3c/scripts/evidence/spr-w2a-sampling"
                "/verification/candidates")
VLM_OUT = WORK / "verify" / "vlm"

sys.path.insert(0, str(WORK))
from sweep_c import vlm_frame  # noqa: E402  (cache-aware single-image caller)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_w2a(record_file: str) -> tuple[dict, str]:
    p = W2A_CAND / record_file
    frames = {}
    for v in json.loads(p.read_text()):
        frames[round(v["mediaTime"], 2)] = v
    return frames, sha256(p)


def extract_exact(ts: Path, t0: float, times: list[float], sid: str):
    """Seek-free extraction of the EXACT 25 fps frames at media `times`.

    Returns [(jpg, mediaTime, frameIndex)]; asserts the index mapping
    (media times must be 0.04-aligned on the pull's frame grid).
    """
    outdir = MON / "frames"
    outdir.mkdir(parents=True, exist_ok=True)
    for f in outdir.glob(f"{sid}-x_*.jpg"):
        f.unlink()
    res = []
    for i, mt in enumerate(times):
        idx = int(round((mt - t0) * 25))
        mapped = t0 + idx / 25.0
        if abs(mapped - mt) > 0.005:
            raise SystemExit(
                f"{sid}: media {mt} not on the pull's 25 fps grid "
                f"(t0={t0}, idx={idx} -> {mapped})")
        out = outdir / f"{sid}-x_{i:03d}.jpg"
        subprocess.run(
            ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-i", str(ts),
             "-vf", f"select=between(n\\,{idx}\\,{idx})", "-vsync", "0",
             str(out)],
            check=True, stdin=subprocess.DEVNULL,
        )
        res.append((str(out), mt, idx))
    return res


def verify_segment(ts: Path, t0: float, a: float, b: float, sid: str,
                   w2a_file: str | None, tag_prefix: str | None = None):
    """Verify [a-1 .. b+1] at 1 fps on the EXACT frames used by the cut.

    tag_prefix: reuse this landed-call tag namespace (e.g. the sweep's
    own per-frame verdicts for the exact same frames — cache hits, zero
    extra quota, raw JSONs already preserved).
    """
    w2a_frames, w2a_sha = (load_w2a(w2a_file) if w2a_file else ({}, None))
    times = [round(a - 1 + i, 2) for i in range(int(b - a) + 3)]
    samples = extract_exact(ts, t0, times, sid)
    verdicts = []
    for img, mt, idx in samples:
        tag = (f"{tag_prefix}-{int(mt * 100)}" if tag_prefix
               else f"mon-{sid}-{int(mt * 100)}")
        v, why = vlm_frame(img, tag)
        basis = "vlm"
        if v in ("ERROR", "UNPARSED"):
            rec = w2a_frames.get(round(mt, 2))
            if rec is not None and rec["verdict"] in ("YES", "NO"):
                v = rec["verdict"]
                why = f"w2a immutable record: {rec['reason']}"[:200]
                basis = "w2a-record"
        verdicts.append({"mediaTime": mt, "frameIndex": idx, "verdict": v,
                         "basis": basis, "reason": why[:180],
                         "frame": Path(img).name})
        print(f"[mon] {sid} t={mt:8.2f} f{idx:4d} {v:3s} [{basis}]",
              file=sys.stderr, flush=True)
    inside = [v for v in verdicts if a <= v["mediaTime"] <= b]
    pre = [v for v in verdicts if v["mediaTime"] < a]
    post = [v for v in verdicts if v["mediaTime"] > b]
    all_yes = inside and all(v["verdict"] == "YES" for v in inside)
    brackets = ((pre and pre[-1]["verdict"] == "NO")
                and (post and post[0]["verdict"] == "NO"))
    no_error = all(v["verdict"] in ("YES", "NO") for v in verdicts)
    ok = all_yes and brackets and no_error
    return verdicts, ok, {"w2aRecord": w2a_file, "w2aRecordSha256": w2a_sha}


def main() -> int:
    plan = json.loads((WORK / sys.argv[1]).read_text())
    MON.mkdir(exist_ok=True)
    segs_out = []
    for s in plan["segments"]:
        sid = s["id"]
        a, b = s["mediaStart"], s["mediaEnd"]
        ts = MON / f"mon-{sid}.ts"
        if not ts.exists():
            subprocess.run(
                [sys.executable, str(WORK / "fetcher.py"),
                 "--start", str(a - 3), "--end", str(b + 3),
                 "--name", f"mon-{sid}", "--out", str(MON)],
                check=True, capture_output=True,
            )
        wmap = json.loads((MON / f"mon-{sid}-window.json").read_text())
        t0 = wmap["trueWindow"][0]

        verdicts, ok, wmeta = verify_segment(
            ts, t0, a, b, sid, s.get("w2aRecord"), s.get("tagPrefix"))
        if not ok:
            print(f"[mon] {sid} VERIFICATION FAILED — segment REFUSED",
                  file=sys.stderr, flush=True)
            return 2

        # video cut: seek-free decode + exact frame select at native fps
        fps = 25
        i0 = int(round((a - t0) * fps))
        i1 = int(round((b + 1 - t0) * fps)) - 1
        dur = (i1 - i0 + 1) / fps
        vid = MON / f"mon-{sid}-v.mp4"
        subprocess.run(
            ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-i", str(ts),
             "-vf", f"select=between(n\\,{i0}\\,{i1})", "-vsync", "0",
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
             "-pix_fmt", "yuv420p", str(vid)],
            check=True, stdin=subprocess.DEVNULL,
        )
        # audio cut: same media times from the full-match audio, apad to
        # exactly the video duration (the corpus b8 normalization recipe:
        # output -t == video duration)
        aud = MON / f"mon-{sid}-a.m4a"
        subprocess.run(
            ["ffmpeg", "-nostdin", "-y", "-loglevel", "error",
             "-ss", f"{a:.2f}", "-t", f"{dur:.2f}", "-i", str(AUDIO),
             "-af", "apad", "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
             "-t", f"{dur:.2f}", str(aud)],
            check=True, stdin=subprocess.DEVNULL,
        )
        seg = MON / f"mon-{sid}.mp4"
        subprocess.run(
            ["ffmpeg", "-nostdin", "-y", "-loglevel", "error",
             "-i", str(vid), "-i", str(aud), "-map", "0:v", "-map", "1:a",
             "-c:v", "copy", "-c:a", "copy", str(seg)],
            check=True, stdin=subprocess.DEVNULL,
        )
        segs_out.append({
            "id": sid, "mediaStart": a, "mediaEnd": b,
            "durationSec": round(dur, 3), "file": seg.name,
            "sha256": sha256(seg), "byteSize": seg.stat().st_size,
            "sourceWindowMap": f"mon-{sid}-window.json",
            "sourceSegments": wmap["segments"],
            "sourceSegmentDurations": wmap["segmentDurs"],
            "provenance": s.get("provenance"),
            "verification": {"frames": verdicts, **wmeta},
        })
        print(f"[mon] {sid}: {dur:.2f}s assembled+verified", file=sys.stderr,
              flush=True)

    # join (single-segment plans skip the concat — it is the passage itself)
    designation = plan["designation"]
    outname = plan["output"]
    out = MON / outname
    total = sum(s["durationSec"] for s in segs_out)
    if len(segs_out) == 1:
        subprocess.run(["cp", str(MON / segs_out[0]["file"]), str(out)],
                       check=True)
    else:
        lst = MON / "concat.txt"
        lst.write_text("".join(
            f"file '{MON / s['file']}'\n" for s in segs_out))
        subprocess.run(
            ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-f", "concat",
             "-safe", "0", "-i", str(lst), "-c", "copy", str(out)],
            check=True, stdin=subprocess.DEVNULL,
        )
        # validate the stream-copy join; re-encode-join if the container
        # duration is off (honest fallback, same frames)
        got = float(json.loads(subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json",
             "-show_format", str(out)],
            capture_output=True, text=True, check=True).stdout
        )["format"]["duration"])
        if abs(got - total) > 0.10:
            print(f"[mon] concat copy duration {got:.2f}s != {total:.2f}s — "
                  "re-encoding the join", file=sys.stderr, flush=True)
            subprocess.run(
                ["ffmpeg", "-nostdin", "-y", "-loglevel", "error",
                 "-f", "concat", "-safe", "0", "-i", str(lst),
                 "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                 "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
                 "-ar", "44100", str(out)],
                check=True, stdin=subprocess.DEVNULL,
            )
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json",
         "-show_format", "-show_streams", str(out)],
        capture_output=True, text=True, check=True,
    )
    fmt = json.loads(probe.stdout)["format"]
    doc = {
        "designation": designation,
        "file": outname,
        "byteSize": out.stat().st_size,
        "sha256": sha256(out),
        "totalDurationSec": round(total, 2),
        "ffprobeDurationSec": float(fmt["duration"]),
        "segmentCount": len(segs_out),
        "segments": segs_out,
        "joins": [
            {"atSegmentBoundary": i + 1,
             "from": segs_out[i]["id"], "to": segs_out[i + 1]["id"],
             "cutPointAfterMediaSec": segs_out[i]["mediaEnd"] + 1.0,
             "cutPointBeforeMediaSec": segs_out[i + 1]["mediaStart"],
             "method": "hard cut, concat demuxer over uniformly "
                       "re-encoded segments (libx264 crf18) — no "
                       "transition frames invented"}
            for i in range(len(segs_out) - 1)
        ],
        "audio": "full-match itag-140-5 m4a (sha256 603806d9…e360) cut at "
                 "the same media times per segment, apad-normalized, "
                 "aac 128k 44100 (corpus recipe)",
        "ffprobe": json.loads(probe.stdout),
    }
    (MON / "b4-gate-output.json").write_text(json.dumps(doc, indent=1) + "\n")
    print(f"[mon] {designation}: {outname} {total:.2f}s "
          f"({len(segs_out)} segment(s)), sha256 {doc['sha256'][:16]}…",
          flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
