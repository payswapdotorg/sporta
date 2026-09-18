/**
 * Apparent identity-switch counting (R203) — the honest adapter-level
 * continuity metric shared by both player-tracking candidates.
 *
 * DEFINITION (documented once, honored exactly): an APPARENT identity switch
 * is a strongly-overlapping same-label box pair across ADJACENT frames whose
 * track ids differ. Pairing is greedy one-to-one over adjacent frame pairs:
 * candidate pairs `(a, b)` (a in frame k, b in frame k+1, same label) are
 * sorted best-IoU-first with the deterministic tie-break (IoU descending,
 * frame-k array order ascending, frame-(k+1) array order ascending) and
 * consumed greedily; a consumed pair with `iou >= threshold` and
 * `a.trackId !== b.trackId` counts as ONE apparent switch.
 *
 * HONESTY: without ground truth NO tracker can count true switches — this
 * is an adapter-level PROXY that both candidates are scored by identically.
 * The benchmark's GROUND-TRUTH switch count (from the synthetic fixtures'
 * known identities) is the evaluative metric; this one is what a live
 * pipeline can compute without ground truth.
 *
 * Pure function of the per-frame tracked boxes: no RNG, no clock.
 */
import { iou } from "@sporta/perception-detection";
import type { TrackedBox } from "@sporta/perception-tracking";
import { PLAYER_TRACKING_SWITCH_IOU } from "../adapter";

/**
 * Counts apparent identity switches across a per-frame tracked-box sequence
 * (see the module docs for the exact pairing rule).
 */
export function countApparentIdentitySwitches(
  perFrame: readonly (readonly TrackedBox[])[],
  iouThreshold: number = PLAYER_TRACKING_SWITCH_IOU,
): number {
  if (!Number.isFinite(iouThreshold) || iouThreshold < 0 || iouThreshold > 1) {
    throw new RangeError(
      `countApparentIdentitySwitches: iouThreshold must be in [0, 1] (got ${iouThreshold})`,
    );
  }
  let switches = 0;
  for (let k = 0; k + 1 < perFrame.length; k += 1) {
    const current = perFrame[k] ?? [];
    const next = perFrame[k + 1] ?? [];
    interface Candidate {
      readonly i: number;
      readonly j: number;
      readonly overlap: number;
    }
    const candidates: Candidate[] = [];
    for (const [i, a] of current.entries()) {
      for (const [j, b] of next.entries()) {
        if (a.label !== b.label) continue;
        const overlap = iou(a.box, b.box);
        if (overlap >= iouThreshold) {
          candidates.push({ i, j, overlap });
        }
      }
    }
    candidates.sort((x, y) => y.overlap - x.overlap || x.i - y.i || x.j - y.j);
    const usedI = new Set<number>();
    const usedJ = new Set<number>();
    for (const candidate of candidates) {
      if (usedI.has(candidate.i) || usedJ.has(candidate.j)) continue;
      usedI.add(candidate.i);
      usedJ.add(candidate.j);
      const a = current[candidate.i];
      const b = next[candidate.j];
      if (a !== undefined && b !== undefined && a.trackId !== b.trackId) {
        switches += 1;
      }
    }
  }
  return switches;
}
