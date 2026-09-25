#!/usr/bin/env python3
"""Quota probe on a load-bearing frame + conditional sweep launch.

The 429 quota window was reported cleared by the lead. First fresh call
still 429s. This probe waits (budget 22 waits, ~36 min max) on a frame
whose verdict is genuinely needed (w2839 run pre-bracket — the only
>=8s single-shot candidate). On landing: full sweep, budget 4. On
exhaustion: documentation pass, budget 1 (fast honest ERRORs; none of
the ERROR frames is load-bearing — the gate then closes on the w2a
immutable verification record for the montage branch).
"""
import json
import os
import subprocess
import sys

sys.path.insert(0, "/home/z/spr-w3c-work")
from sweep_c import extract_frames, PROMPT, WORK, SWEEP, VERIFY  # noqa: E402

PY = sys.executable

cands = json.loads((WORK / "sweep-crowd-candidates.json").read_text())
c = cands[2]          # original candidate k=3: w2839, the 12 s run
name, k = c["window"], 3
wmap = json.loads((SWEEP / f"{name}-window.json").read_text())
t0 = wmap["trueWindow"][0]
a, b = c["runStart"], c["runEnd"]

frames = extract_frames(SWEEP / f"{name}.ts", t0, a - 2, b + 2,
                        VERIFY / "frames", f"{name}-{k}")
img, mt = frames[0]
tag = f"{name}-{k}-{int(mt * 100)}"
outjson = VERIFY / "vlm" / f"{tag}.json"
print(f"[probe] {name} k={k}: {len(frames)} frames {mt}..{frames[-1][1]}; "
      f"probing tag {tag}", flush=True)

rc = subprocess.run(
    [PY, str(WORK / "vlm1.py"), img, PROMPT, str(outjson),
     "--tag", tag, "--rate-retries", "22"],
).returncode

if rc == 0:
    print("[probe] LANDED — quota window open; full sweep (budget 4)",
          flush=True)
    os.environ["SWEEP_RATE_RETRIES"] = "4"
else:
    print("[probe] EXHAUSTED — quota still closed; documentation pass "
          "(budget 1, honest ERRORs)", flush=True)
    os.environ["SWEEP_RATE_RETRIES"] = "1"

r = subprocess.run([PY, str(WORK / "sweep_c.py")], env=os.environ)
sys.exit(r.returncode)
