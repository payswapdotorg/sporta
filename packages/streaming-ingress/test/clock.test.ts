/**
 * VirtualClock unit tests (W301): virtual time advances ONLY at registered
 * wait deadlines, never spontaneously, never backwards; waits in the past
 * resolve without advancing; non-finite deadlines fail loud. Deterministic
 * per docs/testing/HARNESS.md — microtasks only, no real timers.
 */
import { describe, expect, test } from "bun:test";
import { VirtualClock } from "../src/index";
import { drainMicrotasks } from "./helpers";

describe("VirtualClock — deterministic virtual time", () => {
  test("starts at the given time and does not advance spontaneously", async () => {
    const clock = new VirtualClock(1_000);
    expect(clock.now()).toBe(1_000);
    await drainMicrotasks(100);
    expect(clock.now()).toBe(1_000); // no wait registered ⇒ time is frozen
  });

  test("defaults to time 0", () => {
    expect(new VirtualClock().now()).toBe(0);
  });

  test("wait(future) advances time to exactly the deadline", async () => {
    const clock = new VirtualClock(0);
    await clock.wait(120);
    expect(clock.now()).toBe(120);
    await clock.wait(130);
    expect(clock.now()).toBe(130);
  });

  test("wait(past) resolves immediately without advancing", async () => {
    const clock = new VirtualClock(200);
    await clock.wait(0);
    await clock.wait(199);
    expect(clock.now()).toBe(200);
  });

  test("time never goes backwards: a late-registered earlier wait resolves at the current time", async () => {
    const clock = new VirtualClock(0);
    await clock.wait(300);
    expect(clock.now()).toBe(300);
    await clock.wait(100); // already past — resolves, clock stays at 300
    expect(clock.now()).toBe(300);
  });

  test("sequential waits advance monotonically through each deadline", async () => {
    const clock = new VirtualClock(0);
    const observed: number[] = [];
    for (const deadline of [50, 50, 240, 241, 1_000]) {
      await clock.wait(deadline);
      observed.push(clock.now());
    }
    expect(observed).toEqual([50, 50, 240, 241, 1_000]);
  });

  test("non-finite deadlines reject fail-loud", async () => {
    const clock = new VirtualClock(0);
    await expect(clock.wait(Number.NaN)).rejects.toThrow(RangeError);
    await expect(clock.wait(Number.POSITIVE_INFINITY)).rejects.toThrow(RangeError);
    expect(clock.now()).toBe(0);
  });

  test("non-finite constructor start fails loud", () => {
    expect(() => new VirtualClock(Number.NaN)).toThrow(RangeError);
  });

  test("deterministic: two clocks driven through the same wait sequence read equal", async () => {
    const a = new VirtualClock(0);
    const b = new VirtualClock(0);
    for (const deadline of [10, 400, 401, 5_000]) {
      await a.wait(deadline);
      await b.wait(deadline);
      expect(a.now()).toBe(b.now());
    }
    expect(a.now()).toBe(5_000);
  });
});
