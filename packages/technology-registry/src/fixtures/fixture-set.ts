/**
 * Benchmark fixture-set contracts (R002).
 *
 * The frozen, versioned fixture set every candidate technology is evaluated
 * against (technology-plane.md "Benchmark contract"): candidates are
 * compared ONLY on the same `fixtureSetVersion`, so the set itself is an
 * immutable, versioned artifact.
 *
 * Honesty rules encoded here:
 *
 * - Every entry declares whether it is `real-footage` or
 *   `synthetic-diagnostic`. A synthetic clip (procedurally generated) is a
 *   legitimate DETERMINISM/diagnostic fixture but is NEVER real footage and
 *   must never be presented as one; real footage MUST cite its source URL.
 * - Every entry carries a full `TechnologyLicenseRecord` — the MEDIA license
 *   under `code` (the work itself) and, when separately licensed, the
 *   expected annotations under `dataset`. Permissive media licensing does
 *   not make an annotation dataset commercially usable; the components are
 *   reviewed separately, exactly like technology licenses.
 * - An entry whose license is unresolved OR whose commercial-use verdict is
 *   not affirmed is allowed in the set but is flagged `evaluation-only`
 *   ({@link isEvaluationOnly}): it may back evaluation and comparison, but
 *   never a production claim.
 */
import { TechnologyLicenseRecord, schemaVersionField } from "@sporta/contracts";
import type { TechnologyLicenseRecord as TechnologyLicenseRecordDoc } from "@sporta/contracts";
import { z } from "zod";

/** The closed scenario taxonomy a fixture may be tagged with. */
export const FixtureScenarioTag = z.enum([
  "open-play",
  "ball-action",
  "occlusion",
  "camera-movement",
  "cut-boundary",
  "set-piece",
]);
export type FixtureScenarioTag = z.infer<typeof FixtureScenarioTag>;

/** Whether a fixture's media is real footage or a synthetic diagnostic. */
export const FixtureMediaKind = z.enum(["real-footage", "synthetic-diagnostic"]);
export type FixtureMediaKind = z.infer<typeof FixtureMediaKind>;

/** One fixture entry: media + license + expected annotations + scenarios. */
export const FixtureEntry = z
  .object({
    schemaVersion: schemaVersionField,
    fixtureId: z.string().min(1),
    mediaKind: FixtureMediaKind,
    /** Reference to the media: a path relative to this package's `fixtures/media/` or an absolute URL. */
    mediaRef: z.string().min(1),
    media: z.object({
      /** Where the media was sourced from (REQUIRED for real footage). */
      sourceUrl: z.string().min(1).optional(),
      /** The upstream license page / record for the source. */
      sourceLicenseUrl: z.string().min(1).optional(),
      acquiredAtMs: z.number().int().min(0).optional(),
      /** sha256 of the exact media file, pinned for integrity. */
      sha256: z.string().min(1).optional(),
      /** How the checked-in file was derived from the source (e.g. "trimmed 0s-20s, downscaled to 640px"). */
      derivationNote: z.string().optional(),
      durationSeconds: z.number().positive().optional(),
    }),
    license: TechnologyLicenseRecord,
    /** References to expected-annotation artifacts (never inline payloads). */
    expectedAnnotationRefs: z.array(z.string().min(1)),
    /** Scenario coverage; at least one tag per entry. */
    scenarioTags: z.array(FixtureScenarioTag).min(1),
    notes: z.string().optional(),
  })
  .superRefine((entry, ctx) => {
    if (entry.mediaKind === "real-footage" && entry.media.sourceUrl === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["media", "sourceUrl"],
        message: "real-footage entries must cite their source URL",
      });
    }
    if (entry.mediaKind === "synthetic-diagnostic" && entry.media.sourceUrl !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["media", "sourceUrl"],
        message:
          "synthetic-diagnostic entries are generated, not sourced; do not cite a source URL",
      });
    }
  });
export type FixtureEntry = z.infer<typeof FixtureEntry>;

/** A frozen, versioned fixture set. */
export const FixtureSet = z
  .object({
    schemaVersion: schemaVersionField,
    fixtureSetVersion: z.string().min(1),
    displayName: z.string().min(1),
    entries: z.array(FixtureEntry).min(1),
    createdAtMs: z.number().int().min(0),
    notes: z.string().optional(),
  })
  .superRefine((set, ctx) => {
    const ids = new Set<string>();
    for (const [index, entry] of set.entries.entries()) {
      if (ids.has(entry.fixtureId)) {
        ctx.addIssue({
          code: "custom",
          path: ["entries", index, "fixtureId"],
          message: `duplicate fixtureId '${entry.fixtureId}'`,
        });
      }
      ids.add(entry.fixtureId);
    }
  });
export type FixtureSet = z.infer<typeof FixtureSet>;

/** Parse + validate a fixture entry (throws the zod error on invalid input). */
export function parseFixtureEntry(input: unknown): FixtureEntry {
  return FixtureEntry.parse(input);
}

/** Parse + validate a fixture set (throws the zod error on invalid input). */
export function parseFixtureSet(input: unknown): FixtureSet {
  return FixtureSet.parse(input);
}

/**
 * The `evaluation-only` flag (R002): an entry may back evaluation and
 * comparison runs, but never a production claim, unless EVERY present
 * license component is resolved AND affirmatively commercially usable.
 * Unresolved status or an unreviewed/absent commercial-use verdict both
 * flag the entry. Absent components are not flagged (they do not apply —
 * e.g. a clip with no separately-licensed model or dataset).
 */
export function isEvaluationOnly(entry: FixtureEntry): boolean {
  const components: Array<
    TechnologyLicenseRecordDoc[keyof TechnologyLicenseRecordDoc] | undefined
  > = [entry.license.code, entry.license.model, entry.license.dataset, entry.license.assets];
  return components.some(
    (component) =>
      component !== undefined &&
      (component.status === "unresolved" || component.commercialUse !== true),
  );
}

/** All scenario tags covered by a fixture set (for coverage assertions). */
export function coveredScenarioTags(set: FixtureSet): FixtureScenarioTag[] {
  const tags = new Set<FixtureScenarioTag>();
  for (const entry of set.entries) {
    for (const tag of entry.scenarioTags) tags.add(tag);
  }
  return [...tags].sort();
}
