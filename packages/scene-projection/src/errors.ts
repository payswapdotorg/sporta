/**
 * The error of the scene projection contract (W601).
 *
 * Thrown fail-loud (the repo convention) when the INPUT to
 * {@link projectScene} or `parseSceneSpecification` is malformed: a snapshot
 * that does not validate against the frozen `WorldSnapshot` contract, event
 * stream entries that do not validate (or belong to another session), or
 * projection options that are invalid (unknown/duplicate camera slot ids).
 *
 * Malformed DATA INSIDE a valid snapshot is never an error — it is accounted
 * honestly in the scene specification via dispositions
 * (`omitted-invalid-position`, `omitted-non-pitch-frame`, …): the projection
 * is total over contract-valid snapshots. Only structurally invalid input
 * throws.
 */
export class SceneProjectionError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "SceneProjectionError";
  }
}
