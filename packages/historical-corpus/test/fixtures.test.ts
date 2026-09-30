/**
 * REL-009 content-addressed benchmark fixture tests: the reproducibility
 * contract — every field present, the id a pure function of content, and
 * the honest null for reference-only fixtures.
 */
import { describe, expect, test } from "bun:test";
import {
  BenchmarkFixtureInputSchema,
  CorpusValidationError,
  canonicalJson,
  createBenchmarkFixture,
} from "../src";
import type { BenchmarkFixtureInput } from "../src";

const HEX64 = /^[0-9a-f]{64}$/;

function fixtureInput(overrides: Partial<BenchmarkFixtureInput> = {}): BenchmarkFixtureInput {
  return {
    sourceRef: {
      sourceId: "source-1",
      provider: "youtube",
      providerContentId: "vid-001",
      canonicalUrl: "https://www.youtube.com/watch?v=vid-001",
    },
    acquiredByteChecksum: "1".repeat(64),
    normalizedByteChecksum: "2".repeat(64),
    timeWindow: { startMs: 1_700_000_000_000, endMs: 1_700_000_060_000 },
    versions: [
      { name: "optical-flow", kind: "feature", version: "1.2.0" },
      { name: "h264-decoder", kind: "decoder", version: "9" },
    ],
    ...overrides,
  };
}

describe("the content-addressed fixture id", () => {
  test("identical input produces the identical fixtureId (run twice)", async () => {
    const a = await createBenchmarkFixture(fixtureInput());
    const b = await createBenchmarkFixture(fixtureInput());
    expect(a.fixtureId).toBe(b.fixtureId);
    expect(a.fixtureId).toMatch(HEX64);
  });

  test("property insertion order never matters (canonical serialization)", async () => {
    const a = await createBenchmarkFixture(fixtureInput());
    const shuffled = {
      versions: fixtureInput().versions,
      timeWindow: fixtureInput().timeWindow,
      normalizedByteChecksum: fixtureInput().normalizedByteChecksum,
      acquiredByteChecksum: fixtureInput().acquiredByteChecksum,
      sourceRef: fixtureInput().sourceRef,
    };
    const b = await createBenchmarkFixture(shuffled);
    expect(a.fixtureId).toBe(b.fixtureId);
    // And the canonical JSON itself is order-insensitive.
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  test("every reproducibility field participates in the address", async () => {
    const base = await createBenchmarkFixture(fixtureInput());
    const variations: BenchmarkFixtureInput[] = [
      // different source reference
      fixtureInput({
        sourceRef: {
          sourceId: "source-2",
          provider: "youtube",
          providerContentId: "vid-001",
          canonicalUrl: "https://www.youtube.com/watch?v=vid-001",
        },
      }),
      // different acquired checksum
      fixtureInput({ acquiredByteChecksum: "3".repeat(64) }),
      // different normalized checksum
      fixtureInput({ normalizedByteChecksum: "4".repeat(64) }),
      // different time window
      fixtureInput({ timeWindow: { startMs: 1_700_000_000_000, endMs: 1_700_000_061_000 } }),
      // different feature versions
      fixtureInput({
        versions: [{ name: "optical-flow", kind: "feature", version: "1.3.0" }],
      }),
    ];
    for (const variation of variations) {
      const fixture = await createBenchmarkFixture(variation);
      expect(fixture.fixtureId).not.toBe(base.fixtureId);
    }
  });

  test("null vs a checksum for acquired bytes are different addresses (reference-only honesty)", async () => {
    const withNull = await createBenchmarkFixture(fixtureInput({ acquiredByteChecksum: null }));
    const withChecksum = await createBenchmarkFixture(fixtureInput());
    expect(withNull.fixtureId).not.toBe(withChecksum.fixtureId);
    expect(withNull.acquiredByteChecksum).toBeNull();
  });
});

describe("the fixture carries every contract field", () => {
  test("source ref, checksums, time window and feature/decoder versions", async () => {
    const input = fixtureInput();
    const fixture = await createBenchmarkFixture(input);
    expect(fixture.sourceRef).toEqual(input.sourceRef);
    expect(fixture.acquiredByteChecksum).toBe(input.acquiredByteChecksum);
    expect(fixture.normalizedByteChecksum).toBe(input.normalizedByteChecksum);
    expect(fixture.timeWindow).toEqual(input.timeWindow);
    expect(fixture.versions).toEqual(input.versions);
  });

  test("the fixture is frozen (immutable evidence)", async () => {
    const fixture = await createBenchmarkFixture(fixtureInput());
    expect(Object.isFrozen(fixture)).toBe(true);
    expect(() => {
      (fixture as unknown as { normalizedByteChecksum: string }).normalizedByteChecksum =
        "0".repeat(64);
    }).toThrow();
  });
});

describe("fixture input validation (fail-closed shape)", () => {
  test("an inverted time window refuses", async () => {
    await expect(
      createBenchmarkFixture(fixtureInput({ timeWindow: { startMs: 200, endMs: 100 } })),
    ).rejects.toThrow(CorpusValidationError);
  });

  test("an empty versions list refuses (reproducibility pins at least one version)", async () => {
    await expect(createBenchmarkFixture(fixtureInput({ versions: [] }))).rejects.toThrow(
      CorpusValidationError,
    );
  });

  test("a non-hex checksum refuses", async () => {
    await expect(
      createBenchmarkFixture(fixtureInput({ normalizedByteChecksum: "zz" })),
    ).rejects.toThrow(CorpusValidationError);
    await expect(
      createBenchmarkFixture(fixtureInput({ acquiredByteChecksum: "not-a-digest" })),
    ).rejects.toThrow(CorpusValidationError);
  });

  test("the schema rejects an unknown component kind", () => {
    expect(
      BenchmarkFixtureInputSchema.safeParse(
        fixtureInput({ versions: [{ name: "x", kind: "codec" as never, version: "1" }] }),
      ).success,
    ).toBe(false);
  });
});
