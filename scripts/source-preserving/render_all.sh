#!/usr/bin/env bash
# SPE-v1 wave-1 full render driver (Worker B, Task spr-w1-b — retry).
#
# Renders the four registry realities (+ the noir vhs profile variant) over:
#   - b8  : the full in-play clip (47.603s, 1190 frames, sha a13396ec...)
#   - b12 : the 12s review cut (b8-b12.mp4 = `ffmpeg -i B8 -t 12 -c copy`)
#
# Determinism proof per artifact (contract hard invariant #2, G-T5):
#   every (reality, profile, tag) is rendered TWICE — once into repro/ and
#   once shipped — and the shipped render is re-run with --verify-repro
#   <repro mp4>, which compares sha256s, FAILS CLOSED on mismatch, and embeds
#   the pair into provenance.reproducibility.doubleRender.
#   The b8 provenance additionally embeds the b12 double-render pair (both
#   sha256s) via --b12-proof <repro/<reality>-b12.repro.json>, re-verified
#   against the files on disk at embed time.
#
# Usage: bash render_all.sh [render-dir]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
R="${1:-/home/z/spr-evidence/render}"
B8=/home/z/w6-real-r606-inplay-evidence/bytes/original-artifact-a13396ec.mp4
REPRO="$R/repro"
mkdir -p "$REPRO" "$R/frames" "$R/selfqa"

# ---- the 12s iteration cut (deterministic stream copy, recreated) ----------
/usr/bin/ffmpeg -y -hide_banner -loglevel error -i "$B8" -t 12 -c copy \
  "$R/b8-b12.mp4"
B12="$R/b8-b12.mp4"

# render <reality> <tag> <clip> <outdir> <profile> [extra args...]
render() {
  local reality="$1" tag="$2" clip="$3" outdir="$4" profile="$5"
  shift 5
  local extra=(--profile "$profile")
  extra+=("$@")
  python3 "$HERE/render.py" --clip "$clip" --reality "$reality" \
    --out-dir "$outdir" --tag "$tag" "${extra[@]}" > /dev/null
}

sha() { sha256sum "$1" | cut -d' ' -f1; }

# items: reality|tag|clip|profile
ITEMS=(
  "cartoon-cel|b12|$B12|default"
  "anime-npr|b12|$B12|default"
  "noir-retro|b12|$B12|noir"
  "noir-retro|b12-vhs|$B12|vhs"
  "motion-trails|b12|$B12|default"
  "cartoon-cel|b8|$B8|default"
  "anime-npr|b8|$B8|default"
  "noir-retro|b8|$B8|noir"
  "noir-retro|b8-vhs|$B8|vhs"
  "motion-trails|b8|$B8|default"
)

for item in "${ITEMS[@]}"; do
  IFS='|' read -r reality tag clip profile <<<"$item"
  name="$reality-$tag"
  echo "== $name =="
  # pass 1: independent render into repro/
  render "$reality" "$tag" "$clip" "$REPRO" "$profile"
  sha1=$(sha "$REPRO/$name.mp4")
  # pass 2: shipped render, verified against pass 1 (fails closed, embeds
  # the sha256 pair into the shipped provenance); b8 renders additionally
  # embed the b12 double-render proof (both sha256s, re-verified on disk)
  b12tag="${tag/b8/b12}"
  if [ "$b12tag" != "$tag" ] && [ -f "$REPRO/$reality-$b12tag.repro.json" ]; then
    render "$reality" "$tag" "$clip" "$R" "$profile" \
      --verify-repro "$REPRO/$name.mp4" \
      --b12-proof "$REPRO/$reality-$b12tag.repro.json"
  else
    render "$reality" "$tag" "$clip" "$R" "$profile" \
      --verify-repro "$REPRO/$name.mp4"
  fi
  sha2=$(sha "$R/$name.mp4")
  if [ "$sha1" != "$sha2" ]; then
    echo "FATAL: double render mismatch for $name ($sha1 vs $sha2)" >&2
    exit 1
  fi
  byte_size=$(stat -c%s "$R/$name.mp4")
  frames=$(/usr/bin/ffprobe -v error -select_streams v:0 -count_frames \
    -show_entries stream=nb_read_frames -of csv=p=0 "$R/$name.mp4")
  python3 - "$reality" "$tag" "$profile" "$clip" "$name" "$sha1" "$sha2" \
    "$byte_size" "$frames" "$R" "$REPRO" <<'PY'
import json, sys
(reality, tag, profile, clip, name, sha1, sha2, size, frames, R, REPRO) = sys.argv[1:12]
rec = {
    "reality": reality,
    "profile": profile,
    "inputClip": clip,
    "artifact": name + ".mp4",
    "renders": [
        {"pass": 1, "file": REPRO + "/" + name + ".mp4", "sha256": sha1},
        {"pass": 2, "file": R + "/" + name + ".mp4", "sha256": sha2,
         "byteSize": int(size)},
    ],
    "frameCount": int(frames),
    "byteEqual": sha1 == sha2,
}
with open(R + "/repro/" + name + ".repro.json", "w") as f:
    json.dump(rec, f, indent=2)
    f.write("\n")
print("  deterministic: %s (%s frames, %s B)" % (rec["byteEqual"], frames, size))
PY
done

# ---- comparison frames (b8 renders), t = 2/15/30/45 s ----------------------
frame() {  # frame <mp4> <t-sec> <out.png>
  /usr/bin/ffmpeg -y -v error -ss "$2" -i "$1" -frames:v 1 "$3"
}
for t in 2 15 30 45; do
  frame "$B8" "$t" "$R/frames/original-t${t}s.png"
  for r in cartoon-cel anime-npr noir-retro motion-trails; do
    frame "$R/$r-b8.mp4" "$t" "$R/frames/$r-t${t}s.png"
  done
  frame "$R/noir-retro-b8-vhs.mp4" "$t" "$R/frames/noir-retro-vhs-t${t}s.png"
done

echo "ALL RENDER PASSES COMPLETE"
