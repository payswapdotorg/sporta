/**
 * Generic replay + calibration adapter implementations (REL-001 §3 bullet
 * 11). Deliberately trivial and dependency-free in v0: the replay adapter
 * regroups a recorded observation stream by kind without re-simulating
 * anything (a replay is a faithful re-presentation of recorded evidence,
 * not a second world), and the calibration adapter pairs predicted vs
 * observed metric series and reports the mean error. Heavier adapters
 * (real interpolation, drift statistics) replace these through the same
 * seam without touching pack code.
 */
import type {
  CalibrationAdapter,
  CalibrationPairs,
  DomainObservationBase,
  ReplayAdapter,
  ReplayStream,
} from "./domain-pack";

/** A replay adapter over a recorded observation stream (order-preserving). */
export function createListReplayAdapter(adapterId: string): ReplayAdapter<DomainObservationBase> {
  return {
    adapterId,
    replay(observations: readonly DomainObservationBase[]): ReplayStream {
      const snapshot = [...observations];
      return {
        adapterId,
        observations: snapshot,
        byKind(kindId: string): readonly DomainObservationBase[] {
          return snapshot.filter((observation) => observation.kindId === kindId);
        },
      };
    },
  };
}

/** A calibration adapter: paired predicted/observed errors + mean error. */
export function createMeanErrorCalibrationAdapter(adapterId: string): CalibrationAdapter {
  return {
    adapterId,
    compare(predictions: readonly number[], observations: readonly number[]): CalibrationPairs {
      const length = Math.min(predictions.length, observations.length);
      const pairs = [];
      for (let i = 0; i < length; i++) {
        const predicted = predictions[i];
        const observed = observations[i];
        if (predicted === undefined || observed === undefined) continue;
        pairs.push({ predicted, observed, error: predicted - observed });
      }
      const meanError =
        pairs.length === 0 ? 0 : pairs.reduce((sum, pair) => sum + pair.error, 0) / pairs.length;
      return { adapterId, pairs, meanError };
    },
  };
}
