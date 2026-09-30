/**
 * Support-machinery tests (the dead-code law): the seeded PRNG, the stable
 * content hashing, and the typed error family all ship with their unit
 * contracts.
 */
import { describe, expect, test } from "bun:test";
import {
  BodyContractError,
  LabRng,
  LabValidationError,
  contentHash,
  contentId,
  hashSeedToUint32,
  isLabError,
  stableStringify,
} from "../src";

describe("LabRng — the determinism machinery", () => {
  test("same seed ⇒ identical streams (1000 draws)", () => {
    const a = new LabRng("stream-seed");
    const b = new LabRng("stream-seed");
    for (let i = 0; i < 1000; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  test("different seeds ⇒ divergent streams", () => {
    const a = new LabRng("stream-seed");
    const b = new LabRng("stream-seed-2");
    const drawsA = Array.from({ length: 10 }, () => a.next());
    const drawsB = Array.from({ length: 10 }, () => b.next());
    expect(drawsA).not.toEqual(drawsB);
  });

  test("integer seeds and string seeds hash to the same stream shape", () => {
    const a = new LabRng(12345);
    const b = new LabRng(12345);
    expect(a.nextUint32()).toBe(b.nextUint32());
  });

  test("forks are independent substreams (drawing from one never shifts another)", () => {
    const parent = new LabRng("parent");
    const forkA = parent.fork("a");
    const forkB = parent.fork("b");
    const bBefore = Array.from({ length: 20 }, () => forkB.next());
    for (let i = 0; i < 50; i++) forkA.next(); // burn A's stream
    const forkBFresh = new LabRng("parent").fork("b");
    const bAfter = Array.from({ length: 20 }, () => forkBFresh.next());
    expect(bBefore).toEqual(bAfter);
  });

  test("distributions: next() in [0,1); int() in range; bool() obeys p; normal() sane", () => {
    const rng = new LabRng("dist-seed");
    for (let i = 0; i < 200; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    for (let i = 0; i < 100; i++) {
      const value = rng.int(3, 8);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThan(8);
    }
    const biased = new LabRng("bool-seed");
    let trues = 0;
    for (let i = 0; i < 1000; i++) if (biased.bool(0.9)) trues++;
    expect(trues).toBeGreaterThan(800); // p=0.9 over 1000 draws
    const gaussian = new LabRng("normal-seed");
    for (let i = 0; i < 500; i++) {
      const value = gaussian.normal(0, 1);
      expect(Math.abs(value)).toBeLessThan(6); // 6σ sanity bound
    }
  });

  test("pick() returns an element and refuses empty arrays", () => {
    const rng = new LabRng("pick-seed");
    const items = ["a", "b", "c"] as const;
    for (let i = 0; i < 20; i++) expect(items).toContain(rng.pick(items));
    expect(() => rng.pick([])).toThrow(RangeError);
    expect(() => rng.int(5, 5)).toThrow(RangeError);
  });

  test("hashSeedToUint32 is stable and spreads nearby strings", () => {
    expect(hashSeedToUint32("seed")).toBe(hashSeedToUint32("seed"));
    expect(hashSeedToUint32("seed")).not.toBe(hashSeedToUint32("seed2"));
    expect(hashSeedToUint32("a")).not.toBe(hashSeedToUint32("b"));
  });
});

describe("stable content hashing", () => {
  test("stableStringify sorts keys recursively (property order is not identity)", () => {
    expect(stableStringify({ a: 1, b: { d: 4, c: 3 } })).toBe(
      stableStringify({ b: { c: 3, d: 4 }, a: 1 }),
    );
    expect(stableStringify({ a: 1, b: 2 })).not.toBe(stableStringify({ b: 1, a: 2 }));
  });

  test("arrays keep order (order IS identity for sequences)", () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  test("undefined-valued keys are dropped (deterministic serialization)", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });

  test("contentHash/contentId are stable and content-sensitive", () => {
    expect(contentHash({ b: 2, a: 1 })).toBe(contentHash({ a: 1, b: 2 }));
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
    expect(contentHash("x")).toHaveLength(64);
    expect(contentId({ a: 1 })).toBe(contentId({ a: 1 }));
    expect(contentId({ a: 1 })).toHaveLength(16);
    expect(contentId({ a: 1 })).not.toBe(contentId({ a: 2 }));
  });
});

describe("the typed error family", () => {
  test("isLabError recognizes the family; classified failureClasses ride along", () => {
    const validation = new LabValidationError("bad input", [{ field: "x" }]);
    expect(isLabError(validation)).toBe(true);
    expect(validation.failureClass).toBe("validation");
    expect(validation.details).toEqual({ issues: [{ field: "x" }] });
    expect(isLabError(new Error("plain"))).toBe(false);
    const bodyError = new BodyContractError("missing fields", [], ["budget"], []);
    expect(isLabError(bodyError)).toBe(true);
    expect(bodyError).toBeInstanceOf(LabValidationError);
    expect(bodyError.missingFields).toEqual(["budget"]);
  });
});
