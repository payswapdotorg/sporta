/**
 * W403 canonical serializer unit tests: sorted keys, full float precision,
 * volatile-value rejection (NaN / ±Infinity / undefined / non-JSON types)
 * with the JSON path, array order preservation, and byte determinism.
 */
import { describe, expect, test } from "bun:test";
import { canonicalizeValue, serializeArtifact } from "../src/serialize";

describe("serializeArtifact — canonical form", () => {
  test("object keys are sorted at every level (insertion order cannot leak)", () => {
    const a = { z: 1, a: { y: 2, b: 3 }, m: [4, 5] };
    const b = { a: { b: 3, y: 2 }, m: [4, 5], z: 1 };
    expect(serializeArtifact(a)).toBe(serializeArtifact(b));
    expect(serializeArtifact(a)).toBe(
      '{\n  "a": {\n    "b": 3,\n    "y": 2\n  },\n  "m": [\n    4,\n    5\n  ],\n  "z": 1\n}\n',
    );
  });

  test("array order is preserved verbatim (order IS semantic)", () => {
    expect(serializeArtifact([3, 1, 2])).not.toBe(serializeArtifact([1, 2, 3]));
    expect(serializeArtifact([3, 1, 2])).toBe(serializeArtifact([3, 1, 2]));
  });

  test("full float precision: shortest-round-trip, never rounded", () => {
    expect(serializeArtifact(0.1 + 0.2)).toBe("0.30000000000000004\n");
    expect(serializeArtifact(1 / 3)).toBe("0.3333333333333333\n");
    expect(serializeArtifact(1e-9)).toBe("1e-9\n");
    // Round-trip exactness: parse(bytes) === the original double.
    const value = 0.1 * 0.7 + 0.3 * 0.9;
    expect(JSON.parse(serializeArtifact(value))).toBe(value);
  });

  test("deterministic: the same value yields the same bytes every call", () => {
    const value = { b: [1, { c: 0.1 + 0.2 }], a: "x" };
    expect(serializeArtifact(value)).toBe(serializeArtifact(value));
    expect(serializeArtifact(value)).toBe(serializeArtifact(structuredClone(value)));
  });
});

describe("serializeArtifact — volatile / non-JSON values fail loud with the path", () => {
  test("NaN is rejected with its JSON path", () => {
    expect(() => serializeArtifact({ a: { b: [1, Number.NaN] } })).toThrow(RangeError);
    expect(() => serializeArtifact({ a: { b: [1, Number.NaN] } })).toThrow(/\$\.a\.b\[1\] is NaN/);
  });

  test("±Infinity is rejected with its JSON path", () => {
    expect(() => serializeArtifact({ pos: [Number.POSITIVE_INFINITY] })).toThrow(
      /\$\.pos\[0\] is Infinity/,
    );
    expect(() => serializeArtifact({ neg: Number.NEGATIVE_INFINITY })).toThrow(
      /\$\.neg is -Infinity/,
    );
  });

  test("undefined values (object values AND array elements) are rejected", () => {
    expect(() => serializeArtifact({ a: undefined })).toThrow(/\$\.a is undefined/);
    expect(() => serializeArtifact({ a: [undefined] })).toThrow(/\$\.a\[0\] is undefined/);
  });

  test("non-JSON types (function, symbol, bigint) are rejected", () => {
    expect(() => serializeArtifact({ f: () => 1 })).toThrow(/non-JSON type function/);
    expect(() => serializeArtifact({ s: Symbol("x") })).toThrow(/non-JSON type symbol/);
    expect(() => serializeArtifact({ n: 1n })).toThrow(/non-JSON type bigint/);
  });

  test("null, strings, booleans, and integers pass through verbatim", () => {
    expect(canonicalizeValue(null)).toBe(null);
    expect(canonicalizeValue("text")).toBe("text");
    expect(canonicalizeValue(false)).toBe(false);
    expect(canonicalizeValue(42)).toBe(42);
    expect(serializeArtifact({ ok: null, s: "v", b: true, n: 7 })).toContain('"ok": null');
  });
});
