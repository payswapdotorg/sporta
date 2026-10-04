#!/usr/bin/env bash
# R607 DECODE-SEAM RECOVERY — the NEGATIVE TESTS for validate-evidence.ts
# (the fail-closed proof: each crafted variant MUST be refused exit 1 with
# the failing check named; the committed evidence tree passes exit 0).
#
# Usage: bash scripts/evidence/r607-decode-seam-recovery/negative-tests.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
VALIDATOR="$HERE/validate-evidence.ts"
TMP="$(mktemp -d /tmp/r607-dcsr-neg.XXXXXX)"

# A fresh copy of the committed evidence tree (the variants' substrate).
seed_variant() {
  local name="$1"
  local dir="$TMP/$name"
  cp -r "$HERE" "$dir"
  rm -rf "$dir/runs"
  echo "$dir"
}

fail=0

# N1 — a FABRICATED hosted closure: the upload block is doctored to claim
# 201/stored, but the media job is still poll-timeout (no executed run
# backs the claimed terminal state).
dir="$(seed_variant n1)"
python3 - "$dir" <<'EOF'
import json, sys
p = sys.argv[1] + "/hosted-golden-path.json"
d = json.load(open(p))
u = d["steps"]["upload"]
u["httpStatusCode"] = 201
u["body"] = {"source": {"asset": {"uploadState": "stored", "checksumVerified": True}}}
json.dump(d, open(p, "w"), indent=2)
EOF
if bun run "$VALIDATOR" --dir "$dir" > "$TMP/n1.out" 2>&1; then
  echo "N1 FAIL: the fabricated hosted closure was NOT refused"; fail=1
else
  echo "N1 ok: $(grep -m1 '✗' "$TMP/n1.out")"
fi

# N2 — a LAUNDERED deployment id (a fabricated provider deployment): the
# live cross-check (VERCEL_TOKEN present in the dev sandbox) must refuse
# it — the fake id does not resolve at the provider.
dir="$(seed_variant n2)"
python3 - "$dir" <<'EOF'
import json, sys
p = sys.argv[1] + "/deploy-record.json"
d = json.load(open(p))
d["deploy"]["deploymentId"] = "dpl_fabricated000000000000000"
json.dump(d, open(p, "w"), indent=2)
EOF
if bun run "$VALIDATOR" --dir "$dir" > "$TMP/n2.out" 2>&1; then
  echo "N2 FAIL: the laundered deployment id was NOT refused"; fail=1
else
  echo "N2 ok: $(grep -m1 '✗' "$TMP/n2.out")"
fi

# N3 — a TOKEN-SHAPED string leaked into the tree (the scan must trip).
# (The fake token is BUILT at runtime — the committed source carries no
#  contiguous token-shaped string, so the validator's scan stays clean.)
dir="$(seed_variant n3)"
FAKE_TOKEN="e2b_""0123456789012345678901234567890123456789"
printf 'api key: %s\n' "$FAKE_TOKEN" >> "$dir/README.md"
if bun run "$VALIDATOR" --dir "$dir" > "$TMP/n3.out" 2>&1; then
  echo "N3 FAIL: the token-shaped leak was NOT refused"; fail=1
else
  echo "N3 ok: $(grep -m1 '✗' "$TMP/n3.out")"
fi

# N4 — a STATS DISAGREEMENT: the usage drain count doctored to disagree
# with the dispatched count (the two-reads identity broken).
dir="$(seed_variant n4)"
python3 - "$dir" <<'EOF'
import json, sys
p = sys.argv[1] + "/decode-seam-live.json"
d = json.load(open(p))
d["accounting"]["usageDrainCount"] = d["accounting"]["stats"]["jobsDispatched"] + 3
json.dump(d, open(p, "w"), indent=2)
EOF
if bun run "$VALIDATOR" --dir "$dir" > "$TMP/n4.out" 2>&1; then
  echo "N4 FAIL: the stats disagreement was NOT refused"; fail=1
else
  echo "N4 ok: $(grep -m1 '✗' "$TMP/n4.out")"
fi

# N5 — a WRONG PINNED SHA (the worker running some other revision — the
# seam profile claim would be about code that is not the seam merge).
dir="$(seed_variant n5)"
python3 - "$dir" <<'EOF'
import json, sys
p = sys.argv[1] + "/sandbox-record.json"
d = json.load(open(p))
d["provider"]["pinnedRevision"]["sha"] = "300c035b4cf0a0e89a4a08c465d9d0104a9b3efd"
json.dump(d, open(p, "w"), indent=2)
EOF
if bun run "$VALIDATOR" --dir "$dir" > "$TMP/n5.out" 2>&1; then
  echo "N5 FAIL: the wrong pinned sha was NOT refused"; fail=1
else
  echo "N5 ok: $(grep -m1 '✗' "$TMP/n5.out")"
fi

# N6 — an INCOMPLETE seam profile (decode-frames dropped from the
# advertised operations — the ADDITIVE pair is the seam's whole point).
dir="$(seed_variant n6)"
python3 - "$dir" <<'EOF'
import json, sys
p = sys.argv[1] + "/sandbox-record.json"
d = json.load(open(p))
d["worker"]["descriptor"]["operationsAdvertised"] = ["normalize", "probe"]
json.dump(d, open(p, "w"), indent=2)
EOF
if bun run "$VALIDATOR" --dir "$dir" > "$TMP/n6.out" 2>&1; then
  echo "N6 FAIL: the incomplete operation profile was NOT refused"; fail=1
else
  echo "N6 ok: $(grep -m1 '✗' "$TMP/n6.out")"
fi

rm -rf "$TMP"
if [ "$fail" -ne 0 ]; then
  echo "✗ negative-tests: $fail REFUSAL(S) MISSING"
  exit 1
fi
echo "✓ negative-tests: all 6 crafted variants refused with the check named; the fail-closed gate is real"
