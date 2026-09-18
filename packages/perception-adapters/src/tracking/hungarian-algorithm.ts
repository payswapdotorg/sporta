/**
 * The deterministic O(n^3) Hungarian (Kuhn-Munkres) assignment solver (R203)
 * — implemented HERE, from scratch, with NO external dependencies.
 *
 * ALGORITHM (documented once, honored exactly): the classic
 * potentials/augmenting-path formulation (JV-style). Rows are workers
 * (tracks), columns are jobs (detections); `cost[i][j]` is finite and
 * non-negative. The solver maintains dual potentials `u[1..n]`, `v[1..m]`
 * and a primal matching `p[j] = row matched to column j` (1-based
 * internally; `p[0]` carries the row currently being augmented, and a real
 * column with `p[j] === 0` is unmatched). Each row is augmented along a
 * shortest augmenting path found by Dijkstra-like relaxation over the
 * reduced costs `cost[i][j] - u[i] - v[j]`; the potential update keeps every
 * reduced cost >= 0 and every MATCHED pair's reduced cost = 0 (complementary
 * slackness), so the final matching is minimum-total-cost among all maximum
 * matchings. Complexity O(n * m^2) <= O(n^3).
 *
 * DETERMINISM (stronger than seeded): all comparisons are STRICT `<`, so
 * every tie — equal reduced costs, equal column minima — resolves to the
 * LOWEST index. The output is a pure lexicographic-deterministic function
 * of the cost matrix: identical matrices always produce the identical
 * assignment, with no RNG involved at all. (The tracker still ACCEPTS a
 * `seed` for benchmark reproducibility records; determinism does not depend
 * on it — that is the documented, honest claim.)
 *
 * FORBIDDEN PAIRS: gated pairs (label mismatch, IoU below the gate) carry
 * the {@link FORBIDDEN_COST} sentinel instead of Infinity — finite
 * arithmetic keeps the relaxation well-defined — and any assignment ending
 * on a sentinel pair is post-filtered to "unmatched". Because the sentinel
 * dominates any realistic cost total, the optimum uses the FEWEST possible
 * sentinel pairs first and then the least allowed cost — i.e. the result is
 * the minimum-cost matching of MAXIMUM cardinality over the ALLOWED pairs
 * (documented envelope: cost-matrix totals well below FORBIDDEN_COST/2,
 * which every IoU+centroid matrix satisfies).
 *
 * RECTANGULAR SAFETY: the potentials formulation is defined for rows <=
 * columns; when rows outnumber columns the solver TRANSPOSES the matrix,
 * solves the transposed problem (original columns as rows), and inverts the
 * mapping — solving rows-in-order (without the transpose) would let the
 * first rows grab columns non-optimally, which the brute-force tests
 * exposed and now guard against.
 *
 * ROWS WITHOUT A PATH: when every column is already matched and no
 * augmenting path exists, the row simply stays unmatched — the partial
 * tree's potential updates up to that point are abandoned safely (see the
 * `j1 < 0` break: the infinity-delta update is SKIPPED, never applied).
 */

/**
 * Sentinel cost for forbidden pairs (label mismatch / gate failure). Finite
 * so the potentials arithmetic stays well-defined; large enough that any
 * allowed pair always wins. Assignments landing on a sentinel are dropped.
 */
export const FORBIDDEN_COST = 1e9;

/**
 * Solves the rectangular assignment problem: `cost[i][j]` (row i, column j)
 * must be finite and non-negative. Returns `rowToCol` where `rowToCol[i]`
 * is the matched column index, or `-1` when row i is unmatched (possible
 * when columns are scarcer than rows, or when every remaining pairing is
 * forbidden/sentinel).
 *
 * Empty inputs are well-defined: zero rows -> `[]`; zero columns -> all rows
 * `-1`.
 */
export function solveHungarianAssignment(cost: readonly (readonly number[])[]): number[] {
  const n = cost.length;
  const m = n === 0 ? 0 : cost[0]!.length;
  if (n === 0) return [];
  if (m === 0) return new Array<number>(n).fill(-1);
  if (n > m) {
    // Rows outnumber columns: transpose, solve, invert (see the module
    // docs — the direct row-order path is NOT cost-optimal here).
    const transposed: number[][] = Array.from({ length: m }, () => new Array<number>(n));
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < m; j += 1) {
        transposed[j]![i] = cost[i]![j]!;
      }
    }
    const transposedAssignment = solveHungarianAssignment(transposed);
    const rowToCol = new Array<number>(n).fill(-1);
    for (let j = 0; j < m; j += 1) {
      const i = transposedAssignment[j]!;
      if (i >= 0) rowToCol[i] = j;
    }
    // Post-filter: sentinel pairs are forbidden, not assignments.
    for (let i = 0; i < n; i += 1) {
      const j = rowToCol[i]!;
      if (j >= 0 && cost[i]![j]! >= FORBIDDEN_COST / 2) {
        rowToCol[i] = -1;
      }
    }
    return rowToCol;
  }

  // 1-based internal arrays; index 0 is the virtual root column.
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);

  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array<boolean>(m + 1).fill(false);
    let augmented = false;
    while (true) {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Number.POSITIVE_INFINITY;
      let j1 = -1;
      for (let j = 1; j <= m; j += 1) {
        if (used[j]) continue;
        const cur = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      if (j1 < 0) {
        // No unused column remains and none was unmatched: the alternating
        // tree is exhausted without an augmenting path. Abandon this row
        // (no potential update — an infinity delta must never be applied).
        break;
      }
      // Potential update over the tree (complementary slackness).
      for (let j = 0; j <= m; j += 1) {
        if (used[j]) {
          u[p[j]!]! += delta;
          v[j]! -= delta;
        } else {
          minv[j]! -= delta;
        }
      }
      j0 = j1;
      if (p[j0]! === 0) {
        augmented = true;
        break;
      }
    }
    if (!augmented) {
      p[0] = 0;
      continue;
    }
    // Augment along the path recorded in `way`: re-match every column on
    // the path to the row of its predecessor, ending at the virtual root.
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 > 0);
  }

  const rowToCol = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j += 1) {
    const row = p[j]!;
    if (row >= 1 && row <= n) {
      rowToCol[row - 1] = j - 1;
    }
  }
  // Post-filter: sentinel pairs are forbidden, not assignments.
  for (let i = 0; i < n; i += 1) {
    const j = rowToCol[i]!;
    if (j >= 0 && cost[i]![j]! >= FORBIDDEN_COST / 2) {
      rowToCol[i] = -1;
    }
  }
  return rowToCol;
}

/**
 * The total cost of a solver result over the ALLOWED (non-sentinel) pairs —
 * the objective value the Hungarian guarantees minimal. Exposed for tests
 * and benchmarks; not needed by callers in production paths.
 */
export function assignmentTotalCost(
  cost: readonly (readonly number[])[],
  rowToCol: readonly number[],
): number {
  let total = 0;
  for (const [i, j] of rowToCol.entries()) {
    if (j >= 0 && cost[i]![j]! < FORBIDDEN_COST / 2) {
      total += cost[i]![j]!;
    }
  }
  return total;
}
