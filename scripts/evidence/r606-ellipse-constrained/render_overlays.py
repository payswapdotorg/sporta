#!/usr/bin/env python3
"""
R606 ellipse-constrained measurement — OVERLAY RENDERER.

Reads measurement.json + the anchor frames (frames/<window>.rgb) written by
the bun driver and renders one PNG per window: the anchor frame dimmed, the
conic-selection candidate chain (the PRIMARY conic cyan; the quota-passing
alternatives magenta; the WINNING candidate — the one the calibration
actually anchored to, identified by its support + coverage in the metrics —
yellow), the v0.1.0 line-only solved pitch grid (green, when calibrated), and
the v0.4.0 ellipse-constrained default's solved pitch grid (orange, when
calibrated) — so a human can visually verify every measured outcome. v0.4.1:
the chain line's label carries the chain-only hardening's typed refusal (the
measured grass median / the measured quad-geometry numbers when present).

Run:  python3 render_overlays.py   (from scripts/evidence/r606-ellipse-constrained/)
"""
import json
import math
import os

import cv2
import numpy as np

WIDTH, HEIGHT = 640, 360
HERE = os.path.dirname(os.path.abspath(__file__))

# The canonical pitch model (105 x 68) — segments + arcs, meters.
PENALTY_FRONT_X = 16.5
PENALTY_HALF = 20.16
GOAL_AREA_FRONT_X = 5.5
GOAL_AREA_HALF = 9.16
R = 9.15
SEGMENTS = [
    (0, 0, 105, 0), (0, 68, 105, 68), (0, 0, 0, 68), (105, 0, 105, 68),
    (52.5, 0, 52.5, 68),
    (PENALTY_FRONT_X, 34 - PENALTY_HALF, PENALTY_FRONT_X, 34 + PENALTY_HALF),
    (105 - PENALTY_FRONT_X, 34 - PENALTY_HALF, 105 - PENALTY_FRONT_X, 34 + PENALTY_HALF),
    (0, 34 - PENALTY_HALF, PENALTY_FRONT_X, 34 - PENALTY_HALF),
    (0, 34 + PENALTY_HALF, PENALTY_FRONT_X, 34 + PENALTY_HALF),
    (105 - PENALTY_FRONT_X, 34 - PENALTY_HALF, 105, 34 - PENALTY_HALF),
    (105 - PENALTY_FRONT_X, 34 + PENALTY_HALF, 105, 34 + PENALTY_HALF),
    (GOAL_AREA_FRONT_X, 34 - GOAL_AREA_HALF, GOAL_AREA_FRONT_X, 34 + GOAL_AREA_HALF),
    (105 - GOAL_AREA_FRONT_X, 34 - GOAL_AREA_HALF, 105 - GOAL_AREA_FRONT_X, 34 + GOAL_AREA_HALF),
    (0, 34 - GOAL_AREA_HALF, GOAL_AREA_FRONT_X, 34 - GOAL_AREA_HALF),
    (0, 34 + GOAL_AREA_HALF, GOAL_AREA_FRONT_X, 34 + GOAL_AREA_HALF),
    (105 - GOAL_AREA_FRONT_X, 34 - GOAL_AREA_HALF, 105, 34 - GOAL_AREA_HALF),
    (105 - GOAL_AREA_FRONT_X, 34 + GOAL_AREA_HALF, 105, 34 + GOAL_AREA_HALF),
]


def project_pitch_to_image(h, px, py):
    """h: 9-entry image->pitch homography (h[8]=1); returns image px coords."""
    denom = h[6] * px + h[7] * py + 1.0
    if abs(denom) < 1e-12:
        return None
    # We need pitch -> image: use the inverse of h.
    m = np.array(h, dtype=np.float64).reshape(3, 3)
    try:
        inv = np.linalg.inv(m)
    except np.linalg.LinAlgError:
        return None
    vec = inv @ np.array([px, py, 1.0])
    if abs(vec[2]) < 1e-12:
        return None
    return (vec[0] / vec[2] * WIDTH, vec[1] / vec[2] * HEIGHT)


def draw_grid(img, h, color):
    for (x0, y0, x1, y1) in SEGMENTS:
        steps = max(2, int(math.hypot(x1 - x0, y1 - y0) / 0.5))
        pts = []
        for s in range(steps + 1):
            t = s / steps
            p = project_pitch_to_image(h, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
            if p is None:
                pts = []
                break
            pts.append(p)
        if len(pts) >= 2:
            for a, b in zip(pts, pts[1:]):
                cv2.line(img, (int(a[0]), int(a[1])), (int(b[0]), int(b[1])), color, 1, cv2.LINE_AA)
    # Center circle.
    pts = []
    for s in range(97):
        ang = 2 * math.pi * s / 96
        p = project_pitch_to_image(h, 52.5 + R * math.cos(ang), 34 + R * math.sin(ang))
        if p is None:
            pts = []
            break
        pts.append(p)
    if len(pts) >= 2:
        for a, b in zip(pts, pts[1:]):
            cv2.line(img, (int(a[0]), int(a[1])), (int(b[0]), int(b[1])), color, 1, cv2.LINE_AA)


def draw_conic(img, conic, color):
    """Draw the conic a x^2 + b xy + c y^2 + d x + e y + f = 0 (px coords)."""
    a, b, c, d, e, f = (conic[k] for k in ("a", "b", "c", "d", "e", "f"))
    if b * b - 4 * a * c >= 0:
        return
    det = 4 * a * c - b * b
    if abs(det) < 1e-12:
        return
    cx = (-2 * c * d + b * e) / det
    cy = (b * d - 2 * a * e) / det
    fp = a * cx * cx + b * cx * cy + c * cy * cy + d * cx + e * cy + f
    ht = (a + c) / 2
    rt = math.sqrt(max(0.0, ((a - c) / 2) ** 2 + (b / 2) ** 2))
    for lam in (ht + rt, ht - rt):
        if abs(lam) < 1e-12:
            return
    axis1 = math.sqrt(max(0.0, -fp / (ht + rt)))
    axis2 = math.sqrt(max(0.0, -fp / (ht - rt)))
    if axis1 <= 0 or axis2 <= 0:
        return
    theta1 = 0.5 * math.atan2(b, a - c)
    if axis1 >= axis2:
        major, minor, rot = axis1, axis2, theta1
    else:
        major, minor, rot = axis2, axis1, theta1 + math.pi / 2
    cv2.ellipse(
        img,
        (int(cx), int(cy)),
        (int(major), int(minor)),
        -rot * 180 / math.pi,
        0,
        360,
        color,
        1,
        cv2.LINE_AA,
    )


def draw_ellipse_geometry(img, center, semi_major, semi_minor, rotation_deg, color, thickness=1):
    cv2.ellipse(
        img,
        (int(center[0]), int(center[1])),
        (int(max(1, semi_major)), int(max(1, semi_minor))),
        rotation_deg,
        0,
        360,
        color,
        thickness,
        cv2.LINE_AA,
    )


def label(img, text, x, y, color):
    cv2.putText(img, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 0, 0), 3, cv2.LINE_AA)
    cv2.putText(img, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.42, color, 1, cv2.LINE_AA)


def main():
    with open(os.path.join(HERE, "measurement.json")) as fh:
        data = json.load(fh)
    out_dir = os.path.join(HERE, "overlays")
    os.makedirs(out_dir, exist_ok=True)
    for window in data["windows"]:
        wid = window["id"]
        frame_path = os.path.join(HERE, "frames", f"{wid}.rgb")
        if not os.path.exists(frame_path):
            print(f"skip {wid}: no anchor frame")
            continue
        raw = np.fromfile(frame_path, dtype=np.uint8)
        if raw.size != WIDTH * HEIGHT * 3:
            print(f"skip {wid}: bad frame size {raw.size}")
            continue
        img = raw.reshape(HEIGHT, WIDTH, 3).copy()
        img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
        dim = (img.astype(np.float64) * 0.45).astype(np.uint8)
        canvas = dim.copy()

        evidence = window.get("ellipseEvidence") or {}
        v010 = window["v010LineOnly"]
        v020 = window["v020EllipseConstrained"]

        # The v0.4.0 conic-selection candidate chain: the primary (cyan),
        # the quota-passing alternatives (magenta), and the WINNING
        # candidate (yellow, thick) — matched by support + coverage against
        # the calibrated metrics' ellipse fields.
        if isinstance(evidence, dict):
            candidates = evidence.get("conicCandidates") or []
            winning_support = None
            winning_coverage = None
            chain_out = v040 if (v040 := window.get("v040Chain") or {}).get("kind") == "calibrated" else (v020 if v020.get("kind") == "calibrated" else {})
            if chain_out:
                m = chain_out.get("metrics", {})
                winning_support = m.get("ellipseSupportPx")
                winning_coverage = m.get("ellipseCoverageBins")
            for index, cand in enumerate(candidates):
                if not isinstance(cand, dict) or "centerPx" not in cand:
                    continue
                is_primary = index == 0
                is_winner = (
                    winning_support is not None
                    and cand.get("supportPx") == winning_support
                    and cand.get("coverageBins") == winning_coverage
                )
                color = (255, 255, 0) if is_primary else (255, 0, 255)
                thickness = 2 if is_winner else 1
                draw_ellipse_geometry(
                    canvas,
                    (cand["centerPx"]["x"], cand["centerPx"]["y"]),
                    cand.get("semiMajorPx", 10),
                    cand.get("semiMinorPx", 5),
                    cand.get("rotationDeg", 0),
                    color,
                    thickness,
                )
            # Fallback: the legacy primary conic record (coefficients).
            if not candidates and evidence.get("conic") is not None:
                draw_conic(canvas, evidence["conic"], (255, 255, 0))
        # The solved homography is not carried in the JSON by design (the
        # payload would bloat); the outcomes + metrics are the record. The
        # grid overlays are drawn for windows whose driver record carries
        # a homography (the driver may embed it when run with
        # EMBED_HOMOGRAPHY=1 — the committed run does).
        if v010.get("kind") == "calibrated" and v010.get("homography") is not None:
            draw_grid(canvas, v010["homography"], (0, 255, 0))
        if v020.get("kind") == "calibrated" and v020.get("homography") is not None:
            draw_grid(canvas, v020["homography"], (0, 165, 255))

        def outcome_text(out, name):
            if out.get("kind") == "calibrated":
                m = out.get("metrics", {})
                return f"{name}: CALIBRATED conf={out['confidence']:.3f} lineFit={m.get('lineFit', 0):.3f}"
            det = out.get("details", {})
            return f"{name}: REFUSED {det.get('failureClassId', out.get('failureClassId', '?'))}"

        label(canvas, f"{wid}  ({window['clipId']}, frames {window['frames'][0]}-{window['frames'][-1]})", 8, 16, (255, 255, 255))
        v030 = window.get("v030Surface") or {}
        label(canvas, outcome_text(v010, "v0.1.0 line-only"), 8, 32, (0, 255, 0))
        label(canvas, outcome_text(v020, "v0.4.0 default"), 8, 48, (0, 165, 255))
        label(canvas, outcome_text(v030, "v0.3.0 single-conic"), 8, 64, (255, 200, 100))
        v040 = window.get("v040Chain") or {}
        chain_detail = ""
        if v040.get("kind") == "refused":
            det = v040.get("details", {})
            if "greenInteriorMedian" in det:
                chain_detail = f" grassMedian={det['greenInteriorMedian']:.3f}"
            elif "quadAreaPx" in det:
                chain_detail = f" quad/conic={det['quadAreaPx']:.1f}/{det['conicAreaPx']:.1f}px2"
        label(canvas, outcome_text(v040, "v0.4.1 chain (opt-in)") + chain_detail, 8, 80, (0, 0, 255))
        if v040.get("kind") == "calibrated" and v040.get("homography") is not None:
            draw_grid(canvas, v040["homography"], (0, 0, 255))
        if isinstance(evidence, dict):
            candidates = evidence.get("conicCandidates") or []
            label(
                canvas,
                f"arc evidence: {evidence.get('arcPixels', '?')} px, {len(candidates)} conic candidates (cyan=primary, magenta=alt, yellow=winner)",
                8,
                96,
                (255, 255, 0),
            )
        out_path = os.path.join(out_dir, f"{wid}.png")
        cv2.imwrite(out_path, canvas)
        print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
