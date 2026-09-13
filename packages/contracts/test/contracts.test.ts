import { describe, expect, test } from "bun:test";
import { CONTRACTS_PACKAGE_VERSION } from "../src/index";

describe("@sporta/contracts", () => {
  test("exposes the placeholder package version", () => {
    expect(CONTRACTS_PACKAGE_VERSION).toBe("0.1.0");
  });
});
