# The R606 visual-gate prep — the re-runnable commands

From the REPO ROOT, with the repo installed (`bun install --frozen-lockfile`
once per clone — the drivers ride the workspace's packages):

```sh
# The prep flight (the four realities rendered + exported):
bun run scripts/evidence/r606-visual-gate/visual-gate-prep.ts \
  --out /home/z/my-project/public/r606

# The same, a longer clip (the gate's substance re-measured):
bun run scripts/evidence/r606-visual-gate/visual-gate-prep.ts \
  --out /home/z/my-project/public/r606 --duration-seconds 6

# The RE-PREP flight (the verdict's copy-and-adapt: the same REAL goal clip,
# the derived kinds through the frozen documented ffmpeg chains; downloads
# the researched Mixkit clip live, or --source a pre-downloaded copy):
bun run scripts/evidence/r606-visual-gate/visual-gate-reprep.ts \
  --out /home/z/my-project/public/r606-reprep
bun run scripts/evidence/r606-visual-gate/visual-gate-reprep.ts \
  --out /home/z/my-project/public/r606-reprep --source /tmp/mixkit-43499-720.mp4

# The GENERATIVE RE-PREP flight (the re-verdict's style-fidelity fix: the
# same REAL goal clip, every sampled frame per-frame generatively restyled
# with the design-gated genre prompts). TWO steps — the generation lane runs
# OUTSIDE the repo (the TL station's z-ai image-edit lane; the SDK is an
# environment capability, never a repo dependency), then THIS driver
# verifies + manifests + records:
#   step 1 (the TL station, /home/z/my-project): the design gate first —
#     bun scripts/r606-design-gate.ts
#   (the prompts freeze only on the strict VLM genre check's PASS) — then the
#   paced, resume-safe, chunked batch (the sandbox reaps background processes
#   between tool calls; the lane 429s on bursts):
#     bun scripts/r606-genstyle.ts --max-seconds 400
#   (re-run until "done"; then the video-level spot check:
#     bun scripts/r606-video-check.ts
#   whose verdict lands as video-check.txt in the out dir)
#   step 2 (the repo, the verifier + manifest + record):
bun run scripts/evidence/r606-visual-gate/visual-gate-reprep2.ts \
  --out /home/z/my-project/public/r606-reprep2

# The validator (the record + the exported files re-hashed):
bun run scripts/evidence/r606-visual-gate/validate-evidence.ts \
  --out /home/z/my-project/public/r606

# The validator's negative battery (the tamper check — must exit 0 with the
# tampered copies refused inside):
bun run scripts/evidence/r606-visual-gate/validate-evidence.ts \
  --battery --out /home/z/my-project/public/r606 \
  --reprep-out /home/z/my-project/public/r606-reprep \
  --reprep2-out /home/z/my-project/public/r606-reprep2
```

The outputs (the four MP4s + `manifest.json`) land in the `--out` dir —
OUTSIDE the repo, operator-viewing material. The record
(`visual-gate-prep.json`) lands HERE, in the driver's own dir — the repo's
evidence. The RE-PREP's own record: `visual-gate-reprep.json` (the same
discipline: sha + ftyp + byte-length at the receiving boundary, exports
outside the repo). The GENERATIVE RE-PREP's own record:
`visual-gate-reprep2.json` (the verifier driver's discipline: the four MP4s
re-hashed + the original verified byte-identical to the researched source +
the generation record's own claims cross-checked against the bytes on disk).


## The re-re-verdict record's validator run (after verdict-reprep2.json)

The validator now carries the RE-RE-VERDICT record's shape checks (criterion 1
PASS-not-contested / criterion 2 FAIL on temporal consistency, the MEASURED
flicker metrics + the VLM ball check carried — a laundered re-re-verdict is
refused by the battery):

```bash
bun run scripts/evidence/r606-visual-gate/validate-evidence.ts \
  --out /home/z/my-project/public/r606 \
  --reprep-out /home/z/my-project/public/r606-reprep \
  --reprep2-out /home/z/my-project/public/r606-reprep2
```
