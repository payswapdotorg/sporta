/**
 * J012 production-path candidate: `ContrastContextDetector` — a REAL,
 * deterministic, CPU-only, SURFACE-AGNOSTIC player detector that runs on the
 * actual frame `bytes` pixels with ZERO external components (no weights, no
 * datasets, no vendored assets — the license-clean path decided in
 * `docs/research/j012-perception-licensing-and-production-path.md`).
 *
 * WHY THIS CANDIDATE EXISTS (the J012 failure evidence): the heuristic color
 * detector's pitch-green/white suppression predicate is calibrated for
 * broadcast grass views; on the two committed REAL gate clips (fx-001 beach
 * soccer on sand, CC0; fx-004 1944 newsreel film, CC BY-SA 3.0 nl — both
 * green-fraction ~0) it degraded to near-empty detections, both clips
 * materialized empty-event SWMs, and the deterministic derived realities
 * produced byte-identical outputs across materially different matches. The
 * measured fix (frame sampling on both clips): players are LOCAL-CONTRAST
 * outliers on ANY uniform surface — sand, grass, or film gray.
 *
 * ALGORITHM (documented in full — every constant is part of the tested
 * contract):
 *
 * 1. LOCAL-CONTRAST FOREGROUND MASK, TWO PASSES: per-channel integral
 *    images give the local mean over a square neighborhood (radius
 *    `contrastRadiusPx`, default adaptive to the frame:
 *    clamp(round(min(w,h)/16), 12, 20)); a pixel is FOREGROUND when its
 *    Chebyshev channel distance from the local mean exceeds
 *    `contrastThreshold` (default 32). Pass 2 recomputes the mean over the
 *    pass-1 BACKGROUND pixels only (a two-pass background estimate —
 *    measured evidence: a single-pass mean is polluted by bright clutter
 *    and manufactures wedge/halo foreground around lines and blobs), and a
 *    DEEP-contrast restore keeps pass-1 pixels whose deviation exceeded
 *    `deepContrastThreshold` (default 64) — genuine structure edges — so
 *    close-up boundary rings do not thin below the erosion density.
 *    Surface-agnostic by construction: it fires on a player against sand,
 *    grass, or grayscale film exactly the same way. Large figures whose
 *    interior exceeds the window become high-contrast BOUNDARY rings —
 *    still one connected blob with the correct bounding box (documented
 *    behavior, not a failure).
 * 2. MORPHOLOGICAL MAJORITY CLEANUP: a 5-cross majority vote (>= 4 of
 *    self + 4-neighbours) removes speckle with zero ordering
 *    nondeterminism and without filling 1-pixel gaps (a 3x3 box majority
 *    welds players to adjacent pitch lines — measured evidence).
 * 3. DOMINANT-SURFACE RESTRICTION: the mask is block-downsampled (block
 *    `blockSizePx`, default clamp(round(min(w,h)/20), 6, 18)); the
 *    foreground inside low-density blocks (fraction below
 *    `erosionMaxForegroundFraction`, default 0.35) is ERODED — residual
 *    noise blobs and thin marking fragments die here (measured: 30-70
 *    noise detections per real frame without it); blocks whose post-erosion
 *    foreground fraction is below `surfaceMaxForegroundFraction` (default
 *    0.25) are SURFACE blocks (beach sand, pitch grass, newsreel gray all
 *    qualify). Surviving marking networks/bars stay whole and die on the
 *    compactness/aspect gates.
 * 4. CONNECTED COMPONENTS + GEOMETRIC GATES: area in
 *    [minBlobArea, maxBlobArea] (defaults 120 / 20000 — the ball is excluded
 *    by AREA), aspect ratio (long/short) in [aspectMin, aspectMax] (defaults
 *    1.0 / 6.0 — pitch lines and scratches are excluded by shape), and
 *    compactness (area / bounding-box area) >= minCompactness (default 0.15
 *    — hollow/thin structures like center circles and net meshes are
 *    excluded by fill).
 * 5. RING-CONTEXT SURFACE MEMBERSHIP: a surviving blob is kept only when
 *    the ring around its bounding box (expanded by `ringMarginPx`, default
 *    one block) is majority playing-surface — a ring pixel counts as
 *    surface when it lies in a surface block OR is itself cleaned-mask
 *    background: players STAND ON open background (pitch, sand, gray
 *    field), while crowd/stand/netting blobs sit inside other foreground.
 *    Thin chalk lines crossing the ring cost only their few pixels, so
 *    players standing ON lines stay detected (>= `ringMinSurfaceFraction`,
 *    default 0.5).
 * 6. CONFIDENCE: the product of blob compactness and ring surface fraction,
 *    clamped to (0, 1] — how convincingly the blob fills its box AND sits
 *    on the playing surface. No flooring, no averaging — partial players
 *    and off-surface blobs carry visibly lower confidence
 *    (architecture-lock §6: no silent confidence collapse).
 *
 * HONEST LIMITS (documented failure classes, carried in the registry
 * binding):
 *
 * - adjacent/overlapping players — and players merged with their cast
 *   shadows on strong sun — become ONE blob (undercount);
 * - a kit within `contrastThreshold` of the surface under the local mean is
 *   suppressed exactly like the surface (light kit on light grass under
 *   weak light is the documented newsreel case);
 * - framings without a dominant uniform surface (tight crowd shots) leave
 *   the ring gate nothing to stand on: detection degrades honestly toward
 *   zero rather than fabricating boxes;
 * - the ball is excluded by AREA only: a close-up ball larger than
 *   `minBlobArea` would be detected as a player (honest overcount).
 *
 * Every failure class is deterministic (same input, same output — a retry
 * with identical inputs cannot succeed); `retryable: false` throughout.
 * Pure function of `(options, frame)` — no RNG, no clock, no I/O (scratch
 * buffers are cached per size on the instance; they never influence
 * output).
 */
import type { DetectedBox, DetectorFrameInput } from "@sporta/perception-detection";
import type {
  FailureClassRecord,
  PerceptionAdapterDescriptor,
  ResourceRequirements,
  TechnologyLicenseRecord,
} from "@sporta/contracts";
import { assertDescriptorBinding, CandidateFailureError, perceptionDescriptor } from "../errors";
import { CONTRAST_CONTEXT_DETECTOR_LICENSE } from "../licenses";
import type { PlayerDetectionAdapter } from "../adapter";

/** Stable technology identity of this candidate. */
export const CONTRAST_CONTEXT_DETECTOR_ID = "contrast-context-detector";
export const CONTRAST_CONTEXT_DETECTOR_VERSION = "0.1.0";
export const CONTRAST_CONTEXT_DETECTOR_ADAPTER_VERSION = "0.1.0";

/** Options for {@link ContrastContextDetector}; every field is optional. */
export interface ContrastContextDetectorOptions {
  /** Component id (default `contrast-context-detector-v1`). */
  readonly detectorId?: string;
  /** Emitted class label (default "player"). */
  readonly label?: string;
  /**
   * Local-mean neighborhood radius in pixels. Default: adaptive to the
   * frame — `clamp(round(min(width, height) / 16), 12, 20)`.
   */
  readonly contrastRadiusPx?: number;
  /**
   * Chebyshev channel distance from the local mean above which a pixel is
   * foreground (default 32 — above measured film-grain/compression noise on
   * the committed gate clips, below the measured player-surface contrast).
   */
  readonly contrastThreshold?: number;
  /**
   * Chebyshev channel distance above which a pass-1 foreground pixel is
   * DEEP contrast and is restored even when the background-restricted mean
   * fits it (default 64 = 2x the contrast threshold — genuine structure
   * edges measure 60-150; the shallow wedge/halo artifact family measures
   * 32-45 and stays suppressed).
   */
  readonly deepContrastThreshold?: number;
  /**
   * Surface-grid block size in pixels. Default: adaptive to the frame —
   * `clamp(round(min(width, height) / 12), 10, 18)`.
   */
  readonly blockSizePx?: number;
  /** Foreground fraction below which a block is SURFACE (default 0.25). */
  readonly surfaceMaxForegroundFraction?: number;
  /**
   * Foreground fraction below which a block's foreground is ERODED before
   * surface classification (default 0.35 — kills residual noise blobs and
   * thin marking fragments at real-clip scale; player blobs and hollow-ring
   * walls read >= 0.35 in their core blocks).
   */
  readonly erosionMaxForegroundFraction?: number;
  /** Minimum blob pixel area (default 80 — excludes the ball). */
  readonly minBlobArea?: number;
  /** Maximum blob pixel area (default 20000 — excludes merged crowds). */
  readonly maxBlobArea?: number;
  /** Minimum bounding-box aspect ratio long/short (default 1.0). */
  readonly aspectMin?: number;
  /** Maximum bounding-box aspect ratio long/short (default 6). */
  readonly aspectMax?: number;
  /** Minimum blob compactness area/box-area (default 0.25). */
  readonly minCompactness?: number;
  /** Ring expansion beyond the blob box in pixels (default: one block). */
  readonly ringMarginPx?: number;
  /** Minimum fraction of ring pixels on the playing surface (default 0.5). */
  readonly ringMinSurfaceFraction?: number;
}

const DEFAULTS = {
  detectorId: "contrast-context-detector-v1",
  label: "player",
  contrastThreshold: 32,
  deepContrastThreshold: 64,
  surfaceMaxForegroundFraction: 0.25,
  erosionMaxForegroundFraction: 0.35,
  minBlobArea: 80,
  maxBlobArea: 20000,
  aspectMin: 1,
  aspectMax: 6,
  minCompactness: 0.15,
  ringMinSurfaceFraction: 0.5,
} as const;

/** Documented failure classes of the contrast-context detector. */
export const CONTRAST_CONTEXT_DETECTOR_FAILURE_CLASSES: readonly FailureClassRecord[] = [
  {
    failureClassId: "contrast-context.merged-players",
    description:
      "Adjacent or overlapping players — and players merged with their cast " +
      "shadows on strong sun — become one foreground blob: the frame " +
      "undercounts players and the merged box spans them all. Deterministic " +
      "(identical input reproduces the merge).",
    retryable: false,
  },
  {
    failureClassId: "contrast-context.suppressed-low-contrast-kit",
    description:
      "A kit within the contrast threshold of the playing surface under the " +
      "local mean is suppressed with the surface (light kit on light grass " +
      "under weak light is the documented newsreel case): those players " +
      "produce no detection at all. Deterministic.",
    retryable: false,
  },
  {
    failureClassId: "contrast-context.off-envelope-framing",
    description:
      "A frame without a dominant uniform surface (tight crowd shot, " +
      "fully-cluttered pattern) leaves the ring-context gate nothing to " +
      "stand on: the candidate REFUSES with this class so the chain's " +
      "degradation ledger engages the fallback (never fabricated boxes off " +
      "the playing surface). A frame WITH a surface and no players is NOT " +
      "this class — it is the honest empty result.",
    retryable: false,
  },
];

/** Resource requirements: pure CPU, one core, integral-image scratch RAM. */
export const CONTRAST_CONTEXT_DETECTOR_RESOURCES: ResourceRequirements = {
  gpuRequired: false,
  minCpuCores: 1,
};

/** The default adaptive local-mean radius for a frame of the given size. */
export function defaultContrastRadiusPx(width: number, height: number): number {
  return Math.min(20, Math.max(12, Math.round(Math.min(width, height) / 16)));
}

/** The default adaptive surface-grid block size for a frame of the given size. */
export function defaultBlockSizePx(width: number, height: number): number {
  return Math.min(18, Math.max(6, Math.round(Math.min(width, height) / 20)));
}

/**
 * The deterministic surface-agnostic contrast-context player detector (the
 * J012 license-clean production path).
 *
 * Construct with options; call {@link detect} per frame (synchronous return
 * satisfies the seam's sync-or-async union). The descriptor is validated
 * fail-closed at construction against the frozen binding table.
 */
export class ContrastContextDetector implements PlayerDetectionAdapter {
  readonly descriptor: PerceptionAdapterDescriptor;
  readonly license: TechnologyLicenseRecord = CONTRAST_CONTEXT_DETECTOR_LICENSE;
  readonly failureClasses: readonly FailureClassRecord[] =
    CONTRAST_CONTEXT_DETECTOR_FAILURE_CLASSES;
  readonly resourceRequirements: ResourceRequirements = CONTRAST_CONTEXT_DETECTOR_RESOURCES;
  readonly detectorId: string;
  private readonly label: string;
  private readonly contrastThreshold: number;
  private readonly deepContrastThreshold: number;
  private readonly surfaceMaxForegroundFraction: number;
  private readonly erosionMaxForegroundFraction: number;
  private readonly minBlobArea: number;
  private readonly maxBlobArea: number;
  private readonly aspectMin: number;
  private readonly aspectMax: number;
  private readonly minCompactness: number;
  private readonly ringMinSurfaceFraction: number;
  /** Resolved scale options (adaptive defaults resolve per frame size). */
  private readonly scaleOptions: {
    contrastRadiusPx?: number;
    blockSizePx?: number;
    ringMarginPx?: number;
  };
  /** Scratch buffers cached per frame size (never output-visible). */
  private scratch: {
    width: number;
    height: number;
    /** Three channel sums + [3] = background-pixel count (pass 2). */
    integral: Int32Array[];
    mask: Uint8Array;
    cleaned: Uint8Array;
  } | null = null;

  constructor(options: ContrastContextDetectorOptions = {}) {
    const detectorId = options.detectorId ?? DEFAULTS.detectorId;
    const label = options.label ?? DEFAULTS.label;
    const contrastThreshold = options.contrastThreshold ?? DEFAULTS.contrastThreshold;
    const deepContrastThreshold = options.deepContrastThreshold ?? DEFAULTS.deepContrastThreshold;
    const surfaceMaxForegroundFraction =
      options.surfaceMaxForegroundFraction ?? DEFAULTS.surfaceMaxForegroundFraction;
    const erosionMaxForegroundFraction =
      options.erosionMaxForegroundFraction ?? DEFAULTS.erosionMaxForegroundFraction;
    const minBlobArea = options.minBlobArea ?? DEFAULTS.minBlobArea;
    const maxBlobArea = options.maxBlobArea ?? DEFAULTS.maxBlobArea;
    const aspectMin = options.aspectMin ?? DEFAULTS.aspectMin;
    const aspectMax = options.aspectMax ?? DEFAULTS.aspectMax;
    const minCompactness = options.minCompactness ?? DEFAULTS.minCompactness;
    const ringMinSurfaceFraction =
      options.ringMinSurfaceFraction ?? DEFAULTS.ringMinSurfaceFraction;
    // Fail loud at construction (the repo convention): every gate is part of
    // the documented algorithm and must stay ordered/positive.
    if (typeof detectorId !== "string" || detectorId.length < 1) {
      throw new RangeError("ContrastContextDetector: detectorId must be a non-empty string");
    }
    if (typeof label !== "string" || label.length < 1) {
      throw new RangeError("ContrastContextDetector: label must be a non-empty string");
    }
    for (const [name, value] of [
      ["contrastThreshold", contrastThreshold],
      ["deepContrastThreshold", deepContrastThreshold],
      ["surfaceMaxForegroundFraction", surfaceMaxForegroundFraction],
      ["erosionMaxForegroundFraction", erosionMaxForegroundFraction],
      ["minBlobArea", minBlobArea],
      ["maxBlobArea", maxBlobArea],
      ["aspectMin", aspectMin],
      ["aspectMax", aspectMax],
      ["minCompactness", minCompactness],
      ["ringMinSurfaceFraction", ringMinSurfaceFraction],
    ] as const) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`ContrastContextDetector: ${name} must be > 0 (got ${value})`);
      }
    }
    if (options.contrastRadiusPx !== undefined && options.contrastRadiusPx < 1) {
      throw new RangeError("ContrastContextDetector: contrastRadiusPx must be >= 1");
    }
    if (options.blockSizePx !== undefined && options.blockSizePx < 1) {
      throw new RangeError("ContrastContextDetector: blockSizePx must be >= 1");
    }
    if (options.ringMarginPx !== undefined && options.ringMarginPx < 0) {
      throw new RangeError("ContrastContextDetector: ringMarginPx must be >= 0");
    }
    if (minBlobArea > maxBlobArea) {
      throw new RangeError(
        `ContrastContextDetector: minBlobArea (${minBlobArea}) must not exceed maxBlobArea ` +
          `(${maxBlobArea})`,
      );
    }
    if (aspectMin > aspectMax) {
      throw new RangeError(
        `ContrastContextDetector: aspectMin (${aspectMin}) must not exceed aspectMax ` +
          `(${aspectMax})`,
      );
    }
    if (surfaceMaxForegroundFraction >= 1) {
      throw new RangeError(
        "ContrastContextDetector: surfaceMaxForegroundFraction must be < 1 " +
          `(got ${surfaceMaxForegroundFraction})`,
      );
    }
    if (ringMinSurfaceFraction > 1) {
      throw new RangeError(
        `ContrastContextDetector: ringMinSurfaceFraction must be <= 1 (got ${ringMinSurfaceFraction})`,
      );
    }
    this.detectorId = detectorId;
    this.label = label;
    this.contrastThreshold = contrastThreshold;
    this.deepContrastThreshold = deepContrastThreshold;
    this.surfaceMaxForegroundFraction = surfaceMaxForegroundFraction;
    this.erosionMaxForegroundFraction = erosionMaxForegroundFraction;
    this.minBlobArea = minBlobArea;
    this.maxBlobArea = maxBlobArea;
    this.aspectMin = aspectMin;
    this.aspectMax = aspectMax;
    this.minCompactness = minCompactness;
    this.ringMinSurfaceFraction = ringMinSurfaceFraction;
    this.scaleOptions = {
      ...(options.contrastRadiusPx !== undefined
        ? { contrastRadiusPx: options.contrastRadiusPx }
        : {}),
      ...(options.blockSizePx !== undefined ? { blockSizePx: options.blockSizePx } : {}),
      ...(options.ringMarginPx !== undefined ? { ringMarginPx: options.ringMarginPx } : {}),
    };
    this.descriptor = perceptionDescriptor({
      technologyId: CONTRAST_CONTEXT_DETECTOR_ID,
      technologyVersion: CONTRAST_CONTEXT_DETECTOR_VERSION,
      adapterVersion: CONTRAST_CONTEXT_DETECTOR_ADAPTER_VERSION,
      task: "perception.player-detection",
      inputContract: "contracts/normalized-video-frame@1",
      outputContract: "contracts/observation.detection@1",
    });
    assertDescriptorBinding(this.descriptor, "perception.player-detection");
  }

  detect(frame: DetectorFrameInput): DetectedBox[] {
    const { width, height, bytes } = frame;
    if (width <= 0 || height <= 0 || bytes.length < width * height * 3) return [];
    const radius = this.scaleOptions.contrastRadiusPx ?? defaultContrastRadiusPx(width, height);
    const blockSize = this.scaleOptions.blockSizePx ?? defaultBlockSizePx(width, height);
    const ringMargin = this.scaleOptions.ringMarginPx ?? blockSize;

    const scratch = this.scratchFor(width, height);
    const { integral, mask, cleaned } = scratch;

    // --- 1. local-contrast foreground mask, TWO passes ---------------------
    // Pass 1 approximates the background with the plain local mean; pass 2
    // recomputes the local mean over the pass-1 BACKGROUND pixels only (the
    // classic two-pass background estimate). The refinement is measured
    // evidence, not decoration: with a single pass, bright clutter (pitch
    // lines, goal frames) pollutes the local mean and manufactures (a) a
    // "wedge" of shallow-contrast foreground around every dense clutter
    // crossing and (b) a halo around every blob — both artifacts die when
    // the mean is background-restricted, while genuine contrast (kits vs
    // surface, lines vs surface) fires exactly the same way.
    buildIntegralImages(bytes, width, height, integral);
    const r = radius;
    const stride = width + 1;
    for (let y = 0; y < height; y += 1) {
      const yTop = Math.max(0, y - r);
      const yBottom = Math.min(height - 1, y + r);
      const windowRows = yBottom - yTop + 1;
      for (let x = 0; x < width; x += 1) {
        const xLeft = Math.max(0, x - r);
        const xRight = Math.min(width - 1, x + r);
        const windowPixels = windowRows * (xRight - xLeft + 1);
        const base00 = yTop * stride + xLeft;
        const base10 = yTop * stride + xRight + 1;
        const base01 = (yBottom + 1) * stride + xLeft;
        const base11 = (yBottom + 1) * stride + xRight + 1;
        const index = (y * width + x) * 3;
        let depth = 0;
        for (let channel = 0; channel < 3; channel += 1) {
          const sum =
            integral[channel]![base11]! -
            integral[channel]![base10]! -
            integral[channel]![base01]! +
            integral[channel]![base00]!;
          const mean = sum / windowPixels;
          const value = bytes[index + channel]!;
          const deviation = Math.abs(value - mean);
          if (deviation > this.deepContrastThreshold) {
            depth = 2;
            break;
          }
          if (deviation > this.contrastThreshold) depth = 1;
        }
        mask[y * width + x] = depth;
      }
    }
    // Pass 2: integral images over the pass-1 BACKGROUND pixels, then the
    // mask against the background-restricted local mean. A window with NO
    // background pixels (deep inside dense foreground) stays foreground.
    buildBackgroundIntegralImages(bytes, mask, width, height, integral);
    for (let y = 0; y < height; y += 1) {
      const yTop = Math.max(0, y - r);
      const yBottom = Math.min(height - 1, y + r);
      for (let x = 0; x < width; x += 1) {
        const xLeft = Math.max(0, x - r);
        const xRight = Math.min(width - 1, x + r);
        const base00 = yTop * stride + xLeft;
        const base10 = yTop * stride + xRight + 1;
        const base01 = (yBottom + 1) * stride + xLeft;
        const base11 = (yBottom + 1) * stride + xRight + 1;
        const index = (y * width + x) * 3;
        let foreground = 1;
        for (let channel = 0; channel < 3; channel += 1) {
          const count =
            integral[3]![base11]! -
            integral[3]![base10]! -
            integral[3]![base01]! +
            integral[3]![base00]!;
          if (count === 0) break; // no background samples: keep foreground
          const sum =
            integral[channel]![base11]! -
            integral[channel]![base10]! -
            integral[channel]![base01]! +
            integral[channel]![base00]!;
          const mean = sum / count;
          const value = bytes[index + channel]!;
          if (Math.abs(value - mean) > this.contrastThreshold) {
            foreground = 1;
            break;
          }
          foreground = 0;
        }
        // DEEP-CONTRAST RESTORE: a pass-1 foreground pixel whose deviation
        // exceeded `deepContrastThreshold` (default 2x the contrast
        // threshold) is genuine structure edge (kit vs surface, wall bands
        // of large close-up figures: measured deviations 60-150) and is
        // kept even when the background-restricted mean happens to fit it;
        // shallow pass-1 artifacts (the wedge/halo family, 32-45) stay
        // dead. Without this, the two-pass thinning drops close-up
        // boundary rings below the erosion density and every solid figure
        // larger than the window fragments (measured).
        if (foreground === 0 && mask[y * width + x] === 2) foreground = 1;
        mask[y * width + x] = foreground;
      }
    }

    // --- 2. morphological majority cleanup (5-cross, >= 4 of 5) ----------
    // The CROSS element (self + 4-neighbours) removes isolated speckle
    // WITHOUT filling 1-pixel gaps between adjacent structures — a 3x3
    // box majority welds a player standing next to a pitch line into the
    // line's full-height bar, and the merged blob dies on the aspect gate
    // (measured evidence on the committed fixtures).
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let count = mask[y * width + x]!;
        if (x > 0) count += mask[y * width + x - 1]!;
        if (x < width - 1) count += mask[y * width + x + 1]!;
        if (y > 0) count += mask[(y - 1) * width + x]!;
        if (y < height - 1) count += mask[(y + 1) * width + x]!;
        cleaned[y * width + x] = count >= 4 ? 1 : 0;
      }
    }

    // --- 3. dominant-surface restriction (block grid) ---------------------
    // Step 3a: block-downsample the mask and ERODE the low-density blocks
    // (default 0.35): residual noise blobs (film grain clumps, compression
    // speckle — measured 30-70 per real frame without this) and thin
    // marking fragments die here. Straight blob walls read >= 0.35 in
    // their core blocks and survive.
    const blocksX = Math.ceil(width / blockSize);
    const blocksY = Math.ceil(height / blockSize);
    for (let by = 0; by < blocksY; by += 1) {
      for (let bx = 0; bx < blocksX; bx += 1) {
        const x0 = bx * blockSize;
        const y0 = by * blockSize;
        const x1 = Math.min(width, x0 + blockSize);
        const y1 = Math.min(height, y0 + blockSize);
        let fg = 0;
        let total = 0;
        for (let y = y0; y < y1; y += 1) {
          for (let x = x0; x < x1; x += 1) {
            total += 1;
            fg += cleaned[y * width + x]!;
          }
        }
        if (fg / Math.max(total, 1) < this.erosionMaxForegroundFraction) {
          for (let y = y0; y < y1; y += 1) {
            for (let x = x0; x < x1; x += 1) {
              cleaned[y * width + x] = 0;
            }
          }
        }
      }
    }
    // Step 3b: classify SURFACE blocks on the eroded mask (foreground
    // fraction below `surfaceMaxForegroundFraction`) for the ring-context
    // gate below. (Deliberately NO connected-region labeling: a thin
    // foreground wall — a chalk line's blocks — partitions any region
    // graph and evicts every player on the wrong side of the line; the
    // surface-or-background ring achieves the same crowd/stand gate
    // without that failure mode. Deviation from the research note's
    // literal "largest connected region" wording, documented here and in
    // the lane report.)
    const blockSurface = new Uint8Array(blocksX * blocksY);
    for (let by = 0; by < blocksY; by += 1) {
      for (let bx = 0; bx < blocksX; bx += 1) {
        const x0 = bx * blockSize;
        const y0 = by * blockSize;
        const x1 = Math.min(width, x0 + blockSize);
        const y1 = Math.min(height, y0 + blockSize);
        let fg = 0;
        let total = 0;
        for (let y = y0; y < y1; y += 1) {
          for (let x = x0; x < x1; x += 1) {
            total += 1;
            fg += cleaned[y * width + x]!;
          }
        }
        blockSurface[by * blocksX + bx] =
          fg / Math.max(total, 1) < this.surfaceMaxForegroundFraction ? 1 : 0;
      }
    }
    let surfaceBlockCount = 0;
    for (let i = 0; i < blockSurface.length; i += 1) surfaceBlockCount += blockSurface[i]!;

    // --- 4. connected components + geometric gates -------------------------
    const detections: DetectedBox[] = [];
    if (surfaceBlockCount === 0) {
      // NO surface block exists (every block is dense foreground — a tight
      // crowd shot, a fully-cluttered pattern): this is the documented
      // OFF-ENVELOPE refusal, not an honest "no players" result. The
      // candidate refuses with its failure class so the pipeline's
      // degradation chain engages (the ledger records the refusal + the
      // fallback — the checkpoint's designed posture: the color baseline
      // remains the final fallback); a frame WITH a surface and no players
      // returns [] honestly instead.
      throw new CandidateFailureError(
        `ContrastContextDetector: no dominant playing surface in this frame ` +
          `(${blocksX}x${blocksY} blocks, none surface-classified) — the ring-context ` +
          `gate has nothing to stand on; refusing with the documented off-envelope ` +
          `class so the chain degrades honestly`,
        {
          failureClassId: "contrast-context.off-envelope-framing",
          detectorId: this.detectorId,
          blocksX,
          blocksY,
        },
      );
    }
    for (const blob of connectedComponentsOf(cleaned, width, height)) {
      const w = blob.maxX - blob.minX + 1;
      const h = blob.maxY - blob.minY + 1;
      if (blob.area < this.minBlobArea || blob.area > this.maxBlobArea) continue;
      const aspect = Math.max(w, h) / Math.min(w, h);
      if (aspect < this.aspectMin || aspect > this.aspectMax) continue;
      const boxArea = w * h;
      const compactness = blob.area / boxArea;
      if (compactness < this.minCompactness) continue;
      // --- 5. ring-context surface membership -----------------------------
      // A ring pixel counts as SURFACE when it lies in a surface block OR
      // is itself background in the cleaned mask: players STAND ON open
      // background (pitch, sand, gray field) — a blob surrounded by other
      // foreground (crowd, stands, netting) fails this gate. Thin marking
      // lines crossing the ring cost only their few pixels, so players ON
      // chalk lines stay detected.
      const ringX0 = blob.minX - ringMargin;
      const ringY0 = blob.minY - ringMargin;
      const ringX1 = blob.maxX + ringMargin;
      const ringY1 = blob.maxY + ringMargin;
      let ringPixels = 0;
      let ringSurface = 0;
      for (let y = ringY0; y <= ringY1; y += 1) {
        for (let x = ringX0; x <= ringX1; x += 1) {
          const insideBlobBox =
            x >= blob.minX && x <= blob.maxX && y >= blob.minY && y <= blob.maxY;
          if (insideBlobBox) continue;
          ringPixels += 1;
          // Out-of-frame ring positions count as NON-surface: a blob that
          // fills the frame to its edges cannot smuggle a clean ring past
          // the gate on the one in-frame strip that happens to be surface.
          if (x < 0 || x >= width || y < 0 || y >= height) continue;
          const bx = Math.floor(x / blockSize);
          const by = Math.floor(y / blockSize);
          if (blockSurface[by * blocksX + bx] === 1 || cleaned[y * width + x] === 0) {
            ringSurface += 1;
          }
        }
      }
      if (ringPixels === 0) continue;
      const ringFraction = ringSurface / ringPixels;
      if (ringFraction < this.ringMinSurfaceFraction) continue;
      // --- 6. honest confidence: compactness x ring surface fraction ------
      const x0 = blob.minX / width;
      const x1 = (blob.maxX + 1) / width;
      const y0 = blob.minY / height;
      const y1 = (blob.maxY + 1) / height;
      const confidence = Math.min(1, Math.max(1e-6, compactness * ringFraction));
      detections.push({
        box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
        label: this.label,
        confidence,
      });
    }
    return detections;
  }

  /** (Re)allocates the per-size scratch buffers (never output-visible). */
  private scratchFor(
    width: number,
    height: number,
  ): {
    integral: Int32Array[];
    mask: Uint8Array;
    cleaned: Uint8Array;
  } {
    if (this.scratch !== null && this.scratch.width === width && this.scratch.height === height) {
      return this.scratch;
    }
    const scratch = {
      width,
      height,
      integral: [
        new Int32Array((width + 1) * (height + 1)),
        new Int32Array((width + 1) * (height + 1)),
        new Int32Array((width + 1) * (height + 1)),
        new Int32Array((width + 1) * (height + 1)),
      ],
      mask: new Uint8Array(width * height),
      cleaned: new Uint8Array(width * height),
    };
    this.scratch = scratch;
    return scratch;
  }
}

/** Builds the three per-channel integral images (zero row/column prefix). */
function buildIntegralImages(
  bytes: Uint8Array,
  width: number,
  height: number,
  integral: Int32Array[],
): void {
  const stride = width + 1;
  for (let channel = 0; channel < 3; channel += 1) {
    const table = integral[channel]!;
    table.fill(0);
    for (let y = 0; y < height; y += 1) {
      let rowSum = 0;
      const rowBase = (y + 1) * stride;
      const prevBase = y * stride;
      const pixelBase = y * width * 3 + channel;
      for (let x = 0; x < width; x += 1) {
        rowSum += bytes[pixelBase + x * 3]!;
        table[rowBase + x + 1] = table[prevBase + x + 1]! + rowSum;
      }
    }
  }
}

/**
 * Builds the pass-2 integral images over the pass-1 BACKGROUND pixels
 * only: three channel-sum tables plus a background-COUNT table at index 3
 * (the background-restricted local mean = sum / count per window).
 */
function buildBackgroundIntegralImages(
  bytes: Uint8Array,
  mask: Uint8Array,
  width: number,
  height: number,
  integral: Int32Array[],
): void {
  const stride = width + 1;
  for (let channel = 0; channel < 3; channel += 1) {
    integral[channel]!.fill(0);
  }
  integral[3]!.fill(0);
  for (let y = 0; y < height; y += 1) {
    let rowSum0 = 0;
    let rowSum1 = 0;
    let rowSum2 = 0;
    let rowCount = 0;
    const rowBase = (y + 1) * stride;
    const prevBase = y * stride;
    const pixelBase = y * width * 3;
    const maskBase = y * width;
    for (let x = 0; x < width; x += 1) {
      if (mask[maskBase + x] === 0) {
        rowSum0 += bytes[pixelBase + x * 3]!;
        rowSum1 += bytes[pixelBase + x * 3 + 1]!;
        rowSum2 += bytes[pixelBase + x * 3 + 2]!;
        rowCount += 1;
      }
      integral[0]![rowBase + x + 1] = integral[0]![prevBase + x + 1]! + rowSum0;
      integral[1]![rowBase + x + 1] = integral[1]![prevBase + x + 1]! + rowSum1;
      integral[2]![rowBase + x + 1] = integral[2]![prevBase + x + 1]! + rowSum2;
      integral[3]![rowBase + x + 1] = integral[3]![prevBase + x + 1]! + rowCount;
    }
  }
}

/**
 * 4-connectivity connected-component labeling over the cleaned mask,
 * row-major first-pixel order (deterministic) — the same contract as the
 * package's shared `connectedComponents`, inlined to keep the scratch
 * buffers local and the blob scan allocation-free.
 */
function connectedComponentsOf(
  mask: Uint8Array,
  width: number,
  height: number,
): Array<{ minX: number; minY: number; maxX: number; maxY: number; area: number }> {
  const visited = new Uint8Array(width * height);
  const blobs: Array<{ minX: number; minY: number; maxX: number; maxY: number; area: number }> = [];
  const queue = new Int32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (mask[start] === 0 || visited[start] !== 0) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      visited[start] = 1;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let area = 0;
      while (head < tail) {
        const current = queue[head++]!;
        const cx = current % width;
        const cy = (current - cx) / width;
        area += 1;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        if (cx > 0 && mask[current - 1] !== 0 && visited[current - 1] === 0) {
          visited[current - 1] = 1;
          queue[tail++] = current - 1;
        }
        if (cx < width - 1 && mask[current + 1] !== 0 && visited[current + 1] === 0) {
          visited[current + 1] = 1;
          queue[tail++] = current + 1;
        }
        if (cy > 0 && mask[current - width] !== 0 && visited[current - width] === 0) {
          visited[current - width] = 1;
          queue[tail++] = current - width;
        }
        if (cy < height - 1 && mask[current + width] !== 0 && visited[current + width] === 0) {
          visited[current + width] = 1;
          queue[tail++] = current + width;
        }
      }
      blobs.push({ minX, minY, maxX, maxY, area });
    }
  }
  return blobs;
}
