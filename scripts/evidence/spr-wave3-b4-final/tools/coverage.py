#!/usr/bin/env python3
"""Coverage v3: time-interval disjointness with segment containment.

The current itag-230 manifest is a NEW generation: segment boundaries differ
from the w2a session's manifest (HLS manifests are re-generated per
acquisition — corpus.json records this). Exact segment-index alignment with
w2a windows is therefore impossible; the honest law is TIME disjointness:

  a segment is USABLE for my sweep iff its [start, end] interval does not
  intersect ANY prior-coverage time interval (w2a exact trueWindows, the 9
  modeled disc windows [t, t+86], b8, the 1979-2213 calibration pull).

My windows are then maximal runs of usable segments inside the free time,
clipped to each window's preferred placement (the moment's peak-10 anchor).
Mutual disjointness by segment index. Requested bounds are dust-proofed.

Writes window-plan-final.json + coverage-check.json.
"""
from __future__ import annotations

import json
from pathlib import Path

WORK = Path("/home/z/spr-w3c-work")
W2A = Path("/home/z/sporta-w3c/scripts/evidence/spr-w2a-sampling/verification/windows")

DISC_MODELED = {
    "disc-300": (300.0, 386.0), "disc-900": (900.0, 986.0),
    "disc-1979": (1979.0, 2065.0), "disc-2065": (2065.0, 2151.0),
    "disc-3300": (3300.0, 3386.0), "disc-3500": (3500.0, 3586.0),
    "disc-4600": (4600.0, 4686.0), "disc-5000": (5000.0, 5086.0),
    "disc-5800": (5800.0, 5886.0),
}
EXTRA_EXACT = {"b8": (1803.84, 1851.44), "pull-1979-2213": (1979.0, 2213.0)}


def load_segments():
    lines = (WORK / "playlist-230.m3u8").read_text().splitlines()
    segs, dur, start = [], 0.0, 0.0
    for line in lines:
        line = line.strip()
        if line.startswith("#EXTINF:"):
            dur = float(line.split(":", 1)[1].rstrip(","))
        elif line.startswith("http"):
            segs.append({"url": line, "dur": dur, "start": start})
            start += dur
    return segs


def overlaps(s, e, intervals):
    return any(a < e and s < b for a, b in intervals)


def main() -> int:
    segs = load_segments()
    cum = [s["start"] for s in segs] + [segs[-1]["start"] + segs[-1]["dur"]]

    prior: list[tuple[float, float, str]] = []
    for f in sorted(W2A.glob("*-window.json")):
        d = json.loads(f.read_text())
        prior.append((*d["trueWindow"], f.name.replace("-window.json", "")))
    for name, (a, b) in DISC_MODELED.items():
        # modeled windows get +-4s padding: their exact true ranges are not
        # recorded (774s/9 average); the pad guards the modeling error
        prior.append((a - 4.0, b + 4.0, name + " (modeled, padded)"))
    for name, (a, b) in EXTRA_EXACT.items():
        prior.append((a, b, name))

    usable = [k for k in range(len(segs))
              if not overlaps(cum[k], cum[k + 1], [(a, b) for a, b, _ in prior])]

    plan = json.loads((WORK / "window-plan.json").read_text())
    used: set[int] = set()
    finals = []
    ok = True
    for w in plan:
        pref_a, pref_b = w["requested"]
        allow_short = "short" in w.get("note", "").lower()
        # usable segments overlapping the preferred range
        cand = [k for k in usable
                if cum[k + 1] > pref_a and cum[k] < pref_b and k not in used]
        if not cand:
            finals.append({**w, "error": "no usable segments in preferred range"})
            ok = False
            continue
        cand.sort()
        # take the contiguous run around the preference (they are contiguous
        # within a free interval by construction; split runs if the preference
        # spans a prior-covered island)
        i = next(k for k in cand if cum[k + 1] > pref_a)
        j = next(k for k in reversed(cand) if cum[k] < pref_b)
        # ensure the run [i..j] is contiguous usable and unused
        run = [k for k in cand if i <= k <= j]
        if len(run) != j - i + 1:
            finals.append({**w, "error": "preferred range spans unusable island"})
            ok = False
            continue
        dur = cum[j + 1] - cum[i]
        if dur < 60.0 and not allow_short:
            # extend toward the preference inside the free interval
            for k in range(j + 1, len(segs)):
                if k in used or k not in usable or cum[k] >= pref_b + 30:
                    break
                j = k
                if cum[j + 1] - cum[i] >= 60.0:
                    break
            if cum[j + 1] - cum[i] < 60.0:
                for k in range(i - 1, -1, -1):
                    if k in used or k not in usable or cum[k + 1] <= pref_a - 30:
                        break
                    i = k
                    if cum[j + 1] - cum[i] >= 60.0:
                        break
            dur = cum[j + 1] - cum[i]
        used |= set(range(i, j + 1))
        finals.append({
            **w,
            "segments": [i, j],
            "requestedFinal": [round(cum[i] + 0.05, 2), round(cum[j + 1] - 0.05, 2)],
            "trueRange": [round(cum[i], 2), round(cum[j + 1], 2)],
            "newSeconds": round(cum[j + 1] - cum[i], 2),
            "shortWindow": bool(dur < 60.0),
        })

    total_new = round(sum(f["newSeconds"] for f in finals if "newSeconds" in f), 2)
    out = {
        "ok": ok, "windows": finals, "totalNewSeconds": total_new,
        "law": "time-interval disjointness: segments fully inside free time "
               "(w2a exact trueWindows + modeled disc windows + b8 + pull)",
        "manifestNote": "current manifest is a new HLS generation; segment "
                        "boundaries differ from the w2a manifest — segment-"
                        "index alignment impossible, time law used instead",
    }
    (WORK / "coverage-check.json").write_text(json.dumps(out, indent=1) + "\n")
    (WORK / "window-plan-final.json").write_text(json.dumps(finals, indent=1) + "\n")
    for f in finals:
        if "error" in f:
            print(f"{f['name']:8s} ERROR {f['error']}")
        else:
            print(f"{f['name']:8s} segs {f['segments'][0]:4d}-{f['segments'][1]:4d} "
                  f"true [{f['trueRange'][0]:8.2f}, {f['trueRange'][1]:8.2f}] "
                  f"+{f['newSeconds']:6.1f}s{' SHORT' if f['shortWindow'] else ''}")
    print(f"TOTAL projected NEW coverage: {total_new}s   ok={ok}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
