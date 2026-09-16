import { describe, expect, test } from "bun:test";
import { LiveLatencyWindow, measureLiveLatencyMs } from "../src/lib/live-latency";

/**
 * LIVE LATENCY TESTS (W915) — the pure measurement math. The numbers the UI
 * and the evidence script surface come from THIS code: nearest-rank
 * percentiles over really-added samples; absent metrics stay absent.
 */

test("an empty window has NO snapshot (never a faked zero)", () => {
  const window = new LiveLatencyWindow();
  expect(window.size).toBe(0);
  expect(window.snapshot()).toBeNull();
});

test("a single sample is every percentile (nearest-rank)", () => {
  const window = new LiveLatencyWindow();
  window.add(37);
  const snapshot = window.snapshot();
  expect(snapshot).not.toBeNull();
  expect(snapshot).toMatchObject({
    count: 1,
    lastMs: 37,
    minMs: 37,
    p50Ms: 37,
    p95Ms: 37,
    maxMs: 37,
  });
});

test("nearest-rank percentiles over 20 samples (p50 = 11th, p95 = 19th)", () => {
  const window = new LiveLatencyWindow();
  for (let i = 1; i <= 20; i += 1) window.add(i);
  const snapshot = window.snapshot();
  expect(snapshot).not.toBeNull();
  expect(snapshot!.count).toBe(20);
  expect(snapshot!.minMs).toBe(1);
  // ceil(0.5 * 20) = 10 → sorted[9] = 10; ceil(0.95 * 20) = 19 → sorted[18] = 19.
  expect(snapshot!.p50Ms).toBe(10);
  expect(snapshot!.p95Ms).toBe(19);
  expect(snapshot!.maxMs).toBe(20);
  expect(snapshot!.lastMs).toBe(20); // insertion order, not sorted order
});

test("p95 rounds UP on a non-integral rank (7 samples → rank 7)", () => {
  const window = new LiveLatencyWindow();
  for (const value of [5, 1, 9, 3, 7, 2, 8]) window.add(value);
  const snapshot = window.snapshot();
  expect(snapshot).not.toBeNull();
  // sorted = [1,2,3,5,7,8,9]; ceil(0.95 * 7) = ceil(6.65) = 7 → sorted[6] = 9.
  expect(snapshot!.p95Ms).toBe(9);
  // ceil(0.5 * 7) = 4 → sorted[3] = 5.
  expect(snapshot!.p50Ms).toBe(5);
});

test("negative samples (unsynchronized-clock skew) are kept verbatim", () => {
  const window = new LiveLatencyWindow();
  window.add(-12);
  window.add(4);
  const snapshot = window.snapshot();
  expect(snapshot).not.toBeNull();
  expect(snapshot!.minMs).toBe(-12);
  expect(snapshot!.maxMs).toBe(4);
  expect(snapshot!.lastMs).toBe(4);
});

test("non-finite samples are refused (never a fake number)", () => {
  const window = new LiveLatencyWindow();
  expect(() => window.add(Number.NaN)).toThrow();
  expect(() => window.add(Number.POSITIVE_INFINITY)).toThrow();
  expect(window.size).toBe(0);
});

test("reset clears the window back to absent", () => {
  const window = new LiveLatencyWindow();
  window.add(5);
  window.reset();
  expect(window.size).toBe(0);
  expect(window.snapshot()).toBeNull();
});

test("measureLiveLatencyMs is the plain receipt-minus-generation diff", () => {
  expect(measureLiveLatencyMs(1_000, 1_030)).toBe(30);
  expect(measureLiveLatencyMs(1_030, 1_000)).toBe(-30);
});

describe("LiveLatencyWindow contract", () => {
  test("the snapshot is a fresh object every call (no aliasing)", () => {
    const window = new LiveLatencyWindow();
    window.add(1);
    const a = window.snapshot();
    const b = window.snapshot();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
