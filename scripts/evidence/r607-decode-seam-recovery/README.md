# R607 DECODE-SEAM RECOVERY (the quota-window re-run at the seam merge)

The TL flight that closes the R607 hosted re-run the 65-j flight could not
(blocked at the account's free-tier deploy quota): the pinned revision is
the **decode-seam merge `920c556c18ba984d22d4bea50895b6a173b0a4bd`** —
`Merge work/r607-decode-seam` (R607 gap flight A: the R207 decode seam,
the 62-c Gap 1 closure) — whose worker profile advertises the ADDITIVE
`decode-probe`/`decode-frames` pair and whose composition injects the http
decode port into `RealToSwmPipeline` when `MEDIA_TOOLCHAIN=http`.

## The honest scope

- **The live decode-seam leg** (`decode-seam-live.ts` + `decode-seam-live.json`):
  the seam's client half (`createHttpDecodePort`) driving the pinned-revision
  E2B worker over the PUBLIC wire — the demux-level W102 probe document, the
  bounded rgb24 frame batch, the fail-closed typed budget refusal, and the
  accounting identities — from the same network position the Vercel runtime
  holds. The client is this driver, NOT the hosted runtime.
- **The hosted leg** (commands.md §4–§5): the env re-point + the deploy
  attempt (the quota window is the honest variable — the 65-j refusal was
  `api-deployments-free-per-day` at ~08:55Z Oct 4; the typed outcome is
  recorded either way) + the hosted golden path when the deploy lands. At
  the seam merge the code-measured expectation FLIPS: the hosted upload's
  R207 decode now routes over the wire to the live worker (the recorded
  Gap 1 refusal class is closed by the seam) — the first hosted run whose
  upload can proceed past the decode boundary.

## The fix-forward over the 65-j orchestration

The 65-j `orchestrate-e2b.ts` measured the companion compute worker (:3973)
but never STARTED it on fresh provision — the inherited
`COMPUTE_PROVIDER=http` posture requires a live compute worker at the
composition's fail-loud boot, and the 65-j record honestly noted it as
infrastructure. This flight's orchestration starts and measures BOTH
workers on fresh provision, so a landed deploy stays bootable.

## Files

- `orchestrate-e2b.ts` — the sandbox provisioner (pinned at the seam merge;
  fails closed on any other HEAD; writes `sandbox-record.json`).
- `decode-seam-live.ts` — the live decode-seam driver (writes
  `decode-seam-live.json`; every number measured).
- `commands.md` — the re-runnable procedure (the 65-j §6 recovery path,
  executed at the seam merge).
- `sandbox-record.json` / `decode-seam-live.json` / `deploy-record.json` /
  `hosted-golden-path.json` — the measured records (fail-closed validated).
