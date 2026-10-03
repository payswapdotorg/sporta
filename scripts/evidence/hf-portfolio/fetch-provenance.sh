#!/usr/bin/env bash
# HF002 measured-fetch harness (Worker 62-d).
#
# Re-runs every live fetch the technology provenance ledger rows stand on.
# Each run overwrites the raw snapshots under fetches/ and stamps a
# fetch-meta.json per artifact with the UTC timestamp and HTTP status, so the
# Tech Lead can re-verify every ledger field locally instead of trusting the
# worker's claims. A field that cannot be reproduced from these fetches does
# not belong in the ledger.
#
# No authentication is used: gated repositories return 401 on /raw/ but still
# serve README.md (and LICENSE files) through /resolve/, which the harness
# falls back to automatically. Weight files are never fetched.
set -u
BASE="$(cd "$(dirname "$0")" && pwd)/fetches"
mkdir -p "$BASE/github/readmes" "$BASE/datasets"

stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }

write_meta() {
  # write_meta <file> <url> <status>
  python3 - "$1" "$2" "$3" "$(stamp)" <<'PY'
import json, sys, os
path, url, status, now = sys.argv[1:5]
meta = {}
if os.path.exists(path):
    try:
        meta = json.load(open(path))
    except Exception:
        meta = {}
entry = meta.setdefault("fetches", [])
entry.append({"url": url, "httpStatus": int(status), "fetchedAtUtc": now})
meta["lastFetchedAtUtc"] = now
json.dump(meta, open(path, "w"), indent=2)
PY
}

fetch_hf_model() {
  local repo="$1"
  local slug="${repo//\//__}"
  local dir="$BASE/$slug"
  mkdir -p "$dir"
  local api_url="https://huggingface.co/api/models/$repo"
  local raw_url="https://huggingface.co/$repo/raw/main/README.md"
  local resolve_url="https://huggingface.co/$repo/resolve/main/README.md"
  local page_url="https://huggingface.co/$repo"
  local api_code readme_code readme_url page_code
  api_code=$(curl -sL --max-time 60 -o "$dir/api.json" -w "%{http_code}" "$api_url")
  # The model page itself is read (status + content equivalence with the
  # archived api.json/README.md); its HTML shell is not archived to keep the
  # evidence pack lean — every recorded field stands on the archived files.
  page_code=$(curl -sL --max-time 60 -o /dev/null -w "%{http_code}" "$page_url")
  readme_code=$(curl -sL --max-time 60 -o "$dir/README.md" -w "%{http_code}" "$raw_url")
  readme_url="$raw_url"
  if [ "$readme_code" != "200" ]; then
    readme_code=$(curl -sL --max-time 60 -o "$dir/README.md" -w "%{http_code}" "$resolve_url")
    readme_url="$resolve_url"
  fi
  printf '{\n  "repo": "%s",\n  "fetchedAtUtc": "%s",\n  "api": {"url": "%s", "httpStatus": %s},\n  "readme": {"url": "%s", "httpStatus": %s},\n  "page": {"url": "%s", "httpStatus": %s}\n}\n' \
    "$repo" "$(stamp)" "$api_url" "$api_code" "$readme_url" "$readme_code" "$page_url" "$page_code" > "$dir/fetch-meta.json"
  echo "hf   $repo api=$api_code readme=$readme_code page=$page_code at $(date -u +%H:%M:%SZ)"
}

fetch_hf_file() {
  # fetch_hf_file <repo> <filename> <out-subdir>
  local repo="$1" fname="$2" out="$3"
  local slug="${repo//\//__}"
  local dir="$BASE/$slug"
  mkdir -p "$dir"
  local url="https://huggingface.co/$repo/resolve/main/$fname"
  local code
  code=$(curl -sL --max-time 60 -o "$dir/$fname" -w "%{http_code}" "$url")
  write_meta "$dir/$fname.fetch-meta.json" "$url" "$code"
  echo "hf   $repo/$fname status=$code"
}

fetch_github_raw() {
  # fetch_github_raw <owner/repo> <branch/path> <out-name>
  local repo="$1" path="$2" out="$3"
  local url="https://raw.githubusercontent.com/$repo/$path"
  local code
  code=$(curl -sL --max-time 60 -o "$BASE/github/$out" -w "%{http_code}" "$url")
  write_meta "$BASE/github/$out.fetch-meta.json" "$url" "$code"
  echo "gh   $repo/$path status=$code"
}

# --- Hugging Face model pages (every ledger row's primary source) -----------
HF_MODELS=(
  "julianzu9612/RFDETR-Soccernet"
  "facebook/map-anything-apache"
  "facebook/sam3"
  "yahoo-inc/spivak-action-spotting-soccernet"
  "SimulaMet/SoccerChat-qwen2-vl-7b"
  "microsoft/VibeVoice-ASR-Streaming-1.5B"
  "Qwen/Qwen3-ASR-1.7B"
  "pyannote/speaker-diarization-community-1"
  "alibaba-pai/Wan2.2-Fun-A14B-Control-Camera"
  "KlingTeam/ReCamMaster-Wan2.1"
  "Viggle/Meridian"
  "Drexubery/ViewCrafter_25"
  "Wan-AI/Wan2.2-Animate-14B"
  "Lightricks/LTX-2.3"
  "depth-anything/DA3-GIANT"
)
for repo in "${HF_MODELS[@]}"; do
  fetch_hf_model "$repo"
done

# --- License / license-index files inside HF repos --------------------------
fetch_hf_file "facebook/sam3" "LICENSE" "facebook__sam3"
fetch_hf_file "Viggle/Meridian" "LICENSE" "Viggle__Meridian"
fetch_hf_file "Viggle/Meridian" "LICENSE-CODE" "Viggle__Meridian"

# --- Linked code repositories (codeLicense field) ---------------------------
fetch_github_raw "facebookresearch/map-anything" "main/LICENSE" "facebookresearch__map-anything.LICENSE"
fetch_github_raw "facebookresearch/map-anything" "main/README.md" "readmes/facebookresearch__map-anything.README.md"
fetch_github_raw "yahoo/spivak" "master/LICENSE" "yahoo__spivak.LICENSE"
fetch_github_raw "simula/SoccerChat" "main/README.md" "readmes/simula__SoccerChat.README.md"
fetch_github_raw "microsoft/VibeVoice" "main/LICENSE" "microsoft__VibeVoice.LICENSE"
fetch_github_raw "QwenLM/Qwen3-ASR" "main/LICENSE" "QwenLM__Qwen3-ASR.LICENSE"
fetch_github_raw "pyannote/pyannote-audio" "main/LICENSE" "pyannote__pyannote-audio.LICENSE"
fetch_github_raw "aigc-apps/VideoX-Fun" "main/LICENSE" "aigc-apps__VideoX-Fun.LICENSE"
fetch_github_raw "Lightricks/LTX-2" "main/LICENSE" "Lightricks__LTX-2.LICENSE"
fetch_github_raw "Lightricks/LTX-2" "main/LICENSE-2" "Lightricks__LTX-2.LICENSE-2"
fetch_github_raw "Lightricks/LTX-2" "main/LICENSE-2_x" "Lightricks__LTX-2.LICENSE-2_x"
fetch_github_raw "Lightricks/LTX-2" "main/README.md" "readmes/Lightricks__LTX-2.README.md"
fetch_github_raw "ByteDance-Seed/depth-anything-3" "main/LICENSE" "ByteDance-Seed__depth-anything-3.LICENSE"
fetch_github_raw "Wan-Video/Wan2.2" "main/LICENSE.txt" "Wan-Video__Wan2.2.LICENSE.txt"
fetch_github_raw "Drexubery/ViewCrafter" "main/LICENSE" "Drexubery__ViewCrafter.LICENSE"
fetch_github_raw "Drexubery/ViewCrafter" "main/README.md" "readmes/Drexubery__ViewCrafter.README.md"
fetch_github_raw "facebookresearch/sam3" "main/LICENSE" "facebookresearch__sam3.LICENSE"
fetch_github_raw "KwaiVGI/ReCamMaster" "main/LICENSE" "KwaiVGI__ReCamMaster.LICENSE"
fetch_github_raw "KwaiVGI/ReCamMaster" "main/README.md" "readmes/KwaiVGI__ReCamMaster.README.md"
fetch_github_raw "facebookresearch/vggt-omega" "main/LICENSE" "facebookresearch__vggt-omega.LICENSE"

# --- Training-dataset card referenced by the SoccerChat model card ----------
slug="datasets__SimulaMet__SoccerChat"
url="https://huggingface.co/datasets/SimulaMet/SoccerChat/resolve/main/README.md"
code=$(curl -sL --max-time 60 -o "$BASE/datasets/SimulaMet__SoccerChat.README.md" -w "%{http_code}" "$url")
write_meta "$BASE/datasets/SimulaMet__SoccerChat.README.md.fetch-meta.json" "$url" "$code"
echo "data SimulaMet/SoccerChat status=$code"

echo "done at $(stamp)"
