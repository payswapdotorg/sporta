#!/usr/bin/env python3
"""Sweep phase C: DIRECT per-frame verification of crowd-flagged runs.

The w2a discipline (all three incidents are the law):
- SEEK-FREE extraction: full sequential decode of the window TS + select by
  frame index (TS input-seeks land seconds off on concatenated VBR)
- ONE image per VLM call (multi-image calls mis-attribute)
- UNLINK-BEFORE-ATTEMPT (vlm1.py) + strict prompt: YES only when
  spectators/stands occupy more than half of the frame
- Bracketing BOTH ends: a run counts only if every frame in it is
  crowd-dominant AND the frames on both sides are clean NOs
- Runs touching a window edge get a boundary-extension pull to bracket
  outside (the w2a w4160-wide pattern; counted in coverage by its
  non-overlapping part)

Usage: sweep-c.py            (verify all crowd candidates from sweep-b)
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

WORK = Path("/home/z/spr-w3c-work")
SWEEP = WORK / "sweep"
VERIFY = WORK / "verify"

# per-call 429 wait budget (worker instruction: after the budget, honest
# ERROR; every ERROR frame documented, none load-bearing). Escalating pass
# runner re-runs only ERROR frames — landed verdicts are cache-reused.
RATE_RETRIES = os.environ.get("SWEEP_RATE_RETRIES", "10")

PROMPT = (
    "Look at this single frame from a soccer broadcast. Do spectators/crowd "
    "in the stands occupy more than half of the total frame area? Answer "
    "with exactly one word YES or NO, then one short sentence explaining "
    "what occupies the frame."
)


def extract_frames(ts: Path, true_start: float, a: float, b: float, outdir: Path,
                   tag: str) -> list[tuple[str, float]]:
    """Seek-free 1fps extraction of frames covering media [a, b]."""
    outdir.mkdir(parents=True, exist_ok=True)
    i0 = max(0, int(a - true_start))
    i1 = int(b - true_start)
    frames = []
    for f in sorted(outdir.glob(f"{tag}_*.jpg")):
        f.unlink()
    subprocess.run(
        ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-i", str(ts),
         "-vf", f"fps=1,select=between(n\\,{i0}\\,{i1})",
         "-vsync", "0", str(outdir / f"{tag}_%03d.jpg")],
        check=True, stdin=subprocess.DEVNULL,
    )
    for n, f in enumerate(sorted(outdir.glob(f"{tag}_*.jpg")), start=i0):
        frames.append((str(f), round(true_start + n, 2)))
    return frames


def vlm_frame(image: str, tag: str) -> tuple[str, str]:
    outjson = VERIFY / "vlm" / f"{tag}.json"
    outjson.parent.mkdir(parents=True, exist_ok=True)
    # cache: a previously-successful verdict for the SAME tag is reused
    # (tags are frame-unique: window-run-centisecond)
    if outjson.exists():
        data = json.loads(outjson.read_text())
        if "error" not in data:
            content = data["choices"][0]["message"]["content"].strip()
            first = content.split()[0].strip(".,:").upper()
            verdict = "YES" if first == "YES" else (
                "NO" if first == "NO" else "UNPARSED")
            return (verdict, content.replace("\n", " ")[:220])
    time.sleep(6)  # pacing
    rc = subprocess.run(
        [sys.executable, str(WORK / "vlm1.py"), image, PROMPT, str(outjson),
         "--tag", tag, "--rate-retries", RATE_RETRIES],
    ).returncode
    if rc != 0:
        detail = "vlm call failed after retries"
        try:  # surface the honest per-call failure detail if present
            d = json.loads(outjson.read_text())
            if "error" in d:
                detail = str(d.get("detail", detail))[:160]
        except Exception:  # noqa: BLE001 — detail is best-effort
            pass
        return ("ERROR", detail)
    data = json.loads(outjson.read_text())
    if "error" in data:
        return ("ERROR", data.get("detail", "vlm error")[:120])
    content = data["choices"][0]["message"]["content"].strip()
    first = content.split()[0].strip(".,:").upper()
    verdict = "YES" if first == "YES" else ("NO" if first == "NO" else "UNPARSED")
    return (verdict, content.replace("\n", " ")[:220])


def main() -> int:
    cands = json.loads((WORK / "sweep-crowd-candidates.json").read_text())
    windows = {}
    for w in json.loads((WORK / "window-plan-final.json").read_text()):
        if "error" not in w:
            windows[w["name"]] = w
    results = []
    # longest run first (the only >=8s single-shot candidate leads); k keeps
    # the ORIGINAL candidate numbering so landed cache tags stay reusable
    order = sorted(range(len(cands)),
                   key=lambda i: cands[i]["runEnd"] - cands[i]["runStart"],
                   reverse=True)
    for k0 in order:
        k = k0 + 1
        c = cands[k0]
        name = c["window"]
        w = windows[name]
        ts = SWEEP / f"{name}.ts"
        wmap = json.loads((SWEEP / f"{name}-window.json").read_text())
        t0, t1 = wmap["trueWindow"]
        a, b = c["runStart"], c["runEnd"]
        # bracket: 2 s on each side inside the window; if the run touches an
        # edge, a boundary-extension pull brackets outside (once, recorded)
        ext_tag = None
        need_ext = a - 2 < t0 or b + 2 > t1
        if need_ext:
            ea = a - 4 if a - 2 < t0 else a
            eb = b + 4 if b + 2 > t1 else b
            ext_tag = f"ext-{name}-{k}"
            ets = VERIFY / f"{ext_tag}.ts"
            if not ets.exists():
                subprocess.run(
                    [sys.executable, str(WORK / "fetcher.py"),
                     "--start", str(max(0.0, ea)), "--end", str(eb),
                     "--name", ext_tag, "--out", str(VERIFY)],
                    check=True, capture_output=True,
                )
            emap = json.loads((VERIFY / f"{ext_tag}-window.json").read_text())
            if a - 2 < t0:  # bracket before window start via extension pull
                ts, t0 = ets, emap["trueWindow"][0]
            if b + 2 > t1:  # bracket after window end via extension pull
                # verify the tail inside the extension pull
                tail_frames = extract_frames(
                    ets, emap["trueWindow"][0], b, min(b + 2, emap["trueWindow"][1]),
                    VERIFY / "frames", f"{ext_tag}-tail")
                head_frames = extract_frames(
                    SWEEP / f"{name}.ts", wmap["trueWindow"][0],
                    max(a - 2, t0), min(b, t1), VERIFY / "frames", f"{name}-{k}")
                frames = head_frames + tail_frames
            else:
                frames = extract_frames(ts, t0, max(a - 2, t0), b,
                                        VERIFY / "frames", f"{name}-{k}")
        else:
            frames = extract_frames(ts, t0, a - 2, b + 2, VERIFY / "frames",
                                    f"{name}-{k}")
        verdicts = []
        for img, mt in frames:
            v, why = vlm_frame(img, f"{name}-{k}-{int(mt*100)}")
            verdicts.append({"mediaTime": mt, "verdict": v, "reason": why,
                             "frame": Path(img).name})
            print(f"[verify] {name} run {a}-{b}: t={mt:8.2f} {v}  {why[:60]}",
                  file=sys.stderr)
        results.append({
            "candidate": c, "extensionPull": ext_tag,
            "framesChecked": len(verdicts), "verdicts": verdicts,
        })
    (WORK / "verify-results.json").write_text(json.dumps(results, indent=1) + "\n")

    # summarize runs: consecutive YES runs with clean brackets
    print("\n=== VERIFIED RUNS ===")
    for r in results:
        vs = r["verdicts"]
        runs, cur = [], None
        for v in vs:
            if v["verdict"] == "YES":
                if cur is None:
                    cur = [v["mediaTime"], v["mediaTime"]]
                else:
                    cur[1] = v["mediaTime"]
            else:
                if cur:
                    runs.append(cur)
                    cur = None
        if cur:
            runs.append(cur)
        for a, b in runs:
            dur = b - a + 1.0
            idx = [i for i, v in enumerate(vs) if v["mediaTime"] == a]
            pre = vs[idx[0] - 1]["verdict"] if idx and idx[0] > 0 else "EDGE"
            j = [i for i, v in enumerate(vs) if v["mediaTime"] == b]
            post = vs[j[0] + 1]["verdict"] if j and j[0] + 1 < len(vs) else "EDGE"
            clean = pre == "NO" and post == "NO"
            print(f"{r['candidate']['window']}: {a}-{b} ({dur:.1f}s) "
                  f"brackets {pre}/{post} {'CLEAN' if clean else 'NOT-CLEAN/EDGE'}"
                  f"{'  *** >=8s CANDIDATE ***' if dur >= 8 and clean else ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
