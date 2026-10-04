#!/usr/bin/env bash
# R607 65-j — the NEGATIVE TESTS for validate-evidence.ts (the fail-closed
# proof: each crafted variant MUST be refused exit 1 with the failing check
# named; the committed evidence tree passes exit 0 — run by commands.md §7).
#
# Usage: bash scripts/evidence/r607-e2b-hosted-rerun/negative-tests.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
VALIDATOR="$HERE/validate-evidence.ts"
TMP="$(mktemp -d /tmp/r607-e2b-neg.XXXXXX)"

# A fresh copy of the committed evidence tree (the variants' substrate).
seed_variant() {
  local name="$1"
  local dir="$TMP/$name"
  cp -r "$HERE" "$dir"
  rm -rf "$dir/runs"
  echo "$dir"
}

fail=0

# N1 — a FABRICATED admission-PASS without the executed run: the record claims
# uploadState 'stored' but the admission's workerJobId is not in the ledger's
# usage drain (no executed job backs the claimed PASS).
dir="$(seed_variant n1)"
python3 - "$dir" <<'EOF'
import json, sys
p = sys.argv[1] + "/golden-path-seam.json"
d = json.load(open(p))
d["stages"]["admission"]["workerJobId"] = "mtjob-fabricated0000000000000000000000000000"
json.dump(d, open(p, "w"), indent=2)
EOF
if bun run "$VALIDATOR" --dir "$dir" > "$TMP/n1.out" 2>&1; then
  echo "N1 FAIL: the fabricated admission-PASS was NOT refused"; fail=1
else
  echo "N1 ok: $(grep -m1 '✗' "$TMP/n1.out")"
fi

# N2 — a LAUNDERED deploy id (a fabricated deployment the provider refused).
dir="$(seed_variant n2)"
python3 - "$dir" <<'EOF'
import json, sys
p = sys.argv[1] + "/deploy-record.json"
d = json.load(open(p))
d["deployOutcome"]["deploymentId"] = "dpl_fabricated00000000000000000000"
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
FAKE_TOKEN="e2b_""012345678901234567890123456789012345678901234567"
printf 'api key: %s\n' "$FAKE_TOKEN" >> "$dir/README.md"
if bun run "$VALIDATOR" --dir "$dir" > "$TMP/n3.out" 2>&1; then
  echo "N3 FAIL: the token-shaped string was NOT refused"; fail=1
else
  echo "N3 ok: $(grep -m1 '✗' "$TMP/n3.out")"
fi

# N4 — the worker's own stats DISAGREE with the record's accounting read.
dir="$(seed_variant n4)"
python3 - "$dir" <<'EOF'
import json, sys
p = sys.argv[1] + "/worker-stats.json"
d = json.load(open(p))
d["jobsDispatched"] = 5
json.dump(d, open(p, "w"), indent=2)
EOF
if bun run "$VALIDATOR" --dir "$dir" > "$TMP/n4.out" 2>&1; then
  echo "N4 FAIL: the stats disagreement was NOT refused"; fail=1
else
  echo "N4 ok: $(grep -m1 '✗' "$TMP/n4.out")"
fi

# N5 — a LAUNDERED determinism verdict (identical=true over differing shas).
dir="$(seed_variant n5)"
python3 - "$dir" <<'EOF'
import json, sys
p = sys.argv[1] + "/determinism.json"
d = json.load(open(p))
d["runs"]["run2"]["artifactSha256"] = "a" * 64
json.dump(d, open(p, "w"), indent=2)
EOF
if bun run "$VALIDATOR" --dir "$dir" > "$TMP/n5.out" 2>&1; then
  echo "N5 FAIL: the laundered determinism verdict was NOT refused"; fail=1
else
  echo "N5 ok: $(grep -m1 '✗' "$TMP/n5.out")"
fi

# The committed tree must PASS (the guard is not a blanket refuser).
if bun run "$VALIDATOR" > "$TMP/pass.out" 2>&1; then
  echo "committed tree ok: $(head -1 "$TMP/pass.out")"
else
  echo "committed tree FAIL: the validator refused the honest evidence"; fail=1
fi

rm -rf "$TMP"
if [ "$fail" -eq 0 ]; then
  echo "=== ALL NEGATIVE TESTS PASS (fail-closed proven) ==="
else
  echo "=== NEGATIVE TESTS FAILED ==="
fi
exit "$fail"
