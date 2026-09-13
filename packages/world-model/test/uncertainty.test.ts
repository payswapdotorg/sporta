import { describe, expect, test } from "bun:test";
import { UncertainValue } from "@sporta/contracts";
import {
  InvalidUncertainValueError,
  known,
  resolveUncertain,
  uncertain,
  unknownValue,
} from "../src/index";

describe("uncertainty constructors", () => {
  test("known() builds a known slot carrying its value", () => {
    expect(known(7)).toEqual({ status: "known", value: 7 });
  });

  test("known() carries an optional confidence", () => {
    expect(known("home", 0.9)).toEqual({ status: "known", value: "home", confidence: 0.9 });
  });

  test("known() accepts boundary confidences 0 and 1", () => {
    expect(known(1, 0)).toEqual({ status: "known", value: 1, confidence: 0 });
    expect(known(1, 1)).toEqual({ status: "known", value: 1, confidence: 1 });
  });

  test("known() accepts falsy values as real values", () => {
    expect(known(0)).toEqual({ status: "known", value: 0 });
    expect(known(false)).toEqual({ status: "known", value: false });
    expect(known(null)).toEqual({ status: "known", value: null });
  });

  test("known() rejects a missing value (never fabricate certainty)", () => {
    expect(() => known(undefined)).toThrow(InvalidUncertainValueError);
  });

  test("known() rejects out-of-range confidence", () => {
    expect(() => known(7, 1.01)).toThrow(InvalidUncertainValueError);
    expect(() => known(7, -0.01)).toThrow(InvalidUncertainValueError);
  });

  test("unknownValue() is the explicit unknown slot", () => {
    expect(unknownValue()).toEqual({ status: "unknown" });
  });

  test("uncertain() builds a candidate with confidence", () => {
    expect(uncertain(7, 0.55)).toEqual({ status: "uncertain", value: 7, confidence: 0.55 });
  });

  test("uncertain() rejects out-of-range confidence", () => {
    expect(() => uncertain(7, 1.5)).toThrow(InvalidUncertainValueError);
    expect(() => uncertain(7, Number.NaN)).toThrow(InvalidUncertainValueError);
  });

  test("every helper output validates against the contracts schema", () => {
    expect(UncertainValue.safeParse(known({ x: 1, y: 2 }, 0.4)).success).toBe(true);
    expect(UncertainValue.safeParse(unknownValue()).success).toBe(true);
    expect(UncertainValue.safeParse(uncertain("away", 0.3)).success).toBe(true);
  });
});

describe("resolveUncertain", () => {
  test("resolves a known slot to its value and status", () => {
    expect(resolveUncertain(known("home"))).toEqual({ status: "known", value: "home" });
  });

  test("resolves an unknown slot without a value key", () => {
    const resolved = resolveUncertain(unknownValue());
    expect(resolved.status).toBe("unknown");
    expect("value" in resolved).toBe(false);
  });

  test("resolves an uncertain slot to its candidate value", () => {
    const resolved = resolveUncertain(uncertain(9, 0.6));
    expect(resolved.status).toBe("uncertain");
    expect(resolved.value).toBe(9);
  });
});
