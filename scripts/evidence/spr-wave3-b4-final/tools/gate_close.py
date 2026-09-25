#!/usr/bin/env python3
"""Close the b4 hard gate exactly as ordered.

Reads verify-results.json (the sweep-C direct-verification record),
computes VERIFIED runs (every 1 fps frame in [a,b] a landed YES, both
brackets landed NOs — ERROR/UNPARSED frames never count and are always
documented), then:

- if any verified run is >= 8 s  -> SINGLE-SHOT b4: cut exactly that
  run from its sweep window (seek-free, exact 25 fps frame select),
  designation "crowd"
- else                           -> b4-MONTAGE: assemble the plan
  (w2a verified segments joined at verified cut points), designation
  "crowd-montage"

Writes montage/gate-decision.json for the addendum builder.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

WORK = Path("/home/z/spr-w3c-work")
SWEEP = WORK / "sweep"
MON = WORK / "montage"


def verified_runs(res: dict):
    vs = res["verdicts"]
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
    out = []
    for a, b in runs:
        i0 = [i for i, v in enumerate(vs) if v["mediaTime"] == a][0]
        i1 = [i for i, v in enumerate(vs) if v["mediaTime"] == b][0]
        pre = vs[i0 - 1]["verdict"] if i0 > 0 else "EDGE"
        post = vs[i1 + 1]["verdict"] if i1 + 1 < len(vs) else "EDGE"
        clean = pre == "NO" and post == "NO"
        out.append({
            "window": res["candidate"]["window"],
            "candidateRun": [res["candidate"]["runStart"],
                             res["candidate"]["runEnd"]],
            "runStart": a, "runEnd": b,
            "durationSec": round(b - a + 1.0, 2),
            "brackets": [pre, post],
            "verified": clean,
        })
    return out


def main() -> int:
    results = json.loads((WORK / "verify-results.json").read_text())
    all_runs, errors = [], []
    for r in results:
        for run in verified_runs(r):
            all_runs.append(run)
        for v in r["verdicts"]:
            if v["verdict"] in ("ERROR", "UNPARSED"):
                errors.append({
                    "window": r["candidate"]["window"],
                    "mediaTime": v["mediaTime"], "verdict": v["verdict"],
                    "detail": v.get("reason", "")[:160],
                    "frame": v.get("frame"),
                })

    winners = [r for r in all_runs if r["verified"] and r["durationSec"] >= 8.0]
    decision = {
        "rule": "no >=8s directly-verified crowd-dominant run => b4 "
                "RECLASSIFIED as crowd-montage (lead decision, pre-recorded)",
        "sweepVerifiedRuns": all_runs,
        "errorFrames": errors,
        "errorFramesLoadBearing": False,
        "branch": "single-shot" if winners else "montage",
    }

    if winners:
        w = sorted(winners, key=lambda r: -r["durationSec"])[0]
        decision["singleShotRun"] = w
        # original candidate index (stable tag namespace of the sweep's
        # landed per-frame verdicts for these exact frames)
        cands = json.loads((WORK / "sweep-crowd-candidates.json").read_text())
        k = next(i + 1 for i, c in enumerate(cands)
                 if c["window"] == w["window"]
                 and c["runStart"] == w["candidateRun"][0]
                 and c["runEnd"] == w["candidateRun"][1])
        sid = f"{w['window']}run"
        src_ts = SWEEP / f"{w['window']}.ts"
        src_map = SWEEP / f"{w['window']}-window.json"
        shutil.copy(src_ts, MON / f"mon-{sid}.ts")
        shutil.copy(src_map, MON / f"mon-{sid}-window.json")
        plan = {
            "designation": "crowd",
            "output": "clip-b4-crowd.mp4",
            "segments": [{
                "id": sid,
                "mediaStart": w["runStart"],
                "mediaEnd": w["runEnd"],
                "tagPrefix": f"{w['window']}-{k}",
                "provenance": (
                    f"SPR-W3-C sweep direct-verified run {w['runStart']}-"
                    f"{w['runEnd']} ({w['durationSec']}s, every 1 fps frame "
                    f"landed YES, brackets {w['brackets']}) in window "
                    f"{w['window']} (goal-adjacent, prior-coverage-"
                    f"disjoint); per-frame verdicts cache-reused from the "
                    f"sweep's own landed calls (raw JSONs preserved)"),
            }],
        }
        plan_file = "montage-plan-singleshot.json"
    else:
        plan = json.loads((WORK / "montage-plan.json").read_text())
        plan_file = "montage-plan.json"
    (WORK / plan_file).write_text(json.dumps(plan, indent=1) + "\n")

    rc = subprocess.run(
        [sys.executable, str(WORK / "montage.py"), plan_file],
    ).returncode
    if rc != 0 and winners:
        # honest fallback: the single-shot refused at assembly time ->
        # the pre-recorded montage branch still delivers b4
        print("[gate] single-shot assembly refused — falling back to the "
              "montage branch", file=sys.stderr, flush=True)
        decision["singleShotFallbackToMontage"] = True
        plan = json.loads((WORK / "montage-plan.json").read_text())
        plan_file = "montage-plan.json"
        (WORK / plan_file).write_text(json.dumps(plan, indent=1) + "\n")
        rc = subprocess.run(
            [sys.executable, str(WORK / "montage.py"), plan_file],
        ).returncode
        decision["branch"] = "montage"
    decision["assemblerPlan"] = plan_file
    decision["assemblerRc"] = rc
    (MON / "gate-decision.json").write_text(
        json.dumps(decision, indent=1) + "\n")
    print(json.dumps({k: decision[k] for k in
                      ("branch", "sweepVerifiedRuns", "errorFrames")},
                     indent=1))
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
