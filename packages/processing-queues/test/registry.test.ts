/**
 * Terminal-disposition registry tests (W302): first write wins, records are
 * frozen, registration order is preserved, and the processedKeys projection
 * is exactly the checkpoint resume set.
 */
import { describe, expect, test } from "bun:test";
import { TerminalDispositionRegistry } from "../src/registry";

describe("TerminalDispositionRegistry", () => {
  test("put records and get returns the frozen record", () => {
    const registry = new TerminalDispositionRegistry();
    expect(registry.put("k0", "emitted")).toBe(true);
    expect(registry.get("k0")).toEqual({ idempotencyKey: "k0", disposition: "emitted" });
    expect(registry.size).toBe(1);
  });

  test("first write wins: a later put for the same key is a no-op", () => {
    const registry = new TerminalDispositionRegistry();
    expect(registry.put("k0", "emitted")).toBe(true);
    expect(registry.put("k0", "dead-lettered")).toBe(false);
    expect(registry.get("k0")?.disposition).toBe("emitted");
    expect(registry.size).toBe(1);
  });

  test("records are frozen on creation", () => {
    const registry = new TerminalDispositionRegistry();
    registry.put("k0", "dead-lettered");
    const record = registry.get("k0");
    expect(() => {
      (record as { disposition: string }).disposition = "emitted";
    }).toThrow();
  });

  test("processedKeys preserves registration order", () => {
    const registry = new TerminalDispositionRegistry();
    registry.put("b", "emitted");
    registry.put("a", "emitted");
    registry.put("c", "dead-lettered");
    expect(registry.processedKeys()).toEqual([
      { key: "b", disposition: "emitted" },
      { key: "a", disposition: "emitted" },
      { key: "c", disposition: "dead-lettered" },
    ]);
  });

  test("records() returns fresh copies owned by the caller", () => {
    const registry = new TerminalDispositionRegistry();
    registry.put("k0", "emitted");
    const first = registry.records();
    (first[0] as { disposition: string }).disposition = "mutated";
    expect(registry.get("k0")?.disposition).toBe("emitted");
  });

  test("get on an unknown key returns undefined", () => {
    const registry = new TerminalDispositionRegistry();
    expect(registry.get("nope")).toBeUndefined();
  });

  test("put fails loud on an empty key", () => {
    const registry = new TerminalDispositionRegistry();
    expect(() => registry.put("", "emitted")).toThrow(RangeError);
  });

  test("put fails loud on an invalid disposition", () => {
    const registry = new TerminalDispositionRegistry();
    expect(() => registry.put("k0", "refused" as "emitted")).toThrow(RangeError);
  });
});
