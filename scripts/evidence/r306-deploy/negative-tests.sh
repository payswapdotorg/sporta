# R306 DEPLOY LEG — the fail-closed validator's NEGATIVE TESTS (the crafted
# tampered/laundered variants a record must be REFUSED for; each runs the
# validator against a mutated copy and asserts exit 1 WITH the check named).
#
# Run (from the REPO ROOT, with VERCEL_TOKEN in the env for the live
# provider cross-check):
#   source /home/z/.sporta-env
#   bash scripts/evidence/r306-deploy/negative-tests.sh

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d /tmp/r306-deploy-negative.XXXXXX)"
PASS=0
FAIL=0

# variant <name> — copies the evidence pack; the caller mutates it in
# $WORK/<name> before running the validator.
run_variant() {
  local name="$1"
  local dir="$WORK/$name"
  mkdir -p "$dir"
  cp "$HERE"/*.json "$dir/"
}

check_refused() {
  local name="$1"
  local expect="$2"
  local out
  out="$(VERCEL_TOKEN="${VERCEL_TOKEN:-}" bun run "$HERE/validate-evidence.ts" --dir "$WORK/$name" 2>&1)"
  if [ "$?" -ne 0 ] && printf '%s' "$out" | grep -q "$expect"; then
    echo "  ✓ $name REFUSED with the check named"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $name NOT refused as expected ($expect)"
    echo "$out" | head -5
    FAIL=$((FAIL + 1))
  fi
}

echo "== the r306-deploy negative tests (tampered variants must be REFUSED) =="

# 1. a laundered PATCH status (a 500 recorded as a 200)
run_variant laundered-patch
python3 - "$WORK/laundered-patch/deploy-record.json" <<'PY'
import json, sys
path = sys.argv[1]
d = json.load(open(path))
d["envWiring"]["patches"][0]["httpStatusCode"] = 500
json.dump(d, open(path, "w"), indent=2)
PY
check_refused laundered-patch "PATCH landed"

# 2. a laundered deployment state (BUILDING recorded as READY)
run_variant laundered-state
python3 - "$WORK/laundered-state/deploy-record.json" <<'PY'
import json, sys
path = sys.argv[1]
d = json.load(open(path))
d["deploy"]["state"] = "BUILDING"
json.dump(d, open(path, "w"), indent=2)
PY
check_refused laundered-state "deployment READY"

# 3. a fabricated deployment id (does not resolve at the provider — the LIVE
#    cross-check refuses it)
run_variant fabricated-id
python3 - "$WORK/fabricated-id/deploy-record.json" <<'PY'
import json, sys
path = sys.argv[1]
d = json.load(open(path))
d["deploy"]["deploymentId"] = "dpl_ThisIdWasNeverDeployedAnywhere99"
json.dump(d, open(path, "w"), indent=2)
PY
check_refused fabricated-id "resolves at the provider"

# 4. a laundered marker (the alias health's marker disagreeing with the
#    PATCHed value — the four-way agreement refuses it)
run_variant laundered-marker
python3 - "$WORK/laundered-marker/deploy-record.json" <<'PY'
import json, sys
path = sys.argv[1]
d = json.load(open(path))
d["productionMeasured"]["thePublicSurface"]["apiPlatformHealth"]["deployMarker"] = "r607-decode-seam-rerun-2"
d["productionMeasured"]["thePublicSurface"]["apiPlatformHealth"]["body"]["deployMarker"] = "r607-decode-seam-rerun-2"
json.dump(d, open(path, "w"), indent=2)
PY
check_refused laundered-marker "FOUR-WAY MARKER AGREEMENT"

# 5. a laundered boot-time fetch (the compute worker's descriptor measured
#    502, recorded as 200 — the 62-c incident class laundered away)
run_variant laundered-boot-fetch
python3 - "$WORK/laundered-boot-fetch/compute-worker-record.json" <<'PY'
import json, sys
path = sys.argv[1]
d = json.load(open(path))
d["computeWorker"]["descriptor"]["httpStatusCode"] = 502
json.dump(d, open(path, "w"), indent=2)
PY
check_refused laundered-boot-fetch "BOOT-TIME FETCH"

# 6. a planted token in the evidence tree (the token scan refuses it) —
#    the planted string is ASSEMBLED AT RUNTIME from disjoint pieces (the
#    prefix and the body are never contiguous in the committed file, so the
#    tree's own token scan stays clean while the variant's scan refuses)
run_variant planted-token
planted="e2b""_abcdefghijklmnopqrstuvwxyz123456"
printf 'the leaked key %s sat right here\n' "$planted" \
  > "$WORK/planted-token/planted.txt"
check_refused planted-token "token-scan"

echo "== $PASS refused, $FAIL not refused (expected 6/0) =="
rm -rf "$WORK"
[ "$FAIL" -eq 0 ] && [ "$PASS" -eq 6 ]
