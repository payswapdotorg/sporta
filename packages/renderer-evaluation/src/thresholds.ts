/**
 * The executable thresholds of the W503 temporal consistency evaluation.
 *
 * **Every threshold in this file is documented, with its derivation, in
 * `packages/renderer-evaluation/THRESHOLDS.md`** — and the document is
 * pinned row-for-row to this constant by `test/thresholds-doc.test.ts`
 * (the W403 TOLERANCE.md convention: a change to either side without the
 * other fails the suite; no silent drift).
 *
 * Policy (mirrored in THRESHOLDS.md §1):
 *
 * 1. **Zero-defect thresholds for deterministic renderers.** A renderer that
 *    is a pure function of its SWM inputs (W502's construction) has no
 *    source of nondeterminism: an unexplained identity absence, a style
 *    token change, a duplicate event attribution, or a watermark regression
 *    is always a defect. Counts are therefore 0 and ratios 1.0 — never
 *    tuned to make a failing fixture pass.
 * 2. **Physical bounds for geometry drift.** Displacement plausibility is
 *    NOT a tuned number: the bound per consecutive-position pair is
 *    `maxSpeed(kind) × Δt + POSITION_EPSILON_METERS`, where the speeds are
 *    documented physical ceilings (human sprint, struck ball) and the
 *    epsilon is a numerical-safety headroom, not a semantic tolerance.
 * 3. **Justified omissions are never defects.** The W502 dispositions
 *    `omitted-no-position`, `omitted-invalid-position`,
 *    `omitted-out-of-play`, and `not-rendered-kind` are HONEST accounting
 *    (architecture-lock §4: explicit uncertainty, never invented). They
 *    break measurement series as gaps (accounted, never interpolated) but
 *    count as neither flicker nor drift.
 */
export const THRESHOLDS = {
  // --- Identity flicker -----------------------------------------------------
  /** Max recorded-then-vanished entity transitions per evaluation (any prior disposition). */
  MAX_UNEXPLAINED_ABSENCE_COUNT: 0,
  /** Max drawn-then-vanished entity transitions (the visual pop-out). */
  MAX_IDENTITY_FLICKER_COUNT: 0,
  /** Min ratio of frames whose style token equals the entity's modal token (1.0 = perfectly stable). */
  MIN_STYLE_STABILITY_RATIO: 1,
  /** Min ratio of position/opacity-normalized marker groups byte-identical to the entity's modal group. */
  MIN_STYLE_BYTE_STABILITY_RATIO: 1,

  // --- Geometry drift (physical bounds) ------------------------------------
  /** Peak human sprint speed in m/s (documented ceiling; see THRESHOLDS.md §3). */
  PLAYER_MAX_SPEED_MPS: 12.5,
  /** Fast struck-ball speed in m/s (documented ceiling; see THRESHOLDS.md §3). */
  BALL_MAX_SPEED_MPS: 40,
  /** Numerical-safety headroom in meters added to every drift bound (not a semantic tolerance). */
  POSITION_EPSILON_METERS: 0.01,
  /** Max consecutive-position pairs exceeding the drift bound. */
  MAX_GEOMETRY_JUMP_COUNT: 0,
  /** Max displacement/bound ratio over all measured pairs (1.0 = at the bound exactly). */
  MAX_GEOMETRY_JUMP_RATIO: 1,

  // --- Temporal artifacts ---------------------------------------------------
  /** Max consecutive frame windows that overlap. */
  MAX_WINDOW_OVERLAP_COUNT: 0,
  /** Max inverted windows (startMs >= endMs). */
  MAX_INVERTED_WINDOW_COUNT: 0,
  /** Max windows whose startMs differs from the frame's outputTimestampMs. */
  MAX_WINDOW_TIMESTAMP_MISMATCH_COUNT: 0,
  /** Max event sequences captioned in more than one frame (or twice in one frame). */
  MAX_CAPTION_DUPLICATE_COUNT: 0,
  /** Max captioned/uncaptioned sequences missing from the frame's appliedEventSequences. */
  MAX_CAPTION_UNAPPLIED_COUNT: 0,
  /** Max applied sequences attributed to more than one frame (or twice in one frame). */
  MAX_APPLIED_DUPLICATE_COUNT: 0,
  /** Max frames whose appliedEventSequences are not strictly ascending. */
  MAX_APPLIED_UNSORTED_COUNT: 0,
  /** Max interior event sequences neither applied nor accounted in skippedEvents. */
  MAX_APPLIED_GAP_COUNT: 0,
  /** Max applied sequences accounted in neither captions.events nor captions.uncaptionedEvents. */
  MAX_APPLIED_UNACCOUNTED_COUNT: 0,
  /** Max frames whose source watermark sequence is below the previous frame's. */
  MAX_WATERMARK_SEQUENCE_REGRESSION_COUNT: 0,
  /** Max frames whose source watermark watermarkMs is below the previous frame's. */
  MAX_WATERMARK_TIME_REGRESSION_COUNT: 0,
  /** Max watermarkAfter.sequence below the highest applied-or-skipped event sequence. */
  MAX_WATERMARK_BELOW_EVENTS_COUNT: 0,
  /** Max drawn→omitted→drawn disposition flaps (one omitted frame between two drawn frames). */
  MAX_DISPOSITION_FLAP_COUNT: 0,
  /** Max entities whose recorded kind differs across frames. */
  MAX_KIND_CHANGE_COUNT: 0,
  /** Max frames with possession.displayed true while the possessing entity is not drawn. */
  MAX_POSSESSION_DISPLAY_MISMATCH_COUNT: 0,
} as const;

export type Thresholds = typeof THRESHOLDS;
