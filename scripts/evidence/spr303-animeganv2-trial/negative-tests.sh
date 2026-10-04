#!/usr/bin/env bash
# SPR303 — the fail-closed validator NEGATIVE TESTS (worker 65-i).
#
# The proof that validate-trial.ts actually refuses fabricated/laundered
# records (the record-benchmark.ts convention). Each case mutates a COPY of
# trial-record.json in /tmp, runs the validator against the copy, and asserts
# exit 1 with the failure named; the final check re-runs the validator on the
# committed record and asserts exit 0. Any case failing to fail exits 1.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
VALIDATOR="$HERE/validate-trial.ts"
RECORD="$HERE/trial-record.json"
TMP="$(mktemp -d)"

run_case() {
  local name="$1" expect="$2" rec="$3"
  bun "$VALIDATOR" "$rec" >/dev/null 2>"$TMP/err.txt"
  local rc=$?
  if [ "$rc" -ne "$expect" ]; then
    echo "NEGATIVE TEST FAILED: $name (expected exit $expect, got $rc)"
    cat "$TMP/err.txt" >&2
    rm -rf "$TMP"
    exit 1
  fi
  if [ "$expect" -eq 1 ]; then
    echo "  refused ($name): $(head -2 "$TMP/err.txt" | tail -1)"
  else
    echo "  accepted ($name)"
  fi
}

echo "SPR303 negative tests (the fabricated/laundered record must FAIL):"

# (a) a fabricated GPU latency measurement (no GPU ever ran on this host)
python3 - "$RECORD" "$TMP/a.json" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
d["measurements"]["latency"]["gpuLatencyP50Ms"] = 42.0
json.dump(d, open(sys.argv[2], "w"), indent=1)
EOF
run_case "fabricated gpuLatencyP50Ms" 1 "$TMP/a.json"

# (b) the TL visual gate laundered to APPROVED (the TL owns the gate)
python3 - "$RECORD" "$TMP/b.json" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
d["tlApproval"]["status"] = "APPROVED"
json.dump(d, open(sys.argv[2], "w"), indent=1)
EOF
run_case "tlApproval laundered to APPROVED" 1 "$TMP/b.json"

# (c) the weights sha tampered (the pin is the verification chain)
python3 - "$RECORD" "$TMP/c.json" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
d["weights"]["sha256"] = "0" * 64
json.dump(d, open(sys.argv[2], "w"), indent=1)
EOF
run_case "weights sha tampered" 1 "$TMP/c.json"

# (d) a laundered baseline (anime-npr collapse axis rewritten 1.8 -> 2.9)
python3 - "$RECORD" "$TMP/d.json" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
d["abVerdict"]["animeNprMinAxisMean"] = 2.9
json.dump(d, open(sys.argv[2], "w"), indent=1)
EOF
run_case "laundered anime-npr baseline" 1 "$TMP/d.json"

# (e) a drifted latency measurement (record != the executed latency.json)
python3 - "$RECORD" "$TMP/e.json" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
d["measurements"]["latency"]["p50TotalMs"] = 12.5
json.dump(d, open(sys.argv[2], "w"), indent=1)
EOF
run_case "drifted p50TotalMs" 1 "$TMP/e.json"

# (f) a silent EbSynth drop (the deferral record erased)
python3 - "$RECORD" "$TMP/f.json" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
del d["ebsynthLeg"]["recordedDesign"]
json.dump(d, open(sys.argv[2], "w"), indent=1)
EOF
run_case "EbSynth deferral record gutted" 1 "$TMP/f.json"

# restored: the committed record passes
run_case "the committed record" 0 "$RECORD"

rm -rf "$TMP"
echo "ALL NEGATIVE TESTS PASS (6 refusals + the clean pass)."
