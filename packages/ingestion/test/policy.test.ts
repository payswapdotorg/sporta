/**
 * W101 ingestion policy tests: the default allowlist and resource bounds.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_INGESTION_POLICY } from "../src/index";
import type { Container } from "../src/index";

describe("DEFAULT_INGESTION_POLICY", () => {
  test("allows the streaming container family and excludes avi", () => {
    expect(DEFAULT_INGESTION_POLICY.allowedContainers).toEqual(["mp4", "webm", "mkv", "mpegts"]);
  });

  test("bounds source size at 2 GiB (2 * 1024^3 bytes)", () => {
    expect(DEFAULT_INGESTION_POLICY.maxBytes).toBe(2 * 1024 * 1024 * 1024);
  });

  test("declares no duration cap (enforcement lands with W102 decoding)", () => {
    expect(DEFAULT_INGESTION_POLICY.maxDurationMs).toBeUndefined();
  });

  test("is frozen: the shared default cannot be mutated by callers", () => {
    expect(() => {
      DEFAULT_INGESTION_POLICY.maxBytes = 1;
    }).toThrow(TypeError);
    expect(() => {
      (DEFAULT_INGESTION_POLICY.allowedContainers as Container[]).push("avi");
    }).toThrow(TypeError);
    // The frozen state itself is unchanged.
    expect(DEFAULT_INGESTION_POLICY.allowedContainers).toHaveLength(4);
    expect(DEFAULT_INGESTION_POLICY.maxBytes).toBe(2 * 1024 * 1024 * 1024);
  });
});
