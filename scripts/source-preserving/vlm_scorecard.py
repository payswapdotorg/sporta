#!/usr/bin/env python3
"""VLM scorecard harness v2 — SPEC-CONFORMANT (frozen acceptance doc §2/§4).

v1 (quota-outage era) implemented a 4-axis prompt that drifted from the
frozen 7-axis protocol — it was authored while the VLM returned 429 for
every call and could never be validated against a live model. v2 conforms
to the frozen spec exactly:

  axes (1-5 each, one-line justification):
    1. sourceFidelity      — same match, same moment, same camera context?
    2. temporalConsistency — objects flicker/morph/disappear?
    3. identityConsistency — same players visually stable?
    4. motionFidelity      — player/ball motion matches the original?
    5. sceneFidelity       — stadium/background spatially consistent?
    6. stylizationStrength — is the intended transformation obvious?
  artifact checklist (counted per type):
    malformed limbs / disappearing players / warped lines / duplicated
    players / ball hallucination / background drift / temporal jumps;
    critical = any limb malformation or player disappearance > momentary.

  sample frames: t = 2/8/15/30/45 s + cut-adjacent (pre/post of every
  input cut). Each call carries original@t + stylized@t + stylized@t+0.2 s
  (the temporal pair grounds the temporal/motion axes).

Outputs (per family, doc §4 shape): qa/scorecard-<family>.json with gates
(from the measured hard-gate JSONs), metrics, vlm meanScores +
criticalArtifacts + evidence list, tierClaim, tlApproval PENDING; per-call
evidence qa/vlm/<family>-<sample>.json; aggregate qa/vlm-scorecard.json.

Honest limitations recorded in every scorecard: temporal axes are judged
from a 0.2 s frame pair (not full-video review — that is the Tier-3 /
wave-2 video-based audit); artifact counts are per-sampled-frame.

Usage:
  python3 vlm_scorecard.py [--realities cartoon-cel,...] [--resume]
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

EVIDENCE = Path("/home/z/spr-evidence")
RENDER = EVIDENCE / "render"
QA = EVIDENCE / "qa"
BYTES = EVIDENCE / "bytes"
FRAMES_DIR = RENDER / "frames" / "vlm2"
VLM_DIR = QA / "vlm"

SUBSTRATE = BYTES / "b8p3.mp4"
INPUT_CUTS = [189, 475, 550, 862, 979, 982]  # frozen b8 broadcast cuts (corpus.json)
FIXED_T = [2, 8, 15, 30, 45]
CUT_OFFSET = 3  # frames before/after a cut
CLUSTER_GAP = 5  # cuts within this many frames are one event (micro-shots)
TEMPORAL_DELTA_S = 0.2  # 5 frames @ 25 fps

DEFAULT_REALITIES = ["cartoon-cel", "anime-npr", "noir-retro-noir", "motion-trails"]

AXES = ["sf", "tc", "ic", "mf", "scf", "ss"]
AXIS_NAMES = {
    "sf": "sourceFidelity",
    "tc": "temporalConsistency",
    "ic": "identityConsistency",
    "mf": "motionFidelity",
    "scf": "sceneFidelity",
    "ss": "stylizationStrength",
}
ARTIFACT_KEYS = ["limbs", "players", "warped", "dupes", "ball", "bg", "tj"]
ARTIFACT_NAMES = {
    "limbs": "malformedLimbs",
    "players": "disappearingPlayers",
    "warped": "warpedLines",
    "dupes": "duplicatedPlayers",
    "ball": "ballHallucination",
    "bg": "backgroundDrift",
    "tj": "temporalJumps",
}

PROMPT = (
    "Image 1 is an original football broadcast frame at time t. Image 2 is a "
    "stylized ({family}) version of the SAME frame. Image 3 is another stylized "
    "frame 0.2 seconds apart in time, within the same camera shot (the order "
    "may be earlier or later).\n"
    "Score each axis 1-5 (5 best) with a one-line justification:\n"
    "1. sourceFidelity - same match, same moment, same camera context?\n"
    "2. temporalConsistency - objects flicker, morph or disappear?\n"
    "3. identityConsistency - same players visually stable?\n"
    "4. motionFidelity - player/ball motion consistent with image 1 and the "
    "temporal pair?\n"
    "5. sceneFidelity - stadium/background spatially consistent?\n"
    "6. stylizationStrength - is the intended transformation obvious?\n"
    "Then count artifacts visible in images 2-3, each an integer count "
    "(0 if none): malformedLimbs, disappearingPlayers, warpedLines, "
    "duplicatedPlayers, ballHallucination, backgroundDrift, temporalJumps.\n"
    "A camera shot change between images is NOT an artifact — judge only "
    "within-shot instability.\n"
    "End with exactly two lines:\n"
    "AXES sf=<n> tc=<n> ic=<n> mf=<n> scf=<n> ss=<n>\n"
    "ARTIFACTS limbs=<n> players=<n> warped=<n> dupes=<n> ball=<n> bg=<n> tj=<n>"
)


def samples() -> list[dict]:
    """Fixed t plus cut-adjacent pre/post for every frozen input cut.

    Cuts within CLUSTER_GAP frames are clustered into one event (e.g. the
    979/982 double-cut bounds a 3-frame micro-shot that cannot support a
    0.2 s within-shot pair). The cluster's pre = start-3 (partner start-8),
    post = end+3 (partner end+8) — identical frames to the unclustered
    c{start}pre / c{end}post, so their evidence remains valid.
    """
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
        pre, post = start - CUT_OFFSET, end + CUT_OFFSET
        if start == end:
            out.append({"id": f"c{start}pre", "kind": "cut-adjacent",
                        "t": pre / 25.0})
            out.append({"id": f"c{end}post", "kind": "cut-adjacent",
                        "t": post / 25.0})
        else:
            out.append({"id": f"c{start}pre", "kind": "cut-adjacent",
                        "t": pre / 25.0})
            out.append({"id": f"c{end}post", "kind": "cut-adjacent",
                        "t": post / 25.0})
    return out


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


def vlm_call(images: list[Path], family: str, out_json: Path,
             retries: int = 3, backoff_s: float = 90.0) -> dict:
    for attempt in range(1, retries + 1):
        proc = subprocess.run(
            ["z-ai", "vision", "-p", PROMPT.format(family=family)]
            + [arg for img in images for arg in ("-i", str(img))]
            + ["-o", str(out_json)],
            capture_output=True, text=True, timeout=240,
        )
        if out_json.exists():
            try:
                j = json.loads(out_json.read_text())
                content = j["choices"][0]["message"]["content"]
                return {"ok": True, "content": content, "attempt": attempt}
            except Exception:  # noqa: BLE001
                pass
        if "429" in (proc.stderr or "") and attempt < retries:
            print(f"  429 quota; backoff {backoff_s}s "
                  f"(attempt {attempt}/{retries})", flush=True)
            time.sleep(backoff_s)
    return {"ok": False, "content": "quota-exhausted", "attempt": retries}


AXES_RE = re.compile(
    r"AXES\s+sf\s*=\s*([1-5])\s+tc\s*=\s*([1-5])\s+ic\s*=\s*([1-5])\s+"
    r"mf\s*=\s*([1-5])\s+scf\s*=\s*([1-5])\s+ss\s*=\s*([1-5])",
    re.IGNORECASE,
)
ARTIFACTS_RE = re.compile(
    r"ARTIFACTS\s+limbs\s*=\s*(\d+)\s+players\s*=\s*(\d+)\s+warped\s*=\s*(\d+)\s+"
    r"dupes\s*=\s*(\d+)\s+ball\s*=\s*(\d+)\s+bg\s*=\s*(\d+)\s+tj\s*=\s*(\d+)",
    re.IGNORECASE,
)


def parse_verdict(content: str) -> dict:
    axes_m = AXES_RE.search(content)
    art_m = ARTIFACTS_RE.search(content)
    out: dict = {"axes": None, "artifacts": None}
    if axes_m:
        vals = [int(g) for g in axes_m.groups()]
        out["axes"] = {k: v for k, v in zip(AXES, vals)}
    if art_m:
        vals = [int(g) for g in art_m.groups()]
        out["artifacts"] = {k: v for k, v in zip(ARTIFACT_KEYS, vals)}
    return out


def load_gates(stem: str, render_entry: dict | None) -> dict:
    """Hard gates from the measured JSONs (same resolution as the product manifest).

    G-T5 determinism: the measured sha-triple lives on files.b12 (the b12
    determinism cut); files.b8 carries determinismDoubleRender once the
    full-artifact double render is recorded. Read b8 first, fall back to b12.
    """
    metrics = {}
    try:
        metrics = json.loads((QA / f"metrics-{stem}.json").read_text())
    except Exception:  # noqa: BLE001
        pass
    deep = {}
    try:
        deep = json.loads((QA / f"cuts-deep-{stem}.json").read_text())
    except Exception:  # noqa: BLE001
        pass
    t1, t2, t3, t4 = (metrics.get(f"G-T{i}") for i in (1, 2, 3, 4))
    t2b = deep
    t2_resolved = t2.get("pass") is True or t2b.get("pass") is True
    files = (render_entry or {}).get("files", {})
    det_b8 = (files.get("b8") or {}).get("determinismDoubleRender", {})
    det_b12 = (files.get("b12") or {}).get("determinismDoubleRender", {})
    det = det_b8.get("byteIdentical")
    det_source = "b8 full-artifact"
    if det is None:
        det = det_b12.get("byteIdentical")
        det_source = "b12 determinism cut"
    gates = {
        "G-T1": {"value": f"{t1.get('inputFrameCount')}=={t1.get('outputFrameCount')}"
                 if t1 else None, "pass": t1.get("pass") if t1 else None},
        "G-T2": {"value": f"coverage={t2b.get('coverage', t2.get('coverage'))}",
                 "pass": t2_resolved,
                 "note": "detector miss on stylization-softened cut resolved by the "
                         "deep correspondence gate (T2b)" if t2.get("pass") is False
                         and t2b.get("pass") is True else None},
        "G-T3": {"value": f"pearsonR={t3.get('pearsonR')}" if t3 else None,
                 "pass": t3.get("pass") if t3 else None},
        "G-T4": {"value": f"percentOfRange={t4.get('percentOfRange')}" if t4 else None,
                 "pass": t4.get("pass") if t4 else None},
        "G-T5": {"value": f"double render byteIdentical ({det_source})"
                 if det is not None else None,
                 "pass": det is True,
                 "source": det_source if det is not None else None},
    }
    metrics_block = {}
    if t3:
        metrics_block["motionCorrelation"] = t3.get("pearsonR")
    if t4:
        metrics_block["staticRegionInstability"] = t4.get("percentOfRange")
    if t2b:
        metrics_block["cutCoverage"] = t2b.get("coverage")
    return {"gates": gates, "metrics": metrics_block,
            "hardGatesGreen": all(
                gates[f"G-T{i}"]["pass"] is True for i in (1, 2, 3, 4, 5))}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--realities", default=",".join(DEFAULT_REALITIES))
    ap.add_argument("--resume", action="store_true",
                    help="reuse existing per-call evidence JSONs")
    a = ap.parse_args()
    realities = [r for r in a.realities.split(",") if r.strip()]

    renders = json.loads((RENDER / "renders.json").read_text())

    VLM_DIR.mkdir(parents=True, exist_ok=True)
    FRAMES_DIR.mkdir(parents=True, exist_ok=True)
    smp = samples()
    aggregate: dict = {
        "schemaVersion": "2.0",
        "protocol": "frozen acceptance doc §2 (7-axis) — v1 4-axis harness was "
                    "spec-drift, superseded",
        "samplesPerReality": [s["id"] for s in smp],
        "limitations": [
            "temporal axes judged from a within-shot 0.2 s stylized frame pair, "
            "not full-video review (Tier-3 / wave-2 video audit); cut-adjacent "
            "pre samples pair backwards so the pair never crosses a source cut",
            "artifact counts are per sampled frame, not per frame of the "
            "full render",
        ],
        "perReality": {},
    }

    for family in realities:
        stem = family
        # match on the derived stem (reality + non-default profile) —
        # e.g. noir-retro + profile noir -> noir-retro-noir
        r_entry = next((r for r in renders.get("realities", [])
                        if r["reality"] + (
                            "-" + r["profile"]
                            if r.get("profile") not in (None, "default")
                            else "") == family), None)
        src = RENDER / f"{stem}-b8.mp4"
        if not src.exists():
            print(f"{stem}: no b8 render, skipping", flush=True)
            continue

        entries = []
        for s in smp:
            orig = FRAMES_DIR / f"original-{s['id']}.png"
            styl = FRAMES_DIR / f"{stem}-{s['id']}.png"
            styl_t2 = FRAMES_DIR / f"{stem}-{s['id']}p2.png"
            # the temporal pair must stay WITHIN the source shot: a pre-cut
            # sample pairs with 0.2 s BEFORE it (never across the cut — the
            # cut is source content the engine must preserve, G-T2)
            if s["kind"] == "cut-adjacent" and s["id"].endswith("pre"):
                partner_t = s["t"] - TEMPORAL_DELTA_S
            else:
                partner_t = s["t"] + TEMPORAL_DELTA_S
            ok_ex = all([
                extract_frame(SUBSTRATE, s["t"], orig),
                extract_frame(src, s["t"], styl),
                extract_frame(src, partner_t, styl_t2),
            ])
            if not ok_ex:
                entries.append({"sample": s["id"], "error": "frame extraction failed"})
                continue

            out_json = VLM_DIR / f"{stem}-{s['id']}.json"
            if a.resume and out_json.exists():
                try:
                    content = json.loads(out_json.read_text())["choices"][0][
                        "message"]["content"]
                    verdict = {"ok": True, "content": content, "attempt": 0}
                except Exception:  # noqa: BLE001
                    verdict = vlm_call([orig, styl, styl_t2], family, out_json)
            else:
                verdict = vlm_call([orig, styl, styl_t2], family, out_json)

            entry = {"sample": s["id"], "kind": s["kind"], "t": s["t"],
                     "ok": verdict["ok"], "justification": verdict["content"]}
            if verdict["ok"]:
                parsed = parse_verdict(verdict["content"])
                entry.update(parsed)
            entries.append(entry)
            print(f"{stem} {s['id']} ok={verdict['ok']}", flush=True)

        scored = [e for e in entries if e.get("axes")]
        arts = [e for e in entries if e.get("artifacts")]
        mean_scores = {}
        for k in AXES:
            vals = [e["axes"][k] for e in scored]
            mean_scores[AXIS_NAMES[k]] = round(
                sum(vals) / len(vals), 2) if vals else None
        critical = sum(
            (e["artifacts"]["limbs"] + e["artifacts"]["players"]) for e in arts
        ) if arts else None
        total_artifacts = sum(
            sum(e["artifacts"].values()) for e in arts) if arts else None

        gg = load_gates(stem, r_entry)
        axis_means = [v for v in mean_scores.values() if v is not None]
        tier = 0
        if gg["hardGatesGreen"] and axis_means and critical is not None:
            if min(axis_means) >= 4.0 and critical == 0:
                tier = 2  # TL visual approval still pending
            elif min(axis_means) >= 3.5 and critical == 0:
                tier = 1
        scorecard = {
            "family": family,
            "rendererId": (r_entry or {}).get("rendererId"),
            "rendererVersion": (r_entry or {}).get("rendererVersion"),
            "clipIds": ["sprclip-b8-inplay-original"],
            "gates": gg["gates"],
            "metrics": gg["metrics"],
            "vlm": {
                "meanScores": mean_scores,
                "minAxisMean": min(axis_means) if axis_means else None,
                "overallMean": round(sum(axis_means) / len(axis_means), 2)
                if axis_means else None,
                "criticalArtifacts": critical,
                "totalArtifacts": total_artifacts,
                "evidence": [f"vlm/{stem}-{s['id']}.json" for s in smp],
                "tierThresholds": {
                    "tier1": "hard gates green AND every axis mean >= 3.5 AND "
                             "critical artifacts = 0",
                    "tier2": "hard gates green AND every axis mean >= 4.0 AND "
                             "critical artifacts = 0 AND TL visual approval",
                },
            },
            "tierClaim": tier,
            "tlApproval": {"status": "PENDING", "reviewer": "tech-lead"},
            "limitations": aggregate["limitations"],
        }
        (QA / f"scorecard-{stem}.json").write_text(json.dumps(scorecard, indent=1))
        aggregate["perReality"][stem] = {
            "tierClaim": tier,
            "hardGatesGreen": gg["hardGatesGreen"],
            "meanScores": mean_scores,
            "criticalArtifacts": critical,
            "scoredSamples": len(scored),
            "totalSamples": len(smp),
            "scorecard": f"scorecard-{stem}.json",
        }
        print(f"{stem}: tierClaim={tier} critical={critical}", flush=True)

    (QA / "vlm-scorecard.json").write_text(json.dumps(aggregate, indent=1))
    print(f"aggregate -> {QA / 'vlm-scorecard.json'}", flush=True)
    ok = all(
        r.get("scoredSamples") == len(smp)
        for r in aggregate["perReality"].values()
    )
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
