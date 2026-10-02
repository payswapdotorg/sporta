#!/usr/bin/env bash
# typecheck-series.sh — sequential typecheck with memory discipline.
#
# WHY THIS EXISTS (measured, 2026-10-02): the root `typecheck` script fans out
# `bun run --filter '@sporta/*' typecheck` — ~60+ concurrent `tsc --noEmit`
# processes. On the GitHub-hosted 2-vCPU runner (ubuntu-latest) that starves
# the runner service and the job dies with SIGTERM/exit-143 mid-run (run
# 36975350208 on c8df6b3: lint green, three packages already exited 0, then
# the runner shutdown signal — an infrastructure kill, never a type error;
# reproduced locally at exit 137 OOM). Standing order: when a blocker is
# infrastructure, move to a compatible execution mode through the existing
# contract and record it — never weaken the acceptance criteria.
#
# THE CONTRACT (unchanged criteria): every workspace package that declares a
# `typecheck` script runs `tsc --noEmit` to completion; any failure fails the
# run; the full per-package ledger prints so the gate is auditable. The only
# change is execution order: one package at a time.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

fail=0
count=0
failed=""

for dir in packages/* apps/*; do
  manifest="$dir/package.json"
  [ -f "$manifest" ] || continue

  has_typecheck=$(bun -e "const m=require('./$manifest');process.exit(m.scripts&&typeof m.scripts.typecheck==='string'?0:1)" \
    && echo yes || echo no)
  [ "$has_typecheck" = "yes" ] || continue

  name=$(bun -e "console.log(require('./$manifest').name)")
  echo "== [$((count + 1))] typecheck $name ($dir)"
  if (cd "$dir" && bun run typecheck); then
    count=$((count + 1))
  else
    echo "TYPECHECK FAILED: $name ($dir)" >&2
    failed="$failed $name"
    fail=1
    break
  fi
done

echo "== typecheck-series: $count package(s) passed, fail=$fail"
if [ "$fail" -ne 0 ]; then
  echo "== failed:$failed" >&2
  exit 1
fi
