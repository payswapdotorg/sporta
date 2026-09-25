#!/usr/bin/env python3
"""Sweep phase A: fetch all planned windows + build grids + decode check.

For each window in window-plan-final.json:
1. fetch segments via the recorded chain (fetcher.py, requestedFinal bounds)
2. decode-integrity check (ffmpeg full decode error scan; a corrupt segment
   is re-fetched bypassing the cache, once)
3. build w2a-format 4x5 grids (5 per window max, 1 fps, media timestamps)
Outputs under sweep/: <name>.ts, <name>-window.json, <name>_g*.jpg,
<name>-grids.json, plus sweep-fetch-summary.json.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

WORK = Path("/home/z/spr-w3c-work")
SWEEP = WORK / "sweep"


def decode_errors(ts: Path) -> str | None:
    proc = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", str(ts), "-f", "null", "-"],
        capture_output=True, text=True, stdin=subprocess.DEVNULL,
    )
    err = (proc.stderr or "").strip()
    return err if proc.returncode != 0 or err else None


def main() -> int:
    SWEEP.mkdir(exist_ok=True)
    plan = json.loads((WORK / "window-plan-final.json").read_text())
    summary = []
    for w in plan:
        if "error" in w:
            summary.append({**w, "status": "planning-error"})
            continue
        name = w["name"]
        ts = SWEEP / f"{name}.ts"
        req = w["requestedFinal"]
        if not ts.exists():
            r = subprocess.run(
                [sys.executable, str(WORK / "fetcher.py"),
                 "--start", str(req[0]), "--end", str(req[1]),
                 "--name", name, "--out", str(SWEEP)],
                capture_output=True, text=True,
            )
            if r.returncode != 0:
                summary.append({**w, "status": "fetch-failed", "log": r.stderr[-400:]})
                print(f"[sweep] {name} FETCH FAILED", file=sys.stderr)
                continue
        err = decode_errors(ts)
        if err:
            print(f"[sweep] {name} decode errors, re-pulling once: {err[:120]}",
                  file=sys.stderr)
            ts.unlink()
            subprocess.run(
                [sys.executable, str(WORK / "fetcher.py"),
                 "--start", str(req[0]), "--end", str(req[1]),
                 "--name", name, "--out", str(SWEEP)],
                capture_output=True, text=True, check=True,
            )
            err = decode_errors(ts)
        wmap = json.loads((SWEEP / f"{name}-window.json").read_text())
        grids_meta = SWEEP / f"{name}-grids.json"
        if not grids_meta.exists():
            subprocess.run(
                [sys.executable, str(WORK / "grid.py"), str(ts),
                 str(wmap["trueWindow"][0]), str(SWEEP / name)],
                check=True, capture_output=True,
            )
        meta = json.loads(grids_meta.read_text())
        summary.append({
            "name": name, "moment": w.get("moment"),
            "requested": w["requested"], "requestedFinal": req,
            "trueWindow": wmap["trueWindow"], "segments": wmap["segments"],
            "bytes": wmap["bytes"], "newSeconds": w["newSeconds"],
            "shortWindow": w["shortWindow"], "grids": len(meta),
            "decodeErrors": err, "status": "ok",
        })
        print(f"[sweep] {name} true {wmap['trueWindow']} +{w['newSeconds']}s "
              f"{len(meta)} grids decode={'ERR: ' + err[:80] if err else 'clean'}",
              file=sys.stderr)
        time.sleep(1)
    (WORK / "sweep-fetch-summary.json").write_text(json.dumps(summary, indent=1) + "\n")
    ok = sum(1 for s in summary if s.get("status") == "ok")
    print(f"[sweep] fetched {ok}/{len(plan)} windows ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
