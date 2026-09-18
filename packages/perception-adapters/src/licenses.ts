/**
 * Honest license records for every perception-adapter candidate (R201-R206).
 *
 * THE ONE RULE (technology-plane.md License policy + R004 fail-closed):
 * permissive code licensing does NOT make a checkpoint commercially usable,
 * so code / model / dataset / assets are recorded SEPARATELY, and an
 * unreviewed or ambiguous commercial-use verdict is recorded as ABSENT
 * (never fabricated as `true`, never defaulted to `false` beyond the status
 * verdict — `commercialUse` absent means "not yet reviewed" per the frozen
 * schema docs).
 *
 * Component provenance, candidate by candidate:
 *
 * - EVERY candidate's CODE component is this repository's code, and the
 *   repository root carries NO LICENSE file as of this wave — recorded
 *   honestly as `status: "unresolved"` with a review reference to the repo.
 *   Every record is therefore BLOCKING under `blockingLicenseIssues`, which
 *   is exactly right: these are `candidate`-status technologies, and
 *   promotion is fail-closed until the repo declares its license and the
 *   reviews happen.
 *
 * - The MODEL-BACKED detector additionally carries model/dataset/assets
 *   components: the checked asset is Ultralytics YOLOv8n (`yolov8n.pt`,
 *   AGPL-3.0 with commercial dual-licensing — evaluation-only until a
 *   review affirms commercial use) trained on the COCO detection corpus
 *   (mixed Flickr image terms + annotation terms — commercial use not
 *   affirmed). See `assets/README.md` for the exact pinned download.
 *
 * - All other candidates are pure-code, deterministic, CPU-only algorithms
 *   with no model, dataset, or bundled-asset components — those components
 *   are simply absent (an absent component is not blocking; the promotion
 *   record must state why it does not apply, which these records do via the
 *   code component's review reference and the candidate notes in
 *   `registry-bindings.ts`).
 */
import type { LicenseComponent, TechnologyLicenseRecord } from "@sporta/contracts";

/**
 * The code component every candidate shares: this repository's code, which
 * declares no license as of this wave — honestly unresolved (fail-closed).
 */
export const REPO_CODE_LICENSE: LicenseComponent = {
  status: "unresolved",
  reviewRef:
    "https://github.com/payswapdotorg/sporta — repository root carries no LICENSE " +
    "file as of the R201-R206 wave; commercial-use verdict pending that declaration",
};

/** Pure-code, CPU-only, no-model candidate: one honest record shape. */
export function pureCodeLicense(notes: string): TechnologyLicenseRecord {
  return {
    code: {
      status: REPO_CODE_LICENSE.status,
      reviewRef: `${REPO_CODE_LICENSE.reviewRef} — candidate notes: ${notes}`,
    },
  };
}

/** License record: `heuristic-color-detector` (R202 candidate 1). */
export const HEURISTIC_COLOR_DETECTOR_LICENSE: TechnologyLicenseRecord = pureCodeLicense(
  "deterministic CPU-only color/connected-component algorithm; no model, dataset, or bundled assets",
);

/**
 * License record: `model-backed-detector` (R202 candidate 2).
 *
 * MODEL: the checked asset class is Ultralytics YOLOv8n — AGPL-3.0 (with a
 * separate commercial licensing track), so the component is resolved as
 * `copyleft` with the commercial-use verdict deliberately UNREVIEWED
 * (evaluation-only). DATASET: the detection checkpoint lineage is trained on
 * the COCO corpus, whose mixed Flickr image terms and annotation terms do
 * not support an affirmative commercial-use verdict here — unresolved.
 * ASSETS: the optional `yolov8n.pt` weights file, same AGPL-3.0 terms; see
 * `packages/perception-adapters/assets/README.md` for the pinned provenance
 * (official release URL, byte size, sha256).
 */
export const MODEL_BACKED_DETECTOR_LICENSE: TechnologyLicenseRecord = {
  code: {
    status: REPO_CODE_LICENSE.status,
    reviewRef: REPO_CODE_LICENSE.reviewRef,
  },
  model: {
    status: "copyleft",
    licenseId: "AGPL-3.0",
    // commercialUse deliberately absent: AGPL-3.0 + Ultralytics dual-licensing
    // track — evaluation-only until a license review affirms commercial use.
    reviewRef:
      "https://github.com/ultralytics/assets/releases/download/v8.2.0/yolov8n.pt — " +
      "Ultralytics YOLOv8n detection checkpoint (AGPL-3.0, dual-licensed; " +
      "evaluation-only pending commercial-use review)",
  },
  dataset: {
    status: "unresolved",
    licenseId: "COCO-detection-corpus-terms",
    reviewRef:
      "COCO detection corpus (Flickr image terms + COCO annotation terms) — the " +
      "checkpoint's training data lineage; commercial use not affirmed",
  },
  assets: {
    status: "copyleft",
    licenseId: "AGPL-3.0",
    reviewRef:
      "packages/perception-adapters/assets/yolov8n.pt — see assets/README.md for " +
      "the pinned official-release provenance (evaluation-only)",
  },
};

/** License record: `greedy-iou-tracker` (R203 candidate 1, W204 baseline wrap). */
export const GREEDY_IOU_TRACKER_LICENSE: TechnologyLicenseRecord = pureCodeLicense(
  "wraps the W204 GreedyIouTracker; deterministic CPU-only association; no model/dataset/assets",
);

/** License record: `hungarian-tracker` (R203 candidate 2). */
export const HUNGARIAN_TRACKER_LICENSE: TechnologyLicenseRecord = pureCodeLicense(
  "own O(n^3) Hungarian assignment over IoU+centroid cost; deterministic CPU-only; no model/dataset/assets",
);

/** License record: `nearest-box-ball-tracker` (R204 candidate 1, W202 baseline wrap). */
export const NEAREST_BOX_BALL_TRACKER_LICENSE: TechnologyLicenseRecord = pureCodeLicense(
  "wraps the W202 NearestBoxBallTracker; deterministic CPU-only; no model/dataset/assets",
);

/** License record: `color-blob-ball-tracker` (R204 candidate 2). */
export const COLOR_BLOB_BALL_TRACKER_LICENSE: TechnologyLicenseRecord = pureCodeLicense(
  "pixel-space bright-blob extraction + honest gap semantics; deterministic CPU-only; no model/dataset/assets",
);

/** License record: `homography-field-calibrator` (R205 candidate 1, W203 DLT wrap). */
export const HOMOGRAPHY_FIELD_CALIBRATOR_LICENSE: TechnologyLicenseRecord = pureCodeLicense(
  "wraps the W203 solveHomography DLT solver; deterministic CPU-only; no model/dataset/assets",
);

/** License record: `line-based-field-calibrator` (R205 candidate 2). */
export const LINE_BASED_FIELD_CALIBRATOR_LICENSE: TechnologyLicenseRecord = pureCodeLicense(
  "pitch-mask + projection-histogram line detection feeding the W203 solver; deterministic CPU-only; no model/dataset/assets",
);

/** License record: `jersey-color-team-assigner` (R206). */
export const JERSEY_COLOR_TEAM_ASSIGNER_LICENSE: TechnologyLicenseRecord = pureCodeLicense(
  "per-track dominant-jersey-color k=2 clustering; deterministic CPU-only; no model/dataset/assets",
);
