/**
 * Virtual processing clock tests (W302): virtual time advances ONLY at
 * registered sleeps, never spontaneously; validation is fail-loud; the same
 * call sequence produces the same readings (determinism).
 */
import { describe, expect, test } from "bun:test";
import { VirtualProcessingClock } from "../src/clock";

describe("VirtualProcessingClock", () => {
  test("starts at the injected start time", () => {
    expect(new VirtualProcessingClock(0).now()).toBe(0);
    expect(new VirtualProcessingClock(1_000).now()).toBe(1_000);
  });

  test("time never advances without a registered sleep", async () => {
    const clock = new VirtualProcessingClock(50);
    await Promise.resolve();
    await Promise.resolve();
    expect(clock.now()).toBe(50);
  });

  test("sleep advances the clock by its duration and resolves without real waiting", async () => {
    const clock = new VirtualProcessingClock(0);
    await clock.sleep(100);
    expect(clock.now()).toBe(100);
    await clock.sleep(25);
    expect(clock.now()).toBe(125);
  });

  test("a zero-duration sleep is a no-op that still resolves", async () => {
    const clock = new VirtualProcessingClock(7);
    await clock.sleep(0);
    expect(clock.now()).toBe(7);
  });

  test("sleep rejects loudly on a negative duration (no clock change)", async () => {
    const clock = new VirtualProcessingClock(10);
    await expect(clock.sleep(-1)).rejects.toThrow(RangeError);
    expect(clock.now()).toBe(10);
  });

  test("sleep rejects loudly on a non-finite duration", async () => {
    const clock = new VirtualProcessingClock(10);
    await expect(clock.sleep(Number.NaN)).rejects.toThrow(RangeError);
    await expect(clock.sleep(Number.POSITIVE_INFINITY)).rejects.toThrow(RangeError);
  });

  test("advance moves time explicitly (the test tool)", () => {
    const clock = new VirtualProcessingClock(0);
    clock.advance(40);
    expect(clock.now()).toBe(40);
  });

  test("advance fails loud on invalid input", () => {
    const clock = new VirtualProcessingClock(0);
    expect(() => clock.advance(-5)).toThrow(RangeError);
    expect(() => clock.advance(Number.NaN)).toThrow(RangeError);
    expect(clock.now()).toBe(0);
  });

  test("constructor fails loud on a non-finite start", () => {
    expect(() => new VirtualProcessingClock(Number.NaN)).toThrow(RangeError);
    expect(() => new VirtualProcessingClock(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  test("the same sleep sequence produces the same readings (determinism)", async () => {
    const run = async (): Promise<number[]> => {
      const clock = new VirtualProcessingClock(1_000);
      const readings = [clock.now()];
      await clock.sleep(10);
      readings.push(clock.now());
      await clock.sleep(20);
      readings.push(clock.now());
      return readings;
    };
    expect(await run()).toEqual(await run());
    expect((await run())[2]).toBe(1_030);
  });
});
