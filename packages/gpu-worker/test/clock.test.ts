/**
 * VirtualGpuClock tests (W303): virtual time moves only through
 * sleep/advance/advanceTo; passive `waitUntil` waiters fire in deadline
 * order when a later advance crosses them; validation is fail-loud; the
 * same call sequence produces the same readings (determinism).
 */
import { describe, expect, test } from "bun:test";
import { VirtualGpuClock } from "../src/clock";
import { until } from "./helpers";

describe("VirtualGpuClock", () => {
  test("starts at the injected start time and never advances spontaneously", async () => {
    const clock = new VirtualGpuClock(1_000);
    expect(clock.now()).toBe(1_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(clock.now()).toBe(1_000);
    expect(clock.pendingWaiters).toBe(0);
  });

  test("constructor fails loud on a non-finite start", () => {
    expect(() => new VirtualGpuClock(Number.NaN)).toThrow(RangeError);
    expect(() => new VirtualGpuClock(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  test("sleep advances the clock by its duration and resolves without real waiting", async () => {
    const clock = new VirtualGpuClock(0);
    await clock.sleep(100);
    expect(clock.now()).toBe(100);
    await clock.sleep(25);
    expect(clock.now()).toBe(125);
  });

  test("a zero-duration sleep is a no-op that still resolves", async () => {
    const clock = new VirtualGpuClock(7);
    await clock.sleep(0);
    expect(clock.now()).toBe(7);
  });

  test("sleep rejects loudly on a negative duration (no clock change)", async () => {
    const clock = new VirtualGpuClock(10);
    await expect(clock.sleep(-1)).rejects.toThrow(RangeError);
    expect(clock.now()).toBe(10);
  });

  test("sleep rejects loudly on a non-finite duration", async () => {
    const clock = new VirtualGpuClock(10);
    await expect(clock.sleep(Number.NaN)).rejects.toThrow(RangeError);
    await expect(clock.sleep(Number.POSITIVE_INFINITY)).rejects.toThrow(RangeError);
  });

  test("waitUntil resolves immediately for a deadline at or before now", async () => {
    const clock = new VirtualGpuClock(50);
    await clock.waitUntil(50);
    await clock.waitUntil(0);
    expect(clock.pendingWaiters).toBe(0);
  });

  test("waitUntil parks for a future deadline (a passive wait)", async () => {
    const clock = new VirtualGpuClock(0);
    const parked = clock.waitUntil(100);
    expect(clock.pendingWaiters).toBe(1);
    clock.advanceTo(100);
    await parked;
    expect(clock.pendingWaiters).toBe(0);
  });

  test("waitUntil rejects loudly on a non-finite deadline", async () => {
    const clock = new VirtualGpuClock(0);
    await expect(clock.waitUntil(Number.NaN)).rejects.toThrow(RangeError);
    await expect(clock.waitUntil(Number.NEGATIVE_INFINITY)).rejects.toThrow(RangeError);
  });

  test("advance and advanceTo move time explicitly (the fixture tools)", () => {
    const clock = new VirtualGpuClock(0);
    clock.advance(40);
    expect(clock.now()).toBe(40);
    clock.advanceTo(90);
    expect(clock.now()).toBe(90);
    clock.advanceTo(90); // same target: a no-op
    expect(clock.now()).toBe(90);
  });

  test("advance fails loud on invalid input", () => {
    const clock = new VirtualGpuClock(0);
    expect(() => clock.advance(-5)).toThrow(RangeError);
    expect(() => clock.advance(Number.NaN)).toThrow(RangeError);
    expect(() => clock.advanceTo(-1)).toThrow(RangeError);
    expect(() => clock.advanceTo(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(clock.now()).toBe(0);
  });

  test("a big jump fires every crossed waiter exactly once, in deadline order", async () => {
    const clock = new VirtualGpuClock(0);
    const fired: number[] = [];
    const early = clock.waitUntil(100).then(() => fired.push(100));
    const late = clock.waitUntil(300).then(() => fired.push(300));
    const mid = clock.waitUntil(200).then(() => fired.push(200));
    clock.advance(350);
    await Promise.all([early, mid, late]);
    expect(fired).toEqual([100, 200, 300]);
    expect(clock.pendingWaiters).toBe(0);
    expect(clock.now()).toBe(350);
  });

  test("same-deadline waiters resolve in registration (FIFO) order", async () => {
    const clock = new VirtualGpuClock(0);
    const fired: string[] = [];
    const first = clock.waitUntil(100).then(() => fired.push("first"));
    const second = clock.waitUntil(100).then(() => fired.push("second"));
    clock.advance(100);
    await Promise.all([first, second]);
    expect(fired).toEqual(["first", "second"]);
  });

  test("sleep fires crossed waiters BEFORE the sleeper resumes (work keeps heartbeats beating)", async () => {
    const clock = new VirtualGpuClock(0);
    const order: string[] = [];
    const waiter = clock.waitUntil(50).then(() => order.push("waiter"));
    const sleeper = clock.sleep(100).then(() => order.push("sleeper"));
    await Promise.all([waiter, sleeper]);
    expect(order).toEqual(["waiter", "sleeper"]);
    expect(clock.now()).toBe(100);
  });

  test("a resolved waiter's continuation re-registers from the post-advance present", async () => {
    // The documented discretization: a jump to 700 fires the waiter parked at
    // 100; its continuation computes the next deadline from now()=700, so the
    // beats scheduled for 200..700 are skipped (one beat per crossed
    // deadline), and later beats fire only on later advances.
    const clock = new VirtualGpuClock(0);
    let beats = 0;
    const loop = (async () => {
      for (let i = 0; i < 3; i += 1) {
        const due = clock.now() + 100;
        await clock.waitUntil(due);
        beats += 1;
      }
    })();
    clock.advance(700);
    expect(await until(() => beats >= 1)).toBe(true);
    expect(beats).toBe(1); // exactly one beat for the whole 0->700 jump
    clock.advance(100); // 800: the re-registered deadline fires
    expect(await until(() => beats >= 2)).toBe(true);
    clock.advance(100); // 900
    expect(await until(() => beats >= 3)).toBe(true);
    await loop;
    expect(beats).toBe(3);
    expect(clock.now()).toBe(900);
  });

  test("the same call sequence produces the same readings (determinism)", async () => {
    const run = async (): Promise<Array<number | string>> => {
      const clock = new VirtualGpuClock(1_000);
      const trace: Array<number | string> = [clock.now()];
      await clock.sleep(10);
      trace.push(clock.now());
      const waiter = clock.waitUntil(clock.now() + 20).then(() => trace.push("beat"));
      await clock.sleep(30);
      await waiter;
      trace.push(clock.now());
      return trace;
    };
    const first = await run();
    const second = await run();
    expect(first).toEqual(second);
    expect(first).toEqual([1_000, 1_010, "beat", 1_040]);
  });
});
