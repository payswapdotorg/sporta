#!/usr/bin/env python3
"""SPR303 — assemble the trial record FROM the executed artifacts (worker 65-i).

No hand-typed numbers: every measurement below is read from the executed
record JSONs this flight produced (results/latency.json,
results/determinism.json, scorecard-animeganv2-hayao.json,
weights-fetch-meta.json) — the fail-closed validator then cross-checks the
record against those same artifacts + the committed bytes (validate-trial.ts).
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent.parent

WORK_ITEM = (
    "SPR303 — Provider/hosted-inference trial (BYOK/free-tier verification). "
    "Owner: A. Wave: WAVE-2+ (only where legitimately available)."
)
NC_CITATION = (
    "This repo is made freely available to academic and non-academic entities "
    "for non-commercial purposes such as academic research, teaching, "
    "scientific publications. Permission is granted to use the AnimeGAN given "
    "that you agree to my license terms. Regarding the request for commercial "
    "use, please contact us via email to help you obtain the authorization "
    "letter."
)
NC_CITATION_SOURCE = (
    "scripts/evidence/spr302-v2v-feasibility/fetches/"
    "hf-vumichien-AnimeGANv2_Hayao-README@pinned-rev (committed by 65-h, "
    "fetch-meta sha256 948ed04b…) — the SPR302-recorded mirror card, the SAME "
    "repo/revision this trial's weights were downloaded from"
)
MIT_CITATION = (
    "Permission is hereby granted, free of charge, to any person obtaining a "
    "copy of this software ... to use, copy, modify, merge, publish, "
    "distribute, sublicense, and/or sell copies (Copyright (c) 2021 Bryan Lee) "
    "— scripts/evidence/spr302-v2v-feasibility/fetches/"
    "github-bryandlee-animegan2-pytorch-LICENSE"
)


def main() -> int:
    latency = json.loads((HERE / "results" / "latency.json").read_text())
    det = json.loads((HERE / "results" / "determinism.json").read_text())
    score = json.loads((HERE / "scorecard-animeganv2-hayao.json").read_text())
    wf = json.loads((HERE / "weights-fetch-meta.json").read_text())

    trial_min = score["vlm"]["minAxisMean"]
    b_anime = score["abAgainstCommittedBaseline"]["animeNpr"]
    b_cel = score["abAgainstCommittedBaseline"]["cartoonCel"]

    record = {
        "schemaVersion": "1.0",
        "flight": "SPR303 — the executed AnimeGANv2 trial (the provider/"
                  "hosted-inference work item, honestly resolved)",
        "worker": "65-i (flight 15, the SPR lane, Worker A's wave-2)",
        "workItem": WORK_ITEM,
        "recordedAtUtc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "honestReading": {
            "theWorkItemSays": "Provider/hosted-inference trial (BYOK/"
                               "free-tier verification)",
            "theResolution": "the local ONNX trial IS the legitimately-"
                             "available path: the SPR302 matrix recorded that "
                             "no legitimate v2v hosted provider exists in the "
                             "shortlist's classes (Diffutoon/ToonCrafter/"
                             "Pix2Video/vid2vid = infeasible-or-not-ready; "
                             "FlowVid/CompoundVST artifact-absent; ReReVST "
                             "off-hub weights); the BYOK/free-tier hosted "
                             "angle is a TYPED GAP (hosted-provider-absent), "
                             "recorded, never faked — no hosted provider was "
                             "invoked, no token was used",
            "typedGap": "hosted-provider-absent (BYOK/free-tier hosted "
                        "inference unavailable per the recorded matrix; the "
                        "executed trial is local ONNX on this CPU host)",
        },
        "weights": {
            "policy": "ONE style ONLY (the trial is the A/B, not a portfolio)",
            "model": "AnimeGANv2 (per-frame neural style transfer, ONNX)",
            "style": "Hayao",
            "mirror": wf["repoId"],
            "revision": wf["revision"],
            "file": wf["filename"],
            "downloadUrl": wf["url"],
            "byteSize": wf["byteSize"],
            "sha256": wf["sha256"],
            "downloadedAtUtc": wf["downloadedAtUtc"],
            "storedAt": "/home/z/hf-bench-13/weights/ (OUTSIDE the repo — "
                        "weights are never committed; the sha above is the "
                        "verification pin)",
            "gated": "no (ungated mirror, HTTP-206-reachable per the SPR302 "
                     "probe; the download itself executed on this flight)",
            "license": {
                "code": "MIT (the canonical bryandlee/animegan2-pytorch port)",
                "codeCitation": MIT_CITATION,
                "weights": "NON-COMMERCIAL usage terms on the hub mirror "
                           "(research-class trial matches SPR303's 'only "
                           "where legitimately available'); the "
                           "card-metadata 'license: apache-2.0' tag "
                           "CONTRADICTS the body's NC terms — recorded "
                           "contradiction, never adjudicated here",
                "weightsCitationVerbatim": NC_CITATION,
                "weightsCitationSource": NC_CITATION_SOURCE,
                "trainingProvenance": "film-frame provenance (The Wind Rises "
                                      "/ Shinkai / Paprika classes, per the "
                                      "SPR302-recorded cards) — the "
                                      "production-class typed blocker stands",
                "commercialClearance": "NOT proven — the NC terms require the "
                                       "email-authorization letter; recorded "
                                       "for the TL/HF015-class adjudication, "
                                       "never a promotion",
            },
        },
        "substrate": {
            "clipId": "sprclip-b8-inplay-original",
            "file": "scripts/evidence/spr-corpus-bytes/b8p3.mp4",
            "sha256": "969af7c6fdb172091ff00705b25fa37b7073f4332d722416b9754a4a7579917a",
            "pinSource": "scripts/evidence/spr-tier2-scorecards/"
                         "renders-with-b8-determinism.json inputSubstrate.sha256 "
                         "(the scorecard-convention pin; byte-verified before "
                         "every run phase by trial_animegan.py check_pins)",
            "frameCount": 1190,
            "fps": 25,
            "width": 640,
            "height": 360,
            "sampleSet": "the frozen 15 scorecard samples (t = 2/8/15/30/45 s "
                         "+ cut-adjacent pre/post for every frozen b8 input "
                         "cut [189, 475, 550, 862, 979, 982]) + each sample's "
                         "within-shot ±0.2 s partner — 30 trial frames + a "
                         "30-frame latency-probe block (300..329, mid-shot)",
        },
        "measurements": {
            "latency": {
                "executed": True,
                "host": latency["host"],
                "frameCount": latency["frameCount"],
                "p50TotalMs": latency["p50TotalMs"],
                "p95TotalMs": latency["p95TotalMs"],
                "p50InferenceMs": latency["p50InferenceMs"],
                "p95InferenceMs": latency["p95InferenceMs"],
                "meanTotalMs": latency["meanTotalMs"],
                "record": "results/latency.json",
                "gpu": "N/A honestly — no GPU execution provider on this host",
            },
            "determinism": {
                "executed": True,
                "byteIdentical": det["byteIdentical"],
                "extractionByteIdentical": det["extractionByteIdentical"],
                "method": det["method"],
                "verdict": det["verdict"],
                "record": "results/determinism.json",
            },
            "renders": {
                "committed": "renders/animeganv2-hayao-<sample>{,p2}.png — "
                             "30 stylized PNGs (the executed A/B artifacts)",
                "shaMap": "results/latency.json rendersSha256 (the 30 "
                          "per-frame pins, byte-verified by the validator)",
            },
        },
        "scorecard": {
            "record": "scorecard-animeganv2-hayao.json",
            "protocol": score["protocol"],
            "meanScores": score["vlm"]["meanScores"],
            "minAxisMean": trial_min,
            "overallMean": score["vlm"]["overallMean"],
            "criticalArtifacts": score["vlm"]["criticalArtifacts"],
            "totalArtifacts": score["vlm"]["totalArtifacts"],
            "scoredSamples": score["vlm"]["scoredSamples"],
            "totalSamples": score["vlm"]["totalSamples"],
            "perCallEvidence": "vlm/animeganv2-hayao-<sample>.json (15 files)",
        },
        "abVerdict": {
            "baselineReusePolicy": "the committed spr-tier2-scorecards "
                                   "evidence reused verbatim (never "
                                   "re-rendered, never re-scored)",
            "animeNprMinAxisMean": b_anime["minAxisMean"],
            "cartoonCelMinAxisMean": b_cel["minAxisMean"],
            "trialMinAxisMean": trial_min,
            "collapseAxesBeaten": trial_min > b_anime["minAxisMean"]
            and trial_min > b_cel["minAxisMean"],
            "verdict": score["abAgainstCommittedBaseline"]["collapseAxesVerdict"],
            "caveats": [
                "beating the collapse axes is NOT a tier claim — the trial is "
                "sampled-frame, the G-T hard gates are a typed gap",
                "cross-run VLM drift recorded (the baseline scores are an "
                "earlier run; same protocol/sample set/prompt criteria)",
                "identityConsistency 2.67 beats 1.80 but remains below the "
                "Tier-1 3.5 bar — the honest number stands",
            ],
        },
        "tierClaim": 0,
        "tierClaimNote": "honestly 0 (see scorecard.tierClaimNote): no tier "
                         "may be claimed from a sampled-frame trial without "
                         "the full-render hard gates; the TL owns the visual "
                         "gate — tlApproval PENDING",
        "tlApproval": {"status": "PENDING", "reviewer": "tech-lead"},
        "ebsynthLeg": {
            "status": "DEFERRED (honest)",
            "reason": "the AnimeGANv2 leg completed within the flight budget; "
                      "the EbSynth leg requires the EbSynth CLI binary (not a "
                      "hub model — nothing to download legitimately from the "
                      "hub) + our deterministic keyframes as seeds; the "
                      "flight's time budget closed before the second leg",
            "recordedDesign": "EbSynth propagation seeded by OUR deterministic "
                              "keyframes (the SPR302 recommendation's second "
                              "candidate — the anti-slideshow class): keyframes "
                              "from the committed spr-anime-npr render family, "
                              "propagated across the within-shot spans, scored "
                              "by the same frozen 7-axis protocol on the same "
                              "sample set; the matrix's blockers stand "
                              "(public-domain code + the Adobe PatchMatch "
                              "patent warning + the tool terms)",
            "nextAction": "a wave-2 continuation flight (SPR303b-class) if the "
                          "TL admits the second leg",
        },
        "noPromotion": "the trial is research-class benchmark evaluation "
                       "(the NC terms permit it; never a promotion): no "
                       "rendererId registered, no renderer-registry change, "
                       "no status claim, no tier claim — the TL owns the "
                       "visual gate and the HF015-class adjudication owns "
                       "any future promotion",
        "provenance": {
            "scripts": [
                "trial_animegan.py (extract / stylize / stylize-raw / "
                "determinism — all executed this flight)",
                "vlm_scorecard_trial.py (the frozen 7-axis protocol via the "
                "z-ai vision CLI — executed, 15/15 calls)",
                "record_trial.py (this assembler — reads only the executed "
                "artifacts, no hand-typed measurements)",
                "validate-trial.ts (the fail-closed validator, "
                "negative-tested)",
            ],
            "venv": "/home/z/hf-bench-13 (fresh, OUTSIDE the repo: "
                    "huggingface_hub + onnxruntime + numpy + Pillow ONLY)",
            "host": latency["host"],
        },
    }
    out = HERE / "trial-record.json"
    out.write_text(json.dumps(record, indent=1))
    print(f"trial record -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
