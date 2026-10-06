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

# The validator (the record + the exported files re-hashed):
bun run scripts/evidence/r606-visual-gate/validate-evidence.ts \
  --out /home/z/my-project/public/r606

# The validator's negative battery (the tamper check — must exit 0 with the
# tampered copy refused inside):
bun run scripts/evidence/r606-visual-gate/validate-evidence.ts \
  --battery --out /home/z/my-project/public/r606
```

The outputs (the four MP4s + `manifest.json`) land in the `--out` dir —
OUTSIDE the repo, operator-viewing material. The record
(`visual-gate-prep.json`) lands HERE, in the driver's own dir — the repo's
evidence. The RE-PREP's own record: `visual-gate-reprep.json` (the same
discipline: sha + ftyp + byte-length at the receiving boundary, exports
outside the repo).
