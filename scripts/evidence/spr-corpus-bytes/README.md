# SPR Corpus Substrate Pack (frozen bytes for worker bootstrap)

Purpose: byte-exact, reset-proof bootstrap substrate for wave-2+ workers.
The machine-local evidence root (`/home/z/spr-evidence/`) dies with sandbox
resets; these are the SAME frozen clips, sha-256-verified at commit time
against `scripts/evidence/spr-wave2-corpus/corpus.json` (the canonical
provenance record: acquisition commands, windows, VLM verdicts, the honest
b4-pending note).

Workers MUST verify sha-256 after clone before rendering (the determinism
contract requires the exact frozen substrate):

| clipId | file | sha-256 (first 16) | category |
|---|---|---|---|
| sprclip-b8-inplay-original | `b8p3.mp4` | `969af7c6fdb17209` | real in-play R606 source (substrate) |
| sprclip-b1-wide-broadcast | `clip-b1-wide-broadcast.mp4` | `72ac7f69f9edbadf` | wide broadcast |
| sprclip-b12-determinism-cut | `b8-b12.mp4` | `7cb3d728cc349720` | determinism review cut |
| clip-b2-closeup | `clip-b2-closeup.mp4` | `e65ae48740472f57` | close-up |
| clip-b3-fast-action | `clip-b3-fast-action.mp4` | `f88e3bd5f88f047b` | fast action |
| clip-b5-camera-move | `clip-b5-camera-move.mp4` | `349a37eeb7fc1374` | camera movement |
| clip-b6-setpiece | `clip-b6-setpiece.mp4` | `9ef4be96be392766` | set piece |
| clip-b7-night | `clip-b7-night.mp4` | `0700b8d9185b2328` | night lighting |

Full shas: `corpus.json` (`scripts/evidence/spr-wave2-corpus/`). b4 (crowd)
remains honestly PENDING — see corpus.json note.

Rights posture: acquired broadcast bytes under the recorded R606
registration declaration (analysis / transformation / derivative generation
/ storage); repo is private; provenance chain in
`docs/status/source-preserving-reality-status.md` (w6-spr-2/3/4 sessions).

Committed by the Tech Lead (integration station) — wave-2 dispatch base.
