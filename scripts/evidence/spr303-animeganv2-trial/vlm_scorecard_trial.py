#!/usr/bin/env python3
"""SPR303 — the frozen 7-axis VLM scorecard for the AnimeGANv2 trial leg.

The FROZEN protocol (scripts/source-preserving/vlm_scorecard.py — the
acceptance doc §2/§4 convention) applied to the trial's executed renders:
each call carries original@t (the b8 substrate frame) + stylized@t
(AnimeGANv2 Hayao) + stylized@t±0.2 s (the within-shot temporal pair), the
same 6 scored axes + the 7-key artifact checklist, the same AXES/ARTIFACTS
response contract, the same z-ai vision CLI calling convention, the same
sample set (t = 2/8/15/30/45 s + cut-adjacent pre/post for every frozen b8
input cut). The ONE intentional deviation, recorded honestly: the family
string inside the frozen prompt is the trial's ("anime (AnimeGANv2 Hayao
style)") — the trial is NOT the spr-anime-npr renderer and must not be
labeled as it (never laundered); the axis criteria are byte-identical.

The A/B: the trial scorecard vs the COMMITTED baseline scorecards
(spr-tier2-scorecards/scorecard-anime-npr.json + scorecard-cartoon-cel.json
— reused, never re-rendered/re-scored). The collapse axes to beat:
anime-npr minAxisMean 1.80 / cartoon-cel 1.53.

Tier claim: 0, honestly — the trial is a sampled-frame stylization run, NOT
a full 1190-frame render; the G-T1..G-T5 hard gates are typed NOT MEASURED
on this trial, so no tier may be claimed (the thresholds require hard gates
green). TL visual approval: PENDING (the TL owns the visual gate).
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent.parent
FRAMES = HERE / "frames"
RENDERS = HERE / "renders"
VLM_DIR = HERE / "vlm"
BASELINE_DIR = REPO / "scripts/evidence/spr-tier2-scorecards"

sys.path.insert(0, str(HERE))
from trial_animegan import samples, partner_t  # noqa: E402

FAMILY = "anime (AnimeGANv2 Hayao style)"

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


def vlm_call(images: list[Path], out_json: Path,
             retries: int = 3, backoff_s: float = 90.0) -> dict:
    for attempt in range(1, retries + 1):
        proc = subprocess.run(
            ["z-ai", "vision", "-p", PROMPT.format(family=FAMILY)]
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
    return {"ok": False, "content": f"vlm-call-failed rc={proc.returncode}",
            "attempt": retries, "stderr": (proc.stderr or "")[-300:]}


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


def main() -> int:
    VLM_DIR.mkdir(parents=True, exist_ok=True)
    smp = samples()
    entries = []
    for s in smp:
        orig = FRAMES / f"original-{s['id']}.png"
        styl = RENDERS / f"animeganv2-hayao-{s['id']}.png"
        styl_p2 = RENDERS / f"animeganv2-hayao-{s['id']}p2.png"
        if not (orig.exists() and styl.exists() and styl_p2.exists()):
            print(f"{s['id']}: missing render artifact", file=sys.stderr)
            return 1
        out_json = VLM_DIR / f"animeganv2-hayao-{s['id']}.json"
        verdict = vlm_call([orig, styl, styl_p2], out_json)
        entry = {"sample": s["id"], "kind": s["kind"], "t": s["t"],
                 "ok": verdict["ok"], "justification": verdict["content"]}
        if verdict["ok"]:
            entry.update(parse_verdict(verdict["content"]))
        entries.append(entry)
        print(f"animeganv2-hayao {s['id']} ok={verdict['ok']}", flush=True)

    scored = [e for e in entries if e.get("axes")]
    arts = [e for e in entries if e.get("artifacts")]
    mean_scores = {}
    for k in AXES:
        vals = [e["axes"][k] for e in scored]
        mean_scores[AXIS_NAMES[k]] = round(sum(vals) / len(vals), 2) if vals else None
    axis_means = [v for v in mean_scores.values() if v is not None]
    critical = sum((e["artifacts"]["limbs"] + e["artifacts"]["players"])
                   for e in arts) if arts else None
    total_artifacts = sum(sum(e["artifacts"].values()) for e in arts) \
        if arts else None

    # ---- the A/B against the COMMITTED baseline scorecards (reused) ----
    def baseline(fam: str) -> dict:
        d = json.loads((BASELINE_DIR / f"scorecard-{fam}.json").read_text())
        v = d["vlm"]
        return {
            "family": fam,
            "meanScores": v["meanScores"],
            "minAxisMean": v["minAxisMean"],
            "criticalArtifacts": v["criticalArtifacts"],
            "totalArtifacts": v["totalArtifacts"],
            "tierClaim": d["tierClaim"],
            "record": f"scripts/evidence/spr-tier2-scorecards/scorecard-{fam}.json",
        }

    b_anime = baseline("anime-npr")
    b_cel = baseline("cartoon-cel")
    trial_min = min(axis_means) if axis_means else None
    verdict = None
    if trial_min is not None:
        beats_anime = trial_min > b_anime["minAxisMean"]
        beats_cel = trial_min > b_cel["minAxisMean"]
        verdict = (
            f"trial minAxisMean {trial_min} vs anime-npr {b_anime['minAxisMean']} "
            f"({'BEATEN' if beats_anime else 'NOT BEATEN'}) and cartoon-cel "
            f"{b_cel['minAxisMean']} ({'BEATEN' if beats_cel else 'NOT BEATEN'}) "
            "— the collapse axes stand until beaten; the honest result stands"
        )

    scorecard = {
        "schemaVersion": "1.0",
        "flight": "SPR303 — the executed AnimeGANv2 trial (worker 65-i)",
        "family": "animeganv2-hayao",
        "stylizer": {
            "class": "learned per-frame neural style transfer (ONNX, CPU)",
            "model": "vumichien/AnimeGANv2_Hayao @ f84714b47ad2c7e930c5f3d5dff58fe91659be95",
            "style": "Hayao (ONE style — the trial is the A/B, not a portfolio)",
            "weightsSha256": "5a84ca468f3c4fd891fe8c883a3a507ed3e463f4f059985735f6449dae7590b5",
        },
        "protocol": "frozen 7-axis acceptance protocol (vlm_scorecard.py §2/§4) "
                    "— same axes, same artifact checklist, same sample set, "
                    "same response contract, same z-ai vision CLI convention",
        "promptFamilyString": FAMILY,
        "promptDeviationNote": "the ONLY deviation from the frozen baseline "
                               "prompt: the family string names the trial's "
                               "stylizer honestly (anime (AnimeGANv2 Hayao "
                               "style)) instead of the baseline renderer's "
                               "family label — the trial must not be "
                               "labeled as the spr-anime-npr renderer",
        "clipIds": ["sprclip-b8-inplay-original"],
        "substrateSha256": "969af7c6fdb172091ff00705b25fa37b7073f4332d722416b9754a4a7579917a",
        "perSample": entries,
        "vlm": {
            "meanScores": mean_scores,
            "minAxisMean": trial_min,
            "overallMean": round(sum(axis_means) / len(axis_means), 2)
            if axis_means else None,
            "criticalArtifacts": critical,
            "totalArtifacts": total_artifacts,
            "scoredSamples": len(scored),
            "totalSamples": len(smp),
            "evidence": [f"vlm/animeganv2-hayao-{s['id']}.json" for s in smp],
        },
        "abAgainstCommittedBaseline": {
            "baselineReusePolicy": "the committed spr-tier2-scorecards evidence "
                                   "is REUSED verbatim (never re-rendered, "
                                   "never re-scored)",
            "animeNpr": b_anime,
            "cartoonCel": b_cel,
            "trialMinAxisMean": trial_min,
            "collapseAxesVerdict": verdict,
            "crossRunCaveat": "the baseline scores were recorded on an earlier "
                              "VLM run (2026-09-25); the trial scores on this "
                              "run — cross-run VLM drift is a recorded "
                              "limitation, not laundered away (same protocol, "
                              "same sample set, same prompt criteria)",
        },
        "gates": "TYPED GAP — G-T1..G-T5 full-render hard gates NOT MEASURED "
                 "on this trial (the trial stylizes the frozen sample frames, "
                 "not the full 1190-frame b8 render; measured instead: "
                 "double-run determinism byte-identical — results/determinism.json)",
        "tierClaim": 0,
        "tierClaimNote": "honestly 0 — no tier may be claimed from a "
                         "sampled-frame trial without the full-render hard "
                         "gates (tier thresholds require hard gates green); "
                         "the collapse-axes comparison above is the trial's "
                         "actual result",
        "tlApproval": {"status": "PENDING", "reviewer": "tech-lead"},
        "noPromotion": "the trial is a benchmark evaluation (research class, "
                       "NC weights terms) — NEVER a renderer-registry "
                       "promotion; no rendererId registered, no status claim",
        "limitations": [
            "temporal axes judged from a within-shot 0.2 s stylized frame pair, "
            "not full-video review (Tier-3 / wave-2 video audit); cut-adjacent "
            "pre samples pair backwards so the pair never crosses a source cut",
            "artifact counts are per sampled frame, not per frame of a full "
            "render (no full render exists on this trial)",
            "the baseline side of the A/B is the committed record (a different "
            "VLM run) — cross-run drift recorded above, never laundered",
        ],
    }
    out = HERE / "scorecard-animeganv2-hayao.json"
    out.write_text(json.dumps(scorecard, indent=1))
    print(f"scorecard -> {out}", flush=True)
    print(f"meanScores={mean_scores}", flush=True)
    print(f"minAxisMean={trial_min} critical={critical} "
          f"total={total_artifacts}", flush=True)
    print(verdict, flush=True)
    return 0 if len(scored) == len(smp) else 1


if __name__ == "__main__":
    sys.exit(main())
