/**
 * REL-009 public-surface tests: every runtime export the behavior tests
 * reach only indirectly — the zod schemas (the boundary validators), the
 * vocabulary guards, the typed error family constructors, the clock/id
 * constitution and the canonical-JSON/hash primitives — pinned here so
 * nothing ships untested.
 */
import { describe, expect, test } from "bun:test";
import type { CorpusFailureClass } from "../src";
import {
  ACQUISITION_STATES,
  AVAILABILITY_STATES,
  CORPUS_DEFAULT_EPOCH_MS,
  CorpusAccessInvalidError,
  CorpusApiError,
  CorpusBytesUnavailableError,
  CorpusConflictError,
  CorpusFixtureMismatchError,
  CorpusIllegalTransitionError,
  CorpusInternalError,
  CorpusNotFoundError,
  CorpusRestrictionError,
  CorpusRightsBasisRequiredError,
  CorpusValidationError,
  RIGHTS_BASIS_TYPES,
  SOURCE_RESTRICTIONS,
  AcquisitionStateSchema,
  MediaAvailabilitySchema,
  RightsBasisSchema,
  SourceMetadataSchema,
  canonicalJson,
  createCorpusDefaultClock,
  createDefaultSourceIdSource,
  createSequentialIdSource,
  isCorpusError,
  sha256Hex,
  toIsoUtc,
} from "../src";
import { providerPermittedBasis, youtubeMetadata } from "./fixtures";

describe("the vocabulary schemas", () => {
  test("AcquisitionStateSchema accepts the five states and rejects typos", () => {
    for (const state of ACQUISITION_STATES) {
      expect(AcquisitionStateSchema.safeParse(state).success).toBe(true);
    }
    expect(AcquisitionStateSchema.safeParse("authorized").success).toBe(false);
    expect(AcquisitionStateSchema.safeParse("Authorized-For-Access").success).toBe(false);
    expect(AcquisitionStateSchema.safeParse(1).success).toBe(false);
  });

  test("MediaAvailabilitySchema accepts the vocabulary and rejects others", () => {
    for (const state of AVAILABILITY_STATES) {
      expect(MediaAvailabilitySchema.safeParse(state).success).toBe(true);
    }
    expect(MediaAvailabilitySchema.safeParse("gone").success).toBe(false);
  });

  test("the frozen vocabularies are pinned", () => {
    expect(ACQUISITION_STATES).toEqual([
      "referenced",
      "authorized-for-access",
      "acquired",
      "normalized",
      "benchmarked",
    ]);
    expect(SOURCE_RESTRICTIONS).toEqual([
      "reference-only",
      "no-transformation",
      "private",
      "rights-reserved",
      "tos-restricted",
    ]);
    expect(RIGHTS_BASIS_TYPES).toEqual([
      "user-declared-ownership",
      "user-authorized-connector",
      "provider-permitted-terms",
      "authorized-feed",
      "other-recorded-basis",
    ]);
  });
});

describe("the boundary schemas", () => {
  test("SourceMetadataSchema validates the full shape and rejects a bad URL field", () => {
    expect(SourceMetadataSchema.safeParse(youtubeMetadata()).success).toBe(true);
    expect(SourceMetadataSchema.safeParse({ ...youtubeMetadata(), canonicalUrl: "" }).success).toBe(
      false,
    );
    expect(
      SourceMetadataSchema.safeParse({ ...youtubeMetadata(), availability: "somewhere" }).success,
    ).toBe(false);
    expect(
      SourceMetadataSchema.safeParse({
        ...youtubeMetadata(),
        restrictions: ["made-up-restriction"],
      }).success,
    ).toBe(false);
  });

  test("RightsBasisSchema requires every field and rejects an empty grant reference", () => {
    expect(RightsBasisSchema.safeParse(providerPermittedBasis()).success).toBe(true);
    expect(RightsBasisSchema.safeParse({ ...providerPermittedBasis(), grantRef: "" }).success).toBe(
      false,
    );
    expect(
      RightsBasisSchema.safeParse({
        ...providerPermittedBasis(),
        basisType: "wishful-thinking",
      }).success,
    ).toBe(false);
    expect(RightsBasisSchema.safeParse(undefined).success).toBe(false);
  });
});

describe("the typed error family", () => {
  test("every constructor carries its stable code and failure class", () => {
    const cases: Array<[CorpusApiError, string, CorpusFailureClass]> = [
      [new CorpusValidationError("v", ["issue"]), "corpus.validation", "validation"],
      [new CorpusNotFoundError("n"), "corpus.not-found", "not-found"],
      [new CorpusConflictError("c"), "corpus.conflict", "conflict"],
      [new CorpusRightsBasisRequiredError("r"), "corpus.rights-basis-required", "rights"],
      [new CorpusRestrictionError("x"), "corpus.restriction-forbidden", "restriction"],
      [
        new CorpusIllegalTransitionError("i", { from: "a", to: "b", reason: "r" }),
        "corpus.illegal-transition",
        "illegal-transition",
      ],
      [new CorpusAccessInvalidError("a"), "corpus.access-invalid", "rights"],
      [new CorpusBytesUnavailableError("b"), "corpus.bytes-unavailable", "not-found"],
      [new CorpusFixtureMismatchError("f"), "corpus.fixture-mismatch", "conflict"],
      [new CorpusInternalError("z"), "corpus.internal", "internal"],
    ];
    for (const [error, code, failureClass] of cases) {
      expect(error.code).toBe(code);
      expect(error.failureClass).toBe(failureClass);
      expect(isCorpusError(error)).toBe(true);
      expect(error).toBeInstanceOf(CorpusApiError);
    }
    expect(isCorpusError(new Error("plain"))).toBe(false);
  });

  test("details ride along, JSON-safe", () => {
    const error = new CorpusRightsBasisRequiredError("no basis", { sourceId: "source-9" });
    expect(error.details).toEqual({ sourceId: "source-9" });
    expect(JSON.parse(JSON.stringify(error.details))).toEqual({ sourceId: "source-9" });
  });
});

describe("the clock/id constitution", () => {
  test("the deterministic default clock ticks from the shared epoch", () => {
    const clock = createCorpusDefaultClock();
    expect(CORPUS_DEFAULT_EPOCH_MS).toBe(Date.parse("2025-01-06T12:00:00.000Z"));
    expect(clock()).toBe(CORPUS_DEFAULT_EPOCH_MS + 1);
    expect(clock()).toBe(CORPUS_DEFAULT_EPOCH_MS + 2);
    expect(clock()).toBe(CORPUS_DEFAULT_EPOCH_MS + 3);
  });

  test("the sequential id source is deterministic and namespaced", () => {
    const ids = createSequentialIdSource("src");
    expect(ids.nextId()).toBe("src-1");
    expect(ids.nextId()).toBe("src-2");
    expect(createDefaultSourceIdSource().nextId()).toBe("source-1");
  });

  test("toIsoUtc formats the epoch", () => {
    expect(toIsoUtc(CORPUS_DEFAULT_EPOCH_MS)).toBe("2025-01-06T12:00:00.000Z");
  });
});

describe("the hash primitives", () => {
  test("sha256Hex is the standard digest of the UTF-8 text", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  test("canonicalJson sorts keys recursively and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson([2, 1])).toBe("[2,1]");
  });
});
